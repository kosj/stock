"""
국내증시 통계 서비스.
- 투자자별 매매동향: 네이버 금융 investorDealTrendTime.naver (시간별 순매수 스크래핑)
- 업종별 수익률:    sector_service.SectorService.get_performance() 재사용
- 공매도 현황:      네이버 금융 quoteSummary.naver 파생 데이터
- 자금흐름 요약:    투자자 데이터 가공

데이터 단위: Naver 원본 = 억원, 서비스 반환 = 원 (× 1억 변환)
"""
from __future__ import annotations

import io
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 1800  # 30분
_EXECUTOR = ThreadPoolExecutor(max_workers=4)

NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/sise/",
    "Accept-Language": "ko-KR,ko;q=0.9",
}

# 억원 → 원 변환 배수
_EOK = 100_000_000

_INVESTOR_ORDER = [
    "금융투자", "보험", "투신", "은행", "기타금융", "연기금등",
    "기관계", "외국인", "개인", "기타법인",
]

# Naver 컬럼명 → 표시 이름 매핑
_COL_MAP = {
    "개인": "개인",
    "외국인": "외국인",
    "기관계": "기관계",
    "금융투자": "금융투자",
    "보험": "보험",
    "투신(사모)": "투신",
    "투신 (사모)": "투신",
    "은행": "은행",
    "기타금융기관": "기타금융",
    "기타금융": "기타금융",
    "연기금등": "연기금등",
    "기타법인": "기타법인",
}


def _last_trading_day() -> str:
    """오후 4시 이전이면 전날, 주말은 금요일 기준."""
    d = datetime.now()
    if d.hour < 16:
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


# ── 투자자별 매매동향 ────────────────────────────────────────────────────────

def _fetch_investor_sync(bizdate: str, sosok: str) -> list[dict]:
    """
    네이버 금융 투자자별 시간별 순매수 스크래핑.
    sosok: "" 또는 "01" = KOSPI, "02" = KOSDAQ
    반환: [{name, buy, sell, net}] net 단위 = 원
    """
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

        # MultiIndex 컬럼 처리 — 마지막 레벨 이름 사용
        if isinstance(df.columns, pd.MultiIndex):
            flat_cols = [str(col[-1]).strip() for col in df.columns]
        else:
            flat_cols = [str(c).strip() for c in df.columns]

        # 첫 번째 NaN 행 제거, 유효 데이터 첫 번째 행 사용 (최신 시간)
        df.columns = flat_cols
        df = df.dropna(subset=["시간"]) if "시간" in flat_cols else df.dropna()
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

        # 정해진 순서로 정렬
        order_map = {n: i for i, n in enumerate(_INVESTOR_ORDER)}
        result.sort(key=lambda x: order_map.get(x["name"], 99))
        # 중복 제거
        seen: set[str] = set()
        unique = []
        for r in result:
            if r["name"] not in seen:
                seen.add(r["name"])
                unique.append(r)
        return unique

    except Exception as e:
        logger.error("네이버 투자자 스크래핑 실패 sosok=%s: %s", sosok, e)
        return []


async def get_investor_trends() -> dict:
    """KOSPI / KOSDAQ 투자자별 매매동향 (시간별 순매수 최신 값)."""
    import asyncio

    trd_dd = _last_trading_day()
    cache_key = f"investor_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    loop = asyncio.get_event_loop()
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


# ── 업종별 수익률 (KODEX ETF 기반) ─────────────────────────────────────────

async def get_sector_index() -> dict:
    """KODEX ETF 기반 업종별 수익률. sector_service 재사용."""
    from app.services.sector_service import SectorService

    trd_dd = _last_trading_day()
    cache_key = f"sector_idx_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    sectors = await SectorService.get_performance()

    # KRX 섹터 지수 포맷에 맞게 변환
    kospi_data = []
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


# ── 공매도 현황 ──────────────────────────────────────────────────────────────

def _fetch_short_selling_sync(bizdate: str) -> dict:
    """
    네이버 금융 quoteSummary.naver에서 실시간 시장 데이터 파싱.
    공매도 상세 API는 비공개이므로 sise_deal_rank.naver에서 대체.
    """
    import requests
    import pandas as pd

    result: dict = {
        "by_market":  [],
        "top_kospi":  [],
        "top_kosdaq": [],
    }

    try:
        # 공매도 상위 종목 (KOSPI)
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
                if not name or name in ("nan", "종목명"):
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
        logger.warning("공매도 KOSPI 로딩 실패: %s", e)

    try:
        # 공매도 상위 종목 (KOSDAQ)
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
                if not name or name in ("nan", "종목명"):
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
        logger.warning("공매도 KOSDAQ 로딩 실패: %s", e)

    return result


async def get_short_selling() -> dict:
    """공매도 현황 (네이버 금융 대안 데이터)."""
    import asyncio

    trd_dd = _last_trading_day()
    cache_key = f"short_{trd_dd}"
    if cache_key in _CACHE:
        ts, val = _CACHE[cache_key]
        if time.monotonic() - ts < _CACHE_TTL:
            return val  # type: ignore

    loop = asyncio.get_event_loop()
    short_data = await loop.run_in_executor(_EXECUTOR, _fetch_short_selling_sync, trd_dd)

    data: dict = {
        "date":       trd_dd,
        "by_market":  [],
        "top_kospi":  short_data.get("top_kospi", []),
        "top_kosdaq": short_data.get("top_kosdaq", []),
    }
    _CACHE[cache_key] = (time.monotonic(), data)
    return data


# ── 자금 흐름 요약 ────────────────────────────────────────────────────────────

def _money_flow_summary(investor_data: dict) -> dict:
    def extract(rows: list[dict], names: list[str]) -> int:
        for r in rows:
            if r["name"] in names:
                return r["net"]
        return 0

    kospi  = investor_data.get("kospi", [])
    kosdaq = investor_data.get("kosdaq", [])

    categories = [
        ("외국인",   ["외국인"]),
        ("기관",     ["기관계"]),
        ("개인",     ["개인"]),
        ("기타법인", ["기타법인"]),
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


# ── 대시보드 ──────────────────────────────────────────────────────────────────

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


# ── 디버그 ────────────────────────────────────────────────────────────────────

async def get_raw(bld: str, extra: dict | None = None) -> dict:
    """디버그용: 네이버 투자자 데이터 원시 반환."""
    import asyncio

    trd_dd = extra.get("trdDd", _last_trading_day()) if extra else _last_trading_day()
    loop = asyncio.get_event_loop()
    rows = await loop.run_in_executor(_EXECUTOR, _fetch_investor_sync, trd_dd, "01")
    return {"date": trd_dd, "source": "naver_investorDealTrendTime", "rows": rows}
