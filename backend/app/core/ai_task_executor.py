"""
AI Task Executor - Core logic for executing AI tasks with credit management
"""
from decimal import Decimal
from typing import Dict, Any, Callable, Awaitable
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.credits import CreditManager, InsufficientCreditsError
from app.models.transaction import Transaction, TransactionType, TransactionStatus
from app.models.model_usage import ModelUsage
import logging

logger = logging.getLogger(__name__)


class AITaskExecutor:
    """Execute AI tasks with transactional credit management"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.credit_manager = CreditManager(db)
    
    async def execute_ai_task(
        self,
        tenant_id: int,
        task_cost: Decimal,
        task_callable: Callable[[], Awaitable[Dict[str, Any]]],
        model_provider: str,
        model_name: str,
        task_description: str,
        extra_data: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Execute AI task with transactional credit management
        
        Args:
            tenant_id: Tenant ID
            task_cost: Cost of the task in credits
            task_callable: Async function that executes the AI task
            model_provider: AI model provider (openai, google, flux, worldlabs)
            model_name: Model name
            task_description: Description for transaction record
            extra_data: Additional data to store in model usage record
            
        Returns:
            AI task result
            
        Raises:
            InsufficientCreditsError: If tenant has insufficient credits
            Exception: If AI task execution fails
        """
        transaction = None
        transaction_id = None
        credits_deducted = False
        
        try:
            # Step 1: Check credits (no savepoint needed - TiDB doesn't support it)
            logger.info(f"Checking credits for tenant {tenant_id}, required: {task_cost}")
            
            balance = await self.credit_manager.get_balance(tenant_id)
            if balance < task_cost:
                raise InsufficientCreditsError(
                    f"Insufficient credits. Required: {task_cost}, Available: {balance}"
                )
            
            # Step 2: Deduct credits (deduct method commits internally)
            transaction = await self.credit_manager.deduct(
                tenant_id=tenant_id,
                amount=int(task_cost),  # Convert Decimal to int
                description=task_description
            )
            transaction_id = transaction.id
            credits_deducted = True
            logger.info(f"Credits deducted for tenant {tenant_id}: {task_cost}")
            
            # Step 3: Execute AI task (Mock or real API call)
            logger.info(f"Executing AI task: {model_provider}/{model_name}")
            result = await task_callable()

            # The gateway image/video clients swallow upstream errors (incl. content
            # moderation rejections) into {"success": False, "error": ...} rather than
            # raising. Treat that as a failure so the refund path below runs — otherwise
            # the tenant is charged for a generation that never produced a file.
            if isinstance(result, dict) and result.get("success") is False:
                raise Exception(result.get("error") or "AI task failed")

            # Step 4: Task succeeded - record usage
            usage_record = ModelUsage(
                tenant_id=tenant_id,
                model_provider=model_provider,
                model_name=model_name,
                cost=task_cost,
                extra_data=extra_data or {}
            )
            self.db.add(usage_record)
            
            await self.db.commit()
            logger.info(f"AI task completed successfully for tenant {tenant_id}")
            
            return {
                "success": True,
                "result": result,
                "cost": float(task_cost),
                "transaction_id": transaction_id
            }
            
        except InsufficientCreditsError as e:
            # Insufficient credits - rollback any pending changes
            logger.warning(f"Insufficient credits for tenant {tenant_id}: {str(e)}")
            await self.db.rollback()
            raise
            
        except Exception as e:
            # AI task execution failed - rollback first to clean session state
            logger.error(f"AI task failed for tenant {tenant_id}: {str(e)}")
            
            # Rollback to clean session state
            await self.db.rollback()
            
            # If credits were deducted, refund them in a new transaction
            if credits_deducted and transaction_id:
                try:
                    await self._refund_credits(
                        tenant_id=tenant_id,
                        amount=task_cost,
                        original_transaction_id=transaction_id,
                        reason=f"Task failed: {str(e)}"
                    )
                except Exception as refund_error:
                    logger.error(f"Failed to refund credits: {str(refund_error)}")
                    await self.db.rollback()
            
            raise Exception(f"AI task execution failed: {str(e)}")
    
    async def _refund_credits(
        self,
        tenant_id: int,
        amount: Decimal,
        original_transaction_id: int,
        reason: str
    ) -> Transaction:
        """Refund credits after task failure"""
        # recharge method commits internally
        refund_transaction = await self.credit_manager.recharge(
            tenant_id=tenant_id,
            amount=int(amount),  # Convert Decimal to int
            reference_id=f"refund_{original_transaction_id}",
            description=f"Refund: {reason}"
        )
        
        # Update original transaction status - need to re-fetch after recharge commit
        original_transaction = await self.db.get(Transaction, original_transaction_id)
        if original_transaction:
            original_transaction.status = TransactionStatus.FAILED
            await self.db.commit()
        
        logger.info(f"Credits refunded for tenant {tenant_id}: {amount}")
        return refund_transaction


# Mock AI API call functions for testing
async def mock_dalle_api_call(prompt: str, model: str = "dall-e-3") -> Dict[str, Any]:
    """Mock DALL-E API call"""
    import asyncio
    await asyncio.sleep(1.0)  # Simulate API latency
    
    import random
    if random.random() < 0.05:
        raise Exception("Mock image generation failed - content policy")
    
    return {
        "created": 1234567890,
        "data": [{
            "url": f"https://mock-image-url.com/{model}/mock123.png",
            "revised_prompt": prompt
        }]
    }
