"""
Credit Repository
"""
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.credit import Credit
from app.repositories.base import BaseRepository


class CreditRepository(BaseRepository[Credit]):
    """Credit repository"""
    
    def __init__(self, db: AsyncSession):
        super().__init__(Credit, db)
    
    async def get_by_tenant(self, tenant_id: int) -> Optional[Credit]:
        """Get credit by tenant ID"""
        result = await self.db.execute(
            select(Credit).where(Credit.tenant_id == tenant_id)
        )
        return result.scalar_one_or_none()
