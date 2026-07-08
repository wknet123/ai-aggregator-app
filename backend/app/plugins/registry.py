"""Plugin 注册表：name → 单例实例。启动时自动发现内置 Plugin。"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Type

from app.plugins.base import BasePlugin

logger = logging.getLogger(__name__)

_REGISTRY: Dict[str, BasePlugin] = {}


def register_plugin(cls: Type[BasePlugin]) -> Type[BasePlugin]:
    """类装饰器：实例化并注册一个 Plugin。"""
    inst = cls()
    if not inst.name:
        raise ValueError(f"Plugin {cls.__name__} 缺少 name")
    _REGISTRY[inst.name] = inst
    return cls


def get_plugin(name: str) -> Optional[BasePlugin]:
    return _REGISTRY.get(name)


def all_plugins() -> List[BasePlugin]:
    return list(_REGISTRY.values())


_loaded = False


def load_builtin_plugins() -> None:
    """导入内置 Plugin 模块以触发注册（幂等）。"""
    global _loaded
    if _loaded:
        return
    # 导入即注册（image + video 族）。audio 族 P2 再加。
    from app.plugins.image import generate as _  # noqa: F401
    from app.plugins.video import text_to_video as _t2v  # noqa: F401
    from app.plugins.video import image_to_video as _i2v  # noqa: F401
    _loaded = True
    logger.info("loaded builtin plugins: %s", list(_REGISTRY.keys()))
