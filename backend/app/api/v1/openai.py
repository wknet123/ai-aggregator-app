"""
Image / Video endpoints routed through the AI 网关 (wan image models).
"""
from typing import Annotated, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from pathlib import Path
from pydantic import BaseModel
import uuid
import json
from datetime import datetime
import logging

from app.db.session import get_db, AsyncSessionLocal
from app.dependencies import get_current_tenant, get_current_user
from app.models.tenant import Tenant
from app.models.user import User
from app.services.openai_service import OpenAIService
from app.services.storage import get_storage_service, StorageService
from app.schemas.response import ResponseBase
from app.schemas.file import GenerationTaskCreate, GenerationTaskResponse
from app.core.credits import InsufficientCreditsError
from app.integrations.openai.client import OpenAIClient
from app.config import Settings
from app.utils.helpers import get_user_output_path

logger = logging.getLogger(__name__)

router = APIRouter()
settings = Settings()

# Credit costs for wan image models (via AI 网关).
# 'high' quality routes to the pro model (wan2.7-image-pro); others use standard.
GPT_IMAGE_COSTS = {
    'wan2.7-image': {
        'low': 40,      # 标清
        'medium': 80,   # 高清
        'high': 160,    # 超清 (pro)
    },
    'wan2.7-image-pro': {
        'low': 80,
        'medium': 120,
        'high': 160,
    },
}


class ImageGenerationRequest(BaseModel):
    """Image generation request"""
    prompt: str
    model: str = "wan2.7-image"
    size: str = "1024x1024"
    quality: str = "standard"


class GPTImageGenerationRequest(BaseModel):
    """wan image generation request"""
    prompt: str
    model_id: str = "wan2.7-image"
    quality: str = "medium"  # low, medium, high
    size: str = "1024x1024"
    output_format: str = "png"


class VideoGenerationRequest(BaseModel):
    """Video generation request"""
    prompt: str
    duration: int = 5  # seconds
    resolution: str = "1080p"
    fps: int = 24


