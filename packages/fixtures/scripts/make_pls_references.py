"""Reference results for the browser engine, produced by the verified R engine (cSEM 0.7.1).

For every synthetic fixture whose model is estimable by PLS: classic PLS and PLSc under the
path, centroid and factorial schemes (no bootstrap — point estimates are the parity target),
plus IPMA (classic, path scheme) when every indicator has scale endpoints and the model has a
construct with predecessors. Output: packages/fixtures/reference-results/pls/<case>__<method>__<scheme>[__ipma-<target>].json
holding {request, result} with the engine's 17-digit numbers.

Run:  python3 packages/fixtures/scripts/make_pls_references.py [case ...]   (needs services/r-engine/bin/run-job)
      With case names, only those cases are (re)generated; without, every case in CASES.
"""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SYN = ROOT / "packages" / "fixtures" / "synthetic"
OUT = ROOT / "packages" / "fixtures" / "reference-results" / "pls"
RUN_JOB = ROOT / "services" / "r-engine" / "bin" / "run-job"
CASES = ["pls-two-construct", "pls-mixed-composite", "pls-mixed-composite-exact", "tam-mediation",
         "tam-mediation-exact", "poor-discriminant", "ipma-range-restricted", "delone-mclean", "service-quality",
         "acsi-inspired", "utaut2-inspired"]


def run(model, analysis, data_csv: Path):
    with tempfile.TemporaryDirectory() as d:
        dd = Path(d)
        shutil.copy(data_csv, dd / "data.csv")
        req = {"protocolVersion": 1, "jobId": "ref", "model": model, "analysis": analysis,
               "limits": {"maxBootstrap": 10000, "timeoutSeconds": 1800}}
        (dd / "request.json").write_text(json.dumps(req))
        subprocess.run([str(RUN_JOB), str(dd)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
        res = json.loads((dd / "result.json").read_text())
    return req, res


def main(argv=None) -> int:
    selected = list(sys.argv[1:] if argv is None else argv) or CASES
    unknown = [c for c in selected if c not in CASES]
    if unknown:
        print("unknown case(s): " + ", ".join(unknown), file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for case in selected:
        model = json.loads((SYN / case / "model.json").read_text())
        data = SYN / case / "data.csv"
        # PLS ignores covariances between constructs; the engine accepts exogenous ones only.
        for method in ("pls-sem", "plsc"):
            for scheme in ("path", "centroid", "factorial"):
                a = {"method": method, "engine": "r-csem", "estimator": "pls-pm", "missingData": "listwise",
                     "pls": {"innerWeighting": scheme, "maxIterations": 300, "tolerance": 1e-10}}
                req, res = run(model, a, data)
                name = f"{case}__{method}__{scheme}.json"
                (OUT / name).write_text(json.dumps({"request": req, "response": res}, indent=1) + "\n")
                print(("ok " if res.get("ok") else "ERR") + " " + name + ("" if res.get("ok") else f" {res['error']['code']}: {res['error']['message'][:120]}"))
                n += 1
        if all("scale" in i for i in model["indicators"]):
            ids = {c["id"] for c in model["constructs"]}
            targets = sorted({r["targetId"] for r in model["relationships"] if r["kind"] == "structural" and r["targetId"] in ids})
            sinks = [t for t in targets if not any(r["kind"] == "structural" and r["sourceId"] == t for r in model["relationships"])]
            for t in sinks[:1]:
                a = {"method": "pls-sem", "engine": "r-csem", "estimator": "pls-pm", "missingData": "listwise",
                     "pls": {"innerWeighting": "path", "maxIterations": 300, "tolerance": 1e-10}, "ipma": {"targetConstructId": t}}
                req, res = run(model, a, data)
                name = f"{case}__pls-sem__path__ipma-{t}.json"
                (OUT / name).write_text(json.dumps({"request": req, "response": res}, indent=1) + "\n")
                print(("ok " if res.get("ok") else "ERR") + " " + name)
                n += 1
    print(n, "reference runs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
