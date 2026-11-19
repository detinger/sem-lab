"""Phase 0: run spike/compat_probe.py across interpreter / numpy / pandas / scipy combinations.

Each combination is installed by uv into a throw-away environment
(`uv run --no-project --python <X> --with <pins> python compat_probe.py`), so the project
environment in apps/api/.venv is not touched.

Run:  cd apps/api && uv run python spike/compat_matrix.py
Writes: docs/validation/phase-0/evidence/python/compat_matrix.json

"install_ok" false means uv could not resolve/build the combination for that interpreter;
"checks" lists every probe check with ok/error. Nothing here is inferred: a combination
that is not listed was not run.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from _common import EVIDENCE_DIR, TAM_DATA, dump_json

PROBE = Path(__file__).with_name("compat_probe.py")

# label, python, pins (exact).  statsmodels / scikit-learn are direct imports of plspm.
COMBOS: list[tuple[str, str, dict[str, str]]] = [
    (
        "py312-latest (unpinned resolution on 2026-11-19)",
        "3.12",
        {"numpy": "2.5.5", "pandas": "3.1.1", "scipy": "1.18.1", "statsmodels": "0.15.0", "scikit-learn": "1.9.1"},
    ),
    (
        "py312-pandas3.0",
        "3.12",
        {"numpy": "2.4.6", "pandas": "3.0.6", "scipy": "1.17.1", "statsmodels": "0.15.0", "scikit-learn": "1.9.1"},
    ),
    (
        "py312-pandas2.3-numpy2.5",
        "3.12",
        {"numpy": "2.5.5", "pandas": "2.3.3", "scipy": "1.18.1", "statsmodels": "0.15.0", "scikit-learn": "1.9.1"},
    ),
    (
        "py312-pandas2.3-numpy2.4",
        "3.12",
        {"numpy": "2.4.6", "pandas": "2.3.3", "scipy": "1.17.1", "statsmodels": "0.14.6", "scikit-learn": "1.8.0"},
    ),
    (
        "py312-pandas2.3-numpy2.3",
        "3.12",
        {"numpy": "2.3.5", "pandas": "2.3.3", "scipy": "1.16.3", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
    (
        "py312-pandas2.3-numpy2.2",
        "3.12",
        {"numpy": "2.2.6", "pandas": "2.3.3", "scipy": "1.15.3", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
    (
        "py312-pandas2.2-numpy2.2",
        "3.12",
        {"numpy": "2.2.6", "pandas": "2.2.3", "scipy": "1.15.3", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
    (
        "py312-pandas2.2-numpy2.0",
        "3.12",
        {"numpy": "2.0.2", "pandas": "2.2.3", "scipy": "1.14.1", "statsmodels": "0.14.6", "scikit-learn": "1.6.1"},
    ),
    (
        "py312-pandas2.2-numpy1.26",
        "3.12",
        {"numpy": "1.26.4", "pandas": "2.2.3", "scipy": "1.13.1", "statsmodels": "0.14.6", "scikit-learn": "1.6.1"},
    ),
    (
        "py312-pandas2.2-numpy2.0-scipy1.13",
        "3.12",
        {"numpy": "2.0.2", "pandas": "2.2.3", "scipy": "1.13.1", "statsmodels": "0.14.6", "scikit-learn": "1.6.1"},
    ),
    (
        "py312-pandas2.3-numpy2.2-scipy1.13",
        "3.12",
        {"numpy": "2.2.6", "pandas": "2.3.3", "scipy": "1.13.1", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
    (
        "py311-pandas2.3-numpy2.2-scipy1.13",
        "3.11",
        {"numpy": "2.2.6", "pandas": "2.3.3", "scipy": "1.13.1", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
    (
        "py310-pandas2.3-numpy2.2-scipy1.13",
        "3.10",
        {"numpy": "2.2.6", "pandas": "2.3.3", "scipy": "1.13.1", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
    (
        "py311-pandas2.3-numpy2.2",
        "3.11",
        {"numpy": "2.2.6", "pandas": "2.3.3", "scipy": "1.15.3", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
    (
        "py310-pandas2.3-numpy2.2",
        "3.10",
        {"numpy": "2.2.6", "pandas": "2.3.3", "scipy": "1.15.3", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
    (
        "py313-pandas2.3-numpy2.2",
        "3.13",
        {"numpy": "2.2.6", "pandas": "2.3.3", "scipy": "1.15.3", "statsmodels": "0.14.6", "scikit-learn": "1.7.2"},
    ),
]

ENGINES = {"semopy": "2.3.11", "plspm": "0.5.7"}


def run_combo(label: str, python: str, pins: dict[str, str]) -> dict:
    cmd = ["uv", "run", "--quiet", "--no-project", "--python", python]
    for name, ver in {**pins, **ENGINES}.items():
        cmd += ["--with", f"{name}=={ver}"]
    cmd += ["python", str(PROBE), str(TAM_DATA)]
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)  # noqa: S603 - fixed argv, no shell
    elapsed = time.perf_counter() - t0
    rec: dict = {"label": label, "requested_python": python, "pins": {**pins, **ENGINES}, "seconds": elapsed}
    last = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
    try:
        probe = json.loads(last)
    except json.JSONDecodeError:
        rec.update({"install_ok": False, "returncode": proc.returncode, "stderr_tail": proc.stderr.strip()[-1500:]})
        return rec
    rec.update(
        {
            "install_ok": True,
            "python": probe["python"],
            "resolved_versions": probe["versions"],
            "all_checks_ok": probe["ok"],
            "failed": probe["failed"],
            "checks": probe["checks"],
            "warning_categories": probe["warning_categories"],
        }
    )
    return rec


def main() -> None:
    only = set(sys.argv[1:])
    combos = [c for c in COMBOS if not only or any(c[0].startswith(o) for o in only)]
    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(lambda c: run_combo(*c), combos))

    out_path = EVIDENCE_DIR / "compat_matrix.json"
    if only and out_path.exists():
        # Partial re-run: keep earlier records for combinations that were not re-run.
        previous = {r["label"]: r for r in json.loads(out_path.read_text())["results"]}
        previous.update({r["label"]: r for r in results})
        order = [c[0] for c in COMBOS]
        results = [previous[label] for label in order if label in previous]

    # Do working combinations agree numerically?  Compare every numeric leaf with the first
    # fully-passing combination.
    ref = next((r for r in results if r.get("all_checks_ok")), None)
    for r in results:
        r.pop("max_abs_diff_vs_reference", None)
        r.pop("reference_label", None)
    if ref is not None:
        for r in results:
            if not r.get("install_ok"):
                continue
            worst = 0.0
            for name, chk in r["checks"].items():
                rv = ref["checks"].get(name, {})
                if not (chk["ok"] and rv.get("ok")):
                    continue
                a, b = chk["value"], rv["value"]
                if isinstance(a, dict) and isinstance(b, dict):
                    for k in a:
                        if isinstance(a[k], float) and isinstance(b.get(k), float):
                            worst = max(worst, abs(a[k] - b[k]))
            r["max_abs_diff_vs_reference"] = worst
            r["reference_label"] = ref["label"]

    dump_json(
        out_path,
        {
            "generated_by": "apps/api/spike/compat_matrix.py",
            "probe": "apps/api/spike/compat_probe.py",
            "engines": ENGINES,
            "results": results,
        },
    )
    for r in results:
        status = "INSTALL-FAIL" if not r.get("install_ok") else ("ok" if r["all_checks_ok"] else "FAIL " + ",".join(r["failed"]))
        print(f"{r['label']:55s} {status[:200]}  diff={r.get('max_abs_diff_vs_reference')}")


if __name__ == "__main__":
    main()
