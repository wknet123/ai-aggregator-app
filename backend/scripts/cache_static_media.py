#!/usr/bin/env python3
"""
Cache all remote media assets (images/videos) to local MinIO storage.

Usage:
    cd /home/juhe0092/ai-aggregator-code/backend/scripts
    /tmp/media-cache-env/bin/python3 cache_static_media.py

What it does:
1. Collects every remote media URL hardcoded in the frontend source files
2. Downloads each file (skip if already in MinIO)
3. Uploads to MinIO under  public/static/{sha256[:12]}.{ext}
4. Patches all frontend source files: replaces remote URLs with /api/v1/static/{filename}
5. Writes backend/scripts/static_media_manifest.json for reference
"""

import hashlib
import json
import mimetypes
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, unquote

import requests
from minio import Minio
from minio.error import S3Error

# ── Config ────────────────────────────────────────────────────────────────────
MINIO_ENDPOINT  = "localhost:9000"
MINIO_ACCESS    = "minioadmin"
MINIO_SECRET    = "minioadmin"
MINIO_BUCKET    = "ai-aggregator"
MINIO_PREFIX    = "public/static"
FRONTEND_BASE   = "/api/v1/static"

# Repo root is two levels up from backend/scripts/ (scripts → backend → repo root)
REPO_ROOT       = Path(__file__).resolve().parents[2]
FRONTEND_SRC    = REPO_ROOT / "frontend" / "src"
MANIFEST_PATH   = Path(__file__).parent / "static_media_manifest.json"

# Extensions the regex must match
MEDIA_EXTS = {"png", "jpg", "jpeg", "mp4", "webp", "gif", "webm"}

EXT_CONTENT_TYPES = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".gif":  "image/gif",
    ".mp4":  "video/mp4",
    ".webm": "video/webm",
}

DOWNLOAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
}

# ── URL collection ─────────────────────────────────────────────────────────────

# Pattern 1: URLs ending with a known extension (possibly followed by query params)
_RE_EXT = re.compile(
    r"https?://[^\s'\"`,)>\]]+?\.(" + "|".join(MEDIA_EXTS) + r")(?:[?#][^\s'\"`,)>\]]*)?",
    re.IGNORECASE,
)

# Pattern 2: Unsplash CDN URLs (no explicit extension, serve JPEG content)
_RE_UNSPLASH = re.compile(
    r"https://images\.unsplash\.com/photo-[a-zA-Z0-9_\-]+(?:\?[^\s'\"`,)>\]]*)?",
)

# Pattern 3: picsum.photos URLs
_RE_PICSUM = re.compile(
    r"https://picsum\.photos/seed/[^\s'\"`,)>\]]+",
)


def collect_urls_from_files() -> dict[str, str]:
    """Scan frontend src for all remote media URLs. Returns {url: filename}."""
    found: dict[str, str] = {}

    def add(url: str) -> None:
        url = url.rstrip("?&,")
        if url not in found:
            found[url] = url_to_filename(url)

    for fpath in list(FRONTEND_SRC.rglob("*.ts")) + list(FRONTEND_SRC.rglob("*.tsx")):
        text = fpath.read_text(encoding="utf-8")
        for m in _RE_EXT.finditer(text):
            add(m.group(0))
        for m in _RE_UNSPLASH.finditer(text):
            add(m.group(0))
        for m in _RE_PICSUM.finditer(text):
            add(m.group(0))

    return found


# ── Filename helpers ────────────────────────────────────────────────────────────

def _ext_from_url(url: str) -> str:
    parsed = urlparse(url)
    path   = unquote(parsed.path)
    ext    = Path(path).suffix.lower()
    if ext in EXT_CONTENT_TYPES:
        return ext
    # Unsplash / picsum → always JPEG
    if "unsplash.com" in url or "picsum.photos" in url:
        return ".jpg"
    guessed, _ = mimetypes.guess_type(path)
    if guessed:
        return mimetypes.guess_extension(guessed) or ".bin"
    return ".bin"


def url_to_filename(url: str) -> str:
    """Stable filename: sha256(url)[:12] + extension."""
    ext    = _ext_from_url(url)
    digest = hashlib.sha256(url.encode()).hexdigest()[:12]
    return f"{digest}{ext}"


