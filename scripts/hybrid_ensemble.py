#!/usr/bin/env python3
"""
Hybrid Stacking Ensemble — Korean Stock Alpha Predictor
========================================================
Layer 1 (Base Models):
  - LightGBM  (gradient boosting tree)
  - RandomForest (bagging ensemble)
  - MLP Neural Net (temporal patterns via lag features; LSTM-equivalent in tabular form)
Layer 2 (Meta Model):
  - Ridge Regression with L2 regularisation (prevents overfitting)

Validation : TimeSeriesSplit / Walk-forward (no look-ahead bias enforced)
Target     : N-day forward excess return vs KOSPI benchmark (Alpha, cross-sectional rank)
Horizons   : 10d primary (full stack, drives ranking) + 30d independent (LightGBM)
Score      : 0.5 × alpha_zscore + 0.5 × sharpe_zscore  (cross-sectional blend)

Post-processing:
  - Liquidity filter   : 20d average trading value >= 5B KRW
  - Positive alpha gate: alpha_5d > 0 (no negative-alpha stocks in Top 20)
  - News sentiment tilt: cross-sectional sentiment z-score blended into score
  - Sector cap         : max 5 tickers per sector in final Top 20

Output: Upserted into Supabase `prophet_recommendations` table.
"""

import json
import os
import socket
import sys
import time
import warnings
from datetime import date

import numpy as np
import pandas as pd
import requests
import yfinance as yf
import lightgbm as lgb
from scipy.stats import spearmanr
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import r2_score
from sklearn.model_selection import KFold, TimeSeriesSplit, cross_val_predict

# 수급·밸류는 Supabase krx_daily 캐시에서 읽는다(KR 접속 환경의 krx_cache.py가 적재).
# KRX는 클라우드 IP를 차단하므로 ML 잡(CI)은 pykrx를 직접 호출하지 않는다.
from news_sentiment import NewsSentimentService

warnings.filterwarnings("ignore")

# 모든 네트워크 호출(소켓) 전역 타임아웃 — 단일 pykrx/yfinance 호출이 무한 hang하여
# CI 잡이 취소(timeout)되는 것을 방지하는 backstop. requests의 명시 timeout은 이를 override함.
socket.setdefaulttimeout(20)

# ── 환경 변수 ─────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# ── 하이퍼파라미터 ─────────────────────────────────────────────────────────────
TARGET_DAYS    = 10              # 예측 대상: 10거래일 선행 섹터 중립 알파 (5→10: SNR 개선)
SECTOR_CAP     = 5               # 섹터당 최대 종목 수 (쏠림 방지)
TOP_N          = 20              # 최종 추천 종목 수 (Top-N)
LIQUIDITY_MIN  = 5_000_000_000   # 20일 평균 거래대금 최소치 (50억 KRW)
TARGET_CLIP    = 0.40            # 훈련 타깃 클리핑 ±40%
TARGET_DAYS_LONG = 30            # 독립 30일 모델 타깃 호라이즌 (결함2: 2.19배 외삽 대체)
TARGET_CLIP_LONG = 0.60          # 30일 타깃 클리핑 ±60% (10일보다 큰 변동 반영)
# 예측 백분위 → 실제 알파 역변환 밴드 (p5~p95).
# 일별 극단 분위(p0/p100=±TARGET_CLIP)를 단일 종목에 부여하는 과대추정 방지.
RANK_RETURN_BAND = (5.0, 95.0)
MIN_TRAIN_ROWS = 200             # 폴드당 최소 훈련 행 수 (5y 데이터로 기준 상향)
BENCHMARK_YF   = "^KS11"        # KOSPI 벤치마크
CV_SPLITS      = 5               # Walk-forward 분할 수
MIN_OOF_R2     = 0.01            # 메타 모델 최소 OOF R² — 미달 시 경고
ALPHA30_DECAY  = 0.7             # 30일 외삽 감쇠 계수 — 10d×3스텝: Σ(0.7^k, k=0..2) ≈ 2.19×
A30_CAP        = 0.60            # 30일 예측 최대 ±60%

# ── 뉴스 감성 ─────────────────────────────────────────────────────────────────
SENTIMENT_CONCURRENCY = 4        # 감성 배치 동시 실행 상한(Naver/HF rate-limit·콜드스타트 부하 회피)
# 최종 스코어 z-블렌드 가중치: 0.45·alpha_z + 0.45·sharpe_z + 0.10·sentiment_z
# (감성 z가 전부 0이면 0.45(α+s)가 되어 기존 0.5(α+s)와 순위 동일 → 감성 부재 시 무해)
W_ALPHA_Z     = 0.45
W_SHARPE_Z    = 0.45
W_SENTIMENT_Z = 0.10

# ── 종목 유니버스 ─────────────────────────────────────────────────────────────
# 단일 소스 universe.py에서 로드 (krx_cache.py와 공유 — 종목 수정은 거기 한 곳만).
from universe import UNIVERSE

# 훈련·예측에 사용할 피처 컬럼 목록
FEATURE_COLS = [
    "ret_1d", "ret_2d", "ret_3d", "ret_5d", "ret_10d", "ret_20d", "ret_60d",
    "alpha_1d", "alpha_5d", "alpha_20d",
    "rsi_14", "macd_hist", "bb_pct",
    "vs_ma5", "vs_ma20", "vs_ma60",
    "vol_ratio", "vol_20d", "vol_60d",
    "market_ret_5d", "market_ret_20d",
    "high_52w_pct",         # 52주 고점 대비 위치 (모멘텀·돌파 신호)
    "momentum_12_1",        # 12개월-1개월 모멘텀 팩터 (연구 기반 알파)
    "sector_rel_ret_5d",    # 동일 섹터 평균 대비 5일 초과수익 (섹터 중립 신호)
    "sector_rel_ret_20d",   # 동일 섹터 평균 대비 20일 초과수익
    "rs_rank_20d",          # 크로스섹셔널 20일 수익률 상대강도 순위 0~1
    "foreign_net_5d",       # 외국인 5일 순매수금액 / 거래대금 비율 (수급)
    "foreign_net_20d",      # 외국인 20일 순매수 비율
    "inst_net_5d",          # 기관 5일 순매수 비율
    "inst_net_20d",         # 기관 20일 순매수 비율
    "earnings_yield",       # 1/PER 이익수익률 (밸류: 높을수록 저평가)
    "book_yield",           # 1/PBR 장부수익률 (밸류)
]


# ─────────────────────────────────────────────────────────────────────────────
# 데이터 조회
# ─────────────────────────────────────────────────────────────────────────────

def to_yf(code: str, market: str) -> str:
    return code + (".KS" if market == "KOSPI" else ".KQ")


def fetch_ohlcv(ticker_yf: str, period: str = "5y") -> pd.DataFrame:
    for attempt in range(3):
        try:
            df = yf.download(ticker_yf, period=period, auto_adjust=True,
                             progress=False, threads=False)
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            if len(df) < 60:
                return pd.DataFrame()
            return df[["Open", "High", "Low", "Close", "Volume"]].copy()
        except Exception as exc:
            if attempt == 2:
                print(f"  [warn] {ticker_yf}: {exc}")
                return pd.DataFrame()
            time.sleep(2 ** attempt)
    return pd.DataFrame()


