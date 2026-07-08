"""
Workflow API endpoints - OmniWeaver
"""
from typing import Annotated, List
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_user, get_current_tenant
from app.models.user import User
from app.models.tenant import Tenant
from app.services.workflow_service import WorkflowService
from app.schemas.workflow import (
    WorkflowCreate,
    WorkflowResponse,
    WorkflowUpdate,
    ExecuteStepRequest,
    ConfirmStepRequest,
    WorkflowStepResponse
)
from app.schemas.response import ResponseBase
from app.core.credits import InsufficientCreditsError


router = APIRouter()


@router.post("/", response_model=ResponseBase[WorkflowResponse])
async def create_workflow(
    workflow_data: WorkflowCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant: Annotated[Tenant, Depends(get_current_tenant)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Create a new workflow"""
    try:
        workflow_service = WorkflowService(db)
        workflow = await workflow_service.create_workflow(
            tenant_id=tenant.id,
            user_id=current_user.id,
            workflow_data=workflow_data
        )
        
        return ResponseBase(
            success=True,
            message="Workflow created successfully",
            data=WorkflowResponse.model_validate(workflow)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create workflow: {str(e)}"
        )


@router.get("/", response_model=ResponseBase[List[WorkflowResponse]])
async def list_workflows(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant: Annotated[Tenant, Depends(get_current_tenant)],
    db: Annotated[AsyncSession, Depends(get_db)],
    skip: int = 0,
    limit: int = 100
):
    """List all workflows for current user"""
    from app.repositories.workflow_repository import WorkflowRepository
    
    workflow_repo = WorkflowRepository(db)
    workflows = await workflow_repo.get_by_user(current_user.id, skip, limit)
    
    return ResponseBase(
        success=True,
        message="Workflows retrieved successfully",
        data=[WorkflowResponse.model_validate(w) for w in workflows]
    )


@router.get("/{workflow_id}", response_model=ResponseBase[WorkflowResponse])
async def get_workflow(
    workflow_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Get workflow by ID"""
    from app.repositories.workflow_repository import WorkflowRepository
    
    workflow_repo = WorkflowRepository(db)
    workflow = await workflow_repo.get_with_steps(workflow_id)
    
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )
    
    if workflow.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this workflow"
        )
    
    return ResponseBase(
        success=True,
        message="Workflow retrieved successfully",
        data=WorkflowResponse.model_validate(workflow)
    )


@router.post("/{workflow_id}/steps/{step_index}/execute", response_model=ResponseBase[WorkflowStepResponse])
async def execute_step(
    workflow_id: int,
    step_index: int,
    request: ExecuteStepRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Execute a workflow step"""
    try:
        workflow_service = WorkflowService(db)
        
        # Verify ownership
        from app.repositories.workflow_repository import WorkflowRepository
        workflow_repo = WorkflowRepository(db)
        workflow = await workflow_repo.get(workflow_id)
        
        if not workflow or workflow.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to execute this workflow"
            )
        
        step = await workflow_service.execute_step(
            workflow_id=workflow_id,
            step_index=step_index,
            input_data=request.input_data,
            background_tasks=background_tasks,
            model_id_override=request.model_id
        )
        
        return ResponseBase(
            success=True,
            message="Step execution started",
            data=WorkflowStepResponse.model_validate(step)
        )
        
    except InsufficientCreditsError as e:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Step execution failed: {str(e)}"
        )


@router.post("/{workflow_id}/steps/{step_index}/confirm", response_model=ResponseBase[WorkflowResponse])
async def confirm_step(
    workflow_id: int,
    step_index: int,
    request: ConfirmStepRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Confirm step completion and move to next step"""
    try:
        workflow_service = WorkflowService(db)
        
        # Verify ownership
        from app.repositories.workflow_repository import WorkflowRepository
        workflow_repo = WorkflowRepository(db)
        workflow = await workflow_repo.get(workflow_id)
        
        if not workflow or workflow.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to confirm this workflow"
            )
        
        workflow = await workflow_service.confirm_step(
            workflow_id=workflow_id,
            step_index=step_index,
            confirmed=request.confirmed,
            feedback=request.feedback
        )
        
        return ResponseBase(
            success=True,
            message="Step confirmed successfully",
            data=WorkflowResponse.model_validate(workflow)
        )
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Step confirmation failed: {str(e)}"
        )


@router.delete("/{workflow_id}", response_model=ResponseBase[dict])
async def delete_workflow(
    workflow_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Delete workflow"""
    from app.repositories.workflow_repository import WorkflowRepository
    
    workflow_repo = WorkflowRepository(db)
    workflow = await workflow_repo.get(workflow_id)
    
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )
    
    if workflow.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this workflow"
        )
    
    await workflow_repo.delete(workflow_id)
    
    return ResponseBase(
        success=True,
        message="Workflow deleted successfully",
        data={"id": workflow_id}
    )


@router.post("/{workflow_id}/prepare-next-step/{step_index}")
async def prepare_next_step_endpoint(
    workflow_id: int,
    step_index: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Manually trigger prepare_next_step to inject context (temporary fix for hot-reload issues)"""
    try:
        workflow_service = WorkflowService(db)
        
        # Verify ownership
        from app.repositories.workflow_repository import WorkflowRepository
        workflow_repo = WorkflowRepository(db)
        workflow = await workflow_repo.get(workflow_id)
        
        if not workflow or workflow.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to access this workflow"
            )
        
        # Call prepare_next_step
        await workflow_service.prepare_next_step(workflow_id, step_index)
        
        # Get updated workflow to return
        workflow = await workflow_repo.get_with_steps(workflow_id)
        
        return ResponseBase(
            success=True,
            message=f"Context prepared for next step after step {step_index}",
            data=WorkflowResponse.model_validate(workflow)
        )
        
    except Exception as e:
        logger.error(f"Failed to prepare next step: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to prepare next step: {str(e)}"
        )
