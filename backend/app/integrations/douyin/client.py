"""
Douyin API Client - 抖音开放平台 API 客户端
"""
import logging
from typing import Dict, Any, Optional
from urllib.parse import urlencode

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

DOUYIN_BASE_URL = "https://open.douyin.com"


class DouyinClient:
    """抖音开放平台客户端"""

    def __init__(self):
        self.client_key = settings.DOUYIN_CLIENT_KEY
        self.client_secret = settings.DOUYIN_CLIENT_SECRET
        self.redirect_uri = settings.DOUYIN_REDIRECT_URI

    def get_authorize_url(self, state: str) -> str:
        """
        生成 OAuth 授权链接

        Args:
            state: 状态参数，用于防止 CSRF 攻击

        Returns:
            授权 URL
        """
        params = {
            "client_key": self.client_key,
            "response_type": "code",
            "scope": "user_info,video.create,video.data",
            "redirect_uri": self.redirect_uri,
            "state": state,
        }
        return f"{DOUYIN_BASE_URL}/platform/oauth/connect/?{urlencode(params)}"

    async def exchange_code_for_token(self, code: str) -> Dict[str, Any]:
        """
        用授权码换取 access_token

        Args:
            code: 授权码

        Returns:
            包含 access_token, refresh_token, open_id 等信息的字典
        """
        url = f"{DOUYIN_BASE_URL}/oauth/access_token/"
        payload = {
            "client_key": self.client_key,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            result = response.json()

        logger.info(f"Douyin token exchange response: {result}")

        data = result.get("data", {})
        if data.get("error_code", 0) != 0:
            raise Exception(
                f"Douyin token exchange failed: {data.get('description', 'Unknown error')}"
            )

        return data

    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """
        刷新 access_token

        Args:
            refresh_token: 刷新令牌

        Returns:
            包含新的 access_token 等信息的字典
        """
        url = f"{DOUYIN_BASE_URL}/oauth/refresh_token/"
        payload = {
            "client_key": self.client_key,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            result = response.json()

        data = result.get("data", {})
        if data.get("error_code", 0) != 0:
            raise Exception(
                f"Douyin token refresh failed: {data.get('description', 'Unknown error')}"
            )

        return data

    async def upload_video(
        self, access_token: str, open_id: str, video_path: str
    ) -> Dict[str, Any]:
        """
        上传视频到抖音

        Args:
            access_token: 访问令牌
            open_id: 用户 open_id
            video_path: 本地视频文件路径

        Returns:
            包含 video.video_id 的字典
        """
        url = f"{DOUYIN_BASE_URL}/api/douyin/v1/video/upload_video/"
        headers = {"access-token": access_token}
        params = {"open_id": open_id}

        async with httpx.AsyncClient(timeout=300.0) as client:
            with open(video_path, "rb") as f:
                files = {"video": ("video.mp4", f, "video/mp4")}
                response = await client.post(
                    url, headers=headers, params=params, files=files
                )
                response.raise_for_status()
                result = response.json()

        logger.info(f"Douyin upload response: {result}")

        data = result.get("data", {})
        if data.get("error_code", 0) != 0:
            raise Exception(
                f"Douyin video upload failed: {data.get('description', 'Unknown error')}"
            )

        return data

    async def create_video(
        self,
        access_token: str,
        open_id: str,
        video_id: str,
        text: str,
        cover_tsp: float = 0.0,
    ) -> Dict[str, Any]:
        """
        发布视频（创建抖音视频）

        Args:
            access_token: 访问令牌
            open_id: 用户 open_id
            video_id: 上传后获得的视频 ID
            text: 视频标题/描述
            cover_tsp: 封面时间点（秒）

        Returns:
            包含 item_id 的字典
        """
        url = f"{DOUYIN_BASE_URL}/api/douyin/v1/video/create_video/"
        headers = {
            "access-token": access_token,
            "Content-Type": "application/json",
        }
        params = {"open_id": open_id}
        payload = {
            "video_id": video_id,
            "text": text,
            "cover_tsp": cover_tsp,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url, headers=headers, params=params, json=payload
            )
            response.raise_for_status()
            result = response.json()

        logger.info(f"Douyin create video response: {result}")

        data = result.get("data", {})
        if data.get("error_code", 0) != 0:
            raise Exception(
                f"Douyin video create failed: {data.get('description', 'Unknown error')}"
            )

        return data


douyin_client = DouyinClient()
