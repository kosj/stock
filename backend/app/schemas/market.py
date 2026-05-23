from pydantic import BaseModel
from typing import Any


class QuoteOut(BaseModel):
    ticker: str
    name: str | None = None
    price: float
    change: float
    change_pct: float
    volume: int
    high: float
    low: float
    open: float
    prev_close: float | None = None
    market_cap: float | None = None
    timestamp: str


class CandleOut(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class IndicatorPoint(BaseModel):
    time: str
    value: float


class ChartOut(BaseModel):
    ticker: str
    candles: list[CandleOut]
    indicators: dict[str, list[IndicatorPoint]]


class FinancialsOut(BaseModel):
    ticker: str
    name: str | None = None
    sector: str | None = None
    industry: str | None = None
    market_cap: float | None = None
    per: float | None = None
    forward_per: float | None = None
    pbr: float | None = None
    psr: float | None = None
    roe: float | None = None
    roa: float | None = None
    debt_to_equity: float | None = None
    current_ratio: float | None = None
    revenue_growth: float | None = None
    earnings_growth: float | None = None
    gross_margin: float | None = None
    operating_margin: float | None = None
    net_margin: float | None = None
    dividend_yield: float | None = None
    beta: float | None = None
    week_52_high: float | None = None
    week_52_low: float | None = None
    employees: int | None = None
    summary: str | None = None


class SearchResult(BaseModel):
    ticker: str
    name: str
    market: str | None = None
    sector: str | None = None
