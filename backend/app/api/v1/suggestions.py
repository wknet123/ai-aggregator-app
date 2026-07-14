"""
Quick Prompt Suggestions API - generates creative prompts via Gemini 2.0 Flash

Refresh strategy:
  - refresh=false: serve shared file cache (5 min TTL), else call Gemini
  - refresh=true:  always call Gemini; on failure return random sample from pool
Fallback pool has 12 prompts per category; random.sample ensures variety.
File cache at /tmp/quick_prompts_cache.json is shared across uvicorn workers.
"""
import json
import random
import time
import logging
from pathlib import Path

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel
import httpx

from app.config import settings
from app.dependencies import get_current_user
from app.integrations.gateway import get_gateway_client, get_gateway_client_for_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Fallback pool (randomly sampled when Gemini unavailable) ─────────────────

FALLBACK_POOL: dict[str, list[dict]] = {
    "image": [
        {"icon": "🌃", "label": "霓虹城市", "prompt": "赛博朋克风格的霓虹灯城市夜景，雨天倒影，高饱和色彩"},
        {"icon": "🎨", "label": "抽象艺术", "prompt": "流动的色彩交织，蓝色和金色为主调的抽象画作"},
        {"icon": "🏔️", "label": "自然风光", "prompt": "壮丽的山脉日出，云海翻涌，金色阳光穿透云层"},
        {"icon": "🚀", "label": "科幻场景", "prompt": "未来太空站，星际飞船停靠，地球蓝色圆弧背景"},
        {"icon": "🐉", "label": "东方神话", "prompt": "水墨风格的神龙盘旋于云雾缭绕的山峰之间"},
        {"icon": "🌊", "label": "海底世界", "prompt": "深海珊瑚丛，五彩鱼群穿梭，阳光透水面折射光柱"},
        {"icon": "🏯", "label": "古风建筑", "prompt": "月色下的古代宫殿，红灯笼摇曳，庭院白雪皑皑"},
        {"icon": "🦋", "label": "梦幻花园", "prompt": "蝴蝶飞舞的魔法花园，巨大彩色花朵，奇幻光晕"},
        {"icon": "🌌", "label": "宇宙星云", "prompt": "璀璨星云中的行星，紫蓝光晕流动，宇宙深邃感"},
        {"icon": "🍃", "label": "禅意山水", "prompt": "淡墨山水意境，远山如黛，一叶扁舟漂于平静江面"},
        {"icon": "🤖", "label": "机甲战士", "prompt": "未来风格机甲战士立于霓虹城市之上，金属质感"},
        {"icon": "🌸", "label": "樱花古道", "prompt": "日式樱花小道，花瓣如雪飘落，石灯笼，晨雾轻柔"},
    ],
    "video": [
        {"icon": "🌊", "label": "海浪日落", "prompt": "金色夕阳下，海浪轻拍沙滩，镜头缓缓向海平线推进"},
        {"icon": "🏙️", "label": "城市延时", "prompt": "繁忙都市十字路口延时摄影，车流如光带穿梭闪烁"},
        {"icon": "🌸", "label": "花开过程", "prompt": "微距拍摄花朵绽放全过程，花瓣逐渐展开，背景虚化"},
        {"icon": "🦅", "label": "鸟瞰飞行", "prompt": "无人机航拍掠过雪山、森林和蜿蜒河流，壮阔视角"},
        {"icon": "🌧️", "label": "雨夜街道", "prompt": "霓虹灯在湿润路面倒影，行人撑伞而过，慢镜头美感"},
        {"icon": "🌋", "label": "火山爆发", "prompt": "火山喷发震撼场景，熔岩奔涌，烟雾弥漫，航拍视角"},
        {"icon": "🐋", "label": "水下世界", "prompt": "水下拍摄鲸鱼悠游，阳光穿透水面形成梦幻光柱"},
        {"icon": "🎆", "label": "烟火绽放", "prompt": "夜空中烟花绽放慢动作，五彩光芒倒映于平静湖面"},
        {"icon": "☁️", "label": "云层穿越", "prompt": "飞机穿越云层，云海翻涌，阳光从云隙射出，极光感"},
        {"icon": "🦁", "label": "动物迁徙", "prompt": "非洲草原角马大迁徙，尘土飞扬，生命的壮观旅程"},
        {"icon": "🌿", "label": "森林晨光", "prompt": "晨光穿透树梢，雾气缥缈，一只鹿静静走过林间小径"},
        {"icon": "❄️", "label": "极地极光", "prompt": "北极冰原上绚丽极光舞动，星空清晰，冰面反光"},
    ],
}

