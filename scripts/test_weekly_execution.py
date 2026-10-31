"""Offline recovery regressions: no secrets, network, training or production writes."""
import ast
from datetime import datetime
import io
import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import zipfile

import weekly_execution as weekly

TARGET = "2026-10-30"
ROOT = Path(__file__).resolve().parents[1]
NETWORK_BLOCK = patch("socket.socket.connect", side_effect=AssertionError("network is disabled in offline tests"))


def setUpModule():
    NETWORK_BLOCK.start()


def tearDownModule():
    NETWORK_BLOCK.stop()


def quality(**values):
    checks = {"ic": dict(value=.0275, minimum=.01, passed=True),
              "nw_t": dict(value=1.57, minimum=2., passed=False),
              "days": dict(value=624, minimum=60, passed=True)}
    return dict(run_date=TARGET, data_as_of=TARGET, publishable=False,
                model_version="weekly-data-integrity-v2", checks=checks, **values)


def receipt(status="withheld", **extra):
    result = dict(schema=1, run_date=TARGET, run_id=10, run_attempt=1,
                  mode="production", status=status, exit_code=78, quality=quality())
    result.update(extra)
    return result


def run(run_id=10, **extra):
    data = dict(id=run_id, head_branch="master", head_sha="abc", path=weekly.WORKFLOW,
                event="schedule", status="completed", conclusion="success", run_attempt=1,
                created_at="2026-10-30T07:12:00Z")
    data.update(extra)
    return data


class FakeAPI:
    def __init__(self, runs=(), evidence=(), jobs=()):
        self.runs, self.evidence, self.jobs = runs, evidence, jobs
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        return run(99, status="in_progress")

    def pages(self, path, key):
        self.calls.append(path)
        if key == "workflow_runs":
            return iter(self.runs)
        if key == "jobs":
            return iter(self.jobs)
        run_id = int(path.split("/")[3])
        return iter(dict(id=i, name=f"weekly-execution-{TARGET}-{row['run_id']}-{row['run_attempt']}",
                         expired=False) for i, row in enumerate(self.evidence) if row["run_id"] == run_id)

    def receipt(self, artifact):
        return self.evidence[artifact["id"]]


class Scheduling(unittest.TestCase):
    def test_delay_across_midnight_keeps_friday(self):
        for instant in ("2026-10-30T07:12:00Z", "2026-10-30T14:07:59Z", "2026-10-31T06:42:00Z"):
            now = weekly.timestamp(instant)
            self.assertEqual(weekly.target_friday(now, now), TARGET)

    def test_rejects_early_late_stale_and_nonweekly_events(self):
        for instant in ("2026-10-30T07:11:59Z", "2026-10-31T09:00:01Z", "2026-11-01T03:00:00Z",
                        "2026-11-02T03:00:00Z", "2026-11-05T03:00:00Z"):
            now = weekly.timestamp(instant)
            with self.subTest(instant=instant), self.assertRaises(weekly.EvidenceError):
                weekly.target_friday(now, now)
        with self.assertRaises(weekly.EvidenceError):
            weekly.target_friday(weekly.timestamp("2026-10-30T07:12:00Z"),
                                 weekly.timestamp("2026-11-06T07:12:00Z"))

    def test_guard_and_model_use_one_pinned_date(self):
        source = ast.parse((ROOT / "scripts/hybrid_ensemble.py").read_text())
        main = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "main")
        assignment = next(node for node in main.body if isinstance(node, ast.Assign)
                          and any(isinstance(t, ast.Name) and t.id == "run_date" for t in node.targets))
        with patch.dict(os.environ, {"WEEKLY_RUN_DATE": TARGET}):
            self.assertEqual(eval(compile(ast.Expression(assignment.value), "date", "eval"),
                                  dict(os=os, datetime=datetime, ZoneInfo=weekly.ZoneInfo)), TARGET)

    def test_late_monitor_still_recognizes_the_expected_friday(self):
        now = weekly.timestamp("2026-11-01T03:00:00Z")
        self.assertEqual(weekly.target_friday(now, now, monitor=True), TARGET)
        before_next_due = weekly.timestamp("2026-11-06T06:00:00Z")
        self.assertEqual(weekly.target_friday(before_next_due, before_next_due, monitor=True), TARGET)


