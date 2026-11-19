"""Small dense linear-algebra helpers for the PLS engine (port of packages/engine/src/linalg).

Numerics follow the R functions the reference engine uses:
 - ``inverse_r`` / ``solve_r`` mirror base::solve(): LU with partial pivoting and the same
   refusal rule (error when the reciprocal 1-norm condition number is below
   .Machine$double.eps, "system is computationally singular");
 - ``symmetric_eigenvalues`` mirrors eigen(symmetric = TRUE);
 - ``is_positive_semi_definite`` mirrors cSEM:::isPositiveSemiDefinite (eigenvalues >= -1e-8);
 - ``correlation`` mirrors stats::cor() for complete numeric data (Pearson, two-pass means).
"""

import math

import numpy as np

DOUBLE_EPS = 2.220446049250313e-16


class NumericalError(Exception):
    """Raised where R itself would stop with an error (singular system, NaN input ...)."""


def _assert_finite(a):
    if not np.all(np.isfinite(a)):
        raise NumericalError("non-finite value in matrix")


def _norm1(a):
    # max column sum of |a|; NaN propagates (JS: if (!(s <= best)) best = s)
    s = np.sum(np.abs(a), axis=0)
    if np.any(np.isnan(s)):
        return math.nan
    return float(np.max(s)) if s.size else 0.0


def inverse_r(a):
    """Inverse with base::solve()'s singularity rule; raises NumericalError."""
    a = np.asarray(a, dtype=float)
    n = a.shape[0]
    if n == 0:
        return np.zeros((0, 0))
    _assert_finite(a)
    try:
        inv = np.linalg.inv(a)
    except np.linalg.LinAlgError as e:
        raise NumericalError("system is exactly singular") from e
    _assert_finite(inv)
    with np.errstate(all="ignore"):
        rcond = 1.0 / (_norm1(a) * _norm1(inv))
    if not (rcond >= DOUBLE_EPS):
        raise NumericalError("system is computationally singular")
    return inv


def solve_r(a, b):
    """solve(a, b) for a vector right-hand side, with base::solve()'s singularity rule."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    n = a.shape[0]
    if n == 0:
        return np.zeros(0)
    if n == 1:
        d = float(a[0, 0])
        if not math.isfinite(d) or d == 0 or not math.isfinite(float(b[0])):
            raise NumericalError("singular 1x1 system")
        return np.array([float(b[0]) / d])
    _assert_finite(a)
    if not np.all(np.isfinite(b)):
        raise NumericalError("non-finite right-hand side")
    try:
        lu_inv = np.linalg.inv(a)
        x = np.linalg.solve(a, b)
    except np.linalg.LinAlgError as e:
        raise NumericalError("system is exactly singular") from e
    with np.errstate(all="ignore"):
        rcond = 1.0 / (_norm1(a) * _norm1(lu_inv))
    if not (rcond >= DOUBLE_EPS):
        raise NumericalError("system is computationally singular")
    if not np.all(np.isfinite(x)):
        raise NumericalError("non-finite solution")
    return x


def symmetric_eigenvalues(a):
    """Eigenvalues of a symmetric matrix, descending."""
    a = np.asarray(a, dtype=float)
    if a.shape[0] == 0:
        return np.zeros(0)
    try:
        ev = np.linalg.eigvalsh(a)
    except np.linalg.LinAlgError as e:
        raise NumericalError("eigen decomposition failed") from e
    return ev[::-1]


def is_positive_semi_definite(a, tolerance=1e-8):
    a = np.asarray(a, dtype=float)
    if not np.all(np.isfinite(a)):
        return False
    try:
        ev = symmetric_eigenvalues(a)
    except NumericalError:
        return False
    return not bool(np.any(~np.isfinite(ev) | (ev < -tolerance)))


def symmetrize_from_upper(a):
    """R: x[lower.tri(x)] <- t(x)[lower.tri(x)] (in place; returns a)."""
    il = np.tril_indices(a.shape[0], -1)
    a[il] = a.T[il]
    return a


def r_mean(x):
    """mean(x) with R's two-pass refinement (s/n, then + mean(x - s/n))."""
    x = np.asarray(x, dtype=float)
    n = x.shape[0]
    m = np.sum(x) / n
    return float(m + np.sum(x - m) / n)


def r_sd(x):
    """stats::sd (divisor n - 1)."""
    x = np.asarray(x, dtype=float)
    n = x.shape[0]
    m = r_mean(x)
    d = x - m
    return math.sqrt(float(np.sum(d * d)) / (n - 1))


def correlation(X, rows=None):
    """Pearson correlation of the columns of X (n x p), over `rows` (0-based, repetitions
    allowed: a bootstrap resample). Returns (S, zero_variance_column_indices); S has an exact
    unit diagonal and off-diagonal values clamped to [-1, 1] (stats::cor)."""
    V = X if rows is None else X[rows]
    n, p = V.shape
    m = np.sum(V, axis=0) / n
    m = m + np.sum(V - m, axis=0) / n
    C = V - m
    ss = np.sum(C * C, axis=0)
    all_same = np.all(V == V[0:1, :], axis=0) if n > 0 else np.ones(p, dtype=bool)
    zero = [j for j in range(p) if all_same[j] or not (ss[j] > 0)]
    with np.errstate(all="ignore"):
        S = (C.T @ C) / np.sqrt(np.outer(ss, ss))
    np.clip(S, -1.0, 1.0, out=S)
    np.fill_diagonal(S, 1.0)
    # exact symmetry, as the reference computes the upper triangle once
    symmetrize_from_upper(S)
    return S, zero


def qr_rank(a, tol=1e-10):
    """Numerical rank with base::qr(x, tol)'s rule (Gram-Schmidt with limited pivoting)."""
    a = np.asarray(a, dtype=float)
    n = a.shape[0]
    if n == 0:
        return 0
    kept = []
    for j in range(a.shape[1]):
        c = a[:, j].copy()
        orig = math.hypot(*c)
        v = c.copy()
        for q in kept:
            d = float(np.dot(q, v))
            v = v - d * q
        nv = math.hypot(*v)
        if orig > 0 and nv >= tol * orig:
            kept.append(v / nv)
    return len(kept)
