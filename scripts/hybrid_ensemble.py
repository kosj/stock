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
Target     : 5-day forward excess return vs KOSPI benchmark (Alpha)
Score      : expected_alpha / 60d_annualised_volatility  (Risk-Adjusted Sharpe analog)

Post-processing:
  - Liquidity filter   : 20d average trading value >= 5B KRW
  - Positive alpha gate: risk_adj_score > SCORE_FLOOR (no negative-alpha stocks in Top 30)
  - Sector cap         : max 5 tickers per sector in final Top 30

Output: Upserted into Supabase `prophet_recommendations` table.
"""

import json
import os
import sys
import time
import warnings
from datetime import date

import numpy as np
import pandas as pd
import requests
import yfinance as yf
import lightgbm as lgb
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

# ── 환경 변수 ─────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# ── 하이퍼파라미터 ─────────────────────────────────────────────────────────────
TARGET_DAYS    = 5               # 예측 대상: 5거래일 선행 알파
SECTOR_CAP     = 5               # 섹터당 최대 종목 수 (쏠림 방지)
LIQUIDITY_MIN  = 5_000_000_000   # 20일 평균 거래대금 최소치 (50억 KRW)
TARGET_CLIP    = 0.40            # 훈련 타깃 클리핑 ±40% (극단 급등락 종목 오염 방지)
PRED_CLIP      = 0.25            # 최종 예측 상한 ±25% (MLP 외삽 방지)
MIN_TRAIN_ROWS = 100            # 폴드당 최소 훈련 행 수
BENCHMARK_YF  = "^KS11"        # KOSPI 벤치마크
CV_SPLITS      = 5               # Walk-forward 분할 수
MIN_TRAIN_ROWS = 100             # 폴드당 최소 훈련 행 수
MIN_OOF_R2     = 0.01            # 메타 모델 최소 OOF R² — 미달 시 경고 출력
SCORE_FLOOR    = 0.0             # Top30 진입 최소 리스크 조정 스코어 (음의 알파 차단)
ALPHA30_DECAY  = 0.7             # 30일 외삽 감쇠 계수 — 등비급수 합: Σ(0.7^k, k=0..5) ≈ 4.0×
A30_CAP        = 0.60            # 30일 예측 최대 ±60% (KOSPI 종목 물리 상한)
BENCHMARK_YF   = "^KS11"        # KOSPI 벤치마크

# ── 종목 유니버스 ─────────────────────────────────────────────────────────────
# stock-universe.ts와 동기화 유지
UNIVERSE = [
    # 반도체
    dict(ticker="005930", name="삼성전자",             sector="반도체",  market="KOSPI"),
    dict(ticker="000660", name="SK하이닉스",           sector="반도체",  market="KOSPI"),
    dict(ticker="042700", name="한미반도체",           sector="반도체",  market="KOSDAQ"),
    dict(ticker="240810", name="원익IPS",              sector="반도체",  market="KOSDAQ"),
    # 2차전지
    dict(ticker="373220", name="LG에너지솔루션",       sector="2차전지", market="KOSPI"),
    dict(ticker="051910", name="LG화학",               sector="2차전지", market="KOSPI"),
    dict(ticker="003670", name="포스코퓨처엠",         sector="2차전지", market="KOSPI"),
    dict(ticker="247540", name="에코프로비엠",         sector="2차전지", market="KOSDAQ"),
    dict(ticker="086520", name="에코프로",             sector="2차전지", market="KOSDAQ"),
    # 자동차
    dict(ticker="005380", name="현대차",               sector="자동차",  market="KOSPI"),
    dict(ticker="000270", name="기아",                 sector="자동차",  market="KOSPI"),
    dict(ticker="012330", name="현대모비스",           sector="자동차",  market="KOSPI"),
    # IT/플랫폼
    dict(ticker="035420", name="NAVER",                sector="IT",      market="KOSPI"),
    dict(ticker="035720", name="카카오",               sector="IT",      market="KOSPI"),
    dict(ticker="323410", name="카카오뱅크",           sector="IT",      market="KOSPI"),
    # 게임
    dict(ticker="036570", name="NC소프트",             sector="게임",    market="KOSDAQ"),
    dict(ticker="259960", name="크래프톤",             sector="게임",    market="KOSPI"),
    dict(ticker="263750", name="펄어비스",             sector="게임",    market="KOSDAQ"),
    dict(ticker="293490", name="카카오게임즈",         sector="게임",    market="KOSDAQ"),
    # 엔터
    dict(ticker="041510", name="에스엠",               sector="엔터",    market="KOSDAQ"),
    dict(ticker="035900", name="JYP Ent.",             sector="엔터",    market="KOSDAQ"),
    dict(ticker="122870", name="와이지엔터테인먼트",   sector="엔터",    market="KOSDAQ"),
    dict(ticker="352820", name="하이브",               sector="엔터",    market="KOSPI"),
    # 바이오/제약
    dict(ticker="207940", name="삼성바이오로직스",     sector="바이오",  market="KOSPI"),
    dict(ticker="068270", name="셀트리온",             sector="바이오",  market="KOSPI"),
    dict(ticker="128940", name="한미약품",             sector="바이오",  market="KOSDAQ"),
    dict(ticker="145020", name="휴젤",                 sector="바이오",  market="KOSDAQ"),
    # 금융
    dict(ticker="105560", name="KB금융",               sector="금융",    market="KOSPI"),
    dict(ticker="055550", name="신한지주",             sector="금융",    market="KOSPI"),
    dict(ticker="086790", name="하나금융지주",         sector="금융",    market="KOSPI"),
    dict(ticker="032830", name="삼성생명",             sector="금융",    market="KOSPI"),
    dict(ticker="316140", name="우리금융지주",         sector="금융",    market="KOSPI"),
    # 소재
    dict(ticker="005490", name="POSCO홀딩스",          sector="소재",    market="KOSPI"),
    dict(ticker="010130", name="고려아연",             sector="소재",    market="KOSPI"),
    # 에너지/화학
    dict(ticker="096770", name="SK이노베이션",         sector="에너지",  market="KOSPI"),
    dict(ticker="010950", name="S-Oil",                sector="에너지",  market="KOSPI"),
    dict(ticker="011170", name="롯데케미칼",           sector="화학",    market="KOSPI"),
    # 방산
    dict(ticker="012450", name="한화에어로스페이스",   sector="방산",    market="KOSPI"),
    dict(ticker="047810", name="한국항공우주",         sector="방산",    market="KOSPI"),
    dict(ticker="064350", name="현대로템",             sector="방산",    market="KOSPI"),
    dict(ticker="000880", name="한화",                 sector="방산",    market="KOSPI"),
    # 건설
    dict(ticker="028260", name="삼성물산",             sector="건설",    market="KOSPI"),
    dict(ticker="000720", name="현대건설",             sector="건설",    market="KOSPI"),
    # 유통
    dict(ticker="139480", name="이마트",               sector="유통",    market="KOSPI"),
    dict(ticker="282330", name="BGF리테일",            sector="유통",    market="KOSPI"),
    # 통신
    dict(ticker="017670", name="SK텔레콤",             sector="통신",    market="KOSPI"),
    dict(ticker="030200", name="KT",                   sector="통신",    market="KOSPI"),
    # 해운/물류
    dict(ticker="011200", name="HMM",                  sector="해운",    market="KOSPI"),
    dict(ticker="000120", name="CJ대한통운",           sector="물류",    market="KOSPI"),
    # 소부장
    dict(ticker="357780", name="솔브레인",             sector="소부장",  market="KOSDAQ"),
    dict(ticker="166090", name="하나머티리얼즈",       sector="소부장",  market="KOSDAQ"),
]

# 훈련·예측에 사용할 피처 컬럼 목록
FEATURE_COLS = [
    "ret_1d", "ret_2d", "ret_3d", "ret_5d", "ret_10d", "ret_20d",
    "alpha_1d", "alpha_5d",
    "rsi_14", "macd_hist", "bb_pct",
    "vs_ma5", "vs_ma20", "vs_ma60",
    "vol_ratio", "vol_20d", "vol_60d",
    "market_ret_5d", "market_ret_20d",
]


# ─────────────────────────────────────────────────────────────────────────────
# 데이터 조회
# ─────────────────────────────────────────────────────────────────────────────

def to_yf(code: str, market: str) -> str:
    return code + (".KS" if market == "KOSPI" else ".KQ")


def fetch_ohlcv(ticker_yf: str, period: str = "2y") -> pd.DataFrame:
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

def make_features(df: pd.DataFrame, mkt: pd.DataFrame) -> pd.DataFrame:
    """
    날짜 d의 피처는 d 이전 데이터만 참조.
    target_alpha_5d 는 훈련 레이블용 (d+1 ~ d+5 참조) — 예측 시 사용 안 함.
    """
    c   = df["Close"]
    vol = df["Volume"]
    mkt_c = mkt["Close"].reindex(c.index, method="ffill")
    ret   = c.pct_change()
    mret  = mkt_c.pct_change()

    f = pd.DataFrame(index=c.index)

    for lag in [1, 2, 3, 5, 10, 20]:
        f[f"ret_{lag}d"] = c.pct_change(lag)

    for lag in [1, 5]:
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

    # 유동성 계산용 (훈련 피처 아님)
    f["trading_value"] = c * vol

    # ── 타깃: 5거래일 선행 초과수익률 ─────────────────────────────────────────
    fwd_ret  = c.pct_change(TARGET_DAYS).shift(-TARGET_DAYS)
    fwd_mret = mret.rolling(TARGET_DAYS).sum().shift(-TARGET_DAYS)
    # ±TARGET_CLIP 클리핑: 에코프로·바이오株 등 급등락 이벤트가 훈련 데이터를 오염하는 것을 방지
    f["target_alpha_5d"] = (fwd_ret - fwd_mret).clip(-TARGET_CLIP, TARGET_CLIP)

    return f.dropna(subset=["rsi_14", "vs_ma60", "vol_60d"])


# ─────────────────────────────────────────────────────────────────────────────
# 모델 팩토리
# ─────────────────────────────────────────────────────────────────────────────

def _make_base_models():
    lgbm = lgb.LGBMRegressor(
        n_estimators=300, learning_rate=0.05, max_depth=5,
        num_leaves=31, subsample=0.8, colsample_bytree=0.8,
        reg_lambda=1.0, random_state=42, verbose=-1,
    )
    rf = RandomForestRegressor(
        n_estimators=200, max_depth=6, min_samples_leaf=5,
        max_features=0.7, random_state=42, n_jobs=-1,
    )
    mlp = MLPRegressor(
        hidden_layer_sizes=(64, 32), activation="relu", solver="adam",
        max_iter=400, random_state=42, learning_rate_init=0.001,
        early_stopping=True, validation_fraction=0.1, n_iter_no_change=20,
    )
    return lgbm, rf, mlp


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
    row_dates = panel.index.get_level_values("date").to_numpy()

    X_all = panel[FEATURE_COLS].values.astype(np.float32)
    y_all = panel["target_alpha_5d"].values.astype(np.float32)

    n = len(panel)
    oof_lgbm = np.full(n, np.nan)
    oof_rf   = np.full(n, np.nan)
    oof_mlp  = np.full(n, np.nan)
    oof_mask = np.zeros(n, dtype=bool)

    scaler = StandardScaler()
    tscv   = TimeSeriesSplit(n_splits=CV_SPLITS, gap=TARGET_DAYS)

    for fold, (tr_di, te_di) in enumerate(tscv.split(np.arange(len(dates)))):
        tr_dates = set(dates[tr_di])
        te_dates = set(dates[te_di])
        tr = np.isin(row_dates, list(tr_dates))
        te = np.isin(row_dates, list(te_dates))

        X_tr_raw, y_tr_raw = X_all[tr], y_all[tr]
        X_te_raw = X_all[te]

        # NaN 행 제거 — 훈련셋
        ok_tr = ~np.isnan(y_tr_raw) & ~np.any(np.isnan(X_tr_raw), axis=1)
        X_tr, y_tr = X_tr_raw[ok_tr], y_tr_raw[ok_tr]

        # NaN 행 제거 — 테스트셋 (RF는 NaN을 처리하지 못함; OOF 인덱스 분리 관리)
        ok_te = ~np.any(np.isnan(X_te_raw), axis=1)
        X_te  = X_te_raw[ok_te]
        ok = ~np.isnan(y_tr_raw) & ~np.any(np.isnan(X_tr_raw), axis=1)
        X_tr, y_tr = X_tr_raw[ok], y_tr_raw[ok]

        if len(X_tr) < MIN_TRAIN_ROWS or len(X_te) == 0:
            print(f"  Fold {fold+1}/{CV_SPLITS}: skip (train={len(X_tr)}, test={len(X_te)})")
            continue

        X_tr_s = scaler.fit_transform(X_tr)
        X_te_s = scaler.transform(X_te)

        lgbm, rf, mlp = _make_base_models()
        lgbm.fit(X_tr, y_tr)
        rf.fit(X_tr, y_tr)
        mlp.fit(X_tr_s, y_tr)

        # te 마스크 내 NaN-없는 행에만 OOF 기록 (인덱스 정합성 유지)
        te_idx = np.where(te)[0][ok_te]
        oof_lgbm[te_idx] = lgbm.predict(X_te)
        oof_rf[te_idx]   = rf.predict(X_te)
        oof_mlp[te_idx]  = mlp.predict(X_te_s)
        oof_mask[te_idx] = True

        print(f"  Fold {fold+1}/{CV_SPLITS}: train={tr.sum():,}행  test={te.sum():,}행")

    # ── Ridge 메타 모델 ────────────────────────────────────────────────────────
    valid   = oof_mask & ~np.isnan(y_all) & ~np.isnan(oof_lgbm)
    meta_X  = np.column_stack([oof_lgbm[valid], oof_rf[valid], oof_mlp[valid]])
    meta_y  = y_all[valid]

    meta = Ridge(alpha=1.0)
    meta.fit(meta_X, meta_y)

    # OOF R²: 메타 모델을 TimeSeriesSplit 3-fold CV로 평가
    # - TimeSeriesSplit: 시계열 순서 유지 (KFold 대신 사용 — 미래 누수 방지)
    # - clip 제거: 음수 R²도 그대로 노출 (clip하면 진짜 실패를 0.0으로 마스킹함)
    if len(meta_y) > 30:
        cv_scores = cross_val_score(
            Ridge(alpha=1.0), meta_X, meta_y,
            cv=TimeSeriesSplit(n_splits=3),
            scoring="r2",
        )
        oof_r2 = float(cv_scores.mean())
    else:
        oof_r2 = 0.0

    print(f"  OOF R² (meta CV): {oof_r2:.4f}")

    # ── 모델 품질 게이트 ──────────────────────────────────────────────────────
    if oof_r2 < MIN_OOF_R2:
        print(f"  ⚠ 경고: OOF R²={oof_r2:.4f} < 최소 기준({MIN_OOF_R2})")
        print(f"  → 베이스 모델이 5일 알파를 유의미하게 예측하지 못하고 있음.")
        print(f"  → 생성된 추천 신호의 신뢰도가 낮을 수 있음. 결과를 참고 자료로만 활용 권장.")

    # ── 전체 데이터로 Base 모델 재훈련 (최종 예측용) ─────────────────────────
    ok_all   = ~np.isnan(y_all) & ~np.any(np.isnan(X_all), axis=1)
    X_full   = X_all[ok_all]
    y_full   = y_all[ok_all]
    X_full_s = scaler.fit_transform(X_full)

    lgbm_f, rf_f, mlp_f = _make_base_models()
    lgbm_f.fit(X_full, y_full)
    rf_f.fit(X_full, y_full)
    mlp_f.fit(X_full_s, y_full)

    return dict(
        lgbm=lgbm_f, rf=rf_f, mlp=mlp_f,
        meta=meta, scaler=scaler, oof_r2=oof_r2,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 예측
# ─────────────────────────────────────────────────────────────────────────────

def predict_alpha(models: dict, latest: pd.DataFrame) -> pd.Series:
    """latest: shape (n_tickers, n_features) → 5일 기대 알파 Series"""
    X  = latest[FEATURE_COLS].values.astype(np.float32)
    Xs = models["scaler"].transform(X)
    p_lgbm = models["lgbm"].predict(X)
    p_rf   = models["rf"].predict(X)
    p_mlp  = models["mlp"].predict(Xs)
    meta_X = np.column_stack([p_lgbm, p_rf, p_mlp])
    raw = models["meta"].predict(meta_X)
    # MLP는 훈련 범위 밖으로 외삽 가능 — ±PRED_CLIP으로 물리적 상한 적용
    clipped = np.clip(raw, -PRED_CLIP, PRED_CLIP)
    return pd.Series(clipped, index=latest.index, name="alpha_5d")


# ─────────────────────────────────────────────────────────────────────────────
# 포스트 프로세싱
# ─────────────────────────────────────────────────────────────────────────────

def _rec_label(score: float) -> str:
    """
    risk_adj_score = alpha_5d(fraction) / vol_60d_ann(fraction) 기준 추천 레이블.

    임계값 근거 (vol_60d_ann = 35% 가정):
      strong_buy : score > 0.15  → alpha_5d > 5.25%
      buy        : score > 0.06  → alpha_5d > 2.1%
      hold       : score > -0.02 → 미미한 양/음 알파 (±0.7%)
      sell       : score > -0.10 → alpha_5d < -3.5%
      strong_sell: else          → alpha_5d < -5.25%

    기존 임계값(0.80, 0.35)은 연환산 Sharpe 17~40배에 해당 → 사실상 모든 종목이 "hold"
    """
    if score > 0.15:   return "strong_buy"
    if score > 0.06:   return "buy"
    if score > -0.02:  return "hold"
    if score > -0.10:  return "sell"
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
    if not ins_resp.ok:
        print(f"  [error] 삽입 실패 응답 본문: {ins_resp.text[:400]}")
    ins_resp.raise_for_status()
    print(f"[supabase] {len(rows)}행 저장 완료")


# ─────────────────────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    run_date = date.today().isoformat()
    print(f"\n{'='*64}")
    print(f"  Hybrid Stacking Ensemble  {run_date}")
    print(f"{'='*64}\n")

    # ── 1. KOSPI 벤치마크 ─────────────────────────────────────────────────────
    print("[1/6] KOSPI 벤치마크 조회...")
    mkt_df = fetch_ohlcv(BENCHMARK_YF)
    if mkt_df.empty:
        sys.exit("KOSPI 데이터 조회 실패")

    # ── 2. 종목 OHLCV + 피처 엔지니어링 ──────────────────────────────────────
    print("\n[2/6] 종목 데이터 조회 및 피처 엔지니어링...")
    per_stock: dict = {}

    for s in UNIVERSE:
        yf_code = to_yf(s["ticker"], s["market"])
        df = fetch_ohlcv(yf_code)
        if df.empty or len(df) < 100:
            print(f"  skip {s['ticker']} {s['name']}: 데이터 부족")
            continue

        feats = make_features(df, mkt_df)
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

    # ── 3. 패널 데이터셋 구성 ─────────────────────────────────────────────────
    print("\n[3/6] 패널 데이터셋 구성...")
    panel_dfs = []
    for ticker, d in per_stock.items():
        f = d["feats"].copy()
        f.index.name = "date"
        f["ticker"] = ticker
        panel_dfs.append(f.reset_index())

    panel = pd.concat(panel_dfs, ignore_index=True).set_index(["ticker", "date"])
    train_panel = panel.dropna(subset=["target_alpha_5d"] + FEATURE_COLS)
    # 타깃 클리핑은 make_features에서 이미 적용됨; 여기서는 잔여 NaN만 확인
    before_n = len(train_panel)
    train_panel = train_panel[train_panel["target_alpha_5d"].abs() <= TARGET_CLIP]
    n_tickers = train_panel.index.get_level_values("ticker").nunique()
    print(f"  훈련 패널: {len(train_panel):,}행 × {len(FEATURE_COLS)}피처 / {n_tickers}종목 "
          f"(극단값 제거: {before_n - len(train_panel)}행)")

    # ── 4. Walk-forward 앙상블 훈련 ───────────────────────────────────────────
    print("\n[4/6] Walk-forward TimeSeriesSplit 앙상블 훈련...")
    models = walk_forward_stack(train_panel)

    # ── 5. 최신 피처로 알파 예측 ──────────────────────────────────────────────
    print("\n[5/6] 최신 피처 → 5일 기대 초과수익률(Alpha) 예측...")
    latest = (
        pd.DataFrame(
            {t: d["feats"][FEATURE_COLS].iloc[-1] for t, d in per_stock.items()}
        )
        .T.dropna()
    )
    latest.index.name = "ticker"
    pred = predict_alpha(models, latest)

    # ── 6. 리스크 조정 스코어 + 필터링 ───────────────────────────────────────
    print("\n[6/6] 리스크 조정 스코어 산출 → Top 30 선정...")
    records = []
    for ticker, alpha_5d in pred.items():
        if np.isnan(alpha_5d) or ticker not in per_stock:
            continue
        d    = per_stock[ticker]
        info = d["info"]
        vol  = d["vol_60d_ann"]
        records.append({
            "ticker":                ticker,
            "name":                  info["name"],
            "sector":                info["sector"],
            "market":                info["market"],
            "current_price":         d["current_price"],
            "avg_trading_value_20d": d["avg_trading_value_20d"],
            "alpha_5d":              float(alpha_5d),
            "risk_adj_score":        float(alpha_5d) / vol,
            "vol_60d_ann":           vol,
            "ret_20d":               d["ret_20d"],
        })

    df_all = pd.DataFrame(records)

    # 유동성 필터
    df_liq = df_all[df_all["avg_trading_value_20d"] >= LIQUIDITY_MIN].copy()
    print(f"  유동성 필터:    {len(df_all)} → {len(df_liq)} 종목 (50억 KRW)")

    # ── 양의 알파 게이트: 음수 risk_adj_score 종목 Top30 진입 차단 ─────────────
    # 모델이 음의 초과수익률을 예측하는 종목을 추천 목록에서 제외.
    # SCORE_FLOOR=0.0: 최소한 시장 대비 양의 초과수익률을 예측한 종목만 포함.
    df_pos = df_liq[df_liq["risk_adj_score"] > SCORE_FLOOR].copy()
    print(f"  양의 알파 필터: {len(df_liq)} → {len(df_pos)} 종목 (score > {SCORE_FLOOR})")

    if df_pos.empty:
        print("\n  ⚠ 양의 알파 예측 종목 없음 — 당일 추천 생략")
        print("  → 모델이 전 종목에 대해 음의 초과수익률 예측 중.")
        print("  → 시장 전반적 하락 국면 또는 모델 재훈련 필요.")
        return

    # 리스크 조정 스코어 내림차순 정렬
    df_sorted = df_pos.sort_values("risk_adj_score", ascending=False).reset_index(drop=True)

    # 섹터 쏠림 방지: 동일 섹터 최대 5종목
    df_top = _apply_sector_cap(df_sorted, cap=SECTOR_CAP)
    df_top = df_top.head(30).reset_index(drop=True)

    # ── 결과 출력 ─────────────────────────────────────────────────────────────
    print(f"\n{'='*64}")
    print(f"  최종 Top {len(df_top)} 추천 종목   "
          f"(OOF R²={models['oof_r2']:.4f} | 양의알파풀={len(df_pos)}종목)")
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

    # ── Supabase 저장 (전체 유니버스 — Top30 여부는 accuracy_json.is_top 플래그) ──
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
        a5     = row["alpha_5d"]
        # 평균회귀 감쇠 외삽: decay=0.7 등비급수 합 ≈ 4.0×, 물리 상한 ±60%
        a30_raw = a5 * sum(ALPHA30_DECAY ** k for k in range(6))
        a30  = float(np.clip(a30_raw, -A30_CAP, A30_CAP))
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
            "predicted_return_7d":  round(a5  * 100, 2),
            "predicted_return_30d": round(a30 * 100, 2),
            "bull_return_30d":      round(bull * 100, 2),
            "base_return_30d":      round(a30 * 100, 2),
            "bear_return_30d":      round(bear * 100, 2),
            "recommendation":       _rec_label(row["risk_adj_score"]),
            "r_squared":            round(oof_r2, 4),
            "trend_direction":      _trend_dir(row["ret_20d"]),
            "accuracy_json":        json.dumps({
                "predicted_return_5d":    round(a5  * 100, 2),
                "atr_pct":                round(atr_pct, 2),
                "trend_slope_annual_pct": round(trend_sl, 2),
                "is_top":                 is_top,
                "oof_r2":                 round(oof_r2, 4),
            }),
        })

    upsert_supabase(rows, run_date)
    print(f"\n완료: {run_date}  전체 {len(rows)} 종목 저장 (Top30: {len(top_tickers)})\n")


if __name__ == "__main__":
    main()
