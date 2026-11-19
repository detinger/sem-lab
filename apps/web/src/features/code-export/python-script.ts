/**
 * Python export (PLAN §2.9): a driver script that runs SEM Lab's verified Python engine
 * (packages/python-engine, shipped as the single file `semlab_bundle.py`) on the exact
 * analysis matrix the app analysed, then checks its numbers against the app's own result.
 *
 * Why the app's own engine and not semopy / plspm: the Python port reproduces the browser
 * engine (PLS ≤ 2.7e-13 relative, CB ≤ 1.4e-9; packages/python-engine/tests), bootstrap draws
 * included, whereas semopy/plspm implement different estimator definitions. PLAN §2.9 allows a
 * "tested optional app-owned implementation".
 *
 * The CSV holds the prepared matrix (reverse scoring and listwise deletion already applied),
 * so the driver passes it to estimate() directly — calling build_analysis_data() on it would
 * reverse reverse-scored columns a second time.
 *
 * Safety: user text appears only in comment lines stripped of line breaks; everything else
 * the script needs is read from the JSON files next to it.
 */
import type { AnalysisConfiguration } from '@sem-lab/contracts';
import { rComment } from './r-csem';

/** Versions the exported bundle was tested with (packages/python-engine CI matrix). */
export const PYTHON_TESTED = {
  python: '3.10–3.12',
  numpy: '>=1.22.4',
  scipy: '>=1.12.0',
  pinned: { numpy: '2.2.6', scipy: '1.15.3' },
} as const;

/** Agreement the check at the end of the script requires (absolute, per number). */
export const pythonTolerance = (a: AnalysisConfiguration): number =>
  a.method === 'cb-sem' ? 1e-6 : 1e-9;

/** Comment-safe text: same stripping as the R exporter (no line breaks of any kind). */
const comment = rComment;

export interface PythonExportInput {
  analysis: AnalysisConfiguration;
  projectName: string;
  modelHash: string;
  dataFingerprint: string;
  generatedAt: string;
  appVersion: string;
}