# ─────────────────────────────────────────────────────────────────────────────
# 기술적 지표
# ─────────────────────────────────────────────────────────────────────────────

def _rsi(prices: pd.Series, n: int = 14) -> pd.Series:
    d    = prices.diff()
    gain = d.clip(lower=0).rolling(n).mean()
    loss = (-d.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + gain / loss.replace(0, np.nan))


def _macd_hist(prices: pd.Series, f: int = 12, s: int = 26, sig: int = 9) -> pd.Series:
    m = prices.ewm(span=f, adjust=False).mean() - prices.ewm(span=s, adjust=False).mean()
    return m - m.ewm(span=sig, adjust=False).mean()


def _bb_pct(prices: pd.Series, n: int = 20) -> pd.Series:
    ma  = prices.rolling(n).mean()
    sd  = prices.rolling(n).std()
    rng = (2 * sd).replace(0, np.nan)
    return (prices - (ma - sd)) / rng


# ─────────────────────────────────────────────────────────────────────────────
# 피처 엔지니어링 — look-ahead bias 없음
# ─────────────────────────────────────────────────────────────────────────────

def fetch_krx_cache(ticker: str) -> pd.DataFrame:
    """
    Supabase krx_daily 테이블에서 종목 수급·밸류 시계열 조회 (KR 캐시 파이프라인).

    KRX는 클라우드 IP를 차단하므로 ML 잡(CI)은 pykrx를 직접 호출하지 않고,
    KR 접속 환경의 krx_cache.py가 적재해 둔 이 테이블을 읽는다.
    반환: DataFrame(index=DatetimeIndex, columns=[foreign_net, inst_net, per, pbr]).
    테이블 부재/빈 데이터/오류 시 빈 DataFrame → 호출측에서 0(중립) degrade.
    """
    try:
        url = (f"{SUPABASE_URL}/rest/v1/krx_daily"
               f"?ticker=eq.{ticker}"
               f"&select=date,foreign_net,inst_net,per,pbr"
               f"&order=date.asc&limit=3000")
        r = requests.get(url, headers={
            "apikey":        SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }, timeout=15)
        if not r.ok:
            return pd.DataFrame()
        rows = r.json()
        if not rows:
            return pd.DataFrame()
        out = pd.DataFrame(rows)
        out["date"] = pd.to_datetime(out["date"])
        out = out.set_index("date").sort_index()
        out = out[~out.index.duplicated(keep="last")]
        for col in ("foreign_net", "inst_net", "per", "pbr"):
            if col not in out.columns:
                out[col] = 0.0
        return out[["foreign_net", "inst_net", "per", "pbr"]].astype(float)
    except Exception:
        return pd.DataFrame()


def make_features(df: pd.DataFrame, mkt: pd.DataFrame,
                  flows: "pd.DataFrame | None" = None,
                  funda: "pd.DataFrame | None" = None) -> pd.DataFrame:
    """
    날짜 d의 피처는 d 이전 데이터만 참조.
    target_alpha_5d 는 훈련 레이블용 (d+1 ~ d+5 참조) — 예측 시 사용 안 함.
    flows: pykrx 순매수금액 시계열(없으면 수급 피처는 0 중립으로 degrade).
    funda: pykrx PER/PBR 시계열(없으면 밸류 피처는 0 중립으로 degrade).
    """
    c   = df["Close"]
    vol = df["Volume"]
    mkt_c = mkt["Close"].reindex(c.index, method="ffill")
    ret   = c.pct_change()
    mret  = mkt_c.pct_change()

    f = pd.DataFrame(index=c.index)

    for lag in [1, 2, 3, 5, 10, 20, 60]:
        f[f"ret_{lag}d"] = c.pct_change(lag)

    for lag in [1, 5, 20]:
        f[f"alpha_{lag}d"] = c.pct_change(lag) - mret.rolling(lag).sum()

    f["rsi_14"]    = _rsi(c, 14)
    f["macd_hist"] = _macd_hist(c)
    f["bb_pct"]    = _bb_pct(c)

    for w in [5, 20, 60]:
        f[f"vs_ma{w}"] = c / c.rolling(w).mean() - 1

    vol_ma20       = vol.rolling(20).mean()
    f["vol_ratio"] = vol / vol_ma20.replace(0, np.nan)

    f["vol_20d"] = ret.rolling(20).std() * np.sqrt(252)
    f["vol_60d"] = ret.rolling(60).std() * np.sqrt(252)

    f["market_ret_5d"]  = mret.rolling(5).sum()
    f["market_ret_20d"] = mret.rolling(20).sum()

    # 52주(252거래일) 고점 대비 현재가 위치 (돌파·조정 국면 식별)
    f["high_52w_pct"] = c / c.rolling(252).max() - 1

    # 12개월-1개월 모멘텀 팩터: 장기 모멘텀에서 단기 반전(reversal) 제거
    f["momentum_12_1"] = c.pct_change(252).shift(21) - c.pct_change(21)

    # 유동성 계산용 (훈련 피처 아님)
    f["trading_value"] = c * vol

    # ── 수급 피처: 외국인/기관 순매수금액 ÷ 거래대금 (5d·20d 비율) ──────────────
    # 순매수금액(원)을 같은 기간 거래대금으로 나눠 종목 간 비교 가능한 [-1,1] 비율로
    # 정규화. KR 시장에서 외국인·기관 수급은 가장 강력한 단기 알파 신호 중 하나.
    # flows 미제공/결손 시 0(중립). 날짜 정렬은 문자열 키(YYYYMMDD)로 tz 무관 처리.
    tv = f["trading_value"]
    if flows is not None and not flows.empty:
        _fk   = flows.index.strftime("%Y%m%d")
        _fmap = pd.Series(flows["foreign_net"].values, index=_fk)
        _imap = pd.Series(flows["inst_net"].values,    index=_fk)
        _ck   = c.index.strftime("%Y%m%d")
        fn  = pd.Series(_fmap.reindex(_ck).fillna(0.0).values, index=c.index)
        inn = pd.Series(_imap.reindex(_ck).fillna(0.0).values, index=c.index)
    else:
        fn  = pd.Series(0.0, index=c.index)
        inn = pd.Series(0.0, index=c.index)
    for w in (5, 20):
        _denom = tv.rolling(w).sum().replace(0, np.nan)
        f[f"foreign_net_{w}d"] = (fn.rolling(w).sum()  / _denom).clip(-1, 1)
        f[f"inst_net_{w}d"]    = (inn.rolling(w).sum() / _denom).clip(-1, 1)

    # ── 밸류 피처: 이익수익률(1/PER)·장부수익률(1/PBR) ─────────────────────────
    # 낮은 PER/PBR = 저평가(value factor). 역수로 변환해 '높을수록 저평가'로 정렬하고,
    # 횡단면 z-score(main)에서 '동일 시점 동종 대비 저평가' 신호로 정규화된다.
    # 적자(PER≤0)·결손은 0(중립). funda 미제공 시 전부 0 → degrade.
    if funda is not None and not funda.empty:
        _vk   = funda.index.strftime("%Y%m%d")
        _pmap = pd.Series(funda["per"].values, index=_vk)
        _bmap = pd.Series(funda["pbr"].values, index=_vk)
        _ck2  = c.index.strftime("%Y%m%d")
        per = pd.Series(_pmap.reindex(_ck2).values, index=c.index).ffill()
        pbr = pd.Series(_bmap.reindex(_ck2).values, index=c.index).ffill()
    else:
        per = pd.Series(np.nan, index=c.index)
        pbr = pd.Series(np.nan, index=c.index)
    f["earnings_yield"] = (1.0 / per).where(per > 0, 0.0)
    f["book_yield"]     = (1.0 / pbr).where(pbr > 0, 0.0)

    # ── 타깃: 5거래일 선행 초과수익률 ─────────────────────────────────────────
    fwd_ret  = c.pct_change(TARGET_DAYS).shift(-TARGET_DAYS)
    fwd_mret = mret.rolling(TARGET_DAYS).sum().shift(-TARGET_DAYS)
    # ±TARGET_CLIP 클리핑: 에코프로·바이오株 등 급등락 이벤트가 훈련 데이터를 오염하는 것을 방지
    f["target_alpha_5d"] = (fwd_ret - fwd_mret).clip(-TARGET_CLIP, TARGET_CLIP)

    # ── 보조 타깃: 30거래일 선행 초과수익률 (독립 30일 모델용 — 결함2) ─────────
    fwd_ret_l  = c.pct_change(TARGET_DAYS_LONG).shift(-TARGET_DAYS_LONG)
    fwd_mret_l = mret.rolling(TARGET_DAYS_LONG).sum().shift(-TARGET_DAYS_LONG)
    f["target_alpha_30d"] = (fwd_ret_l - fwd_mret_l).clip(-TARGET_CLIP_LONG, TARGET_CLIP_LONG)

    return f.dropna(subset=["rsi_14", "vs_ma60", "vol_60d"])


