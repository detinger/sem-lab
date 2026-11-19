"""Phase 0 spike: what plspm 0.5.7 can and cannot do, established by execution on tam-v1.

Run:    cd apps/api && uv run python spike/plspm_probe.py
Writes: docs/validation/phase-0/evidence/python/plspm_probe.json
        docs/validation/phase-0/evidence/python/parity_plspm_pls-modeA-{path,centroid,factorial}.json

Every numeric claim is checked against something independent of plspm: spike/ref_pls.py (a
NumPy PLS-PM implementation sharing no code with plspm), NumPy least squares on plspm's own
scores, closed-form identities, or hand formulas. Bootstrap is in spike/plspm_bootstrap.py.
"""

from __future__ import annotations

import importlib.metadata as md
import inspect
import re
from pathlib import Path

import numpy as np
import pandas as pd
import plspm
import plspm.config as c
import ref_pls
from _common import (
    EVIDENCE_DIR,
    TAM_BLOCKS,
    TAM_ENDOGENOUS,
    TAM_INDICATORS,
    TAM_PATHS,
    Recorder,
    dump_json,
    inject_missing,
    load_tam,
    max_abs_diff,
    versions,
)
from plspm.mode import Mode
from plspm.plspm import Plspm
from plspm.scale import Scale
from plspm.scheme import Scheme

TOL = 1e-12  # plspm tolerance: sum over indicators of (|w_old| - |w_new|)^2 (metric) or over scores (nonmetric)
MAX_IT = 300
LVS = list(TAM_BLOCKS)
CHECK_TOL = 1e-8  # acceptance for "verified" comparisons below

rec = Recorder()
df = load_tam()
out: dict = {"generated_by": "apps/api/spike/plspm_probe.py", "versions": versions(), "checks": rec.results}


def build(scaled: bool = True, default_scale: Scale | None = None, modes: dict[str, str] | None = None) -> c.Config:
    s = c.Structure()
    for a, b in TAM_PATHS:
        s.add_path([a], [b])
    cfg = c.Config(s.path(), scaled=scaled, default_scale=default_scale)
    for lv, mvs in TAM_BLOCKS.items():
        mode = Mode.B if (modes or {}).get(lv) == "B" else Mode.A
        cfg.add_lv(lv, mode, *[c.MV(m) for m in mvs])
    return cfg


def fit(data=None, scheme=Scheme.PATH, **cfg_kw) -> Plspm:
    return Plspm(df if data is None else data, build(**cfg_kw), scheme, MAX_IT, TOL)


def ref(scheme: str, modes=None) -> ref_pls.RefPLS:
    return ref_pls.fit({k: df[v].to_numpy(float) for k, v in TAM_BLOCKS.items()}, TAM_PATHS, scheme, modes, tol=1e-14)


def paths_of(p: Plspm) -> dict[str, float]:
    pc = p.path_coefficients()
    return {f"{a}->{b}": float(pc.loc[b, a]) for a, b in TAM_PATHS}


def compare_to_ref(p: Plspm, r: ref_pls.RefPLS) -> dict[str, float]:
    om = p.outer_model()
    pc = p.path_coefficients()
    w_ref = np.concatenate([r.weights[lv] for lv in LVS])
    l_ref = np.concatenate([r.loadings[lv] for lv in LVS])
    mvs = [m for lv in LVS for m in TAM_BLOCKS[lv]]
    score_ref = pd.DataFrame(r.scores, columns=r.constructs)[LVS].to_numpy()
    return {
        "paths": max_abs_diff([pc.loc[b, a] for a, b in TAM_PATHS], [r.paths[(a, b)] for a, b in TAM_PATHS]),
        "weights": max_abs_diff(om.loc[mvs, "weight"], w_ref),
        "loadings": max_abs_diff(om.loc[mvs, "loading"], l_ref),
        "r2": max_abs_diff(p.inner_summary().loc[TAM_ENDOGENOUS, "r_squared"], [r.r2[e] for e in TAM_ENDOGENOUS]),
        "scores": max_abs_diff(p.scores()[LVS].to_numpy(), score_ref),
    }