export function exportPythonScript(input: PythonExportInput): string {
  const a = input.analysis;
  const method =
    a.method === 'cb-sem'
      ? `CB-SEM (${a.estimator}${a.missingData === 'fiml' ? ', FIML' : ''})`
      : a.method === 'plsc'
        ? 'PLSc (consistent PLS)'
        : 'PLS-SEM (classic PLS path modeling)';
  return `# =============================================================================
# SEM Lab — reproducible Python analysis
# Project: ${comment(input.projectName)}
# Method:  ${comment(method)}
# Generated ${comment(input.generatedAt)} by SEM Lab ${comment(input.appVersion)}
# Model hash:       ${input.modelHash}
# Data fingerprint: ${input.dataFingerprint}
#
# Runs SEM Lab's own estimation engine (semlab_bundle.py, the verified Python port of
# the engine in the app) on analysis-data.csv — the exact rows and columns the app analysed —
# and checks the numbers against browser-result.json, the result the app showed.
# Requirements: Python ${PYTHON_TESTED.python}, numpy ${PYTHON_TESTED.numpy}, scipy ${PYTHON_TESTED.scipy}
#   pip install -r requirements.txt        (pandas and matplotlib are optional)
# Run:  python run_analysis.py
# =============================================================================
import csv
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import semlab_bundle as semlab  # noqa: E402

TOLERANCE = ${pythonTolerance(a)}  # largest absolute difference accepted by the check below


def load(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


model = load("model.json")
analysis = load("analysis.json")
manifest = load("manifest.json")

# ---- Data: the prepared analysis matrix (empty cell = missing, only with FIML) ----------------
with open(HERE / "analysis-data.csv", encoding="utf-8", newline="") as fh:
    reader = csv.reader(fh)
    columns = next(reader)
    rows = [[None if cell == "" else float(cell) for cell in row] for row in reader if row]
n_rows = manifest["data"]["rows"]
data = {"columns": columns, "rows": rows, "nRows": n_rows, "nDropped": n_rows - len(rows)}
print(f"{len(rows)} of {n_rows} rows analysed ({analysis['missingData']}), {len(columns)} indicators")


# ---- Estimation ------------------------------------------------------------------------------
def progress(event):
    if event.get("stage") == "bootstrap" and event.get("total"):
        done = event.get("done", 0)
        if done == event["total"] or done % max(1, event["total"] // 10) == 0:
            print(f"  bootstrap {done}/{event['total']}", flush=True)


out = semlab.estimate(model, analysis, data, on_progress=progress)
if not out["ok"]:
    raise SystemExit(f"{out['error']['code']}: {out['error']['message']}")
result = out["result"]
for w in result["warnings"]:
    print(f"[{w['severity']}] {w['message']}")

# ---- Tables ----------------------------------------------------------------------------------
tables = semlab.results_tables(result, model)


def show(name, rows, fields):
    if not rows:
        return
    print(f"\\n{name}")
    for r in rows:
        print("  " + "  ".join(_fmt(r.get(f)) for f in fields))


def _fmt(v):
    if isinstance(v, float):
        return f"{v:9.4f}" if math.isfinite(v) else "      n/a"
    return str(v) if v is not None else "        —"


show("Structural paths (from, to, estimate, SE, p, CI)", tables.get("paths"),
     ["from", "to", "est", "se", "pValue", "ciLower", "ciUpper"])
show("Loadings / weights", (tables.get("loadings") or []) + (tables.get("weights") or []),
     ["from", "to", "est", "se", "pValue"])
show("Fit", tables.get("fit"), ["name", "variant", "value"])
show("IPMA (construct, importance, performance)", tables.get("ipmaConstructs"),
     ["construct", "importance", "performance"])

if semlab.pandas_available():
    frames = semlab.to_dataframes(result, model)  # every table as a pandas DataFrame
(HERE / "python-result.json").write_text(json.dumps(result, indent=1), encoding="utf-8")

# ---- Check against the app's result ----------------------------------------------------------
app = load("browser-result.json")
worst = 0.0
compared = 0


def compare(a, b):
    global worst, compared
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        worst = max(worst, abs(a - b))
        compared += 1


mine = {(p["key"], p["scale"]): p for p in result["parameters"]}
for p in app["parameters"]:
    q = mine.get((p["key"], p["scale"]))
    if q is None:
        raise SystemExit(f"Parameter {p['key']} ({p['scale']}) is missing from the Python result.")
    for f in ("est", "se", "statistic", "pValue", "ciLower", "ciUpper"):
        compare(p.get(f), q.get(f))
fit = {(f["name"], f.get("variant")): f for f in result["fit"]}
for f in app["fit"]:
    compare(f.get("value"), fit.get((f["name"], f.get("variant")), {}).get("value"))
if app.get("ipma"):
    for kind in ("constructs", "indicators"):
        for a_row, p_row in zip(app["ipma"].get(kind) or [], result["ipma"].get(kind) or []):
            compare(a_row.get("importance"), p_row.get("importance"))
            compare(a_row.get("performance"), p_row.get("performance"))
status = "OK" if worst <= TOLERANCE else "DIFFERS"
print(f"\\nCheck against the app: {compared} numbers, largest difference {worst:.3g} -> {status}")
if status != "OK":
    sys.exit(1)

# ---- Optional plot ---------------------------------------------------------------------------
try:
    import matplotlib.pyplot as plt
except ImportError:
    plt = None
if plt is not None and tables.get("ipmaConstructs"):
    ip = tables["ipmaConstructs"]
    fig, ax = plt.subplots(figsize=(6, 4.5))
    ax.scatter([r["importance"] for r in ip], [r["performance"] for r in ip])
    for r in ip:
        ax.annotate(r["construct"], (r["importance"], r["performance"]),
                    textcoords="offset points", xytext=(4, 4))
    ax.set_xlabel("Importance (unstandardized total effect)")
    ax.set_ylabel("Performance (0-100)")
    ax.set_ylim(0, 100)
    fig.tight_layout()
    fig.savefig(HERE / "ipma.png", dpi=200)
    print("IPMA map written to ipma.png")
`;
}
