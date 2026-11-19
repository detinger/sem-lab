/**
 * Data preparation for CB-SEM: column resolution, listwise deletion or FIML pattern grouping,
 * divisor-N sample moments (lavaan likelihood = "normal"), and the saturated (h1) moments for
 * incomplete data by EM.
 */
import type { SemModel } from '@sem-studio/contracts';
import { Mat, spdInverse } from './matrix.ts';
import type { Pattern, SampleData } from './objective.ts';

export interface CbDataInput {
  /** Column names, in the order of the values in each row. */
  columns: string[];
  /** Row-major values; null = missing. */
  rows: (number | null)[][];
  /** Rows in the original dataset (before any rows were removed by the caller). */
  nRows: number;
  /** Rows the caller removed before passing `rows` (nRows − nDropped = rows.length). */
  nDropped: number;
}

export interface DataError {
  code:
    | 'REQUEST_INVALID'
    | 'DATA_COLUMN_MISSING'
    | 'DATA_NOT_NUMERIC'
    | 'DATA_INSUFFICIENT_ROWS'
    | 'DATA_ZERO_VARIANCE';
  message: string;
  details?: Record<string, unknown>;
}

export interface PreparedData {
  data: SampleData;
  /** Rows used for estimation. */
  nUsed: number;
  /** Rows of `rows` not used (listwise deletion, or all values missing under FIML). */
  nExcluded: number;
}

