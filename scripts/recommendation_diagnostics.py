#!/usr/bin/env python3
"""Offline close-to-close cohort diagnostics, never an investable strategy backtest."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import math

import numpy as np
import pandas as pd


def read_export(path):
    value = json.loads(Path(path).read_text())
    if isinstance(value, dict) and "rows" in value:
        value = value["rows"][0]["dataset"]
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, list):
        raise ValueError("Expected dataset array or CLI rows[0].dataset envelope")
    return value


def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def nw_t(values, lag):
    values = np.asarray(values, dtype=float)
    if len(values) < 3:
        return None
    residual = values - values.mean()
    variance = float(residual @ residual) / len(values)
    lag = min(lag, len(values) - 1)
    for k in range(1, lag + 1):
        variance += 2 * (1 - k / (lag + 1)) * float(residual[k:] @ residual[:-k]) / len(values)
    return float(values.mean() / math.sqrt(variance / len(values))) if variance > 0 else None


def stats(values, horizon):
    # Weekend runs can map to the same Monday entry. Average those cohorts first
    # rather than counting their labels as independent consecutive sessions.
    by_entry = defaultdict(list)
    for entry, value in values:
        by_entry[entry].append(value)
    observations = [float(np.mean(group)) for _, group in sorted(by_entry.items())]
    return {"n_cohorts": len(values), "n_entry_sessions": len(observations),
            "mean": float(np.mean(observations)) if observations else None,
            "nw_t": nw_t(observations, horizon),
            "positive_share": float(np.mean(np.asarray(observations) > 0)) if observations else None,
            "rough_nonoverlapping_blocks": len(observations) // horizon,
            "small_sample": len(observations) < max(60, 10 * horizon)}


def spearman(pairs):
    if len(pairs) < 5:
        return None
    frame = pd.DataFrame(pairs, columns=["score", "return"])
    if frame.score.nunique() < 2 or frame["return"].nunique() < 2:
        return None
    value = frame.rank(method="average").corr().iloc[0, 1]
    return float(value) if pd.notna(value) else None


def diagnose(recommendations, prices, horizons=(1, 5, 10, 20), topn=5, benchmark="^KS11"):
    if topn < 1 or any(h < 1 for h in horizons):
        raise ValueError("positive topn and horizons required")
    quotes, duplicate_prices = {}, set()
    invalid_prices = 0
    for row in prices:
        key = (row["ticker"], row["date"][:10])
        close = finite(row.get("close"))
        if key in quotes:
            duplicate_prices.add(key)
        if close is None or close <= 0:
            invalid_prices += 1
        quotes[key] = close if close is not None and close > 0 else None
    for key in duplicate_prices:
        quotes[key] = None
    # A missing benchmark row must not silently shift the horizon. Domestic stored
    # observations also contribute session dates; exact benchmark endpoints remain required.
    benchmark_dates = sorted(date for (ticker, date), close in quotes.items()
                             if ticker == benchmark and close is not None)
    calendar = sorted({date for (ticker, date), close in quotes.items()
                       if (ticker == benchmark or ticker.endswith((".KS", ".KQ"))) and close is not None})
    groups = defaultdict(list)
    keys = Counter((r["run_date"][:10], r["ticker"]) for r in recommendations)
    for row in recommendations:
        groups[row["run_date"][:10]].append(row)
    report = {
        "kind": "stored_close_cohort_quality_diagnostic",
        "parameters": {"entry_lag_sessions": 1, "horizons": list(horizons), "topn": topn, "benchmark": benchmark,
                       "prediction_field": "predicted_return_7d",
                       "prediction_semantics": "Legacy field reused for 10-session alpha; 1/5/20-session ICs are sensitivity diagnostics, not matching-horizon calibration."},
        "input": {"recommendation_rows": len(recommendations), "cohort_dates": len(groups),
                  "first_run_date": min(groups) if groups else None, "last_run_date": max(groups) if groups else None,
                  "price_rows": len(prices), "invalid_price_rows": invalid_prices,
                  "duplicate_price_keys_rejected": len(duplicate_prices), "benchmark_sessions": len(benchmark_dates),
                  "observed_domestic_sessions": len(calendar),
                  "first_benchmark_date": benchmark_dates[0] if benchmark_dates else None,
                  "last_benchmark_date": benchmark_dates[-1] if benchmark_dates else None},
        "limitations": [
            "Overlapping cohorts are not a compounded portfolio; no cumulative strategy return is computed.",
            "Entry is next benchmark-session close, not the production 09:12 quote; costs/taxes/slippage are excluded.",
            "Stored adjusted closes may include later corporate-action revisions; full historical point-in-time inputs are unavailable.",
            "run_date alone does not prove a recommendation was available before entry; missing publication timestamps remain unverified.",
            "created_at is checked conservatively when present but is not proof of completed batch publication or point-in-time availability.",
            "Legacy/current model versions are mixed unless explicitly separated; this does not measure the new implementation's improvement.",
            "HAC t values use cohort order and horizon lag; small samples and overlapping labels prevent strong inference.",
            "Session calendar is the union of stored domestic observations, not an independently verified exchange calendar.",
            "Cohorts sharing an entry date are averaged before means/HAC inference so weekend runs do not multiply session weight.",
        ], "horizons": {},
    }
    sessions = np.asarray(calendar)
    for horizon in horizons:
        rejected, cohort_rejected = Counter(), Counter()
        valid_rows = 0
        daily = []
        prediction_ics, rank_ics, top_returns, top_excess, universe_excess, selection_excess = [], [], [], [], [], []
        timing_unknown = 0
        for run_date, rows in sorted(groups.items()):
            entry = int(np.searchsorted(sessions, run_date, side="right"))
            if entry + horizon >= len(calendar):
                rejected["not_mature_or_no_future_benchmark"] += len(rows)
                cohort_rejected["not_mature_or_no_future_benchmark"] += 1
                continue
            d_in, d_out = calendar[entry], calendar[entry + horizon]
            if (pd.Timestamp(d_in) - pd.Timestamp(run_date)).days > 10:
                rejected["entry_calendar_gap_over_10_days"] += len(rows)
                cohort_rejected["entry_calendar_gap_over_10_days"] += 1
                continue
            m0, m1 = quotes.get((benchmark, d_in)), quotes.get((benchmark, d_out))
            if m0 is None or m1 is None:
                rejected["missing_exact_benchmark_close"] += len(rows)
                cohort_rejected["missing_exact_benchmark_close"] += 1
                continue
            market_return = m1 / m0 - 1
            evaluated, pred_pairs, rank_pairs = [], [], []
            rank_counts = Counter(finite(r.get("rank")) for r in rows)
            for row in rows:
                if keys[(run_date, row["ticker"])] != 1:
                    rejected["duplicate_recommendation_key"] += 1
                    continue
                symbol = row["ticker"]
                if not (symbol.endswith(".KS") or symbol.endswith(".KQ")):
                    symbol += ".KQ" if row.get("market") == "KOSDAQ" else ".KS"
                p0, p1 = quotes.get((symbol, d_in)), quotes.get((symbol, d_out))
                if p0 is None or p1 is None:
                    rejected["missing_exact_entry_or_exit_close"] += 1
                    continue
                published = row.get("completed_at") or row.get("created_at")
                if published:
                    stamp = pd.Timestamp(published)
                    if stamp.tzinfo is None:
                        stamp = stamp.tz_localize("UTC")
                    if stamp > pd.Timestamp(d_in + " 15:30", tz="Asia/Seoul"):
                        rejected["published_after_assumed_entry"] += 1
                        continue
                else:
                    timing_unknown += 1
                realized = p1 / p0 - 1
                excess = realized - market_return
                rank = finite(row.get("rank"))
                pred = finite(row.get("predicted_return_7d"))
                if pred is not None:
                    pred_pairs.append((pred, excess))
                if rank is not None and rank > 0:
                    rank_pairs.append((-rank, excess))
                evaluated.append((rank, realized, excess))
            valid_rows += len(evaluated)
            pred_ic, rank_ic = spearman(pred_pairs), spearman(rank_pairs)
            if pred_ic is not None:
                prediction_ics.append((d_in, pred_ic))
            if rank_ic is not None:
                rank_ics.append((d_in, rank_ic))
            top = [item for item in evaluated if item[0] is not None and 1 <= item[0] <= topn]
            complete = all(rank_counts[r] == 1 for r in range(1, topn + 1)) and len(top) == topn
            if complete:
                top_returns.append((d_in, float(np.mean([x[1] for x in top]))))
                top_excess.append((d_in, float(np.mean([x[2] for x in top]))))
                selection_excess.append((d_in, top_excess[-1][1] - float(np.mean([x[2] for x in evaluated]))))
            else:
                cohort_rejected["incomplete_topn_ranks_or_prices"] += 1
            if evaluated:
                universe_excess.append((d_in, float(np.mean([x[2] for x in evaluated]))))
            daily.append({"run_date": run_date, "entry_date": d_in, "exit_date": d_out,
                          "valid_rows": len(evaluated), "prediction_ic": pred_ic, "rank_ic": rank_ic,
                          "topn_complete": complete,
                          "topn_excess": top_excess[-1][1] if complete else None})
        report["horizons"][str(horizon)] = {
            "valid_rows": valid_rows, "row_coverage": valid_rows / len(recommendations) if recommendations else 0,
            "row_rejections": dict(rejected), "cohort_rejections": dict(cohort_rejected),
            "valid_rows_without_recorded_timestamp": timing_unknown,
            "prediction_ic": stats(prediction_ics, horizon), "saved_rank_ic": stats(rank_ics, horizon),
            "topn_gross_return": stats(top_returns, horizon), "topn_excess_return": stats(top_excess, horizon),
            "topn_minus_same_cohort_available_universe": stats(selection_excess, horizon),
            "available_universe_excess_return": stats(universe_excess, horizon), "daily": daily,
        }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recommendations", required=True)
    parser.add_argument("--prices", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--topn", type=int, default=5)
    parser.add_argument("--completed-batches-count", type=int, default=None,
                        help="Optional separately verified read-only count at export; not inferred from legacy rows")
    args = parser.parse_args()
    result = diagnose(read_export(args.recommendations), read_export(args.prices), topn=args.topn)
    result["generated_at_utc"] = datetime.now(timezone.utc).isoformat()
    result["separately_verified_completed_batch_count"] = args.completed_batches_count
    result["source_sha256"] = {"recommendations": hashlib.sha256(Path(args.recommendations).read_bytes()).hexdigest(),
                               "prices": hashlib.sha256(Path(args.prices).read_bytes()).hexdigest()}
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
