"""
주식 시세 및 재무 데이터 서비스.
한국 주식: FinanceDataReader (KRX 데이터)
글로벌 주식: yfinance
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from app.executor import get_executor, market_cache, TTL_QUOTE, TTL_CHART, TTL_FINANCIALS, TTL_SEARCH

logger = logging.getLogger(__name__)

KR_STOCK_NAMES: dict[str, str] = {}

# FinanceDataReader로 처리해야 하는 지수/환율 전용 티커
_FDR_SPECIAL_TICKERS = frozenset({
    "KS11", "KQ11",          # KOSPI, KOSDAQ 지수
    "USD/KRW", "USD/EUR", "USD/JPY", "USD/CNY",  # 환율
})


def _is_kr_ticker(ticker: str) -> bool:
    return ticker.isdigit() and len(ticker) == 6


def _use_fdr(ticker: str) -> bool:
    """FDR로 처리해야 하는 티커인지 판단 (한국 종목 코드 또는 FDR 전용 지수/환율)."""
    return _is_kr_ticker(ticker) or ticker in _FDR_SPECIAL_TICKERS


def _to_yf_ticker(ticker: str) -> str:
    if _is_kr_ticker(ticker):
        return f"{ticker}.KS"
    return ticker


def _get_period_days(period: str) -> int:
    return {
        "1d": 1, "5d": 5, "1m": 30, "3m": 90,
        "6m": 180, "1y": 365, "2y": 730, "5y": 1825,
    }.get(period, 365)


# ---------------------------------------------------------------------------
# 동기 함수들 (스레드 풀에서 실행)
# ---------------------------------------------------------------------------

def _fetch_quote_sync(ticker: str) -> dict:
    try:
        import FinanceDataReader as fdr
        end = datetime.now()
        start = end - timedelta(days=10)
        df = fdr.DataReader(ticker, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
        if df.empty:
            return {}
        latest = df.iloc[-1]
        prev = df.iloc[-2] if len(df) > 1 else df.iloc[-1]
        prev_close = float(prev["Close"])
        price = float(latest["Close"])
        change = price - prev_close
        return {
            "ticker": ticker,
            "price": price,
            "change": change,
            "change_pct": change / prev_close * 100 if prev_close else 0,
            "volume": int(latest.get("Volume", 0)),
            "high": float(latest.get("High", price)),
            "low": float(latest.get("Low", price)),
            "open": float(latest.get("Open", price)),
            "prev_close": prev_close,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.error(f"FDR quote error [{ticker}]: {e}")
        return {}


def _fetch_quote_yf_sync(ticker: str) -> dict:
    try:
        import yfinance as yf
        yf_ticker = yf.Ticker(ticker)
        hist = yf_ticker.history(period="5d")
        if hist.empty:
            return {}
        latest = hist.iloc[-1]
        prev = hist.iloc[-2] if len(hist) > 1 else hist.iloc[-1]
        prev_close = float(prev["Close"])
        price = float(latest["Close"])
        change = price - prev_close
        return {
            "ticker": ticker,
            "price": price,
            "change": change,
            "change_pct": change / prev_close * 100 if prev_close else 0,
            "volume": int(latest.get("Volume", 0)),
            "high": float(latest.get("High", price)),
            "low": float(latest.get("Low", price)),
            "open": float(latest.get("Open", price)),
            "prev_close": prev_close,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.error(f"yfinance quote error [{ticker}]: {e}")
        return {}


def _fetch_chart_sync(ticker: str, period: str = "1y") -> list[dict]:
    try:
        import FinanceDataReader as fdr
        days = _get_period_days(period)
        end = datetime.now()
        start = end - timedelta(days=days)
        df = fdr.DataReader(ticker, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
        if df.empty:
            return []
        result = []
        for date, row in df.iterrows():
            result.append({
                "time": date.strftime("%Y-%m-%d"),
                "open": float(row.get("Open", row["Close"])),
                "high": float(row.get("High", row["Close"])),
                "low": float(row.get("Low", row["Close"])),
                "close": float(row["Close"]),
                "volume": int(row.get("Volume", 0)),
            })
        return result
    except Exception as e:
        logger.error(f"FDR chart error [{ticker}]: {e}")
        return []


def _fetch_chart_yf_sync(ticker: str, period: str = "1y") -> list[dict]:
    try:
        import yfinance as yf
        period_map = {
            "1d": "1d", "5d": "5d", "1m": "1mo", "3m": "3mo",
            "6m": "6mo", "1y": "1y", "2y": "2y", "5y": "5y",
        }
        yf_period = period_map.get(period, "1y")
        yf_ticker = yf.Ticker(ticker)
        hist = yf_ticker.history(period=yf_period)
        if hist.empty:
            return []
        result = []
        for date, row in hist.iterrows():
            result.append({
                "time": date.strftime("%Y-%m-%d"),
                "open": float(row.get("Open", row["Close"])),
                "high": float(row.get("High", row["Close"])),
                "low": float(row.get("Low", row["Close"])),
                "close": float(row["Close"]),
                "volume": int(row.get("Volume", 0)),
            })
        return result
    except Exception as e:
        logger.error(f"yfinance chart error [{ticker}]: {e}")
        return []


def _fetch_financials_sync(ticker: str) -> dict:
    try:
        import yfinance as yf
        yf_t = _to_yf_ticker(ticker)
        info = yf.Ticker(yf_t).info

        def safe(key: str, scale: float = 1.0):
            v = info.get(key)
            if v is None or v != v:
                return None
            try:
                return float(v) * scale
            except Exception:
                return None

        return {
            "ticker": ticker,
            "name": info.get("longName") or info.get("shortName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "market_cap": safe("marketCap"),
            "per": safe("trailingPE"),
            "forward_per": safe("forwardPE"),
            "pbr": safe("priceToBook"),
            "psr": safe("priceToSalesTrailing12Months"),
            "roe": safe("returnOnEquity", 100),
            "roa": safe("returnOnAssets", 100),
            "debt_to_equity": safe("debtToEquity"),
            "current_ratio": safe("currentRatio"),
            "revenue_growth": safe("revenueGrowth", 100),
            "earnings_growth": safe("earningsGrowth", 100),
            "gross_margin": safe("grossMargins", 100),
            "operating_margin": safe("operatingMargins", 100),
            "net_margin": safe("profitMargins", 100),
            "dividend_yield": safe("dividendYield", 100),
            "beta": safe("beta"),
            "week_52_high": safe("fiftyTwoWeekHigh"),
            "week_52_low": safe("fiftyTwoWeekLow"),
            "employees": info.get("fullTimeEmployees"),
            "summary": (info.get("longBusinessSummary", "") or "")[:600],
        }
    except Exception as e:
        logger.error(f"financials error [{ticker}]: {e}")
        return {"ticker": ticker}


def _search_stocks_sync(query: str) -> list[dict]:
    results = []
    try:
        import FinanceDataReader as fdr
        for market in ("KOSPI", "KOSDAQ"):
            try:
                listing = fdr.StockListing(market)
                mask = (
                    listing["Name"].str.contains(query, na=False, case=False) |
                    listing["Code"].str.contains(query, na=False)
                )
                for _, row in listing[mask].head(10).iterrows():
                    results.append({
                        "ticker": row["Code"],
                        "name": row["Name"],
                        "market": market,
                        "sector": row.get("Sector", ""),
                    })
            except Exception:
                pass
    except Exception as e:
        logger.error(f"search error: {e}")

    if not results and not query.isdigit():
        try:
            import yfinance as yf
            t = yf.Ticker(query.upper())
            info = t.info
            if info.get("longName") or info.get("shortName"):
                results.append({
                    "ticker": query.upper(),
                    "name": info.get("longName", info.get("shortName", query.upper())),
                    "market": info.get("exchange", "US"),
                    "sector": info.get("sector", ""),
                })
        except Exception:
            pass

    return results[:20]


# ---------------------------------------------------------------------------
# 비동기 퍼블릭 API — 공유 executor + TTL 캐시
# ---------------------------------------------------------------------------

class MarketService:
    @staticmethod
    async def get_quote(ticker: str) -> dict:
        cache_key = f"quote:{ticker}"
        hit, cached = market_cache.get(cache_key)
        if hit:
            return cached

        loop = asyncio.get_running_loop()
        executor = get_executor()
        if _use_fdr(ticker):
            data = await loop.run_in_executor(executor, _fetch_quote_sync, ticker)
        else:
            data = await loop.run_in_executor(executor, _fetch_quote_yf_sync, ticker)

        data["name"] = KR_STOCK_NAMES.get(ticker, data.get("name"))
        if data:
            market_cache.set(cache_key, data, TTL_QUOTE)
        return data

    @staticmethod
    async def get_chart(ticker: str, period: str = "1y") -> list[dict]:
        cache_key = f"chart:{ticker}:{period}"
        hit, cached = market_cache.get(cache_key)
        if hit:
            return cached

        loop = asyncio.get_running_loop()
        executor = get_executor()
        if _use_fdr(ticker):
            data = await loop.run_in_executor(executor, _fetch_chart_sync, ticker, period)
        else:
            data = await loop.run_in_executor(executor, _fetch_chart_yf_sync, ticker, period)

        if data:
            market_cache.set(cache_key, data, TTL_CHART)
        return data

    @staticmethod
    async def get_financials(ticker: str) -> dict:
        cache_key = f"financials:{ticker}"
        hit, cached = market_cache.get(cache_key)
        if hit:
            return cached

        loop = asyncio.get_running_loop()
        executor = get_executor()
        data = await loop.run_in_executor(executor, _fetch_financials_sync, ticker)
        if data:
            market_cache.set(cache_key, data, TTL_FINANCIALS)
        return data

    @staticmethod
    async def search(query: str) -> list[dict]:
        cache_key = f"search:{query}"
        hit, cached = market_cache.get(cache_key)
        if hit:
            return cached

        loop = asyncio.get_running_loop()
        executor = get_executor()
        data = await loop.run_in_executor(executor, _search_stocks_sync, query)
        market_cache.set(cache_key, data, TTL_SEARCH)
        return data


market_service = MarketService()
