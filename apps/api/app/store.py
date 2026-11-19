"""Job store: SQLite for state, one directory per job for payloads (engine-protocol.md)."""

from __future__ import annotations

import json
import re
import secrets
import shutil
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

STATES = ("queued", "validating", "estimating", "bootstrapping", "summarizing", "complete", "failed", "cancelled")
TERMINAL = frozenset({"complete", "failed", "cancelled"})
STAGES = frozenset({"validating", "estimating", "bootstrapping", "summarizing"})
JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{22}$")


def new_job_id() -> str:
    return secrets.token_urlsafe(16)  # 128 random bits -> 22 URL-safe chars


@dataclass
class JobRow:
    id: str
    state: str
    engine: str
    created_at: float
    updated_at: float
    finished_at: float | None
    pid: int | None
    cancel_requested: bool
    error_code: str | None
    error_message: str | None
    error_details: Any


class JobStore:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.jobs_dir = data_dir / "jobs"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(data_dir / "jobs.sqlite3"), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS jobs (
                 id TEXT PRIMARY KEY, state TEXT NOT NULL, engine TEXT NOT NULL,
                 created_at REAL NOT NULL, updated_at REAL NOT NULL, finished_at REAL,
                 pid INTEGER, cancel_requested INTEGER NOT NULL DEFAULT 0,
                 error_code TEXT, error_message TEXT, error_details TEXT)"""
        )

    def job_dir(self, job_id: str) -> Path:
        if not JOB_ID_RE.match(job_id):
            raise ValueError("invalid job id")
        return self.jobs_dir / job_id

    @staticmethod
    def _row(r: tuple) -> JobRow:
        return JobRow(
            r[0], r[1], r[2], r[3], r[4], r[5], r[6], bool(r[7]), r[8], r[9], json.loads(r[10]) if r[10] else None
        )

    _COLS = (
        "id,state,engine,created_at,updated_at,finished_at,pid,cancel_requested,error_code,error_message,error_details"
    )

    def create(self, job_id: str, engine: str) -> None:
        now = time.time()
        with self._lock:
            self._db.execute(
                "INSERT INTO jobs (id,state,engine,created_at,updated_at) VALUES (?,?,?,?,?)",
                (job_id, "queued", engine, now, now),
            )

    def get(self, job_id: str) -> JobRow | None:
        with self._lock:
            r = self._db.execute(f"SELECT {self._COLS} FROM jobs WHERE id=?", (job_id,)).fetchone()
        return self._row(r) if r else None

    def all(self) -> list[JobRow]:
        with self._lock:
            rows = self._db.execute(f"SELECT {self._COLS} FROM jobs ORDER BY created_at").fetchall()
        return [self._row(r) for r in rows]

    def count_in_state(self, state: str) -> int:
        with self._lock:
            return int(self._db.execute("SELECT COUNT(*) FROM jobs WHERE state=?", (state,)).fetchone()[0])

    def set_state(self, job_id: str, state: str, *, only_if_not_terminal: bool = True) -> bool:
        """Move a job to `state`. A terminal state is final: it is never overwritten."""
        assert state in STATES
        now = time.time()
        with self._lock:
            cond = " AND state NOT IN ('complete','failed','cancelled')" if only_if_not_terminal else ""
            cur = self._db.execute(
                "UPDATE jobs SET state=?, updated_at=?, finished_at=CASE WHEN ? THEN ? ELSE finished_at END "
                f"WHERE id=?{cond}",
                (state, now, state in TERMINAL, now, job_id),
            )
            return cur.rowcount > 0

    def finish(
        self, job_id: str, state: str, code: str | None = None, message: str | None = None, details: Any = None
    ) -> bool:
        assert state in TERMINAL
        now = time.time()
        with self._lock:
            cur = self._db.execute(
                "UPDATE jobs SET state=?, updated_at=?, finished_at=?, error_code=?, error_message=?, error_details=?, pid=NULL "
                "WHERE id=? AND state NOT IN ('complete','failed','cancelled')",
                (state, now, now, code, message, json.dumps(details) if details is not None else None, job_id),
            )
            return cur.rowcount > 0

    def force_fail(self, job_id: str, code: str, message: str) -> None:
        """Used when a result that was already accepted turns out to be invalid."""
        now = time.time()
        with self._lock:
            self._db.execute(
                "UPDATE jobs SET state='failed', updated_at=?, finished_at=?, error_code=?, error_message=?, error_details=NULL "
                "WHERE id=?",
                (now, now, code, message, job_id),
            )

    def set_pid(self, job_id: str, pid: int | None) -> None:
        with self._lock:
            self._db.execute("UPDATE jobs SET pid=? WHERE id=?", (pid, job_id))

    def request_cancel(self, job_id: str) -> None:
        with self._lock:
            self._db.execute("UPDATE jobs SET cancel_requested=1, updated_at=? WHERE id=?", (time.time(), job_id))

    def delete(self, job_id: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM jobs WHERE id=?", (job_id,))
        shutil.rmtree(self.job_dir(job_id), ignore_errors=True)

    def older_than(self, cutoff: float) -> list[JobRow]:
        with self._lock:
            rows = self._db.execute(f"SELECT {self._COLS} FROM jobs WHERE created_at < ?", (cutoff,)).fetchall()
        return [self._row(r) for r in rows]

    def orphan_dirs(self) -> list[Path]:
        """Job directories with no row (e.g. a crash between mkdir and INSERT)."""
        known = {j.id for j in self.all()}
        return [p for p in self.jobs_dir.iterdir() if p.is_dir() and p.name not in known]

    def close(self) -> None:
        with self._lock:
            self._db.close()


def read_progress(job_dir: Path) -> list[dict[str, Any]]:
    """Valid progress events, in order. Malformed or unknown lines are skipped, never guessed at."""
    path = job_dir / "progress.ndjson"
    events: list[dict[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return events
    for line in text.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if isinstance(ev, dict) and ev.get("stage") in STAGES:
            events.append(ev)
    return events
