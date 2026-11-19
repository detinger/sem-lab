/**
 * Pure formulas behind the Learn demos. Every number a demo shows comes from here, so the
 * formulas are unit-tested against hand-computed values (math.test.ts) and, for RMSEA / CFI,
 * against the CB engine's own functions.
 */
import { RMersenneTwister, bootstrapIndices, quantile7 } from '@sem-studio/engine';

const mean = (x: readonly number[]): number => x.reduce((s, v) => s + v, 0) / x.length;

// ---- Reliability from standardized loadings ------------------------------------------------

export interface ReliabilityResult {
  /** implied correlations r_ij = λi·λj for i < j, row-major over the upper triangle */
  pairs: { i: number; j: number; r: number }[];
  meanR: number;
  /** standardized Cronbach's α = k·r̄ / (1 + (k − 1)·r̄) */
  alpha: number;
  /** composite reliability ρC = (Σλ)² / ((Σλ)² + Σ(1 − λ²)) */
  rhoC: number;
  /** average variance extracted = Σλ² / k */
  ave: number;
}

export function reliabilityFromLoadings(lambdas: readonly number[]): ReliabilityResult {
  const k = lambdas.length;
  const pairs: ReliabilityResult['pairs'] = [];
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) pairs.push({ i, j, r: lambdas[i]! * lambdas[j]! });
  const meanR = pairs.length > 0 ? mean(pairs.map((p) => p.r)) : 0;
  const sum = lambdas.reduce((s, l) => s + l, 0);
  const err = lambdas.reduce((s, l) => s + (1 - l * l), 0);
  return {
    pairs,
    meanR,
    alpha: (k * meanR) / (1 + (k - 1) * meanR),
    rhoC: (sum * sum) / (sum * sum + err),
    ave: lambdas.reduce((s, l) => s + l * l, 0) / k,
  };
}

// ---- HTMT, VIF, f² -------------------------------------------------------------------------

/** HTMT = mean heterotrait correlation / √(mean monotrait A · mean monotrait B). */
export function htmt(h: number, a: number, b: number): number | null {
  const d = a * b;
  return d > 0 ? h / Math.sqrt(d) : null;
}

/** VIF = 1 / (1 − R²); undefined (null) at R² ≥ 1. */
export function vif(r2: number): number | null {
  return r2 < 1 ? 1 / (1 - r2) : null;
}

/** f² = (R²included − R²excluded) / (1 − R²included); null when R²included ≥ 1. */
export function fSquared(r2In: number, r2Ex: number): number | null {
  return r2In < 1 ? (r2In - r2Ex) / (1 - r2In) : null;
}

export function fSquaredLabel(f2: number): 'none' | 'small' | 'medium' | 'large' {
  if (f2 >= 0.35) return 'large';
  if (f2 >= 0.15) return 'medium';
  if (f2 >= 0.02) return 'small';
  return 'none';
}

// ---- Mediation (Zhao, Lynch & Chen 2010) -----------------------------------------------------

export type MediationType =
  'complementary' | 'competitive' | 'indirect-only' | 'direct-only' | 'no-effect';

export interface MediationResult {
  indirect: number;
  total: number;
  /** null when both effects are flagged significant but a path is exactly 0 (sign undefined) */
  type: MediationType | null;
}

export function mediation(
  a: number,
  b: number,
  cPrime: number,
  indirectSignificant: boolean,
  directSignificant: boolean,
): MediationResult {
  const indirect = a * b;
  const total = cPrime + indirect;
  let type: MediationType | null;
  if (indirectSignificant && directSignificant) {
    const product = indirect * cPrime;
    type = product > 0 ? 'complementary' : product < 0 ? 'competitive' : null;
  } else if (indirectSignificant) type = 'indirect-only';
  else if (directSignificant) type = 'direct-only';
  else type = 'no-effect';
  return { indirect, total, type };
}

// ---- Bootstrap ---------------------------------------------------------------------------------

