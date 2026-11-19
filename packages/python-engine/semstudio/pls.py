"""estimate_pls(): the PLS-SEM / PLSc job (port of packages/engine/src/pls/estimate.ts and
results.ts). Numbers follow cSEM 0.7.1 (pls_core.py), the normalisation follows the R engine's
pls_results.R (keys, kinds, ordering, definitions, missing reasons), the bootstrap is SEM
Studio's definition (bootstrap.py)."""

import math
import numpy as np

from .assess import (
    ave,
    cronbach_alpha,
    cross_loadings,
    f2,
    fit_indices,
    htmt_pair,
    reliability_eligible,
    rho_a,
    rho_c,
    rho_c_sigma,
    vif_mode_b,
)
from .bootstrap import (
    BootstrapProblem,
    DrawResult,
    ThetaSlot,
    extract_theta,
    fit_draw,
    infer_from_draws,
    summarise_bootstrap,
)
from .effects import MAX_SPECIFIC_INDIRECT, compute_effects, effects_spec
from .errors import EngineError
from .ipma import compute_ipma
from .jsnum import js_signif, js_str
from .linalg import NumericalError, correlation
from .meta import iso_now, provenance
from .pls_core import (
    VERIFY_CHECKS,
    core_model,
    fit_pls,
    pls_prepare_data,
    validate_request,
    verify,
)
from .rng import bootstrap_indices

ENGINE_VERSION = "0.1.0"
#: Draws stored in result.bootstrap.draws are rounded to this many significant digits.
DRAW_SIGNIF = 6

SOURCE_PLS = "@sem-studio/engine pls-pm (cSEM 0.7.1 semantics)"
SOURCE_EFFECTS = "@sem-studio/engine effects from the path estimates"
INFERENCE_NOTE = "se = sd(valid draws, divisor B_valid-1); t = est/se; p from t distribution, df = B_valid-1; CI = percentile, quantile(type 7)"
_INF_FIELDS = ("se", "statistic", "pValue", "ciLower", "ciUpper")


# ---- theta ----------------------------------------------------------------------------------


class ThetaEntry(ThetaSlot):
    __slots__ = ("key", "source_id", "target_id", "relationship_id", "single", "raw_path")

    def __init__(self, kind, row, col, key, source_id, target_id, relationship_id, single, raw):
        super().__init__(kind, row, col)
        self.key = key
        self.source_id = source_id
        self.target_id = target_id
        self.relationship_id = relationship_id
        self.single = single
        self.raw_path = raw


def theta_entries(spec):
    """Paths in relationship order, then every block's (loading, weight) per indicator."""
    out = []
    for p in spec.paths:
        s = spec.constructs[p.source].id
        t = spec.constructs[p.target].id
        out.append(
            ThetaEntry(
                "path",
                p.target,
                p.source,
                f"path:{s}->{t}",
                s,
                t,
                p.id,
                False,
                f"path coefficient B[{t}, {s}] (OLS on the construct correlations)",
            )
        )
    for j, c in enumerate(spec.constructs):
        single = len(c.indicators) == 1
        for a in c.indicators:
            ii = spec.indicators[a].id
            out.append(
                ThetaEntry(
                    "loading",
                    j,
                    a,
                    f"loading:{c.id}:{ii}",
                    c.id,
                    ii,
                    None,
                    single,
                    f"loading Lambda[{c.id}, {ii}]",
                )
            )
            out.append(
                ThetaEntry(
                    "weight",
                    j,
                    a,
                    f"weight:{c.id}:{ii}",
                    c.id,
                    ii,
                    None,
                    single,
                    f"weight W[{c.id}, {ii}] (scaled to unit composite variance)",
                )
            )
    return out


# ---- parameters ------------------------------------------------------------------------------


def _num_or_reason(x, reason):
    if x is None:
        return None, reason
    if not math.isfinite(x):
        return None, "non-finite"
    return float(x), None


