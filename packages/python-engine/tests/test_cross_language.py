"""Cross-language parity: the same request run by the TypeScript engine (packages/engine/src,
via node) and by semlab must give the same NormalizedSemResult JSON: identical structure,
keys, ids, strings (messages, warnings, missing reasons) and numbers within 1e-10 (PLS) /
1e-7 (CB), relative to max(1, |value|). Only `provenance` (timestamps, versions) is excluded.
Skips with a reason when node or the repository's node_modules are unavailable."""

import copy
import json
import math
import os
import re
import shutil
import subprocess
import tempfile

import pytest
from helpers import FIXTURES, REF, REPO, analysis_data, load_case, load_cb_data, load_model, read_csv, read_json

ENGINE_ENTRY = REPO / "packages" / "engine" / "src" / "index.ts"
NODE = shutil.which("node")


def _node_problem():
    if NODE is None:
        return "node is not installed (the TypeScript engine cannot be run)"
    if not ENGINE_ENTRY.exists():
        return f"{ENGINE_ENTRY} not found"
    if not (REPO / "node_modules" / "ml-matrix").exists():
        return "repository node_modules missing (run `npm ci` at the repository root)"
    return None


SKIP = _node_problem()


def test_node_available_when_required():
    """CI sets SEMLAB_REQUIRE_NODE=1 so that the cross-language tests cannot skip silently."""
    if os.environ.get("SEMLAB_REQUIRE_NODE") == "1":
        assert SKIP is None, SKIP
    elif SKIP is not None:
        pytest.skip(SKIP)


def _node_flags():
    out = subprocess.run([NODE, "--version"], capture_output=True, text=True, check=True).stdout
    major = int(out.strip().lstrip("v").split(".")[0])
    # TypeScript type stripping is on by default from Node 23.6
    return [] if major >= 23 else ["--experimental-strip-types"]


_TS_CACHE = {}


