"""
Google AI API endpoints
"""
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from jose import JWTError, jwt
from app.repositories.user_repository import UserRepository
from app.schemas.response import ResponseBase
from app.schemas.file import FileUploadResponse, GenerationTaskCreate, GenerationTaskResponse
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.integrations.google.client import GoogleAIClient
from app.services.google_service import GoogleService
from app.services.storage import get_storage_service, StorageService
from app.core.credits import InsufficientCreditsError
from app.core.pricing import max_prompt_chars
from app.config import Settings
from app.utils.helpers import get_user_upload_path, get_user_output_path
from pathlib import Path
import uuid
import json
import aiofiles
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


router = APIRouter()
settings = Settings()

# Model ID mapping: frontend UI id -> AI gateway model id
# Image generation always resolves to wan (text-to-image / image-to-image).
# Image-model → gateway-model routing now lives in GoogleService.generate_image
# (it picks standard vs pro from the original model_id).

# Video routing. The active gateway token supports HappyHorse and Seedance, but
# NOT the Hailuo (MiniMax) group — so 'hailuo' falls back to Seedance until that
# group is granted. HappyHorse and Seedance route to their real models.
VIDEO_MODEL_MAPPING = {
    'happyhorse': settings.GATEWAY_VIDEO_HAPPYHORSE,
    'seedance': settings.GATEWAY_DRAMA_VIDEO_MODEL,
    'google-veo': settings.GATEWAY_DRAMA_VIDEO_MODEL,
    'hailuo': settings.GATEWAY_DRAMA_VIDEO_MODEL,  # token lacks Hailuo group → Seedance
}

# Backward-compat alias: drama.py imports MODEL_MAPPING for its (video) pipeline.
# Maps UI ids to gateway video models; drama short-form video uses Seedance.
MODEL_MAPPING = {
    **VIDEO_MODEL_MAPPING,
    'drama': settings.GATEWAY_DRAMA_VIDEO_MODEL,
    'doubao-seedance': settings.GATEWAY_DRAMA_VIDEO_MODEL,
}