# ── MinIO helpers ────────────────────────────────────────────────────────────────

def object_exists(client: Minio, key: str) -> bool:
    try:
        client.stat_object(MINIO_BUCKET, key)
        return True
    except S3Error:
        return False


def upload_to_minio(client: Minio, key: str, data: bytes, content_type: str) -> None:
    from io import BytesIO
    client.put_object(
        MINIO_BUCKET, key, BytesIO(data), length=len(data), content_type=content_type,
    )


# ── Download ─────────────────────────────────────────────────────────────────────

def download_file(url: str, timeout: int = 60) -> bytes:
    resp = requests.get(url, headers=DOWNLOAD_HEADERS, timeout=timeout, stream=True)
    resp.raise_for_status()
    return resp.content


# ── Frontend patching ─────────────────────────────────────────────────────────────

def patch_frontend_files(mapping: dict[str, str]) -> None:
    """Replace remote URLs in all frontend source files with /api/v1/static/{filename}."""
    sorted_pairs = sorted(mapping.items(), key=lambda x: len(x[0]), reverse=True)
    ts_files  = list(FRONTEND_SRC.rglob("*.ts"))
    tsx_files = list(FRONTEND_SRC.rglob("*.tsx"))

    for fpath in ts_files + tsx_files:
        original = fpath.read_text(encoding="utf-8")
        patched  = original
        for url, filename in sorted_pairs:
            local_url = f"{FRONTEND_BASE}/{filename}"
            patched = patched.replace(url, local_url)
        if patched != original:
            fpath.write_text(patched, encoding="utf-8")
            print(f"  patched {fpath.relative_to(FRONTEND_SRC.parent.parent)}")


# ── Main ──────────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("  Static media cache migration")
    print("=" * 60)

    client = Minio(MINIO_ENDPOINT, access_key=MINIO_ACCESS, secret_key=MINIO_SECRET, secure=False)
    if not client.bucket_exists(MINIO_BUCKET):
        print(f"[ERROR] Bucket '{MINIO_BUCKET}' not found. Is MinIO running?")
        sys.exit(1)
    print(f"Connected to MinIO at {MINIO_ENDPOINT}, bucket={MINIO_BUCKET}")

    url_map = collect_urls_from_files()
    print(f"\nFound {len(url_map)} unique remote media URLs\n")

    results: dict[str, str] = {}
    mapping: dict[str, str] = {}

    for i, (url, filename) in enumerate(url_map.items(), 1):
        minio_key    = f"{MINIO_PREFIX}/{filename}"
        local_url    = f"{FRONTEND_BASE}/{filename}"
        ext          = Path(filename).suffix.lower()
        content_type = EXT_CONTENT_TYPES.get(ext, "image/jpeg")

        short_url = url[:80] + ("…" if len(url) > 80 else "")
        print(f"[{i:3}/{len(url_map)}] {filename}")
        print(f"         {short_url}")

        if object_exists(client, minio_key):
            print(f"         → already cached, skip")
            results[url] = local_url
            mapping[url] = filename
            continue

        try:
            data = download_file(url)
        except Exception as exc:
            print(f"         ✗ download failed: {exc}")
            results[url] = "FAILED"
            continue

        try:
            upload_to_minio(client, minio_key, data, content_type)
            print(f"         ✓ uploaded {len(data):,} bytes")
            results[url] = local_url
            mapping[url] = filename
        except Exception as exc:
            print(f"         ✗ upload failed: {exc}")
            results[url] = "FAILED"

        time.sleep(0.2)

    # Save manifest
    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "minio_bucket": MINIO_BUCKET,
        "minio_prefix": MINIO_PREFIX,
        "frontend_prefix": FRONTEND_BASE,
        "files": {
            url: {"filename": mapping.get(url, ""), "local_url": results.get(url, "FAILED")}
            for url in url_map
        },
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"\nManifest saved → {MANIFEST_PATH}")

    if mapping:
        print("\nPatching frontend source files...")
        patch_frontend_files(mapping)

    ok     = sum(1 for v in results.values() if v != "FAILED")
    failed = sum(1 for v in results.values() if v == "FAILED")
    print(f"\n{'=' * 60}")
    print(f"  Done: {ok} cached, {failed} failed")
    print(f"  Next: rebuild backend + frontend containers")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
