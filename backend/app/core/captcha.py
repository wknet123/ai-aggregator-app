"""无状态图形验证码。

不依赖 Redis：答案与过期时间用 SECRET_KEY 做 HMAC 签名后，随图片一并下发一个
不透明 token。校验时验签 + 检查未过期 + 比对用户输入（大小写不敏感）。图片是唯一
泄露答案的渠道——人眼可读、脚本难读，从而挡住自动化访问。

token 结构：base64url(payload_json) + "." + base64url(hmac_sha256(secret, payload_b64))
payload = {"c": <code_lower>, "e": <expire_epoch_seconds>}
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import secrets
import time
from typing import Tuple

from PIL import Image, ImageDraw, ImageFont

from app.config import settings

# 排除易混字符：0/O、1/l/I、间接排除大小写混淆（统一按小写校验）
_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload_b64: str) -> str:
    sig = hmac.new(settings.SECRET_KEY.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64e(sig)


def _make_token(code: str, ttl: int) -> str:
    payload = json.dumps({"c": code.lower(), "e": int(time.time()) + ttl}, separators=(",", ":"))
    payload_b64 = _b64e(payload.encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def _random_code(length: int) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def _load_font(size: int) -> ImageFont.ImageFont:
    """尽量用 truetype（清晰、可调大小），装不到就退回位图默认字体。"""
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except Exception:  # noqa: BLE001
            continue
    return ImageFont.load_default()


def _render_image(code: str) -> bytes:
    """把验证码字符画成带干扰线/噪点的 PNG。"""
    width, height = 140, 48
    img = Image.new("RGB", (width, height), (26, 26, 31))  # 贴近前端深色主题 #1a1a1f
    draw = ImageDraw.Draw(img)
    font = _load_font(30)

    # 噪点
    for _ in range(280):
        xy = (secrets.randbelow(width), secrets.randbelow(height))
        draw.point(xy, fill=(secrets.randbelow(120) + 60,) * 3)

    # 干扰线
    for _ in range(5):
        start = (secrets.randbelow(width), secrets.randbelow(height))
        end = (secrets.randbelow(width), secrets.randbelow(height))
        color = (secrets.randbelow(160) + 60, secrets.randbelow(160) + 60, secrets.randbelow(160) + 60)
        draw.line([start, end], fill=color, width=1)

    # 逐字绘制，带轻微上下抖动与颜色变化
    n = len(code)
    slot = width // (n + 1)
    for i, ch in enumerate(code):
        x = slot * (i + 1) - slot // 2 + secrets.randbelow(6) - 3
        y = (height - 30) // 2 + secrets.randbelow(8) - 4
        color = (
            200 + secrets.randbelow(56),
            120 + secrets.randbelow(120),
            160 + secrets.randbelow(96),
        )
        draw.text((x, y), ch, font=font, fill=color)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_captcha() -> Tuple[str, bytes]:
    """返回 (token, png_bytes)。token 不透明，登录/注册时原样回传。"""
    code = _random_code(settings.CAPTCHA_LENGTH)
    token = _make_token(code, settings.CAPTCHA_TTL_SECONDS)
    return token, _render_image(code)


def generate_captcha_data_url() -> Tuple[str, str]:
    """返回 (token, data_url)，data_url 可直接用于前端 <img src>。"""
    token, png = generate_captcha()
    return token, "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def verify_captcha(token: str, answer: str) -> bool:
    """验签 + 未过期 + 答案匹配（大小写不敏感）。任何异常一律判为失败。"""
    if not token or not answer:
        return False
    try:
        payload_b64, sig = token.split(".", 1)
    except ValueError:
        return False
    # 恒定时间比对签名，防时序侧信道
    if not hmac.compare_digest(sig, _sign(payload_b64)):
        return False
    try:
        payload = json.loads(_b64d(payload_b64))
    except Exception:  # noqa: BLE001
        return False
    if int(payload.get("e", 0)) < int(time.time()):
        return False
    return hmac.compare_digest(str(payload.get("c", "")), answer.strip().lower())
