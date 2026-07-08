"""
Unified AI Aggregation Gateway client (New API, OpenAI-compatible).

ALL model calls in the platform route through this single client:
  - text reasoning  → chat()         (deepseek-v4-flash)
  - image gen/edit  → generate_image() (wan2.7-image / -pro, t2i + i2i)
  - video           → 3 task families, each with its own create + poll:
        Hailuo (海螺)   → minimax video_generation
        HappyHorse      → /videos (multipart)
        Seedance (短剧) → /contents/generations/tasks

Image inputs are delivered to the gateway as base64 data URLs (MinIO is internal
and not reachable by the gateway).
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any, Dict, List, Optional, Union

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Status buckets shared across the (differing) video task APIs.
_DONE = {"succeeded", "success", "completed", "ready", "done"}
_FAIL = {"failed", "error", "cancelled", "canceled"}

def _extract_error_message(body: str) -> str:
    """从上游错误响应体里提取人类可读的错误消息;提取不到则返回原始体。

    平台对"可识别真人"(垫图人脸 / 提示词真人姓名)等的拦截,会在响应体里带上具体原因。
    与其在本地猜测/改写,不如把上游的真实消息原样回传给用户,让其据此调整。
    """
    body = (body or "").strip()
    if not body:
        return ""
    try:
        data = json.loads(body)
    except (ValueError, TypeError):
        return body
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            msg = err.get("message") or err.get("msg")
            if msg:
                return str(msg)
        elif isinstance(err, str) and err:
            return err
        for key in ("message", "msg", "detail", "error_msg"):
            val = data.get(key)
            if isinstance(val, str) and val:
                return val
    return body


def _as_data_url(image: Union[str, bytes], mime: str = "image/png") -> str:
    """Normalise an image (raw bytes / data URL / http URL) to a data URL or URL.

    - bytes              → data:<mime>;base64,....
    - 'data:...' string  → returned unchanged
    - 'http...' string   → returned unchanged (already public)
    - bare base64 string → wrapped as data URL
    """
    if isinstance(image, bytes):
        b64 = base64.b64encode(image).decode("ascii")
        return f"data:{mime};base64,{b64}"
    if image.startswith(("data:", "http://", "https://")):
        return image
    return f"data:{mime};base64,{image}"


class GatewayError(Exception):
    """Raised when the aggregation gateway returns an error."""


class GatewayContentModerationError(GatewayError):
    """Raised when the gateway/upstream model rejects content via its safety filter.

    Carries a clean, user-facing (Chinese) message instead of the raw upstream JSON.
    """


class GatewayClient:
    """Thin async client over the aggregation gateway."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key or settings.AI_GATEWAY_API_KEY
        self.base_url = (base_url or settings.AI_GATEWAY_BASE_URL).rstrip("/")
        # Gateway root without the /v1 OpenAI prefix (needed for /minimax/... paths)
        self.root_url = self.base_url[:-3].rstrip("/") if self.base_url.endswith("/v1") else self.base_url

    # ── internals ────────────────────────────────────────────────────────────
    @property
    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _require_key(self) -> None:
        if not self.api_key:
            raise GatewayError("AI_GATEWAY_API_KEY 未配置")

    @staticmethod
    def _check(resp: httpx.Response, what: str) -> None:
        """Raise a GatewayError carrying the upstream body on a non-2xx response.

        ``resp.raise_for_status()`` only reports the URL + status, swallowing the
        body that actually explains *why* the gateway rejected the request (e.g. a
        bad model id, an unsupported ratio/duration, or a moderation block). Surface
        it so the log/return value is diagnosable.
        """
        if resp.is_success:
            return
        body = resp.text[:500]
        logger.warning("%s gateway error %s: %s", what, resp.status_code, body[:300])
        raise GatewayError(_extract_error_message(body) or f"{what} failed: {resp.status_code}")

    async def _post_task(
        self, url: str, payload: Dict[str, Any], what: str,
        *, timeout: float = 60.0, retries: int = 2,
    ) -> Dict[str, Any]:
        """POST a task-create request, retrying transient gateway dispatch failures.

        The gateway wraps an upstream dispatch failure as ``fail_to_fetch_task`` —
        this is transient (the gateway couldn't hand the task to the upstream model),
        not a bad payload, so retrying with backoff usually succeeds. 429/5xx are
        likewise retried. A genuine bad-parameter 400 (e.g. InvalidParameter /
        MissingParameter) is surfaced immediately with the upstream body.
        """
        delays = [3, 8, 15][: max(0, retries)]
        async with httpx.AsyncClient(timeout=timeout) as client:
            for attempt, delay in enumerate(delays + [None], start=1):
                resp = await client.post(url, headers=self._headers, json=payload)
                if resp.is_success:
                    return resp.json()
                body = resp.text[:500]
                low = body.lower()
                transient = (
                    resp.status_code >= 500
                    or resp.status_code == 429
                    or "fail_to_fetch_task" in low
                )
                if transient and delay is not None:
                    logger.warning(
                        "%s transient gateway error %s (attempt %d), retry in %ds: %s",
                        what, resp.status_code, attempt, delay, body[:200],
                    )
                    await asyncio.sleep(delay)
                    continue
                # Non-transient failure (bad params, moderation/privacy block, etc.):
                # surface the upstream's own message so the user sees exactly why it was
                # rejected (e.g. real-face/real-name privacy interception) and can fix it.
                logger.warning("%s gateway error %s: %s", what, resp.status_code, body[:300])
                raise GatewayError(_extract_error_message(body) or f"{what} failed: {resp.status_code}")
        raise GatewayError(f"{what} failed: exhausted retries")

    async def _post_seedance_task(
        self, payload: Dict[str, Any], what: str, *, timeout: float = 60.0,
    ) -> Dict[str, Any]:
        """POST a Seedance task, transparently handling the r2v duration quirk.

        Seedance 2.0 derives the clip length itself in **r2v** mode (主体参考生视频 —
        reference images without a reference video, e.g. a 分镜首帧 driving a shot) and
        rejects an explicit ``duration`` with
        ``"... parameter duration ... is not valid for model ... in r2v"``. The same
        request *with* a reference video is the multimodal mode, which does accept
        ``duration``. Rather than guess the gateway's mode-detection up front, send
        ``duration`` and, if it's rejected for r2v, drop it and retry once.
        """
        url = f"{self.base_url}/contents/generations/tasks"
        try:
            return await self._post_task(url, payload, what, timeout=timeout)
        except GatewayError as e:
            msg = str(e).lower()
            if "duration" in payload and "duration" in msg and "r2v" in msg:
                logger.info("%s: r2v mode rejects explicit duration, retrying without it", what)
                payload = {k: v for k, v in payload.items() if k != "duration"}
                return await self._post_task(url, payload, what, timeout=timeout)
            raise

    # ── text reasoning ─────────────────────────────────────────────────────────
    async def chat(
        self,
        messages: List[Dict[str, str]],
        *,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        json_mode: bool = False,
        timeout: float = 60.0,
        retries: int = 3,
    ) -> str:
        """Chat completion → assistant message text (default deepseek-v4-flash)."""
        self._require_key()
        payload: Dict[str, Any] = {
            "model": model or settings.GATEWAY_TEXT_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        delays = [5, 15, 30][: max(0, retries)]
        async with httpx.AsyncClient(timeout=timeout) as client:
            for attempt, delay in enumerate(delays + [None], start=1):
                resp = await client.post(
                    f"{self.base_url}/chat/completions", headers=self._headers, json=payload
                )
                if resp.status_code == 429 and delay is not None:
                    logger.warning("gateway chat 429 (attempt %d), retry in %ds", attempt, delay)
                    await asyncio.sleep(delay)
                    continue
                resp.raise_for_status()
                break
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()

    # ── image generation / editing (wan) ───────────────────────────────────────
    async def generate_image(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        image: Optional[Union[str, bytes]] = None,
        size: str = "1024*1024",
        n: int = 1,
        watermark: bool = False,
        timeout: float = 180.0,
    ) -> List[str]:
        """Generate (or edit, when ``image`` given) images. Returns image URLs.

        wan/qwen share ``/v1/images/generations``; an ``image`` content part turns
        the call into image-to-image.
        """
        self._require_key()
        model = model or settings.GATEWAY_IMAGE_MODEL
        size = size.replace("x", "*")  # accept both 1024x1024 and 1024*1024

        if image is not None:
            content: List[Dict[str, str]] = [{"text": prompt}, {"image": _as_data_url(image)}]
            payload: Dict[str, Any] = {
                "model": model,
                "input": {"messages": [{"role": "user", "content": content}]},
                "parameters": {"n": n, "watermark": watermark, "size": size},
            }
        else:
            payload = {"model": model, "prompt": prompt, "n": n, "size": size, "watermark": watermark}

        # Output moderation (the upstream model flags the *generated* image as
        # "inappropriate content") is non-deterministic — re-rolling the same prompt
        # with a fresh seed often passes. Retry a few times before surfacing a clean,
        # user-facing message instead of the raw upstream JSON.
        moderation_markers = (
            "inappropriate content", "content policy", "content_policy",
            "safety", "审核", "敏感", "违规", "not allowed", "blocked",
        )
        data: Optional[Dict[str, Any]] = None
        last_text = ""
        attempts = 3
        async with httpx.AsyncClient(timeout=timeout) as client:
            for attempt in range(1, attempts + 1):
                resp = await client.post(
                    f"{self.base_url}/images/generations", headers=self._headers, json=payload
                )
                if resp.status_code == 200:
                    data = resp.json()
                    break
                last_text = resp.text[:300]
                is_moderation = resp.status_code == 400 and any(
                    m in last_text.lower() for m in moderation_markers
                )
                if is_moderation:
                    if attempt < attempts:
                        logger.warning(
                            "gateway image moderation rejection (attempt %d/%d), re-rolling",
                            attempt, attempts,
                        )
                        continue
                    raise GatewayContentModerationError(
                        "生成内容被安全审核拦截，请调整分镜描述"
                        "（避免暴力、血腥、过度暴露或其他敏感内容）后重试"
                    )
                raise GatewayError(f"image generation failed: {resp.status_code} - {last_text}")
        if data is None:
            raise GatewayError(f"image generation failed: {last_text}")

        urls = self._extract_image_urls(data)
        if not urls:
            raise GatewayError(f"no image in response: {json.dumps(data)[:300]}")
        return urls

    @staticmethod
    def _extract_image_urls(data: Dict[str, Any]) -> List[str]:
        """Pull image URLs out of the several response shapes wan/qwen return."""
        urls: List[str] = []
        for item in data.get("data", []) or []:
            if item.get("url"):
                urls.append(item["url"])
            elif item.get("b64_json"):
                urls.append(_as_data_url(item["b64_json"]))
        if urls:
            return urls
        # fallback: metadata.output.choices[].message.content[].image
        try:
            for choice in data["metadata"]["output"]["choices"]:
                for part in choice["message"]["content"]:
                    if part.get("image"):
                        urls.append(part["image"])
        except (KeyError, TypeError):
            pass
        return urls

    async def fetch_bytes(self, url: str, timeout: float = 120.0) -> bytes:
        """Download a result URL (or decode a data URL) to bytes."""
        if url.startswith("data:"):
            return base64.b64decode(url.split(",", 1)[1])
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content

    # ── video: Hailuo (海螺) ────────────────────────────────────────────────────
    async def hailuo_create(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        first_frame_image: Optional[Union[str, bytes]] = None,
        duration: int = 6,             # 海螺: 768P 支持 6/10s, 1080P 仅 6s
        resolution: str = "768P",      # 海螺仅支持 768P / 1080P
        prompt_optimizer: bool = True,
        timeout: float = 60.0,
    ) -> str:
        """Create a Hailuo video task → task_id.

        必须走原生 ``/minimax/v1/video_generation`` 端点(文档:
        https://neolink.com/docs/instruction-manual/video/hailuo/t2v)——只有它会真正
        消费首帧图 ``first_frame_image`` 做 i2v(实测坏图会 "image: unknown format" 失败);
        OpenAI 风格的 ``/videos`` 端点会**静默忽略**首帧图、退化成纯 t2v,故不可用于 i2v。
        模型必须带网关分组前缀 ``MiniMax/``(否则 403)。任务状态仍用统一的
        ``/videos/{id}`` 查询,即 :meth:`video_poll`。
        """
        self._require_key()
        payload: Dict[str, Any] = {
            "model": model or settings.GATEWAY_VIDEO_HAILUO_MODEL,
            "prompt": prompt,
            "duration": int(duration),
            "resolution": resolution,
            "prompt_optimizer": prompt_optimizer,
        }
        if first_frame_image is not None:
            payload["first_frame_image"] = _as_data_url(first_frame_image, "image/jpeg")
        data = await self._post_task(
            f"{self.root_url}/minimax/v1/video_generation", payload, "hailuo video", timeout=timeout
        )
        task_id = data.get("id") or data.get("task_id")
        if not task_id:
            raise GatewayError(f"hailuo: no task_id: {json.dumps(data)[:300]}")
        return task_id

    # ── video: HappyHorse (JSON /videos) ────────────────────────────────────────
    async def happyhorse_create(
        self,
        prompt: str,
        *,
        mode: str = "t2v",            # t2v | i2v | r2v
        resolution: str = "720p",     # 720p | 1080p
        duration: Union[int, str] = 4,
        ratio: str = "16:9",
        images: Optional[List[bytes]] = None,
        timeout: float = 60.0,
    ) -> str:
        """Create a HappyHorse video task → task_id.

        The gateway expects JSON with an integer ``duration``. Reference frames
        (i2v / r2v) are delivered as base64 data URLs via ``input_reference``.
        """
        self._require_key()
        model = f"{settings.GATEWAY_VIDEO_HAPPYHORSE}-{mode}-{resolution}"
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "duration": int(duration),
            "ratio": ratio,
        }
        if images:
            refs = [_as_data_url(img, "image/png") for img in images]
            payload["input_reference"] = refs if len(refs) > 1 else refs[0]
        data = await self._post_task(
            f"{self.base_url}/videos", payload, "happyhorse video", timeout=timeout
        )
        task_id = data.get("id") or data.get("task_id")
        if not task_id:
            raise GatewayError(f"happyhorse: no task_id: {json.dumps(data)[:300]}")
        return task_id

    async def video_poll(self, task_id: str, timeout: float = 30.0) -> Dict[str, Any]:
        """Poll the OpenAI-style /videos/{id} endpoint (HappyHorse).

        Statuses: queued / in_progress / completed / failed. The result URL is at
        ``metadata.url`` on completion.
        """
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(
                f"{self.base_url}/videos/{task_id}", headers=self._headers
            )
            self._check(resp, "video poll")
            data = resp.json()
        url = (data.get("metadata") or {}).get("url") or data.get("url")
        return {"status": str(data.get("status", "")).lower(), "url": url, "raw": data}

    # ── video: Seedance (短剧, /contents/generations/tasks) ─────────────────────
    async def seedance_create(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        reference_image: Optional[Union[str, bytes]] = None,
        last_frame_image: Optional[Union[str, bytes]] = None,
        reference_images: Optional[List[Union[str, bytes]]] = None,
        reference_video_url: Optional[str] = None,
        reference_video_urls: Optional[List[str]] = None,
        audio_url: Optional[str] = None,
        ratio: str = "16:9",
        duration: int = 5,
        generate_audio: bool = False,
        watermark: bool = False,
        timeout: float = 60.0,
    ) -> str:
        """Create a Seedance 2.0 video task → task_id.

        Seedance 2.0 accepts a multimodal `content` array mixing text + reference
        images + a reference video + an audio track (剧创式逐分镜多模态参考).

        - Images may be passed as a remote-fetchable URL (preferred: a proxy URL that
          publishes the MinIO object, e.g. /api/v1/drama/ref-asset) or as raw bytes; bytes
          are base64-inlined as a data URL fallback (e.g. runtime-extracted chained frames).
        - reference_video_url / audio_url MUST be publicly fetchable URLs (e.g. a MinIO
          presigned URL on MINIO_PUBLIC_ENDPOINT); large media can't be base64-inlined.

        IMAGE ORDER IS SIGNIFICANT. Seedance has no dedicated first/last-frame role —
        "图片1 / 图片2 / …" are interpreted purely by the order images appear in the
        `content` array, and the prompt references them by ordinal ("首帧为图片1…尾帧
        定格为图片2…"). So we emit them in a deterministic canonical order:
        reference_image (首帧 = 图片1) → last_frame_image (尾帧 = 图片2) →
        reference_images (额外参考 = 图片3+). All carry the proven `image_url` +
        `reference_image` shape; only their position differs.
        """
        self._require_key()
        # Seedance requires a non-empty content[0].text — a blank prompt is rejected
        # with a 400 (MissingParameter `content[0].text`). Validate up front so the
        # caller gets a clean, actionable message instead of an opaque gateway 400.
        prompt = (prompt or "").strip()
        if not prompt:
            raise GatewayError("视频生成提示词不能为空，请填写画面描述后重试")
        content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]

        # Canonical order: 首帧(图片1) → 尾帧(图片2) → 额外参考(图片3+).
        imgs: List[Union[str, bytes]] = []
        if reference_image is not None:
            imgs.append(reference_image)
        if last_frame_image is not None:
            imgs.append(last_frame_image)
        imgs.extend(reference_images or [])
        for img in imgs:
            content.append(
                {"type": "image_url", "role": "reference_image",
                 "image_url": {"url": _as_data_url(img, "image/jpeg")}}
            )

        # 参考视频：兼容单条(reference_video_url)与多条(reference_video_urls，用于「合并成片」
        # 模式 B 把多段已生成分镜视频作参考)。注意：Seedance 上游对「多条参考视频」的支持未经
        # 验证——若上游只认一条，会在 _post_seedance_task 处返回 4xx，由上层原样回传给用户。
        video_urls: List[str] = []
        if reference_video_url:
            video_urls.append(reference_video_url)
        video_urls.extend(reference_video_urls or [])
        if len(video_urls) > 1:
            logger.warning(
                "seedance: %d reference videos requested; upstream multi-reference-video "
                "support is unverified", len(video_urls)
            )
        for vu in video_urls:
            content.append(
                {"type": "video_url", "role": "reference_video",
                 "video_url": {"url": vu}}
            )
        if audio_url:
            content.append(
                {"type": "audio_url", "role": "reference_audio",
                 "audio_url": {"url": audio_url}}
            )

        payload = {
            "model": model or settings.GATEWAY_DRAMA_VIDEO_MODEL,
            "content": content,
            "ratio": ratio,
            "duration": duration,
            "generate_audio": generate_audio,
            "watermark": watermark,
        }
        data = await self._post_seedance_task(payload, "seedance video", timeout=timeout)
        task_id = data.get("task_id") or data.get("id")
        if not task_id:
            raise GatewayError(f"seedance: no task_id: {json.dumps(data)[:300]}")
        return task_id

    async def seedance_poll(self, task_id: str, timeout: float = 30.0) -> Dict[str, Any]:
        """Poll a Seedance task → {status, url}."""
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(
                f"{self.base_url}/contents/generations/tasks/{task_id}", headers=self._headers
            )
            self._check(resp, "seedance poll")
            data = resp.json()
        status = str(data.get("status", "")).lower()
        url = (
            data.get("content", {}).get("video_url")
            if isinstance(data.get("content"), dict)
            else None
        ) or data.get("video_url") or data.get("url")
        return {"status": status, "url": url, "raw": data}

    # ── Media Studio: 视频→视频 / 动作模仿 / 视频编辑 (M1 骨架) ──────────────────
    # 这三类都需要专用模型 + 公网可达的视频 URL(网关访问不到内部 MinIO,需传 presigned
    # public URL)。请求/响应形态等真实模型信息补充后在 M2 填实。当前若模型 ID 未配置,
    # 直接抛 GatewayError,上层据此退款并提示“待配置”。
    async def video2video_create(
        self,
        prompt: str,
        *,
        video_url: str,
        model: Optional[str] = None,
        strength: float = 0.7,
        style_prompt: Optional[str] = None,
        reference_images: Optional[List[Union[str, bytes]]] = None,
        negative_prompt: Optional[str] = None,
        ratio: str = "16:9",
        duration: int = 5,
        timeout: float = 60.0,
    ) -> str:
        """视频→视频(视频转绘)创建任务 → task_id。

        按 Seedance 文档(https://neolink.com/docs/instruction-manual/video/03-seedance):
        把源视频作为 ``reference_video`` 传入多模态 content("video-to-video workflow"),
        走 ``/contents/generations/tasks``,轮询用 :meth:`seedance_poll`。``strength`` 非
        文档字段,不下发。``video_url`` 必须公网可达(用 studio /asset 签名 URL)。

        丰富项:
        - ``style_prompt``:风格描述,追加到 content[0].text(在用户 prompt 之后)。
        - ``reference_images``:参考主体图(承载 elements/主体语义),逐个作为
          ``role: reference_image`` 的多模态图追加(bytes 走 base64 data URL,URL 原样)。
        - ``negative_prompt``:负向描述,以 "负向提示词:" 形式并入文本(Seedance 无独立负向字段)。
        """
        self._require_key()
        model = model or settings.GATEWAY_VIDEO2VIDEO_MODEL
        if not model:
            raise GatewayError("视频→视频 模型待配置 (GATEWAY_VIDEO2VIDEO_MODEL)")
        text = (prompt or "").strip()
        if style_prompt:
            text = f"{text}，{style_prompt}" if text else style_prompt
        if negative_prompt:
            text = f"{text}\n负向提示词(避免):{negative_prompt}" if text else f"负向提示词(避免):{negative_prompt}"
        content: List[Dict[str, Any]] = [
            {"type": "text", "text": text},
            {"type": "video_url", "role": "reference_video", "video_url": {"url": video_url}},
        ]
        for img in (reference_images or []):
            content.append(
                {"type": "image_url", "role": "reference_image",
                 "image_url": {"url": _as_data_url(img, "image/jpeg")}}
            )
        payload = {"model": model, "content": content, "ratio": ratio, "duration": duration}
        data = await self._post_task(
            f"{self.base_url}/contents/generations/tasks", payload, "video2video", timeout=timeout
        )
        task_id = data.get("task_id") or data.get("id")
        if not task_id:
            raise GatewayError(f"video2video: no task_id: {json.dumps(data)[:300]}")
        return task_id

    async def kling_omni_video2video(
        self,
        prompt: str,
        *,
        video_url: str,
        image_urls: Optional[List[str]] = None,
        mode: str = "pro",
        model: Optional[str] = None,
        timeout: float = 60.0,
    ) -> str:
        """Kling Omni 视频→视频(风格化转绘)创建任务 → task_id。

        文档:https://neolink.com/docs/instruction-manual/video/kling/omni
        POST /api/kling/v1/videos/omni-video。``video_list`` = 源视频(转绘参考),
        ``image_list`` = 参考主体图(可空)。均须公网可达 URL。轮询用
        :meth:`kling_poll` (endpoint="omni-video")。
        """
        self._require_key()
        payload: Dict[str, Any] = {
            "model_name": model or settings.GATEWAY_KLING_OMNI_MODEL,
            "video_list": [{"url": video_url}],
            "mode": mode,
        }
        if image_urls:
            payload["image_list"] = [{"url": u} for u in image_urls]
        if prompt:
            payload["prompt"] = prompt
        data = await self._post_task(
            f"{self.root_url}/kling/v1/videos/omni-video", payload,
            "kling omni v2v", timeout=timeout,
        )
        return self._kling_task_id(data, "kling omni v2v")

    async def motion_create(
        self,
        prompt: str,
        *,
        character_image: Union[str, bytes],
        motion_video_url: str,
        model: Optional[str] = None,
        ratio: str = "16:9",
        duration: int = 5,
        timeout: float = 60.0,
    ) -> str:
        """动作模仿(动作迁移)创建任务 → task_id。

        按 Seedance 文档: 角色图作为 ``reference_image``(base64 内联)、动作参考视频作为
        ``reference_video``(文档仅这三种 role,无 motion_reference)。走
        ``/contents/generations/tasks``,轮询用 :meth:`seedance_poll`。``motion_video_url``
        须公网可达(studio /asset 签名 URL)。
        """
        self._require_key()
        model = model or settings.GATEWAY_MOTION_MODEL
        if not model:
            raise GatewayError("动作模仿 模型待配置 (GATEWAY_MOTION_MODEL)")
        content: List[Dict[str, Any]] = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "role": "reference_image",
             "image_url": {"url": _as_data_url(character_image, "image/jpeg")}},
            {"type": "video_url", "role": "reference_video", "video_url": {"url": motion_video_url}},
        ]
        payload = {"model": model, "content": content, "ratio": ratio, "duration": duration}
        data = await self._post_task(
            f"{self.base_url}/contents/generations/tasks", payload, "motion", timeout=timeout
        )
        task_id = data.get("task_id") or data.get("id")
        if not task_id:
            raise GatewayError(f"motion: no task_id: {json.dumps(data)[:300]}")
        return task_id

    # ── 动作模仿 Kling 档 (/api/kling/v1/videos/*) ──────────────────────────────
    # Kling 端点不在 OpenAI /v1 前缀下,响应外层为 {code,message,request_id,data:{...}}。
    # 角色图/参考视频都必须是公网可达 URL(网关按 URL 拉取,不吃 base64 内联)。
    @staticmethod
    def _kling_task_id(data: Dict[str, Any], what: str) -> str:
        """从 Kling {code,message,data:{task_id,...}} 响应里取 task_id;code!=0 视为错误。"""
        code = data.get("code")
        if code not in (0, None, "0"):
            raise GatewayError(_extract_error_message(json.dumps(data)) or f"{what} failed: code={code}")
        body = data.get("data") or {}
        task_id = body.get("task_id") or body.get("id")
        if not task_id:
            raise GatewayError(f"{what}: no task_id: {json.dumps(data)[:300]}")
        return task_id

    async def kling_motion_control_create(
        self,
        prompt: str,
        *,
        image_url: str,
        video_url: str,
        character_orientation: str = "image",   # image | video
        keep_original_sound: str = "yes",
        mode: str = "pro",
        model: Optional[str] = None,
        timeout: float = 60.0,
    ) -> str:
        """Kling 动作控制(动作模仿)创建任务 → task_id。

        文档:https://neolink.com/docs/instruction-manual/video/kling/motion-control
        POST /api/kling/v1/videos/motion-control。image_url=角色/背景参考图,video_url=参考
        动作视频,二者均须公网可达 URL。轮询用 :meth:`kling_poll` (endpoint="motion-control")。
        """
        self._require_key()
        payload: Dict[str, Any] = {
            "model_name": model or settings.GATEWAY_KLING_MOTION_MODEL,
            "image_url": image_url,
            "video_url": video_url,
            "character_orientation": character_orientation,
            "keep_original_sound": keep_original_sound,
            "mode": mode,
        }
        if prompt:
            payload["prompt"] = prompt
        data = await self._post_task(
            f"{self.root_url}/kling/v1/videos/motion-control", payload,
            "kling motion-control", timeout=timeout,
        )
        return self._kling_task_id(data, "kling motion-control")

    async def kling_omni_create(
        self,
        prompt: str,
        *,
        image_url: str,
        video_url: str,
        mode: str = "pro",
        model: Optional[str] = None,
        timeout: float = 60.0,
    ) -> str:
        """Kling Omni 视频生成(动作迁移用法)创建任务 → task_id。

        文档:https://neolink.com/docs/instruction-manual/video/kling/omni
        POST /api/kling/v1/videos/omni-video。image_list=参考图(主体),video_list=参考视频
        (动作),均须公网可达 URL。轮询用 :meth:`kling_poll` (endpoint="omni-video")。
        """
        self._require_key()
        payload: Dict[str, Any] = {
            "model_name": model or settings.GATEWAY_KLING_OMNI_MODEL,
            "image_list": [{"url": image_url}],
            "video_list": [{"url": video_url}],
            "mode": mode,
        }
        if prompt:
            payload["prompt"] = prompt
        data = await self._post_task(
            f"{self.root_url}/kling/v1/videos/omni-video", payload,
            "kling omni", timeout=timeout,
        )
        return self._kling_task_id(data, "kling omni")

    async def kling_poll(
        self, task_id: str, *, endpoint: str, timeout: float = 30.0,
    ) -> Dict[str, Any]:
        """轮询 Kling 任务 → {status, url, raw}。endpoint ∈ motion-control | omni-video。

        Kling task_status: submitted/processing/succeed/failed,归一化到统一桶
        (succeed → "succeeded")。结果视频 URL 字段文档未明示,采用防御式多路径解析。
        """
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(
                f"{self.root_url}/kling/v1/videos/{endpoint}/{task_id}", headers=self._headers
            )
            self._check(resp, f"kling {endpoint} poll")
            data = resp.json()
        body = data.get("data") or {}
        status = str(body.get("task_status") or data.get("task_status") or "").lower()
        if status == "succeed":
            status = "succeeded"
        url = self._extract_kling_video_url(body)
        # 任务已成功但结果视频 URL 提取不到:文档未给结果响应结构,采用了多路径兜底仍未命中。
        # 与其让上层 _poll_video 静默轮询到 10 分钟超时,不如立即失败并把原始响应打到日志/错误里,
        # 便于据首个真实成功响应校正 _extract_kling_video_url 的字段路径。
        if status in _DONE and not url:
            logger.warning("kling %s poll succeeded but no video url; raw=%s",
                           endpoint, json.dumps(data)[:800])
            raise GatewayError(
                f"Kling 任务已完成但未能解析结果视频 URL(响应结构待确认): {json.dumps(data)[:300]}"
            )
        return {"status": status, "url": url, "raw": data}

    @staticmethod
    def _extract_kling_video_url(body: Dict[str, Any]) -> Optional[str]:
        """从 Kling 任务结果里防御式抽取输出视频 URL(响应结构文档未给全,多路径兜底)。

        Kling(可灵/kwaivgi)异步任务常见结果形态:``data.task_result.videos[].url``;
        亦见 ``works[]`` 里携 ``url`` / ``resource`` / ``resource_without_watermark``。
        逐一兜底,命中第一个可用 URL 即返回。
        """
        result = body.get("task_result") or body.get("result") or {}
        for coll_key in ("videos", "works", "video_list"):
            items = result.get(coll_key) if isinstance(result, dict) else None
            if isinstance(items, list):
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    for k in ("url", "resource", "resource_without_watermark", "video_url"):
                        if isinstance(it.get(k), str) and it[k]:
                            return it[k]
        # 顶层兜底
        for key in ("video_url", "url"):
            val = (result.get(key) if isinstance(result, dict) else None) or body.get(key)
            if isinstance(val, str) and val:
                return val
        return None

    async def video_edit_create(
        self,
        prompt: str,
        *,
        video_url: Optional[str] = None,
        video_bytes: Optional[bytes] = None,
        edit_type: str = "basic",     # 兼容上层调用,非网关字段
        model: Optional[str] = None,
        timeout: float = 120.0,
    ) -> str:
        """视频编辑创建任务 → task_id。

        按 HappyHorse 文档(https://neolink.com/docs/instruction-manual/video/02-happyhorse):
        走 ``POST /v1/videos``,``input_reference`` = 输入视频,``prompt`` = 编辑指令,
        ``model`` = ``happyhorse-1.0-video-edit-{res}``。轮询用 :meth:`video_poll`。
        优先用公网视频 URL(input_reference 接 URL 字符串);无 URL 时回退 base64 内联。
        """
        self._require_key()
        model = model or settings.GATEWAY_VIDEO_EDIT_MODEL
        if not model:
            raise GatewayError("视频编辑 模型待配置 (GATEWAY_VIDEO_EDIT_MODEL)")
        if video_url:
            input_ref = video_url
        elif video_bytes is not None:
            input_ref = _as_data_url(video_bytes, "video/mp4")
        else:
            raise GatewayError("视频编辑缺少输入视频 (video_url / video_bytes)")
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "input_reference": input_ref,
        }
        data = await self._post_task(
            f"{self.base_url}/videos", payload, "video_edit", timeout=timeout
        )
        task_id = data.get("id") or data.get("task_id")
        if not task_id:
            raise GatewayError(f"video_edit: no task_id: {json.dumps(data)[:300]}")
        return task_id

    # ── generic poll helper ────────────────────────────────────────────────────
    @staticmethod
    def is_done(status: str) -> bool:
        return status in _DONE

    @staticmethod
    def is_failed(status: str) -> bool:
        return status in _FAIL


_gateway_singleton: Optional[GatewayClient] = None


def get_gateway_client() -> GatewayClient:
    """Shared gateway client instance."""
    global _gateway_singleton
    if _gateway_singleton is None:
        _gateway_singleton = GatewayClient()
    return _gateway_singleton
