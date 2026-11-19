/**
 * Small dense linear-algebra helpers for the PLS engine (matrices are row-major number[][]).
 *
 * Numerics follow the R functions the reference engine uses:
 *  - `solveR` mirrors base::solve(): LU with partial pivoting (LAPACK dgesv; here ml-matrix's
 *    LuDecomposition) and the same refusal rule — an error when the reciprocal 1-norm
 *    condition number is below .Machine$double.eps ("system is computationally singular");
 *  - `symmetricEigenvalues` mirrors eigen(symmetric = TRUE) (ml-matrix's symmetric
 *    tridiagonal QL, same eigenvalues up to rounding);
 *  - `isPositiveSemiDefinite` mirrors cSEM:::isPositiveSemiDefinite (all eigenvalues
 *    >= -1e-8 and finite);
 *  - `correlation` mirrors stats::cor() for complete numeric data (Pearson, two-pass means).
 */
import { EigenvalueDecomposition, LuDecomposition, Matrix } from 'ml-matrix';

export type Mat = number[][];

export const DOUBLE_EPS = 2.220446049250313e-16;

/** Error raised where R itself would stop with an error (singular system, NaN input …). */
export class NumericalError extends Error {
  override readonly name = 'NumericalError';
}

export function zeros(r: number, c: number): Mat {
  return Array.from({ length: r }, () => new Array<number>(c).fill(0));
}

export function identity(n: number): Mat {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i]![i] = 1;
  return m;
}

export function transpose(a: Mat): Mat {
  const r = a.length;
  const c = r ? a[0]!.length : 0;
  const t = zeros(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) t[j]![i] = a[i]![j]!;
  return t;
}

export function matmul(a: Mat, b: Mat): Mat {
  const r = a.length;
  const inner = b.length;
  const c = inner ? b[0]!.length : 0;
  const out = zeros(r, c);
  for (let i = 0; i < r; i++) {
    const ai = a[i]!;
    const oi = out[i]!;
    for (let k = 0; k < inner; k++) {
      const v = ai[k]!;
      if (v === 0) continue;
      const bk = b[k]!;
      for (let j = 0; j < c; j++) oi[j]! += v * bk[j]!;
    }
  }
  return out;
}

/** Sub-matrix a[rows, cols]. */
export function sub(a: Mat, rows: readonly number[], cols: readonly number[]): Mat {
  return rows.map((i) => cols.map((j) => a[i]![j]!));
}

function norm1(a: Mat): number {
  const n = a.length;
  let best = 0;
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs(a[i]![j]!);
    if (!(s <= best)) best = s;
  }
  return best;
}

function assertFinite(a: Mat): void {
  for (const row of a)
    for (const v of row)
      if (!Number.isFinite(v)) throw new NumericalError('non-finite value in matrix');
}

/**
 * Inverse of a square matrix with base::solve()'s singularity rule. Throws NumericalError
 * when the matrix is exactly singular or its reciprocal condition number is below eps.
 */
export function inverseR(a: Mat): Mat {
  const n = a.length;
  if (n === 0) return [];
  assertFinite(a);
  const lu = new LuDecomposition(new Matrix(a));
  if (lu.isSingular()) throw new NumericalError('system is exactly singular');
  const inv = lu.solve(Matrix.eye(n)).to2DArray();
  assertFinite(inv);
  const rcond = 1 / (norm1(a) * norm1(inv));
  if (!(rcond >= DOUBLE_EPS)) throw new NumericalError('system is computationally singular');
  return inv;
}

/** solve(a, b) for a vector right-hand side, with base::solve()'s singularity rule. */
export function solveR(a: Mat, b: readonly number[]): number[] {
  const n = a.length;
  if (n === 0) return [];
  if (n === 1) {
    const d = a[0]![0]!;
    if (!Number.isFinite(d) || d === 0 || !Number.isFinite(b[0]!))
      throw new NumericalError('singular 1x1 system');
    return [b[0]! / d];
  }
  assertFinite(a);
  for (const v of b)
    if (!Number.isFinite(v)) throw new NumericalError('non-finite right-hand side');
  const lu = new LuDecomposition(new Matrix(a));
  if (lu.isSingular()) throw new NumericalError('system is exactly singular');
  // one factorisation: [b | I] gives the solution and the inverse for the condition check
  const rhs = Matrix.zeros(n, n + 1);
  for (let i = 0; i < n; i++) {
    rhs.set(i, 0, b[i]!);
    rhs.set(i, i + 1, 1);
  }
  const sol = lu.solve(rhs).to2DArray();
  const inv = sol.map((r) => r.slice(1));
  const rcond = 1 / (norm1(a) * norm1(inv));
  if (!(rcond >= DOUBLE_EPS)) throw new NumericalError('system is computationally singular');
  const x = sol.map((r) => r[0]!);
  for (const v of x) if (!Number.isFinite(v)) throw new NumericalError('non-finite solution');
  return x;
}

