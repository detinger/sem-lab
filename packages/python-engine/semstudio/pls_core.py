"""PLS request validation and the PLS-PM estimation core (port of packages/engine/src/pls/spec.ts
and core.ts).

Validation: the checks, error codes and reasons of the R engine's validate_request /
validate_ipma / load_job_data, applied to the in-memory analysis matrix the web app builds
(indicator columns in model order, reverse scoring min + max - x ALREADY applied,
listwise-complete rows).

Estimation: the semantics of cSEM 0.7.1 ``csem()`` with .approach_weights = "PLS-PM",
.approach_paths = "OLS", .conv_criterion = "diff_absolute", inner scheme path / centroid /
factorial, .disattenuate = FALSE (classic) / TRUE with .PLS_approach_cf =
"dist_squared_euclid" (PLSc), no dominant indicators, no starting values. Everything is
computed from the Pearson indicator correlation matrix S.
"""

import math
import re

import numpy as np

from .effects import all_paths, find_cycle
from .errors import EngineError, invalid
from .linalg import (
    NumericalError,
    correlation,
    inverse_r,
    is_positive_semi_definite,
    qr_rank,
    solve_r,
    symmetrize_from_upper,
)

ENGINE_ID = "browser"
_ID_PATTERN = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.:-]*")
_ID_PATTERN_SOURCE = "^[A-Za-z0-9_][A-Za-z0-9_.:-]*$"


# ---------------------------------------------------------------------------------------------
# spec


class SpecConstruct:
    __slots__ = ("id", "reflective", "mode_b", "indicator_ids", "indicators")

    def __init__(self, id, reflective, mode_b, indicator_ids, indicators):
        self.id = id
        self.reflective = reflective
        self.mode_b = mode_b
        self.indicator_ids = indicator_ids
        #: positions of the block's indicators in PlsSpec.indicators
        self.indicators = indicators


class SpecIndicator:
    __slots__ = ("id", "column", "reverse", "scale")

    def __init__(self, id, column, reverse, scale):
        self.id = id
        self.column = column
        self.reverse = reverse
        self.scale = scale  # (min, max) or None


class SpecPath:
    __slots__ = ("id", "source", "target")

    def __init__(self, id, source, target):
        self.id = id
        self.source = source
        self.target = target


class BootstrapSpec:
    __slots__ = ("reps", "level", "sides", "seed")

    def __init__(self, reps, level, sides, seed):
        self.reps = reps
        self.level = level
        self.sides = sides
        self.seed = seed


class IpmaSpec:
    __slots__ = ("target", "predecessors", "direct")

    def __init__(self, target, predecessors, direct):
        self.target = target
        self.predecessors = predecessors
        self.direct = direct


class PlsSpec:
    __slots__ = (
        "method",
        "scheme",
        "max_iter",
        "tol",
        "constructs",
        "indicators",
        "paths",
        "bootstrap",
        "ipma",
        "warnings",
    )

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def _is_number(x):
    return isinstance(x, (int, float, np.integer, np.floating)) and not isinstance(x, bool)


def _is_whole(x):
    return _is_number(x) and math.isfinite(x) and abs(x - round(x)) < 1e-9


def _check_id(x, what):
    if not isinstance(x, str) or len(x) > 128 or not _ID_PATTERN.fullmatch(x):
        raise invalid(f"{what} must be an id matching {_ID_PATTERN_SOURCE} (max 128 characters).")
    return x


def _get(d, key):
    """`d[key]` treating an absent key and JSON null alike (undefined)."""
    return d.get(key) if isinstance(d, dict) else None