def run_ts(name, request):
    if name in _TS_CACHE:
        return _TS_CACHE[name]
    code = (
        f"import {{ estimate }} from {json.dumps(ENGINE_ENTRY.as_uri())};"
        "import { readFileSync } from 'node:fs';"
        "const req = JSON.parse(readFileSync(process.argv[1], 'utf8'));"
        "const out = await estimate(req);"
        "process.stdout.write(JSON.stringify(out));"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(request, fh)
        path = fh.name
    try:
        proc = subprocess.run(
            [NODE, *_node_flags(), "--input-type=module", "-e", code, path],
            capture_output=True,
            text=True,
            cwd=str(REPO),
            timeout=600,
        )
    finally:
        os.unlink(path)
    if proc.returncode != 0:
        raise RuntimeError(f"node failed ({proc.returncode}): {proc.stderr[-2000:]}")
    out = json.loads(proc.stdout)
    _TS_CACHE[name] = out
    return out


# ---- requests -----------------------------------------------------------------------------------


def _pls_request(case, analysis, rows=None):
    model, header, data_rows = load_case(case)
    if rows is not None:
        data_rows = data_rows[:rows]
    return {"model": model, "analysis": analysis, "data": analysis_data(model, header, data_rows)}


def _pls_analysis(method, scheme, boot=None, seed=None, ipma=None):
    a = {
        "method": method,
        "engine": "browser",
        "estimator": "pls-pm",
        "missingData": "listwise",
        "pls": {"innerWeighting": scheme, "maxIterations": 300, "tolerance": 1e-7},
    }
    if boot is not None:
        a["seed"] = seed
        a["bootstrap"] = boot
    if ipma is not None:
        a["ipma"] = {"targetConstructId": ipma}
    return a


def _boot(reps, sides="two-sided", level=0.95):
    return {"enabled": True, "repetitions": reps, "ci": "percentile", "confidenceLevel": level, "sides": sides}


def _acsi():
    ex = read_json(REPO / "content" / "examples" / "acsi-2015.json")
    header, rows = read_csv(FIXTURES / "third-party" / "smartpls-samples" / "acsi-2015" / "data.csv")
    analysis = dict(ex["analysis"], engine="browser")
    return {"model": ex["model"], "analysis": analysis, "data": analysis_data(ex["model"], header, rows)}


def _delone_ipma():
    ref = read_json(REF / "pls" / "delone-mclean__pls-sem__path__ipma-c_nb.json")
    model, header, rows = load_case("delone-mclean")
    analysis = dict(ref["request"]["analysis"], engine="browser", seed=11, bootstrap=_boot(100))
    return {"model": ref["request"]["model"], "analysis": analysis, "data": analysis_data(ref["request"]["model"], header, rows)}


def _n8():
    ref = read_json(REF / "pls-bootstrap" / "tam-mediation-n8__pls-sem.json")
    model, header, rows = load_case(ref["case"])
    return {
        "model": ref["request"]["model"],
        "analysis": dict(ref["request"]["analysis"], engine="browser"),
        "data": analysis_data(ref["request"]["model"], header, rows[: ref["rows"]]),
    }


def _cb(case, variant):
    from helpers import analysis_for

    return {"model": load_model(case), "analysis": analysis_for(variant), "data": load_cb_data(case)}


PLS_CASES = {
    "tam-mediation pls-sem path B=500": lambda: _pls_request(
        "tam-mediation", _pls_analysis("pls-sem", "path", _boot(500), 20261119)
    ),
    "tam-mediation plsc centroid B=200 one-sided 90%": lambda: _pls_request(
        "tam-mediation", _pls_analysis("plsc", "centroid", _boot(200, "one-sided", 0.9), 7)
    ),
    "pls-mixed-composite pls-sem factorial B=200 (Mode B)": lambda: _pls_request(
        "pls-mixed-composite", _pls_analysis("pls-sem", "factorial", _boot(200), 3)
    ),
    "poor-discriminant plsc path (inadmissible draws)": lambda: _pls_request(
        "poor-discriminant", _pls_analysis("plsc", "path", _boot(100), 5)
    ),
    "delone-mclean IPMA + B=100": _delone_ipma,
    "tam-mediation n=8 (failed draws)": _n8,
    "ACSI 2015 example (IPMA, B=1000)": _acsi,
    "error: engine mismatch": lambda: dict(
        _pls_request("tam-mediation", _pls_analysis("pls-sem", "path")),
        analysis=dict(_pls_analysis("pls-sem", "path"), engine="r-csem"),
    ),
}
CB_CASES = {
    "service-quality ML marker": lambda: _cb("service-quality", "ml-marker"),
    "service-quality MLR marker": lambda: _cb("service-quality", "mlr-marker"),
    "cfa-two-factor ML std-lv": lambda: _cb("cfa-two-factor", "ml-stdlv"),
    "missing-mcar ML FIML": lambda: _cb("missing-mcar", "ml-fiml"),
    "missing-mcar MLR FIML": lambda: _cb("missing-mcar", "mlr-fiml"),
    "cb-heywood-exact ML (Heywood, df = 0)": lambda: _cb("cb-heywood-exact", "ml-marker"),
    "error: cb-singular": lambda: _cb("cb-singular", "ml-marker"),
}


# ---- comparison -------------------------------------------------------------------------------


def _family(path):
    head = path.split(".")[0].split("[")[0]
    if head == "result":
        parts = path.split(".")
        return parts[1].split("[")[0] if len(parts) > 1 else "result"
    return head


def compare(py, ts, tol, devlog, report, path="", mismatches=None):
    if mismatches is None:
        mismatches = []
    if isinstance(ts, dict):
        if not isinstance(py, dict):
            mismatches.append(f"{path}: type {type(py).__name__} vs object")
            return mismatches
        keys_ts = set(ts) - {"provenance"}
        keys_py = set(py) - {"provenance"}
        if keys_ts != keys_py:
            mismatches.append(f"{path}: keys {sorted(keys_py ^ keys_ts)} differ")
        for k in sorted(keys_ts & keys_py):
            compare(py[k], ts[k], tol, devlog, report, f"{path}.{k}" if path else k, mismatches)
        return mismatches
    if isinstance(ts, list):
        if not isinstance(py, list) or len(py) != len(ts):
            mismatches.append(f"{path}: list length {len(py) if isinstance(py, list) else py!r} vs {len(ts)}")
            return mismatches
        for i, (a, b) in enumerate(zip(py, ts)):
            compare(a, b, tol, devlog, report, f"{path}[{i}]", mismatches)
        return mismatches
    if isinstance(ts, bool) or ts is None or isinstance(ts, str):
        if py != ts or type(py) is not type(ts):
            mismatches.append(f"{path}: {py!r} vs {ts!r}")
        return mismatches
    # number
    if isinstance(py, bool) or not isinstance(py, (int, float)):
        mismatches.append(f"{path}: {py!r} vs number {ts!r}")
        return mismatches
    d = abs(py - ts) / max(1.0, abs(ts))
    devlog.track(report, _family(path), d, path)
    if not (d <= tol) or (math.isfinite(py) != math.isfinite(ts)):
        mismatches.append(f"{path}: {py!r} vs {ts!r} (Δ {d:.2e})")
    return mismatches


@pytest.mark.skipif(SKIP is not None, reason=SKIP or "")
@pytest.mark.parametrize("name", list(PLS_CASES))
def test_pls_python_equals_typescript(eng, devlog, name):
    req = PLS_CASES[name]()
    ts = run_ts(name, req)
    py = eng.estimate(req["model"], req["analysis"], req["data"])
    mm = compare(py, ts, 1e-10, devlog, f"cross-language PLS TS↔Python, tol 1e-10 ({eng.__name__})")
    assert not mm, "\n".join(mm[:20])


_CB_MSG = re.compile(
    r"^ML by Fisher scoring with Newton refinement: (\d+) iterations, max \|gradient\| (\S+)\.$"
)


def _normalise_cb(out):
    """The optimiser's stopping decision is taken at the 1e-15 gradient level, where the two
    languages' floating-point summation orders differ: the iteration count may differ by one
    or two and the printed final max |gradient| (~1e-15) differs. Both are checked against
    explicit bounds here and then masked; every number of the result is still compared."""
    out = copy.deepcopy(out)
    if not out.get("ok"):
        return out, None
    est = out["result"]["estimation"]
    m = _CB_MSG.match(est["messages"][0])
    assert m, est["messages"][0]
    info = (int(m.group(1)), float(m.group(2)), est["iterations"])
    est["messages"][0] = "ML by Fisher scoring with Newton refinement: <n> iterations, max |gradient| <g>."
    est["iterations"] = 0
    return out, info


@pytest.mark.skipif(SKIP is not None, reason=SKIP or "")
@pytest.mark.parametrize("name", [n for n in CB_CASES if not n.startswith("error: cb-singular")])
def test_cb_python_equals_typescript(eng, devlog, name):
    req = CB_CASES[name]()
    ts, ts_info = _normalise_cb(run_ts(name, req))
    py, py_info = _normalise_cb(eng.estimate(req["model"], req["analysis"], req["data"]))
    if ts_info is not None:
        assert py_info is not None
        assert py_info[0] == py_info[2] and ts_info[0] == ts_info[2]
        assert abs(py_info[0] - ts_info[0]) <= 2, (py_info, ts_info)
        assert py_info[1] < 1e-9 and ts_info[1] < 1e-9, (py_info, ts_info)
        devlog.track(
            f"cross-language CB TS↔Python, tol 1e-7 ({eng.__name__})",
            "optimiser iterations (|Δ|, count)",
            abs(py_info[0] - ts_info[0]),
            name,
        )
    mm = compare(py, ts, 1e-7, devlog, f"cross-language CB TS↔Python, tol 1e-7 ({eng.__name__})")
    assert not mm, "\n".join(mm[:20])


@pytest.mark.skipif(SKIP is not None, reason=SKIP or "")
def test_cb_singular_error_equals_typescript(eng):
    """s7 = s1 + s2 exactly: the null vector's three coefficients are tied in magnitude up to
    1e-16, so WHICH indicator the message leads with is rounding noise in either language.
    Code, reason, the set of dependent indicators and the normalised dependency must agree."""
    name = "error: cb-singular"
    req = CB_CASES[name]()
    ts = run_ts(name, req)
    py = eng.estimate(req["model"], req["analysis"], req["data"])
    assert not ts["ok"] and not py["ok"]
    assert py["error"]["code"] == ts["error"]["code"] == "DATA_ZERO_VARIANCE"
    pd, td = py["error"]["details"], ts["error"]["details"]
    assert pd["reason"] == td["reason"] == "singular-covariance"
    assert sorted(pd["elementIds"]) == sorted(td["elementIds"])
    assert set(pd["dependency"]) == set(td["dependency"])
    for k, v in td["dependency"].items():
        assert abs(pd["dependency"][k] - v) < 1e-9, k
    assert abs(pd["smallestEigenvalue"]) < 1e-12 and abs(td["smallestEigenvalue"]) < 1e-12
    assert py["error"]["message"].startswith("The sample covariance matrix of the indicators is singular")
