# =============================================================================
# 하이브리드 스태킹 앙상블 (Hybrid Stacking Ensemble)
#
# 목적:
#   펀더멘털(재무) + 기술적 지표 + 거시경제 + 수급 4가지 데이터를 융합하여
#   주식의 다음 날 상승(1) / 하락(0)을 예측하는 2-Layer 앙상블 시스템
#
# 아키텍처:
#   [Layer 1-A] StackingTrendModel  → 장기 펀더멘털 트렌드 예측값
#               (Ridge + RandomForest + GradientBoosting → Ridge 메타)
#   [Layer 1-B] GRU(PyTorch)        → 단기 파동 상승 확률
#                 ↓ concatenate + 거시경제
#   [Layer 2  ] LightGBM            → 최종 매수 확률 (0.0 ~ 1.0)
#
# 실행 방법:
#   pip install torch lightgbm scikit-learn pandas numpy
#   python hybrid_stacking_ensemble.py
# =============================================================================

import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import logging

# ── 전처리 / 스태킹 베이스 모델 (Layer 1-A) ──────────────────────────────────
from sklearn.preprocessing import RobustScaler, MinMaxScaler
from sklearn.metrics import roc_auc_score, accuracy_score, classification_report
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.base import clone
from sklearn.model_selection import KFold

# ── PyTorch GRU (Layer 1-B) ─────────────────────────────────────────────────
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

# ── LightGBM (Layer 2) ──────────────────────────────────────────────────────
import lightgbm as lgb

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# =============================================================================
# [CONFIG] 전역 하이퍼파라미터 딕셔너리
#
# 설계 원칙:
#   - 하드코딩 근절: 모든 실험 파라미터를 한 곳에서 관리
#   - 재현성 보장: random_seed 고정
#   - 모듈 간 결합 최소화: 각 클래스는 CONFIG를 주입받아 동작
# =============================================================================
CONFIG: Dict = {
    "data": {
        "n_days": 756,       # 약 3년치 영업일 (252 거래일/년 × 3)
        "seq_len": 20,       # GRU 입력 시퀀스 길이 = 한 달 거래일
        "train_ratio": 0.70,
        "val_ratio": 0.15,
        "test_ratio": 0.15,
        "random_seed": 42,
    },
    "preprocess": {
        # ── RobustScaler 적용 대상 ────────────────────────────────────────
        # 근거: 이상치(급등락, 어닝 서프라이즈)가 많고 단위가 다양한 피처군
        #       중앙값(median)과 IQR 기반 스케일링 → 이상치 영향 최소화
        "robust_cols": [
            "open", "high", "low", "close", "volume",       # OHLCV
            "macd", "macd_signal",                           # 음수 가능 지표
            "bb_upper", "bb_lower", "bb_mid",               # 볼린저밴드 (가격 단위)
            "per", "pbr", "operating_profit", "debt_ratio", # 펀더멘털
            "foreign_ratio", "institution_net_buy",          # 수급
            "interest_rate", "usd_krw", "vix",              # 거시경제
        ],
        # ── MinMaxScaler 적용 대상 ────────────────────────────────────────
        # 근거: 설계상 0~100 범위가 보장된 지표 → [0,1] 정규화가 자연스러움
        #       RobustScaler 적용 시 경계 의미가 손상됨
        "minmax_cols": [
            "rsi",             # 0~100 (과매수=70+, 과매도=30-)
            "stoch_k",         # 0~100 (Stochastic %K)
            "stoch_d",         # 0~100 (Stochastic %D, %K의 3일 이동평균)
            "williams_r_norm", # 원래 -100~0 → 부호 반전해 0~100으로 변환
        ],
    },
    "stacking_trend": {
        # StackingTrendModel (Layer 1-A) 하이퍼파라미터
        # 베이스 모델 3종: 선형(Ridge) + 배깅(RandomForest) + 부스팅(GradientBoosting)
        # → 각 모델이 포착하지 못하는 패턴을 상호 보완
        "ridge_alpha":    1.0,          # Ridge 정규화 강도 (클수록 단순한 모델)
        "rf_n_estimators": 100,         # RandomForest 트리 수
        "rf_max_depth":   5,            # 과적합 방지를 위한 깊이 제한
        "gb_n_estimators": 100,         # GradientBoosting 반복 횟수
        "gb_max_depth":   3,            # 부스팅은 얕은 트리가 기본 원칙
        "gb_learning_rate": 0.05,       # 작을수록 안정적이나 느림
        "n_folds":        5,            # OOF K-Fold 분할 수 (시계열: shuffle=False)
        "meta_alpha":     1.0,          # 메타 Ridge 정규화 강도
        "random_seed":    42,
    },
    "gru": {
        "hidden_size": 128,
        "num_layers": 2,
        "dropout": 0.3,      # 금융 데이터의 낮은 SNR 환경에서 정규화 핵심
        "batch_size": 64,
        "epochs": 30,
        "lr": 1e-3,
        "weight_decay": 1e-4,
        "patience": 10,      # Early stopping: 10 에폭 연속 개선 없으면 종료
    },
    "lgbm": {
        # LightGBM 선택 이유: Leaf-wise 성장 → 소규모 금융 데이터에서 정확
        # XGBoost 대비 메모리 효율적이고 학습 속도 2~10배 빠름
        "objective": "binary",
        "metric": "auc",
        "learning_rate": 0.05,
        "num_leaves": 31,
        "n_estimators": 500,
        "early_stopping_rounds": 50,
        "verbose": -1,
        "random_state": 42,
    },
}


