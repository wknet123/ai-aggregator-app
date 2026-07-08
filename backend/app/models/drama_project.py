"""
Drama Project Model – stores metadata + serialized outline/storyboard state.
MinIO media is organized under  users/{uid}/drama/{project_id}/images|videos/
"""
from sqlalchemy import Column, Integer, String, Text, DateTime
from app.db.base import Base


class DramaProject(Base):
    __tablename__ = "drama_projects"

    project_id   = Column(String(36),  unique=True, index=True, nullable=False)
    user_id      = Column(Integer,     nullable=False, index=True)
    tenant_id    = Column(Integer,     nullable=False, index=True)

    name         = Column(String(200), nullable=False)
    description  = Column(Text,        nullable=True)
    concept      = Column(Text,        nullable=True)   # original story concept text
    genre        = Column(String(50),  nullable=True)
    art_style    = Column(String(50),  nullable=True)
    aspect_ratio = Column(String(10),  nullable=True)
    episode_count = Column(Integer,    default=0)

    # 剧创式重构新增字段
    script_text   = Column(Text,        nullable=True)   # imported full script (剧本生短剧)
    source_mode   = Column(String(20),  default="concept")  # concept | script
    style_lock    = Column(String(20),  nullable=True)   # 2d | 3d | realistic (全局风格锁)
    final_video_path = Column(String(500), nullable=True)  # assembled episode video MinIO key

    # draft | in_progress | completed
    status       = Column(String(20),  default="draft", index=True)

    # Full serialized state (JSON strings)
    # NOTE: outline_data/storyboard_data/materials_data belong to the legacy
    # 5-stage pipeline (OmniWeaver.tsx) and are no longer read by the refactored
    # script-first OmniWeaver. Kept nullable to avoid a destructive drop.
    outline_data    = Column(Text, nullable=True)   # legacy OutlineResponse
    storyboard_data = Column(Text, nullable=True)   # legacy Record<epNum, ShotState[]>
    materials_data  = Column(Text, nullable=True)   # legacy MaterialsData JSON

    # Refactored core state: a series of episodes, each with its own script,
    # shots (time-segment storyboard / beats), and rendered composite.
    # Shape: { "episodes": [ { episode, title, script_text, shots:[...], composite_path, composite_url } ] }
    episodes_data   = Column(Text, nullable=True)

    # First completed image used as card thumbnail (task URL or MinIO key)
    thumbnail_path = Column(String(500), nullable=True)

    # Archival: set when the project is archived (status mirrors to 'archived').
    archived_at = Column(DateTime, nullable=True)

    deleted_at = Column(DateTime, nullable=True)
