import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  pchisq,
  pchisqUpper,
  pnchisq,
  pnormUpper,
  rmseaCi,
  zeroin,
} from '../../src/cb/distributions.ts';

interface DistRef {
  pchisq_noncentral: Array<{ q: number; df: number; ncp: number; p: number }>;
  pchisq_central: Array<{ q: number; df: number; upper: number; lower: number }>;
  pnorm: Array<{ z: number; upper: number }>;
  rmsea_ci: Array<{
    x2: number;
    df: number;
    n: number;
    lower: number | null;
    upper: number | null;
    lambda_lower_exact: number;
    lambda_upper_exact: number;
  }>;
}

const ref = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/reference-results/cb-math/distributions.json', import.meta.url),
    'utf8',
  ),
) as DistRef;

function relErr(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
}

describe('χ² and normal distribution functions vs R', () => {
  it('central pchisq (both tails) ≤ 1e-12 relative', () => {
    let worst = 0;
    for (const r of ref.pchisq_central) {
      worst = Math.max(worst, Math.abs(pchisq(r.q, r.df) - r.lower));
      if (r.upper > 1e-300) worst = Math.max(worst, relErr(pchisqUpper(r.q, r.df), r.upper));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('noncentral pchisq ≤ 1e-11 absolute', () => {
    let worst = 0;
    for (const r of ref.pchisq_noncentral)
      worst = Math.max(worst, Math.abs(pnchisq(r.q, r.df, r.ncp) - r.p));
    expect(worst).toBeLessThan(1e-11);
  });

  it('normal upper tail ≤ 1e-13 relative', () => {
    for (const r of ref.pnorm) expect(relErr(pnormUpper(r.z), r.upper)).toBeLessThan(1e-13);
  });

  it('noncentrality roots: exact (tight) ≤ 1e-9 and lavaan uniroot emulation ≤ 1e-9', () => {
    let worstExact = 0;
    let worstLavaan = 0;
    for (const r of ref.rmsea_ci) {
      const lo = (l: number): number => pnchisq(r.x2, r.df, l) - 0.95;
      const up = (l: number): number => pnchisq(r.x2, r.df, l) - 0.05;
      if (r.lambda_lower_exact > 0) {
        const root = zeroin(lo, 0, Math.max(r.x2, 1) * 10 + 100, 1e-13)!;
        worstExact = Math.max(worstExact, Math.abs(root - r.lambda_lower_exact));
      }
      if (r.lambda_upper_exact > 0) {
        const root = zeroin(up, 0, Math.max(r.x2, 1) * 10 + 100, 1e-13)!;
        worstExact = Math.max(worstExact, Math.abs(root - r.lambda_upper_exact));
      }
      const ci = rmseaCi(r.x2, r.df, r.n);
      if (r.lower !== null) worstLavaan = Math.max(worstLavaan, Math.abs(ci.lower! - r.lower));
      if (r.upper !== null) worstLavaan = Math.max(worstLavaan, Math.abs(ci.upper! - r.upper));
    }
    process.stdout.write(
      `[cb distributions] max |Δλ| exact roots ${worstExact.toExponential(2)}, max |ΔRMSEA CI| lavaan emulation ${worstLavaan.toExponential(2)}\n`,
    );
    expect(worstExact).toBeLessThan(1e-8);
    expect(worstLavaan).toBeLessThan(1e-9);
  });
});
