"""No network, database, credentials, model training or production writes."""
import json
from pathlib import Path
import tempfile
import unittest
import pandas as pd
from recommendation_diagnostics import diagnose, read_export, spearman, stats


def fixture():
    days = pd.bdate_range("2026-01-02", periods=30).strftime("%Y-%m-%d").tolist()
    prices = [{"ticker": "^KS11", "date": date, "close": 100} for date in days]
    recs = []
    for i in range(1, 7):
        recs.append({"run_date": days[0], "ticker": str(i), "market": "KOSPI", "rank": i,
                     "predicted_return_7d": 7 - i})
        prices.extend({"ticker": f"{i}.KS", "date": date, "close": 100 + j * (7 - i)}
                      for j, date in enumerate(days))
    return days, recs, prices


class Diagnostics(unittest.TestCase):
    def test_lag_maturity_exact_prices_and_complete_topn(self):
        days, recs, prices = fixture()
        result = diagnose(recs, prices, horizons=(1, 20), topn=5)
        one = result["horizons"]["1"]
        self.assertEqual(one["daily"][0]["entry_date"], days[1])
        self.assertEqual(one["daily"][0]["exit_date"], days[2])
        self.assertAlmostEqual(one["prediction_ic"]["mean"], 1)
        self.assertTrue(one["topn_excess_return"]["small_sample"])
        self.assertIsNone(one["topn_excess_return"]["nw_t"])
        prices = [p for p in prices if not (p["ticker"] == "1.KS" and p["date"] == days[2])]
        incomplete = diagnose(recs, prices, horizons=(1,), topn=5)["horizons"]["1"]
        self.assertEqual(incomplete["row_rejections"]["missing_exact_entry_or_exit_close"], 1)
        self.assertEqual(incomplete["topn_excess_return"]["n_cohorts"], 0)

    def test_missing_benchmark_session_never_shifts_horizon(self):
        days, recs, prices = fixture()
        prices = [p for p in prices if not (p["ticker"] == "^KS11" and p["date"] == days[2])]
        one = diagnose(recs, prices, horizons=(1,))["horizons"]["1"]
        self.assertEqual(one["valid_rows"], 0)
        self.assertEqual(one["row_rejections"]["missing_exact_benchmark_close"], 6)

    def test_weekend_maturity_duplicates_and_late_publication(self):
        days, recs, prices = fixture()
        for row in recs:
            row["run_date"] = "2026-01-03"
        weekend = diagnose(recs, prices, horizons=(1,))["horizons"]["1"]
        self.assertEqual(weekend["daily"][0]["entry_date"], days[1])
        recs[0]["created_at"] = "2026-01-06T09:00:00+09:00"
        recs.append(dict(recs[1]))
        changed = diagnose(recs, prices, horizons=(1, 30))["horizons"]
        self.assertEqual(changed["1"]["row_rejections"]["duplicate_recommendation_key"], 2)
        self.assertEqual(changed["1"]["row_rejections"]["published_after_assumed_entry"], 1)
        self.assertEqual(changed["30"]["row_rejections"]["not_mature_or_no_future_benchmark"], 7)

    def test_cli_export_envelope_and_finite_json(self):
        _, recs, prices = fixture()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "export.json"
            path.write_text(json.dumps({"rows": [{"dataset": recs}]}))
            self.assertEqual(read_export(path), recs)
        json.dumps(diagnose(recs, prices), allow_nan=False)
        self.assertIsNone(spearman([(1, 1)] * 6))

    def test_same_entry_session_has_equal_weight_and_no_cumulative_return(self):
        summary = stats([("2026-01-05", 0.1), ("2026-01-05", 0.3), ("2026-01-06", -0.1)], 5)
        self.assertEqual(summary["n_cohorts"], 3)
        self.assertEqual(summary["n_entry_sessions"], 2)
        self.assertAlmostEqual(summary["mean"], 0.05)
        self.assertIsNone(summary["nw_t"])
        self.assertTrue(summary["small_sample"])


if __name__ == "__main__":
    unittest.main()
