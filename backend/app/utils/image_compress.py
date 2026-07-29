"""Downscale + re-encode oversized reference images before they leave for a gateway.

External AI gateways (HappyHorse / Seedance / Kling) fetch reference frames over our
public origin, which is bandwidth-limited (~20KB/s observed). A multi-MB reference then
exceeds the gateway's download window and surfaces as a generic
``Failed to download <url> ... InvalidParameter`` — the task is accepted but fails at the
gateway's own download step. Shrinking the reference at upload time keeps it fetchable.

Every endpoint that stores a user reference image under ``users/.../uploads/`` should run
``compress_image_bytes`` first so the fix holds regardless of which upload path is used.
"""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Tuple

logger = logging.getLogger(__name__)

MAX_DIM = 1600      # px, longest side; refs beyond this add no quality for gen models
JPEG_QUALITY = 85


def compress_image_bytes(contents: bytes, ext: str) -> Tuple[bytes, str]:
    """Return ``(bytes, ext)`` for a size-reduced image, or the original on any failure.

    Downscales the longest side to ``MAX_DIM`` and re-encodes (alpha → PNG, else JPEG).
    ``ext`` is normalised to ``.png`` / ``.jpg`` to match the re-encoded format. Falls back
    to the original bytes+ext when Pillow errors or the result isn't actually smaller.
    """
    try:
        from PIL import Image, ImageOps

        img = Image.open(BytesIO(contents))
        img = ImageOps.exif_transpose(img)  # honor orientation before EXIF is dropped
        has_alpha = img.mode in ("RGBA", "LA") or (
            img.mode == "P" and "transparency" in img.info
        )

        w, h = img.size
        scale = MAX_DIM / max(w, h)
        if scale < 1:
            img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)

        buf = BytesIO()
        if has_alpha:
            img.convert("RGBA").save(buf, format="PNG", optimize=True)
            new_ext = ".png"
        else:
            img.convert("RGB").save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            new_ext = ".jpg"
        out = buf.getvalue()
        if len(out) < len(contents):
            logger.info("compressed ref image %d→%d bytes", len(contents), len(out))
            return out, new_ext
    except Exception as e:  # noqa: BLE001
        logger.warning("image compress failed, using original: %s", e)
    return contents, ext
