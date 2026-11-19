import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  correlations,
  histogramBinCount,
  missingness,
  pearson,
  profileColumn,
  profileDataset,
} from './stats';
import { createDataset } from './transform';
import type { Dataset, DatasetColumn } from './types';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SMARTPLS = join(ROOT, 'packages', 'fixtures', 'third-party', 'smartpls-samples');
const SYNTHETIC = join(ROOT, 'packages', 'fixtures', 'synthetic');

async function datasetFrom(path: string): Promise<Dataset> {
  const r = await createDataset(readFileSync(path, 'utf8'), {
    name: 'test',
    source: { kind: 'file', fileName: 'data.csv' },
    id: 'd_test',
    importedAt: '2026-11-19T00:00:00Z',
  });
  if ('error' in r) throw new Error(r.error.message);
  return r;
}

const num = (name: string, values: number[]): DatasetColumn => ({
  name,
  kind: 'numeric',
  values: Float64Array.from(values),
});

interface Reference {
  name: string;
  n: number;
  nMissing: number;
  mean: number;
  median: number;
  standardDeviation: number;
  skewness: number | null;
  kurtosis: number | null;
  min: number;
  max: number;
}

const REL_TOL = 1e-9;
const close = (actual: number | null, expected: number | null): boolean =>
  expected === null
    ? actual === null
    : actual !== null && Math.abs(actual - expected) <= REL_TOL * Math.max(1, Math.abs(expected));

describe('descriptive statistics against the values SmartPLS stores', () => {
  const datasets = ['acsi-2015', 'tam', 'utaut', 'oi', 'concise-guide', 'hbat'];
  for (const slug of datasets) {
    const csv = join(SMARTPLS, slug, 'data.csv');
    const present = existsSync(csv);
    const title = present
      ? `${slug}: every column matches reference-descriptives.json (1e-9 relative; median/min/max exact)`
      : `${slug}: SKIPPED — data.csv is git-ignored (redistribution terms unverified) and absent here; regenerate it with packages/fixtures/scripts/build_third_party.py`;
    if (slug === 'acsi-2015')
      expect(present, 'acsi-2015/data.csv is tracked and must exist').toBe(true);
    it.skipIf(!present)(title, async () => {
      const ref = JSON.parse(
        readFileSync(join(SMARTPLS, slug, 'reference-descriptives.json'), 'utf8'),
      ) as { columns: Reference[] };
      const ds = await datasetFrom(csv);
      const profiles = profileDataset(ds);
      expect(profiles.map((p) => p.name)).toEqual(ref.columns.map((c) => c.name));
      for (const [j, r] of ref.columns.entries()) {
        const p = profiles[j]!;
        const where = `${slug}.${r.name}`;
        expect(p.kind, where).toBe('numeric');
        expect([p.n, p.nMissing], where).toEqual([r.n, r.nMissing]);
        expect(p.median, where).toBe(r.median);
        expect(p.min, where).toBe(r.min);
        expect(p.max, where).toBe(r.max);
        expect(close(p.mean, r.mean), `${where} mean ${p.mean} vs ${r.mean}`).toBe(true);
        expect(
          close(p.sdPopulation, r.standardDeviation),
          `${where} sd ${p.sdPopulation} vs ${r.standardDeviation}`,
        ).toBe(true);
        expect(close(p.skewness, r.skewness), `${where} skew ${p.skewness} vs ${r.skewness}`).toBe(
          true,
        );
        expect(close(p.kurtosis, r.kurtosis), `${where} kurt ${p.kurtosis} vs ${r.kurtosis}`).toBe(
          true,
        );
        // sample SD is the population SD rescaled; checked for consistency, not against SmartPLS
        if (p.n >= 2)
          expect(close(p.sdSample, r.standardDeviation * Math.sqrt(r.n / (r.n - 1)))).toBe(true);
      }
    });
  }
});