# ----------------------------------------------------------------------------- a. construction
out["api"] = {
    "Plspm.__init__": str(inspect.signature(Plspm.__init__)),
    "Config.__init__": str(inspect.signature(c.Config.__init__)),
    "Config.add_lv": str(inspect.signature(c.Config.add_lv)),
    "Config.add_higher_order": str(inspect.signature(c.Config.add_higher_order)),
    "Structure.add_path": str(inspect.signature(c.Structure.add_path)),
    "MV.__init__": str(inspect.signature(c.MV.__init__)),
    "Scheme": [s.name for s in Scheme],
    "Mode": [m.name for m in Mode],
    "Scale": [s.name for s in Scale],
    "Plspm_public_methods": sorted(n for n, _ in inspect.getmembers(Plspm, inspect.isfunction) if not n.startswith("_")),
    "Bootstrap_public_methods": sorted(
        n for n, _ in inspect.getmembers(plspm.bootstrap.Bootstrap, inspect.isfunction) if not n.startswith("_")
    ),
}


def _treatment():
    """How each data route standardises indicators (Config.treat is what Plspm calls)."""
    res = {}
    for name, kw in {
        "metric_scaled_true": {"scaled": True},
        "metric_scaled_false": {"scaled": False},
        "nonmetric_NUM": {"default_scale": Scale.NUM},
    }.items():
        cfg = build(**kw)
        t = cfg.treat(cfg.filter(df))
        sd0 = t.std(ddof=0)
        res[name] = {
            "max_abs_column_mean": float(t.mean().abs().max()),
            "column_sd_ddof0_min": float(sd0.min()),
            "column_sd_ddof0_max": float(sd0.max()),
            # metric scaled=True divides EVERY column by one pooled scalar: sd of all stacked values * sqrt((n-1)/n)
            "ratio_raw_sd_to_treated_sd_unique": sorted({round(float(v), 10) for v in df.std(ddof=0) / sd0}),
        }
    pooled = float(df.stack().std() * np.sqrt((len(df) - 1) / len(df)))
    res["pooled_scalar_hand"] = pooled
    return res


out["treatment"] = rec.run("a.data_treatment_by_route", _treatment)


def _routes():
    """Same model through the three data routes; compared to ref_pls (per-indicator standardisation)."""
    r = ref("path")
    res = {}
    for name, kw in {
        "metric_scaled_true": {"scaled": True},
        "metric_scaled_false": {"scaled": False},
        "nonmetric_NUM": {"default_scale": Scale.NUM},
    }.items():
        p = fit(**kw)
        res[name] = {"paths": paths_of(p), "maxAbsDiffVsRefPLS": compare_to_ref(p, r)}
    z = (df - df.mean()) / df.std(ddof=0)
    p = fit(data=z, scaled=False)
    res["prestandardised_metric_scaled_false"] = {"paths": paths_of(p), "maxAbsDiffVsRefPLS": compare_to_ref(p, r)}
    return res


out["routes"] = rec.run("a.routes_vs_ref_pls.path", _routes)


def _iterations():
    import plspm.weights as w

    res = {"iteration_count_exposed": any("iter" in n.lower() for n in dir(fit(default_scale=Scale.NUM)))}
    # iterations < 100 is silently raised to 100; tolerance must be > 0
    src = inspect.getsource(Plspm.__init__)
    res["iterations_floor_100_in_source"] = "if iterations < 100:" in src
    try:
        Plspm(df, build(default_scale=Scale.NUM), Scheme.PATH, 100, 1e-300)
        res["tol_1e-300"] = "converged"
    except Exception as e:  # noqa: BLE001
        res["tol_1e-300"] = f"{type(e).__name__}: {e}"
    # count iterations by instrumenting the calculator loop (monkeypatch only inside this probe)
    counts = {}
    orig = w._NonmetricWeights.iterate

    def counting(self, scheme):
        counts["n"] = counts.get("n", 0) + 1
        return orig(self, scheme)

    w._NonmetricWeights.iterate = counting
    try:
        for tol in (1e-6, 1e-10, 1e-12):
            counts.clear()
            Plspm(df, build(default_scale=Scale.NUM), Scheme.PATH, 300, tol)
            res[f"iterate_calls_tol_{tol:g}"] = counts["n"]
    finally:
        w._NonmetricWeights.iterate = orig
    return res


out["iterations"] = rec.run("a.iterations_and_convergence", _iterations)

# ------------------------------------------------------- b. accessors + self-consistency, per scheme
SCHEMES = {"path": Scheme.PATH, "centroid": Scheme.CENTROID, "factorial": Scheme.FACTORIAL}
fits: dict[str, Plspm] = {}


