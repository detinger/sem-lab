"""Phase 0 spike: what semopy 2.3.11 can and cannot do, established by execution on tam-v1.

Run:    cd apps/api && uv run python spike/semopy_probe.py              (driver: every feature, own process)
        cd apps/api && uv run python spike/semopy_probe.py --only NAME [--rows 200]   (one feature, JSON on stdout)
Writes: docs/validation/phase-0/evidence/python/semopy_probe.json
        docs/validation/phase-0/evidence/python/parity_semopy_{sem-mlw,cfa-mlw}.json

Each feature runs in its own subprocess with a hard timeout (FEATURE_TIMEOUT_S), so one slow or hung
semopy call cannot block the rest. A feature that times out is recorded as failed with the exact call and
retried once on the first 200 rows, to tell "slow" from "hung".

Independent checks used here (none of them calls semopy's own objective, gradient, SE or index code):
  * model-implied Sigma = Lambda (I-B)^-1 Psi (I-B)^-T Lambda' + Theta rebuilt by hand from the
    estimated matrices; the ML discrepancy F_ML recomputed from it and from S;
  * standard errors from the expected information (N/2) tr(Sigma^-1 dSigma_i Sigma^-1 dSigma_j), with
    dSigma by central differences of the hand-built Sigma; and from a central-difference Hessian of the
    hand-written F_ML (observed information);
  * standardised estimates from model-implied latent / indicator variances;
  * fit indices recomputed from their textbook formulas, with an independently computed
    independence-model chi-square;
  * FIML on complete data vs ML (they share the minimiser).
"""

from __future__ import annotations

import argparse
import copy
import importlib.metadata as md
import inspect
import json
import logging
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import semopy
from _common import (
    EVIDENCE_DIR,
    TAM_BLOCKS,
    TAM_ENDOGENOUS,
    TAM_PATHS,
    Recorder,
    clean,
    dump_json,
    inject_missing,
    load_tam,
    max_abs_diff,
    versions,
)
from scipy import stats

FEATURE_TIMEOUT_S = 150
SUBSET_ROWS = 200

logging.getLogger().setLevel(logging.ERROR)
LVS = list(TAM_BLOCKS)
MEAS = "\n".join(f"{lv} =~ " + " + ".join(mvs) for lv, mvs in TAM_BLOCKS.items())
STRUCT = "\n".join(f"{b} ~ " + " + ".join(a for a, bb in TAM_PATHS if bb == b) for b in TAM_ENDOGENOUS)
DESC = {"cfa": MEAS, "sem": MEAS + "\n" + STRUCT}

df: pd.DataFrame = load_tam()
N = len(df)


def set_rows(n: int | None) -> None:
    global df, N
    if n:
        df = load_tam().iloc[:n].reset_index(drop=True)
        N = len(df)


# ------------------------------------------------------------------------------- hand algebra
def mats(m):
    return m.mx_lambda, m.mx_beta, m.mx_psi, m.mx_theta


def sigma_hand(m) -> np.ndarray:
    L, B, P, T = mats(m)
    C = np.linalg.inv(np.eye(B.shape[0]) - B)
    return L @ C @ P @ C.T @ L.T + T


def sample_cov(m) -> np.ndarray:
    return df[m.vars["observed"]].cov(ddof=0).to_numpy()


def fml_hand(S, Sig) -> float:
    p = S.shape[0]
    return float(np.trace(S @ np.linalg.inv(Sig)) + np.linalg.slogdet(Sig)[1] - np.linalg.slogdet(S)[1] - p)


def active_param_keys(m) -> list[tuple[str, str, str]]:
    """(lval, op, rval) for each active parameter, in param_vals order, located through matrix identity."""
    keys = []
    L, B, P, T = mats(m)
    for name, prm in m.parameters.items():
        if not prm.active:
            continue
        loc = prm.locations[0]
        i, j = loc.indices
        for mx, names, op in [(L, m.names_lambda, "~"), (B, m.names_beta, "~"), (P, m.names_psi, "~~"),
                              (T, m.names_theta, "~~")]:
            if loc.matrix is mx:
                keys.append((names[0][i], op, names[1][j]))
                break
        else:
            keys.append((name, "?", "?"))
    return keys


def lookup(ins: pd.DataFrame, key, col):
    lv, op, rv = key
    hit = ins[(ins.lval == lv) & (ins.op == op) & (ins.rval == rv)]
    if hit.empty and op == "~~":
        hit = ins[(ins.lval == rv) & (ins.op == op) & (ins.rval == lv)]
    return float(hit.iloc[0][col])


