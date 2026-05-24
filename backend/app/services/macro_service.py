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


def _fetch_macro_dashboard_sync(fred_api_key: str = "") -> dict:
    """
    공유 스레드 풀의 단일 스레드에서 순차 실행.
    전체 소요 시간은 늘어날 수 있지만, 동시 스레드 폭발을 방지합니다.
    캐시가 있으면 이 함수가 호출되지 않으므로 실제 호출 빈도가 낮습니다.
    """
    tasks = {
        "us_fed_rate":  lambda: _fetch_fred_series("FEDFUNDS",         "미국 기준금리", "%",     fred_api_key=fred_api_key),
        "us_10y_yield": lambda: _fetch_fred_series("DGS10",            "미국 10년 국채", "%",    fred_api_key=fred_api_key),
        "kr_base_rate": lambda: _fetch_fred_series("INTDSRKRM193N",    "한국 기준금리", "%",     fred_api_key=fred_api_key),
        "us_cpi":       lambda: _fetch_fred_series("CPIAUCSL",         "미국 CPI",    "index",  fred_api_key=fred_api_key),
        "kr_cpi":       lambda: _fetch_fred_series("KORCPIALLMINMEI",  "한국 CPI",    "index",  fred_api_key=fred_api_key),
        "usd_krw":      lambda: _fetch_fdr_index("USD/KRW", "달러/원", "₩"),
        "eur_usd":      lambda: _fetch_fdr_index("EUR/USD", "유로/달러", "$"),
        "kospi":        lambda: _fetch_fdr_index("KS11",    "KOSPI",    "pt"),
        "kosdaq":       lambda: _fetch_fdr_index("KQ11",    "KOSDAQ",   "pt"),
        "sp500":        lambda: _fetch_fdr_index("S&P500",  "S&P 500",  "pt"),
        "nasdaq":       lambda: _fetch_fdr_index("IXIC",    "NASDAQ",   "pt"),
    }

    result: dict = {}
    for key, fn in tasks.items():
        try:
            result[key] = fn()
        except Exception as e:
            logger.warning(f"macro [{key}] error: {e}")
            result[key] = None
    return result


class MacroService:
    @staticmethod
    async def get_dashboard(fred_api_key: str = "") -> dict:
        # API 키가 동일한 요청끼리만 캐시 공유 (키가 다르면 별도 캐시 엔트리)
        cache_key = f"macro:{fred_api_key[:8] if fred_api_key else 'default'}"
        hit, cached = macro_cache.get(cache_key)
        if hit:
            return cached

        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(get_executor(), _fetch_macro_dashboard_sync, fred_api_key)
        macro_cache.set(cache_key, data, TTL_MACRO)
        return data


macro_service = MacroService()
