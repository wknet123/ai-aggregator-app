"""
Tenant Context Management - Multi-tenant utilities
"""
from contextvars import ContextVar
from typing import Optional

# Context variable to store current tenant ID
_tenant_context: ContextVar[Optional[int]] = ContextVar('tenant_context', default=None)


def set_tenant_context(tenant_id: int) -> None:
    """Set current tenant ID in context"""
    _tenant_context.set(tenant_id)


def get_tenant_context() -> Optional[int]:
    """Get current tenant ID from context"""
    return _tenant_context.get()


def clear_tenant_context() -> None:
    """Clear tenant context"""
    _tenant_context.set(None)


class TenantContext:
    """Context manager for tenant operations"""
    
    def __init__(self, tenant_id: int):
        self.tenant_id = tenant_id
        self.previous_tenant = None
    
    def __enter__(self):
        self.previous_tenant = get_tenant_context()
        set_tenant_context(self.tenant_id)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.previous_tenant is not None:
            set_tenant_context(self.previous_tenant)
        else:
            clear_tenant_context()
