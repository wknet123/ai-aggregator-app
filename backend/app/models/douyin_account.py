"""
Douyin Account Model - 抖音账号绑定
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from datetime import datetime
from app.db.base import Base


class DouyinAccount(Base):
    """用户绑定的抖音账号"""

    __tablename__ = "douyin_accounts"

    # 1. Added a primary key for this table
    id = Column(Integer, primary_key=True, autoincrement=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    open_id = Column(String(128), nullable=False, index=True)
    access_token = Column(String(512), nullable=False)
    refresh_token = Column(String(512), nullable=False)
    access_token_expires_at = Column(DateTime, nullable=False)
    refresh_token_expires_at = Column(DateTime, nullable=False)
    nickname = Column(String(128), nullable=True)

    def __repr__(self):
        return f"<DouyinAccount user_id={self.user_id} nickname={self.nickname}>"
