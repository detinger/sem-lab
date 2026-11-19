"""Engine subprocess runner: bounded concurrency, wall-clock timeout, cooperative + forced cancellation."""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .config import Settings
from .store import TERMINAL, JobStore

log = logging.getLogger("sem_studio.runner")

_ENV_ALLOW_EXACT = {"PATH", "HOME", "LANG", "TMPDIR", "TZ", "USER", "SHELL", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"}
_ENV_ALLOW_PREFIX = ("LC_", "R_", "SEM_STUDIO_", "OMP_", "OPENBLAS_", "MKL_", "RENV_")

# outcome passed to the finalizer
EXITED, TIMED_OUT, CANCELLED, START_FAILED, INTERRUPTED = (
    "exited",
    "timed_out",
    "cancelled",
    "start_failed",
    "interrupted",
)


def engine_env(extra: dict[str, str]) -> dict[str, str]:
    """A whitelist of the API's environment: engines get no API secrets by default."""
    env = {k: v for k, v in os.environ.items() if k in _ENV_ALLOW_EXACT or k.startswith(_ENV_ALLOW_PREFIX)}
    env.update(extra)
    return env


def process_matches(pid: int, job_dir: Path) -> bool:
    """True if `pid` is alive and its command line mentions this job directory (guards against pid reuse)."""
    try:
        out = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return False
    return out.returncode == 0 and str(job_dir) in out.stdout


def _killpg(pid: int, sig: int) -> None:
    try:
        os.killpg(pid, sig)  # pgid == pid because the engine is started in its own session
    except (ProcessLookupError, PermissionError):
        pass


class Runner:
    def __init__(self, settings: Settings, store: JobStore, on_finished: Callable[[str, str, int | None], None]):
        self.settings = settings
        self.store = store
        self.on_finished = on_finished
        self._pool = ThreadPoolExecutor(max_workers=settings.max_concurrent_jobs, thread_name_prefix="engine")
        self._lock = threading.Lock()
        self._cancel: dict[str, threading.Event] = {}
        self._procs: dict[str, subprocess.Popen] = {}
        self._stopping = False
        self.running_now = 0
        self.peak_running = 0

    def is_tracked(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancel

    def has_process(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._procs

    def submit(self, job_id: str) -> None:
        with self._lock:
            self._cancel[job_id] = threading.Event()
        self._pool.submit(self._run, job_id)

    def cancel(self, job_id: str) -> None:
        """Cooperative first (cancel file), then SIGTERM to the process group; the worker escalates to SIGKILL."""
        with self._lock:
            ev = self._cancel.get(job_id)
            proc = self._procs.get(job_id)
        if ev is not None:
            ev.set()
        try:
            (self.store.job_dir(job_id) / "cancel").touch()
        except OSError:
            pass
        if proc is not None and proc.poll() is None:
            _killpg(proc.pid, signal.SIGTERM)

    def _run(self, job_id: str) -> None:
        try:
            self._run_inner(job_id)
        except Exception as e:  # never let a worker thread die silently; log type only (messages may carry data)
            log.error("runner failure", extra={"job_id": job_id, "error_type": type(e).__name__})
            self.on_finished(job_id, START_FAILED, None)
        finally:
            with self._lock:
                self._cancel.pop(job_id, None)
                self._procs.pop(job_id, None)

    def _run_inner(self, job_id: str) -> None:
        row = self.store.get(job_id)
        with self._lock:
            ev = self._cancel[job_id]
        if row is None or row.state in TERMINAL:
            return
        if ev.is_set():
            self.on_finished(job_id, CANCELLED, None)
            return
        job_dir = self.store.job_dir(job_id)
        argv = [*self.settings.engine_r_command, str(job_dir)]  # list, never shell=True; path is ours
        try:
            with open(job_dir / "engine.log", "ab") as logf:
                proc = subprocess.Popen(  # noqa: S603
                    argv,
                    cwd=job_dir,
                    stdin=subprocess.DEVNULL,
                    stdout=logf,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                    env=engine_env(self.settings.engine_env_extra),
                    shell=False,
                )
        except OSError as e:
            log.error("engine start failed", extra={"job_id": job_id, "error_type": type(e).__name__})
            self.on_finished(job_id, START_FAILED, None)
            return
        with self._lock:
            self._procs[job_id] = proc
            self.running_now += 1
            self.peak_running = max(self.peak_running, self.running_now)
        self.store.set_pid(job_id, proc.pid)
        self.store.set_state(job_id, "validating")
        log.info("engine started", extra={"job_id": job_id})

        deadline = time.monotonic() + self.settings.job_timeout_seconds
        outcome = EXITED
        term_at: float | None = None
        while proc.poll() is None:
            now = time.monotonic()
            if term_at is None:
                if ev.is_set():
                    outcome, term_at = CANCELLED, now
                    _killpg(proc.pid, signal.SIGTERM)
                elif now > deadline:
                    outcome, term_at = TIMED_OUT, now
                    (job_dir / "cancel").touch()
                    _killpg(proc.pid, signal.SIGTERM)
            elif now - term_at > self.settings.cancel_grace_seconds:
                _killpg(proc.pid, signal.SIGKILL)
            time.sleep(0.05)
        # Whatever the exit, nothing of this job may outlive it (e.g. R parallel workers).
        _killpg(proc.pid, signal.SIGKILL)
        if self._stopping:
            outcome = INTERRUPTED
        elif ev.is_set():
            outcome = CANCELLED
        with self._lock:
            self.running_now -= 1
        self.on_finished(job_id, outcome, proc.returncode)

    def shutdown(self) -> None:
        self._stopping = True
        with self._lock:
            events = list(self._cancel.values())
            procs = list(self._procs.values())
        for ev in events:
            ev.set()
        for p in procs:
            if p.poll() is None:
                _killpg(p.pid, signal.SIGKILL)
        self._pool.shutdown(wait=True, cancel_futures=True)
