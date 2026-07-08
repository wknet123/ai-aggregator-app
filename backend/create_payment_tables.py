"""
数据库迁移脚本 - 创建支付相关表

运行方式：
cd backend
python create_payment_tables.py
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

# 导入配置
from app.config import settings
from app.models.credit_package import CreditPackage
from app.models.payment_order import PaymentOrder
from app.db.base import Base

async def create_tables():
    """创建支付相关表"""
    print("🔄 Creating payment tables...")

    engine = create_async_engine(settings.DATABASE_URL, echo=True)

    async with engine.begin() as conn:
        # 创建表
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)

    print("✅ Payment tables created successfully!")

    # 初始化默认套餐数据
    await init_default_packages(engine)

    await engine.dispose()


async def init_default_packages(engine):
    """初始化默认积分套餐"""
    print("🔄 Initializing default credit packages...")

    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    default_packages = [
        {
            "name": "体验包",
            "description": "新手入门首选",
            "credits": 100,
            "price": 9.9,
            "original_price": 19.9,
            "sort_order": 1,
            "badge": "推荐",
            "is_active": True
        },
        {
            "name": "标准包",
            "description": "日常创作足够",
            "credits": 500,
            "price": 49.0,
            "original_price": 99.0,
            "sort_order": 2,
            "badge": "热门",
            "is_active": True
        },
        {
            "name": "专业包",
            "description": "高频使用优选",
            "credits": 1000,
            "price": 89.0,
            "original_price": 199.0,
            "sort_order": 3,
            "badge": "超值",
            "is_active": True
        },
        {
            "name": "企业包",
            "description": "团队协作首选",
            "credits": 5000,
            "price": 399.0,
            "original_price": 999.0,
            "sort_order": 4,
            "is_active": True
        },
        {
            "name": "旗舰包",
            "description": "无限创作可能",
            "credits": 10000,
            "price": 699.0,
            "original_price": 1999.0,
            "sort_order": 5,
            "is_active": True
        }
    ]

    async with async_session() as session:
        # 检查是否已有套餐数据
        result = await session.execute(text("SELECT COUNT(*) FROM credit_packages"))
        count = result.scalar()

        if count == 0:
            # 插入默认套餐
            for pkg_data in default_packages:
                package = CreditPackage(**pkg_data)
                session.add(package)

            await session.commit()
            print(f"✅ Created {len(default_packages)} default packages!")
        else:
            print(f"ℹ️  Packages already exist ({count} found), skipping initialization.")


if __name__ == "__main__":
    asyncio.run(create_tables())
