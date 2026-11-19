"""The Colab notebooks run top to bottom without errors, reproduce the fixture data byte for byte,
ship the committed engine, and report exactly the numbers of SEM Lab's Python engine
(package `semlab`) on the fixture data. The statements made in the notebooks' interpretation
cells are checked against the results, so a change of data or engine cannot silently turn the
text wrong."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math

import pytest
import semlab
from conftest import BUNDLE, COLAB, EXAMPLES, FIXTURES, NOTEBOOKS, build_notebooks, execute, stream_text


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def case_of(name):
    return build_notebooks.NOTEBOOKS[name]["case"]


# ---------------------------------------------------------------------------------------------
# Static checks (no execution)
# ---------------------------------------------------------------------------------------------

def test_notebooks_are_current():
    built = build_notebooks.build_all()
    assert sorted(built) == sorted(p.name for p in COLAB.glob("*.ipynb"))
    for name, b in built.items():
        assert (COLAB / name).read_bytes() == b, f"{name} is stale: run notebooks/build_notebooks.py"


@pytest.mark.parametrize("name", NOTEBOOKS)
def test_structure(name):
    nb = json.loads((COLAB / f"{name}.ipynb").read_text(encoding="utf-8"))
    text = "".join("".join(c["source"]) for c in nb["cells"])
    assert "SYNTHETIC" in text
    assert "colab.research.google.com" not in text and "githubusercontent" not in text, "no Open-in-Colab links yet"
    # Colab preinstalls numpy/scipy/pandas/matplotlib: reinstalling them would force a runtime restart
    for line in text.splitlines():
        stripped = line.strip()
        assert not stripped.startswith("!pip"), line
        if stripped.startswith("%pip"):
            assert not any(p in stripped for p in ("numpy", "scipy", "pandas", "matplotlib")), line
    engine = [c for c in nb["cells"] if c["cell_type"] == "code" and "".join(c["source"]).startswith("%%writefile semlab_bundle.py")]
    assert len(engine) == 1 and engine[0]["metadata"].get("cellView") == "form"
    src = "".join(engine[0]["source"])
    body = src.split("\n", 2)[2]  # drop the magic and the #@title line
    # notebook sources drop the final newline; the verification cell restores it before hashing
    assert body + "\n" == BUNDLE.read_text(encoding="utf-8"), "engine cell must embed the committed bundle verbatim"
    forms = [c for c in nb["cells"] if c["metadata"].get("cellView") == "form"]
    assert all(any(line.startswith("#@title") for line in c["source"][:2]) for c in forms)
    headings = [c for c in nb["cells"] if c["cell_type"] == "markdown"]
    joined = "".join("".join(c["source"]) for c in headings)
    for required in ("Learning objectives", "hypotheses", "Setup", "Data", "Export", "Questions", "Challenges"):
        assert required in joined, f"{name}: section '{required}' missing"


@pytest.mark.parametrize("name", NOTEBOOKS)
def test_generator_code_is_extracted_not_copied(name):
    """The data cells hold the generator's own source text (ast-extracted at build time)."""
    gen = (build_notebooks.GENERATOR).read_text(encoding="utf-8")
    nb = json.loads((COLAB / f"{name}.ipynb").read_text(encoding="utf-8"))
    spec = build_notebooks.NOTEBOOKS[name]
    cells = ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"]
    fn_cell = next(c for c in cells if f"def {spec['data_fn']}(" in c)
    start = gen.index(f"def {spec['data_fn']}(")
    end = gen.index("\n\n\n", start)
    assert gen[start:end] in fn_cell


# ---------------------------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------------------------

def test_executes_without_errors(executed):
    name, run = executed
    for c in run["nb"].cells:
        for o in c.get("outputs", []) if c.cell_type == "code" else []:
            assert o.get("output_type") != "error", f"{name}: {o.get('ename')}: {o.get('evalue')}"


def test_data_and_engine_are_the_fixture_and_committed_bundle(executed):
    name, run = executed
    case = case_of(name)
    manifest = json.loads((FIXTURES / case / "manifest.json").read_text())
    data = (run["dir"] / "data.csv").read_bytes()
    assert sha256(data) == manifest["sha256"] == sha256((FIXTURES / case / "data.csv").read_bytes())
    assert (run["dir"] / "semlab_bundle.py").read_bytes() == BUNDLE.read_bytes()
    assert (run["dir"] / "model.json").read_bytes() == (FIXTURES / case / "model.json").read_bytes()
    text = stream_text(run["nb"])
    assert f"== fixture {case}" in text and "verified" in text


