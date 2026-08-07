#!/usr/bin/env python3
"""
backtest_recommendations.py — 추천 실현성과 측정 (Phase 1 측정 인프라 v2)
==========================================================================
Supabase `prophet_recommendations`(과거 추천) × 실현 수익률(yfinance)을 결합해
모델이 실제로 작동하는지 정량 측정한다. 모델 개선은 이 측정값으로만 판정한다.

v2 수정(측정기 자체의 결함 교정):
  1) 벤치마크 정렬 버그 수정 — 기존엔 종목 시계열의 "위치 인덱스"로 KOSPI를
     인덱싱해(mkt.iloc[pos]) 두 시계열의 시작일/결측이 다르면 벤치마크 구간이
     종목 구간과 어긋났다. 날짜 기준(asof) 정렬로 교정.
  2) 운영 포트폴리오 측정 — 기존 Top-N은 예측알파 정렬이었으나 실제 서비스/
     자동매매는 composite 점수 기반 `rank`(1..20)를 쓴다. rank 기반을 기본으로
     측정하고, 예측알파 정렬은 진단용으로 병기.
  3) 실행 시차 — 추천은 장마감 후 산출되므로 당일 종가 진입은 비현실적.
     기본 lag=1(다음 거래일 종가 진입). lag=0은 신호 순수 품질 비교용.
  4) 통계적 유의성 — 일별 IC는 중첩 라벨로 자기상관이 강함 → Newey-West t-stat.
  5) 상장 전/데이터 시작 전 run_date의 조용한 오계산 방지(신선도 가드).

측정 지표:
  - 실현 IC   : run_date별 (예측 vs 실현 H일 알파) Spearman 평균 + NW t-stat
  - 운영 Top-N: rank≤N 포트폴리오의 평균 실현 알파 / Hit-rate / 누적
  - 진단 Top-N: 예측알파 상위 N 포트폴리오(모델 신호 자체의 품질)

사용:
  python scripts/backtest_recommendations.py                     # h=10, lag=1
  python scripts/backtest_recommendations.py --horizon 30 --pred-col predicted_return_30d
  python scripts/backtest_recommendations.py --lag 0 --json out.json
환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
의존성: pandas, numpy, scipy, yfinance, requests (scripts/requirements.txt)

주의: 추천이 충분히 누적된 뒤(수 주~개월)라야 통계적으로 의미 있다.
      예측 칼럼 predicted_return_7d 는 10거래일 섹터중립 알파(컬럼 재활용)이다.
"""

import argparse
import json
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

from metrics_util import daily_ic_stats, newey_west_tstat

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BENCHMARK_YF = "^KS11"

# run_date 대비 첫 체결 가능일이 이보다 늦으면(상장 전/데이터 시작 전) 표본 제외
MAX_ENTRY_DELAY_DAYS = 10


def to_yf(ticker: str, market: str) -> str:
    return ticker + (".KS" if (market or "KOSPI") == "KOSPI" else ".KQ")


def _norm_series(s: pd.Series) -> pd.Series:
    """yfinance 종가 시계열 정규화: tz 제거, 자정 정규화, 중복 제거, 정렬."""
    s = s[~s.index.duplicated(keep="last")]
    idx = pd.to_datetime(s.index)
    try:
        idx = idx.tz_localize(None)
    except TypeError:          # 이미 naive
        pass
    s.index = idx.normalize()
    return s.sort_index()


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


