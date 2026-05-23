"""
가격 알림 체크 서비스.
APScheduler로 주기적으로 활성 알림을 체크하고 웹 푸시 발송.
"""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select, update
from app.db import AsyncSessionLocal
from app.models.alerts import PriceAlert, PushSubscription
from app.services.market_service import MarketService

logger = logging.getLogger(__name__)


async def check_alerts() -> None:
    """활성 알림을 순회하며 조건 충족 시 푸시 발송."""
    async with AsyncSessionLocal() as db:
        stmt = select(PriceAlert).where(PriceAlert.is_active == True)
        result = await db.execute(stmt)
        alerts = result.scalars().all()

        if not alerts:
            return

        # 고유 ticker만 조회
        tickers = list({a.ticker for a in alerts})
        prices: dict[str, float] = {}
        for ticker in tickers:
            try:
                q = await MarketService.get_quote(ticker)
                if q:
                    prices[ticker] = q["price"]
            except Exception as e:
                logger.warning(f"alert price fetch [{ticker}]: {e}")

        triggered_ids = []
        notifications = []

        for alert in alerts:
            price = prices.get(alert.ticker)
            if price is None:
                continue

            triggered = False
            if alert.direction == "below" and price <= alert.threshold:
                triggered = True
            elif alert.direction == "above" and price >= alert.threshold:
                triggered = True

            if triggered:
                triggered_ids.append(alert.id)
                label = "손절가" if alert.alert_type == "stop_loss" else ("목표가" if alert.alert_type == "take_profit" else "알림")
                notifications.append({
                    "title": f"{alert.ticker} {label} 도달",
                    "body": f"현재가 {price:,.0f}원 | 설정가 {alert.threshold:,.0f}원",
                })

        # DB 업데이트
        if triggered_ids:
            await db.execute(
                update(PriceAlert)
                .where(PriceAlert.id.in_(triggered_ids))
                .values(is_active=False, last_triggered=datetime.now())
            )
            await db.commit()

        # 푸시 발송
        for notif in notifications:
            await _send_push_to_all(db, notif["title"], notif["body"])


async def _send_push_to_all(db, title: str, body: str) -> None:
    try:
        from app.services.push_service import send_push_notification
        stmt = select(PushSubscription)
        result = await db.execute(stmt)
        subs = result.scalars().all()
        for sub in subs:
            try:
                await send_push_notification(
                    endpoint=sub.endpoint,
                    p256dh=sub.p256dh,
                    auth=sub.auth,
                    title=title,
                    body=body,
                )
            except Exception as e:
                logger.warning(f"push send error: {e}")
    except Exception as e:
        logger.error(f"push broadcast error: {e}")
