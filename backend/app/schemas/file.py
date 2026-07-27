"""
File Upload Schemas
"""
from pydantic import BaseModel, Field
from typing import Optional


class FileUploadResponse(BaseModel):
    """File upload response"""
    success: bool
    file_id: str
    filename: str
    file_path: str
    message: Optional[str] = None


class GenerationTaskCreate(BaseModel):
    """Generation task creation"""
    prompt: str = Field(..., min_length=1)  # 上限按所选模型在端点校验（见 core.pricing.max_prompt_chars）
    model_id: str
    aspect_ratio: Optional[str] = "4:3"
    resolution: Optional[str] = "720p"  # For video generation: 720p or 1080p
    duration: Optional[int] = None
    first_frame_id: Optional[str] = None  # For video generation - required for image-to-video
    second_frame_id: Optional[str] = None  # For video generation - optional
    third_frame_id: Optional[str] = None  # For video generation - optional
    reference_image_id: Optional[str] = None  # For image-to-image generation - optional
    generation_mode: Optional[str] = None  # text-to-video, image-to-video, video-to-video, text-to-image, image-to-image
    drama_project_id: Optional[str] = None  # Route media to project-specific MinIO path


class GenerationTaskResponse(BaseModel):
    """Generation task response"""
    task_id: str
    status: str  # pending, processing, completed, failed
    message: str
    result_url: Optional[str] = None
    error: Optional[str] = None
    progress: Optional[int] = 0  # 0-100


class GenerationTaskStatus(BaseModel):
    """Generation task status"""
    task_id: str
    status: str
    progress: int
    result_url: Optional[str] = None
    error: Optional[str] = None
    created_at: str
    updated_at: str
