"""
・ｹ奓ｰ ・・・ ・・・懦・・ｴ・・・罹ｹ・侃.
KODEX ETF ・・ｩ ・ｰ・ｴ奓ｰ ・ｰ・們愍・・・ｹ奓ｰ ・ｱ・ｼ ・肥・
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# KODEX/TIGER ETF ・ｰ・・・ｹ奓ｰ ・､﨑・(・ｹ奓ｰ ・岺・ETF)
SECTOR_ETFS = [
    {"sector": "・俯巡・ｴ",      "ticker": "091160", "name": "KODEX ・俯巡・ｴ"},
    {"sector": "2・ｨ・・ｧ",     "ticker": "305720", "name": "KODEX 2・ｨ・・ｧ・ｰ・・},
    {"sector": "・肥擽・､",      "ticker": "244580", "name": "KODEX ・肥擽・､"},
    {"sector": "・ｸ奓ｰ・ｷ/IT",   "ticker": "139260", "name": "KODEX ・ｸ奓ｰ・ｷ"},
    {"sector": "・尖徐・ｨ",      "ticker": "091180", "name": "KODEX ・尖徐・ｨ"},
    {"sector": "・溢愀",        "ticker": "139270", "name": "KODEX ・嵂・},
    {"sector": "・尖ц・",      "ticker": "117460", "name": "KODEX ・尖ц・嶹被蕗"},
    {"sector": "・ｴ・､",        "ticker": "139220", "name": "KODEX ・ｴ・､"},
    {"sector": "・・・・護椪",   "ticker": "139230", "name": "KODEX ・・・},
    {"sector": "AI/・罹ｴ・,     "ticker": "364980", "name": "KODEX K-・罹ｴ・複寀ｰ・・},
]


# ・ｹ奓ｰ・・・・ｨ ETF ・ｩ・・(ETF ・ｭ墲ｹ ・ｰ・･・ｩ)
SECTOR_ETF_MAP: dict[str, list[dict]] = {
    "・俯巡・ｴ": [
        {"ticker": "091160", "name": "KODEX ・俯巡・ｴ"},
        {"ticker": "091230", "name": "TIGER ・俯巡・ｴ"},
        {"ticker": "091170", "name": "KBSTAR ・俯巡・ｴ"},
        {"ticker": "396510", "name": "SOL ・俯巡・ｴ・誤ｶ・･"},
    ],
    "2・ｨ・・ｧ": [
        {"ticker": "305720", "name": "KODEX 2・ｨ・・ｧ・ｰ・・},
        {"ticker": "305540", "name": "TIGER 2・ｨ・・ｧ奛誤ｧ・},
        {"ticker": "381180", "name": "KBSTAR 2・ｨ・・ｧ&・ｸ・們ｰｨ"},
    ],
    "・肥擽・､": [
        {"ticker": "244580", "name": "KODEX ・肥擽・､"},
        {"ticker": "143850", "name": "TIGER 嵭ｬ・､・・ｴ"},
        {"ticker": "227550", "name": "KBSTAR 嵭ｬ・､・・ｴ"},
        {"ticker": "266410", "name": "KODEX ・肥擽・､嵓誤洳・､嵭ｬ・､・・ｴ"},
    ],
    "・ｸ奓ｰ・ｷ/IT": [
        {"ticker": "139260", "name": "KODEX ・ｸ奓ｰ・ｷ"},
        {"ticker": "157490", "name": "TIGER ・醐売孖ｸ・ｨ・ｴ"},
        {"ticker": "381175", "name": "KBSTAR IT嵓誤洳・､"},
        {"ticker": "371460", "name": "TIGER KRX IT"},
    ],
    "・尖徐・ｨ": [
        {"ticker": "091180", "name": "KODEX ・尖徐・ｨ"},
        {"ticker": "140710", "name": "TIGER ・尖徐・ｨ"},
    ],
    "・溢愀": [
        {"ticker": "139270", "name": "KODEX ・嵂・},
        {"ticker": "091220", "name": "TIGER ・嵂・},
        {"ticker": "139290", "name": "KODEX ・晝ｶ・},
    ],
    "・尖ц・": [
        {"ticker": "117460", "name": "KODEX ・尖ц・嶹被蕗"},
        {"ticker": "140700", "name": "TIGER ・尖ц・嶹被蕗"},
    ],
    "・ｴ・､": [
        {"ticker": "139220", "name": "KODEX ・ｴ・､"},
        {"ticker": "140720", "name": "TIGER ・ｴ・､・ｰ・・},
    ],
    "・・・・護椪": [
        {"ticker": "139230", "name": "KODEX ・・・},
        {"ticker": "140690", "name": "TIGER 嶹被蕗"},
    ],
    "AI/・罹ｴ・: [
        {"ticker": "364980", "name": "KODEX K-・罹ｴ・複寀ｰ・・},
        {"ticker": "462870", "name": "KODEX AI・俯巡・ｴ﨑ｵ・ｬ・･・・},
        {"ticker": "445090", "name": "TIGER AI・罷ｦｬ・・ｷｸ・懍侃・｡寀ｰ・・},
        {"ticker": "411600", "name": "TIGER ・・罹ｲ窟I&・罹ｴ・},
    ],
}

_SORT_FIELDS = {
    "1d": "change_1d",
    "1w": "change_1w",
    "1m": "change_1m",
    "3m": "change_3m",
    "ytd": "change_ytd",
}

# sector 竊・(timestamp, data)
_etf_cache: dict[str, tuple[float, list[dict]]] = {}
_ETF_CACHE_TTL = 300  # 5・・

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
    start = end - timedelta(days=400)  # ytd ・・げ・ｩ
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

            # YTD ・・げ
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
            logger.info(f"ETF [{etf['ticker']} {etf['name']}] ・､墲ｵ (・ｰ・ｴ奓ｰ ・・搆 ・尖株 ・ｸ・・棗): {e}")

    if not results:
        logger.warning(f"・ｹ奓ｰ [{sector}] ETF ・・ｲｴ ・罹畠 ・､甯ｨ 窶・寀ｰ・､ ・ｩ・・ {[e['ticker'] for e in etf_list]}")

    _etf_cache[sector] = (now_ts, results)
    field = _SORT_FIELDS.get(sort_by, "change_1m")
    return sorted(results, key=lambda x: x.get(field, 0), reverse=True)


def _get_rotation_analysis(sectors: list[dict]) -> dict:
    if not sectors:
        return {"leading": [], "lagging": [], "theme": "・ｰ・ｴ奓ｰ ・・搆"}

    sorted_1m = sorted(sectors, key=lambda x: x["change_1m"], reverse=True)
    leading   = [s["sector"] for s in sorted_1m[:3]]
    lagging   = [s["sector"] for s in sorted_1m[-3:]]

    # 奛誤ｧ・・・・
    top_sectors = set(leading)
    if "・俯巡・ｴ" in top_sectors or "AI/・罹ｴ・ in top_sectors:
        theme = "・ｰ・ ・ｱ・･・ｼ ・ｼ・・棗 - AI/・俯巡・ｴ ・ｬ・ｴ增ｴ ・・柑 ・ｭ・ｴ"
    elif "・肥擽・､" in top_sectors:
        theme = "嵭ｬ・､・・ｴ/・肥擽・､ ・ｼ・・棗 - ・ｩ・ｴ・ｼ ・嶸ｸ ・ｬ・・
    elif "・溢愀" in top_sectors or "・ｴ・､" in top_sectors:
        theme = "・ｽ・ｰ・ｼ・・・・們｣ｼ ・ｼ・・棗 - ・壱ｦｬ 嶹俾ｲｽ ・懍│ ・ｰ・"
    elif "2・ｨ・・ｧ" in top_sectors or "・尖ц・" in top_sectors:
        theme = "・懦劍・ｽ/・尖ц・ ・・劍 ・ｼ・・棗"
    else:
        theme = f"{', '.join(leading[:2])} ・ｼ・・・懦劍・､ ・・哩 ・・

    return {"leading": leading, "lagging": lagging, "theme": theme}


class SectorService:
    @staticmethod
    async def get_performance() -> list[dict]:
        from app.executor import get_executor, sector_cache, TTL_SECTOR
        hit, cached = sector_cache.get("performance")
        if hit:
            return cached
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(get_executor(), _fetch_sector_performance_sync)
        if data:
            sector_cache.set("performance", data, TTL_SECTOR)
        return data

    @staticmethod
    async def get_sector_etfs(sector: str, sort_by: str = "1m") -> list[dict]:
        from app.executor import get_executor
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(get_executor(), _fetch_sector_etfs_sync, sector, sort_by)

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