# =============================================================================
# [Phase 1] DummyDataGenerator
#
# 설계 의도:
#   - 실제 데이터 없이도 즉시 실행 가능한 자급자족 코드
#   - 실제 구현 시 이 클래스의 generate() 반환 포맷만 맞추면 전체 파이프라인 재사용
#   - GBM(기하 브라운 운동)으로 주가 생성 → 로그 정규 분포 특성 반영
# =============================================================================
class DummyDataGenerator:
    """
    4가지 데이터 소스를 시뮬레이션하는 더미 데이터 생성기

    반환 포맷 (pd.DataFrame, index=영업일 DatetimeIndex):
      OHLCV + 기술적 지표 + 펀더멘털 + 수급 + 거시경제 + target(0/1)
    """

    def __init__(self, n_days: int = 756, seed: int = 42):
        self.n_days = n_days
        np.random.seed(seed)

    def generate(self) -> pd.DataFrame:
        """모든 피처를 하나의 DataFrame으로 반환"""
        dates = pd.bdate_range(end=datetime.today(), periods=self.n_days)
        df = pd.DataFrame(index=dates)
        df.index.name = "date"

        # ── 1. OHLCV: 기하 브라운 운동(GBM) 시뮬레이션 ──────────────────────
        # 실제 주가는 로그 정규 분포를 따르므로 GBM이 가장 현실적
        #   dS = μ·S·dt + σ·S·dW  →  S(t) = S(0)·exp((μ - σ²/2)t + σ·W(t))
        log_ret = np.random.normal(0.0003, 0.018, self.n_days)  # 일평균 수익률 0.03%, 변동성 1.8%
        close   = 50_000 * np.exp(np.cumsum(log_ret))           # 초기 주가 50,000원
        noise   = lambda scale: np.random.uniform(-scale, scale, self.n_days)
        df["close"]  = close
        df["open"]   = close * (1 + noise(0.005))
        df["high"]   = close * (1 + np.abs(np.random.normal(0, 0.008, self.n_days)))
        df["low"]    = close * (1 - np.abs(np.random.normal(0, 0.008, self.n_days)))
        df["volume"] = np.random.lognormal(15, 0.5, self.n_days).astype(int)

        # ── 2. 기술적 지표 ───────────────────────────────────────────────────
        # RSI (0~100): Wilder's Smoothing EMA 방식
        df["rsi"] = self._rsi(df["close"], 14)

        # MACD: 단기(12) - 장기(26) EMA 차이, 음수 가능
        ema12 = df["close"].ewm(span=12, adjust=False).mean()
        ema26 = df["close"].ewm(span=26, adjust=False).mean()
        df["macd"]        = ema12 - ema26
        df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()

        # 볼린저 밴드: 20일 이동평균 ± 2σ
        df["bb_mid"]   = df["close"].rolling(20).mean()
        df["bb_upper"] = df["bb_mid"] + 2 * df["close"].rolling(20).std()
        df["bb_lower"] = df["bb_mid"] - 2 * df["close"].rolling(20).std()

        # Stochastic (0~100): 최근 14일 중 오늘 종가의 상대적 위치
        lo14 = df["low"].rolling(14).min()
        hi14 = df["high"].rolling(14).max()
        df["stoch_k"] = 100 * (df["close"] - lo14) / (hi14 - lo14 + 1e-9)
        df["stoch_d"] = df["stoch_k"].rolling(3).mean()

        # Williams %R: 원래 -100~0 → 부호 반전 후 0~100 정규화
        df["williams_r_norm"] = 100 + (
            100 * (hi14 - df["close"]) / (hi14 - lo14 + 1e-9)
        )

        # ── 3. 펀더멘털 (분기별 공시 → forward fill) ─────────────────────────
        # 재무제표는 분기 1회 공시되므로 다음 공시일까지 직전 값을 유지
        n_q = self.n_days // 63 + 2  # 분기당 약 63 영업일
        q_idx = np.linspace(0, self.n_days - 1, n_q, dtype=int)

        fundamentals = {
            "per":              np.random.uniform(8, 30, n_q),
            "pbr":              np.random.uniform(0.5, 4.0, n_q),
            "operating_profit": np.random.normal(5e11, 1e11, n_q),  # 5천억 ± 1천억 원
            "debt_ratio":       np.random.uniform(30, 200, n_q),    # %
        }
        for col, vals in fundamentals.items():
            s = pd.Series(np.nan, index=range(self.n_days))
            s.iloc[q_idx[:len(vals)]] = vals
            df[col] = s.ffill().values

        # ── 4. 수급 데이터 ───────────────────────────────────────────────────
        # 외국인 보유 비율: 누적 랜덤워크로 서서히 변하는 특성 반영
        df["foreign_ratio"]       = np.clip(
            np.cumsum(np.random.normal(0, 0.1, self.n_days)) + 35, 10, 70
        )
        df["institution_net_buy"] = np.random.normal(0, 5e9, self.n_days)  # 기관 순매수 (원)

        # ── 5. 거시경제 지표 ─────────────────────────────────────────────────
        df["interest_rate"] = np.clip(
            np.cumsum(np.random.normal(0, 0.02, self.n_days)) + 3.5, 0.5, 7.0
        )
        df["usd_krw"] = np.clip(
            np.cumsum(np.random.normal(0, 2.5, self.n_days)) + 1300, 1050, 1550
        )
        df["vix"] = np.abs(np.random.normal(20, 8, self.n_days))

        # ── 6. 타깃 레이블 (다음 날 종가 > 오늘 종가 → 1) ───────────────────
        df["target"] = (df["close"].shift(-1) > df["close"]).astype(int)

        df.dropna(inplace=True)
        logger.info(
            f"[DummyDataGenerator] 생성 완료: {len(df)}행 × {len(df.columns)}열"
        )
        return df

    @staticmethod
    def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
        """Wilder's EMA 방식 RSI 계산"""
        delta = series.diff()
        gain  = delta.clip(lower=0).ewm(com=period - 1, adjust=False).mean()
        loss  = (-delta.clip(upper=0)).ewm(com=period - 1, adjust=False).mean()
        return 100 - (100 / (1 + gain / (loss + 1e-9)))


