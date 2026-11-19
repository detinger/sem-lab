"""Distribution functions for CB-SEM inference and fit (port of
packages/engine/src/cb/distributions.ts; the same textbook algorithms, so that the RMSEA
confidence limits follow the identical root-finder path):

 - log Gamma by the Lanczos approximation (g = 7, 9 terms);
 - regularized incomplete gamma P(a, x) / Q(a, x): power series for x < a + 1, modified Lentz
   continued fraction otherwise;
 - central chi^2 = incomplete gamma; noncentral chi^2 CDF as the Poisson(lambda/2) mixture of
   central chi^2 CDFs, summed outwards from the Poisson mode;
 - standard normal tail via Q(1/2, z^2/2);
 - Brent's zeroin exactly as R's ``uniroot()`` (R_zeroin2), so lavaan's RMSEA confidence limits
   (uniroot results with R's default tolerance) are reproduced, not merely approximated.
"""

import math

_EPS = 2.220446049250313e-16
_LANCZOS = (
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
)


def lgamma_lanczos(x):
    if x < 0.5:
        return math.log(math.pi / abs(math.sin(math.pi * x))) - lgamma_lanczos(1 - x)
    z = x - 1
    a = _LANCZOS[0]
    t = z + 7.5
    for i in range(1, 9):
        a += _LANCZOS[i] / (z + i)
    return 0.5 * math.log(2 * math.pi) + (z + 0.5) * math.log(t) - t + math.log(a)


def _gamma_prefix_log(a, x):
    """log of x^a e^-x / Gamma(a)."""
    return a * math.log(x) - x - lgamma_lanczos(a)


def _gamma_series(a, x):
    term = 1 / a
    s = term
    for n in range(1, 100000):
        term *= x / (a + n)
        s += term
        if abs(term) < abs(s) * 1e-17:
            break
    return s * math.exp(_gamma_prefix_log(a, x))


def _gamma_cf(a, x):
    tiny = 1e-300
    b = x + 1 - a
    c = 1 / tiny
    d = 1 / b
    h = d
    for i in range(1, 100000):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        if abs(d) < tiny:
            d = tiny
        c = b + an / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-16:
            break
    return math.exp(_gamma_prefix_log(a, x)) * h


def gamma_p(a, x):
    """Regularized lower incomplete gamma P(a, x)."""
    if x <= 0:
        return 0.0
    if not math.isfinite(x):
        return 1.0
    if x < a + 1:
        return _gamma_series(a, x)
    return 1 - _gamma_cf(a, x)


def gamma_q(a, x):
    """Regularized upper incomplete gamma Q(a, x) = 1 - P(a, x), accurate in the far tail."""
    if x <= 0:
        return 1.0
    if not math.isfinite(x):
        return 0.0
    if x < a + 1:
        return 1 - _gamma_series(a, x)
    return _gamma_cf(a, x)


def pchisq(q, df):
    """Central chi^2 CDF (lower tail); df may be non-integer."""
    return gamma_p(df / 2, q / 2)


def pchisq_upper(q, df):
    """Central chi^2 upper tail P(X > q)."""
    return gamma_q(df / 2, q / 2)


def pnchisq(q, df, ncp):
    """Noncentral chi^2 CDF (lower tail) with noncentrality ncp >= 0."""
    if q <= 0:
        return 0.0
    if ncp <= 0:
        return pchisq(q, df)
    half = ncp / 2
    x = q / 2
    mode = math.floor(half)
    log_w0 = -half + mode * math.log(half) - lgamma_lanczos(mode + 1)
    s = 0.0
    # upward from the mode
    w = math.exp(log_w0)
    w_sum = 0.0
    j = mode
    while j < mode + 100000:
        if j > mode:
            w *= half / j
        term = w * gamma_p(df / 2 + j, x)
        s += term
        w_sum += w
        if j > mode + 5 and (w < 1e-18 or term < 1e-18 * s):
            break
        j += 1
    # downward from the mode
    w = math.exp(log_w0)
    j = mode - 1
    while j >= 0:
        w *= (j + 1) / half
        term = w * gamma_p(df / 2 + j, x)
        s += term
        w_sum += w
        if w < 1e-18 * max(w_sum, 1e-300):
            break
        j -= 1
    return min(1.0, s)


