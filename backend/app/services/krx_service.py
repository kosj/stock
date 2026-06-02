"""
・ｭ・ｴ・晧亨 奝ｵ・・・罹ｹ・侃.
- 妤ｬ・川梵・・・､・､・呰箕: ・､・ｴ・・・溢愀 investorDealTrendTime.naver (・懋ｰ・ｳ・・罹ｧ､・・・､增ｬ・倆舞)
- ・・｢・ｳ・・們攘・:    sector_service.SectorService.get_performance() ・ｬ・ｬ・ｩ
- ・ｵ・､・・嶸・勦:      ・､・ｴ・・・溢愀 quoteSummary.naver 甯護・ ・ｰ・ｴ奓ｰ
- ・専ｸ逸攝・・・肥平:    妤ｬ・川梵 ・ｰ・ｴ奓ｰ ・・ｵ

・ｰ・ｴ奓ｰ ・ｨ・・ Naver ・尖ｳｸ = ・ｵ・・ ・罹ｹ・侃 ・倆劍 = ・・(ﾃ・1・ｵ ・嶹・
"""
from __future__ import annotations

import io
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 1800  # 30・・_EXECUTOR = ThreadPoolExecutor(max_workers=4)

NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/sise/",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

# ・ｵ・・竊・・・・嶹・・ｰ・・_EOK = 100_000_000

_INVESTOR_ORDER = [
    "・溢愀妤ｬ・・, "・ｴ嵭・, "妤ｬ・", "・嵂・, "・ｰ夋・溢愀", "・ｰ・ｰ・壱導",
    "・ｰ・・・, "・ｸ・ｭ・ｸ", "・懍攤", "・ｰ夋・菩攤",
]

# Naver ・ｬ・ｼ・・竊・岺懍亨 ・ｴ・・・､﨑・_COL_MAP = {
    "・懍攤": "・懍攤",
    "・ｸ・ｭ・ｸ": "・ｸ・ｭ・ｸ",
    "・ｰ・・・: "・ｰ・・・,
    "・溢愀妤ｬ・・: "・溢愀妤ｬ・・,
    "・ｴ嵭・: "・ｴ嵭・,
    "妤ｬ・(・ｬ・ｨ)": "妤ｬ・",
    "妤ｬ・ (・ｬ・ｨ)": "妤ｬ・",
    "・嵂・: "・嵂・,
    "・ｰ夋・溢愀・ｰ・": "・ｰ夋・溢愀",
    "・ｰ夋・溢愀": "・ｰ夋・溢愀",
    "・ｰ・ｰ・壱導": "・ｰ・ｰ・壱導",
    "・ｰ夋・菩攤": "・ｰ夋・菩攤",
}


def _last_trading_day() -> str:
    """・､弡・4・・・ｴ・・擽・ｴ ・・あ, ・ｼ・川捩 ・溢囈・ｼ ・ｰ・."""
    d = datetime.now()
    if d.hour < 16:
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


# 笏笏 妤ｬ・川梵・・・､・､・呰箕 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

