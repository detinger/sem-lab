/**
 * SEM Studio's bootstrap definition (the one the exported R/Python scripts reproduce; it
 * replaces cSEM's resampler and the R engine's chunked seeds):
 *
 *   set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")
 *   for (b in 1:B) {
 *     idx_b <- sample.int(n, n, replace = TRUE)   # one RNG stream, drawn sequentially
 *     refit the full model on data[idx_b, ]         # same csem() options as the main fit
 *     failed       if the fit errors, does not converge or gives a non-finite estimate
 *     inadmissible if cSEM::verify() flags it
 *   }
 *   valid draws only: se = sd (divisor B_valid − 1); t = est / se;
 *   p = 2·P(T ≤ −|t|), T ~ t(B_valid − 1) (one-sided: P(T ≤ −|t|), direction of the estimate);
 *   CI = quantile(type = 7) percentile; one-sided: est ≥ 0 → lower = q(1 − L), upper null;
 *   est < 0 → upper = q(L), lower null. Total / indirect / specific effects per draw.
 *
 * Parallel use: `bootstrapIndices` generates the resamples in R's order (cheap, sequential);
 * `fitDraw` is a pure function of (problem, idx) and can run in any Web Worker; collect the
 * results back into draw order and call `summariseBootstrap`. Reference:
 * packages/fixtures/scripts/make_bootstrap_references.R.
 */
import { correlation, NumericalError } from '../linalg/index.ts';
import { RMersenneTwister } from '../rng/r-mt.ts';
import { ptLowerTailAbs, quantile7, sampleSd } from '../shared/stats.ts';
import { type CoreFit, type CoreModel, fitPls, verify, type VerifyCheck } from './core.ts';

/** Where each estimated parameter lives in a CoreFit: B[row][col], Lambda[row][col], W[row][col]. */
export interface ThetaSlot {
  kind: 'path' | 'loading' | 'weight';
  row: number;
  col: number;
}

/** Everything a worker needs to fit one draw (structured-cloneable). */
export interface BootstrapProblem {
  core: CoreModel;
  disattenuate: boolean;
  /** analysis matrix, column-major, model indicator order */
  columns: Float64Array[];
  theta: ThetaSlot[];
}

export type DrawResult =
  | { status: 'ok'; theta: number[] }
  | { status: 'failed'; reason: 'error' | 'nonconvergence' | 'non-finite' }
  | { status: 'inadmissible'; checks: VerifyCheck[]; theta: number[] };

/**
 * The bootstrap resamples in R's order: draw b is `sample.int(n, n, replace = TRUE) − 1`
 * (0-based row indices) after `set.seed(seed, "Mersenne-Twister", "Inversion", "Rejection")`.
 */
export function* bootstrapIndices(seed: number, n: number, B: number): Generator<Int32Array> {
  const rng = new RMersenneTwister(seed);
  for (let b = 0; b < B; b++) {
    const idx = rng.sampleIntReplace(n, n);
    for (let i = 0; i < n; i++) idx[i]!--;
    yield idx;
  }
}

export function extractTheta(fit: CoreFit, slots: readonly ThetaSlot[]): number[] {
  return slots.map((s) =>
    s.kind === 'path'
      ? fit.B[s.row]![s.col]!
      : s.kind === 'loading'
        ? fit.Lambda[s.row]![s.col]!
        : fit.W[s.row]![s.col]!,
  );
}

/** Refit the model on the rows `idx` (0-based, with repetitions) and classify the draw. */
export function fitDraw(problem: BootstrapProblem, idx: Int32Array): DrawResult {
  const { S, zeroVariance } = correlation(problem.columns, idx);
  if (zeroVariance.length > 0) return { status: 'failed', reason: 'error' };
  let fit: CoreFit;
  try {
    fit = fitPls(S, problem.core, problem.disattenuate, idx.length);
  } catch (e) {
    if (e instanceof NumericalError) return { status: 'failed', reason: 'error' };
    throw e;
  }
  if (!fit.converged) return { status: 'failed', reason: 'nonconvergence' };
  const theta = extractTheta(fit, problem.theta);
  if (theta.some((v) => !Number.isFinite(v))) return { status: 'failed', reason: 'non-finite' };
  const checks = verify(S, fit, problem.core);
  if (checks.length > 0) return { status: 'inadmissible', checks, theta };
  return { status: 'ok', theta };
}

export interface BootstrapCounts {
  requested: number;
  completed: number;
  failed: number;
  inadmissible: number;
  /** valid draws in draw order: valid[d][i] belongs to theta slot i */
  valid: number[][];
}

/** Count draws (in draw order) and keep the valid parameter vectors. */
export function summariseBootstrap(drawsInOrder: readonly DrawResult[]): BootstrapCounts {
  const valid: number[][] = [];
  let failed = 0;
  let inadmissible = 0;
  for (const d of drawsInOrder) {
    if (d.status === 'ok') valid.push(d.theta);
    else if (d.status === 'failed') failed++;
    else inadmissible++;
  }
  return { requested: drawsInOrder.length, completed: valid.length, failed, inadmissible, valid };
}

export interface Inference {
  nValid: number;
  se: number | null;
  statistic: number | null;
  pValue: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  /** reason for the nulls when the whole inference is unavailable */
  reason?: 'failed' | 'non-finite';
}

/** Inference for one parameter from its valid draws (R engine infer_from_draws). */
export function inferFromDraws(
  est: number,
  drawsIn: readonly number[],
  level: number,
  sides: 'two-sided' | 'one-sided',
): Inference {
  const draws = drawsIn.filter((v) => Number.isFinite(v));
  const nv = draws.length;
  if (!Number.isFinite(est) || nv < 2) {
    return {
      nValid: nv,
      se: null,
      statistic: null,
      pValue: null,
      ciLower: null,
      ciUpper: null,
      reason: Number.isFinite(est) ? 'failed' : 'non-finite',
    };
  }
  const se = sampleSd(draws);
  const t = est / se;
  const df = nv - 1;
  let p: number;
  let lo: number | null;
  let hi: number | null;
  if (sides === 'two-sided') {
    p = 2 * ptLowerTailAbs(t, df);
    const q = quantile7(draws, [(1 - level) / 2, 1 - (1 - level) / 2]);
    lo = q[0]!;
    hi = q[1]!;
  } else {
    p = ptLowerTailAbs(t, df);
    if (est >= 0) {
      lo = quantile7(draws, [1 - level])[0]!;
      hi = null;
    } else {
      lo = null;
      hi = quantile7(draws, [level])[0]!;
    }
  }
  if (Number.isFinite(p)) p = Math.min(1, Math.max(0, p));
  return { nValid: nv, se, statistic: t, pValue: p, ciLower: lo, ciUpper: hi };
}