def fitted(kind: str, obj: str = "MLW", data=None, **kw):
    m = semopy.Model(DESC[kind])
    r = m.fit(df if data is None else data, obj=obj, **kw)
    return m, r


_MODELS: dict = {}


def model(kind: str):
    if kind not in _MODELS:
        _MODELS[kind] = fitted(kind)
    return _MODELS[kind]


def result_info(r) -> dict:
    return {"success": bool(r.success), "fun": float(r.fun), "n_it": int(r.n_it), "message": str(r.message),
            "name_method": r.name_method, "name_obj": r.name_obj, "n_params": int(len(r.x))}


def fd_hessian(f, x0, h=1e-4):
    k = len(x0)
    H = np.empty((k, k))
    f0 = f(x0)
    for i in range(k):
        for j in range(i, k):
            if i == j:
                xp, xm = x0.copy(), x0.copy()
                xp[i] += h
                xm[i] -= h
                H[i, i] = (f(xp) - 2 * f0 + f(xm)) / h**2
            else:
                v = []
                for si, sj in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
                    x = x0.copy()
                    x[i] += si * h
                    x[j] += sj * h
                    v.append(f(x))
                H[i, j] = H[j, i] = (v[0] - v[1] - v[2] + v[3]) / (4 * h * h)
    return H


# ============================================================================== features
FEATURES: dict = {}


def feature(name):
    def deco(fn):
        FEATURES[name] = fn
        return fn

    return deco


@feature("api")
def _api():
    return {
        "Model.__init__": str(inspect.signature(semopy.Model.__init__)),
        "Model.fit": str(inspect.signature(semopy.Model.fit)),
        "Model.inspect": str(inspect.signature(semopy.Model.inspect)),
        "ModelMeans.fit": str(inspect.signature(semopy.ModelMeans.fit)),
        "Model.predict_factors": str(inspect.signature(semopy.Model.predict_factors)),
        "calc_stats": str(inspect.signature(semopy.calc_stats)),
        "bias_correction": str(inspect.signature(semopy.bias_correction)),
        "semplot": str(inspect.signature(semopy.semplot)),
        "Model.objectives_keys": list(semopy.Model(DESC["cfa"]).objectives),
        "ModelMeans.objectives_keys": list(semopy.ModelMeans(DESC["cfa"]).objectives),
        "SolverResult_fields": list(semopy.solver.SolverResult.__dataclass_fields__),
        "top_level_names": sorted(n for n in dir(semopy) if not n.startswith("_")),
        "descriptions": DESC,
    }


# -------------------------------------------------------------------------- h. objectives
for _kind in ["cfa", "sem"]:
    for _obj in ["MLW", "ULS", "GLS", "WLS", "DWLS", "FIML", "ML", "REML"]:
        def _o(kind=_kind, obj=_obj):
            t0 = time.perf_counter()
            r = fitted(kind, obj)[1]
            return result_info(r) | {"seconds": time.perf_counter() - t0}

        FEATURES[f"objective.{_kind}.{_obj}"] = _o


def _mlw_definition(kind):
    m, r = model(kind)
    S0 = sample_cov(m)
    S1 = df[m.vars["observed"]].cov(ddof=1).to_numpy()
    Sig = sigma_hand(m)
    resid = S0 - Sig
    sd = np.sqrt(np.diag(S0))
    return {
        "sample_cov_vs_ddof0_N": max_abs_diff(m.mx_cov, S0),
        "sample_cov_vs_ddof1_N-1": max_abs_diff(m.mx_cov, S1),
        "sigma_semopy_vs_hand": max_abs_diff(m.calc_sigma()[0], Sig),
        "fun_vs_hand_FML": abs(r.fun - fml_hand(S0, Sig)),
        "max_abs_cov_residual": float(np.abs(resid).max()),
        "max_abs_corr_residual": float(np.abs(resid / np.outer(sd, sd)).max()),
        "srmr_hand_lavaan_style": float(np.sqrt(np.mean((resid / np.outer(sd, sd))[np.tril_indices_from(S0)] ** 2))),
    }


for _kind in ["cfa", "sem"]:
    FEATURES[f"mlw_definition.{_kind}"] = lambda kind=_kind: _mlw_definition(kind)


@feature("fiml_identity.Model.raw")
def _fiml_raw():
    m, r = fitted("cfa", "FIML", data=df)
    return {"maxAbsDiff_params_vs_MLW": max_abs_diff(m.param_vals, model("cfa")[0].param_vals)} | result_info(r)