def _fetch_investor_sync(bizdate: str, sosok: str) -> list[dict]:
    """
    ・､・ｴ・・・溢愀 妤ｬ・川梵・・・懋ｰ・ｳ・・罹ｧ､・・・､增ｬ・倆舞.
    sosok: "" ・尖株 "01" = KOSPI, "02" = KOSDAQ
    ・倆劍: [{name, buy, sell, net}] net ・ｨ・・= ・・    """
    import requests
    import pandas as pd

    url = (
        "https://finance.naver.com/sise/investorDealTrendTime.naver"
        f"?bizdate={bizdate}&sosok={sosok}"
    )
    try:
        resp = requests.get(url, headers=NAVER_HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = "euc-kr"

        tables = pd.read_html(io.StringIO(resp.text), flavor="lxml")
        if not tables:
            return []

        df = tables[0]

        # MultiIndex ・ｬ・ｼ ・俯ｦｬ 窶・・溢ｧ・・・壱ｲｨ ・ｴ・・・ｬ・ｩ
        if isinstance(df.columns, pd.MultiIndex):
            flat_cols = [str(col[-1]).strip() for col in df.columns]
        else:
            flat_cols = [str(c).strip() for c in df.columns]

        # ・ｫ ・溢ｧｸ NaN 嵂・・懋ｱｰ, ・巐ｨ ・ｰ・ｴ奓ｰ ・ｫ ・溢ｧｸ 嵂・・ｬ・ｩ (・懍侠 ・懋ｰ・
        df.columns = flat_cols
        df = df.dropna(subset=["・懋ｰ・]) if "・懋ｰ・ in flat_cols else df.dropna()
        if df.empty:
            return []

        latest = df.iloc[0]
        result = []
        for col_raw, col_mapped in _COL_MAP.items():
            for actual_col in flat_cols:
                if actual_col.replace(" ", "") == col_raw.replace(" ", ""):
                    val = latest.get(actual_col, None)
                    if val is None:
                        continue
                    try:
                        net_eok = float(str(val).replace(",", "").strip())
                    except (ValueError, TypeError):
                        continue
                    net = int(net_eok * _EOK)
                    result.append({
                        "name": col_mapped,
                        "buy":  max(0, net),
                        "sell": max(0, -net),
                        "net":  net,
                    })
                    break

        # ・倣紛・・・懍・・・・簿ｬ
        order_map = {n: i for i, n in enumerate(_INVESTOR_ORDER)}
        result.sort(key=lambda x: order_map.get(x["name"], 99))
        # ・瀧ｳｵ ・懋ｱｰ
        seen: set[str] = set()
        unique = []
        for r in result:
            if r["name"] not in seen:
                seen.add(r["name"])
                unique.append(r)
        return unique

    except Exception as e:
        logger.error("・､・ｴ・・妤ｬ・川梵 ・､增ｬ・倆舞 ・､甯ｨ sosok=%s: %s", sosok, e)
        return []


async def get_investor_trends() -> dict:
    """KOSPI / KOSDAQ 妤ｬ・川梵・・・､・､・呰箕 (・懋ｰ・ｳ・・罹ｧ､・・・懍侠 ・・."""
    import asyncio

    trd_dd = _last_trading_day()
    cache_key = f"investor_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    loop = asyncio.get_running_loop()
    kospi_rows, kosdaq_rows = await asyncio.gather(
        loop.run_in_executor(_EXECUTOR, _fetch_investor_sync, trd_dd, "01"),
        loop.run_in_executor(_EXECUTOR, _fetch_investor_sync, trd_dd, "02"),
    )

    data: dict = {
        "date":   trd_dd,
        "kospi":  kospi_rows,
        "kosdaq": kosdaq_rows,
    }
    _CACHE[cache_key] = (time.monotonic(), data)
    return data


# 笏笏 ・・｢・ｳ・・們攘・ (KODEX ETF ・ｰ・・ 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

async def get_sector_index() -> dict:
    """KODEX ETF ・ｰ・・・・｢・ｳ・・們攘・. sector_service ・ｬ・ｬ・ｩ."""
    from app.services.sector_service import SectorService

    trd_dd = _last_trading_day()
    cache_key = f"sector_idx_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    sectors = await SectorService.get_performance()

    # KRX ・ｹ奓ｰ ・・・尞ｬ・ｷ・・・樓ｲ・・嶹・    kospi_data = []
    for s in sectors:
        price = s.get("price", 0) or 0
        c1d   = s.get("change_1d", 0) or 0
        kospi_data.append({
            "name":       s.get("sector", s.get("name", "")),
            "index":      price,
            "change":     round(price * c1d / 100, 0),
            "change_pct": c1d,
            "change_1d":  c1d,
            "change_1w":  s.get("change_1w", 0) or 0,
            "change_1m":  s.get("change_1m", 0) or 0,
            "change_3m":  s.get("change_3m", 0) or 0,
            "change_ytd": s.get("change_ytd", 0) or 0,
            "volume":     0,
            "value":      0,
            "market_cap": 0,
        })

    data: dict = {
        "date":    trd_dd,
        "kospi":   sorted(kospi_data, key=lambda x: x["change_pct"], reverse=True),
        "kosdaq":  [],
    }
    _CACHE[cache_key] = (time.monotonic(), data)
    return data


# 笏笏 ・ｵ・､・・嶸・勦 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

def _fetch_short_selling_sync(bizdate: str) -> dict:
    """
    ・､・ｴ・・・溢愀 quoteSummary.naver・川・ ・､・懋ｰ・・懍棗 ・ｰ・ｴ奓ｰ 甯護恭.
    ・ｵ・､・・・・┷ API・・・・ｳｵ・懍擽・・・sise_deal_rank.naver・川・ ・・ｴ.
    """
    import requests
    import pandas as pd

    result: dict = {
        "by_market":  [],
        "top_kospi":  [],
        "top_kosdaq": [],
    }

    try:
        # ・ｵ・､・・・・怱 ・・ｪｩ (KOSPI)
        r = requests.get(
            "https://finance.naver.com/sise/sise_deal_rank.naver?investor_gubun=2000",
            headers=NAVER_HEADERS, timeout=12,
        )
        r.encoding = "euc-kr"
        tables = pd.read_html(io.StringIO(r.text), flavor="lxml")
        if tables:
            df = tables[0]
            stocks = []
            for _, row in df.iterrows():
                vals = [str(v).strip() for v in row.values]
                name = vals[0] if vals else ""
                if not name or name in ("nan", "・・ｪｩ・・):
                    continue
                try:
                    price = int(vals[1].replace(",", "")) if len(vals) > 1 and vals[1] != "nan" else 0
                except Exception:
                    price = 0
                stocks.append({
                    "ticker": "",
                    "name": name,
                    "short_vol": 0,
                    "short_val": price,
                    "ratio": 0.0,
                })
            result["top_kospi"] = stocks[:15]
    except Exception as e:
        logger.warning("・ｵ・､・・KOSPI ・罹畠 ・､甯ｨ: %s", e)

    try:
        # ・ｵ・､・・・・怱 ・・ｪｩ (KOSDAQ)
        r2 = requests.get(
            "https://finance.naver.com/sise/sise_deal_rank.naver?investor_gubun=2000&sosok=02",
            headers=NAVER_HEADERS, timeout=12,
        )
        r2.encoding = "euc-kr"
        tables2 = pd.read_html(io.StringIO(r2.text), flavor="lxml")
        if tables2:
            df2 = tables2[0]
            stocks2 = []
            for _, row in df2.iterrows():
                vals = [str(v).strip() for v in row.values]
                name = vals[0] if vals else ""
                if not name or name in ("nan", "・・ｪｩ・・):
                    continue
                try:
                    price = int(vals[1].replace(",", "")) if len(vals) > 1 and vals[1] != "nan" else 0
                except Exception:
                    price = 0
                stocks2.append({
                    "ticker": "",
                    "name": name,
                    "short_vol": 0,
                    "short_val": price,
                    "ratio": 0.0,
                })
            result["top_kosdaq"] = stocks2[:15]
    except Exception as e:
        logger.warning("・ｵ・､・・KOSDAQ ・罹畠 ・､甯ｨ: %s", e)

    return result


async def get_short_selling() -> dict:
    """・ｵ・､・・嶸・勦 (・､・ｴ・・・溢愀 ・・・・ｰ・ｴ奓ｰ)."""
    import asyncio

    trd_dd = _last_trading_day()
    cache_key = f"short_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    loop = asyncio.get_running_loop()
    short_data = await loop.run_in_executor(_EXECUTOR, _fetch_short_selling_sync, trd_dd)

    data: dict = {
        "date":       trd_dd,
        "by_market":  [],
        "top_kospi":  short_data.get("top_kospi", []),
        "top_kosdaq": short_data.get("top_kosdaq", []),
    }
    _CACHE[cache_key] = (time.monotonic(), data)
    return data


# 笏笏 ・専ｸ・彧尖ｦ・・肥平 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

def _money_flow_summary(investor_data: dict) -> dict:
    def extract(rows: list[dict], names: list[str]) -> int:
        for r in rows:
            if r["name"] in names:
                return r["net"]
        return 0

    kospi  = investor_data.get("kospi", [])
    kosdaq = investor_data.get("kosdaq", [])

    categories = [
        ("・ｸ・ｭ・ｸ",   ["・ｸ・ｭ・ｸ"]),
        ("・ｰ・",     ["・ｰ・・・]),
        ("・懍攤",     ["・懍攤"]),
        ("・ｰ夋・菩攤", ["・ｰ夋・菩攤"]),
    ]

    flows = []
    for label, names in categories:
        kp = extract(kospi,  names)
        kq = extract(kosdaq, names)
        flows.append({
            "investor":   label,
            "kospi_net":  kp,
            "kosdaq_net": kq,
            "total_net":  kp + kq,
        })
    return {"flows": flows}


# 笏笏 ・・罹ｳｴ・・笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

async def get_dashboard() -> dict:
    """・・ｲｴ ・・罹ｳｴ・・・ｰ・ｴ奓ｰ ・瀧ｬ ・ｰ巐・"""
    import asyncio

    investor, sector, short = await asyncio.gather(
        get_investor_trends(),
        get_sector_index(),
        get_short_selling(),
        return_exceptions=True,
    )

    def safe(r, default):
        if isinstance(r, Exception):
            logger.error("KRX dashboard gather error: %s", r)
            return default
        return r

    inv = safe(investor, {"date": "", "kospi": [], "kosdaq": []})
    sec = safe(sector,   {"date": "", "kospi": [], "kosdaq": []})
    sht = safe(short,    {"date": "", "by_market": [], "top_kospi": [], "top_kosdaq": []})

    return {
        "date":          inv.get("date", ""),
        "money_flow":    _money_flow_summary(inv),
        "investor":      inv,
        "sector_index":  sec,
        "short_selling": sht,
    }


# 笏笏 ・罷ｲ・ｷｸ 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

async def get_raw(bld: str, extra: dict | None = None) -> dict:
    """・罷ｲ・ｷｸ・ｩ: ・､・ｴ・・妤ｬ・川梵 ・ｰ・ｴ奓ｰ ・川亨 ・倆劍."""
    import asyncio

    trd_dd = extra.get("trdDd", _last_trading_day()) if extra else _last_trading_day()
    loop = asyncio.get_running_loop()
    rows = await loop.run_in_executor(_EXECUTOR, _fetch_investor_sync, trd_dd, "01")
    return {"date": trd_dd, "source": "naver_investorDealTrendTime", "rows": rows}
