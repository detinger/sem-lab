/**
 * Distribution functions needed for CB-SEM inference and fit, implemented from the textbook
 * definitions (no external dependency):
 *
 * - log Γ by the Lanczos approximation (g = 7, 9 terms; ~1e-15 relative);
 * - regularized incomplete gamma P(a, x) / Q(a, x): power series for x < a + 1, modified Lentz
 *   continued fraction otherwise;
 * - central χ² = incomplete gamma; noncentral χ² CDF as the Poisson(λ/2) mixture of central χ²
 *   CDFs with df + 2j, summed outwards from the Poisson mode until the remaining weight is
 *   negligible;
 * - standard normal tail via Q(½, z²/2);
 * - Brent's zeroin root finder in exactly the form used by R's `uniroot()` (R_zeroin2), so that
 *   lavaan's RMSEA confidence limits — which are uniroot results with R's default tolerance
 *   (≈1.2e-4 on λ) — can be reproduced, not merely approximated.
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log of x^a e^{-x} / Γ(a) */
function gammaPrefixLog(a: number, x: number): number {
  return a * Math.log(x) - x - lgamma(a);
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaCf(a, x);
}

/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), accurate in the far tail. */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaCf(a, x);
}

function gammaSeries(a: number, x: number): number {
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n < 100000; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-17) break;
  }
  return sum * Math.exp(gammaPrefixLog(a, x));
}

function gammaCf(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 100000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(gammaPrefixLog(a, x)) * h;
}

/** Central χ² CDF (lower tail). df may be non-integer. */
export function pchisq(q: number, df: number): number {
  return gammaP(df / 2, q / 2);
}

/** Central χ² upper tail P(X > q). */
export function pchisqUpper(q: number, df: number): number {
  return gammaQ(df / 2, q / 2);
}

/** Noncentral χ² CDF (lower tail) with noncentrality ncp ≥ 0. */
export function pnchisq(q: number, df: number, ncp: number): number {
  if (q <= 0) return 0;
  if (ncp <= 0) return pchisq(q, df);
  const half = ncp / 2;
  const x = q / 2;
  const mode = Math.floor(half);
  const logW0 = -half + mode * Math.log(half) - lgamma(mode + 1);
  let sum = 0;
  // upward from the mode
  let w = Math.exp(logW0);
  let wSum = 0;
  for (let j = mode; j < mode + 100000; j++) {
    if (j > mode) w *= half / j;
    const term = w * gammaP(df / 2 + j, x);
    sum += term;
    wSum += w;
    if (j > mode + 5 && (w < 1e-18 || term < 1e-18 * sum)) break;
  }
  // downward from the mode
  w = Math.exp(logW0);
  for (let j = mode - 1; j >= 0; j--) {
    w *= (j + 1) / half;
    const term = w * gammaP(df / 2 + j, x);
    sum += term;
    wSum += w;
    if (w < 1e-18 * Math.max(wSum, 1e-300)) break;
  }
  return Math.min(1, sum);
}

/** Upper tail of the standard normal, P(Z > z), accurate far into the tail. */
export function pnormUpper(z: number): number {
  if (z === 0) return 0.5;
  if (z > 0) return 0.5 * gammaQ(0.5, (z * z) / 2);
  return 1 - 0.5 * gammaQ(0.5, (z * z) / 2);
}

/** Two-sided normal p value 2·P(Z > |z|), computed in the tail (no 1 − Φ cancellation). */
export function pTwoSidedNormal(z: number): number {
  return Math.min(1, 2 * pnormUpper(Math.abs(z)));
}

/** qnorm(0.975) to full double precision. */
export const Z_975 = 1.959963984540054;

/**
 * Brent's zeroin as in R's `uniroot()` (R_zeroin2): returns the root of f on [ax, bx], given
 * f(ax) and f(bx) with opposite signs, to the tolerance `tol` (R default .Machine$double.eps^0.25).
 * Returns null when the sign condition does not hold (uniroot would throw).
 */