def describe_accessors(p: Plspm) -> dict:
    res = {}
    for name in ["inner_model", "path_coefficients", "outer_model", "inner_summary", "unidimensionality",
                 "effects", "crossloadings", "scores"]:
        v = getattr(p, name)()
        res[name] = {"columns": [str(x) for x in v.columns], "index_head": [str(x) for x in list(v.index)[:6]],
                     "shape": list(v.shape)}
    res["goodness_of_fit"] = {"type": type(p.goodness_of_fit()).__name__}
    try:
        p.bootstrap()
        res["bootstrap_without_request"] = "returned"
    except Exception as e:  # noqa: BLE001
        res["bootstrap_without_request"] = f"{type(e).__name__}: {e}"
    return res


def self_consistency(p: Plspm) -> dict:
    sc = p.scores()[LVS]
    X = sc.to_numpy()
    n = len(sc)
    pc = p.path_coefficients()
    ins = p.inner_summary()
    om = p.outer_model()
    uni = p.unidimensionality()
    res: dict = {}
    # scores standardised (population variance 1)
    res["scores_mean_maxabs"] = float(np.abs(X.mean(axis=0)).max())
    res["scores_var_ddof0_range"] = [float(X.var(axis=0, ddof=0).min()), float(X.var(axis=0, ddof=0).max())]
    # paths == OLS (numpy lstsq, with intercept) on plspm's own scores; R2 from residuals
    worst_b, worst_r2, worst_r2adj = 0.0, 0.0, 0.0
    for e in TAM_ENDOGENOUS:
        preds = [a for a, b in TAM_PATHS if b == e]
        A = np.column_stack([np.ones(n), sc[preds].to_numpy()])
        beta, *_ = np.linalg.lstsq(A, sc[e].to_numpy(), rcond=None)
        worst_b = max(worst_b, max_abs_diff(beta[1:], [pc.loc[e, a] for a in preds]))
        resid = sc[e].to_numpy() - A @ beta
        r2 = 1 - resid.var() / sc[e].var(ddof=0)
        worst_r2 = max(worst_r2, abs(r2 - ins.loc[e, "r_squared"]))
        r2adj = 1 - (1 - r2) * (n - 1) / (n - len(preds) - 1)
        worst_r2adj = max(worst_r2adj, abs(r2adj - ins.loc[e, "r_squared_adj"]))
    res["paths_vs_numpy_ols_on_scores"] = worst_b
    res["r2_vs_numpy_residuals"] = worst_r2
    res["r2adj_vs_hand"] = worst_r2adj
    # loadings == corr(indicator, own score); communality, redundancy, AVE, GoF by hand
    mvs = [m for lv in LVS for m in TAM_BLOCKS[lv]]
    own = {m: lv for lv in LVS for m in TAM_BLOCKS[lv]}
    load_hand = np.array([np.corrcoef(df[m], sc[own[m]])[0, 1] for m in mvs])
    res["loadings_vs_corr_raw_indicator_score"] = max_abs_diff(om.loc[mvs, "loading"], load_hand)
    res["communality_vs_loading_sq"] = max_abs_diff(om.loc[mvs, "communality"], load_hand**2)
    r2_full = ins["r_squared"]
    res["redundancy_vs_comm_x_r2"] = max_abs_diff(
        om.loc[mvs, "redundancy"], [load_hand[i] ** 2 * r2_full[own[m]] for i, m in enumerate(mvs)]
    )
    ave_hand = {lv: float(np.mean(om.loc[TAM_BLOCKS[lv], "loading"] ** 2)) for lv in LVS}
    res["ave_vs_mean_loading_sq"] = max_abs_diff([ins.loc[lv, "ave"] for lv in LVS], [ave_hand[lv] for lv in LVS])
    mean_comm = np.mean(load_hand**2)  # all blocks have > 1 indicator: weighted mean = plain mean over indicators
    gof_hand = np.sqrt(mean_comm * np.mean([ins.loc[e, "r_squared"] for e in TAM_ENDOGENOUS]))
    res["gof_vs_hand"] = abs(gof_hand - p.goodness_of_fit())
    # crossloadings: own-block entries equal loadings
    cl = p.crossloadings()
    res["crossloadings_own_vs_loadings"] = max_abs_diff([cl.loc[m, own[m]] for m in mvs], load_hand)
    # Cronbach alpha: plspm's value equals the STANDARDISED alpha (from the correlation matrix)
    alpha_std, alpha_raw, dg_pca, rhoc_pls = {}, {}, {}, {}
    for lv in LVS:
        B = df[TAM_BLOCKS[lv]]
        k = B.shape[1]
        R = B.corr().to_numpy()
        rbar = (R.sum() - k) / (k * (k - 1))
        alpha_std[lv] = k * rbar / (1 + (k - 1) * rbar)
        C = B.cov().to_numpy()
        alpha_raw[lv] = k / (k - 1) * (1 - np.trace(C) / C.sum())
        # Dillon-Goldstein rho as plspm defines it: loadings on the FIRST PRINCIPAL COMPONENT of the block
        evals, evecs = np.linalg.eigh(R)
        l_pc = np.abs(evecs[:, -1]) * np.sqrt(evals[-1])
        dg_pca[lv] = l_pc.sum() ** 2 / (l_pc.sum() ** 2 + (k - (l_pc**2).sum()))
        lp = om.loc[TAM_BLOCKS[lv], "loading"].to_numpy()
        rhoc_pls[lv] = lp.sum() ** 2 / (lp.sum() ** 2 + (1 - lp**2).sum())
    res["cronbach_alpha_vs_standardised_alpha"] = max_abs_diff(uni.loc[LVS, "cronbach_alpha"], [alpha_std[x] for x in LVS])
    res["cronbach_alpha_vs_raw_alpha"] = max_abs_diff(uni.loc[LVS, "cronbach_alpha"], [alpha_raw[x] for x in LVS])
    res["dg_rho_vs_first_pc_formula"] = max_abs_diff(uni.loc[LVS, "dillon_goldstein_rho"], [dg_pca[x] for x in LVS])
    res["dg_rho_vs_rhoC_from_pls_loadings"] = max_abs_diff(
        uni.loc[LVS, "dillon_goldstein_rho"], [rhoc_pls[x] for x in LVS]
    )
    res["eig_1st_vs_corr_eigen"] = max_abs_diff(
        uni.loc[LVS, "eig_1st"], [np.linalg.eigvalsh(df[TAM_BLOCKS[x]].corr())[-1] for x in LVS]
    )
    # effects: total = direct + indirect, and total == (I - B)^-1 - I computed independently
    eff = p.effects()
    res["effects_total_minus_direct_minus_indirect"] = float((eff["total"] - eff["direct"] - eff["indirect"]).abs().max())
    Bm = pc.loc[LVS, LVS].to_numpy(float)  # row = to, col = from
    T = np.linalg.inv(np.eye(len(LVS)) - Bm) - np.eye(len(LVS))
    idx = {lv: i for i, lv in enumerate(LVS)}
    res["effects_total_vs_inverse_formula"] = float(
        max(abs(r["total"] - T[idx[r["to"]], idx[r["from"]]]) for _, r in eff.iterrows())
    )
    nonzero_T = int((np.abs(T) > 0).sum())
    res["effects_rows_vs_nonzero_total_effects"] = [int(len(eff)), nonzero_T]
    res["effects_rows"] = int(len(eff))
    # inner_model: OLS t statistics, NOT bootstrap
    im = p.inner_model()
    res["inner_model_t_equals_est_over_se"] = float((im["t"] - im["estimate"] / im["std error"]).abs().max())
    return {"diffs": res, "alpha_std": alpha_std, "alpha_raw": alpha_raw, "rhoC_from_pls_loadings": rhoc_pls}


