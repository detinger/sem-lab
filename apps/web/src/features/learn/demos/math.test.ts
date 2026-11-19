import { describe, expect, it } from 'vitest';
import { cfiValue } from '../../../../../../packages/engine/src/cb/engine.ts';
import { rmseaPoint as rmseaPointDist } from '../../../../../../packages/engine/src/cb/distributions.ts';
import {
  BOOTSTRAP_SAMPLE,
  bootstrap,
  cfi,
  fSquared,
  fSquaredLabel,
  histogram,
  htmt,
  mediation,
  performance,
  reliabilityFromLoadings,
  rmsea,
  sampleStatistic,
  vif,
} from './math';

describe('reliability from loadings', () => {
  it('matches hand computation for four loadings of .8', () => {
    const r = reliabilityFromLoadings([0.8, 0.8, 0.8, 0.8]);
    expect(r.pairs).toHaveLength(6);
    expect(r.meanR).toBeCloseTo(0.64, 12);
    expect(r.alpha).toBeCloseTo((4 * 0.64) / (1 + 3 * 0.64), 12); // 0.876712…
    expect(r.alpha).toBeCloseTo(0.8767123, 6);
    // (Σλ)² = 10.24; Σ(1−λ²) = 4·0.36 = 1.44 → 10.24 / 11.68
    expect(r.rhoC).toBeCloseTo(10.24 / 11.68, 12);
    expect(r.ave).toBeCloseTo(0.64, 12);
  });
  it('handles unequal loadings (.9, .7, .5)', () => {
    const r = reliabilityFromLoadings([0.9, 0.7, 0.5]);
    expect(r.meanR).toBeCloseTo((0.63 + 0.45 + 0.35) / 3, 12);
    expect(r.alpha).toBeCloseTo((3 * (1.43 / 3)) / (1 + 2 * (1.43 / 3)), 12);
    expect(r.rhoC).toBeCloseTo(2.1 ** 2 / (2.1 ** 2 + (0.19 + 0.51 + 0.75)), 12);
    expect(r.ave).toBeCloseTo((0.81 + 0.49 + 0.25) / 3, 12);
    // α (tau-equivalent) never exceeds ρC when loadings differ
    expect(r.alpha).toBeLessThan(r.rhoC);
  });
});

describe('HTMT, VIF, f²', () => {
  it('HTMT = h / √(a·b)', () => {
    expect(htmt(0.6, 0.64, 0.81)).toBeCloseTo(0.6 / Math.sqrt(0.64 * 0.81), 12);
    expect(htmt(0.6, 0.64, 0.81)).toBeCloseTo(0.8333333, 6);
    expect(htmt(0.6, 0, 0.5)).toBeNull();
  });
  it('VIF = 1/(1−R²)', () => {
    expect(vif(0.8)).toBeCloseTo(5, 12);
    expect(vif(0)).toBe(1);
    expect(vif(0.75)).toBeCloseTo(4, 12);
    expect(vif(1)).toBeNull();
  });
  it('f² = (R²in − R²ex)/(1 − R²in)', () => {
    expect(fSquared(0.5, 0.4)).toBeCloseTo(0.2, 12);
    expect(fSquared(0.6, 0.6)).toBe(0);
    expect(fSquared(1, 0.5)).toBeNull();
    expect(fSquaredLabel(0.2)).toBe('medium');
    expect(fSquaredLabel(0.02)).toBe('small');
    expect(fSquaredLabel(0.0199)).toBe('none');
    expect(fSquaredLabel(0.35)).toBe('large');
  });
});

describe('mediation', () => {
  it('computes indirect and total effects', () => {
    const m = mediation(0.5, 0.4, 0.2, true, true);
    expect(m.indirect).toBeCloseTo(0.2, 12);
    expect(m.total).toBeCloseTo(0.4, 12);
  });
  it('classifies the five Zhao et al. types', () => {
    expect(mediation(0.5, 0.4, 0.2, true, true).type).toBe('complementary');
    expect(mediation(-0.5, -0.4, 0.2, true, true).type).toBe('complementary');
    expect(mediation(0.5, 0.4, -0.2, true, true).type).toBe('competitive');
    expect(mediation(0.5, 0.4, 0.2, true, false).type).toBe('indirect-only');
    expect(mediation(0.5, 0.4, 0.2, false, true).type).toBe('direct-only');
    expect(mediation(0.5, 0.4, 0.2, false, false).type).toBe('no-effect');
    expect(mediation(0, 0.4, 0.2, true, true).type).toBeNull();
  });
});

