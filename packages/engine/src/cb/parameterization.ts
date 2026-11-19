/**
 * Parameterizations: maps from a free-parameter vector θ to the model-implied moments
 * (Σ(θ), μ(θ)) together with their analytic Jacobian (∂Σ/∂θ_k, ∂μ/∂θ_k).
 *
 * - the LISREL all-y model:  Σ = Λ A Ψ Aᵀ Λᵀ + Θ,  μ = ν + Λ A α,  A = (I − B)⁻¹;
 * - the saturated (h1) model: θ = (vech Σ, μ);
 * - the independence (baseline) model: θ = (diag Σ, μ).
 */
import { Mat, inverse, mul, transpose } from './matrix.ts';
import type { ModelSpec } from './spec.ts';

export interface Moments {
  sigma: Mat;
  /** null when the means are not modelled (they are then the sample means). */
  mu: Float64Array | null;
}

export interface Jacobian {
  dSigma: Mat[];
  dMu: Float64Array[] | null;
}

export interface Parameterization {
  npar: number;
  p: number;
  meanStructure: boolean;
  moments(theta: Float64Array): Moments | null;
  jacobian(theta: Float64Array): Jacobian | null;
}

export interface ModelMatrices {
  lambda: Mat;
  beta: Mat;
  psi: Mat;
  theta: Mat;
  nu: Float64Array;
  alpha: Float64Array;
}

export function fillMatrices(spec: ModelSpec, x: Float64Array): ModelMatrices {
  const { p, m } = spec;
  const mats: ModelMatrices = {
    lambda: Mat.zeros(p, m),
    beta: Mat.zeros(m, m),
    psi: Mat.zeros(m, m),
    theta: Mat.zeros(p, p),
    nu: new Float64Array(p),
    alpha: new Float64Array(m),
  };
  for (const e of spec.entries) {
    const v = e.free >= 0 ? x[e.free]! : e.value;
    switch (e.mat) {
      case 'lambda':
        mats.lambda.set(e.row, e.col, v);
        break;
      case 'beta':
        mats.beta.set(e.row, e.col, v);
        break;
      case 'psi':
        mats.psi.set(e.row, e.col, v);
        mats.psi.set(e.col, e.row, v);
        break;
      case 'theta':
        mats.theta.set(e.row, e.col, v);
        mats.theta.set(e.col, e.row, v);
        break;
      case 'nu':
        mats.nu[e.row] = v;
        break;
      case 'alpha':
        mats.alpha[e.row] = v;
        break;
    }
  }
  return mats;
}

export interface ModelState {
  mats: ModelMatrices;
  /** (I − B)⁻¹ */
  a: Mat;
  /** Latent covariance Φ = A Ψ Aᵀ */
  phi: Mat;
  sigma: Mat;
  mu: Float64Array | null;
  /** Λ A */
  la: Mat;
  /** A α */
  aAlpha: Float64Array;
}

export function modelState(spec: ModelSpec, x: Float64Array): ModelState | null {
  const mats = fillMatrices(spec, x);
  const { p, m } = spec;
  const iMinusB = Mat.identity(m);
  for (let i = 0; i < m * m; i++) iMinusB.d[i] = iMinusB.d[i]! - mats.beta.d[i]!;
  const a = m === 0 ? Mat.zeros(0, 0) : inverse(iMinusB);
  if (!a) return null;
  const phi = mul(mul(a, mats.psi), transpose(a));
  const la = mul(mats.lambda, a);
  const sigma = mul(mul(mats.lambda, phi), transpose(mats.lambda));
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++) sigma.set(i, j, sigma.get(i, j) + mats.theta.get(i, j));
  // exact symmetry
  for (let i = 0; i < p; i++)
    for (let j = 0; j < i; j++) {
      const v = 0.5 * (sigma.get(i, j) + sigma.get(j, i));
      sigma.set(i, j, v);
      sigma.set(j, i, v);
    }
  const aAlpha = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) s += a.get(i, j) * mats.alpha[j]!;
    aAlpha[i] = s;
  }
  let mu: Float64Array | null = null;
  if (spec.meanStructure) {
    mu = new Float64Array(p);
    for (let i = 0; i < p; i++) {
      let s = mats.nu[i]!;
      for (let j = 0; j < m; j++) s += la.get(i, j) * mats.alpha[j]!;
      mu[i] = s;
    }
  }
  return { mats, a, phi, sigma, mu, la, aAlpha };
}

