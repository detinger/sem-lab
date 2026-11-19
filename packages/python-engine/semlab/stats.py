"""Distribution and summary functions with R's definitions (port of packages/engine/src/shared/stats.ts):

 - ``pt(t, df)`` / ``pt_lower_tail_abs(t, df)``: Student t CDF, P(T <= -|t|) computed in the
   tail without cancellation: scipy.stats.t.sf, except near t = 0 (tail > 1/4), where scipy's
   cephes stdtr loses ~1e-11 (df = 1, |t| = 1e-6) and the tail is taken as
   1/2 - 1/2 I_y(1/2, df/2), y = t^2/(df + t^2) (scipy.special.betainc, no cancellation in y).
   Equals R's stats::pt to 2.2e-16 absolute, 1.5e-13 relative in the tail (tests/test_stats.py);
 - ``quantile7``: stats::quantile(x, probs, type = 7) including R's (1 - h)*x_lo + h*x_hi form;
 - ``sample_sd``: stats::sd (divisor n - 1).
"""

import math

import numpy as np
from scipy.special import betainc as _betainc
from scipy.stats import t as _student_t

from .linalg import r_mean


def _t_upper_tail(t_abs, df):
    """P(T > |t|) for T ~ t(df)."""
    s = float(_student_t.sf(t_abs, df))
    if s > 0.25:
        t2 = t_abs * t_abs
        return 0.5 - 0.5 * float(_betainc(0.5, df / 2, t2 / (df + t2)))
    return s


def pt(t, df):
    """Lower-tail Student t CDF P(T <= t), df > 0 (stats::pt(t, df))."""
    if t != t or not (df > 0):
        return math.nan
    if t == math.inf:
        return 1.0
    if t == -math.inf:
        return 0.0
    tail = _t_upper_tail(abs(t), df)
    return 1.0 - tail if t > 0 else tail


def pt_lower_tail_abs(t, df):
    """P(T <= -|t|) without cancellation (the bootstrap p-value building block)."""
    if t != t or not (df > 0):
        return math.nan
    if not math.isfinite(t):
        return 0.0
    return _t_upper_tail(abs(t), df)


def quantile7(x, probs):
    """stats::quantile(x, probs, type = 7, names = FALSE) for finite x."""
    xs = np.sort(np.asarray(x, dtype=float))
    n = xs.shape[0]
    out = []
    for p in probs:
        index = 1 + max(n - 1, 0) * p
        lo = math.floor(index)
        hi = math.ceil(index)
        qs = float(xs[lo - 1])
        xh = float(xs[hi - 1])
        if index > lo and xh != qs:
            h = index - lo
            out.append((1 - h) * qs + h * xh)
        else:
            out.append(qs)
    return out


def sample_sd(x):
    """stats::sd (divisor n - 1)."""
    x = np.asarray(x, dtype=float)
    n = x.shape[0]
    m = r_mean(x)
    d = x - m
    return math.sqrt(float(np.sum(d * d)) / (n - 1))