@router.post("/upload-frame", response_model=ResponseBase[FileUploadResponse])
async def upload_first_frame(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Upload first frame for video generation"""
    # Validate file type
    if file.content_type not in settings.ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type. Only JPEG, PNG, and WebP are allowed.")
    
    # Validate file size
    contents = await file.read()
    if len(contents) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds maximum limit (10MB)")
    
    # Generate unique file ID and save
    file_id = str(uuid.uuid4())
    file_extension = Path(file.filename).suffix
    upload_path = get_user_upload_path(settings.STORAGE_BASE_PATH, current_user.id)
    file_path = upload_path / f"{file_id}{file_extension}"

    async with aiofiles.open(file_path, 'wb') as f:
        await f.write(contents)

    # Mirror upload to MinIO (best-effort; local copy kept for downstream use)
    if settings.MINIO_ENABLED:
        try:
            storage = get_storage_service()
            object_key = storage.user_upload_key(current_user.id, f"{file_id}{file_extension}")
            await storage.upload_file(file_path, object_key, file.content_type or "image/jpeg")
        except Exception as _e:
            logger.warning(f"MinIO upload of frame {file_id} failed: {_e}")

    return ResponseBase(
        success=True,
        message="File uploaded successfully",
        data=FileUploadResponse(
            success=True,
            file_id=file_id,
            filename=file.filename,
            file_path=str(file_path)
        )
    )


@router.get("/upload-frame/{file_id}")
async def get_uploaded_frame(
    file_id: str,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """Serve a previously-uploaded reference frame by its file_id.

    Accepts auth token via Authorization header OR ?token= query param so that
    <img src="...?token=..."> tags work without a custom fetch.
    """
    import re
    if not re.fullmatch(r'[0-9a-f\-]{36}', file_id):
        raise HTTPException(status_code=400, detail="Invalid file_id")

    # Resolve token from query param or Authorization header
    raw_token = token
    if not raw_token and request is not None:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            raw_token = auth_header[7:]

    if not raw_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(raw_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id_str: str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = int(user_id_str)
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    # 1. Try MinIO first
    if settings.MINIO_ENABLED:
        try:
            storage = get_storage_service()
            for ext in ('.jpg', '.jpeg', '.png', '.webp'):
                key = storage.user_upload_key(user_id, f"{file_id}{ext}")
                try:
                    data, content_type = await storage.get_object_bytes(key)
                    return Response(
                        content=data,
                        media_type=content_type or "image/jpeg",
                        headers={"Cache-Control": "private, max-age=86400"},
                    )
                except Exception:
                    continue
        except Exception as _e:
            logger.debug("MinIO lookup failed for upload frame %s: %s", file_id, _e)

    # 2. Fall back to local file
    upload_path = get_user_upload_path(settings.STORAGE_BASE_PATH, user_id)
    for ext in ('.jpg', '.jpeg', '.png', '.webp'):
        file_path = upload_path / f"{file_id}{ext}"
        if file_path.exists():
            import mimetypes as _mt
            ct = _mt.guess_type(str(file_path))[0] or "image/jpeg"
            return FileResponse(str(file_path), media_type=ct,
                                headers={"Cache-Control": "private, max-age=86400"})

    raise HTTPException(status_code=404, detail="Uploaded frame not found")


@router.post("/generate-image", response_model=ResponseBase[GenerationTaskResponse])
async def generate_image(
    task: GenerationTaskCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generate image via AI 网关 (wan)"""
    if not settings.AI_GATEWAY_API_KEY:
        raise HTTPException(status_code=500, detail="AI 网关未配置")

    _limit = max_prompt_chars(task.model_id)
    if task.prompt and len(task.prompt) > _limit:
        raise HTTPException(
            status_code=400,
            detail=f"提示词过长：当前 {len(task.prompt)} 字，该模型最多 {_limit} 字，请精简后重试",
        )

    # Check credits before starting task
    google_service = GoogleService(db, user_id=current_user.id)
    cost = google_service._calculate_image_cost(task.model_id)

    try:
        # Pre-check credits without deduction
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

    # Find reference image path if provided (for image-to-image generation)
    reference_image_path = None
    if task.reference_image_id:
        upload_path = get_user_upload_path(settings.STORAGE_BASE_PATH, current_user.id)
        for ext in ['.jpg', '.jpeg', '.png', '.webp']:
            potential_path = upload_path / f"{task.reference_image_id}{ext}"
            if potential_path.exists():
                reference_image_path = str(potential_path)
                break

    # Create task ID
    task_id = str(uuid.uuid4())

    # Store task in database
    from app.models.generation_task import GenerationTask

    db_task = GenerationTask(
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        model_id=task.model_id,
        task_type="image",
        prompt=task.prompt,
        parameters=json.dumps({
            "aspect_ratio": task.aspect_ratio,
            "reference_image_path": reference_image_path
        }),
        status="pending",
        # 短剧分镜图(带 drama_project_id)是中间产物，不作为作品展示。
        show_in_gallery=0 if task.drama_project_id else 1,
    )
    db.add(db_task)
    await db.commit()

    # Start background task with credit management
    background_tasks.add_task(
        process_image_generation_with_credits,
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        prompt=task.prompt,
        aspect_ratio=task.aspect_ratio or "4:3",
        model_id=task.model_id,
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


@router.post("/generate-video", response_model=ResponseBase[GenerationTaskResponse])
async def generate_video(
    task: GenerationTaskCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generate video via AI 网关 (Hailuo/HappyHorse)"""
    if not settings.AI_GATEWAY_API_KEY:
        raise HTTPException(status_code=500, detail="AI 网关未配置")

    # Determine generation mode: text-to-video or image-to-video
    generation_mode = task.generation_mode or ('image-to-video' if task.first_frame_id else 'text-to-video')

    # For image-to-video mode, first frame is required
    if generation_mode == 'image-to-video' and not task.first_frame_id:
        raise HTTPException(status_code=400, detail="First frame image is required for image-to-video generation")

    # Validate prompt length against the *resolved* gateway video model's real limit.
    gateway_video_model = VIDEO_MODEL_MAPPING.get(task.model_id, settings.GATEWAY_DRAMA_VIDEO_MODEL)
    _limit = max_prompt_chars(gateway_video_model)
    if task.prompt and len(task.prompt) > _limit:
        raise HTTPException(
            status_code=400,
            detail=f"提示词过长：当前 {len(task.prompt)} 字，该模型最多 {_limit} 字，请精简后重试",
        )

    # Check credits before starting task
    google_service = GoogleService(db, user_id=current_user.id)
    cost = google_service._calculate_video_cost(task.duration or 5)
    
    try:
        # Pre-check credits without deduction
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
    
    # Helper to find frame paths. Uploads are stored on local disk AND mirrored to
    # MinIO (see /upload-frame). The local copy may be absent (separate container/host,
    # a rebuild, or an upload that only reached MinIO), so fall back to MinIO and
    # materialise the object to a local file — the same order the serving endpoint
    # (get_uploaded_frame) and the drama pipeline (_fetch_shot_image_to_local) use.
    upload_path = get_user_upload_path(settings.STORAGE_BASE_PATH, current_user.id)

    async def find_frame_path(frame_id: str):
        if not frame_id:
            return None
        # 1. Local disk
        for ext in ['.jpg', '.jpeg', '.png', '.webp']:
            potential_path = upload_path / f"{frame_id}{ext}"
            if potential_path.exists():
                return potential_path
        # 2. MinIO fallback → write back to local disk for downstream generation
        if settings.MINIO_ENABLED:
            try:
                storage = get_storage_service()
            except Exception:
                storage = None
            if storage is not None:
                for ext in ['.jpg', '.jpeg', '.png', '.webp']:
                    key = storage.user_upload_key(current_user.id, f"{frame_id}{ext}")
                    try:
                        data, _ = await storage.get_object_bytes(key)
                    except Exception:
                        continue
                    upload_path.mkdir(parents=True, exist_ok=True)
                    local_path = upload_path / f"{frame_id}{ext}"
                    async with aiofiles.open(local_path, 'wb') as f:
                        await f.write(data)
                    return local_path
        return None

    # For image-to-video, find frame paths
    first_frame_path = None
    second_frame_path = None
    third_frame_path = None

    if generation_mode == 'image-to-video':
        first_frame_path = await find_frame_path(task.first_frame_id)
        second_frame_path = await find_frame_path(task.second_frame_id) if task.second_frame_id else None
        third_frame_path = await find_frame_path(task.third_frame_id) if task.third_frame_id else None

        if not first_frame_path:
            raise HTTPException(status_code=404, detail="First frame image not found")
    
    # Create task ID
    task_id = str(uuid.uuid4())
    
    # Store task in database
    from app.models.generation_task import GenerationTask
    
    db_task = GenerationTask(
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        model_id=task.model_id,
        task_type="video",
        prompt=task.prompt,
        parameters=json.dumps({
            "aspect_ratio": task.aspect_ratio,
            "resolution": task.resolution,
            "duration": task.duration,
            "generation_mode": generation_mode,
            "first_frame_path": str(first_frame_path) if first_frame_path else None,
            "second_frame_path": str(second_frame_path) if second_frame_path else None,
            "third_frame_path": str(third_frame_path) if third_frame_path else None
        }),
        status="pending",
        # 归属短剧项目(带 drama_project_id)的视频是逐镜中间产物，不作为作品展示；
        # AI视频页面直接生成的单视频才作为作品。
        show_in_gallery=0 if task.drama_project_id else 1,
    )
    db.add(db_task)
    await db.commit()

    # Resolve gateway video model + clamp duration for Hailuo (only 6 or 10s).
    # gateway_video_model was resolved above for prompt-length validation.
    duration = task.duration or 6
    if "happyhorse" not in gateway_video_model.lower():
        # Hailuo (海螺): supports only 6 or 10 seconds.
        duration = 6 if duration <= 6 else 10

    # Start background task with credit management
    background_tasks.add_task(
        process_video_generation_with_credits,
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        prompt=task.prompt,
        first_frame_path=str(first_frame_path) if first_frame_path else None,
        second_frame_path=str(second_frame_path) if second_frame_path else None,
        third_frame_path=str(third_frame_path) if third_frame_path else None,
        aspect_ratio=task.aspect_ratio or "16:9",
        resolution=task.resolution or "720p",
        duration=duration,
        model_id=gateway_video_model,
        generation_mode=generation_mode
    )
    
    return ResponseBase(
        success=True,
        message="Video generation task created",
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
    """Get generation task status"""
    from sqlalchemy import select
    from app.models.generation_task import GenerationTask

    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id == task_id,
            GenerationTask.user_id == current_user.id
        )
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Use task-based URL for result, fall back to stored result_url for older tasks
    if task.result_path:
        result_url = f"/api/v1/google/task/{task_id}/file"
    else:
        result_url = task.result_url  # Fall back to old format for existing data

    return ResponseBase(
        success=True,
        message="Task status retrieved",
        data=GenerationTaskResponse(
            task_id=task.task_id,
            status=task.status,
            message=task.error_message if task.status == "failed" else "Task is " + task.status,
            # Surface the failure reason in `error` too — the frontend polling reads
            # `task.error` (not `message`); without this it falls back to a generic
            # "生成失败" and the real upstream cause (e.g. real-person风控) is lost.
            error=task.error_message if task.status == "failed" else None,
            progress=task.progress,
            result_url=result_url
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
            GenerationTask.task_id == task_id,
            GenerationTask.deleted_at.is_(None)
        )
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status != "completed" or not task.result_path:
        raise HTTPException(status_code=400, detail="File not available")

    # MinIO-stored file → stream through backend (avoids browser→MinIO hostname issues)
    if StorageService.is_minio_key(task.result_path):
        try:
            storage = get_storage_service()
            data, content_type = await storage.get_object_bytes(task.result_path)
            return Response(content=data, media_type=content_type)
        except Exception as _e:
            raise HTTPException(status_code=500, detail=f"Storage error: {_e}")

    # Legacy local file
    file_path = Path(task.result_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    if task.task_type == "video":
        media_type = "video/mp4"
    else:
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


@router.get("/history", response_model=ResponseBase[list])
async def get_generation_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    task_type: str = None,
    limit: int = 20
):
    """Get user's generation history"""
    from sqlalchemy import select, desc
    from app.models.generation_task import GenerationTask
    
    query = select(GenerationTask).where(
        GenerationTask.user_id == current_user.id,
        GenerationTask.status == "completed",
        GenerationTask.deleted_at.is_(None),
        # 只展示「作品」：最终成片 / 用户直接生成的单图单视频。
        # 短剧中间产物(分镜图、逐镜分镜视频)与素材 show_in_gallery=0，过滤掉。
        GenerationTask.show_in_gallery == 1
    )

    if task_type:
        query = query.where(GenerationTask.task_type == task_type)
    
    query = query.order_by(desc(GenerationTask.created_at)).limit(limit)
    
    result = await db.execute(query)
    tasks = result.scalars().all()
    
    history_items = []
    for task in tasks:
        # Parse parameters from JSON string
        parameters = {}
        if task.parameters:
            try:
                parameters = json.loads(task.parameters)
            except:
                pass

        # Use task-based URL for result, fall back to stored result_url for older tasks
        if task.result_path:
            result_url = f"/api/v1/google/task/{task.task_id}/file"
        else:
            result_url = task.result_url  # Fall back to old format

        history_items.append({
            "task_id": task.task_id,
            "prompt": task.prompt,
            "model_id": task.model_id,
            "task_type": task.task_type,
            "result_url": result_url,
            "parameters": parameters,
            "is_favorite": task.is_favorite == 1,
            "is_public": task.is_public == 1,
            "created_at": task.created_at.isoformat() if task.created_at else None
        })

    return ResponseBase(
        success=True,
        message="Generation history retrieved",
        data=history_items
    )


@router.get("/favorites", response_model=ResponseBase[list])
async def get_favorites(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    task_type: str = None,
    limit: int = 50
):
    """Get user's favorite generation tasks"""
    from sqlalchemy import select, desc
    from app.models.generation_task import GenerationTask
    
    query = select(GenerationTask).where(
        GenerationTask.user_id == current_user.id,
        GenerationTask.status == "completed",
        GenerationTask.deleted_at.is_(None),
        GenerationTask.is_favorite == 1,
        # 只展示「作品」：最终成片 / 用户直接生成的单图单视频。
        # 短剧中间产物(分镜图、逐镜分镜视频)与素材 show_in_gallery=0，过滤掉。
        GenerationTask.show_in_gallery == 1
    )
    
    if task_type:
        query = query.where(GenerationTask.task_type == task_type)
    
    query = query.order_by(desc(GenerationTask.created_at)).limit(limit)
    
    result = await db.execute(query)
    tasks = result.scalars().all()
    
    favorite_items = []
    for task in tasks:
        parameters = {}
        if task.parameters:
            try:
                parameters = json.loads(task.parameters)
            except:
                pass

        # Use task-based URL for result, fall back to stored result_url for older tasks
        if task.result_path:
            result_url = f"/api/v1/google/task/{task.task_id}/file"
        else:
            result_url = task.result_url  # Fall back to old format

        favorite_items.append({
            "task_id": task.task_id,
            "prompt": task.prompt,
            "model_id": task.model_id,
            "task_type": task.task_type,
            "result_url": result_url,
            "parameters": parameters,
            "is_favorite": True,
            "created_at": task.created_at.isoformat() if task.created_at else None
        })

    return ResponseBase(
        success=True,
        message="Favorites retrieved",
        data=favorite_items
    )


@router.post("/task/{task_id}/favorite", response_model=ResponseBase)
async def toggle_favorite(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Toggle favorite status for a generation task"""
    from sqlalchemy import select
    from app.models.generation_task import GenerationTask

    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id == task_id,
            GenerationTask.user_id == current_user.id,
            GenerationTask.deleted_at.is_(None)
        )
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Toggle favorite status (0 -> 1, 1 -> 0)
    task.is_favorite = 0 if task.is_favorite == 1 else 1
    await db.commit()

    return ResponseBase(
        success=True,
        message="收藏成功" if task.is_favorite == 1 else "已取消收藏",
        data={"is_favorite": task.is_favorite == 1}
    )


@router.post("/task/{task_id}/public", response_model=ResponseBase)
async def toggle_public(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Toggle public status for a generation task"""
    from sqlalchemy import select
    from app.models.generation_task import GenerationTask

    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id == task_id,
            GenerationTask.user_id == current_user.id,
            GenerationTask.deleted_at.is_(None)
        )
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Toggle public status (0 -> 1, 1 -> 0)
    task.is_public = 0 if task.is_public == 1 else 1
    await db.commit()

    return ResponseBase(
        success=True,
        message="已公开作品" if task.is_public == 1 else "已设为私有",
        data={"is_public": task.is_public == 1}
    )


@router.get("/discover", response_model=ResponseBase[list])
async def get_public_works(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    task_type: str = None,
    limit: int = 50
):
    """Get all public works from all users for discovery"""
    from sqlalchemy import select, desc
    from app.models.generation_task import GenerationTask

    query = select(GenerationTask).where(
        GenerationTask.status == "completed",
        GenerationTask.deleted_at.is_(None),
        GenerationTask.is_public == 1,
        # 只展示「作品」：最终成片 / 用户直接生成的单图单视频。
        # 短剧中间产物(分镜图、逐镜分镜视频)与素材 show_in_gallery=0，过滤掉。
        GenerationTask.show_in_gallery == 1
    )

    if task_type:
        query = query.where(GenerationTask.task_type == task_type)

    query = query.order_by(desc(GenerationTask.created_at)).limit(limit)

    result = await db.execute(query)
    tasks = result.scalars().all()

    public_items = []
    for task in tasks:
        parameters = {}
        if task.parameters:
            try:
                parameters = json.loads(task.parameters)
            except:
                pass

        # Use task-based URL for result
        if task.result_path:
            result_url = f"/api/v1/google/task/{task.task_id}/file"
        else:
            result_url = task.result_url

        public_items.append({
            "task_id": task.task_id,
            "prompt": task.prompt,
            "model_id": task.model_id,
            "task_type": task.task_type,
            "result_url": result_url,
            "parameters": parameters,
            "user_id": task.user_id,
            "created_at": task.created_at.isoformat() if task.created_at else None
        })

    return ResponseBase(
        success=True,
        message="Public works retrieved",
        data=public_items
    )


@router.delete("/task/{task_id}", response_model=ResponseBase)
async def delete_generation_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Soft delete a generation task and remove its file"""
    from sqlalchemy import select
    from app.models.generation_task import GenerationTask
    import os
    
    # Find the task
    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id == task_id,
            GenerationTask.user_id == current_user.id,
            GenerationTask.deleted_at.is_(None)
        )
    )
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Delete the physical file if exists
    if task.result_path:
        file_path = Path(task.result_path)
        if file_path.exists():
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Error deleting file {file_path}: {e}")
    
    # Soft delete: set deleted_at timestamp
    task.deleted_at = datetime.utcnow()
    await db.commit()
    
    return ResponseBase(
        success=True,
        message="Task deleted successfully",
        data=None
    )


async def process_image_generation_with_credits(
    task_id: str,
    user_id: int,
    tenant_id: int,
    prompt: str,
    aspect_ratio: str,
    model_id: str,
    reference_image_path: str = None,
    drama_project_id: str = None,
):
    """Background task for image generation with credit management"""
    from app.models.generation_task import GenerationTask
    from sqlalchemy import select, update
    from app.db.session import AsyncSessionLocal
    import logging

    logger = logging.getLogger(__name__)
    logger.info(f"Starting image generation task {task_id} for user {user_id}")
    if reference_image_path:
        logger.info(f"Task {task_id}: Using reference image: {reference_image_path}")

    async with AsyncSessionLocal() as db:
        try:
            # Update status to processing
            logger.info(f"Task {task_id}: Updating status to processing")
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(status="processing", progress=10)
            )
            await db.commit()

            # Initialize Google service
            google_service = GoogleService(db, user_id=user_id)

            # Update progress
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(progress=30)
            )
            await db.commit()

            # Prepare output path
            output_path = get_user_output_path(settings.STORAGE_BASE_PATH, user_id, "images")
            filename = f"{task_id}.png"

            logger.info(f"Task {task_id}: Calling Google API for image generation")

            # Generate image with credit deduction
            result = await google_service.generate_image(
                tenant_id=tenant_id,
                prompt=prompt,
                output_path=output_path,
                filename=filename,
                aspect_ratio=aspect_ratio,
                reference_image_path=reference_image_path,
                model_id=model_id,
            )

            logger.info(f"Task {task_id}: Google API returned: {result}")
            
            # Update progress
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(progress=70)
            )
            await db.commit()
            
            if result.get("success"):
                ai_result = result.get("result", {})
                # Propagate gateway-signalled failure (executor only catches raises).
                if isinstance(ai_result, dict) and ai_result.get("success") is False:
                    raise Exception(ai_result.get("error", "图像生成失败"))
                local_path = output_path / filename
                if not local_path.exists():
                    raise Exception(f"图像生成失败：未产出文件 {filename}")
                result_path_val = ai_result.get("file_path", str(local_path))
                result_url = f"/api/v1/google/outputs/{user_id}/images/{filename}"

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
                        logger.warning(f"Task {task_id}: MinIO upload failed, using local URL: {_e}")

                # Update task as completed
                await db.execute(
                    update(GenerationTask)
                    .where(GenerationTask.task_id == task_id)
                    .values(
                        status="completed",
                        progress=100,
                        result_path=result_path_val,
                        result_url=result_url
                    )
                )
                await db.commit()
                logger.info(f"Task {task_id}: Completed successfully, result_url={result_url}")
            else:
                raise Exception(result.get("error", "Unknown error"))
                
        except InsufficientCreditsError as e:
            # Update task as failed due to insufficient credits
            logger.error(f"Task {task_id}: Failed due to insufficient credits: {e}")
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(
                    status="failed",
                    error_message=f"积分不足: {str(e)}"
                )
            )
            await db.commit()
                
        except Exception as e:
            # Update task as failed
            logger.error(f"Task {task_id}: Failed with error: {e}", exc_info=True)
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(
                    status="failed",
                    error_message=str(e)
                )
            )
            await db.commit()


async def process_image_generation(
    task_id: str,
    user_id: int,
    prompt: str,
    aspect_ratio: str,
    model_id: str
):
    """Background task for image generation"""
    from app.models.generation_task import GenerationTask
    from sqlalchemy import select, update
    from app.db.session import AsyncSessionLocal
    
    async with AsyncSessionLocal() as db:
        try:
            # Update status to processing
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(status="processing", progress=10)
            )
            await db.commit()
            
            # Initialize Google AI client (routes through AI 网关)
            client = GoogleAIClient()
            
            # Update progress
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(progress=30)
            )
            await db.commit()
            
            # Prepare output path
            output_path = get_user_output_path(settings.STORAGE_BASE_PATH, user_id, "images")
            filename = f"{task_id}.png"
            
            # Generate image
            result = await client.generate_image(
                prompt=prompt,
                output_path=output_path,
                filename=filename,
                aspect_ratio=aspect_ratio,
                model=model_id
            )
            
            # Update progress
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(progress=70)
            )
            await db.commit()
            
            if result.get("success"):
                local_path = output_path / filename
                result_path_val = result.get("file_path", str(local_path))
                result_url = f"/api/v1/google/outputs/{user_id}/images/{filename}"

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

                # Update task as completed
                await db.execute(
                    update(GenerationTask)
                    .where(GenerationTask.task_id == task_id)
                    .values(
                        status="completed",
                        progress=100,
                        result_path=result_path_val,
                        result_url=result_url
                    )
                )
                await db.commit()
            else:
                raise Exception(result.get("error", "Unknown error"))

        except Exception as e:
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(status="failed", error_message=str(e))
            )
            await db.commit()


async def process_video_generation_with_credits(
    task_id: str,
    user_id: int,
    tenant_id: int,
    prompt: str,
    first_frame_path: str = None,
    second_frame_path: str = None,
    third_frame_path: str = None,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    duration: int = 8,
    model_id: str = None,
    generation_mode: str = "text-to-video",
    reference_image_paths: list = None,
    last_frame_path: str = None,
    reference_video_url: str = None,
    audio_url: str = None,
    generate_audio: bool = False,
    drama_project_id: str = None,
    reference_video_urls: list = None,
    episode_num: int = None,
    as_episode_composite: bool = False,
):
    """Background task for video generation with credit management.

    When drama_project_id is set, the result is stored under the project's drama
    shots path and Seedance 2.0 multimodal extras (extra reference images, a
    reference video URL, an audio URL, generate_audio) are forwarded to the model.
    """
    from app.models.generation_task import GenerationTask
    from sqlalchemy import select, update
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        try:
            # Update status to processing
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(status="processing", progress=10)
            )
            await db.commit()

            # Initialize Google service
            google_service = GoogleService(db, user_id=user_id)

            # Update progress
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(progress=20)
            )
            await db.commit()

            # Prepare output path
            output_path = get_user_output_path(settings.STORAGE_BASE_PATH, user_id, "videos")
            filename = f"{task_id}.mp4"

            # Progress callback
            async def progress_callback(progress: int):
                await db.execute(
                    update(GenerationTask)
                    .where(GenerationTask.task_id == task_id)
                    .values(progress=min(20 + progress * 0.6, 80))  # Scale to 20-80%
                )
                await db.commit()

            # Generate video with credit deduction
            # For text-to-video, first_frame_path will be None.
            # 2nd/3rd frames (HappyHorse i2v multi-reference) ride along as extra
            # reference images, appended after any caller-supplied reference paths.
            extra_frame_paths = [p for p in (second_frame_path, third_frame_path) if p]
            merged_reference_paths = (list(reference_image_paths) if reference_image_paths else []) + extra_frame_paths
            result = await google_service.generate_video(
                tenant_id=tenant_id,
                prompt=prompt,
                first_frame_path=first_frame_path,
                output_path=output_path,
                filename=filename,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                duration=duration,
                model=model_id,
                generation_mode=generation_mode,
                reference_image_paths=merged_reference_paths or None,
                last_frame_path=last_frame_path,
                reference_video_url=reference_video_url,
                reference_video_urls=reference_video_urls,
                audio_url=audio_url,
                generate_audio=generate_audio,
            )

            if result.get("success"):
                ai_result = result.get("result", {})
                # The executor reports success when the callable does not raise, but
                # the gateway client signals generation failure via {"success": False}.
                # Propagate that as a failure instead of marking the task completed.
                if isinstance(ai_result, dict) and ai_result.get("success") is False:
                    raise Exception(ai_result.get("error", "视频生成失败"))
                local_path = output_path / filename
                if not local_path.exists():
                    raise Exception(f"视频生成失败：未产出文件 {filename}")
                result_path_val = ai_result.get("file_path", str(local_path))
                result_url = f"/api/v1/google/outputs/{user_id}/videos/{filename}"

                # Upload to MinIO and use presigned URL as result_url
                if settings.MINIO_ENABLED:
                    try:
                        storage = get_storage_service()
                        if drama_project_id:
                            object_key = storage.drama_shot_key(user_id, drama_project_id, filename)
                        else:
                            object_key = storage.user_video_key(user_id, filename)
                        result_url = await storage.upload_and_get_url(
                            local_path, object_key, "video/mp4",
                        )
                        result_path_val = object_key
                    except Exception as _e:
                        logger.warning(f"Task {task_id}: MinIO video upload failed, using local URL: {_e}")

                # Update task as completed
                await db.execute(
                    update(GenerationTask)
                    .where(GenerationTask.task_id == task_id)
                    .values(
                        status="completed",
                        progress=100,
                        result_path=result_path_val,
                        result_url=result_url
                    )
                )
                await db.commit()
            else:
                raise Exception(result.get("error", "Unknown error"))

            # 「合并成片」模式 B：把生成式合成结果回写为本集成片 + 项目状态
            if as_episode_composite and drama_project_id and episode_num is not None:
                try:
                    from app.api.v1.drama import _persist_compose_episode_composite
                    await _persist_compose_episode_composite(
                        db, drama_project_id, user_id, episode_num, task_id, result_path_val,
                    )
                except Exception as _e:
                    logger.warning(f"Task {task_id}: compose episode write-back failed: {_e}")

        except InsufficientCreditsError as e:
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(status="failed", error_message=f"积分不足: {str(e)}")
            )
            await db.commit()

        except Exception as e:
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(status="failed", error_message=str(e))
            )
            await db.commit()


async def process_video_generation(
    task_id: str,
    user_id: int,
    prompt: str,
    first_frame_path: str,
    aspect_ratio: str,
    resolution: str,
    duration: int,
    model_id: str
):
    """Background task for video generation"""
    from app.models.generation_task import GenerationTask
    from sqlalchemy import select, update
    from app.db.session import AsyncSessionLocal
    
    async with AsyncSessionLocal() as db:
        try:
            # Update status to processing
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(status="processing", progress=10)
            )
            await db.commit()
            
            # Initialize Google AI client (routes through AI 网关)
            client = GoogleAIClient()
            
            # Update progress
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(progress=20)
            )
            await db.commit()
            
            # Prepare output path
            output_path = get_user_output_path(settings.STORAGE_BASE_PATH, user_id, "videos")
            filename = f"{task_id}.mp4"
            
            # Generate video (this is a long operation)
            result = await client.generate_video(
                prompt=prompt,
                first_frame_path=first_frame_path,
                output_path=output_path,
                filename=filename,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                duration=duration,
                model=model_id,
                progress_callback=lambda p: update_task_progress(db, task_id, p)
            )
            
            if result.get("success"):
                local_path = output_path / filename
                result_path_val = result.get("file_path", str(local_path))
                result_url = f"/api/v1/google/outputs/{user_id}/videos/{filename}"

                if settings.MINIO_ENABLED:
                    try:
                        storage = get_storage_service()
                        object_key = storage.user_video_key(user_id, filename)
                        result_url = await storage.upload_and_get_url(
                            local_path, object_key, "video/mp4",
                        )
                        result_path_val = object_key
                    except Exception as _e:
                        logger.warning(f"Task {task_id}: MinIO upload failed, using local: {_e}")

                # Update task as completed
                await db.execute(
                    update(GenerationTask)
                    .where(GenerationTask.task_id == task_id)
                    .values(
                        status="completed",
                        progress=100,
                        result_path=result_path_val,
                        result_url=result_url
                    )
                )
                await db.commit()
            else:
                raise Exception(result.get("error", "Unknown error"))

        except Exception as e:
            await db.execute(
                update(GenerationTask)
                .where(GenerationTask.task_id == task_id)
                .values(
                    status="failed",
                    error_message=str(e)
                )
            )
            await db.commit()


async def update_task_progress(db, task_id: str, progress: int):
    """Update task progress"""
    from sqlalchemy import update
    from app.models.generation_task import GenerationTask
    
    await db.execute(
        update(GenerationTask)
        .where(GenerationTask.task_id == task_id)
        .values(progress=min(progress, 95))  # Cap at 95%, final step is file saving
    )
    await db.commit()

