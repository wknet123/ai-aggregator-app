"""AI Aggregation Gateway integration (New API, OpenAI-compatible)."""
from app.integrations.gateway.client import GatewayClient, GatewayError, get_gateway_client

__all__ = ["GatewayClient", "GatewayError", "get_gateway_client"]
