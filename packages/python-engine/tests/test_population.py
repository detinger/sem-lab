"""R-independent checks: on the EXACT fixtures (sample covariance = population Sigma) a consistent
estimator must return the generating parameters (packages/fixtures/synthetic/<case>/population.json);
plus the closed-form Heywood case and the singular-covariance diagnostic."""

import pytest
from helpers import FIXTURES, analysis_data, analysis_for, fit_value, load_case, load_cb_data, load_model, read_json

TOL = 1e-9


def _run_pls(eng, case, method, scheme):
    model, header, rows = load_case(case)
    analysis = {
        "method": method,
        "engine": "browser",
        "estimator": "pls-pm",
        "missingData": "listwise",
        "pls": {"innerWeighting": scheme, "maxIterations": 300, "tolerance": 1e-10},
    }
    out = eng.estimate(model, analysis, analysis_data(model, header, rows))
    assert out["ok"], out.get("error")
    return out["result"]


def _est(r, key, scale=None):
    p = next(x for x in r["parameters"] if x["key"] == key and (scale is None or x["scale"] == scale))
    assert p["est"] is not None
    return p["est"]


def _metric(r, c, m):
    return next(x for x in r["constructMetrics"] if x["constructId"] == c and x["metric"] == m)["value"]


LAMBDA = {
    "i_peou1": 0.8, "i_peou2": 0.78, "i_peou3": 0.76, "i_peou4": 0.74,
    "i_pu1": 0.85, "i_pu2": 0.82, "i_pu3": 0.8, "i_pu4": 0.78,
    "i_bi1": 0.88, "i_bi2": 0.85, "i_bi3": 0.82,
}
BLOCK = {"peou": "c_peou", "pu": "c_pu", "bi": "c_bi"}
POP_TAM = read_json(FIXTURES / "synthetic" / "tam-mediation-exact" / "population.json")
POP_MIX = read_json(FIXTURES / "synthetic" / "pls-mixed-composite-exact" / "population.json")


@pytest.mark.parametrize("scheme", ["path", "centroid", "factorial"])
def test_tam_exact_plsc_population(eng, devlog, scheme):
    r = _run_pls(eng, "tam-mediation-exact", "plsc", scheme)
    rep = f"population truths ({eng.__name__})"
    checks = [
        ("path:c_peou->c_pu", 0.6),
        ("path:c_peou->c_bi", 0.2),
        ("path:c_pu->c_bi", 0.5),
        ("indirect:c_peou->c_bi", 0.3),
        ("total:c_peou->c_bi", 0.5),
        ("specific-indirect:c_peou->c_pu->c_bi", 0.3),
    ]
    for ind, lam in LAMBDA.items():
        c = BLOCK[ind[2:].rstrip("0123456789")]
        checks.append((f"loading:{c}:{ind}", lam))
    for key, truth in checks:
        d = abs(_est(r, key) - truth)
        devlog.track(rep, "PLSc tam-mediation-exact", d, f"{scheme} {key}")
        assert d < TOL, key
    assert abs(_metric(r, "c_pu", "r2") - 0.36) < TOL
    assert abs(_metric(r, "c_bi", "r2") - 0.41) < TOL
    for name, c in (("PEOU", "c_peou"), ("PU", "c_pu"), ("BI", "c_bi")):
        t = POP_TAM["derivedTruths"]["constructs"][name]
        assert abs(_metric(r, c, "ave") - t["AVE"]) < TOL
        assert abs(_metric(r, c, "rho-c") - t["rhoC"]) < TOL
        assert abs(_metric(r, c, "rho-a") - t["rhoA"]) < TOL


@pytest.mark.parametrize("scheme", ["path", "centroid", "factorial"])
def test_tam_exact_classic_limit(eng, scheme):
    r = _run_pls(eng, "tam-mediation-exact", "pls-sem", scheme)
    for p in POP_TAM["derivedTruths"]["classicPlsPopulationLimit"]["paths"]:
        key = f"path:c_{p['source'].lower()}->c_{p['target'].lower()}"
        assert abs(_est(r, key) - p["coefficient"]) < TOL, key
    assert abs(_est(r, "total:c_peou->c_bi") - 0.43543038341742357) < TOL
    assert abs(_metric(r, "c_pu", "rho-a") - POP_TAM["derivedTruths"]["constructs"]["PU"]["rhoA"]) < TOL


@pytest.mark.parametrize("method", ["pls-sem", "plsc"])
@pytest.mark.parametrize("scheme", ["path", "centroid", "factorial"])
def test_mixed_composite_exact(eng, devlog, method, scheme):
    r = _run_pls(eng, "pls-mixed-composite-exact", method, scheme)
    F = POP_MIX["derivedTruths"]["constructs"]["F"]
    for i, w in enumerate(F["weights"]):
        d = abs(_est(r, f"weight:c_f:i_f{i + 1}") - w)
        devlog.track(f"population truths ({eng.__name__})", "Mode B weights (mixed-composite-exact)", d)
        assert d < TOL
        assert abs(_est(r, f"loading:c_f:i_f{i + 1}") - F["compositeLoadings"][i]) < TOL
    for m in ("cronbach-alpha", "rho-a", "rho-c", "ave"):
        x = next(c for c in r["constructMetrics"] if c["constructId"] == "c_f" and c["metric"] == m)
        assert x["value"] is None and x["missing"] == "not-applicable"
    if method == "plsc":
        assert abs(_est(r, "path:c_f->c_y") - 0.4) < TOL
        assert abs(_est(r, "path:c_x->c_y") - 0.3) < TOL
        cc = next(m for m in r["matrices"] if m["id"] == "construct-correlations")
        assert abs(cc["values"][cc["rowIds"].index("c_f")][cc["colIds"].index("c_x")] - 0.3) < TOL
    else:
        assert abs(_est(r, "path:c_f->c_y") - 0.3871305220309719) < TOL
        assert abs(_est(r, "path:c_x->c_y") - 0.24927517391513318) < TOL


