"""Offline regression tests: extract pure functions, never import the network pipeline."""
import ast
from pathlib import Path
import unittest
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.model_selection import TimeSeriesSplit

tree = ast.parse(Path(__file__).with_name("hybrid_ensemble.py").read_text())
names = {"_rsi", "_macd_hist", "_bb_pct", "make_features", "purged_meta_oof", "model_is_publishable"}
code = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
scope = dict(np=np, pd=pd, Ridge=Ridge, TimeSeriesSplit=TimeSeriesSplit,
             TARGET_DAYS=2, TARGET_DAYS_LONG=3, TARGET_CLIP=1, TARGET_CLIP_LONG=1, MIN_OOF_IC=0.01)
exec(compile(code, "model_functions", "exec"), scope)

class ModelSafety(unittest.TestCase):
    def test_benchmark_uses_compound_return(self):
        dates = pd.bdate_range("2025-01-01", periods=100)
        df = pd.DataFrame({"Close": 100 * np.cumprod(np.where(np.arange(100) % 2, 1.002, 0.999)), "Volume": 1000}, index=dates)
        mkt = pd.DataFrame({"Close": 100 * 1.01 ** np.arange(100)}, index=dates)
        f = scope["make_features"](df, mkt)
        i = df.index.get_loc(f.index[0])
        self.assertAlmostEqual(float(f["target_alpha_5d"].iloc[0]), df.Close.iloc[i+2] / df.Close.iloc[i] - 1.01**2)
        self.assertAlmostEqual(float(f["target_alpha_30d"].iloc[0]), df.Close.iloc[i+3] / df.Close.iloc[i] - 1.01**3)

    def test_momentum_excludes_latest_month_and_uses_correct_window(self):
        dates = pd.bdate_range("2024-01-01", periods=330)
        close = pd.Series(100 * 1.002 ** np.arange(330), index=dates)
        df = pd.DataFrame({"Close": close, "Volume": 1000})
        market = pd.DataFrame({"Close": 100.}, index=dates)
        first = scope["make_features"](df, market)
        i = 310
        self.assertAlmostEqual(first.loc[dates[i], "momentum_12_1"], close.iloc[i-21] / close.iloc[i-252] - 1)
        changed = df.copy()
        changed.loc[dates[i-20]:dates[i], "Close"] *= 2
        second = scope["make_features"](changed, market)
        self.assertEqual(first.loc[dates[i], "momentum_12_1"], second.loc[dates[i], "momentum_12_1"])

    def test_trailing_alpha_uses_compound_benchmark(self):
        dates = pd.bdate_range("2025-01-01", periods=100)
        df = pd.DataFrame({"Close": 100., "Volume": 1000}, index=dates)
        market = pd.DataFrame({"Close": 100 * 1.01 ** np.arange(100)}, index=dates)
        features = scope["make_features"](df, market)
        self.assertAlmostEqual(features.alpha_20d.iloc[-1], 1 - 1.01 ** 20)

    def test_future_labels_cannot_change_earlier_meta_predictions(self):
        dates = pd.DatetimeIndex(np.repeat(pd.bdate_range("2025-01-01", periods=100), 4))
        rng = np.random.default_rng(7)
        X = rng.normal(size=(400, 2)); y = X[:,0] * 0.2 + rng.normal(size=400) * 0.01
        first = scope["purged_meta_oof"](X, y, dates, 2)
        changed = y.copy(); changed[dates >= dates.unique()[75]] += 10000
        second = scope["purged_meta_oof"](X, changed, dates, 2)
        before = (dates < dates.unique()[75]) & np.isfinite(first)
        self.assertTrue(before.any())
        np.testing.assert_allclose(first[before], second[before])

    def test_quality_gate_requires_significance_and_sample_size(self):
        valid = dict(oof_ic=0.03, oof_ic_tstat=2.5, oof_ic_days=100)
        self.assertTrue(scope["model_is_publishable"](valid))
        for update in [dict(oof_ic=0), dict(oof_ic=np.nan), dict(oof_ic_tstat=1), dict(oof_ic_days=10)]:
            self.assertFalse(scope["model_is_publishable"]({**valid, **update}))

if __name__ == "__main__": unittest.main()
