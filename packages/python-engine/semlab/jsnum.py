"""JavaScript number formatting (String(x), toExponential, toFixed, toPrecision), so that
messages and the rounded bootstrap draws are character-for-character those of the
TypeScript engine. JS rounds exact ties away from zero ("pick the larger n"); Python's
format() rounds half-even, hence the Decimal implementation."""

import math
from decimal import ROUND_HALF_UP, Decimal, localcontext


def js_str(x):
    """Number.prototype.toString() / String(x) for a finite or non-finite double."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        return str(x)
    if x != x:
        return "NaN"
    if x == math.inf:
        return "Infinity"
    if x == -math.inf:
        return "-Infinity"
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    # shortest round-trip digits (repr) -> digits d1..dk and decimal exponent n: 0.d1..dk x 10^n
    t = Decimal(repr(abs(float(x)))).normalize().as_tuple()
    digits = "".join(str(d) for d in t.digits)
    k = len(digits)
    n = t.exponent + k
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    es = ("+" if e >= 0 else "-") + str(abs(e))
    if k == 1:
        return sign + digits + "e" + es
    return sign + digits[0] + "." + digits[1:] + "e" + es


def _nonfinite(x):
    if x != x:
        return "NaN"
    return "Infinity" if x > 0 else "-Infinity"


def js_to_exponential(x, f):
    """Number.prototype.toExponential(f)."""
    x = float(x)
    if not math.isfinite(x):
        return _nonfinite(x)
    sign = "-" if x < 0 else ""
    a = abs(x)
    if a == 0:
        return sign + "0" + ("." + "0" * f if f > 0 else "") + "e+0"
    with localcontext() as ctx:
        ctx.prec = 2000
        d = Decimal(a)
        e = d.adjusted()
        q = d.scaleb(-e).quantize(Decimal(1).scaleb(-f), rounding=ROUND_HALF_UP)
        if q >= 10:
            e += 1
            q = d.scaleb(-e).quantize(Decimal(1).scaleb(-f), rounding=ROUND_HALF_UP)
        s = format(q, "f")
    return sign + s + "e" + ("+" if e >= 0 else "-") + str(abs(e))


def js_to_fixed(x, f):
    """Number.prototype.toFixed(f) for |x| < 1e21."""
    x = float(x)
    if not math.isfinite(x):
        return _nonfinite(x)
    if abs(x) >= 1e21:
        return js_str(x)
    sign = "-" if x < 0 else ""
    with localcontext() as ctx:
        ctx.prec = 2000
        q = Decimal(abs(x)).quantize(Decimal(1).scaleb(-f), rounding=ROUND_HALF_UP)
        s = format(q, "f")
    if sign and float(q) == 0:
        # JS: (-0.0001).toFixed(2) === '-0.00'
        return "-" + s
    return sign + s


def js_signif(x, digits):
    """Number(x.toPrecision(digits)) (0 stays 0): round to `digits` significant digits."""
    if x == 0 or not math.isfinite(x):
        return 0.0 if x == 0 else x
    a = abs(x)
    with localcontext() as ctx:
        ctx.prec = 2000
        d = Decimal(a)
        e = d.adjusted()
        q = d.quantize(Decimal(1).scaleb(e - digits + 1), rounding=ROUND_HALF_UP)
        v = float(q)
    return -v if x < 0 else v