# =============================================================================
# [Phase 2] HybridPreprocessor
#
# 설계 의도:
#   - 피처 특성별 최적 스케일러를 분리 적용
#   - fit은 훈련 데이터에만 → 데이터 누수(data leakage) 방지
#   - transform은 훈련/검증/테스트 모두에 재사용
# =============================================================================
class HybridPreprocessor:
    """
    이중 스케일링 파이프라인

    RobustScaler 적용 피처:
      단위가 크거나 이상치 多 → 중앙값·IQR 기반 스케일링
    MinMaxScaler 적용 피처:
      0~100 경계가 명확한 지표 → [0,1] 선형 압축
    """

    def __init__(self, config: Dict):
        self.cfg           = config["preprocess"]
        self.robust_scaler = RobustScaler()
        self.minmax_scaler = MinMaxScaler(feature_range=(0, 1))
        self.robust_cols: List[str] = []
        self.minmax_cols: List[str] = []
        self._fitted = False

    def fit(self, df: pd.DataFrame) -> "HybridPreprocessor":
        """훈련 데이터 기준으로 두 스케일러 동시 학습"""
        # 설정에 있지만 실제 df에 없는 컬럼은 자동 제외 (방어적 설계)
        self.robust_cols = [c for c in self.cfg["robust_cols"] if c in df.columns]
        self.minmax_cols = [c for c in self.cfg["minmax_cols"] if c in df.columns]

        self.robust_scaler.fit(df[self.robust_cols])
        self.minmax_scaler.fit(df[self.minmax_cols])
        self._fitted = True
        logger.info(
            f"[Preprocessor] fit 완료 | "
            f"Robust {len(self.robust_cols)}개, MinMax {len(self.minmax_cols)}개"
        )
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """학습된 스케일러로 변환 (원본 DataFrame 불변)"""
        assert self._fitted, "transform() 전에 fit()을 호출해야 합니다."
        out = df.copy()
        out[self.robust_cols] = self.robust_scaler.transform(df[self.robust_cols])
        out[self.minmax_cols] = self.minmax_scaler.transform(df[self.minmax_cols])
        return out

    def fit_transform(self, df: pd.DataFrame) -> pd.DataFrame:
        return self.fit(df).transform(df)

    @property
    def feature_cols(self) -> List[str]:
        """스케일링된 피처 컬럼 목록 (target 제외)"""
        return self.robust_cols + self.minmax_cols


