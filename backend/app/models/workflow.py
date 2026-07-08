"""
Workflow Models - OmniWeaver System
"""
from sqlalchemy import Column, Integer, String, Text, JSON, Boolean, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.db.base import Base


class WorkflowStatus(str, enum.Enum):
    """Workflow status"""
    DRAFT = "DRAFT"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class StepType(str, enum.Enum):
    """Step type"""
    TEXT_TO_IMAGE = "TEXT_TO_IMAGE"
    IMAGE_TO_VIDEO = "IMAGE_TO_VIDEO"
    VIDEO_TO_3D = "VIDEO_TO_3D"


class StepStatus(str, enum.Enum):
    """Step status"""
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class WorkflowInstance(Base):
    """Workflow instance"""
    __tablename__ = "workflow_instances"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(SQLEnum(WorkflowStatus), default=WorkflowStatus.DRAFT, nullable=False)
    current_step_index = Column(Integer, default=0, nullable=False)
    
    # Metadata
    total_cost = Column(String(20), default="0", nullable=False)  # Total credits consumed
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    steps = relationship("WorkflowStep", back_populates="workflow", cascade="all, delete-orphan")
    tenant = relationship("Tenant")
    user = relationship("User")


class WorkflowStep(Base):
    """Workflow step"""
    __tablename__ = "workflow_steps"
    
    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("workflow_instances.id"), nullable=False, index=True)
    
    step_index = Column(Integer, nullable=False)  # Order in workflow
    step_type = Column(SQLEnum(StepType), nullable=False)
    status = Column(SQLEnum(StepStatus), default=StepStatus.PENDING, nullable=False)
    
    # Configuration
    model_id = Column(String(100), nullable=False)  # e.g., "dall-e-3", "sora-2"
    input_data = Column(JSON, nullable=True)  # Input parameters (prompt, previous output, etc.)
    output_data = Column(JSON, nullable=True)  # Generated results (URLs, metadata)
    
    # Optional features
    is_optional = Column(Boolean, default=False, nullable=False)
    
    # Execution info
    cost = Column(String(20), default="0", nullable=False)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    workflow = relationship("WorkflowInstance", back_populates="steps")