def param_entry(
    key,
    kind,
    est,
    source_id=None,
    target_id=None,
    via_ids=None,
    relationship_id=None,
    inf=None,
    boot=None,
    fixed_reason=None,
    source_method="",
    raw_path="",
):
    """R param_entry()."""
    missing = {}
    status = "fixed" if fixed_reason else "estimated"
    e_val, e_reason = _num_or_reason(est, "non-finite")
    if e_reason:
        missing["est"] = e_reason
        status = "failed"
    vals = {f: None for f in _INF_FIELDS}
    use_boot = boot is not None and not fixed_reason
    for f in _INF_FIELDS:
        if fixed_reason:
            missing[f] = fixed_reason
        elif not use_boot:
            missing[f] = "not-requested"
        else:
            v = inf.get(f)
            if v is None:
                missing[f] = inf.reason or (
                    "not-applicable" if f in ("ciLower", "ciUpper") else "failed"
                )
            else:
                nv, nr = _num_or_reason(v, "failed")
                vals[f] = nv
                if nr:
                    missing[f] = nr
    p = {"key": key, "kind": kind}
    if source_id is not None:
        p["sourceId"] = source_id
    if target_id is not None:
        p["targetId"] = target_id
    if via_ids is not None:
        p["viaIds"] = via_ids
    if relationship_id is not None:
        p["relationshipId"] = relationship_id
    p["scale"] = "standardized"
    p["est"] = e_val
    p.update(vals)
    if use_boot:
        p["statisticType"] = "t"
    if missing:
        p["missing"] = missing
    p["status"] = status
    if use_boot:
        p["inference"] = {
            "method": "bootstrap-percentile",
            "level": boot.level,
            "sides": boot.sides,
            "nValid": inf.n_valid,
        }
    p["sourceMethod"] = source_method
    p["rawPath"] = raw_path[:400]
    return p


class BootstrapInference:
    __slots__ = ("boot", "theta", "total", "indirect", "specific")

    def __init__(self, boot, theta, total, indirect, specific):
        self.boot = boot
        self.theta = theta
        self.total = total
        self.indirect = indirect
        self.specific = specific


def build_parameters(spec, theta, theta_values, es, eff, bs):
    ids = [c.id for c in spec.constructs]
    out = []
    for i, t in enumerate(theta):
        fixed = t.single
        raw = t.raw_path
        if bs is not None and not fixed:
            raw += f"; {INFERENCE_NOTE}"
        if fixed:
            raw += "; single-indicator block: fixed at 1 by construction"
        out.append(
            param_entry(
                t.key,
                t.kind,
                theta_values[i],
                source_id=t.source_id,
                target_id=t.target_id,
                relationship_id=t.relationship_id,
                inf=bs.theta[i] if bs is not None and not fixed else None,
                boot=bs.boot if bs is not None and not fixed else None,
                fixed_reason="not-applicable" if fixed else None,
                source_method=SOURCE_PLS,
                raw_path=raw,
            )
        )
    note = f"; per draw; {INFERENCE_NOTE}" if bs is not None else ""
    for j, pr in enumerate(es.pairs):
        out.append(
            param_entry(
                f"total:{ids[pr.source]}->{ids[pr.target]}",
                "total-effect",
                eff.total[j],
                source_id=ids[pr.source],
                target_id=ids[pr.target],
                inf=bs.total[j] if bs is not None else None,
                boot=bs.boot if bs is not None else None,
                source_method=SOURCE_EFFECTS,
                raw_path=f"(I - B)^-1 - I, B = path coefficients{note}",
            )
        )
    for j, pr in enumerate(es.pairs):
        if not pr.has_indirect:
            continue
        out.append(
            param_entry(
                f"indirect:{ids[pr.source]}->{ids[pr.target]}",
                "indirect-effect",
                eff.indirect[j],
                source_id=ids[pr.source],
                target_id=ids[pr.target],
                inf=bs.indirect[j] if bs is not None else None,
                boot=bs.boot if bs is not None else None,
                source_method=SOURCE_EFFECTS,
                raw_path=f"(I - B)^-1 - I - B, B = path coefficients{note}",
            )
        )
    for j, sp in enumerate(es.specific):
        key = "specific-indirect:" + "->".join(ids[c] for c in sp.nodes)
        if len(key) > 400:
            continue
        out.append(
            param_entry(
                key,
                "specific-indirect",
                eff.specific[j],
                source_id=ids[sp.source],
                target_id=ids[sp.target],
                via_ids=[ids[c] for c in sp.via],
                inf=bs.specific[j] if bs is not None else None,
                boot=bs.boot if bs is not None else None,
                source_method=SOURCE_EFFECTS,
                raw_path=f"product of the path coefficients along the chain{note}",
            )
        )
    return out


