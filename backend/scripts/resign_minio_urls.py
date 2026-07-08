#!/usr/bin/env python3
"""
Re-generate presigned URLs for all MinIO-backed tasks.

Run inside backend container:
  docker cp backend/scripts/resign_minio_urls.py ai-aggregator-backend:/app/resign_minio_urls.py
  docker exec ai-aggregator-backend python3 /app/resign_minio_urls.py

This script connects to MinIO using the internal endpoint (minio:9000) and
rewrites the resulting presigned URL hostname to MINIO_PUBLIC_ENDPOINT so
that the URLs are accessible from a browser.
MinIO must be configured with MINIO_SERVER_URL=http://<MINIO_PUBLIC_ENDPOINT>
to verify signatures against the public hostname.
"""
import os
import re
from datetime import timedelta
from urllib.parse import unquote

import pymysql
from minio import Minio

# ── Config ─────────────────────────────────────────────────────────────────────
MINIO_ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "minio:9000")   # internal
PUBLIC_ENDPOINT  = os.getenv("MINIO_PUBLIC_ENDPOINT", "")         # public host:port
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET     = os.getenv("MINIO_BUCKET",     "ai-aggregator")
MINIO_SECURE     = os.getenv("MINIO_SECURE",     "false").lower() == "true"
PRESIGN_DAYS     = int(os.getenv("PRESIGN_DAYS", "7"))

_db_url = os.getenv("DATABASE_URL", "")
if _db_url:
    m = re.match(r"mysql\+\w+://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)", _db_url)
    if m:
        DB_USER = unquote(m.group(1))
        DB_PASS = unquote(m.group(2))
        DB_HOST = m.group(3)
        DB_PORT = int(m.group(4))
        DB_NAME = m.group(5)
    else:
        DB_USER, DB_PASS, DB_HOST, DB_PORT, DB_NAME = "ai_user", "Ai@User2024", "db", 3306, "ai_aggregator"
else:
    DB_USER = unquote(os.getenv("DB_USER", "ai_user"))
    DB_PASS = unquote(os.getenv("DB_PASSWORD", "Ai@User2024"))
    DB_HOST = os.getenv("DB_HOST", "db")
    DB_PORT = int(os.getenv("DB_PORT", "3306"))
    DB_NAME = os.getenv("DB_NAME", "ai_aggregator")

# ── URL rewrite helpers ────────────────────────────────────────────────────────
scheme = "https" if MINIO_SECURE else "http"
internal_prefix = f"{scheme}://{MINIO_ENDPOINT}"
public_prefix   = f"{scheme}://{PUBLIC_ENDPOINT}" if PUBLIC_ENDPOINT else None

def rewrite_url(url: str) -> str:
    if public_prefix and url.startswith(internal_prefix):
        return public_prefix + url[len(internal_prefix):]
    return url

# ── Connect ────────────────────────────────────────────────────────────────────
print(f"MinIO internal endpoint : {MINIO_ENDPOINT}")
print(f"MinIO public  endpoint  : {PUBLIC_ENDPOINT or '(same as internal)'}")
minio = Minio(MINIO_ENDPOINT, access_key=MINIO_ACCESS_KEY, secret_key=MINIO_SECRET_KEY, secure=MINIO_SECURE)

print(f"MySQL: {DB_HOST}:{DB_PORT}/{DB_NAME}")
db = pymysql.connect(host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS,
                     database=DB_NAME, charset="utf8mb4", autocommit=False)
cursor = db.cursor(pymysql.cursors.DictCursor)

# ── Fetch tasks with MinIO keys ────────────────────────────────────────────────
cursor.execute("""
    SELECT task_id, result_path FROM generation_tasks
    WHERE status = 'completed'
      AND result_path IS NOT NULL
      AND (result_path LIKE 'users/%' OR result_path LIKE 'public/%' OR result_path LIKE 'shared/%')
""")
tasks = cursor.fetchall()
print(f"Found {len(tasks)} tasks with MinIO keys\n")

updated = 0
errors  = 0

for t in tasks:
    key = t["result_path"]
    try:
        raw_url = minio.presigned_get_object(MINIO_BUCKET, key, expires=timedelta(days=PRESIGN_DAYS))
        url = rewrite_url(raw_url)
        cursor.execute("UPDATE generation_tasks SET result_url=%s WHERE task_id=%s", (url, t["task_id"]))
        print(f"  ✓ {t['task_id'][:8]}…  {url[:80]}")
        updated += 1
    except Exception as e:
        print(f"  ✗ {t['task_id'][:8]}…  {key}: {e}")
        errors += 1

db.commit()
cursor.close()
db.close()

print(f"\nDone — updated: {updated}, errors: {errors}")
