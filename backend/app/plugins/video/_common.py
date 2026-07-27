"""视频 Plugin 共用：Seedance create + 同步轮询 + 落 MinIO（P1-b 简单版）。

用户拍板走「execute() 内同步轮询 + 拉高 worker job_timeout」，不引入 submit/poll 基建。
引擎选 Seedance（drama 生产管线已验证），单一 poll 路径，支持 ratio+duration+首帧 bytes。
首帧以 **原始 bytes** 传入 → gateway `_as_data_url` 自动 base64 内联（gateway 访问不到 MinIO）。
"""
from __future__ import annotations

import asyncio
import logging
import uuid

from app.plugins.base import PluginContext, PluginResult

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 8.0     # 秒
_POLL_MAX = 180          # ≤ 1440s，小于 worker job_timeout(1800)


def _clamp_duration(duration, lo: int = 3, hi: int = 12, default: int = 5) -> int:
    try:
        d = int(duration)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, d))


async def run_seedance(
    ctx: PluginContext, prompt: str, *, ratio: str, duration: int,
    reference_image: bytes | None = None, source_hint: str = "",
    model: str | None = None,
) -> PluginResult:
    """提交 Seedance 任务 → 同步轮询直到出片/失败 → 落 MinIO → 返回 video 产物。"""
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("视频生成需要 prompt（画面描述）")
    ratio = ratio or "16:9"
    duration = _clamp_duration(duration)

    tid = await ctx.gateway.seedance_create(
        prompt, reference_image=reference_image, ratio=ratio, duration=duration,
        model=model or None,
    )
    logger.info("seedance task %s submitted (ratio=%s dur=%s%s)", tid, ratio, duration,
                " +首帧" if reference_image else "")

    url = None
    for _ in range(_POLL_MAX):
        await asyncio.sleep(_POLL_INTERVAL)
        state = await ctx.gateway.seedance_poll(tid)
        status = state.get("status", "")
        if ctx.gateway.is_done(status) and state.get("url"):
            url = state["url"]
            break
        if ctx.gateway.is_failed(status):
            raise RuntimeError(f"视频生成失败（task {tid} 状态 {status}）")
    if not url:
        raise RuntimeError(f"视频生成超时（task {tid}，轮询 {_POLL_MAX} 次未完成）")

    data = await ctx.gateway.fetch_bytes(url)
    key = ctx.storage.agent_artifact_key(ctx.user_id, ctx.run_id, f"vid_{uuid.uuid4().hex}.mp4")
    await ctx.storage.upload_bytes(data, key, "video/mp4")
    logger.info("video → %s (%d bytes)", key, len(data))

    note = f"已生成视频（{ratio}，约 {duration}s{('，' + source_hint) if source_hint else ''}），提示词：{prompt[:60]}"
    return PluginResult(
        artifact={"type": "video", "key": key, "aspect_ratio": ratio,
                  "duration": duration, "note": note},
        cost=0,
    )


_ASPECT_SCHEMA = {
    "type": "string",
    "enum": ["16:9", "9:16", "1:1"],
    "default": "16:9",
    "description": "画面比例",
}
_DURATION_SCHEMA = {
    "type": "integer",
    "default": 5,
    "description": "视频时长（秒，3-12）",
}


def _model_schema(plugin_name: str) -> dict:
    """按插件的候选模型清单构造 model 字段 schema。"""
    from app.core.pricing import model_options
    return {
        "type": "string",
        "enum": [o["model"] for o in model_options(plugin_name)],
        "description": "视频模型（不填用影视级默认）；经济模型积分更低。",
    }
