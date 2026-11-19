"""CB engine vs lavaan 0.7-3, with the tolerances of packages/engine/tests/cb/reference.test.ts.

Two oracles per case/variant: the committed run (reference-results/cb + cb-math/fit-measures.json;
limited by lavaan's own stopping rule) and lavaan re-optimised to max |gradient| ~ 1e-8
(cb-math/tight-refits.json), which is held to the full tolerances:
estimates / std.all <= 1e-6 abs, SE <= 1e-5 rel, fit <= 1e-6 rel (~0 values <= 1e-7 abs),
RMSEA CI <= 1e-5 abs."""

import os
import time

import pytest
from helpers import REF, analysis_for, find_param, fit_value, load_cb_data, load_model, read_json

FILES = sorted(f for f in os.listdir(REF / "cb") if f.endswith(".json"))
FIT_REF = read_json(REF / "cb-math" / "fit-measures.json")["fits"]
TIGHT = read_json(REF / "cb-math" / "tight-refits.json")["fits"]

FIT_MAP = [
    ("chisq", "standard", "chisq"),
    ("df", "standard", "df"),
    ("pvalue", "standard", "pvalue"),
    ("baseline.chisq", "standard", "baseline.chisq"),
    ("baseline.df", "standard", "baseline.df"),
    ("baseline.pvalue", "standard", "baseline.pvalue"),
    ("cfi", "standard", "cfi"),
    ("tli", "standard", "tli"),
    ("rmsea", "standard", "rmsea"),
    ("rmsea.pvalue", "standard", "rmsea.pvalue"),
    ("srmr", "standard", "srmr"),
    ("logl", "standard", "logl"),
    ("unrestricted.logl", "standard", "unrestricted.logl"),
    ("aic", "standard", "aic"),
    ("bic", "standard", "bic"),
    ("bic2", "standard", "bic2"),
    ("npar", "standard", "npar"),
    ("ntotal", "standard", "ntotal"),
    ("chisq", "scaled", "chisq.scaled"),
    ("chisq.scaling.factor", "scaled", "chisq.scaling.factor"),
    ("pvalue", "scaled", "pvalue.scaled"),
    ("baseline.chisq", "scaled", "baseline.chisq.scaled"),
    ("baseline.chisq.scaling.factor", "scaled", "baseline.chisq.scaling.factor"),
    ("cfi", "scaled", "cfi.scaled"),
    ("tli", "scaled", "tli.scaled"),
    ("rmsea", "scaled", "rmsea.scaled"),
    ("cfi", "robust", "cfi.robust"),
    ("tli", "robust", "tli.robust"),
    ("rmsea", "robust", "rmsea.robust"),
]
CI_MAP = [
    ("standard", "rmsea.ci.lower", "rmsea.ci.upper"),
    ("scaled", "rmsea.ci.lower.scaled", "rmsea.ci.upper.scaled"),
    ("robust", "rmsea.ci.lower.robust", "rmsea.ci.upper.robust"),
]
DEFINED_AT_DF0 = {
    "chisq", "df", "baseline.chisq", "baseline.df", "baseline.pvalue", "logl",
    "unrestricted.logl", "aic", "bic", "bic2", "npar", "ntotal",
}
ZERO_FLOOR = 1e-6


def _param_dev(res, params):
    d = {"est": 0.0, "se": 0.0, "std": 0.0, "p": 0.0}
    for r in params:
        u = find_param(res, r, "unstandardized")
        s = find_param(res, r, "standardized")
        assert u is not None and s is not None, f"{r['lhs']} {r['op']} {r['rhs']}"
        d["est"] = max(d["est"], abs(u["est"] - r["est"]))
        if u["status"] == "estimated":
            assert r["se"] > 0
            d["se"] = max(d["se"], abs(u["se"] - r["se"]) / r["se"])
            if r.get("pvalue") is not None:
                d["p"] = max(d["p"], abs(u["pValue"] - r["pvalue"]))
        else:
            assert r["se"] == 0
        if r["std_all"] is not None:
            d["std"] = max(d["std"], abs(s["est"] - r["std_all"]))
    return d