describe('profileColumn', () => {
  it('returns null, never NaN, below the minimum n of each statistic', () => {
    const p0 = profileColumn(num('a', [NaN, NaN]));
    expect(p0).toMatchObject({ n: 0, nMissing: 2, mean: null, median: null, sdPopulation: null });
    const p1 = profileColumn(num('a', [4]));
    expect(p1).toMatchObject({ n: 1, mean: 4, median: 4, sdPopulation: 0, sdSample: null });
    const p2 = profileColumn(num('a', [1, 3]));
    expect(p2).toMatchObject({ mean: 2, median: 3, sdSample: Math.SQRT2, skewness: null });
    const p3 = profileColumn(num('a', [1, 2, 6]));
    expect(p3.skewness).not.toBeNull();
    expect(p3.kurtosis).toBeNull();
    const p4 = profileColumn(num('a', [1, 2, 6, 9]));
    expect(p4.kurtosis).not.toBeNull();
    for (const p of [p0, p1, p2, p3, p4])
      for (const v of Object.values(p))
        if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
  });

  it('uses the upper median and labels both standard deviations', () => {
    const p = profileColumn(num('a', [4, 1, 3, 2]));
    expect(p.median).toBe(3);
    expect(p.sdPopulation).toBeCloseTo(Math.sqrt(1.25), 15);
    expect(p.sdSample).toBeCloseTo(Math.sqrt(5 / 3), 15);
  });

  it('matches G1/G2 computed independently with exact rational moments', () => {
    // Python: moments m2, m3, m4 as fractions.Fraction, then the G1/G2 formulas in floating point.
    const p = profileColumn(num('a', [2, 8, 0, 4, 1, 9, 9, 0]));
    expect(p.skewness).toBeCloseTo(0.33058218040797466, 13);
    expect(p.kurtosis).toBeCloseTo(-2.098602258096087, 13);
  });

  it('gives null skewness and kurtosis for a constant column', () => {
    const p = profileColumn(num('a', [0.1, 0.1, 0.1, 0.1, 0.1]));
    expect(p).toMatchObject({ sdPopulation: 0, sdSample: 0, skewness: null, kurtosis: null });
  });

  it('is numerically stable with a large offset', () => {
    const p = profileColumn(num('a', [1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]));
    expect(p.sdSample).toBeCloseTo(Math.sqrt(30), 9);
    expect(p.skewness).toBeCloseTo(0, 12);
  });

  it('gives value counts for ≤ 15 distinct integers and a histogram otherwise', () => {
    const likert = profileColumn(num('a', [1, 2, 2, 7, NaN]));
    expect(likert.integerValued).toBe(true);
    expect(likert.valueCounts).toEqual([
      { value: 1, count: 1 },
      { value: 2, count: 2 },
      { value: 7, count: 1 },
    ]);
    expect(likert.histogram).toBeUndefined();

    const xs = Array.from({ length: 1000 }, (_, i) => i / 7);
    const cont = profileColumn(num('b', xs));
    expect(cont.valueCounts).toBeUndefined();
    expect(cont.histogram).toHaveLength(histogramBinCount(1000)); // Sturges: 11
    expect(cont.histogram!.reduce((s, b) => s + b.count, 0)).toBe(1000);
    expect(cont.histogram![0]!.from).toBe(0);
    expect(cont.histogram!.at(-1)!.to).toBe(999 / 7);

    const manyInts = profileColumn(
      num(
        'c',
        Array.from({ length: 16 }, (_, i) => i),
      ),
    );
    expect(manyInts.valueCounts).toBeUndefined();
    expect(manyInts.histogram).toHaveLength(10);
  });

  it('clamps the histogram bin count to 10–30', () => {
    expect(histogramBinCount(5)).toBe(10);
    expect(histogramBinCount(1e12)).toBe(30);
  });

  it('profiles text and empty columns without statistics', () => {
    const text = profileColumn({
      name: 't',
      kind: 'text',
      values: ['1', 'n/a', null],
      nonNumericCount: 1,
      examples: ['n/a'],
    });
    expect(text).toMatchObject({
      kind: 'text',
      n: 2,
      nMissing: 1,
      nUnique: 2,
      mean: null,
      nonNumericCount: 1,
      nonNumericExamples: ['n/a'],
    });
    expect(profileColumn({ name: 'e', kind: 'empty', length: 3 })).toMatchObject({
      kind: 'empty',
      n: 0,
      nMissing: 3,
      nUnique: 0,
      min: null,
    });
  });
});

/** Independent textbook formula: r = (nΣxy − ΣxΣy) / √((nΣx² − (Σx)²)(nΣy² − (Σy)²)). */
function naivePearson(x: number[], y: number[]): number {
  const n = x.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
    sxx += x[i]! * x[i]!;
    syy += y[i]! * y[i]!;
    sxy += x[i]! * y[i]!;
  }
  return (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
}

