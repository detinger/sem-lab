import { describe, expect, it } from 'vitest';
import { pt, quantile7 } from '../src/index.ts';
import { ptLowerTailAbs, sampleSd } from '../src/shared/stats.ts';
import { readJson } from './helpers.ts';

const ref = readJson<{ cases: { t: number; df: number; lower: number; lowerTailAbs: number }[] }>(
  new URL('./fixtures/r-pt.json', import.meta.url).pathname,
);

describe('Student t CDF (regularised incomplete beta) equals R stats::pt', () => {
  it(`${ref.cases.length} (t, df) pairs, relative tail error ≤ 5e-12`, () => {
    let maxRel = 0;
    let maxAbs = 0;
    for (const c of ref.cases) {
      const a = pt(c.t, c.df);
      const tail = ptLowerTailAbs(c.t, c.df);
      maxAbs = Math.max(maxAbs, Math.abs(a - c.lower));
      const rel =
        c.lowerTailAbs === 0 ? Math.abs(tail) : Math.abs(tail - c.lowerTailAbs) / c.lowerTailAbs;
      maxRel = Math.max(maxRel, rel);
      expect(Math.abs(a - c.lower), `pt(${c.t}, ${c.df})`).toBeLessThanOrEqual(1e-13);
      expect(rel, `pt(-|${c.t}|, ${c.df}) relative`).toBeLessThanOrEqual(5e-12);
    }
    process.stderr.write(
      `pt vs R: max abs ${maxAbs.toExponential(2)}, max tail rel ${maxRel.toExponential(2)}\n`,
    );
  });

  it('handles infinities and invalid df', () => {
    expect(pt(Infinity, 5)).toBe(1);
    expect(pt(-Infinity, 5)).toBe(0);
    expect(ptLowerTailAbs(Infinity, 5)).toBe(0);
    expect(Number.isNaN(pt(1, 0))).toBe(true);
  });
});

describe('quantile type 7 and sd', () => {
  it('matches R quantile(type = 7) on a small example', () => {
    // R: quantile(c(3, 1, 4, 1, 5, 9, 2, 6), c(0.025, 0.5, 0.975), type = 7)
    expect(quantile7([3, 1, 4, 1, 5, 9, 2, 6], [0.025, 0.5, 0.975])).toEqual([
      1, 3.5, 8.475000000000001,
    ]); // R prints 8.4750000000000014
    expect(quantile7([2], [0.05, 0.95])).toEqual([2, 2]);
  });
  it('sd uses divisor n - 1', () => {
    expect(sampleSd([1, 2, 3, 4])).toBeCloseTo(1.2909944487358056, 15);
  });
});
