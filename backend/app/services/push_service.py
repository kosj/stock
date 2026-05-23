"""웹 푸시 알림 발송 서비스."""
from __future__ import annotations

import json
import logging

from app.config import settings

logger = logging.getLogger(__name__)


async def send_push_notification(
    endpoint: str,
    p256dh: str,
    auth: str,
    title: str,
    body: str,
    url: str = "/",
) -> None:
    if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
        logger.warning("VAPID keys not configured, skipping push")
        return

    try:
        import asyncio
        from pywebpush import webpush, WebPushException

        payload = json.dumps({"title": title, "body": body, "url": url})
        loop = asyncio.get_event_loop()

        def _send():
            webpush(
                subscription_info={
                    "endpoint": endpoint,
                    "keys": {"p256dh": p256dh, "auth": auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_EMAIL},
            )

        await loop.run_in_executor(None, _send)
        logger.info(f"Push sent: {title}")
    except Exception as e:
        logger.error(f"Push error: {e}")
