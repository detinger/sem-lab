/**
 * Descriptive statistics, correlations and missingness (PLAN §2.2 steps 3 and 7).
 *
 * Conventions (docs/validation/phase-0/data-recon.md; reproduced to ≤ 1e-9 relative against
 * the values SmartPLS stores, see stats.test.ts):
 *  - every statistic is over the non-missing values of the column;
 *  - median = UPPER median, sorted[floor(n / 2)];
 *  - sdPopulation divides by n, sdSample by n − 1 (both are returned and labelled);
 *  - skewness = adjusted Fisher–Pearson G1 = g1·√(n(n−1))/(n−2), g1 = m3/m2^1.5;
 *  - kurtosis = adjusted excess G2 = (n−1)/((n−2)(n−3))·((n+1)·g2 + 6), g2 = m4/m2² − 3;
 *  - m_k are central moments with divisor n, from deviations about the mean (two-pass), with
 *    Neumaier-compensated sums.
 * Undefined statistics are null, never NaN: mean/median/sdPopulation need n ≥ 1, sdSample
 * n ≥ 2, skewness n ≥ 3, kurtosis n ≥ 4; skewness and kurtosis are null for a constant column.
 *
 * Histogram rule: Sturges, k = ceil(log2 n) + 1, clamped to [10, 30] equal-width bins over
 * [min, max]; the last bin includes max. Used when a column is not integer-valued with ≤ 15
 * distinct values (those get `valueCounts` instead).
 */
import type {
  ColumnProfile,
  CorrelationMatrix,
  Dataset,
  DatasetColumn,
  MissingnessSummary,
} from './types';

export const MAX_VALUE_COUNTS = 15;
export const MIN_BINS = 10;
export const MAX_BINS = 30;
const MAX_PATTERNS = 50;

/** Neumaier (improved Kahan) summation. */
export function compensatedSum(xs: ArrayLike<number>): number {
  let sum = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return sum + c;
}

/** Non-missing (non-NaN) values of a numeric column, in row order. */
export function presentValues(values: Float64Array): Float64Array {
  let n = 0;
  for (const v of values) if (!Number.isNaN(v)) n++;
  const out = new Float64Array(n);
  let k = 0;
  for (const v of values) if (!Number.isNaN(v)) out[k++] = v;
  return out;
}

/** Two-pass mean with a correction term (accurate even for large offsets). */
export function mean(xs: Float64Array): number | null {
  const n = xs.length;
  if (n === 0) return null;
  const m0 = compensatedSum(xs) / n;
  const dev = new Float64Array(n);
  for (let i = 0; i < n; i++) dev[i] = (xs[i] as number) - m0;
  return m0 + compensatedSum(dev) / n;
}

export interface Moments {
  n: number;
  mean: number;
  /** central moments with divisor n */
  m2: number;
  m3: number;
  m4: number;
  min: number;
  max: number;
}

export function moments(xs: Float64Array): Moments | null {
  const n = xs.length;
  const mu = mean(xs);
  if (mu === null) return null;
  let min = Infinity;
  let max = -Infinity;
  const d2 = new Float64Array(n);
  const d3 = new Float64Array(n);
  const d4 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = xs[i] as number;
    if (x < min) min = x;
    if (x > max) max = x;
    const d = x - mu;
    const sq = d * d;
    d2[i] = sq;
    d3[i] = sq * d;
    d4[i] = sq * sq;
  }
  if (min === max) return { n, mean: min, m2: 0, m3: 0, m4: 0, min, max };
  return {
    n,
    mean: mu,
    m2: compensatedSum(d2) / n,
    m3: compensatedSum(d3) / n,
    m4: compensatedSum(d4) / n,
    min,
    max,
  };
}

/** Sample standard deviation (divisor n − 1); null when n < 2. */
export function sdSample(m: Moments): number | null {
  return m.n < 2 ? null : Math.sqrt((m.m2 * m.n) / (m.n - 1));
}

