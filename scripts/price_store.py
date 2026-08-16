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

TABLE = "price_daily"
COLS = ["Open", "High", "Low", "Close", "Volume"]

# 중복 구간 괴리율이 이 값을 넘으면 기업행위로 보고 전량 재적재.
# 관측된 잡음은 0.1% 미만, 배당 조정은 통상 1~3%, 분할은 수십~수백 %.
RESYNC_PCT = 0.01
# PostgREST 페이지 크기 (Supabase max-rows 기본값과 동일하게 잡아 잘림 방지)
PAGE = 1000
# 한 번에 보낼 upsert 행 수
CHUNK = 1000


def _headers(extra: dict | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    if extra:
        h.update(extra)
    return h


def enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def read(ticker: str) -> pd.DataFrame:
    """저장된 전 구간 조회. 테이블 부재·오류 시 빈 DataFrame.

    PostgREST 는 기본 1,000행에서 잘리므로 반드시 페이지네이션한다
    (조용히 잘리면 과거 구간이 통째로 사라져 피처가 오염된다).
    """
    if not enabled():
        return pd.DataFrame()
    frames, offset = [], 0
    while True:
        url = (f"{SUPABASE_URL}/rest/v1/{TABLE}"
               f"?ticker=eq.{requests.utils.quote(ticker, safe='')}"
               f"&select=date,open,high,low,close,volume"
               f"&order=date.asc&limit={PAGE}&offset={offset}")
        try:
            r = requests.get(url, headers=_headers(), timeout=20)
        except Exception:
            return pd.DataFrame()
        if not r.ok:
            return pd.DataFrame()
        rows = r.json()
        if not rows:
            break
        frames.append(pd.DataFrame(rows))
        if len(rows) < PAGE:
            break
        offset += PAGE

    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    out["date"] = pd.to_datetime(out["date"])
    out = out.set_index("date").sort_index()
    out = out[~out.index.duplicated(keep="last")]
    out = out.rename(columns={"open": "Open", "high": "High", "low": "Low",
                              "close": "Close", "volume": "Volume"})
    return out[COLS].astype(float)


def _write(ticker: str, df: pd.DataFrame) -> int:
    """행 삽입(멱등 upsert). 반환: 전송 행 수."""
    if df.empty or not enabled():
        return 0

    def _num(x):
        return None if pd.isna(x) else float(x)

    rows = [{
        "ticker": ticker,
        "date":   pd.Timestamp(idx).strftime("%Y-%m-%d"),
        "open":   _num(r.get("Open")),
        "high":   _num(r.get("High")),
        "low":    _num(r.get("Low")),
        "close":  _num(r.get("Close")),
        "volume": _num(r.get("Volume")),
    } for idx, r in df.iterrows() if not pd.isna(r.get("Close"))]

    sent = 0
    for i in range(0, len(rows), CHUNK):
        batch = rows[i:i + CHUNK]
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/{TABLE}?on_conflict=ticker,date",
                headers=_headers({
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=minimal",
                }),
                json=batch, timeout=60,
            )
        except Exception as exc:
            print(f"    [warn] {ticker} 시세 적재 실패(네트워크): {exc}")
            return sent
        if not resp.ok:
            print(f"    [warn] {ticker} 시세 적재 실패: {resp.status_code} {resp.text[:160]}")
            return sent
        sent += len(batch)
    return sent


def _delete(ticker: str) -> bool:
    try:
        resp = requests.delete(
            f"{SUPABASE_URL}/rest/v1/{TABLE}"
            f"?ticker=eq.{requests.utils.quote(ticker, safe='')}",
            headers=_headers({"Prefer": "return=minimal"}), timeout=60,
        )
        return resp.ok
    except Exception:
        return False


def load(ticker: str, fetcher: Callable[[str], pd.DataFrame]) -> tuple[pd.DataFrame, str]:
    """
    스냅샷 우선 시세 로드.

    반환: (DataFrame[Open,High,Low,Close,Volume], 상태문자열)
      상태: "snapshot"  저장본 사용(+신규 일자만 추가) — 재현 가능
            "seed"      최초 적재
            "resync"    기업행위 감지 → 전량 재적재
            "live"      저장소 사용 불가 → 야후 응답 그대로(재현 불가)
    """
    fresh = fetcher(ticker)

    if not enabled():
        return fresh, "live"

    stored = read(ticker)

    if stored.empty:
        if fresh.empty:
            return fresh, "live"
        _write(ticker, fresh)
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
                if _delete(ticker):
                    _write(ticker, fresh)
                    return fresh, "resync"
                return fresh, "live"

    # 저장본 우선 + 신규 일자만 추가 (저장된 값은 절대 덮어쓰지 않는다)
    new_idx = fresh.index.difference(stored.index)
    if len(new_idx) > 0:
        _write(ticker, fresh.loc[new_idx])
        merged = pd.concat([stored, fresh.loc[new_idx][COLS]]).sort_index()
    else:
        merged = stored
    return merged[COLS], "snapshot"