def pnorm_upper(z):
    """Upper tail of the standard normal, P(Z > z), accurate far into the tail."""
    if z == 0:
        return 0.5
    if z > 0:
        return 0.5 * gamma_q(0.5, (z * z) / 2)
    return 1 - 0.5 * gamma_q(0.5, (z * z) / 2)


def p_two_sided_normal(z):
    """Two-sided normal p value 2 P(Z > |z|), computed in the tail (no 1 - Phi cancellation)."""
    return min(1.0, 2 * pnorm_upper(abs(z)))


#: qnorm(0.975) to full double precision
Z_975 = 1.959963984540054


def zeroin(f, ax, bx, tol=_EPS**0.25, maxit=1000):
    """Brent's zeroin as R's uniroot() (R_zeroin2). None when the sign condition fails."""
    fa = f(ax)
    fb = f(bx)
    if not math.isfinite(fa) or not math.isfinite(fb) or fa * fb > 0:
        return None
    a = ax
    b = bx
    c = a
    fc = fa
    if fa == 0:
        return a
    if fb == 0:
        return b
    it = maxit + 1
    while it > 0:
        it -= 1
        prev_step = b - a
        if abs(fc) < abs(fb):
            a = b
            b = c
            c = a
            fa = fb
            fb = fc
            fc = fa
        tol_act = 2 * _EPS * abs(b) + tol / 2
        new_step = (c - b) / 2
        if abs(new_step) <= tol_act or fb == 0:
            return b
        if abs(prev_step) >= tol_act and abs(fa) > abs(fb):
            cb = c - b
            if a == c:
                t1 = fb / fa
                p = cb * t1
                q = 1 - t1
            else:
                qq = fa / fc
                t1 = fb / fc
                t2 = fb / fa
                p = t2 * (cb * qq * (qq - t1) - (b - a) * (t1 - 1))
                q = (qq - 1) * (t1 - 1) * (t2 - 1)
            if p > 0:
                q = -q
            else:
                p = -p
            if p < 0.75 * cb * q - abs(tol_act * q) / 2 and p < abs((prev_step * q) / 2):
                new_step = p / q
        if abs(new_step) < tol_act:
            new_step = tol_act if new_step > 0 else -tol_act
        a = b
        fa = fb
        b += new_step
        fb = f(b)
        if (fb > 0 and fc > 0) or (fb < 0 and fc < 0):
            c = a
            fc = fa
    return None


def _sqrt(v):
    """Math.sqrt: NaN (not an exception) for negative or NaN input."""
    return math.sqrt(v) if v >= 0 else math.nan


def rmsea_point(x2, df, n, c_hat=1.0):
    """RMSEA point estimate as lavaan::lav_fit_rmsea (single group)."""
    if not (df > 0):
        return 0.0
    return _sqrt(max(x2 / n / df - c_hat / n, 0))


def rmsea_ci(x2, df, n, c_hat=1.0, level=0.9):
    """RMSEA confidence interval as lavaan::lav_fit_rmsea_ci (uniroot on the noncentrality)."""
    upper_perc = 1 - (1 - level) / 2
    lower_perc = (1 - level) / 2

    def lower_fn(lam):
        return pnchisq(x2, df, lam) - upper_perc

    def upper_fn(lam):
        return pnchisq(x2, df, lam) - lower_perc

    if df < 1 or lower_fn(0) < 0:
        lower = 0.0
    else:
        root = zeroin(lower_fn, 0, x2)
        lower = None if root is None else _sqrt((c_hat * root) / (n * df))
    n_rmsea = max(n, x2 * 4)
    if df < 1 or upper_fn(n_rmsea) > 0 or upper_fn(0) < 0:
        upper = 0.0
    else:
        root = zeroin(upper_fn, 0, n_rmsea)
        upper = None if root is None else _sqrt((c_hat * root) / (n * df))
    return lower, upper


def rmsea_close_pvalue(x2, df, n, h0, c_hat=1.0):
    """lavaan::lav_fit_rmsea_closefit: P(RMSEA <= h0) test p value."""
    if not (df > 0):
        return None
    ncp = n * df * (1 / c_hat) * h0 * h0
    return 1 - pnchisq(x2, df, ncp)
