from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from app.services.market_service import MarketService
from app.services.chart_service import ChartService
from app.services.sector_service import SectorService
from app.services.ai_service import analyze_stock
from app.schemas.analysis import AnalysisOut, ScoreBreakdown

router = APIRouter()


@router.get("/{ticker}", response_model=AnalysisOut)
async def get_analysis(
    ticker: str,
    x_anthropic_key: Optional[str] = Header(None, alias="X-Anthropic-Key"),
):
    ticker = ticker.upper()

    # 병렬로 데이터 수집
    import asyncio
    financials_task = MarketService.get_financials(ticker)
    chart_task      = MarketService.get_chart(ticker, "1y")
    sector_task     = SectorService.get_performance()

    financials, candles, sectors = await asyncio.gather(
        financials_task, chart_task, sector_task,
        return_exceptions=True,
    )

    if isinstance(financials, Exception):
        financials = {}
    if isinstance(candles, Exception):
        candles = []
    if isinstance(sectors, Exception):
        sectors = []

    # 기술적 신호
    signals = await ChartService.get_signals(candles) if candles else {}

    result = await analyze_stock(ticker, financials, signals, sectors, anthropic_api_key=x_anthropic_key or "")

    # ScoreBreakdown 객체 변환
    sb = result.pop("score_breakdown", {})
    score_breakdown = ScoreBreakdown(
        valuation_score=sb.get("valuation_score", 0),
        growth_score=sb.get("growth_score", 0),
        technical_score=sb.get("technical_score", 0),
        sector_score=sb.get("sector_score", 0),
        total_score=sb.get("total_score", 0),
    )

    return AnalysisOut(score_breakdown=score_breakdown, **result)
