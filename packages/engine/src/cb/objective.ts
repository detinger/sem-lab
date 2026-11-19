/**
 * Normal-theory ML discrepancy, written once for complete data and for casewise ML (FIML).
 *
 * With missingness patterns k (n_k cases, observed set o_k, pattern mean ȳ_k and divisor-n_k
 * covariance S_k) the objective is
 *
 *   f(θ) = Σ_k (n_k / N) [ log|Σ_oo| + tr(Σ_oo⁻¹ (S_k + d_k d_kᵀ)) ],   d_k = ȳ_k − μ_o,
 *
 * i.e. f = −2·logL/N up to a constant. Complete data are one pattern. Without a mean structure
 * μ is the sample mean (d = 0), so f − log|S| − p is lavaan's F_ML and χ² = N·F_ML.
 *
 * The gradient uses dF = tr(G dΣ) + gᵀ dμ; the expected (Fisher) Hessian of f is
 * Σ_k (n_k/N)[tr(Σ_oo⁻¹ Σ_a Σ_oo⁻¹ Σ_b) + 2 μ_aᵀ Σ_oo⁻¹ μ_b].
 */
import { Mat, frob, spdInverse } from './matrix.ts';
import type { Jacobian, Moments, Parameterization } from './parameterization.ts';

export interface Pattern {
  /** Observed variable indices (into the model's ov order). */
  obs: number[];
  n: number;
  mean: Float64Array;
  /** Divisor-n covariance of the pattern's observed values. */
  cov: Mat;
  /** Observed values of each case (length obs.length). */
  rows: Float64Array[];
}

export interface SampleData {
  p: number;
  n: number;
  patterns: Pattern[];
  /** True when there is exactly one pattern with every variable observed. */
  complete: boolean;
  /** Complete data only: overall mean and divisor-N covariance. */
  mean: Float64Array | null;
  cov: Mat | null;
}

export interface Evaluation {
  f: number;
  /** ∂f/∂Σ (symmetric, dF = Σ_ij G_ij dΣ_ij). */
  G: Mat;
  /** ∂f/∂μ (null when the means are not modelled). */
  g: Float64Array | null;
}

function effectiveMu(data: SampleData, mom: Moments): Float64Array {
  if (mom.mu) return mom.mu;
  if (!data.mean) throw new Error('a mean structure is required for incomplete data');
  return data.mean;
}

/** Objective and its derivatives with respect to (Σ, μ). Null when some Σ_oo is not PD. */
export function evaluate(data: SampleData, mom: Moments): Evaluation | null {
  const p = data.p;
  const mu = effectiveMu(data, mom);
  const G = Mat.zeros(p, p);
  const g = mom.mu ? new Float64Array(p) : null;
  let f = 0;
  for (const pat of data.patterns) {
    const o = pat.obs;
    const q = o.length;
    const soo = new Mat(q, q);
    for (let i = 0; i < q; i++)
      for (let j = 0; j < q; j++) soo.set(i, j, mom.sigma.get(o[i]!, o[j]!));
    const inv = spdInverse(soo);
    if (!inv) return null;
    const w = pat.n / data.n;
    const d = new Float64Array(q);
    for (let i = 0; i < q; i++) d[i] = pat.mean[i]! - mu[o[i]!]!;
    // M = S_k + d dᵀ
    const M = new Mat(q, q);
    for (let i = 0; i < q; i++)
      for (let j = 0; j < q; j++) M.set(i, j, pat.cov.get(i, j) + d[i]! * d[j]!);
    // Σ⁻¹ M Σ⁻¹ and tr(Σ⁻¹ M)
    const sm = new Mat(q, q);
    for (let i = 0; i < q; i++)
      for (let j = 0; j < q; j++) {
        let s = 0;
        for (let k = 0; k < q; k++) s += inv.inv.get(i, k) * M.get(k, j);
        sm.set(i, j, s);
      }
    let tr = 0;
    for (let i = 0; i < q; i++) tr += sm.get(i, i);
    f += w * (inv.logdet + tr);
    for (let i = 0; i < q; i++)
      for (let j = 0; j < q; j++) {
        let s = 0;
        for (let k = 0; k < q; k++) s += sm.get(i, k) * inv.inv.get(k, j);
        G.add(o[i]!, o[j]!, w * (inv.inv.get(i, j) - s));
      }
    if (g) {
      for (let i = 0; i < q; i++) {
        let s = 0;
        for (let k = 0; k < q; k++) s += inv.inv.get(i, k) * d[k]!;
        g[o[i]!] = g[o[i]!]! - 2 * w * s;
      }
    }
  }
  return { f, G, g };
}

