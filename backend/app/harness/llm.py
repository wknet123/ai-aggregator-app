"""LLM 大脑装配：gateway 是 OpenAI 兼容（已实测 function-calling），直接用 ChatOpenAI 指过去。

注意分层：
- 本模块只承载「大脑」（agent 节点的推理 + tool 决策），走标准 /chat/completions。
- Plugin 的实际能力（生图/视频）由 app.plugins.* 直接调 GatewayClient 的专有端点，不经此。
"""
from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.config import settings


def get_llm(model: str | None = None, temperature: float = 0.3) -> ChatOpenAI:
    """返回指向聚合网关的 ChatOpenAI（OpenAI 兼容）。"""
    return ChatOpenAI(
        base_url=settings.AI_GATEWAY_BASE_URL,
        api_key=settings.AI_GATEWAY_API_KEY,
        model=model or settings.GATEWAY_TEXT_MODEL,
        temperature=temperature,
        max_tokens=1024,
        timeout=60,
    )
