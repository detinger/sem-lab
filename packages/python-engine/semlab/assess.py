"""Quality criteria with the definitions of cSEM 0.7.1 ``assess()`` (port of
packages/engine/src/pls/assess.ts):

    cronbach_alpha   cSEM:::calculateRhoT (unweighted, correlation-based)
    rho_c            cSEM:::calculateRhoC (.model_implied = TRUE, .weighted = FALSE)
    ave              cSEM:::calculateAVE
    rho_a            Estimates$Reliabilities of a PLSc pass (cSEM:::calculateReliabilities)
    htmt_pair        cSEM:::calculateHTMTcore (.absolute = TRUE, htmt / htmt2)
    cross_loadings   stats::cor(data, Estimates$Construct_scores)
    f2               cSEM:::calculatef2 (drop the predictor, same construct correlations)
    vif_mode_b       cSEM:::calculateVIFModeB
    fit_indices      cSEM:::calculateSRMR / calculateDL / calculateDG (log base 10)
"""

import math

import numpy as np
from scipy.linalg import solve_triangular

from .linalg import NumericalError, inverse_r, symmetric_eigenvalues
from .pls_core import correction_factor, estimate_paths, model_implied_indicator_cor


def cronbach_alpha(S, block):
    """Standardised Cronbach's alpha: rbar * (sum w)^2, w = unit weights scaled to w'Sw = 1."""
    Sb = S[np.ix_(block, block)]
    total = float(np.sum(Sb))
    iu = np.triu_indices(len(block), 1)
    rbar = float(np.sum(Sb[iu])) / len(iu[0])
    with np.errstate(all="ignore"):
        w = 1 / np.sqrt(total)
    return float(rbar * (len(block) * w) ** 2)


def rho_c(sigma_cf, fit, j, block):
    """rho_C on the reported loadings with the model-implied block correlations."""
    total = float(np.sum(sigma_cf[np.ix_(block, block)]))
    with np.errstate(all="ignore"):
        w = 1 / np.sqrt(total)
    s = float(np.sum(w * fit.Lambda[j, block]))
    return s * s


def ave(fit, j, block):
    """AVE = sum l^2 / (sum l^2 + sum (1 - l^2)) over the block's non-zero loadings."""
    s2 = 0.0
    s1 = 0.0
    for a in block:
        lam = float(fit.Lambda[j, a])
        if lam == 0:
            continue
        s2 += lam * lam
        s1 += 1 - lam * lam
    with np.errstate(all="ignore"):
        return float(np.divide(s2, s2 + s1))


def rho_a(S, W, block, j):
    """rho_A = Q^2 of the PLSc correction applied to these (identical) weights."""
    w = W[j, block]
    c = 1.0 if len(block) == 1 else correction_factor(S, w, block)
    q = float(np.sum(w * c * w))
    return q * q


def _nth_root(x, n):
    if x < 0 and n % 2 == 1:
        return -((-x) ** (1 / n))
    if x < 0:
        return math.nan
    return x ** (1 / n)


def _lower_tri(S, block):
    # column-major lower triangle, as S[lower.tri(S)]
    out = []
    for c in range(len(block)):
        for r in range(c + 1, len(block)):
            out.append(float(S[block[r], block[c]]))
    return out


def htmt_pair(S, b1, b2, kind):
    """HTMT / HTMT2 of two blocks (absolute value), as cSEM:::calculateHTMTcore."""
    mono1 = [1.0] if len(b1) == 1 else _lower_tri(S, b1)
    mono2 = [1.0] if len(b2) == 1 else _lower_tri(S, b2)
    het = [float(S[r, c]) for c in b2 for r in b1]
    sign_id = 1
    if all(v < 0 for v in het):
        het = [abs(v) for v in het]
        sign_id = -1
    if kind == "htmt":
        a1 = sum(mono1) / len(mono1)
        a2 = sum(mono2) / len(mono2)
        a3 = sum(het) / len(het)
    else:

        def prod(x):
            p = 1.0
            for v in x:
                p *= v
            return p

        a1 = _nth_root(prod(mono1), len(mono1))
        a2 = _nth_root(prod(mono2), len(mono2))
        a3 = _nth_root(prod(het), len(het))
    with np.errstate(all="ignore"):
        return float(abs((a3 / np.sqrt(a1 * a2)) * sign_id))


def cross_loadings(fit, S, model):
    """Pearson correlation of every indicator (rows) with every construct score (columns)."""
    with np.errstate(all="ignore"):
        return (fit.W @ S).T / np.sqrt(np.diag(fit.C))[None, :]


def f2(fit, model, n):
    """f2[t, s] for every path s -> t (NaN elsewhere)."""
    k = model.k
    out = np.full((k, k), math.nan)
    for t in range(k):
        for s in range(k):
            if model.structural[t, s] != 1:
                continue
            reduced = model.structural.copy()
            reduced[t, s] = 0
            r2excl = (
                float(estimate_paths(fit.P, reduced, n).R2[t]) if np.any(reduced[t] == 1) else 0.0
            )
            r2 = float(fit.R2[t])
            with np.errstate(all="ignore"):
                out[t, s] = np.divide(r2 - r2excl, 1 - r2)
    return out


def vif_mode_b(S, block):
    """VIF of each indicator of a Mode B block: diagonal of the inverse block correlation matrix."""
    inv = inverse_r(S[np.ix_(block, block)])
    return np.diag(inv).copy()


def _geodesic(S, Sigma):
    """0.5 sum (log10 l_i)^2, l eigenvalues of S^-1 Sigma (symmetric form L^-1 Sigma L^-T)."""
    try:
        L = np.linalg.cholesky(S)
    except np.linalg.LinAlgError as e:
        raise NumericalError("S is not positive definite") from e
    X = solve_triangular(L, Sigma, lower=True)
    M = solve_triangular(L, X.T, lower=True)
    M = 0.5 * (M + M.T)
    ev = symmetric_eigenvalues(M)
    with np.errstate(all="ignore"):
        return float(0.5 * np.sum(np.log10(ev) ** 2))


class FitIndices:
    __slots__ = ("srmr", "d_uls", "d_g")

    def __init__(self, srmr, d_uls, d_g):
        self.srmr = srmr
        self.d_uls = d_uls
        self.d_g = d_g


def fit_indices(S, fit, model):
    """SRMR, d_ULS and d_G (base-10 logarithm) against the model-implied indicator correlations."""
    Sigma = model_implied_indicator_cor(S, fit, model)
    p = S.shape[0]
    with np.errstate(all="ignore"):
        ds = np.sqrt(np.diag(S))
        dh = np.sqrt(np.diag(Sigma))
        D = S - Sigma
        dl = float(np.sum(D * D))
        cs = S / np.outer(ds, ds)
        ch = Sigma / np.outer(dh, dh)
        np.fill_diagonal(cs, 1.0)
        np.fill_diagonal(ch, 1.0)
        il = np.tril_indices(p)
        c = cs[il] - ch[il]
        srmr = math.sqrt(float(np.sum(c * c)) / len(il[0]))
    try:
        dg = _geodesic(S, Sigma)
    except NumericalError:
        dg = math.nan
    return FitIndices(srmr, 0.5 * dl, dg)


def reliability_eligible(model):
    """Common-factor blocks with >= 2 indicators (eligibility for alpha, rho, AVE, HTMT, FL)."""
    return [model.common_factor[j] and len(b) >= 2 for j, b in enumerate(model.blocks)]


def rho_c_sigma(S, fit, model):
    """Model-implied correlations with composites converted to common factors (calculateRhoC)."""
    return model_implied_indicator_cor(S, fit, model, True)
