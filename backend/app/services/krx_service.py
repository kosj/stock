"""
KRX(한국거래소) 정보데이터시스템 서비스.
투자자별 매매동향, 업종별 지수, 공매도 현황 데이터 제공.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

KRX_URL = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
KRX_HEADERS = {
    "Referer": "http://data.krx.co.kr/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
}

# TTL 캐시: key → (timestamp, data)
_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 1800  # 30분


def _cached(key: str, ttl: int = _CACHE_TTL):
    """캐시 데코레이터 팩토리 (동기/비동기 공통)."""
    def decorator(fn):
        import functools, asyncio
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            now = time.monotonic()
            if key in _CACHE:
                ts, val = _CACHE[key]
                if now - ts < ttl:
                    return val
            val = await fn(*args, **kwargs)
            _CACHE[key] = (now, val)
            return val
        return wrapper
    return decorator


def _last_trading_day(offset: int = 0) -> str:
    """
    최근 거래일을 YYYYMMDD 형식으로 반환.
    오후 4시 이전이면 전날 기준, 주말은 금요일로 내려감.
    offset: 추가 일수 소급 (multi-day 시계열용)
    """
    d = datetime.now()
    if d.hour < 16:
        d -= timedelta(days=1)
    d -= timedelta(days=offset)
    while d.weekday() >= 5:  # 토(5), 일(6) 스킵
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


async def _post(bld: str, extra: dict | None = None, timeout: float = 20.0) -> dict:
    """KRX API POST 요청."""
    params = {"bld": bld, **(extra or {})}
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(KRX_URL, data=params, headers=KRX_HEADERS)
        resp.raise_for_status()
        return resp.json()


def _int(v) -> int:
    try:
        return int(str(v).replace(",", ""))
    except Exception:
        return 0


def _float(v) -> float:
    try:
        return float(str(v).replace(",", ""))
    except Exception:
        return 0.0


# ── 투자자별 매매동향 ────────────────────────────────────────────────────────

def _parse_investor(rows: list[dict]) -> list[dict]:
    """
    KRX 투자자별 거래실적 응답 파싱.
    ASK = 매도, BID = 매수 (KRX 컨벤션)
    """
    result = []
    for r in rows:
        name = r.get("INVST_TP_NM", r.get("ISU_MKT_NM", ""))
        if not name:
            continue
        buy  = _int(r.get("BID_TRDVAL", r.get("MKTCAP", 0)))
        sell = _int(r.get("ASK_TRDVAL", 0))
        net  = _int(r.get("NETBID_TRDVAL", buy - sell))
        result.append({"name": name, "buy": buy, "sell": sell, "net": net})
    return result


async def get_investor_trends() -> dict:
    """KOSPI / KOSDAQ 투자자별 매매동향 (당일 기준)."""
    trd_dd = _last_trading_day()
    cache_key = f"investor_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    import asyncio
    results = await asyncio.gather(
        _post("dbms/MDC/STAT/standard/MDCSTAT02301", {"trdDd": trd_dd, "mktId": "STK"}),
        _post("dbms/MDC/STAT/standard/MDCSTAT02303", {"trdDd": trd_dd, "mktId": "KSQ"}),
        return_exceptions=True,
    )

    def safe_output(r) -> list:
        if isinstance(r, Exception):
            logger.warning(f"KRX investor error: {r}")
            return []
        return r.get("output", [])

    data = {
        "date": trd_dd,
        "kospi": _parse_investor(safe_output(results[0])),
        "kosdaq": _parse_investor(safe_output(results[1])),
    }
    _CACHE[cache_key] = (time.monotonic(), data)
    return data


# ── 업종별 지수 ──────────────────────────────────────────────────────────────

def _parse_sector_index(rows: list[dict]) -> list[dict]:
    result = []
    for r in rows:
        name = r.get("IDX_IND_NM", r.get("IDX_NM", ""))
        if not name or name in ("전체",):
            continue
        result.append({
            "name":       name,
            "index":      _float(r.get("CLSPRC_IDX", r.get("PRCINDEX", 0))),
            "change":     _float(r.get("PRV_DD_CMPR", r.get("CMPR", 0))),
            "change_pct": _float(r.get("FLUC_RT", r.get("FLUCRT", 0))),
            "volume":     _int(r.get("ACC_TRDVOL", 0)),
            "value":      _int(r.get("ACC_TRDVAL", 0)),
            "market_cap": _int(r.get("MKTCAP", 0)),
        })
    return result


async def get_sector_index() -> dict:
    """KOSPI / KOSDAQ 업종별 지수."""
    trd_dd = _last_trading_day()
    cache_key = f"sector_idx_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    import asyncio
    results = await asyncio.gather(
        _post("dbms/MDC/STAT/standard/MDCSTAT02501", {"trdDd": trd_dd, "idxIndMidclssCd": "01"}),
        _post("dbms/MDC/STAT/standard/MDCSTAT02503", {"trdDd": trd_dd, "idxIndMidclssCd": "01"}),
        return_exceptions=True,
    )

    def safe_output(r) -> list:
        if isinstance(r, Exception):
            logger.warning(f"KRX sector index error: {r}")
            return []
        return r.get("output", [])

    data = {
        "date": trd_dd,
        "kospi":  _parse_sector_index(safe_output(results[0])),
        "kosdaq": _parse_sector_index(safe_output(results[1])),
    }
    _CACHE[cache_key] = (time.monotonic(), data)
    return data


# ── 공매도 현황 ──────────────────────────────────────────────────────────────

def _parse_short_market(rows: list[dict]) -> list[dict]:
    result = []
    for r in rows:
        mkt = r.get("MKT_NM", r.get("MKTID", ""))
        if not mkt:
            continue
        short_val  = _int(r.get("SLB_TRDVAL",   r.get("SLB_TRDVAL2", 0)))
        total_val  = _int(r.get("TRDVAL",        r.get("ACC_TRDVAL",  0)))
        short_vol  = _int(r.get("SLB_TRDVOL",   0))
        total_vol  = _int(r.get("TRDVOL",        r.get("ACC_TRDVOL",  0)))
        ratio      = _float(r.get("SLB_RTSN",    r.get("SLB_RTSN2",   0)))
        result.append({
            "market":    mkt,
            "short_val": short_val,
            "total_val": total_val,
            "short_vol": short_vol,
            "total_vol": total_vol,
            "ratio":     ratio,
        })
    return result


def _parse_short_stocks(rows: list[dict]) -> list[dict]:
    result = []
    for r in rows:
        name = r.get("ISU_ABBRV", r.get("ISU_NM", ""))
        if not name:
            continue
        result.append({
            "ticker":    r.get("ISU_SRT_CD", r.get("ISU_CD", "")),
            "name":      name,
            "short_vol": _int(r.get("SLB_TRDVOL", 0)),
            "short_val": _int(r.get("SLB_TRDVAL", 0)),
            "ratio":     _float(r.get("SLB_RTSN",  0)),
        })
    # 공매도 비중 내림차순
    return sorted(result, key=lambda x: x["ratio"], reverse=True)[:20]


async def get_short_selling() -> dict:
    """공매도 시장별 현황 + 상위 종목."""
    trd_dd = _last_trading_day()
    cache_key = f"short_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    import asyncio
    results = await asyncio.gather(
        _post("dbms/MDC/STAT/standard/MDCSTAT01601", {"trdDd": trd_dd}),
        _post("dbms/MDC/STAT/standard/MDCSTAT01602", {
            "trdDd": trd_dd, "mktId": "STK", "isuCd": "", "strtDd": trd_dd, "endDd": trd_dd,
        }),
        _post("dbms/MDC/STAT/standard/MDCSTAT01602", {
            "trdDd": trd_dd, "mktId": "KSQ", "isuCd": "", "strtDd": trd_dd, "endDd": trd_dd,
        }),
        return_exceptions=True,
    )

    def safe_output(r) -> list:
        if isinstance(r, Exception):
            logger.warning(f"KRX short selling error: {r}")
            return []
        return r.get("output", [])

    data = {
        "date":           trd_dd,
        "by_market":      _parse_short_market(safe_output(results[0])),
        "top_kospi":      _parse_short_stocks(safe_output(results[1])),
        "top_kosdaq":     _parse_short_stocks(safe_output(results[2])),
    }
    _CACHE[cache_key] = (time.monotonic(), data)
    return data


# ── 시장 자금 흐름 요약 ──────────────────────────────────────────────────────

def _money_flow_summary(investor_data: dict) -> dict:
    """투자자별 데이터에서 외국인/기관/개인 자금 흐름 요약 추출."""
    def extract(rows: list[dict], names: list[str]) -> int:
        for r in rows:
            if r["name"] in names:
                return r["net"]
        return 0

    kospi  = investor_data.get("kospi", [])
    kosdaq = investor_data.get("kosdaq", [])

    categories = [
        ("외국인",  ["외국인", "외국인계"]),
        ("기관",    ["기관계"]),
        ("개인",    ["개인"]),
        ("기타법인", ["기타법인"]),
    ]

    flows = []
    for label, names in categories:
        kp = extract(kospi,  names)
        kq = extract(kosdaq, names)
        flows.append({
            "investor": label,
            "kospi_net":  kp,
            "kosdaq_net": kq,
            "total_net":  kp + kq,
        })
    return {"flows": flows}


async def get_dashboard() -> dict:
    """전체 대시보드 데이터 병렬 조회."""
    import asyncio
    investor, sector, short = await asyncio.gather(
        get_investor_trends(),
        get_sector_index(),
        get_short_selling(),
        return_exceptions=True,
    )

    def safe(r, default):
        return r if not isinstance(r, Exception) else default

    inv   = safe(investor, {"date": "", "kospi": [], "kosdaq": []})
    sec   = safe(sector,   {"date": "", "kospi": [], "kosdaq": []})
    sht   = safe(short,    {"date": "", "by_market": [], "top_kospi": [], "top_kosdaq": []})
    flow  = _money_flow_summary(inv)

    return {
        "date":         inv.get("date", ""),
        "money_flow":   flow,
        "investor":     inv,
        "sector_index": sec,
        "short_selling": sht,
    }
