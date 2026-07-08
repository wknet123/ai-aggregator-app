"""
Model Management API endpoints.

All models are served through the AI aggregation gateway:
  - text reasoning → deepseek-v4-flash
  - image (文生图/图生图) → wan2.7-image / wan2.7-image-pro
  - video → 海螺 Hailuo 2.3 / HappyHorse 1.0 (通用) ，Seedance (短剧)
"""
from fastapi import APIRouter
from app.config import settings
from app.schemas.response import ResponseBase


router = APIRouter()


@router.get("/list", response_model=ResponseBase[list])
async def list_available_models():
    """List all available AI models grouped by capability."""
    models = [
        {"provider": "wan", "category": "image",
         "models": [settings.GATEWAY_IMAGE_MODEL, settings.GATEWAY_IMAGE_PRO_MODEL]},
        {"provider": "hailuo", "category": "video",
         "models": [settings.GATEWAY_VIDEO_HAILUO_MODEL]},
        {"provider": "happyhorse", "category": "video",
         "models": [settings.GATEWAY_VIDEO_HAPPYHORSE]},
        {"provider": "seedance", "category": "drama-video",
         "models": [settings.GATEWAY_DRAMA_VIDEO_MODEL]},
        {"provider": "deepseek", "category": "text",
         "models": [settings.GATEWAY_TEXT_MODEL]},
    ]

    return ResponseBase(
        success=True,
        message="Models retrieved successfully",
        data=models,
    )


@router.get("/pricing", response_model=ResponseBase[dict])
async def get_model_pricing():
    """Get credit pricing (per generation) for the platform models."""
    from app.core.pricing import pricing_table
    return ResponseBase(
        success=True,
        message="Pricing retrieved successfully",
        data=pricing_table(),
    )
