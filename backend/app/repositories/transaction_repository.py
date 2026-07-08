"""
Transaction Repository
"""
from typing import List
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.transaction import Transaction
from app.repositories.base import BaseRepository


class TransactionRepository(BaseRepository[Transaction]):
    """Transaction repository"""
    
    def __init__(self, db: AsyncSession):
        super().__init__(Transaction, db)
    
    async def get_by_tenant(
        self,
        tenant_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Transaction]:
        """Get transactions by tenant"""
        result = await self.db.execute(
            select(Transaction)
            .where(Transaction.tenant_id == tenant_id)
            .order_by(desc(Transaction.created_at))
            .offset(skip)
            .limit(limit)
        )
        return list(result.scalars().all())