# ---- construct metrics ---------------------------------------------------------------------

DEF = {
    "r2": "R²: share of the endogenous construct's variance explained by its predictors (OLS on the construct correlation matrix; cSEM Estimates$R2 definition). Defined for endogenous constructs only.",
    "r2adj": "Adjusted R² = 1 - (1 - R²)(n - 1)/(n - k - 1), n = rows used, k = number of predictors (cSEM Estimates$R2adj definition). Defined for endogenous constructs only.",
    "alpha": "Cronbach's alpha, standardized (correlation-based): k·r̄/(1 + (k - 1)·r̄), r̄ = mean inter-item correlation of the block (cSEM assess() RhoT definition). Reflective blocks with at least 2 indicators only.",
    "rhoa": "Dijkstra–Henseler rho_A of the Mode A weights: the PLSc (consistent PLS) reliability c²·(w′w)² of the same weights (cSEM Estimates$Reliabilities of a PLSc fit; the weights equal those of the classic fit). Reflective blocks with at least 2 indicators only.",
    "rhoc": "Composite reliability rho_C = (Σλ)² / ((Σλ)² + Σ(1 - λ²)) on the reported standardized loadings (cSEM assess() RhoC definition). Reflective blocks with at least 2 indicators only.",
    "ave": "Average variance extracted: mean of the squared reported standardized loadings (cSEM assess() AVE definition). Reflective blocks with at least 2 indicators only.",
}


def _metric_entry(construct_id, metric, value, reason, definition):
    v, r = _num_or_reason(value, reason)
    if r:
        return {
            "constructId": construct_id,
            "metric": metric,
            "value": None,
            "missing": r,
            "definition": definition,
        }
    return {"constructId": construct_id, "metric": metric, "value": v, "definition": definition}


def _safe(f):
    try:
        with np.errstate(all="ignore"):
            return f()
    except NumericalError:
        return None


def build_construct_metrics(spec, model, fit, S, rho_available):
    eligible = reliability_eligible(model)
    sigma_cf = _safe(lambda: rho_c_sigma(S, fit, model))
    out = []
    with np.errstate(all="ignore"):
        for j, c in enumerate(spec.constructs):
            endo = model.endo_mask[j]
            out.append(
                _metric_entry(
                    c.id,
                    "r2",
                    float(fit.R2[j]) if endo else None,
                    "failed" if endo else "not-applicable",
                    DEF["r2"],
                )
            )
            out.append(
                _metric_entry(
                    c.id,
                    "r2-adjusted",
                    float(fit.R2adj[j]) if endo else None,
                    "failed" if endo else "not-applicable",
                    DEF["r2adj"],
                )
            )
            el = eligible[j]
            block = c.indicators
            na = "not-applicable"
            out.append(
                _metric_entry(
                    c.id,
                    "cronbach-alpha",
                    cronbach_alpha(S, block) if el else None,
                    "failed" if el else na,
                    DEF["alpha"],
                )
            )
            ra = None
            if el and rho_available:
                ra = float(fit.Q[j]) ** 2 if fit.disattenuated else rho_a(S, fit.W, block, j)
            out.append(_metric_entry(c.id, "rho-a", ra, "failed" if el else na, DEF["rhoa"]))
            out.append(
                _metric_entry(
                    c.id,
                    "rho-c",
                    rho_c(sigma_cf, fit, j, block) if el and sigma_cf is not None else None,
                    "failed" if el else na,
                    DEF["rhoc"],
                )
            )
            out.append(
                _metric_entry(
                    c.id, "ave", ave(fit, j, block) if el else None, "failed" if el else na, DEF["ave"]
                )
            )
    return out


# ---- matrices ------------------------------------------------------------------------------


def _clean_row(row):
    return [float(v) if math.isfinite(v) else None for v in row]


def _matrix_entry(id, title, row_ids, col_ids, M, symmetric, definition, missing=None):
    m = {
        "id": id,
        "title": title,
        "rowIds": row_ids,
        "colIds": col_ids,
        "values": [_clean_row(r) for r in M] if row_ids and M is not None else [],
        "symmetric": symmetric,
        "definition": definition,
    }
    if missing:
        m["missing"] = missing
    return m