# ── Shared file-based cache (readable by all uvicorn workers) ────────────────

_CACHE_FILE = Path("/tmp/quick_prompts_cache.json")
CACHE_TTL = 300  # seconds


def _read_cache() -> dict:
    try:
        if _CACHE_FILE.exists():
            return json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _write_cache(key: str, prompts: list, ts: float) -> None:
    try:
        cache = _read_cache()
        cache[key] = {"data": prompts, "ts": ts}
        _CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Cache write failed: {e}")


def _random_fallback(category: str) -> list[dict]:
    return random.sample(FALLBACK_POOL[category], 4)


# ── Gemini prompt template ────────────────────────────────────────────────────

_GEMINI_PROMPT = (
    "你是一个创意AI助手。请为AI{category_label}生成平台生成4个富有创意的快速提示。\n\n"
    "要求：\n"
    "- 每个提示包含 icon（一个emoji）、label（2-4个中文字的简短标签）、"
    "prompt（15-30字的中文创作描述）\n"
    "- 内容多样化，涵盖不同风格和主题，不要重复上次的内容\n"
    "- 描述具体、有画面感，能激发用户创作灵感\n"
    '- 返回严格的 JSON 格式：{{"prompts": [{{"icon": "...", "label": "...", "prompt": "..."}}]}}'
)


class QuickPromptsResponse(BaseModel):
    prompts: list[dict]
    source: str  # "ai" or "fallback"


@router.get("/quick-prompts", response_model=QuickPromptsResponse)
async def get_quick_prompts(
    request: Request,
    category: str = Query("image", regex="^(image|video)$"),
    refresh: bool = Query(False),
):
    """
    Generate creative quick prompts for the portal page.
    Public endpoint — no auth required, no credits consumed.
    """
    now = time.time()
    cache_key = f"quick_prompts_{category}"

    # ── Serve from shared cache when not refreshing ───────────────────────
    if not refresh:
        entry = _read_cache().get(cache_key)
        if entry and now - entry["ts"] < CACHE_TTL:
            return QuickPromptsResponse(prompts=entry["data"], source="ai")

    # ── No gateway key → random fallback ──────────────────────────────────
    if not settings.AI_GATEWAY_API_KEY:
        return QuickPromptsResponse(prompts=_random_fallback(category), source="fallback")

    # ── Call deepseek-v4-flash via the aggregation gateway ────────────────
    category_label = "图片" if category == "image" else "视频"
    try:
        prompt_text = _GEMINI_PROMPT.format(category_label=category_label)
        raw = await get_gateway_client_for_user(None).chat(
            [{"role": "user", "content": prompt_text}],
            temperature=1.2,
            max_tokens=500,
            json_mode=True,
            timeout=15.0,
        )
        content = json.loads(raw)
        if isinstance(content, list):
            content = content[0]
        prompts = content["prompts"]

        if (
            not isinstance(prompts, list)
            or len(prompts) != 4
            or not all(
                isinstance(p, dict) and {"icon", "label", "prompt"} <= p.keys()
                for p in prompts
            )
        ):
            raise ValueError("Unexpected prompt structure")

        _write_cache(cache_key, prompts, now)
        return QuickPromptsResponse(prompts=prompts, source="ai")

    except Exception as exc:
        logger.warning("Quick-prompts generation failed (%s): %s", category, exc)
        # Always return a fresh random sample so the user sees variety
        return QuickPromptsResponse(prompts=_random_fallback(category), source="fallback")


# ── Prompt Polish ─────────────────────────────────────────────────────────────

_POLISH_SYSTEM_IMAGE = (
    "你是一位专业的 AI 图像/视频生成提示词工程师。"
    "用户会给你一段简短的中文描述，你需要将其润色扩写成高质量的生成提示词。\n\n"
    "要求：\n"
    "- 保留用户原始意图，不改变主题\n"
    "- 补充光线、色调、风格、构图、细节等描述，使画面感更强\n"
    "- 字数控制在 50-120 字之间\n"
    "- 只返回润色后的提示词文本，不要任何解释或标点符号之外的内容\n"
    "- 用中文输出"
)

_POLISH_SYSTEM_DRAMA = (
    "你是一位专业的短剧/微短剧编剧顾问。"
    "用户会给你一段故事概念或剧情描述，你需要将其润色扩写，使其更具吸引力和戏剧张力。\n\n"
    "要求：\n"
    "- 保留用户原始故事核心，不改变主题和人物关系\n"
    "- 强化人物性格反差、情感冲突、戏剧钩子，增加代入感\n"
    "- 突出核心矛盾和情节反转点，让故事更抓人\n"
    "- 字数控制在 80-200 字之间\n"
    "- 只返回润色后的故事概念文本，不要任何解释\n"
    "- 用中文输出"
)