class Decisions(unittest.TestCase):
    def test_no_run_is_recovered(self):
        self.assertEqual(weekly.decide(TARGET, []), ("train", "missing_run"))

    def test_published_batch_never_trains_even_with_lost_artifact(self):
        self.assertEqual(weekly.decide(TARGET, [], unknown=True, has_batch=True), ("skip", "published_batch"))

    def test_normal_withholding_is_terminal_even_if_other_run_failed(self):
        self.assertEqual(weekly.decide(TARGET, [receipt(), receipt("failed", retry_safe=False)], unknown=True),
                         ("skip", "quality_withheld"))

    def test_failed_before_quality_has_one_bounded_retry(self):
        failed = receipt("failed", retry_safe=True, quality=None)
        self.assertEqual(weekly.decide(TARGET, [failed]), ("train", "retry_failed"))
        self.assertEqual(weekly.decide(TARGET, [failed, failed]), ("block", "retry_budget_exhausted"))

    def test_ambiguous_failure_missing_evidence_and_inflight_do_not_train(self):
        cases = [([receipt("failed", retry_safe=False)], {}, "ambiguous_model_failure"),
                 ([], dict(unknown=True), "missing_execution_evidence"),
                 ([], dict(active=True), "execution_in_progress"),
                 ([receipt("prepared")], {}, "unknown_execution_outcome"),
                 ([receipt("published")], {}, "publication_evidence_conflict")]
        for rows, flags, reason in cases:
            self.assertEqual(weekly.decide(TARGET, rows, **flags), ("block", reason))
        self.assertEqual(weekly.decide(TARGET, [receipt("skipped", reason="published_batch")]),
                         ("block", "publication_evidence_conflict"))

    def test_tampered_or_incomplete_withholding_cannot_suppress_execution(self):
        reports = []
        for path, value in [(('publishable',), True), (('run_date',), '2026-10-23'),
                            (('model_version',), 'untrusted'), (('data_as_of',), '2026-10-31'),
                            (('data_as_of',), '2026-10-01'), (('checks', 'nw_t', 'minimum'), 1),
                            (('checks', 'nw_t', 'passed'), True)]:
            report = quality()
            container = report
            for key in path[:-1]:
                container = container[key]
            container[path[-1]] = value
            reports.append(report)
        reports += [None, {}, dict(run_date=TARGET)]
        for report in reports:
            self.assertFalse(weekly.valid_withholding(report, TARGET))
            self.assertEqual(weekly.decide(TARGET, [receipt(quality=report)])[0], "block")
        self.assertEqual(weekly.decide(TARGET, [receipt(exit_code=1)])[0], "block")

    def test_all_gate_checks_passing_cannot_be_called_withholding(self):
        report = quality()
        report["checks"]["nw_t"].update(value=2.1, passed=True)
        self.assertFalse(weekly.valid_withholding(report, TARGET))