def build_matrices(spec, model, fit, S, n):
    ids = [c.id for c in spec.constructs]
    k = model.k
    eligible_idx = [j for j, e in enumerate(reliability_eligible(model)) if e]
    eligible = [ids[j] for j in eligible_idx]
    out = []
    for kind in ("htmt", "htmt2"):
        title = (
            "Heterotrait–monotrait ratio (HTMT)" if kind == "htmt" else "HTMT2 (geometric-mean HTMT)"
        )
        d = (
            "HTMT (Henseler, Ringle & Sarstedt, 2015): mean heterotrait correlation / sqrt(product of the mean monotrait correlations)"
            if kind == "htmt"
            else "HTMT2 (Roemer, Schuberth & Henseler, 2021): as HTMT with geometric instead of arithmetic means"
        ) + ", on Pearson indicator correlations, absolute value (cSEM assess() definition, .absolute = TRUE). Reflective constructs with at least 2 indicators only; other constructs are omitted (not applicable). Diagonal is null (not applicable)."
        if len(eligible) < 2:
            out.append(_matrix_entry(kind, title, [], [], None, True, d, "not-applicable"))
            continue
        M = [
            [
                math.nan if a == b else htmt_pair(S, model.blocks[a], model.blocks[b], kind)
                for b in eligible_idx
            ]
            for a in eligible_idx
        ]
        out.append(_matrix_entry(kind, title, eligible, eligible, M, True, d))

    fl_def = "Fornell–Larcker matrix (cSEM assess() fl_criterion definition): diagonal = AVE, off-diagonal = squared construct correlations. Reflective constructs with at least 2 indicators only."
    if not eligible:
        out.append(
            _matrix_entry(
                "fornell-larcker",
                "Fornell–Larcker criterion",
                [],
                [],
                None,
                True,
                fl_def,
                "not-applicable",
            )
        )
    else:
        M = [
            [ave(fit, a, model.blocks[a]) if a == b else float(fit.P[a, b]) ** 2 for b in eligible_idx]
            for a in eligible_idx
        ]
        out.append(
            _matrix_entry(
                "fornell-larcker", "Fornell–Larcker criterion", eligible, eligible, M, True, fl_def
            )
        )

    out.append(
        _matrix_entry(
            "cross-loadings",
            "Cross-loadings",
            [i.id for i in spec.indicators],
            ids,
            cross_loadings(fit, S, model),
            False,
            "Pearson correlation of each indicator with each construct score (standardized composites, as cSEM Estimates$Construct_scores)."
            + (
                " For PLSc the own-block entries are composite (proxy) correlations and therefore differ from the consistency-corrected loadings."
                if spec.method == "plsc"
                else ""
            ),
        )
    )
    out.append(
        _matrix_entry(
            "construct-correlations",
            "Construct correlations",
            ids,
            ids,
            fit.P,
            True,
            "Construct correlations (cSEM Estimates$Construct_VCV definition): consistency-corrected for reflective constructs (PLSc), composite correlations for Mode B constructs."
            if spec.method == "plsc"
            else "Construct correlations (cSEM Estimates$Construct_VCV definition): correlations of the standardized composites (classic PLS, no consistency correction).",
        )
    )

    endo = [j for j in range(k) if model.endo_mask[j]]
    preds = [j for j in range(k) if np.any(model.structural[:, j] == 1)]
    F = _safe(lambda: f2(fit, model, n))
    M = [
        [float(F[t, s]) if F is not None and model.structural[t, s] == 1 else math.nan for t in endo]
        for s in preds
    ]
    out.append(
        _matrix_entry(
            "f2",
            "Effect size f²",
            [ids[j] for j in preds],
            [ids[j] for j in endo],
            M,
            False,
            "f² = (R²_incl - R²_excl) / (1 - R²_incl) per structural path (row = predictor, column = endogenous construct), cSEM definition (assess() F2): R²_excl drops the predictor from the regression on the SAME construct correlations; the model is not re-estimated. Null where there is no path.",
            None if F is not None else "failed",
        )
    )

    def vif_cell(s, t):
        if model.structural[t, s] != 1:
            return math.nan
        n_pred = int(np.sum(model.structural[t] == 1))
        return 1.0 if n_pred == 1 else float(fit.vif[t, s])

    V = [[vif_cell(s, t) for t in endo] for s in preds]
    out.append(
        _matrix_entry(
            "vif-structural",
            "Structural VIF",
            [ids[j] for j in preds],
            [ids[j] for j in endo],
            V,
            False,
            "Variance inflation factor of each predictor in the regression of the endogenous construct (row = predictor, column = endogenous construct): diagonal of the inverse predictor correlation matrix (cSEM Estimates$VIF definition). Equals 1 by definition for a single predictor. Null where there is no path.",
        )
    )

    mode_b = [j for j in range(k) if model.mode_b[j]]
    vb_def = "Indicator VIF within each Mode B block: diagonal of the inverse indicator correlation matrix of the block (cSEM assess() VIF_modeB definition). Rows = indicators of Mode B blocks, columns = Mode B constructs; null outside the indicator's own block and for single-indicator blocks."
    if not mode_b:
        out.append(
            _matrix_entry(
                "vif-indicator-mode-b",
                "Indicator VIF (Mode B blocks)",
                [],
                [],
                None,
                False,
                vb_def,
                "not-applicable",
            )
        )
    else:
        rows = [a for j in mode_b for a in model.blocks[j]]
        Mv = [[math.nan] * len(mode_b) for _ in rows]
        failed = False
        for col, j in enumerate(mode_b):
            block = model.blocks[j]
            if len(block) < 2:
                continue
            v = _safe(lambda: vif_mode_b(S, block))
            if v is None:
                failed = True
                continue
            for idx, a in enumerate(block):
                Mv[rows.index(a)][col] = float(v[idx])
        out.append(
            _matrix_entry(
                "vif-indicator-mode-b",
                "Indicator VIF (Mode B blocks)",
                [spec.indicators[a].id for a in rows],
                [ids[j] for j in mode_b],
                Mv,
                False,
                vb_def,
                "failed" if failed else None,
            )
        )
    return out


