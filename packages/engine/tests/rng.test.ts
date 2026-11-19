import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rSetSeed, runif } from '../src/rng/r-mt.ts';
import { bootstrapIndices } from '../src/pls/bootstrap.ts';

interface RngCase {
  seed: number;
  runif: number[];
  sample_int: { n: number; idx: number[] }[];
  bootstrap_n12_B3: number[][];
}
const ref = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../fixtures/reference-results/rng/r-mersenne-twister.json', import.meta.url),
    ),
    'utf8',
  ),
) as { cases: RngCase[] };

describe('R Mersenne-Twister (set.seed kind MT, sample.kind Rejection)', () => {
  it('covers the edge-case seeds and sizes', () => {
    const seeds = ref.cases.map((c) => c.seed);
    expect(seeds).toEqual(expect.arrayContaining([0, -7, 2147483646]));
    const ns = ref.cases[0]!.sample_int.map((s) => s.n);
    expect(ns).toEqual(expect.arrayContaining([65536, 65537, 1000000]));
  });

  for (const c of ref.cases) {
    it(`seed ${c.seed}: runif and sample.int are bit-identical`, () => {
      const rng = rSetSeed(c.seed);
      const u = runif(rng, c.runif.length);
      // to the last bit
      expect(u).toEqual(c.runif);
      // the sample.int block starts from a fresh set.seed(seed) and is drawn sequentially
      rng.setSeed(c.seed);
      for (const s of c.sample_int) {
        const idx = Array.from(rng.sampleIntReplace(s.n, s.idx.length));
        expect(idx, `n = ${s.n}`).toEqual(s.idx);
      }
    });

    it(`seed ${c.seed}: bootstrapIndices(seed, 12, 3) equals R`, () => {
      // bootstrapIndices yields 0-based rows; R's sample.int is 1-based
      const draws = [...bootstrapIndices(c.seed, 12, 3)].map((d) => Array.from(d, (v) => v + 1));
      expect(draws).toEqual(c.bootstrap_n12_B3);
    });
  }
});
