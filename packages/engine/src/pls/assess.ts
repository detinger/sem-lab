/**
 * Quality criteria with the definitions of cSEM 0.7.1 `assess()` as the R engine calls it
 * (services/r-engine/R/pls_results.R; docs/estimators/pls-csem.md §3). Each function names
 * the cSEM function whose semantics it reproduces:
 *   cronbachAlpha    cSEM:::calculateRhoT (unweighted, correlation-based)
 *   rhoC             cSEM:::calculateRhoC (.model_implied = TRUE, .weighted = FALSE)
 *   ave              cSEM:::calculateAVE
 *   rhoA             Estimates$Reliabilities of a PLSc pass (cSEM:::calculateReliabilities)
 *   htmt             cSEM:::calculateHTMTcore (.absolute = TRUE, htmt / htmt2)
 *   fornellLarcker   cSEM:::calculateFLCriterion
 *   crossLoadings    stats::cor(data, Estimates$Construct_scores)
 *   f2               cSEM:::calculatef2 (drop the predictor, same construct correlations)
 *   vifModeB         cSEM:::calculateVIFModeB
 *   srmr, dUls, dG   cSEM:::calculateSRMR / calculateDL / calculateDG (log base 10)
 */
import { type Mat, NumericalError, symmetricEigenvalues, inverseR, sub } from '../linalg/index.ts';
import { CholeskyDecomposition, Matrix } from 'ml-matrix';
import {
  type CoreFit,
  type CoreModel,
  correctionFactor,
  estimatePaths,
  modelImpliedIndicatorCor,
} from './core.ts';

/** Standardised Cronbach's alpha: r̄ · (Σ w)², w = unit weights scaled to w'Sw = 1. */
export function cronbachAlpha(S: Mat, block: readonly number[]): number {
  let rsum = 0;
  let count = 0;
  let total = 0;
  for (let i = 0; i < block.length; i++) {
    for (let l = 0; l < block.length; l++) {
      const v = S[block[i]!]![block[l]!]!;
      total += v;
      if (l > i) {
        rsum += v;
        count++;
      }
    }
  }
  const rbar = rsum / count;
  const w = 1 / Math.sqrt(total);
  return rbar * (block.length * w) ** 2;
}

/** ρC on the reported loadings with the model-implied block correlations (all constructs as common factors). */
export function rhoC(SigmaCf: Mat, fit: CoreFit, j: number, block: readonly number[]): number {
  let total = 0;
  for (const a of block) for (const b of block) total += SigmaCf[a]![b]!;
  const w = 1 / Math.sqrt(total);
  let s = 0;
  for (const a of block) s += w * fit.Lambda[j]![a]!;
  return s * s;
}

/** AVE = Σλ² / (Σλ² + Σ(1 − λ²)) over the block's non-zero loadings. */
export function ave(fit: CoreFit, j: number, block: readonly number[]): number {
  let s2 = 0;
  let s1 = 0;
  for (const a of block) {
    const l = fit.Lambda[j]![a]!;
    if (l === 0) continue;
    s2 += l * l;
    s1 += 1 - l * l;
  }
  return s2 / (s2 + s1);
}

/** ρA = Q² of the PLSc correction applied to these (identical) weights. */
export function rhoA(S: Mat, W: Mat, block: readonly number[], j: number): number {
  const w = block.map((a) => W[j]![a]!);
  const c = block.length === 1 ? 1 : correctionFactor(S, w, block);
  let q = 0;
  for (const x of w) q += x * c * x;
  return q * q;
}

function nthRoot(x: number, n: number): number {
  if (x < 0 && n % 2 === 1) return Math.sign(x) * Math.abs(x) ** (1 / n);
  return x ** (1 / n);
}

function lowerTri(S: Mat, block: readonly number[]): number[] {
  // column-major lower triangle, as S[lower.tri(S)]
  const out: number[] = [];
  for (let c = 0; c < block.length; c++)
    for (let r = c + 1; r < block.length; r++) out.push(S[block[r]!]![block[c]!]!);
  return out;
}

/** HTMT / HTMT2 of two blocks (absolute value), as cSEM:::calculateHTMTcore. NaN when undefined. */
export function htmtPair(
  S: Mat,
  b1: readonly number[],
  b2: readonly number[],
  type: 'htmt' | 'htmt2',
): number {
  const mono1 = b1.length === 1 ? [1] : lowerTri(S, b1);
  const mono2 = b2.length === 1 ? [1] : lowerTri(S, b2);
  let het: number[] = [];
  for (const c of b2) for (const r of b1) het.push(S[r]![c]!);
  let signId = 1;
  if (het.every((v) => Math.sign(v) === -1)) {
    het = het.map(Math.abs);
    signId = -1;
  }
  let a1: number;
  let a2: number;
  let a3: number;
  if (type === 'htmt') {
    const meanOf = (x: number[]): number => x.reduce((s, v) => s + v, 0) / x.length;
    a1 = meanOf(mono1);
    a2 = meanOf(mono2);
    a3 = meanOf(het);
  } else {
    const prod = (x: number[]): number => x.reduce((s, v) => s * v, 1);
    a1 = nthRoot(prod(mono1), mono1.length);
    a2 = nthRoot(prod(mono2), mono2.length);
    a3 = nthRoot(prod(het), het.length);
  }
  return Math.abs((a3 / Math.sqrt(a1 * a2)) * signId);
}