# ---- fit ---------------------------------------------------------------------------------------

_FIT_DEFS = {
    "srmr": "Standardized root mean square residual: sqrt(mean of the squared differences between the empirical and the model-implied indicator correlations over the lower triangle INCLUDING the diagonal) (cSEM assess() SRMR definition; model-implied matrix as cSEM::fit()). No CB-SEM cutoffs apply.",
    "d_uls": "Unweighted least-squares discrepancy d_ULS = 0.5 · Σ_ij (s_ij - σ̂_ij)² over all elements of the empirical (S) and model-implied (Σ̂) indicator correlation matrices (cSEM assess() DL definition). No CB-SEM cutoffs apply.",
    "d_g": "Geodesic discrepancy d_G = 0.5 · Σ_i (log10 λ_i)², λ_i the eigenvalues of S⁻¹Σ̂ — base-10 logarithm as cSEM; the natural-log definition is (ln 10)² ≈ 5.30 times larger (cSEM assess() DG definition). No CB-SEM cutoffs apply.",
}


def build_fit(model, fit, S):
    fi = _safe(lambda: fit_indices(S, fit, model))
    values = {
        "srmr": fi.srmr if fi is not None else None,
        "d_uls": fi.d_uls if fi is not None else None,
        "d_g": fi.d_g if fi is not None else None,
    }
    out = []
    for name in ("srmr", "d_uls", "d_g"):
        v, r = _num_or_reason(values[name], "failed")
        if r:
            out.append(
                {
                    "name": name,
                    "value": None,
                    "missing": r,
                    "variant": "standard",
                    "definition": _FIT_DEFS[name],
                }
            )
        else:
            out.append(
                {"name": name, "value": v, "variant": "standard", "definition": _FIT_DEFS[name]}
            )
    return out


# ---- warnings ----------------------------------------------------------------------------------


