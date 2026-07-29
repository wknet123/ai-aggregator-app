"""
Media Studio API — 恢复并适配以下功能(M1 骨架):
  - 视频生成视频 (video2video)   POST /api/v1/studio/video2video
  - AI特效        (effect)        POST /api/v1/studio/effects
  - AI短视频      (short_video)   POST /api/v1/studio/short-video
  - 动作模仿      (motion)        POST /api/v1/studio/motion
  - 视频编辑      (video_edit)    POST /api/v1/studio/video-edit

共享:
  - 上传        POST /api/v1/studio/upload  (图片或视频)
  - 任务状态    GET  /api/v1/studio/task/{task_id}
  - 取文件      GET  /api/v1/studio/task/{task_id}/file
  - 历史        GET  /api/v1/studio/history?task_type=effect

复用现有基建:GenerationTask 表(新 task_type)、CreditService 扣/退积分、
StorageService(MinIO 落盘)、统一网关 client。结果落 result_path 后自动进作品画廊。

M1 说明:
  - 短视频 / 图像特效 复用现有可用模型(Hailuo / wan 图生图),立即可出结果。
  - 视频→视频 / 动作模仿 / 视频编辑 需专用模型;模型 ID 未配置时明确报“模型待配置”
    并退还积分。补充模型信息后在 M2 把 gateway 方法填实即可。
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
import uuid
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.asset_url import public_asset_url, sign_asset
from app.db.session import get_db
from app.dependencies import get_current_user
from app.integrations.gateway.client import GatewayError, get_gateway_client, get_gateway_client_for_user
from app.models.user import User
from app.schemas.response import ResponseBase
from app.schemas.file import FileUploadResponse, GenerationTaskResponse
from app.services.storage import StorageService, get_storage_service
from app.utils.helpers import get_user_output_path, get_user_upload_path

logger = logging.getLogger(__name__)

router = APIRouter()

# ── 功能 → task_type / 默认积分 ──────────────────────────────────────────────
FEATURE_VIDEO2VIDEO = "video2video"
FEATURE_EFFECT = "effect"
FEATURE_SHORT_VIDEO = "short_video"
FEATURE_MOTION = "motion"
FEATURE_VIDEO_EDIT = "video_edit"

DEFAULT_COST = {
    FEATURE_VIDEO2VIDEO: 150,
    FEATURE_EFFECT: 40,
    FEATURE_SHORT_VIDEO: 120,
    FEATURE_MOTION: 150,
    FEATURE_VIDEO_EDIT: 80,
}

# AI特效逐项积分(与前端 effectsData.ts 对齐)
EFFECT_COST = {
    "remove-bg": 20, "extend-image": 40,
    "gfpgan": 30, "real-esrgan-4x": 50, "real-esrgan-8x": 80,
    "photo-restore": 50, "colorize": 40,
    "animegan": 40, "ghibli": 40, "pixar": 50, "sketch": 30,
    "faceswap": 80, "ai-kiss": 100, "ai-hug": 100,
    "make-younger": 50, "make-older": 50, "add-beard": 40, "makeup": 40,
    "ai-squish": 60, "ai-inflate": 60, "ai-melt": 60, "ai-explode": 80,
}

# 输出为视频的特效(M1:走 HappyHorse 图生视频 i2v/r2v)
EFFECT_VIDEO_IDS = {"ai-kiss", "ai-hug", "ai-squish", "ai-inflate", "ai-melt", "ai-explode"}

# 视频类特效 → 运动提示词(驱动 HappyHorse i2v)
EFFECT_VIDEO_PROMPT = {
    "ai-squish": "the subject gets squished and compressed, satisfying squish and squash motion, playful",
    "ai-inflate": "the subject inflates and expands like a balloon, smooth swelling motion",
    "ai-melt": "the subject slowly melts and drips downward, fluid melting motion",
    "ai-explode": "the subject bursts and explodes into flying particles, dramatic explosion",
    "ai-kiss": "the two people lean in close and kiss tenderly, romantic, natural motion",
    "ai-hug": "the two people move together and share a warm affectionate hug",
}

# 特效 → 提示词模板(图像类 M1 用 wan 图生图实现)
EFFECT_PROMPT = {
    "remove-bg": "Remove the background completely, keep only the main subject on a clean transparent/white background",
    "extend-image": "Outpaint and naturally extend the image borders, keeping style consistent",
    "gfpgan": "Restore and enhance the face, fix blur, high detail, photorealistic",
    "real-esrgan-4x": "Upscale to high resolution, 4x super resolution, crisp details",
    "real-esrgan-8x": "Upscale to ultra high resolution, 8x super resolution, crisp details",
    "photo-restore": "Restore this old damaged photo, remove scratches and noise, recover detail",
    "colorize": "Colorize this black and white photo with natural, realistic colors",
    "animegan": "Convert to Japanese anime style illustration",
    "ghibli": "Convert to Studio Ghibli / Miyazaki anime art style",
    "pixar": "Convert to Pixar 3D animation character style",
    "sketch": "Convert to a detailed pencil sketch drawing",
    "faceswap": "Swap the face naturally and seamlessly, keep lighting consistent",
    "make-younger": "Make the person look noticeably younger, natural result",
    "make-older": "Make the person look noticeably older, natural aging",
    "add-beard": "Add a natural-looking beard to the person",
    "makeup": "Apply tasteful makeup to the person, natural beautified look",
}

_POLL_INTERVAL = 5.0       # 秒
_POLL_MAX_WAIT = 600.0     # 秒(视频任务上限 10 分钟)


# ── 请求体 ───────────────────────────────────────────────────────────────────
class EffectRequest(BaseModel):
    effect_id: str
    image_id: str                                  # 上传得到的 file_id
    reference_image_id: Optional[str] = None       # 换脸等需要的第二张图
    prompt: Optional[str] = None
    model_id: Optional[str] = None


class ShortVideoRequest(BaseModel):
    prompt: str = Field(..., min_length=1)  # 上限按模型在端点校验
    first_frame_id: Optional[str] = None           # 图生视频可选首帧
    duration: int = 6
    resolution: str = "768P"
    model_id: Optional[str] = None


class Video2VideoRequest(BaseModel):
    prompt: str = Field(..., min_length=1)  # 上限按模型在端点校验
    video_id: str                                    # 上传的源视频 file_id,或 /api/v1/static/xxx.mp4 样例路径
    strength: float = 0.7
    style_id: Optional[str] = None                   # 前端风格预设 id(仅记录)
    style_prompt: Optional[str] = None               # 风格描述,追加进生成文本
    reference_image_ids: List[str] = Field(default_factory=list)  # 参考主体图(file_id 或 static 路径)
    negative_prompt: Optional[str] = None
    ratio: str = "16:9"
    duration: int = 5
    output_count: int = 1                            # 本次仅稳定支持 1
    model_id: Optional[str] = None                   # seedance(默认) | kling-omni


class MotionRequest(BaseModel):
    prompt: Optional[str] = ""
    character_image_id: str
    motion_video_id: Optional[str] = None          # 上传的自定义动作视频 file_id
    motion_template: Optional[str] = None           # 内置模板静态路径 (/api/v1/static/xxx.mp4)
    ratio: str = "16:9"
    duration: int = 5
    model_id: Optional[str] = None                  # kling-motion-control | kling-omni | seedance(默认)
    character_orientation: str = "image"            # Kling 动作控制:面向跟随 image|video
    keep_original_sound: str = "yes"                # Kling 动作控制:保留原视频声音


class VideoEditRequest(BaseModel):
    prompt: str = Field(..., min_length=1)  # 上限按模型在端点校验
    video_id: str
    edit_type: str = "basic"                       # basic | style | character
    ratio: str = "16:9"
    duration: int = 5
    model_id: Optional[str] = None


# ── 通用辅助 ─────────────────────────────────────────────────────────────────
_IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp"]
_VIDEO_EXTS = [".mp4", ".mov", ".webm", ".avi"]


def _resolve_upload(user_id: int, file_id: str):
    """按 file_id 在本地上传目录里找文件 → (Path, ext) 或 (None, None)。"""
    upload_path = get_user_upload_path(settings.STORAGE_BASE_PATH, user_id)
    for ext in _IMG_EXTS + _VIDEO_EXTS:
        p = upload_path / f"{file_id}{ext}"
        if p.exists():
            return p, ext
    return None, None


async def _read_upload_bytes(user_id: int, file_id: str) -> Optional[bytes]:
    p, _ = _resolve_upload(user_id, file_id)
    if not p:
        return None
    async with aiofiles.open(p, "rb") as f:
        return await f.read()


def _sign_asset(object_key: str, exp: int) -> str:
    """HMAC-SHA256 over the object key + expiry, keyed by the app secret."""
    return sign_asset(object_key, exp)


def _public_asset_url(object_key: str, ttl_seconds: int = 6 * 3600) -> Optional[str]:
    """构造网关可达的、签名保护的流式 URL,失败返回 None。

    外部网关(Seedance/HappyHorse 等)取不到内网 MinIO(minio:9000),也无法用 presigned
    (host 是内网名)。改为走公网后端 origin → nginx → 后端 → MinIO 流式(同短剧 ref-asset),
    不暴露 MinIO、不依赖 presign host。需要 PUBLIC_BASE_URL 配置。
    """
    return public_asset_url(object_key, ttl_seconds)


async def _public_video_url(user_id: int, file_id: str) -> Optional[str]:
    """把上传的视频暴露成网关可达的公网流式 URL(签名保护)。"""
    p, ext = _resolve_upload(user_id, file_id)
    if not p or not settings.MINIO_ENABLED:
        return None
    storage = get_storage_service()
    key = storage.user_upload_key(user_id, f"{file_id}{ext}")
    try:
        await storage.upload_file(p, key, StorageService.content_type_for(p.name))
    except Exception as e:  # noqa: BLE001
        logger.warning("studio: upload video %s to MinIO failed: %s", file_id, e)
        return None
    url = _public_asset_url(key)
    if not url:
        logger.warning("studio: PUBLIC_BASE_URL 未配置,无法生成视频公网 URL")
    return url


# _public_upload_url 是 _public_video_url 的通用别名:图片/视频同走上传区,签名 URL 逻辑一致。
# Kling 的 image_url 需公网可达 URL(不吃 base64 内联),故角色图也用它暴露。
_public_upload_url = _public_video_url


def _template_public_url(template_path: str) -> Optional[str]:
    """把内置模板静态路径(/api/v1/static/xxx.mp4)拼成网关可达的公网 URL。

    仅放行 static 代理路径(公开桶 public/static/),防止被当作任意 URL 转发(SSRF)。
    """
    path = (template_path or "").strip()
    if not path.startswith("/api/v1/static/") or ".." in path:
        return None
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    if not base:
        logger.warning("studio: PUBLIC_BASE_URL 未配置,无法生成模板公网 URL")
        return None
    return f"{base}{path}"


def _is_static_path(ref: str) -> bool:
    """判断引用是内置静态样例路径(/api/v1/static/...)还是上传的 file_id。"""
    return bool(ref) and ref.strip().startswith("/api/v1/static/")


async def _resolve_video_public_url(user_id: int, ref: str) -> Optional[str]:
    """把源视频引用(上传 file_id 或 static 样例路径)解析成网关可达公网 URL。"""
    if _is_static_path(ref):
        return _template_public_url(ref)
    return await _public_video_url(user_id, ref)


async def _resolve_image_bytes(user_id: int, ref: str) -> Optional[bytes]:
    """把参考主体图引用解析为字节(上传 file_id 读本地;static 样例走后端流式取回)。"""
    if _is_static_path(ref):
        url = _template_public_url(ref)
        if not url:
            return None
        try:
            return await get_gateway_client_for_user(user_id).fetch_bytes(url)
        except Exception as e:  # noqa: BLE001
            logger.warning("studio: fetch static ref image %s failed: %s", ref, e)
            return None
    return await _read_upload_bytes(user_id, ref)


async def _resolve_image_public_url(user_id: int, ref: str) -> Optional[str]:
    """把参考主体图引用解析为网关可达公网 URL(Kling 档需 URL,不吃 base64)。"""
    if _is_static_path(ref):
        return _template_public_url(ref)
    return await _public_upload_url(user_id, ref)


def _image_ext(data: bytes) -> str:
    """按魔数嗅探图片真实格式(网关图生图可能返回 PNG)。"""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "jpg"


async def _finalize(db_task, user_id: int, data: bytes, kind: str, task_id: str):
    """把结果字节落本地 + MinIO,写回 result_path / result_url。kind: image|video。"""
    ext = "mp4" if kind == "video" else _image_ext(data)
    subdir = "videos" if kind == "video" else "images"
    out_dir = get_user_output_path(settings.STORAGE_BASE_PATH, user_id, subdir)
    filename = f"studio_{task_id}.{ext}"
    local_path = out_dir / filename
    async with aiofiles.open(local_path, "wb") as f:
        await f.write(data)

    result_url = f"/api/v1/studio/task/{task_id}/file"
    result_path = str(local_path)
    if settings.MINIO_ENABLED:
        try:
            storage = get_storage_service()
            key = storage.user_video_key(user_id, filename) if kind == "video" \
                else storage.user_image_key(user_id, filename)
            await storage.upload_and_get_url(
                local_path, key, StorageService.content_type_for(filename)
            )
            result_path = key
        except Exception as e:  # noqa: BLE001
            logger.warning("Task %s: MinIO upload failed, using local: %s", task_id, e)

    db_task.status = "completed"
    db_task.progress = 100
    db_task.result_url = result_url
    db_task.result_path = result_path


async def _poll_video(poll_fn, gw_task_id: str) -> str:
    """轮询网关视频任务直到完成,返回结果 URL。超时/失败抛 GatewayError。"""
    waited = 0.0
    while waited < _POLL_MAX_WAIT:
        res = await poll_fn(gw_task_id)
        status = res.get("status", "")
        if get_gateway_client().is_done(status) and res.get("url"):
            return res["url"]
        if get_gateway_client().is_failed(status):
            raise GatewayError(f"网关任务失败: {json.dumps(res.get('raw', {}))[:300]}")
        await asyncio.sleep(_POLL_INTERVAL)
        waited += _POLL_INTERVAL
    raise GatewayError("网关任务超时")


async def _run_task(task_id: str, feature: str, user_id: int, tenant_id: int,
                    cost: int, kind: str, worker):
    """通用后台执行器:置 processing → 扣分 → worker() 产出字节 → 落盘;失败退款。"""
    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask
    from app.services.credit_service import CreditService

    async with AsyncSessionLocal() as db:
        credit_service = CreditService(db)
        deducted = False
        try:
            db_task = (await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )).scalar_one_or_none()
            if not db_task:
                logger.error("studio task %s not found", task_id)
                return

            db_task.status = "processing"
            db_task.progress = 10
            await db.commit()

            from app.core.credits import InsufficientCreditsError
            try:
                await credit_service.deduct(
                    tenant_id=tenant_id, amount=cost,
                    description=f"Media Studio [{feature}] 任务",
                )
                deducted = True
            except InsufficientCreditsError as e:
                db_task.status = "failed"
                db_task.error_message = str(e)
                await db.commit()
                return

            if not settings.AI_GATEWAY_API_KEY:
                raise GatewayError("AI 网关未配置 (AI_GATEWAY_API_KEY)")

            db_task.progress = 30
            await db.commit()

            data = await worker()   # → bytes

            await _finalize(db_task, user_id, data, kind, task_id)
            await db.commit()
            logger.info("studio task %s [%s] completed", task_id, feature)

        except Exception as e:  # noqa: BLE001
            logger.error("studio task %s [%s] failed: %s", task_id, feature, e)
            try:
                db_task = (await db.execute(
                    select(GenerationTask).where(GenerationTask.task_id == task_id)
                )).scalar_one_or_none()
                if db_task:
                    db_task.status = "failed"
                    db_task.error_message = str(e)
                    await db.commit()
                if deducted:
                    await credit_service.recharge(
                        tenant_id=tenant_id, amount=cost,
                        payment_method="refund", reference_id=task_id,
                    )
            except Exception:  # noqa: BLE001
                pass


async def _precheck_and_create(db: AsyncSession, current_user: User, feature: str,
                               model_id: str, prompt: str, cost: int) -> str:
    """积分校验 + 建任务记录,返回 task_id。"""
    from app.services.credit_service import CreditService
    from app.models.generation_task import GenerationTask
    from app.core.pricing import max_prompt_chars

    if not settings.AI_GATEWAY_API_KEY:
        raise HTTPException(status_code=500, detail="AI 网关未配置 (AI_GATEWAY_API_KEY)")

    # 提示词长度按所选模型的真实上限校验（对齐上游）。
    _limit = max_prompt_chars(model_id)
    if prompt and len(prompt) > _limit:
        raise HTTPException(
            status_code=400,
            detail=f"提示词过长：当前 {len(prompt)} 字，该模型最多 {_limit} 字，请精简后重试",
        )

    credit_service = CreditService(db)
    if not await credit_service.check_sufficient_credits(current_user.tenant_id, cost):
        balance = await credit_service.get_balance(current_user.tenant_id)
        raise HTTPException(status_code=400,
                            detail=f"积分不足。需要 {cost} 积分,当前余额 {balance} 积分")

    task_id = str(uuid.uuid4())
    db.add(GenerationTask(
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        model_id=model_id,
        task_type=feature,
        prompt=prompt or feature,
        parameters=json.dumps({"feature": feature, "cost": cost}),
        status="pending",
    ))
    await db.commit()
    return task_id


# ── 上传(图片 / 视频)──────────────────────────────────────────────────────
@router.post("/upload", response_model=ResponseBase[FileUploadResponse])
async def upload_media(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """上传图片或视频,返回 file_id(供各功能端点引用)。"""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _IMG_EXTS + _VIDEO_EXTS:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")

    contents = await file.read()
    file_id = str(uuid.uuid4())
    upload_path = get_user_upload_path(settings.STORAGE_BASE_PATH, current_user.id)
    local_path = upload_path / f"{file_id}{ext}"
    async with aiofiles.open(local_path, "wb") as f:
        await f.write(contents)

    if settings.MINIO_ENABLED:
        try:
            storage = get_storage_service()
            await storage.upload_file(
                local_path, storage.user_upload_key(current_user.id, f"{file_id}{ext}"),
                StorageService.content_type_for(f"{file_id}{ext}"),
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("studio upload MinIO failed for %s: %s", file_id, e)

    kind = "video" if ext in _VIDEO_EXTS else "image"
    return ResponseBase(
        success=True, message="上传成功",
        data=FileUploadResponse(
            success=True, file_id=file_id, filename=file.filename or f"{file_id}{ext}",
            file_path=str(local_path), message=kind,
        ),
    )


# ── AI特效 ───────────────────────────────────────────────────────────────────
@router.post("/effects", response_model=ResponseBase[GenerationTaskResponse])
async def create_effect(
    req: EffectRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cost = EFFECT_COST.get(req.effect_id, DEFAULT_COST[FEATURE_EFFECT])
    is_video = req.effect_id in EFFECT_VIDEO_IDS
    if is_video:
        model_id = req.model_id or settings.GATEWAY_VIDEO_HAPPYHORSE
        prompt = req.prompt or EFFECT_VIDEO_PROMPT.get(req.effect_id, f"animate effect: {req.effect_id}")
    else:
        model_id = req.model_id or settings.GATEWAY_EFFECT_IMAGE_MODEL
        prompt = req.prompt or EFFECT_PROMPT.get(req.effect_id, f"Apply effect: {req.effect_id}")
    task_id = await _precheck_and_create(db, current_user, FEATURE_EFFECT,
                                         model_id or "effect", prompt, cost)
    uid, tid = current_user.id, current_user.tenant_id
    image_id = req.image_id
    ref_id = req.reference_image_id

    async def worker() -> bytes:
        gw = get_gateway_client_for_user(uid)
        img = await _read_upload_bytes(uid, image_id)
        if img is None:
            raise GatewayError("未找到上传的图片")
        if is_video:
            # 视频类特效:M1 用 HappyHorse 图生视频。双人特效(亲吻/拥抱)若有参考图走 r2v。
            # HappyHorse 的 input_reference 是逗号连接的 URL 列表,base64 data URL 含逗号会
            # 破坏该字段导致 "Invalid Parameter" —— 必须传网关可达的公网 URL。
            image_url = await _resolve_image_public_url(uid, image_id)
            ref_url = await _resolve_image_public_url(uid, ref_id) if ref_id else None
            image_urls = [u for u in [image_url, ref_url] if u]
            if not image_urls:
                raise GatewayError(
                    "图生视频需要网关可达的图片公网 URL；请确认 PUBLIC_BASE_URL 已配置"
                )
            mode = "r2v" if ref_url else "i2v"
            gw_task = await gw.happyhorse_create(
                prompt, mode=mode, resolution="720p", duration=4, image_urls=image_urls,
            )
            url = await _poll_video(gw.video_poll, gw_task)
            return await gw.fetch_bytes(url)
        # 图像类特效:M1 用 wan 图生图实现
        urls = await gw.generate_image(prompt, image=img,
                                       model=settings.GATEWAY_EFFECT_IMAGE_MODEL)
        return await gw.fetch_bytes(urls[0])

    background_tasks.add_task(
        _run_task, task_id, FEATURE_EFFECT, uid, tid, cost,
        "video" if is_video else "image", worker,
    )
    return _accepted(task_id)


# ── AI短视频 ─────────────────────────────────────────────────────────────────
@router.post("/short-video", response_model=ResponseBase[GenerationTaskResponse])
async def create_short_video(
    req: ShortVideoRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cost = DEFAULT_COST[FEATURE_SHORT_VIDEO]
    # 短视频走海螺(Hailuo)。本网关把海螺统一在 OpenAI 风格 /videos 端点,经 video_poll 轮询。
    model_id = req.model_id or settings.GATEWAY_SHORT_VIDEO_MODEL
    task_id = await _precheck_and_create(db, current_user, FEATURE_SHORT_VIDEO,
                                         model_id, req.prompt, cost)
    uid, tid = current_user.id, current_user.tenant_id
    prompt, frame_id = req.prompt, req.first_frame_id
    # 海螺时长:1080P 仅支持 6s;此处统一 768P,>6s 取 10s 否则 6s
    hl_duration = 10 if req.duration and req.duration > 6 else 6

    async def worker() -> bytes:
        gw = get_gateway_client_for_user(uid)
        first_frame = await _read_upload_bytes(uid, frame_id) if frame_id else None
        gw_task = await gw.hailuo_create(
            prompt, first_frame_image=first_frame, duration=hl_duration, resolution="768P",
        )
        url = await _poll_video(gw.video_poll, gw_task)
        return await gw.fetch_bytes(url)

    background_tasks.add_task(
        _run_task, task_id, FEATURE_SHORT_VIDEO, uid, tid, cost, "video", worker,
    )
    return _accepted(task_id)


# ── 视频生成视频 ─────────────────────────────────────────────────────────────
@router.post("/video2video", response_model=ResponseBase[GenerationTaskResponse])
async def create_video2video(
    req: Video2VideoRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cost = DEFAULT_COST[FEATURE_VIDEO2VIDEO]
    model_id = req.model_id or "seedance"
    task_id = await _precheck_and_create(db, current_user, FEATURE_VIDEO2VIDEO,
                                         model_id, req.prompt, cost)
    uid, tid = current_user.id, current_user.tenant_id
    prompt, video_id = req.prompt, req.video_id
    ratio, duration = req.ratio, req.duration
    style_prompt, negative_prompt = req.style_prompt, req.negative_prompt
    ref_ids = list(req.reference_image_ids or [])

    async def worker() -> bytes:
        gw = get_gateway_client_for_user(uid)
        video_url = await _resolve_video_public_url(uid, video_id)
        if not video_url:
            raise GatewayError("未找到源视频,或 PUBLIC_BASE_URL/MinIO 未配置")

        if model_id == "kling-omni":
            # Kling Omni 转绘:源视频 + 参考主体图都需公网可达 URL。
            image_urls: List[str] = []
            for rid in ref_ids:
                u = await _resolve_image_public_url(uid, rid)
                if u:
                    image_urls.append(u)
            full_prompt = prompt
            if style_prompt:
                full_prompt = f"{prompt}，{style_prompt}" if prompt else style_prompt
            gw_task = await gw.kling_omni_video2video(
                full_prompt, video_url=video_url, image_urls=image_urls or None,
            )
            url = await _poll_video(lambda t: gw.kling_poll(t, endpoint="omni-video"), gw_task)
            return await gw.fetch_bytes(url)

        # 默认 Seedance 档:参考主体图 base64 内联,风格/负向并入文本。
        ref_images = []
        for rid in ref_ids:
            b = await _resolve_image_bytes(uid, rid)
            if b is not None:
                ref_images.append(b)
        gw_task = await gw.video2video_create(
            prompt, video_url=video_url, style_prompt=style_prompt,
            reference_images=ref_images or None, negative_prompt=negative_prompt,
            ratio=ratio, duration=duration,
        )
        url = await _poll_video(gw.seedance_poll, gw_task)
        return await gw.fetch_bytes(url)

    background_tasks.add_task(
        _run_task, task_id, FEATURE_VIDEO2VIDEO, uid, tid, cost, "video", worker,
    )
    return _accepted(task_id)


# ── 动作模仿 ─────────────────────────────────────────────────────────────────
# 三档模型:kling-motion-control(Kling 动作控制)/ kling-omni(Kling Omni)/ seedance(默认回退)。
# Kling 两档需 token 开通 kling 分组;未开通时任务失败并由 _run_task 自动退款。
_MOTION_KLING_MODELS = {"kling-motion-control", "kling-omni"}


@router.post("/motion", response_model=ResponseBase[GenerationTaskResponse])
async def create_motion(
    req: MotionRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cost = DEFAULT_COST[FEATURE_MOTION]
    model_id = req.model_id or "seedance"
    if not req.motion_video_id and not req.motion_template:
        raise HTTPException(status_code=400, detail="请上传动作视频或选择动作模板")
    task_id = await _precheck_and_create(db, current_user, FEATURE_MOTION,
                                         model_id, req.prompt or "motion imitation", cost)
    uid, tid = current_user.id, current_user.tenant_id
    prompt = req.prompt or ""
    char_id, motion_id, template = req.character_image_id, req.motion_video_id, req.motion_template
    ratio, duration = req.ratio, req.duration
    orientation, keep_sound = req.character_orientation, req.keep_original_sound

    async def worker() -> bytes:
        gw = get_gateway_client_for_user(uid)
        # 动作参考:自定义上传视频 → 公网签名 URL;内置模板 → static 公网 URL。
        if motion_id:
            motion_url = await _public_upload_url(uid, motion_id)
        else:
            motion_url = _template_public_url(template or "")
        if not motion_url:
            raise GatewayError("未找到动作参考视频/模板,或 PUBLIC_BASE_URL/MinIO 未配置")

        if model_id in _MOTION_KLING_MODELS:
            # Kling 两档:角色图也需公网可达 URL(不吃 base64 内联)。
            char_url = await _public_upload_url(uid, char_id)
            if not char_url:
                raise GatewayError("未找到角色图片,或 PUBLIC_BASE_URL/MinIO 未配置")
            if model_id == "kling-omni":
                gw_task = await gw.kling_omni_create(
                    prompt, image_url=char_url, video_url=motion_url,
                )
                url = await _poll_video(
                    lambda t: gw.kling_poll(t, endpoint="omni-video"), gw_task)
            else:
                gw_task = await gw.kling_motion_control_create(
                    prompt, image_url=char_url, video_url=motion_url,
                    character_orientation=orientation, keep_original_sound=keep_sound,
                )
                url = await _poll_video(
                    lambda t: gw.kling_poll(t, endpoint="motion-control"), gw_task)
            return await gw.fetch_bytes(url)

        # 默认 Seedance 档(即时可用):角色图 base64 内联 + 动作参考视频公网 URL。
        char_img = await _read_upload_bytes(uid, char_id)
        if char_img is None:
            raise GatewayError("未找到角色图片")
        gw_task = await gw.motion_create(
            prompt, character_image=char_img, motion_video_url=motion_url,
            ratio=ratio, duration=duration,
        )
        url = await _poll_video(gw.seedance_poll, gw_task)
        return await gw.fetch_bytes(url)

    background_tasks.add_task(
        _run_task, task_id, FEATURE_MOTION, uid, tid, cost, "video", worker,
    )
    return _accepted(task_id)


# ── 视频编辑 ─────────────────────────────────────────────────────────────────
@router.post("/video-edit", response_model=ResponseBase[GenerationTaskResponse])
async def create_video_edit(
    req: VideoEditRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cost = DEFAULT_COST[FEATURE_VIDEO_EDIT]
    model_id = req.model_id or settings.GATEWAY_VIDEO_EDIT_MODEL or "video_edit"
    task_id = await _precheck_and_create(db, current_user, FEATURE_VIDEO_EDIT,
                                         model_id, req.prompt, cost)
    uid, tid = current_user.id, current_user.tenant_id
    prompt, video_id, edit_type = req.prompt, req.video_id, req.edit_type

    async def worker() -> bytes:
        gw = get_gateway_client_for_user(uid)
        # HappyHorse 视频编辑: 优先公网 URL,取不到则回退 base64 内联上传字节
        video_url = await _public_video_url(uid, video_id)
        video_bytes = None if video_url else await _read_upload_bytes(uid, video_id)
        if not video_url and video_bytes is None:
            raise GatewayError("未找到上传的视频")
        gw_task = await gw.video_edit_create(
            prompt, video_url=video_url, video_bytes=video_bytes, edit_type=edit_type,
        )
        url = await _poll_video(gw.video_poll, gw_task)
        return await gw.fetch_bytes(url)

    background_tasks.add_task(
        _run_task, task_id, FEATURE_VIDEO_EDIT, uid, tid, cost, "video", worker,
    )
    return _accepted(task_id)


# ── 共享:任务状态 / 文件 / 历史 ─────────────────────────────────────────────
def _accepted(task_id: str) -> ResponseBase[GenerationTaskResponse]:
    return ResponseBase(
        success=True, message="任务已创建",
        data=GenerationTaskResponse(
            task_id=task_id, status="pending", message="Task submitted", progress=0,
        ),
    )


@router.get("/task/{task_id}", response_model=ResponseBase[GenerationTaskResponse])
async def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.generation_task import GenerationTask
    db_task = (await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id == task_id,
            GenerationTask.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    result_url = f"/api/v1/studio/task/{task_id}/file" if db_task.result_path else db_task.result_url
    return ResponseBase(
        success=True, message="ok",
        data=GenerationTaskResponse(
            task_id=db_task.task_id, status=db_task.status,
            message=f"Task is {db_task.status}", result_url=result_url,
            error=db_task.error_message, progress=db_task.progress or 0,
        ),
    )


@router.get("/task/{task_id}/file")
async def get_task_file(task_id: str, db: AsyncSession = Depends(get_db)):
    from app.models.generation_task import GenerationTask
    db_task = (await db.execute(
        select(GenerationTask).where(GenerationTask.task_id == task_id)
    )).scalar_one_or_none()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if db_task.status != "completed" or not db_task.result_path:
        raise HTTPException(status_code=400, detail="File not available")

    if StorageService.is_minio_key(db_task.result_path):
        try:
            storage = get_storage_service()
            data, content_type = await storage.get_object_bytes(db_task.result_path)
            return Response(content=data, media_type=content_type)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Storage error: {e}")

    file_path = Path(db_task.result_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return Response(
        content=file_path.read_bytes(),
        media_type=StorageService.content_type_for(file_path.name),
    )


@router.get("/asset")
async def serve_studio_asset(
    key: str = Query(...),
    exp: int = Query(...),
    sig: str = Query(...),
):
    """公网(签名保护)流式输出 studio 上传的素材(供外部网关取视频/图片做输入)。

    用 HMAC 签名+过期校验,不是开放代理;无需鉴权头——网关直接 GET 此 URL。
    仅允许本用户上传区 ``users/.../uploads/`` 的素材,阻断路径穿越。
    """
    if not key.startswith("users/") or "/uploads/" not in key or ".." in key:
        raise HTTPException(status_code=400, detail="Invalid asset key")
    if exp < int(time.time()):
        raise HTTPException(status_code=403, detail="Asset link expired")
    if not hmac.compare_digest(sig, _sign_asset(key, exp)):
        raise HTTPException(status_code=403, detail="Invalid signature")
    try:
        data, ct = await get_storage_service().get_object_bytes(key)
    except Exception as exc:  # noqa: BLE001
        logger.debug("studio asset not found: %s (%s)", key, exc)
        raise HTTPException(status_code=404, detail="Asset not found")
    return Response(
        content=data,
        media_type=StorageService.content_type_for(Path(key).name) or ct,
        headers={"Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes"},
    )


@router.get("/history")
async def get_history(
    task_type: str,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """按功能(task_type)拉取历史。task_type ∈ effect/short_video/video2video/motion/video_edit。"""
    from app.models.generation_task import GenerationTask
    tasks = (await db.execute(
        select(GenerationTask).where(
            GenerationTask.user_id == current_user.id,
            GenerationTask.task_type == task_type,
            GenerationTask.status == "completed",
        ).order_by(desc(GenerationTask.created_at)).limit(limit)
    )).scalars().all()

    history = []
    for t in tasks:
        try:
            params = json.loads(t.parameters) if t.parameters else {}
        except Exception:  # noqa: BLE001
            params = {}
        history.append({
            "task_id": t.task_id, "prompt": t.prompt, "model_id": t.model_id,
            "result_url": f"/api/v1/studio/task/{t.task_id}/file" if t.result_path else t.result_url,
            "parameters": params,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    return ResponseBase(success=True, message="ok", data=history)