@feature("fiml_identity.Model.centred")
def _fiml_centred():
    m, r = fitted("cfa", "FIML", data=df - df.mean())
    return {"maxAbsDiff_params_vs_MLW": max_abs_diff(m.param_vals, model("cfa")[0].param_vals)} | result_info(r)


@feature("fiml_identity.ModelMeans.ML.raw")
def _fiml_means_ml():
    return _fiml_means("ML")


@feature("fiml_identity.ModelMeans.raw")
def _fiml_means(obj="FIML"):
    mm = semopy.ModelMeans(DESC["cfa"])
    r = mm.fit(df, obj=obj)
    ins, ins_ml = mm.inspect(), model("cfa")[0].inspect()
    loads = [(mv, lv) for lv in LVS for mv in TAM_BLOCKS[lv]]
    return result_info(r) | {
        "maxAbsDiff_loadings_vs_Model_MLW": max(abs(lookup(ins, (mv, "~", lv), "Estimate")
                                                    - lookup(ins_ml, (mv, "~", lv), "Estimate")) for mv, lv in loads),
        "intercepts_vs_sample_means_maxAbsDiff": max(abs(lookup(ins, (mv, "~", "1"), "Estimate") - df[mv].mean())
                                                     for mv, _ in loads),
    }


for _solver in ["SLSQP", "L-BFGS-B", "trust-constr"]:
    def _s(solver=_solver):
        t0 = time.perf_counter()
        m, r = fitted("sem", solver=solver)
        return result_info(r) | {"seconds": time.perf_counter() - t0,
                                 "maxAbsDiff_params_vs_SLSQP": max_abs_diff(m.param_vals, model("sem")[0].param_vals)}

    FEATURES[f"solver.{_solver}"] = _s


# ---------------------------------------------------------------------------- i. inspect
def _inspect_expected(kind):
    m, _ = model(kind)
    t0 = time.perf_counter()
    ins = m.inspect()
    secs = time.perf_counter() - t0
    keys = active_param_keys(m)
    est = np.array([lookup(ins, k, "Estimate") for k in keys])
    se = np.array([lookup(ins, k, "Std. Err") for k in keys])
    z = np.array([lookup(ins, k, "z-value") for k in keys])
    pv = np.array([lookup(ins, k, "p-value") for k in keys])
    res = {"columns": list(ins.columns), "rows": int(len(ins)), "ops": sorted(ins.op.unique()), "seconds": secs,
           "fixed_marker_se_cell": str(ins.iloc[0]["Std. Err"]), "se_dtype": str(ins["Std. Err"].dtype),
           "param_vals_vs_inspect_estimate": max_abs_diff(est, m.param_vals),
           "z_vs_est_over_se": max_abs_diff(z, est / se),
           "p_vs_two_sided_normal": max_abs_diff(pv, 2 * stats.norm.sf(np.abs(z)))}
    x0 = m.param_vals.copy()

    def sig_at(x):
        m.update_matrices(x)
        return sigma_hand(m)

    h = 1e-6
    dS = []
    for i in range(len(x0)):
        xp, xm = x0.copy(), x0.copy()
        xp[i] += h
        xm[i] -= h
        dS.append((sig_at(xp) - sig_at(xm)) / (2 * h))
    m.update_matrices(x0)
    Si = np.linalg.inv(sigma_hand(m))
    k = len(x0)
    I_exp = np.empty((k, k))
    for i in range(k):
        A = Si @ dS[i] @ Si
        for j in range(k):
            I_exp[i, j] = 0.5 * N * np.einsum("ij,ji->", A, dS[j])
    se_exp = np.sqrt(np.diag(np.linalg.inv(I_exp)))
    res["se_expected_vs_hand_fisher_N_rel"] = float(np.max(np.abs(se / se_exp - 1)))
    res["se_expected_vs_hand_fisher_N-1_rel"] = float(np.max(np.abs(se / (se_exp * np.sqrt(N / (N - 1))) - 1)))
    res["confidence_interval_columns"] = [c for c in ins.columns if re.search(r"ci|conf|lower|upper", c, re.I)]
    return res


def _inspect_observed(kind):
    m, _ = model(kind)
    keys = active_param_keys(m)
    x0 = m.param_vals.copy()
    S0 = sample_cov(m)

    def f(x):
        m.update_matrices(x)
        return fml_hand(S0, sigma_hand(m))

    H = fd_hessian(f, x0)
    m.update_matrices(x0)
    se_hand = np.sqrt(np.diag(np.linalg.inv(0.5 * N * H)))
    t0 = time.perf_counter()
    ins_obs = m.inspect(information="observed")
    secs = time.perf_counter() - t0
    se_obs = np.array([lookup(ins_obs, k, "Std. Err") for k in keys])
    se_exp = np.array([lookup(m.inspect(), k, "Std. Err") for k in keys])
    return {"seconds_semopy_observed": secs,
            "se_observed_vs_hand_fd_hessian_rel": float(np.max(np.abs(se_obs / se_hand - 1))),
            "se_observed_vs_expected_rel_max": float(np.max(np.abs(se_obs / se_exp - 1)))}


