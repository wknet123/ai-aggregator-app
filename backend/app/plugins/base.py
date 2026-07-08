"""Plugin 契约（Plugin Contract）。

Plugin 是原子能力：封装底层 gateway 的一次具体调用，产物落 MinIO。
对 LLM 暴露标准 JSON Schema 入参（供 function-calling）。

P0-a 约定：
- Plugin 不直接扣费（扣费由 executor 统一做，P0-b 落地）。
- 长任务（video/audio）P0-b 再支持 submit()+poll()；P0-a 只做同步 image。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.storage import StorageService
from app.integrations.gateway.client import GatewayClient


@dataclass
class PluginContext:
    """一次 Plugin 执行的运行时上下文（由 executor 注入）。"""
    user_id: int
    tenant_id: int
    run_id: str
    storage: StorageService
    gateway: GatewayClient


@dataclass
class PluginResult:
    """Plugin 产物统一封装。artifact 会作为结构化描述回喂给 LLM。"""
    artifact: dict                       # {type, key, note, ...} —— 产物引用 + 可读描述
    cost: int = 0
    raw_meta: dict = field(default_factory=dict)


class BasePlugin:
    """所有 Plugin 的基类。"""
    name: str = ""                       # 如 "image.generate"（唯一）
    family: str = ""                     # image | video | audio
    label: str = ""
    description: str = ""
    parameters_schema: dict = {}         # 供 LLM function-calling 的 JSON Schema
    output_type: str = "text"            # image | video | audio | text
    is_long_running: bool = False

    def cost(self, params: dict) -> int:
        """返回本次调用的积分成本（P0-a 恒 0，P0-b 对齐 pricing）。"""
        return 0

    async def execute(self, ctx: PluginContext, params: dict) -> PluginResult:
        raise NotImplementedError

    # ── function-calling 工具规格 ────────────────────────────────────────────
    @property
    def tool_name(self) -> str:
        """OpenAI function name 不允许 '.'，用 '_' 替代（dispatch 时反查）。"""
        return self.name.replace(".", "_")

    def to_openai_tool(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.tool_name,
                "description": self.description,
                "parameters": self.parameters_schema,
            },
        }
