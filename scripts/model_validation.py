"""Pure model validation helpers; no credentials or network access."""
import json
from pathlib import Path
import numpy as np
import pandas as pd


def cross_sectional_zscore(frame, dates=None):
    """Same-date statistics only; constants map to zero, missing inputs stay missing."""
    values = frame.replace([np.inf, -np.inf], np.nan).astype(float)
    if dates is None:
        mean, std = values.mean(), values.std()
    else:
        groups = values.groupby(np.asarray(dates), sort=False)
        mean, std = groups.transform("mean"), groups.transform("std")
    scale = std.where(std > 1e-8, 1.0)
    return (values - mean) / scale


def write_quality_report(path, models, *, min_ic, run_date, data_as_of):
    checks = {
        "ic": {"value": float(models["oof_ic"]), "minimum": min_ic},
        "nw_t": {"value": float(models["oof_ic_tstat"]), "minimum": 2.0},
        "days": {"value": int(models["oof_ic_days"]), "minimum": 60},
    }
    for check in checks.values():
        value = check["value"]
        check["passed"] = bool(np.isfinite(value) and value >= check["minimum"])
        if not np.isfinite(value):
            check["value"] = None
    report = {"run_date": run_date, "data_as_of": data_as_of,
              "publishable": all(check["passed"] for check in checks.values()),
              "checks": checks, "model_version": "weekly-data-integrity-v2"}
    if path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    return report