_POLISH_SYSTEM_SKILL = (
    "你是一位 AI 智能体「技能」设计专家。技能说明（instructions）是一段会被注入智能体"
    "system prompt 的方法论提示词，用来规范智能体在某类创作任务中的工作方式。\n"
    "用户会给你一段简短的技能说明草稿（或模板样例），你需要将其润色扩写成结构清晰、"
    "可直接使用的技能说明。\n\n"
    "要求：\n"
    "- 保留用户原始意图与领域，不改变技能主题\n"
    "- 用祈使句写给「智能体」，明确角色定位、适用场景、分步骤的工作方法与产出要求\n"
    "- 可包含质量约束与注意事项，但不要编造具体的插件/工具名\n"
    "- 用分点或小标题组织，条理清晰，篇幅控制在 150-400 字\n"
    "- 只返回润色后的技能说明正文，不要任何前后缀、解释或引号\n"
    "- 用中文输出"
)

_POLISH_SYSTEM_AGENT = (
    "你是一位 AI 智能体「人设」设计专家。人设（persona）是一段会作为智能体 system prompt "
    "的角色设定，用来定义这个智能体是谁、目标是什么、怎么工作、有哪些边界。\n"
    "用户会给你一段简短的人设草稿（或模板样例），你需要将其润色扩写成结构清晰、"
    "可直接使用的智能体人设。\n\n"
    "要求：\n"
    "- 保留用户原始意图与领域，不改变智能体的角色定位\n"
    "- 用第二人称「你是……」写给智能体本身，明确：角色定位、核心目标、工作方式与风格、行为边界\n"
    "- 侧重「是谁/做什么/怎么做」的整体设定，不要写成分镜/画面提示词，也不要编造具体插件/工具名\n"
    "- 可分点或小标题组织，条理清晰，篇幅控制在 150-400 字\n"
    "- 只返回润色后的人设正文，不要任何前后缀、解释或引号\n"
    "- 用中文输出"
)


class PolishRequest(BaseModel):
    prompt: str
    category: str = "image"   # "image" | "video" | "drama" | "skill" | "agent"


class PolishResponse(BaseModel):
    polished: str


@router.post("/polish-prompt", response_model=PolishResponse)
async def polish_prompt(
    body: PolishRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Enhance / expand a short user prompt using Gemini.
    Requires login; does NOT consume credits.
    """
    raw = body.prompt.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="prompt is empty")

    is_drama = body.category == "drama"
    is_skill = body.category == "skill"
    is_agent = body.category == "agent"
    max_len = 800 if (is_drama or is_skill or is_agent) else 500
    if len(raw) > max_len:
        raise HTTPException(status_code=400, detail="prompt too long")

    if not settings.AI_GATEWAY_API_KEY:
        raise HTTPException(status_code=503, detail="AI润色服务未配置")

    if is_drama:
        system_prompt = _POLISH_SYSTEM_DRAMA
        user_msg = f"请润色以下短剧故事概念：\n\n{raw}"
        max_tokens = 500
    elif is_skill:
        system_prompt = _POLISH_SYSTEM_SKILL
        user_msg = f"请润色以下智能体技能说明：\n\n{raw}"
        max_tokens = 700
    elif is_agent:
        system_prompt = _POLISH_SYSTEM_AGENT
        user_msg = f"请润色以下智能体人设：\n\n{raw}"
        max_tokens = 700
    else:
        system_prompt = _POLISH_SYSTEM_IMAGE
        category_hint = "视频" if body.category == "video" else "图像"
        user_msg = f"这是用于AI{category_hint}生成的提示词，请润色：\n\n{raw}"
        max_tokens = 300

    try:
        polished = (await get_gateway_client_for_user(current_user.id).chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.8,
            max_tokens=max_tokens,
            timeout=45.0,
        )).strip()
        return PolishResponse(polished=polished)

    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 429:
            raise HTTPException(status_code=429, detail="AI请求过于频繁，请稍等片刻再试")
        logger.warning("Polish failed: %s", exc)
        raise HTTPException(status_code=502, detail="AI润色服务暂时不可用，请稍后重试")
    except Exception as exc:
        logger.warning("Polish error: %s", exc)
        raise HTTPException(status_code=502, detail="AI润色服务暂时不可用，请稍后重试")
