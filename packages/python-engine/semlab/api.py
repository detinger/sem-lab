"""Public API: one entry point with the TypeScript engine's contract, plus data preparation as
the web app does it and plain result tables.

    estimate(model, analysis, data) -> {'ok': True, 'result': NormalizedSemResult}
                                     | {'ok': False, 'error': {'code', 'message', 'details'?}}

``model`` is the SemModel JSON, ``analysis`` the AnalysisConfiguration JSON (``engine`` must be
``"browser"``, the engine the app runs), ``data`` = {columns, rows, nRows, nDropped}: the analysis
matrix as the web app builds it (``build_analysis_data``). The result is the NormalizedSemResult
JSON the app shows (same parameter keys, kinds, ids, missing reasons and warnings).
"""

import math

from .cb import estimate_cb
from .pls import estimate_pls


def estimate(model, analysis, data, on_progress=None, is_cancelled=None):
    """Estimate with the method in analysis['method']: PLS-SEM / PLSc -> PLS engine, CB-SEM ->
    CB engine. Never raises for bad input."""
    if analysis.get("method") == "cb-sem":
        return estimate_cb(model, analysis, data, on_progress=on_progress, is_cancelled=is_cancelled)
    return estimate_pls(model, analysis, data, on_progress=on_progress, is_cancelled=is_cancelled)


# ---- data ------------------------------------------------------------------------------------


