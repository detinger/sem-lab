/**
 * Small dense matrix kernel for the CB-SEM engine. Row-major Float64Array storage; sizes are
 * small (p ≤ a few dozen), so plain loops beat any abstraction. Everything is pure.
 */
import { EigenvalueDecomposition, Matrix } from 'ml-matrix';

export class Mat {
  readonly r: number;
  readonly c: number;
  readonly d: Float64Array;

  constructor(r: number, c: number, d?: Float64Array) {
    this.r = r;
    this.c = c;
    this.d = d ?? new Float64Array(r * c);
  }

  static zeros(r: number, c: number): Mat {
    return new Mat(r, c);
  }

  static identity(n: number): Mat {
    const m = new Mat(n, n);
    for (let i = 0; i < n; i++) m.d[i * n + i] = 1;
    return m;
  }

  static from(rows: readonly (readonly number[])[]): Mat {
    const r = rows.length;
    const c = r === 0 ? 0 : rows[0]!.length;
    const m = new Mat(r, c);
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) m.d[i * c + j] = rows[i]![j]!;
    return m;
  }

  get(i: number, j: number): number {
    return this.d[i * this.c + j]!;
  }

  set(i: number, j: number, v: number): void {
    this.d[i * this.c + j] = v;
  }

  add(i: number, j: number, v: number): void {
    this.d[i * this.c + j] = this.d[i * this.c + j]! + v;
  }

  clone(): Mat {
    return new Mat(this.r, this.c, Float64Array.from(this.d));
  }

  toArray(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.r; i++)
      out.push(Array.from(this.d.subarray(i * this.c, (i + 1) * this.c)));
    return out;
  }
}

export function mul(a: Mat, b: Mat): Mat {
  const out = new Mat(a.r, b.c);
  const ad = a.d;
  const bd = b.d;
  const od = out.d;
  for (let i = 0; i < a.r; i++) {
    for (let k = 0; k < a.c; k++) {
      const aik = ad[i * a.c + k]!;
      if (aik === 0) continue;
      const bo = k * b.c;
      const oo = i * b.c;
      for (let j = 0; j < b.c; j++) od[oo + j] = od[oo + j]! + aik * bd[bo + j]!;
    }
  }
  return out;
}

export function transpose(a: Mat): Mat {
  const out = new Mat(a.c, a.r);
  for (let i = 0; i < a.r; i++)
    for (let j = 0; j < a.c; j++) out.d[j * a.r + i] = a.d[i * a.c + j]!;
  return out;
}

/** a · b · aᵀ */
export function sandwich(a: Mat, b: Mat): Mat {
  return mul(mul(a, b), transpose(a));
}

export function addMat(a: Mat, b: Mat): Mat {
  const out = new Mat(a.r, a.c);
  for (let i = 0; i < a.d.length; i++) out.d[i] = a.d[i]! + b.d[i]!;
  return out;
}

export function subMat(a: Mat, b: Mat): Mat {
  const out = new Mat(a.r, a.c);
  for (let i = 0; i < a.d.length; i++) out.d[i] = a.d[i]! - b.d[i]!;
  return out;
}

export function scaleMat(a: Mat, s: number): Mat {
  const out = new Mat(a.r, a.c);
  for (let i = 0; i < a.d.length; i++) out.d[i] = a.d[i]! * s;
  return out;
}

export function symmetrize(a: Mat): Mat {
  const out = a.clone();
  for (let i = 0; i < a.r; i++)
    for (let j = 0; j < i; j++) {
      const v = 0.5 * (a.get(i, j) + a.get(j, i));
      out.set(i, j, v);
      out.set(j, i, v);
    }
  return out;
}

export function matVec(a: Mat, v: Float64Array): Float64Array {
  const out = new Float64Array(a.r);
  for (let i = 0; i < a.r; i++) {
    let s = 0;
    for (let j = 0; j < a.c; j++) s += a.d[i * a.c + j]! * v[j]!;
    out[i] = s;
  }
  return out;
}

export function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Σ_ij a_ij b_ij (= tr(aᵀb)). */
export function frob(a: Mat, b: Mat): number {
  let s = 0;
  for (let i = 0; i < a.d.length; i++) s += a.d[i]! * b.d[i]!;
  return s;
}

