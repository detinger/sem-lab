/**
 * Timing report (Node, single thread): ms per fit and per 100 bootstrap draws for
 * tam-mediation (n = 500, 11 indicators) and the ACSI 2015 sample (listwise, 12 indicators).
 * Assertions are generous upper bounds; the numbers are printed for the record.
 */
import { describe, expect, it } from 'vitest';
import type { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import { estimatePls } from '../src/index.ts';
import { analysisData, FIXTURES, loadCase, readCsv, readJson } from './helpers.ts';

const ROOT = new URL('../../../', import.meta.url).pathname;

async function time(
  label: string,
  model: SemModel,
  data: ReturnType<typeof analysisData>,
  method: 'pls-sem' | 'plsc',
) {
  const base: AnalysisConfiguration = {
    method,
    engine: 'browser',
    estimator: 'pls-pm',
    missingData: 'listwise',
    pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-10 },
  };
  await estimatePls({ model, analysis: base, data }); // warm-up
  const reps = 20;
  let t0 = performance.now();
  for (let i = 0; i < reps; i++) {
    const out = await estimatePls({ model, analysis: base, data });
    expect(out.ok).toBe(true);
  }
  const perFit = (performance.now() - t0) / reps;
  const withBoot: AnalysisConfiguration = {
    ...base,
    seed: 1,
    bootstrap: {
      enabled: true,
      repetitions: 100,
      ci: 'percentile',
      confidenceLevel: 0.95,
      sides: 'two-sided',
    },
  };
  t0 = performance.now();
  const out = await estimatePls({ model, analysis: withBoot, data });
  const per100 = performance.now() - t0 - perFit;
  expect(out.ok).toBe(true);
  process.stderr.write(
    `performance ${label} ${method} (n = ${data.rows.length}, p = ${data.columns.length}): ` +
      `${perFit.toFixed(2)} ms per full fit with assessment; ${per100.toFixed(1)} ms per 100 bootstrap draws\n`,
  );
  return { perFit, per100 };
}

describe('performance (Node)', () => {
  it('tam-mediation', async () => {
    const { model, csv } = loadCase('tam-mediation');
    const data = analysisData(model, csv);
    for (const m of ['pls-sem', 'plsc'] as const) {
      const r = await time('tam-mediation', model, data, m);
      expect(r.per100).toBeLessThan(10_000);
    }
  });

  it('ACSI 2015 (real data, listwise)', async () => {
    const ex = readJson<{ model: SemModel }>(`${ROOT}content/examples/acsi-2015.json`);
    const csv = readCsv(`${FIXTURES}third-party/smartpls-samples/acsi-2015/data.csv`);
    const data = analysisData(ex.model, csv);
    expect(data.rows.length).toBeGreaterThan(7000);
    for (const m of ['pls-sem', 'plsc'] as const) {
      const r = await time('acsi-2015', ex.model, data, m);
      expect(r.per100).toBeLessThan(30_000);
    }
  }, 120_000);
});