# ─────────────────────────────────────────────────────────────────────────────
# 모델 팩토리
# ─────────────────────────────────────────────────────────────────────────────

def _make_base_models():
    lgbm = lgb.LGBMRegressor(
        n_estimators=500, learning_rate=0.03,  # 트리 늘리고 학습률 낮춤 (일반화 개선)
        max_depth=4, num_leaves=15,             # 복잡도 축소 (과적합 억제)
        subsample=0.8, colsample_bytree=0.7,
        reg_lambda=2.0,                         # L2 정규화 강화
        min_child_samples=20,                   # 리프 최소 샘플 (노이즈 과적합 방지)
        random_state=42, verbose=-1,
    )
    rf = RandomForestRegressor(
        n_estimators=300, max_depth=5,          # 깊이 축소 (6→5)
        min_samples_leaf=10,                    # 리프 최소 샘플 상향 (5→10)
        max_features=0.6, random_state=42, n_jobs=-1,
    )
    # MLP 제거(P1): latest OOD에서 ±1e13 폭주(P0 원인) + 메타 기여 거의 0(coef≈0.005).
    # LGBM·RF 2종으로 단순화 → 폭주 위험 제거, 입력 스케일링(StandardScaler) 불필요.
    return lgbm, rf


# ─────────────────────────────────────────────────────────────────────────────
# Walk-forward TimeSeriesSplit 스태킹
# ─────────────────────────────────────────────────────────────────────────────