def collect_warnings(spec, reversed_ids, verify_failed, theta, theta_values, rho_message, truncated, boot):
    """R collect_warnings(), preceded by the validation warnings."""
    out = list(spec.warnings)

    def add(code, severity, message, ids=None):
        w = {"code": code, "severity": severity, "message": message[:2000]}
        if ids:
            uniq = []
            for x in ids:
                if x not in uniq:
                    uniq.append(x)
            w["elementIds"] = uniq
        out.append(w)

    if reversed_ids:
        add(
            "REVERSE_SCORED_APPLIED",
            "info",
            f"{len(reversed_ids)} indicator(s) were reverse scored before estimation as (scale min + scale max) - x.",
            reversed_ids,
        )
    if verify_failed:
        add(
            "INADMISSIBLE_SOLUTION",
            "warning",
            f"The estimate is not admissible according to the cSEM::verify() checks: {'; '.join(VERIFY_CHECKS[c] for c in verify_failed)} failed. The numbers are reported but should not be interpreted without resolving this.",
        )
    neg = [
        t
        for i, t in enumerate(theta)
        if t.kind == "loading"
        and not t.single
        and math.isfinite(theta_values[i])
        and theta_values[i] < 0
    ]
    if neg:
        add(
            "NEGATIVE_LOADING",
            "warning",
            f"{len(neg)} loading(s) are negative. A construct's sign is arbitrary in PLS (the weights start from unit weights, so each block is oriented so that most loadings are positive); a negative loading usually means a reverse-worded item or a block whose indicators do not share one direction. Check item coding before interpreting path signs.",
            [t.source_id for t in neg] + [t.target_id for t in neg],
        )
    if rho_message:
        add("RHO_A_UNAVAILABLE", "warning", rho_message)
    if truncated:
        add(
            "SPECIFIC_INDIRECT_TRUNCATED",
            "warning",
            f"The structural model has more than {MAX_SPECIFIC_INDIRECT} indirect chains; only the first {MAX_SPECIFIC_INDIRECT} specific indirect effects are reported (total and total indirect effects are complete).",
        )
    b = boot
    if b is not None:
        if b.inadmissible > 0:
            add(
                "BOOTSTRAP_INADMISSIBLE_DROPPED",
                "warning" if b.inadmissible / b.requested > 0.05 else "info",
                f"{b.inadmissible} of {b.requested} bootstrap samples were inadmissible (cSEM::verify() checks) and were excluded from the standard errors and intervals.",
            )
        if b.failed > 0:
            add(
                "BOOTSTRAP_FAILED_DRAWS",
                "warning",
                f"{b.failed} of {b.requested} bootstrap samples could not be estimated (e.g. an indicator without variance in the resample, or no convergence) and were excluded.",
            )
        if b.completed < 2:
            add(
                "BOOTSTRAP_TOO_FEW_DRAWS",
                "error",
                f"Only {b.completed} valid bootstrap draw(s); standard errors, p values and intervals are not reported.",
            )
        if spec.bootstrap is not None and spec.bootstrap.sides == "one-sided":
            add(
                "ONE_SIDED_DIRECTION",
                "info",
                "One-sided inference is taken in the direction of each point estimate's sign: for est >= 0 the lower bound (quantile 1 - level) and p = P(T <= -|t|); for est < 0 the upper bound (quantile level).",
            )
    return out


# ---- estimate --------------------------------------------------------------------------------


def _cancelled(stage):
    return EngineError("CANCELLED", f"The job was cancelled {stage}.")


def estimate_pls(model, analysis, data, on_progress=None, is_cancelled=None, execute_draws=None, batch_size=25):
    """Run a PLS-SEM or PLSc analysis. Never raises: errors are returned as {'ok': False, 'error'}.

    on_progress(event: dict) receives {'stage', 'done'?, 'total'?, 'failed'?, 'inadmissible'?};
    is_cancelled() is polled between bootstrap draws; execute_draws(problem, batch) may fit a
    batch of resamples in parallel (results in the same order)."""
    try:
        with np.errstate(all="ignore"):
            return {
                "ok": True,
                "result": _run(
                    model, analysis, data, on_progress, is_cancelled, execute_draws, batch_size
                ),
            }
    except EngineError as e:
        return {"ok": False, "error": e.to_info()}
    except NumericalError:
        return {
            "ok": False,
            "error": {
                "code": "ENGINE_INTERNAL",
                "message": "A numerical step of the PLS estimation failed (singular or non-finite system).",
            },
        }
    except Exception:  # noqa: BLE001 - mirrors the TS engine's catch-all
        return {
            "ok": False,
            "error": {
                "code": "ENGINE_INTERNAL",
                "message": "Unexpected internal error in the browser PLS engine.",
            },
        }


