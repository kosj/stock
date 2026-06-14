#!/usr/bin/env python3
"""
backtest_recommendations.py — 추천 실현성과 측정 (P2 측정 인프라)
====================================================================
Supabase `prophet_recommendations`(과거 추천) × 실현 수익률(yfinance)을 결합해
모델이 실제로 작동하는지 정량 측정한다. 모델 개선(P1)은 이 측정값으로 가이드한다.

측정 지표:
  - 실현 IC   : run_date별 (예측수익률 vs 실현 H일 알파) Spearman 순위상관의 평균
                (>0 이면 예측 순위가 실현 순위와 정렬 = 유효)
  - Hit-rate  : 추천(Top-N) 종목 중 실현 알파 > 0 비율
  - Top-N 포트 : Top-N 동일가중 평균 실현 알파(=KOSPI 대비 초과수익) vs 전체 평균
  - 누적       : run_date별 Top-N 평균 알파의 합(겹침 무시한 단순 합산, 추세 확인용)

사용:
  python scripts/backtest_recommendations.py            # 10일 호라이즌, Top20
  python scripts/backtest_recommendations.py --horizon 30 --topn 10
환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
의존성: pandas, numpy, scipy, yfinance, requests (scripts/requirements.txt)

주의: 추천이 충분히 누적된 뒤(수 주~개월)라야 통계적으로 의미 있다.
      예측 칼럼 predicted_return_7d 는 10거래일 섹터중립 알파(컬럼 재활용)이다.
"""

import argparse
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from scipy.stats import spearmanr

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BENCHMARK_YF = "^KS11"


def to_yf(ticker: str, market: str) -> str:
    return ticker + (".KS" if (market or "KOSPI") == "KOSPI" else ".KQ")


def fetch_recommendations() -> pd.DataFrame:
    """prophet_recommendations 전체 조회 (예측 칼럼 + rank + market)."""
    url = (f"{SUPABASE_URL}/rest/v1/prophet_recommendations"
           f"?select=run_date,ticker,market,rank,predicted_return_7d,predicted_return_30d"
           f"&order=run_date.asc&limit=100000")
    r = requests.get(url, headers={"apikey": SUPABASE_KEY,
                                   "Authorization": f"Bearer {SUPABASE_KEY}"}, timeout=30)
    r.raise_for_status()
    df = pd.DataFrame(r.json())
    if df.empty:
        return df
    df["run_date"] = pd.to_datetime(df["run_date"])
    return df


def realized_alpha(close: pd.Series, mkt: pd.Series, d0: pd.Timestamp, horizon: int):
    """d0 시점 → horizon 거래일 후 종목 수익률 − 시장 수익률(알파). 데이터 부족 시 None."""
    idx = close.index
    pos = idx.searchsorted(d0)
    if pos >= len(idx) or pos + horizon >= len(idx):
        return None
    p0, p1 = close.iloc[pos], close.iloc[pos + horizon]
    m0, m1 = mkt.iloc[pos], mkt.iloc[pos + horizon]
    if not (np.isfinite(p0) and np.isfinite(p1) and p0 > 0 and m0 > 0):
        return None
    return (p1 / p0 - 1.0) - (m1 / m0 - 1.0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=10, help="실현 호라이즌(거래일)")
    ap.add_argument("--topn", type=int, default=20, help="Top-N 포트폴리오 크기")
    ap.add_argument("--pred-col", default="predicted_return_7d",
                    help="예측 칼럼(기본 predicted_return_7d=10일 알파)")
    args = ap.parse_args()

    recs = fetch_recommendations()
    if recs.empty:
        sys.exit("prophet_recommendations 비어있음 — 추천 누적 후 재실행")
    recs = recs.dropna(subset=[args.pred_col])
    run_dates = sorted(recs["run_date"].unique())
    print(f"[backtest] 추천 {len(recs)}행 / {len(run_dates)} run_date "
          f"| horizon={args.horizon}일 topn={args.topn} pred={args.pred_col}")

    # 가격 시계열 1회 조회 (종목별 + 벤치마크)
    tickers = recs[["ticker", "market"]].drop_duplicates()
    mkt = yf.download(BENCHMARK_YF, period="2y", auto_adjust=True, progress=False)["Close"]
    if isinstance(mkt, pd.DataFrame):
        mkt = mkt.iloc[:, 0]
    px = {}
    for _, row in tickers.iterrows():
        try:
            s = yf.download(to_yf(row["ticker"], row["market"]), period="2y",
                            auto_adjust=True, progress=False)["Close"]
            if isinstance(s, pd.DataFrame):
                s = s.iloc[:, 0]
            if len(s) > args.horizon:
                px[row["ticker"]] = s
        except Exception:
            continue

    # run_date별 지표
    ics, hits, topn_alphas, all_alphas = [], [], [], []
    for d0 in run_dates:
        day = recs[recs["run_date"] == d0]
        preds, reals = [], []
        for _, r in day.iterrows():
            s = px.get(r["ticker"])
            if s is None:
                continue
            a = realized_alpha(s, mkt, d0, args.horizon)
            if a is None:
                continue
            preds.append(float(r[args.pred_col]))
            reals.append(a)
        if len(reals) < 5:
            continue
        preds, reals = np.array(preds), np.array(reals)
        ic = spearmanr(preds, reals).statistic
        if np.isfinite(ic):
            ics.append(ic)
        # Top-N (예측 상위) 포트폴리오
        order = np.argsort(-preds)[:args.topn]
        topn_alphas.append(reals[order].mean())
        hits.append((reals[order] > 0).mean())
        all_alphas.append(reals.mean())

    if not ics:
        sys.exit("실현 수익률 매칭 부족 — 호라이즌 경과한 run_date가 더 필요")

    print(f"\n{'='*56}\n  실현성과 ({len(ics)} run_date 평가)\n{'='*56}")
    print(f"  실현 IC (평균)        : {np.mean(ics):+.4f}  (>0 유효, 0.03+ 양호)")
    print(f"  실현 IC > 0 비율       : {np.mean(np.array(ics) > 0):.1%}")
    print(f"  Top{args.topn} 평균 알파   : {np.mean(topn_alphas)*100:+.2f}%  "
          f"(전체평균 {np.mean(all_alphas)*100:+.2f}%, 초과 "
          f"{(np.mean(topn_alphas)-np.mean(all_alphas))*100:+.2f}%p)")
    print(f"  Top{args.topn} Hit-rate    : {np.mean(hits):.1%}  (알파>0 비율)")
    print(f"  Top{args.topn} 누적 알파   : {np.sum(topn_alphas)*100:+.1f}% (단순합, 추세용)")


if __name__ == "__main__":
    main()
