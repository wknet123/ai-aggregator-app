"""
Image client (was Flux/BFL) — now backed by the AI aggregation gateway (wan).

Class name/signature kept so the existing flux router and OmniWeaver keep
working; the implementation now generates via wan2.7-image (text-to-image and
image-to-image when ``input_image`` is supplied).
"""
from typing import Dict, Any, Optional
from pathlib import Path
import logging

import aiofiles

from app.config import settings
from app.integrations.gateway import get_gateway_client
from app.integrations.google.client import ar_to_size

logger = logging.getLogger(__name__)


class FluxClient:
    """Image client backed by the aggregation gateway (wan)."""

    def __init__(self, api_key: Optional[str] = None):
        # api_key kept for signature compatibility; the gateway token is used.
        self.gateway = get_gateway_client()

    async def generate_image(
        self,
        prompt: str,
        output_path: Path,
        filename: str,
        aspect_ratio: str = "1:1",
        output_format: str = "png",
        model: Optional[str] = None,
        seed: Optional[int] = None,
        prompt_upsampling: bool = False,
        safety_tolerance: int = 2,
        input_image: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate (or edit) an image via wan and save it to output_path/filename."""
        try:
            logger.info(
                f"Generating image (wan): prompt={prompt[:50]}..., aspect_ratio={aspect_ratio}, "
                f"image-to-image={input_image is not None}"
            )
            urls = await self.gateway.generate_image(
                prompt,
                model=model or settings.GATEWAY_IMAGE_MODEL,
                image=input_image,
                size=ar_to_size(aspect_ratio),
                n=1,
            )
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
                "image_url": urls[0],
            }
        except Exception as e:
            logger.error(f"Failed to generate image with wan: {e}")
            return {"success": False, "error": str(e)}

    async def get_credits(self) -> Dict[str, Any]:
        """Credits are managed by the gateway account; not exposed per-call."""
        return {"success": True, "data": {"credits": None, "provider": "gateway"}}
