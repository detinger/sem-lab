"""Execute each Colab notebook once, headless, in a fresh temporary directory (like a fresh
Colab runtime: no local files), and share the executed notebook with the tests."""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import nbformat
import pytest
from nbclient import NotebookClient

ROOT = Path(__file__).resolve().parents[2]
NB_DIR = ROOT / "notebooks"
COLAB = NB_DIR / "colab"
FIXTURES = ROOT / "packages" / "fixtures" / "synthetic"
EXAMPLES = ROOT / "content" / "examples"
BUNDLE = ROOT / "packages" / "python-engine" / "dist" / "semstudio_bundle.py"

sys.path.insert(0, str(NB_DIR))
sys.path.insert(0, str(ROOT / "packages" / "python-engine"))  # the semstudio package (independent of the bundle)

import build_notebooks

NOTEBOOKS = list(build_notebooks.NOTEBOOKS)
_CACHE: dict[str, dict] = {}


def execute(name: str) -> dict:
    if name not in _CACHE:
        nb = nbformat.read(COLAB / f"{name}.ipynb", as_version=4)
        workdir = Path(tempfile.mkdtemp(prefix=f"colab-{name}-"))
        t0 = time.perf_counter()
        NotebookClient(nb, timeout=1200, kernel_name="python3", resources={"metadata": {"path": str(workdir)}}).execute()
        elapsed = time.perf_counter() - t0
        sys.stderr.write(f"\n[notebook] {name}: executed in {elapsed:.1f} s ({workdir})\n")
        _CACHE[name] = {"nb": nb, "dir": workdir, "seconds": elapsed}
    return _CACHE[name]


@pytest.fixture(scope="session", autouse=True)
def _remove_workdirs():
    """Delete the notebooks' working folders after the session (set SEMSTUDIO_KEEP_NOTEBOOK_RUNS=1
    to keep them for inspecting the exported figures)."""
    yield
    if os.environ.get("SEMSTUDIO_KEEP_NOTEBOOK_RUNS") != "1":
        for run in _CACHE.values():
            shutil.rmtree(run["dir"], ignore_errors=True)


@pytest.fixture(params=NOTEBOOKS)
def executed(request):
    return request.param, execute(request.param)


def stream_text(nb) -> str:
    out = []
    for c in nb.cells:
        if c.cell_type == "code":
            for o in c.get("outputs", []):
                if o.get("output_type") == "stream":
                    out.append(o.get("text", ""))
    return "".join(out)