export function skewnessG1(m: Moments): number | null {
  if (m.n < 3 || m.min === m.max || m.m2 <= 0) return null;
  const g1 = m.m3 / Math.pow(m.m2, 1.5);
  return (g1 * Math.sqrt(m.n * (m.n - 1))) / (m.n - 2);
}

export function kurtosisG2(m: Moments): number | null {
  if (m.n < 4 || m.min === m.max || m.m2 <= 0) return null;
  const g2 = m.m4 / (m.m2 * m.m2) - 3;
  return ((m.n - 1) / ((m.n - 2) * (m.n - 3))) * ((m.n + 1) * g2 + 6);
}

export function histogramBinCount(n: number): number {
  const sturges = Math.ceil(Math.log2(Math.max(n, 1))) + 1;
  return Math.min(MAX_BINS, Math.max(MIN_BINS, sturges));
}

export function profileColumn(col: DatasetColumn): ColumnProfile {
  const base = {
    name: col.name,
    kind: col.kind,
    mean: null,
    median: null,
    sdSample: null,
    sdPopulation: null,
    skewness: null,
    kurtosis: null,
    min: null,
    max: null,
    integerValued: false,
  };
  switch (col.kind) {
    case 'empty':
      return { ...base, n: 0, nMissing: col.length, nUnique: 0 };
    case 'text': {
      const present = col.values.filter((v): v is string => v !== null);
      return {
        ...base,
        n: present.length,
        nMissing: col.values.length - present.length,
        nUnique: new Set(present).size,
        nonNumericCount: col.nonNumericCount,
        nonNumericExamples: [...col.examples],
      };
    }
    case 'numeric':
      return profileNumeric(col.name, col.values);
  }
}

function profileNumeric(name: string, values: Float64Array): ColumnProfile {
  const xs = presentValues(values);
  const n = xs.length;
  const sorted = Float64Array.from(xs).sort();
  const counts = new Map<number, number>();
  let integerValued = n > 0;
  for (const x of sorted) {
    counts.set(x, (counts.get(x) ?? 0) + 1);
    if (!Number.isInteger(x)) integerValued = false;
  }
  const m = moments(xs);
  const profile: ColumnProfile = {
    name,
    kind: 'numeric',
    n,
    nMissing: values.length - n,
    nUnique: counts.size,
    mean: m ? m.mean : null,
    median: n > 0 ? (sorted[Math.floor(n / 2)] as number) : null,
    sdSample: m ? sdSample(m) : null,
    sdPopulation: m ? Math.sqrt(m.m2) : null,
    skewness: m ? skewnessG1(m) : null,
    kurtosis: m ? kurtosisG2(m) : null,
    min: m ? m.min : null,
    max: m ? m.max : null,
    integerValued,
  };
  if (n === 0) return profile;
  if (integerValued && counts.size <= MAX_VALUE_COUNTS) {
    profile.valueCounts = [...counts].map(([value, count]) => ({ value, count }));
  } else {
    profile.histogram = histogram(sorted);
  }
  return profile;
}