def _close(a, b, path, tol=1e-12):
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), f"{path}: keys differ"
        for k in a:
            _close(a[k], b[k], f"{path}.{k}", tol)
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), f"{path}: lengths differ"
        for i, (x, y) in enumerate(zip(a, b)):
            _close(x, y, f"{path}[{i}]", tol)
    elif isinstance(a, float) or isinstance(b, float):
        assert abs(a - b) <= tol * max(1.0, abs(a)), f"{path}: {a} vs {b}"
    else:
        assert a == b, f"{path}: {a!r} vs {b!r}"


def test_results_equal_the_python_engine_on_the_fixture(executed):
    """The notebook's exported result.json equals semlab (the package) on the fixture files."""
    name, run = executed
    case = case_of(name)
    exp = run["dir"] / "exports"
    analysis = json.loads((exp / "analysis.json").read_text())
    model = json.loads((FIXTURES / case / "model.json").read_text())
    columns, rows = semlab.read_csv(str(FIXTURES / case / "data.csv"))
    out = semlab.estimate(model, analysis, semlab.build_analysis_data(model, columns, rows, analysis["missingData"]))
    assert out["ok"], out.get("error")
    mine = json.loads((exp / "result.json").read_text())
    ref = json.loads(json.dumps(out["result"]))
    for r in (mine, ref):
        r.pop("provenance")
    _close(mine, ref, "result")


def test_analysis_matches_the_app_example_or_fixture(executed):
    """Same configuration as the SEM Lab example (content/examples/<case>.json), bootstrap draws
    included, or, for cases without an example yet, as the fixture's first
    browser analysis."""
    name, run = executed
    case = case_of(name)
    analysis = json.loads((run["dir"] / "exports" / "analysis.json").read_text())
    example = EXAMPLES / f"{case}.json"
    if example.is_file():
        ex = json.loads(example.read_text())
        assert ex["model"] == json.loads((FIXTURES / case / "model.json").read_text())
        ref = ex["analysis"]
    else:
        ref = next(a["analysis"] for a in json.loads((FIXTURES / case / "analyses.json").read_text())
                   if a["analysis"]["engine"] == "browser")

    # identical, bootstrap draws included: app and notebook report the same intervals
    assert analysis == ref


def test_exports(executed):
    name, run = executed
    exp = run["dir"] / "exports"
    for f in ("data.csv", "model.json", "analysis.json", "result.json", "tables_word.html", "model.png", "model_estimated.png"):
        assert (exp / f).is_file(), f"{name}: exports/{f} missing"
    html = (exp / "tables_word.html").read_text(encoding="utf-8")
    assert html.count("<table") >= 2 and "style=" in html and "<link" not in html and "<script" not in html
    assert (run["dir"] / f"{name}_exports.zip").is_file()
    for png in exp.glob("*.png"):
        assert png.stat().st_size > 10_000, f"{png.name} looks empty"


# ---------------------------------------------------------------------------------------------
# The statements in the interpretation cells
# ---------------------------------------------------------------------------------------------

def _tables(name):
    run = execute(name)
    exp = run["dir"] / "exports"
    result = json.loads((exp / "result.json").read_text())
    model = json.loads((exp / "model.json").read_text())
    return run, exp, result, model, semlab.results_tables(result, model)


def _sig(r):
    return r["ciLower"] > 0 or r["ciUpper"] < 0


def _csv(path):
    return list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))


def test_01_story():
    _, _, result, _, t = _tables("01_tam_pls_sem")
    assert all(_sig(p) for p in t["paths"])
    assert min(r["est"] for r in t["loadings"]) > 0.708
    eff = {(e["kind"], e["from"], e["to"]): e for e in t["effects"]}
    ind, tot = eff[("indirect-effect", "PEOU", "BI")], eff[("total-effect", "PEOU", "BI")]
    assert _sig(ind) and 0.6 < ind["est"] / tot["est"] < 0.7
    m = {r["construct"]: r for r in t["constructMetrics"]}
    assert 0.30 < m["BI"]["r2"] < 0.36 and 0.22 < m["PU"]["r2"] < 0.28
    f2 = {r[""]: r for r in t["matrix:f2"]}
    assert f2["PEOU"]["BI"] < 0.02 and 0.25 < f2["PU"]["BI"] < 0.35
    assert result["bootstrap"]["requested"] == 5000