def _inspect_robust(kind):
    m, _ = model(kind)
    keys = active_param_keys(m)
    t0 = time.perf_counter()
    ins_rob = m.inspect(se_robust=True)
    secs = time.perf_counter() - t0
    ins = m.inspect()
    se_rob = np.array([lookup(ins_rob, k, "Std. Err") for k in keys])
    se = np.array([lookup(ins, k, "Std. Err") for k in keys])
    return {"seconds": secs, "se_robust_vs_expected_rel_max": float(np.max(np.abs(se_rob / se - 1))),
            "se_robust_vs_expected_rel_median": float(np.median(np.abs(se_rob / se - 1))),
            "estimates_unchanged": max_abs_diff([lookup(ins_rob, k, "Estimate") for k in keys],
                                                [lookup(ins, k, "Estimate") for k in keys])}


def _inspect_std(kind):
    m, _ = model(kind)
    ins_std = m.inspect(std_est=True)
    L, B, P, T = mats(m)
    C = np.linalg.inv(np.eye(B.shape[0]) - B)
    sd_eta = pd.Series(np.sqrt(np.diag(C @ P @ C.T)), index=m.names_beta[0])
    sd_x = pd.Series(np.sqrt(np.diag(sigma_hand(m))), index=m.names_lambda[0])
    worst = 0.0
    for _, row in ins_std.iterrows():
        if row.op != "~":
            continue
        den = sd_x[row.lval] if row.lval in sd_x.index else sd_eta[row.lval]
        worst = max(worst, abs(row.Estimate * sd_eta[row.rval] / den - row["Est. Std"]))
    return {"std_est_vs_hand": worst, "columns": list(ins_std.columns)}


for _kind in ["cfa", "sem"]:
    FEATURES[f"inspect.expected.{_kind}"] = lambda kind=_kind: _inspect_expected(kind)
    FEATURES[f"inspect.observed.{_kind}"] = lambda kind=_kind: _inspect_observed(kind)
    FEATURES[f"inspect.robust.{_kind}"] = lambda kind=_kind: _inspect_robust(kind)
    FEATURES[f"inspect.std.{_kind}"] = lambda kind=_kind: _inspect_std(kind)


# -------------------------------------------------------------------------- j. calc_stats
def _stats(kind):
    m, r = model(kind)
    t0 = time.perf_counter()
    st = semopy.calc_stats(m).T["Value"]
    secs = time.perf_counter() - t0
    S0 = sample_cov(m)
    Sig = sigma_hand(m)
    p = S0.shape[0]
    k = len(m.param_vals)
    dof = p * (p + 1) / 2 - k
    chi2 = N * fml_hand(S0, Sig)
    chi2_b = float(N * (np.sum(np.log(np.diag(S0))) - np.linalg.slogdet(S0)[1]))
    dof_b = p * (p + 1) / 2 - p
    W = np.linalg.inv(Sig) @ S0
    true_gfi = 1 - np.trace((W - np.eye(p)) @ (W - np.eye(p))) / np.trace(W @ W)
    loglik = -0.5 * N * (p * np.log(2 * np.pi) + np.linalg.slogdet(Sig)[1] + np.trace(S0 @ np.linalg.inv(Sig)))
    hand = {"DoF": dof, "chi2": chi2, "chi2 Baseline": chi2_b, "DoF Baseline": dof_b,
            "chi2 p-value": float(stats.chi2.sf(chi2, dof)),
            "CFI": 1 - (chi2 - dof) / (chi2_b - dof_b),
            "TLI": ((chi2_b / dof_b) - (chi2 / dof)) / ((chi2_b / dof_b) - 1),
            "NFI": (chi2_b - chi2) / chi2_b,
            "RMSEA": np.sqrt((chi2 / dof - 1) / (N - 1))}
    return {
        "seconds": secs, "names": list(st.index), "values": {kk: float(v) for kk, v in st.items()}, "hand": hand,
        "diff_vs_hand": {kk: abs(float(st[kk]) - v) for kk, v in hand.items()},
        "RMSEA_if_divisor_N": float(np.sqrt((chi2 / dof - 1) / N)),
        "GFI_equals_NFI": abs(float(st["GFI"]) - float(st["NFI"])),
        "GFI_textbook_hand": float(true_gfi),
        "LogLik_equals_fun_FML": abs(float(st["LogLik"]) - r.fun),
        "AIC_equals_2k_minus_2fun": abs(float(st["AIC"]) - (2 * k - 2 * r.fun)),
        "BIC_equals_lnN_k_minus_2fun": abs(float(st["BIC"]) - (np.log(N) * k - 2 * r.fun)),
        "true_loglik_hand": float(loglik), "AIC_textbook_hand": float(-2 * loglik + 2 * k),
        "has_SRMR": any("srmr" in s.lower() for s in st.index),
        "has_RMSEA_CI": any(("rmsea" in s.lower() and s.lower() != "rmsea") for s in st.index),
        "srmr_hand": _mlw_definition(kind)["srmr_hand_lavaan_style"],
        "chi2_sb_function_exists": hasattr(semopy.stats, "calc_chi2_sb"),
    }


