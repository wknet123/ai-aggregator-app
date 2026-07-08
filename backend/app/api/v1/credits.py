"""
Credit API endpoints
"""
from typing import Annotated, List
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_tenant
from app.models.tenant import Tenant
from app.services.credit_service import CreditService
from app.schemas.credit import CreditResponse, CreditRechargeRequest
from app.schemas.transaction import TransactionResponse
from app.schemas.response import ResponseBase
from app.repositories.credit_repository import CreditRepository


router = APIRouter()


@router.get("/balance", response_model=ResponseBase[dict])
async def get_credit_balance(
    tenant: Annotated[Tenant, Depends(get_current_tenant)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Get current credit balance"""
    credit_service = CreditService(db)
    balance = await credit_service.get_balance(tenant.id)
    
    return ResponseBase(
        success=True,
        message="Balance retrieved successfully",
        data={"balance": balance}
    )


@router.post("/recharge", response_model=ResponseBase[TransactionResponse])
async def recharge_credits(
    request: CreditRechargeRequest,
    tenant: Annotated[Tenant, Depends(get_current_tenant)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Recharge credits"""
    credit_service = CreditService(db)
    
    transaction = await credit_service.recharge(
        tenant_id=tenant.id,
        amount=request.amount,
        payment_method=request.payment_method,
        reference_id=request.reference_id
    )
    
    return ResponseBase(
        success=True,
        message="Credits recharged successfully",
        data=TransactionResponse.model_validate(transaction)
    )


@router.get("/transactions", response_model=ResponseBase[List[TransactionResponse]])
async def get_transactions(
    tenant: Annotated[Tenant, Depends(get_current_tenant)],
    db: Annotated[AsyncSession, Depends(get_db)],
    skip: int = 0,
    limit: int = 100
):
    """Get transaction history"""
    credit_service = CreditService(db)
    
    transactions = await credit_service.get_transaction_history(
        tenant_id=tenant.id,
        skip=skip,
        limit=limit
    )
    
    return ResponseBase(
        success=True,
        message="Transactions retrieved successfully",
        data=[TransactionResponse.model_validate(t) for t in transactions]
    )


@router.get("/info", response_model=ResponseBase[CreditResponse])
async def get_credit_info(
    tenant: Annotated[Tenant, Depends(get_current_tenant)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Get complete credit information"""
    credit_repo = CreditRepository(db)
    credit = await credit_repo.get_by_tenant(tenant.id)
    
    return ResponseBase(
        success=True,
        message="Credit info retrieved successfully",
        data=CreditResponse.model_validate(credit)
    )
