"""
Workflow Repository
"""
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.repositories.base import BaseRepository
from app.models.workflow import WorkflowInstance, WorkflowStep, WorkflowStatus, StepStatus


class WorkflowRepository(BaseRepository[WorkflowInstance]):
    """Workflow repository"""
    
    def __init__(self, db: AsyncSession):
        super().__init__(WorkflowInstance, db)
    
    async def get_with_steps(self, workflow_id: int) -> Optional[WorkflowInstance]:
        """Get workflow with all steps"""
        stmt = select(WorkflowInstance).where(
            WorkflowInstance.id == workflow_id
        ).options(selectinload(WorkflowInstance.steps))
        
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
    
    async def get_by_tenant(
        self, 
        tenant_id: int, 
        skip: int = 0, 
        limit: int = 100
    ) -> List[WorkflowInstance]:
        """Get workflows by tenant"""
        stmt = select(WorkflowInstance).where(
            WorkflowInstance.tenant_id == tenant_id
        ).options(
            selectinload(WorkflowInstance.steps)
        ).offset(skip).limit(limit).order_by(WorkflowInstance.created_at.desc())
        
        result = await self.db.execute(stmt)
        return result.scalars().all()
    
    async def get_by_user(
        self, 
        user_id: int, 
        skip: int = 0, 
        limit: int = 100
    ) -> List[WorkflowInstance]:
        """Get workflows by user"""
        stmt = select(WorkflowInstance).where(
            WorkflowInstance.user_id == user_id
        ).options(
            selectinload(WorkflowInstance.steps)
        ).offset(skip).limit(limit).order_by(WorkflowInstance.created_at.desc())
        
        result = await self.db.execute(stmt)
        return result.scalars().all()


class WorkflowStepRepository(BaseRepository[WorkflowStep]):
    """Workflow step repository"""
    
    def __init__(self, db: AsyncSession):
        super().__init__(WorkflowStep, db)
    
    async def get_by_workflow(self, workflow_id: int) -> List[WorkflowStep]:
        """Get all steps for a workflow"""
        stmt = select(WorkflowStep).where(
            WorkflowStep.workflow_id == workflow_id
        ).order_by(WorkflowStep.step_index)
        
        result = await self.db.execute(stmt)
        return result.scalars().all()
    
    async def get_current_step(self, workflow_id: int, step_index: int) -> Optional[WorkflowStep]:
        """Get current step by index"""
        stmt = select(WorkflowStep).where(
            WorkflowStep.workflow_id == workflow_id,
            WorkflowStep.step_index == step_index
        )
        
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
    
    async def update_status(
        self, 
        step_id: int, 
        status: StepStatus,
        output_data: Optional[dict] = None,
        error_message: Optional[str] = None
    ) -> Optional[WorkflowStep]:
        """Update step status"""
        step = await self.get(step_id)
        if not step:
            return None
        
        step.status = status
        if output_data is not None:
            step.output_data = output_data
        if error_message is not None:
            step.error_message = error_message
        
        await self.db.commit()
        await self.db.refresh(step)
        return step