for _kind in ["cfa", "sem"]:
    FEATURES[f"calc_stats.{_kind}"] = lambda kind=_kind: _stats(kind)


# ------------------------------------------------------------- k. missing data / FIML / ordinal
for _label, _cls, _obj in [("Model.MLW", "Model", "MLW"), ("Model.FIML", "Model", "FIML"),
                           ("ModelMeans.ML", "ModelMeans", "ML"), ("ModelMeans.FIML", "ModelMeans", "FIML")]:
    def _miss(cls=_cls, obj=_obj):
        dmiss = inject_missing(df)
        m = getattr(semopy, cls)(DESC["cfa"])
        t0 = time.perf_counter()
        r = m.fit(dmiss, obj=obj)
        secs = time.perf_counter() - t0
        ins, ins_c = m.inspect(), model("cfa")[0].inspect()
        return result_info(r) | {
            "seconds": secs, "n_missing_cells": int(dmiss.isna().sum().sum()),
            "n_samples": int(getattr(m, "n_samples", -1)),
            "maxAbsDiff_loadings_vs_complete_MLW": max(
                abs(lookup(ins, (mv, "~", lv), "Estimate") - lookup(ins_c, (mv, "~", lv), "Estimate"))
                for lv in LVS for mv in TAM_BLOCKS[lv])}

    FEATURES[f"missing.{_label}"] = _miss


@feature("missing.Model.MLW.sample_cov")
def _miss_cov():
    dmiss = inject_missing(df)
    m = semopy.Model(DESC["cfa"])
    m.load(dmiss)
    obs = m.vars["observed"]
    X = dmiss[obs].to_numpy()
    # np.ma.cov(bias=True): per-variable means over each variable's own available rows, products over
    # pairwise-complete rows, divisor = pairwise count. Recompute by hand.
    k = len(obs)
    mu = np.nanmean(X, axis=0)
    C = np.empty((k, k))
    for i in range(k):
        for j in range(k):
            ok = ~np.isnan(X[:, i]) & ~np.isnan(X[:, j])
            C[i, j] = np.sum((X[ok, i] - mu[i]) * (X[ok, j] - mu[j])) / ok.sum()
    return {"sample_cov_vs_hand_pairwise": max_abs_diff(m.mx_cov, C), "n_samples": int(m.n_samples)}


ORD2 = "BI =~ BI1 + BI2 + BI3\nUSE =~ USE1 + USE2 + USE3\nDEFINE(ordinal) BI1 BI2 BI3 USE1 USE2 USE3"
ORD_ALL = MEAS + "\nDEFINE(ordinal) " + " ".join(sum(TAM_BLOCKS.values(), []))
for _label, _desc in [("cfa2_6items", ORD2), ("tam_cfa_22items", ORD_ALL)]:
    for _obj in ["DWLS", "MLW"]:
        def _ord(desc=_desc, obj=_obj):
            m = semopy.Model(desc)
            t0 = time.perf_counter()
            m.load(df)
            secs_cor = time.perf_counter() - t0
            r = m.fit(df, obj=obj)
            secs = time.perf_counter() - t0
            ins = m.inspect()
            pearson = df[m.vars["observed"]].corr().to_numpy()
            return result_info(r) | {
                "seconds_total": secs, "seconds_polychoric_load": secs_cor,
                "input_matrix_is_correlation": bool(np.allclose(np.diag(m.mx_cov), 1)),
                "mean_input_minus_pearson_offdiag": float(np.mean((m.mx_cov - pearson)[np.triu_indices_from(pearson, 1)])),
                "se_available": bool(pd.to_numeric(ins["Std. Err"], errors="coerce").notna().any())}

        FEATURES[f"ordinal.{_label}.{_obj}"] = _ord


