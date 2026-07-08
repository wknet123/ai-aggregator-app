"""
Helper utilities
"""
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path
import secrets
import string
import os


def generate_random_string(length: int = 32) -> str:
    """Generate random string"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def generate_api_key() -> str:
    """Generate API key"""
    return f"sk_{generate_random_string(48)}"


def format_datetime(dt: datetime, format: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Format datetime to string"""
    return dt.strftime(format)


def calculate_expiry_time(days: int = 30) -> datetime:
    """Calculate expiry time from now"""
    return datetime.utcnow() + timedelta(days=days)


def get_user_storage_path(base_path: str, user_id: int, subdir: str) -> Path:
    """Get user-specific storage path"""
    path = Path(base_path) / str(user_id) / subdir
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_user_upload_path(base_path: str, user_id: int) -> Path:
    """Get user upload directory"""
    return get_user_storage_path(base_path, user_id, "uploads")


def get_user_output_path(base_path: str, user_id: int, output_type: str) -> Path:
    """Get user output directory by type (images/videos)"""
    return get_user_storage_path(base_path, user_id, output_type)
