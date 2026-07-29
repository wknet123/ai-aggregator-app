"""
Character Identity API – upload reference images and manage character assets.

POST   /                 – create character + upload 1-3 reference images
GET    /                 – list characters for current user
GET    /{character_id}   – get character detail
PUT    /{character_id}   – update name / prompt_description
DELETE /{character_id}   – soft-delete
GET    /{character_id}/images/{image_id}/file  – stream an uploaded image
"""
import hashlib
import json
import random
import uuid
import asyncio
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query
from fastapi.responses import Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.character import Character, CharacterImage
from app.models.user import User
from app.schemas.response import ResponseBase
from app.services.storage import get_storage_service, StorageService
from app.utils.image_compress import compress_image_bytes

router = APIRouter()


# ── helpers ──────────────────────────────────────────────────────────────────

def _simulate_feature_vector(image_data_list: list[bytes]) -> list[float]:
    """
    Simulate IP-Adapter behaviour: hash the image bytes to produce a
    deterministic 128-dim 'feature vector'.  In production this would call a
    real embedding model.
    """
    combined = b"".join(image_data_list)
    digest = hashlib.sha512(combined).hexdigest()
    # Expand the hex digest into 128 float values in [-1, 1]
    rng = random.Random(digest)
    return [round(rng.uniform(-1.0, 1.0), 4) for _ in range(128)]


def _fingerprint_from_vector(vec: list[float]) -> str:
    """Derive a short hex fingerprint from the feature vector for visual display."""
    raw = json.dumps(vec).encode()
    return hashlib.md5(raw).hexdigest()[:16].upper()