class AnalysisDataError(ValueError):
    """The data cannot be prepared for the analysis (codes of apps/web buildAnalysisData)."""

    def __init__(self, code, message, columns=None, indicator_ids=None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.columns = columns or []
        self.indicator_ids = indicator_ids or []


def _parse_cell(t, missing_tokens):
    t = t.strip()
    if len(t) >= 2 and t[0] == '"' and t[-1] == '"':
        t = t[1:-1]
    if t in missing_tokens:
        return None
    try:
        v = float(t)
    except ValueError:
        return t
    return v if math.isfinite(v) else None


def read_csv(path, missing_tokens=("", "NA"), delimiter=","):
    """Minimal CSV reader (UTF-8, optional BOM, header row, no embedded delimiters): returns
    (columns, rows). Numeric cells become floats, missing tokens None, anything else stays a
    string (and is refused as non-numeric by build_analysis_data if it is an analysis column)."""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        lines = [ln for ln in fh.read().splitlines() if ln]
    header = [h.strip().strip('"') for h in lines[0].split(delimiter)]
    rows = [[_parse_cell(c, missing_tokens) for c in ln.split(delimiter)] for ln in lines[1:]]
    return header, rows


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def build_analysis_data(model, columns, rows, missing_data="listwise"):
    """The numeric matrix one analysis runs on, exactly as the web app builds it
    (apps/web/src/domain/dataset/analysis-data.ts): one column per bound data column of every
    indicator that belongs to a construct, in model order; reverse scoring min + max - x with
    the ORIGINAL scale endpoints; 'listwise' drops every row with a missing value, 'fiml' keeps
    rows with at least one observed value (missing cells stay None)."""
    by_id = {i["id"]: i for i in model.get("indicators") or []}
    seen = set()
    indicators = []
    for c in model.get("constructs") or []:
        for iid in c.get("indicatorIds") or []:
            ind = by_id.get(iid)
            if ind is not None and iid not in seen:
                seen.add(iid)
                indicators.append(ind)
    unmapped = [i for i in indicators if i.get("column") is None]
    if unmapped:
        raise AnalysisDataError(
            "DATA_INDICATOR_UNMAPPED",
            f"Indicator(s) {', '.join(repr(i.get('name', i['id'])) for i in unmapped)} not mapped to a data column.",
            indicator_ids=[i["id"] for i in unmapped],
        )
    cols = list(columns)
    missing = []
    for i in indicators:
        if i["column"] not in cols and i["column"] not in missing:
            missing.append(i["column"])
    if missing:
        raise AnalysisDataError(
            "DATA_COLUMN_MISSING",
            f"The data have no column(s) {', '.join(repr(c) for c in missing)}.",
            columns=missing,
            indicator_ids=[i["id"] for i in indicators if i["column"] in missing],
        )
    no_scale = [i for i in indicators if i.get("reverseScored") is True and i.get("scale") is None]
    if no_scale:
        raise AnalysisDataError(
            "DATA_SCALE_MISSING",
            "Reverse scoring needs the original scale endpoints (minimum and maximum).",
            columns=list(dict.fromkeys(i["column"] for i in no_scale)),
            indicator_ids=[i["id"] for i in no_scale],
        )
    bindings = []
    conflicts = []
    for ind in indicators:
        col = ind["column"]
        rev = (
            (ind["scale"]["min"], ind["scale"]["max"])
            if ind.get("reverseScored") is True and ind.get("scale")
            else None
        )
        ex = next((b for b in bindings if b["column"] == col), None)
        if ex is None:
            bindings.append({"column": col, "reverse": rev})
        elif ex["reverse"] != rev and col not in conflicts:
            conflicts.append(col)
    if conflicts:
        raise AnalysisDataError(
            "DATA_REVERSE_CONFLICT",
            "Indicators bound to the same column disagree on reverse scoring or scale.",
            columns=conflicts,
        )
    idx = [cols.index(b["column"]) for b in bindings]
    non_numeric = []
    for b, j in zip(bindings, idx):
        if any(r[j] is not None and not _is_num(r[j]) for r in rows):
            non_numeric.append(b["column"])
    if non_numeric:
        raise AnalysisDataError(
            "DATA_NOT_NUMERIC", "Analysis column(s) are not numeric.", columns=non_numeric
        )
    out_of_scale = []
    for b, j in zip(bindings, idx):
        if b["reverse"] is None:
            continue
        lo, hi = b["reverse"]
        if any(r[j] is not None and not (r[j] != r[j]) and (r[j] < lo or r[j] > hi) for r in rows):
            out_of_scale.append(b["column"])
    if out_of_scale:
        raise AnalysisDataError(
            "DATA_OUT_OF_SCALE",
            "Reverse-scored column(s) have values outside the stated scale endpoints.",
            columns=out_of_scale,
        )
    full = []
    complete = []
    for r in rows:
        row = []
        observed = 0
        for b, j in zip(bindings, idx):
            v = r[j] if j < len(r) else None
            if v is None or v != v:
                row.append(None)
                continue
            observed += 1
            rev = b["reverse"]
            row.append(rev[0] + rev[1] - v if rev else v)
        if observed == len(bindings):
            complete.append(row)
        if observed > 0:
            full.append(row)
    n_rows = len(rows)
    use = complete if missing_data == "listwise" else full
    if len(use) < 3:
        raise AnalysisDataError(
            "DATA_INSUFFICIENT_ROWS",
            f"Only {len(use)} usable row(s) remain; at least 3 are needed.",
            columns=[b["column"] for b in bindings],
        )
    return {
        "columns": [b["column"] for b in bindings],
        "rows": use,
        "nRows": n_rows,
        "nDropped": n_rows - len(use),
    }


# ---- tables ----------------------------------------------------------------------------------


def _labels(model):
    lab = {}
    for c in model.get("constructs") or []:
        lab[c["id"]] = c.get("name") or c["id"]
    for i in model.get("indicators") or []:
        lab[i["id"]] = i.get("name") or i["id"]
    return lab


_PARAM_COLS = ("est", "se", "statistic", "pValue", "ciLower", "ciUpper")


def results_tables(result, model):
    """Plain tables (lists of row dicts; no pandas needed) from a NormalizedSemResult:
    parameters (PLS: standardized; CB: unstandardized with the standardized estimate in `std`),
    paths, loadings, weights, effects, constructMetrics (one row per construct), fit, one table
    per matrix (``matrix:<id>``), ipmaConstructs / ipmaIndicators, bootstrap, warnings."""
    lab = _labels(model)
    params = result.get("parameters") or []
    has_unstd = any(p.get("scale") == "unstandardized" for p in params)
    std_by_key = {p["key"]: p.get("est") for p in params if p.get("scale") == "standardized"}
    rows = []
    for p in params:
        if has_unstd and p.get("scale") != "unstandardized":
            continue
        row = {
            "key": p["key"],
            "kind": p["kind"],
            "from": lab.get(p.get("sourceId"), p.get("sourceId")),
            "to": lab.get(p.get("targetId"), p.get("targetId")),
            "via": " -> ".join(lab.get(v, v) for v in p.get("viaIds") or []) or None,
        }
        for c in _PARAM_COLS:
            row[c] = p.get(c)
        if has_unstd:
            row["std"] = std_by_key.get(p["key"])
        row["status"] = p.get("status")
        rows.append(row)
    t = {"parameters": rows}
    t["paths"] = [r for r in rows if r["kind"] == "path"]
    t["loadings"] = [r for r in rows if r["kind"] == "loading"]
    t["weights"] = [r for r in rows if r["kind"] == "weight"]
    t["effects"] = [
        r for r in rows if r["kind"] in ("total-effect", "indirect-effect", "specific-indirect")
    ]
    t["variances"] = [
        r for r in rows if r["kind"] in ("variance", "residual-variance", "covariance", "intercept")
    ]
    cm = {}
    for m in result.get("constructMetrics") or []:
        r = cm.setdefault(m["constructId"], {"construct": lab.get(m["constructId"], m["constructId"])})
        r[m["metric"]] = m.get("value")
    t["constructMetrics"] = list(cm.values())
    t["fit"] = [
        {
            "name": f["name"],
            "variant": f.get("variant", "standard"),
            "value": f.get("value"),
            "ciLower": f.get("ciLower"),
            "ciUpper": f.get("ciUpper"),
            "missing": f.get("missing"),
        }
        for f in result.get("fit") or []
    ]
    for m in result.get("matrices") or []:
        mrows = []
        for rid, vals in zip(m.get("rowIds") or [], m.get("values") or []):
            r = {"": lab.get(rid, rid)}
            for cid, v in zip(m.get("colIds") or [], vals):
                r[lab.get(cid, cid)] = v
            mrows.append(r)
        t[f"matrix:{m['id']}"] = mrows
    ip = result.get("ipma")
    if ip:
        t["ipmaConstructs"] = [
            dict(c, construct=lab.get(c["constructId"], c["constructId"])) for c in ip["constructs"]
        ]
        t["ipmaIndicators"] = [
            dict(c, indicator=lab.get(c["indicatorId"], c["indicatorId"]))
            for c in ip.get("indicators") or []
        ]
    b = result.get("bootstrap")
    if b:
        t["bootstrap"] = [{k: b[k] for k in b if k != "draws"}]
    t["warnings"] = [
        {"code": w["code"], "severity": w["severity"], "message": w["message"]}
        for w in result.get("warnings") or []
    ]
    return t


def pandas_available():
    try:
        import pandas  # noqa: F401
    except ImportError:
        return False
    return True


def to_dataframe(table):
    """One table (list of row dicts) as a pandas DataFrame. Requires pandas (optional)."""
    try:
        import pandas as pd
    except ImportError as e:  # pragma: no cover - depends on the environment
        raise ImportError("to_dataframe needs pandas (pip install pandas); results_tables() does not.") from e
    return pd.DataFrame(table)


def to_dataframes(result, model):
    """Every table of results_tables() as a pandas DataFrame. Requires pandas (optional)."""
    return {name: to_dataframe(rows) for name, rows in results_tables(result, model).items()}
