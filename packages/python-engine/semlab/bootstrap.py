"""SEM Lab's bootstrap definition (port of packages/engine/src/pls/bootstrap.ts):

    set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")
    for (b in 1:B) {
      idx_b <- sample.int(n, n, replace = TRUE)   # one RNG stream, drawn sequentially
      refit the full model on data[idx_b, ]         # same csem() options as the main fit
      failed       if the fit errors, does not converge or gives a non-finite estimate
      inadmissible if cSEM::verify() flags it
    }
    valid draws only: se = sd (divisor B_valid - 1); t = est / se;
    p = 2 P(T <= -|t|), T ~ t(B_valid - 1) (one-sided: P(T <= -|t|), direction of the estimate);
    CI = quantile(type = 7) percentile; one-sided: est >= 0 -> lower = q(1 - L), upper null;
    est < 0 -> upper = q(L), lower null. Total / indirect / specific effects per draw.
"""

import math

import numpy as np

from .linalg import NumericalError, correlation
from .pls_core import fit_pls, verify
from .rng import bootstrap_indices  # noqa: F401  (re-exported building block)
from .stats import pt_lower_tail_abs, quantile7, sample_sd


class ThetaSlot:
    """Where an estimated parameter lives in a CoreFit: B / Lambda / W [row, col]."""

    __slots__ = ("kind", "row", "col")

    def __init__(self, kind, row, col):
        self.kind = kind
        self.row = row
        self.col = col


class BootstrapProblem:
    """Everything needed to fit one draw."""

    __slots__ = ("core", "disattenuate", "X", "theta")

    def __init__(self, core, disattenuate, X, theta):
        self.core = core
        self.disattenuate = disattenuate
        #: analysis matrix (n x p), model indicator order
        self.X = X
        self.theta = theta


def extract_theta(fit, slots):
    out = []
    for s in slots:
        if s.kind == "path":
            out.append(float(fit.B[s.row, s.col]))
        elif s.kind == "loading":
            out.append(float(fit.Lambda[s.row, s.col]))
        else:
            out.append(float(fit.W[s.row, s.col]))
    return out


class DrawResult:
    __slots__ = ("status", "reason", "checks", "theta")

    def __init__(self, status, reason=None, checks=None, theta=None):
        self.status = status  # 'ok' | 'failed' | 'inadmissible'
        self.reason = reason  # failed: 'error' | 'nonconvergence' | 'non-finite'
        self.checks = checks  # inadmissible: failed verify() checks
        self.theta = theta


def fit_draw(problem, idx):
    """Refit the model on the rows `idx` (0-based, with repetitions) and classify the draw."""
    S, zero = correlation(problem.X, idx)
    if zero:
        return DrawResult("failed", reason="error")
    try:
        with np.errstate(all="ignore"):
            fit = fit_pls(S, problem.core, problem.disattenuate, len(idx))
    except NumericalError:
        return DrawResult("failed", reason="error")
    if not fit.converged:
        return DrawResult("failed", reason="nonconvergence")
    theta = extract_theta(fit, problem.theta)
    if any(not math.isfinite(v) for v in theta):
        return DrawResult("failed", reason="non-finite")
    with np.errstate(all="ignore"):
        checks = verify(S, fit, problem.core)
    if checks:
        return DrawResult("inadmissible", checks=checks, theta=theta)
    return DrawResult("ok", theta=theta)


class BootstrapCounts:
    __slots__ = ("requested", "completed", "failed", "inadmissible", "valid")

    def __init__(self, requested, completed, failed, inadmissible, valid):
        self.requested = requested
        self.completed = completed
        self.failed = failed
        self.inadmissible = inadmissible
        #: valid draws in draw order: valid[d][i] belongs to theta slot i
        self.valid = valid


def summarise_bootstrap(draws_in_order):
    valid = []
    failed = 0
    inadmissible = 0
    for d in draws_in_order:
        if d.status == "ok":
            valid.append(d.theta)
        elif d.status == "failed":
            failed += 1
        else:
            inadmissible += 1
    return BootstrapCounts(len(draws_in_order), len(valid), failed, inadmissible, valid)


class Inference:
    __slots__ = ("n_valid", "se", "statistic", "p_value", "ci_lower", "ci_upper", "reason")

    def __init__(self, n_valid, se, statistic, p_value, ci_lower, ci_upper, reason=None):
        self.n_valid = n_valid
        self.se = se
        self.statistic = statistic
        self.p_value = p_value
        self.ci_lower = ci_lower
        self.ci_upper = ci_upper
        self.reason = reason

    def get(self, field):
        return {
            "se": self.se,
            "statistic": self.statistic,
            "pValue": self.p_value,
            "ciLower": self.ci_lower,
            "ciUpper": self.ci_upper,
        }[field]


def infer_from_draws(est, draws_in, level, sides):
    """Inference for one parameter from its valid draws (R engine infer_from_draws)."""
    draws = [v for v in draws_in if math.isfinite(v)]
    nv = len(draws)
    if not math.isfinite(est) or nv < 2:
        return Inference(
            nv, None, None, None, None, None, "failed" if math.isfinite(est) else "non-finite"
        )
    se = sample_sd(draws)
    with np.errstate(all="ignore"):
        t = float(np.divide(est, se))
    df = nv - 1
    if sides == "two-sided":
        p = 2 * pt_lower_tail_abs(t, df)
        q = quantile7(draws, [(1 - level) / 2, 1 - (1 - level) / 2])
        lo, hi = q[0], q[1]
    else:
        p = pt_lower_tail_abs(t, df)
        if est >= 0:
            lo, hi = quantile7(draws, [1 - level])[0], None
        else:
            lo, hi = None, quantile7(draws, [level])[0]
    if math.isfinite(p):
        p = min(1.0, max(0.0, p))
    return Inference(nv, se, t, p, lo, hi)
