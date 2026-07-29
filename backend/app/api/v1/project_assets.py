"""
Project Asset API – per-project 角色 / 场景 / 道具 configuration assets.

Each asset belongs to a drama project (project_id) and a type (character/scene/prop),
carries a name + description and 1..N images (a required 主图 cover + optional 副图).
Images can be uploaded directly or sourced from a completed Flux text-to-image task.

POST   /                              – create asset + upload 1..N images (first = cover)
GET    /?project_id&asset_type&q      – list assets for a project + type
GET    /{asset_id}                    – asset detail
PUT    /{asset_id}                    – update name / description
DELETE /{asset_id}                    – soft-delete
POST   /{asset_id}/images             – append 副图 (upload files or a flux task_id)
DELETE /{asset_id}/images/{image_id}  – delete one image (cover auto-reassigns)
GET    /{asset_id}/images/{image_id}/file  – stream an image (capability-token by asset_id)
"""
import uuid
import json
import asyncio
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query
from fastapi.responses import Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.project_asset import ProjectAsset, ProjectAssetImage
from app.models.drama_project import DramaProject
from app.models.user import User
from app.schemas.response import ResponseBase
from app.services.storage import get_storage_service, StorageService
from app.utils.ai_character_parser import view_caption, ai_character_slot_caption, build_description
from app.utils.image_compress import compress_image_bytes

router = APIRouter()

ASSET_TYPES = {"character", "scene", "prop"}
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


# ── helpers ──────────────────────────────────────────────────────────────────