def validate_request(model, an):
    """validate_request(): model + analysis -> PlsSpec, or a stable EngineError."""
    if an.get("engine") != ENGINE_ID:
        raise invalid(
            f"This is the {ENGINE_ID} engine; the request asks for engine `{an.get('engine')}`."
        )
    method = an.get("method")
    if method == "cb-sem":
        raise EngineError(
            "CAPABILITY_UNSUPPORTED",
            "CB-SEM is not estimated by the PLS engine (use the CB-SEM entry point).",
            {"method": method, "engine": ENGINE_ID},
        )
    if method not in ("pls-sem", "plsc"):
        raise invalid("analysis.method must be `pls-sem` or `plsc`.")
    if an.get("estimator") != "pls-pm":
        raise EngineError(
            "CAPABILITY_UNSUPPORTED",
            "The browser PLS engine implements estimator `pls-pm` only.",
            {"engine": ENGINE_ID},
        )
    if an.get("missingData") != "listwise":
        raise invalid(
            "analysis.missingData must be `listwise` for PLS methods (FIML is defined for CB-SEM only)."
        )
    if _get(an, "cb") is not None:
        raise invalid("analysis.cb is only valid for CB-SEM.")
    ipma_req = _get(an, "ipma")
    if ipma_req is not None and method != "pls-sem":
        raise EngineError(
            "CAPABILITY_UNSUPPORTED",
            "IPMA uses a classic PLS-SEM fit (method `pls-sem`); it is not computed from a PLSc fit (in Phase 0 a PLSc fit shifted importance by 0.086).",
            {"capabilityId": "ipma.construct", "method": method},
        )
    pls = _get(an, "pls")
    if not pls:
        raise invalid(
            "analysis.pls (innerWeighting, maxIterations, tolerance) is required for PLS methods."
        )
    scheme = pls.get("innerWeighting")
    if scheme not in ("path", "centroid", "factorial"):
        raise invalid("analysis.pls.innerWeighting must be `path`, `centroid` or `factorial`.")
    mi = pls.get("maxIterations")
    if not _is_whole(mi) or mi < 1 or mi > 100000:
        raise invalid("analysis.pls.maxIterations must be an integer in [1, 100000].")
    tol = pls.get("tolerance")
    if not (_is_number(tol) and math.isfinite(tol)) or tol <= 0 or tol > 0.01:
        raise invalid("analysis.pls.tolerance must be a number in (0, 0.01].")

    bootstrap = None
    b = _get(an, "bootstrap")
    if b is not None and b.get("enabled") is True:
        if b.get("ci") == "bca":
            raise EngineError(
                "CAPABILITY_UNSUPPORTED",
                "Bootstrap `bca` intervals are not available in the browser engine (only percentile intervals are verified).",
                {"capabilityId": "resampling.bootstrap-bca", "engine": ENGINE_ID},
            )
        if b.get("ci") != "percentile":
            raise invalid("analysis.bootstrap.ci must be `percentile` or `bca`.")
        reps = b.get("repetitions")
        if not _is_whole(reps) or reps < 1 or reps > 100000:
            raise invalid("analysis.bootstrap.repetitions must be an integer in [1, 100000].")
        lvl = b.get("confidenceLevel")
        if not (_is_number(lvl) and lvl > 0.5 and lvl < 1):
            raise invalid("analysis.bootstrap.confidenceLevel must lie strictly between 0.5 and 1.")
        if b.get("sides") not in ("two-sided", "one-sided"):
            raise invalid("analysis.bootstrap.sides must be `two-sided` or `one-sided`.")
        seed = an.get("seed")
        if not _is_whole(seed) or seed < 0 or seed > 2147483647:
            raise invalid(
                "analysis.seed (integer in [0, 2147483647]) is required when bootstrapping."
            )
        bootstrap = BootstrapSpec(int(round(reps)), float(lvl), b["sides"], int(round(seed)))

    # ---- model ------------------------------------------------------------------------
    cons = model.get("constructs")
    if not isinstance(cons, list) or len(cons) == 0:
        raise invalid("model.constructs must be a non-empty array.")
    ind_by_id = {}
    for i in model.get("indicators") or []:
        iid = _check_id(i.get("id"), "indicator id")
        if iid in ind_by_id:
            raise invalid(f"Duplicate indicator id `{iid}`.")
        sc = _get(i, "scale")
        if sc is not None and not (
            _is_number(sc.get("min"))
            and _is_number(sc.get("max"))
            and math.isfinite(sc["min"])
            and math.isfinite(sc["max"])
            and sc["min"] < sc["max"]
        ):
            raise invalid(f"Indicator `{iid}`: scale needs numeric min < max.")
        ind_by_id[iid] = i
    constructs = []
    indicators = []
    used = set()
    cons_index = {}
    for cc in cons:
        cid = _check_id(cc.get("id"), "construct id")
        if cid in cons_index or cid in ind_by_id:
            raise invalid(f"Duplicate id `{cid}`.")
        meas = cc.get("measurement")
        if meas not in ("reflective", "composite-formative"):
            raise invalid(
                f"Construct `{cid}`: measurement must be `reflective` or `composite-formative`."
            )
        if _get(cc, "higherOrder") is not None:
            raise EngineError(
                "CAPABILITY_UNSUPPORTED",
                "Higher-order constructs are not available in the browser PLS engine.",
                {"capabilityId": "pls.higher-order", "engine": ENGINE_ID, "constructId": cid},
            )
        ids = list(cc.get("indicatorIds") or [])
        if len(ids) == 0:
            raise invalid(f"Construct `{cid}` has no indicators.", {"constructId": cid})
        for ii in ids:
            if ii not in ind_by_id:
                raise invalid(f"Construct `{cid}` lists unknown indicator `{ii}`.")
        if len(set(ids)) != len(ids):
            raise invalid(f"Construct `{cid}` lists an indicator twice.")
        dup = [ii for ii in ids if ii in used]
        if dup:
            raise invalid(
                f"Indicator `{dup[0]}` is assigned to more than one construct.",
                {"indicatorIds": dup},
            )
        default_mode = "mode-a" if meas == "reflective" else "mode-b"
        mode = _get(cc, "plsWeightingMode") or default_mode
        if mode != default_mode:
            raise EngineError(
                "CAPABILITY_UNSUPPORTED",
                f"Construct `{cid}`: overriding the weighting mode of a {meas} block ({mode}) is not offered; the mode follows the measurement kind.",
                {"constructId": cid},
            )
        positions = []
        for ii in ids:
            used.add(ii)
            ind = ind_by_id[ii]
            positions.append(len(indicators))
            sc = _get(ind, "scale")
            col = ind.get("column")
            indicators.append(
                SpecIndicator(
                    ii,
                    col if col is not None else "",
                    ind.get("reverseScored") is True,
                    (sc["min"], sc["max"]) if sc is not None else None,
                )
            )
            if col is None:
                raise invalid(
                    f"Indicator `{ii}` is not mapped to a data column.", {"indicatorIds": [ii]}
                )
            if ind.get("reverseScored") is True and sc is None:
                raise invalid(
                    f"Indicator `{ii}` is reverse scored but has no scale endpoints.",
                    {"indicatorIds": [ii]},
                )
        cons_index[cid] = len(constructs)
        constructs.append(
            SpecConstruct(cid, meas == "reflective", mode == "mode-b", list(ids), positions)
        )
    cols = [i.column for i in indicators]
    dup_cols = []
    for idx, c in enumerate(cols):
        if cols.index(c) != idx and c not in dup_cols:
            dup_cols.append(c)
    if dup_cols:
        raise invalid("A data column is bound to more than one indicator.", {"columns": dup_cols})

    # ---- relationships --------------------------------------------------------------------
    rel_ids = set()
    paths = []
    rels = model.get("relationships") or []
    for r in rels:
        rid = _check_id(r.get("id"), "relationship id")
        if rid in rel_ids:
            raise invalid(f"Duplicate relationship id `{rid}`.")
        rel_ids.add(rid)
        if r.get("kind") != "structural":
            continue
        s = cons_index.get(r.get("sourceId"))
        t = cons_index.get(r.get("targetId"))
        if s is None or t is None:
            raise invalid(f"Structural relationship `{rid}` must connect two constructs.")
        if s == t:
            raise invalid(f"Structural relationship `{rid}` is a self-loop.")
        if any(p.source == s and p.target == t for p in paths):
            raise invalid(
                f"Structural path {r.get('sourceId')} -> {r.get('targetId')} is listed twice."
            )
        if _get(r, "fixedValue") is not None:
            raise EngineError(
                "CAPABILITY_UNSUPPORTED",
                f"Relationship `{rid}`: fixed path values are not supported in PLS-SEM.",
                {"relationshipId": rid},
            )
        paths.append(SpecPath(rid, s, t))
    targets = {p.target for p in paths}
    warnings = []
    for r in rels:
        if r.get("kind") != "covariance":
            continue
        s = cons_index.get(r.get("sourceId"))
        t = cons_index.get(r.get("targetId"))
        if s is not None and t is not None and s != t and s not in targets and t not in targets:
            ids = []
            for x in (r["id"], r["sourceId"], r["targetId"]):
                if x not in ids:
                    ids.append(x)
            warnings.append(
                {
                    "code": "EXOGENOUS_CORRELATION_IMPLIED",
                    "severity": "info",
                    "message": "PLS-SEM leaves the correlation between exogenous constructs free; this covariance relationship is not a separate parameter. The estimate is in the construct-correlations matrix.",
                    "elementIds": ids,
                }
            )
        else:
            raise EngineError(
                "CAPABILITY_UNSUPPORTED",
                f"Covariance relationship `{r.get('id')}`: PLS-SEM does not estimate indicator residual covariances or covariances involving endogenous constructs.",
                {"relationshipId": r.get("id")},
            )
    if not paths:
        raise EngineError(
            "MODEL_NOT_IDENTIFIED", "A PLS path model needs at least one structural path.", {}
        )
    isolated = [
        c.id
        for i, c in enumerate(constructs)
        if not any(p.source == i or p.target == i for p in paths)
    ]
    if isolated:
        raise EngineError(
            "MODEL_NOT_IDENTIFIED",
            "Every construct must take part in at least one structural path (the PLS inner weighting has no neighbour for an isolated construct).",
            {"constructIds": isolated},
        )
    k = len(constructs)
    cyc = find_cycle(k, paths)
    if cyc:
        ids = [constructs[i].id for i in cyc]
        uniq = []
        for x in ids:
            if x not in uniq:
                uniq.append(x)
        raise invalid(
            f"The structural model contains a cycle ({' -> '.join(ids)}). The PLS engine estimates recursive models only.",
            {"constructIds": uniq},
        )

    ipma = None
    if ipma_req is not None:
        target = cons_index.get(ipma_req.get("targetConstructId"))
        if target is None:
            raise invalid(
                "analysis.ipma.targetConstructId is not a construct of the model.",
                {"reason": "ipma-target-unknown"},
            )
        preds = [c for c in range(k) if c != target and len(all_paths(k, paths, c, target, 1)) > 0]
        if not preds:
            raise invalid(
                f"The IPMA target `{constructs[target].id}` has no predecessor construct (no structural path leads to it).",
                {"reason": "ipma-no-predecessors", "constructIds": [constructs[target].id]},
            )
        no_scale = [i.id for i in indicators if i.scale is None]
        if no_scale:
            raise invalid(
                f"IPMA needs the original scale endpoints (scale.min, scale.max) of every model indicator; {len(no_scale)} indicator(s) have none.",
                {"reason": "ipma-scale-missing", "indicatorIds": no_scale},
            )
        ipma = IpmaSpec(
            target,
            preds,
            [any(p.source == c and p.target == target for p in paths) for c in preds],
        )

    return PlsSpec(
        method=method,
        scheme=scheme,
        max_iter=int(round(mi)),
        tol=tol,
        constructs=constructs,
        indicators=indicators,
        paths=paths,
        bootstrap=bootstrap,
        ipma=ipma,
        warnings=warnings,
    )


