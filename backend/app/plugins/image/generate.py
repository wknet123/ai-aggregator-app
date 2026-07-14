"""image.generate —— 文生图 Plugin（复用 GatewayClient.generate_image，产物落 MinIO）。"""
from __future__ import annotations

import logging
import uuid

from app.plugins.base import BasePlugin, PluginContext, PluginResult
from app.plugins.registry import register_plugin
from app.core.pricing import plugin_cost

logger = logging.getLogger(__name__)

# aspect_ratio → wan 尺寸（对齐 GatewayClient.generate_image 的 size 语义 "W*H"）
_RATIO_SIZE = {
    "1:1":  "1024*1024",
    "9:16": "768*1344",
    "16:9": "1344*768",
}


@register_plugin
class ImageGeneratePlugin(BasePlugin):
    name = "image.generate"
    family = "image"
    label = "生成图片"
    description = "根据文本提示词生成一张图片。需要产出图片时调用本工具。"
    output_type = "image"
    is_long_running = False

    def cost(self, params: dict) -> int:
        """文生图积分成本（对齐 core/pricing）。"""
        return plugin_cost(self.name, params)
    parameters_schema = {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "详细的画面描述（越具体越好）"},
            "aspect_ratio": {
                "type": "string",
                "enum": ["1:1", "9:16", "16:9"],
                "default": "1:1",
                "description": "画面比例",
            },
            "image_key": {
                "type": "string",
                "description": "参考图的存储 key（做图生图/以图改图时提供；用户上传或前序产物的 key）。不提供则为纯文生图。",
            },
        },
        "required": ["prompt"],
    }

    async def execute(self, ctx: PluginContext, params: dict) -> PluginResult:
        prompt = (params.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("image.generate 需要 prompt")
        ratio = params.get("aspect_ratio", "1:1")
        size = _RATIO_SIZE.get(ratio, "1024*1024")

        # 0) 可选参考图：读取字节做图生图（底层 gateway.generate_image 支持 image 入参）
        ref_image = None
        image_key = (params.get("image_key") or "").strip()
        if image_key:
            ref_image, _ = await ctx.storage.get_object_bytes(image_key)

        # 1) 调 gateway 生图（有参考图则为图生图）→ 拿结果 URL
        urls = await ctx.gateway.generate_image(prompt, size=size, n=1, image=ref_image)
        if not urls:
            raise RuntimeError("gateway 未返回图片")

        # 2) 拉取字节 → 落 MinIO（agent 产物目录）
        data = await ctx.gateway.fetch_bytes(urls[0])
        key = ctx.storage.agent_artifact_key(ctx.user_id, ctx.run_id, f"img_{uuid.uuid4().hex}.png")
        await ctx.storage.upload_bytes(data, key, "image/png")
        logger.info("image.generate → %s (%d bytes, i2i=%s)", key, len(data), bool(image_key))

        # 3) 结构化产物（回喂 LLM 的是 note 文本 + 引用；LLM 看不到图本身——P0-a 无视觉）
        note = f"已生成图片（{ratio}），提示词：{prompt[:60]}"
        if image_key:
            note = f"已基于参考图生成图片（{ratio}），提示词：{prompt[:60]}"
        return PluginResult(
            artifact={
                "type": "image",
                "key": key,
                "aspect_ratio": ratio,
                "note": note,
            },
            cost=0,
        )
