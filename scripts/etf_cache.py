#!/usr/bin/env python3
"""
etf_cache.py — 국내 상장 ETF 전체 마스터 적재기 (KR 접속 환경 전용)
====================================================================
ETF 수익률 랭킹/연금계좌 적합성 기능은 "국내 상장 ETF 전체 목록"이 필요하다.
KRX(pykrx)·KIS 모두 클라우드/해외 IP를 차단하므로, 이 스크립트는 KR 접속이
가능한 환경(로컬 PC / KR 서버)에서 실행하여 Supabase `etf_universe` 테이블에
적재한다. cloud 앱(Vercel)은 이 테이블을 읽기만 한다(krx_cache.py와 동일 패턴).

소스 우선순위:
  1) pykrx(stock.get_etf_ticker_list) — 전체 ETF 열거. (권장; 이미 KR 캐시 의존성)
  2) KIS Open API — 대안. KIS도 cloud IP 차단이므로 동일하게 KR 환경에서 실행하며,
     ETF 마스터 파일/검색 엔드포인트로 목록을 받는다(아래 fetch_via_kis 참고).

레버리지/인버스/해외 플래그는 ETF 명칭 규칙으로 분류한다(연금/IRP 편입 가부 판정).

사용법:
  python scripts/etf_cache.py                 # pykrx로 전체 ETF 적재
  python scripts/etf_cache.py --source kis     # KIS로 적재(환경변수 KIS_* 필요)

환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
          (--source kis 시) KIS_APPKEY, KIS_APPSECRET
의존성:   pip install -r scripts/requirements-krx.txt   (pykrx, pandas, requests)

권장 스케줄: 주 1회(ETF 신규상장/상폐 반영). 예) 일요일 또는 평일 1회.
"""

import argparse
import os
import sys
from datetime import date

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# ── 명칭 기반 분류 규칙 ────────────────────────────────────────────────────────

_OVERSEAS_KW = (
    "미국", "나스닥", "S&P", "SP500", "해외", "차이나", "중국", "일본", "유로",
    "글로벌", "선진", "신흥", "베트남", "인도", "대만", "필라델피아", "다우",
    "항셍", "유럽", "아시아",
)
_BOND_KW      = ("채권", "국고채", "회사채", "통안", "단기채", "금리", "머니마켓", "CD")
_COMMOD_KW    = ("골드", "금", "은", "원유", "구리", "원자재", "농산물", "천연가스", "팔라듐")
_INDEX_KW     = ("200", "코스피", "코스닥", "KRX300", "MSCIKOREA")


def classify(name: str) -> dict:
    """ETF 명칭 → {category, leveraged, inverse, overseas} 분류."""
    n = name.upper().replace(" ", "")
    leveraged = ("레버리지" in name) or ("2X" in n) or ("2배" in name)
    inverse   = ("인버스" in name) or ("곱버스" in name)
    overseas  = any(k.upper() in n for k in _OVERSEAS_KW)

    if any(k in name for k in _BOND_KW):
        category = "채권"
    elif any(k in name for k in _COMMOD_KW):
        category = "원자재"
    elif overseas:
        category = "해외주식"
    elif any(k.upper() in n for k in _INDEX_KW):
        category = "대표지수"
    else:
        category = "섹터"

    return {"category": category, "leveraged": leveraged, "inverse": inverse, "overseas": overseas}


# ── 소스 1: pykrx ─────────────────────────────────────────────────────────────

def fetch_via_pykrx() -> list[dict]:
    from pykrx import stock

    today = date.today().strftime("%Y%m%d")
    tickers = stock.get_etf_ticker_list(today)
    rows: list[dict] = []
    for t in tickers:
        try:
            name = stock.get_etf_ticker_name(t)
        except Exception:
            continue
        if not name:
            continue
        rows.append({"ticker": t, "name": name, **classify(name)})
    return rows


# ── 소스 2: KIS (대안) ────────────────────────────────────────────────────────

def fetch_via_kis() -> list[dict]:
    """
    KIS Open API로 ETF 목록 적재(대안). KIS도 cloud IP를 차단하므로 KR 환경 실행.
    KIS는 ETF 전용 '전체 목록' 엔드포인트가 제한적이라, 운영에서는
    KIS가 배포하는 ETF 구성종목/마스터 파일을 받아 동일 스키마로 매핑한다.
    여기서는 통합 지점만 제공하고, 키 미설정 시 명확히 안내한다.
    """
    appkey, secret = os.environ.get("KIS_APPKEY"), os.environ.get("KIS_APPSECRET")
    if not (appkey and secret):
        raise SystemExit("KIS_APPKEY / KIS_APPSECRET 미설정 — KIS 소스 사용 불가")
    raise SystemExit(
        "KIS ETF 마스터 적재는 KIS 마스터파일 매핑이 필요합니다. "
        "pykrx 소스(기본)를 권장합니다: python scripts/etf_cache.py"
    )


# ── Supabase upsert ───────────────────────────────────────────────────────────

def upsert(rows: list[dict]) -> None:
    if not rows:
        print("적재할 ETF가 없습니다 — 종료")
        return
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    url = f"{SUPABASE_URL}/rest/v1/etf_universe?on_conflict=ticker"
    # 배치 분할(URL/페이로드 크기 보호)
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        r = requests.post(url, headers=headers, json=chunk, timeout=30)
        if not r.ok:
            print(f"  [warn] upsert 실패 {r.status_code}: {r.text[:200]}")
        else:
            print(f"  upsert {i + len(chunk)}/{len(rows)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=("pykrx", "kis"), default="pykrx")
    args = ap.parse_args()

    print(f"[etf_cache] 소스={args.source} — ETF 마스터 수집 시작")
    rows = fetch_via_kis() if args.source == "kis" else fetch_via_pykrx()
    lev = sum(r["leveraged"] for r in rows)
    inv = sum(r["inverse"] for r in rows)
    print(f"  → {len(rows)}개 ETF (레버리지 {lev}, 인버스 {inv})")
    upsert(rows)
    print(f"완료: {date.today()} — etf_universe {len(rows)}행 적재")


if __name__ == "__main__":
    main()
