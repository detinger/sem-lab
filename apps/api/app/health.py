"""Engine availability probing. An engine is reported available only if a probe actually succeeded."""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from importlib import metadata
from pathlib import Path
from typing import Any

from .config import Settings

R_ENGINES = {"r-csem": "cSEM", "r-seminr": "seminr", "r-lavaan": "lavaan"}
PY_ENGINES = {"py-semopy": "semopy", "py-plspm": "plspm"}

_R_PACKAGE_PROBE = (
    'for (p in c("cSEM","seminr","lavaan")) cat(p, "=", '
    'if (requireNamespace(p, quietly = TRUE)) as.character(packageVersion(p)) else "", "\\n", sep = "")'
)


def _resolve(cmd: list[str]) -> str | None:
    if not cmd:
        return None
    first = cmd[0]
    if os.sep in first:
        return first if os.access(first, os.X_OK) and Path(first).is_file() else None
    return shutil.which(first)


def _run(argv: list[str], timeout: float) -> tuple[bool, str]:
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return False, ""
    return out.returncode == 0, (out.stdout + out.stderr).strip()


def _rscript_argv(s: Settings) -> list[str] | None:
    if s.rscript_command:
        return s.rscript_command
    engine = _resolve(s.engine_r_command)
    if engine:
        sibling = Path(engine).resolve().parent / "rscript"  # services/r-engine/bin/rscript sets the project library
        if sibling.is_file() and os.access(sibling, os.X_OK):
            return [str(sibling)]
    found = shutil.which("Rscript")
    return [found] if found else None


def probe_r(s: Settings) -> dict[str, Any]:
    engine_cmd = _resolve(s.engine_r_command)
    base: dict[str, Any] = {"engineCommand": engine_cmd is not None, "rVersion": None, "packages": {}}
    if engine_cmd is None:
        return {**base, "reason": "R engine command not found or not executable"}
    argv = _rscript_argv(s)
    if argv is None:
        return {**base, "reason": "Rscript not found"}
    ok, text = _run([*argv, "--version"], 20)
    if not ok:
        return {**base, "reason": "`Rscript --version` failed"}
    base["rVersion"] = text.splitlines()[0] if text else None
    ok, text = _run([*argv, "-e", _R_PACKAGE_PROBE], 60)
    pkgs: dict[str, str] = {}
    if ok:
        for line in text.splitlines():
            name, _, ver = line.partition("=")
            if name.strip() in R_ENGINES.values() and ver.strip():
                pkgs[name.strip()] = ver.strip()
    base["packages"] = pkgs
    return base


class HealthProbe:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.Lock()
        self._cached: tuple[float, dict[str, Any]] | None = None

    def r(self) -> dict[str, Any]:
        with self._lock:
            now = time.monotonic()
            if self._cached is None or now - self._cached[0] > self.settings.health_probe_ttl_seconds:
                self._cached = (now, probe_r(self.settings))
            return self._cached[1]

    def engines(self) -> list[dict[str, Any]]:
        r = self.r()
        out: list[dict[str, Any]] = []
        for eid, pkg in R_ENGINES.items():
            ver = r["packages"].get(pkg)
            available = bool(r["engineCommand"] and r["rVersion"] and ver)
            reason = None if available else (r.get("reason") or f"R package {pkg} is not installed")
            out.append(
                {
                    "id": eid,
                    "available": available,
                    "version": ver,
                    "runtime": r["rVersion"],
                    "reason": reason,
                    "jobs": available,
                }
            )
        for eid, pkg in PY_ENGINES.items():
            try:
                ver = metadata.version(pkg)
            except metadata.PackageNotFoundError:
                ver = None
            out.append(
                {
                    "id": eid,
                    "available": ver is not None,
                    "version": ver,
                    "runtime": None,
                    "reason": "installed; the API has no job-protocol adapter for Python engines yet"
                    if ver
                    else f"Python package {pkg} is not installed",
                    # The package is importable, but no job-protocol adapter exists for it yet.
                    "jobs": False,
                }
            )
        return out
