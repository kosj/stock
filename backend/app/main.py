from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.db import create_tables
from app.api import portfolio, market, analysis, macro, sectors, push, krx, broker
from app.ws.prices import router as ws_router
from app.services.alert_service import check_alerts


scheduler = AsyncIOScheduler(timezone="Asia/Seoul")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작
    await create_tables()

    # 가격 알림 체크 (1분마다)
    scheduler.add_job(check_alerts, "interval", minutes=1, id="alert_check")
    scheduler.start()

    yield

    # 종료
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="주식 대시보드 API",
    version="1.0.0",
    description="한국투자증권 연동, AI 분석, 거시경제 지표, 섹터 로테이션",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 라우터 등록
app.include_router(portfolio.router,  prefix="/api/portfolio",  tags=["포트폴리오"])
app.include_router(market.router,     prefix="/api/market",     tags=["시세"])
app.include_router(analysis.router,   prefix="/api/analysis",   tags=["AI 분석"])
app.include_router(macro.router,      prefix="/api/macro",      tags=["거시경제"])
app.include_router(sectors.router,    prefix="/api/sectors",    tags=["섹터"])
app.include_router(push.router,       prefix="/api/push",       tags=["알림"])
app.include_router(krx.router,        prefix="/api/krx",        tags=["국내증시통계"])
app.include_router(broker.router,     prefix="/api/broker",     tags=["브로커 API"])
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/")
async def root():
    return {
        "app": "주식 대시보드 API",
        "docs": "/docs",
        "health": "/health",
    }
