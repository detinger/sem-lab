import { NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { estimate } from '../src/index.ts';
import { FIXTURES, analysisData, readCsv, readJson } from './helpers.ts';

const model = SemModel.parse(readJson(`${FIXTURES}synthetic/tam-mediation-exact/model.json`));
const data = analysisData(model, readCsv(`${FIXTURES}synthetic/tam-mediation-exact/data.csv`));

describe('estimate() dispatches by method and always returns a contract-valid result', () => {
  it('refuses a PLS request without explicit pls options (they are recorded in provenance)', async () => {
    const out = await estimate({
      model,
      data,
      analysis: {
        method: 'pls-sem',
        engine: 'browser',
        estimator: 'pls-pm',
        missingData: 'listwise',
      },
    });
    expect(out).toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
  });
  it('PLS-SEM goes to the PLS engine', async () => {
    const out = await estimate({
      model,
      data,
      analysis: {
        method: 'pls-sem',
        engine: 'browser',
        estimator: 'pls-pm',
        missingData: 'listwise',
        pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-7 },
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(NormalizedSemResult.safeParse(out.result).success).toBe(true);
  });
  it('CB-SEM goes to the CB engine and recovers the population paths', async () => {
    const out = await estimate({
      model,
      data,
      analysis: {
        method: 'cb-sem',
        engine: 'browser',
        estimator: 'ML',
        missingData: 'listwise',
        cb: { identification: 'marker', meanStructure: false },
      },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(NormalizedSemResult.safeParse(out.result).success).toBe(true);
    const std = out.result.parameters.find(
      (p) =>
        p.kind === 'path' &&
        p.sourceId === 'c_peou' &&
        p.targetId === 'c_pu' &&
        p.scale === 'standardized',
    );
    expect(std?.est).toBeCloseTo(0.6, 6);
  });
});
