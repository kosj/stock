"""Offline data regressions; no pipeline imports, network calls or secrets."""
import ast
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import numpy as np
import pandas as pd
import requests
import price_store


def functions(file, names, **scope):
    tree = ast.parse(Path(__file__).with_name(file).read_text())
    module = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)
                             and node.name in names], type_ignores=[])
    exec(compile(module, file, "exec"), scope)
    return scope


class DataQuality(unittest.TestCase):
    def test_rsi_direction_flat_and_warmup(self):
        rsi = functions("hybrid_ensemble.py", {"_rsi"}, pd=pd, np=np)["_rsi"]
        for values, expected in [(np.arange(30), 100), (-np.arange(30), 0), (np.ones(30), 50)]:
            result = rsi(pd.Series(values))
            self.assertTrue(result.iloc[:14].isna().all())
            self.assertTrue((result.iloc[14:] == expected).all())

    def test_recommendations_paginate_even_with_lower_server_cap(self):
        responses = []
        for rows in [[{"run_date": "2026-01-01", "ticker": "A"}],
                     [{"run_date": "2026-01-01", "ticker": "B"}], []]:
            response = Mock(); response.json.return_value = rows; responses.append(response)
        client = Mock(); client.get.side_effect = responses
        fetch = functions("backtest_recommendations.py", {"fetch_recommendations"},
                          requests=client, pd=pd, SUPABASE_URL="offline", SUPABASE_KEY="offline")["fetch_recommendations"]
        self.assertEqual(fetch().ticker.tolist(), ["A", "B"])
        self.assertIn("offset=2", client.get.call_args.args[0])

    def test_weekend_and_session_lag_use_same_next_session(self):
        dates = pd.bdate_range("2026-01-02", periods=10)
        prices = pd.Series(np.arange(10) + 100.0, index=dates)
        market = pd.Series(100.0, index=dates)
        realize = functions("backtest_recommendations.py", {"realized_alpha"},
                            pd=pd, np=np, MAX_ENTRY_DELAY_DAYS=10)["realized_alpha"]
        friday = realize(prices, market, "2026-01-02", 2)
        saturday = realize(prices, market, "2026-01-03", 2)
        self.assertAlmostEqual(friday, 103 / 101 - 1)
        self.assertEqual(friday, saturday)

    def test_failed_price_publish_aborts_without_delete_or_live_fallback(self):
        dates = pd.bdate_range("2026-01-01", periods=25)
        old = pd.DataFrame({c: np.full(25, 100.0) for c in price_store.COLS}, index=dates)
        fresh = old * 2
        with patch.object(price_store, "enabled", return_value=True), \
             patch.object(price_store, "_read_snapshot", return_value=(old, 7)), \
             patch.object(price_store, "_publish", side_effect=requests.HTTPError("offline")) as publish:
            with self.assertRaises(requests.HTTPError):
                price_store.load("TEST", lambda _: fresh)
            self.assertEqual(publish.call_args.args[2:], (7, "resync"))

    def test_append_keeps_committed_overlap_and_publishes_all_rows(self):
        dates = pd.bdate_range("2026-01-01", periods=3)
        old = pd.DataFrame({c: [100., 101.] for c in price_store.COLS}, index=dates[:2])
        fresh = pd.DataFrame({c: [999., 999., 102.] for c in price_store.COLS}, index=dates)
        with patch.object(price_store, "enabled", return_value=True), \
             patch.object(price_store, "_read_snapshot", return_value=(old, 3)), \
             patch.object(price_store, "_publish") as publish:
            result, status = price_store.load("TEST", lambda _: fresh)
            self.assertEqual(status, "snapshot")
            self.assertEqual(result.Close.tolist(), [100., 101., 102.])
            self.assertEqual(len(publish.call_args.args[1]), 3)


if __name__ == "__main__":
    unittest.main()