export function gradientFromJacobian(ev: Evaluation, jac: Jacobian): Float64Array {
  const n = jac.dSigma.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = frob(ev.G, jac.dSigma[k]!);
    if (ev.g && jac.dMu) {
      const dm = jac.dMu[k]!;
      for (let i = 0; i < dm.length; i++) s += ev.g[i]! * dm[i]!;
    }
    out[k] = s;
  }
  return out;
}

/** f and ∂f/∂θ; null when Σ(θ) is not admissible for the likelihood. */
export function objectiveAndGradient(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
): { f: number; grad: Float64Array } | null {
  const mom = par.moments(x);
  if (!mom) return null;
  const ev = evaluate(data, mom);
  if (!ev) return null;
  const jac = par.jacobian(x);
  if (!jac) return null;
  return { f: ev.f, grad: gradientFromJacobian(ev, jac) };
}

export function objectiveOnly(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
): number | null {
  const mom = par.moments(x);
  if (!mom) return null;
  const ev = evaluate(data, mom);
  return ev ? ev.f : null;
}

/** Expected Hessian of f: Σ_k (n_k/N)[tr(Σ⁻¹Σ_aΣ⁻¹Σ_b) + 2 μ_aᵀΣ⁻¹μ_b] over observed blocks. */
export function expectedHessian(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
): Mat | null {
  const mom = par.moments(x);
  const jac = par.jacobian(x);
  if (!mom || !jac) return null;
  const npar = jac.dSigma.length;
  const H = Mat.zeros(npar, npar);
  for (const pat of data.patterns) {
    const o = pat.obs;
    const q = o.length;
    const soo = new Mat(q, q);
    for (let i = 0; i < q; i++)
      for (let j = 0; j < q; j++) soo.set(i, j, mom.sigma.get(o[i]!, o[j]!));
    const inv = spdInverse(soo);
    if (!inv) return null;
    const w = pat.n / data.n;
    // M_a = Σ_oo⁻¹ (dΣ_a)_oo
    const Ms: Mat[] = [];
    for (let a = 0; a < npar; a++) {
      const dS = jac.dSigma[a]!;
      const Ma = new Mat(q, q);
      for (let i = 0; i < q; i++)
        for (let j = 0; j < q; j++) {
          let s = 0;
          for (let k = 0; k < q; k++) s += inv.inv.get(i, k) * dS.get(o[k]!, o[j]!);
          Ma.set(i, j, s);
        }
      Ms.push(Ma);
    }
    const Vs: Float64Array[] = [];
    if (jac.dMu && mom.mu) {
      for (let a = 0; a < npar; a++) {
        const dm = jac.dMu[a]!;
        const v = new Float64Array(q);
        for (let i = 0; i < q; i++) {
          let s = 0;
          for (let k = 0; k < q; k++) s += inv.inv.get(i, k) * dm[o[k]!]!;
          v[i] = s;
        }
        Vs.push(v);
      }
    }
    for (let a = 0; a < npar; a++) {
      const Ma = Ms[a]!;
      for (let b = 0; b <= a; b++) {
        const Mb = Ms[b]!;
        let t = 0;
        for (let i = 0; i < q; i++)
          for (let j = 0; j < q; j++) t += Ma.d[i * q + j]! * Mb.d[j * q + i]!;
        if (Vs.length) {
          const dmA = jac.dMu![a]!;
          const vb = Vs[b]!;
          let s = 0;
          for (let i = 0; i < q; i++) s += dmA[o[i]!]! * vb[i]!;
          t += 2 * s;
        }
        H.add(a, b, w * t);
        if (a !== b) H.add(b, a, w * t);
      }
    }
  }
  return H;
}

/**
 * Casewise scores of logL_i with respect to θ (one row per case, patterns in order).
 * s_ik = ½ tr(W_i Σ_k,oo) + μ_k,oᵀ Σ_oo⁻¹ z_i with z = y_o − μ_o and W = Σ⁻¹zzᵀΣ⁻¹ − Σ⁻¹.
 */