function histogram(sorted: Float64Array): Array<{ from: number; to: number; count: number }> {
  const n = sorted.length;
  const min = sorted[0] as number;
  const max = sorted[n - 1] as number;
  if (min === max) return [{ from: min, to: max, count: n }];
  const k = histogramBinCount(n);
  const width = (max - min) / k;
  const bins = Array.from({ length: k }, (_, i) => ({
    from: min + i * width,
    to: i === k - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const x of sorted) {
    const i = Math.min(k - 1, Math.floor((x - min) / width));
    (bins[i] as { count: number }).count++;
  }
  return bins;
}

export function profileDataset(dataset: Pick<Dataset, 'columns'>): ColumnProfile[] {
  return dataset.columns.map(profileColumn);
}

// ---------------------------------------------------------------- correlations

function numericValues(dataset: Pick<Dataset, 'columns' | 'rowIndex'>, name: string): Float64Array {
  const col = dataset.columns.find((c) => c.name === name);
  if (!col) throw new Error(`Unknown column "${name}".`);
  if (col.kind === 'numeric') return col.values;
  // Text and empty columns carry no numeric values: every cell counts as missing.
  return new Float64Array(dataset.rowIndex.length).fill(NaN);
}

/**
 * Pearson correlations. 'pairwise' uses, for each pair, the rows where both are present;
 * 'listwise' uses only rows complete on ALL requested columns. r is null when fewer than 3
 * rows are available or either variable is constant on them.
 */
export function correlations(
  dataset: Pick<Dataset, 'columns' | 'rowIndex'>,
  columns: readonly string[],
  method: 'pairwise' | 'listwise',
): CorrelationMatrix {
  const data = columns.map((c) => numericValues(dataset, c));
  const nRows = dataset.rowIndex.length;
  let complete: boolean[] | null = null;
  if (method === 'listwise') {
    complete = Array.from({ length: nRows }, (_, i) =>
      data.every((v) => !Number.isNaN(v[i] as number)),
    );
  }
  const p = columns.length;
  const values: (number | null)[][] = Array.from({ length: p }, () =>
    new Array<number | null>(p).fill(null),
  );
  const n: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      const xa = data[a] as Float64Array;
      const xb = data[b] as Float64Array;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < nRows; i++) {
        const x = xa[i] as number;
        const y = xb[i] as number;
        if (complete ? complete[i] : !Number.isNaN(x) && !Number.isNaN(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
      const r = pearson(Float64Array.from(xs), Float64Array.from(ys));
      (values[a] as (number | null)[])[b] = r;
      (values[b] as (number | null)[])[a] = r;
      (n[a] as number[])[b] = xs.length;
      (n[b] as number[])[a] = xs.length;
    }
  }
  return { columns: [...columns], values, method, n };
}

export function pearson(x: Float64Array, y: Float64Array): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x) as number;
  const my = mean(y) as number;
  const sxy = new Float64Array(n);
  const sxx = new Float64Array(n);
  const syy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy[i] = dx * dy;
    sxx[i] = dx * dx;
    syy[i] = dy * dy;
  }
  const vx = compensatedSum(sxx);
  const vy = compensatedSum(syy);
  if (!(vx > 0) || !(vy > 0)) return null;
  const r = compensatedSum(sxy) / Math.sqrt(vx * vy);
  return Math.max(-1, Math.min(1, r));
}

// ---------------------------------------------------------------- missingness

function missingMask(dataset: Pick<Dataset, 'columns' | 'rowIndex'>, name: string): boolean[] {
  const col = dataset.columns.find((c) => c.name === name);
  if (!col) throw new Error(`Unknown column "${name}".`);
  switch (col.kind) {
    case 'numeric':
      return Array.from(col.values, (v) => Number.isNaN(v));
    case 'text':
      return col.values.map((v) => v === null);
    case 'empty':
      return new Array<boolean>(col.length).fill(true);
  }
}

export function missingness(
  dataset: Pick<Dataset, 'columns' | 'rowIndex'>,
  columns: readonly string[],
): MissingnessSummary {
  const masks = columns.map((c) => missingMask(dataset, c));
  const rows = dataset.rowIndex.length;
  const patterns = new Map<string, { missing: boolean[]; count: number }>();
  let completeRows = 0;
  for (let i = 0; i < rows; i++) {
    const missing = masks.map((m) => m[i] === true);
    if (!missing.includes(true)) completeRows++;
    const key = missing.map((b) => (b ? '1' : '0')).join('');
    const entry = patterns.get(key);
    if (entry) entry.count++;
    else patterns.set(key, { missing, count: 1 });
  }
  const sorted = [...patterns.entries()]
    .sort(([ka, a], [kb, b]) => b.count - a.count || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .slice(0, MAX_PATTERNS)
    .map(([, v]) => v);
  return {
    rows,
    completeRows,
    byColumn: columns.map((column, j) => ({
      column,
      missing: (masks[j] as boolean[]).filter(Boolean).length,
    })),
    patterns: sorted,
  };
}