async def process_gpt_image_generation(
    task_id: str,
    user_id: int,
    tenant_id: int,
    prompt: str,
    model_id: str,
    quality: str,
    size: str,
    output_format: str
):
    """Background task to process GPT-Image generation"""
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
            
            # Get credit cost
            model_costs = GPT_IMAGE_COSTS.get(model_id, GPT_IMAGE_COSTS['wan2.7-image'])
            cost = model_costs.get(quality, model_costs['medium'])

            # Deduct credits
            credit_service = CreditService(db)

            try:
                await credit_service.deduct(
                    tenant_id=tenant_id,
                    amount=cost,
                    description=f"wan 图像生成 ({quality}): {prompt[:50]}..."
                )
            except InsufficientCreditsError as e:
                db_task.status = "failed"
                db_task.error_message = str(e)
                await db.commit()
                return

            # Initialize gateway client
            if not settings.AI_GATEWAY_API_KEY:
                db_task.status = "failed"
                db_task.error_message = "AI 网关未配置"
                await db.commit()
                # Refund credits
                await credit_service.recharge(
                    tenant_id=tenant_id,
                    amount=cost,
                    payment_method="refund",
                    reference_id=task_id
                )
                return
            
            openai_client = OpenAIClient(user_id=user_id)
            
            # Update progress
            db_task.progress = 30
            await db.commit()
            
            # Generate output path
            output_path = get_user_output_path(settings.STORAGE_BASE_PATH, user_id, "images")
            ext = output_format if output_format in ['png', 'jpeg', 'webp'] else 'png'
            filename = f"gptimage_{task_id}.{ext}"
            
            # Generate image
            result = await openai_client.generate_image_gpt(
                prompt=prompt,
                output_path=output_path,
                filename=filename,
                model=model_id,
                quality=quality,
                size=size,
                output_format=output_format
            )
            
            if result.get("success"):
                local_path = output_path / filename
                result_url = f"/api/v1/openai/outputs/{user_id}/images/{filename}"
                result_path_val = str(local_path)

                # Upload to MinIO
                if settings.MINIO_ENABLED:
                    try:
                        storage = get_storage_service()
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
                logger.info(f"GPT-Image generation completed: {task_id}")
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
                logger.error(f"GPT-Image generation failed: {task_id} - {error_msg}")
                
        except Exception as e:
            logger.error(f"Error processing GPT-Image task {task_id}: {str(e)}")
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
async def generate_gpt_image(
    task: GenerationTaskCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generate image with wan model via AI 网关"""
    if not settings.AI_GATEWAY_API_KEY:
        raise HTTPException(status_code=500, detail="AI 网关未配置")
    
    # Parse model_id to get actual model name
    model_id = task.model_id
    if model_id not in GPT_IMAGE_COSTS:
        raise HTTPException(status_code=400, detail=f"Invalid model ID: {model_id}")
    
    # Get parameters - try to parse from aspect_ratio field for quality
    # Frontend might send quality in aspect_ratio field for this model
    quality = "medium"
    size = "1024x1024"
    output_format = "png"
    
    # Handle the case where quality might be passed via aspect_ratio
    if task.aspect_ratio in ['low', 'medium', 'high']:
        quality = task.aspect_ratio
    
    # Get credit cost
    model_costs = GPT_IMAGE_COSTS.get(model_id, GPT_IMAGE_COSTS['wan2.7-image'])
    cost = model_costs.get(quality, model_costs['medium'])

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
            "quality": quality,
            "size": size,
            "output_format": output_format
        }),
        status="pending",
        # 短剧分镜图(带 drama_project_id)是中间产物，不作为作品展示。
        show_in_gallery=0 if task.drama_project_id else 1,
    )
    db.add(db_task)
    await db.commit()
    
    # Start background task
    background_tasks.add_task(
        process_gpt_image_generation,
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        prompt=task.prompt,
        model_id=model_id,
        quality=quality,
        size=size,
        output_format=output_format
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
    """Get GPT-Image generation task status"""
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
        result_url = f"/api/v1/openai/task/{task_id}/file"
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
    """Get user's OpenAI generation history"""
    from sqlalchemy import select, desc
    from app.models.generation_task import GenerationTask
    
    # Filter for GPT-Image models
    gpt_image_models = list(GPT_IMAGE_COSTS.keys())
    
    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.user_id == current_user.id,
            GenerationTask.task_type == task_type,
            GenerationTask.model_id.in_(gpt_image_models),
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
            result_url = f"/api/v1/openai/task/{task.task_id}/file"
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


@router.post("/image", response_model=ResponseBase[dict])
async def generate_image(
    request: ImageGenerationRequest,
    tenant: Annotated[Tenant, Depends(get_current_tenant)],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Image Generation (wan via AI 网关) - Legacy endpoint"""
    try:
        openai_service = OpenAIService(db, use_mock=True, user_id=current_user.id)  # Set to False for production
        
        result = await openai_service.generate_image(
            tenant_id=tenant.id,
            prompt=request.prompt,
            model=request.model,
            quality=request.quality,
            size=request.size
        )
        
        return ResponseBase(
            success=True,
            message="Image generated successfully",
            data=result
        )
        
    except InsufficientCreditsError as e:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Image generation failed: {str(e)}"
        )


@router.post("/video", response_model=ResponseBase[dict])
async def generate_video(
    request: VideoGenerationRequest,
    tenant: Annotated[Tenant, Depends(get_current_tenant)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Video generation here is no longer supported.

    Sora has been removed; route video generation through the general video
    endpoint (Hailuo/HappyHorse) at /api/v1/google/generate-video instead.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="此视频接口已停用，请使用通用视频(Hailuo/HappyHorse)：/api/v1/google/generate-video"
    )
