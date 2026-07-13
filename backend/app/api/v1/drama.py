"""
AI Drama (AI短剧) Generation API

Flow: story concept → episode outline → storyboard shots → images → videos
Each stage builds on the previous, sharing results via generation_task records.
"""
import asyncio
import functools
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from typing import Optional
from pathlib import Path
from urllib.parse import quote
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, field_validator
from app.config import settings
from app.dependencies import get_current_user
from app.integrations.gateway import get_gateway_client, get_gateway_client_for_user
from app.models.user import User
from app.schemas.response import ResponseBase

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response schemas ────────────────────────────────────────────────

class OutlineRequest(BaseModel):
    concept: str              # User's story idea / novel synopsis
    genre: str = "都市"       # 都市 / 古风 / 悬疑 / 玄幻 / 爱情 / 励志
    art_style: str = "写实"  # 写实 / 动漫 / 漫画 / 国风
    aspect_ratio: str = "9:16"
    episode_count: int = 3   # How many episodes to plan
    materials_context: Optional[str] = None  # Serialized material descriptions for prompt injection


class CharacterItem(BaseModel):
    name: str
    description: str


class SceneItem(BaseModel):
    name: str
    description: str


class EpisodeOutline(BaseModel):
    episode: int
    title: str
    outline: str             # 100-200 word plot summary
    opening_hook: str        # Cinematic first shot
    ending_hook: str         # Cliffhanger for next episode
    characters: list[CharacterItem]
    scenes: list[SceneItem]
    key_events: list[str]    # 4 plot points: 起/承/转/合
    emotional_curve: str


class OutlineResponse(BaseModel):
    genre: str
    art_style: str
    aspect_ratio: str
    episodes: list[EpisodeOutline]


class StoryboardRequest(BaseModel):
    episode: EpisodeOutline
    art_style: str = "写实"
    aspect_ratio: str = "9:16"
    shot_count: int = 6      # Shots per episode (3-20)
    materials_context: Optional[str] = None  # Serialized material descriptions for prompt injection

    @field_validator('shot_count')
    @classmethod
    def validate_shot_count(cls, v: int) -> int:
        if v < 3 or v > 20:
            raise ValueError("shot_count must be between 3 and 20")
        return v


class ShotItem(BaseModel):
    index: int
    prompt: str              # English image generation prompt
    prompt_cn: str           # Chinese description for reference
    shot_type: str           # close-up / medium / wide / aerial / POV
    scene: str               # Which scene from outline
    characters: list[str]    # Character names in this shot
    props: list[str] = []    # Prop/accessory names referenced in this shot
    duration_hint: str       # e.g. "2-3s"


class StoryboardResponse(BaseModel):
    episode: int
    title: str
    shots: list[ShotItem]


# ── Shared text-reasoning helper (aggregation gateway → deepseek-v4-flash) ─────

