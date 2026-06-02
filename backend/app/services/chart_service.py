"""
・ｰ・・・・・・ ・岺・・・げ ・罹ｹ・侃.
pandas_ta・・・ｴ・呰初・, ・ｼ・ｰ・・ｴ・・ RSI, MACD ・・げ.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _calc_indicators_sync(candles: list[dict]) -> dict[str, list[dict]]:
    if len(candles) < 26:
        return {}
    try:
        import pandas as pd
        import numpy as np

        df = pd.DataFrame(candles)
        df["time"] = pd.to_datetime(df["time"])
        df = df.sort_values("time").reset_index(drop=True)
        close = df["close"].astype(float)
        volume = df["volume"].astype(float)

        def to_series(series: "pd.Series") -> list[dict]:
            out = []
            for i, v in series.items():
                if pd.notna(v) and not (isinstance(v, float) and (v != v)):
                    out.append({
                        "time": df.loc[i, "time"].strftime("%Y-%m-%d"),
                        "value": round(float(v), 4),
                    })
            return out

        # ・ｴ・呰初・・
        ma5   = close.rolling(5).mean()
        ma20  = close.rolling(20).mean()
        ma60  = close.rolling(60).mean()
        ma120 = close.rolling(120).mean()

        # ・ｼ・ｰ・ ・ｴ・・(20・ｼ, 2ﾏ・
        bb_mid   = close.rolling(20).mean()
        bb_std   = close.rolling(20).std()
        bb_upper = bb_mid + 2 * bb_std
        bb_lower = bb_mid - 2 * bb_std

        # RSI (14・ｼ)
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss.replace(0, float("nan"))
        rsi = 100 - (100 / (1 + rs))

        # MACD (12, 26, 9)
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd_line = ema12 - ema26
        macd_signal = macd_line.ewm(span=9, adjust=False).mean()
        macd_hist = macd_line - macd_signal

        # ・ｰ・俯汢 MA
        vol_ma5 = volume.rolling(5).mean()

        return {
            "ma5":        to_series(ma5),
            "ma20":       to_series(ma20),
            "ma60":       to_series(ma60),
            "ma120":      to_series(ma120),
            "bb_upper":   to_series(bb_upper),
            "bb_mid":     to_series(bb_mid),
            "bb_lower":   to_series(bb_lower),
            "rsi":        to_series(rsi),
            "macd":       to_series(macd_line),
            "macd_signal":to_series(macd_signal),
            "macd_hist":  to_series(macd_hist),
            "vol_ma5":    to_series(vol_ma5),
        }
    except Exception as e:
        logger.error(f"indicator calc error: {e}")
        return {}


def _get_latest_signals(candles: list[dict]) -> dict:
    """・懍侠 ・ｰ・・・・嶸ｸ ・肥平 (AI ・・・・ｩ)."""
    if len(candles) < 30:
        return {}
    try:
        import pandas as pd

        df = pd.DataFrame(candles)
        close = df["close"].astype(float)

        # RSI
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss.replace(0, float("nan"))
        rsi = (100 - (100 / (1 + rs))).iloc[-1]

        # MACD
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd_line = ema12 - ema26
        macd_signal = macd_line.ewm(span=9, adjust=False).mean()

        # ・ｴ尞餓│
        ma20  = close.rolling(20).mean().iloc[-1]
        ma60  = close.rolling(60).mean().iloc[-1]
        ma120 = close.rolling(120).mean().iloc[-1]
        current = close.iloc[-1]

        # ・ｼ・ｰ・・ｴ・・・・ｹ・        bb_mid = close.rolling(20).mean().iloc[-1]
        bb_std = close.rolling(20).std().iloc[-1]
        bb_pos = (current - (bb_mid - 2 * bb_std)) / (4 * bb_std) * 100 if bb_std else 50

        # 52・ｼ ・・ ・・ｹ・        high_52w = close.tail(252).max()
        low_52w  = close.tail(252).min()
        pos_52w  = (current - low_52w) / (high_52w - low_52w) * 100 if (high_52w - low_52w) else 50

        macd_bullish = float(macd_line.iloc[-1]) > float(macd_signal.iloc[-1])
        macd_cross   = (float(macd_line.iloc[-2]) <= float(macd_signal.iloc[-2])) and macd_bullish

        return {
            "rsi": round(float(rsi), 2) if pd.notna(rsi) else None,
            "macd_bullish": macd_bullish,
            "macd_golden_cross": macd_cross,
            "above_ma20": current > ma20 if pd.notna(ma20) else None,
            "above_ma60": current > ma60 if pd.notna(ma60) else None,
            "above_ma120": current > ma120 if pd.notna(ma120) else None,
            "bb_position_pct": round(float(bb_pos), 1),
            "pos_52w_pct": round(float(pos_52w), 1),
            "current_price": float(current),
            "ma20": round(float(ma20), 2) if pd.notna(ma20) else None,
            "ma60": round(float(ma60), 2) if pd.notna(ma60) else None,
        }
    except Exception as e:
        logger.error(f"signal error: {e}")
        return {}


class ChartService:
    @staticmethod
    async def get_indicators(candles: list[dict]) -> dict[str, list[dict]]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _calc_indicators_sync, candles)

    @staticmethod
    async def get_signals(candles: list[dict]) -> dict:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _get_latest_signals, candles)


chart_service = ChartService()
