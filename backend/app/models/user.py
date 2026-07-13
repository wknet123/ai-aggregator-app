"""
User Model
"""
from sqlalchemy import Column, String, Boolean, Integer, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class User(Base):
    """User model"""
    
    __tablename__ = "users"
    
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100))
    is_active = Column(Boolean, default=True, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    
    # Foreign Keys
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    # 映射到某一组 AI 网关凭证；NULL = 使用默认组（is_default）。
    gateway_config_id = Column(Integer, ForeignKey("gateway_configs.id"), nullable=True)
    
    # Relationships
    tenant = relationship("Tenant", back_populates="users")
    api_keys = relationship("APIKey", back_populates="user", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<User {self.username}>"
