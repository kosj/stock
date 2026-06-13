#!/usr/bin/env python3
"""
krx_cache.py — KRX 수급·밸류 캐시 적재기 (KR 접속 환경 전용)
=============================================================
KRX(data.krx.co.kr)는 GitHub Actions 등 클라우드/해외 IP를 차단(빈 응답→JSON
파싱오류)한다. 따라서 이 스크립트는 **KR 접속이 가능한 환경(로컬 PC / KR 서버)**
에서 실행하여 pykrx로 종목별 수급(외국인/기관 순매수금액)·밸류(PER/PBR)를
조회하고 Supabase `krx_daily` 테이블에 적재한다.
ML 잡(hybrid_ensemble.py, CI)은 이 테이블만 읽으므로 KRX 차단의 영향을 받지 않는다.

사용법:
  python scripts/krx_cache.py               # 증분: 최근 INCREMENTAL_DAYS일 (매일 실행용)
  python scripts/krx_cache.py --backfill    # 백필: BACKFILL_YEARS년 전체 (최초 1회)
  python scripts/krx_cache.py --days 30     # 최근 N일

환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
의존성:   pip install -r scripts/requirements-krx.txt   (pykrx, pandas, requests)

권장 스케줄: 평일 장마감 후(예: 16:10 KST) 증분 실행
  - Windows: 작업 스케줄러로 `python scripts/krx_cache.py` 등록
  - cron:    10 7 * * 1-5  (07:10 UTC = 16:10 KST)
"""

import argparse
import os
import sys
import time
from datetime import date, timedelta

import pandas as pd
import requests
from pykrx import stock

from universe import UNIVERSE

# Windows 콘솔(cp932 등)에서 한글 출력이 UnicodeEncodeError로 죽지 않도록 UTF-8 강제.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

BACKFILL_YEARS   = 5
INCREMENTAL_DAYS = 7      # 증분: 공시 지연·정정 대비 최근 N일 재적재(멱등 upsert)
THROTTLE_SEC     = 0.2    # KRX rate-limit 회피용 종목당 소폭 스로틀


def _detect(df: pd.DataFrame, *keys: str):
    """컬럼명 부분일치 탐지 (배포본별 컬럼명 차이 흡수)."""
    for k in keys:
        col = next((c for c in df.columns if k in str(c)), None)
        if col is not None:
            return col
    return None


def fetch_one(ticker: str, fromdate: str, todate: str) -> pd.DataFrame:
    """종목 1개의 수급+밸류 시계열 → DataFrame(index=date, cols 4개). 실패 항목은 결측."""
    out = pd.DataFrame()
    # 수급: 투자자별 순매수 '금액'(원). on 미지정 시 순매수 반환.
    try:
        f = stock.get_market_trading_value_by_date(fromdate, todate, ticker)
        if f is not None and len(f):
            fcol, icol = _detect(f, "외국인"), _detect(f, "기관")
            if fcol and icol:
                out = f[[fcol, icol]].copy()
                out.columns = ["foreign_net", "inst_net"]
    except Exception as e:
        print(f"    [warn] {ticker} 수급 조회 실패: {e}")
    # 밸류: 일별 PER/PBR
    try:
        v = stock.get_market_fundamental_by_date(fromdate, todate, ticker)
        if v is not None and len(v):
            pcol, bcol = _detect(v, "PER"), _detect(v, "PBR")
            if pcol and bcol:
                vv = v[[pcol, bcol]].copy()
                vv.columns = ["per", "pbr"]
                out = vv if out.empty else out.join(vv, how="outer")
    except Exception as e:
        print(f"    [warn] {ticker} 밸류 조회 실패: {e}")

    if out.empty:
        return out
    out.index = pd.to_datetime(out.index)
    out = out[~out.index.duplicated(keep="last")]
    for col in ("foreign_net", "inst_net", "per", "pbr"):
        if col not in out.columns:
            out[col] = None
    return out


def upsert(ticker: str, df: pd.DataFrame) -> int:
    """krx_daily upsert (on_conflict=date,ticker, 멱등). 반환: 적재 행 수."""
    def _num(x):
        return None if pd.isna(x) else float(x)

    rows = [{
        "date":        pd.Timestamp(idx).strftime("%Y-%m-%d"),
        "ticker":      ticker,
        "foreign_net": _num(r.get("foreign_net")),
        "inst_net":    _num(r.get("inst_net")),
        "per":         _num(r.get("per")),
        "pbr":         _num(r.get("pbr")),
    } for idx, r in df.iterrows()]
    if not rows:
        return 0

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/krx_daily?on_conflict=date,ticker",
        headers={
            "apikey":        SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type":  "application/json",
            "Prefer":        "resolution=merge-duplicates,return=minimal",
        },
        json=rows, timeout=30,
    )
    if not resp.ok:
        print(f"    [error] {ticker} upsert 실패: {resp.status_code} {resp.text[:160]}")
        return 0
    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description="KRX 수급·밸류 → Supabase krx_daily 적재")
    ap.add_argument("--backfill", action="store_true", help=f"{BACKFILL_YEARS}년 전체 적재(최초 1회)")
    ap.add_argument("--days", type=int, default=None, help="최근 N일 적재")
    args = ap.parse_args()

    todate = date.today()
    if args.backfill:
        fromdate = todate - timedelta(days=BACKFILL_YEARS * 365 + 10)
    else:
        fromdate = todate - timedelta(days=args.days or INCREMENTAL_DAYS)
    f_s, t_s = fromdate.strftime("%Y%m%d"), todate.strftime("%Y%m%d")
    mode = "백필" if args.backfill else f"증분({(todate - fromdate).days}일)"
    print(f"[krx_cache] {mode} 적재 {f_s}~{t_s} | {len(UNIVERSE)}종목")

    total_rows = ok = 0
    for i, s in enumerate(UNIVERSE, 1):
        tk = s["ticker"]
        df = fetch_one(tk, f_s, t_s)
        if df.empty:
            print(f"  [{i}/{len(UNIVERSE)}] {tk} {s['name']}: 데이터 없음")
            continue
        n = upsert(tk, df)
        total_rows += n
        ok += 1 if n else 0
        print(f"  [{i}/{len(UNIVERSE)}] {tk} {s['name']}: {n}행")
        time.sleep(THROTTLE_SEC)

    print(f"[krx_cache] 완료: {ok}/{len(UNIVERSE)}종목, 총 {total_rows}행 upsert")


if __name__ == "__main__":
    main()
