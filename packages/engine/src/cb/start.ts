/**
 * Starting values from the (h1) sample moments. Loadings from the classical triad estimate
 * λ_i²φ ≈ s_ij s_ik / s_jk averaged over indicator pairs of the same block (|s_12| for
 * two-indicator blocks), residual variances from the remainder, factor covariances from the
 * cross-block covariances, structural paths 0, intercepts = means. The optimum does not depend
 * on these; they only need to be inside the admissible region.
 */
import { Mat, cholesky } from './matrix.ts';
import { modelState } from './parameterization.ts';
import type { ModelSpec } from './spec.ts';

export function startValues(spec: ModelSpec, S: Mat, mean: Float64Array | null): Float64Array {
  const { m, p } = spec;
  const x = new Float64Array(spec.npar);
  const blocks: number[][] = Array.from({ length: m }, () => []);
  for (const e of spec.entries) if (e.mat === 'lambda') blocks[e.col]!.push(e.row);
  // order inside a block follows the entry order = construct.indicatorIds order
  const lambda = Mat.zeros(p, m);
  const phi = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const idx = blocks[j]!;
    const c = idx.map((i) => {
      const sii = S.get(i, i);
      let c2: number;
      const others = idx.filter((k) => k !== i);
      if (others.length >= 2) {
        let sum = 0;
        let cnt = 0;
        for (let a = 0; a < others.length; a++)
          for (let b = a + 1; b < others.length; b++) {
            const ka = others[a]!;
            const kb = others[b]!;
            const sab = S.get(ka, kb);
            if (Math.abs(sab) < 1e-8 * Math.sqrt(S.get(ka, ka) * S.get(kb, kb))) continue;
            sum += Math.abs((S.get(i, ka) * S.get(i, kb)) / sab);
            cnt++;
          }
        c2 = cnt ? sum / cnt : 0.5 * sii;
      } else if (others.length === 1) c2 = Math.abs(S.get(i, others[0]!));
      else c2 = sii;
      c2 = Math.min(Math.max(c2, 0.05 * sii), others.length ? 0.95 * sii : sii);
      return Math.sqrt(c2);
    });
    const marker = idx[0]!;
    const signed = idx.map((i, t) => (t === 0 || S.get(i, marker) >= 0 ? c[t]! : -c[t]!));
    if (spec.identification === 'marker') {
      phi[j] = signed[0]! ** 2;
      idx.forEach((i, t) => lambda.set(i, j, signed[t]! / signed[0]!));
    } else {
      phi[j] = 1;
      idx.forEach((i, t) => lambda.set(i, j, signed[t]!));
    }
  }
  const latentCov = (a: number, b: number): number => {
    let sum = 0;
    let cnt = 0;
    for (const i of blocks[a]!)
      for (const k of blocks[b]!) {
        if (i === k) continue;
        const la = lambda.get(i, a);
        const lb = lambda.get(k, b);
        if (la === 0 || lb === 0) continue;
        sum += S.get(i, k) / (la * lb);
        cnt++;
      }
    if (!cnt) return 0;
    const lim = 0.9 * Math.sqrt(phi[a]! * phi[b]!);
    return Math.max(-lim, Math.min(lim, sum / cnt));
  };
  for (const e of spec.entries) {
    if (e.free < 0) continue;
    let v = 0;
    switch (e.mat) {
      case 'lambda':
        v = lambda.get(e.row, e.col);
        break;
      case 'beta':
        v = 0;
        break;
      case 'psi':
        v = e.row === e.col ? phi[e.row]! : latentCov(e.row, e.col);
        break;
      case 'theta':
        if (e.row === e.col) {
          let common = 0;
          for (let j = 0; j < m; j++) common += lambda.get(e.row, j) ** 2 * phi[j]!;
          const sii = S.get(e.row, e.row);
          v = Math.max(sii - common, 0.1 * sii);
        } else v = 0;
        break;
      case 'nu':
        v = mean ? mean[e.row]! : 0;
        break;
      case 'alpha':
        v = 0;
        break;
    }
    x[e.free] = v;
  }
  // keep the implied covariance positive definite
  for (let attempt = 0; attempt < 30; attempt++) {
    const st = modelState(spec, x);
    if (st && cholesky(st.sigma)) break;
    for (const e of spec.entries) {
      if (e.free < 0) continue;
      if (e.row !== e.col && (e.mat === 'psi' || e.mat === 'theta')) x[e.free] = x[e.free]! * 0.5;
      if (e.row === e.col && e.mat === 'theta') x[e.free] = x[e.free]! + 0.1 * S.get(e.row, e.row);
    }
  }
  return x;
}
