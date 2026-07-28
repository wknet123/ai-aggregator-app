"""
Image & video client — now backed by the AI aggregation gateway.

Kept the historical class name/method signatures so existing routers keep
working, but the implementation routes through the gateway:
  - generate_image → wan2.7-image (text-to-image + image-to-image)
  - generate_video → Hailuo (海螺) / HappyHorse general video models
"""
from typing import Dict, Any, Optional, Callable
import asyncio
from pathlib import Path
import logging

import aiofiles

from app.config import settings
from app.integrations.gateway import get_gateway_client_for_user

logger = logging.getLogger(__name__)


# Aspect-ratio → wan size string ("W*H")
_AR_TO_SIZE = {
    "1:1": "1024*1024",
    "16:9": "1280*720",
    "9:16": "720*1280",
    "4:3": "1024*768",
    "3:4": "768*1024",
    "3:2": "1216*832",
    "2:3": "832*1216",
}


def ar_to_size(aspect_ratio: str) -> str:
    return _AR_TO_SIZE.get((aspect_ratio or "").strip(), "1024*1024")


class GoogleAIClient:
    """Image/video client backed by the aggregation gateway."""

    def __init__(self, api_key: Optional[str] = None, user_id: Optional[int] = None):
        # api_key kept for signature compatibility; the gateway token is used.
        # user_id 解析按用户映射的网关凭证（None → DB 默认组，见 resolve_for_user）。
        self.gateway = get_gateway_client_for_user(user_id)

    # ── image (wan) ────────────────────────────────────────────────────────────
    async def generate_image(
        self,
        prompt: str,
        output_path: Path,
        filename: str,
        aspect_ratio: str = "4:3",
        model: Optional[str] = None,
        reference_image_path: str = None,
    ) -> Dict[str, Any]:
        """Generate (or edit) an image via wan and save it to output_path/filename."""
        try:
            image_input = None
            if reference_image_path and Path(reference_image_path).exists():
                async with aiofiles.open(reference_image_path, "rb") as f:
                    image_input = await f.read()

            urls = await self.gateway.generate_image(
                prompt,
                model=model or settings.GATEWAY_IMAGE_MODEL,
                image=image_input,
                size=ar_to_size(aspect_ratio),
                n=1,
            )
            image_bytes = await self.gateway.fetch_bytes(urls[0])

            output_path.mkdir(parents=True, exist_ok=True)
            file_path = output_path / filename
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(image_bytes)
            logger.info(f"Image generated and saved to {file_path}")
            return {"success": True, "file_path": str(file_path), "filename": filename}
        except Exception as e:
            logger.error(f"Failed to generate image: {e}")
            return {"success": False, "error": str(e)}

    # ── video (Hailuo / HappyHorse) ────────────────────────────────────────────
    async def generate_video(
        self,
        prompt: str,
        first_frame_path: str = None,
        output_path: Path = None,
        filename: str = None,
        aspect_ratio: str = "16:9",
        resolution: str = "720p",
        duration: int = 6,
        model: Optional[str] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
        generation_mode: str = "text-to-video",
        reference_image_paths: Optional[list] = None,
        reference_image_urls: Optional[list] = None,
        last_frame_path: Optional[str] = None,
        reference_video_url: Optional[str] = None,
        reference_video_urls: Optional[list] = None,
        audio_url: Optional[str] = None,
        generate_audio: bool = False,
    ) -> Dict[str, Any]:
        """Generate a video via the chosen general-video model and save it.

        Extra Seedance 2.0 multimodal inputs (剧创式逐分镜): additional reference image
        files, a reference video URL, and an audio URL. Ignored by non-Seedance families.
        """
        if isinstance(output_path, str):
            output_path = Path(output_path)

        family = (model or settings.GATEWAY_VIDEO_HAILUO_MODEL).lower()
        is_i2v = generation_mode == "image-to-video" and first_frame_path

        try:
            first_frame_bytes = None
            if is_i2v and Path(first_frame_path).exists():
                async with aiofiles.open(first_frame_path, "rb") as f:
                    first_frame_bytes = await f.read()

            # Optional last frame (尾帧 = 图片2 for Seedance). Loaded regardless of
            # generation_mode — a 尾帧 alone still makes this a reference-driven clip.
            last_frame_bytes = None
            if last_frame_path and Path(last_frame_path).exists():
                async with aiofiles.open(last_frame_path, "rb") as f:
                    last_frame_bytes = await f.read()

            if progress_callback:
                await progress_callback(20)

            # Load any extra reference images (multi-image / 变装 references)
            extra_image_bytes: list = []
            for p in (reference_image_paths or []):
                try:
                    if p and Path(p).exists():
                        async with aiofiles.open(p, "rb") as f:
                            extra_image_bytes.append(await f.read())
                except Exception as _e:
                    logger.warning("skip reference image %s: %s", p, _e)

            gw = self.gateway
            # ── submit task ──
            if "seedance" in family or "doubao" in family:
                task_id = await gw.seedance_create(
                    prompt,
                    model=model,
                    reference_image=first_frame_bytes,
                    last_frame_image=last_frame_bytes,
                    reference_images=extra_image_bytes or None,
                    reference_video_url=reference_video_url,
                    reference_video_urls=reference_video_urls,
                    audio_url=audio_url,
                    ratio=aspect_ratio,
                    duration=int(duration),
                    generate_audio=generate_audio,
                )
                poll = gw.seedance_poll
            elif "happyhorse" in family:
                res = "1080p" if str(resolution).startswith("1080") else "720p"
                # HappyHorse /videos delivers reference frames as a comma-joined
                # `input_reference` list of FETCHABLE URLs (a base64 data URL contains
                # commas → would corrupt the list). Prefer the public URLs the caller
                # built; only fall back to a single inlined byte-frame when no URL is
                # available (single-image i2v). Mode by count: 1 → i2v, ≥2 → r2v.
                ref_urls = [u for u in (reference_image_urls or []) if u]
                if ref_urls:
                    hh_mode = "r2v" if len(ref_urls) >= 2 else "i2v"
                    task_id = await gw.happyhorse_create(
                        prompt,
                        mode=hh_mode,
                        resolution=res,
                        duration=duration,
                        ratio=aspect_ratio,
                        image_urls=ref_urls,
                    )
                else:
                    images = [first_frame_bytes] if first_frame_bytes else None
                    task_id = await gw.happyhorse_create(
                        prompt,
                        mode="i2v" if is_i2v else "t2v",
                        resolution=res,
                        duration=duration,
                        ratio=aspect_ratio,
                        images=images,
                    )
                poll = gw.video_poll
            else:  # Hailuo (海螺) default
                res = "1080P" if str(resolution).startswith("1080") else "768P"
                dur = 6 if int(duration) <= 6 else 10
                if res == "1080P":
                    dur = 6  # 1080P only supports 6s
                task_id = await gw.hailuo_create(
                    prompt,
                    first_frame_image=first_frame_bytes,
                    duration=dur,
                    resolution=res,
                )
                poll = gw.video_poll

            if progress_callback:
                await progress_callback(45)

            # ── poll for completion ──
            video_url = None
            max_checks = 180
            for i in range(max_checks):
                await asyncio.sleep(10)
                state = await poll(task_id)
                status = state["status"]
                if progress_callback:
                    await progress_callback(min(45 + (i * 45 // max_checks), 90))
                if gw.is_done(status) and state.get("url"):
                    video_url = state["url"]
                    break
                if gw.is_failed(status):
                    return {"success": False, "error": f"video task failed: {state.get('raw')}"}

            if not video_url:
                return {"success": False, "error": "Video generation timeout"}

            if progress_callback:
                await progress_callback(95)

            video_bytes = await gw.fetch_bytes(video_url)
            output_path.mkdir(parents=True, exist_ok=True)
            file_path = output_path / filename
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(video_bytes)
            logger.info(f"Video generated and saved to {file_path}")
            return {"success": True, "file_path": str(file_path), "filename": filename}

        except Exception as e:
            logger.error(f"Failed to generate video: {e}")
            return {"success": False, "error": str(e)}
