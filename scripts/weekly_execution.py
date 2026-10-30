"""Weekly execution receipts and conservative recovery (stdlib only, no DB writes).

All production invocations must share the workflow's concurrency group. Artifacts
are evidence, not a lock. Missing/inaccessible evidence never means permission to
train. The existing atomic publication RPC remains the only recommendation writer.
"""
import argparse
from datetime import date, datetime, time, timedelta, timezone
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
WORKFLOW = ".github/workflows/friday-prophet.yml"
RECEIPT = Path("weekly-execution.json")
MODEL_OUTCOME = Path("model-outcome.json")
QUALITY = Path("model-quality.json")
WITHHELD_EXIT = 78
MAX_ATTEMPTS = 2


class EvidenceError(RuntimeError):
    pass


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def target_friday(created_at, now, *, monitor=False):
    """Pin to event creation, permit recovery through Saturday 18:00 KST only."""
    local = created_at.astimezone(KST)
    target = local.date() - timedelta(days=(local.weekday() - 4) % 7)
    due = datetime.combine(target, time(16, 12), KST)
    deadline = datetime.combine(target + timedelta(days=1), time(18), KST)
    if monitor:
        # Monitoring may itself arrive days late. Still recognize a terminal
        # withholding/publication instead of reporting an expired recovery window.
        if local < due:
            target -= timedelta(days=7)
        return target.isoformat()
    if not due <= local <= deadline or not due <= now.astimezone(KST) <= deadline:
        raise EvidenceError("outside Friday 16:12–Saturday 18:00 KST recovery window")
    return target.isoformat()


def write_json(path, data):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, indent=2) + "\n")
    tmp.replace(path)


def write_model_outcome(status, run_date, data_as_of):
    """Called only at the actual quality rejection or after the publication RPC."""
    path = os.environ.get("MODEL_EXECUTION_OUTCOME")
    if path:
        write_json(path, dict(status=status, run_date=run_date, data_as_of=data_as_of))


def valid_withholding(report, target):
    """Recompute the unchanged gate; a Boolean flag alone is insufficient evidence."""
    import math
    try:
        if (report["run_date"] != target or report["publishable"] is not False
                or report["model_version"] != "weekly-data-integrity-v2"):
            return False
        source = date.fromisoformat(report["data_as_of"])
        if not 0 <= (date.fromisoformat(target) - source).days <= 4:
            return False
        passed = []
        for key, minimum in (("ic", .01), ("nw_t", 2), ("days", 60)):
            check = report["checks"][key]
            value = check["value"]
            if check["minimum"] != minimum:
                return False
            ok = (isinstance(value, (int, float)) and not isinstance(value, bool)
                  and math.isfinite(value) and value >= minimum)
            if check["passed"] is not ok:
                return False
            passed.append(ok)
        return not all(passed)
    except (KeyError, TypeError, ValueError):
        return False


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class API:
    def __init__(self, repository, token):
        if not token or len(repository.split("/")) != 2:
            raise EvidenceError("GitHub identity is required")
        self.base = f"https://api.github.com/repos/{repository}"
        self.headers = {"Authorization": f"Bearer {token}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28"}

    @staticmethod
    def read(url, headers, *, artifact=False):
        try:
            opener = build_opener(NoRedirect)
            try:
                response = opener.open(Request(url, headers=headers), timeout=30)
            except HTTPError as error:
                if not artifact or error.code != 302:
                    raise
                location = error.headers.get("Location", "")
                if urlsplit(location).scheme != "https":
                    raise EvidenceError("invalid artifact download redirect")
                # Signed storage URL: never forward GitHub Authorization headers.
                response = opener.open(Request(location), timeout=30)
            with response:
                data = response.read(2_000_001)
            if len(data) > 2_000_000:
                raise EvidenceError("evidence response exceeds size limit")
            return data
        except (HTTPError, URLError, TimeoutError) as error:
            code = getattr(error, "code", "network")
            raise EvidenceError(f"evidence request failed ({code})") from None

    def get(self, path):
        try:
            data = json.loads(self.read(self.base + path, self.headers))
            if not isinstance(data, dict):
                raise EvidenceError("invalid GitHub JSON object")
            return data
        except (ValueError, TypeError):
            raise EvidenceError("invalid GitHub JSON evidence") from None

    def pages(self, path, key):
        for page in range(1, 21):
            sep = "&" if "?" in path else "?"
            data = self.get(f"{path}{sep}per_page=100&page={page}")
            items = data.get(key)
            if not isinstance(items, list):
                raise EvidenceError("invalid paginated evidence")
            yield from items
            if len(items) < 100:
                return
        raise EvidenceError("evidence pagination limit reached")

    def receipt(self, artifact):
        if artifact.get("expired"):
            raise EvidenceError("execution receipt expired")
        raw = self.read(self.base + f"/actions/artifacts/{artifact['id']}/zip",
                        self.headers, artifact=True)
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                info = archive.getinfo(RECEIPT.name)
                if info.file_size > 100_000:
                    raise EvidenceError("execution receipt too large")
                data = json.loads(archive.read(info))
                if not isinstance(data, dict):
                    raise EvidenceError("invalid execution receipt object")
                return data
        except (KeyError, ValueError, zipfile.BadZipFile):
            raise EvidenceError("invalid execution receipt archive") from None