def _char_to_dict(c: Character) -> dict:
    return {
        "id": c.id,
        "character_id": c.character_id,
        "name": c.name,
        "prompt_description": c.prompt_description,
        "profile_json": json.loads(c.profile_json) if c.profile_json else None,
        "feature_vector": json.loads(c.feature_vector) if c.feature_vector else None,
        "fingerprint": c.fingerprint,
        "status": c.status,
        "avatar_path": c.avatar_path,
        "images": [
            {
                "id": img.id,
                "image_path": img.image_path,
                "sort_order": img.sort_order,
            }
            for img in (c.images or [])
        ],
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── routes ───────────────────────────────────────────────────────────────────

@router.post("", response_model=ResponseBase)
async def create_character(
    name: str = Form(...),
    prompt_description: str = Form(""),
    profile_json: Optional[str] = Form(None),
    images: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a character with 1-3 reference images."""
    if len(images) < 1 or len(images) > 3:
        raise HTTPException(status_code=400, detail="请上传 1-3 张参考图片")

    # Validate file types
    allowed = {"image/png", "image/jpeg", "image/webp"}
    for img in images:
        if img.content_type not in allowed:
            raise HTTPException(status_code=400, detail=f"不支持的图片格式: {img.content_type}")

    char_uuid = str(uuid.uuid4())
    storage = get_storage_service()

    # Read all image bytes (needed for feature extraction + upload)
    image_bytes_list: list[bytes] = []
    for img in images:
        data = await img.read()
        image_bytes_list.append(data)

    # Simulate IP-Adapter feature extraction
    feature_vec = _simulate_feature_vector(image_bytes_list)
    fingerprint = _fingerprint_from_vector(feature_vec)

    # Upload images to MinIO
    image_records: list[CharacterImage] = []
    avatar_key: Optional[str] = None
    for idx, (img, data) in enumerate(zip(images, image_bytes_list)):
        ext = img.filename.rsplit(".", 1)[-1] if img.filename and "." in img.filename else "png"
        # Shrink oversized refs so the gateway can fetch them over the slow public origin.
        data, norm_ext = await asyncio.to_thread(compress_image_bytes, data, f".{ext}")
        ext = norm_ext.lstrip(".")
        object_key = f"users/{current_user.id}/characters/{char_uuid}/ref_{idx}.{ext}"
        content_type = StorageService.content_type_for(f"file.{ext}")
        await storage.upload_bytes(data, object_key, content_type)
        image_records.append(CharacterImage(image_path=object_key, sort_order=idx))
        if idx == 0:
            avatar_key = object_key

    # Create DB record
    # Validate profile_json if provided
    validated_profile = None
    if profile_json:
        try:
            json.loads(profile_json)
            validated_profile = profile_json
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="profile_json must be valid JSON")

    character = Character(
        character_id=char_uuid,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        name=name,
        prompt_description=prompt_description,
        profile_json=validated_profile,
        feature_vector=json.dumps(feature_vec),
        fingerprint=fingerprint,
        status="active",
        avatar_path=avatar_key,
    )
    character.images = image_records

    db.add(character)
    await db.commit()
    await db.refresh(character)

    return ResponseBase(success=True, message="角色创建成功", data=_char_to_dict(character))


@router.get("", response_model=ResponseBase)
async def list_characters(
    q: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List characters for the current user."""
    base = select(Character).where(
        Character.user_id == current_user.id,
        Character.deleted_at.is_(None),
    )
    if q:
        base = base.where(Character.name.ilike(f"%{q}%"))

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = base.order_by(Character.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    chars = result.scalars().all()

    return ResponseBase(
        success=True,
        data={
            "items": [_char_to_dict(c) for c in chars],
            "total": total,
            "limit": limit,
            "offset": offset,
        },
    )


@router.get("/{character_id}", response_model=ResponseBase)
async def get_character(
    character_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single character by character_id."""
    result = await db.execute(
        select(Character).where(
            Character.character_id == character_id,
            Character.user_id == current_user.id,
            Character.deleted_at.is_(None),
        )
    )
    char = result.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="角色不存在")
    return ResponseBase(success=True, data=_char_to_dict(char))


@router.put("/{character_id}", response_model=ResponseBase)
async def update_character(
    character_id: str,
    name: Optional[str] = Form(None),
    prompt_description: Optional[str] = Form(None),
    profile_json: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update character name or prompt description."""
    result = await db.execute(
        select(Character).where(
            Character.character_id == character_id,
            Character.user_id == current_user.id,
            Character.deleted_at.is_(None),
        )
    )
    char = result.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="角色不存在")

    if name is not None:
        char.name = name
    if prompt_description is not None:
        char.prompt_description = prompt_description
    if profile_json is not None:
        try:
            json.loads(profile_json)
            char.profile_json = profile_json
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="profile_json must be valid JSON")

    await db.commit()
    await db.refresh(char)
    return ResponseBase(success=True, message="角色已更新", data=_char_to_dict(char))


@router.delete("/{character_id}", response_model=ResponseBase)
async def delete_character(
    character_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a character."""
    from datetime import datetime

    result = await db.execute(
        select(Character).where(
            Character.character_id == character_id,
            Character.user_id == current_user.id,
            Character.deleted_at.is_(None),
        )
    )
    char = result.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="角色不存在")

    char.deleted_at = datetime.utcnow()
    await db.commit()
    return ResponseBase(success=True, message="角色已删除")


@router.get("/{character_id}/images/{image_id}/file")
async def get_character_image_file(
    character_id: str,
    image_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Stream a character reference image from MinIO.

    No auth required — the character_id UUID is unguessable and acts as a
    capability token, same pattern as flux task file endpoints.  This allows
    plain <img src="..."> tags to work without Bearer headers.
    """
    result = await db.execute(
        select(CharacterImage).join(Character).where(
            Character.character_id == character_id,
            CharacterImage.id == image_id,
            Character.deleted_at.is_(None),
        )
    )
    img = result.scalar_one_or_none()
    if not img:
        raise HTTPException(status_code=404, detail="图片不存在")

    storage = get_storage_service()
    data, content_type = await storage.get_object_bytes(img.image_path)
    return Response(content=data, media_type=content_type)
