"""
Flux API endpoints - Flux Kontext Integration
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas.response import ResponseBase
from app.schemas.file import GenerationTaskCreate, GenerationTaskResponse
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.integrations.flux.client import FluxClient
from app.services.storage import get_storage_service, StorageService
from app.core.credits import InsufficientCreditsError
from app.core.pricing import max_prompt_chars
from app.config import Settings
from app.utils.helpers import get_user_output_path
from pathlib import Path
import uuid
import json
import aiofiles
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

router = APIRouter()
settings = Settings()

# Model ID mapping: frontend ID -> gateway model name (wan)
MODEL_MAPPING = {
    'wan2.7-image': 'wan2.7-image',
    'wan2.7-image-pro': 'wan2.7-image-pro',
}

# Credit costs per model
CREDIT_COSTS = {
    'wan2.7-image': 40,
    'wan2.7-image-pro': 80,
}


async def process_flux_image_generation(
    task_id: str,
    user_id: int,
    tenant_id: int,
    prompt: str,
    aspect_ratio: str,
    output_format: str,
    model_id: str,
    reference_image_path: str = None,
    drama_project_id: str = None,
):
    """Background task to process Flux image generation"""
    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask
    from app.services.credit_service import CreditService
    
    async with AsyncSessionLocal() as db:
        try:
            # Get the task
            from sqlalchemy import select
            result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            db_task = result.scalar_one_or_none()
            
            if not db_task:
                logger.error(f"Task {task_id} not found")
                return
            
            # Update status to processing
            db_task.status = "processing"
            db_task.progress = 10
            await db.commit()
            
            # Deduct credits
            credit_service = CreditService(db)
            cost = CREDIT_COSTS.get(model_id, 40)
            
            try:
                await credit_service.deduct(
                    tenant_id=tenant_id,
                    amount=cost,
                    description=f"Flux Kontext 图像生成: {prompt[:50]}..."
                )
            except InsufficientCreditsError as e:
                db_task.status = "failed"
                db_task.error_message = str(e)
                await db.commit()
                return
            
            # Initialize image client (gateway / wan)
            if not settings.AI_GATEWAY_API_KEY:
                db_task.status = "failed"
                db_task.error_message = "AI 网关未配置 (AI_GATEWAY_API_KEY)"
                await db.commit()
                # Refund credits
                await credit_service.recharge(
                    tenant_id=tenant_id,
                    amount=cost,
                    payment_method="refund",
                    reference_id=task_id
                )
                return
            
            flux_client = FluxClient(user_id=user_id)

            # Update progress
            db_task.progress = 30
            await db.commit()

            # Generate output path
            output_path = get_user_output_path(settings.STORAGE_BASE_PATH, user_id, "images")
            ext = "png" if output_format == "png" else "jpg"
            filename = f"flux_{task_id}.{ext}"

            # Encode reference image as base64 if provided
            input_image_b64 = None
            if reference_image_path:
                try:
                    import base64
                    async with aiofiles.open(reference_image_path, 'rb') as f:
                        img_data = await f.read()
                    input_image_b64 = base64.b64encode(img_data).decode('utf-8')
                except Exception as _e:
                    logger.warning(f"Failed to read reference image {reference_image_path}: {_e}")

            # Generate image
            result = await flux_client.generate_image(
                prompt=prompt,
                output_path=output_path,
                filename=filename,
                aspect_ratio=aspect_ratio,
                output_format=output_format,
                model=model_id,
                input_image=input_image_b64,
            )
            
            if result.get("success"):
                local_path = output_path / filename
                result_url = f"/api/v1/flux/outputs/{user_id}/images/{filename}"
                result_path_val = str(local_path)

                # Upload to MinIO (use drama path when project context is set)
                if settings.MINIO_ENABLED:
                    try:
                        storage = get_storage_service()
                        if drama_project_id:
                            object_key = storage.drama_image_key(user_id, drama_project_id, filename)
                        else:
                            object_key = storage.user_image_key(user_id, filename)
                        result_url = await storage.upload_and_get_url(
                            local_path, object_key,
                            StorageService.content_type_for(filename),
                        )
                        result_path_val = object_key
                    except Exception as _e:
                        logger.warning(f"Task {task_id}: MinIO upload failed, using local: {_e}")

                db_task.status = "completed"
                db_task.progress = 100
                db_task.result_url = result_url
                db_task.result_path = result_path_val
                await db.commit()
                logger.info(f"Flux image generation completed: {task_id}")
            else:
                error_msg = result.get("error", "Unknown error")
                db_task.status = "failed"
                db_task.error_message = error_msg
                await db.commit()
                
                # Refund credits on failure
                await credit_service.recharge(
                    tenant_id=tenant_id,
                    amount=cost,
                    payment_method="refund",
                    reference_id=task_id
                )
                logger.error(f"Flux image generation failed: {task_id} - {error_msg}")
                
        except Exception as e:
            logger.error(f"Error processing Flux task {task_id}: {str(e)}")
            try:
                from sqlalchemy import select
                result = await db.execute(
                    select(GenerationTask).where(GenerationTask.task_id == task_id)
                )
                db_task = result.scalar_one_or_none()
                if db_task:
                    db_task.status = "failed"
                    db_task.error_message = str(e)
                    await db.commit()
            except:
                pass


@router.post("/generate-image", response_model=ResponseBase[GenerationTaskResponse])
async def generate_image(
    task: GenerationTaskCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generate image with wan (via aggregation gateway)"""
    if not settings.AI_GATEWAY_API_KEY:
        raise HTTPException(status_code=500, detail="AI 网关未配置 (AI_GATEWAY_API_KEY)")
    
    # Validate model
    model_id = task.model_id
    if model_id not in MODEL_MAPPING:
        raise HTTPException(status_code=400, detail=f"Invalid model ID: {model_id}")

    _limit = max_prompt_chars(model_id)
    if task.prompt and len(task.prompt) > _limit:
        raise HTTPException(
            status_code=400,
            detail=f"提示词过长：当前 {len(task.prompt)} 字，该模型最多 {_limit} 字，请精简后重试",
        )

    # Get credit cost
    cost = CREDIT_COSTS.get(model_id, 40)
    
    # Check credits before starting task
    try:
        from app.services.credit_service import CreditService
        credit_service = CreditService(db)
        has_sufficient = await credit_service.check_sufficient_credits(
            current_user.tenant_id, cost
        )
        
        if not has_sufficient:
            balance = await credit_service.get_balance(current_user.tenant_id)
            raise HTTPException(
                status_code=400,
                detail=f"积分不足。需要 {cost} 积分，当前余额 {balance} 积分"
            )
    except InsufficientCreditsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Create task ID
    task_id = str(uuid.uuid4())

    # Get parameters
    aspect_ratio = task.aspect_ratio or "1:1"
    output_format = "jpeg"

    # Resolve reference image path if provided
    reference_image_path = None
    if task.reference_image_id:
        from app.utils.helpers import get_user_upload_path
        upload_path = get_user_upload_path(settings.STORAGE_BASE_PATH, current_user.id)
        for ext in ['.jpg', '.jpeg', '.png', '.webp']:
            potential_path = upload_path / f"{task.reference_image_id}{ext}"
            if potential_path.exists():
                reference_image_path = str(potential_path)
                break

    # Store task in database
    from app.models.generation_task import GenerationTask

    db_task = GenerationTask(
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        model_id=model_id,
        task_type="image",
        prompt=task.prompt,
        parameters=json.dumps({
            "aspect_ratio": aspect_ratio,
            "output_format": output_format
        }),
        status="pending",
        # 短剧分镜图(带 drama_project_id)是中间产物，不作为作品展示；用户直接生成的单图才展示。
        show_in_gallery=0 if task.drama_project_id else 1,
    )
    db.add(db_task)
    await db.commit()

    # Start background task
    background_tasks.add_task(
        process_flux_image_generation,
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        prompt=task.prompt,
        aspect_ratio=aspect_ratio,
        output_format=output_format,
        model_id=model_id,
        reference_image_path=reference_image_path,
        drama_project_id=task.drama_project_id,
    )
    
    return ResponseBase(
        success=True,
        message="Image generation task created",
        data=GenerationTaskResponse(
            task_id=task_id,
            status="pending",
            message="Task submitted successfully",
            progress=0
        )
    )