class PreparedData:
    __slots__ = ("X", "n", "n_rows", "n_dropped", "reversed")

    def __init__(self, X, n, n_rows, n_dropped, reversed):
        #: analysis matrix (n x p) in model indicator order
        self.X = X
        self.n = n
        self.n_rows = n_rows
        self.n_dropped = n_dropped
        self.reversed = reversed


def _is_int(x):
    return isinstance(x, (int, np.integer)) and not isinstance(x, bool) or (
        isinstance(x, float) and math.isfinite(x) and x == math.floor(x)
    )


def pls_prepare_data(spec, data):
    """load_job_data(): the numeric matrix in model indicator order, with the R engine's checks."""
    rows = data.get("rows") if isinstance(data, dict) else None
    hdr = data.get("columns") if isinstance(data, dict) else None
    if not isinstance(rows, (list, tuple)) or not isinstance(hdr, (list, tuple)):
        raise invalid("data needs `columns` and `rows`.")
    n_rows = data.get("nRows")
    n_dropped = data.get("nDropped")
    if (
        not (_is_int(n_rows) and _is_int(n_dropped))
        or n_rows < 0
        or n_dropped < 0
        or n_rows - n_dropped != len(rows)
    ):
        raise invalid(
            "The data preparation is inconsistent (nRows - nDropped must equal the number of rows passed).",
            {"reason": "data-preparation-mismatch", "uploadedRows": len(rows)},
        )
    hdr = list(hdr)
    missing_cols = [i for i in spec.indicators if i.column not in hdr]
    if missing_cols:
        raise EngineError(
            "DATA_COLUMN_MISSING",
            f"{len(missing_cols)} mapped column(s) are not in the data: {', '.join('`' + i.column + '`' for i in missing_cols)}.",
            {
                "columns": [i.column for i in missing_cols],
                "indicatorIds": [i.id for i in missing_cols],
            },
        )
    ambiguous = [i for i in spec.indicators if hdr.count(i.column) > 1]
    if ambiguous:
        raise invalid(
            "A mapped column name occurs more than once in the data header.",
            {"columns": [i.column for i in ambiguous]},
        )
    n = len(rows)
    p = len(spec.indicators)
    col_idx = [hdr.index(i.column) for i in spec.indicators]
    X = np.zeros((n, p))
    non_numeric = {}
    missing = {}
    for r in range(n):
        row = rows[r]
        for j in range(p):
            ci = col_idx[j]
            v = row[ci] if row is not None and ci < len(row) else None
            col = spec.indicators[j].column
            if v is None or (isinstance(v, float) and v != v):
                missing[col] = missing.get(col, 0) + 1
            elif not _is_number(v) or not math.isfinite(v):
                non_numeric[col] = non_numeric.get(col, 0) + 1
            else:
                X[r, j] = v
    if non_numeric:
        raise EngineError(
            "DATA_NOT_NUMERIC",
            f"{len(non_numeric)} mapped column(s) contain non-numeric cells: {', '.join(f'`{c}` ({k} cells)' for c, k in non_numeric.items())}.",
            {"columns": list(non_numeric), "nonNumericCells": list(non_numeric.values())},
        )
    if missing:
        raise invalid(
            f"{len(missing)} mapped column(s) contain missing cells: {', '.join(f'`{c}` ({k} cells)' for c, k in missing.items())}. The engine expects the listwise-complete data set.",
            {
                "reason": "missing-values",
                "columns": list(missing),
                "missingCells": list(missing.values()),
            },
        )
    if n < 3:
        raise EngineError(
            "DATA_INSUFFICIENT_ROWS",
            f"The data have {n} row(s); at least 3 are required.",
            {"nRows": n, "minimum": 3},
        )
    constant = [ind for j, ind in enumerate(spec.indicators) if np.all(X[:, j] == X[0, j])]
    if constant:
        raise EngineError(
            "DATA_ZERO_VARIANCE",
            f"{len(constant)} mapped column(s) have zero variance: {', '.join('`' + i.column + '`' for i in constant)}.",
            {"columns": [i.column for i in constant], "indicatorIds": [i.id for i in constant]},
        )
    if spec.ipma is not None:
        bad = []
        counts = []
        for j, ind in enumerate(spec.indicators):
            lo, hi = ind.scale
            c = int(np.sum((X[:, j] < lo) | (X[:, j] > hi)))
            if c > 0:
                bad.append(ind.id)
                counts.append(c)
        if bad:
            raise invalid(
                f"IPMA: {len(bad)} indicator(s) have observed values outside their declared scale endpoints.",
                {"reason": "ipma-out-of-scale", "indicatorIds": bad, "cellsOutOfScale": counts},
            )
    for c in spec.constructs:
        if not c.mode_b or len(c.indicators) < 2:
            continue
        R, _ = correlation(X[:, c.indicators])
        if qr_rank(R, 1e-10) < R.shape[0]:
            raise EngineError(
                "MODEL_NOT_IDENTIFIED",
                f"The indicators of Mode B construct `{c.id}` are perfectly collinear; its weights are not identified.",
                {"constructId": c.id},
            )
    return PreparedData(
        X, n, int(n_rows), int(n_dropped), [i.id for i in spec.indicators if i.reverse]
    )


