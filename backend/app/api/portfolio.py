import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db import get_db
from app.models.portfolio import Portfolio, Position, Watchlist
from app.schemas.portfolio import (
    PortfolioCreate, PortfolioUpdate, PortfolioOut,
    PositionCreate, PositionUpdate, PositionOut,
    PnLOut, PortfolioSummary,
    WatchlistCreate, WatchlistOut,
)
from app.services.market_service import MarketService
from app.services.kis_service import kis_service

logger = logging.getLogger(__name__)
router = APIRouter()

_STRATEGY_MAP = {
    "Strong Buy":  "적극 매수 — 분할 매수 후 장기 보유",
    "Buy":         "매수 — 지지선 확인 후 비중 확대",
    "Hold":        "보유 유지 — 추가 매수 보류, 모니터링",
    "Sell":        "매도 검토 — 리스크 관리 우선",
    "Strong Sell": "적극 매도 — 손절 후 현금 확보",
}


# ── 포트폴리오 CRUD ─────────────────────────────────────────────────────────

@router.get("/", response_model=list[PortfolioOut])
async def list_portfolios(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Portfolio).order_by(Portfolio.created_at.desc()))
    return result.scalars().all()


@router.post("/", response_model=PortfolioOut, status_code=status.HTTP_201_CREATED)
async def create_portfolio(body: PortfolioCreate, db: AsyncSession = Depends(get_db)):
    portfolio = Portfolio(**body.model_dump())
    db.add(portfolio)
    await db.commit()
    await db.refresh(portfolio)
    return portfolio


@router.get("/{portfolio_id}", response_model=PortfolioOut)
async def get_portfolio(portfolio_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id))
    portfolio = result.scalar_one_or_none()
    if not portfolio:
        raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다.")
    return portfolio


@router.put("/{portfolio_id}", response_model=PortfolioOut)
async def update_portfolio(portfolio_id: int, body: PortfolioUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id))
    portfolio = result.scalar_one_or_none()
    if not portfolio:
        raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다.")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(portfolio, k, v)
    await db.commit()
    await db.refresh(portfolio)
    return portfolio


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_portfolio(portfolio_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id))
    portfolio = result.scalar_one_or_none()
    if not portfolio:
        raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다.")
    await db.delete(portfolio)
    await db.commit()


# ── 포지션 CRUD ─────────────────────────────────────────────────────────────

@router.get("/{portfolio_id}/positions", response_model=list[PositionOut])
async def list_positions(portfolio_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Position).where(Position.portfolio_id == portfolio_id))
    return result.scalars().all()


@router.post("/{portfolio_id}/positions", response_model=PositionOut, status_code=status.HTTP_201_CREATED)
async def add_position(portfolio_id: int, body: PositionCreate, db: AsyncSession = Depends(get_db)):
    # 포트폴리오 존재 확인
    pr = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id))
    if not pr.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다.")
    pos = Position(portfolio_id=portfolio_id, **body.model_dump())
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return pos


@router.put("/positions/{position_id}", response_model=PositionOut)
async def update_position(position_id: int, body: PositionUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Position).where(Position.id == position_id))
    pos = result.scalar_one_or_none()
    if not pos:
        raise HTTPException(status_code=404, detail="포지션을 찾을 수 없습니다.")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(pos, k, v)
    await db.commit()
    await db.refresh(pos)
    return pos


