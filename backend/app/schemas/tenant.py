"""
Tenant Schemas
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class TenantBase(BaseModel):
    """Tenant base schema"""
    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=50)


class TenantCreate(TenantBase):
    """Tenant creation schema"""
    max_users: Optional[int] = 10


class TenantUpdate(BaseModel):
    """Tenant update schema"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None
    max_users: Optional[int] = None


class TenantInDB(TenantBase):
    """Tenant in database schema"""
    id: int
    is_active: bool
    max_users: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class TenantResponse(TenantInDB):
    """Tenant response schema"""
    pass
