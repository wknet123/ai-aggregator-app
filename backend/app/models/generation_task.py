"""
Generation Task Model for async job tracking
"""
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.db.base import Base


class GenerationTask(Base):
    """Generation task model"""
    __tablename__ = "generation_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(Integer, nullable=False, index=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    
    model_id = Column(String(50), nullable=False)
    task_type = Column(String(20), nullable=False)  # image, video
    
    prompt = Column(Text, nullable=False)
    parameters = Column(Text)  # JSON string of generation parameters
    
    status = Column(String(20), default="pending", nullable=False, index=True)  # pending, processing, completed, failed
    progress = Column(Integer, default=0)
    
    result_path = Column(String(500))
    result_url = Column(String(500))
    error_message = Column(Text)
    
    is_favorite = Column(Integer, default=0, nullable=False, index=True)  # 收藏标记 (0=否, 1=是)
    is_public = Column(Integer, default=0, nullable=False, index=True)  # 公开标记 (0=私有, 1=公开)
    # 作品展示标记：只有最终成片(及用户直接生成的单图/单视频)才作为「作品」展示在作品画廊/AI图片/AI视频；
    # 短剧中间产物(分镜图、逐镜分镜视频)与上传素材一律为 0，从作品列表中过滤掉。
    show_in_gallery = Column(Integer, default=1, nullable=False, index=True)  # 1=展示, 0=中间过程/素材

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)
