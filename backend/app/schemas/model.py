"""
Model Usage Schemas
"""
from pydantic import BaseModel, Field
from decimal import Decimal
from datetime import datetime
from typing import Dict, Any, Optional


class ModelUsageBase(BaseModel):
    """Model usage base schema"""
    model_provider: str = Field(..., description="Model provider (openai, google, flux, worldlabs)")
    model_name: str = Field(..., description="Model name")
    cost: Decimal = Field(..., ge=0)


class ModelUsageCreate(ModelUsageBase):
    """Model usage creation schema"""
    tenant_id: int
    input_tokens: Optional[int] = 0
    output_tokens: Optional[int] = 0
    extra_data: Optional[Dict[str, Any]] = None


class ModelUsageInDB(ModelUsageBase):
    """Model usage in database schema"""
    id: int
    tenant_id: int
    input_tokens: int
    output_tokens: int
    extra_data: Dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ModelUsageResponse(ModelUsageInDB):
    """Model usage response schema"""
    pass
