"""
Gateway Config Model — 多组 AI 网关凭证（base_url + api_key）。

平台级全局配置（不做租户隔离）。用户通过 users.gateway_config_id 映射到某一组；
未映射的用户回退到 is_default=True 的那组。首次启动由 main.py 从 settings.AI_GATEWAY_* 播种默认组。
"""
from sqlalchemy import Column, String, Boolean
from app.db.base import Base


class GatewayConfig(Base):
    """一组 AI 网关凭证。"""

    __tablename__ = "gateway_configs"

    name = Column(String(100), nullable=False)
    base_url = Column(String(500), nullable=False)
    api_key = Column(String(500), nullable=False)
    # 默认组：未显式映射的用户回退到此组（全库应仅有一行为 True）。
    is_default = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    def __repr__(self):
        return f"<GatewayConfig {self.name}{' *default' if self.is_default else ''}>"
