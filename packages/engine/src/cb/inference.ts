/**
 * Sampling variances and the Yuan–Bentler (Mplus variant) scaling of the χ² statistic.
 *
 * - ML, complete data: vcov = (N · I_E)⁻¹ with the expected information I_E (lavaan
 *   information = "expected", h1.information = "structured").
 * - ML, FIML: vcov = (N · I_O)⁻¹ with the observed information I_O (lavaan default for
 *   missing = "ml": information = "observed", observed.information = "hessian").
 * - MLR: vcov = I_O⁻¹ B₀ I_O⁻¹ / N (Huber–White), B₀ = mean casewise score cross-product
 *   evaluated at the structured (model-implied) moments.
 * - Yuan–Bentler-Mplus trace: tr(B₁ A₁⁻¹) − tr(B₀ I_O⁻¹), A₁/B₁ = observed / first-order
 *   information of the saturated model at the h1 estimates (unstructured); c = trace / df.
 */
import { Mat, inverse, mul, symEigenvalues } from './matrix.ts';
import {
  expectedHessian,
  firstOrderInformation,
  observedInformation,
  type SampleData,
} from './objective.ts';
import type { Parameterization } from './parameterization.ts';

export type InformationKind = 'expected' | 'observed';

export interface VcovResult {
  vcov: Mat | null;
  /** Information used (per case). */
  information: Mat | null;
  /** First-order information at the solution (MLR). */
  firstOrder: Mat | null;
  /** Inverse information (needed for the Yuan–Bentler trace). */
  infoInverse: Mat | null;
  problem?: 'information-singular' | 'information-failed';
  minEigen?: number;
}

export function informationMatrix(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
  kind: InformationKind,
): Mat | null {
  if (kind === 'expected') {
    const H = expectedHessian(par, data, x);
    if (!H) return null;
    for (let i = 0; i < H.d.length; i++) H.d[i] = H.d[i]! * 0.5;
    return H;
  }
  return observedInformation(par, data, x);
}

/** Relative eigenvalue threshold below which the information matrix is treated as singular. */
const SINGULAR_REL = 1e-10;

export function computeVcov(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
  kind: InformationKind,
  robust: boolean,
): VcovResult {
  const info = informationMatrix(par, data, x, kind);
  if (!info || info.d.some((v) => !Number.isFinite(v)))
    return {
      vcov: null,
      information: null,
      firstOrder: null,
      infoInverse: null,
      problem: 'information-failed',
    };
  const ev = symEigenvalues(info);
  const maxEv = Math.max(...ev.map(Math.abs), 0);
  const minEv = Math.min(...ev);
  const inv = inverse(info);
  if (!inv || !(minEv > SINGULAR_REL * maxEv))
    return {
      vcov: null,
      information: info,
      firstOrder: null,
      infoInverse: null,
      problem: 'information-singular',
      minEigen: minEv,
    };
  const n = data.n;
  if (!robust) {
    const v = new Mat(inv.r, inv.c);
    for (let i = 0; i < inv.d.length; i++) v.d[i] = inv.d[i]! / n;
    return { vcov: v, information: info, firstOrder: null, infoInverse: inv };
  }
  const B = firstOrderInformation(par, data, x);
  if (!B)
    return {
      vcov: null,
      information: info,
      firstOrder: null,
      infoInverse: inv,
      problem: 'information-failed',
    };
  const s = mul(mul(inv, B), inv);
  for (let i = 0; i < s.d.length; i++) s.d[i] = s.d[i]! / n;
  return { vcov: s, information: info, firstOrder: B, infoInverse: inv };
}

/** tr(B A⁻¹) given A⁻¹. */
export function traceProduct(B: Mat, Ainv: Mat): number {
  let t = 0;
  for (let i = 0; i < B.r; i++) for (let j = 0; j < B.c; j++) t += B.get(i, j) * Ainv.get(j, i);
  return t;
}

/** tr(B₁ A₁⁻¹) for the saturated model at the h1 estimates. */
export function h1Trace(sat: Parameterization, data: SampleData, xh1: Float64Array): number | null {
  const A1 = observedInformation(sat, data, xh1);
  const B1 = firstOrderInformation(sat, data, xh1);
  if (!A1 || !B1) return null;
  const A1inv = inverse(A1);
  if (!A1inv) return null;
  return traceProduct(B1, A1inv);
}

/** tr(B₀ I⁻¹) for a fitted (h0) model with observed information I. */
export function h0Trace(
  par: Parameterization,
  data: SampleData,
  x: Float64Array,
  infoInverse?: Mat | null,
  firstOrder?: Mat | null,
): number | null {
  const Iinv =
    infoInverse ??
    (() => {
      const I = observedInformation(par, data, x);
      return I ? inverse(I) : null;
    })();
  const B0 = firstOrder ?? firstOrderInformation(par, data, x);
  if (!Iinv || !B0) return null;
  return traceProduct(B0, Iinv);
}
