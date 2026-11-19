"""Every engine test runs twice: against the `semstudio` package and against the single-file
bundle dist/semstudio_bundle.py (the file the web app ships with exported scripts).
Maximum deviations per family are collected and printed in the terminal summary."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
BUNDLE = ROOT / "dist" / "semstudio_bundle.py"

_ENGINES = {}


def load_engine(kind):
    if kind in _ENGINES:
        return _ENGINES[kind]
    if kind == "package":
        import semstudio

        mod = semstudio
    else:
        spec = importlib.util.spec_from_file_location("semstudio_bundle", BUNDLE)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["semstudio_bundle"] = mod
        spec.loader.exec_module(mod)
    _ENGINES[kind] = mod
    return mod


@pytest.fixture(scope="session", params=["package", "bundle"])
def eng(request):
    """The engine under test: the package or the bundle."""
    return load_engine(request.param)


@pytest.fixture(scope="session")
def pkg():
    return load_engine("package")


class DeviationLog:
    """max |deviation| per (report, family), with where it occurred."""

    def __init__(self):
        self.data = {}
        self.notes = []

    def track(self, report, family, dev, where=""):
        key = (report, family)
        cur = self.data.get(key)
        if cur is None or dev > cur[0] or (cur[0] != cur[0]):
            self.data[key] = (dev, where)

    def note(self, line):
        self.notes.append(line)


LOG = DeviationLog()


@pytest.fixture(scope="session")
def devlog():
    return LOG


def pytest_terminal_summary(terminalreporter):
    if not LOG.data and not LOG.notes:
        return
    tr = terminalreporter
    tr.section("semstudio parity report")
    for report in sorted({k[0] for k in LOG.data}):
        tr.write_line(report)
        for (rep, fam), (dev, where) in sorted(LOG.data.items()):
            if rep != report:
                continue
            tr.write_line(f"  {fam:<34} max |Δ| = {dev:.2e}  {where}")
    for line in LOG.notes:
        tr.write_line(line)