@router.delete("/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_position(position_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Position).where(Position.id == position_id))
    pos = result.scalar_one_or_none()
    if not pos:
        raise HTTPException(status_code=404, detail="포지션을 찾을 수 없습니다.")
    await db.delete(pos)
    await db.commit()


# ── P&L 계산 ────────────────────────────────────────────────────────────────

@router.get("/{portfolio_id}/summary", response_model=PortfolioSummary)
async def get_portfolio_summary(portfolio_id: int, db: AsyncSession = Depends(get_db)):
    pr = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id))
    portfolio = pr.scalar_one_or_none()
    if not portfolio:
        raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다.")

    result = await db.execute(select(Position).where(Position.portfolio_id == portfolio_id))
    positions = result.scalars().all()

    pnl_list = []
    total_invested = 0.0
    total_value = 0.0

    for pos in positions:
        try:
            quote = await MarketService.get_quote(pos.ticker)
            current_price = quote.get("price", pos.avg_price)
        except Exception:
            current_price = pos.avg_price

        cost_basis  = pos.avg_price * pos.quantity
        total_val   = current_price * pos.quantity
        pnl_amount  = total_val - cost_basis
        pnl_percent = pnl_amount / cost_basis * 100 if cost_basis else 0

        # 손절/목표 근접 경고 (5% 이내)
        is_near_stop   = pos.stop_loss is not None and current_price <= pos.stop_loss * 1.05
        is_near_target = pos.take_profit is not None and current_price >= pos.take_profit * 0.95

        pnl_list.append(PnLOut(
            position_id=pos.id,
            ticker=pos.ticker,
            name=pos.name,
            quantity=pos.quantity,
            avg_price=pos.avg_price,
            current_price=current_price,
            stop_loss=pos.stop_loss,
            take_profit=pos.take_profit,
            strategy=pos.strategy,
            notes=pos.notes,
            pnl_amount=round(pnl_amount, 0),
            pnl_percent=round(pnl_percent, 2),
            total_value=round(total_val, 0),
            cost_basis=round(cost_basis, 0),
            is_near_stop=is_near_stop,
            is_near_target=is_near_target,
        ))
        total_invested += cost_basis
        total_value    += total_val

    total_pnl = total_value - total_invested
    total_pnl_pct = total_pnl / total_invested * 100 if total_invested else 0

    return PortfolioSummary(
        portfolio_id=portfolio_id,
        name=portfolio.name,
        total_invested=round(total_invested, 0),
        total_value=round(total_value, 0),
        total_pnl=round(total_pnl, 0),
        total_pnl_percent=round(total_pnl_pct, 2),
        positions=pnl_list,
    )


# ── AI 자동 채우기 ──────────────────────────────────────────────────────────

@router.post("/{portfolio_id}/auto-fill")
async def auto_fill_portfolio(portfolio_id: int, db: AsyncSession = Depends(get_db)):
    """포트폴리오 전체 포지션의 손절가·목표가·전략을 AI 분석으로 일괄 갱신."""
    from app.services.ai_service import analyze_stock
    from app.services.chart_service import ChartService
    from app.services.sector_service import SectorService

    pr = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id))
    if not pr.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="포트폴리오를 찾을 수 없습니다.")

    result = await db.execute(select(Position).where(Position.portfolio_id == portfolio_id))
    positions = result.scalars().all()
    if not positions:
        return {"updated": 0}

    async def fill_one(pos: Position) -> None:
        try:
            ticker = pos.ticker
            financials, candles, sectors = await asyncio.gather(
                MarketService.get_financials(ticker),
                MarketService.get_chart(ticker, "1y"),
                SectorService.get_performance(),
                return_exceptions=True,
            )
            if isinstance(financials, Exception): financials = {}
            if isinstance(candles, Exception):    candles = []
            if isinstance(sectors, Exception):    sectors = []

            signals  = await ChartService.get_signals(candles) if candles else {}
            analysis = await analyze_stock(ticker, financials, signals, sectors)

            rec   = analysis.get("recommendation", "Hold")
            score = analysis.get("score", 0)
            pos.strategy = f"{_STRATEGY_MAP.get(rec, rec)} (AI 점수: {score:.0f}/100)"
            if analysis.get("stop_price"):
                pos.stop_loss = round(analysis["stop_price"], 0)
            if analysis.get("target_price"):
                pos.take_profit = round(analysis["target_price"], 0)
        except Exception as exc:
            logger.error("auto-fill [%s]: %s", pos.ticker, exc)

    await asyncio.gather(*[fill_one(p) for p in positions])
    await db.commit()
    return {"updated": len(positions)}


# ── KIS 연동 포트폴리오 가져오기 ─────────────────────────────────────────────

@router.get("/kis/positions")
async def get_kis_positions():
    """한국투자증권 보유 종목 조회."""
    return await kis_service.get_positions()


@router.get("/kis/balance")
async def get_kis_balance():
    """한국투자증권 잔고 조회."""
    return await kis_service.get_balance()


# ── 관심종목 ────────────────────────────────────────────────────────────────

@router.get("/watchlist/", response_model=list[WatchlistOut])
async def list_watchlist(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Watchlist).order_by(Watchlist.added_at.desc()))
    return result.scalars().all()


@router.post("/watchlist/", response_model=WatchlistOut, status_code=status.HTTP_201_CREATED)
async def add_watchlist(body: WatchlistCreate, db: AsyncSession = Depends(get_db)):
    item = Watchlist(**body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/watchlist/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_watchlist(item_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Watchlist).where(Watchlist.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404)
    await db.delete(item)
    await db.commit()
