/**
 * Minimisation of the ML discrepancy by Fisher scoring (Gauss–Newton with the expected
 * information) with a backtracking line search that keeps Σ(θ) positive definite, finished by
 * Newton steps on the exact (finite-difference) Hessian when it is positive definite. The
 * analytic gradient is used throughout. Convergence: max |∂f/∂θ| ≤ gradTol after a step whose
 * size is below stepTol.
 */
import { type Mat, cholesky, solve } from './matrix.ts';
import {
  expectedHessian,
  objectiveAndGradient,
  objectiveOnly,
  observedInformation,
  type SampleData,
} from './objective.ts';
import type { Parameterization } from './parameterization.ts';

export interface OptimResult {
  x: Float64Array;
  f: number;
  grad: Float64Array;
  iterations: number;
  converged: boolean;
  message?: string;
}

export function minimize(
  par: Parameterization,
  data: SampleData,
  start: Float64Array,
  opts: { maxIter?: number; gradTol?: number; stepTol?: number } = {},
): OptimResult {
  const maxIter = opts.maxIter ?? 500;
  const gradTol = opts.gradTol ?? 1e-9;
  const stepTol = opts.stepTol ?? 1e-12;
  let x: Float64Array = Float64Array.from(start);
  let cur = objectiveAndGradient(par, data, x);
  if (!cur)
    return {
      x,
      f: NaN,
      grad: new Float64Array(par.npar),
      iterations: 0,
      converged: false,
      message: 'the starting values imply a non-positive-definite covariance matrix',
    };
  const maxAbs = (v: Float64Array): number => v.reduce((m, a) => Math.max(m, Math.abs(a)), 0);
  let it: number;
  let small = 0;
  let newton = false;
  for (it = 1; it <= maxIter; it++) {
    let H: Mat | null = null;
    if (newton) {
      const obs = observedInformation(par, data, x);
      if (obs) {
        H = obs;
        for (let i = 0; i < H.d.length; i++) H.d[i] = H.d[i]! * 2;
        if (!cholesky(H)) H = null;
      }
    }
    if (!H) H = expectedHessian(par, data, x);
    // Candidate directions: (quasi-)Newton step, then ridge-regularised steps (for a (near-)
    // singular information matrix, e.g. empirical under-identification), then steepest descent.
    const directions: Array<() => Float64Array | null> = [() => (H ? solve(H, cur!.grad) : null)];
    if (H) {
      let tr = 0;
      for (let i = 0; i < H.r; i++) tr += Math.abs(H.get(i, i));
      for (let k = 0; k < 6; k++)
        directions.push(() => {
          const R = H.clone();
          const ridge = (tr / Math.max(H.r, 1)) * Math.pow(10, -8 + 2 * k);
          for (let i = 0; i < R.r; i++) R.add(i, i, ridge);
          return solve(R, cur!.grad);
        });
    }
    directions.push(() => Float64Array.from(cur!.grad));
    let accepted: { x: Float64Array; f: number } | null = null;
    let step: Float64Array = cur.grad;
    let alpha = 1;
    for (const dir of directions) {
      const s = dir();
      if (!s || s.some((v) => !Number.isFinite(v))) continue;
      let slope = 0;
      for (let i = 0; i < s.length; i++) slope += s[i]! * cur.grad[i]!;
      if (!(slope > 0)) continue;
      alpha = 1;
      for (let k = 0; k < 40; k++) {
        const y = new Float64Array(x.length);
        for (let i = 0; i < x.length; i++) y[i] = x[i]! - alpha * s[i]!;
        const fy = objectiveOnly(par, data, y);
        if (
          fy !== null &&
          Number.isFinite(fy) &&
          fy <= cur.f - 1e-4 * alpha * slope + 1e-13 * Math.abs(cur.f)
        ) {
          accepted = { x: y, f: fy };
          break;
        }
        alpha /= 2;
      }
      if (accepted) {
        step = s;
        break;
      }
    }
    if (!accepted) break;
    const stepSize = maxAbs(step) * alpha;
    x = accepted.x;
    const next = objectiveAndGradient(par, data, x);
    if (!next) break;
    const df = cur.f - next.f;
    cur = next;
    const g = maxAbs(cur.grad);
    if (g < 1e-4) newton = true;
    if (stepSize < stepTol || (g < gradTol && Math.abs(df) < 1e-15)) {
      small++;
      if (small >= 2 || g < gradTol * 1e-3) break;
    } else small = 0;
  }
  const g = maxAbs(cur.grad);
  return {
    x,
    f: cur.f,
    grad: cur.grad,
    iterations: Math.min(it, maxIter),
    converged: g < Math.max(gradTol * 100, 1e-7),
  };
}
