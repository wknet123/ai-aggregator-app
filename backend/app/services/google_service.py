"""
Google Service - Image and Video Generation with credit management
"""
from typing import Dict, Any
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from app.integrations.google.client import GoogleAIClient
from app.core.ai_task_executor import AITaskExecutor
from app.config import Settings


# AI gateway model pricing in points (image via wan, video via Hailuo/HappyHorse)
# NOTE: image prices must match the advertised values surfaced by the frontend
# (utils/drama-helpers.ts, config/models.config.ts), flux.py and the /models
# pricing endpoint — standard 40, pro 80. Keep these in sync.
GATEWAY_PRICING = {
    "wan2.7-image": 40,      # 40 points per image (standard)
    "wan2.7-image-pro": 80,  # 80 points per image (pro)
    "general-video": {
        "5s": 150,    # 150 points for <=5 seconds
        "6s": 200,    # 200 points for 6 seconds
        "10s": 240,   # 240 points for 7-10 seconds
    }
}


class GoogleService:
    """AI gateway image/video service with credit management"""

    def __init__(self, db: AsyncSession, user_id: int | None = None):
        self.db = db
        self.settings = Settings()
        self.client = GoogleAIClient(user_id=user_id)
        self.executor = AITaskExecutor(db)

    def _calculate_image_cost(self, model_id: str = "wan2.7-image") -> int:
        """Calculate point cost for image generation.

        Pro variant costs more; any other alias (e.g. google-imagen) falls back
        to the standard wan price.
        """
        price = GATEWAY_PRICING.get(model_id, GATEWAY_PRICING["wan2.7-image"])
        return price if isinstance(price, int) else GATEWAY_PRICING["wan2.7-image"]
    
    def _calculate_video_cost(self, duration: int = 5) -> int:
        """Calculate point cost for video generation"""
        if duration <= 5:
            return 150
        elif duration <= 6:
            return 200
        else:
            return 240
    
    async def generate_image(
        self,
        tenant_id: int,
        prompt: str,
        output_path: Path,
        filename: str,
        aspect_ratio: str = "4:3",
        reference_image_path: str = None,
        model_id: str = "wan2.7-image",
        **kwargs
    ) -> Dict[str, Any]:
        """Generate image with credit deduction"""
        cost = self._calculate_image_cost(model_id)
        gateway_model = (
            self.settings.GATEWAY_IMAGE_PRO_MODEL
            if model_id == "wan2.7-image-pro"
            else self.settings.GATEWAY_IMAGE_MODEL
        )

        async def task():
            return await self.client.generate_image(
                prompt=prompt,
                output_path=output_path,
                filename=filename,
                aspect_ratio=aspect_ratio,
                reference_image_path=reference_image_path,
                model=gateway_model,
            )

        result = await self.executor.execute_ai_task(
            tenant_id=tenant_id,
            task_cost=cost,
            task_callable=task,
            model_provider="gateway",
            model_name=gateway_model,
            task_description="wan image generation" + (" (image-to-image)" if reference_image_path else ""),
            extra_data={
                "prompt": prompt,
                "aspect_ratio": aspect_ratio,
                "has_reference_image": bool(reference_image_path)
            }
        )

        return result
    
    async def generate_video(
        self,
        tenant_id: int,
        prompt: str,
        first_frame_path: str = None,
        output_path: Path = None,
        filename: str = None,
        aspect_ratio: str = "16:9",
        resolution: str = "720p",
        duration: int = 6,
        model: str = None,
        generation_mode: str = "text-to-video",
        reference_image_paths: list = None,
        reference_image_urls: list = None,
        last_frame_path: str = None,
        reference_video_url: str = None,
        reference_video_urls: list = None,
        audio_url: str = None,
        generate_audio: bool = False,
        **kwargs
    ) -> Dict[str, Any]:
        """Generate video with credit deduction via AI 网关.

        Args:
            model: gateway video model id (e.g. 'MiniMax-Hailuo-2.3' or
                   'happyhorse-1.0'); the client picks the family. Defaults to Hailuo.
            generation_mode: 'text-to-video' (no first_frame_path needed) or
                           'image-to-video' (first_frame_path required)
        """
        cost = self._calculate_video_cost(duration)
        model = model or self.settings.GATEWAY_VIDEO_HAILUO_MODEL

        async def task():
            return await self.client.generate_video(
                prompt=prompt,
                first_frame_path=first_frame_path,
                output_path=output_path,
                filename=filename,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                duration=duration,
                model=model,
                generation_mode=generation_mode,
                reference_image_paths=reference_image_paths,
                reference_image_urls=reference_image_urls,
                last_frame_path=last_frame_path,
                reference_video_url=reference_video_url,
                reference_video_urls=reference_video_urls,
                audio_url=audio_url,
                generate_audio=generate_audio,
            )

        mode_desc = "image-to-video" if generation_mode == "image-to-video" else "text-to-video"
        result = await self.executor.execute_ai_task(
            tenant_id=tenant_id,
            task_cost=cost,
            task_callable=task,
            model_provider="gateway",
            model_name=model,
            task_description=f"{model} video generation ({mode_desc}) - {duration}s",
            extra_data={
                "prompt": prompt,
                "aspect_ratio": aspect_ratio,
                "resolution": resolution,
                "duration": duration,
                "model": model,
                "generation_mode": generation_mode,
                "has_first_frame": bool(first_frame_path)
            }
        )

        return result