async def _call_text(prompt: str, timeout: float = 30.0, user_id: int | None = None) -> str:
    """Call deepseek-v4-flash and return plain text (no JSON constraint)."""
    if not settings.AI_GATEWAY_API_KEY:
        raise HTTPException(status_code=503, detail="AI 网关未配置 (AI_GATEWAY_API_KEY)")

    raw = (await get_gateway_client_for_user(user_id).chat(
        [{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=1024,
        timeout=timeout,
    )).strip()
    # Strip surrounding quotes and markdown code fences the model sometimes adds
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        raw = raw[1:-1]
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]  # remove first ```lang line
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    return raw.strip()


async def _call_json(prompt: str, timeout: float = 60.0, user_id: int | None = None) -> str:
    """Call deepseek-v4-flash in JSON mode and return raw JSON text. Retries on 429."""
    if not settings.AI_GATEWAY_API_KEY:
        raise HTTPException(status_code=503, detail="AI 网关未配置 (AI_GATEWAY_API_KEY)")

    return await get_gateway_client_for_user(user_id).chat(
        [{"role": "user", "content": prompt}],
        temperature=0.85,
        max_tokens=8192,
        json_mode=True,
        timeout=timeout,
    )


# 真人合规规范 (注入大纲/剧本/分镜系统提示词)。下游图像/视频模型(尤其 Seedance 2.0)对
# "可识别真人"做三重风控(人脸检测+姓名黑名单+成片核验),命中即拒。从源头让 AI 只产出虚构
# 角色名 + 泛化外貌描述,可降低被拦截概率;真的被拦截时,网关层会把平台的实际错误消息原样回传。
REAL_PERSON_SAFETY_RULES = """【真人合规规范 - 必须严格遵守】
- 严禁使用任何真实公众人物的姓名（明星、艺人、网红、主播、政界/商界名人等），也不得描述"神似/酷似某真人"。
- 严禁使用现实中可对应到特定真人的真实全名；所有角色一律使用虚构的中文角色名（如"林晚""沈舟"）。
- 角色外貌只能用"泛化描述"刻画：年龄段 + 性别 + 族裔 + 气质 + 发型 + 服装，
  例："二十多岁的亚洲女性，长发，知性气质，米色风衣"；禁止"长得像XXX""XX明星同款脸"等表述。
- 英文 prompt 同理：只用泛化描述（如 "a young Asian woman in her twenties, long hair"），绝不出现真实人名。"""


# ── Outline endpoint ──────────────────────────────────────────────────────────

OUTLINE_SYSTEM_PROMPT = """你是一位专业的短剧编剧和AI短剧工厂制片人。请根据用户提供的故事概念，生成结构化的短剧集数大纲。

输出要求：
- 严格按照 JSON 格式输出，不要有其他内容
- 每集必须有强烈的开篇钩子(opening_hook)和结尾悬念(ending_hook)
- 角色描述要具体（外貌、年龄、气质），便于后续图像生成
- 场景描述要有视觉感（光线、空间、氛围）
- key_events 严格按 [起, 承, 转, 合] 四个节点
- 如果用户提供了【素材参考】中的【角色设定】、【布景设定】、【辅助附件】，角色和场景的描述必须严格遵循素材中给出的外貌、服装、布景细节、道具等设定，保持全剧视觉一致性
- 场景描述应关联使用素材中定义的布景和辅助附件
- 每集应明确列出出现的关键道具/附件，便于后续分镜和图像生成

【角色统一卡规范 - 极其重要】
- 遇到【角色统一卡】标记的角色，必须严格使用卡中的每一项视觉特征（面部、服装、身材、配饰）
- 角色名全程统一，禁止使用"她/他/女生/男生"等代词替代角色名
- 角色描述必须与统一卡完全一致，不得改写或省略任何视觉特征
- 锁定角色必须在每集大纲中出现

JSON Schema:
{
  "episodes": [
    {
      "episode": 1,
      "title": "8字以内的标题，含情绪爆点",
      "outline": "100-200字剧情主干，按时间顺序叙述",
      "opening_hook": "开篇第一个镜头的视觉化描述，30字以内",
      "ending_hook": "结尾悬念延伸，勾引下集，30字以内",
      "characters": [
        {"name": "角色名", "description": "年龄+外貌+气质+服装的具体描述，50字以内"}
      ],
      "scenes": [
        {"name": "场景名", "description": "空间结构+光线氛围+环境细节+使用的布景/道具，40字以内"}
      ],
      "key_events": ["起：...", "承：...", "转：...", "合：..."],
      "emotional_curve": "情绪曲线，如：2(压抑)→5(反抗)→9(爆发)→3(余波)"
    }
  ]
}"""


@router.post("/outline")
async def generate_outline(
    req: OutlineRequest,
    current_user: User = Depends(get_current_user),
) -> OutlineResponse:
    """
    Stage 1: Generate multi-episode story outline from concept.
    Uses Gemini to produce structured episode data including characters, scenes, and plot beats.
    """
    materials_block = ""
    if req.materials_context:
        materials_block = f"""

【素材参考 - 必须严格遵循以下设定】
{req.materials_context}

注意：标记为（锁定）的角色是全剧核心角色，必须在每集大纲中出现，其外貌和人设描述必须与素材完全一致。
"""

    user_prompt = f"""故事类型: {req.genre}
画面风格: {req.art_style}
画幅比例: {req.aspect_ratio}
集数: {req.episode_count} 集

故事概念:
{req.concept}
{materials_block}
请生成 {req.episode_count} 集的短剧大纲，每集时长约 3-5 分钟（约 15-20 个镜头）。
注意: 角色设定要贯穿全剧保持一致，场景可复用。"""

    raw = await _call_json(f"{OUTLINE_SYSTEM_PROMPT}\n\n{user_prompt}", user_id=current_user.id)

    try:
        data = json.loads(raw)
        episodes = [EpisodeOutline(**ep) for ep in data["episodes"]]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.error(f"Gemini outline parse error: {exc}\nraw={raw[:500]}")
        raise HTTPException(status_code=502, detail="AI 大纲生成失败，请重试")

    return OutlineResponse(
        genre=req.genre,
        art_style=req.art_style,
        aspect_ratio=req.aspect_ratio,
        episodes=episodes,
    )


# ── Script parsing endpoint (剧本生短剧) ──────────────────────────────────────

class ParseScriptRequest(BaseModel):
    script_text: str                       # Full pasted/uploaded script
    genre: str = "都市"
    art_style: str = "写实"
    aspect_ratio: str = "9:16"
    episode_count: int = 0                  # 0 = auto-detect from the script
    materials_context: Optional[str] = None


PARSE_SCRIPT_SYSTEM_PROMPT = """你是一位专业的短剧制片人和分集编剧。用户会提供一整本剧本，请你忠实地解析并结构化拆解，而不是另行创作。

输出要求：
- 严格按照 JSON 格式输出，不要有其他内容
- 必须忠于原剧本：角色、情节、场景、台词走向都以剧本为准，禁止虚构剧本中不存在的主线剧情
- 按剧本自身的叙事节奏自动拆分为「剧集」，每集再归纳出现的「场次/场景」
- 若用户指定了集数，严格拆成该集数；若集数为 0，则根据剧本长度与情节起伏自行决定合理集数（通常 1-12 集）
- 每集必须提炼强开篇钩子(opening_hook)和结尾悬念(ending_hook)
- 角色描述要具体（外貌、年龄、气质、服装），便于后续图像生成；同一角色在各集描述保持一致
- 场景描述要有视觉感（光线、空间、氛围）
- key_events 严格按 [起, 承, 转, 合] 四个节点，概括该集核心情节
- 如果用户提供了【素材参考】，角色和场景描述必须与素材中的设定保持一致

【角色统一卡规范 - 极其重要】
- 遇到【角色统一卡】标记的角色，必须严格使用卡中的每一项视觉特征（面部、服装、身材、配饰）
- 角色名全程统一，禁止使用"她/他/女生/男生"等代词替代角色名

JSON Schema:
{
  "episodes": [
    {
      "episode": 1,
      "title": "8字以内的标题，含情绪爆点",
      "outline": "100-200字本集剧情概括，忠于原剧本，按时间顺序叙述",
      "opening_hook": "本集开篇第一个镜头的视觉化描述，30字以内",
      "ending_hook": "本集结尾悬念，勾引下集，30字以内",
      "characters": [
        {"name": "角色名", "description": "年龄+外貌+气质+服装的具体描述，50字以内"}
      ],
      "scenes": [
        {"name": "场景名", "description": "空间结构+光线氛围+环境细节，40字以内"}
      ],
      "key_events": ["起：...", "承：...", "转：...", "合：..."],
      "emotional_curve": "情绪曲线，如：2(压抑)→5(反抗)→9(爆发)→3(余波)"
    }
  ]
}"""


@router.post("/parse-script")
async def parse_script(
    req: ParseScriptRequest,
    current_user: User = Depends(get_current_user),
) -> OutlineResponse:
    """
    剧本生短剧: parse a full uploaded/pasted script into a structured multi-episode
    outline (剧集/场次/角色/情节节点). Returns the same OutlineResponse shape as
    /outline so the downstream storyboard → image → video pipeline is unchanged.
    """
    if not req.script_text or not req.script_text.strip():
        raise HTTPException(status_code=400, detail="剧本内容不能为空")

    materials_block = ""
    if req.materials_context:
        materials_block = f"""

【素材参考 - 角色/场景描述必须遵循以下设定】
{req.materials_context}
"""

    ep_instruction = (
        f"目标集数: 自动判断合理集数" if req.episode_count <= 0
        else f"目标集数: 严格拆成 {req.episode_count} 集"
    )

    user_prompt = f"""故事类型: {req.genre}
画面风格: {req.art_style}
画幅比例: {req.aspect_ratio}
{ep_instruction}

完整剧本如下（请忠实解析，不要另行创作）:
\"\"\"
{req.script_text.strip()}
\"\"\"
{materials_block}
请把上面的剧本解析为结构化的分集大纲，忠于原剧本的人物与情节。"""

    raw = await _call_json(f"{PARSE_SCRIPT_SYSTEM_PROMPT}\n\n{user_prompt}", user_id=current_user.id)

    try:
        data = json.loads(raw)
        episodes = [EpisodeOutline(**ep) for ep in data["episodes"]]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.error(f"Script parse error: {exc}\nraw={raw[:500]}")
        raise HTTPException(status_code=502, detail="AI 剧本解析失败，请重试")

    return OutlineResponse(
        genre=req.genre,
        art_style=req.art_style,
        aspect_ratio=req.aspect_ratio,
        episodes=episodes,
    )


# ── Storyboard endpoint ───────────────────────────────────────────────────────

STORYBOARD_SYSTEM_PROMPT = """你是一位专业的短剧分镜师。根据剧集大纲，为每个叙事片段生成分镜脚本。

输出要求：
- 严格按照 JSON 格式输出
- prompt 字段必须是英文，用于 AI 图像生成（Flux/Stable Diffusion），要求详细描述画面构图、光线、人物动作
- prompt_cn 是对应的中文说明
- shot_type 只能是: close-up / medium / wide / aerial / POV
- characters 列表只包含该镜头出现的角色名，必须与大纲中的角色名完全一致
- props 列表包含该镜头中出现的道具/附件名称（如有），必须与素材中的辅助附件名称一致
- 每个镜头的 prompt 要包含: 画面内容 + 拍摄角度 + 光线环境 + 画面风格
- 如果用户提供了【素材参考】，每个镜头的英文 prompt 必须严格包含素材中对角色外貌、服装、布景细节、辅助附件/道具的描述，确保生成图像的视觉一致性
- 布景素材的描述应融入 scene 对应的 prompt 中
- 辅助附件/道具素材的描述应融入出现该道具的镜头 prompt 中

【角色统一卡规范 - 极其重要】
- 遇到【角色统一卡】标记的角色，英文 prompt 必须完整包含统一卡中的所有视觉特征
- 英文 prompt 中角色描述格式: "same person as [角色名], face({面部特征}), wearing({服装}), {身材体态}"
- 如有标志性特征、配饰，必须在每次出镜时精确描述
- 【禁止代词】英文 prompt 中绝对禁止使用任何代词指代角色，包括但不限于:
  she / he / her / him / his / hers / they / them / their / theirs，
  以及 a girl / the girl / a boy / the boy / a woman / the woman / a man / the man /
  the lady / the person / the figure 等泛指说法。
  每次提及角色都必须直接使用【角色名】，即使同一句中重复出现也必须重复角色名。
  ✗ 错误示例: "Alice opens the door, then he walks in slowly"
  ✓ 正确示例: "Alice opens the door, then Alice walks in slowly"
- 每次角色出现必须完整复制统一卡中的外貌描述，不得改写或省略

【角色面部一致性规范 - 极其重要】
- 每个角色在所有镜头中必须保持完全一致的面部特征描述
- 角色首次出现时定义的外貌描述，后续所有镜头必须逐字复制，不得改写或省略
- 对于特写镜头(close-up)，必须额外添加: "maintaining exact facial features and expression style consistent with previous shots"

【风格一致性规范】
- 所有镜头必须保持统一的画面风格，禁止跨风格混用
- 写实风格不可混入动漫/3D元素；动漫风格不可混入写实/3D元素
- 每个 prompt 的风格描述必须与用户指定的「画面风格」一致

JSON Schema:
{
  "shots": [
    {
      "index": 1,
      "prompt": "English image prompt for AI generation, detailed, cinematic",
      "prompt_cn": "中文分镜描述",
      "shot_type": "close-up",
      "scene": "场景名（必须与大纲中场景名一致）",
      "characters": ["角色名1"],
      "props": ["道具名1"],
      "duration_hint": "2-3s"
    }
  ]
}"""


# 把真人合规规范注入三个系统提示词(在 JSON Schema 说明之前),源头杜绝真人姓名/肖像。
OUTLINE_SYSTEM_PROMPT = OUTLINE_SYSTEM_PROMPT.replace(
    "JSON Schema:", REAL_PERSON_SAFETY_RULES + "\n\nJSON Schema:", 1
)
PARSE_SCRIPT_SYSTEM_PROMPT = PARSE_SCRIPT_SYSTEM_PROMPT.replace(
    "JSON Schema:", REAL_PERSON_SAFETY_RULES + "\n\nJSON Schema:", 1
)
STORYBOARD_SYSTEM_PROMPT = STORYBOARD_SYSTEM_PROMPT.replace(
    "JSON Schema:", REAL_PERSON_SAFETY_RULES + "\n\nJSON Schema:", 1
)


@router.post("/storyboard")
async def generate_storyboard(
    req: StoryboardRequest,
    current_user: User = Depends(get_current_user),
) -> StoryboardResponse:
    """
    Stage 2: Generate shot list from episode outline.
    Each shot includes an English image generation prompt for use with Flux/Imagen.
    """
    ep = req.episode
    chars_text = "\n".join(
        f"- {c.name}: {c.description}" for c in ep.characters
    )
    scenes_text = "\n".join(
        f"- {s.name}: {s.description}" for s in ep.scenes
    )

    materials_block = ""
    if req.materials_context:
        materials_block = f"""

【素材参考 - 每个镜头的英文 prompt 必须包含以下角色/布景/道具的视觉描述】
{req.materials_context}

注意：标记为（锁定）的角色是全剧核心角色，必须在每集分镜中合理出现，其外貌描述必须在所有镜头中保持完全一致，不可省略或改写。
"""

    user_prompt = f"""第 {ep.episode} 集: {ep.title}

剧情主干:
{ep.outline}

开篇镜头: {ep.opening_hook}
结尾悬念: {ep.ending_hook}

关键节点:
{chr(10).join(ep.key_events)}

情绪曲线: {ep.emotional_curve}

角色列表:
{chars_text}

场景列表:
{scenes_text}

画面风格: {req.art_style}
画幅比例: {req.aspect_ratio}
{materials_block}
请生成 {req.shot_count} 个分镜，按叙事顺序从开篇镜头到结尾悬念全部覆盖。
重要:
1. 角色名和场景名必须与上面列表完全一致
2. prompt 必须是英文，适合 Flux Kontext/Stable Diffusion 的提示词风格
3. 根据画幅 {req.aspect_ratio} 描述构图（竖幅注重人物正面/表情，横幅注重场景全景）"""

    raw = await _call_json(f"{STORYBOARD_SYSTEM_PROMPT}\n\n{user_prompt}", user_id=current_user.id)

    try:
        data = json.loads(raw)
        shots = [ShotItem(**s) for s in data["shots"]]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.error(f"Gemini storyboard parse error: {exc}\nraw={raw[:500]}")
        raise HTTPException(status_code=502, detail="AI 分镜生成失败，请重试")

    return StoryboardResponse(
        episode=ep.episode,
        title=ep.title,
        shots=shots,
    )



# ── Multimodal reference asset upload (落 MinIO drama refs/audio) ──────────────

# Coarse content-type guards for reference media.
_ASSET_VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"}
_ASSET_AUDIO_TYPES = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/ogg", "audio/mp4"}
_ASSET_MAX_BYTES = 50 * 1024 * 1024   # 50MB ceiling for reference video/audio


@router.post("/upload-asset", response_model=ResponseBase)
async def upload_asset(
    file: UploadFile = File(...),
    drama_project_id: str = Form(...),
    asset_type: str = Form(...),        # 'video' | 'audio' | 'image'
    current_user: User = Depends(get_current_user),
):
    """
    Upload a multimodal reference asset (参考视频 / 参考音频 / 参考图) to MinIO under the
    project's drama paths. Returns the MinIO object key; generate-shot-video turns it into
    a presigned public URL for Seedance (when MINIO_PUBLIC_ENDPOINT is configured).
    """
    from app.services.storage import get_storage_service

    if asset_type not in ("video", "audio", "image"):
        raise HTTPException(status_code=400, detail="asset_type 必须是 video / audio / image")

    contents = await file.read()
    if len(contents) > _ASSET_MAX_BYTES:
        raise HTTPException(status_code=400, detail="文件过大（参考视频/音频上限 50MB）")

    ctype = file.content_type or "application/octet-stream"
    if asset_type == "video" and ctype not in _ASSET_VIDEO_TYPES:
        raise HTTPException(status_code=400, detail=f"不支持的视频格式: {ctype}")
    if asset_type == "audio" and ctype not in _ASSET_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail=f"不支持的音频格式: {ctype}")

    if not settings.MINIO_ENABLED:
        raise HTTPException(status_code=503, detail="对象存储未启用，无法上传参考素材")

    storage = get_storage_service()
    ext = Path(file.filename or "").suffix or {"video": ".mp4", "audio": ".mp3", "image": ".jpg"}[asset_type]
    filename = f"{uuid.uuid4()}{ext}"
    if asset_type == "audio":
        object_key = storage.drama_audio_key(current_user.id, drama_project_id, filename)
    else:  # video / image → refs
        object_key = storage.drama_ref_key(current_user.id, drama_project_id, filename)

    try:
        await storage.upload_bytes(contents, object_key, ctype)
    except Exception as exc:
        logger.error("upload-asset MinIO failed: %s", exc)
        raise HTTPException(status_code=500, detail="参考素材上传失败")

    return ResponseBase(
        success=True,
        message="Asset uploaded",
        data={"object_key": object_key, "asset_type": asset_type, "filename": file.filename},
    )