@feature("bias_correction.seed")
def _bias_correction():
    vals = []
    t0 = time.perf_counter()
    for _ in range(2):
        m = copy.deepcopy(model("cfa")[0])
        np.random.seed(2026)
        semopy.bias_correction(m, n=5)
        vals.append(m.param_vals.copy())
    secs = (time.perf_counter() - t0) / 2
    m = copy.deepcopy(model("cfa")[0])
    np.random.seed(7)
    semopy.bias_correction(m, n=5)
    return {"seconds_per_call_n5": secs, "same_np_seed_maxAbsDiff": max_abs_diff(vals[0], vals[1]),
            "different_seed_maxAbsDiff": max_abs_diff(vals[0], m.param_vals),
            "changes_params_vs_mle": max_abs_diff(vals[0], model("cfa")[0].param_vals),
            "returns": "None (modifies model.param_vals in place)"}


@feature("predict_factors")
def _factor_scores():
    m, _ = model("cfa")
    F = m.predict_factors(df)
    L, B, P, T = mats(m)
    lat = m.names_lambda[1]
    Sig = sigma_hand(m)
    Xc = (df[m.names_lambda[0]] - df[m.names_lambda[0]].mean()).to_numpy()
    reg = Xc @ np.linalg.inv(Sig) @ L @ P
    bart = Xc @ np.linalg.inv(T) @ L @ np.linalg.inv(L.T @ np.linalg.inv(T) @ L)
    Fv = F[lat].to_numpy()
    return {"columns": list(F.columns), "shape": list(F.shape),
            "maxAbsDiff_vs_regression_scores": max_abs_diff(Fv, reg),
            "maxAbsDiff_vs_bartlett_scores": max_abs_diff(Fv, bart),
            "corr_with_regression_scores_min": float(min(np.corrcoef(Fv[:, i], reg[:, i])[0, 1] for i in range(len(lat))))}


@feature("semplot")
def _semplot():
    try:
        import graphviz  # noqa: F401

        has = True
    except ModuleNotFoundError:
        has = False
    try:
        semopy.semplot(model("sem")[0], "/nonexistent/x.png")
        call = "returned"
    except Exception as e:  # noqa: BLE001
        call = f"{type(e).__name__}: {str(e)[:200]}"
    return {"graphviz_python_package_importable": has, "semplot_call": call}


PATTERNS = {
    "modification indices": r"modification|mod_?ind|score.?test|lagrange",
    "SRMR": r"srmr",
    "RMSEA CI": r"rmsea.*(ci|interval|lower|upper)",
    "parameter CIs": r"conf(idence)?_?int|\bci\b",
    "nonparametric bootstrap": r"bootstrap",
    "Heywood / admissibility check": r"heywood|improper|negative variance|admissib",
    "random seed argument": r"random_state|default_rng|RandomState|\bseed\b",
}


@feature("absence_search")
def _absence():
    root = Path(semopy.__file__).parent
    files = [f for f in sorted(root.rglob("*.py")) if "/tests/" not in str(f)]
    res = {}
    for feat, pat in PATTERNS.items():
        rx = re.compile(pat, re.IGNORECASE)
        hits = [f"{f.relative_to(root)}:{i}: {ln.strip()[:110]}" for f in files
                for i, ln in enumerate(f.read_text().splitlines(), 1) if rx.search(ln)]
        res[feat] = {"pattern": pat, "hits": hits[:15], "n_hits": len(hits)}
    return res


# --------------------------------------------------------------- l. non-convergence / Heywood
@feature("nonconvergence.maxiter3")
def _nonconvergence():
    m = semopy.Model(DESC["sem"])
    r = m.fit(df, options={"maxiter": 3})
    return result_info(r) | {"raised": False}


@feature("heywood")
def _heywood():
    d = df.copy()
    rng = np.random.default_rng(1)
    d["BI1c"] = d["BI1"] + rng.normal(0, 0.05, len(d))
    m = semopy.Model("F =~ BI1 + BI1c + BI2\nG =~ USE1 + USE2 + USE3\nF ~~ G")
    r = m.fit(d)
    ins = m.inspect()
    var_rows = ins[(ins.op == "~~") & (ins.lval == ins.rval)]
    return result_info(r) | {
        "variances": {row.lval: float(row.Estimate) for _, row in var_rows.iterrows()},
        "min_variance": float(var_rows.Estimate.min()),
        "se_of_boundary_estimates": {row.lval: str(row["Std. Err"]) for _, row in var_rows.iterrows()
                                     if abs(row.Estimate) < 1e-6},
    }


