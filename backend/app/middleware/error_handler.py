"""
Error Handler Middleware
"""
import logging
from fastapi import Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from app.core.credits import InsufficientCreditsError

logger = logging.getLogger(__name__)


async def error_handler_middleware(request: Request, call_next):
    """Global error handler middleware"""
    try:
        return await call_next(request)
    
    except InsufficientCreditsError as e:
        logger.warning(f"Insufficient credits: {str(e)}")
        return JSONResponse(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            content={
                "success": False,
                "message": str(e),
                "error_code": "INSUFFICIENT_CREDITS"
            }
        )
    
    except SQLAlchemyError as e:
        logger.error(f"Database error: {str(e)}")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "message": "Database error occurred",
                "error_code": "DATABASE_ERROR"
            }
        )
    
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "message": "Internal server error",
                "error_code": "INTERNAL_ERROR"
            }
        )