/** Eigenvalues of a symmetric matrix (descending order). */
export function symmetricEigenvalues(a: Mat): number[] {
  if (a.length === 0) return [];
  const ev = new EigenvalueDecomposition(new Matrix(a), { assumeSymmetric: true });
  return [...ev.realEigenvalues].sort((x, y) => y - x);
}

/** cSEM:::isPositiveSemiDefinite: every eigenvalue finite and >= -tolerance. */
export function isPositiveSemiDefinite(a: Mat, tolerance = 1e-8): boolean {
  for (const row of a) for (const v of row) if (!Number.isFinite(v)) return false;
  let ev: number[];
  try {
    ev = symmetricEigenvalues(a);
  } catch {
    return false;
  }
  return !ev.some((v) => !Number.isFinite(v) || v < -tolerance);
}

/** Copy the upper triangle onto the lower one (R: x[lower.tri(x)] <- t(x)[lower.tri(x)]). */
export function symmetrizeFromUpper(a: Mat): void {
  const n = a.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) a[i]![j] = a[j]![i]!;
}

/** Column means with R's two-pass refinement (mean(x) = s/n, then + mean(x - s/n)). */
export function mean(x: ArrayLike<number>): number {
  const n = x.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i]!;
  let m = s / n;
  let t = 0;
  for (let i = 0; i < n; i++) t += x[i]! - m;
  m += t / n;
  return m;
}

/** Sample standard deviation (divisor n - 1), as stats::sd(). */
export function sd(x: ArrayLike<number>): number {
  const n = x.length;
  const m = mean(x);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i]! - m;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1));
}

export interface CorrelationResult {
  /** Pearson correlation matrix (p x p), diagonal exactly 1. */
  S: Mat;
  /** Indices of columns with zero variance in the rows used (correlation undefined). */
  zeroVariance: number[];
}

/**
 * Pearson correlation of the columns of a data set given column-major as Float64Arrays,
 * over the rows `rows` (0-based, repetitions allowed: a bootstrap resample). Equals
 * stats::cor(X[rows, ]) up to floating-point summation order.
 */
export function correlation(
  columns: readonly Float64Array[],
  rows?: Int32Array | null,
): CorrelationResult {
  const p = columns.length;
  const n = rows ? rows.length : p ? columns[0]!.length : 0;
  const centered: Float64Array[] = [];
  const zeroVariance: number[] = [];
  const ss = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    const col = columns[j]!;
    const v = new Float64Array(n);
    if (rows) for (let r = 0; r < n; r++) v[r] = col[rows[r]!]!;
    else v.set(col.subarray(0, n));
    const m = mean(v);
    let s = 0;
    let allSame = true;
    const first = v[0];
    for (let r = 0; r < n; r++) {
      if (v[r] !== first) allSame = false;
      const d = v[r]! - m;
      v[r] = d;
      s += d * d;
    }
    if (allSame || !(s > 0)) zeroVariance.push(j);
    ss[j] = s;
    centered.push(v);
  }
  const S = zeros(p, p);
  for (let i = 0; i < p; i++) {
    S[i]![i] = 1;
    const ci = centered[i]!;
    for (let j = i + 1; j < p; j++) {
      const cj = centered[j]!;
      let s = 0;
      for (let r = 0; r < n; r++) s += ci[r]! * cj[r]!;
      let c = s / Math.sqrt(ss[i]! * ss[j]!);
      if (c > 1) c = 1;
      else if (c < -1) c = -1;
      S[i]![j] = c;
      S[j]![i] = c;
    }
  }
  return { S, zeroVariance };
}

/**
 * Numerical rank of a correlation matrix with base::qr(x, tol)'s rule (LINPACK dqrdc2 with
 * limited column pivoting): a column is dependent when its norm after orthogonalisation
 * against the kept columns falls below tol times its original norm.
 */
export function qrRank(a: Mat, tol = 1e-10): number {
  const n = a.length;
  if (n === 0) return 0;
  const cols = transpose(a).map((c) => [...c]);
  const kept: number[][] = [];
  for (const c of cols) {
    const orig = Math.hypot(...c);
    const v = [...c];
    for (const q of kept) {
      let d = 0;
      for (let i = 0; i < n; i++) d += q[i]! * v[i]!;
      for (let i = 0; i < n; i++) v[i]! -= d * q[i]!;
    }
    const nv = Math.hypot(...v);
    if (orig > 0 && nv >= tol * orig) kept.push(v.map((x) => x / nv));
  }
  return kept.length;
}
