"""Timing report (single thread; printed in the terminal summary). Assertions are generous
upper bounds; the numbers are the record. Runs on the package only (the bundle is the same
code): R-compatible bootstrap index generation (B = 1,000 x n = 7,422), the ACSI 2015 PLS fit and
its B = 1,000 bootstrap (listwise, as the app's example analysis), CB fits."""

import time

import pytest
from helpers import FIXTURES, REPO, analysis_data, analysis_for, load_cb_data, load_model, read_csv, read_json


@pytest.fixture(scope="module")
def acsi():
    ex = read_json(REPO / "content" / "examples" / "acsi-2015.json")
    header, rows = read_csv(FIXTURES / "third-party" / "smartpls-samples" / "acsi-2015" / "data.csv")
    data = analysis_data(ex["model"], header, rows)
    assert len(data["rows"]) > 7000
    return ex["model"], dict(ex["analysis"], engine="browser"), data


def _best(f, reps):
    best = float("inf")
    for _ in range(reps):
        t0 = time.perf_counter()
        f()
        best = min(best, time.perf_counter() - t0)
    return best


def test_bootstrap_index_generation(pkg, devlog):
    def gen():
        s = 0
        for idx in pkg.bootstrap_indices(20150101, 7422, 1000):
            s += int(idx[0])
        return s

    t = _best(gen, 3)
    devlog.note(f"[perf] R-compatible bootstrap indices B = 1,000 x n = 7,422: {t:.3f} s")
    assert t < 10


def test_acsi_pls(pkg, devlog, acsi):
    model, analysis, data = acsi
    n = len(data["rows"])
    base = {k: v for k, v in analysis.items() if k not in ("bootstrap", "ipma", "seed")}
    for method in ("pls-sem", "plsc"):
        an = dict(base, method=method)
        t_fit = _best(lambda an=an: pkg.estimate(model, an, data), 5)
        devlog.note(f"[perf] ACSI 2015 {method} (n = {n}, p = {len(data['columns'])}): {t_fit * 1000:.1f} ms per full fit with assessment")
        assert t_fit < 5
    t0 = time.perf_counter()
    out = pkg.estimate(model, analysis, data)
    t_boot = time.perf_counter() - t0
    assert out["ok"], out
    b = out["result"]["bootstrap"]
    devlog.note(
        f"[perf] ACSI 2015 example analysis (pls-sem, IPMA, B = {b['requested']} bootstrap; valid {b['completed']}): {t_boot:.2f} s total"
    )
    assert t_boot < 120


@pytest.mark.parametrize(
    "case, variant",
    [
        ("service-quality", "ml-marker"),
        ("service-quality", "ml-stdlv"),
        ("service-quality", "mlr-marker"),
        ("tam-mediation-exact", "ml-marker"),
        ("missing-mcar", "ml-fiml"),
        ("missing-mcar", "mlr-fiml"),
    ],
)
def test_cb_fit_times(pkg, devlog, case, variant):
    model = load_model(case)
    data = load_cb_data(case)
    an = analysis_for(variant)
    t = _best(lambda: pkg.estimate(model, an, data), 3)
    devlog.note(f"[perf] CB {case} {variant}: {t * 1000:.0f} ms per fit")
    assert t < 30
