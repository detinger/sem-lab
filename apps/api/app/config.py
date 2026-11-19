"""Runtime configuration, read from the environment once per app instance."""

from __future__ import annotations

import os
import shlex
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ENGINE_COMMAND = REPO_ROOT / "services" / "r-engine" / "bin" / "run-job"
DEFAULT_REGISTRY = REPO_ROOT / "packages" / "method-registry" / "registry.json"


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as e:
        raise SystemExit(f"environment variable {name} must be an integer") from e


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as e:
        raise SystemExit(f"environment variable {name} must be a number") from e


@dataclass
class Settings:
    app_env: str = "production"
    data_dir: Path = Path(".sem-studio-data")
    data_retention_hours: float = 24.0
    max_csv_mb: int = 25
    max_rows: int = 200_000
    max_columns: int = 500
    max_bootstrap_reps: int = 10_000
    max_concurrent_jobs: int = 2
    max_queued_jobs: int = 20
    job_timeout_seconds: int = 1800
    cancel_grace_seconds: float = 10.0
    sweep_interval_seconds: float = 600.0
    allowed_origins: list[str] = field(default_factory=list)
    # argv prefix; the job directory is appended as the last argument. Never run through a shell.
    engine_r_command: list[str] = field(default_factory=lambda: [str(DEFAULT_ENGINE_COMMAND)])
    # Rscript used only for the health probe (package availability); default: wrapper next to the engine, else PATH.
    rscript_command: list[str] | None = None
    registry_path: Path = DEFAULT_REGISTRY
    rate_limit_jobs_per_minute: int = 10
    trust_proxy_headers: bool = False
    engine_env_extra: dict[str, str] = field(default_factory=dict)
    health_probe_ttl_seconds: float = 300.0

    @property
    def development(self) -> bool:
        return self.app_env == "development"

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @classmethod
    def from_env(cls) -> Settings:
        env = os.environ
        origins = [o.strip() for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
        cmd = shlex.split(env["ENGINE_R_COMMAND"]) if env.get("ENGINE_R_COMMAND") else [str(DEFAULT_ENGINE_COMMAND)]
        rscript = shlex.split(env["ENGINE_RSCRIPT_COMMAND"]) if env.get("ENGINE_RSCRIPT_COMMAND") else None
        return cls(
            app_env=env.get("APP_ENV", "production"),
            data_dir=Path(env.get("DATA_DIR", ".sem-studio-data")),
            data_retention_hours=_float("DATA_RETENTION_HOURS", 24.0),
            max_csv_mb=_int("MAX_CSV_MB", 25),
            max_rows=_int("MAX_ROWS", 200_000),
            max_columns=_int("MAX_COLUMNS", 500),
            max_bootstrap_reps=_int("MAX_BOOTSTRAP_REPS", 10_000),
            max_concurrent_jobs=max(1, _int("MAX_CONCURRENT_JOBS", 2)),
            max_queued_jobs=_int("MAX_QUEUED_JOBS", 20),
            job_timeout_seconds=_int("JOB_TIMEOUT_SECONDS", 1800),
            cancel_grace_seconds=_float("CANCEL_GRACE_SECONDS", 10.0),
            sweep_interval_seconds=_float("SWEEP_INTERVAL_SECONDS", 600.0),
            allowed_origins=origins,
            engine_r_command=cmd,
            rscript_command=rscript,
            registry_path=Path(env.get("REGISTRY_PATH", str(DEFAULT_REGISTRY))),
            rate_limit_jobs_per_minute=_int("RATE_LIMIT_JOBS_PER_MINUTE", 10),
            trust_proxy_headers=env.get("TRUST_PROXY_HEADERS", "").lower() in ("1", "true", "yes"),
        )
