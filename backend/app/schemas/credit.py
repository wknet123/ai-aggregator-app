"""
Credit Schemas
"""
from pydantic import BaseModel, Field
from datetime import datetime


class CreditBase(BaseModel):
    """Credit base schema"""
    balance: int = Field(..., ge=0)


class CreditCreate(CreditBase):
    """Credit creation schema"""
    tenant_id: int


class CreditUpdate(BaseModel):
    """Credit update schema"""
    balance: int = Field(..., ge=0)


class CreditInDB(CreditBase):
    """Credit in database schema"""
    id: int
    tenant_id: int
    total_recharged: int
    total_consumed: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class CreditResponse(CreditInDB):
    """Credit response schema"""
    pass


class CreditRechargeRequest(BaseModel):
    """Credit recharge request"""
    amount: int = Field(..., gt=0, description="Amount to recharge")
    payment_method: str = Field(..., description="Payment method")
    reference_id: str = Field(..., description="Payment reference ID")


class CreditDeductionRequest(BaseModel):
    """Credit deduction request"""
    amount: int = Field(..., gt=0, description="Amount to deduct")
    description: str = Field(..., description="Deduction description")
