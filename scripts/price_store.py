#!/usr/bin/env python3
"""
일별 시세 스냅샷 저장소 (Supabase `price_daily`)
================================================
왜 필요한가 — 실측된 재현성 결함
--------------------------------
앙상블은 매 실행마다 yfinance에서 5년치를 새로 받았다. 그런데 같은 날 같은
코드로 5분 간격 두 번 돌리면 결과가 달라졌다(2026-08-15 dry-run 8회 실측):

    종목종가 전체 해시   d6cc774b4d0f  vs  3cbe83c94dd4   (행 수는 109,577 동일)
    삼성전자 모델순위     51 ~ 59위
    SK하이닉스 모델순위   38 ~ 46위
    OOF 일별 IC           +0.0399 ~ +0.0434
    Top20 구성            휴젤·HD한국조선해양·카카오뱅크 진입/이탈 반복

최근 60일 통계는 8회 모두 동일했고 전체 해시만 달랐다 → 흔들리는 건 과거
구간이다. auto_adjust=True 의 배당·분할 소급 조정가가 호출마다 미세하게 달라진다.
IC 변동 폭이 알고리즘 개선의 효과 크기보다 커서, 이 상태로는 어떤 개선도 측정할
수 없었다.

핵심 원칙 — append-only
-----------------------
한 번 적재된 (ticker, date) 행은 덮어쓰지 않는다. 야후가 다음 호출에 다른 값을
줘도 저장본이 이긴다. 이것이 재현성을 만든다.

예외 — 실제 기업행위
--------------------
분할·대규모 배당이 발생하면 과거 전체가 재스케일돼야 한다. 그대로 두면 저장본
(구 스케일)과 신규 행(신 스케일)이 이어붙어 가짜 급등락이 생긴다. 그래서 중복
구간의 괴리율을 매번 측정해 임계(RESYNC_PCT)를 넘으면 그 티커만 전량 재적재한다.
임계 미만의 미세 흔들림은 무시한다 — 그것이 바로 제거하려는 잡음이다.
"""

from __future__ import annotations

import os
from typing import Callable

import numpy as np
import pandas as pd
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

COLS = ["Open", "High", "Low", "Close", "Volume"]
_snapshot_revisions: dict[str, int] = {}


def revision(ticker: str) -> int | None:
    """Revision actually read/published by this process (None for live input)."""
    return _snapshot_revisions.get(ticker)

# 중복 구간 괴리율이 이 값을 넘으면 기업행위로 보고 전량 재적재.
# 관측된 잡음은 0.1% 미만, 배당 조정은 통상 1~3%, 분할은 수십~수백 %.
RESYNC_PCT = 0.01


def _headers(extra: dict | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    if extra:
        h.update(extra)
    return h


def enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def _read_snapshot(ticker: str) -> tuple[pd.DataFrame, int]:
    """One DB statement reads the entire ticker and revision consistently."""
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/read_price_snapshot",
        headers=_headers(), json={"p_ticker": ticker}, timeout=60,
    )
    resp.raise_for_status()
    snapshot = resp.json()
    rows, revision = snapshot["rows"], int(snapshot["revision"])
    _snapshot_revisions[ticker] = revision
    if not rows:
        return pd.DataFrame(), revision
    out = pd.DataFrame(rows)
    out["date"] = pd.to_datetime(out["date"])
    out = out.set_index("date").sort_index()
    out = out.rename(columns={"open": "Open", "high": "High", "low": "Low",
                              "close": "Close", "volume": "Volume"})
    return out[COLS].astype(float), revision


def read(ticker: str) -> pd.DataFrame:
    """Read a committed snapshot; configured storage failures are fatal."""
    return _read_snapshot(ticker)[0] if enabled() else pd.DataFrame()


def _publish(ticker: str, df: pd.DataFrame, revision: int, reason: str) -> None:
    """Atomic compare-and-swap: no destructive DELETE or partial chunk writes."""
    def number(value):
        return float(value) if pd.notna(value) and np.isfinite(value) else None

    rows = [{"date": pd.Timestamp(idx).strftime("%Y-%m-%d"),
             **{col.lower(): number(row.get(col)) for col in COLS}}
            for idx, row in df.iterrows()]
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/publish_price_snapshot",
        headers=_headers(), json={"p_ticker": ticker, "p_rows": rows,
                                  "p_expected_revision": revision, "p_reason": reason},
        timeout=60,
    )
    resp.raise_for_status()
    if int(resp.json()) != revision + 1:
        raise RuntimeError("Invalid snapshot publication receipt")
    _snapshot_revisions[ticker] = revision + 1


def load(ticker: str, fetcher: Callable[[str], pd.DataFrame]) -> tuple[pd.DataFrame, str]:
    """
    스냅샷 우선 시세 로드.

    반환: (DataFrame[Open,High,Low,Close,Volume], 상태문자열)
      상태: "snapshot"  저장본 사용(+신규 일자만 추가) — 재현 가능
            "seed"      최초 적재
            "resync"    기업행위 감지 → 전량 재적재
            "live"      저장소 미설정 → 야후 응답 그대로(재현 불가)
    설정된 저장소의 읽기/쓰기 오류는 전파한다. 미적재 가격으로 학습하지 않는다.
    """
    fresh = fetcher(ticker)

    if not enabled():
        return fresh, "live"

    stored, revision = _read_snapshot(ticker)

    if stored.empty:
        if fresh.empty:
            return fresh, "live"
        _publish(ticker, fresh, revision, "seed")
        return fresh, "seed"

    if fresh.empty:
        # 야후 장애 — 저장본만으로 진행(오히려 견고해진다)
        return stored, "snapshot"

    overlap = stored.index.intersection(fresh.index)
    if len(overlap) >= 20:
        a = stored.loc[overlap, "Close"].to_numpy(dtype=float)
        b = fresh.loc[overlap, "Close"].to_numpy(dtype=float)
        ok = (a > 0) & np.isfinite(a) & np.isfinite(b)
        if ok.sum() >= 20:
            drift = float(np.median(np.abs(b[ok] / a[ok] - 1.0)))
            if drift > RESYNC_PCT:
                # 분할·대규모 배당 등 실제 기업행위 → 과거 스케일이 바뀌었다.
                # 저장본을 유지하면 신·구 스케일이 이어붙어 가짜 급등락이 생긴다.
                print(f"    [resync] {ticker}: 중복구간 괴리 {drift*100:.2f}% "
                      f"(> {RESYNC_PCT*100:.0f}%) — 기업행위로 보고 전량 재적재")
                _publish(ticker, fresh, revision, "resync")
                return fresh, "resync"

    # 저장본 우선 + 신규 일자만 추가 (저장된 값은 절대 덮어쓰지 않는다)
    new_idx = fresh.index.difference(stored.index)
    if len(new_idx) > 0:
        merged = pd.concat([stored, fresh.loc[new_idx][COLS]]).sort_index()
        _publish(ticker, merged, revision, "append")
    else:
        merged = stored
    return merged[COLS], "snapshot"
