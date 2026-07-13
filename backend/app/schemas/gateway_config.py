"""
Gateway Config Schemas（admin 网关管理）。
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class GatewayConfigCreate(BaseModel):
    """新建网关配置。"""
    name: str = Field(..., min_length=1, max_length=100)
    base_url: str = Field(..., min_length=1, max_length=500)
    api_key: str = Field(..., min_length=1, max_length=500)
    is_default: bool = False
    is_active: bool = True


class GatewayConfigUpdate(BaseModel):
    """更新网关配置。api_key 留空 = 不改动。"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    base_url: Optional[str] = Field(None, min_length=1, max_length=500)
    api_key: Optional[str] = Field(None, min_length=1, max_length=500)
    is_active: Optional[bool] = None


class GatewayConfigResponse(BaseModel):
    """网关配置响应（api_key 脱敏，仅回尾 4 位）。"""
    id: int
    name: str
    base_url: str
    api_key_masked: str
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserMappingResponse(BaseModel):
    """用户及其当前网关映射。"""
    user_id: int
    email: str
    username: str
    is_admin: bool
    gateway_config_id: Optional[int] = None


class UserMappingUpdate(BaseModel):
    """设/清某用户的网关映射（null = 清除，回退默认组）。"""
    gateway_config_id: Optional[int] = None
