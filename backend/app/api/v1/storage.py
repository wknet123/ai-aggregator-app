"""
Storage Management API

Provides endpoints for browsing and managing files in MinIO:
  GET  /api/v1/storage/files         – list current user's stored files
  GET  /api/v1/storage/files/{key}   – get a fresh presigned download URL
  DELETE /api/v1/storage/files/{key} – delete a file from MinIO
  GET  /api/v1/storage/shared        – list shared/public files

All paths are scoped to the authenticated user's prefix in the bucket.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.storage import get_storage_service, StorageService
from app.schemas.response import ResponseBase
from app.config import settings
from typing import List, Optional
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


class FileInfo(BaseModel):
    key: str
    size: Optional[int] = None
    last_modified: Optional[str] = None
    url: Optional[str] = None


def _require_minio():
    if not settings.MINIO_ENABLED:
        raise HTTPException(status_code=503, detail="MinIO storage is not enabled")


@router.get("/files", response_model=ResponseBase[List[FileInfo]])
async def list_user_files(
    file_type: str = "images",   # "images", "videos", or "uploads"
    current_user: User = Depends(get_current_user),
):
    """List files stored under the current user's prefix in MinIO."""
    _require_minio()
    if file_type not in ("images", "videos", "uploads"):
        raise HTTPException(status_code=400, detail="file_type must be images, videos, or uploads")

    try:
        storage = get_storage_service()
        prefix = f"users/{current_user.id}/{file_type}/"
        objects = await storage.list_objects(prefix)
        items = [
            FileInfo(key=o["key"], size=o["size"], last_modified=o["last_modified"])
            for o in objects
        ]
        return ResponseBase(success=True, message=f"Found {len(items)} files", data=items)
    except Exception as exc:
        logger.error(f"Failed to list files for user {current_user.id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/files/{file_key:path}")
async def get_file_url(
    file_key: str,
    current_user: User = Depends(get_current_user),
):
    """Get a fresh presigned download URL for a file in the user's MinIO prefix."""
    _require_minio()
    # Ensure the key belongs to this user
    expected_prefix = f"users/{current_user.id}/"
    if not file_key.startswith(expected_prefix):
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        storage = get_storage_service()
        presigned = await storage.get_presigned_url(file_key)
        return RedirectResponse(url=presigned)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/files/{file_key:path}", response_model=ResponseBase)
async def delete_file(
    file_key: str,
    current_user: User = Depends(get_current_user),
):
    """Delete a file from MinIO (does not remove the DB task record)."""
    _require_minio()
    expected_prefix = f"users/{current_user.id}/"
    if not file_key.startswith(expected_prefix):
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        storage = get_storage_service()
        success = await storage.delete(file_key)
        if not success:
            raise HTTPException(status_code=500, detail="Delete failed")
        return ResponseBase(success=True, message="File deleted", data=None)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/shared", response_model=ResponseBase[List[FileInfo]])
async def list_shared_files(
    current_user: User = Depends(get_current_user),
):
    """List files in the shared/public prefix (community-shared works)."""
    _require_minio()
    try:
        storage = get_storage_service()
        objects = await storage.list_objects("shared/")
        items = [
            FileInfo(key=o["key"], size=o["size"], last_modified=o["last_modified"])
            for o in objects
        ]
        return ResponseBase(success=True, message=f"Found {len(items)} shared files", data=items)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