# ---- CB -----------------------------------------------------------------------------------------


def _cb(eng, case, variant):
    out = eng.estimate(load_model(case), analysis_for(variant), load_cb_data(case))
    assert out["ok"], out.get("error")
    return out["result"]


def _id_of_column(model, column):
    return next(i["id"] for i in model["indicators"] if i["column"] == column)


def _construct_of(model, iid):
    return next(c["id"] for c in model["constructs"] if iid in c["indicatorIds"])


def _construct_by_name(model, name):
    return next(c["id"] for c in model["constructs"] if c["name"] == name)


@pytest.mark.parametrize("variant", ["ml-marker", "ml-stdlv"])
def test_cfa_two_factor_exact(eng, devlog, variant):
    model = load_model("cfa-two-factor-exact")
    pop = read_json(FIXTURES / "synthetic" / "cfa-two-factor-exact" / "population.json")
    res = _cb(eng, "cfa-two-factor-exact", variant)
    assert abs(fit_value(res, "chisq", "standard")["value"]) < 1e-8
    assert fit_value(res, "df")["value"] == 19
    for ind in pop["indicators"]:
        iid = _id_of_column(model, ind["column"])
        d = abs(_est(res, f"loading:{_construct_of(model, iid)}:{iid}", "standardized") - ind["standardizedLoading"])
        devlog.track(f"population truths ({eng.__name__})", "CB cfa-two-factor-exact std loadings", d)
        assert d < 1e-7
    a, b = [c["id"] for c in model["constructs"]]
    assert abs(_est(res, f"covariance:{a}~~{b}", "standardized") - 0.4) < 1e-7
    assert res["estimation"]["admissible"] is True


@pytest.mark.parametrize("variant", ["ml-marker", "ml-stdlv"])
def test_tam_mediation_exact_cb(eng, variant):
    model = load_model("tam-mediation-exact")
    res = _cb(eng, "tam-mediation-exact", variant)
    assert fit_value(res, "df")["value"] == 41
    assert abs(fit_value(res, "chisq", "standard")["value"]) < 1e-8
    assert [s["coefficient"] for s in POP_TAM["structuralCoefficients"]] == [0.6, 0.2, 0.5]
    for s in POP_TAM["structuralCoefficients"]:
        key = f"path:{_construct_by_name(model, s['source'])}->{_construct_by_name(model, s['target'])}"
        assert abs(_est(res, key, "standardized") - s["coefficient"]) < 1e-7
    for ind in POP_TAM["indicators"]:
        iid = _id_of_column(model, ind["column"])
        assert abs(_est(res, f"loading:{_construct_of(model, iid)}:{iid}", "standardized") - ind["standardizedLoading"]) < 1e-7

    def r2(name):
        return _metric(res, _construct_by_name(model, name), "r2")

    assert abs(r2("PU") - 0.36) < 1e-7
    assert abs(r2("BI") - 0.41) < 1e-7


@pytest.mark.parametrize("variant", ["ml-marker", "ml-stdlv"])
def test_heywood_closed_form(eng, variant):
    res = _cb(eng, "cb-heywood-exact", variant)
    N = 200
    assert abs(_est(res, "loading:c_h:i_h1", "standardized") ** 2 - 1.445) < 1e-7
    assert abs(_est(res, "residual-variance:i_h1", "standardized") - -0.445) < 1e-7
    assert abs(_est(res, "residual-variance:i_h1", "unstandardized") - (-0.445 * (N - 1)) / N) < 1e-7
    assert abs(_est(res, "residual-variance:i_h2", "standardized") - 0.5) < 1e-7
    assert res["estimation"]["admissible"] is False
    w = next(x for x in res["warnings"] if x["code"] == "CB_NEGATIVE_VARIANCE")
    assert w["severity"] == "warning" and w["elementIds"] == ["i_h1"]
    assert fit_value(res, "df")["value"] == 0
    for name in ("cfi", "tli", "rmsea", "srmr", "pvalue"):
        f = fit_value(res, name, "standard")
        assert f["value"] is None and f["missing"] == "not-applicable"
    assert any(x["code"] == "CB_JUST_IDENTIFIED" for x in res["warnings"])


def test_singular_covariance_diagnostic(eng):
    out = eng.estimate(load_model("cb-singular"), analysis_for("ml-marker"), load_cb_data("cb-singular"))
    assert not out["ok"]
    e = out["error"]
    assert e["code"] == "DATA_ZERO_VARIANCE"
    assert e["details"]["reason"] == "singular-covariance"
    assert sorted(e["details"]["elementIds"]) == ["i_s1", "i_s2", "i_s7"]
    dep = e["details"]["dependency"]
    assert any(v == 1 for v in dep.values())
    for v in dep.values():
        assert abs(abs(v) - 1) < 1e-6
    assert "singular" in e["message"]
