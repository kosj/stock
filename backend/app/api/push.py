from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.db import get_db
from app.models.alerts import PushSubscription, PriceAlert
from app.services.push_service import send_push_notification
from app.config import settings

router = APIRouter()


class PushSubscribeBody(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class AlertCreate(BaseModel):
    ticker: str
    alert_type: str   # stop_loss | take_profit | custom
    direction: str    # above | below
    threshold: float
    message: str | None = None
    position_id: int | None = None


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    return {"public_key": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe(body: PushSubscribeBody, db: AsyncSession = Depends(get_db)):
    # 기존 구독 갱신 또는 신규 등록
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.p256dh = body.p256dh
        existing.auth   = body.auth
    else:
        sub = PushSubscription(endpoint=body.endpoint, p256dh=body.p256dh, auth=body.auth)
        db.add(sub)
    await db.commit()
    return {"status": "subscribed"}


@router.post("/test")
async def test_push(db: AsyncSession = Depends(get_db)):
    """테스트 푸시 알림 발송."""
    result = await db.execute(select(PushSubscription))
    subs = result.scalars().all()
    if not subs:
        raise HTTPException(status_code=404, detail="등록된 구독이 없습니다.")
    for sub in subs:
        await send_push_notification(
            endpoint=sub.endpoint,
            p256dh=sub.p256dh,
            auth=sub.auth,
            title="테스트 알림",
            body="주식 대시보드 알림이 정상 작동 중입니다.",
        )
    return {"sent": len(subs)}


# ── 가격 알림 ────────────────────────────────────────────────────────────────

@router.get("/alerts")
async def list_alerts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PriceAlert).where(PriceAlert.is_active == True).order_by(PriceAlert.created_at.desc())
    )
    return result.scalars().all()


@router.post("/alerts", status_code=status.HTTP_201_CREATED)
async def create_alert(body: AlertCreate, db: AsyncSession = Depends(get_db)):
    alert = PriceAlert(**body.model_dump())
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return alert


@router.delete("/alerts/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PriceAlert).where(PriceAlert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404)
    await db.delete(alert)
    await db.commit()