export function modelParameterization(spec: ModelSpec): Parameterization {
  const { p } = spec;
  return {
    npar: spec.npar,
    p,
    meanStructure: spec.meanStructure,
    moments(x) {
      const st = modelState(spec, x);
      return st ? { sigma: st.sigma, mu: st.mu } : null;
    },
    jacobian(x) {
      const st = modelState(spec, x);
      if (!st) return null;
      const lphi = mul(st.mats.lambda, st.phi); // Λ Φ  (p × m)
      const dSigma = Array.from({ length: spec.npar }, () => Mat.zeros(p, p));
      const dMu = spec.meanStructure
        ? Array.from({ length: spec.npar }, () => new Float64Array(p))
        : null;
      const addOuter = (d: Mat, u: (i: number) => number, v: (i: number) => number): void => {
        // d += u vᵀ + v uᵀ
        for (let i = 0; i < p; i++) {
          const ui = u(i);
          const vi = v(i);
          for (let j = 0; j < p; j++) d.d[i * p + j] = d.d[i * p + j]! + ui * v(j) + vi * u(j);
        }
      };
      for (const e of spec.entries) {
        if (e.free < 0) continue;
        const d = dSigma[e.free]!;
        const dm = dMu ? dMu[e.free]! : null;
        const r = e.row;
        const c = e.col;
        switch (e.mat) {
          case 'lambda': {
            addOuter(
              d,
              (i) => (i === r ? 1 : 0),
              (i) => lphi.get(i, c),
            );
            if (dm) dm[r] = dm[r]! + st.aAlpha[c]!;
            break;
          }
          case 'beta': {
            // η_r ← η_c:  dΣ = u vᵀ + v uᵀ with u = (ΛA)_{·r}, v = (ΛΦ)_{·c}
            addOuter(
              d,
              (i) => st.la.get(i, r),
              (i) => lphi.get(i, c),
            );
            if (dm) for (let i = 0; i < p; i++) dm[i] = dm[i]! + st.la.get(i, r) * st.aAlpha[c]!;
            break;
          }
          case 'psi': {
            if (r === c) {
              for (let i = 0; i < p; i++)
                for (let j = 0; j < p; j++)
                  d.d[i * p + j] = d.d[i * p + j]! + st.la.get(i, r) * st.la.get(j, r);
            } else
              addOuter(
                d,
                (i) => st.la.get(i, r),
                (i) => st.la.get(i, c),
              );
            break;
          }
          case 'theta': {
            if (r === c) d.add(r, r, 1);
            else {
              d.add(r, c, 1);
              d.add(c, r, 1);
            }
            break;
          }
          case 'nu': {
            if (dm) dm[r] = dm[r]! + 1;
            break;
          }
          case 'alpha': {
            if (dm) for (let i = 0; i < p; i++) dm[i] = dm[i]! + st.la.get(i, r);
            break;
          }
        }
      }
      return { dSigma, dMu };
    },
  };
}

/** Saturated model: θ = (σ_ij for i ≥ j, row-wise lower triangle; then μ when modelled). */
export function saturatedParameterization(p: number, meanStructure: boolean): Parameterization {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) pairs.push([i, j]);
  const nCov = pairs.length;
  const npar = nCov + (meanStructure ? p : 0);
  const dSigma: Mat[] = [];
  const dMu: Float64Array[] | null = meanStructure ? [] : null;
  for (let k = 0; k < npar; k++) {
    const d = Mat.zeros(p, p);
    const dm = new Float64Array(p);
    if (k < nCov) {
      const [i, j] = pairs[k]!;
      d.set(i, j, 1);
      d.set(j, i, 1);
    } else dm[k - nCov] = 1;
    dSigma.push(d);
    dMu?.push(dm);
  }
  return {
    npar,
    p,
    meanStructure,
    moments(x) {
      const sigma = Mat.zeros(p, p);
      pairs.forEach(([i, j], k) => {
        sigma.set(i, j, x[k]!);
        sigma.set(j, i, x[k]!);
      });
      return { sigma, mu: meanStructure ? Float64Array.from(x.subarray(nCov)) : null };
    },
    jacobian() {
      return { dSigma, dMu };
    },
  };
}

export function saturatedTheta(sigma: Mat, mu: Float64Array | null): Float64Array {
  const p = sigma.r;
  const out: number[] = [];
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) out.push(sigma.get(i, j));
  if (mu) out.push(...mu);
  return Float64Array.from(out);
}

/** Independence (baseline) model: θ = (σ_11 … σ_pp; then μ when modelled). */
export function independenceParameterization(p: number, meanStructure: boolean): Parameterization {
  const npar = p + (meanStructure ? p : 0);
  const dSigma: Mat[] = [];
  const dMu: Float64Array[] | null = meanStructure ? [] : null;
  for (let k = 0; k < npar; k++) {
    const d = Mat.zeros(p, p);
    const dm = new Float64Array(p);
    if (k < p) d.set(k, k, 1);
    else dm[k - p] = 1;
    dSigma.push(d);
    dMu?.push(dm);
  }
  return {
    npar,
    p,
    meanStructure,
    moments(x) {
      const sigma = Mat.zeros(p, p);
      for (let i = 0; i < p; i++) sigma.set(i, i, x[i]!);
      return { sigma, mu: meanStructure ? Float64Array.from(x.subarray(p)) : null };
    },
    jacobian() {
      return { dSigma, dMu };
    },
  };
}