consistency = {}
ref_diffs = {}
for sname, scheme in SCHEMES.items():
    fits[sname] = rec.run(f"b.fit.NUM.{sname}", lambda scheme=scheme: fit(scheme=scheme, default_scale=Scale.NUM))
    if fits[sname] is None:
        continue
    ref_diffs[sname] = rec.run(f"b.ref_pls.NUM.{sname}", lambda s=sname: compare_to_ref(fits[s], ref(s)))
    consistency[sname] = rec.run(f"b.self_consistency.NUM.{sname}", lambda s=sname: self_consistency(fits[s]))
out["accessors"] = rec.run("b.accessors", lambda: describe_accessors(fits["path"]))
out["refPLS_maxAbsDiff"] = ref_diffs
out["self_consistency"] = consistency


def _sign():
    """Weights are NOT sign-corrected together with scores in the metric route (source: weights.py)."""
    src = inspect.getsource(__import__("plspm.weights", fromlist=["x"])._MetricWeights.calculate)
    return {"metric_flips_scores_only": "scores = scores.dot(w_sign_matrix)" in src and "weights.dot(w_sign" not in src,
            "nonmetric_has_sign_correction": "sign" in inspect.getsource(
                __import__("plspm.weights", fromlist=["x"])._NonmetricWeights.calculate)}