describe('bootstrap demo', () => {
  it('has 25 observations and a hand-computed mean', () => {
    expect(BOOTSTRAP_SAMPLE).toHaveLength(25);
    expect(sampleStatistic(BOOTSTRAP_SAMPLE, 'mean')).toBeCloseTo(
      BOOTSTRAP_SAMPLE.reduce((s, p) => s + p[0], 0) / 25,
      12,
    );
    expect(
      sampleStatistic(
        [
          [1, 2],
          [2, 4],
          [3, 6],
        ],
        'correlation',
      ),
    ).toBeCloseTo(1, 12);
    expect(
      sampleStatistic(
        [
          [1, 2],
          [2, 4],
          [3, 7],
        ],
        'correlation',
      ),
    ).toBeCloseTo(5 / Math.sqrt(2 * (38 / 3)), 12);
  });
  it('is deterministic for a seed and differs between seeds', () => {
    const a = bootstrap('mean', 500, 123);
    const b = bootstrap('mean', 500, 123);
    const c = bootstrap('mean', 500, 124);
    expect(a.draws).toEqual(b.draws);
    expect(a.draws).not.toEqual(c.draws);
    expect(a.draws).toHaveLength(500);
  });
  it('SE uses divisor B−1 and the CI is the type-7 percentile interval', () => {
    const r = bootstrap('mean', 200, 7);
    const m = r.draws.reduce((s, v) => s + v, 0) / 200;
    const sd = Math.sqrt(r.draws.reduce((s, v) => s + (v - m) ** 2, 0) / 199);
    expect(r.se).toBeCloseTo(sd, 12);
    const sorted = [...r.draws].sort((x, y) => x - y);
    const q = (p: number): number => {
      const h = 199 * p;
      const lo = Math.floor(h);
      return sorted[lo]! + (h - lo) * (sorted[Math.min(lo + 1, 199)]! - sorted[lo]!);
    };
    expect(r.ci[0]).toBeCloseTo(q(0.025), 12);
    expect(r.ci[1]).toBeCloseTo(q(0.975), 12);
    // SE of a mean ≈ s/√n
    expect(r.se).toBeGreaterThan(0.2);
    expect(r.se).toBeLessThan(0.5);
  });
  it('rejects a seed that is not an R integer', () => {
    expect(() => bootstrap('mean', 10, 1.5)).toThrow();
  });
  it('histogram counts every draw', () => {
    const r = bootstrap('correlation', 300, 5);
    const h = histogram(r.draws, 12);
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(r.draws.length);
  });
});

describe('IPMA rescale', () => {
  it('uses declared endpoints', () => {
    expect(performance(5.5, 1, 7)).toBeCloseTo(75, 12);
    expect(performance(5.5, 3, 7)).toBeCloseTo(62.5, 12);
    expect(performance(5, 5, 5)).toBeNull();
  });
});

describe('RMSEA and CFI match the CB engine', () => {
  const cases: [number, number, number, number, number][] = [
    [85.3, 40, 300, 1200, 55],
    [30, 40, 300, 900, 45],
    [120, 24, 150, 600, 36],
    [40, 40, 500, 40, 40],
  ];
  it.each(cases)('x2=%d df=%d N=%d x2b=%d dfb=%d', (x2, df, n, x2b, dfb) => {
    expect(rmsea(x2, df, n)).toBeCloseTo(rmseaPointDist(x2, df, n), 12);
    expect(cfi(x2, df, x2b, dfb)).toBeCloseTo(cfiValue(x2, df, x2b, dfb), 12);
  });
  it('hand-computed values', () => {
    // RMSEA = sqrt((85.3/40 − 1)/300) = sqrt(1.1325/300)
    expect(rmsea(85.3, 40, 300)).toBeCloseTo(Math.sqrt(1.1325 / 300), 12);
    // CFI = 1 − 45.3 / max(45.3, 1145) = 1 − 45.3/1145
    expect(cfi(85.3, 40, 1200, 55)).toBeCloseTo(1 - 45.3 / 1145, 12);
    expect(rmsea(30, 40, 300)).toBe(0);
    expect(cfi(30, 40, 900, 45)).toBe(1);
  });
});