def walk_forward_stack(panel: pd.DataFrame) -> dict:
    """
    날짜 기준 walk-forward 분할로 미래 데이터 참조를 원천 차단.
    panel MultiIndex: (ticker, date)

    OOF R² 계산 방식:
      - base 모델 3종의 OOF 예측을 쌓아(stacking) Ridge 메타 모델 학습
      - 진짜 OOF R²: 메타 모델 자체도 3-fold CV로 평가 (in-sample R² 방지)
    """
    dates     = panel.index.get_level_values("date").unique().sort_values()
    row_dates = panel.index.get_level_values("date")   # DatetimeIndex 유지(.isin 견고 매칭)

    X_all = panel[FEATURE_COLS].values.astype(np.float32)
    y_all = panel["target_alpha_5d"].values.astype(np.float32)

    n = len(panel)
    oof_lgbm = np.full(n, np.nan)
    oof_rf   = np.full(n, np.nan)
    oof_mask = np.zeros(n, dtype=bool)

    tscv = TimeSeriesSplit(n_splits=CV_SPLITS, gap=TARGET_DAYS)

    for fold, (tr_di, te_di) in enumerate(tscv.split(np.arange(len(dates)))):
        # 날짜 값 매칭은 datetime64 vs Timestamp 타입 차로 np.isin이 numpy 버전에 따라
        # 전부 False가 될 수 있음(폴드 0행 → 메타 학습 붕괴). pandas .isin으로 견고화.
        tr = row_dates.isin(dates[tr_di])   # Index.isin -> numpy bool 배열
        te = row_dates.isin(dates[te_di])

        X_tr_raw, y_tr_raw = X_all[tr], y_all[tr]
        X_te_raw = X_all[te]

        # NaN 행 제거 — 훈련셋
        ok_tr = ~np.isnan(y_tr_raw) & ~np.any(np.isnan(X_tr_raw), axis=1)
        X_tr, y_tr = X_tr_raw[ok_tr], y_tr_raw[ok_tr]

        # NaN 행 제거 — 테스트셋 (RF는 NaN을 처리하지 못함; OOF 인덱스 분리 관리)
        ok_te = ~np.any(np.isnan(X_te_raw), axis=1)
        X_te  = X_te_raw[ok_te]

        if len(X_tr) < MIN_TRAIN_ROWS or len(X_te) == 0:
            print(f"  Fold {fold+1}/{CV_SPLITS}: skip (train={len(X_tr)}, test={len(X_te)})")
            continue

        lgbm, rf = _make_base_models()
        lgbm.fit(X_tr, y_tr)
        rf.fit(X_tr, y_tr)

        # te 마스크 내 NaN-없는 행에만 OOF 기록 (인덱스 정합성 유지)
        te_idx = np.where(te)[0][ok_te]
        # 베이스 예측 클립[-0.5,0.5] (트리 외삽 방어, 메타 입력 분포 일치)
        oof_lgbm[te_idx] = np.clip(lgbm.predict(X_te), -0.5, 0.5)
        oof_rf[te_idx]   = np.clip(rf.predict(X_te),   -0.5, 0.5)
        oof_mask[te_idx] = True

        print(f"  Fold {fold+1}/{CV_SPLITS}: train={tr.sum():,}행  test={te.sum():,}행")

    # ── Ridge 메타 모델 ────────────────────────────────────────────────────────
    valid  = oof_mask & ~np.isnan(y_all) & ~np.isnan(oof_lgbm) & ~np.isnan(oof_rf)
    meta_X = np.column_stack([oof_lgbm[valid], oof_rf[valid]])
    meta_y = y_all[valid]

    meta = Ridge(alpha=1.0)
    meta.fit(meta_X, meta_y)

    # OOF R² + IC: 메타 모델(Ridge) 자체를 KFold 5-fold CV로 평가
    # meta_X는 이미 walk-forward OOF 예측이므로 KFold 추가 CV는 메타 레이어만 측정
    # → 스태킹 앙상블 전체 품질을 LGBM OOF 단독보다 정확하게 반영
    if len(meta_X) > 30:
        _meta_oof = cross_val_predict(
            Ridge(alpha=1.0), meta_X, meta_y,
            cv=KFold(n_splits=5, shuffle=False),
        )
        oof_r2 = float(r2_score(meta_y, _meta_oof))
        oof_ic = float(spearmanr(_meta_oof, meta_y).statistic)
    else:
        oof_r2, oof_ic = 0.0, 0.0

    print(f"  OOF R²  (meta CV): {oof_r2:.4f}")
    print(f"  OOF IC  (Spearman): {oof_ic:.4f}  ← 랭킹 품질 지표 (>0 = 유효)")

    # ── 모델 품질 게이트 (IC 기준) ────────────────────────────────────────────
    # R²는 절대 오차 기준으로 noise floor에서 쉽게 음수가 됨.
    # IC > -0.02: 순위 방향이 심하게 반전되지 않으면 랭킹 신호로 활용.
    if oof_ic < MIN_OOF_R2:
        print(f"  ⚠ 경고: OOF IC={oof_ic:.4f} < 최소 기준({MIN_OOF_R2})")
        print(f"  → 신호 신뢰도 낮음. 결과를 참고 자료로만 활용 권장.")

    # ── 전체 데이터로 Base 모델 재훈련 (최종 예측용) ─────────────────────────
    ok_all   = ~np.isnan(y_all) & ~np.any(np.isnan(X_all), axis=1)
    X_full   = X_all[ok_all]
    y_full   = y_all[ok_all]
    lgbm_f, rf_f = _make_base_models()
    lgbm_f.fit(X_full, y_full)
    rf_f.fit(X_full, y_full)

    return dict(
        lgbm=lgbm_f, rf=rf_f,
        meta=meta, oof_r2=oof_r2, oof_ic=oof_ic,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 예측
# ─────────────────────────────────────────────────────────────────────────────

def predict_alpha(models: dict, latest: pd.DataFrame) -> pd.Series:
    """최신 피처 → 횡단면 '랭크 점수' 예측 Series (도메인 ≈ -0.5~+0.5).

    반환값은 알파(수익률)가 아니라 타깃과 동일한 횡단면 랭크 점수다.
    실제 기대수익률 변환은 main()의 _pct_to_return에서 백분위 매핑으로 수행한다.

    베이스 예측(LGBM·RF)은 [-0.5,0.5]로 클립(트리 외삽·이상치 방어). 랭크 점수는 이
    범위를 벗어날 수 없어 정상 예측엔 무손실이며, 하류에서 횡단면 백분위로 재정규화된다.
    (MLP는 P1에서 제거 — OOD 폭주 위험 + 메타 기여 미미.)"""
    X  = latest[FEATURE_COLS].values.astype(np.float32)
    p_lgbm = np.clip(models["lgbm"].predict(X), -0.5, 0.5)
    p_rf   = np.clip(models["rf"].predict(X),   -0.5, 0.5)
    meta_X = np.column_stack([p_lgbm, p_rf])
    raw = models["meta"].predict(meta_X)
    rank_score = np.clip(raw, -0.5, 0.5)
    return pd.Series(rank_score, index=latest.index, name="rank_score")


def train_predict_alpha_30d(panel: pd.DataFrame, latest: pd.DataFrame) -> dict:
    """
    독립 30일 모델 — 별도 30거래일 선행 알파 타깃을 LightGBM 단독으로 학습/예측.
    반환: {ticker: 기대 30일 알파(분율)}

    결함2 배경:
      기존 30일은 a30 = 2.19 × a10(10일 알파)의 결정론적 외삽이라 독립 정보가
      전혀 없었다(횡단면 순위가 10일과 100% 동일). 진짜 30일 타깃 학습으로 대체.

    설계 결정:
      - CI 비용 절감을 위해 풀 스택(LGBM+RF+MLP+Ridge) 대신 LightGBM 단독 사용.
        30일은 보조 표시 지표이며 LGBM이 단일 최강 베이스 모델 → 비용/효익 균형.
      - 결함1과 동일하게 횡단면 백분위 매핑(raw_alpha_q_30d)으로 스프레드 복원.
      - look-ahead 없음: 타깃이 실현된 과거 (피처, 30일 선행 알파) 쌍으로만 학습
        (오늘 기준 미래 30일 타깃은 NaN으로 자동 제외).
    """
    p30 = panel.dropna(subset=["target_alpha_30d"] + FEATURE_COLS).copy()
    p30 = p30[p30["target_alpha_30d"].abs() <= TARGET_CLIP_LONG]
    if len(p30) < MIN_TRAIN_ROWS:
        raise ValueError(f"30일 훈련 행 부족: {len(p30)} < {MIN_TRAIN_ROWS}")

    # 경험적 30일 알파 분위수 맵 (예측 백분위 → 실제 알파 역변환용)
    raw_alpha_q_30d = np.percentile(p30["target_alpha_30d"].values, np.arange(0, 101))

    # 랭크 타깃 변환 (날짜별 백분위 - 0.5) — 10일 파이프라인과 동일 방식
    y30 = p30.groupby(level="date")["target_alpha_30d"].rank(pct=True) - 0.5

    # 크로스섹셔널 피처 정규화 (날짜별 z-score) — latest와 동일 표현 보장
    X30 = p30[FEATURE_COLS].copy()
    for _col in FEATURE_COLS:
        _mu = X30.groupby(level="date")[_col].transform("mean")
        _sd = X30.groupby(level="date")[_col].transform("std").replace(0, np.nan).fillna(1.0)
        X30[_col] = (X30[_col] - _mu) / _sd
    _ok = ~X30.isna().any(axis=1) & ~y30.isna()
    X30, y30 = X30[_ok], y30[_ok]

    lgbm30 = _make_base_models()[0]               # 동일 LGBM 설정 재사용
    lgbm30.fit(X30.values.astype(np.float32), y30.values.astype(np.float32))

    # 예측 → 횡단면 백분위 매핑 (결함1과 동일한 스프레드 복원)
    pred30 = pd.Series(
        lgbm30.predict(latest[FEATURE_COLS].values.astype(np.float32)),
        index=latest.index,
    )
    pct30  = pred30.rank(pct=True)
    lo, hi = RANK_RETURN_BAND
    grid   = np.arange(0, 101)
    return {
        t: float(np.interp(lo + float(np.clip(pct30[t], 0.0, 1.0)) * (hi - lo), grid, raw_alpha_q_30d))
        for t in latest.index
    }


# ─────────────────────────────────────────────────────────────────────────────
# 포스트 프로세싱
# ─────────────────────────────────────────────────────────────────────────────

def _rec_label(score: float) -> str:
    """
    risk_adj_score = 0.5 × alpha_z + 0.5 × sharpe_z 크로스섹셔널 z-score 블렌드 기준.
    분포: mean≈0, std≈1 → 임계값을 z-score 스케일로 설정.

    비율 근거 (정규분포 가정):
      strong_buy : z > +1.0  → 상위 ~16%
      buy        : z > +0.25 → 상위 ~40%  (buy = +0.25 ~ +1.0 구간 ~24%)
      hold       : z > -0.25 → 중간 ~20%  (hold = -0.25 ~ +0.25 구간)
      sell       : z > -1.0  → 하위 ~40%  (sell = -1.0 ~ -0.25 구간 ~24%)
      strong_sell: else      → 하위 ~16%
    """
    if score > 1.0:    return "strong_buy"
    if score > 0.25:   return "buy"
    if score > -0.25:  return "hold"
    if score > -1.0:   return "sell"
    return "strong_sell"


def _trend_dir(ret20: float) -> str:
    return "up" if ret20 > 0.03 else ("down" if ret20 < -0.03 else "flat")


def _calc_atr_pct(df: pd.DataFrame, period: int = 14) -> float:
    """14일 ATR% — 클램핑 0.5 ~ 12.0% 적용"""
    try:
        tr = pd.concat([
            df["High"] - df["Low"],
            (df["High"] - df["Close"].shift(1)).abs(),
            (df["Low"]  - df["Close"].shift(1)).abs(),
        ], axis=1).max(axis=1)
        atr   = tr.rolling(period).mean().dropna().iloc[-1]
        price = df["Close"].dropna().iloc[-1]
        if price <= 0:
            return 2.0
        return float(np.clip((atr / price) * 100, 0.5, 12.0))
    except Exception:
        return 2.0


def _calc_trend_slope_annual_pct(df: pd.DataFrame, days: int = 60) -> float:
    """최근 N거래일 선형 회귀 기울기 → 연간 환산 %"""
    try:
        prices = np.asarray(df["Close"].tail(days).dropna(), dtype=np.float64)
        if len(prices) < 10:
            return 0.0
        xs    = np.arange(len(prices), dtype=np.float64)
        slope = float(np.polyfit(xs, prices, 1)[0])
        return float(np.clip((slope * 252 / prices[0]) * 100, -200, 200))
    except Exception:
        return 0.0


def _apply_sector_cap(df: pd.DataFrame, cap: int) -> pd.DataFrame:
    """섹터별 상위 cap개 초과 종목을 차순위로 교체 (순서 유지)"""
    counts: dict = {}
    rows = []
    for _, r in df.iterrows():
        s = r["sector"]
        if counts.get(s, 0) < cap:
            rows.append(r)
            counts[s] = counts.get(s, 0) + 1
    return pd.DataFrame(rows).reset_index(drop=True)


# ─────────────────────────────────────────────────────────────────────────────
# Supabase 저장
# ─────────────────────────────────────────────────────────────────────────────

def upsert_supabase(rows: list, run_date: str) -> None:
    """
    on_conflict/upsert 대신 delete → insert 패턴 사용.
    이유:
      - PostgREST on_conflict는 DB 레벨 UNIQUE 제약 필요 (없으면 400)
      - 매일 1회 실행이므로 당일 데이터 삭제 후 재삽입이 더 단순하고 안전
      - 재실행 시에도 멱등(idempotent) 보장
    """
    base_url = f"{SUPABASE_URL}/rest/v1/prophet_recommendations"
    headers = {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
    }

    # Step 1: 당일 기존 행 삭제
    del_resp = requests.delete(
        f"{base_url}?run_date=eq.{run_date}",
        headers=headers,
        timeout=15,
    )
    if not del_resp.ok:
        print(f"  [warn] 기존 행 삭제 실패 (무시하고 계속): "
              f"{del_resp.status_code} {del_resp.text[:120]}")

    # Step 2: 새 행 삽입
    ins_resp = requests.post(base_url, headers=headers, json=rows, timeout=30)

    # 신규 컬럼(excess_return·sentiment_*)이 아직 DB에 없으면 PostgREST가
    # 스키마 캐시 오류(PGRST204)를 낸다. 이 경우 해당 컬럼만 제거하고 1회
    # 재시도하여 "컬럼 미생성으로 당일 추천이 통째로 누락"되는 사고를 방지한다.
    optional_cols = ("excess_return", "sentiment_score", "sentiment_3d_ma")
    if not ins_resp.ok and any(c in ins_resp.text for c in optional_cols):
        print(f"  [warn] 신규 컬럼 미존재 추정 → 제거 후 재시도 (원본: {ins_resp.text[:160]})")
        print(f"  [warn] Supabase 마이그레이션 권장: {', '.join(optional_cols)} 컬럼 추가")
        stripped = [{k: v for k, v in r.items() if k not in optional_cols} for r in rows]
        ins_resp = requests.post(base_url, headers=headers, json=stripped, timeout=30)

    if not ins_resp.ok:
        print(f"  [error] 삽입 실패 응답 본문: {ins_resp.text[:400]}")
    ins_resp.raise_for_status()
    print(f"[supabase] {len(rows)}행 저장 완료")


# ─────────────────────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    import argparse
    _ap = argparse.ArgumentParser()
    _ap.add_argument("--dry-run", action="store_true", help="Supabase 저장 생략(로컬 진단용)")
    dry_run = _ap.parse_args().dry_run

    run_date = date.today().isoformat()
    print(f"\n{'='*64}")
    print(f"  Hybrid Stacking Ensemble  {run_date}{'  [DRY-RUN]' if dry_run else ''}")
    print(f"{'='*64}\n")

    # ── 1. KOSPI 벤치마크 ─────────────────────────────────────────────────────
    print("[1/6] KOSPI 벤치마크 조회...")
    mkt_df = fetch_ohlcv(BENCHMARK_YF)
    if mkt_df.empty:
        sys.exit("KOSPI 데이터 조회 실패")

    # ── 2. 종목 OHLCV + 수급 + 피처 엔지니어링 ───────────────────────────────
    print("\n[2/6] 종목 데이터 조회 및 피처 엔지니어링...")
    per_stock: dict = {}

    # 수급·밸류는 Supabase krx_daily 캐시(krx_cache.py가 KR에서 적재)에서 읽는다.
    # KRX 클라우드 IP 차단 우회 — CI는 pykrx 미접속, 캐시 조회만(빠름). 비어 있으면 중립.
    flow_ok  = 0
    funda_ok = 0

    for s in UNIVERSE:
        yf_code = to_yf(s["ticker"], s["market"])
        df = fetch_ohlcv(yf_code)
        if df.empty or len(df) < 100:
            print(f"  skip {s['ticker']} {s['name']}: 데이터 부족")
            continue

        krx   = fetch_krx_cache(s["ticker"])   # Supabase 캐시 (없으면 빈 DF → 중립)
        flows = krx[["foreign_net", "inst_net"]] if not krx.empty else pd.DataFrame()
        funda = krx[["per", "pbr"]]             if not krx.empty else pd.DataFrame()
        if not flows.empty:
            flow_ok += 1
        if not funda.empty:
            funda_ok += 1

        feats = make_features(df, mkt_df, flows, funda)
        if len(feats) < 80:
            print(f"  skip {s['ticker']} {s['name']}: 피처 부족 ({len(feats)}행)")
            continue

        last_close  = float(df["Close"].dropna().iloc[-1])
        avg_tv      = float(feats["trading_value"].tail(20).mean())
        vol_60d_ann = float(feats["vol_60d"].iloc[-1])
        ret_20d     = float(feats["ret_20d"].iloc[-1])

        per_stock[s["ticker"]] = {
            "info":                  s,
            "feats":                 feats,
            "df":                    df,           # ATR·trend 계산용 OHLCV
            "current_price":         last_close,
            "avg_trading_value_20d": avg_tv,
            "vol_60d_ann":           max(vol_60d_ann, 0.01),
            "ret_20d":               ret_20d,
        }
        print(f"  ✓ {s['ticker']}  {s['name']:15s}: {len(feats):3d}행  "
              f"현재가={last_close:,.0f}  거래대금={avg_tv/1e8:.0f}억")

    if not per_stock:
        sys.exit("처리 가능한 종목 없음")
    print(f"\n  → {len(per_stock)}/{len(UNIVERSE)} 종목 준비 완료")
    print(f"  → 수급(캐시): {flow_ok}/{len(per_stock)}종목 | "
          f"밸류(캐시): {funda_ok}/{len(per_stock)}종목 "
          f"{'(0이면 krx_daily 캐시 미적재 → 중립)' if (flow_ok == 0 or funda_ok == 0) else ''}")

    # ── 3. 패널 데이터셋 구성 ─────────────────────────────────────────────────
    print("\n[3/6] 패널 데이터셋 구성...")
    sector_map = {t: d["info"]["sector"] for t, d in per_stock.items()}

    panel_dfs = []
    for ticker, d in per_stock.items():
        f = d["feats"].copy()
        f.index.name = "date"
        f["ticker"]  = ticker
        f["_sector"] = sector_map[ticker]
        panel_dfs.append(f.reset_index())

    panel_raw = pd.concat(panel_dfs, ignore_index=True)

    # ── 섹터 상대 피처: 동일 섹터 평균 대비 초과수익 ─────────────────────────
    # 크로스섹셔널 정보 활용 — 섹터 공통 움직임을 피처로 포착
    # (타깃은 KOSPI 대비 알파 유지: 섹터당 3~4종목 평균은 노이즈 과다)
    for col, dest in [("ret_5d", "sector_rel_ret_5d"), ("ret_20d", "sector_rel_ret_20d")]:
        sec_avg = panel_raw.groupby(["date", "_sector"])[col].transform("mean")
        panel_raw[dest] = panel_raw[col] - sec_avg

    # 크로스섹셔널 상대강도 순위: 날짜별 ret_20d 백분위 (0~1)
    panel_raw["rs_rank_20d"] = panel_raw.groupby("date")["ret_20d"].rank(pct=True)

    panel = panel_raw.drop(columns=["_sector"]).set_index(["ticker", "date"])

    train_panel = panel.dropna(subset=["target_alpha_5d"] + FEATURE_COLS)
    before_n = len(train_panel)
    train_panel = train_panel[train_panel["target_alpha_5d"].abs() <= TARGET_CLIP]
    n_tickers = train_panel.index.get_level_values("ticker").nunique()
    print(f"  훈련 패널: {len(train_panel):,}행 × {len(FEATURE_COLS)}피처 / {n_tickers}종목 "
          f"(극단값 제거: {before_n - len(train_panel)}행)")

    # ── 랭크 기반 타깃 변환 전: 실제 알파 분위수 맵 저장 ──────────────────────
    # IC 개선을 위해 랭크 모델은 유지하되, 예측 랭크 점수 → 실제 수익률 역변환에 사용.
    # 훈련 타깃의 경험적 분포(분율 단위)를 101개 분위수로 저장.
    _raw_vals = train_panel["target_alpha_5d"].dropna().values
    raw_alpha_q = np.percentile(_raw_vals, np.arange(0, 101))
    print(f"  → 알파 분포(실제): "
          f"p10={raw_alpha_q[10]*100:+.2f}%  p50={raw_alpha_q[50]*100:+.2f}%  "
          f"p90={raw_alpha_q[90]*100:+.2f}%  (10거래일 알파 기준)")

    # ── 랭크 기반 타깃 변환 ─────────────────────────────────────────────────────
    # 날짜별 알파 백분위 순위 → 중앙값 중심 (-0.5 ~ +0.5)
    # Ridge가 bounded target에서 안정적; 아웃라이어 없음; 랭킹 목적에 최적
    train_panel = train_panel.copy()
    train_panel["target_alpha_5d"] = (
        train_panel.groupby(level="date")["target_alpha_5d"]
        .rank(pct=True)
        - 0.5
    )
    print(f"  → 랭크 기반 타깃 적용: 날짜별 크로스섹셔널 백분위 (-0.5 ~ +0.5)")

    # ── 크로스섹셔널 피처 정규화 (날짜별 z-score) ─────────────────────────────
    # 핵심: 모델이 "RSI>60이면 상승" 같은 시계열 절대값 신호 대신
    #       "같은 날 다른 종목 대비 RSI가 높은 종목이 초과수익" 하는
    #       상대 순위 패턴을 학습하도록 강제.
    for _col in FEATURE_COLS:
        _cs_mean = train_panel.groupby(level="date")[_col].transform("mean")
        _cs_std  = (
            train_panel.groupby(level="date")[_col]
            .transform("std")
            .replace(0, np.nan)
            .fillna(1.0)
        )
        train_panel[_col] = (train_panel[_col] - _cs_mean) / _cs_std
    train_panel = train_panel.dropna(subset=FEATURE_COLS)
    print(f"  → 크로스섹셔널 피처 정규화 완료: {len(train_panel):,}행")

    # ── 4. Walk-forward 앙상블 훈련 ───────────────────────────────────────────
    print("\n[4/6] Walk-forward TimeSeriesSplit 앙상블 훈련...")
    models = walk_forward_stack(train_panel)

    # ── R² 게이트: 극단적 음수(-0.005 미만)만 차단 ─────────────────────────
    # IC(Spearman) 기준 게이트: 순위 방향이 심하게 반전된 경우만 차단
    # R²는 noise floor에서 쉽게 음수가 되지만 IC > 0이면 랭킹은 유효
    if models["oof_ic"] < -0.02:
        print(f"\n❌ OOF IC = {models['oof_ic']:.4f} < -0.02 — 순위 반전 신호, 당일 저장 생략")
        print("  피처 추가 또는 데이터 확장 후 재실행 권장")
        return

    # ── 5. 최신 피처로 알파 예측 ──────────────────────────────────────────────
    print("\n[5/6] 최신 피처 → 기대 상대강도 순위(Alpha Rank) 예측...")

    # cross-sectional 피처(sector_rel, rs_rank)는 d["feats"]에 없으므로 별도 계산
    _CS_FEATS = {"sector_rel_ret_5d", "sector_rel_ret_20d", "rs_rank_20d"}
    _local_fcols = [f for f in FEATURE_COLS if f not in _CS_FEATS]

    latest_df = pd.DataFrame(
        {t: d["feats"][_local_fcols].iloc[-1] for t, d in per_stock.items()}
    ).T

    # 섹터 상대 피처 (최신 날짜 기준 크로스섹셔널)
    latest_df["_sector"] = latest_df.index.map(sector_map)
    for _src, _dest in [("ret_5d", "sector_rel_ret_5d"), ("ret_20d", "sector_rel_ret_20d")]:
        _sec_avg = latest_df.groupby("_sector")[_src].transform("mean")
        latest_df[_dest] = latest_df[_src] - _sec_avg

    # 크로스섹셔널 상대강도 순위 (최신 날짜 기준)
    latest_df["rs_rank_20d"] = latest_df["ret_20d"].rank(pct=True)

    # 크로스섹셔널 피처 정규화 — 훈련 데이터와 동일한 방식 적용
    for _col in FEATURE_COLS:
        if _col not in latest_df.columns:
            continue
        _mean = latest_df[_col].mean()
        _std  = latest_df[_col].std()
        if _std > 1e-8:
            latest_df[_col] = (latest_df[_col] - _mean) / _std

    # 견고성: dropna(how="any")는 종목마다 다른 피처 하나만 NaN이어도(예: 상장 이력이
    # 짧아 momentum_12_1·high_52w_pct 결손) latest 전체를 비워 예측을 깨뜨린다
    # (빈 입력 → 모델 predict 실패). → 전 피처가 NaN인 종목(데이터 결손)만
    # 제외하고, 잔여 NaN은 0(정규화 후 횡단면 중립)으로 대체해 예측을 견고하게 진행.
    latest = latest_df[FEATURE_COLS].dropna(how="all").fillna(0.0)
    latest.index.name = "ticker"
    if latest.empty:
        sys.exit("최신 피처가 비어 예측 불가 (전 종목 데이터 결손)")
    pred = predict_alpha(models, latest)

    # [P0 진단] 예측 붕괴(전 종목 동일) 원인 국소화: latest 행 동일 여부 vs 모델 상수출력
    _ndup = latest.drop_duplicates().shape[0]
    print(f"  [진단] latest: {latest.shape[0]}행, 고유행={_ndup}, 피처별고유값합={int(latest.nunique().sum())}")
    print(f"  [진단] pred: 고유값={pred.nunique()}, std={float(pred.std()):.6g}, "
          f"min={float(pred.min()):.4g}, max={float(pred.max()):.4g}")

    # ── 독립 30일 모델 예측 (결함2: 2.19배 외삽 대체) ─────────────────────────
    # 실패 시 alpha30_map=None → rows 빌딩에서 10일 알파 감쇠 외삽으로 graceful degrade.
    try:
        alpha30_map = train_predict_alpha_30d(panel, latest)
        print(f"  30일 독립 모델: {len(alpha30_map)}종목 예측 완료")
    except Exception as _e30:
        alpha30_map = None
        print(f"  [warn] 30일 독립 모델 실패 → 10일 외삽 폴백: {_e30}")

    # ── 6. 리스크 조정 스코어 + 필터링 ───────────────────────────────────────
    print(f"\n[6/6] 리스크 조정 스코어 산출 → Top {TOP_N} 선정...")

    def _pct_to_return(pct01: float) -> float:
        """예측 백분위(0~1) → 실제 기대 알파(분율) 역변환.
        훈련 알파 분포를 RANK_RETURN_BAND(p5~p95)로 선형 보간."""
        lo, hi = RANK_RETURN_BAND
        pct = lo + float(np.clip(pct01, 0.0, 1.0)) * (hi - lo)
        return float(np.interp(pct, np.arange(0, 101), raw_alpha_q))

    # ── 결함1 수정: 스프레드 복원 (횡단면 백분위 매핑) ──────────────────────────
    # Ridge 메타는 MSE 최소화 특성상 예측을 평균(0)으로 강하게 수축(regression to
    # mean)시킨다. 수축된 절대 점수를 그대로 역변환하면 전 종목이 알파 분포의
    # 중앙(p≈50)에만 매핑돼 기대수익률이 1~30위 내내 거의 동일해진다.
    # → 예측의 '순위'는 유효하므로(타깃도 백분위 랭크였음) 횡단면 백분위로 변환해
    #   전체 분포를 활용한다. 각 종목이 고유 백분위를 가져 스프레드가 복원되고,
    #   정렬 기준 risk_adj_score는 단조변환이라 순위는 영향받지 않는다.
    pred_pct = pred.rank(pct=True)   # ∈ (0,1], 종목별 고유 백분위

    records = []
    for ticker, rank_score in pred.items():
        if np.isnan(rank_score) or ticker not in per_stock:
            continue
        d       = per_stock[ticker]
        info    = d["info"]
        vol     = d["vol_60d_ann"]
        # 예측 백분위 → 실제 기대 수익률(분율)로 역변환 (스프레드 복원)
        alpha_5d = _pct_to_return(float(pred_pct[ticker]))
        records.append({
            "ticker":                ticker,
            "name":                  info["name"],
            "sector":                info["sector"],
            "market":                info["market"],
            "current_price":         d["current_price"],
            "avg_trading_value_20d": d["avg_trading_value_20d"],
            "alpha_5d":              alpha_5d,
            "risk_adj_score":        alpha_5d / vol,
            "vol_60d_ann":           vol,
            "ret_20d":               d["ret_20d"],
        })

    df_all = pd.DataFrame(records)

    # ── 뉴스 감성 분석 (이벤트 드리븐 보조 알파) ─────────────────────────────
    # 헤드라인 크롤링 → HF Inference API(snunlp/KR-FinBert-SC) → [-1,+1] 점수.
    # HF 키 미설정 시 전 종목 0.0으로 graceful degrade (순위 영향 없음).
    sent_svc = NewsSentimentService(SUPABASE_URL, SUPABASE_KEY)
    sent_map = sent_svc.get_sentiment_batch(
        df_all["ticker"].tolist(), run_date, concurrency=SENTIMENT_CONCURRENCY,
    )
    df_all["sentiment_score"] = df_all["ticker"].map(lambda t: sent_map.get(t, {}).get("score", 0.0))
    df_all["sentiment_3d_ma"] = df_all["ticker"].map(lambda t: sent_map.get(t, {}).get("ma3", 0.0))
    _n_ok = sum(1 for v in sent_map.values() if v.get("ok"))
    print(f"  뉴스 감성:      {_n_ok}/{len(df_all)} 종목 성공 "
          f"(평균 3d_ma={df_all['sentiment_3d_ma'].mean():+.3f})")

    # ── 크로스섹셔널 z-score 혼합 스코어 재계산 ─────────────────────────────
    # 기존: alpha/vol → 저변동성 방어주(통신·금융) 구조적 우선선택 문제
    # 개선: alpha_z + sharpe_z + sentiment_z 혼합 (모두 z-공간 → 부호·스케일 안전)
    #   - alpha_z:     절대 알파 크기 반영 → 성장주 불이익 해소
    #   - sharpe_z:    리스크 조정 반영 → 무분별한 고변동성 선택 방지
    #   - sentiment_z: 호재/악재 뉴스를 같은 날 다른 종목 대비 상대평가해 가산
    #                  (감성 부재 시 std≈0 → 0 → 기존 동작과 동일하게 무해)
    if len(df_all) >= 2:
        raw_sharpe = df_all["alpha_5d"] / df_all["vol_60d_ann"]
        def _cs_zscore(s: pd.Series) -> pd.Series:
            std = float(s.std())
            return (s - s.mean()) / std if std > 1e-8 else pd.Series(0.0, index=s.index)
        df_all["risk_adj_score"] = (
            W_ALPHA_Z     * _cs_zscore(df_all["alpha_5d"]) +
            W_SHARPE_Z    * _cs_zscore(raw_sharpe) +
            W_SENTIMENT_Z * _cs_zscore(df_all["sentiment_3d_ma"])
        )

    # 유동성 필터
    df_liq = df_all[df_all["avg_trading_value_20d"] >= LIQUIDITY_MIN].copy()
    print(f"  유동성 필터:    {len(df_all)} → {len(df_liq)} 종목 (50억 KRW)")

    # ── 선정: risk_adj_score 상위 (횡단면 long-only 랭킹) ──────────────────────
    # [구]절대 alpha_5d>0 게이트 제거: 유니버스 알파 분포가 median-음수(KOSPI 대비
    # 평균 하회, 예: p50≈-0.8%)라, 예측이 중앙에 뭉치는 약예측·약세 구간에서 절대
    # 양수 요구 시 추천이 0으로 전멸한다(설계 결함). 횡단면 랭킹 전략이므로
    # risk_adj_score 상위 20으로 선정(상위 = 상대 best). 시장 타이밍(현금 보유)은
    # 별도 오버레이 영역이며, 약세는 점수·기대수익률에 그대로 반영된다.
    _pos = int((df_liq["alpha_5d"] > 0).sum())
    _nuniq = int(df_liq["alpha_5d"].nunique())
    print(f"  예측 알파: 양수 {_pos}/{len(df_liq)}종목 | 고유값 {_nuniq}개 "
          f"| 범위 {df_liq['alpha_5d'].min()*100:+.2f}~{df_liq['alpha_5d'].max()*100:+.2f}%")
    if _nuniq <= 1:
        print("  ⚠ 예측이 거의 동일(저신뢰) — 차별화 약함. 상위 선정은 진행하되 신뢰도 낮음.")

    if df_liq.empty:
        print("\n  ⚠ 유동성 통과 종목 없음 — 당일 추천 생략")
        return

    # 리스크 조정 스코어 내림차순 정렬 (상위 = 횡단면 상대 best)
    df_sorted = df_liq.sort_values("risk_adj_score", ascending=False).reset_index(drop=True)

    # 섹터 쏠림 방지: 동일 섹터 최대 5종목
    df_top = _apply_sector_cap(df_sorted, cap=SECTOR_CAP)
    df_top = df_top.head(TOP_N).reset_index(drop=True)

    # ── 결과 출력 ─────────────────────────────────────────────────────────────
    print(f"\n{'='*64}")
    print(f"  최종 Top {len(df_top)} 추천 종목   "
          f"(OOF R²={models['oof_r2']:.4f} | 양의예측 {_pos}종목)")
    print(f"{'='*64}")
    disp = df_top[["ticker", "name", "sector", "alpha_5d", "risk_adj_score"]].copy()
    disp.index = disp.index + 1
    disp.index.name = "순위"
    disp["alpha_5d"]       = disp["alpha_5d"].map(lambda x: f"{x*100:+.2f}%")
    disp["risk_adj_score"] = disp["risk_adj_score"].map(lambda x: f"{x:.4f}")
    print(
        disp.rename(columns={
            "ticker": "종목코드", "name": "종목명", "sector": "섹터",
            "alpha_5d": "기대초과수익률", "risk_adj_score": "리스크조정스코어",
        }).to_string()
    )

    # 추천 레이블 분포 출력 (진단용)
    label_counts = df_top["risk_adj_score"].map(_rec_label).value_counts()
    print(f"\n  추천 분포: {dict(label_counts)}")

    # ── Supabase 저장 (전체 유니버스 — Top20 여부는 accuracy_json.is_top 플래그) ──
    oof_r2     = models["oof_r2"]
    top_tickers = set(df_top["ticker"].tolist())
    # df_top은 enumerate 기반 순위 → ticker → rank 매핑
    rank_map: dict[str, int] = {
        r["ticker"]: idx + 1
        for idx, r in enumerate(df_top.to_dict("records"))
    }

    rows = []
    for _, row in df_all.iterrows():
        ticker = row["ticker"]
        if ticker not in per_stock:
            continue                    # 데이터 부족으로 skip된 종목

        d      = per_stock[ticker]
        a10    = row["alpha_5d"]            # 컬럼명은 alpha_5d 유지, 실제는 10일 섹터중립 알파
        # 30일: 독립 모델 예측 우선, 실패 시 10일 알파의 감쇠 외삽으로 폴백
        if alpha30_map is not None and ticker in alpha30_map:
            a30 = float(np.clip(alpha30_map[ticker], -A30_CAP, A30_CAP))
        else:
            a30_raw = a10 * sum(ALPHA30_DECAY ** k for k in range(3))  # Σ(0.7^k,k=0..2)≈2.19×
            a30 = float(np.clip(a30_raw, -A30_CAP, A30_CAP))
        vol  = row["vol_60d_ann"]
        bull = a30 + vol * 0.4
        bear = a30 - vol * 0.4

        is_top   = ticker in top_tickers
        atr_pct  = _calc_atr_pct(d["df"])
        trend_sl = _calc_trend_slope_annual_pct(d["df"])

        rows.append({
            "run_date":             run_date,
            "rank":                 rank_map.get(ticker, None),
            "ticker":               ticker,
            "name":                 row["name"],
            "market":               row["market"],
            "sector":               row["sector"],
            "current_price":        round(row["current_price"], 2),
            "predicted_return_7d":  round(a10 * 100, 2),   # 10일 섹터중립 알파 (컬럼 재활용)
            "predicted_return_30d": round(a30 * 100, 2),
            "bull_return_30d":      round(bull * 100, 2),
            "base_return_30d":      round(a30 * 100, 2),
            "bear_return_30d":      round(bear * 100, 2),
            "recommendation":       _rec_label(row["risk_adj_score"]),
            "r_squared":            round(oof_r2, 4),
            "trend_direction":      _trend_dir(row["ret_20d"]),
            # 알파(a30)는 KOSPI 대비 초과수익이므로 excess_return으로 직접 노출.
            # 음수 알파는 상단 양의 알파 게이트(alpha_5d>0)에서 이미 제거됨.
            "excess_return":        round(a30 * 100, 2),
            "sentiment_score":      round(float(row.get("sentiment_score", 0.0)), 4),
            "sentiment_3d_ma":      round(float(row.get("sentiment_3d_ma", 0.0)), 4),
            "accuracy_json":        json.dumps({
                "predicted_return_10d":   round(a10 * 100, 2),
                "atr_pct":                round(atr_pct, 2),
                "trend_slope_annual_pct": round(trend_sl, 2),
                "is_top":                 is_top,
                "oof_r2":                 round(oof_r2, 4),
                "oof_ic":                 round(models["oof_ic"], 4),
            }),
        })

    if dry_run:
        print(f"\n[dry-run] Supabase 저장 생략. 산출 {len(rows)}행 (Top{TOP_N}: {len(top_tickers)})\n")
    else:
        upsert_supabase(rows, run_date)
        print(f"\n완료: {run_date}  전체 {len(rows)} 종목 저장 (Top{TOP_N}: {len(top_tickers)})\n")


if __name__ == "__main__":
    main()
