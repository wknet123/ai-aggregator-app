"""AI Aggregation Gateway integration (New API, OpenAI-compatible)."""
from app.integrations.gateway.client import (
    GatewayClient,
    GatewayError,
    get_gateway_client,
    get_gateway_client_for_user,
)

__all__ = ["GatewayClient", "GatewayError", "get_gateway_client", "get_gateway_client_for_user"]
