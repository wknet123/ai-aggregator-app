"""
Credit System - Credit management utilities
"""
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.credit import Credit
from app.models.transaction import Transaction, TransactionType, TransactionStatus
from app.models.tenant import Tenant


class InsufficientCreditsError(Exception):
    """Raised when tenant has insufficient credits"""
    pass


# transactions.description is varchar(255). Upstream error messages are now
# surfaced verbatim (e.g. the full Seedance "InputImageSensitive…/real person"
# JSON), and a refund description like ``Refund: Task failed: {long json}`` can
# exceed 255 chars. A too-long INSERT raises pymysql DataError(1406) which rolls
# back the *refund* — silently charging the tenant for a failed task. Clamp every
# description so the credit write can never fail on length. The full error is
# still kept in generation_tasks.error_message (TEXT).
_DESCRIPTION_MAX = 255


def _fit_description(text: Optional[str], fallback: str) -> str:
    text = text or fallback
    return text if len(text) <= _DESCRIPTION_MAX else text[: _DESCRIPTION_MAX - 1] + "…"


class CreditManager:
    """Credit management utility"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def get_balance(self, tenant_id: int) -> int:
        """Get tenant credit balance"""
        result = await self.db.execute(
            select(Credit).where(Credit.tenant_id == tenant_id)
        )
        credit = result.scalar_one_or_none()
        
        if not credit:
            # Create default credit record
            credit = Credit(tenant_id=tenant_id, balance=0)
            self.db.add(credit)
            await self.db.commit()
            await self.db.refresh(credit)
        
        return credit.balance
    
    async def recharge(
        self,
        tenant_id: int,
        amount: int,
        reference_id: Optional[str] = None,
        description: Optional[str] = None
    ) -> Transaction:
        """Recharge credits for tenant"""
        # Get or create credit record
        result = await self.db.execute(
            select(Credit).where(Credit.tenant_id == tenant_id)
        )
        credit = result.scalar_one_or_none()
        
        if not credit:
            credit = Credit(tenant_id=tenant_id, balance=0)
            self.db.add(credit)
        
        # Update credit balance
        credit.balance += amount
        credit.total_recharged += amount
        
        # Create transaction record
        transaction = Transaction(
            tenant_id=tenant_id,
            type=TransactionType.RECHARGE,
            amount=amount,
            status=TransactionStatus.COMPLETED,
            reference_id=reference_id,
            description=_fit_description(description, f"Credit recharge: {amount}")
        )
        self.db.add(transaction)
        
        await self.db.commit()
        await self.db.refresh(transaction)
        
        return transaction
    
    async def deduct(
        self,
        tenant_id: int,
        amount: int,
        description: Optional[str] = None
    ) -> Transaction:
        """Deduct credits from tenant"""
        # Get credit record
        result = await self.db.execute(
            select(Credit).where(Credit.tenant_id == tenant_id)
        )
        credit = result.scalar_one_or_none()
        
        if not credit or credit.balance < amount:
            raise InsufficientCreditsError(
                f"Insufficient credits. Required: {amount}, Available: {credit.balance if credit else 0}"
            )
        
        # Update credit balance
        credit.balance -= amount
        credit.total_consumed += amount
        
        # Create transaction record
        transaction = Transaction(
            tenant_id=tenant_id,
            type=TransactionType.CONSUMPTION,
            amount=amount,
            status=TransactionStatus.COMPLETED,
            description=_fit_description(description, f"Credit deduction: {amount}")
        )
        self.db.add(transaction)
        
        await self.db.commit()
        await self.db.refresh(transaction)
        
        return transaction
    
    async def check_sufficient_credits(self, tenant_id: int, required_amount: int) -> bool:
        """Check if tenant has sufficient credits"""
        balance = await self.get_balance(tenant_id)
        return balance >= required_amount
