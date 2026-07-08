"""
Render Pipeline Model – tracks chained video generation across storyboard shots.

Each pipeline contains N shots, each mapped to a GenerationTask.
Shots are processed sequentially: shot N+1 depends on shot N's last frame (chain reference).
"""
from sqlalchemy import Column, Integer, String, Text, DateTime
from app.db.base import Base


class RenderPipeline(Base):
    __tablename__ = "render_pipelines"

    pipeline_id = Column(String(36), unique=True, index=True, nullable=False)
    user_id     = Column(Integer, nullable=False, index=True)
    tenant_id   = Column(Integer, nullable=False, index=True)

    # pending | processing | completed | failed | partial
    status = Column(String(20), default="pending", index=True)

    # Total shots & progress
    total_shots    = Column(Integer, default=0)
    completed_shots = Column(Integer, default=0)
    failed_shots   = Column(Integer, default=0)

    # JSON: full storyboard snapshot at render time
    storyboard_json = Column(Text, nullable=True)

    # JSON array: [{shot_index, task_id, status, seed, result_url, error}]
    shot_tasks_json = Column(Text, nullable=True)

    # Final composite video path (MinIO key)
    composite_path = Column(String(500), nullable=True)
    composite_url  = Column(String(500), nullable=True)

    error_message = Column(Text, nullable=True)
