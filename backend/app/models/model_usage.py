"""
Model Usage - Track AI model usage for billing
"""
from sqlalchemy import Column, String, Integer, ForeignKey, Numeric, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base


class ModelUsage(Base):
    """Model usage tracking for billing"""
    
    __tablename__ = "model_usages"
    
    model_provider = Column(String(50), nullable=False)  # openai, google, flux, worldlabs
    model_name = Column(String(100), nullable=False)  # gpt-4, dalle-3, etc.
    cost = Column(Numeric(10, 4), nullable=False)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    extra_data = Column(JSON)  # Additional usage details
    
    # Foreign Keys
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    
    # Relationships
    tenant = relationship("Tenant", back_populates="model_usages")
    
    def __repr__(self):
        return f"<ModelUsage {self.model_provider}/{self.model_name} cost={self.cost}>"
