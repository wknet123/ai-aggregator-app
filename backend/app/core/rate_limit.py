"""
Rate Limiting utilities
"""
from typing import Optional
from datetime import datetime, timedelta
from collections import defaultdict
from threading import Lock


class RateLimiter:
    """Simple in-memory rate limiter"""
    
    def __init__(self):
        self._requests = defaultdict(list)
        self._lock = Lock()
    
    def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int
    ) -> bool:
        """Check if request is allowed under rate limit"""
        now = datetime.utcnow()
        window_start = now - timedelta(seconds=window_seconds)
        
        with self._lock:
            # Clean old requests
            self._requests[key] = [
                req_time for req_time in self._requests[key]
                if req_time > window_start
            ]
            
            # Check rate limit
            if len(self._requests[key]) >= max_requests:
                return False
            
            # Add current request
            self._requests[key].append(now)
            return True
    
    def get_remaining(
        self,
        key: str,
        max_requests: int,
        window_seconds: int
    ) -> int:
        """Get remaining requests in current window"""
        now = datetime.utcnow()
        window_start = now - timedelta(seconds=window_seconds)
        
        with self._lock:
            # Clean old requests
            self._requests[key] = [
                req_time for req_time in self._requests[key]
                if req_time > window_start
            ]
            
            return max(0, max_requests - len(self._requests[key]))


# Global rate limiter instance
rate_limiter = RateLimiter()