@router.get("/task/{task_id}", response_model=ResponseBase[GenerationTaskResponse])
async def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get Flux generation task status"""
    from sqlalchemy import select
    from app.models.generation_task import GenerationTask

    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id == task_id,
            GenerationTask.user_id == current_user.id
        )
    )
    db_task = result.scalar_one_or_none()

    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Use task-based URL for result, fall back to stored result_url for older tasks
    if db_task.result_path:
        result_url = f"/api/v1/flux/task/{task_id}/file"
    else:
        result_url = db_task.result_url  # Fall back to old format

    return ResponseBase(
        success=True,
        message="Task status retrieved",
        data=GenerationTaskResponse(
            task_id=db_task.task_id,
            status=db_task.status,
            message=f"Task is {db_task.status}",
            result_url=result_url,
            error=db_task.error_message,
            progress=db_task.progress or 0
        )
    )


@router.get("/task/{task_id}/file")
async def get_task_file(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Download generated file by task ID (public access via task_id)"""
    from sqlalchemy import select
    from app.models.generation_task import GenerationTask

    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id == task_id
        )
    )
    db_task = result.scalar_one_or_none()

    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    if db_task.status != "completed" or not db_task.result_path:
        raise HTTPException(status_code=400, detail="File not available")

    # MinIO-stored file → stream through backend
    if StorageService.is_minio_key(db_task.result_path):
        try:
            storage = get_storage_service()
            data, content_type = await storage.get_object_bytes(db_task.result_path)
            return Response(content=data, media_type=content_type)
        except Exception as _e:
            raise HTTPException(status_code=500, detail=f"Storage error: {_e}")

    # Legacy local file
    file_path = Path(db_task.result_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    ext = file_path.suffix.lower()
    media_type = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'
    }.get(ext, 'application/octet-stream')

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=file_path.name
    )


@router.get("/history")
async def get_history(
    task_type: str = "image",
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's Flux generation history"""
    from sqlalchemy import select, desc
    from app.models.generation_task import GenerationTask
    
    # Filter for Flux models
    flux_models = list(MODEL_MAPPING.keys())
    
    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.user_id == current_user.id,
            GenerationTask.task_type == task_type,
            GenerationTask.model_id.in_(flux_models),
            GenerationTask.status == "completed"
        ).order_by(desc(GenerationTask.created_at)).limit(limit)
    )
    tasks = result.scalars().all()
    
    history = []
    for task in tasks:
        params = {}
        if task.parameters:
            try:
                params = json.loads(task.parameters)
            except:
                pass

        # Use task-based URL for result, fall back to stored result_url for older tasks
        if task.result_path:
            result_url = f"/api/v1/flux/task/{task.task_id}/file"
        else:
            result_url = task.result_url  # Fall back to old format

        history.append({
            "task_id": task.task_id,
            "prompt": task.prompt,
            "model_id": task.model_id,
            "result_url": result_url,
            "parameters": params,
            "created_at": task.created_at.isoformat() if task.created_at else None
        })

    return ResponseBase(
        success=True,
        message="History retrieved",
        data=history
    )
