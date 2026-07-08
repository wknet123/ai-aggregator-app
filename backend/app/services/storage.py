"""
MinIO Object Storage Service

Provides an async wrapper around the MinIO Python SDK.

Bucket layout inside `ai-aggregator` (single bucket):
  public/images/{filename}          – showcase / sample images (public)
  public/videos/{filename}          – showcase / sample videos (public)
  users/{user_id}/images/{filename} – per-user generated images
  users/{user_id}/videos/{filename} – per-user generated videos
  users/{user_id}/uploads/{filename}– per-user uploaded source files
  shared/{filename}                 – community-shared / public works

result_path convention:
  - MinIO object:   "users/123/images/abc.png"   (no leading slash)
  - Local file:     "/app/storage/123/images/abc.png"  (starts with /)
                    "storage/123/images/abc.png"        (relative path)
Use `StorageService.is_minio_key()` to distinguish.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)


class StorageService:
    """Async MinIO storage service."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        secure: bool = False,
        presign_expires: int = 604800,
        public_endpoint: Optional[str] = None,
    ):
        from minio import Minio

        self._client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
        )
        self._bucket = bucket
        self._presign_expires = presign_expires
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ── internal helpers ───────────────────────────────────────────────────────

    def _get_loop(self) -> asyncio.AbstractEventLoop:
        return asyncio.get_event_loop()

    async def _run(self, fn, *args):
        loop = self._get_loop()
        return await loop.run_in_executor(None, fn, *args)

    # ── bucket management ──────────────────────────────────────────────────────

    def _ensure_bucket_sync(self):
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)
            logger.info(f"Created MinIO bucket: {self._bucket}")
        else:
            logger.info(f"MinIO bucket already exists: {self._bucket}")

    async def ensure_bucket(self):
        """Create the bucket if it does not already exist."""
        await self._run(self._ensure_bucket_sync)

    # ── upload ─────────────────────────────────────────────────────────────────

    def _upload_bytes_sync(self, data: bytes, object_key: str, content_type: str):
        self._client.put_object(
            self._bucket,
            object_key,
            BytesIO(data),
            length=len(data),
            content_type=content_type,
        )

    async def upload_bytes(
        self, data: bytes, object_key: str, content_type: str
    ) -> str:
        """Upload raw bytes and return the object key."""
        await self._run(self._upload_bytes_sync, data, object_key, content_type)
        return object_key

    def _upload_file_sync(self, local_path: str, object_key: str, content_type: str):
        self._client.fput_object(
            self._bucket, object_key, local_path, content_type=content_type
        )

    async def upload_file(
        self, local_path: Path, object_key: str, content_type: str
    ) -> str:
        """Upload a local file and return the object key."""
        await self._run(self._upload_file_sync, str(local_path), object_key, content_type)
        return object_key

    async def upload_and_get_url(
        self,
        local_path: Path,
        object_key: str,
        content_type: str,
        expires: Optional[int] = None,
    ) -> str:
        """Upload a local file and return a presigned URL."""
        await self.upload_file(local_path, object_key, content_type)
        return await self.get_presigned_url(object_key, expires)

    # ── presigned URL ──────────────────────────────────────────────────────────

    def _presigned_url_sync(self, object_key: str, expires_seconds: int) -> str:
        return self._client.presigned_get_object(
            self._bucket,
            object_key,
            expires=timedelta(seconds=expires_seconds),
        )

    async def get_presigned_url(
        self, object_key: str, expires: Optional[int] = None
    ) -> str:
        """Return a presigned GET URL valid for `expires` seconds."""
        secs = expires if expires is not None else self._presign_expires
        return await self._run(self._presigned_url_sync, object_key, secs)

    # ── stream / download ──────────────────────────────────────────────────────

    def _get_object_sync(self, object_key: str):
        """Return (data_bytes, content_type) for the given key."""
        response = self._client.get_object(self._bucket, object_key)
        try:
            data = response.read()
            content_type = response.headers.get("content-type", "application/octet-stream")
        finally:
            response.close()
            response.release_conn()
        return data, content_type

    async def get_object_bytes(self, object_key: str):
        """Return (data_bytes, content_type) for the given key."""
        return await self._run(self._get_object_sync, object_key)

    # ── delete ─────────────────────────────────────────────────────────────────

    def _delete_sync(self, object_key: str):
        self._client.remove_object(self._bucket, object_key)

    async def delete(self, object_key: str) -> bool:
        """Delete an object. Returns True on success."""
        try:
            await self._run(self._delete_sync, object_key)
            return True
        except Exception as exc:
            logger.error(f"MinIO delete failed for {object_key!r}: {exc}")
            return False

    # ── list ───────────────────────────────────────────────────────────────────

    def _list_sync(self, prefix: str, recursive: bool) -> List[dict]:
        objects = self._client.list_objects(
            self._bucket, prefix=prefix, recursive=recursive
        )
        return [
            {
                "key": obj.object_name,
                "size": obj.size,
                "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
            }
            for obj in objects
        ]

    async def list_objects(self, prefix: str, recursive: bool = True) -> List[dict]:
        """List objects under `prefix`. Returns list of dicts with key/size/last_modified."""
        return await self._run(self._list_sync, prefix, recursive)

    # ── object-key helpers ─────────────────────────────────────────────────────

    def user_image_key(self, user_id: int, filename: str) -> str:
        return f"users/{user_id}/images/{filename}"

    def user_video_key(self, user_id: int, filename: str) -> str:
        return f"users/{user_id}/videos/{filename}"

    def user_upload_key(self, user_id: int, filename: str) -> str:
        return f"users/{user_id}/uploads/{filename}"

    def drama_image_key(self, user_id: int, project_id: str, filename: str) -> str:
        return f"users/{user_id}/drama/{project_id}/images/{filename}"

    def drama_video_key(self, user_id: int, project_id: str, filename: str) -> str:
        return f"users/{user_id}/drama/{project_id}/videos/{filename}"

    def drama_shot_key(self, user_id: int, project_id: str, filename: str) -> str:
        """Per-shot generated video (剧创式逐分镜)."""
        return f"users/{user_id}/drama/{project_id}/shots/{filename}"

    def drama_audio_key(self, user_id: int, project_id: str, filename: str) -> str:
        """Reference / dubbing audio for a shot."""
        return f"users/{user_id}/drama/{project_id}/audio/{filename}"

    def drama_ref_key(self, user_id: int, project_id: str, filename: str) -> str:
        """Multimodal reference media (image / video) uploaded for a shot."""
        return f"users/{user_id}/drama/{project_id}/refs/{filename}"

    def drama_final_key(self, user_id: int, project_id: str, filename: str) -> str:
        """Final assembled episode video (ffmpeg concat output)."""
        return f"users/{user_id}/drama/{project_id}/final/{filename}"

    def project_asset_key(self, user_id: int, project_id: str, asset_id: str, filename: str) -> str:
        """Per-project 角色/场景/道具 configuration image (主图/副图)."""
        return f"users/{user_id}/drama/{project_id}/assets/{asset_id}/{filename}"

    def public_key(self, subtype: str, filename: str) -> str:
        """subtype: 'images' or 'videos'"""
        return f"public/{subtype}/{filename}"

    def ai_character_key(self, category_path: str, character_key: str, filename: str) -> str:
        """全局 AI 角色库图片（公共只读）：public/ai_characters/{分类路径}/{character_key}/{filename}"""
        return f"public/ai_characters/{category_path}/{character_key}/{filename}"

    def agent_artifact_key(self, user_id: int, run_id: str, filename: str) -> str:
        """自定义智能体 Run 的产物：users/{uid}/agents/{run_id}/{filename}"""
        return f"users/{user_id}/agents/{run_id}/{filename}"

    def shared_key(self, filename: str) -> str:
        return f"shared/{filename}"

    # ── path-type detection ────────────────────────────────────────────────────

    @staticmethod
    def is_minio_key(path_str: str) -> bool:
        """Return True if path_str is a MinIO object key rather than a local path."""
        if not path_str:
            return False
        if path_str.startswith(("/", "storage/", "./", "..")):
            return False
        return path_str.startswith(("users/", "public/", "shared/"))

    @staticmethod
    def content_type_for(filename: str) -> str:
        """Guess MIME type from filename extension."""
        ext = Path(filename).suffix.lower()
        return {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".webm": "video/webm",
            ".avi": "video/x-msvideo",
        }.get(ext, "application/octet-stream")


# ── singleton ──────────────────────────────────────────────────────────────────

_storage_service: Optional[StorageService] = None


def get_storage_service() -> StorageService:
    """Return the global StorageService instance (initialised once in main.py)."""
    global _storage_service
    if _storage_service is None:
        from app.config import settings

        _storage_service = StorageService(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            bucket=settings.MINIO_BUCKET,
            secure=settings.MINIO_SECURE,
            presign_expires=settings.MINIO_PRESIGN_EXPIRES,
            public_endpoint=settings.MINIO_PUBLIC_ENDPOINT,
        )
    return _storage_service
