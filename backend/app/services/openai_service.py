"""
Image generation service (wan via AI 网关) with credit management.
"""
from decimal import Decimal
from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from app.integrations.openai.client import OpenAIClient
from app.core.ai_task_executor import AITaskExecutor, mock_dalle_api_call


# Model pricing in points (not dollars)
GATEWAY_PRICING = {
    "wan2.7-image": {"standard": 40, "hd": 40},      # 40 points per image (advertised)
    "wan2.7-image-pro": {"standard": 80, "hd": 80},  # 80 points per image (pro)
}


class OpenAIService:
    """Image generation service (wan via AI 网关) with credit management"""

    def __init__(self, db: AsyncSession, use_mock: bool = True, user_id: int | None = None):
        self.db = db
        self.client = OpenAIClient(user_id=user_id)
        self.executor = AITaskExecutor(db)
        self.use_mock = use_mock  # Toggle for testing

    def _calculate_image_cost(self, model: str, quality: str = "standard") -> Decimal:
        """Calculate point cost for image generation"""
        pricing = GATEWAY_PRICING.get(model, {"standard": 40})
        return Decimal(str(pricing.get(quality, pricing["standard"])))
    
    def _calculate_video_cost(self, duration: int, resolution: str = "1080p") -> Decimal:
        """Calculate point cost for video generation"""
        # Duration-based pricing
        if duration <= 5:
            return Decimal("150")  # 5 seconds or less: 150 points
        elif duration <= 6:
            return Decimal("200")  # 6 seconds: 200 points
        else:
            return Decimal("240")  # 7-10 seconds: 240 points
    
    async def generate_video(
        self,
        tenant_id: int,
        prompt: str,
        duration: int = 5,
        resolution: str = "1080p",
        **kwargs
    ) -> Dict[str, Any]:
        """Video generation here is no longer supported.

        Sora has been removed; use the general video pipeline
        (Hailuo/HappyHorse) via GoogleService.generate_video instead.
        No credits are deducted.
        """
        return {
            "success": False,
            "error": "此视频接口已停用，请使用通用视频(Hailuo/HappyHorse)",
        }

    async def generate_image(
        self,
        tenant_id: int,
        prompt: str,
        model: str = "wan2.7-image",
        quality: str = "standard",
        **kwargs
    ) -> Dict[str, Any]:
        """Generate image with credit deduction"""
        cost = self._calculate_image_cost(model, quality)

        async def task():
            if self.use_mock:
                response = await mock_dalle_api_call(prompt=prompt, model=model)
            else:
                response = await self.client.generate_image(prompt, model, quality=quality, **kwargs)
            return response

        result = await self.executor.execute_ai_task(
            tenant_id=tenant_id,
            task_cost=cost,
            task_callable=task,
            model_provider="gateway",
            model_name=model,
            task_description=f"wan {model} image generation",
            extra_data={
                "prompt": prompt,
                "quality": quality
            }
        )

        return result
