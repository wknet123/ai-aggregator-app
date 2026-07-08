"""
Payment Service - 支付服务
"""
import logging
import json
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.payment_order import PaymentOrder, PaymentStatus, PaymentMethod
from app.models.credit_package import CreditPackage
from app.models.credit import Credit
from app.models.transaction import Transaction, TransactionType, TransactionStatus
from app.integrations.alipay.client import alipay_client
from app.config import settings

logger = logging.getLogger(__name__)


class PaymentService:
    """支付服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all_packages(self) -> List[CreditPackage]:
        """获取所有启用的套餐包"""
        try:
            result = await self.db.execute(
                select(CreditPackage)
                .where(CreditPackage.is_active == True)
                .order_by(CreditPackage.sort_order, CreditPackage.credits)
            )
            packages = result.scalars().all()
            return list(packages)
        except Exception as e:
            logger.error(f"Failed to get packages: {str(e)}")
            raise

    async def create_order(
        self,
        tenant_id: int,
        user_id: int,
        package_id: int,
        payment_method: PaymentMethod = PaymentMethod.ALIPAY
    ) -> PaymentOrder:
        """
        创建支付订单

        Args:
            tenant_id: 租户ID
            user_id: 用户ID
            package_id: 套餐ID
            payment_method: 支付方式

        Returns:
            支付订单
        """
        try:
            # 获取套餐信息
            package = await self.db.get(CreditPackage, package_id)
            if not package:
                raise ValueError("套餐不存在")

            if not package.is_active:
                raise ValueError("套餐已下架")

            # 生成订单号
            order_no = self._generate_order_no()

            # 计算过期时间
            expired_at = datetime.utcnow() + timedelta(minutes=settings.ALIPAY_ORDER_TIMEOUT)

            # 创建订单
            order = PaymentOrder(
                order_no=order_no,
                tenant_id=tenant_id,
                user_id=user_id,
                package_id=package_id,
                package_name=package.name,
                credits=package.credits,
                amount=package.price,
                payment_method=payment_method,
                status=PaymentStatus.PENDING,
                expired_at=expired_at
            )

            self.db.add(order)
            await self.db.commit()
            await self.db.refresh(order)

            # 如果是支付宝支付，创建预下单
            if payment_method == PaymentMethod.ALIPAY:
                await self._create_alipay_precreate(order, package)

            await self.db.commit()
            await self.db.refresh(order)

            logger.info(f"Created payment order: {order_no}")
            return order

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to create order: {str(e)}")
            raise

    async def _create_alipay_precreate(self, order: PaymentOrder, package: CreditPackage):
        """创建支付宝预下单"""
        try:
            # 将Decimal类型转换为float再转为字符串，确保格式正确
            amount_str = f"{float(order.amount):.2f}"

            # 调用支付宝API创建预下单
            result = alipay_client.create_precreate_order(
                out_trade_no=order.order_no,
                total_amount=amount_str,
                subject=f"积分充值 - {package.name}",
                body=f"购买{package.credits}积分",
                timeout_minutes=settings.ALIPAY_ORDER_TIMEOUT
            )

            if result.get("success"):
                order.qr_code = result.get("qr_code")
                order.status = PaymentStatus.PENDING
                logger.info(f"Alipay precreate success: {order.order_no}")
            else:
                order.status = PaymentStatus.FAILED
                order.error_message = result.get("error", "创建支付订单失败")
                logger.error(f"Alipay precreate failed: {result.get('error')}")

        except Exception as e:
            order.status = PaymentStatus.FAILED
            order.error_message = str(e)
            logger.error(f"Failed to create alipay precreate: {str(e)}")

    async def handle_alipay_notify(self, notify_data: Dict[str, Any]) -> bool:
        """
        处理支付宝异步通知

        Args:
            notify_data: 支付宝通知数据

        Returns:
            是否处理成功
        """
        try:
            # 验证签名
            if not alipay_client.verify_notify(notify_data):
                logger.error("Alipay notify signature verification failed")
                return False

            # 提取关键信息
            out_trade_no = notify_data.get("out_trade_no")
            trade_no = notify_data.get("trade_no")
            trade_status = notify_data.get("trade_status")
            total_amount = notify_data.get("total_amount")

            logger.info(f"Received alipay notify: order={out_trade_no}, trade={trade_no}, status={trade_status}")

            # 查询订单
            result = await self.db.execute(
                select(PaymentOrder).where(PaymentOrder.order_no == out_trade_no)
            )
            order = result.scalar_one_or_none()

            if not order:
                logger.error(f"Order not found: {out_trade_no}")
                return False

            # 保存回调数据
            order.notify_data = json.dumps(notify_data, ensure_ascii=False)
            order.notify_time = datetime.utcnow()
            order.trade_no = trade_no

            # 处理不同的交易状态
            if trade_status == "TRADE_SUCCESS" or trade_status == "TRADE_FINISHED":
                # 支付成功
                await self._handle_payment_success(order)
            elif trade_status == "TRADE_CLOSED":
                # 交易关闭
                order.status = PaymentStatus.CANCELLED
                logger.info(f"Order cancelled: {out_trade_no}")
            else:
                # 其他状态（等待支付等）
                order.status = PaymentStatus.PROCESSING
                logger.info(f"Order processing: {out_trade_no}, status: {trade_status}")

            await self.db.commit()
            return True

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to handle alipay notify: {str(e)}")
            return False

    async def _handle_payment_success(self, order: PaymentOrder):
        """
        处理支付成功

        Args:
            order: 支付订单
        """
        try:
            # 检查订单状态，避免重复处理
            if order.status == PaymentStatus.SUCCESS:
                logger.warning(f"Order already processed: {order.order_no}")
                return

            # 更新订单状态
            order.status = PaymentStatus.SUCCESS
            order.paid_at = datetime.utcnow()

            # 充值积分
            await self._recharge_credits(order)

            logger.info(f"Payment success processed: {order.order_no}")

        except Exception as e:
            # 回滚订单状态
            order.status = PaymentStatus.FAILED
            order.error_message = f"充值失败: {str(e)}"
            logger.error(f"Failed to process payment success: {str(e)}")
            raise

    async def _recharge_credits(self, order: PaymentOrder):
        """
        充值积分

        Args:
            order: 支付订单
        """
        try:
            # 查询租户积分记录
            result = await self.db.execute(
                select(Credit).where(Credit.tenant_id == order.tenant_id)
            )
            credit = result.scalar_one_or_none()

            if not credit:
                # 创建积分记录
                credit = Credit(
                    tenant_id=order.tenant_id,
                    balance=0,
                    total_recharged=0,
                    total_consumed=0
                )
                self.db.add(credit)
                await self.db.flush()

            # 增加积分余额
            credit.balance += order.credits
            credit.total_recharged += order.credits

            # 创建交易记录
            transaction = Transaction(
                tenant_id=order.tenant_id,
                amount=order.credits,
                type=TransactionType.RECHARGE,
                status=TransactionStatus.COMPLETED,
                description=f"支付宝充值 - {order.package_name}",
                reference_id=str(order.id)
            )
            self.db.add(transaction)

            await self.db.flush()

            logger.info(
                f"Credits recharged: tenant={order.tenant_id}, "
                f"amount={order.credits}, new_balance={credit.balance}"
            )

        except Exception as e:
            logger.error(f"Failed to recharge credits: {str(e)}")
            raise

    async def query_order_status(self, order_no: str) -> Optional[PaymentOrder]:
        """
        查询订单状态（并同步支付宝状态）

        Args:
            order_no: 订单号

        Returns:
            支付订单
        """
        try:
            # 查询本地订单
            result = await self.db.execute(
                select(PaymentOrder).where(PaymentOrder.order_no == order_no)
            )
            order = result.scalar_one_or_none()

            if not order:
                return None

            # 如果订单还在待支付状态，查询支付宝订单状态
            if order.status == PaymentStatus.PENDING and order.payment_method == PaymentMethod.ALIPAY:
                alipay_result = alipay_client.query_order(out_trade_no=order_no)

                if alipay_result.get("success"):
                    trade_status = alipay_result.get("trade_status")

                    if trade_status in ["TRADE_SUCCESS", "TRADE_FINISHED"]:
                        # 支付成功，同步处理
                        order.trade_no = alipay_result.get("trade_no")
                        await self._handle_payment_success(order)
                        await self.db.commit()
                    elif trade_status == "TRADE_CLOSED":
                        order.status = PaymentStatus.CANCELLED
                        await self.db.commit()

            return order

        except Exception as e:
            logger.error(f"Failed to query order status: {str(e)}")
            raise

    def _generate_order_no(self) -> str:
        """生成订单号"""
        import time
        import random
        timestamp = int(time.time() * 1000)
        random_num = random.randint(1000, 9999)
        return f"ORD{timestamp}{random_num}"


# Repository层（可选，用于更好的代码组织）
class PaymentRepository:
    """支付订单仓储"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_order_by_no(self, order_no: str) -> Optional[PaymentOrder]:
        """根据订单号获取订单"""
        result = await self.db.execute(
            select(PaymentOrder).where(PaymentOrder.order_no == order_no)
        )
        return result.scalar_one_or_none()

    async def get_user_orders(self, user_id: int, limit: int = 20) -> List[PaymentOrder]:
        """获取用户订单列表"""
        result = await self.db.execute(
            select(PaymentOrder)
            .where(PaymentOrder.user_id == user_id)
            .order_by(PaymentOrder.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