def _fit_dev(res, lav, d):
    d.setdefault("fit", 0.0)
    d.setdefault("fitWorst", "")
    d.setdefault("fitAbsZero", 0.0)
    d.setdefault("ci", 0.0)
    just_id = lav.get("df") == 0
    has_scaled = any(f.get("variant") == "scaled" for f in res["fit"])
    for name, variant, lav_name in FIT_MAP:
        if lav_name not in lav:
            continue
        lv = lav[lav_name]
        ours = fit_value(res, name, variant)
        if just_id and name not in DEFINED_AT_DF0:
            if ours is not None:
                assert ours["value"] is None, f"{lav_name} at df = 0"
            continue
        if lv is None:
            continue
        if ours is None and variant != "standard" and not has_scaled:
            continue
        if ours is not None and ours.get("missing") == "not-supported":
            continue
        assert ours is not None, lav_name
        assert ours["value"] is not None, lav_name
        if abs(lv) < ZERO_FLOOR:
            d["fitAbsZero"] = max(d["fitAbsZero"], abs(ours["value"] - lv))
            continue
        rel = abs(ours["value"] - lv) / abs(lv)
        if rel > d["fit"]:
            d["fit"] = rel
            d["fitWorst"] = lav_name
    if just_id:
        return
    for variant, lo, hi in CI_MAP:
        if lav.get(lo) is None:
            continue
        ours = fit_value(res, "rmsea", variant)
        if ours is None or ours.get("missing") == "not-supported":
            continue
        d["ci"] = max(d["ci"], abs(ours["ciLower"] - lav[lo]), abs(ours["ciUpper"] - lav[hi]))


@pytest.mark.parametrize("file", FILES)
def test_matches_lavaan(eng, devlog, file):
    report = f"CB vs lavaan 0.7-3 (tight refits), {len(FILES)} runs ({eng.__name__})"
    ref = read_json(REF / "cb" / file)
    vk = f"{ref['case']}__{ref['variant']}"
    t0 = time.perf_counter()
    out = eng.estimate(load_model(ref["case"]), analysis_for(ref["variant"]), load_cb_data(ref["case"]))
    ms = (time.perf_counter() - t0) * 1000
    assert out["ok"], out.get("error")
    res = out["result"]
    assert res["estimation"]["converged"] == ref["converged"]
    assert res["estimation"]["admissible"] == ref["post_check"]
    assert res["sample"]["nUsed"] == ref["n_used"]
    assert res["sample"]["nRows"] == ref["n_rows"]
    if not ref["post_check"]:
        assert any(w["code"] == "CB_NEGATIVE_VARIANCE" for w in res["warnings"])
    else:
        assert not any(w["severity"] in ("warning", "error") for w in res["warnings"])

    committed = _param_dev(res, ref["parameters"])
    _fit_dev(res, FIT_REF[vk], committed)
    tight = _param_dev(res, TIGHT[vk]["parameters"])
    _fit_dev(res, TIGHT[vk]["fit"], tight)

    family = "ML (FIML)" if ref["variant"] == "ml-fiml" else (
        "MLR (FIML)" if ref["variant"] == "mlr-fiml" else ("MLR" if ref["variant"].startswith("mlr") else "ML")
    )
    devlog.track(report, f"{family} estimates", tight["est"], vk)
    devlog.track(report, f"{family} SE (relative)", tight["se"], vk)
    devlog.track(report, f"{family} std.all", tight["std"], vk)
    devlog.track(report, "fit indices (relative)", tight["fit"], f"{vk} [{tight['fitWorst']}]")
    devlog.track(report, "fit indices ~0 (absolute)", tight["fitAbsZero"], vk)
    devlog.track(report, "RMSEA CI", tight["ci"], vk)
    devlog.track(report, "committed-run p values", committed["p"], vk)
    devlog.note(f"[cb {eng.__name__}] {vk:<34} {ms:7.0f} ms")

    assert tight["est"] < 1e-6
    assert tight["se"] < 1e-5
    assert tight["std"] < 1e-6
    assert tight["fit"] < 1e-6
    assert tight["fitAbsZero"] < 1e-7
    assert tight["ci"] < 1e-5
    slack = TIGHT[vk]["max_est_change"]
    assert committed["est"] < 1e-6 + 1.1 * slack
    assert committed["se"] < 1e-5
    assert committed["std"] < 1e-6 + 1.1 * slack
    assert committed["p"] < 1e-7
    assert committed["fit"] < 1e-5
    assert committed["fitAbsZero"] < 1e-7
    assert committed["ci"] < 1e-5