export function prepareData(
  model: SemModel,
  ovIds: readonly string[],
  input: CbDataInput,
  missing: 'listwise' | 'fiml',
): { ok: true; value: PreparedData } | { ok: false; error: DataError } {
  const fail = (code: DataError['code'], message: string, details?: Record<string, unknown>) =>
    ({ ok: false, error: { code, message, ...(details ? { details } : {}) } }) as const;
  if (input.nRows - input.nDropped !== input.rows.length)
    return fail(
      'REQUEST_INVALID',
      `nRows − nDropped (${input.nRows} − ${input.nDropped}) does not equal the number of rows supplied (${input.rows.length}).`,
      { reason: 'data-preparation-mismatch' },
    );
  const byId = new Map(model.indicators.map((i) => [i.id, i]));
  const colIndex = new Map(input.columns.map((c, i) => [c, i]));
  const unmapped: string[] = [];
  const absent: string[] = [];
  const cols: number[] = [];
  for (const id of ovIds) {
    const col = byId.get(id)?.column ?? null;
    if (col === null) {
      unmapped.push(id);
      continue;
    }
    const k = colIndex.get(col);
    if (k === undefined) absent.push(col);
    else cols.push(k);
  }
  if (unmapped.length || absent.length)
    return fail(
      'DATA_COLUMN_MISSING',
      [
        unmapped.length ? `indicators without a bound column: ${unmapped.join(', ')}` : '',
        absent.length ? `columns not in the data: ${absent.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; '),
      { elementIds: unmapped, columns: absent },
    );

  const p = ovIds.length;
  const used: Float64Array[] = []; // NaN = missing
  for (let r = 0; r < input.rows.length; r++) {
    const row = input.rows[r]!;
    if (row.length !== input.columns.length)
      return fail(
        'REQUEST_INVALID',
        `Row ${r + 1} has ${row.length} values for ${input.columns.length} columns.`,
        {
          reason: 'ragged-rows',
        },
      );
    const v = new Float64Array(p);
    let nObs = 0;
    for (let j = 0; j < p; j++) {
      const x = row[cols[j]!];
      if (x === null || x === undefined) v[j] = NaN;
      else if (typeof x !== 'number' || !Number.isFinite(x))
        return fail(
          'DATA_NOT_NUMERIC',
          `Column ${input.columns[cols[j]!]} contains a non-numeric or non-finite value.`,
          {
            columns: [input.columns[cols[j]!]],
            elementIds: [ovIds[j]!],
          },
        );
      else {
        v[j] = x;
        nObs++;
      }
    }
    if (missing === 'listwise' ? nObs === p : nObs > 0) used.push(v);
  }
  const n = used.length;
  if (n < 2)
    return fail(
      'DATA_INSUFFICIENT_ROWS',
      `Only ${n} usable row(s) after ${missing === 'listwise' ? 'listwise deletion' : 'removing empty rows'}.`,
      {
        nUsed: n,
      },
    );
  // zero variance among observed values
  const zero: string[] = [];
  for (let j = 0; j < p; j++) {
    let lo = Infinity;
    let hi = -Infinity;
    let cnt = 0;
    for (const v of used) {
      const x = v[j]!;
      if (Number.isNaN(x)) continue;
      cnt++;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (cnt < 2 || lo === hi) zero.push(ovIds[j]!);
  }
  if (zero.length)
    return fail(
      'DATA_ZERO_VARIANCE',
      `Indicator(s) without variance in the analysed rows: ${zero.join(', ')}.`,
      {
        elementIds: zero,
      },
    );

  // group into missingness patterns
  const groups = new Map<string, { obs: number[]; rows: Float64Array[] }>();
  for (const v of used) {
    const obs: number[] = [];
    for (let j = 0; j < p; j++) if (!Number.isNaN(v[j]!)) obs.push(j);
    const key = obs.join(',');
    let gr = groups.get(key);
    if (!gr) {
      gr = { obs, rows: [] };
      groups.set(key, gr);
    }
    gr.rows.push(Float64Array.from(obs.map((j) => v[j]!)));
  }
  const patterns: Pattern[] = [...groups.values()].map(({ obs, rows }) => {
    const q = obs.length;
    const k = rows.length;
    const mean = new Float64Array(q);
    for (const r of rows) for (let i = 0; i < q; i++) mean[i] = mean[i]! + r[i]!;
    for (let i = 0; i < q; i++) mean[i] = mean[i]! / k;
    const cov = Mat.zeros(q, q);
    for (const r of rows)
      for (let i = 0; i < q; i++) {
        const di = r[i]! - mean[i]!;
        for (let j = 0; j <= i; j++) cov.add(i, j, di * (r[j]! - mean[j]!));
      }
    for (let i = 0; i < q; i++)
      for (let j = 0; j <= i; j++) {
        const val = cov.get(i, j) / k;
        cov.set(i, j, val);
        cov.set(j, i, val);
      }
    return { obs, n: k, mean, cov, rows };
  });
  const complete = patterns.length === 1 && patterns[0]!.obs.length === p;
  return {
    ok: true,
    value: {
      data: {
        p,
        n,
        patterns,
        complete,
        mean: complete ? patterns[0]!.mean : null,
        cov: complete ? patterns[0]!.cov : null,
      },
      nUsed: n,
      nExcluded: input.rows.length - n,
    },
  };
}

/**
 * Saturated ML moments under MAR (EM algorithm). Start: available-case means and divisor-n
 * variances (as lavaan); iterate to max |Δ| < tol. Returns null if a conditional covariance
 * becomes singular.
 */
export function emSaturated(
  data: SampleData,
  tol = 1e-13,
  maxIter = 20000,
): { mu: Float64Array; sigma: Mat; iterations: number; converged: boolean } | null {
  const p = data.p;
  if (data.complete) return { mu: data.mean!, sigma: data.cov!, iterations: 0, converged: true };
  // start
  const sum = new Float64Array(p);
  const cnt = new Float64Array(p);
  for (const pat of data.patterns)
    pat.obs.forEach((j, i) => {
      sum[j] = sum[j]! + pat.n * pat.mean[i]!;
      cnt[j] = cnt[j]! + pat.n;
    });
  let mu = new Float64Array(p);
  for (let j = 0; j < p; j++) mu[j] = sum[j]! / cnt[j]!;
  const ss = new Float64Array(p);
  for (const pat of data.patterns)
    pat.obs.forEach((j, i) => {
      for (const r of pat.rows) ss[j] = ss[j]! + (r[i]! - mu[j]!) ** 2;
    });
  let sigma = Mat.zeros(p, p);
  for (let j = 0; j < p; j++) sigma.set(j, j, ss[j]! / cnt[j]!);

  for (let it = 1; it <= maxIter; it++) {
    const T1 = new Float64Array(p);
    const T2 = Mat.zeros(p, p);
    for (const pat of data.patterns) {
      const o = pat.obs;
      const q = o.length;
      const mis: number[] = [];
      for (let j = 0; j < p; j++) if (!o.includes(j)) mis.push(j);
      const nk = pat.n;
      // sufficient statistics of the observed part
      const sy = new Float64Array(q);
      const syy = Mat.zeros(q, q);
      for (let i = 0; i < q; i++) sy[i] = nk * pat.mean[i]!;
      for (let i = 0; i < q; i++)
        for (let j = 0; j < q; j++)
          syy.set(i, j, nk * (pat.cov.get(i, j) + pat.mean[i]! * pat.mean[j]!));
      if (mis.length === 0) {
        for (let i = 0; i < q; i++) {
          T1[o[i]!] = T1[o[i]!]! + sy[i]!;
          for (let j = 0; j < q; j++) T2.add(o[i]!, o[j]!, syy.get(i, j));
        }
        continue;
      }
      const soo = Mat.zeros(q, q);
      for (let i = 0; i < q; i++)
        for (let j = 0; j < q; j++) soo.set(i, j, sigma.get(o[i]!, o[j]!));
      const inv = spdInverse(soo);
      if (!inv) return null;
      const r = mis.length;
      // B = Σ_mo Σ_oo⁻¹ (r × q), C = Σ_mm − B Σ_om, a = μ_m − B μ_o
      const B = Mat.zeros(r, q);
      for (let i = 0; i < r; i++)
        for (let j = 0; j < q; j++) {
          let s = 0;
          for (let k = 0; k < q; k++) s += sigma.get(mis[i]!, o[k]!) * inv.inv.get(k, j);
          B.set(i, j, s);
        }
      const C = Mat.zeros(r, r);
      for (let i = 0; i < r; i++)
        for (let j = 0; j < r; j++) {
          let s = sigma.get(mis[i]!, mis[j]!);
          for (let k = 0; k < q; k++) s -= B.get(i, k) * sigma.get(o[k]!, mis[j]!);
          C.set(i, j, s);
        }
      const a = new Float64Array(r);
      for (let i = 0; i < r; i++) {
        let s = mu[mis[i]!]!;
        for (let k = 0; k < q; k++) s -= B.get(i, k) * mu[o[k]!]!;
        a[i] = s;
      }
      // Σ E[y_m] = n a + B Σy_o
      const bsy = new Float64Array(r);
      for (let i = 0; i < r; i++) {
        let s = 0;
        for (let k = 0; k < q; k++) s += B.get(i, k) * sy[k]!;
        bsy[i] = s;
      }
      // B Syy (r × q)
      const bSyy = Mat.zeros(r, q);
      for (let i = 0; i < r; i++)
        for (let j = 0; j < q; j++) {
          let s = 0;
          for (let k = 0; k < q; k++) s += B.get(i, k) * syy.get(k, j);
          bSyy.set(i, j, s);
        }
      for (let i = 0; i < q; i++) {
        T1[o[i]!] = T1[o[i]!]! + sy[i]!;
        for (let j = 0; j < q; j++) T2.add(o[i]!, o[j]!, syy.get(i, j));
      }
      for (let i = 0; i < r; i++) {
        T1[mis[i]!] = T1[mis[i]!]! + nk * a[i]! + bsy[i]!;
        // E[y_m y_oᵀ] summed: a Σy_oᵀ + B Syy
        for (let j = 0; j < q; j++) {
          const v = a[i]! * sy[j]! + bSyy.get(i, j);
          T2.add(mis[i]!, o[j]!, v);
          T2.add(o[j]!, mis[i]!, v);
        }
        // E[y_m y_mᵀ] summed: n C + n a aᵀ + a (BΣy)ᵀ + (BΣy) aᵀ + B Syy Bᵀ
        for (let j = 0; j < r; j++) {
          let bsb = 0;
          for (let k = 0; k < q; k++) bsb += bSyy.get(i, k) * B.get(j, k);
          T2.add(
            mis[i]!,
            mis[j]!,
            nk * C.get(i, j) + nk * a[i]! * a[j]! + a[i]! * bsy[j]! + bsy[i]! * a[j]! + bsb,
          );
        }
      }
    }
    const n = data.n;
    const muNew = new Float64Array(p);
    for (let j = 0; j < p; j++) muNew[j] = T1[j]! / n;
    const sigNew = Mat.zeros(p, p);
    for (let i = 0; i < p; i++)
      for (let j = 0; j <= i; j++) {
        const v = (0.5 * (T2.get(i, j) + T2.get(j, i))) / n - muNew[i]! * muNew[j]!;
        sigNew.set(i, j, v);
        sigNew.set(j, i, v);
      }
    let delta = 0;
    for (let j = 0; j < p; j++) delta = Math.max(delta, Math.abs(muNew[j]! - mu[j]!));
    for (let k = 0; k < p * p; k++) delta = Math.max(delta, Math.abs(sigNew.d[k]! - sigma.d[k]!));
    mu = muNew;
    sigma = sigNew;
    if (delta < tol) return { mu, sigma, iterations: it, converged: true };
  }
  return { mu, sigma, iterations: maxIter, converged: false };
}
