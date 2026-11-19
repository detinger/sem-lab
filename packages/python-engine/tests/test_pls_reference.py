"""Parity with the R engine (cSEM 0.7.1): every run in packages/fixtures/reference-results/pls
(the same suite the TypeScript engine passes, packages/engine/tests/pls-reference.test.ts).
Tolerance: 1e-10 absolute for every number (classic, PLSc, Mode B, assessment, fit, IPMA);
keys, kinds, ids, statuses, missing reasons, warnings and admissibility must be identical."""

import os

import pytest
from helpers import REF, analysis_data, case_of, load_case, read_json

DIR = REF / "pls"
FILES = sorted(f for f in os.listdir(DIR) if f.endswith(".json"))
TOL = 1e-10


def test_has_the_61_reference_runs():
    assert len(FILES) == 61


@pytest.mark.parametrize("file", FILES)
def test_reproduces_r_reference(eng, devlog, file):
    report = f"PLS vs R/cSEM reference, {len(FILES)} runs ({eng.__name__})"
    ref = read_json(DIR / file)
    assert ref["response"]["ok"] is True
    R = ref["response"]["result"]
    model, header, rows = load_case(case_of(file))
    model = ref["request"]["model"]
    analysis = dict(ref["request"]["analysis"], engine="browser")
    out = eng.estimate(model, analysis, analysis_data(model, header, rows))
    assert out["ok"], out.get("error")
    T = out["result"]
    plsc = ref["request"]["analysis"]["method"] == "plsc"
    fam = "plsc" if plsc else "classic"

    def track(family, a, b, where):
        if a is None or b is None:
            assert a == b, f"{where}: null mismatch {a} vs {b}"
            return
        d = abs(a - b)
        devlog.track(report, family, d, f"{file} {where}")
        assert d <= TOL, f"{where}: {a} vs {b}"

    assert T["sample"] == R["sample"]
    assert T["estimation"]["converged"] == R["estimation"]["converged"]
    assert T["estimation"]["iterations"] == R["estimation"]["iterations"]
    assert T["estimation"]["admissible"] == R["estimation"]["admissible"]

    assert [p["key"] for p in T["parameters"]] == [p["key"] for p in R["parameters"]]
    mode_b = {c["id"] for c in model["constructs"] if c["measurement"] == "composite-formative"}
    for tp, rp in zip(T["parameters"], R["parameters"]):
        for k in ("kind", "sourceId", "targetId", "viaIds", "relationshipId", "status", "scale", "missing"):
            assert tp.get(k) == rp.get(k), f"{rp['key']} {k}"
        if rp["kind"] in ("total-effect", "indirect-effect", "specific-indirect"):
            f = "effects"
        elif rp["kind"] == "weight" and rp["sourceId"] in mode_b:
            f = "mode-b weights"
        else:
            f = fam
        track(f, tp["est"], rp["est"], rp["key"])
        if f in ("effects", "mode-b weights"):
            track(fam, tp["est"], rp["est"], rp["key"])

    assert [f"{m['constructId']}/{m['metric']}" for m in T["constructMetrics"]] == [
        f"{m['constructId']}/{m['metric']}" for m in R["constructMetrics"]
    ]
    for tm, rm in zip(T["constructMetrics"], R["constructMetrics"]):
        assert tm.get("missing") == rm.get("missing")
        track("construct metrics", tm["value"], rm["value"], f"{rm['constructId']}/{rm['metric']}")

    assert [m["id"] for m in T["matrices"]] == [m["id"] for m in R["matrices"]]
    for tm, rm in zip(T["matrices"], R["matrices"]):
        for k in ("rowIds", "colIds", "missing", "symmetric"):
            assert tm.get(k) == rm.get(k), f"{rm['id']} {k}"
        for a, row in enumerate(rm["values"]):
            for b, v in enumerate(row):
                track("matrices", tm["values"][a][b], v, f"{rm['id']}[{rm['rowIds'][a]}, {rm['colIds'][b]}]")

    assert [f["name"] for f in T["fit"]] == [f["name"] for f in R["fit"]]
    for tf, rf in zip(T["fit"], R["fit"]):
        assert tf.get("missing") == rf.get("missing")
        track("fit", tf["value"], rf["value"], rf["name"])

    assert bool(T.get("ipma")) == bool(R.get("ipma"))
    if R.get("ipma"):
        ti, ri = T["ipma"], R["ipma"]
        assert ti["targetConstructId"] == ri["targetConstructId"]
        assert ti["convention"] == ri["convention"]
        assert [(c["constructId"], c["predecessor"]) for c in ti["constructs"]] == [
            (c["constructId"], c["predecessor"]) for c in ri["constructs"]
        ]
        for tc, rc in zip(ti["constructs"], ri["constructs"]):
            track("ipma", tc["importance"], rc["importance"], f"{rc['constructId']} importance")
            track("ipma", tc["performance"], rc["performance"], f"{rc['constructId']} performance")
        assert [(c["indicatorId"], c["constructId"]) for c in ti["indicators"]] == [
            (c["indicatorId"], c["constructId"]) for c in ri["indicators"]
        ]
        for tc, rc in zip(ti["indicators"], ri["indicators"]):
            track("ipma", tc["importance"], rc["importance"], f"{rc['indicatorId']} importance")
            track("ipma", tc["performance"], rc["performance"], f"{rc['indicatorId']} performance")

    assert [(w["code"], w["severity"], w.get("elementIds")) for w in T["warnings"]] == [
        (w["code"], w["severity"], w.get("elementIds")) for w in R["warnings"]
    ]
    assert T["provenance"]["engine"] == "browser"
