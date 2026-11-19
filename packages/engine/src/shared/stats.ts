/**
 * Distribution and summary functions with R's definitions:
 *  - `pt(t, df)`: Student t CDF via the regularised incomplete beta function
 *    I_x(df/2, 1/2), x = df/(df + t²) (continued fraction, modified Lentz), with an
 *    accurate log B(a, 1/2) (Stirling series for large a) so that tail probabilities keep
 *    their relative precision; tested against R's stats::pt.
 *  - `quantile7`: stats::quantile(x, probs, type = 7) including R's (1 − h)·x_lo + h·x_hi form.
 *  - `sampleSd`: stats::sd (divisor n − 1).
 */
import { mean } from '../linalg/index.ts';

const LN_SQRT_PI = 0.5723649429247001; // log(sqrt(pi)) = lgamma(1/2)

/** Lanczos log-gamma for x > 0 (g = 7, 9 terms; relative error ~1e-15). */
function lgammaLanczos(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgammaLanczos(1 - x);
  const xx = x - 1;
  let a = c[0]!;
  const t = xx + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Σ B_{2k} / (2k(2k−1) z^{2k−1}) — the Stirling correction of log Γ(z). */
function stirlingCorrection(z: number): number {
  const z2 = z * z;
  const b = [
    1 / 12,
    -1 / 360,
    1 / 1260,
    -1 / 1680,
    1 / 1188,
    -691 / 360360,
    1 / 156,
    -3617 / 122400,
  ];
  let s = 0;
  let zp = z;
  for (const coef of b) {
    s += coef / zp;
    zp *= z2;
  }
  return s;
}

/** log B(a, 1/2) = lgamma(a) + lgamma(1/2) − lgamma(a + 1/2), accurate for all a > 0. */
export function logBetaHalf(a: number): number {
  if (a < 15) return lgammaLanczos(a) + LN_SQRT_PI - lgammaLanczos(a + 0.5);
  // lgamma(a + 1/2) − lgamma(a) = ½ ln a + a·log1p(1/(2a)) − ½ + [corr(a + ½) − corr(a)]
  const diff =
    0.5 * Math.log(a) +
    a * Math.log1p(1 / (2 * a)) -
    0.5 +
    (stirlingCorrection(a + 0.5) - stirlingCorrection(a));
  return LN_SQRT_PI - diff;
}

function logBeta(a: number, b: number): number {
  if (b === 0.5) return logBetaHalf(a);
  if (a === 0.5) return logBetaHalf(b);
  return lgammaLanczos(a) + lgammaLanczos(b) - lgammaLanczos(a + b);
}

/** Continued fraction for I_x(a, b) (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  const EPS = 1e-16;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * Regularised incomplete beta I_x(a, b) given x and 1 − x separately (so that a tail
 * argument computed without cancellation keeps its precision), optionally with accurate
 * log(x) and log(1 − x).
 */
export function incompleteBeta(
  a: number,
  b: number,
  x: number,
  oneMinusX = 1 - x,
  logX = Math.log(x),
  logOneMinusX = Math.log(oneMinusX),
): number {
  if (x <= 0) return 0;
  if (oneMinusX <= 0) return 1;
  const lnFront = a * logX + b * logOneMinusX - logBeta(a, b);
  if (x < (a + 1) / (a + b + 2)) {
    return (Math.exp(lnFront) * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (Math.exp(lnFront) * betaContinuedFraction(b, a, oneMinusX)) / b;
}

/** P(T > |t|) for T ~ t(df): ½·I_x(df/2, ½), x = df/(df + t²), with accurate logarithms. */
function upperTailAbs(t: number, df: number): number {
  const t2 = t * t;
  const x = df / (df + t2);
  const omx = t2 / (df + t2);
  const logX = -Math.log1p(t2 / df);
  const logOmx = t2 === 0 ? -Infinity : Math.log(omx);
  return 0.5 * incompleteBeta(df / 2, 0.5, x, omx, logX, logOmx);
}

/** Lower-tail Student t CDF P(T ≤ t), df > 0 (stats::pt(t, df)). */
export function pt(t: number, df: number): number {
  if (Number.isNaN(t) || !(df > 0)) return NaN;
  if (t === Infinity) return 1;
  if (t === -Infinity) return 0;
  const tail = upperTailAbs(t, df); // P(T > |t|)
  return t > 0 ? 1 - tail : tail;
}

/** P(T ≤ −|t|) without cancellation (the bootstrap p-value building block). */
export function ptLowerTailAbs(t: number, df: number): number {
  if (Number.isNaN(t) || !(df > 0)) return NaN;
  if (!Number.isFinite(t)) return 0;
  return upperTailAbs(t, df);
}

/** stats::quantile(x, probs, type = 7, names = FALSE) for finite x. */
export function quantile7(x: readonly number[], probs: readonly number[]): number[] {
  const n = x.length;
  const sorted = [...x].sort((a, b) => a - b);
  return probs.map((p) => {
    const index = 1 + Math.max(n - 1, 0) * p;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    const qs = sorted[lo - 1]!;
    const xh = sorted[hi - 1]!;
    if (index > lo && xh !== qs) {
      const h = index - lo;
      return (1 - h) * qs + h * xh;
    }
    return qs;
  });
}

/** stats::sd (divisor n − 1). */
export function sampleSd(x: readonly number[]): number {
  const n = x.length;
  const m = mean(x);
  let ss = 0;
  for (const v of x) ss += (v - m) * (v - m);
  return Math.sqrt(ss / (n - 1));
}