# ---------------------------------------------------------------------------------------------
# core


class CoreModel:
    """The model as the estimation core sees it (indices, no ids)."""

    __slots__ = (
        "k",
        "p",
        "blocks",
        "mode_b",
        "common_factor",
        "structural",
        "scheme",
        "max_iter",
        "tol",
        "preds",
        "endo_mask",
    )

    def __init__(self, k, p, blocks, mode_b, common_factor, structural, scheme, max_iter, tol):
        self.k = k
        self.p = p
        self.blocks = blocks
        self.mode_b = mode_b
        self.common_factor = common_factor
        #: structural[t, s] = 1 when there is a path s -> t
        self.structural = structural
        self.scheme = scheme
        self.max_iter = max_iter
        self.tol = tol
        self.preds = [[s for s in range(k) if structural[t, s] == 1] for t in range(k)]
        self.endo_mask = [bool(np.any(structural[t] == 1)) for t in range(k)]


def core_model(spec):
    k = len(spec.constructs)
    structural = np.zeros((k, k), dtype=np.int8)
    for p in spec.paths:
        structural[p.target, p.source] = 1
    return CoreModel(
        k,
        len(spec.indicators),
        [list(c.indicators) for c in spec.constructs],
        [c.mode_b for c in spec.constructs],
        [c.reflective for c in spec.constructs],
        structural,
        spec.scheme,
        spec.max_iter,
        spec.tol,
    )


