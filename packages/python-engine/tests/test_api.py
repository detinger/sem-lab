"""Public API: data preparation as the web app does it, dispatch, error paths (the TS engine's
codes and reasons), JSON-safety of results, plain tables and the optional pandas helpers."""

import copy
import json

import pytest
from helpers import (
    FIXTURES,
    REPO,
    analysis_data,
    analysis_for,
    load_case,
    load_cb_data,
    load_model,
    read_csv,
    read_json,
)


def _pls_analysis(**kw):
    a = {
        "method": "pls-sem",
        "engine": "browser",
        "estimator": "pls-pm",
        "missingData": "listwise",
        "pls": {"innerWeighting": "path", "maxIterations": 300, "tolerance": 1e-7},
    }
    a.update(kw)
    return a


def test_build_analysis_data_equals_the_web_app_matrix(eng):
    for case in ("tam-mediation", "delone-mclean", "pls-mixed-composite", "missing-mcar"):
        model, header, rows = load_case(case)
        assert eng.build_analysis_data(model, header, rows, "listwise") == analysis_data(model, header, rows)


def test_build_analysis_data_reverse_scoring_and_fiml(eng):
    model, header, rows = load_case("missing-mcar")
    m = copy.deepcopy(model)
    ind = m["indicators"][0]
    ind["reverseScored"] = True
    ind["scale"] = {"min": -100, "max": 100}
    d = eng.build_analysis_data(m, header, rows, "fiml")
    j = header.index(ind["column"])
    k = d["columns"].index(ind["column"])
    full = [r for r in rows if any(r[header.index(c)] is not None for c in d["columns"])]
    assert d["nRows"] == len(rows) and len(d["rows"]) == len(full)
    for src, dst in zip(full, d["rows"]):
        assert dst[k] == (None if src[j] is None else -100 + 100 - src[j])
    with pytest.raises(eng.AnalysisDataError) as ei:
        bad = copy.deepcopy(model)
        bad["indicators"][0]["column"] = "nope"
        eng.build_analysis_data(bad, header, rows)
    assert ei.value.code == "DATA_COLUMN_MISSING"


def test_read_csv(eng):
    path = FIXTURES / "synthetic" / "missing-mcar" / "data.csv"
    cols, rows = eng.read_csv(path)
    h2, r2 = read_csv(path)
    assert cols == h2 and rows == r2


def test_results_are_strict_json(eng):
    model, header, rows = load_case("tam-mediation")
    out = eng.estimate(model, _pls_analysis(seed=1, bootstrap={"enabled": True, "repetitions": 30, "ci": "percentile", "confidenceLevel": 0.95, "sides": "two-sided"}), analysis_data(model, header, rows))
    assert out["ok"]
    json.dumps(out, allow_nan=False)
    cb = eng.estimate(load_model("missing-mcar"), analysis_for("mlr-fiml"), load_cb_data("missing-mcar"))
    assert cb["ok"]
    json.dumps(cb, allow_nan=False)
    prov = cb["result"]["provenance"]
    assert prov["engine"] == "browser" and prov["packageVersions"]["semlab"] == eng.__version__


def test_progress_and_cancellation(eng):
    model, header, rows = load_case("tam-mediation")
    events = []
    an = _pls_analysis(seed=1, bootstrap={"enabled": True, "repetitions": 60, "ci": "percentile", "confidenceLevel": 0.95, "sides": "two-sided"})
    out = eng.estimate(model, an, analysis_data(model, header, rows), on_progress=events.append)
    assert out["ok"]
    stages = [e["stage"] for e in events]
    assert stages[0] == "validating" and stages[-1] == "summarizing"
    assert {"done": 60, "total": 60}.items() <= [e for e in events if e["stage"] == "bootstrapping"][-1].items()
    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        return calls["n"] > 10

    out = eng.estimate(model, an, analysis_data(model, header, rows), is_cancelled=cancel)
    assert out == {"ok": False, "error": {"code": "CANCELLED", "message": "The job was cancelled during bootstrapping."}}
    out = eng.estimate(load_model("cfa-two-factor"), analysis_for("ml-marker"), load_cb_data("cfa-two-factor"), is_cancelled=lambda: True)
    assert out["error"]["code"] == "CANCELLED"


@pytest.mark.parametrize(
    "mutate, code",
    [
        (lambda a: a.update(engine="r-csem"), "REQUEST_INVALID"),
        (lambda a: a.update(seed=1, bootstrap={"enabled": True, "repetitions": 10, "ci": "bca", "confidenceLevel": 0.95, "sides": "two-sided"}), "CAPABILITY_UNSUPPORTED"),
        (lambda a: a.update(missingData="fiml"), "REQUEST_INVALID"),
        (lambda a: a.update(method="plsc", ipma={"targetConstructId": "c_bi"}), "CAPABILITY_UNSUPPORTED"),
        (lambda a: a["pls"].update(maxIterations=1), "ENGINE_NONCONVERGENCE"),
    ],
)
def test_pls_error_codes(eng, mutate, code):
    model, header, rows = load_case("tam-mediation")
    an = _pls_analysis()
    mutate(an)
    out = eng.estimate(model, an, analysis_data(model, header, rows))
    assert not out["ok"] and out["error"]["code"] == code, out


def test_pls_data_errors(eng):
    model, header, rows = load_case("tam-mediation")
    d = analysis_data(model, header, rows)
    bad = dict(d, nDropped=d["nDropped"] + 1)
    out = eng.estimate(model, _pls_analysis(), bad)
    assert out["error"]["code"] == "REQUEST_INVALID" and out["error"]["details"]["reason"] == "data-preparation-mismatch"
    const = dict(d, rows=[[1.0] + r[1:] for r in d["rows"]])
    out = eng.estimate(model, _pls_analysis(), const)
    assert out["error"]["code"] == "DATA_ZERO_VARIANCE"
    out = eng.estimate(model, _pls_analysis(), dict(d, columns=["x"] + d["columns"][1:]))
    assert out["error"]["code"] == "DATA_COLUMN_MISSING"


