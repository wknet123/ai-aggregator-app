"""
Project Asset Model – per-project 角色 / 场景 / 道具 configuration assets.

Each drama project owns its own set of assets grouped by asset_type. Every asset
holds a name + description and one or more images (a required 主图 cover + optional
其他视角 副图). Images live in MinIO under:

    users/{uid}/drama/{project_id}/assets/{asset_id}/{filename}
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class ProjectAsset(Base):
    __tablename__ = "project_assets"

    asset_id     = Column(String(36), unique=True, index=True, nullable=False)
    project_id   = Column(String(36), nullable=False, index=True)   # → drama_projects.project_id
    user_id      = Column(Integer, nullable=False, index=True)
    tenant_id    = Column(Integer, nullable=False, index=True)

    asset_type   = Column(String(20), nullable=False, index=True)   # 'character' | 'scene' | 'prop'
    name         = Column(String(200), nullable=False)
    description  = Column(Text, nullable=True)

    # Cover (主图) MinIO key – redundant mirror of the is_cover image for quick listing.
    cover_path   = Column(String(500), nullable=True)
    sort_order   = Column(Integer, default=0)   # display order within the same type

    # 溯源：若该要素由 AI 角色库「应用到画布」实例化而来，记录来源 character_key
    # （仅溯源用途，实例本身独立可编辑，不受全局定义只读约束）。
    source_ai_character_key = Column(String(36), nullable=True, index=True)

    deleted_at   = Column(DateTime, nullable=True)

    images = relationship(
        "ProjectAssetImage",
        back_populates="asset",
        lazy="selectin",
        order_by="ProjectAssetImage.sort_order",
        cascade="all, delete-orphan",
    )


class ProjectAssetImage(Base):
    __tablename__ = "project_asset_images"

    asset_id   = Column(Integer, ForeignKey("project_assets.id", ondelete="CASCADE"), nullable=False, index=True)
    image_path = Column(String(500), nullable=False)   # MinIO object key
    is_cover   = Column(Integer, default=0)             # 1 = 主图
    sort_order = Column(Integer, default=0)

    asset = relationship("ProjectAsset", back_populates="images")