def realized_alpha(close: pd.Series, mkt: pd.Series, d0: pd.Timestamp,
                   horizon: int, lag: int = 1):
    """
    run_date d0 기준: (d0 이후 lag번째 거래일 종가) → (그로부터 horizon 거래일 뒤
    종가) 수익률 − 같은 "날짜" 구간의 벤치마크 수익률.

    벤치마크는 반드시 날짜(asof)로 정렬한다 — 위치 인덱스 공유 금지(구버전 버그).
    데이터 부족/정렬 불가/신선도 위반 시 None.
    """
    d0 = pd.Timestamp(d0)
    idx = close.index
    pos = int(idx.searchsorted(d0)) + lag
    if pos >= len(idx) or pos + horizon >= len(idx):
        return None
    d_in, d_out = idx[pos], idx[pos + horizon]

    # 신선도 가드: run_date보다 한참 뒤에야 데이터가 시작되면(상장 전 등) 무효
    if (d_in - d0).days > MAX_ENTRY_DELAY_DAYS:
        return None
    # 벤치마크가 출구일까지 존재해야 같은 구간 비교가 성립
    if len(mkt) == 0 or mkt.index[-1] < d_out:
        return None

    p0, p1 = float(close.iloc[pos]), float(close.iloc[pos + horizon])
    m0, m1 = float(mkt.asof(d_in)), float(mkt.asof(d_out))
    if not (np.isfinite(p0) and np.isfinite(p1) and np.isfinite(m0) and np.isfinite(m1)
            and p0 > 0 and m0 > 0):
        return None
    return (p1 / p0 - 1.0) - (m1 / m0 - 1.0)


# ── 신공식 시뮬레이션 (순위 산출 교정안의 채택 게이트) ────────────────────────
# hybrid_ensemble.py v2 교정안: 0.65·z(rank(pred)) + 0.25·z(rank(pred/vol)).
# 감성 항(0.10)은 과거 행에 저장돼 있지 않아 제외 — 전 종목 공통 누락이므로
# 두 항 비교의 공정성엔 영향 없음. 가중치는 앙상블 W_ALPHA_Z/W_SHARPE_Z와 동일.
SIM_W_ALPHA  = 0.65
SIM_W_SHARPE = 0.25


def trailing_vol_ann(close: pd.Series, d0, window: int = 60):
    """d0 시점에 알 수 있는 최근 window일 일수익률의 연환산 변동성. 부족 시 None."""
    pos = int(close.index.searchsorted(pd.Timestamp(d0)))
    seg = close.iloc[max(0, pos - window - 1): pos]
    if len(seg) < 20:
        return None
    r = seg.pct_change().dropna()
    v = float(r.std() * np.sqrt(252))
    return v if np.isfinite(v) and v > 0 else None


RANK_Z_DENOM = 0.2887   # 균등분포 이론 표준편차 1/√12 — 동률 붕괴에도 유계 보장


def _rank_z(x: np.ndarray) -> np.ndarray:
    """순위(pct) 변환 후 이론 표준편차로 정규화 — 항상 |z| ≤ ~1.73.

    경험적 std로 나누면 동률이 많은 퇴화 입력(예: 예측 붕괴로 전 종목 동일)에서
    std가 붕괴해 유계가 깨진다(아웃라이어 z≈9). 균등분포 이론값으로 나눠 방어."""
    r = pd.Series(x).rank(pct=True).values
    return (r - r.mean()) / RANK_Z_DENOM