export function casewiseScores(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
): Float64Array[] | null {
  const mom = par.moments(x);
  const jac = par.jacobian(x);
  if (!mom || !jac) return null;
  const mu = effectiveMu(data, mom);
  const npar = jac.dSigma.length;
  const out: Float64Array[] = [];
  for (const pat of data.patterns) {
    const o = pat.obs;
    const q = o.length;
    const soo = new Mat(q, q);
    for (let i = 0; i < q; i++)
      for (let j = 0; j < q; j++) soo.set(i, j, mom.sigma.get(o[i]!, o[j]!));
    const inv = spdInverse(soo);
    if (!inv) return null;
    // pattern sub-blocks of the Jacobian
    const dS: Float64Array[] = [];
    const dM: Float64Array[] = [];
    for (let a = 0; a < npar; a++) {
      const full = jac.dSigma[a]!;
      const blk = new Float64Array(q * q);
      for (let i = 0; i < q; i++)
        for (let j = 0; j < q; j++) blk[i * q + j] = full.get(o[i]!, o[j]!);
      dS.push(blk);
      if (jac.dMu && mom.mu) {
        const dm = jac.dMu[a]!;
        const mb = new Float64Array(q);
        for (let i = 0; i < q; i++) mb[i] = dm[o[i]!]!;
        dM.push(mb);
      }
    }
    const W = new Float64Array(q * q);
    const v = new Float64Array(q);
    const z = new Float64Array(q);
    for (const row of pat.rows) {
      for (let i = 0; i < q; i++) z[i] = row[i]! - mu[o[i]!]!;
      for (let i = 0; i < q; i++) {
        let s = 0;
        for (let k = 0; k < q; k++) s += inv.inv.get(i, k) * z[k]!;
        v[i] = s;
      }
      for (let i = 0; i < q; i++)
        for (let j = 0; j < q; j++) W[i * q + j] = v[i]! * v[j]! - inv.inv.get(i, j);
      const s = new Float64Array(npar);
      for (let a = 0; a < npar; a++) {
        const blk = dS[a]!;
        let t = 0;
        for (let k = 0; k < q * q; k++) t += W[k]! * blk[k]!;
        t *= 0.5;
        if (dM.length) {
          const mb = dM[a]!;
          for (let i = 0; i < q; i++) t += v[i]! * mb[i]!;
        }
        s[a] = t;
      }
      out.push(s);
    }
  }
  return out;
}

/** First-order information B = (1/N) Σ_i s_i s_iᵀ. */
export function firstOrderInformation(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
): Mat | null {
  const scores = casewiseScores(par, data, x);
  if (!scores) return null;
  const k = par.npar;
  const B = Mat.zeros(k, k);
  for (const s of scores)
    for (let a = 0; a < k; a++) {
      const sa = s[a]!;
      if (sa === 0) continue;
      for (let b = 0; b <= a; b++) B.d[a * k + b] = B.d[a * k + b]! + sa * s[b]!;
    }
  for (let a = 0; a < k; a++)
    for (let b = 0; b <= a; b++) {
      const v = B.get(a, b) / data.n;
      B.set(a, b, v);
      B.set(b, a, v);
    }
  return B;
}

/**
 * Observed information per case (Hessian of f/2 = −logL/N) by Richardson extrapolation of the
 * analytic gradient with step h = 1e-6 — the same scheme as lavaan::lav_model_hessian.
 */
export function observedInformation(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
  h = 1e-6,
): Mat | null {
  const k = par.npar;
  const H = Mat.zeros(k, k);
  const grad = (y: Float64Array): Float64Array | null =>
    objectiveAndGradient(par, data, y)?.grad ?? null;
  for (let j = 0; j < k; j++) {
    const at = (delta: number): Float64Array | null => {
      const y = Float64Array.from(x);
      y[j] = y[j]! + delta;
      return grad(y);
    };
    const gl = at(-h);
    const gl2 = at(-2 * h);
    const gr = at(h);
    const gr2 = at(2 * h);
    if (!gl || !gl2 || !gr || !gr2) return null;
    for (let i = 0; i < k; i++)
      H.set(i, j, (0.5 * (gl2[i]! - 8 * gl[i]! + 8 * gr[i]! - gr2[i]!)) / (12 * h));
  }
  for (let i = 0; i < k; i++)
    for (let j = 0; j < i; j++) {
      const v = 0.5 * (H.get(i, j) + H.get(j, i));
      H.set(i, j, v);
      H.set(j, i, v);
    }
  return H;
}
