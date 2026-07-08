"""
Credit Model - Credit system for tenant
"""
from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class Credit(Base):
    """Credit model for tenant credit management"""
    
    __tablename__ = "credits"
    
    balance = Column(Integer, default=0, nullable=False)
    total_recharged = Column(Integer, default=0, nullable=False)
    total_consumed = Column(Integer, default=0, nullable=False)
    
    # Foreign Keys
    tenant_id = Column(Integer, ForeignKey("tenants.id"), unique=True, nullable=False)
    
    # Relationships
    tenant = relationship("Tenant", back_populates="credits")
    
    def __repr__(self):
        return f"<Credit tenant_id={self.tenant_id} balance={self.balance}>"