def _port_stats(alphas: list, hits: list, horizon: int) -> dict:
    """포트폴리오 run_date별 알파 배열 → 요약(평균/NW t/히트율/누적)."""
    if not alphas:
        return {"n": 0}
    a = np.array(alphas, dtype=float)
    return {
        "n":            int(len(a)),
        "alpha_mean":   float(a.mean()),
        "alpha_tstat":  newey_west_tstat(a, lag=horizon),
        "hit_rate":     float(np.mean(hits)) if hits else float("nan"),
        "alpha_cumsum": float(a.sum()),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=10, help="실현 호라이즌(거래일)")
    ap.add_argument("--topn", type=int, default=20, help="Top-N 포트폴리오 크기")
    ap.add_argument("--lag", type=int, default=1,
                    help="진입 시차(거래일). 1=다음 거래일 종가(체결 가능), 0=당일 종가(신호 품질)")
    ap.add_argument("--pred-col", default="predicted_return_7d",
                    help="예측 칼럼(기본 predicted_return_7d=10일 알파)")
    ap.add_argument("--period", default="2y", help="yfinance 가격 조회 구간")
    ap.add_argument("--json", default=None, help="지표를 JSON 파일로 저장할 경로")
    args = ap.parse_args()

    recs = fetch_recommendations()
    if recs.empty:
        sys.exit("prophet_recommendations 비어있음 — 추천 누적 후 재실행")
    recs_pred = recs.dropna(subset=[args.pred_col])
    run_dates = sorted(recs_pred["run_date"].unique())
    print(f"[backtest] 추천 {len(recs)}행 / {len(run_dates)} run_date "
          f"| horizon={args.horizon} lag={args.lag} topn={args.topn} pred={args.pred_col}")

    # ── 가격 시계열 1회 조회 (종목별 + 벤치마크) ─────────────────────────────
    tickers = recs[["ticker", "market"]].drop_duplicates()
    mkt = yf.download(BENCHMARK_YF, period=args.period, auto_adjust=True, progress=False)["Close"]
    if isinstance(mkt, pd.DataFrame):
        mkt = mkt.iloc[:, 0]
    mkt = _norm_series(mkt)

    px = {}
    for _, row in tickers.iterrows():
        try:
            s = yf.download(to_yf(row["ticker"], row["market"]), period=args.period,
                            auto_adjust=True, progress=False)["Close"]
            if isinstance(s, pd.DataFrame):
                s = s.iloc[:, 0]
            s = _norm_series(s)
            if len(s) > args.horizon + args.lag:
                px[row["ticker"]] = s
        except Exception:
            continue
    print(f"[backtest] 가격 시계열 확보: {len(px)}/{len(tickers)}종목 + 벤치마크 {len(mkt)}행")

    # ── run_date별: IC 표본 + 운영/진단 포트폴리오 ───────────────────────────
    ic_rows = []                      # (run_date, pred, realized) — daily_ic_stats 입력
    prod_alphas, prod_hits = [], []   # rank 기반(운영과 동일)
    diag_alphas, diag_hits = [], []   # 예측알파 상위(신호 진단)
    sim_alphas,  sim_hits  = [], []   # 신공식 시뮬(교정안 채택 게이트)
    all_alphas = []                   # 유니버스 평균(비교 기준)
    n_dates_evaluated = 0
    rank_missing_dates = 0

    for d0 in run_dates:
        day = recs_pred[recs_pred["run_date"] == d0]
        preds, reals, ranks, vols = [], [], [], []
        for _, r in day.iterrows():
            s = px.get(r["ticker"])
            if s is None:
                continue
            a = realized_alpha(s, mkt, d0, args.horizon, lag=args.lag)
            if a is None:
                continue
            preds.append(float(r[args.pred_col]))
            reals.append(float(a))
            rk = r.get("rank")
            ranks.append(float(rk) if pd.notna(rk) else np.nan)
            v = trailing_vol_ann(s, d0)
            vols.append(v if v is not None else np.nan)
        if len(reals) < 5:
            continue
        n_dates_evaluated += 1
        preds_a, reals_a, ranks_a = np.array(preds), np.array(reals), np.array(ranks)

        ic_rows.extend((d0, p, a) for p, a in zip(preds_a, reals_a))
        all_alphas.append(float(reals_a.mean()))

        # 운영 포트폴리오: rank ≤ topn (실서비스가 저장한 순위 그대로)
        prod_mask = np.isfinite(ranks_a) & (ranks_a <= args.topn)
        if prod_mask.any():
            prod_alphas.append(float(reals_a[prod_mask].mean()))
            prod_hits.append(float((reals_a[prod_mask] > 0).mean()))
        else:
            rank_missing_dates += 1

        # 진단 포트폴리오: 예측알파 상위 topn
        order = np.argsort(-preds_a)[: args.topn]
        diag_alphas.append(float(reals_a[order].mean()))
        diag_hits.append(float((reals_a[order] > 0).mean()))

        # 신공식 시뮬: 유계 순위-z 혼합 (교정안을 과거 데이터에 소급 적용)
        vols_a = np.array(vols, dtype=float)
        _vmed = np.nanmedian(vols_a)
        if np.isfinite(_vmed):
            vols_f = np.where(np.isfinite(vols_a), vols_a, _vmed)
            new_score = (SIM_W_ALPHA  * _rank_z(preds_a)
                         + SIM_W_SHARPE * _rank_z(preds_a / np.maximum(vols_f, 0.05)))
            order_new = np.argsort(-new_score)[: args.topn]
            sim_alphas.append(float(reals_a[order_new].mean()))
            sim_hits.append(float((reals_a[order_new] > 0).mean()))

    if not ic_rows:
        # 호라이즌이 아직 경과하지 않은 상태는 도구 오류가 아니라 데이터 누적 대기.
        # 스케줄 잡이 실패로 표시되지 않도록 정보 출력 후 정상 종료(exit 0)한다.
        print("실현 수익률 매칭 부족 — 호라이즌 경과한 run_date가 더 필요 (누적 대기, 정상 종료)")
        if args.json:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"params": {"horizon": args.horizon, "topn": args.topn,
                                      "lag": args.lag, "pred_col": args.pred_col},
                           "n_run_dates_evaluated": 0,
                           "note": "호라이즌 미경과 — 추천 누적 후 재측정"},
                          f, ensure_ascii=False, indent=2)
            print(f"[backtest] JSON 저장: {args.json}")
        return

    ic_dates = [t[0] for t in ic_rows]
    ic_preds = [t[1] for t in ic_rows]
    ic_reals = [t[2] for t in ic_rows]
    ic = daily_ic_stats(ic_dates, ic_preds, ic_reals, min_names=5, nw_lag=args.horizon)

    prod = _port_stats(prod_alphas, prod_hits, args.horizon)
    diag = _port_stats(diag_alphas, diag_hits, args.horizon)
    sim  = _port_stats(sim_alphas,  sim_hits,  args.horizon)
    uni_mean = float(np.mean(all_alphas)) if all_alphas else float("nan")

    print(f"\n{'='*60}\n  실현성과 ({n_dates_evaluated} run_date | lag={args.lag} "
          f"h={args.horizon})\n{'='*60}")
    print(f"  실현 IC 평균          : {ic['ic_mean']:+.4f}  "
          f"(NW t={ic['ic_tstat_nw']:.2f}, {ic['n_days']}일)  ← |t|≥2 라야 유의")
    print(f"  실현 IC > 0 비율       : {ic['ic_share_pos']:.1%}")
    print(f"  유니버스 평균 알파      : {uni_mean*100:+.2f}%  (비교 기준선)")
    if prod.get("n"):
        print(f"  [운영] rank≤{args.topn} 알파  : {prod['alpha_mean']*100:+.2f}%  "
              f"(NW t={prod['alpha_tstat']:.2f}, 초과 {(prod['alpha_mean']-uni_mean)*100:+.2f}%p, "
              f"{prod['n']}일)")
        print(f"  [운영] Hit-rate        : {prod['hit_rate']:.1%} | 누적 {prod['alpha_cumsum']*100:+.1f}%")
    else:
        print(f"  [운영] rank 포트폴리오  : 측정 불가(rank 컬럼 없음 — 구버전 추천 데이터)")
    if rank_missing_dates:
        print(f"  (참고) rank 결측 run_date {rank_missing_dates}건은 운영 지표에서 제외")
    print(f"  [진단] 예측상위{args.topn} 알파: {diag['alpha_mean']*100:+.2f}%  "
          f"(NW t={diag['alpha_tstat']:.2f}, 초과 {(diag['alpha_mean']-uni_mean)*100:+.2f}%p)")
    print(f"  [진단] Hit-rate        : {diag['hit_rate']:.1%} | 누적 {diag['alpha_cumsum']*100:+.1f}%")
    if sim.get("n"):
        print(f"  [시뮬·신공식] 알파      : {sim['alpha_mean']*100:+.2f}%  "
              f"(NW t={sim['alpha_tstat']:.2f}, 초과 {(sim['alpha_mean']-uni_mean)*100:+.2f}%p, "
              f"Hit {sim['hit_rate']:.1%})  ← 유계 순위-z 교정안(감성 제외) 소급 적용")

    if args.json:
        out = {
            "params": {"horizon": args.horizon, "topn": args.topn, "lag": args.lag,
                       "pred_col": args.pred_col, "period": args.period},
            "n_run_dates_evaluated": n_dates_evaluated,
            "ic": ic,
            "universe_alpha_mean": uni_mean,
            "portfolio_prod_rank": prod,
            "portfolio_diag_pred": diag,
            "portfolio_sim_newscore": sim,
        }
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2, default=float)
        print(f"\n[backtest] JSON 저장: {args.json}")


if __name__ == "__main__":
    main()
