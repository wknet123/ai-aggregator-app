"""
Gateway 凭证解析层（进程内同步缓存）。

两个凭证出口（GatewayClient、harness/llm.py 的 ChatOpenAI）散落在 18+ 处同步调用点，
不便逐一注入 async DB 依赖。故这里维护一个进程内缓存：启动/写操作后由 refresh_cache(db)
全量刷新，调用点用同步的 resolve_for_user(user_id) 拿 (base_url, api_key)。

回退顺序：用户映射 → 默认组(is_default) → settings.AI_GATEWAY_*（冷启动兜底）。
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

logger = logging.getLogger(__name__)

# id → (base_url, api_key)
_configs: dict[int, Tuple[str, str]] = {}
# user_id → gateway_config_id
_user_map: dict[int, int] = {}
# 默认组 (base_url, api_key)，None = 尚未加载/无默认组
_default: Optional[Tuple[str, str]] = None
_loaded: bool = False


async def refresh_cache(db: AsyncSession) -> None:
    """从 DB 全量重建缓存。启动时 + admin 每次写操作后调用。"""
    global _configs, _user_map, _default, _loaded
    # 延迟 import 避免模型循环依赖
    from app.models.gateway_config import GatewayConfig
    from app.models.user import User

    configs = (await db.execute(select(GatewayConfig))).scalars().all()
    new_configs: dict[int, Tuple[str, str]] = {}
    new_default: Optional[Tuple[str, str]] = None
    for c in configs:
        if not c.is_active:
            continue
        new_configs[c.id] = (c.base_url, c.api_key)
        if c.is_default:
            new_default = (c.base_url, c.api_key)

    rows = (await db.execute(
        select(User.id, User.gateway_config_id).where(User.gateway_config_id.isnot(None))
    )).all()
    new_user_map = {uid: cid for uid, cid in rows if cid is not None}

    _configs = new_configs
    _user_map = new_user_map
    _default = new_default
    _loaded = True
    logger.info(
        "gateway config cache refreshed: %d configs, %d user mappings, default=%s",
        len(_configs), len(_user_map), "yes" if _default else "no",
    )


def is_loaded() -> bool:
    return _loaded


def _fallback() -> Tuple[str, str]:
    """settings 兜底（冷启动、缓存未加载、无默认组时）。"""
    return (settings.AI_GATEWAY_BASE_URL, settings.AI_GATEWAY_API_KEY or "")


def resolve_for_user(user_id: Optional[int]) -> Tuple[str, str]:
    """同步返回该用户应使用的 (base_url, api_key)。

    用户映射 → 默认组 → settings 兜底。任一层缺失都平滑回退到下一层。
    """
    if user_id is not None:
        cid = _user_map.get(user_id)
        if cid is not None:
            cfg = _configs.get(cid)
            if cfg is not None:
                return cfg
            # 映射指向已停用/已删除的配置：回退默认组
    if _default is not None:
        return _default
    return _fallback()