def test_02_story():
    _, exp, _, _, t = _tables("02_acsi_pls_sem")
    assert len(t["paths"]) == 7 and all(_sig(p) for p in t["paths"])
    assert min(r["est"] for r in t["loadings"]) > 0.708
    htmt = [(r[""], k, v) for r in t["matrix:htmt"] for k, v in r.items() if k != "" and v is not None]
    worst = max(htmt, key=lambda x: x[2])
    assert {worst[0], worst[1]} == {"PQ", "SAT"} and worst[2] < 0.85
    ip = {r["construct"]: r for r in t["ipmaConstructs"]}
    assert max(ip, key=lambda c: ip[c]["importance"]) == "SAT"
    assert min(ip, key=lambda c: ip[c]["performance"]) == "PV"
    assert max(ip, key=lambda c: ip[c]["performance"]) == "PQ"
    sat = {r["construct"]: float(r["importance"]) for r in _csv(exp / "ipma_satisfaction_constructs.csv")}
    assert sat["PQ"] > sat["CE"] > sat["PV"] > 0
    modes = _csv(exp / "mode_a_vs_mode_b_paths.csv")
    assert max(abs(float(r["difference"])) for r in modes) < 0.01


def test_03_story():
    _, _, _, _, t = _tables("03_delone_mclean_is_success_pls_sem")
    assert len(t["paths"]) == 9 and all(_sig(p) for p in t["paths"])
    assert all(_sig(e) for e in t["effects"] if e["kind"] == "specific-indirect" and e["to"] == "NB")
    ip = {r["construct"]: r for r in t["ipmaConstructs"]}
    order = sorted(ip, key=lambda c: -ip[c]["importance"])
    assert order[:2] == ["SAT", "USE"]
    assert min(ip, key=lambda c: ip[c]["performance"]) == "SERVQ" == min(ip, key=lambda c: ip[c]["importance"])
    assert math.isclose(ip["SYSQ"]["importance"], ip["INFQ"]["importance"], abs_tol=0.01)
    fl = {r[""]: r for r in t["matrix:fornell-larcker"]}
    for a, row in fl.items():
        assert all(v < row[a] for k, v in row.items() if k not in ("", a))


def test_04_story():
    _, _, _, _, t = _tables("04_utaut2_pls_sem")
    sig = {(p["from"], p["to"]): _sig(p) for p in t["paths"]}
    assert [k for k, v in sig.items() if not v] == [("EE", "BI")]
    ee = next(p for p in t["paths"] if (p["from"], p["to"]) == ("EE", "BI"))
    assert abs(ee["est"]) < 0.05 and ee["pValue"] > 0.3
    vif = [v for r in t["matrix:vif-structural"] for k, v in r.items() if k != "" and v is not None]
    assert max(vif) < 1.6


def test_05_story():
    run, exp, _, _, t = _tables("05_service_quality_cb_sem")
    fit = {r["name"]: r["value"] for r in t["fit"] if r["variant"] == "standard"}
    assert fit["df"] == 62 and fit["cfi"] > 0.99 and fit["rmsea"] < 0.01 and fit["srmr"] < 0.03
    one = {r["name"]: float(r["one-factor model"]) for r in _csv(exp / "fit_one_factor_vs_cfa.csv") if r["variant"] == "standard"}
    assert one["cfi"] < 0.8 and one["rmsea"] > 0.1
    est = _csv(exp / "estimands.csv")
    for r in est:
        assert abs(float(r["CB-SEM (ML, std.)"]) - float(r["PLSc"])) < 0.01
    sq_sat = next(r for r in est if r["path"].startswith("SQ") and r["path"].endswith("SAT"))
    assert float(sq_sat["classic PLS-SEM"]) < float(sq_sat["CB-SEM (ML, std.)"]) - 0.05
    text = stream_text(run["nb"])
    assert "-> agree" in text, "the optional semopy cross-check did not run or did not agree"