class CoreFit:
    __slots__ = (
        "converged",
        "iterations",
        "W",
        "Lambda",
        "Q",
        "C",
        "P",
        "B",
        "R2",
        "R2adj",
        "vif",
        "disattenuated",
    )

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def _composite_vcv(WS, W):
    """C = W S W' with the upper triangle copied to the lower (cSEM calculateCompositeVCV)."""
    C = WS @ W.T
    return symmetrize_from_upper(C)


def scale_weights(S, W, blocks):
    """cSEM:::scaleWeights: each row divided by the composite's sd sqrt(w'Sw)."""
    out = np.empty_like(W)
    with np.errstate(all="ignore"):
        for j, b in enumerate(blocks):
            w = W[j, b]
            v = float(w @ S[np.ix_(b, b)] @ w)
            f = 1.0 / np.sqrt(v) if v >= 0 else math.nan
            if not math.isfinite(f):
                raise NumericalError("composite variance is not positive")
            out[j] = W[j] * f
    return out


def _inner_weights(C, model):
    """cSEM:::calculateInnerWeightsPLS (with .PLS_ignore_structural_model = FALSE)."""
    k = model.k
    st = model.structural
    if model.scheme == "path":
        E = np.where(st.T == 1, C, 0.0)
        for j in range(k):
            f = model.preds[j]
            if not f:
                continue
            coef = solve_r(C[np.ix_(f, f)], C[j, f])
            E[j, f] = coef
        return E
    adj = (st == 1) | (st.T == 1)
    if model.scheme == "centroid":
        return np.where(adj, np.sign(C), 0.0)
    return np.where(adj, C, 0.0)


