"""
Douyin API Endpoints - 抖音发布功能
"""
import uuid
import logging
import asyncio
from typing import Dict, Any
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.dependencies import get_current_user
from app.db.session import get_db, AsyncSessionLocal
from app.models.user import User
from app.models.douyin_account import DouyinAccount
from app.models.generation_task import GenerationTask
from app.integrations.douyin.client import douyin_client

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory publish task status tracking
_publish_tasks: Dict[str, Dict[str, Any]] = {}


class CallbackRequest(BaseModel):
    code: str
    state: str


class PublishRequest(BaseModel):
    task_id: str
    title: str
    cover_tsp: float = 0.0


# ────────────────────────────────────────────────────────────────
# Connection management
# ────────────────────────────────────────────────────────────────

@router.get("/connection")
async def get_connection(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """检查用户是否已绑定抖音账号"""
    result = await db.execute(
        select(DouyinAccount).where(DouyinAccount.user_id == current_user.id)
    )
    account = result.scalar_one_or_none()

    if not account:
        return {"data": {"connected": False}}

    # Auto-refresh if access token expired
    if account.access_token_expires_at < datetime.utcnow():
        try:
            token_data = await douyin_client.refresh_access_token(account.refresh_token)
            account.access_token = token_data["access_token"]
            account.refresh_token = token_data["refresh_token"]
            account.access_token_expires_at = datetime.utcnow() + timedelta(
                seconds=token_data.get("expires_in", 86400)
            )
            account.refresh_token_expires_at = datetime.utcnow() + timedelta(
                seconds=token_data.get("refresh_expires_in", 2592000)
            )
            await db.flush()
        except Exception as e:
            logger.warning(f"Douyin token refresh failed for user {current_user.id}: {e}")
            return {"data": {"connected": False, "error": "Token expired, please reconnect"}}

    return {
        "data": {
            "connected": True,
            "nickname": account.nickname,
            "open_id": account.open_id,
        }
    }


@router.get("/auth-url")
async def get_auth_url(
    current_user: User = Depends(get_current_user),
):
    """生成抖音 OAuth 授权链接"""
    from app.config import settings as _settings
    if not _settings.DOUYIN_CLIENT_KEY or not _settings.DOUYIN_CLIENT_SECRET or not _settings.DOUYIN_REDIRECT_URI:
        raise HTTPException(
            status_code=503,
            detail="抖音授权未配置，请联系管理员在服务器设置 DOUYIN_CLIENT_KEY / DOUYIN_CLIENT_SECRET / DOUYIN_REDIRECT_URI",
        )
    state = str(current_user.id)
    url = douyin_client.get_authorize_url(state)
    return {"data": {"auth_url": url}}


@router.post("/callback")
async def handle_callback(
    request: CallbackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """处理 OAuth 回调，换取 token 并保存"""
    try:
        token_data = await douyin_client.exchange_code_for_token(request.code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    open_id = token_data["open_id"]
    access_token = token_data["access_token"]
    refresh_token = token_data["refresh_token"]
    expires_in = token_data.get("expires_in", 86400)
    refresh_expires_in = token_data.get("refresh_expires_in", 2592000)

    # Upsert DouyinAccount
    result = await db.execute(
        select(DouyinAccount).where(DouyinAccount.user_id == current_user.id)
    )
    account = result.scalar_one_or_none()

    now = datetime.utcnow()
    if account:
        account.open_id = open_id
        account.access_token = access_token
        account.refresh_token = refresh_token
        account.access_token_expires_at = now + timedelta(seconds=expires_in)
        account.refresh_token_expires_at = now + timedelta(seconds=refresh_expires_in)
    else:
        account = DouyinAccount(
            user_id=current_user.id,
            open_id=open_id,
            access_token=access_token,
            refresh_token=refresh_token,
            access_token_expires_at=now + timedelta(seconds=expires_in),
            refresh_token_expires_at=now + timedelta(seconds=refresh_expires_in),
        )
        db.add(account)

    await db.flush()

    return {"data": {"success": True, "open_id": open_id}}


@router.delete("/connection")
async def disconnect(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """解绑抖音账号"""
    result = await db.execute(
        select(DouyinAccount).where(DouyinAccount.user_id == current_user.id)
    )
    account = result.scalar_one_or_none()

    if not account:
        raise HTTPException(status_code=404, detail="No Douyin account linked")

    await db.delete(account)
    await db.flush()

    return {"data": {"success": True}}


# ────────────────────────────────────────────────────────────────
# Publish
# ────────────────────────────────────────────────────────────────

async def _do_publish(publish_id: str, user_id: int, task_id: str, title: str, cover_tsp: float):
    """后台发布任务"""
    try:
        _publish_tasks[publish_id]["status"] = "uploading"
        _publish_tasks[publish_id]["step"] = 1

        # Get DouyinAccount + GenerationTask from a fresh session
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DouyinAccount).where(DouyinAccount.user_id == user_id)
            )
            account = result.scalar_one_or_none()
            if not account:
                raise Exception("Douyin account not found")

            result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task or not task.result_path:
                raise Exception("Video file not found")

            access_token = account.access_token
            open_id = account.open_id
            video_path = task.result_path

        # Step 1: Upload video
        upload_data = await douyin_client.upload_video(access_token, open_id, video_path)
        video_id = upload_data["video"]["video_id"]

        _publish_tasks[publish_id]["status"] = "publishing"
        _publish_tasks[publish_id]["step"] = 2

        # Step 2: Create/publish video
        create_data = await douyin_client.create_video(
            access_token, open_id, video_id, title, cover_tsp
        )

        _publish_tasks[publish_id]["status"] = "completed"
        _publish_tasks[publish_id]["step"] = 3
        _publish_tasks[publish_id]["item_id"] = create_data.get("item_id")

    except Exception as e:
        logger.error(f"Douyin publish failed [{publish_id}]: {e}")
        _publish_tasks[publish_id]["status"] = "failed"
        _publish_tasks[publish_id]["error"] = str(e)


@router.post("/publish")
async def publish_video(
    request: PublishRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """发布视频到抖音"""
    # Verify user has a linked account
    result = await db.execute(
        select(DouyinAccount).where(DouyinAccount.user_id == current_user.id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=400, detail="No Douyin account linked")

    # Verify the generation task belongs to the user and is completed
    result = await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id == request.task_id,
            GenerationTask.user_id == current_user.id,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "completed":
        raise HTTPException(status_code=400, detail="Task is not completed")
    if not task.result_path:
        raise HTTPException(status_code=400, detail="No result video available")

    # Create publish task
    publish_id = str(uuid.uuid4())
    _publish_tasks[publish_id] = {
        "status": "pending",
        "step": 0,
        "error": None,
        "item_id": None,
    }

    background_tasks.add_task(
        _do_publish, publish_id, current_user.id, request.task_id, request.title, request.cover_tsp
    )

    return {"data": {"publish_id": publish_id, "status": "pending"}}


@router.get("/publish/{publish_id}")
async def get_publish_status(
    publish_id: str,
    current_user: User = Depends(get_current_user),
):
    """查询发布任务状态"""
    task_info = _publish_tasks.get(publish_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Publish task not found")

    return {"data": task_info}
