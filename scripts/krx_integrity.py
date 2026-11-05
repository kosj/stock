"""Offline KRX source checks shared by loader tests and recommendation generation."""
from datetime import timedelta
import numpy as np
import pandas as pd

FIELDS = ("foreign_net", "inst_net", "per", "pbr")


def recovery_start(today, latest, days=7):
    """Overlap the last committed date so a long outage cannot leave a silent gap."""
    if days < 1:
        raise ValueError("days must be positive")
    normal = today - timedelta(days=days)
    if latest is None:
        return today - timedelta(days=5 * 365 + 10)
    if latest > today:
        raise ValueError("future cache date")
    return min(normal, latest - timedelta(days=days))


def complete_rows(frame):
    """Do not overwrite complete cached fields with partially failed API responses."""
    if frame.empty or any(c not in frame.columns for c in FIELDS):
        return False
    return bool(np.isfinite(frame[list(FIELDS)].to_numpy(dtype=float)).all())


def cache_readiness(frame, price_dates, lookback=20):
    """Require observed supply/value on the last 20 actual price sessions.

    This follows the longest supply feature window, not calendar weekdays. It
    does not authenticate historical data or prove point-in-time fundamentals.
    """
    sessions = pd.DatetimeIndex([pd.Timestamp(d).date() for d in price_dates]).unique().sort_values()[-lookback:]
    if len(sessions) < lookback:
        return {"ready": False, "reason": "price_history_short", "missing_sessions": lookback - len(sessions)}
    if frame.empty or any(c not in frame.columns for c in FIELDS):
        return {"ready": False, "reason": "cache_missing", "missing_sessions": lookback}
    rows = frame.copy()
    rows.index = pd.DatetimeIndex([pd.Timestamp(d).date() for d in rows.index])
    if rows.index.has_duplicates:
        return {"ready": False, "reason": "cache_duplicate_dates", "missing_sessions": lookback}
    aligned = rows.reindex(sessions)[list(FIELDS)]
    valid = np.isfinite(aligned.to_numpy(dtype=float)).all(axis=1)
    missing = int((~valid).sum())
    return {"ready": missing == 0, "reason": "ready" if missing == 0 else "cache_incomplete_window",
            "missing_sessions": missing}
