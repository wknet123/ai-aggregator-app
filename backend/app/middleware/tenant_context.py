"""
Tenant Context Middleware
"""
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.tenant import set_tenant_context, clear_tenant_context
from app.db.session import AsyncSessionLocal
from app.repositories.tenant_repository import TenantRepository


class TenantContextMiddleware(BaseHTTPMiddleware):
    """Middleware to set and validate tenant context from headers"""
    
    async def dispatch(self, request: Request, call_next):
        # Skip tenant validation for public endpoints
        public_paths = ["/api/v1/auth/login", "/api/v1/auth/register", "/health", "/", "/api/docs", "/api/redoc", "/api/openapi.json"]
        if request.url.path in public_paths:
            return await call_next(request)
        
        # Get tenant ID from header
        tenant_id_header = request.headers.get("X-Tenant-ID")
        
        if tenant_id_header:
            try:
                tenant_id = int(tenant_id_header)
                
                # Validate tenant exists and is active
                async with AsyncSessionLocal() as db:
                    tenant_repo = TenantRepository(db)
                    tenant = await tenant_repo.get(tenant_id)
                    
                    if not tenant:
                        raise HTTPException(
                            status_code=status.HTTP_404_NOT_FOUND,
                            detail="Tenant not found"
                        )
                    
                    if not tenant.is_active:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Tenant is inactive"
                        )
                
                # Set tenant context
                set_tenant_context(tenant_id)
                
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid tenant ID format"
                )
        
        try:
            response = await call_next(request)
        finally:
            # Clear tenant context after request
            clear_tenant_context()
        
        return response
