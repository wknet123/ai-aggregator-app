"""
Tenant Repository
"""
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.tenant import Tenant
from app.repositories.base import BaseRepository


class TenantRepository(BaseRepository[Tenant]):
    """Tenant repository"""
    
    def __init__(self, db: AsyncSession):
        super().__init__(Tenant, db)
    
    async def get_by_slug(self, slug: str) -> Optional[Tenant]:
        """Get tenant by slug"""
        result = await self.db.execute(
            select(Tenant).where(Tenant.slug == slug)
        )
        return result.scalar_one_or_none()
    
    async def get_active_tenants(self, skip: int = 0, limit: int = 100):
        """Get all active tenants"""
        result = await self.db.execute(
            select(Tenant)
            .where(Tenant.is_active == True)
            .offset(skip)
            .limit(limit)
        )
        return list(result.scalars().all())
