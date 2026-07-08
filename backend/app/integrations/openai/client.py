"""
Image client (was OpenAI GPT-Image/DALL-E) — now backed by the aggregation gateway (wan).

Class name/method signatures kept for router compatibility; generation routes
through wan2.7-image via the gateway.
"""
from typing import Optional, Dict, Any
from pathlib import Path
import logging

import aiofiles

from app.config import settings
from app.integrations.gateway import get_gateway_client
from app.integrations.google.client import ar_to_size

logger = logging.getLogger(__name__)


# GPT-Image style "WxH" sizes → wan "W*H" (passed through gateway, which also
# normalises x→*). Aspect names map via ar_to_size when callers send ratios.
class OpenAIClient:
    """Image client backed by the aggregation gateway (wan)."""

    def __init__(self):
        self.gateway = get_gateway_client()

    async def generate_image_gpt(
        self,
        prompt: str,
        output_path: Path,
        filename: str,
        model: Optional[str] = None,
        quality: str = "medium",
        size: str = "1024x1024",
        output_format: str = "png",
        background: str = "opaque",
        n: int = 1,
    ) -> Dict[str, Any]:
        """Generate an image via wan and save it to output_path/filename."""
        try:
            logger.info(f"Generating image (wan): prompt={prompt[:50]}..., size={size}")
            # "high" quality → pro model
            chosen = model or (
                settings.GATEWAY_IMAGE_PRO_MODEL if quality == "high" else settings.GATEWAY_IMAGE_MODEL
            )
            urls = await self.gateway.generate_image(prompt, model=chosen, size=size, n=n)
            image_bytes = await self.gateway.fetch_bytes(urls[0])

            output_path.mkdir(parents=True, exist_ok=True)
            file_path = output_path / filename
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(image_bytes)
            logger.info(f"Image saved to {file_path}")
            return {
                "success": True,
                "file_path": str(file_path),
                "filename": filename,
                "revised_prompt": None,
            }
        except Exception as e:
            logger.error(f"Failed to generate image with wan: {e}")
            return {"success": False, "error": str(e)}

    async def generate_image(
        self,
        prompt: str,
        model: Optional[str] = None,
        size: str = "1024x1024",
        quality: str = "standard",
        n: int = 1,
    ) -> Dict[str, Any]:
        """Legacy shape: returns OpenAI-style {'data': [{'url': ...}]}."""
        urls = await self.gateway.generate_image(
            prompt, model=model or settings.GATEWAY_IMAGE_MODEL, size=size, n=n
        )
        return {"data": [{"url": u} for u in urls]}

    async def generate_video(self, prompt: str, **kwargs) -> Dict[str, Any]:
        """Video generation is served by the dedicated video models (Hailuo/HappyHorse)."""
        return {"status": "unsupported", "message": "请使用通用视频接口 (Hailuo/HappyHorse)"}
