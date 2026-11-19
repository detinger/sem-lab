"""Fixture readers, ported from packages/engine/tests/helpers.ts and tests/cb/helpers.ts, so the
Python engine is fed exactly the inputs the TypeScript engine is tested with."""

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
FIXTURES = REPO / "packages" / "fixtures"
REF = FIXTURES / "reference-results"


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _js_number(t):
    """Number(t) for the fixture cells (decimal / exponent notation); None when not finite."""
    try:
        v = float(t)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def read_csv(path):
    """helpers.ts readCsv: header + rows, '' / 'NA' -> None, quotes stripped."""
    text = Path(path).read_text(encoding="utf-8")
    if text.startswith("﻿"):
        text = text[1:]
    lines = [ln for ln in text.replace("\r\n", "\n").split("\n") if ln]
    header = [h.strip('"') for h in lines[0].split(",")]
    rows = []
    for ln in lines[1:]:
        row = []
        for c in ln.split(","):
            t = c.strip().strip('"')
            row.append(None if t in ("", "NA") else _js_number(t))
        rows.append(row)
    return header, rows


def analysis_data(model, header, rows):
    """helpers.ts analysisData = apps/web buildAnalysisData(model, dataset, 'listwise')."""
    by_id = {i["id"]: i for i in model["indicators"]}
    bindings = []
    for c in model["constructs"]:
        for iid in c["indicatorIds"]:
            ind = by_id[iid]
            col = ind["column"]
            if any(b[0] == col for b in bindings):
                continue
            rev = (
                (ind["scale"]["min"], ind["scale"]["max"])
                if ind.get("reverseScored") is True and ind.get("scale")
                else None
            )
            bindings.append((col, rev))
    idx = [header.index(b[0]) for b in bindings]
    out = []
    for r in rows:
        row = []
        complete = True
        for (_col, rev), j in zip(bindings, idx):
            v = r[j] if j < len(r) else None
            if v is None:
                complete = False
                break
            row.append(rev[0] + rev[1] - v if rev else v)
        if complete:
            out.append(row)
    return {
        "columns": [b[0] for b in bindings],
        "rows": out,
        "nRows": len(rows),
        "nDropped": len(rows) - len(out),
    }


def case_of(file_name):
    return file_name.split("__")[0]


def load_case(case):
    model = read_json(FIXTURES / "synthetic" / case / "model.json")
    header, rows = read_csv(FIXTURES / "synthetic" / case / "data.csv")
    return model, header, rows


# ---- CB ----------------------------------------------------------------------------------------


def load_model(case):
    return read_json(FIXTURES / "synthetic" / case / "model.json")


def load_cb_data(case):
    """cb/helpers.ts loadData: every column, '' = missing, nDropped = 0."""
    text = (FIXTURES / "synthetic" / case / "data.csv").read_text(encoding="utf-8")
    lines = [ln for ln in text.split("\n") if ln]
    columns = lines[0].split(",")
    rows = [[None if v == "" else float(v) for v in ln.split(",")] for ln in lines[1:]]
    return {"columns": columns, "rows": rows, "nRows": len(rows), "nDropped": 0}


def analysis_for(variant):
    fiml = variant.endswith("fiml")
    return {
        "method": "cb-sem",
        "engine": "browser",
        "estimator": "MLR" if variant.startswith("mlr") else "ML",
        "missingData": "fiml" if fiml else "listwise",
        "cb": {"identification": "std-lv" if variant == "ml-stdlv" else "marker", "meanStructure": fiml},
    }


def keys_for(r):
    op = r["op"]
    if op == "=~":
        return [f"loading:{r['lhs']}:{r['rhs']}"]
    if op == "~":
        return [f"path:{r['rhs']}->{r['lhs']}"]
    if op == "~1":
        return [f"intercept:{r['lhs']}"]
    if op == "~~":
        if r["lhs"] == r["rhs"]:
            return [f"variance:{r['lhs']}", f"residual-variance:{r['lhs']}"]
        return [f"covariance:{r['lhs']}~~{r['rhs']}", f"covariance:{r['rhs']}~~{r['lhs']}"]
    return []


def find_param(result, r, scale):
    keys = keys_for(r)
    return next((p for p in result["parameters"] if p["scale"] == scale and p["key"] in keys), None)


def fit_value(result, name, variant=None):
    return next(
        (
            f
            for f in result["fit"]
            if f["name"] == name and (variant is None or f.get("variant", "standard") == variant)
        ),
        None,
    )
