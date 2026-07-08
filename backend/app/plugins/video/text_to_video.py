"""video.text_to_video —— 文生视频 Plugin（Seedance，同步轮询）。"""
from __future__ import annotations

from app.plugins.base import BasePlugin, PluginContext, PluginResult
from app.plugins.registry import register_plugin
from app.core.pricing import plugin_cost
from app.plugins.video._common import run_seedance, _ASPECT_SCHEMA, _DURATION_SCHEMA


@register_plugin
class VideoTextToVideoPlugin(BasePlugin):
    name = "video.text_to_video"
    family = "video"
    label = "文生视频"
    description = "根据文本提示词直接生成一段视频。无需参考图时使用。"
    output_type = "video"
    is_long_running = True

    parameters_schema = {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "详细的画面/动作描述（越具体越好）"},
            "aspect_ratio": _ASPECT_SCHEMA,
            "duration": _DURATION_SCHEMA,
        },
        "required": ["prompt"],
    }

    def cost(self, params: dict) -> int:
        return plugin_cost(self.name, params)

    async def execute(self, ctx: PluginContext, params: dict) -> PluginResult:
        return await run_seedance(
            ctx, params.get("prompt", ""),
            ratio=params.get("aspect_ratio", "16:9"),
            duration=params.get("duration", 5),
        )
