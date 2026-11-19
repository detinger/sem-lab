"""Independent NumPy reference implementation of the basic PLS path modelling algorithm.

Purpose: a self-consistency yardstick for the Phase 0 spike. It is written from the textbook
description of Wold/Lohmoeller's algorithm (standardised indicators, Mode A / Mode B outer
estimation, centroid / factorial / path inner weighting) and shares no code with plspm.
It is NOT the SEM Lab production estimator and makes no claim beyond what the spike
scripts check with it.

Conventions (stated explicitly because every one of them matters for cross-package parity):
  * each indicator is standardised to mean 0 and variance 1 (the divisor does not matter
    for the estimates because everything downstream is correlation based);
  * outer weights are rescaled each iteration so that every composite has unit variance;
  * starting weights are all 1;
  * convergence: max |w_new - w_old| < tol on the rescaled weights;
  * path coefficients are OLS on the final composite scores; loadings are correlations
    between an indicator and its own composite.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class RefPLS:
    constructs: list[str]
    weights: dict[str, np.ndarray]  # per construct, in block order
    loadings: dict[str, np.ndarray]
    scores: np.ndarray  # n x k, population variance 1
    paths: dict[tuple[str, str], float]  # (from, to)
    r2: dict[str, float]
    iterations: int
    converged: bool


def _standardise(x: np.ndarray) -> np.ndarray:
    x = x - x.mean(axis=0)
    return x / x.std(axis=0, ddof=0)


def fit(
    data: dict[str, np.ndarray],
    paths: list[tuple[str, str]],
    scheme: str = "path",
    modes: dict[str, str] | None = None,
    tol: float = 1e-12,
    max_iter: int = 1000,
) -> RefPLS:
    """data: construct -> (n x p_j) raw indicator matrix; paths: (from, to); scheme: path|centroid|factorial."""
    names = list(data)
    k = len(names)
    idx = {c: i for i, c in enumerate(names)}
    modes = modes or {}
    X = {c: _standardise(np.asarray(v, dtype=float)) for c, v in data.items()}
    n = next(iter(X.values())).shape[0]

    # D[i, j] = 1 if j -> i  (row = dependent)
    D = np.zeros((k, k))
    for a, b in paths:
        D[idx[b], idx[a]] = 1.0
    C = D + D.T

    def scale(c: str, w: np.ndarray) -> np.ndarray:
        return w / (X[c] @ w).std(ddof=0)

    W = {c: scale(c, np.ones(X[c].shape[1])) for c in names}
    converged = False
    it = 0
    for it in range(1, max_iter + 1):
        Y = np.column_stack([X[c] @ W[c] for c in names])
        R = np.corrcoef(Y, rowvar=False)
        if scheme == "centroid":
            E = np.sign(R) * C
        elif scheme == "factorial":
            E = R * C
        elif scheme == "path":
            E = np.zeros((k, k))
            for j in range(k):
                pred = np.flatnonzero(D[j] == 1)
                if pred.size:
                    beta, *_ = np.linalg.lstsq(Y[:, pred], Y[:, j], rcond=None)
                    E[pred, j] = beta
                succ = np.flatnonzero(D[:, j] == 1)
                E[succ, j] = R[succ, j]
        else:  # pragma: no cover
            raise ValueError(scheme)
        Z = Y @ E
        W_new = {}
        for c in names:
            z = Z[:, idx[c]]
            if modes.get(c, "A") == "A":
                w = X[c].T @ z / n
            else:
                w, *_ = np.linalg.lstsq(X[c], z, rcond=None)
            W_new[c] = scale(c, w)
        delta = max(float(np.max(np.abs(W_new[c] - W[c]))) for c in names)
        W = W_new
        if delta < tol:
            converged = True
            break

    Y = np.column_stack([X[c] @ W[c] for c in names])
    loadings = {
        c: np.array([np.corrcoef(X[c][:, j], Y[:, idx[c]])[0, 1] for j in range(X[c].shape[1])]) for c in names
    }
    path_est: dict[tuple[str, str], float] = {}
    r2: dict[str, float] = {}
    for j, c in enumerate(names):
        pred = np.flatnonzero(D[j] == 1)
        if not pred.size:
            continue
        beta, *_ = np.linalg.lstsq(Y[:, pred], Y[:, j], rcond=None)
        resid = Y[:, j] - Y[:, pred] @ beta
        r2[c] = float(1.0 - resid.var(ddof=0) / Y[:, j].var(ddof=0))
        for p, b in zip(pred, beta):
            path_est[(names[p], c)] = float(b)
    return RefPLS(names, W, loadings, Y, path_est, r2, it, converged)
