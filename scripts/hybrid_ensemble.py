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
Score      : expected_alpha / 60d_annualised_volatility  (Risk-Adjusted)

Post-processing:
  - Liquidity filter : 20d average trading value >= 5B KRW
  - Sector cap       : max 5 tickers per sector in final Top 30

Output: Upserted into Supabase `prophet_recommendations` table (existing schema).
"""

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
from sklearn.metrics import r2_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

# ── 환경 변수 ─────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# ── 하이퍼파라미터 ─────────────────────────────────────────────────────────────
TARGET_DAYS   = 5               # 예측 대상: 5거래일 선행 알파
SECTOR_CAP    = 5               # 섹터당 최대 종목 수 (쏠림 방지)
LIQUIDITY_MIN = 5_000_000_000   # 20일 평균 거래대금 최소치 (50억 KRW)
CV_SPLITS     = 5               # Walk-forward 분할 수
MIN_TRAIN_ROWS = 100            # 폴드당 최소 훈련 행 수
BENCHMARK_YF  = "^KS11"        # KOSPI 벤치마크

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

    # 과거 수익률 (여러 lag)
    for lag in [1, 2, 3, 5, 10, 20]:
        f[f"ret_{lag}d"] = c.pct_change(lag)

    # 초과수익률 (alpha) lag
    for lag in [1, 5]:
        f[f"alpha_{lag}d"] = c.pct_change(lag) - mret.rolling(lag).sum()

    # 기술적 지표
    f["rsi_14"]    = _rsi(c, 14)
    f["macd_hist"] = _macd_hist(c)
    f["bb_pct"]    = _bb_pct(c)

    # 이동평균 대비 위치
    for w in [5, 20, 60]:
        f[f"vs_ma{w}"] = c / c.rolling(w).mean() - 1

    # 거래량 비율
    vol_ma20      = vol.rolling(20).mean()
    f["vol_ratio"] = vol / vol_ma20.replace(0, np.nan)

    # 실현 변동성 (연환산)
    f["vol_20d"] = ret.rolling(20).std() * np.sqrt(252)
    f["vol_60d"] = ret.rolling(60).std() * np.sqrt(252)

    # 시장 맥락
    f["market_ret_5d"]  = mret.rolling(5).sum()
    f["market_ret_20d"] = mret.rolling(20).sum()

    # 유동성 계산용 (훈련 피처 아님)
    f["trading_value"] = c * vol

    # ── 타깃: 5거래일 선행 초과수익률 (훈련 레이블) ──────────────────────────
    fwd_ret  = c.pct_change(TARGET_DAYS).shift(-TARGET_DAYS)
    fwd_mret = mret.rolling(TARGET_DAYS).sum().shift(-TARGET_DAYS)
    f["target_alpha_5d"] = fwd_ret - fwd_mret

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
    # MLP: lag 피처를 시계열 입력으로 사용 — LSTM과 동일한 단기 의존성 학습
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
    Returns: trained models dict + OOF R²
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
        X_te = X_all[te]

        # NaN 행 제거
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

        oof_lgbm[te] = lgbm.predict(X_te)
        oof_rf[te]   = rf.predict(X_te)
        oof_mlp[te]  = mlp.predict(X_te_s)
        oof_mask[te] = True

        print(f"  Fold {fold+1}/{CV_SPLITS}: train={tr.sum():,}행  test={te.sum():,}행")

    # ── Ridge 메타 모델 (L2 규제) ─────────────────────────────────────────────
    valid = oof_mask & ~np.isnan(y_all) & ~np.isnan(oof_lgbm)
    meta_X = np.column_stack([oof_lgbm[valid], oof_rf[valid], oof_mlp[valid]])
    meta_y = y_all[valid]

    meta   = Ridge(alpha=1.0)
    meta.fit(meta_X, meta_y)
    oof_r2 = r2_score(meta_y, meta.predict(meta_X)) if len(meta_y) > 10 else 0.0
    print(f"  OOF R²: {oof_r2:.4f}  (Ridge 메타 모델)")

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
        meta=meta, scaler=scaler, oof_r2=float(oof_r2),
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
    return pd.Series(
        models["meta"].predict(meta_X),
        index=latest.index,
        name="alpha_5d",
    )


# ─────────────────────────────────────────────────────────────────────────────
# 포스트 프로세싱
# ─────────────────────────────────────────────────────────────────────────────

def _rec_label(score: float) -> str:
    if score > 0.80:  return "strong_buy"
    if score > 0.35:  return "buy"
    if score > -0.20: return "hold"
    if score > -0.60: return "sell"
    return "strong_sell"


def _trend_dir(ret20: float) -> str:
    return "up" if ret20 > 0.03 else ("down" if ret20 < -0.03 else "flat")


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

def upsert_supabase(rows: list) -> None:
    headers = {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates",
    }
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/prophet_recommendations",
        headers=headers,
        json=rows,
        timeout=30,
    )
    resp.raise_for_status()
    print(f"[supabase] {len(rows)}행 upsert 완료")


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
    n_tickers = train_panel.index.get_level_values("ticker").nunique()
    print(f"  훈련 패널: {len(train_panel):,}행 × {len(FEATURE_COLS)}피처 / {n_tickers}종목")

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

    # 유동성 필터: 20일 평균 거래대금 50억 KRW 이상
    df_liq = df_all[df_all["avg_trading_value_20d"] >= LIQUIDITY_MIN].copy()
    print(f"  유동성 필터: {len(df_all)} → {len(df_liq)} 종목 (50억 KRW 기준)")

    # 리스크 조정 스코어 내림차순 정렬
    df_sorted = df_liq.sort_values("risk_adj_score", ascending=False).reset_index(drop=True)

    # 섹터 쏠림 방지: 동일 섹터 최대 5종목
    df_top = _apply_sector_cap(df_sorted, cap=SECTOR_CAP)
    df_top = df_top.head(30).reset_index(drop=True)

    # ── 결과 출력 ─────────────────────────────────────────────────────────────
    print(f"\n{'='*64}")
    print(f"  최종 Top {len(df_top)} 추천 종목   (OOF R²={models['oof_r2']:.4f})")
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

    # ── Supabase 저장 (기존 prophet_recommendations 스키마 재사용) ────────────
    oof_r2 = models["oof_r2"]
    rows = []
    for i, row in df_top.iterrows():
        a5   = row["alpha_5d"]
        a30  = a5 * 6                   # 30일 외삽 (선형)
        vol  = row["vol_60d_ann"]
        bull = a30 + vol * 0.5          # 낙관 시나리오
        bear = a30 - vol * 0.5          # 비관 시나리오

        rows.append({
            "run_date":             run_date,
            "rank":                 int(i) + 1,
            "ticker":               row["ticker"],
            "name":                 row["name"],
            "market":               row["market"],
            "sector":               row["sector"],
            "current_price":        round(row["current_price"], 2),
            "predicted_return_7d":  round(a5  * 100, 2),   # 5일 alpha → 7일 컬럼 재활용
            "predicted_return_30d": round(a30 * 100, 2),
            "bull_return_30d":      round(bull * 100, 2),
            "base_return_30d":      round(a30 * 100, 2),
            "bear_return_30d":      round(bear * 100, 2),
            "recommendation":       _rec_label(row["risk_adj_score"]),
            "r_squared":            round(max(0.0, min(1.0, oof_r2)), 4),
            "trend_direction":      _trend_dir(row["ret_20d"]),
            "accuracy_json":        None,
        })

    upsert_supabase(rows)
    print(f"\n완료: {run_date}  Top {len(rows)} 종목 저장\n")


if __name__ == "__main__":
    main()
