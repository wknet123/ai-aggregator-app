"""
Workflow Schemas
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum


class WorkflowStatus(str, Enum):
    DRAFT = "DRAFT"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class StepType(str, Enum):
    TEXT_TO_IMAGE = "TEXT_TO_IMAGE"
    IMAGE_TO_VIDEO = "IMAGE_TO_VIDEO"
    VIDEO_TO_3D = "VIDEO_TO_3D"


class StepStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class WorkflowStepCreate(BaseModel):
    """Create workflow step"""
    step_type: StepType
    model_id: str
    is_optional: bool = False
    input_data: Optional[Dict[str, Any]] = None


class WorkflowStepUpdate(BaseModel):
    """Update workflow step"""
    input_data: Optional[Dict[str, Any]] = None
    output_data: Optional[Dict[str, Any]] = None
    status: Optional[StepStatus] = None


class WorkflowStepResponse(BaseModel):
    """Workflow step response"""
    id: int
    workflow_id: int
    step_index: int
    step_type: StepType
    status: StepStatus
    model_id: str
    input_data: Optional[Dict[str, Any]] = None
    output_data: Optional[Dict[str, Any]] = None
    is_optional: bool
    cost: str
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class WorkflowCreate(BaseModel):
    """Create workflow"""
    name: str
    description: Optional[str] = None
    steps: List[WorkflowStepCreate]


class WorkflowUpdate(BaseModel):
    """Update workflow"""
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[WorkflowStatus] = None


class WorkflowResponse(BaseModel):
    """Workflow response"""
    id: int
    tenant_id: int
    user_id: int
    name: str
    description: Optional[str] = None
    status: WorkflowStatus
    current_step_index: int
    total_cost: str
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    steps: List[WorkflowStepResponse] = []
    
    class Config:
        from_attributes = True


class ExecuteStepRequest(BaseModel):
    """Execute step request"""
    input_data: Dict[str, Any] = Field(..., description="Input parameters for the step")
    model_id: Optional[str] = Field(None, description="Optional model ID override for this step")


class ConfirmStepRequest(BaseModel):
    """Confirm step request"""
    confirmed: bool = Field(..., description="Whether user confirms the result")
    feedback: Optional[str] = Field(None, description="Optional user feedback")
