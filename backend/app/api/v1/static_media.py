"""
Static media proxy — serves cached public assets from MinIO.
No authentication required; files live under public/static/ in the bucket.
Responses are heavily cached (1 year, immutable) since filenames are content hashes.
"""
import logging
from pathlib import PurePosixPath

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services.storage import get_storage_service

logger = logging.getLogger(__name__)
router = APIRouter()

_CONTENT_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
}


@router.get("/{path:path}")
async def serve_static_media(path: str) -> Response:
    """
    Stream a public static asset from MinIO.
    Path must be a flat filename like 'abc123def456.jpg' — no directory traversal allowed.
    """
    # Guard: only allow flat filenames (no directory traversal)
    clean = PurePosixPath(path).name
    if not clean or clean != path or ".." in path:
        raise HTTPException(status_code=400, detail="Invalid path")

    ext = PurePosixPath(clean).suffix.lower()
    content_type = _CONTENT_TYPES.get(ext, "application/octet-stream")
    minio_key = f"public/static/{clean}"

    try:
        storage = get_storage_service()
        data, _ = await storage.get_object_bytes(minio_key)
        return Response(
            content=data,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )
    except Exception as exc:
        logger.debug("Static media not found: %s (%s)", minio_key, exc)
        raise HTTPException(status_code=404, detail="Media not found")
