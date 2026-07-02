#!/usr/bin/env python3
"""
metrics_util.py — 랭킹 품질 지표 공용 유틸 (hybrid_ensemble / backtest 공유)
==============================================================================
핵심 원칙:
  일간 크로스섹셔널 랭킹 전략의 품질은 "일별 크로스섹셔널 IC의 평균"으로 재야 한다.
  전체 패널 행을 풀링한 단일 Spearman은 (1) 시계열·크로스섹션 변동을 섞고
  (2) H일 중첩 라벨 때문에 유효 표본수를 크게 과대평가한다.

  또한 연속 거래일의 일별 IC는 라벨 윈도우가 겹쳐 자기상관이 강하므로,
  평균 IC의 유의성은 Newey-West(HAC) 보정 t-stat로 판단한다(lag ≈ 호라이즌).

의존성: numpy, pandas, scipy (scripts/requirements.txt에 이미 포함)
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy.stats import spearmanr


def newey_west_tstat(x, lag: int) -> float:
    """
    평균이 0인지에 대한 Newey-West(HAC, Bartlett 커널) t-통계량.

    x   : 1차원 수열(예: 일별 IC 시계열, 시간순 정렬 가정)
    lag : 자기상관 보정 최대 시차(중첩 라벨이면 호라이즌-1 이상 권장)

    NaN은 제거한다. 표본 < 3 또는 분산 비양수면 NaN 반환.
    """
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    n = len(x)
    if n < 3:
        return float("nan")
    mu = float(x.mean())
    e = x - mu
    # 장기분산(HAC): gamma0 + 2 * Σ_l w_l * gamma_l,  w_l = 1 - l/(L+1)
    g = float(e @ e) / n
    L = int(min(max(lag, 0), n - 1))
    for l in range(1, L + 1):
        cov = float(e[l:] @ e[:-l]) / n
        g += 2.0 * (1.0 - l / (L + 1.0)) * cov
    if g <= 0:
        return float("nan")
    return mu / math.sqrt(g / n)


def daily_ic_stats(dates, pred, y, min_names: int = 5, nw_lag: int = 10) -> dict:
    """
    일별 크로스섹셔널 IC 통계.

    dates / pred / y : 같은 길이의 배열(행 단위 패널). 날짜별로 그룹핑해
                       각 날짜에서 Spearman(pred, y)을 구하고 시간순으로 모은다.
    min_names        : IC를 계산할 날짜의 최소 종목 수(그 미만인 날짜는 제외)
    nw_lag           : Newey-West 시차(중첩 라벨 보정; 호라이즌 권장)

    반환: {ic_mean, ic_tstat_nw, ic_share_pos, n_days}
          유효 날짜가 없으면 전부 NaN/0.
    """
    df = pd.DataFrame({"date": pd.to_datetime(np.asarray(dates)),
                       "pred": np.asarray(pred, dtype=float),
                       "y":    np.asarray(y, dtype=float)})
    df = df.dropna()

    ics: list[tuple[pd.Timestamp, float]] = []
    for d, g in df.groupby("date", sort=True):
        if len(g) < min_names:
            continue
        # 상수 벡터(전부 동일 값)면 spearmanr가 NaN — 그대로 걸러진다
        ic = spearmanr(g["pred"].values, g["y"].values).statistic
        if np.isfinite(ic):
            ics.append((d, float(ic)))

    if not ics:
        return {"ic_mean": float("nan"), "ic_tstat_nw": float("nan"),
                "ic_share_pos": float("nan"), "n_days": 0}

    ic_arr = np.array([v for _, v in ics], dtype=float)   # 이미 날짜 오름차순
    return {
        "ic_mean":      float(ic_arr.mean()),
        "ic_tstat_nw":  newey_west_tstat(ic_arr, lag=nw_lag),
        "ic_share_pos": float((ic_arr > 0).mean()),
        "n_days":       int(len(ic_arr)),
    }