@feature("heywood.just_identified_cov")
def _heywood_cov():
    """One factor, three indicators (just identified): r12=.9, r13=.9, r23=.5 imply lambda1^2 = .81/.5 = 1.62,
    i.e. error variance of x1 = 1 - 1.62 = -0.62 in the unconstrained ML solution. What does semopy return?"""
    names = ["x1", "x2", "x3"]
    S = pd.DataFrame([[1, .9, .9], [.9, 1, .5], [.9, .5, 1]], index=names, columns=names, dtype=float)
    m = semopy.Model("F =~ x1 + x2 + x3")
    r = m.fit(cov=S, n_samples=500)
    ins = m.inspect()
    var_rows = ins[(ins.op == "~~") & (ins.lval == ins.rval)]
    S_np = S.to_numpy()
    Sig = sigma_hand(m)
    return result_info(r) | {
        "unconstrained_theta_x1_hand": 1 - .9 * .9 / .5,
        "variances": {row.lval: float(row.Estimate) for _, row in var_rows.iterrows()},
        "se_cells": {row.lval: str(row["Std. Err"]) for _, row in var_rows.iterrows()},
        "fit_not_exact_max_abs_residual": float(np.abs(S_np - Sig).max()),
    }


@feature("bad_input")
def _bad_input():
    res = {}
    d = df.copy()
    d["USEF1"] = d["USEF1"].astype(str)
    for label, data in {"string_column": d, "missing_column": df.drop(columns=["USEF1"])}.items():
        try:
            res[label] = result_info(fitted("cfa", data=data)[1])
        except Exception as e:  # noqa: BLE001
            res[label] = {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    return res


# ------------------------------------------------------------------------------- parity files
def parity(kind: str) -> dict:
    m, r = model(kind)
    ins = m.inspect(std_est=True)
    st = _stats(kind)
    mlw = _mlw_definition(kind)
    ie = _inspect_expected(kind)
    std = _inspect_std(kind)
    L, B, P, T = mats(m)
    C = np.linalg.inv(np.eye(B.shape[0]) - B)
    cov_eta = pd.DataFrame(C @ P @ C.T, index=m.names_beta[0], columns=m.names_beta[0])
    r2 = {e: 1 - lookup(ins, (e, "~~", e), "Estimate") / cov_eta.loc[e, e] for e in TAM_ENDOGENOUS} if kind == "sem" else {}
    num = lambda v: None if v == "-" else float(v)  # noqa: E731
    return {
        "model": "tam-v1",
        "engine": "semopy",
        "engineVersion": md.version("semopy"),
        "variant": f"{kind}-mlw",
        "options": {"Model": {"description": DESC[kind], "mimic_lavaan": False, "baseline": False, "cov_diag": False},
                    "fit": {"obj": "MLW", "solver": "SLSQP", "clean_slate": False},
                    "identification": "marker variable: first loading of each factor fixed to 1 (semopy default)",
                    "data": "raw TAM indicators (no standardisation), complete cases"},
        "n": N,
        "paths": [{"from": a, "to": b, "est": lookup(ins, (b, "~", a), "Estimate")} for a, b in TAM_PATHS] if kind == "sem" else [],
        "loadings": [{"construct": lv, "indicator": mv, "est": lookup(ins, (mv, "~", lv), "Estimate")}
                     for lv in LVS for mv in TAM_BLOCKS[lv]],
        "weights": [],
        "r2": r2,
        "extra": {
            "estimatesAreUnstandardised": True,
            "pathsStd": [{"from": a, "to": b, "est": lookup(ins, (b, "~", a), "Est. Std")} for a, b in TAM_PATHS] if kind == "sem" else [],
            "loadingsStd": [{"construct": lv, "indicator": mv, "est": lookup(ins, (mv, "~", lv), "Est. Std")}
                            for lv in LVS for mv in TAM_BLOCKS[lv]],
            "r2Definition": "computed by the spike: 1 - psi_resid / model-implied var(eta); semopy has no R2 accessor",
            "parameters": [{"lval": row.lval, "op": row.op, "rval": row.rval, "est": float(row.Estimate),
                            "estStd": float(row["Est. Std"]), "se": num(row["Std. Err"]), "z": num(row["z-value"]),
                            "p": num(row["p-value"])} for _, row in ins.iterrows()],
            "seDefinition": "expected information with N (not N-1), non-robust",
            "fitIndices": st["values"],
            "fitIndexDefinitions": {
                "chi2": "N * F_ML, F_ML = tr(S Sigma^-1) + log|Sigma| - log|S| - p, S with divisor N",
                "RMSEA": "sqrt((chi2/df - 1)/(N - 1)), 0 if chi2 < df; no confidence interval",
                "GFI": "semopy computes 1 - chi2/chi2_baseline (identical to NFI), NOT the textbook GFI",
                "AGFI": "1 - dof_baseline/dof * (1 - GFI) using semopy's GFI",
                "LogLik": "semopy reports the F_ML value, NOT a log-likelihood; AIC = 2k - 2*F_ML, BIC = ln(N)k - 2*F_ML",
            },
            "srmr_computedBySpike": st["srmr_hand"],
            "gfiTextbook_computedBySpike": st["GFI_textbook_hand"],
            "logLikTrue_computedBySpike": st["true_loglik_hand"],
            "aicTextbook_computedBySpike": st["AIC_textbook_hand"],
            "optimizer": result_info(r),
            "independentChecks": {"fun_vs_hand_FML": mlw["fun_vs_hand_FML"],
                                  "sigma_semopy_vs_hand": mlw["sigma_semopy_vs_hand"],
                                  "maxAbsCorrResidual": mlw["max_abs_corr_residual"],
                                  "seExpected_vs_handFisher_rel": ie["se_expected_vs_hand_fisher_N_rel"],
                                  "stdEst_vs_hand": std["std_est_vs_hand"],
                                  "fitIndex_maxAbsDiff_vs_hand": max(st["diff_vs_hand"].values())},
        },
    }


for _kind in ["sem", "cfa"]:
    def _p(kind=_kind):
        dump_json(EVIDENCE_DIR / f"parity_semopy_{kind}-mlw.json", parity(kind))
        return {"written": f"parity_semopy_{kind}-mlw.json"}

    FEATURES[f"parity.{_kind}"] = _p


# ============================================================================== driver
def run_one(name: str, rows: int | None) -> None:
    set_rows(rows)
    if name.startswith("parity.") and rows:
        raise SystemExit("parity files are only written from the full data")
    rec = Recorder()
    t0 = time.perf_counter()
    rec.run(name, FEATURES[name])
    res = rec.results[name] | {"seconds_wall": time.perf_counter() - t0, "n": N}
    print(json.dumps(clean(res), allow_nan=False))


def call(name: str, rows: int | None, timeout: int) -> dict:
    cmd = [sys.executable, __file__, "--only", name] + (["--rows", str(rows)] if rows else [])
    t0 = time.perf_counter()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)  # noqa: S603 - fixed argv
    except subprocess.TimeoutExpired:
        return {"ok": False, "timeout": True, "seconds_wall": time.perf_counter() - t0,
                "error": f"did not finish within {timeout} s on tam-v1 (N={rows or 1190}, 22 indicators)",
                "call": " ".join(["uv run python spike/semopy_probe.py", "--only", name] + (["--rows", str(rows)] if rows else []))}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1])
    except (IndexError, json.JSONDecodeError):
        return {"ok": False, "error": f"no JSON result, returncode {p.returncode}", "stderr_tail": p.stderr[-800:]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--rows", type=int)
    ap.add_argument("--timeout", type=int, default=FEATURE_TIMEOUT_S)
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        print("\n".join(FEATURES))
        return
    if a.only:
        run_one(a.only, a.rows)
        return
    results = {}
    for name in FEATURES:
        res = call(name, None, a.timeout)
        if res.get("timeout") and not name.startswith("parity."):
            res["subset_retry"] = call(name, SUBSET_ROWS, a.timeout)
        results[name] = res
        sub = res.get("subset_retry")
        print(f"[{'ok  ' if res.get('ok') else 'FAIL'}] {name}  {res.get('seconds_wall', 0):.1f}s"
              + (f"  -> {res.get('error', '')[:120]}" if not res.get("ok") else "")
              + (f"  | subset {SUBSET_ROWS} rows: {'ok' if sub.get('ok') else 'FAIL'} {sub.get('seconds_wall', 0):.1f}s" if sub else ""),
              flush=True)
    dump_json(EVIDENCE_DIR / "semopy_probe.json", {
        "generated_by": "apps/api/spike/semopy_probe.py", "versions": versions(),
        "feature_timeout_s": a.timeout, "subset_rows_for_retry": SUBSET_ROWS,
        "features": results, "failed": [k for k, v in results.items() if not v.get("ok")]})


if __name__ == "__main__":
    main()