def _run(model, analysis, data, on_progress, is_cancelled, execute_draws, batch_size):
    started_at = iso_now()

    def progress(e):
        if on_progress is not None:
            on_progress(e)

    def cancelled():
        return is_cancelled is not None and is_cancelled() is True

    progress({"stage": "validating"})
    spec = validate_request(model, analysis)
    prepared = pls_prepare_data(spec, data)
    if cancelled():
        raise _cancelled("before estimation")

    progress({"stage": "estimating"})
    cm = core_model(spec)
    plsc = spec.method == "plsc"
    S, _ = correlation(prepared.X)
    n = prepared.n
    try:
        fit = fit_pls(S, cm, plsc, n)
    except NumericalError:
        raise EngineError(
            "ENGINE_INTERNAL",
            "The PLS estimation failed (a singular or non-finite system occurred during estimation).",
            {"stage": "estimation"},
        ) from None
    if not fit.converged:
        raise EngineError(
            "ENGINE_NONCONVERGENCE",
            f"The PLS weight algorithm did not converge within {spec.max_iter} iterations (tolerance {js_str(spec.tol)}).",
            {"maxIterations": spec.max_iter, "tolerance": spec.tol, "iterations": fit.iterations},
        )
    verify_failed = verify(S, fit, cm)
    rho_available = True

    theta = theta_entries(spec)
    theta_values = extract_theta(fit, theta)
    es = effects_spec(cm.k, spec.paths)
    path_idx = [i for i, t in enumerate(theta) if t.kind == "path"]

    def effects_of(vals):
        return compute_effects(cm.k, spec.paths, [vals[i] for i in path_idx], es)

    eff = effects_of(theta_values)

    # ---- bootstrap -----------------------------------------------------------------------
    bs_inference = None
    boot_counts = None
    valid_effects = []
    if spec.bootstrap is not None:
        if cancelled():
            raise _cancelled("before bootstrapping")
        B = spec.bootstrap.reps
        problem = BootstrapProblem(cm, plsc, prepared.X, theta)
        bsz = max(1, batch_size)
        draws = []
        failed = 0
        inadm = 0
        progress({"stage": "bootstrapping", "done": 0, "total": B, "failed": 0, "inadmissible": 0})
        gen = bootstrap_indices(spec.bootstrap.seed, n, B)
        while len(draws) < B:
            batch = []
            while len(batch) < bsz and len(draws) + len(batch) < B:
                batch.append(next(gen))
            if execute_draws is not None:
                if cancelled():
                    raise _cancelled("during bootstrapping")
                results = list(execute_draws(problem, batch))
                if len(results) != len(batch):
                    raise EngineError(
                        "ENGINE_INTERNAL", "The bootstrap executor returned a wrong number of draws."
                    )
            else:
                results = []
                for idx in batch:
                    if cancelled():
                        raise _cancelled("during bootstrapping")
                    results.append(fit_draw(problem, idx))
            for r in results:
                draws.append(r)
                if r.status == "failed":
                    failed += 1
                elif r.status == "inadmissible":
                    inadm += 1
            progress(
                {
                    "stage": "bootstrapping",
                    "done": len(draws),
                    "total": B,
                    "failed": failed,
                    "inadmissible": inadm,
                }
            )
        if cancelled():
            raise _cancelled("during bootstrapping")
        boot_counts = summarise_bootstrap(draws)
        valid_effects = [effects_of(v) for v in boot_counts.valid]
        level = spec.bootstrap.level
        sides = spec.bootstrap.sides
        V = boot_counts.valid
        bs_inference = BootstrapInference(
            spec.bootstrap,
            [infer_from_draws(est, [v[i] for v in V], level, sides) for i, est in enumerate(theta_values)],
            [
                infer_from_draws(est, [e.total[j] for e in valid_effects], level, sides)
                for j, est in enumerate(eff.total)
            ],
            [
                infer_from_draws(est, [e.indirect[j] for e in valid_effects], level, sides)
                for j, est in enumerate(eff.indirect)
            ],
            [
                infer_from_draws(est, [e.specific[j] for e in valid_effects], level, sides)
                for j, est in enumerate(eff.specific)
            ],
        )
    if cancelled():
        raise _cancelled("before summarizing")

    # ---- summarise --------------------------------------------------------------------------
    progress({"stage": "summarizing"})
    parameters = build_parameters(spec, theta, theta_values, es, eff, bs_inference)
    construct_metrics = build_construct_metrics(spec, cm, fit, S, rho_available)
    matrices = build_matrices(spec, cm, fit, S, n)
    fit_idx = build_fit(cm, fit, S)
    warnings = collect_warnings(
        spec,
        prepared.reversed,
        verify_failed,
        theta,
        theta_values,
        None,
        es.truncated,
        boot_counts,
    )
    ipma = None
    estimator_text = (
        'consistent PLS (PLSc: Mode A weights + consistency correction, correction factor "dist_squared_euclid")'
        if plsc
        else "classic PLS-SEM (no consistency correction)"
    )
    calls = [
        f'PLS-PM (cSEM 0.7.1 semantics) on the Pearson indicator correlation matrix: {estimator_text}; reflective blocks Mode A, composite-formative blocks Mode B; starting weights = unit weights scaled to unit composite variance; inner weighting scheme "{spec.scheme}"; convergence: max |W_old - W_new| < {js_str(spec.tol)} within {spec.max_iter} iterations; paths by OLS on the construct correlations; no sign re-orientation.'
    ]
    if not plsc and any(cm.common_factor):
        calls.append("rho_A: PLSc correction (dist_squared_euclid) applied to the same weights.")
    if spec.bootstrap is not None:
        calls.append(
            f'Bootstrap: set.seed({spec.bootstrap.seed}, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection"); for b in 1..{spec.bootstrap.reps}: idx <- sample.int({n}, {n}, replace = TRUE), refit the full model; failed (error / no convergence / non-finite) and inadmissible (verify) draws excluded; percentile CI (quantile type 7), p from t(df = B_valid - 1).'
        )
    if spec.ipma is not None:
        ipma, ipma_warnings = compute_ipma(spec, prepared)
        warnings.extend(ipma_warnings)
        calls.append(
            f'IPMA: classic PLS-SEM (scheme "{spec.scheme}", same tolerance and iteration cap) on the indicators rescaled to 0-100 with their declared endpoints.'
        )

    admissible = len(verify_failed) == 0
    messages = [
        f"PLS weights converged after {fit.iterations} iteration(s) (tolerance {js_str(spec.tol)}, criterion max |W_old - W_new|, at most {spec.max_iter} iterations).",
        "Estimator: "
        + ("consistent PLS (PLSc)" if plsc else "classic PLS-SEM (no consistency correction)")
        + f'; inner weighting scheme "{spec.scheme}".',
    ]
    if not admissible:
        messages.append(
            f"Admissibility (cSEM::verify() checks) failed: {'; '.join(VERIFY_CHECKS[c] for c in verify_failed)}."
        )
    messages = [m[:2000] for m in messages]

    bootstrap = None
    if spec.bootstrap is not None and boot_counts is not None:
        draw_map = {}
        for i in path_idx:
            draw_map[theta[i].key] = [js_signif(v[i], DRAW_SIGNIF) for v in boot_counts.valid]
        ids = [c.id for c in spec.constructs]
        for j, sp in enumerate(es.specific):
            key = "specific-indirect:" + "->".join(ids[c] for c in sp.nodes)
            if len(key) <= 400:
                draw_map[key] = [js_signif(e.specific[j], DRAW_SIGNIF) for e in valid_effects]
        bootstrap = {
            "requested": boot_counts.requested,
            "completed": boot_counts.completed,
            "failed": boot_counts.failed,
            "inadmissible": boot_counts.inadmissible,
            "seed": spec.bootstrap.seed,
            "ciMethod": "percentile",
            "confidenceLevel": spec.bootstrap.level,
            "chunkSize": 1,
            "draws": draw_map,
        }

    call = "\n".join(calls)
    if len(call) > 4000:
        call = call[:3980] + "\n[truncated]"
    result = {
        "schemaVersion": 1,
        "sample": {
            "nRows": prepared.n_rows,
            "nUsed": n,
            "nDropped": prepared.n_rows - n,
            "missingData": "listwise",
        },
        "estimation": {
            "converged": True,
            "iterations": fit.iterations,
            "admissible": admissible,
            "messages": messages,
        },
        "parameters": parameters,
        "constructMetrics": construct_metrics,
        "matrices": matrices,
        "fit": fit_idx,
    }
    if bootstrap is not None:
        result["bootstrap"] = bootstrap
    if ipma is not None:
        result["ipma"] = ipma
    result["warnings"] = warnings
    result["provenance"] = provenance(call, started_at, {"@sem-studio/engine": ENGINE_VERSION})
    return result


__all__ = [
    "ENGINE_VERSION",
    "estimate_pls",
    "theta_entries",
    "DrawResult",
]