describe('correlations', () => {
  it('matches a hand computation', () => {
    // dx = −2..2, dy = (−2, 0, 1, 0, 1): r = 6 / √(10·6)
    expect(pearson(Float64Array.from([1, 2, 3, 4, 5]), Float64Array.from([2, 4, 5, 4, 5]))).toBe(
      6 / Math.sqrt(60),
    );
    expect(pearson(Float64Array.from([1, 2]), Float64Array.from([2, 1]))).toBeNull();
    expect(pearson(Float64Array.from([1, 1, 1]), Float64Array.from([2, 1, 3]))).toBeNull();
  });

  it('agrees with an independent formula on pls-two-construct pairs', async () => {
    const ds = await datasetFrom(join(SYNTHETIC, 'pls-two-construct', 'data.csv'));
    const cols = ['x1', 'x2', 'x3', 'y1', 'x3_rev'];
    const m = correlations(ds, cols, 'pairwise');
    const get = (c: string) =>
      Array.from((ds.columns.find((d) => d.name === c) as { values: Float64Array }).values);
    for (const [a, b] of [
      ['x1', 'x2'],
      ['x1', 'y1'],
      ['x2', 'x3'],
    ] as const) {
      const r = m.values[cols.indexOf(a)]![cols.indexOf(b)]!;
      expect(r).toBeCloseTo(naivePearson(get(a), get(b)), 12);
    }
    // x3_rev = 8 − x3 is a perfect negative copy
    expect(m.values[2]![4]).toBeCloseTo(-1, 14);
    expect(m.values[0]![0]).toBe(1);
    expect(m.n[0]![1]).toBe(300);
  });

  it('uses per-pair n (pairwise) or the complete-row n (listwise) on missing-mcar', async () => {
    const ds = await datasetFrom(join(SYNTHETIC, 'missing-mcar', 'data.csv'));
    const cols = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];
    const pw = correlations(ds, cols, 'pairwise');
    const lw = correlations(ds, cols, 'listwise');
    expect(pw.n[0]![0]).toBe(500 - 42);
    expect(pw.n[4]![4]).toBe(500 - 45);
    const v = (c: string) =>
      (ds.columns.find((d) => d.name === c) as { values: Float64Array }).values;
    const both = Array.from(v('v1')).filter(
      (x, i) => !Number.isNaN(x) && !Number.isNaN(v('v2')[i]!),
    );
    expect(pw.n[0]![1]).toBe(both.length);
    expect(lw.n.flat().every((n) => n === 258)).toBe(true);
    expect(pw.values[0]![1]).not.toBe(lw.values[0]![1]);
    const xs: number[] = [];
    const ys: number[] = [];
    v('v1').forEach((x, i) => {
      if (!Number.isNaN(x) && !Number.isNaN(v('v2')[i]!)) {
        xs.push(x);
        ys.push(v('v2')[i]!);
      }
    });
    expect(pw.values[0]![1]).toBeCloseTo(naivePearson(xs, ys), 12);
  });

  it('treats text columns as having no numeric values and refuses unknown columns', () => {
    const ds = {
      rowIndex: [0, 1, 2, 3],
      columns: [
        num('a', [1, 2, 3, 4]),
        { name: 't', kind: 'text', values: ['x', 'y', 'z', 'w'], nonNumericCount: 4, examples: [] },
      ] as DatasetColumn[],
    };
    const m = correlations(ds, ['a', 't'], 'pairwise');
    expect(m.values[0]![1]).toBeNull();
    expect(m.n[1]![1]).toBe(0);
    expect(() => correlations(ds, ['nope'], 'pairwise')).toThrow(/Unknown column "nope"/);
  });
});

describe('missingness', () => {
  it('summarises missing-mcar exactly as its manifest states', async () => {
    const manifest = JSON.parse(
      readFileSync(join(SYNTHETIC, 'missing-mcar', 'manifest.json'), 'utf8'),
    ) as { completeRows: number; missingPerColumn: Record<string, number> };
    const ds = await datasetFrom(join(SYNTHETIC, 'missing-mcar', 'data.csv'));
    const cols = Object.keys(manifest.missingPerColumn);
    const s = missingness(ds, cols);
    expect(s.rows).toBe(500);
    expect(s.completeRows).toBe(manifest.completeRows);
    expect(Object.fromEntries(s.byColumn.map((b) => [b.column, b.missing]))).toEqual(
      manifest.missingPerColumn,
    );
    expect(s.patterns[0]).toEqual({ missing: new Array(8).fill(false), count: 258 });
    expect(s.patterns.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < s.patterns.length; i++)
      expect(s.patterns[i - 1]!.count).toBeGreaterThanOrEqual(s.patterns[i]!.count);
  });
});