def _asset_to_dict(a: ProjectAsset) -> dict:
    return {
        "id": a.id,
        "asset_id": a.asset_id,
        "project_id": a.project_id,
        "asset_type": a.asset_type,
        "name": a.name,
        "description": a.description,
        "cover_path": a.cover_path,
        "sort_order": a.sort_order,
        "source_ai_character_key": getattr(a, "source_ai_character_key", None),
        "images": [
            {
                "id": img.id,
                "image_path": img.image_path,
                "is_cover": img.is_cover,
                "sort_order": img.sort_order,
                "caption": getattr(img, "caption", None),
            }
            for img in (a.images or [])
        ],
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


async def _get_owned_asset(db: AsyncSession, asset_id: str, user: User) -> ProjectAsset:
    result = await db.execute(
        select(ProjectAsset).where(
            ProjectAsset.asset_id == asset_id,
            ProjectAsset.user_id == user.id,
            ProjectAsset.deleted_at.is_(None),
        )
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="资源不存在")
    return asset


def _scan_asset_references(episodes_data: Optional[str], asset_id: str) -> list[str]:
    """扫描项目 episodes_data，找出所有引用了该配置元素(asset_id)的位置。

    引用来源：分镜参考图 shots[].images[].assetId、整集素材库 assets[].assetId。
    返回去重后的人类可读位置列表（如「第1集·分镜3」「第2集·整集素材库」），供删除拦截提示。
    """
    refs: list[str] = []
    seen: set[str] = set()

    def _add(loc: str) -> None:
        if loc not in seen:
            seen.add(loc)
            refs.append(loc)

    try:
        data = json.loads(episodes_data or "{}")
    except (ValueError, TypeError):
        return refs
    for ep in (data.get("episodes") or []):
        ep_no = ep.get("episode")
        for a in (ep.get("assets") or []):
            if a.get("assetId") == asset_id:
                _add(f"第{ep_no}集·整集素材库")
        for shot in (ep.get("shots") or []):
            for im in (shot.get("images") or []):
                if im.get("assetId") == asset_id:
                    _add(f"第{ep_no}集·分镜{shot.get('index')}")
    return refs


async def _find_asset_references(db: AsyncSession, asset: ProjectAsset, user: User) -> list[str]:
    """加载该元素所属项目的 episodes_data，返回引用位置列表（空=未被引用）。"""
    proj = (await db.execute(
        select(DramaProject).where(
            DramaProject.project_id == asset.project_id,
            DramaProject.user_id == user.id,
            DramaProject.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not proj:
        return []
    return _scan_asset_references(proj.episodes_data, asset.asset_id)


async def _upload_asset_image(
    storage: StorageService, data: bytes, filename: Optional[str],
    user_id: int, project_id: str, asset_id: str, idx: int,
) -> str:
    ext = filename.rsplit(".", 1)[-1] if filename and "." in filename else "png"
    # Shrink oversized refs so the gateway can fetch them over the slow public origin
    # (else: "Failed to download ... InvalidParameter"). Covers upload + copy call sites.
    data, norm_ext = await asyncio.to_thread(compress_image_bytes, data, f".{ext}")
    ext = norm_ext.lstrip(".")
    object_key = storage.project_asset_key(user_id, project_id, asset_id, f"img_{uuid.uuid4().hex}.{ext}")
    content_type = StorageService.content_type_for(f"file.{ext}")
    await storage.upload_bytes(data, object_key, content_type)
    return object_key


# ── routes ───────────────────────────────────────────────────────────────────

@router.post("", response_model=ResponseBase)
async def create_asset(
    project_id: str = Form(...),
    asset_type: str = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    images: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an asset with 1..N images (first uploaded image becomes the 主图)."""
    if asset_type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail="asset_type 必须是 character / scene / prop")
    if len(images) < 1:
        raise HTTPException(status_code=400, detail="请至少上传一张主图")
    for img in images:
        if img.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail=f"不支持的图片格式: {img.content_type}")

    asset_uuid = str(uuid.uuid4())
    storage = get_storage_service()

    image_records: list[ProjectAssetImage] = []
    cover_key: Optional[str] = None
    for idx, img in enumerate(images):
        data = await img.read()
        object_key = await _upload_asset_image(
            storage, data, img.filename, current_user.id, project_id, asset_uuid, idx,
        )
        # 角色图按上传顺序自动套用视角名称（前 4 张：特征图片/肖像特写/各类表情/三个角度视图）。
        caption = view_caption(name, idx) if asset_type == "character" else ""
        image_records.append(ProjectAssetImage(
            image_path=object_key, is_cover=1 if idx == 0 else 0, sort_order=idx,
            caption=caption or None,
        ))
        if idx == 0:
            cover_key = object_key

    # Next sort_order within this project + type
    max_order = (await db.execute(
        select(func.coalesce(func.max(ProjectAsset.sort_order), -1)).where(
            ProjectAsset.project_id == project_id,
            ProjectAsset.asset_type == asset_type,
            ProjectAsset.user_id == current_user.id,
            ProjectAsset.deleted_at.is_(None),
        )
    )).scalar()

    asset = ProjectAsset(
        asset_id=asset_uuid,
        project_id=project_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        asset_type=asset_type,
        name=name,
        description=description,
        cover_path=cover_key,
        sort_order=int(max_order) + 1,
    )
    asset.images = image_records

    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return ResponseBase(success=True, message="创建成功", data=_asset_to_dict(asset))


@router.post("/from-ai-character", response_model=ResponseBase)
async def create_asset_from_ai_character(
    project_id: str = Form(...),
    ai_character_key: str = Form(...),
    name: Optional[str] = Form(None),          # 可选覆盖名称，默认取 AI 角色名
    slots: Optional[str] = Form(None),         # 可选：逗号分隔的图片 slot 子集，如 "1,3"
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """从 AI 角色库「应用到画布」：把一个全局只读 AI 角色实例化为当前项目的可编辑角色要素。

    - 复制 AI 角色图片到用户项目目录（副本独立，后续增删改不影响全局定义）
    - name / description 预填自 AI 角色，用户之后可自由改名改属性
    - 记录 source_ai_character_key 溯源；实例自动获得「被分镜引用时禁删」保护
    """
    from app.models.ai_character import AICharacter

    ai_char = (await db.execute(
        select(AICharacter).where(AICharacter.character_key == ai_character_key)
    )).scalar_one_or_none()
    if not ai_char:
        raise HTTPException(status_code=404, detail="AI 角色不存在")
    if not ai_char.images:
        raise HTTPException(status_code=400, detail="该 AI 角色无可用图片")

    # 选择要复制的图片（默认全部；否则按 slot 子集）
    wanted_slots = None
    if slots:
        wanted_slots = {int(s) for s in slots.split(",") if s.strip().isdigit()}
    src_images = [im for im in ai_char.images if (wanted_slots is None or im.slot in wanted_slots)]
    if not src_images:
        src_images = list(ai_char.images)

    asset_uuid = str(uuid.uuid4())
    storage = get_storage_service()
    asset_name = (name or ai_char.name)

    # 先算出角色描述（属性摘要 + 辨识特征 + 着装，多行），供下面按行生成每图默认视角描述用。
    import json as _json
    try:
        attrs = _json.loads(ai_char.attributes_json) if ai_char.attributes_json else {}
    except (ValueError, TypeError):
        attrs = {}
    description = build_description(attrs, ai_char.feature_desc or "", ai_char.costume_desc or "")

    image_records: list[ProjectAssetImage] = []
    cover_key: Optional[str] = None
    for idx, src in enumerate(src_images):
        try:
            data, _ct = await storage.get_object_bytes(src.image_path)
        except Exception:
            raise HTTPException(status_code=400, detail="AI 角色图片读取失败")
        object_key = await _upload_asset_image(
            storage, data, src.image_path, current_user.id, project_id, asset_uuid, idx,
        )
        # 每图默认描述按源 AI 角色图的 slot（1..4）从角色描述逐行对应（表情固定）；
        # 按 slot 而非拷贝顺序，保证只选部分 slot 时不错位。
        caption = ai_character_slot_caption(asset_name, (src.slot or 1), description)
        image_records.append(ProjectAssetImage(
            image_path=object_key, is_cover=1 if idx == 0 else 0, sort_order=idx,
            caption=caption or None,
        ))
        if idx == 0:
            cover_key = object_key

    max_order = (await db.execute(
        select(func.coalesce(func.max(ProjectAsset.sort_order), -1)).where(
            ProjectAsset.project_id == project_id,
            ProjectAsset.asset_type == "character",
            ProjectAsset.user_id == current_user.id,
            ProjectAsset.deleted_at.is_(None),
        )
    )).scalar()

    asset = ProjectAsset(
        asset_id=asset_uuid,
        project_id=project_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        asset_type="character",
        name=asset_name,
        description=description,
        cover_path=cover_key,
        sort_order=int(max_order) + 1,
        source_ai_character_key=ai_character_key,
    )
    asset.images = image_records

    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return ResponseBase(success=True, message="已添加到角色要素", data=_asset_to_dict(asset))


@router.get("", response_model=ResponseBase)
async def list_assets(
    project_id: str = Query(...),
    asset_type: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List assets for a project (optionally filtered by type / name query)."""
    base = select(ProjectAsset).where(
        ProjectAsset.project_id == project_id,
        ProjectAsset.user_id == current_user.id,
        ProjectAsset.deleted_at.is_(None),
    )
    if asset_type:
        if asset_type not in ASSET_TYPES:
            raise HTTPException(status_code=400, detail="asset_type 无效")
        base = base.where(ProjectAsset.asset_type == asset_type)
    if q:
        base = base.where(ProjectAsset.name.ilike(f"%{q}%"))

    result = await db.execute(base.order_by(ProjectAsset.sort_order, ProjectAsset.created_at))
    assets = result.scalars().all()

    return ResponseBase(
        success=True,
        data={"items": [_asset_to_dict(a) for a in assets], "total": len(assets)},
    )


@router.get("/{asset_id}", response_model=ResponseBase)
async def get_asset(
    asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await _get_owned_asset(db, asset_id, current_user)
    return ResponseBase(success=True, data=_asset_to_dict(asset))


@router.put("/{asset_id}", response_model=ResponseBase)
async def update_asset(
    asset_id: str,
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await _get_owned_asset(db, asset_id, current_user)
    if name is not None:
        asset.name = name
    if description is not None:
        asset.description = description
    await db.commit()
    await db.refresh(asset)
    return ResponseBase(success=True, message="已更新", data=_asset_to_dict(asset))


@router.delete("/{asset_id}", response_model=ResponseBase)
async def delete_asset(
    asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset = await _get_owned_asset(db, asset_id, current_user)
    # 引用校验：被分镜参考图 / 整集素材库引用中的元素不允许删除，返回具体引用位置提示
    refs = await _find_asset_references(db, asset, current_user)
    if refs:
        shown = "、".join(refs[:5])
        more = f" 等 {len(refs)} 处" if len(refs) > 5 else ""
        raise HTTPException(
            status_code=409,
            detail=f"「{asset.name}」正在被 {shown}{more} 引用，无法删除。请先在对应分镜/整集素材库中移除引用后再删除。",
        )
    asset.deleted_at = datetime.utcnow()
    await db.commit()
    return ResponseBase(success=True, message="已删除")


@router.post("/{asset_id}/images", response_model=ResponseBase)
async def add_asset_images(
    asset_id: str,
    images: List[UploadFile] = File(None),
    flux_task_id: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Append 副图 to an asset – either uploaded files or a completed Flux task's output."""
    asset = await _get_owned_asset(db, asset_id, current_user)
    storage = get_storage_service()

    existing_count = len(asset.images)
    next_order = (max((img.sort_order for img in asset.images), default=-1)) + 1
    new_keys: list[str] = []

    # From uploaded files
    for img in (images or []):
        if img.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail=f"不支持的图片格式: {img.content_type}")
        data = await img.read()
        key = await _upload_asset_image(
            storage, data, img.filename, current_user.id, asset.project_id, asset.asset_id, next_order,
        )
        new_keys.append(key)
        next_order += 1

    # From a completed Flux text-to-image task – copy its bytes into the asset dir
    if flux_task_id:
        from app.models.generation_task import GenerationTask
        task = (await db.execute(
            select(GenerationTask).where(
                GenerationTask.task_id == flux_task_id,
                GenerationTask.user_id == current_user.id,
            )
        )).scalar_one_or_none()
        if not task or task.status != "completed" or not task.result_path:
            raise HTTPException(status_code=400, detail="文生图任务未完成或不存在")
        try:
            data, _ct = await storage.get_object_bytes(task.result_path)
        except Exception:
            raise HTTPException(status_code=400, detail="文生图结果读取失败")
        key = await _upload_asset_image(
            storage, data, task.result_path, current_user.id, asset.project_id, asset.asset_id, next_order,
        )
        new_keys.append(key)
        next_order += 1

    if not new_keys:
        raise HTTPException(status_code=400, detail="未提供图片")

    for i, key in enumerate(new_keys):
        # 角色图续算视角名称：以已有图片数为起始序号（前 4 张：特征图片/肖像特写/各类表情/三个角度视图）。
        caption = view_caption(asset.name, existing_count + i) if asset.asset_type == "character" else ""
        db.add(ProjectAssetImage(
            asset_id=asset.id, image_path=key, is_cover=0, sort_order=next_order,
            caption=caption or None,
        ))
        next_order += 1

    await db.commit()
    await db.refresh(asset)
    return ResponseBase(success=True, message="已添加", data=_asset_to_dict(asset))


@router.delete("/{asset_id}/images/{image_id}", response_model=ResponseBase)
async def delete_asset_image(
    asset_id: str,
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete one image. If it was the cover, promote the next remaining image."""
    asset = await _get_owned_asset(db, asset_id, current_user)
    target = next((img for img in asset.images if img.id == image_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="图片不存在")
    if len(asset.images) <= 1:
        raise HTTPException(status_code=400, detail="至少保留主图，无法删除")

    was_cover = target.is_cover == 1
    storage = get_storage_service()
    try:
        await storage.delete(target.image_path)
    except Exception:
        pass  # best-effort; still remove the DB row

    await db.delete(target)
    await db.flush()

    if was_cover:
        remaining = sorted((i for i in asset.images if i.id != image_id), key=lambda i: i.sort_order)
        if remaining:
            new_cover = remaining[0]
            new_cover.is_cover = 1
            asset.cover_path = new_cover.image_path

    await db.commit()
    await db.refresh(asset)
    return ResponseBase(success=True, message="已删除", data=_asset_to_dict(asset))


@router.put("/{asset_id}/images/{image_id}", response_model=ResponseBase)
async def update_asset_image(
    asset_id: str,
    image_id: int,
    caption: str = Form(""),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新单张图片的视角描述定义（caption）。用于「配置」面板手动改写每图的视角命名。"""
    asset = await _get_owned_asset(db, asset_id, current_user)
    target = next((img for img in asset.images if img.id == image_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="图片不存在")
    target.caption = (caption or "").strip() or None
    await db.commit()
    await db.refresh(asset)
    return ResponseBase(success=True, message="已更新", data=_asset_to_dict(asset))


@router.get("/{asset_id}/images/{image_id}/file")
async def get_asset_image_file(
    asset_id: str,
    image_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Stream an asset image from MinIO.

    No auth required — asset_id is an unguessable UUID acting as a capability token,
    same pattern as character / flux task file endpoints (enables plain <img src>).
    """
    result = await db.execute(
        select(ProjectAssetImage).join(ProjectAsset).where(
            ProjectAsset.asset_id == asset_id,
            ProjectAssetImage.id == image_id,
            ProjectAsset.deleted_at.is_(None),
        )
    )
    img = result.scalar_one_or_none()
    if not img:
        raise HTTPException(status_code=404, detail="图片不存在")

    storage = get_storage_service()
    data, content_type = await storage.get_object_bytes(img.image_path)
    return Response(content=data, media_type=content_type)
