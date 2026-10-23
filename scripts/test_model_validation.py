"""Offline model contracts: shared transforms, publication evidence and identity."""
import ast
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import pandas as pd
from model_validation import cross_sectional_zscore, write_quality_report
from universe import UNIVERSE


class ModelValidation(unittest.TestCase):
    def test_training_and_latest_use_identical_transform(self):
        dates = pd.to_datetime(["2026-01-01"] * 3 + ["2026-01-02"] * 3)
        data = pd.DataFrame({"constant": [7.] * 6, "varying": [1., 2., 3., 3., 5., 7.]})
        train = cross_sectional_zscore(data, dates)
        latest = cross_sectional_zscore(data.iloc[3:])
        pd.testing.assert_frame_equal(train.iloc[3:], latest)
        self.assertTrue((latest.constant == 0).all())
        changed = data.copy(); changed.iloc[3:] *= 1000
        pd.testing.assert_frame_equal(train.iloc[:3], cross_sectional_zscore(changed, dates).iloc[:3])

    def test_missing_inputs_are_not_fabricated_as_observations(self):
        data = pd.DataFrame({"a": [np.nan, 2., 2.], "b": [np.inf, 1., 3.]})
        out = cross_sectional_zscore(data)
        self.assertTrue(out.iloc[0].isna().all())
        self.assertTrue(np.isfinite(out.dropna().to_numpy()).all())
        self.assertEqual(len(out.dropna()), 2)
        self.assertEqual(cross_sectional_zscore(pd.DataFrame({"a": [5.]})).a.iloc[0], 0)

    def test_quality_evidence_is_strict_json_and_preserves_thresholds(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "quality.json"
            report = write_quality_report(path, dict(oof_ic=.0087, oof_ic_tstat=.74, oof_ic_days=609),
                                          min_ic=.01, run_date="2026-10-23", data_as_of="2026-10-23")
            self.assertFalse(report["publishable"])
            self.assertEqual(json.loads(path.read_text())["checks"]["nw_t"]["minimum"], 2)
            missing = write_quality_report(None, dict(oof_ic=np.nan, oof_ic_tstat=np.nan, oof_ic_days=0),
                                          min_ic=.01, run_date="2026-10-23", data_as_of="2026-10-23")
            self.assertFalse(missing["publishable"])
            json.dumps(missing, allow_nan=False)

    def test_verified_company_identity_and_unique_universe(self):
        expected = {"한미반도체": "042700", "솔루스첨단소재": "336370", "NC소프트": "036570",
                    "한미약품": "128940", "씨에스윈드": "112610", "DL이앤씨": "375500", "한샘": "009240"}
        by_name = {row["name"]: row for row in UNIVERSE}
        for name, code in expected.items():
            self.assertEqual(by_name[name]["ticker"], code)
            self.assertEqual(by_name[name]["market"], "KOSPI")
        self.assertEqual(len(UNIVERSE), len({row["ticker"] for row in UNIVERSE}))
        for row in UNIVERSE:
            self.assertRegex(row["ticker"], r"^\d{6}$")

    def test_rejected_model_skips_full_refit(self):
        # Actual walk-forward orchestration with cheap deterministic estimators.
        from sklearn.linear_model import Ridge
        from sklearn.model_selection import TimeSeriesSplit
        source = ast.parse(Path(__file__).with_name("hybrid_ensemble.py").read_text())
        names = {"purged_meta_oof", "walk_forward_stack"}
        definitions = ast.Module(body=[node for node in source.body if isinstance(node, ast.FunctionDef)
                                      and node.name in names], type_ignores=[])
        calls = []
        class Regressor:
            def fit(self, x, y): return self
            def predict(self, x): return x[:, 0] * .1
        def factory():
            calls.append(1)
            return Regressor(), Regressor()
        metrics = lambda *a, **kw: dict(ic_mean=.0087, ic_tstat_nw=.74, n_days=609, ic_share_pos=.56)
        scope = dict(np=np, pd=pd, Ridge=Ridge, TimeSeriesSplit=TimeSeriesSplit, CV_SPLITS=2,
                     TARGET_DAYS=2, MIN_TRAIN_ROWS=5, FEATURE_COLS=["x"], MIN_OOF_IC=.01,
                     _make_base_models=factory, daily_ic_stats=metrics, model_is_publishable=lambda _: False,
                     os=type("Env", (), {"environ": {}}), r2_score=lambda *a: 0.,
                     spearmanr=lambda *a: type("Corr", (), {"statistic": 0.})())
        exec(compile(definitions, "walk_forward", "exec"), scope)
        index = pd.MultiIndex.from_product([["A", "B"], pd.bdate_range("2025-01-01", periods=90)], names=["ticker", "date"])
        rng = np.random.default_rng(42)
        panel = pd.DataFrame({"x": rng.normal(size=len(index)), "target_alpha_5d": rng.normal(size=len(index))}, index=index)
        result = scope["walk_forward_stack"](panel)
        self.assertEqual(len(calls), 2)
        self.assertNotIn("lgbm", result)
        self.assertEqual(result["oof_ic"], .0087)


if __name__ == "__main__": unittest.main()