def _outer_weights(S, W, E, model):
    """cSEM:::calculateOuterWeightsPLS for Mode A / Mode B blocks."""
    WS = W @ S
    PIC = E @ WS
    out = np.zeros((model.k, model.p))
    for j, b in enumerate(model.blocks):
        if len(b) == 1:
            out[j, b[0]] = 1.0
        elif model.mode_b[j]:
            out[j, b] = solve_r(S[np.ix_(b, b)], PIC[j, b])
        else:
            out[j, b] = PIC[j, b]
    return out


class WeightResult:
    __slots__ = ("W", "converged", "iterations")

    def __init__(self, W, converged, iterations):
        self.W = W
        self.converged = converged
        self.iterations = iterations


def fit_weights(S, model):
    """cSEM:::calculateWeightsPLS with .conv_criterion = "diff_absolute"."""
    W = np.zeros((model.k, model.p))
    for j, b in enumerate(model.blocks):
        W[j, b] = 1.0
    W = scale_weights(S, W, model.blocks)
    W_iter = W
    it = 0
    converged = False
    while True:
        it += 1
        C = _composite_vcv(W_iter @ S, W_iter)
        E = _inner_weights(C, model)
        W = scale_weights(S, _outer_weights(S, W_iter, E, model), model.blocks)
        max_diff = float(np.max(np.abs(W_iter - W)))
        if not math.isfinite(max_diff):
            raise NumericalError("non-finite weights")
        if max_diff < model.tol:
            converged = True
            break
        # iter_max == 1 gives cSEM status NULL, which the engine treats as not converged
        if it >= model.max_iter:
            break
        W_iter = W
    return WeightResult(W, converged, it)