export function zeroin(
  f: (x: number) => number,
  ax: number,
  bx: number,
  tol = Math.pow(Number.EPSILON, 0.25),
  maxit = 1000,
): number | null {
  let fa = f(ax);
  let fb = f(bx);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null;
  let a = ax;
  let b = bx;
  let c = a;
  let fc = fa;
  if (fa === 0) return a;
  if (fb === 0) return b;
  let iter = maxit + 1;
  while (iter-- > 0) {
    const prevStep = b - a;
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tolAct = 2 * Number.EPSILON * Math.abs(b) + tol / 2;
    let newStep = (c - b) / 2;
    if (Math.abs(newStep) <= tolAct || fb === 0) return b;
    if (Math.abs(prevStep) >= tolAct && Math.abs(fa) > Math.abs(fb)) {
      let p: number;
      let q: number;
      const cb = c - b;
      if (a === c) {
        const t1 = fb / fa;
        p = cb * t1;
        q = 1 - t1;
      } else {
        const qq = fa / fc;
        const t1 = fb / fc;
        const t2 = fb / fa;
        p = t2 * (cb * qq * (qq - t1) - (b - a) * (t1 - 1));
        q = (qq - 1) * (t1 - 1) * (t2 - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (p < 0.75 * cb * q - Math.abs(tolAct * q) / 2 && p < Math.abs((prevStep * q) / 2))
        newStep = p / q;
    }
    if (Math.abs(newStep) < tolAct) newStep = newStep > 0 ? tolAct : -tolAct;
    a = b;
    fa = fb;
    b += newStep;
    fb = f(b);
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
    }
  }
  return null;
}

/** RMSEA point estimate as lavaan::lav_fit_rmsea (single group). */
export function rmseaPoint(x2: number, df: number, n: number, cHat = 1): number {
  if (!(df > 0)) return 0;
  return Math.sqrt(Math.max(x2 / n / df - cHat / n, 0));
}

/**
 * RMSEA confidence interval as lavaan::lav_fit_rmsea_ci (single group, level 0.90): the
 * noncentrality λ solving pnchisq(X², df, λ) = 0.95 / 0.05, found with R's uniroot on [0, X²]
 * and [0, max(N, 4X²)], then sqrt(ĉ·λ / (N·df)). Null where lavaan returns NA (root not
 * bracketed).
 */
export function rmseaCi(
  x2: number,
  df: number,
  n: number,
  cHat = 1,
  level = 0.9,
): { lower: number | null; upper: number | null } {
  const upperPerc = 1 - (1 - level) / 2;
  const lowerPerc = (1 - level) / 2;
  const lowerFn = (l: number): number => pnchisq(x2, df, l) - upperPerc;
  const upperFn = (l: number): number => pnchisq(x2, df, l) - lowerPerc;
  let lower: number | null;
  if (df < 1 || lowerFn(0) < 0) lower = 0;
  else {
    const root = zeroin(lowerFn, 0, x2);
    lower = root === null ? null : Math.sqrt((cHat * root) / (n * df));
  }
  const nRmsea = Math.max(n, x2 * 4);
  let upper: number | null;
  if (df < 1 || upperFn(nRmsea) > 0 || upperFn(0) < 0) upper = 0;
  else {
    const root = zeroin(upperFn, 0, nRmsea);
    upper = root === null ? null : Math.sqrt((cHat * root) / (n * df));
  }
  return { lower, upper };
}

/** lavaan::lav_fit_rmsea_closefit: P(RMSEA ≤ h0) test p value. */
export function rmseaClosePvalue(
  x2: number,
  df: number,
  n: number,
  h0: number,
  cHat = 1,
): number | null {
  if (!(df > 0)) return null;
  const ncp = n * df * (1 / cHat) * h0 * h0;
  return 1 - pnchisq(x2, df, ncp);
}
