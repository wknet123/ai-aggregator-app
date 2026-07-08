"""
Credit Package Model - 积分套餐包
"""
from sqlalchemy import Column, Integer, String, Boolean, Numeric
from app.db.base import Base


class CreditPackage(Base):
    """积分套餐包模型"""

    __tablename__ = "credit_packages"

    name = Column(String(100), nullable=False, comment="套餐名称")
    description = Column(String(500), comment="套餐描述")
    credits = Column(Integer, nullable=False, comment="包含积分数量")
    price = Column(Numeric(10, 2), nullable=False, comment="价格（元）")
    original_price = Column(Numeric(10, 2), comment="原价（用于显示折扣）")
    is_active = Column(Boolean, default=True, nullable=False, comment="是否启用")
    sort_order = Column(Integer, default=0, comment="排序顺序")
    badge = Column(String(50), comment="徽章标签（如：热门、推荐）")

    def __repr__(self):
        return f"<CreditPackage {self.name} - {self.credits}积分>"
