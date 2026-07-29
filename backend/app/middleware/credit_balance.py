"""
Credit Balance Middleware.

Attaches the tenant's current credit balance to every authenticated JSON API
response via the ``X-Credit-Balance`` header. The frontend's axios interceptor
reads it and updates the credit store, so the balance stays fresh on real credit
movement (deduction / refund / recharge) without any dedicated polling.

Runs AFTER the route handler so the value reflects any deduction/refund that
happened during the request. Best-effort: a balance-lookup failure never affects
the response body or status.
"""
import logging

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

BALANCE_HEADER = "X-Credit-Balance"

# Path fragments for responses that stream bytes (media/files) or are otherwise
# not JSON the frontend parses — skip the extra query for those.
_SKIP_FRAGMENTS = ("/file", "/outputs", "/asset", "/download", "/stream", "/static/")


def _should_annotate(path: str) -> bool:
    if not path.startswith("/api/"):
        return False
    return not any(frag in path for frag in _SKIP_FRAGMENTS)


class CreditBalanceMiddleware(BaseHTTPMiddleware):
    """Stamp X-Credit-Balance onto authenticated JSON API responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Read the tenant from the header directly: the tenant contextvar set by
        # TenantContextMiddleware is cleared in its `finally` before we get here.
        tenant_id_header = request.headers.get("X-Tenant-ID")
        if not tenant_id_header or not _should_annotate(request.url.path):
            return response

        try:
            tenant_id = int(tenant_id_header)
        except ValueError:
            return response

        try:
            from app.core.credits import CreditManager
            async with AsyncSessionLocal() as db:
                balance = await CreditManager(db).get_balance(tenant_id)
            response.headers[BALANCE_HEADER] = str(balance)
        except Exception as e:  # noqa: BLE001 — never let balance lookup break the response
            logger.debug("balance header skipped for tenant %s: %s", tenant_id_header, e)

        return response