/** Lower Cholesky factor, or null when the matrix is not (numerically) positive definite. */
export function cholesky(a: Mat): Mat | null {
  const n = a.r;
  const l = new Mat(n, n);
  for (let j = 0; j < n; j++) {
    let s = a.get(j, j);
    for (let k = 0; k < j; k++) s -= l.get(j, k) ** 2;
    if (!(s > 0) || !Number.isFinite(s)) return null;
    const ljj = Math.sqrt(s);
    l.set(j, j, ljj);
    for (let i = j + 1; i < n; i++) {
      let t = a.get(i, j);
      for (let k = 0; k < j; k++) t -= l.get(i, k) * l.get(j, k);
      l.set(i, j, t / ljj);
    }
  }
  return l;
}

/** Inverse and log-determinant of a symmetric positive-definite matrix; null if not PD. */
export function spdInverse(a: Mat): { inv: Mat; logdet: number } | null {
  const n = a.r;
  const l = cholesky(a);
  if (!l) return null;
  let logdet = 0;
  for (let i = 0; i < n; i++) logdet += 2 * Math.log(l.get(i, i));
  // inv(L)
  const li = new Mat(n, n);
  for (let j = 0; j < n; j++) {
    li.set(j, j, 1 / l.get(j, j));
    for (let i = j + 1; i < n; i++) {
      let s = 0;
      for (let k = j; k < i; k++) s -= l.get(i, k) * li.get(k, j);
      li.set(i, j, s / l.get(i, i));
    }
  }
  // inv(A) = inv(L)ᵀ inv(L)
  const inv = new Mat(n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = i; k < n; k++) s += li.get(k, i) * li.get(k, j);
      inv.set(i, j, s);
      inv.set(j, i, s);
    }
  return { inv, logdet };
}

/** General inverse by LU with partial pivoting; null when (numerically) singular. */
export function inverse(a: Mat): Mat | null {
  const n = a.r;
  const m = a.clone();
  const inv = Mat.identity(n);
  let maxAbs = 0;
  for (const v of a.d) maxAbs = Math.max(maxAbs, Math.abs(v));
  const tiny = maxAbs * n * Number.EPSILON;
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(m.get(col, col));
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m.get(r, col));
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (!(best > tiny)) return null;
    if (piv !== col) {
      for (let j = 0; j < n; j++) {
        const t = m.get(col, j);
        m.set(col, j, m.get(piv, j));
        m.set(piv, j, t);
        const u = inv.get(col, j);
        inv.set(col, j, inv.get(piv, j));
        inv.set(piv, j, u);
      }
    }
    const d = m.get(col, col);
    for (let j = 0; j < n; j++) {
      m.set(col, j, m.get(col, j) / d);
      inv.set(col, j, inv.get(col, j) / d);
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m.get(r, col);
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        m.set(r, j, m.get(r, j) - f * m.get(col, j));
        inv.set(r, j, inv.get(r, j) - f * inv.get(col, j));
      }
    }
  }
  return inv;
}

/** Solve a·x = b (a square). Null when singular. */
export function solve(a: Mat, b: Float64Array): Float64Array | null {
  const inv = inverse(a);
  return inv ? matVec(inv, b) : null;
}

/** Eigen-decomposition of a symmetric matrix: values in DEcreasing order, vectors as columns. */
export function symEigen(a: Mat): { values: number[]; vectors: Mat } {
  const e = new EigenvalueDecomposition(new Matrix(a.toArray()), { assumeSymmetric: true });
  const vals = e.realEigenvalues;
  const vecs = e.eigenvectorMatrix;
  const order = vals.map((_, i) => i).sort((x, y) => vals[y]! - vals[x]!);
  const vectors = new Mat(a.r, a.r);
  order.forEach((src, dst) => {
    for (let i = 0; i < a.r; i++) vectors.set(i, dst, vecs.get(i, src));
  });
  return { values: order.map((i) => vals[i]!), vectors };
}

export function symEigenvalues(a: Mat): number[] {
  return symEigen(a).values;
}

/** Sub-matrix with the given row and column indices. */
export function subset(a: Mat, rows: readonly number[], cols: readonly number[] = rows): Mat {
  const out = new Mat(rows.length, cols.length);
  for (let i = 0; i < rows.length; i++)
    for (let j = 0; j < cols.length; j++) out.set(i, j, a.get(rows[i]!, cols[j]!));
  return out;
}
