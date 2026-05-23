from fastapi import APIRouter, Query
from app.services.market_service import MarketService
from app.services.chart_service import ChartService
from app.schemas.market import QuoteOut, ChartOut, FinancialsOut, SearchResult

router = APIRouter()


@router.get("/search", response_model=list[SearchResult])
async def search(q: str = Query(..., min_length=1)):
    return await MarketService.search(q)


@router.get("/quote/{ticker}")
async def get_quote(ticker: str):
    data = await MarketService.get_quote(ticker.upper())
    if not data:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="시세를 가져올 수 없습니다.")
    return data


@router.get("/chart/{ticker}", response_model=ChartOut)
async def get_chart(
    ticker: str,
    period: str = Query("1y", pattern="^(1d|5d|1m|3m|6m|1y|2y|5y)$"),
):
    ticker = ticker.upper()
    candles = await MarketService.get_chart(ticker, period)
    if not candles:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="차트 데이터를 가져올 수 없습니다.")

    indicators = await ChartService.get_indicators(candles)
    return ChartOut(ticker=ticker, candles=candles, indicators=indicators)


@router.get("/financials/{ticker}", response_model=FinancialsOut)
async def get_financials(ticker: str):
    data = await MarketService.get_financials(ticker.upper())
    return FinancialsOut(**data)


@router.get("/indices")
async def get_market_indices():
    """주요 지수 현황 (KOSPI, KOSDAQ, S&P500, NASDAQ)."""
    import asyncio
    tickers = {
        "KOSPI": "KS11",
        "KOSDAQ": "KQ11",
        "S&P500": "SPY",
        "NASDAQ": "QQQ",
        "달러/원": "USD/KRW",
    }
    results = {}
    tasks = {name: MarketService.get_quote(ticker) for name, ticker in tickers.items()}
    for name, coro in tasks.items():
        try:
            results[name] = await coro
        except Exception:
            results[name] = None
    return results
