"""
Payment Schemas - 支付相关数据模型
"""
from typing import Optional
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field


# Credit Package Schemas
class CreditPackageBase(BaseModel):
    """积分套餐基础模型"""
    name: str = Field(..., description="套餐名称")
    description: Optional[str] = Field(None, description="套餐描述")
    credits: int = Field(..., gt=0, description="积分数量")
    price: Decimal = Field(..., gt=0, description="价格（元）")
    original_price: Optional[Decimal] = Field(None, description="原价")
    badge: Optional[str] = Field(None, description="徽章标签")


class CreditPackageResponse(CreditPackageBase):
    """积分套餐响应模型"""
    id: int
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Payment Order Schemas
class CreateOrderRequest(BaseModel):
    """创建订单请求"""
    package_id: int = Field(..., description="套餐ID")
    payment_method: str = Field("ALIPAY", description="支付方式")


class PaymentOrderResponse(BaseModel):
    """支付订单响应"""
    id: int
    order_no: str
    package_name: str
    credits: int
    amount: Decimal
    payment_method: str
    status: str
    qr_code: Optional[str] = None
    trade_no: Optional[str] = None
    created_at: datetime
    paid_at: Optional[datetime] = None
    expired_at: Optional[datetime] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class QueryOrderResponse(BaseModel):
    """查询订单响应"""
    order: PaymentOrderResponse
    is_expired: bool = Field(..., description="是否已过期")


class AlipayNotifyRequest(BaseModel):
    """支付宝异步通知请求（示意）"""
    out_trade_no: str
    trade_no: str
    trade_status: str
    total_amount: str
    # 其他字段根据支付宝文档添加