def batch_exists(target):
    """Strict authenticated GET; no anonymous fallback or fail-open on HTTP errors."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    parsed = urlsplit(base)
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username
            or parsed.path or parsed.query or parsed.fragment or not key):
        raise EvidenceError("server-side Supabase credentials are required")
    query = urlencode({"run_date": f"eq.{target}", "select": "run_date", "limit": 1})
    try:
        rows = json.loads(API.read(f"{base}/rest/v1/recommendation_batches?{query}",
                                  {"apikey": key, "Authorization": f"Bearer {key}"}))
    except ValueError:
        raise EvidenceError("invalid batch JSON evidence") from None
    if not isinstance(rows, list) or any(row != {"run_date": target} for row in rows):
        raise EvidenceError("invalid batch lookup response")
    return bool(rows)


def history(api, target, current_id, current_attempt, branch):
    start = datetime.combine(date.fromisoformat(target), time(), KST).astimezone(timezone.utc)
    query = urlencode({"branch": branch, "created": f">={start.isoformat()}"})
    runs = api.pages(f"/actions/workflows/friday-prophet.yml/runs?{query}", "workflow_runs")
    receipts, unknown, active = [], False, False
    for run in runs:
        if (run["head_branch"] != branch or run["path"] != WORKFLOW
                or run["event"] not in ("schedule", "workflow_dispatch")):
            continue
        own = run["id"] == current_id
        if run["status"] != "completed" and not own:
            # Pending siblings wait on the SAME concurrency group. They cannot
            # have trained; an actually running sibling is unsafe to race.
            active |= run["status"] not in ("queued", "pending", "waiting", "requested")
            continue
        artifacts = list(api.pages(f"/actions/runs/{run['id']}/artifacts", "artifacts"))
        found_attempts = set()
        for artifact in artifacts:
            prefix = f"weekly-execution-{target}-{run['id']}-"
            if not artifact["name"].startswith(prefix):
                continue
            receipt = api.receipt(artifact)
            attempt = receipt.get("run_attempt")
            if (receipt.get("schema") != 1 or receipt.get("run_date") != target
                    or receipt.get("run_id") != run["id"]
                    or not isinstance(attempt, int)
                    or artifact["name"] != prefix + str(attempt)
                    or attempt > run["run_attempt"]):
                raise EvidenceError("receipt provenance mismatch")
            if own and attempt >= current_attempt:
                continue
            found_attempts.add(attempt)
            if receipt.get("mode") == "dry_run":
                continue
            if receipt.get("mode") != "production":
                raise EvidenceError("unknown receipt mode")
            receipts.append(receipt)
        # A rerun must also honor earlier attempts of its OWN run. Legacy success,
        # missing upload, cancellation and deleted evidence remain ambiguous.
        expected = range(1, current_attempt if own else run["run_attempt"] + 1)
        for attempt in expected:
            if attempt in found_attempts:
                continue
            jobs = list(api.pages(f"/actions/runs/{run['id']}/attempts/{attempt}/jobs", "jobs"))
            model_steps = [step for job in jobs for step in job.get("steps", [])
                           if step["name"] == "Run Hybrid Stacking Ensemble"]
            if not jobs and run.get("conclusion") == "cancelled":
                # GitHub may evict a pending concurrency sibling without ever
                # allocating a runner. It has no model execution to duplicate.
                continue
            if model_steps and all(step.get("conclusion") == "skipped" for step in model_steps):
                receipts.append(dict(status="failed", retry_safe=True, reason="setup_failed"))
            else:
                unknown = True
    return receipts, unknown, active


def decide(target, receipts, unknown=False, active=False, has_batch=False):
    if has_batch:
        return "skip", "published_batch"
    if active:
        return "block", "execution_in_progress"
    for receipt in receipts:
        status = receipt.get("status")
        if status == "withheld":
            if receipt.get("exit_code") == WITHHELD_EXIT and valid_withholding(receipt.get("quality"), target):
                return "skip", "quality_withheld"
            return "block", "invalid_withholding_evidence"
        if status == "published" or (status == "skipped" and receipt.get("reason") == "published_batch"):
            # A receipt says publication committed but DB says otherwise.
            return "block", "publication_evidence_conflict"
    if unknown:
        return "block", "missing_execution_evidence"
    failed = [row for row in receipts if row.get("status") == "failed"]
    if any(row.get("status") not in ("failed", "skipped", "blocked") for row in receipts):
        return "block", "unknown_execution_outcome"
    if any(row.get("retry_safe") is not True for row in failed):
        return "block", "ambiguous_model_failure"
    if len(failed) >= MAX_ATTEMPTS:
        return "block", "retry_budget_exhausted"
    return "train", "retry_failed" if failed else "missing_run"


def prepare(api, *, current_id, attempt, branch, dry_run, now, monitor=False):
    run = api.get(f"/actions/runs/{current_id}")
    target = target_friday(timestamp(run["created_at"]), now, monitor=monitor)
    receipt = dict(schema=1, run_date=target, run_id=current_id, run_attempt=attempt,
                   mode="dry_run" if dry_run else "production", status="blocked")
    if not dry_run and (run["head_branch"] != branch or os.environ.get("GITHUB_REF_NAME") != branch):
        raise EvidenceError("production execution requires the default branch")
    if dry_run:
        decision, reason = "train", "dry_run"
    elif batch_exists(target):
        decision, reason = "skip", "published_batch"
    else:
        receipts, unknown, active = history(api, target, current_id, attempt, branch)
        decision, reason = decide(target, receipts, unknown, active)
    receipt.update(decision=decision, reason=reason,
                   status={"train": "prepared", "skip": "skipped", "block": "blocked"}[decision])
    return receipt


def execute(receipt, runner=subprocess.run, *, now=None):
    if receipt["status"] != "prepared" or receipt["decision"] != "train":
        raise EvidenceError("training requires a prepared execution plan")
    target = receipt["run_date"]
    if target_friday(timestamp(target + "T16:12:00+09:00"), now or datetime.now(timezone.utc)) != target:
        raise EvidenceError("invalid weekly target")
    # Repeat the DB guard immediately before training (also covers slow installs).
    if receipt["mode"] == "production" and batch_exists(receipt["run_date"]):
        receipt.update(status="skipped", reason="published_batch")
        write_json(RECEIPT, receipt)
        return 0
    for path in (MODEL_OUTCOME, QUALITY):
        path.unlink(missing_ok=True)
    # Persist intent before spawning. A killed runner without a final artifact
    # cannot be mistaken for an absent scheduled event by the next invocation.
    receipt.update(status="failed", retry_safe=False, reason="model_interrupted")
    write_json(RECEIPT, receipt)
    env = dict(os.environ, WEEKLY_RUN_DATE=receipt["run_date"],
               MODEL_EXECUTION_OUTCOME=str(MODEL_OUTCOME), MODEL_QUALITY_REPORT=str(QUALITY))
    command = [sys.executable, "-u", "scripts/hybrid_ensemble.py"]
    if receipt["mode"] == "dry_run":
        command.append("--dry-run")
    code = runner(command, env=env, check=False).returncode
    outcome = json.loads(MODEL_OUTCOME.read_text()) if MODEL_OUTCOME.exists() else {}
    quality = json.loads(QUALITY.read_text()) if QUALITY.exists() else None
    receipt.update(exit_code=code, quality=quality)
    same_date = outcome.get("run_date") == receipt["run_date"]
    if (code == WITHHELD_EXIT and same_date and outcome.get("status") == "withheld"
            and valid_withholding(quality, receipt["run_date"])):
        receipt.update(status="withheld", reason="quality_withheld")
    elif code == 0 and same_date and outcome.get("status") in ("published", "dry_run"):
        expected = "dry_run" if receipt["mode"] == "dry_run" else "published"
        if outcome["status"] == expected:
            receipt.update(status=expected, reason=expected)
    else:
        # Retry at most once only when the process explicitly failed BEFORE
        # producing completed training/quality evidence. Never retry an uncertain
        # successful process or an error after training/publication automatically.
        receipt.update(reason="model_failed", retry_safe=code not in (0, WITHHELD_EXIT) and quality is None and not outcome)
    write_json(RECEIPT, receipt)
    return 0 if receipt["status"] in ("published", "withheld", "dry_run") else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("plan", "execute", "finalize", "monitor"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        if args.command in ("plan", "monitor"):
            api = API(os.environ["GITHUB_REPOSITORY"], os.environ.get("GH_TOKEN"))
            result = prepare(api, current_id=int(os.environ["GITHUB_RUN_ID"]),
                             attempt=int(os.environ["GITHUB_RUN_ATTEMPT"]),
                             branch=os.environ["DEFAULT_BRANCH"], dry_run=args.dry_run,
                             now=datetime.now(timezone.utc), monitor=args.command == "monitor")
            print(f"run_date={result['run_date']} decision={result['decision']} reason={result['reason']}")
            if args.command == "plan":
                write_json(RECEIPT, result)
                with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                    output.write(f"train={int(result['decision'] == 'train')}\nrun_date={result['run_date']}\n")
            elif result["decision"] == "train":
                print("::error::weekly execution absent/failed; recovery slot or operator required")
                return 1
            return int(result["decision"] == "block")
        result = json.loads(RECEIPT.read_text())
        if args.command == "execute":
            return execute(result)
        if result["status"] == "prepared":
            result.update(status="failed", retry_safe=True, reason="setup_failed")
            write_json(RECEIPT, result)
        print(f"run_date={result['run_date']} status={result['status']} reason={result['reason']}")
        if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(summary, "a") as output:
                output.write(f"Weekly {result['run_date']}: **{result['status']}** ({result['reason']})\n")
        return 0
    except EvidenceError as error:
        # EvidenceError messages are deliberately static/sanitized at their source.
        print(f"::error::{error}; automatic training blocked")
        return 1
    except (KeyError, ValueError, OSError):
        # Do not put HTTP bodies, signed URLs or credential-bearing exceptions in logs.
        print("::error::weekly execution evidence unavailable or invalid; automatic training blocked")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
