"""Job service: lifecycle on top of the store and the runner."""

from __future__ import annotations

import json
import logging
import os
import shutil
import signal
import time
from typing import Any

from pydantic import ValidationError

from .config import Settings
from .contracts import NormalizedSemResult
from .errors import ENGINE_ERROR_CODES
from .runner import CANCELLED, INTERRUPTED, TIMED_OUT, Runner, process_matches
from .store import TERMINAL, JobRow, JobStore, read_progress

log = logging.getLogger("sem_studio.jobs")

MAX_RESULT_BYTES = 64 * 1024 * 1024


def _safe_text(v: Any, limit: int = 1000) -> str:
    return v[:limit] if isinstance(v, str) else ""


class JobService:
    def __init__(self, settings: Settings, store: JobStore):
        self.settings = settings
        self.store = store
        self.runner = Runner(settings, store, self.finalize)

    # ---- creation -------------------------------------------------------------------------------------------------

    def start(self, job_id: str) -> None:
        self.runner.submit(job_id)

    def queued_count(self) -> int:
        return self.store.count_in_state("queued")

    # ---- finalization -----------------------------------------------------------------------------------------------

    def read_result_file(self, job_id: str) -> tuple[str, Any]:
        """Returns ("missing"|"invalid"|"error"|"ok", payload). Contract validation happens here, once."""
        path = self.store.job_dir(job_id) / "result.json"
        try:
            if path.stat().st_size > MAX_RESULT_BYTES:
                return "invalid", "result.json is too large"
            doc = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return "missing", None
        except (OSError, ValueError):
            return "invalid", "result.json is not valid JSON"
        if not isinstance(doc, dict) or not isinstance(doc.get("ok"), bool):
            return "invalid", "result.json has no boolean ok field"
        if doc["ok"]:
            if set(doc) != {"ok", "result"}:
                return "invalid", "result.json (ok) must contain exactly ok and result"
            try:
                result = NormalizedSemResult.model_validate(doc["result"])
            except ValidationError as e:
                # Only locations and rule messages; never the offending input values.
                locs = sorted({".".join(str(x) for x in err["loc"]) for err in e.errors()})[:10]
                return "invalid", "result failed contract validation at: " + ", ".join(locs)
            expected = self._requested_engine(job_id)
            if expected and result.provenance.engine != expected:
                return "invalid", "result provenance.engine does not match the requested engine"
            return "ok", result
        err = doc.get("error")
        if set(doc) != {"ok", "error"} or not isinstance(err, dict):
            return "invalid", "result.json (error) must contain exactly ok and error"
        code = err.get("code")
        if code not in ENGINE_ERROR_CODES:
            return "invalid", "engine reported an unknown error code"
        details = err.get("details")
        try:
            if details is not None and len(json.dumps(details)) > 8192:
                details = None
        except (TypeError, ValueError):
            details = None
        return "error", {"code": code, "message": _safe_text(err.get("message")), "details": details}

    def _requested_engine(self, job_id: str) -> str | None:
        try:
            req = json.loads((self.store.job_dir(job_id) / "request.json").read_text(encoding="utf-8"))
            return req["analysis"]["engine"]
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def finalize(self, job_id: str, outcome: str, returncode: int | None) -> None:
        row = self.store.get(job_id)
        if row is None or row.state in TERMINAL:
            return
        if outcome == CANCELLED:
            self.store.finish(job_id, "cancelled", "CANCELLED", "The job was cancelled.")
            return
        if outcome == TIMED_OUT:
            self.store.finish(
                job_id,
                "failed",
                "TIMEOUT",
                f"The job exceeded the {self.settings.job_timeout_seconds} s wall-clock limit.",
            )
            return
        if outcome == INTERRUPTED:
            self.store.finish(job_id, "failed", "ENGINE_INTERNAL", "The API stopped while the job was running.")
            return
        if outcome != "exited":
            self.store.finish(job_id, "failed", "ENGINE_INTERNAL", "The engine could not be started.")
            return
        if returncode != 0:
            self.store.finish(
                job_id, "failed", "ENGINE_INTERNAL", f"The engine process crashed (exit status {returncode})."
            )
            return
        kind, payload = self.read_result_file(job_id)
        if kind == "ok":
            self.store.finish(job_id, "complete")
        elif kind == "error":
            self.store.finish(
                job_id, "failed", payload["code"], payload["message"] or payload["code"], payload["details"]
            )
        elif kind == "missing":
            self.store.finish(job_id, "failed", "ENGINE_INTERNAL", "The engine exited without writing result.json.")
        else:
            self.store.finish(job_id, "failed", "ENGINE_INTERNAL", f"The engine result was rejected: {payload}")
        log.info("job finished", extra={"job_id": job_id})

    # ---- reads ---------------------------------------------------------------------------------------------------------

    def get(self, job_id: str) -> JobRow | None:
        """Fetch a row; an unfinished job nobody is running (e.g. left over from a crash) is recovered first."""
        row = self.store.get(job_id)
        if row is not None and row.state not in TERMINAL and not self.runner.is_tracked(job_id):
            self.recover_one(row)
            row = self.store.get(job_id)
        return row

    def status(self, row: JobRow) -> dict[str, Any]:
        events = (
            read_progress(self.store.job_dir(row.id)) if row.state not in ("complete", "failed", "cancelled") else []
        )
        state = row.state
        stage: str | None = None
        progress: dict[str, Any] = {"done": None, "total": None, "failed": None, "inadmissible": None}
        if events:
            last = events[-1]
            stage = last["stage"]
            if state not in TERMINAL:
                state = stage
            # Counters are reported only as the engine wrote them (latest event that has them).
            for ev in reversed(events):
                if (
                    ev["stage"] == "bootstrapping"
                    and isinstance(ev.get("done"), int)
                    and isinstance(ev.get("total"), int)
                ):
                    for k in progress:
                        v = ev.get(k)
                        progress[k] = v if isinstance(v, int) and not isinstance(v, bool) else None
                    break
        warnings: list[dict[str, Any]] = []
        if row.state == "complete":
            kind, res = self.read_result_file(row.id)
            if kind == "ok":
                warnings = [w.model_dump(exclude_none=True) for w in res.warnings]
        error = None
        if row.state in ("failed", "cancelled") and row.error_code:
            error = {"code": row.error_code, "message": row.error_message, "details": row.error_details}
        return {
            "id": row.id,
            "status": state,
            "stage": stage,
            **progress,
            "warnings": warnings,
            "error": error,
            "engine": row.engine,
            "createdAt": _iso(row.created_at),
            "updatedAt": _iso(row.updated_at),
            "finishedAt": _iso(row.finished_at) if row.finished_at else None,
        }

    def result(self, job_id: str) -> tuple[str, Any]:
        """("ok", NormalizedSemResult) or ("invalid", reason); the job is failed if the stored result is invalid."""
        kind, payload = self.read_result_file(job_id)
        if kind == "ok":
            return "ok", payload
        reason = payload if kind == "invalid" else "result.json is missing or is not a result"
        self.store.force_fail(job_id, "ENGINE_INTERNAL", f"The engine result was rejected: {reason}")
        return "invalid", reason

    # ---- cancel / delete ------------------------------------------------------------------------------------------------

    def cancel(self, job_id: str) -> bool:
        """Cancel a running or queued job; its status becomes `cancelled` and it never has a result."""
        row = self.store.get(job_id)
        if row is None or row.state in TERMINAL:
            return False
        self.store.request_cancel(job_id)
        self.store.finish(job_id, "cancelled", "CANCELLED", "The job was cancelled.")
        if self.runner.is_tracked(job_id):
            self.runner.cancel(job_id)
        else:
            self._kill_orphan(row)
        return True

    def delete(self, job_id: str) -> None:
        row = self.store.get(job_id)
        if row is None:
            return
        self.cancel(job_id)
        # Wait (bounded) for the process to be gone so no engine is writing into a directory we delete.
        deadline = time.monotonic() + self.settings.cancel_grace_seconds + 5
        while self.runner.has_process(job_id) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.store.delete(job_id)

    # ---- recovery / retention --------------------------------------------------------------------------------------------

    def _kill_orphan(self, row: JobRow) -> None:
        if row.pid and process_matches(row.pid, self.store.job_dir(row.id)):
            try:
                os.killpg(row.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass

    def recover_one(self, row: JobRow) -> None:
        job_dir = self.store.job_dir(row.id)
        if (
            row.state == "queued"
            and not row.pid
            and (job_dir / "request.json").exists()
            and (job_dir / "data.csv").exists()
        ):
            self.runner.submit(row.id)  # never started: run it now
            return
        self._kill_orphan(row)
        kind, _ = self.read_result_file(row.id)
        if kind == "missing":
            self.store.finish(
                row.id, "failed", "ENGINE_INTERNAL", "The job was interrupted (the API restarted) and has no result."
            )
        else:
            self.finalize(row.id, "exited", 0)

    def recover_all(self) -> int:
        n = 0
        for row in self.store.all():
            if row.state not in TERMINAL and not self.runner.is_tracked(row.id):
                self.recover_one(row)
                n += 1
        for d in self.store.orphan_dirs():
            shutil.rmtree(d, ignore_errors=True)
        return n

    def sweep(self, now: float | None = None) -> int:
        cutoff = (now if now is not None else time.time()) - self.settings.data_retention_hours * 3600
        removed = 0
        for row in self.store.older_than(cutoff):
            if row.state not in TERMINAL and self.runner.is_tracked(row.id):
                continue
            self.delete(row.id)
            removed += 1
        if removed:
            log.info("retention sweep", extra={"removed": removed})
        return removed

    def shutdown(self) -> None:
        self.runner.shutdown()


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))
