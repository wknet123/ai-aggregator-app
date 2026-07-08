"""
Tenant API endpoints
"""
from typing import Annotated
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_tenant
from app.models.tenant import Tenant
from app.schemas.tenant import TenantResponse
from app.schemas.response import ResponseBase


router = APIRouter()


@router.get("/current", response_model=ResponseBase[TenantResponse])
async def get_current_tenant_info(
    tenant: Annotated[Tenant, Depends(get_current_tenant)]
):
    """Get current tenant information"""
    return ResponseBase(
        success=True,
        message="Tenant retrieved successfully",
        data=TenantResponse.model_validate(tenant)
    )
