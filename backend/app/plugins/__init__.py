"""Plugin 层：原子能力抽象。每个 Plugin 封装一次 gateway 调用，对 LLM 暴露为 function-calling 工具。"""
from app.plugins.base import BasePlugin, PluginContext, PluginResult
from app.plugins.registry import register_plugin, get_plugin, all_plugins, load_builtin_plugins

__all__ = [
    "BasePlugin", "PluginContext", "PluginResult",
    "register_plugin", "get_plugin", "all_plugins", "load_builtin_plugins",
]
