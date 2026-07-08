"""
Payment Order Model - 支付订单
"""
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Numeric, Text, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.db.base import Base


class PaymentStatus(str, enum.Enum):
    """支付状态"""
    PENDING = "PENDING"  # 待支付
    PROCESSING = "PROCESSING"  # 处理中
    SUCCESS = "SUCCESS"  # 支付成功
    FAILED = "FAILED"  # 支付失败
    REFUNDED = "REFUNDED"  # 已退款
    CANCELLED = "CANCELLED"  # 已取消


class PaymentMethod(str, enum.Enum):
    """支付方式"""
    ALIPAY = "ALIPAY"  # 支付宝
    WECHAT = "WECHAT"  # 微信支付
    MANUAL = "MANUAL"  # 手动充值


class PaymentOrder(Base):
    """支付订单模型"""

    __tablename__ = "payment_orders"

    # 订单基本信息
    order_no = Column(String(64), unique=True, nullable=False, index=True, comment="订单号")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True, comment="用户ID")

    # 套餐信息
    package_id = Column(Integer, ForeignKey("credit_packages.id"), nullable=False, comment="套餐ID")
    package_name = Column(String(100), nullable=False, comment="套餐名称（冗余字段）")
    credits = Column(Integer, nullable=False, comment="购买积分数量")

    # 支付信息
    amount = Column(Numeric(10, 2), nullable=False, comment="支付金额（元）")
    payment_method = Column(SQLEnum(PaymentMethod), nullable=False, comment="支付方式")
    status = Column(SQLEnum(PaymentStatus), default=PaymentStatus.PENDING, nullable=False, index=True, comment="支付状态")

    # 第三方支付信息
    trade_no = Column(String(128), unique=True, index=True, comment="第三方交易号")
    qr_code = Column(Text, comment="支付二维码内容")

    # 回调信息
    notify_time = Column(DateTime, comment="通知时间")
    notify_data = Column(Text, comment="回调通知数据（JSON）")

    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    paid_at = Column(DateTime, comment="支付完成时间")
    expired_at = Column(DateTime, comment="过期时间")

    # 备注
    remark = Column(String(500), comment="备注")
    error_message = Column(String(500), comment="错误信息")

    # Relationships
    tenant = relationship("Tenant")
    user = relationship("User")
    package = relationship("CreditPackage")

    def __repr__(self):
        return f"<PaymentOrder {self.order_no} - {self.status}>"