# =============================================================================
# [Phase 3] StackingTrendModel — Layer 1-A (하이브리드 스태킹 앙상블)
#
# Prophet 대체 이유:
#   - Prophet: 단일 가법(additive) 시계열 분해 모델
#     → 비선형 펀더멘털 상호작용 포착 한계, 금융 구조 변화에 취약
#   - 스태킹 앙상블: 이질적인 3개 베이스 모델의 예측을 Ridge 메타 모델로 결합
#     → 선형·비선형·부스팅 관점 동시 활용, 편향-분산 트레이드오프 개선
#
# OOF(Out-of-Fold) 전략:
#   K-Fold에서 베이스 모델이 "보지 않은 데이터"에 대한 예측만 수집
#   → 메타 모델이 베이스 모델의 과적합 예측값으로 학습하는 데이터 누수 방지
#
# 구조:
#   Base Layer → Ridge        : 선형 추세 + L2 정규화 (안정적 기저 예측)
#             → RandomForest  : 비선형 패턴 + 배깅으로 분산 감소
#             → GradientBoost : 잔차 반복 학습으로 정밀 예측
#                  ↓ OOF 예측 행렬 (n × 3)
#   Meta Layer → Ridge        : 베이스 모델 결합 → 과적합 방지
# =============================================================================
class StackingTrendModel:
    """
    하이브리드 스태킹 앙상블 기반 장기 트렌드 추출 모델 (Layer 1-A)

    입력 피처:
      - 펀더멘털: PER, PBR, 영업이익, 부채비율
      - 수급/거시: 외국인 비율, 금리, 환율
      - 시간 인코딩: 연도, 월, 연간 일수 (계절성 대리 변수)

    출력 피처 (→ Layer 2 메타 입력):
      - trend_pred  : 스태킹 앙상블 예측 종가 (역스케일링)
      - trend_ratio : 예측 종가 / 실제 종가 비율 (주가 수준 무관화)
    """

    INPUT_COLS = [
        "per", "pbr", "operating_profit", "debt_ratio",  # 펀더멘털
        "foreign_ratio", "interest_rate", "usd_krw",     # 수급 + 거시경제
    ]

    def __init__(self, config: Dict):
        cfg = config["stacking_trend"]

        # 이질적 3종 베이스 모델: 각기 다른 귀납 편향 → 오류 상호 보완
        self._base_specs = [
            ("ridge", Ridge(alpha=cfg["ridge_alpha"])),
            ("rf", RandomForestRegressor(
                n_estimators=cfg["rf_n_estimators"],
                max_depth=cfg["rf_max_depth"],
                random_state=cfg["random_seed"],
                n_jobs=-1,
            )),
            ("gb", GradientBoostingRegressor(
                n_estimators=cfg["gb_n_estimators"],
                max_depth=cfg["gb_max_depth"],
                learning_rate=cfg["gb_learning_rate"],
                random_state=cfg["random_seed"],
            )),
        ]
        self.base_models  = [(n, clone(m)) for n, m in self._base_specs]
        self.meta_model   = Ridge(alpha=cfg["meta_alpha"])
        self.price_scaler = RobustScaler()  # 종가 정규화 (역변환 위해 보관)
        self.n_folds      = cfg["n_folds"]
        self._fitted      = False

    def _build_X(self, df: pd.DataFrame) -> np.ndarray:
        """
        피처 행렬 구성
        시간 피처(연도, 월, 연간 일수)로 Prophet Fourier 계절성을 단순 대체
        → 모델이 장기 추세 변화와 계절 패턴을 동시에 학습 가능
        """
        avail = [c for c in self.INPUT_COLS if c in df.columns]
        X = df[avail].copy()
        X["year"]        = df.index.year
        X["month"]       = df.index.month
        X["day_of_year"] = df.index.dayofyear
        return X.values.astype(float)

    def fit(self, df: pd.DataFrame) -> "StackingTrendModel":
        """
        OOF K-Fold Stacking 학습 절차:
          1. K-Fold로 훈련 데이터 분할 (시계열 → shuffle=False)
          2. 각 Fold: clone된 베이스 모델을 K-1 Fold로 학습 → 나머지 Fold 예측
          3. 전체 OOF 예측 행렬(n × 3)으로 Ridge 메타 모델 학습
          4. 베이스 모델을 전체 훈련 데이터로 재학습 (추론 시 사용)
        """
        X    = self._build_X(df)
        y    = df["close"].values.reshape(-1, 1)
        y_sc = self.price_scaler.fit_transform(y).ravel()

        n_base   = len(self.base_models)
        oof_pred = np.zeros((len(X), n_base))

        # ── OOF 예측 수집 ─────────────────────────────────────────────────
        kf = KFold(n_splits=self.n_folds, shuffle=False)
        for _, (tr_idx, va_idx) in enumerate(kf.split(X)):
            for i, (_, base_m) in enumerate(self.base_models):
                m = clone(base_m)
                m.fit(X[tr_idx], y_sc[tr_idx])
                oof_pred[va_idx, i] = m.predict(X[va_idx])

        # ── 메타 모델 학습 ─────────────────────────────────────────────────
        self.meta_model.fit(oof_pred, y_sc)

        # ── 베이스 모델 전체 재학습 (추론용) ──────────────────────────────
        # OOF 단계의 clone들은 일부 폴드 데이터만 학습 → 전체 데이터로 재학습 필요
        self.base_models = [(n, clone(m)) for n, m in self._base_specs]
        for _, m in self.base_models:
            m.fit(X, y_sc)

        self._fitted = True
        logger.info(
            f"[StackingTrendModel] 학습 완료 | "
            f"베이스: {[n for n, _ in self.base_models]} | "
            f"{self.n_folds}-Fold OOF Stacking"
        )
        return self

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        반환 피처:
          trend_pred  : 스태킹 앙상블 예측 종가 (원본 스케일 역변환)
          trend_ratio : 예측 종가 / 실제 종가 비율
                        → 절대 주가 수준에 무관한 메타 피처 (스케일 무관화)
        """
        assert self._fitted, "fit()을 먼저 호출해야 합니다."
        X = self._build_X(df)

        base_preds  = np.column_stack([m.predict(X) for _, m in self.base_models])
        meta_scaled = self.meta_model.predict(base_preds).reshape(-1, 1)
        trend_pred  = self.price_scaler.inverse_transform(meta_scaled).ravel()

        result = pd.DataFrame(index=df.index)
        result["trend_pred"]  = trend_pred
        result["trend_ratio"] = trend_pred / (df["close"].values + 1e-9)
        return result


# =============================================================================
# [Phase 4] GRUWaveModel — Layer 1-B (PyTorch)
#
# LSTM 대신 GRU를 선택한 이유:
#   - GRU는 LSTM보다 파라미터 수가 약 25% 적음 → 소규모 금융 데이터에서 유리
#   - Update Gate + Reset Gate 두 가지로 LSTM의 3-Gate 역할 대체
#   - 단기(20일) 시계열에서 LSTM과 성능 차이 미미하나 학습 속도 빠름
# =============================================================================

class StockSequenceDataset(Dataset):
    """
    슬라이딩 윈도우 방식 시계열 Dataset
    idx번째 샘플 = [idx, idx+seq_len) 구간의 피처 → idx+seq_len 시점의 레이블
    """

    def __init__(self, features: np.ndarray, targets: np.ndarray, seq_len: int):
        self.X       = torch.tensor(features, dtype=torch.float32)
        self.y       = torch.tensor(targets,  dtype=torch.float32)
        self.seq_len = seq_len

    def __len__(self) -> int:
        return len(self.X) - self.seq_len

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        return self.X[idx: idx + self.seq_len], self.y[idx + self.seq_len]


class _GRUNet(nn.Module):
    """
    2-Layer GRU 분류기

    구조: GRU(2 layers) → Dropout → Linear(1) → Sigmoid
    입력: (batch, seq_len, input_size)
    출력: (batch,) — 상승 확률 [0, 1]
    """

    def __init__(self, input_size: int, hidden_size: int, num_layers: int, dropout: float):
        super().__init__()
        self.gru = nn.GRU(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            # num_layers > 1일 때만 레이어 간 dropout 적용 (단일 레이어엔 불필요)
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.fc      = nn.Linear(hidden_size, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)                  # (batch, seq_len, hidden)
        out    = self.dropout(out[:, -1, :])  # 마지막 타임스텝만 사용 (시퀀스 요약)
        return torch.sigmoid(self.fc(out)).squeeze(-1)  # (batch,)


class GRUWaveModel:
    """GRU 기반 단기 파동 예측 모델 래퍼 (Layer 1-B)"""

    def __init__(self, config: Dict):
        self.cfg     = config["gru"]
        self.seq_len = config["data"]["seq_len"]
        self.device  = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model: Optional[_GRUNet] = None
        logger.info(f"[GRUWaveModel] 디바이스: {self.device}")

    def fit(
        self,
        train_X: np.ndarray, train_y: np.ndarray,
        val_X:   np.ndarray, val_y:   np.ndarray,
    ) -> "GRUWaveModel":
        """
        Early Stopping 포함 학습
        - BCELoss: 이진 분류 표준 손실
        - AdamW: weight decay를 L2 정규화와 분리 → 더 효과적인 정규화
        - Gradient Clipping(max_norm=1.0): 금융 데이터의 급격한 gradient 폭발 방지
        """
        input_size  = train_X.shape[1]
        self.model  = _GRUNet(
            input_size, self.cfg["hidden_size"],
            self.cfg["num_layers"], self.cfg["dropout"],
        ).to(self.device)

        train_loader = DataLoader(
            StockSequenceDataset(train_X, train_y, self.seq_len),
            batch_size=self.cfg["batch_size"], shuffle=True,
        )
        val_loader = DataLoader(
            StockSequenceDataset(val_X, val_y, self.seq_len),
            batch_size=self.cfg["batch_size"], shuffle=False,
        )

        criterion = nn.BCELoss()
        optimizer = torch.optim.AdamW(
            self.model.parameters(),
            lr=self.cfg["lr"],
            weight_decay=self.cfg["weight_decay"],
        )

        best_val_loss  = float("inf")
        patience_count = 0
        best_state     = None

        for epoch in range(self.cfg["epochs"]):
            # ── 훈련 ────────────────────────────────────────────────────────
            self.model.train()
            train_loss = 0.0
            for X_b, y_b in train_loader:
                X_b, y_b = X_b.to(self.device), y_b.to(self.device)
                optimizer.zero_grad()
                pred  = self.model(X_b)
                loss  = criterion(pred, y_b)
                loss.backward()
                nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
                optimizer.step()
                train_loss += loss.item()

            # ── 검증 ────────────────────────────────────────────────────────
            self.model.eval()
            val_loss = 0.0
            with torch.no_grad():
                for X_b, y_b in val_loader:
                    X_b, y_b = X_b.to(self.device), y_b.to(self.device)
                    val_loss += criterion(self.model(X_b), y_b).item()

            avg_val = val_loss / len(val_loader)
            if (epoch + 1) % 5 == 0:
                logger.info(
                    f"  GRU Epoch [{epoch+1:2d}/{self.cfg['epochs']}] "
                    f"train_loss={train_loss/len(train_loader):.4f} "
                    f"val_loss={avg_val:.4f}"
                )

            # ── Early Stopping ───────────────────────────────────────────────
            if avg_val < best_val_loss:
                best_val_loss  = avg_val
                patience_count = 0
                best_state     = {k: v.clone() for k, v in self.model.state_dict().items()}
            else:
                patience_count += 1
                if patience_count >= self.cfg["patience"]:
                    logger.info(f"  [GRU] Early stopping at epoch {epoch+1}")
                    break

        if best_state:
            self.model.load_state_dict(best_state)
        logger.info("[GRUWaveModel] 학습 완료")
        return self

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        """
        슬라이딩 윈도우로 각 타임스텝의 상승 확률 반환
        출력 길이 = len(features) - seq_len
        """
        assert self.model is not None, "fit()을 먼저 호출해야 합니다."
        dataset = StockSequenceDataset(features, np.zeros(len(features)), self.seq_len)
        loader  = DataLoader(dataset, batch_size=self.cfg["batch_size"], shuffle=False)

        probs = []
        self.model.eval()
        with torch.no_grad():
            for X_b, _ in loader:
                probs.append(self.model(X_b.to(self.device)).cpu().numpy())
        return np.concatenate(probs)


# =============================================================================
# [Phase 5] LGBMMetaModel — Layer 2
#
# 설계 의도:
#   - Layer 1의 두 예측값(추세 피처 2개, 파동 확률 1개)과
#     직접 사용할 거시경제 지표(3개)를 Concatenate하여 최종 판단
#   - 총 6개 피처 → LightGBM 이진 분류
#   - 트리 모델의 비선형 상호작용 포착력: 금리가 오를 때 파동 확률이 높으면?
#     → LightGBM이 자동으로 이런 조합 패턴을 학습
# =============================================================================
class LGBMMetaModel:
    """LightGBM 기반 메타 모델 (Layer 2)"""

    def __init__(self, config: Dict):
        self.cfg   = config["lgbm"]
        self.model = None
        self.feature_names: Optional[List[str]] = None

    def fit(
        self,
        X_train: pd.DataFrame, y_train: np.ndarray,
        X_val:   pd.DataFrame, y_val:   np.ndarray,
    ) -> "LGBMMetaModel":
        """Early Stopping 포함 LightGBM 학습"""
        self.feature_names = list(X_train.columns)

        # n_estimators, early_stopping_rounds는 fit() 파라미터이므로 분리
        lgb_params = {
            k: v for k, v in self.cfg.items()
            if k not in ("early_stopping_rounds", "n_estimators")
        }
        self.model = lgb.LGBMClassifier(
            n_estimators=self.cfg["n_estimators"],
            **lgb_params,
        )
        self.model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            callbacks=[
                lgb.early_stopping(self.cfg["early_stopping_rounds"], verbose=False),
                lgb.log_evaluation(period=100),
            ],
        )
        logger.info(
            f"[LGBMMetaModel] 학습 완료 | "
            f"Best iteration: {self.model.best_iteration_}"
        )
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """클래스 1(상승)의 확률 반환"""
        assert self.model is not None, "fit()을 먼저 호출해야 합니다."
        return self.model.predict_proba(X)[:, 1]

    @property
    def feature_importance(self) -> pd.DataFrame:
        """피처 중요도 (gain 기준, 내림차순)"""
        return (
            pd.DataFrame({
                "feature":    self.feature_names,
                "importance": self.model.feature_importances_,
            })
            .sort_values("importance", ascending=False)
            .reset_index(drop=True)
        )


# =============================================================================
# [Phase 6] HybridStackingEnsemble — 오케스트레이터
#
# 설계 의도:
#   - 사용자 인터페이스: fit(df)와 predict_proba(df) 두 메서드만 노출
#   - 내부 데이터 흐름 관리: StackingTrend → GRU → 정렬 → LightGBM
#   - 시계열 분할 원칙: 미래 데이터가 과거 학습에 절대 사용되지 않도록 순서 보장
# =============================================================================
class HybridStackingEnsemble:
    """
    2-Layer 하이브리드 스태킹 앙상블 최상위 클래스

    데이터 흐름:
      원시 df
        → HybridPreprocessor
        → [StackingTrendModel(원본 df)] → trend_pred, trend_ratio
        → [GRUWaveModel(스케일 df)]     → gru_prob
        → Concatenate + macro_cols
        → LGBMMetaModel                 → 최종 매수 확률
    """

    META_FEATURES = [
        "trend_pred",    # Layer 1-A: 스태킹 앙상블 예측 종가
        "trend_ratio",   # Layer 1-A: 예측/실제 비율
        "gru_prob",      # Layer 1-B: 단기 상승 확률
        "interest_rate", # 거시경제: 기준금리
        "usd_krw",       # 거시경제: 환율
        "vix",           # 거시경제: 변동성 지수
    ]

    def __init__(self, config: Dict):
        self.cfg          = config
        self.seq_len      = config["data"]["seq_len"]
        self.preprocessor = HybridPreprocessor(config)
        self.trend_model  = StackingTrendModel(config)
        self.gru          = GRUWaveModel(config)
        self.lgbm         = LGBMMetaModel(config)

    # ── 데이터 분할 ─────────────────────────────────────────────────────────
    def _split(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """
        시계열 데이터는 반드시 시간 순으로 분할 (shuffle 절대 금지)
        미래 정보가 훈련에 새어 들어가는 데이터 누수(data leakage) 방지
        """
        n     = len(df)
        n_tr  = int(n * self.cfg["data"]["train_ratio"])
        n_val = int(n * self.cfg["data"]["val_ratio"])
        return df.iloc[:n_tr], df.iloc[n_tr:n_tr + n_val], df.iloc[n_tr + n_val:]

    # ── Layer 2 입력 행렬 조립 ───────────────────────────────────────────────
    def _build_meta_df(
        self,
        raw_df:      pd.DataFrame,
        scaled_df:   pd.DataFrame,
        trend_feats: pd.DataFrame,
        gru_probs:   np.ndarray,
    ) -> Tuple[pd.DataFrame, np.ndarray]:
        """
        GRU 시퀀스 소모로 인한 인덱스 정렬:
          GRU 출력 길이 = len(features) - seq_len
          → StackingTrend 출력·거시경제·타깃도 앞 seq_len개 행을 버리고 정렬
        """
        n = len(gru_probs)
        sl = self.seq_len

        meta = pd.DataFrame(
            {
                "trend_pred":    trend_feats["trend_pred"].iloc[sl: sl + n].values,
                "trend_ratio":   trend_feats["trend_ratio"].iloc[sl: sl + n].values,
                "gru_prob":      gru_probs,
                "interest_rate": scaled_df["interest_rate"].iloc[sl: sl + n].values,
                "usd_krw":       scaled_df["usd_krw"].iloc[sl: sl + n].values,
                "vix":           scaled_df["vix"].iloc[sl: sl + n].values,
            },
            index=raw_df.index[sl: sl + n],
        )
        targets = raw_df["target"].iloc[sl: sl + n].values
        return meta, targets

    # ── 학습 ────────────────────────────────────────────────────────────────
    def fit(self, df: pd.DataFrame) -> "HybridStackingEnsemble":
        """전체 2-Layer 앙상블 순차 학습"""
        logger.info("=" * 60)
        logger.info("[Ensemble] 2-Layer 하이브리드 스태킹 학습 시작")

        # Step 1. 시간 순 데이터 분할
        train_df, val_df, test_df = self._split(df)
        logger.info(
            f"  데이터 분할 | Train:{len(train_df)} Val:{len(val_df)} Test:{len(test_df)}"
        )

        # Step 2. 이중 전처리 (훈련 기준 fit)
        scaled_tr = self.preprocessor.fit_transform(train_df)
        scaled_va = self.preprocessor.transform(val_df)
        scaled_te = self.preprocessor.transform(test_df)

        # Step 3. Layer 1-A: StackingTrendModel (원본 주가 스케일 필요)
        logger.info("[Ensemble] Layer 1-A (StackingTrendModel) 학습 중...")
        self.trend_model.fit(train_df)
        p_tr = self.trend_model.predict(train_df)
        p_va = self.trend_model.predict(val_df)

        # Step 4. Layer 1-B: GRU (스케일링된 피처 사용)
        logger.info("[Ensemble] Layer 1-B (GRU) 학습 중...")
        gru_cols = [c for c in self.preprocessor.feature_cols if c != "target"]

        self.gru.fit(
            scaled_tr[gru_cols].values, train_df["target"].values.astype(float),
            scaled_va[gru_cols].values, val_df["target"].values.astype(float),
        )
        gru_tr = self.gru.predict_proba(scaled_tr[gru_cols].values)
        gru_va = self.gru.predict_proba(scaled_va[gru_cols].values)

        # Step 5. 메타 피처 행렬 조립
        meta_tr, y_tr = self._build_meta_df(train_df, scaled_tr, p_tr, gru_tr)
        meta_va, y_va = self._build_meta_df(val_df,   scaled_va, p_va, gru_va)

        # Step 6. Layer 2: LightGBM 메타 모델 학습
        logger.info("[Ensemble] Layer 2 (LightGBM) 학습 중...")
        self.lgbm.fit(meta_tr, y_tr, meta_va, y_va)

        # Step 7. 테스트셋 최종 평가
        self._evaluate_test(test_df, scaled_te)
        logger.info("[Ensemble] 전체 학습 완료")
        return self

    def _evaluate_test(self, test_df: pd.DataFrame, scaled_te: pd.DataFrame):
        """테스트셋 AUC·Accuracy·Classification Report 출력"""
        gru_cols = [c for c in self.preprocessor.feature_cols if c != "target"]
        p_te     = self.trend_model.predict(test_df)
        gru_te   = self.gru.predict_proba(scaled_te[gru_cols].values)
        meta_te, y_te = self._build_meta_df(test_df, scaled_te, p_te, gru_te)

        probs = self.lgbm.predict_proba(meta_te)
        preds = (probs >= 0.5).astype(int)

        auc = roc_auc_score(y_te, probs)
        acc = accuracy_score(y_te, preds)
        logger.info(f"\n{'=' * 60}")
        logger.info(f"[테스트 성능] AUC: {auc:.4f} | Accuracy: {acc:.4f}")
        logger.info(
            f"\n{classification_report(y_te, preds, target_names=['하락(0)', '상승(1)'])}"
        )
        logger.info(
            f"\n[Layer 2 피처 중요도]\n"
            f"{self.lgbm.feature_importance.to_string(index=False)}"
        )

    # ── 추론 ────────────────────────────────────────────────────────────────
    def predict_proba(self, df: pd.DataFrame) -> np.ndarray:
        """
        새 데이터에 대한 최종 매수 확률 반환
        df는 최소 seq_len + 1행 이상이어야 함
        """
        scaled   = self.preprocessor.transform(df)
        t_feats  = self.trend_model.predict(df)
        gru_cols = [c for c in self.preprocessor.feature_cols if c != "target"]
        gru_p    = self.gru.predict_proba(scaled[gru_cols].values)
        # 타깃이 없으므로 더미 배열로 _build_meta_df 호출
        df_dummy = df.copy()
        if "target" not in df_dummy.columns:
            df_dummy["target"] = 0
        meta, _ = self._build_meta_df(df_dummy, scaled, t_feats, gru_p)
        return self.lgbm.predict_proba(meta)


# =============================================================================
# [MAIN] 실행 예제
# =============================================================================
if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("하이브리드 스태킹 앙상블 — 실행 시작")
    logger.info("=" * 60)

    # 1. 더미 데이터 생성
    gen = DummyDataGenerator(
        n_days=CONFIG["data"]["n_days"],
        seed=CONFIG["data"]["random_seed"],
    )
    df = gen.generate()
    logger.info(f"\n[데이터 미리보기]\n{df[['close', 'rsi', 'per', 'interest_rate', 'target']].tail(5).to_string()}\n")

    # 2. 앙상블 학습
    ensemble = HybridStackingEnsemble(CONFIG)
    ensemble.fit(df)

    # 3. 최근 50일 데이터로 매수 확률 예측
    logger.info("\n[최근 50일 매수 확률 예측]")
    recent = df.tail(50)
    probs  = ensemble.predict_proba(recent)
    result = pd.DataFrame({
        "date":       recent.index[CONFIG["data"]["seq_len"]: CONFIG["data"]["seq_len"] + len(probs)],
        "buy_prob":   probs.round(4),
        "signal":     ["매수" if p >= 0.55 else "관망" if p >= 0.45 else "매도" for p in probs],
    })
    logger.info(f"\n{result.to_string(index=False)}")
    logger.info("\n실행 완료.")
