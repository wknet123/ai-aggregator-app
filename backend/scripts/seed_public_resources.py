#!/usr/bin/env python
"""
Seed script to add public sample resources to the database.
Scans the storage/public directory and creates database entries for images and videos.
"""

import asyncio
import os
import uuid
import sys
from pathlib import Path
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.session import AsyncSessionLocal
from app.models.generation_task import GenerationTask
from app.config import settings

# System user ID for public sample resources
SYSTEM_USER_ID = 1  # Assuming admin user ID is 1
SYSTEM_TENANT_ID = 1  # Assuming default tenant ID is 1

SUPPORTED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
SUPPORTED_VIDEO_EXTENSIONS = {'.mp4'}


async def seed_public_resources():
    """Scan public directory and create database entries for resources."""
    public_path = Path(settings.STORAGE_BASE_PATH) / "public"
    images_path = public_path / "images"
    videos_path = public_path / "videos"

    async with AsyncSessionLocal() as db:
        added_count = 0

        # Process images
        if images_path.exists():
            for file in images_path.iterdir():
                if file.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS:
                    task_id = str(uuid.uuid4())
                    prompt = f"Sample image: {file.stem}"

                    task = GenerationTask(
                        task_id=task_id,
                        user_id=SYSTEM_USER_ID,
                        tenant_id=SYSTEM_TENANT_ID,
                        model_id="sample",
                        task_type="image",
                        prompt=prompt,
                        parameters="{}",
                        status="completed",
                        progress=100,
                        result_path=str(file.absolute()),
                        result_url=f"/api/v1/google/task/{task_id}/file",
                        is_public=1,
                        is_favorite=0,
                        created_at=datetime.utcnow()
                    )
                    db.add(task)
                    added_count += 1
                    print(f"Added image: {file.name} -> task_id: {task_id}")

        # Process videos
        if videos_path.exists():
            for file in videos_path.iterdir():
                if file.suffix.lower() in SUPPORTED_VIDEO_EXTENSIONS:
                    task_id = str(uuid.uuid4())
                    prompt = f"Sample video: {file.stem}"

                    task = GenerationTask(
                        task_id=task_id,
                        user_id=SYSTEM_USER_ID,
                        tenant_id=SYSTEM_TENANT_ID,
                        model_id="sample",
                        task_type="video",
                        prompt=prompt,
                        parameters="{}",
                        status="completed",
                        progress=100,
                        result_path=str(file.absolute()),
                        result_url=f"/api/v1/google/task/{task_id}/file",
                        is_public=1,
                        is_favorite=0,
                        created_at=datetime.utcnow()
                    )
                    db.add(task)
                    added_count += 1
                    print(f"Added video: {file.name} -> task_id: {task_id}")

        await db.commit()
        print(f"\nTotal resources added: {added_count}")


if __name__ == "__main__":
    print("Seeding public resources...")
    print(f"Looking for resources in: {Path(settings.STORAGE_BASE_PATH) / 'public'}")
    asyncio.run(seed_public_resources())
    print("Done!")