@router.get("/asset-preview", response_model=ResponseBase)
async def asset_preview_url(
    key: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """Return a token-signed, browser-embeddable URL for one of the user's drama assets.

    Lets the frontend preview a shot's own reference image/video/audio (stored as a MinIO
    object key) without exposing MinIO or requiring the client to sign. The key must belong
    to the requesting user's drama paths. Returns a RELATIVE /api/v1/drama/ref-asset URL so
    it resolves against the current browser origin regardless of PUBLIC_BASE_URL.
    """
    expected_prefix = f"users/{current_user.id}/"
    if not key.startswith(expected_prefix) or "/drama/" not in key or ".." in key:
        raise HTTPException(status_code=403, detail="无权访问该素材")
    exp = int(time.time()) + 3600
    sig = _sign_asset(key, exp)
    url = f"/api/v1/drama/ref-asset?key={quote(key, safe='')}&exp={exp}&sig={sig}"
    return ResponseBase(success=True, message="ok", data={"url": url})


# ── Public token-signed asset streaming (给 Seedance 拉取参考视频/音频) ─────────

_ASSET_CONTENT_TYPES = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".avi": "video/x-msvideo",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
}


def _sign_asset(object_key: str, exp: int) -> str:
    """HMAC-SHA256 over the object key + expiry, keyed by the app secret."""
    msg = f"{object_key}:{exp}".encode("utf-8")
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _public_asset_url(object_key: str, ttl_seconds: int = 3600) -> Optional[str]:
    """Build a public, token-signed streaming URL for an object, or None if not configured.

    External services (Seedance) can't reach internal MinIO; this routes through the public
    backend origin → nginx → backend → MinIO stream (no MinIO exposure, no presign host issue).
    """
    base = settings.PUBLIC_BASE_URL.rstrip("/")
    if not base:
        return None
    exp = int(time.time()) + ttl_seconds
    sig = _sign_asset(object_key, exp)
    return f"{base}/api/v1/drama/ref-asset?key={quote(object_key, safe='')}&exp={exp}&sig={sig}"


@router.get("/ref-asset")
async def serve_ref_asset(
    key: str = Query(...),
    exp: int = Query(...),
    sig: str = Query(...),
):
    """
    Public (token-guarded) streaming of a drama reference asset from MinIO.
    Validated by an HMAC signature + expiry so it isn't an open proxy. No auth header
    required — Seedance fetches this URL directly.
    """
    # Only drama media keys are servable; block traversal.
    if not key.startswith("users/") or "/drama/" not in key or ".." in key:
        raise HTTPException(status_code=400, detail="Invalid asset key")
    if exp < int(time.time()):
        raise HTTPException(status_code=403, detail="Asset link expired")
    if not hmac.compare_digest(sig, _sign_asset(key, exp)):
        raise HTTPException(status_code=403, detail="Invalid signature")

    from app.services.storage import get_storage_service
    ext = Path(key).suffix.lower()
    content_type = _ASSET_CONTENT_TYPES.get(ext, "application/octet-stream")
    try:
        data, ct = await get_storage_service().get_object_bytes(key)
    except Exception as exc:
        logger.debug("ref-asset not found: %s (%s)", key, exc)
        raise HTTPException(status_code=404, detail="Asset not found")
    return Response(content=data, media_type=content_type or ct,
                    headers={"Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes"})


# ── 剧创提示词 + 实际 API 请求体预览（含真实可访问的 proxy URL）──────────────────
# 前端无法生成 HMAC 签名 URL（需 SECRET_KEY），故由后端按与 render_pipeline 完全同款
# 的方式拼装请求体并填入真实 ref-asset URL，保证「预览 == 实际提交」。

class PreviewImage(BaseModel):
    key: str = ""
    label: str = ""
    frame: str = ""                                  # 'first' | 'last' | ''
    usage: str = ""                                  # 用途/视角（全局图片代入「全程使用图片N…」）
    desc: str = ""                                   # 形态/特征描述（配置元素 description）

class PreviewPayloadRequest(BaseModel):
    global_desc: str = ""
    beats: list[dict] = []
    images: list[PreviewImage] = []                  # 有序，序号即「图片N」
    reference_video_key: Optional[str] = None
    reference_video_label: str = ""
    audio_key: Optional[str] = None
    audio_label: str = ""
    aspect_ratio: str = "9:16"
    duration: int = 5
    # 整集级全局选项 + AI 最终提示词覆盖
    composition: str = ""
    narration: str = ""
    bgm_label: str = ""
    final_prompt: str = ""


@router.post("/preview-payload", response_model=ResponseBase)
async def preview_payload(
    req: PreviewPayloadRequest,
    current_user: User = Depends(get_current_user),
):
    """返回某镜的剧创提示词 + 实际提交给视频生成 API 的请求体（资源 URL 为真实可访问形式）。

    资源 URL 与生成时一致：经 /api/v1/drama/ref-asset 发布的 MinIO proxy URL。
    与 render_pipeline.build_beat_prompt / seedance content 同款，保证预览即实际请求。
    """
    from app.api.v1.render_pipeline import build_beat_prompt

    # final_prompt 非空：直接用用户 AI 重构/手改的最终提示词；否则确定性基线
    prompt = (req.final_prompt or "").strip() or build_beat_prompt(
        req.beats,
        global_desc=req.global_desc,
        images=[{"label": im.label, "frame": im.frame, "usage": im.usage, "desc": im.desc} for im in req.images],
        has_video=bool(req.reference_video_key),
        has_audio=bool(req.audio_key),
        video_label=req.reference_video_label,
        audio_label=req.audio_label,
        composition=req.composition,
        narration=req.narration,
        bgm_label=req.bgm_label,
    )

    # content：text → 图片(按数组顺序 图片N) → 参考视频 → 参考音频，URL 用真实签名 proxy URL
    content: list[dict] = [{"type": "text", "text": prompt}]
    for im in req.images:
        url = _public_asset_url(im.key, ttl_seconds=6 * 3600) if im.key else None
        content.append({
            "type": "image_url", "role": "reference_image",
            "image_url": {"url": url or "<PUBLIC_BASE_URL 未配置，无法生成可访问 URL>"},
        })
    if req.reference_video_key:
        url = _public_asset_url(req.reference_video_key, ttl_seconds=6 * 3600)
        content.append({
            "type": "video_url", "role": "reference_video",
            "video_url": {"url": url or "<PUBLIC_BASE_URL 未配置，无法生成可访问 URL>"},
        })
    if req.audio_key:
        url = _public_asset_url(req.audio_key, ttl_seconds=6 * 3600)
        content.append({
            "type": "audio_url", "role": "reference_audio",
            "audio_url": {"url": url or "<PUBLIC_BASE_URL 未配置，无法生成可访问 URL>"},
        })

    payload = {
        "model": settings.GATEWAY_DRAMA_VIDEO_MODEL,
        "content": content,
        "ratio": req.aspect_ratio,
        "duration": req.duration,
        "generate_audio": False,
        "watermark": False,
    }
    return ResponseBase(data={"prompt": prompt, "payload": payload})


