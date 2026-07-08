"""
Payment API - 支付接口
"""
import logging
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.payment import (
    CreditPackageResponse,
    CreateOrderRequest,
    PaymentOrderResponse,
    QueryOrderResponse
)
from app.services.payment_service import PaymentService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/packages", response_model=List[CreditPackageResponse])
async def get_credit_packages(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取积分套餐列表
    """
    try:
        service = PaymentService(db)
        packages = await service.get_all_packages()
        return packages
    except Exception as e:
        logger.error(f"Failed to get packages: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/orders", response_model=PaymentOrderResponse)
async def create_payment_order(
    request: CreateOrderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建支付订单
    """
    try:
        service = PaymentService(db)
        order = await service.create_order(
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            package_id=request.package_id,
            payment_method=request.payment_method
        )
        return order
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create order: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orders/{order_no}", response_model=QueryOrderResponse)
async def query_order_status(
    order_no: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    查询订单状态
    """
    try:
        service = PaymentService(db)
        order = await service.query_order_status(order_no)

        if not order:
            raise HTTPException(status_code=404, detail="订单不存在")

        # 验证订单所属
        if order.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权查看此订单")

        # 检查是否过期
        is_expired = False
        if order.expired_at and datetime.utcnow() > order.expired_at and order.status == "PENDING":
            is_expired = True

        return {
            "order": order,
            "is_expired": is_expired
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to query order: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/alipay/notify")
async def alipay_notify_callback(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    支付宝异步通知回调（无需认证）

    注意：此接口会被支付宝服务器调用，不需要用户认证
    """
    try:
        # 获取POST数据
        form_data = await request.form()
        notify_data = dict(form_data)

        logger.info(f"Received alipay notify: {notify_data.get('out_trade_no')}")

        # 处理通知
        service = PaymentService(db)
        success = await service.handle_alipay_notify(notify_data)

        if success:
            # 返回成功响应给支付宝
            return Response(content="success", media_type="text/plain")
        else:
            # 返回失败响应
            return Response(content="fail", media_type="text/plain")

    except Exception as e:
        logger.error(f"Failed to handle alipay notify: {str(e)}")
        return Response(content="fail", media_type="text/plain")


@router.get("/orders", response_model=List[PaymentOrderResponse])
async def get_user_orders(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取用户订单列表
    """
    try:
        from app.services.payment_service import PaymentRepository
        repo = PaymentRepository(db)
        orders = await repo.get_user_orders(current_user.id, limit=limit)
        return orders
    except Exception as e:
        logger.error(f"Failed to get user orders: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
