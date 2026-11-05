"""No credentials, provider imports, sockets, DB writes or training."""
import ast
import argparse
from contextlib import redirect_stdout, redirect_stderr
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import sys
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import numpy as np
import pandas as pd
from krx_integrity import FIELDS, recovery_start, complete_rows, cache_readiness

ROOT = Path(__file__).resolve().parent

def load_functions(names, **scope):
    source = ast.parse((ROOT / 'krx_cache.py').read_text())
    nodes = [n for n in source.body if isinstance(n, ast.FunctionDef) and n.name in names]
    scope.update(CacheError=RuntimeError)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'krx_cache.py', 'exec'), scope)
    return scope

class KRXIntegrity(unittest.TestCase):
    def setUp(self):
        self.days = pd.bdate_range('2026-10-01', periods=25)
        self.frame = pd.DataFrame({c: np.ones(25) for c in FIELDS}, index=self.days)

    def test_exact_sessions_and_all_required_fields_are_observed(self):
        self.assertTrue(cache_readiness(self.frame, self.days)['ready'])
        self.assertTrue(cache_readiness(self.frame, self.days.tz_localize('Asia/Seoul'))['ready'])
        for frame in [self.frame.iloc[:-1], self.frame.drop(columns='per'), self.frame.iloc[:0],
                      self.frame.assign(per=np.nan)]:
            self.assertFalse(cache_readiness(frame, self.days)['ready'])
        future = self.frame.copy(); future.index += pd.Timedelta(days=60)
        self.assertFalse(cache_readiness(future, self.days)['ready'])
        missing_inside = self.frame.drop(self.days[-10])
        self.assertEqual(cache_readiness(missing_inside, self.days)['missing_sessions'], 1)
        self.assertFalse(cache_readiness(pd.concat([self.frame, self.frame.iloc[-1:]]), self.days)['ready'])

    def test_partial_or_nonfinite_source_cannot_replace_existing_fields(self):
        self.assertTrue(complete_rows(self.frame))
        for value in [np.nan, np.inf]:
            partial = self.frame.copy(); partial.iloc[0, 0] = value
            self.assertFalse(complete_rows(partial))
        self.assertFalse(complete_rows(self.frame.drop(columns='pbr')))

    def test_gap_recovery_overlaps_last_complete_commit(self):
        today = date(2026, 11, 5)
        self.assertEqual(recovery_start(today, date(2026, 9, 11)), date(2026, 9, 4))
        self.assertEqual(recovery_start(today, today), today - timedelta(days=7))
        self.assertLess(recovery_start(today, None), today - timedelta(days=1800))
        with self.assertRaises(ValueError): recovery_start(today, today, -1)
        with self.assertRaises(ValueError): recovery_start(today, today + timedelta(days=1))

    def test_authentication_failure_stops_before_any_collection_or_publication(self):
        provider = Mock(return_value=None)
        scope = load_functions({'ensure_login'}, os=type('Env', (), {'environ':{'KRX_ID':'x','KRX_PW':'y'}}),
                               get_auth_session=provider, io=io, redirect_stdout=redirect_stdout, redirect_stderr=redirect_stderr)
        with self.assertRaisesRegex(RuntimeError, 'KRX_AUTH_FAILED'): scope['ensure_login']()
        self.assertEqual(provider.call_count, 1)
        provider.return_value = Mock(is_valid=Mock(return_value=True))
        scope['ensure_login']()

    def test_failed_publication_does_not_return_success_or_leak_response(self):
        client = Mock(); client.post.return_value = Mock(ok=False, status_code=503, text='secret provider body')
        upsert = load_functions({'upsert'}, pd=pd, requests=client, SUPABASE_URL='offline', SUPABASE_KEY='fixture')['upsert']
        with self.assertRaisesRegex(RuntimeError, 'HTTP 503') as error: upsert('005930', self.frame)
        self.assertNotIn('secret', str(error.exception))

    def test_zero_or_partial_source_fails_main_without_publication(self):
        write = Mock()
        for frame in [pd.DataFrame(), self.frame.assign(per=np.nan)]:
            scope = load_functions({'main'}, argparse=argparse, ensure_login=Mock(), datetime=datetime, ZoneInfo=ZoneInfo,
                                   timedelta=timedelta, INCREMENTAL_DAYS=7, BACKFILL_YEARS=5,
                                   UNIVERSE=[{'ticker':'005930','name':'fixture'}],
                                   latest_cached=Mock(return_value=None), recovery_start=recovery_start,
                                   fetch_one=Mock(return_value=frame), complete_rows=complete_rows,
                                   upsert=write, time=Mock(), THROTTLE_SEC=0)
            with patch.object(sys, 'argv', ['krx_cache.py']), self.assertRaises(RuntimeError):
                scope['main']()
            write.assert_not_called()

if __name__ == '__main__': unittest.main()
