"""
AI Character Library API – 全局只读 AI 角色资源库浏览接口（AI角色）。

普通用户只读；不提供创建/更新/删除端点（资源由导入脚本 / 管理端维护）。
用户在项目要素配置中选择角色后，通过 project_assets 的 from-ai-character 端点
实例化为可编辑的项目要素。

GET  /categories                         – 完整分类树（含每级角色计数）
GET  /?category_path=&q=&<attr>=         – 角色列表（按分类前缀 + 名称 + 属性维度筛选）
GET  /filters?category_path=             – 某分类下各属性维度的可选值（供筛选栏）
GET  /{character_key}                    – 角色详情
GET  /{character_key}/images/{image_id}/file  – 流式图片（character_key 作能力令牌，无鉴权）
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.ai_character import AICharacterCategory, AICharacter, AICharacterImage
from app.models.user import User
from app.schemas.response import ResponseBase
from app.services.storage import get_storage_service
from app.utils.ai_character_parser import ATTRIBUTE_KEYS

router = APIRouter()

# 顶部筛选栏使用的属性维度（对标 main.png：性别/年龄段/物种/体格/身高/肤色/发长/发色/气质）
FILTER_KEYS = ["性别", "年龄段", "物种", "体格", "身高", "肤色", "发长", "发色", "气质"]


# ── serializers ──────────────────────────────────────────────────────────────

def _attrs(c: AICharacter) -> dict:
    try:
        return json.loads(c.attributes_json) if c.attributes_json else {}
    except (ValueError, TypeError):
        return {}


def _char_card(c: AICharacter) -> dict:
    """列表卡片精简结构。"""
    attrs = _attrs(c)
    return {
        "character_key": c.character_key,
        "name": c.name,
        "path": c.path,
        "cover_image_id": c.images[0].id if c.images else None,
        "attributes": attrs,
    }


def _char_detail(c: AICharacter) -> dict:
    return {
        "character_key": c.character_key,
        "name": c.name,
        "path": c.path,
        "attributes": _attrs(c),
        "attribute_keys": ATTRIBUTE_KEYS,
        "feature_desc": c.feature_desc,
        "costume_desc": c.costume_desc,
        "images": [
            {"id": img.id, "slot": img.slot, "sort_order": img.sort_order}
            for img in (c.images or [])
        ],
    }


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=ResponseBase)
async def list_categories(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回完整分类树（嵌套结构），每个叶子/节点附带其子树下的角色计数。"""
    rows = (await db.execute(
        select(AICharacterCategory).order_by(AICharacterCategory.level, AICharacterCategory.sort_order, AICharacterCategory.name)
    )).scalars().all()

    # 各分类 path 下（含子树）角色计数：按 path 前缀聚合
    char_paths = (await db.execute(select(AICharacter.path))).scalars().all()

    def count_under(path: str) -> int:
        return sum(1 for p in char_paths if p == path or p.startswith(path + "/"))

    # 组装嵌套树
    nodes = {
        c.id: {
            "id": c.id,
            "name": c.name,
            "path": c.path,
            "level": c.level,
            "parent_id": c.parent_id,
            "count": count_under(c.path),
            "children": [],
        }
        for c in rows
    }
    roots = []
    for c in rows:
        node = nodes[c.id]
        if c.parent_id and c.parent_id in nodes:
            nodes[c.parent_id]["children"].append(node)
        else:
            roots.append(node)

    return ResponseBase(success=True, data={"tree": roots, "total": len(char_paths)})


@router.get("/filters", response_model=ResponseBase)
async def list_filters(
    category_path: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回（可按分类过滤后）各属性维度的可选值集合，供筛选栏渲染。"""
    base = select(AICharacter.attributes_json)
    if category_path:
        base = base.where(
            (AICharacter.path == category_path) | (AICharacter.path.like(f"{category_path}/%"))
        )
    rows = (await db.execute(base)).scalars().all()

    values: dict[str, list[str]] = {k: [] for k in FILTER_KEYS}
    seen: dict[str, set] = {k: set() for k in FILTER_KEYS}
    for raw in rows:
        try:
            attrs = json.loads(raw) if raw else {}
        except (ValueError, TypeError):
            continue
        for k in FILTER_KEYS:
            v = attrs.get(k)
            if v and v not in seen[k]:
                seen[k].add(v)
                values[k].append(v)

    return ResponseBase(success=True, data={"keys": FILTER_KEYS, "values": values})


@router.get("", response_model=ResponseBase)
async def list_characters(
    request: Request,
    category_path: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """角色列表。属性维度筛选以查询参数传入，如 ?性别=男&气质=威严 （多值以逗号分隔取并集）。"""
    base = select(AICharacter)
    if category_path:
        base = base.where(
            (AICharacter.path == category_path) | (AICharacter.path.like(f"{category_path}/%"))
        )
    if q:
        base = base.where(AICharacter.name.ilike(f"%{q}%"))

    # 属性维度筛选：在 JSON 文本上用 LIKE 粗筛（键值对模式），足以覆盖当前规模。
    active_filters: dict[str, list[str]] = {}
    for key in FILTER_KEYS:
        val = request.query_params.get(key)
        if not val:
            continue
        wanted = [v for v in val.split(",") if v]
        if not wanted:
            continue
        active_filters[key] = wanted
        # JSON 存储形如 "键": "值"；用 LIKE 匹配 "键": "值中之一"
        from sqlalchemy import or_
        clauses = [AICharacter.attributes_json.like(f'%"{key}": "{v}"%') for v in wanted]
        base = base.where(or_(*clauses))

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    rows = (await db.execute(
        base.order_by(AICharacter.path, AICharacter.sort_order, AICharacter.name)
            .offset(offset).limit(limit)
    )).scalars().all()

    return ResponseBase(
        success=True,
        data={
            "items": [_char_card(c) for c in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        },
    )


@router.get("/{character_key}", response_model=ResponseBase)
async def get_character(
    character_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    c = (await db.execute(
        select(AICharacter).where(AICharacter.character_key == character_key)
    )).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="AI 角色不存在")
    return ResponseBase(success=True, data=_char_detail(c))


@router.get("/{character_key}/images/{image_id}/file")
async def get_character_image_file(
    character_key: str,
    image_id: int,
    db: AsyncSession = Depends(get_db),
):
    """流式返回 AI 角色图片。

    无鉴权：character_key 为不可猜测 UUID，作为能力令牌（与 project_assets /
    characters 图片端点一致），使 <img src> 直接可用。
    """
    img = (await db.execute(
        select(AICharacterImage).join(AICharacter).where(
            AICharacter.character_key == character_key,
            AICharacterImage.id == image_id,
        )
    )).scalar_one_or_none()
    if not img:
        raise HTTPException(status_code=404, detail="图片不存在")

    storage = get_storage_service()
    data, content_type = await storage.get_object_bytes(img.image_path)
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