out["sign_handling_source"] = rec.run("b.sign_handling_source", _sign)

# ------------------------------------------------------------------------------- c. Mode B / mixed
modeB = {}
for label, modes in {"mixed_PEOU_B": {"PEOU": "B"}, "all_B": {lv: "B" for lv in LVS}}.items():
    for route, kw in {"NUM": {"default_scale": Scale.NUM}, "metric_prestd": {"scaled": False}}.items():
        def _mb(modes=modes, route=route, kw=kw):
            data = (df - df.mean()) / df.std(ddof=0) if route == "metric_prestd" else df
            p = fit(data=data, modes=modes, **kw)
            r = ref("path", modes)
            uni = p.unidimensionality()
            return {
                "paths": paths_of(p),
                "maxAbsDiffVsRefPLS": compare_to_ref(p, r),
                "ave_for_B_blocks": {lv: p.inner_summary().loc[lv, "ave"] for lv, m in modes.items() if m == "B"},
                "alpha_for_B_blocks": {lv: uni.loc[lv, "cronbach_alpha"] for lv, m in modes.items() if m == "B"},
            }

        modeB[f"{label}.{route}"] = rec.run(f"c.modeB.{label}.{route}", _mb)
out["modeB"] = modeB

# --------------------------------------------------------------------------- f. missing / bad input
def _missing_metric():
    d = inject_missing(df)
    p = fit(data=d, scaled=False)
    # independent: plspm says it mean-imputes metric data; impute by hand, standardise per column, use ref_pls
    imp = d.fillna(d.mean())
    p_imp = fit(data=imp, scaled=False)
    return {"n_scores": len(p.scores()), "n_missing_cells": int(d.isna().sum().sum()),
            "paths": paths_of(p), "maxAbsDiff_vs_hand_mean_imputed_fit": max_abs_diff(
                list(paths_of(p).values()), list(paths_of(p_imp).values())),
            "unidimensionality_nan_blocks": [lv for lv in LVS if pd.isna(p.unidimensionality().loc[lv, "cronbach_alpha"])]}


def _missing_num():
    d = inject_missing(df)
    p = fit(data=d, default_scale=Scale.NUM)
    imp = d.fillna(d.mean())
    p_imp = fit(data=imp, default_scale=Scale.NUM)
    return {"n_scores": len(p.scores()), "paths": paths_of(p),
            "maxAbsDiff_vs_mean_imputed_NUM_fit": max_abs_diff(list(paths_of(p).values()), list(paths_of(p_imp).values())),
            "maxAbsDiff_vs_complete_data_NUM_fit": max_abs_diff(list(paths_of(p).values()),
                                                                list(paths_of(fits["path"]).values())),
            "unidimensionality_nan_blocks": [lv for lv in LVS if pd.isna(p.unidimensionality().loc[lv, "cronbach_alpha"])]}


def _missing_whole_block():
    d = df.copy()
    d.loc[d.index[:3], TAM_BLOCKS["PU"]] = np.nan
    return {"rows_in": len(d), "rows_scored_metric": len(fit(data=d, scaled=False).scores()),
            "rows_scored_NUM": len(fit(data=d, default_scale=Scale.NUM).scores())}


out["missing"] = {
    "metric_mean_imputation": rec.run("f.missing.metric", _missing_metric),
    "NUM_available_case": rec.run("f.missing.NUM", _missing_num),
    "whole_block_missing_rows": rec.run("f.missing.whole_block_rows", _missing_whole_block),
    "NUM_modeB_with_missing": rec.run(
        "f.missing.NUM.modeB", lambda: paths_of(fit(data=inject_missing(df), default_scale=Scale.NUM, modes={"PEOU": "B"}))
    ),
    "metric_modeB_with_missing": rec.run(
        "f.missing.metric.modeB", lambda: paths_of(fit(data=inject_missing(df), scaled=False, modes={"PEOU": "B"}))
    ),
}