# ── Per-shot video generation (剧创式逐分镜 → Seedance 2.0 多模态) ─────────────

class ShotVideoRequest(BaseModel):
    drama_project_id: str
    episode_num: int
    shot_index: int
    prompt: str                                  # English motion/video prompt
    prompt_cn: Optional[str] = None
    aspect_ratio: str = "9:16"
    duration: int = 5
    generate_audio: bool = False
    # First frame (image-to-video). First non-empty source wins:
    image_task_id: Optional[str] = None          # GenerationTask that produced the shot image
    reference_file_id: Optional[str] = None      # uploaded image file_id (/upload-frame)
    first_frame_key: Optional[str] = None         # direct MinIO image key
    # Extra Seedance 2.0 multimodal references:
    reference_image_keys: list[str] = []          # extra MinIO image keys (角色/变装/场景)
    reference_video_key: Optional[str] = None     # MinIO key → presigned public URL
    audio_key: Optional[str] = None               # MinIO key → presigned public URL

    @field_validator('duration')
    @classmethod
    def validate_duration(cls, v: int) -> int:
        if v < 3 or v > 12:
            raise ValueError("duration must be between 3 and 12 seconds")
        return v


async def _fetch_shot_image_to_local(
    storage, upload_dir, user_id: int, *,
    image_task_id: Optional[str] = None,
    reference_file_id: Optional[str] = None,
    minio_key: Optional[str] = None,
    tasks_map: Optional[dict] = None,
) -> Optional[str]:
    """Resolve a shot's first-frame image to a LOCAL file path (Seedance i2v needs a file).

    Tries: generated GenerationTask result (MinIO) → direct MinIO key → local uploaded ref.
    Returns the local path string, or None if nothing resolvable.
    """
    import aiofiles

    async def _dump(data: bytes) -> str:
        fid = str(uuid.uuid4())
        path = upload_dir / f"{fid}.jpg"
        async with aiofiles.open(path, "wb") as f:
            await f.write(data)
        return str(path)

    # 1. Generated image via GenerationTask (MinIO key)
    if image_task_id and tasks_map:
        task = tasks_map.get(image_task_id)
        if task and task.result_path:
            try:
                data, _ = await storage.get_object_bytes(task.result_path)
                return await _dump(data)
            except Exception as exc:
                logger.warning("shot image: MinIO task fetch failed: %s", exc)

    # 2. Direct MinIO key
    if minio_key:
        try:
            data, _ = await storage.get_object_bytes(minio_key)
            return await _dump(data)
        except Exception as exc:
            logger.warning("shot image: MinIO key fetch failed (%s): %s", minio_key, exc)

    # 3. Locally-uploaded reference image (file_id from /upload-frame)
    if reference_file_id:
        for ext in (".jpg", ".jpeg", ".png", ".webp"):
            ref_path = upload_dir / f"{reference_file_id}{ext}"
            if ref_path.exists():
                return str(ref_path)

    return None


@router.post("/generate-shot-video", response_model=ResponseBase)
async def generate_shot_video(
    req: ShotVideoRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """
    Stage 4 (剧创式): generate ONE video for a single shot via Seedance 2.0.

    Each shot is generated independently (导演级控片): its own first-frame image plus
    optional multimodal references (extra images / reference video / audio). The result
    is stored under the project's drama shots path in MinIO. Episodes are assembled later
    by /drama/compose-final (M5).
    """
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask
    from app.services.storage import get_storage_service
    from app.utils.helpers import get_user_upload_path
    from app.api.v1.google import process_video_generation_with_credits

    storage = get_storage_service()
    upload_dir = get_user_upload_path(settings.STORAGE_BASE_PATH, current_user.id)

    # Pre-fetch GenerationTask for the first-frame image if referenced by task id
    tasks_map: dict[str, GenerationTask] = {}
    if req.image_task_id:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(GenerationTask).where(
                    GenerationTask.task_id == req.image_task_id,
                    GenerationTask.user_id == current_user.id,
                )
            )
            tasks_map = {t.task_id: t for t in result.scalars().all()}

    # Resolve first-frame image → local path (image-to-video)
    first_frame_path = await _fetch_shot_image_to_local(
        storage, upload_dir, current_user.id,
        image_task_id=req.image_task_id,
        reference_file_id=req.reference_file_id,
        minio_key=req.first_frame_key,
        tasks_map=tasks_map,
    )

    # Resolve extra reference images (MinIO keys) → local paths
    reference_image_paths: list[str] = []
    for key in (req.reference_image_keys or []):
        try:
            data, _ = await storage.get_object_bytes(key)
            import aiofiles
            fid = str(uuid.uuid4())
            p = upload_dir / f"{fid}.jpg"
            async with aiofiles.open(p, "wb") as f:
                await f.write(data)
            reference_image_paths.append(str(p))
        except Exception as exc:
            logger.warning("shot ref image fetch failed (%s): %s", key, exc)

    # Reference video / audio → public token-signed streaming URL (Seedance is external and
    # can't reach internal MinIO). Routed through the public backend origin → nginx → MinIO.
    # Only usable when PUBLIC_BASE_URL is configured; signed URL lives long enough to generate.
    reference_video_url = None
    audio_url = None
    if settings.PUBLIC_BASE_URL:
        if req.reference_video_key:
            reference_video_url = _public_asset_url(req.reference_video_key, ttl_seconds=6 * 3600)
        if req.audio_key:
            audio_url = _public_asset_url(req.audio_key, ttl_seconds=6 * 3600)
    elif req.reference_video_key or req.audio_key:
        logger.info(
            "shot video: skipping reference video/audio — PUBLIC_BASE_URL not set "
            "(Seedance can't reach internal MinIO)"
        )

    generation_mode = "image-to-video" if first_frame_path else "text-to-video"
    google_model = settings.GATEWAY_DRAMA_VIDEO_MODEL   # drama shots → Seedance 2.0

    # Create GenerationTask record
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db_task = GenerationTask(
            task_id=task_id,
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            model_id=google_model,
            task_type="video",
            prompt=req.prompt,
            parameters=json.dumps({
                "aspect_ratio": req.aspect_ratio,
                "duration": req.duration,
                "generation_mode": generation_mode,
                "drama_project_id": req.drama_project_id,
                "episode_num": req.episode_num,
                "shot_index": req.shot_index,
                "generate_audio": req.generate_audio,
                "has_reference_video": bool(reference_video_url),
                "has_audio": bool(audio_url),
            }),
            status="pending",
            # 逐镜分镜视频属短剧中间产物，不进作品画廊/AI视频（成片才展示）
            show_in_gallery=0,
        )
        db.add(db_task)
        await db.commit()

    background_tasks.add_task(
        process_video_generation_with_credits,
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        prompt=req.prompt,
        first_frame_path=first_frame_path,
        aspect_ratio=req.aspect_ratio,
        duration=req.duration,
        model_id=google_model,
        generation_mode=generation_mode,
        reference_image_paths=reference_image_paths or None,
        reference_video_url=reference_video_url,
        audio_url=audio_url,
        generate_audio=req.generate_audio,
        drama_project_id=req.drama_project_id,
    )

    return ResponseBase(
        success=True,
        message="Shot video generation started",
        data={"task_id": task_id, "episode_num": req.episode_num, "shot_index": req.shot_index},
    )


# ── Standalone multi-beat short video (Seedance 2.0 时间段分镜合成) ─────────────
# 独立于多镜头分集流程：用户用「全局创意 + 时间段beat + 首帧(图片1)/尾帧(图片2)/参考视频
# (视频1)/参考音频(音频1)」一次性合成一段广告/短片。提示词在前端按 Seedance 序号规范拼好
# (图片1/图片2/视频1/音频1 由 content 数组顺序决定), 后端只负责素材解析 + 顺序下发。

class BeatScriptRequest(BaseModel):
    description: str
    duration: int = 8
    aspect_ratio: str = "9:16"


BEAT_SCRIPT_SYSTEM_PROMPT = """你是专业的短视频/广告分镜脚本师。根据用户的创意描述，产出一段"按时间段切分"的分镜脚本，供 Seedance 2.0 视频模型使用。

严格输出 JSON（不要输出任何 JSON 之外的内容）：
{
  "global": "一句整体画面/风格/视角概述（如：第一人称视角的果茶宣传广告）",
  "beats": [
    {"time": "0-2s", "action": "该时间段的运镜 + 主体动作", "sfx": "该段关键音效（如：冰块碰撞声）", "voice": "该段背景音/旁白文案（如：鲜切现摇）"}
  ]
}

要求：
- 按总时长切分为若干约 2 秒的时间段，从 0 覆盖到总时长（如 8 秒 → 0-2s / 2-4s / 4-6s / 6-8s）。
- time 用 "起-止s" 格式（如 "0-2s"、"2-4s"）。
- action 用中文，只描述运镜方式与主体动作（不含音效/旁白）。
- sfx 写该段的关键音效与节奏卡点（如"轻脆苹果碰撞声""卡点轻快鼓点"）；无则留空字符串。
- voice 写该段需要念出的背景音/旁白短句（如"鲜切现摇""来一口鲜爽"）；无则留空字符串。
- 不要在任何字段里写"图片1""视频1""音频1"等占位符（首帧/尾帧/参考视频/参考音频由系统另行拼接）。

""" + REAL_PERSON_SAFETY_RULES