/** 25 observations (x, y): 1–7 ratings of two related items, fixed so the demo is reproducible. */
export const BOOTSTRAP_SAMPLE: readonly (readonly [number, number])[] = [
  [5, 4],
  [6, 6],
  [4, 3],
  [7, 6],
  [3, 4],
  [5, 5],
  [6, 5],
  [2, 3],
  [5, 6],
  [4, 4],
  [6, 7],
  [3, 2],
  [5, 4],
  [7, 7],
  [4, 5],
  [6, 6],
  [2, 2],
  [5, 5],
  [4, 3],
  [6, 5],
  [3, 3],
  [7, 6],
  [5, 6],
  [4, 5],
  [6, 7],
];

export type BootstrapStatistic = 'mean' | 'correlation';

export function sampleStatistic(
  pairs: readonly (readonly [number, number])[],
  stat: BootstrapStatistic,
): number {
  if (stat === 'mean') return mean(pairs.map((p) => p[0]));
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN;
}

export interface BootstrapRun {
  estimate: number;
  draws: number[];
  /** standard deviation of the draws, divisor B − 1 */
  se: number;
  /** percentile interval, quantile type 7 (R's default) */
  ci: [number, number];
  level: number;
  /** draws that could not be computed (a correlation needs variation in both columns) */
  dropped: number;
}

/**
 * Nonparametric bootstrap of the embedded sample with the engine's R-compatible generator:
 * resample i is `sample.int(n, n, replace = TRUE)` after `set.seed(seed)`.
 */
export function bootstrap(
  stat: BootstrapStatistic,
  B: number,
  seed: number,
  level = 0.95,
  data: readonly (readonly [number, number])[] = BOOTSTRAP_SAMPLE,
): BootstrapRun {
  new RMersenneTwister(seed); // validates the seed (R integer) with the engine's own check
  const draws: number[] = [];
  let dropped = 0;
  for (const idx of bootstrapIndices(seed, data.length, B)) {
    const v = sampleStatistic(
      Array.from(idx, (i) => data[i]!),
      stat,
    );
    if (Number.isFinite(v)) draws.push(v);
    else dropped++;
  }
  const m = mean(draws);
  const se = Math.sqrt(draws.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(draws.length - 1, 1));
  const [lo, hi] = quantile7(draws, [(1 - level) / 2, 1 - (1 - level) / 2]) as [number, number];
  return { estimate: sampleStatistic(data, stat), draws, se, ci: [lo, hi], level, dropped };
}

export function histogram(
  values: readonly number[],
  bins: number,
): { x0: number; x1: number; count: number }[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const w = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({
    x0: lo + i * w,
    x1: lo + (i + 1) * w,
    count: 0,
  }));
  for (const v of values) out[Math.min(Math.floor((v - lo) / w), bins - 1)]!.count++;
  return out;
}

// ---- IPMA rescaling ----------------------------------------------------------------------------

/** Performance on 0–100: (mean − min) / (max − min) × 100. */
export function performance(meanValue: number, min: number, max: number): number | null {
  return max > min ? ((meanValue - min) / (max - min)) * 100 : null;
}

// ---- RMSEA / CFI (CB engine, lavaan conventions) ----------------------------------------------

/** lavaan::lav_fit_rmsea (single group): sqrt(max(X² / (N·df) − 1/N, 0)); 0 when df = 0. */
export function rmsea(x2: number, df: number, n: number): number {
  if (!(df > 0)) return 0;
  return Math.sqrt(Math.max(x2 / n / df - 1 / n, 0));
}

/** lavaan::lav_fit_cfi: 1 − max(X² − df, 0) / max(X² − df, X²_B − df_B, 0); 1 when both are ~0. */
export function cfi(x2: number, df: number, x2b: number, dfb: number): number {
  const t1 = Math.max(x2 - df, 0);
  const t2 = Math.max(x2 - df, x2b - dfb, 0);
  if (Math.abs(t1) < 1.5e-8 && Math.abs(t2) < 1.5e-8) return 1;
  return 1 - t1 / t2;
}
