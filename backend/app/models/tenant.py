"""
Tenant Model - Multi-tenant architecture
"""
from sqlalchemy import Column, String, Boolean, Integer
from sqlalchemy.orm import relationship
from app.db.base import Base


class Tenant(Base):
    """Tenant model for multi-tenant architecture"""
    
    __tablename__ = "tenants"
    
    name = Column(String(100), nullable=False, index=True)
    slug = Column(String(50), unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    max_users = Column(Integer, default=10)
    
    # Relationships
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    credits = relationship("Credit", back_populates="tenant", uselist=False, cascade="all, delete-orphan")
    transactions = relationship("Transaction", back_populates="tenant", cascade="all, delete-orphan")
    model_usages = relationship("ModelUsage", back_populates="tenant", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Tenant {self.name}>"
