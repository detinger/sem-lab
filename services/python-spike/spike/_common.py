"""Shared helpers for the Phase 0 Python spike scripts (apps/api/spike/*.py).

Nothing in here is statistical: paths, the tam-v1 specification, JSON hygiene
(NaN/Infinity -> null, json.dump(allow_nan=False)) and a tiny check recorder.
"""

from __future__ import annotations

import importlib.metadata as md
import json
import math
import platform
import traceback
import warnings
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[3]
EVIDENCE_DIR = REPO_ROOT / "docs" / "validation" / "phase-0" / "evidence" / "python"
TAM_DATA = REPO_ROOT / "TEMP" / "Example - TAM" / "Data.txt"

# --- tam-v1: SEM Studio's own specification of the classic Technology Acceptance Model -----
TAM_BLOCKS: dict[str, list[str]] = {
    "PU": ["USEF1", "USEF2", "USEF3", "USEF4", "USEF5"],
    "PEOU": ["EOU1", "EOU2", "EOU3", "EOU4", "EOU5"],
    "ATU": ["ATT1", "ATT2", "ATT3", "ATT4", "ATT5"],
    "BI": ["BI1", "BI2", "BI3"],
    "USE": ["USE1", "USE2", "USE3", "USE4"],
}
# (from, to)
TAM_PATHS: list[tuple[str, str]] = [
    ("PEOU", "PU"),
    ("PEOU", "ATU"),
    ("PU", "ATU"),
    ("PU", "BI"),
    ("ATU", "BI"),
    ("BI", "USE"),
]
TAM_ENDOGENOUS = ["PU", "ATU", "BI", "USE"]
TAM_INDICATORS = [mv for mvs in TAM_BLOCKS.values() for mv in mvs]


def load_tam() -> pd.DataFrame:
    """Semicolon-separated, header row, 1190 complete cases, 22 numeric columns."""
    df = pd.read_csv(TAM_DATA, sep=";")
    assert df.shape == (1190, 22), df.shape
    assert not df.isna().any().any()
    return df


def inject_missing(df: pd.DataFrame, n_cells: int = 30, seed: int = 20261119) -> pd.DataFrame:
    """Copy of df with n_cells single cells (distinct rows) set to NaN, deterministically."""
    out = df.copy()
    rng = np.random.default_rng(seed)
    rows = rng.choice(len(out), size=n_cells, replace=False)
    cols = rng.integers(0, out.shape[1], size=n_cells)
    for r, c in zip(rows, cols):
        out.iat[int(r), int(c)] = np.nan
    return out


# --- JSON hygiene -----------------------------------------------------------------------------
def clean(x: Any) -> Any:
    """Recursively convert to plain JSON types; NaN/Infinity become None (ground rule 5)."""
    if x is None or isinstance(x, (bool, str, int)):
        return x
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, np.generic):
        return clean(x.item())
    if isinstance(x, np.ndarray):
        return [clean(v) for v in x.tolist()]
    if isinstance(x, pd.DataFrame):
        return {
            "index": [str(i) for i in x.index],
            "columns": [str(c) for c in x.columns],
            "data": [[clean(v) for v in row] for row in x.to_numpy(dtype=object).tolist()],
        }
    if isinstance(x, pd.Series):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple, set)):
        return [clean(v) for v in x]
    if isinstance(x, Path):
        return str(x)
    return str(x)


def dump_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(clean(obj), fh, indent=2, allow_nan=False, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {path.relative_to(REPO_ROOT)}")


def versions() -> dict[str, str]:
    pkgs = ["numpy", "pandas", "scipy", "statsmodels", "scikit-learn", "semopy", "plspm", "sympy", "numdifftools"]
    return {"python": platform.python_version(), **{p: md.version(p) for p in pkgs}}


# --- check recorder -----------------------------------------------------------------------------
class Recorder:
    """Runs named probes, recording value / exception / warnings instead of crashing the script."""

    def __init__(self) -> None:
        self.results: dict[str, dict[str, Any]] = {}

    def run(self, name: str, fn: Callable[[], Any]) -> Any:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                value = fn()
                rec: dict[str, Any] = {"ok": True, "value": value}
            except Exception as e:  # noqa: BLE001 - recording any failure is the purpose
                tb = traceback.extract_tb(e.__traceback__)
                where = f"{tb[-1].filename.split('site-packages/')[-1]}:{tb[-1].lineno}" if tb else "?"
                rec = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:500]}", "where": where}
                value = None
        warns = sorted(
            {
                f"{w.category.__name__} @ {str(w.filename).split('site-packages/')[-1]}:{w.lineno}: {str(w.message)[:160]}"
                for w in caught
            }
        )
        if warns:
            rec["warnings"] = warns
        self.results[name] = rec
        flag = "ok  " if rec["ok"] else "FAIL"
        print(f"[{flag}] {name}" + ("" if rec["ok"] else f"  -> {rec['error'][:160]}"))
        return value


def max_abs_diff(a: Any, b: Any) -> float:
    return float(np.max(np.abs(np.asarray(a, dtype=float) - np.asarray(b, dtype=float))))
