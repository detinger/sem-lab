/** Bootstrap determinism, counting, cancellation, executor hook, and error codes. */
import { describe, expect, it } from 'vitest';
import type { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import { NormalizedSemResult } from '@sem-lab/contracts';
import {
  type DrawResult,
  estimatePls,
  type EstimateOutcome,
  fitDraw,
  type ProgressEvent,
} from '../src/index.ts';
import type { AnalysisDataInput } from '../src/pls/spec.ts';
import { analysisData, loadCase } from './helpers.ts';

const tam = loadCase('tam-mediation');
const tamData = analysisData(tam.model, tam.csv);

function analysis(over: Partial<AnalysisConfiguration> = {}): AnalysisConfiguration {
  return {
    method: 'pls-sem',
    engine: 'browser',
    estimator: 'pls-pm',
    missingData: 'listwise',
    pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-10 },
    ...over,
  };
}
const boot = (repetitions: number, seed = 123): Partial<AnalysisConfiguration> => ({
  seed,
  bootstrap: {
    enabled: true,
    repetitions,
    ci: 'percentile',
    confidenceLevel: 0.95,
    sides: 'two-sided',
  },
});

function stripTimes(o: EstimateOutcome): unknown {
  if (!o.ok) return o;
  const { provenance, ...rest } = o.result;
  return { ...rest, provenance: { ...provenance, startedAt: '', finishedAt: '' } };
}

function errorOf(o: EstimateOutcome): { code: string; details?: Record<string, unknown> } {
  if (o.ok) throw new Error('expected an error');
  return o.error;
}

describe('bootstrap behaviour', () => {
  it('is deterministic: same seed ⇒ identical result; another seed ⇒ different draws', async () => {
    const a = await estimatePls({ model: tam.model, analysis: analysis(boot(40)), data: tamData });
    const b = await estimatePls({ model: tam.model, analysis: analysis(boot(40)), data: tamData });
    const c = await estimatePls({
      model: tam.model,
      analysis: analysis(boot(40, 124)),
      data: tamData,
    });
    expect(stripTimes(a)).toEqual(stripTimes(b));
    if (!a.ok || !c.ok) throw new Error('fit failed');
    expect(a.result.bootstrap!.draws).not.toEqual(c.result.bootstrap!.draws);
    expect(() => NormalizedSemResult.parse(a.result)).not.toThrow();
  });

  it('counts failed and inadmissible draws: requested = completed + failed + inadmissible', async () => {
    const small: AnalysisDataInput = {
      ...tamData,
      rows: tamData.rows.slice(0, 8),
      nRows: 8,
      nDropped: 0,
    };
    const out = await estimatePls({
      model: tam.model,
      analysis: analysis(boot(60, 3)),
      data: small,
    });
    if (!out.ok) throw new Error(out.error.message);
    const bs = out.result.bootstrap!;
    expect(bs.failed).toBeGreaterThan(0);
    expect(bs.requested).toBe(60);
    expect(bs.completed + bs.failed + bs.inadmissible).toBe(bs.requested);
    expect(out.result.warnings.map((w) => w.code)).toContain('BOOTSTRAP_FAILED_DRAWS');
    for (const p of out.result.parameters)
      if (p.inference) expect(p.inference.nValid).toBe(bs.completed);
    expect(() => NormalizedSemResult.parse(out.result)).not.toThrow();
  });

  it('cancels between draws (CANCELLED, no result) and reports real progress', async () => {
    const events: ProgressEvent[] = [];
    let polls = 0;
    const out = await estimatePls(
      { model: tam.model, analysis: analysis(boot(200)), data: tamData },
      {
        onProgress: (e) => events.push(e),
        isCancelled: () =>
          events.some((e) => e.stage === 'bootstrapping' && (e.done ?? 0) >= 50) && ++polls > 0,
        batchSize: 10,
      },
    );
    expect(errorOf(out).code).toBe('CANCELLED');
    const last = events.filter((e) => e.stage === 'bootstrapping').pop()!;
    expect(last.done).toBe(50);
    expect(last.total).toBe(200);
    expect(events.map((e) => e.stage).slice(0, 3)).toEqual([
      'validating',
      'estimating',
      'bootstrapping',
    ]);
  });

  it('a parallel executor (out-of-order fitting, in-order return) gives the identical result', async () => {
    const seq = await estimatePls({
      model: tam.model,
      analysis: analysis(boot(30)),
      data: tamData,
    });
    const par = await estimatePls(
      { model: tam.model, analysis: analysis(boot(30)), data: tamData },
      {
        batchSize: 7,
        executeDraws: async (problem, batch) => {
          const cloned = structuredClone(problem); // what a Worker receives
          const res: DrawResult[] = new Array<DrawResult>(batch.length);
          for (let i = batch.length - 1; i >= 0; i--) res[i] = fitDraw(cloned, batch[i]!);
          return Promise.resolve(res);
        },
      },
    );
    expect(stripTimes(par)).toEqual(stripTimes(seq));
  });

  it('one-sided inference reports one bound in the direction of the estimate', async () => {
    const out = await estimatePls({
      model: tam.model,
      analysis: analysis({
        seed: 5,
        bootstrap: {
          enabled: true,
          repetitions: 30,
          ci: 'percentile',
          confidenceLevel: 0.95,
          sides: 'one-sided',
        },
      }),
      data: tamData,
    });
    if (!out.ok) throw new Error(out.error.message);
    const p = out.result.parameters.find((x) => x.key === 'path:c_peou->c_pu')!;
    expect(p.ciLower).not.toBeNull();
    expect(p.ciUpper).toBeNull();
    expect(p.missing?.ciUpper).toBe('not-applicable');
    expect(out.result.warnings.map((w) => w.code)).toContain('ONE_SIDED_DIRECTION');
  });
});