def test_cb_error_paths(eng):
    base = load_model("cfa-two-factor")
    data = load_cb_data("cfa-two-factor")
    m = copy.deepcopy(base)
    m["constructs"][0]["measurement"] = "composite-formative"
    assert eng.estimate(m, analysis_for("ml-marker"), data)["error"]["code"] == "CAPABILITY_UNSUPPORTED"
    m = copy.deepcopy(base)
    a, b = [c["id"] for c in m["constructs"]]
    m["relationships"] = [
        {"id": "r1", "kind": "structural", "sourceId": a, "targetId": b},
        {"id": "r2", "kind": "structural", "sourceId": b, "targetId": a},
    ]
    out = eng.estimate(m, analysis_for("ml-marker"), data)
    assert out["error"]["code"] == "REQUEST_INVALID" and out["error"]["details"]["reason"] == "structural-cycle"
    m = copy.deepcopy(base)
    allind = [i for c in m["constructs"] for i in c["indicatorIds"]]
    k = 0
    for i in range(len(allind)):
        for j in range(i + 1, len(allind)):
            m["relationships"].append({"id": f"rc{k}", "kind": "covariance", "sourceId": allind[i], "targetId": allind[j]})
            k += 1
    assert eng.estimate(m, analysis_for("ml-marker"), data)["error"]["code"] == "MODEL_NOT_IDENTIFIED"
    m = copy.deepcopy(base)
    m["indicators"][0]["column"] = "does-not-exist"
    assert eng.estimate(m, analysis_for("ml-marker"), data)["error"]["code"] == "DATA_COLUMN_MISSING"
    an = dict(analysis_for("ml-marker"), estimator="WLSMV")
    assert eng.estimate(base, an, data)["error"]["code"] == "CAPABILITY_UNSUPPORTED"


def test_cb_empirical_underidentification(eng):
    m = load_model("cfa-two-factor")
    c1 = m["constructs"][0]
    c1["indicatorIds"] = c1["indicatorIds"][:2]
    m["indicators"] = [i for i in m["indicators"] if any(i["id"] in c["indicatorIds"] for c in m["constructs"])]
    m["relationships"] = [{"id": "rz", "kind": "covariance", "sourceId": c1["id"], "targetId": m["constructs"][1]["id"], "fixedValue": 0}]
    out = eng.estimate(m, analysis_for("ml-marker"), load_cb_data("cfa-two-factor"))
    assert out["ok"], out
    assert any(w["code"] == "CB_INFORMATION_SINGULAR" for w in out["result"]["warnings"])
    free = [p for p in out["result"]["parameters"] if p["scale"] == "unstandardized" and p["status"] == "estimated"]
    assert free and all(p["se"] is None and p["missing"]["se"] == "failed" for p in free)


def test_cb_parameter_count(eng):
    expected = {
        "cfa-one-factor": 5, "cfa-two-factor": 19, "cfa-two-factor-exact": 19, "tam-mediation-exact": 41,
        "service-quality": 62, "cb-heywood-exact": 0, "missing-mcar": 19, "cb-singular": 13,
    }
    for case, df in expected.items():
        m = load_model(case)
        assert eng.cb_parameter_count(m)["df"] == df, case
        assert eng.cb_parameter_count(m, "std-lv")["df"] == df
        assert eng.cb_parameter_count(m, "marker", True)["df"] == df
    m = load_model("tam-mediation-exact")
    peou, pu, bi = [c["id"] for c in m["constructs"]]
    m["relationships"] = [
        {"id": "r1", "kind": "structural", "sourceId": peou, "targetId": pu},
        {"id": "r2", "kind": "structural", "sourceId": peou, "targetId": bi},
    ]
    assert eng.cb_parameter_count(m)["parameters"] == 25


def test_results_tables(eng):
    ex = read_json(REPO / "content" / "examples" / "acsi-2015.json")
    header, rows = read_csv(FIXTURES / "third-party" / "smartpls-samples" / "acsi-2015" / "data.csv")
    an = dict(ex["analysis"], engine="browser")
    an["bootstrap"] = dict(an["bootstrap"], repetitions=20)
    out = eng.estimate(ex["model"], an, analysis_data(ex["model"], header, rows))
    assert out["ok"], out
    t = eng.results_tables(out["result"], ex["model"])
    for name in ("parameters", "paths", "loadings", "weights", "effects", "constructMetrics", "fit", "matrix:htmt", "ipmaConstructs", "bootstrap", "warnings"):
        assert name in t, name
    n_paths = sum(1 for r in ex["model"]["relationships"] if r["kind"] == "structural")
    assert all(r["kind"] == "path" for r in t["paths"]) and len(t["paths"]) == n_paths
    names = {c["id"]: c.get("name") or c["id"] for c in ex["model"]["constructs"]}
    assert {r["construct"] for r in t["constructMetrics"]} == set(names.values())
    json.dumps(t, allow_nan=False)
    cb = eng.estimate(load_model("service-quality"), analysis_for("mlr-marker"), load_cb_data("service-quality"))
    tc = eng.results_tables(cb["result"], load_model("service-quality"))
    assert all("std" in r for r in tc["parameters"])
    if eng.pandas_available():
        dfs = eng.to_dataframes(out["result"], ex["model"])
        assert len(dfs["paths"]) == n_paths
    else:
        with pytest.raises(ImportError):
            eng.to_dataframe(t["paths"])