def _bad(kind):
    d = df.copy()
    if kind == "string_column":
        d["USEF1"] = d["USEF1"].astype(str)
    elif kind == "string_cell":
        d["USEF1"] = d["USEF1"].astype(object)
        d.iat[0, 0] = "n/a"
    elif kind == "inf_cell":
        d.iat[0, 0] = np.inf
    elif kind == "constant_column":
        d["USEF1"] = 4.0
    elif kind == "missing_column":
        d = d.drop(columns=["USEF1"])
    res = {}
    for route, kw in {"metric": {"scaled": False}, "NUM": {"default_scale": Scale.NUM}}.items():
        try:
            p = fit(data=d, **kw)
            pv = paths_of(p)
            res[route] = {"ran": True, "all_paths_finite": bool(np.isfinite(list(pv.values())).all()), "paths": pv}
        except Exception as e:  # noqa: BLE001
            res[route] = {"ran": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}
    return res


out["bad_input"] = {k: rec.run(f"f.bad_input.{k}", lambda k=k: _bad(k))
                    for k in ["string_column", "string_cell", "inf_cell", "constant_column", "missing_column"]}

# ------------------------------------------------------------------- higher-order (present, smoke)
def _hoc():
    s = c.Structure()
    s.add_path(["BELIEFS"], ["BI"])
    s.add_path(["BI"], ["USE"])
    cfg = c.Config(s.path(), default_scale=Scale.NUM)
    cfg.add_higher_order("BELIEFS", Mode.A, ["PU", "PEOU"])
    for lv in ["PU", "PEOU", "BI", "USE"]:
        cfg.add_lv(lv, Mode.A, *[c.MV(m) for m in TAM_BLOCKS[lv]])
    p = Plspm(df, cfg, Scheme.PATH, MAX_IT, TOL)
    return {"paths": {"BELIEFS->BI": float(p.path_coefficients().loc["BI", "BELIEFS"]),
                      "BI->USE": float(p.path_coefficients().loc["USE", "BI"])},
            "outer_model_index": [str(i) for i in p.outer_model().index],
            "method_note": "two-stage: first-stage scores of PU and PEOU become the MVs of BELIEFS (estimator.py)"}


out["higher_order"] = rec.run("g.higher_order.two_stage.smoke", _hoc)

# ------------------------------------------------------------------ g. absence search in source
PKG_DIR = Path(plspm.__file__).parent
PATTERNS = {
    "PLSc / consistent PLS": r"plsc|consistent|disattenuat",
    "HTMT / HTMT2": r"htmt|heterotrait",
    "Fornell-Larcker": r"fornell|larcker",
    "f-squared effect size": r"f2\b|f_?sq|f\^2|effect.?size",
    "VIF": r"\bvif\b|variance.?inflation",
    "rho_A": r"rho_?a\b|rhoa|dijkstra",
    "SRMR": r"srmr|standardi[sz]ed root",
    "IPMA": r"ipma|importance|performance",
    "PLSpredict / Q2": r"plspredict|predict|q\^2|q2|blindfold|stone|geisser",
    "MGA / MICOM / permutation": r"\bmga\b|multi.?group|micom|permutation|invariance",
    "higher-order constructs": r"higher.?order|hoc",
    "moderation / interaction helpers": r"moderat|interaction|product.?indicator|two.?stage",
    "random seed argument": r"seed|random_state|default_rng|RandomState",
}


def _absence():
    files = sorted(PKG_DIR.glob("*.py"))
    res = {}
    for feature, pat in PATTERNS.items():
        hits = []
        rx = re.compile(pat, re.IGNORECASE)
        for f in files:
            for i, line in enumerate(f.read_text().splitlines(), 1):
                if rx.search(line):
                    hits.append(f"{f.name}:{i}: {line.strip()[:120]}")
        res[feature] = {"pattern": pat, "hits": hits}
    res["files_searched"] = [f.name for f in files]
    return res


out["absence_search"] = rec.run("g.absence_search", _absence)

# ------------------------------------------------------------------------ environment facts
def _meta(pkg):
    m = md.metadata(pkg)
    return {"version": md.version(pkg), "license_field": m.get("License"), "license_expression": m.get("License-Expression"),
            "license_classifiers": [x for x in m.get_all("Classifier") or [] if x.startswith("License")],
            "home_page": m.get("Home-page"), "requires_python": m.get("Requires-Python"),
            "not_official_google_statement": ("not an officially supported Google product" in (m.get_payload() or ""))
            if pkg == "plspm" else None}


