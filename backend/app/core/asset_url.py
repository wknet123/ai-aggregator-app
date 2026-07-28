"""Signed, gateway-reachable public URLs for user assets.

External AI gateways (HappyHorse / Seedance / Kling) cannot reach the internal
MinIO host (``minio:9000``) and presigned URLs carry that internal host, so we
expose assets through a public backend origin (``PUBLIC_BASE_URL`` → nginx →
backend → MinIO stream) guarded by an HMAC signature + expiry, not an open proxy.

The serving endpoint is ``GET /api/v1/studio/asset`` (see media_studio), which
only releases keys under ``users/.../uploads/``. Both the signer here and that
endpoint key the HMAC on ``SECRET_KEY`` so the signatures match.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Optional
from urllib.parse import quote

from app.config import settings

logger = logging.getLogger(__name__)


def sign_asset(object_key: str, exp: int) -> str:
    """HMAC-SHA256 over ``key:exp``, keyed by the app secret."""
    msg = f"{object_key}:{exp}".encode("utf-8")
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def public_asset_url(object_key: str, ttl_seconds: int = 6 * 3600) -> Optional[str]:
    """Build a signed, gateway-reachable URL for ``object_key`` or None.

    Returns None (with a warning) when ``PUBLIC_BASE_URL`` is unset — without a
    public origin an external gateway has no way to fetch the asset.
    """
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    if not base:
        logger.warning("PUBLIC_BASE_URL 未配置，无法生成网关可达的素材 URL")
        return None
    exp = int(time.time()) + ttl_seconds
    sig = sign_asset(object_key, exp)
    return f"{base}/api/v1/studio/asset?key={quote(object_key, safe='')}&exp={exp}&sig={sig}"
