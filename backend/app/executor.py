"""
전역 공유 스레드 풀 및 TTL 캐시.

- 모든 서비스가 이 모듈의 executor를 공유 → 스레드 수 상한을 일관되게 관리
- CPU 바운드가 아닌 I/O 바운드(네트워크) 작업이므로 max_workers를 넉넉히 설정하되 무제한은 허용하지 않음
- TTL 캐시: 외부 API 중복 호출을 제거해 스레드 점유 시간을 최소화
"""
from __future__ import annotations

import os
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from typing import Any, Callable

# yfinance/FDR 호출은 I/O 대기이므로 CPU 수 × 2 + 2 정도면 충분
_MAX_WORKERS = min(16, (os.cpu_count() or 2) * 2 + 2)

# 애플리케이션 전체에서 공유하는 단일 스레드 풀
_executor = ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="svc-io")


def get_executor() -> ThreadPoolExecutor:
    return _executor


# ---------------------------------------------------------------------------
# TTL 캐시
# ---------------------------------------------------------------------------

class _CacheEntry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: Any, ttl: float):
        self.value = value
        self.expires_at = time.monotonic() + ttl


class TTLCache:
    """스레드 안전 TTL 캐시."""

    def __init__(self):
        self._store: dict[str, _CacheEntry] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> tuple[bool, Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return False, None
            if time.monotonic() > entry.expires_at:
                del self._store[key]
                return False, None
            return True, entry.value

    def set(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            self._store[key] = _CacheEntry(value, ttl)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


# 서비스별 캐시 인스턴스
market_cache = TTLCache()   # quote: 5분, chart: 30분, financials: 2시간
macro_cache   = TTLCache()  # 거시경제: 1시간
sector_cache  = TTLCache()  # 섹터: 30분


# ---------------------------------------------------------------------------
# 캐시 TTL 상수 (초)
# ---------------------------------------------------------------------------
TTL_QUOTE      = 5 * 60        # 5분
TTL_CHART      = 30 * 60       # 30분
TTL_FINANCIALS = 2 * 60 * 60   # 2시간
TTL_MACRO      = 60 * 60       # 1시간
TTL_SECTOR     = 30 * 60       # 30분
TTL_SEARCH     = 10 * 60       # 10분