out["package_metadata"] = {p: _meta(p) for p in ["plspm", "semopy", "numpy", "pandas", "scipy", "statsmodels",
                                                  "scikit-learn", "sympy", "numdifftools"]}

# ------------------------------------------------------------------------------- parity files
def parity(sname: str) -> dict:
    p = fits[sname]
    om = p.outer_model()
    ins = p.inner_summary()
    uni = p.unidimensionality()
    sc = p.scores()[LVS]
    cons = consistency[sname]
    return {
        "model": "tam-v1",
        "engine": "plspm",
        "engineVersion": md.version("plspm"),
        "variant": f"pls-modeA-{sname}",
        "options": {
            "Config": {"path": "Structure().add_path([from],[to]) for each tam-v1 path", "scaled": True,
                       "default_scale": "Scale.NUM"},
            "add_lv": {lv: {"mode": "Mode.A", "mvs": TAM_BLOCKS[lv]} for lv in LVS},
            "Plspm": {"scheme": f"Scheme.{SCHEMES[sname].name}", "iterations": MAX_IT, "tolerance": TOL,
                      "bootstrap": False},
            "dataTreatment": "default_scale=Scale.NUM: each indicator centred and divided by its own SD so that "
                             "population variance = 1 (Config.scaled is ignored on this route)",
        },
        "n": int(len(sc)),
        "paths": [{"from": a, "to": b, "est": float(p.path_coefficients().loc[b, a])} for a, b in TAM_PATHS],
        "loadings": [{"construct": lv, "indicator": m, "est": float(om.loc[m, "loading"])} for lv in LVS
                     for m in TAM_BLOCKS[lv]],
        "weights": [{"construct": lv, "indicator": m, "est": float(om.loc[m, "weight"])} for lv in LVS
                    for m in TAM_BLOCKS[lv]],
        "r2": {e: float(ins.loc[e, "r_squared"]) for e in TAM_ENDOGENOUS},
        "extra": {
            "r2adj": {e: float(ins.loc[e, "r_squared_adj"]) for e in TAM_ENDOGENOUS},
            "weightNormalisation": "composite scores have population variance 1 (ddof=0) on per-indicator "
                                   "standardised data; equivalently w'Rw = 1 with R the indicator correlation matrix",
            "convergenceCriterion": "NUM route: sum over all n*k score cells of (|Y_old|-|Y_new|)^2 < tolerance",
            "constructCorrelations": {a: {b: float(sc[a].corr(sc[b])) for b in LVS} for a in LVS},
            "ave": {lv: float(ins.loc[lv, "ave"]) for lv in LVS},
            "blockCommunality": {lv: float(ins.loc[lv, "block_communality"]) for lv in LVS},
            "meanRedundancy": {lv: float(ins.loc[lv, "mean_redundancy"]) for lv in LVS},
            "cronbachAlpha": {lv: float(uni.loc[lv, "cronbach_alpha"]) for lv in LVS},
            "cronbachAlphaDefinition": "standardised alpha (from the indicator correlation matrix)",
            "dillonGoldsteinRho": {lv: float(uni.loc[lv, "dillon_goldstein_rho"]) for lv in LVS},
            "dillonGoldsteinRhoDefinition": "computed from loadings on the block's FIRST PRINCIPAL COMPONENT, "
                                            "not from PLS loadings; NOT comparable to cSEM rhoC",
            "rhoC_fromPlsLoadings_computedBySpike": cons["rhoC_from_pls_loadings"],
            "eig1st": {lv: float(uni.loc[lv, "eig_1st"]) for lv in LVS},
            "eig2nd": {lv: float(uni.loc[lv, "eig_2nd"]) for lv in LVS},
            "goodnessOfFit": float(p.goodness_of_fit()),
            "effects": [{"from": r["from"], "to": r["to"], "direct": float(r["direct"]), "indirect": float(r["indirect"]),
                         "total": float(r["total"])} for _, r in p.effects().iterrows()],
            "independentReferenceMaxAbsDiff": ref_diffs[sname],
        },
    }


for sname in SCHEMES:
    if fits.get(sname) is not None and consistency.get(sname) and ref_diffs.get(sname):
        dump_json(EVIDENCE_DIR / f"parity_plspm_pls-modeA-{sname}.json", parity(sname))

out["failed_checks"] = [k for k, v in rec.results.items() if not v["ok"]]
dump_json(EVIDENCE_DIR / "plspm_probe.json", out)