def correction_factor(S, w, block):
    """cSEM:::calculateCorrectionFactors, .PLS_approach_cf = "dist_squared_euclid"."""
    w = np.asarray(w, dtype=float)
    WW = np.outer(w, w)
    np.fill_diagonal(WW, 0.0)
    num = float(np.sum(WW * S[np.ix_(block, block)]))
    den = float(np.sum(WW * WW))
    with np.errstate(all="ignore"):
        return float(np.sqrt(np.abs(np.divide(num, den))))


def loadings_and_q(S, W, model, disattenuate):
    """Loadings and Q (square roots of reliabilities) as cSEM:::calculateReliabilities."""
    WS = W @ S
    Lambda = np.zeros((model.k, model.p))
    Q = np.ones(model.k)
    for j, b in enumerate(model.blocks):
        Lambda[j, b] = WS[j, b]
    if disattenuate:
        for j, b in enumerate(model.blocks):
            if not model.common_factor[j] or model.mode_b[j]:
                continue
            w = W[j, b]
            c = 1.0 if len(b) == 1 else correction_factor(S, w, b)
            lam = c * w
            Lambda[j, b] = lam
            Q[j] = float(np.sum(w * lam))
    return Lambda, Q, WS


def construct_vcv(C, Q):
    """cSEM:::calculateConstructVCV."""
    with np.errstate(all="ignore"):
        P = C / np.outer(Q, Q)
    np.fill_diagonal(P, 1.0)
    return P


class PathResult:
    __slots__ = ("B", "R2", "R2adj", "vif")

    def __init__(self, B, R2, R2adj, vif):
        self.B = B
        self.R2 = R2
        self.R2adj = R2adj
        self.vif = vif


def estimate_paths(P, structural, n):
    """cSEM:::estimatePath (linear, OLS): coef = P_XX^-1 P_Xy per endogenous construct."""
    k = P.shape[0]
    B = np.zeros((k, k))
    R2 = np.full(k, math.nan)
    R2adj = np.full(k, math.nan)
    vif = np.full((k, k), math.nan)
    for y in range(k):
        X = [s for s in range(k) if structural[y][s] == 1]
        if not X:
            continue
        Pxx = P[np.ix_(X, X)]
        inv = inverse_r(Pxx)
        pxy = P[X, y]
        coef = inv @ pxy
        r2 = float(coef @ Pxx @ coef)
        B[y, X] = coef
        R2[y] = r2
        with np.errstate(all="ignore"):
            R2adj[y] = 1 - np.divide((1 - r2) * (n - 1), float(n - len(X) - 1))
        if len(X) > 1:
            vif[y, X] = np.diag(inv)
    return PathResult(B, R2, R2adj, vif)