@router.post("/beat-script")
async def generate_beat_script(
    req: BeatScriptRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    """AI 草拟时间段分镜脚本 → {global, beats:[{time, action}]}，供合成器填充后再手改。"""
    user_prompt = (
        f"创意描述：{req.description}\n"
        f"总时长：{req.duration} 秒\n"
        f"画幅比例：{req.aspect_ratio}\n"
        f"请按上述要求生成分镜脚本。"
    )
    raw = await _call_json(f"{BEAT_SCRIPT_SYSTEM_PROMPT}\n\n{user_prompt}", user_id=current_user.id)
    try:
        data = json.loads(raw)
        beats = [
            {
                "time": str(b.get("time", "")),
                "action": str(b.get("action", "")),
                "sfx": str(b.get("sfx", "")),
                "voice": str(b.get("voice", "")),
            }
            for b in (data.get("beats") or [])
            if isinstance(b, dict)
        ]
    except (json.JSONDecodeError, TypeError, AttributeError) as exc:
        logger.error("beat-script parse error: %s\nraw=%s", exc, raw[:500])
        raise HTTPException(status_code=502, detail="AI 分镜脚本生成失败，请重试")
    return {"global": str(data.get("global", "")), "beats": beats}


# ── AI 重构最终分镜提示词（按「果茶/阳光饮料」范式整合全局选项 + 景别 + 首尾帧） ──

class ComposeShotPromptImage(BaseModel):
    label: str = ""
    frame: str = ""                                  # 'first' | 'last' | ''
    usage: str = ""                                  # 用途/视角（全局图片代入「全程使用图片N…」）
    desc: str = ""                                   # 形态/特征描述（配置元素 description）

class ComposeShotPromptRequest(BaseModel):
    global_desc: str = ""
    composition: str = ""                            # 构图视角
    narration: str = ""                              # 人称定义
    bgm_label: str = ""                              # 背景音乐名称
    images: list[ComposeShotPromptImage] = []        # 有序，序号即「图片N」
    video_label: str = ""
    audio_label: str = ""
    beats: list[dict] = []                           # [{time, action, shotSize}]
    duration: int = 5
    aspect_ratio: str = "9:16"


COMPOSE_PROMPT_SYSTEM = """你是专业的短视频/广告分镜导演。下面给你一段「结构化分镜事实」（已含：本镜参考图清单与首尾帧标注、参考图的形象特征描述、参考视频/音频、整片人称视角、构图视角、背景音乐、各时间段的景别与运镜动作）。

请把这些事实重构为一段**连贯、有电影感、可直接驱动 Seedance 2.0 视频模型**的中文最终提示词。参考「果茶第一人称广告 / 阳光饮料」范式：开篇点明整体风格与人称视角，逐个时间段顺滑衔接运镜与主体动作，结尾收束到尾帧。

硬性要求：
- 严格保留「图片N」「参考视频」「参考音频」的序号与代入名称语义，不得改写或丢弃（视频生成 API 靠它区分素材）。
- 「全片保持图片N「名称」的形象特征：…」这类形态/特征描述必须**完整保留**并自然融入正文，确保生成画面里该角色/场景/道具的外观特征始终一致，不得删改。
- 保留每段的「起-止s」时间标记与先后顺序，从 0 覆盖到总时长。
- 景别标为「近景/远景/特写」的时间段，要在该段文字中自然体现该景别；标为「标准」或未标的段落，按常规叙述、不要刻意强调景别。
- 首帧/尾帧标注的图片，要在提示词中体现其作为画面首帧/尾帧的定格作用。
- 只输出最终提示词正文，不要任何前缀、解释、标题或引号，不要输出 JSON。

""" + REAL_PERSON_SAFETY_RULES


@router.post("/compose-shot-prompt", response_model=ResponseBase)
async def compose_shot_prompt(
    req: ComposeShotPromptRequest,
    current_user: User = Depends(get_current_user),
):
    """把结构化分镜选项（全局视角/构图/BGM + 各段景别 + 首尾帧）AI 重构为最终提示词。

    先用与生成时同款的 build_beat_prompt 生成确定性基线作为「事实」，再交 AI 重写优化。
    与 /polish 一致：纯文本生成，不扣积分（积分只在真正出片 render 管线扣）。
    """
    from app.api.v1.render_pipeline import build_beat_prompt

    baseline = build_beat_prompt(
        req.beats,
        global_desc=req.global_desc,
        images=[{"label": im.label, "frame": im.frame, "usage": im.usage, "desc": im.desc} for im in req.images],
        has_video=bool(req.video_label),
        has_audio=bool(req.audio_label),
        video_label=req.video_label,
        audio_label=req.audio_label,
        composition=req.composition,
        narration=req.narration,
        bgm_label=req.bgm_label,
    )
    if not baseline.strip():
        raise HTTPException(status_code=400, detail="分镜内容为空，无法生成最终提示词")

    user_prompt = (
        f"总时长：{req.duration} 秒，画幅比例：{req.aspect_ratio}\n"
        f"结构化分镜事实：\n{baseline}\n\n请据此输出最终提示词。"
    )
    try:
        prompt = await _call_text(f"{COMPOSE_PROMPT_SYSTEM}\n\n{user_prompt}", timeout=45.0, user_id=current_user.id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("compose-shot-prompt error: %s", exc)
        raise HTTPException(status_code=502, detail="AI 最终提示词生成失败，请重试")

    return ResponseBase(data={"prompt": (prompt or "").strip() or baseline})


class ComposeVideoRequest(BaseModel):
    drama_project_id: Optional[str] = None        # 给了存项目路径，否则走用户 videos
    prompt: str                                   # 前端按 Seedance 序号规范拼好的最终中文提示词
    aspect_ratio: str = "9:16"
    duration: int = 8
    generate_audio: bool = False
    # 图片1 首帧 / 图片2 尾帧：file_id(来自 /upload-frame) 或 直接 MinIO key
    first_frame_file_id: Optional[str] = None
    first_frame_key: Optional[str] = None
    last_frame_file_id: Optional[str] = None
    last_frame_key: Optional[str] = None
    # 图片3+ 额外参考(MinIO key) / 视频1 / 音频1
    reference_image_keys: list[str] = []
    reference_video_key: Optional[str] = None
    audio_key: Optional[str] = None
    # ── 「合并成片」模式 B：把多段已生成分镜视频作参考视频 ──
    reference_video_keys: list[str] = []          # 直接 MinIO key（多条）
    reference_shot_task_ids: list[str] = []       # 已生成分镜 GenerationTask id（后端解析为 key，保序）
    episode_num: Optional[int] = None             # 回写本集成片用
    as_episode_composite: bool = False            # True → 完成后回写为本集成片 + 项目状态

    @field_validator('duration')
    @classmethod
    def validate_duration(cls, v: int) -> int:
        if v < 3 or v > 12:
            raise ValueError("duration must be between 3 and 12 seconds")
        return v


@router.post("/compose-video", response_model=ResponseBase)
async def compose_video(
    req: ComposeVideoRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """合成一段多beat短片：一次 Seedance 调用，首帧(图片1)→尾帧(图片2)→额外参考(图片3+) 顺序下发。

    提示词序号(图片1/图片2/视频1/音频1)由前端按已填素材槽拼好；后端把素材解析为本地图 / 公网
    签名 URL 后，沿用 process_video_generation_with_credits（计费 + 落库 + 失败退分）。
    """
    from app.services.storage import get_storage_service
    from app.utils.helpers import get_user_upload_path
    from app.api.v1.google import process_video_generation_with_credits

    storage = get_storage_service()
    upload_dir = get_user_upload_path(settings.STORAGE_BASE_PATH, current_user.id)

    # 首帧(图片1) / 尾帧(图片2) → 本地文件 (Seedance i2v 需要文件字节)
    first_frame_path = await _fetch_shot_image_to_local(
        storage, upload_dir, current_user.id,
        reference_file_id=req.first_frame_file_id, minio_key=req.first_frame_key,
    )
    last_frame_path = await _fetch_shot_image_to_local(
        storage, upload_dir, current_user.id,
        reference_file_id=req.last_frame_file_id, minio_key=req.last_frame_key,
    )

    # 额外参考图(图片3+) → 本地路径
    reference_image_paths: list[str] = []
    for key in (req.reference_image_keys or []):
        try:
            data, _ = await storage.get_object_bytes(key)
            import aiofiles
            fid = str(uuid.uuid4())
            p = upload_dir / f"{fid}.jpg"
            async with aiofiles.open(p, "wb") as f:
                await f.write(data)
            reference_image_paths.append(str(p))
        except Exception as exc:
            logger.warning("compose ref image fetch failed (%s): %s", key, exc)

    # 参考视频(视频1) / 参考音频(音频1) → 公网 token 签名流式 URL (Seedance 外部拉取)
    reference_video_url = None
    audio_url = None
    if settings.PUBLIC_BASE_URL:
        if req.reference_video_key:
            reference_video_url = _public_asset_url(req.reference_video_key, ttl_seconds=6 * 3600)
        if req.audio_key:
            audio_url = _public_asset_url(req.audio_key, ttl_seconds=6 * 3600)
    elif req.reference_video_key or req.audio_key:
        logger.info("compose: skipping reference video/audio — PUBLIC_BASE_URL not set")

    # 「合并成片」模式 B：多段参考视频（直接 key + 已生成分镜 task_id→key 解析，均保序）
    reference_video_urls: list[str] = []
    if settings.PUBLIC_BASE_URL:
        merged_keys: list[str] = []
        if req.reference_shot_task_ids:
            async with AsyncSessionLocal() as _db:
                key_map = await _resolve_shot_video_keys(
                    _db, current_user.id, req.reference_shot_task_ids
                )
            merged_keys.extend(key_map[t] for t in req.reference_shot_task_ids if t in key_map)
        merged_keys.extend(req.reference_video_keys or [])
        reference_video_urls = [
            _public_asset_url(k, ttl_seconds=6 * 3600) for k in merged_keys
        ]
    elif req.reference_shot_task_ids or req.reference_video_keys:
        logger.info("compose: skipping multi reference videos — PUBLIC_BASE_URL not set")

    generation_mode = "image-to-video" if first_frame_path else "text-to-video"
    google_model = settings.GATEWAY_DRAMA_VIDEO_MODEL

    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db_task = GenerationTask(
            task_id=task_id,
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            model_id=google_model,
            task_type="video",
            prompt=req.prompt,
            parameters=json.dumps({
                "aspect_ratio": req.aspect_ratio,
                "duration": req.duration,
                "generation_mode": generation_mode,
                "drama_project_id": req.drama_project_id,
                "compose": True,
                "generate_audio": req.generate_audio,
                "has_last_frame": bool(last_frame_path),
                "has_reference_video": bool(reference_video_url),
                "has_audio": bool(audio_url),
            }),
            status="pending",
            # 合并成片：最终作品，展示在作品画廊/AI视频
            show_in_gallery=1,
        )
        db.add(db_task)
        await db.commit()

    background_tasks.add_task(
        process_video_generation_with_credits,
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        prompt=req.prompt,
        first_frame_path=first_frame_path,
        last_frame_path=last_frame_path,
        aspect_ratio=req.aspect_ratio,
        duration=req.duration,
        model_id=google_model,
        generation_mode=generation_mode,
        reference_image_paths=reference_image_paths or None,
        reference_video_url=reference_video_url,
        reference_video_urls=reference_video_urls or None,
        audio_url=audio_url,
        generate_audio=req.generate_audio,
        drama_project_id=req.drama_project_id,
        episode_num=req.episode_num,
        as_episode_composite=req.as_episode_composite,
    )

    return ResponseBase(
        success=True,
        message="Compose video generation started",
        data={"task_id": task_id},
    )


# ── Final cut assembly (成片: ffmpeg concat 镜头视频 → MinIO) ──────────────────

class ComposeFinalRequest(BaseModel):
    drama_project_id: str
    episode_num: int
    title: Optional[str] = None
    aspect_ratio: str = "9:16"
    video_task_ids: list[str]            # ordered shot-video GenerationTask ids
    subtitle: Optional[str] = None       # 合并提示词（元数据/字幕用，v1 仅存库不烧录）


_AR_TO_WH = {"9:16": (720, 1280), "16:9": (1280, 720), "1:1": (1024, 1024)}


@functools.lru_cache(maxsize=1)
def _ffmpeg_exe() -> str:
    """Resolve the ffmpeg binary.

    Prefer a system ffmpeg on PATH: the bundled imageio_ffmpeg binary is a
    static 4.2.2 build that predates the `xfade` filter (added in 4.3), so
    transition-based series compose fails on it. Fall back to the bundled
    binary only when no system ffmpeg is available.
    """
    import shutil
    system = shutil.which("ffmpeg")
    if system:
        return system
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


async def _run_ffmpeg(args: list[str], timeout: float = 300.0) -> tuple[int, str]:
    """Run ffmpeg with the given args; return (returncode, stderr_tail)."""
    proc = await asyncio.create_subprocess_exec(
        _ffmpeg_exe(), *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("ffmpeg timeout")
    tail = (stderr or b"").decode("utf-8", "ignore")[-800:]
    return proc.returncode, tail


async def _clip_has_audio(path: str) -> bool:
    """Probe a clip for an audio stream using ffmpeg's own -i output."""
    rc, info = await _run_ffmpeg(["-i", path], timeout=30.0)
    # `ffmpeg -i` with no output exits non-zero but prints stream info to stderr
    return "Audio:" in info


async def _normalize_clip(src: str, dst: str, w: int, h: int) -> None:
    """Re-encode one clip to a canonical h264/aac format with a guaranteed audio track."""
    vf = (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p"
    )
    if await _clip_has_audio(src):
        args = [
            "-y", "-i", src, "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-ar", "44100", "-ac", "2", dst,
        ]
    else:
        args = [
            "-y", "-i", src,
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-vf", vf, "-map", "0:v:0", "-map", "1:a:0", "-shortest",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-ar", "44100", "-ac", "2", dst,
        ]
    rc, err = await _run_ffmpeg(args)
    if rc != 0:
        raise RuntimeError(f"normalize failed: {err}")


async def _process_compose_final(
    task_id: str, user_id: int, tenant_id: int,
    drama_project_id: str, episode_num: int, aspect_ratio: str,
    video_task_ids: list[str],
):
    """Background task: download shot videos, ffmpeg-concat, upload final to MinIO."""
    import os
    import tempfile
    from sqlalchemy import select, update
    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask
    from app.services.storage import get_storage_service

    storage = get_storage_service()
    w, h = _AR_TO_WH.get(aspect_ratio, (720, 1280))

    async with AsyncSessionLocal() as db:
        try:
            await db.execute(update(GenerationTask).where(GenerationTask.task_id == task_id)
                             .values(status="processing", progress=10))
            await db.commit()

            # Resolve ordered shot videos → result_path (MinIO key or local path)
            result = await db.execute(
                select(GenerationTask).where(
                    GenerationTask.task_id.in_(video_task_ids),
                    GenerationTask.user_id == user_id,
                )
            )
            by_id = {t.task_id: t for t in result.scalars().all()}

            with tempfile.TemporaryDirectory() as tmp:
                norm_paths: list[str] = []
                for i, vid in enumerate(video_task_ids):
                    t = by_id.get(vid)
                    if not t or not t.result_path:
                        logger.warning("compose-final: missing shot video %s", vid)
                        continue
                    raw = os.path.join(tmp, f"raw_{i}.mp4")
                    if storage.is_minio_key(t.result_path):
                        data, _ = await storage.get_object_bytes(t.result_path)
                        with open(raw, "wb") as f:
                            f.write(data)
                    elif os.path.exists(t.result_path):
                        raw = t.result_path
                    else:
                        logger.warning("compose-final: unreadable result_path %s", t.result_path)
                        continue
                    norm = os.path.join(tmp, f"norm_{i}.mp4")
                    await _normalize_clip(raw, norm, w, h)
                    norm_paths.append(norm)

                if not norm_paths:
                    raise RuntimeError("没有可用的分镜视频，请先生成镜头视频")

                await db.execute(update(GenerationTask).where(GenerationTask.task_id == task_id)
                                 .values(progress=70))
                await db.commit()

                # Concat (streams are now uniform → stream copy is safe)
                list_file = os.path.join(tmp, "list.txt")
                with open(list_file, "w") as f:
                    for p in norm_paths:
                        f.write(f"file '{p}'\n")
                out_path = os.path.join(tmp, "final.mp4")
                rc, err = await _run_ffmpeg([
                    "-y", "-f", "concat", "-safe", "0", "-i", list_file,
                    "-c", "copy", "-movflags", "+faststart", out_path,
                ])
                if rc != 0 or not os.path.exists(out_path):
                    raise RuntimeError(f"concat failed: {err}")

                # Upload final to MinIO
                filename = f"ep{episode_num}_{task_id}.mp4"
                object_key = storage.drama_final_key(user_id, drama_project_id, filename)
                from pathlib import Path as _P
                result_url = await storage.upload_and_get_url(_P(out_path), object_key, "video/mp4")

            await db.execute(update(GenerationTask).where(GenerationTask.task_id == task_id)
                             .values(status="completed", progress=100,
                                     result_path=object_key, result_url=result_url))
            await db.commit()

            # 「合并成片」模式 A：回写本集成片 + 项目状态（成片用无鉴权 task 文件端点播放）
            if drama_project_id:
                try:
                    await _persist_compose_episode_composite(
                        db, drama_project_id, user_id, episode_num, task_id, object_key,
                    )
                except Exception as _e:
                    logger.warning("compose-final episode write-back failed: %s", _e)
        except Exception as exc:
            logger.error("compose-final failed: %s", exc)
            await db.execute(update(GenerationTask).where(GenerationTask.task_id == task_id)
                             .values(status="failed", error_message=str(exc)))
            await db.commit()


@router.post("/compose-final", response_model=ResponseBase)
async def compose_final(
    req: ComposeFinalRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """
    成片: assemble an episode's per-shot videos into a single MP4 via ffmpeg concat
    (剪映搁置). Runs as a background GenerationTask; poll status like any video task.
    """
    if not req.video_task_ids:
        raise HTTPException(status_code=400, detail="没有可拼接的分镜视频")

    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask

    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db_task = GenerationTask(
            task_id=task_id,
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            model_id="ffmpeg-concat",
            task_type="video",
            prompt=f"compose final EP{req.episode_num}: {req.title or ''}",
            parameters=json.dumps({
                "drama_project_id": req.drama_project_id,
                "episode_num": req.episode_num,
                "shot_count": len(req.video_task_ids),
                "subtitle": req.subtitle or "",
            }),
            status="pending",
            # 成片(ffmpeg拼接)：最终作品，展示在作品画廊/AI视频
            show_in_gallery=1,
        )
        db.add(db_task)
        await db.commit()

    background_tasks.add_task(
        _process_compose_final,
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        drama_project_id=req.drama_project_id,
        episode_num=req.episode_num,
        aspect_ratio=req.aspect_ratio,
        video_task_ids=req.video_task_ids,
    )

    return ResponseBase(
        success=True,
        message="Final cut composition started",
        data={"task_id": task_id, "episode_num": req.episode_num},
    )


# ── 多集合并成剧 (聚合每集成片 → 转场拼接为整剧 → MinIO) ──────────────────────────

class ComposeSeriesRequest(BaseModel):
    drama_project_id: str
    title: Optional[str] = None
    aspect_ratio: str = "9:16"
    episode_task_ids: list[str]                 # 有序：各集成片 GenerationTask id
    transition: str = "none"                    # none | crossfade | fade
    transition_duration: float = 0.5            # 转场时长（秒），crossfade/fade 用


async def _probe_duration(path: str) -> float:
    """探测片段时长（秒）。用 ffmpeg -i 解析 Duration，失败回退 0。"""
    rc, info = await _run_ffmpeg(["-i", path], timeout=30.0)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info or "")
    if not m:
        return 0.0
    h, mm, ss = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mm * 60 + ss


async def _concat_clips(norm_paths: list[str], out_path: str, tmp: str) -> None:
    """无转场：uniform 流直接 concat（stream copy）。"""
    import os
    list_file = os.path.join(tmp, "list.txt")
    with open(list_file, "w") as f:
        for p in norm_paths:
            f.write(f"file '{p}'\n")
    rc, err = await _run_ffmpeg([
        "-y", "-f", "concat", "-safe", "0", "-i", list_file,
        "-c", "copy", "-movflags", "+faststart", out_path,
    ])
    if rc != 0 or not os.path.exists(out_path):
        raise RuntimeError(f"concat failed: {err}")


async def _xfade_clips(norm_paths: list[str], durations: list[float], out_path: str,
                       mode: str, td: float) -> None:
    """转场拼接：ffmpeg xfade（视频）+ acrossfade（音频）链式合成。

    mode='crossfade' → 交叉淡化；mode='fade' → 经黑场淡入淡出（xfade transition=fade）。
    各段偏移 = 累计时长 − 累计转场重叠；重叠 td 秒。
    """
    n = len(norm_paths)
    inputs: list[str] = []
    for p in norm_paths:
        inputs += ["-i", p]
    xfade_kind = "fadeblack" if mode == "fade" else "fade"

    vparts: list[str] = []
    aparts: list[str] = []
    v_prev, a_prev = "[0:v]", "[0:a]"
    offset = max(0.0, durations[0] - td)
    for i in range(1, n):
        v_out = f"[v{i}]"
        a_out = f"[a{i}]"
        vparts.append(
            f"{v_prev}[{i}:v]xfade=transition={xfade_kind}:duration={td}:offset={offset:.3f}{v_out}"
        )
        aparts.append(f"{a_prev}[{i}:a]acrossfade=d={td}{a_out}")
        v_prev, a_prev = v_out, a_out
        # 下一段偏移：当前合成时长再累加下一段有效时长（减去一次转场重叠）
        offset += max(0.0, durations[i] - td)

    filter_complex = ";".join(vparts + aparts)
    args = ["-y", *inputs, "-filter_complex", filter_complex,
            "-map", v_prev, "-map", a_prev,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart", out_path]
    rc, err = await _run_ffmpeg(args, timeout=600.0)
    import os
    if rc != 0 or not os.path.exists(out_path):
        raise RuntimeError(f"xfade failed: {err}")


async def _process_compose_series(
    task_id: str, user_id: int, tenant_id: int,
    drama_project_id: str, aspect_ratio: str,
    episode_task_ids: list[str], transition: str, transition_duration: float,
):
    """后台任务：下载各集成片 → 归一化 → (无转场 concat / 转场 xfade) → 上传整剧成片。"""
    import os
    import tempfile
    from sqlalchemy import select, update
    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask
    from app.services.storage import get_storage_service
    from pathlib import Path as _P

    storage = get_storage_service()
    w, h = _AR_TO_WH.get(aspect_ratio, (720, 1280))

    async with AsyncSessionLocal() as db:
        try:
            await db.execute(update(GenerationTask).where(GenerationTask.task_id == task_id)
                             .values(status="processing", progress=10))
            await db.commit()

            result = await db.execute(
                select(GenerationTask).where(
                    GenerationTask.task_id.in_(episode_task_ids),
                    GenerationTask.user_id == user_id,
                )
            )
            by_id = {t.task_id: t for t in result.scalars().all()}

            with tempfile.TemporaryDirectory() as tmp:
                norm_paths: list[str] = []
                for i, vid in enumerate(episode_task_ids):
                    t = by_id.get(vid)
                    if not t or not t.result_path:
                        logger.warning("compose-series: missing episode video %s", vid)
                        continue
                    raw = os.path.join(tmp, f"raw_{i}.mp4")
                    if storage.is_minio_key(t.result_path):
                        data, _ = await storage.get_object_bytes(t.result_path)
                        with open(raw, "wb") as f:
                            f.write(data)
                    elif os.path.exists(t.result_path):
                        raw = t.result_path
                    else:
                        logger.warning("compose-series: unreadable result_path %s", t.result_path)
                        continue
                    norm = os.path.join(tmp, f"norm_{i}.mp4")
                    await _normalize_clip(raw, norm, w, h)
                    norm_paths.append(norm)

                if not norm_paths:
                    raise RuntimeError("没有可用的每集成片，请先为各集生成成片")

                await db.execute(update(GenerationTask).where(GenerationTask.task_id == task_id)
                                 .values(progress=65))
                await db.commit()

                out_path = os.path.join(tmp, "series.mp4")
                td = max(0.1, min(2.0, transition_duration or 0.5))
                if transition in ("crossfade", "fade") and len(norm_paths) >= 2:
                    durations = [await _probe_duration(p) for p in norm_paths]
                    # 时长探测失败（0）则回退直接拼接，避免 xfade offset 计算出错
                    if all(d > 0 for d in durations):
                        await _xfade_clips(norm_paths, durations, out_path, transition, td)
                    else:
                        logger.warning("compose-series: duration probe failed, fallback to concat")
                        await _concat_clips(norm_paths, out_path, tmp)
                else:
                    await _concat_clips(norm_paths, out_path, tmp)

                filename = f"series_{task_id}.mp4"
                object_key = storage.drama_final_key(user_id, drama_project_id, filename)
                result_url = await storage.upload_and_get_url(_P(out_path), object_key, "video/mp4")

            await db.execute(update(GenerationTask).where(GenerationTask.task_id == task_id)
                             .values(status="completed", progress=100,
                                     result_path=object_key, result_url=result_url))
            await db.commit()

            # 回写项目：整剧成片路径（不改各集 composite_url）
            if drama_project_id:
                try:
                    from app.models.drama_project import DramaProject
                    res = await db.execute(
                        select(DramaProject).where(
                            DramaProject.project_id == drama_project_id,
                            DramaProject.user_id == user_id,
                            DramaProject.deleted_at.is_(None),
                        )
                    )
                    proj = res.scalar_one_or_none()
                    if proj:
                        proj.final_video_path = object_key
                        await db.commit()
                except Exception as _e:
                    logger.warning("compose-series project write-back failed: %s", _e)
        except Exception as exc:
            logger.error("compose-series failed: %s", exc)
            await db.execute(update(GenerationTask).where(GenerationTask.task_id == task_id)
                             .values(status="failed", error_message=str(exc)))
            await db.commit()


@router.post("/compose-series", response_model=ResponseBase)
async def compose_series(
    req: ComposeSeriesRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """多集合并成剧：把各集成片按序聚合为整剧 MP4（可选转场），后台 GenerationTask 承载。"""
    if not req.episode_task_ids:
        raise HTTPException(status_code=400, detail="没有可合并的每集成片")
    if req.transition not in ("none", "crossfade", "fade"):
        raise HTTPException(status_code=400, detail="transition 必须是 none / crossfade / fade")

    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask

    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db_task = GenerationTask(
            task_id=task_id,
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            model_id="ffmpeg-series",
            task_type="video",
            prompt=f"compose series: {req.title or ''}",
            parameters=json.dumps({
                "drama_project_id": req.drama_project_id,
                "episode_count": len(req.episode_task_ids),
                "transition": req.transition,
            }),
            status="pending",
            show_in_gallery=1,
        )
        db.add(db_task)
        await db.commit()

    background_tasks.add_task(
        _process_compose_series,
        task_id=task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        drama_project_id=req.drama_project_id,
        aspect_ratio=req.aspect_ratio,
        episode_task_ids=req.episode_task_ids,
        transition=req.transition,
        transition_duration=req.transition_duration,
    )

    return ResponseBase(
        success=True,
        message="Series composition started",
        data={"task_id": task_id},
    )


@router.get("/series-works", response_model=ResponseBase)
async def list_series_works(
    drama_project_id: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """放映剧场：列出本项目已完成的「合并成剧」作品（model_id=ffmpeg-series），最新在前。"""
    res = await db_list_series(current_user.id, drama_project_id)
    return ResponseBase(success=True, message=f"{len(res)} works", data=res)


class SeriesRenameRequest(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def _clean_title(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("标题不能为空")
        return v[:120]


@router.patch("/series-works/{task_id}", response_model=ResponseBase)
async def rename_series_work(
    task_id: str,
    body: SeriesRenameRequest,
    current_user: User = Depends(get_current_user),
):
    """重命名放映剧场作品：更新标题（决定下载文件名与展示名）。"""
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GenerationTask).where(
                GenerationTask.task_id == task_id,
                GenerationTask.user_id == current_user.id,
                GenerationTask.model_id == "ffmpeg-series",
                GenerationTask.deleted_at.is_(None),
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            raise HTTPException(status_code=404, detail="作品不存在")
        task.prompt = f"compose series: {body.title}"
        await db.commit()
    return ResponseBase(success=True, message="renamed", data={"task_id": task_id, "title": body.title})


@router.delete("/series-works/{task_id}", response_model=ResponseBase)
async def delete_series_work(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    """删除放映剧场作品（软删除）。"""
    from datetime import datetime
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GenerationTask).where(
                GenerationTask.task_id == task_id,
                GenerationTask.user_id == current_user.id,
                GenerationTask.model_id == "ffmpeg-series",
                GenerationTask.deleted_at.is_(None),
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            raise HTTPException(status_code=404, detail="作品不存在")
        task.deleted_at = datetime.utcnow()
        await db.commit()
    return ResponseBase(success=True, message="deleted", data={"task_id": task_id})


async def db_list_series(user_id: int, drama_project_id: str) -> list[dict]:
    from sqlalchemy import select, desc
    from app.db.session import AsyncSessionLocal
    from app.models.generation_task import GenerationTask

    works: list[dict] = []
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GenerationTask).where(
                GenerationTask.user_id == user_id,
                GenerationTask.model_id == "ffmpeg-series",
                GenerationTask.status == "completed",
                GenerationTask.deleted_at.is_(None),
            ).order_by(desc(GenerationTask.created_at))
        )
        for t in result.scalars().all():
            try:
                params = json.loads(t.parameters or "{}")
            except (json.JSONDecodeError, TypeError):
                params = {}
            if params.get("drama_project_id") != drama_project_id:
                continue
            works.append({
                "task_id": t.task_id,
                "title": (t.prompt or "").replace("compose series:", "").strip() or "整剧成片",
                "url": f"/api/v1/google/task/{t.task_id}/file",
                "transition": params.get("transition", "none"),
                "episode_count": params.get("episode_count", 0),
                "created_at": t.created_at.isoformat() if t.created_at else None,
            })
    return works


# ── 合并成片 共享助手 + 预览端点 ───────────────────────────────────────────────

async def _resolve_shot_video_keys(db, user_id: int, task_ids: list[str]) -> dict[str, str]:
    """已生成分镜 GenerationTask id → MinIO result_path（仅 completed 且有结果）。"""
    if not task_ids:
        return {}
    from sqlalchemy import select
    from app.models.generation_task import GenerationTask
    res = await db.execute(
        select(GenerationTask).where(
            GenerationTask.task_id.in_(task_ids),
            GenerationTask.user_id == user_id,
        )
    )
    return {
        t.task_id: t.result_path
        for t in res.scalars().all()
        if t.result_path and t.status == "completed"
    }


async def _persist_compose_episode_composite(
    db, project_id: str, user_id: int, episode_num, task_id: str, object_key: str
) -> None:
    """合并成片完成 → 回写本集 composite_url（无鉴权 task 文件端点）+ 推导项目状态。

    与 render_pipeline._persist_project_completion 同款，但成片由 GenerationTask 承载，
    故 composite_url 用 /api/v1/google/task/{id}/file。**不写 pipeline_id**：前端 resume-poll
    会拿 pipeline_id 调 pollPipeline，task_id 不是 pipeline 会 404。
    """
    from sqlalchemy import select
    from app.models.drama_project import DramaProject

    res = await db.execute(
        select(DramaProject).where(
            DramaProject.project_id == project_id,
            DramaProject.user_id == user_id,
            DramaProject.deleted_at.is_(None),
        )
    )
    proj = res.scalar_one_or_none()
    if not proj or not proj.episodes_data:
        return
    try:
        data = json.loads(proj.episodes_data)
    except (json.JSONDecodeError, TypeError):
        return
    eps = data.get("episodes") or []
    if not eps:
        return

    target = None
    if episode_num is not None:
        target = next((e for e in eps if e.get("episode") == episode_num), None)
    if target is None and len(eps) == 1:
        target = eps[0]
    if target is None:
        return
    target["composite_url"] = f"/api/v1/google/task/{task_id}/file"

    proj.episodes_data = json.dumps(data, ensure_ascii=False)
    proj.final_video_path = object_key
    if proj.archived_at is None:
        all_done = all(e.get("composite_url") for e in eps)
        proj.status = "completed" if all_done else "in_progress"
    await db.commit()


class ComposePreviewRequest(BaseModel):
    mode: str = "concat"                  # "concat"(模式A) | "seedance"(模式B)
    drama_project_id: str
    episode_num: int
    title: str = ""
    aspect_ratio: str = "9:16"
    video_task_ids: list[str] = []        # 有序：已生成分镜 task id
    merge_prompt: str = ""                # 合并提示词（A=字幕；B=global_desc）
    beats: list[dict] = []                # 模式B 时间段 [{time, action}]
    duration: int = 8                     # 模式B，3..12


@router.post("/compose-preview-payload", response_model=ResponseBase)
async def compose_preview_payload(
    req: ComposePreviewRequest,
    current_user: User = Depends(get_current_user),
):
    """返回「合并成片」实际提交给 API 的请求体（两模式），保证预览即实际请求。"""
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        key_map = await _resolve_shot_video_keys(db, current_user.id, req.video_task_ids)
    # 按用户排列顺序解析（缺失/未完成 → 占位）
    ordered = [(tid, key_map.get(tid)) for tid in req.video_task_ids]

    if req.mode == "seedance":
        from app.api.v1.render_pipeline import build_beat_prompt
        prompt = build_beat_prompt(
            req.beats,
            global_desc=req.merge_prompt,
            images=[],
            has_video=True,
            video_label="已生成分镜",
        )
        content: list[dict] = [{"type": "text", "text": prompt}]
        for tid, key in ordered:
            url = _public_asset_url(key, ttl_seconds=6 * 3600) if key else None
            content.append({
                "type": "video_url", "role": "reference_video",
                "video_url": {"url": url or "<分镜未生成完成或 PUBLIC_BASE_URL 未配置>"},
            })
        payload = {
            "model": settings.GATEWAY_DRAMA_VIDEO_MODEL,
            "content": content,
            "ratio": req.aspect_ratio,
            "duration": req.duration,
            "generate_audio": False,
            "watermark": False,
        }
        return ResponseBase(data={"prompt": prompt, "payload": payload})

    # 默认：concat（模式 A，ffmpeg 拼接）
    clips = []
    for tid, key in ordered:
        clips.append({
            "task_id": tid,
            "result_path": key or "<分镜未生成完成>",
            "ref_asset_url": (_public_asset_url(key, ttl_seconds=6 * 3600) if key else None),
        })
    payload = {
        "engine": "ffmpeg-concat",
        "drama_project_id": req.drama_project_id,
        "episode_num": req.episode_num,
        "aspect_ratio": req.aspect_ratio,
        "subtitle": req.merge_prompt,
        "video_task_ids": req.video_task_ids,
        "clips": clips,
    }
    return ResponseBase(data={"prompt": req.merge_prompt, "payload": payload})


# ── AI Polish (一键润色) ─────────────────────────────────────────────────────

POLISH_PROMPTS = {
    "character": (
        "你是一位角色设计专家。请润色以下角色描述，使其更加生动、具体、适合AI图像生成。"
        "保持原始语言（中文输入则中文输出），不超过100字。"
        "只输出润色后的描述文本，不要有任何前缀、解释或引号。\n\n原始描述：{text}"
    ),
    "script": (
        "你是一位专业短剧编剧。请润色以下剧本内容，使其叙事更紧凑、画面感更强、冲突更鲜明。"
        "保持原始语言和段落结构（每段用空行分隔代表一个场景）。"
        "只输出润色后的文本，不要有任何前缀、解释或引号。\n\n原始剧本：\n{text}"
    ),
    "scene": (
        "你是一位电影分镜师。请润色以下场景描述，加入更丰富的视觉细节（光线、色调、空间纵深、气氛）。"
        "保持原始语言，不超过150字。"
        "只输出润色后的描述文本，不要有任何前缀、解释或引号。\n\n原始场景描述：{text}"
    ),
    "action": (
        "你是一位动作导演。请润色以下动作/运镜描述，使其更专业、更有电影感，加入具体的镜头运动指令。"
        "保持原始语言，不超过100字。"
        "只输出润色后的描述文本，不要有任何前缀、解释或引号。\n\n原始动作描述：{text}"
    ),
}


class PolishRequest(BaseModel):
    text: str
    type: str = "scene"  # character | script | scene | action


@router.post("/polish", response_model=ResponseBase)
async def polish_text(
    req: PolishRequest,
    current_user: User = Depends(get_current_user),
):
    """AI-powered text polishing for character descriptions, scripts, scenes, actions."""
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    template = POLISH_PROMPTS.get(req.type)
    if not template:
        raise HTTPException(status_code=400, detail=f"未知的润色类型: {req.type}")

    try:
        polished = await _call_text(template.format(text=req.text.strip()))
    except Exception as e:
        logger.error(f"Polish API error: {e}")
        raise HTTPException(status_code=502, detail="AI 润色失败，请重试")

    return ResponseBase(
        success=True,
        message="润色完成",
        data={"original": req.text, "polished": polished},
    )