/** Pearson correlation of every indicator (rows) with every construct score (columns). */
export function crossLoadings(fit: CoreFit, S: Mat, model: CoreModel): Mat {
  const { p, k, blocks } = model;
  const out: Mat = Array.from({ length: p }, () => new Array<number>(k).fill(0));
  for (let j = 0; j < k; j++) {
    const sdj = Math.sqrt(fit.C[j]![j]!);
    for (let i = 0; i < p; i++) {
      let s = 0;
      for (const a of blocks[j]!) s += fit.W[j]![a]! * S[a]![i]!;
      out[i]![j] = s / sdj;
    }
  }
  return out;
}

/** f²[t][s] for every path s → t (NaN elsewhere). */
export function f2(fit: CoreFit, model: CoreModel, n: number): Mat {
  const k = model.k;
  const out: Mat = Array.from({ length: k }, () => new Array<number>(k).fill(NaN));
  for (let t = 0; t < k; t++) {
    for (let s = 0; s < k; s++) {
      if (model.structural[t]![s] !== 1) continue;
      const reduced = model.structural.map((row) => [...row]);
      reduced[t]![s] = 0;
      const r2excl = reduced[t]!.some((v) => v === 1) ? estimatePaths(fit.P, reduced, n).R2[t]! : 0;
      const r2 = fit.R2[t]!;
      out[t]![s] = (r2 - r2excl) / (1 - r2);
    }
  }
  return out;
}

/** VIF of each indicator of a Mode B block: 1/(1 − R²) of its regression on the others. */
export function vifModeB(S: Mat, block: readonly number[]): number[] {
  const inv = inverseR(sub(S, block, block));
  return block.map((_, i) => inv[i]![i]!);
}

export interface FitIndices {
  srmr: number;
  dUls: number;
  dG: number;
}

/** SRMR, d_ULS and d_G (base-10 logarithm) against the model-implied indicator correlations. */
export function fitIndices(S: Mat, fit: CoreFit, model: CoreModel): FitIndices {
  const Sigma = modelImpliedIndicatorCor(S, fit, model);
  const p = S.length;
  const ds = S.map((r, i) => Math.sqrt(r[i]!));
  const dh = Sigma.map((r, i) => Math.sqrt(r[i]!));
  let srmrSum = 0;
  let count = 0;
  let dl = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      const d = S[i]![j]! - Sigma[i]![j]!;
      dl += d * d;
      if (j <= i) {
        // cov2cor on both matrices
        const c =
          (i === j ? 1 : S[i]![j]! / (ds[i]! * ds[j]!)) -
          (i === j ? 1 : Sigma[i]![j]! / (dh[i]! * dh[j]!));
        srmrSum += c * c;
        count++;
      }
    }
  }
  let dG: number;
  try {
    dG = geodesic(S, Sigma);
  } catch (e) {
    if (e instanceof NumericalError) dG = NaN;
    else throw e;
  }
  return { srmr: Math.sqrt(srmrSum / count), dUls: 0.5 * dl, dG };
}

/** 0.5 Σ (log10 λ_i)², λ eigenvalues of S⁻¹Σ̂ (via the symmetric form L⁻¹Σ̂L⁻ᵀ, S = LLᵀ). */
function geodesic(S: Mat, Sigma: Mat): number {
  const chol = new CholeskyDecomposition(new Matrix(S));
  if (!chol.isPositiveDefinite()) throw new NumericalError('S is not positive definite');
  const L = chol.lowerTriangularMatrix.to2DArray();
  const p = S.length;
  // X = L⁻¹ Σ (forward substitution per column), then M = L⁻¹ Xᵀ
  const fwd = (B: Mat): Mat => {
    const out: Mat = B.map((r) => [...r]);
    for (let c = 0; c < p; c++) {
      for (let i = 0; i < p; i++) {
        let v = out[i]![c]!;
        for (let m = 0; m < i; m++) v -= L[i]![m]! * out[m]![c]!;
        out[i]![c] = v / L[i]![i]!;
      }
    }
    return out;
  };
  const X = fwd(Sigma);
  const Xt = X[0] ? X[0].map((_, c) => X.map((r) => r[c]!)) : [];
  const M = fwd(Xt);
  for (let i = 0; i < p; i++)
    for (let j = 0; j < i; j++) M[i]![j] = M[j]![i] = 0.5 * (M[i]![j]! + M[j]![i]!);
  const ev = symmetricEigenvalues(M);
  let s = 0;
  for (const v of ev) s += Math.log10(v) ** 2;
  return 0.5 * s;
}

/** All common-factor blocks with ≥ 2 indicators (the R engine's eligibility for α, ρ, AVE, HTMT, FL). */
export function reliabilityEligible(model: CoreModel): boolean[] {
  return model.blocks.map((b, j) => model.commonFactor[j]! && b.length >= 2);
}

/** Model-implied correlations with composites converted to common factors (calculateRhoC). */
export function rhoCSigma(S: Mat, fit: CoreFit, model: CoreModel): Mat {
  return modelImpliedIndicatorCor(S, fit, model, true);
}