describe('error codes (docs/architecture/engine-protocol.md)', () => {
  const withScale = (m: SemModel, drop: string): SemModel => ({
    ...m,
    indicators: m.indicators.map((i) =>
      i.id === drop ? { id: i.id, name: i.name, column: i.column } : i,
    ),
  });
  const run = (model: SemModel, an: AnalysisConfiguration, data: AnalysisDataInput = tamData) =>
    estimatePls({ model, analysis: an, data });

  it('IPMA: missing scale endpoints', async () => {
    const e = errorOf(
      await run(withScale(tam.model, 'i_pu2'), analysis({ ipma: { targetConstructId: 'c_bi' } })),
    );
    expect(e.code).toBe('REQUEST_INVALID');
    expect(e.details).toMatchObject({ reason: 'ipma-scale-missing', indicatorIds: ['i_pu2'] });
  });
  it('IPMA: PLSc is refused', async () => {
    const e = errorOf(
      await run(tam.model, analysis({ method: 'plsc', ipma: { targetConstructId: 'c_bi' } })),
    );
    expect(e.code).toBe('CAPABILITY_UNSUPPORTED');
  });
  it('IPMA: unknown target and target without predecessors', async () => {
    expect(
      errorOf(await run(tam.model, analysis({ ipma: { targetConstructId: 'c_nope' } }))).details,
    ).toMatchObject({
      reason: 'ipma-target-unknown',
    });
    expect(
      errorOf(await run(tam.model, analysis({ ipma: { targetConstructId: 'c_peou' } }))).details,
    ).toMatchObject({
      reason: 'ipma-no-predecessors',
    });
  });
  it('IPMA: observed values outside the declared scale', async () => {
    const m: SemModel = {
      ...tam.model,
      indicators: tam.model.indicators.map((i) =>
        i.id === 'i_bi1' ? { ...i, scale: { min: 1, max: 5 } } : i,
      ),
    };
    const e = errorOf(await run(m, analysis({ ipma: { targetConstructId: 'c_bi' } })));
    expect(e.details).toMatchObject({ reason: 'ipma-out-of-scale', indicatorIds: ['i_bi1'] });
  });
  it('structural cycle', async () => {
    const m: SemModel = {
      ...tam.model,
      relationships: [
        ...tam.model.relationships,
        { id: 'r_bi_peou', kind: 'structural', sourceId: 'c_bi', targetId: 'c_peou' },
      ],
    };
    expect(errorOf(await run(m, analysis())).code).toBe('REQUEST_INVALID');
  });
  it('no structural path / isolated construct', async () => {
    expect(errorOf(await run({ ...tam.model, relationships: [] }, analysis())).code).toBe(
      'MODEL_NOT_IDENTIFIED',
    );
    const m: SemModel = {
      ...tam.model,
      relationships: tam.model.relationships.filter((r) => r.targetId !== 'c_bi'),
    };
    expect(errorOf(await run(m, analysis())).details).toMatchObject({ constructIds: ['c_bi'] });
  });
  it('zero variance, fewer than 3 rows, missing column, missing cell, non-finite cell', async () => {
    const zero = { ...tamData, rows: tamData.rows.map((r) => r.map((v, j) => (j === 0 ? 4 : v))) };
    expect(errorOf(await run(tam.model, analysis(), zero)).code).toBe('DATA_ZERO_VARIANCE');
    const two = { ...tamData, rows: tamData.rows.slice(0, 2), nRows: 2 };
    expect(errorOf(await run(tam.model, analysis(), two)).code).toBe('DATA_INSUFFICIENT_ROWS');
    const nocol = { ...tamData, columns: tamData.columns.map((c) => (c === 'pu3' ? 'pu3x' : c)) };
    expect(errorOf(await run(tam.model, analysis(), nocol)).code).toBe('DATA_COLUMN_MISSING');
    const holes = {
      ...tamData,
      rows: tamData.rows.map((r, i) =>
        i === 3 ? r.map((v, j) => (j === 2 ? (null as unknown as number) : v)) : r,
      ),
    };
    expect(errorOf(await run(tam.model, analysis(), holes)).details).toMatchObject({
      reason: 'missing-values',
    });
    const inf = {
      ...tamData,
      rows: tamData.rows.map((r, i) => (i === 3 ? r.map((v, j) => (j === 2 ? Infinity : v)) : r)),
    };
    expect(errorOf(await run(tam.model, analysis(), inf)).code).toBe('DATA_NOT_NUMERIC');
    const prep = { ...tamData, nRows: tamData.rows.length + 5, nDropped: 0 };
    expect(errorOf(await run(tam.model, analysis(), prep)).details).toMatchObject({
      reason: 'data-preparation-mismatch',
    });
  });
  it('non-convergence', async () => {
    const e = errorOf(
      await run(
        tam.model,
        analysis({ pls: { innerWeighting: 'path', maxIterations: 2, tolerance: 1e-10 } }),
      ),
    );
    expect(e.code).toBe('ENGINE_NONCONVERGENCE');
  });
  it('unsupported options: bca, cb-sem, mode override, covariance with an endogenous construct, wrong engine', async () => {
    const bca = analysis({
      seed: 1,
      bootstrap: {
        enabled: true,
        repetitions: 10,
        ci: 'bca',
        confidenceLevel: 0.95,
        sides: 'two-sided',
      },
    });
    expect(errorOf(await run(tam.model, bca)).code).toBe('CAPABILITY_UNSUPPORTED');
    expect(
      errorOf(await run(tam.model, { ...analysis(), method: 'cb-sem', pls: undefined })).code,
    ).toBe('CAPABILITY_UNSUPPORTED');
    const mode: SemModel = {
      ...tam.model,
      constructs: tam.model.constructs.map((c, i) =>
        i === 0 ? { ...c, plsWeightingMode: 'mode-b' as const } : c,
      ),
    };
    expect(errorOf(await run(mode, analysis())).code).toBe('CAPABILITY_UNSUPPORTED');
    const cov: SemModel = {
      ...tam.model,
      relationships: [
        ...tam.model.relationships,
        { id: 'r_cov', kind: 'covariance', sourceId: 'c_pu', targetId: 'c_bi' },
      ],
    };
    expect(errorOf(await run(cov, analysis())).code).toBe('CAPABILITY_UNSUPPORTED');
    expect(errorOf(await run(tam.model, { ...analysis(), engine: 'r-csem' })).code).toBe(
      'REQUEST_INVALID',
    );
  });
  it('perfectly collinear Mode B block', async () => {
    const mc = loadCase('pls-mixed-composite');
    const d = analysisData(mc.model, mc.csv);
    const j0 = d.columns.indexOf('f1');
    const j1 = d.columns.indexOf('f2');
    const col = { ...d, rows: d.rows.map((r) => r.map((v, j) => (j === j1 ? 2 * r[j0]! + 1 : v))) };
    expect(errorOf(await run(mc.model, analysis(), col)).code).toBe('MODEL_NOT_IDENTIFIED');
  });
  it('reverse-scored indicators are reported (data arrive reversed by the analysis-data builder)', async () => {
    const m: SemModel = {
      ...tam.model,
      indicators: tam.model.indicators.map((i) =>
        i.id === 'i_pu4' ? { ...i, reverseScored: true } : i,
      ),
    };
    const out = await run(m, analysis(), analysisData(m, tam.csv));
    if (!out.ok) throw new Error(out.error.message);
    const w = out.result.warnings.find((x) => x.code === 'REVERSE_SCORED_APPLIED')!;
    expect(w.elementIds).toEqual(['i_pu4']);
    expect(out.result.warnings.map((x) => x.code)).toContain('NEGATIVE_LOADING');
  });
});
