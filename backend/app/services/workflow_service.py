"""
Workflow Service - OmniWeaver State Machine
"""
from typing import Dict, Any, Optional
from decimal import Decimal
from datetime import datetime
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import BackgroundTasks

from app.models.workflow import WorkflowInstance, WorkflowStep, WorkflowStatus, StepStatus, StepType
from app.models.generation_task import GenerationTask
from app.models.generation_task import GenerationTask
from app.repositories.workflow_repository import WorkflowRepository, WorkflowStepRepository
from app.services.openai_service import OpenAIService
from app.services.google_service import GoogleService
from app.config import Settings
from app.utils.helpers import get_user_output_path
from app.core.credits import InsufficientCreditsError
from app.schemas.workflow import WorkflowCreate, WorkflowStepCreate
import logging

logger = logging.getLogger(__name__)


class WorkflowService:
    """Workflow orchestration service"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.workflow_repo = WorkflowRepository(db)
        self.step_repo = WorkflowStepRepository(db)
        self.openai_service = OpenAIService(db, use_mock=True)
        self.google_service = GoogleService(db)
        self.settings = Settings()
    
    async def create_workflow(
        self,
        tenant_id: int,
        user_id: int,
        workflow_data: WorkflowCreate
    ) -> WorkflowInstance:
        """Create new workflow with steps"""
        # Create workflow instance
        workflow = WorkflowInstance(
            tenant_id=tenant_id,
            user_id=user_id,
            name=workflow_data.name,
            description=workflow_data.description,
            status=WorkflowStatus.DRAFT,
            current_step_index=0,
            total_cost="0"
        )
        
        self.db.add(workflow)
        await self.db.flush()
        
        # Create steps
        for index, step_data in enumerate(workflow_data.steps):
            step = WorkflowStep(
                workflow_id=workflow.id,
                step_index=index,
                step_type=step_data.step_type,
                model_id=step_data.model_id,
                status=StepStatus.PENDING if index == 0 else StepStatus.PENDING,
                input_data=step_data.input_data or {},
                is_optional=step_data.is_optional,
                cost="0"
            )
            self.db.add(step)
        
        await self.db.commit()
        await self.db.refresh(workflow)
        
        # Load steps
        workflow = await self.workflow_repo.get_with_steps(workflow.id)
        return workflow
    
    async def execute_step(
        self,
        workflow_id: int,
        step_index: int,
        input_data: Dict[str, Any],
        background_tasks: BackgroundTasks,
        model_id_override: Optional[str] = None
    ) -> WorkflowStep:
        """Execute a workflow step"""
        workflow = await self.workflow_repo.get_with_steps(workflow_id)
        if not workflow:
            raise ValueError("Workflow not found")
        
        step = await self.step_repo.get_current_step(workflow_id, step_index)
        if not step:
            raise ValueError("Step not found")
        
        # Validate step can be executed
        if step.status not in [StepStatus.PENDING, StepStatus.FAILED]:
            if step.status == StepStatus.COMPLETED:
                raise ValueError(f"Step {step_index} has already been completed. Current active step is {workflow.current_step_index}.")
            elif step.status == StepStatus.PROCESSING:
                raise ValueError(f"Step {step_index} is currently being processed. Please wait for it to complete.")
            else:
                raise ValueError(f"Step cannot be executed in status: {step.status}")
        
        # Use model override if provided
        if model_id_override:
            step.model_id = model_id_override
        
        # Merge input_data: Keep existing context (e.g. injected image_url), update with new user input
        merged_input = {**(step.input_data or {}), **input_data}
        
        # Update step status to PROCESSING
        step.status = StepStatus.PROCESSING
        step.started_at = datetime.utcnow()
        step.input_data = merged_input
        await self.db.commit()
        
        logger.info(f"Executing step {step_index}: type={step.step_type}, merged_input={merged_input}")
        
        # Execute based on step type
        try:
            if step.step_type == StepType.TEXT_TO_IMAGE:
                result = await self._execute_text_to_image(workflow.tenant_id, workflow.user_id, step, merged_input)
            elif step.step_type == StepType.IMAGE_TO_VIDEO:
                # Use background task for long-running video generation
                background_tasks.add_task(
                    self._execute_image_to_video_background,
                    workflow.tenant_id,
                    workflow.user_id,
                    step.id,
                    merged_input
                )
                step.status = StepStatus.PROCESSING
                step.output_data = {"status": "processing", "message": "Video generation in progress"}
                await self.db.commit()
                await self.db.refresh(step)
                return step
            elif step.step_type == StepType.VIDEO_TO_3D:
                # VIDEO_TO_3D step is temporarily disabled
                logger.warning(f"VIDEO_TO_3D step is temporarily disabled")
                step.status = StepStatus.FAILED
                step.completed_at = datetime.utcnow()
                step.output_data = {
                    "status": "disabled", 
                    "message": "3D generation is temporarily disabled",
                    "error": "This feature is currently unavailable"
                }
                await self.db.commit()
                await self.db.refresh(step)
                return step
            else:
                raise ValueError(f"Unknown step type: {step.step_type}")
            
            # Mark step as completed
            step.status = StepStatus.COMPLETED
            step.output_data = result
            step.completed_at = datetime.utcnow()
            
            # Create Gallery record if this is an image/video generation
            if step.step_type == StepType.TEXT_TO_IMAGE and result.get("url"):
                await self._create_gallery_record(
                    user_id=workflow.user_id,
                    task_type="image",
                    model_id=step.model_id,
                    prompt=merged_input.get("prompt", ""),
                    parameters={
                        "aspect_ratio": merged_input.get("aspect_ratio", "4:3"),
                        "source": "omniweaver"
                    },
                    result_url=result["url"],
                    workflow_step_id=step.id
                )
            
            await self.db.commit()
            await self.db.refresh(step)
            
            logger.info(f"Step {step_index} completed with output: {result}")
            
            # Prepare next step by injecting context
            await self.prepare_next_step(workflow_id, step_index)
            
            return step
            
        except InsufficientCreditsError as e:
            # Rollback first to clean session state
            await self.db.rollback()
            # Reload step from database
            step = await self.step_repo.get_current_step(workflow_id, step_index)
            if step:
                step.status = StepStatus.FAILED
                step.error_message = str(e)
                await self.db.commit()
            raise
        except Exception as e:
            logger.error(f"Step execution failed: {str(e)}")
            # Rollback first to clean session state
            await self.db.rollback()
            # Reload step from database
            step = await self.step_repo.get_current_step(workflow_id, step_index)
            if step:
                step.status = StepStatus.FAILED
                step.error_message = str(e)
                await self.db.commit()
            raise
    
    async def confirm_step(
        self,
        workflow_id: int,
        step_index: int,
        confirmed: bool,
        feedback: Optional[str] = None
    ) -> WorkflowInstance:
        """
        Confirm step completion and prepare next step.
        NOTE: With auto-advance feature, this method is mostly deprecated.
        Steps automatically advance after completion.
        """
        workflow = await self.workflow_repo.get_with_steps(workflow_id)
        if not workflow:
            raise ValueError("Workflow not found")
        
        step = await self.step_repo.get_current_step(workflow_id, step_index)
        if not step:
            raise ValueError("Step not found")
        
        # Refresh step to get latest status from database
        await self.db.refresh(step)
        
        logger.info(f"Confirming step {step_index} with status: {step.status}")
        
        # If step is already completed (auto-advance), just return current workflow state
        if step.status == StepStatus.COMPLETED:
            logger.info(f"Step {step_index} already completed (auto-advanced). Returning current state.")
            return workflow
        
        # If step is still awaiting confirmation (shouldn't happen with auto-advance)
        if step.status == StepStatus.AWAITING_CONFIRMATION:
            if not confirmed:
                # User rejected the result, reset step
                step.status = StepStatus.PENDING
                step.output_data = None
                await self.db.commit()
                return workflow
            
            # Confirm step completion and advance (legacy behavior)
            step.status = StepStatus.COMPLETED
            await self.db.commit()
            
            # Check if there's a next step
            next_step_index = step_index + 1
            if next_step_index < len(workflow.steps):
                # Inject current step output as next step input
                next_step = workflow.steps[next_step_index]
                
                # Context injection: pass output to next step
                context_data = self._inject_context(step, next_step)
                next_step.input_data = {**(next_step.input_data or {}), **context_data}
                next_step.status = StepStatus.PENDING
                
                workflow.current_step_index = next_step_index
                workflow.status = WorkflowStatus.RUNNING
            else:
                # All steps completed
                workflow.status = WorkflowStatus.COMPLETED
                workflow.completed_at = datetime.utcnow()
            
            await self.db.commit()
            await self.db.refresh(workflow)
            return workflow
        
        # Invalid state for confirmation
        raise ValueError(f"Cannot confirm step in status: {step.status}. Step should be COMPLETED or AWAITING_CONFIRMATION.")
        
        return workflow
    
    async def prepare_next_step(self, workflow_id: int, current_step_index: int) -> None:
        """Prepare next step by injecting context from completed current step"""
        logger.info(f"prepare_next_step called: workflow_id={workflow_id}, current_step_index={current_step_index}")
        
        workflow = await self.workflow_repo.get_with_steps(workflow_id)
        if not workflow:
            logger.warning(f"Workflow {workflow_id} not found")
            return
        
        if current_step_index >= len(workflow.steps):
            logger.warning(f"Invalid step index {current_step_index} for workflow {workflow_id}")
            return
            
        current_step = workflow.steps[current_step_index]
        next_step_index = current_step_index + 1
        
        logger.info(f"Current step {current_step_index}: type={current_step.step_type}, status={current_step.status}")
        logger.info(f"Current step output_data: {current_step.output_data}")
        
        if next_step_index < len(workflow.steps):
            next_step = workflow.steps[next_step_index]
            logger.info(f"Next step {next_step_index} BEFORE injection: input_data={next_step.input_data}")
            
            context_data = self._inject_context(current_step, next_step)
            logger.info(f"Context to inject: {context_data}")
            
            if context_data:
                # Update next step's input_data with injected context
                next_step.input_data = {**(next_step.input_data or {}), **context_data}
                workflow.current_step_index = next_step_index
                workflow.status = WorkflowStatus.RUNNING
                await self.db.commit()
                await self.db.refresh(next_step)
                logger.info(f"✅ Injected context to step {next_step_index}: {context_data}")
                logger.info(f"Next step {next_step_index} AFTER injection: input_data={next_step.input_data}")
            else:
                logger.warning(f"No context data to inject from step {current_step_index}")
        else:
            # All steps completed
            workflow.status = WorkflowStatus.COMPLETED
            workflow.completed_at = datetime.utcnow()
            await self.db.commit()
            logger.info(f"Workflow {workflow_id} completed")
    
    def _inject_context(self, current_step: WorkflowStep, next_step: WorkflowStep) -> Dict[str, Any]:
        """Inject context from current step to next step"""
        context = {}
        
        if current_step.step_type == StepType.TEXT_TO_IMAGE:
            # Pass image URL to video generation
            if current_step.output_data and "url" in current_step.output_data:
                context["image_url"] = current_step.output_data["url"]
                context["source_prompt"] = current_step.input_data.get("prompt", "")
        
        elif current_step.step_type == StepType.IMAGE_TO_VIDEO:
            # Pass video URL to 3D rendering
            if current_step.output_data and "video_url" in current_step.output_data:
                context["video_url"] = current_step.output_data["video_url"]
        
        return context
    
    async def _execute_text_to_image(
        self,
        tenant_id: int,
        user_id: int,
        step: WorkflowStep,
        input_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute text to image generation (always wan via AI 网关)"""
        prompt = input_data.get("prompt", "")
        model = step.model_id
        aspect_ratio = input_data.get("aspect_ratio", "4:3")

        # Generate output path
        import uuid
        filename = f"{uuid.uuid4()}.jpg"
        output_path = get_user_output_path(self.settings.STORAGE_BASE_PATH, user_id, "images")

        # Generate image with credit deduction (wan, file-based)
        result = await self.google_service.generate_image(
            tenant_id=tenant_id,  # Use tenant_id for credit operations
            prompt=prompt,
            output_path=output_path,  # Pass Path object directly
            filename=filename,
            aspect_ratio=aspect_ratio
        )

        # Check if generation was successful
        if not result.get("success"):
            error_msg = result.get("error", "Unknown error during image generation")
            logger.error(f"Image generation failed: {error_msg}")
            raise ValueError(f"Image generation failed: {error_msg}")

        # Construct URL
        result_url = f"/api/v1/google/outputs/{user_id}/images/{filename}"

        return {
            "url": result_url,
            "model": model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio
        }
    
    async def _execute_image_to_video_background(
        self,
        tenant_id: int,
        user_id: int,
        step_id: int,
        input_data: Dict[str, Any]
    ):
        """Execute image to video in background"""
        try:
            step = await self.step_repo.get(step_id)
            if not step:
                return
            
            # IMPORTANT: Use step.input_data from database, not the passed parameter
            # The database version contains injected context like image_url
            if step.input_data:
                input_data = step.input_data
                logger.info(f"Using input_data from database for step {step_id}: {input_data}")
            
            prompt = input_data.get("prompt", "")
            model = step.model_id

            # Image-to-video always uses the general video pipeline.
            # Map the UI model id to a gateway video model (Hailuo default).
            video_model_map = {
                'google-veo': self.settings.GATEWAY_VIDEO_HAILUO_MODEL,
                'hailuo': self.settings.GATEWAY_VIDEO_HAILUO_MODEL,
                'happyhorse': self.settings.GATEWAY_VIDEO_HAPPYHORSE,
            }
            gateway_video_model = video_model_map.get(model, self.settings.GATEWAY_VIDEO_HAILUO_MODEL)

            aspect_ratio = input_data.get("aspect_ratio", "16:9")
            resolution = input_data.get("resolution", "720p")
            duration = input_data.get("duration", 6)
            # Hailuo (海螺) only supports 6 or 10 seconds.
            if "happyhorse" not in gateway_video_model.lower():
                duration = 6 if duration <= 6 else 10

            # Get image URL from input data
            image_url = input_data.get("image_url", "")
            if not image_url:
                raise ValueError("image_url required for video generation")

            # Convert image URL to file system path
            # URL format: /api/v1/google/outputs/{user_id}/images/{filename}
            # File path: {STORAGE_BASE_PATH}/{user_id}/images/{filename}
            if image_url.startswith("/api/v1/google/outputs/"):
                # Extract user_id and filename from URL
                url_parts = image_url.split("/")
                if len(url_parts) >= 7:  # /api/v1/google/outputs/{user_id}/images/{filename}
                    url_user_id = url_parts[5]
                    image_filename = url_parts[7]
                    image_file_path = get_user_output_path(self.settings.STORAGE_BASE_PATH, int(url_user_id), "images") / image_filename
                    logger.info(f"Converted image URL {image_url} to file path: {image_file_path}")
                else:
                    raise ValueError(f"Invalid image URL format: {image_url}")
            else:
                # Assume it's already a file path
                image_file_path = Path(image_url)

            if not image_file_path.exists():
                raise FileNotFoundError(f"Image file not found: {image_file_path}")

            # Generate output path
            import uuid
            filename = f"{uuid.uuid4()}.mp4"
            output_path = get_user_output_path(self.settings.STORAGE_BASE_PATH, user_id, "videos")

            logger.info(f"Generating video ({gateway_video_model}): prompt='{prompt}', image={image_file_path}, output={output_path}/{filename}")

            # Call the general video pipeline with credit deduction using GoogleService
            result = await self.google_service.generate_video(
                tenant_id=tenant_id,  # Use tenant_id for credit operations
                prompt=prompt,
                first_frame_path=str(image_file_path),  # Use actual file system path
                output_path=output_path,  # Pass Path object directly
                filename=filename,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                duration=duration,
                model=gateway_video_model,
                generation_mode="image-to-video",
            )

            # Check if video generation was successful
            if not result.get("success", False):
                error_msg = result.get("error", "Unknown video generation error")
                logger.error(f"Video generation failed: {error_msg}")
                raise ValueError(f"Video generation failed: {error_msg}")

            logger.info(f"Video generation successful: {result.get('file_path')}")
            result_url = f"/api/v1/google/outputs/{user_id}/videos/{filename}"

            step.status = StepStatus.COMPLETED
            step.output_data = {
                "video_url": result_url,
                "duration": duration,
                "resolution": resolution,
                "aspect_ratio": aspect_ratio,
                "status": "completed"
            }
            step.completed_at = datetime.utcnow()

            # Create Gallery record for video generation
            await self._create_gallery_record(
                user_id=user_id,
                task_type="video",
                model_id=gateway_video_model,
                prompt=prompt,
                parameters={
                    "aspect_ratio": aspect_ratio,
                    "duration": duration,
                    "resolution": resolution,
                    "source": "omniweaver"
                },
                result_url=result_url,
                workflow_step_id=step.id
            )

            step.completed_at = datetime.utcnow()
            await self.db.commit()
            
            # Prepare next step by injecting context
            if step.workflow_id:
                await self.prepare_next_step(step.workflow_id, step.step_index)
                
        except Exception as e:
            logger.error(f"Video generation failed: {str(e)}")
            step = await self.step_repo.get(step_id)
            if step:
                step.status = StepStatus.FAILED
                step.error_message = str(e)
                await self.db.commit()
                # Don't prepare next step on failure
    
    async def _execute_video_to_3d_background(
        self,
        user_id: int,
        step_id: int,
        input_data: Dict[str, Any]
    ):
        """Execute video to 3D in background"""
        try:
            step = await self.step_repo.get(step_id)
            if not step:
                return
            
            # IMPORTANT: Use step.input_data from database, not the passed parameter
            # The database version contains injected context like video_url
            if step.input_data:
                input_data = step.input_data
                logger.info(f"Using input_data from database for step {step_id}: {input_data}")
            
            # Mock 3D generation
            import asyncio
            await asyncio.sleep(2)
            
            step.status = StepStatus.COMPLETED
            step.output_data = {
                "model_url": "https://mock-3d-url.com/model.gltf",
                "preview_url": "https://mock-3d-url.com/preview.png",
                "polycount": input_data.get("polycount", "medium"),
                "status": "completed"
            }
            step.completed_at = datetime.utcnow()
            await self.db.commit()
            
            # Prepare next step by injecting context
            if step.workflow_id:
                await self.prepare_next_step(step.workflow_id, step.step_index)
            
        except Exception as e:
            logger.error(f"3D rendering failed: {str(e)}")
            step = await self.step_repo.get(step_id)
            if step:
                step.status = StepStatus.FAILED
                step.error_message = str(e)
                await self.db.commit()
                # Don't prepare next step on failure
    
    async def _create_gallery_record(
        self,
        user_id: int,
        task_type: str,
        model_id: str,
        prompt: str,
        parameters: Dict[str, Any],
        result_url: str,
        workflow_step_id: Optional[int] = None
    ):
        """Create GenerationTask record for Gallery display"""
        import uuid
        import json
        
        try:
            # Get user's tenant_id
            # For simplicity, we'll use user_id as tenant_id for now
            # In a multi-tenant system, you would fetch the actual tenant_id
            tenant_id = user_id
            
            gallery_record = GenerationTask(
                task_id=str(uuid.uuid4()),
                user_id=user_id,
                tenant_id=tenant_id,
                model_id=model_id,
                task_type=task_type,
                prompt=prompt,
                parameters=json.dumps(parameters),
                status="completed",
                progress=100,
                result_url=result_url,
                created_at=datetime.utcnow()
            )
            
            self.db.add(gallery_record)
            await self.db.commit()
            logger.info(f"Created gallery record for {task_type} generation: task_id={gallery_record.task_id}")
            
        except Exception as e:
            logger.error(f"Failed to create gallery record: {str(e)}")
            # Don't fail the workflow if gallery record creation fails