class History(unittest.TestCase):
    def inspect(self, api, attempt=1):
        return weekly.history(api, TARGET, 99, attempt, "master")

    def test_reviewed_legacy_quality_is_terminal_only_for_pinned_run(self):
        legacy = weekly.LEGACY_WITHHELD
        old_run = run(legacy["run_id"], head_sha=legacy["sha"], conclusion="failure")
        artifact = dict(id=legacy["artifact_id"], name=f"weekly-model-quality-{legacy['run_id']}", expired=False)
        jobs = [dict(steps=[dict(name="Run Hybrid Stacking Ensemble", conclusion="failure")])]
        class LegacyAPI(FakeAPI):
            def pages(self, path, key):
                if key == "artifacts": return iter([artifact])
                return super().pages(path, key)
            def legacy_quality(self, value): return quality()
        rows, unknown, _ = self.inspect(LegacyAPI([old_run], jobs=jobs))
        self.assertFalse(unknown)
        self.assertEqual(weekly.decide(TARGET, rows), ("skip", "quality_withheld"))
        old_run["head_sha"] = "different"
        rows, unknown, _ = self.inspect(LegacyAPI([old_run], jobs=jobs))
        self.assertTrue(unknown)
        self.assertEqual(weekly.decide(TARGET, rows, unknown=unknown)[0], "block")

    def test_legacy_quality_archive_is_hash_pinned_and_validated(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("model-quality.json", json.dumps(quality()))
        raw = buffer.getvalue()
        api = weekly.API("kosj/stock", "fake")
        with patch.dict(weekly.LEGACY_WITHHELD, {"digest": hashlib.sha256(raw).hexdigest()}), \
                patch.object(api, "read", return_value=raw):
            self.assertTrue(weekly.valid_withholding(api.legacy_quality({"id": 1}), TARGET))
        with patch.object(api, "read", return_value=raw):
            with self.assertRaises(weekly.EvidenceError): api.legacy_quality({"id": 1})
        with self.assertRaises(weekly.EvidenceError): api.legacy_quality({"expired": True})

    def test_legacy_status_cannot_be_forged_in_receipt(self):
        api = FakeAPI([run()], [receipt(status="legacy_withheld")])
        with self.assertRaises(weekly.EvidenceError): self.inspect(api)

    def test_prior_withholding_and_own_previous_attempt_are_observed(self):
        for run_id, attempt in ((10, 1), (99, 2)):
            api = FakeAPI([run(run_id, run_attempt=attempt)], [receipt(run_id=run_id)])
            rows, unknown, active = self.inspect(api, attempt)
            self.assertEqual(len(rows), 1)
            self.assertFalse(unknown or active)
            self.assertEqual(weekly.decide(TARGET, rows)[1], "quality_withheld")

    def test_each_attempt_requires_evidence(self):
        api = FakeAPI([run(run_attempt=2)], [receipt(run_attempt=2, mode="dry_run")])
        rows, unknown, _ = self.inspect(api)
        self.assertEqual(rows, [])
        self.assertTrue(unknown)

    def test_dry_run_and_unrelated_branch_workflow_do_not_count(self):
        api = FakeAPI([run(), run(11, head_branch="feature"), run(12, path="different.yml")],
                      [receipt(mode="dry_run")])
        self.assertEqual(self.inspect(api), ([], False, False))

    def test_lost_and_expired_receipts_fail_closed(self):
        rows, unknown, _ = self.inspect(FakeAPI([run()]))
        self.assertTrue(unknown)
        with self.assertRaises(weekly.EvidenceError):
            weekly.API("kosj/stock", "fake").receipt(dict(expired=True))

    def test_canceled_pending_run_is_safe_but_interrupted_model_is_not(self):
        self.assertEqual(self.inspect(FakeAPI([run(conclusion="cancelled")])), ([], False, False))
        jobs = [dict(steps=[dict(name="Run Hybrid Stacking Ensemble", conclusion="cancelled")])]
        self.assertTrue(self.inspect(FakeAPI([run(conclusion="cancelled")], jobs=jobs))[1])
        jobs[0]["steps"][0]["conclusion"] = "skipped"
        rows, unknown, _ = self.inspect(FakeAPI([run(conclusion="failure")], jobs=jobs))
        self.assertFalse(unknown)
        self.assertTrue(rows[0]["retry_safe"])

    def test_queued_sibling_does_not_block_current_serialized_run(self):
        self.assertEqual(self.inspect(FakeAPI([run(status="queued")])), ([], False, False))
        self.assertTrue(self.inspect(FakeAPI([run(status="in_progress")]))[2])

    def test_provenance_mismatch_is_blocked(self):
        evidence = receipt(schema=2)
        with self.assertRaises(weekly.EvidenceError):
            self.inspect(FakeAPI([run()], [evidence]))

    def test_run_pagination_reaches_old_terminal_evidence(self):
        api = weekly.API("kosj/stock", "fake")
        first = [run(i, head_branch="other") for i in range(100)]
        with patch.object(api, "get", side_effect=[dict(workflow_runs=first), dict(workflow_runs=[run()])]) as get:
            self.assertEqual(len(list(api.pages("/actions/workflows/1/runs?branch=master", "workflow_runs"))), 101)
            self.assertIn("page=2", get.call_args.args[0])

    def test_pagination_limit_blocks_incomplete_history(self):
        api = weekly.API("kosj/stock", "fake")
        with patch.object(api, "get", return_value=dict(workflow_runs=[run()] * 100)):
            with self.assertRaises(weekly.EvidenceError):
                list(api.pages("/actions/workflows/1/runs", "workflow_runs"))


class Authentication(unittest.TestCase):
    def test_batch_lookup_uses_both_server_headers_and_get_only(self):
        with patch.dict(os.environ, SUPABASE_URL="https://db.invalid", SUPABASE_SERVICE_ROLE_KEY="fake"), \
                patch.object(weekly.API, "read", return_value=b'[{"run_date":"2026-10-30"}]') as read:
            self.assertTrue(weekly.batch_exists(TARGET))
            url, headers = read.call_args.args
            self.assertIn("recommendation_batches?", url)
            self.assertEqual(headers, {"apikey": "fake", "Authorization": "Bearer fake"})

    def test_missing_credentials_http_error_invalid_json_and_object_block(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(weekly.EvidenceError):
            weekly.batch_exists(TARGET)
        with patch.dict(os.environ, SUPABASE_URL="https://db.invalid", SUPABASE_SERVICE_ROLE_KEY="fake"):
            for body in (b'{"message":"permission denied"}', b'bad', b'[{}]', b'null'):
                with patch.object(weekly.API, "read", return_value=body), self.assertRaises(weekly.EvidenceError):
                    weekly.batch_exists(TARGET)
            with patch.object(weekly.API, "read", side_effect=weekly.EvidenceError("403")), \
                    self.assertRaises(weekly.EvidenceError):
                weekly.batch_exists(TARGET)

    def test_artifact_redirect_never_forwards_authorization(self):
        opener = unittest.mock.Mock()
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'zip bytes'
        opener.open.side_effect = [HTTPError("https://api.github.com/zip", 302, "found",
                                             {"Location": "https://storage.invalid/signed"}, None), response]
        with patch.object(weekly, "build_opener", return_value=opener):
            weekly.API.read("https://api.github.com/zip", {"Authorization": "Bearer fake"}, artifact=True)
        self.assertEqual(opener.open.call_args_list[1].args[0].headers, {})

    def test_actual_zip_receipt_is_read_and_size_bounded(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("weekly-execution.json", json.dumps(receipt()))
        api = weekly.API("kosj/stock", "fake")
        with patch.object(api, "read", return_value=archive.getvalue()):
            self.assertEqual(api.receipt(dict(id=1, expired=False)), receipt())


class Planning(unittest.TestCase):
    def test_terminal_batch_avoids_any_history_or_training(self):
        api = FakeAPI()
        with patch.dict(os.environ, GITHUB_REF_NAME="master"), patch.object(weekly, "batch_exists", return_value=True):
            result = weekly.prepare(api, current_id=99, attempt=1, branch="master", dry_run=False,
                                    now=weekly.timestamp("2026-10-31T06:42:00Z"))
        self.assertEqual(result["decision"], "skip")
        self.assertEqual(len(api.calls), 1)

    def test_production_on_feature_branch_is_blocked(self):
        with patch.dict(os.environ, GITHUB_REF_NAME="feature"), self.assertRaises(weekly.EvidenceError):
            weekly.prepare(FakeAPI(), current_id=99, attempt=1, branch="master", dry_run=False,
                           now=weekly.timestamp("2026-10-30T08:42:00Z"))

    def test_dry_run_never_requires_production_batch_check(self):
        with patch.object(weekly, "batch_exists", side_effect=AssertionError("must not read")):
            result = weekly.prepare(FakeAPI(), current_id=99, attempt=1, branch="master", dry_run=True,
                                    now=weekly.timestamp("2026-10-30T08:42:00Z"))
        self.assertEqual(result["mode"], "dry_run")


class Execution(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous = Path.cwd()
        os.chdir(self.tmp.name)
        self.plan = receipt("prepared", decision="train", quality=None)

    def tearDown(self):
        os.chdir(self.previous)
        self.tmp.cleanup()

    def execute(self, code, outcome=None, report=None, mode="production"):
        self.plan["mode"] = mode
        def child(command, *, env, check):
            self.assertEqual(env["WEEKLY_RUN_DATE"], TARGET)
            self.assertEqual("--dry-run" in command, mode == "dry_run")
            if outcome:
                weekly.write_json(weekly.MODEL_OUTCOME, dict(status=outcome, run_date=TARGET))
            if report:
                weekly.write_json(weekly.QUALITY, report)
            return SimpleNamespace(returncode=code)
        with patch.object(weekly, "batch_exists", return_value=False):
            code = weekly.execute(self.plan, runner=child, now=weekly.timestamp("2026-10-30T08:42:00Z"))
        return code, json.loads(weekly.RECEIPT.read_text())

    def test_withheld_exit_is_normal_only_with_exact_gate_evidence(self):
        code, result = self.execute(78, "withheld", quality())
        self.assertEqual((code, result["status"]), (0, "withheld"))
        self.assertEqual(weekly.decide(TARGET, [result]), ("skip", "quality_withheld"))

    def test_exit_code_or_quality_boolean_alone_is_not_terminal(self):
        for code, outcome, report in [(1, "withheld", quality()), (78, None, quality()),
                                      (78, "withheld", None), (0, None, None)]:
            self.assertEqual(self.execute(code, outcome, report)[0], 1)
            self.assertFalse(self.plan["retry_safe"])
            self.plan = receipt("prepared", decision="train", quality=None)

    def test_publication_and_dry_run_have_distinct_outcomes(self):
        self.assertEqual(self.execute(0, "published")[1]["status"], "published")
        self.plan = receipt("prepared", decision="train", quality=None)
        self.assertEqual(self.execute(0, "dry_run", mode="dry_run")[1]["status"], "dry_run")

    def test_failure_after_completed_training_never_retrains_automatically(self):
        code, result = self.execute(1, report=quality())
        self.assertEqual(code, 1)
        self.assertEqual(weekly.decide(TARGET, [result]), ("block", "ambiguous_model_failure"))

    def test_failure_before_quality_is_bounded_retry(self):
        _, result = self.execute(1)
        self.assertEqual(weekly.decide(TARGET, [result]), ("train", "retry_failed"))

    def test_batch_appearing_during_setup_prevents_training(self):
        runner = unittest.mock.Mock(side_effect=AssertionError("must not train"))
        with patch.object(weekly, "batch_exists", return_value=True):
            self.assertEqual(weekly.execute(self.plan, runner, now=weekly.timestamp("2026-10-30T08:42:00Z")), 0)
        runner.assert_not_called()
        self.assertEqual(json.loads(weekly.RECEIPT.read_text())["status"], "skipped")

    def test_slow_setup_cannot_start_training_after_recovery_deadline(self):
        runner = unittest.mock.Mock(side_effect=AssertionError("must not train"))
        with self.assertRaises(weekly.EvidenceError):
            weekly.execute(self.plan, runner, now=weekly.timestamp("2026-10-31T09:01:00Z"))
        runner.assert_not_called()

    def test_unprepared_execution_is_rejected(self):
        self.plan["status"] = "skipped"
        with self.assertRaises(weekly.EvidenceError):
            weekly.execute(self.plan)

    def test_finalize_setup_failure_is_retryable(self):
        weekly.write_json(weekly.RECEIPT, self.plan)
        with patch.object(weekly.sys, "argv", ["weekly_execution.py", "finalize"]):
            self.assertEqual(weekly.main(), 0)
        result = json.loads(weekly.RECEIPT.read_text())
        self.assertTrue(result["retry_safe"])
        self.assertEqual(result["reason"], "setup_failed")


class WorkflowContracts(unittest.TestCase):
    def test_serial_recovery_and_receipt_upload_survive_failed_model(self):
        workflow = (ROOT / ".github/workflows/friday-prophet.yml").read_text()
        self.assertIn('cron: "12 7 * * 5"', workflow)
        self.assertIn('cron: "42 0,6 * * 6"', workflow)
        self.assertIn("group: hybrid-ensemble-weekly", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("actions: read", workflow)
        self.assertNotIn("actions: write", workflow)
        self.assertNotIn("done !=", workflow)
        self.assertIn("always() && steps.plan.outputs.run_date != ''", workflow)
        self.assertLess(workflow.index("weekly_execution.py finalize"), workflow.index("name: Save execution receipt"))
        self.assertIn("github.run_attempt", workflow)
        monitor = (ROOT / ".github/workflows/recommendation-monitor.yml").read_text()
        self.assertIn("weekly_execution.py monitor", monitor)
        self.assertNotIn("/api/recommendations/prophet", monitor)
        ci = (ROOT / ".github/workflows/trading-safety-tests.yml").read_text()
        self.assertIn("python scripts/test_weekly_execution.py", ci)


if __name__ == "__main__":
    unittest.main()