def fit_pls(S, model, disattenuate, n):
    """The complete csem() fit on a correlation matrix. Raises NumericalError where cSEM errors."""
    return complete_fit(S, model, fit_weights(S, model), disattenuate, n)


def complete_fit(S, model, wr, disattenuate, n):
    W = wr.W
    Lambda, Q, WS = loadings_and_q(S, W, model, disattenuate)
    C = _composite_vcv(WS, W)
    P = construct_vcv(C, Q)
    pr = estimate_paths(P, model.structural, n)
    return CoreFit(
        converged=wr.converged,
        iterations=wr.iterations,
        W=W,
        Lambda=Lambda,
        Q=Q,
        C=C,
        P=P,
        B=pr.B,
        R2=pr.R2,
        R2adj=pr.R2adj,
        vif=pr.vif,
        disattenuated=disattenuate,
    )


def model_implied_construct_cor(fit, model):
    """Model-implied construct correlations of cSEM:::fit(.saturated = FALSE)."""
    k = model.k
    endo = [c for c in range(k) if model.endo_mask[c]]
    exo = [c for c in range(k) if not model.endo_mask[c]]
    Path = fit.B
    P = fit.P
    ne = len(endo)
    IB = inverse_r(np.eye(ne) - Path[np.ix_(endo, endo)])
    Gamma = Path[np.ix_(endo, exo)]
    Phi = P[np.ix_(exo, exo)]
    zeta = np.array([1 - float(np.sum(Path[t] * P[t])) for t in endo])
    PhiGt = Phi @ Gamma.T
    corr_exo_endo = PhiGt @ IB.T
    inner = Gamma @ PhiGt + np.diag(zeta)
    cor_endo = IB @ inner @ IB.T
    np.fill_diagonal(cor_endo, 1.0)
    nx = len(exo)
    V0 = np.zeros((k, k))
    V0[:nx, :nx] = Phi
    V0[:nx, nx:] = corr_exo_endo
    V0[nx:, :nx] = corr_exo_endo.T
    V0[nx:, nx:] = cor_endo
    symmetrize_from_upper(V0)
    order = exo + endo
    V = np.zeros((k, k))
    V[np.ix_(order, order)] = V0
    return V


def model_implied_indicator_cor(S, fit, model, treat_as_common_factor=False):
    """Model-implied indicator correlations of cSEM:::fit(.type_vcv = "indicator")."""
    V = model_implied_construct_cor(fit, model)
    p = model.p
    owner = np.full(p, -1)
    for j, b in enumerate(model.blocks):
        owner[b] = j
    lam = np.sum(fit.Lambda**2, axis=0)  # diag(Lambda' Lambda)
    L = fit.Lambda[owner, np.arange(p)]
    Sigma = (L[:, None] * V[np.ix_(owner, owner)]) * L[None, :]
    Sigma[np.diag_indices(p)] += np.diag(S) - lam
    Sigma = np.triu(Sigma)
    symmetrize_from_upper(Sigma)
    if not treat_as_common_factor:
        for j, b in enumerate(model.blocks):
            if model.common_factor[j]:
                continue
            Sigma[np.ix_(b, b)] = S[np.ix_(b, b)]
    return Sigma


VERIFY_CHECKS = {
    "1": "Convergence achieved",
    "2": "All absolute standardized loading estimates <= 1",
    "3": "Construct VCV is positive semi-definite",
    "4": "All reliability estimates <= 1",
    "5": "Model-implied indicator VCV is positive semi-definite",
}


def verify(S, fit, model):
    """cSEM::verify(): the checks that FAILED."""
    failed = []
    if not fit.converged:
        failed.append("1")
    absL = np.abs(fit.Lambda)
    if np.any(np.isnan(absL)) or float(np.max(absL)) > 1:
        failed.append("2")
    if not is_positive_semi_definite(fit.P):
        failed.append("3")
    if any(not (q * q <= 1) for q in fit.Q):
        failed.append("4")
    try:
        sigma_psd = is_positive_semi_definite(model_implied_indicator_cor(S, fit, model))
    except NumericalError:
        sigma_psd = False
    if not sigma_psd:
        failed.append("5")
    return failed
