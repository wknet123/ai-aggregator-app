"""video.image_to_video —— 图生视频 Plugin（Seedance，首帧取上一步 image 产物）。

image_key 为上一步 image.generate 产物 artifact 里的 MinIO key；读为 bytes 作首帧传给
gateway（bytes 经 _as_data_url base64 内联，无需 gateway 访问 MinIO）。
"""
from __future__ import annotations

from app.plugins.base import BasePlugin, PluginContext, PluginResult
from app.plugins.registry import register_plugin
from app.core.pricing import plugin_cost
from app.plugins.video._common import run_seedance, _ASPECT_SCHEMA, _DURATION_SCHEMA


@register_plugin
class VideoImageToVideoPlugin(BasePlugin):
    name = "video.image_to_video"
    family = "video"
    label = "图生视频"
    description = (
        "以一张已生成/已有图片为首帧，生成一段视频。"
        "image_key 传上一步 image 工具产物返回的 key。"
    )
    output_type = "video"
    is_long_running = True

    parameters_schema = {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "运镜/动作描述（如何让首帧动起来）"},
            "image_key": {"type": "string", "description": "首帧图片的产物 key（上一步 image 工具返回）"},
            "aspect_ratio": _ASPECT_SCHEMA,
            "duration": _DURATION_SCHEMA,
        },
        "required": ["prompt", "image_key"],
    }

    def cost(self, params: dict) -> int:
        return plugin_cost(self.name, params)

    async def execute(self, ctx: PluginContext, params: dict) -> PluginResult:
        image_key = (params.get("image_key") or "").strip()
        if not image_key:
            raise ValueError("image_to_video 需要 image_key（首帧图片产物 key）")
        data, _ct = await ctx.storage.get_object_bytes(image_key)
        return await run_seedance(
            ctx, params.get("prompt", ""),
            ratio=params.get("aspect_ratio", "16:9"),
            duration=params.get("duration", 5),
            reference_image=data,
            source_hint="以指定图为首帧",
        )
