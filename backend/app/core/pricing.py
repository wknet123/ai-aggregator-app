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

# Plugin 名 → 单次成本（harness 扣费口径；未指定 model 时的默认价）
PLUGIN_COST = {
    "image.generate": IMAGE,
    "video.text_to_video": VIDEO_SEEDANCE,
    "video.image_to_video": VIDEO_SEEDANCE,
}

# 智能体可选模型清单：plugin 名 → [{model, label, cost, desc}]。
# 供工作台"按需求+单价选模型"：前端展示、后端按所选 model 计价并透传 gateway。
# 各清单第一项为默认（与 PLUGIN_COST 的默认价一致）。
AGENT_MODEL_OPTIONS: dict[str, list[dict]] = {
    "image.generate": [
        {"model": settings.GATEWAY_IMAGE_MODEL, "label": "标准出图", "cost": IMAGE,
         "desc": "速度快、性价比高，适合大多数场景"},
        {"model": settings.GATEWAY_IMAGE_PRO_MODEL, "label": "高清精修", "cost": IMAGE_PRO,
         "desc": "细节更精细、质感更强，适合主图/成片"},
    ],
    "video.text_to_video": [
        {"model": settings.GATEWAY_DRAMA_VIDEO_MODEL, "label": "Seedance 影视级", "cost": VIDEO_SEEDANCE,
         "desc": "运镜自然、画质高，适合成片"},
        {"model": settings.GATEWAY_VIDEO_HAPPYHORSE, "label": "HappyHorse 经济", "cost": VIDEO_HAPPYHORSE,
         "desc": "更省积分，适合草稿/预览"},
    ],
    "video.image_to_video": [
        {"model": settings.GATEWAY_DRAMA_VIDEO_MODEL, "label": "Seedance 影视级", "cost": VIDEO_SEEDANCE,
         "desc": "运镜自然、画质高，适合成片"},
        {"model": settings.GATEWAY_VIDEO_HAPPYHORSE, "label": "HappyHorse 经济", "cost": VIDEO_HAPPYHORSE,
         "desc": "更省积分，适合草稿/预览"},
    ],
}


# 各模型提示词最大字符数（对齐上游实际输入长度）。
# 按模型 id 的「家族关键字」子串匹配 → 现有 id 均可命中：
#   happyhorse-1.0 → 8000 / MiniMax/MiniMax-Hailuo-2.3 → 5000 /
#   doubao-seedance-2-0-* → 8000 / wan2.7-image[-pro] → 4000。
DEFAULT_MAX_PROMPT_CHARS = 4000
MODEL_MAX_PROMPT_CHARS: dict[str, int] = {
    "happyhorse": 8000,
    "hailuo": 5000,
    "minimax": 5000,      # MiniMax/MiniMax-Hailuo-2.3
    "seedance": 8000,
    "doubao": 8000,       # doubao-seedance-*
    "wan": 4000,          # 图像 wan2.7-image / -pro
}


def max_prompt_chars(model_id: Optional[str]) -> int:
    """按模型 id（含家族关键字子串）返回提示词最大字符数；未知用默认。"""
    if not model_id:
        return DEFAULT_MAX_PROMPT_CHARS
    m = model_id.lower()
    for key, limit in MODEL_MAX_PROMPT_CHARS.items():
        if key in m:
            return limit
    return DEFAULT_MAX_PROMPT_CHARS


def model_options(plugin_name: str) -> list[dict]:
    """某插件的可选模型清单（含单价）；无则空列表。"""
    return AGENT_MODEL_OPTIONS.get(plugin_name, [])


def plugin_cost(name: str, params: Optional[dict] = None) -> int:
    """按 plugin 名返回单次积分成本。若 params.model 命中该插件的候选模型，按其单价计。"""
    model = (params or {}).get("model")
    if model:
        for opt in AGENT_MODEL_OPTIONS.get(name, []):
            if opt["model"] == model:
                return opt["cost"]
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
