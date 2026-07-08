"""
Credit Service
"""
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.transaction import Transaction
from app.core.credits import CreditManager
from app.repositories.transaction_repository import TransactionRepository


class CreditService:
    """Credit management service"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.credit_manager = CreditManager(db)
        self.transaction_repo = TransactionRepository(db)
    
    async def get_balance(self, tenant_id: int) -> int:
        """Get tenant credit balance"""
        return await self.credit_manager.get_balance(tenant_id)
    
    async def recharge(
        self,
        tenant_id: int,
        amount: int,
        payment_method: str,
        reference_id: str
    ) -> Transaction:
        """Recharge credits"""
        description = f"Credit recharge via {payment_method}"
        return await self.credit_manager.recharge(
            tenant_id=tenant_id,
            amount=amount,
            reference_id=reference_id,
            description=description
        )
    
    async def deduct(
        self,
        tenant_id: int,
        amount: int,
        description: str
    ) -> Transaction:
        """Deduct credits"""
        return await self.credit_manager.deduct(
            tenant_id=tenant_id,
            amount=amount,
            description=description
        )
    
    async def get_transaction_history(
        self,
        tenant_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Transaction]:
        """Get transaction history"""
        return await self.transaction_repo.get_by_tenant(tenant_id, skip, limit)
    
    async def check_sufficient_credits(
        self,
        tenant_id: int,
        required_amount: int
    ) -> bool:
        """Check if tenant has sufficient credits"""
        return await self.credit_manager.check_sufficient_credits(tenant_id, required_amount)
