"""
거시경제 지표 서비스.
FRED API, FinanceDataReader로 금리/환율/인플레이션 데이터 수집.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from app.config import settings

logger = logging.getLogger(__name__)


def _fetch_fred_series(series_id: str, name: str, unit: str, limit: int = 60) -> dict | None:
    try:
        from fredapi import Fred
        fred = Fred(api_key=settings.FRED_API_KEY or "")
        series = fred.get_series(series_id, observation_start=(datetime.now() - timedelta(days=365*3)).strftime("%Y-%m-%d"))
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
        # 시리즈는 최근 30일
        series = df.tail(30)
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


def _fetch_macro_dashboard_sync() -> dict:
    from concurrent.futures import ThreadPoolExecutor

    tasks = {
        # 금리
        "us_fed_rate":   (lambda: _fetch_fred_series("FEDFUNDS", "미국 기준금리", "%")),
        "us_10y_yield":  (lambda: _fetch_fred_series("DGS10", "미국 10년 국채", "%")),
        "kr_base_rate":  (lambda: _fetch_fred_series("INTDSRKRM193N", "한국 기준금리", "%")),
        # 인플레이션
        "us_cpi":        (lambda: _fetch_fred_series("CPIAUCSL", "미국 CPI", "index")),
        "kr_cpi":        (lambda: _fetch_fred_series("KORCPIALLMINMEI", "한국 CPI", "index")),
        # 환율
        "usd_krw":       (lambda: _fetch_fdr_index("USD/KRW", "달러/원", "₩")),
        "eur_usd":       (lambda: _fetch_fdr_index("EUR/USD", "유로/달러", "$")),
        # 지수
        "kospi":         (lambda: _fetch_fdr_index("KS11", "KOSPI", "pt")),
        "kosdaq":        (lambda: _fetch_fdr_index("KQ11", "KOSDAQ", "pt")),
        "sp500":         (lambda: _fetch_fdr_index("S&P500", "S&P 500", "pt")),
        "nasdaq":        (lambda: _fetch_fdr_index("IXIC", "NASDAQ", "pt")),
    }

    result: dict = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {key: pool.submit(fn) for key, fn in tasks.items()}
        for key, fut in futures.items():
            try:
                result[key] = fut.result(timeout=15)
            except Exception as e:
                logger.warning(f"macro {key} timeout/error: {e}")
                result[key] = None

    return result


class MacroService:
    @staticmethod
    async def get_dashboard() -> dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _fetch_macro_dashboard_sync)


macro_service = MacroService()
