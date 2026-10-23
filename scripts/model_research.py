#!/usr/bin/env python3
"""Frozen-input baseline/candidate diagnostics. Never publish prices, recommendations or orders.

The last 126 evaluated dates are a retrospective recent-window diagnostic, NOT
an untouched holdout: old model metrics on this history have already been seen.
Both models see the same captured OHLCV and complete KRX cache. No parameter search,
model selection, threshold changes or automatic promotion is performed.
"""
import argparse
import gzip
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from metrics_util import daily_ic_stats, newey_west_tstat


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def encode_frame(frame):
    clean = frame.reset_index(names="date")
    clean["date"] = pd.to_datetime(clean.date).dt.strftime("%Y-%m-%d")
    return json.loads(clean.to_json(orient="records"))


def decode_frame(rows):
    if not rows:
        return pd.DataFrame()
    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame.date)
    return frame.set_index("date").sort_index()


def capture(candidate, baseline_universe):
    import price_store
    if not price_store.enabled():
        raise RuntimeError("Read-only source credentials are required")
    # Enforce the read-only boundary even if code is accidentally reused later.
    def forbidden(*args, **kwargs):
        raise RuntimeError("Research must not publish")
    price_store._publish = forbidden
    candidate.upsert_supabase = forbidden
    universes = {"baseline": baseline_universe, "candidate": candidate.UNIVERSE}
    symbols = {candidate.BENCHMARK_YF}
    for universe in universes.values():
        symbols.update(candidate.to_yf(row["ticker"], row["market"]) for row in universe)

    def read_symbol(symbol):
        frame = price_store.read(symbol)
        source = "snapshot"
        # New/corrected symbols may not have a snapshot yet. Fetch without seeding.
        if frame.empty:
            frame = candidate.fetch_ohlcv(symbol)
            source = "public_live_read_only"
        return symbol, {"rows": encode_frame(frame), "source": source,
                        "revision": price_store.revision(symbol)}
    with ThreadPoolExecutor(max_workers=4) as pool:
        prices = dict(pool.map(read_symbol, sorted(symbols)))
    codes = sorted({row["ticker"] for u in universes.values() for row in u})
    with ThreadPoolExecutor(max_workers=4) as pool:
        flows = dict(pool.map(lambda code: (code, encode_frame(candidate.fetch_krx_cache(code))), codes))
    return {"universes": universes, "prices": prices, "flows": flows,
            "limitations": ["current universe; not point-in-time membership", "no cost or trade simulation",
                            "shared full KRX cache; does not reproduce the old server page cap",
                            "public live fallback only for symbols with no stored snapshot"]}


def build_panel(model, universe, inputs):
    market = decode_frame(inputs["prices"][model.BENCHMARK_YF]["rows"])
    if market.empty:
        raise ValueError("Missing benchmark")
    as_of = market.index[-1]
    records, excluded = [], []
    for stock in universe:
        symbol = model.to_yf(stock["ticker"], stock["market"])
        prices = decode_frame(inputs["prices"][symbol]["rows"])
        if prices.empty:
            excluded.append(symbol)
            continue
        prices = prices.loc[prices.index <= as_of]
        if len(prices) < 100 or prices.index[-1] != as_of:
            excluded.append(symbol)
            continue
        cache = decode_frame(inputs["flows"][stock["ticker"]])
        feats = model.make_features(prices, market, cache, cache)
        feats.index.name = "date"
        feats["ticker"], feats["sector"] = stock["ticker"], stock["sector"]
        records.append(feats.reset_index())
    if not records:
        raise ValueError("No comparable input rows")
    raw = pd.concat(records, ignore_index=True)
    for col in ("ret_5d", "ret_20d"):
        raw[f"sector_rel_{col}"] = raw[col] - raw.groupby(["date", "sector"])[col].transform("mean")
    raw["rs_rank_20d"] = raw.groupby("date").ret_20d.rank(pct=True)
    panel = raw.drop(columns="sector").set_index(["ticker", "date"])
    panel = panel.dropna(subset=["target_alpha_5d"] + model.FEATURE_COLS).copy()
    actual = panel.target_alpha_5d.copy()
    panel["target_alpha_5d"] = panel.groupby(level="date").target_alpha_5d.rank(pct=True) - .5
    # Each variant uses its original training transform; raw market/cache inputs
    # are identical. Changes in membership are reported separately below.
    if hasattr(model, "cross_sectional_zscore"):
        panel[model.FEATURE_COLS] = model.cross_sectional_zscore(panel[model.FEATURE_COLS], panel.index.get_level_values("date"))
    else:
        for col in model.FEATURE_COLS:
            groups = panel.groupby(level="date")[col]
            panel[col] = (panel[col] - groups.transform("mean")) / groups.transform("std").replace(0, np.nan).fillna(1.)
    return panel.dropna(subset=model.FEATURE_COLS), actual, excluded


