"""平台计费单一真源（P1-b）。

此前 `/pricing` 端点与各 Plugin 的 `cost()` 是两套、且后者恒 1（占位）。本模块统一：
- `pricing_table()`：供 `GET /api/v1/models/pricing` 展示（按 model 分组）。
- `PLUGIN_COST` / `plugin_cost(name, params)`：供 harness 各 Plugin 的 `cost()` 引用（按 plugin 名）。

价格口径（积分）：图 40 / 图-pro 80 / Hailuo 视频 150 / HappyHorse 视频 120 / Seedance 视频 150 / 文本 0。
"""
from __future__ import annotations

from typing import Optional

from app.config import settings

# 单位价（积分）
IMAGE = 40
IMAGE_PRO = 80
VIDEO_HAILUO = 150
VIDEO_HAPPYHORSE = 120
VIDEO_SEEDANCE = 150
TEXT = 0

# Plugin 名 → 单次成本（harness 扣费口径）
PLUGIN_COST = {
    "image.generate": IMAGE,
    "video.text_to_video": VIDEO_SEEDANCE,
    "video.image_to_video": VIDEO_SEEDANCE,
}


def plugin_cost(name: str, params: Optional[dict] = None) -> int:
    """按 plugin 名返回单次积分成本（params 预留给将来按参数分级，如 pro/时长）。"""
    return PLUGIN_COST.get(name, 0)


def pricing_table() -> dict:
    """`/pricing` 端点用：按 model 分组的展示价（与历史结构一致，新增 Seedance）。"""
    return {
        "image": {
            settings.GATEWAY_IMAGE_MODEL: {"base": IMAGE, "unit": "积分/张"},
            settings.GATEWAY_IMAGE_PRO_MODEL: {"base": IMAGE_PRO, "unit": "积分/张"},
        },
        "video": {
            settings.GATEWAY_VIDEO_HAILUO_MODEL: {"base": VIDEO_HAILUO, "unit": "积分/条"},
            settings.GATEWAY_VIDEO_HAPPYHORSE: {"base": VIDEO_HAPPYHORSE, "unit": "积分/条"},
            settings.GATEWAY_DRAMA_VIDEO_MODEL: {"base": VIDEO_SEEDANCE, "unit": "积分/条"},
        },
        "text": {
            settings.GATEWAY_TEXT_MODEL: {"base": TEXT, "unit": "免费(平台内)"},
        },
    }
