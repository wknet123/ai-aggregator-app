"""
Transaction Schemas
"""
from pydantic import BaseModel, Field
from decimal import Decimal
from datetime import datetime
from app.models.transaction import TransactionType, TransactionStatus


class TransactionBase(BaseModel):
    """Transaction base schema"""
    type: TransactionType
    amount: Decimal = Field(..., gt=0)
    description: str | None = None


class TransactionCreate(TransactionBase):
    """Transaction creation schema"""
    tenant_id: int
    reference_id: str | None = None


class TransactionUpdate(BaseModel):
    """Transaction update schema"""
    status: TransactionStatus


class TransactionInDB(TransactionBase):
    """Transaction in database schema"""
    id: int
    tenant_id: int
    status: TransactionStatus
    reference_id: str | None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class TransactionResponse(TransactionInDB):
    """Transaction response schema"""
    pass
