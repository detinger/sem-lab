"""Distribution functions vs R: Student t (scipy) against stats::pt, chi^2 / noncentral chi^2 /
normal / RMSEA-CI uniroot emulation against packages/fixtures/reference-results/cb-math."""

import math

import pytest
from helpers import REF, REPO, read_json

PT = read_json(REPO / "packages" / "engine" / "tests" / "fixtures" / "r-pt.json")["cases"]
DIST = read_json(REF / "cb-math" / "distributions.json")


def _rel(a, b):
    return abs(a - b) / max(abs(b), 1e-300)


def test_pt_equals_r(eng, devlog):
    max_abs = 0.0
    max_rel = 0.0
    for c in PT:
        a = eng.pt(c["t"], c["df"])
        tail = eng.pt_lower_tail_abs(c["t"], c["df"])
        max_abs = max(max_abs, abs(a - c["lower"]))
        rel = abs(tail) if c["lowerTailAbs"] == 0 else _rel(tail, c["lowerTailAbs"])
        max_rel = max(max_rel, rel)
        assert abs(a - c["lower"]) <= 1e-13, (c, a)
        assert rel <= 5e-12, (c, tail)
    devlog.track(f"distributions ({eng.__name__})", "pt abs", max_abs)
    devlog.track(f"distributions ({eng.__name__})", "pt lower tail rel", max_rel)


def test_pt_edges(eng):
    assert eng.pt(math.inf, 5) == 1
    assert eng.pt(-math.inf, 5) == 0
    assert eng.pt_lower_tail_abs(math.inf, 5) == 0
    assert math.isnan(eng.pt(1, 0))


def test_quantile7_and_sd(eng):
    # R: quantile(c(3, 1, 4, 1, 5, 9, 2, 6), c(0.025, 0.5, 0.975), type = 7)
    assert eng.quantile7([3, 1, 4, 1, 5, 9, 2, 6], [0.025, 0.5, 0.975]) == [1, 3.5, 8.475000000000001]
    assert eng.quantile7([2], [0.05, 0.95]) == [2, 2]
    assert eng.sample_sd([1, 2, 3, 4]) == pytest.approx(1.2909944487358056, abs=1e-15)


def test_chisq_normal_and_rmsea_ci(eng, devlog):
    rep = f"distributions ({eng.__name__})"
    worst = 0.0
    for r in DIST["pchisq_central"]:
        worst = max(worst, abs(eng.pchisq(r["q"], r["df"]) - r["lower"]))
        if r["upper"] > 1e-300:
            worst = max(worst, _rel(eng.pchisq_upper(r["q"], r["df"]), r["upper"]))
    assert worst < 1e-12
    devlog.track(rep, "central chisq", worst)
    worst = 0.0
    for r in DIST["pchisq_noncentral"]:
        worst = max(worst, abs(eng.pnchisq(r["q"], r["df"], r["ncp"]) - r["p"]))
    assert worst < 1e-11
    devlog.track(rep, "noncentral chisq abs", worst)
    for r in DIST["pnorm"]:
        assert _rel(eng.pnorm_upper(r["z"]), r["upper"]) < 1e-13
    worst_exact = 0.0
    worst_lavaan = 0.0
    for r in DIST["rmsea_ci"]:
        x2, df = r["x2"], r["df"]
        if r["lambda_lower_exact"] > 0:
            root = eng.zeroin(lambda lam: eng.pnchisq(x2, df, lam) - 0.95, 0, max(x2, 1) * 10 + 100, 1e-13)
            worst_exact = max(worst_exact, abs(root - r["lambda_lower_exact"]))
        if r["lambda_upper_exact"] > 0:
            root = eng.zeroin(lambda lam: eng.pnchisq(x2, df, lam) - 0.05, 0, max(x2, 1) * 10 + 100, 1e-13)
            worst_exact = max(worst_exact, abs(root - r["lambda_upper_exact"]))
        lo, hi = eng.rmsea_ci(x2, df, r["n"])
        if r["lower"] is not None:
            worst_lavaan = max(worst_lavaan, abs(lo - r["lower"]))
        if r["upper"] is not None:
            worst_lavaan = max(worst_lavaan, abs(hi - r["upper"]))
    assert worst_exact < 1e-8
    assert worst_lavaan < 1e-9
    devlog.track(rep, "noncentrality roots (exact)", worst_exact)
    devlog.track(rep, "RMSEA CI (lavaan uniroot)", worst_lavaan)
