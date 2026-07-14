"""
Drama Project CRUD API
Routes are mounted under /api/v1/drama/projects
"""
import json
import uuid
import logging
from datetime import datetime
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.drama_project import DramaProject
from app.schemas.response import ResponseBase

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request schemas ──────────────────────────────────────────────────────────

class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = None
    concept: Optional[str] = None
    genre: Optional[str] = None
    art_style: Optional[str] = None
    aspect_ratio: Optional[str] = None
    episode_count: int = 0


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    concept: Optional[str] = None
    genre: Optional[str] = None
    art_style: Optional[str] = None
    aspect_ratio: Optional[str] = None
    episode_count: Optional[int] = None
    status: Optional[str] = None          # draft | in_progress | completed | archived
    thumbnail_path: Optional[str] = None
    script_text: Optional[str] = None     # legacy
    source_mode: Optional[str] = None     # legacy
    style_lock: Optional[str] = None      # legacy
    outline_data: Optional[Any] = None    # legacy OutlineResponse dict
    storyboard_data: Optional[Any] = None # legacy Record<epNum, ShotState[]> dict
    materials_data: Optional[Any] = None  # legacy MaterialsData dict
    # 重构核心：剧集系列数据 { episodes: [ { episode, title, script_text, shots, composite_* } ] }
    episodes_data: Optional[Any] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_projects(
    q: Optional[str] = Query(None, description="Search name / concept / description"),
    genre: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    archived: bool = Query(False, description="True 只返回已归档；False(默认)只返回未归档"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List drama projects with full-text search across name, concept, description, genre."""

    def _apply_filters(query):
        if q:
            like = f"%{q}%"
            query = query.where(
                or_(
                    DramaProject.name.ilike(like),
                    DramaProject.concept.ilike(like),
                    DramaProject.description.ilike(like),
                    DramaProject.genre.ilike(like),
                )
            )
        if genre:
            query = query.where(DramaProject.genre == genre)
        if status:
            query = query.where(DramaProject.status == status)
        # 默认隐藏已归档；archived=true 时只看归档
        if archived:
            query = query.where(DramaProject.archived_at.isnot(None))
        else:
            query = query.where(DramaProject.archived_at.is_(None))
        return query

    base = select(DramaProject).where(
        DramaProject.user_id == current_user.id,
        DramaProject.deleted_at.is_(None),
    )
    query = _apply_filters(base).order_by(desc(DramaProject.updated_at)).offset(offset).limit(limit)
    result = await db.execute(query)
    projects = result.scalars().all()

    count_query = _apply_filters(select(DramaProject).where(
        DramaProject.user_id == current_user.id,
        DramaProject.deleted_at.is_(None),
    ))
    count_result = await db.execute(count_query)
    total = len(count_result.scalars().all())

    return ResponseBase(
        success=True,
        message="Projects retrieved",
        data={
            "items": [_to_dict(p, include_data=False) for p in projects],
            "total": total,
            "limit": limit,
            "offset": offset,
        },
    )


@router.post("")
async def create_project(
    body: CreateProjectRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new drama project."""
    project = DramaProject(
        project_id=str(uuid.uuid4()),
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        name=body.name,
        description=body.description,
        concept=body.concept,
        genre=body.genre,
        art_style=body.art_style,
        aspect_ratio=body.aspect_ratio,
        episode_count=body.episode_count,
        status="draft",
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    logger.info(f"Created drama project {project.project_id} for user {current_user.id}")
    return ResponseBase(success=True, message="Project created", data=_to_dict(project))


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get project detail including full outline and storyboard data."""
    project = await _get_or_404(db, project_id, current_user.id)
    return ResponseBase(success=True, message="Project retrieved", data=_to_dict(project, include_data=True))


@router.put("/{project_id}")
async def update_project(
    project_id: str,
    body: UpdateProjectRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update project metadata and/or serialized state."""
    project = await _get_or_404(db, project_id, current_user.id)

    # Scalar fields
    for field in ("name", "description", "concept", "genre", "art_style",
                  "aspect_ratio", "episode_count", "status", "thumbnail_path",
                  "script_text", "source_mode", "style_lock"):
        val = getattr(body, field)
        if val is not None:
            setattr(project, field, val)

    # JSON fields
    if body.outline_data is not None:
        project.outline_data = json.dumps(body.outline_data, ensure_ascii=False)
    if body.storyboard_data is not None:
        project.storyboard_data = json.dumps(body.storyboard_data, ensure_ascii=False)
    if body.materials_data is not None:
        project.materials_data = json.dumps(body.materials_data, ensure_ascii=False)
    if body.episodes_data is not None:
        project.episodes_data = json.dumps(body.episodes_data, ensure_ascii=False)

    project.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(project)
    return ResponseBase(success=True, message="Project updated", data=_to_dict(project, include_data=True))


@router.post("/{project_id}/archive")
async def archive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """归档项目：设 archived_at，status 同步为 archived。"""
    project = await _get_or_404(db, project_id, current_user.id)
    project.archived_at = datetime.utcnow()
    project.status = "archived"
    project.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(project)
    return ResponseBase(success=True, message="Project archived", data=_to_dict(project))


@router.post("/{project_id}/unarchive")
async def unarchive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """取消归档：清 archived_at，status 回到 in_progress。"""
    project = await _get_or_404(db, project_id, current_user.id)
    project.archived_at = None
    if project.status == "archived":
        project.status = "in_progress"
    project.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(project)
    return ResponseBase(success=True, message="Project unarchived", data=_to_dict(project))


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a drama project."""
    project = await _get_or_404(db, project_id, current_user.id)
    project.deleted_at = datetime.utcnow()
    await db.commit()
    logger.info(f"Soft-deleted drama project {project_id} for user {current_user.id}")
    return ResponseBase(success=True, message="Project deleted", data={"project_id": project_id})


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_404(db: AsyncSession, project_id: str, user_id: int) -> DramaProject:
    result = await db.execute(
        select(DramaProject).where(
            DramaProject.project_id == project_id,
            DramaProject.user_id == user_id,
            DramaProject.deleted_at.is_(None),
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _signed_ref_asset_path(object_key: str, ttl_seconds: int = 7 * 24 * 3600) -> Optional[str]:
    """Build a relative, HMAC-signed streaming path for a drama reference image.

    Persisted shot images keep only their MinIO object key (e.g.
    users/{uid}/drama/{pid}/refs/foo.png). The only servable route for those keys
    is the token-guarded /api/v1/drama/ref-asset endpoint, so封面缩略图必须经它代理。
    Returns a relative path (frontend getResultUrl prepends the API base), so this
    does not depend on PUBLIC_BASE_URL being configured.
    """
    if not object_key or not object_key.startswith("users/") or "/drama/" not in object_key:
        return None
    import time, hmac, hashlib
    from urllib.parse import quote
    from app.config import settings
    exp = int(time.time()) + ttl_seconds
    msg = f"{object_key}:{exp}".encode("utf-8")
    sig = hmac.new(settings.SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return f"/api/v1/drama/ref-asset?key={quote(object_key, safe='')}&exp={exp}&sig={sig}"


def _extract_preview_images(episodes_json: str | None, limit: int = 4) -> list[str]:
    """Extract up to `limit` servable preview image URLs from serialized episodes_data.

    封面取自「分镜拆分选定的图片」，默认第一幅：与前端 effectiveShotImages 同序——
    每集先取该集全局应用图片（ep.assets 中 type==image 且 applyToAll!=False，即在整集
    素材库选定并应用到所有分镜的角色/参考图），再取各分镜自有的首张参考图。这样即使
    用户只在整集层选了角色图、未逐镜加图，封面也能正确显示选定图片。

    Video URLs are skipped (can't render in <img>). displayUrl is runtime-only and
    stripped on save, so it is normally absent here (kept only as a legacy fallback).
    """
    if not episodes_json:
        return []
    try:
        data = json.loads(episodes_json)
        images: list[str] = []
        seen: set[str] = set()

        def _add(item: dict) -> bool:
            """Append one image's servable URL; return True once limit reached."""
            key = item.get("key")
            url = _signed_ref_asset_path(key) or item.get("displayUrl")
            if not url:
                return False
            dedup = key or url
            if dedup in seen:
                return False
            seen.add(dedup)
            images.append(url)
            return len(images) >= limit

        for ep in data.get("episodes", []):
            # 1) 整集全局应用图片（图片1..G），与分镜里代入顺序一致
            for asset in (ep.get("assets") or []):
                if asset.get("type") == "image" and asset.get("applyToAll") is not False and asset.get("key"):
                    if _add(asset):
                        return images
            # 2) 各分镜自有的首张参考图
            for shot in ep.get("shots", []):
                first = (shot.get("images") or [{}])[0]
                if first.get("key") or first.get("displayUrl"):
                    if _add(first):
                        return images
        return images
    except Exception:
        return []



def _to_dict(project: DramaProject, include_data: bool = False) -> dict:
    d = {
        "project_id":    project.project_id,
        "name":          project.name,
        "description":   project.description,
        "concept":       project.concept,
        "genre":         project.genre,
        "art_style":     project.art_style,
        "aspect_ratio":  project.aspect_ratio,
        "episode_count": project.episode_count,
        "status":        project.status,
        "archived_at":   project.archived_at.isoformat() if getattr(project, "archived_at", None) else None,
        "thumbnail_path": project.thumbnail_path,
        "preview_images": _extract_preview_images(getattr(project, "episodes_data", None)),
        "created_at":    project.created_at.isoformat() if project.created_at else None,
        "updated_at":    project.updated_at.isoformat() if project.updated_at else None,
    }
    if include_data:
        try:
            d["episodes_data"] = json.loads(project.episodes_data) if getattr(project, "episodes_data", None) else None
        except Exception:
            d["episodes_data"] = None
    return d
