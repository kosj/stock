"""
섹터 분석 및 로테이션 서비스.
KODEX ETF 가격 데이터 기반으로 섹터 성과 추적.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# KODEX/TIGER ETF 기반 섹터 매핑 (섹터 대표 ETF)
SECTOR_ETFS = [
    {"sector": "반도체",      "ticker": "091160", "name": "KODEX 반도체"},
    {"sector": "2차전지",     "ticker": "305720", "name": "KODEX 2차전지산업"},
    {"sector": "바이오",      "ticker": "244580", "name": "KODEX 바이오"},
    {"sector": "인터넷/IT",   "ticker": "139260", "name": "KODEX 인터넷"},
    {"sector": "자동차",      "ticker": "091180", "name": "KODEX 자동차"},
    {"sector": "금융",        "ticker": "139270", "name": "KODEX 은행"},
    {"sector": "에너지",      "ticker": "117460", "name": "KODEX 에너지화학"},
    {"sector": "건설",        "ticker": "139220", "name": "KODEX 건설"},
    {"sector": "철강/소재",   "ticker": "139230", "name": "KODEX 철강"},
    {"sector": "AI/로봇",     "ticker": "364980", "name": "KODEX K-로봇액티브"},
]


# 섹터별 관련 ETF 목록 (ETF 랭킹 기능용)
SECTOR_ETF_MAP: dict[str, list[dict]] = {
    "반도체": [
        {"ticker": "091160", "name": "KODEX 반도체"},
        {"ticker": "091230", "name": "TIGER 반도체"},
        {"ticker": "091170", "name": "KBSTAR 반도체"},
        {"ticker": "396510", "name": "SOL 반도체소부장"},
    ],
    "2차전지": [
        {"ticker": "305720", "name": "KODEX 2차전지산업"},
        {"ticker": "305540", "name": "TIGER 2차전지테마"},
        {"ticker": "381180", "name": "KBSTAR 2차전지&미래차"},
    ],
    "바이오": [
        {"ticker": "244580", "name": "KODEX 바이오"},
        {"ticker": "143850", "name": "TIGER 헬스케어"},
        {"ticker": "227550", "name": "KBSTAR 헬스케어"},
        {"ticker": "266410", "name": "KODEX 바이오플러스헬스케어"},
    ],
    "인터넷/IT": [
        {"ticker": "139260", "name": "KODEX 인터넷"},
        {"ticker": "157490", "name": "TIGER 소프트웨어"},
        {"ticker": "364990", "name": "KODEX K-IT"},
    ],
    "자동차": [
        {"ticker": "091180", "name": "KODEX 자동차"},
        {"ticker": "140710", "name": "TIGER 자동차"},
    ],
    "금융": [
        {"ticker": "139270", "name": "KODEX 은행"},
        {"ticker": "091220", "name": "TIGER 은행"},
        {"ticker": "139290", "name": "KODEX 증권"},
    ],
    "에너지": [
        {"ticker": "117460", "name": "KODEX 에너지화학"},
        {"ticker": "140700", "name": "TIGER 에너지화학"},
    ],
    "건설": [
        {"ticker": "139220", "name": "KODEX 건설"},
        {"ticker": "140720", "name": "TIGER 건설기계"},
    ],
    "철강/소재": [
        {"ticker": "139230", "name": "KODEX 철강"},
        {"ticker": "140690", "name": "TIGER 화학"},
    ],
    "AI/로봇": [
        {"ticker": "364980", "name": "KODEX K-로봇액티브"},
        {"ticker": "445090", "name": "TIGER AI코리아그로스액티브"},
        {"ticker": "453810", "name": "TIGER AI반도체핵심공정"},
    ],
}

_SORT_FIELDS = {
    "1d": "change_1d",
    "1w": "change_1w",
    "1m": "change_1m",
    "3m": "change_3m",
    "ytd": "change_ytd",
}

# sector → (timestamp, data)
_etf_cache: dict[str, tuple[float, list[dict]]] = {}
_ETF_CACHE_TTL = 300  # 5분


def _calc_return(prices: list[float], window: int) -> float | None:
    if len(prices) < window + 1:
        return None
    end = prices[-1]
    start = prices[-(window + 1)]
    return round((end - start) / start * 100, 2) if start else None


def _fetch_sector_performance_sync() -> list[dict]:
    import FinanceDataReader as fdr
    from datetime import datetime, timedelta

    end = datetime.now()
    start = end - timedelta(days=400)  # ytd 계산용
    results = []

    year_start = datetime(end.year, 1, 1).strftime("%Y-%m-%d")

    for s in SECTOR_ETFS:
        try:
            df = fdr.DataReader(s["ticker"], start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
            if df.empty or len(df) < 2:
                continue
            prices = df["Close"].astype(float).tolist()
            dates  = [d.strftime("%Y-%m-%d") for d in df.index]
            current_price = prices[-1]

            # YTD 계산
            df_ytd = df[df.index >= year_start]
            ytd_start = float(df_ytd["Close"].iloc[0]) if not df_ytd.empty else prices[0]
            ytd_return = (current_price - ytd_start) / ytd_start * 100 if ytd_start else 0

            results.append({
                "sector":    s["sector"],
                "ticker":    s["ticker"],
                "name":      s["name"],
                "price":     round(current_price, 0),
                "change_1d": _calc_return(prices, 1) or 0.0,
                "change_1w": _calc_return(prices, 5) or 0.0,
                "change_1m": _calc_return(prices, 20) or 0.0,
                "change_3m": _calc_return(prices, 60) or 0.0,
                "change_ytd": round(ytd_return, 2),
                "series": [{"date": d, "value": p} for d, p in zip(dates[-60:], prices[-60:])],
            })
        except Exception as e:
            logger.warning(f"sector [{s['ticker']}] error: {e}")

    return sorted(results, key=lambda x: x["change_1m"], reverse=True)


def _fetch_sector_etfs_sync(sector: str, sort_by: str = "1m") -> list[dict]:
    import FinanceDataReader as fdr

    now_ts = time.time()
    if sector in _etf_cache:
        ts, cached = _etf_cache[sector]
        if now_ts - ts < _ETF_CACHE_TTL:
            field = _SORT_FIELDS.get(sort_by, "change_1m")
            return sorted(cached, key=lambda x: x.get(field, 0), reverse=True)

    etf_list = SECTOR_ETF_MAP.get(sector, [])
    end = datetime.now()
    start = end - timedelta(days=400)
    year_start = datetime(end.year, 1, 1).strftime("%Y-%m-%d")
    results = []

    for etf in etf_list:
        try:
            df = fdr.DataReader(etf["ticker"], start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
            if df.empty or len(df) < 2:
                continue
            prices = df["Close"].astype(float).tolist()
            current_price = prices[-1]

            df_ytd = df[df.index >= year_start]
            ytd_start = float(df_ytd["Close"].iloc[0]) if not df_ytd.empty else prices[0]
            ytd_return = (current_price - ytd_start) / ytd_start * 100 if ytd_start else 0

            results.append({
                "ticker":     etf["ticker"],
                "name":       etf["name"],
                "price":      round(current_price, 0),
                "change_1d":  _calc_return(prices, 1) or 0.0,
                "change_1w":  _calc_return(prices, 5) or 0.0,
                "change_1m":  _calc_return(prices, 20) or 0.0,
                "change_3m":  _calc_return(prices, 60) or 0.0,
                "change_ytd": round(ytd_return, 2),
            })
        except Exception as e:
            logger.warning(f"ETF [{etf['ticker']}] fetch error: {e}")

    _etf_cache[sector] = (now_ts, results)
    field = _SORT_FIELDS.get(sort_by, "change_1m")
    return sorted(results, key=lambda x: x.get(field, 0), reverse=True)


def _get_rotation_analysis(sectors: list[dict]) -> dict:
    if not sectors:
        return {"leading": [], "lagging": [], "theme": "데이터 없음"}

    sorted_1m = sorted(sectors, key=lambda x: x["change_1m"], reverse=True)
    leading   = [s["sector"] for s in sorted_1m[:3]]
    lagging   = [s["sector"] for s in sorted_1m[-3:]]

    # 테마 분석
    top_sectors = set(leading)
    if "반도체" in top_sectors or "AI/로봇" in top_sectors:
        theme = "기술 성장주 주도장 - AI/반도체 사이클 상승 국면"
    elif "바이오" in top_sectors:
        theme = "헬스케어/바이오 주도장 - 방어주 선호 구간"
    elif "금융" in top_sectors or "건설" in top_sectors:
        theme = "경기민감/가치주 주도장 - 금리 환경 개선 기대"
    elif "2차전지" in top_sectors or "에너지" in top_sectors:
        theme = "친환경/에너지 전환 주도장"
    else:
        theme = f"{', '.join(leading[:2])} 주도 순환매 진행 중"

    return {"leading": leading, "lagging": lagging, "theme": theme}


class SectorService:
    @staticmethod
    async def get_performance() -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _fetch_sector_performance_sync)

    @staticmethod
    async def get_sector_etfs(sector: str, sort_by: str = "1m") -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _fetch_sector_etfs_sync, sector, sort_by)

    @staticmethod
    async def get_rotation() -> dict:
        sectors = await SectorService.get_performance()
        analysis = _get_rotation_analysis(sectors)
        return {
            "date": datetime.now().strftime("%Y-%m-%d"),
            "sectors": sectors,
            **analysis,
        }


sector_service = SectorService()
