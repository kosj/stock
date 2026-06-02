"""
거시경제 지표 서비스.
FRED API, FinanceDataReader로 금리/환율/인플레이션 데이터 수집.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from app.config import settings
from app.executor import get_executor, macro_cache, TTL_MACRO

logger = logging.getLogger(__name__)


def _fetch_fred_series(series_id: str, name: str, unit: str, limit: int = 60, fred_api_key: str = "") -> dict | None:
    try:
        from fredapi import Fred
        fred = Fred(api_key=fred_api_key or settings.FRED_API_KEY or "")
        series = fred.get_series(
            series_id,
            observation_start=(datetime.now() - timedelta(days=365 * 3)).strftime("%Y-%m-%d"),
        )
        series = series.dropna().tail(limit)
        if series.empty:
            return None
        current = float(series.iloc[-1])
        prev    = float(series.iloc[-2]) if len(series) > 1 else current
        change  = current - prev
        return {
            "name": name,
            "value": round(current, 4),
            "prev_value": round(prev, 4),
            "change": round(change, 4),
            "change_pct": round(change / prev * 100, 4) if prev else 0,
            "unit": unit,
            "date": series.index[-1].strftime("%Y-%m-%d"),
            "series": [
                {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
                for d, v in series.items()
            ],
        }
    except Exception as e:
        logger.warning(f"FRED [{series_id}] error: {e}")
        return None


def _fetch_fdr_index(ticker: str, name: str, unit: str = "pt", days: int = 30) -> dict | None:
    try:
        import FinanceDataReader as fdr
        end = datetime.now()
        start = end - timedelta(days=days + 10)
        df = fdr.DataReader(ticker, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
        if df.empty:
            return None
        df = df.dropna(subset=["Close"])
        current = float(df["Close"].iloc[-1])
        prev    = float(df["Close"].iloc[-2]) if len(df) > 1 else current
        change  = current - prev
        series  = df.tail(30)
        return {
            "name": name,
            "value": round(current, 2),
            "prev_value": round(prev, 2),
            "change": round(change, 2),
            "change_pct": round(change / prev * 100, 2) if prev else 0,
            "unit": unit,
            "date": df.index[-1].strftime("%Y-%m-%d"),
            "series": [
                {"date": d.strftime("%Y-%m-%d"), "value": round(float(row["Close"]), 2)}
                for d, row in series.iterrows()
            ],
        }
    except Exception as e:
        logger.warning(f"FDR [{ticker}] error: {e}")
        return None


class MacroService:
    @staticmethod
    async def get_dashboard(fred_api_key: str = "") -> dict:
        cache_key = f"macro:{fred_api_key[:8] if fred_api_key else 'default'}"
        hit, cached = macro_cache.get(cache_key)
        if hit:
            return cached

        loop = asyncio.get_running_loop()
        ex = get_executor()

        async def fred(series_id: str, name: str, unit: str) -> "dict | None":
            return await loop.run_in_executor(
                ex, _fetch_fred_series, series_id, name, unit, 60, fred_api_key
            )

        async def fdr(ticker: str, name: str, unit: str = "pt", days: int = 30) -> "dict | None":
            return await loop.run_in_executor(ex, _fetch_fdr_index, ticker, name, unit, days)

        keys = [
            "us_fed_rate", "us_10y_yield", "kr_base_rate",
            "us_cpi", "kr_cpi",
            "usd_krw", "eur_usd",
            "kospi", "kosdaq", "sp500", "nasdaq",
        ]
        values = await asyncio.gather(
            fred("FEDFUNDS",         "미국 기준금리", "%"),
            fred("DGS10",            "미국 10년 국채", "%"),
            fred("INTDSRKRM193N",    "한국 기준금리", "%"),
            fred("CPIAUCSL",         "미국 CPI",    "index"),
            fred("KORCPIALLMINMEI",  "한국 CPI",    "index"),
            fdr("USD/KRW", "달러/원",   "₩"),
            fdr("EUR/USD", "유로/달러", "$"),
            fdr("KS11",    "KOSPI",     "pt"),
            fdr("KQ11",    "KOSDAQ",    "pt"),
            fdr("S&P500",  "S&P 500",   "pt"),
            fdr("IXIC",    "NASDAQ",    "pt"),
            return_exceptions=True,
        )

        data = {
            key: None if isinstance(val, Exception) else val
            for key, val in zip(keys, values)
        }
        macro_cache.set(cache_key, data, TTL_MACRO)
        return data


macro_service = MacroService()