def evaluate(model, panel):
    observed = []
    def capture_stats(dates, predictions, target, **kwargs):
        observed.append((pd.DatetimeIndex(dates), np.asarray(predictions)))
        return daily_ic_stats(dates, predictions, target, **kwargs)
    model.daily_ic_stats = capture_stats
    os.environ["FEATURE_REPORT"] = "0"
    kwargs = {"refit": False} if "refit" in inspect.signature(model.walk_forward_stack).parameters else {}
    result = model.walk_forward_stack(panel, **kwargs)
    dates, predictions = observed[0]
    selected = panel.loc[panel.index.get_level_values("date").isin(dates.unique())]
    if not selected.index.get_level_values("date").equals(dates):
        raise ValueError("OOF row identities do not match; refuse an invalid comparison")
    metrics = {key: result[key] for key in ("oof_ic", "oof_ic_tstat", "oof_ic_days")}
    metrics["publishable"] = bool(model.model_is_publishable(result))
    return metrics, pd.Series(predictions, index=selected.index)


def compare(inputs, baseline, candidate):
    results, predictions, actuals = {}, {}, {}
    prepared = {name: build_panel(model, inputs["universes"][name], inputs)
                for name, model in [("baseline", baseline), ("candidate", candidate)]}
    calendar = prepared["baseline"][0].index.get_level_values("date").unique().intersection(
        prepared["candidate"][0].index.get_level_values("date").unique()).sort_values()
    if len(calendar) < 300:
        raise ValueError("Insufficient shared training calendar")
    for name, model in [("baseline", baseline), ("candidate", candidate)]:
        print(f"\n=== {name} ===", flush=True)
        panel, actual, excluded = prepared[name]
        panel = panel.loc[panel.index.get_level_values("date").isin(calendar)]
        metrics, prediction = evaluate(model, panel)
        results[name] = {**metrics, "training_rows": len(panel), "training_dates": len(calendar),
                         "symbols": panel.index.get_level_values("ticker").nunique(), "excluded": excluded}
        predictions[name], actuals[name] = prediction, actual
    common = predictions["baseline"].index.intersection(predictions["candidate"].index).sort_values()
    target = actuals["candidate"].reindex(common)
    if not np.allclose(target, actuals["baseline"].reindex(common), equal_nan=False):
        raise ValueError("Comparable targets differ on common ticker/date rows")
    paired = pd.DataFrame({"baseline": predictions["baseline"].reindex(common), "candidate": predictions["candidate"].reindex(common), "target": target}).dropna()
    daily = []
    for day, group in paired.groupby(level="date", sort=True):
        if len(group) < 5 or any(group[col].nunique() < 2 for col in group):
            continue
        daily.append((day, spearmanr(group.baseline, group.target).statistic,
                      spearmanr(group.candidate, group.target).statistic))
    frame = pd.DataFrame(daily, columns=["date", "baseline", "candidate"])
    if len(frame) < 60:
        raise ValueError("Too few comparable evaluation dates")
    windows = {}
    for label, window in [("all_common", frame), ("recent_126", frame.tail(126))]:
        delta = window.candidate - window.baseline
        windows[label] = {"dates": len(window), "from": str(window.date.iloc[0].date()), "to": str(window.date.iloc[-1].date()),
                          "baseline_ic": float(window.baseline.mean()), "candidate_ic": float(window.candidate.mean()),
                          "delta_ic": float(delta.mean()), "delta_nw_t": float(newey_west_tstat(delta, candidate.TARGET_DAYS))}
    return {"models": results, "paired": windows, "common_rows": len(paired),
            "limitations": inputs["limitations"] + ["recent window reuses observed history; not an untouched holdout",
                            "raw stack ranking diagnostic; excludes final volatility/news/sector-cap selection",
                            "no automatic parameter selection, promotion or publication"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--baseline-universe", required=True)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("model-research-output"))
    args = parser.parse_args()
    # Offline replay needs no real credentials. Import-time configuration only.
    os.environ.setdefault("SUPABASE_URL", "https://offline.invalid")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "offline")
    baseline = load_module(args.baseline, "baseline_model")
    baseline_universe = load_module(args.baseline_universe, "baseline_universe").UNIVERSE
    candidate = load_module(Path(__file__).with_name("hybrid_ensemble.py"), "candidate_model")
    inputs = json.loads(gzip.decompress(args.input.read_bytes())) if args.input else capture(candidate, baseline_universe)
    encoded = json.dumps(inputs, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "inputs.json.gz").write_bytes(gzip.compress(encoded, mtime=0))
    report = compare(inputs, baseline, candidate)
    report["input_sha256"] = hashlib.sha256(encoded).hexdigest()
    report["source_sha256"] = {"baseline": hashlib.sha256(Path(args.baseline).read_bytes()).hexdigest(),
                               "candidate": hashlib.sha256(Path(__file__).with_name("hybrid_ensemble.py").read_bytes()).hexdigest()}
    report["cache_coverage"] = {"symbols": len(inputs["flows"]),
                                "over_1000_rows": sum(len(rows) > 1000 for rows in inputs["flows"].values()),
                                "empty": sum(not rows for rows in inputs["flows"].values())}
    # Strict JSON: undefined statistics remain explicitly null.
    def clean(value):
        if isinstance(value, dict): return {k: clean(v) for k,v in value.items()}
        if isinstance(value, list): return [clean(v) for v in value]
        if isinstance(value, (float, np.floating)) and not np.isfinite(value): return None
        return value
    report = clean(report)
    text = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    (args.output_dir / "report.json").write_text(text + "\n")
    print("\nMODEL_RESEARCH_REPORT\n" + text, flush=True)


if __name__ == "__main__": main()
