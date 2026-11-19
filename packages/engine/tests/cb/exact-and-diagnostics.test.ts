/**
 * R-independent checks: exact fixtures (analytic oracles), the closed-form Heywood case, the
 * singular covariance fixture, error paths, parameter counting and performance.
 */
import { NormalizedSemResult, type SemModel } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { cbParameterCount, estimateCb } from '../../src/cb/index.ts';
import { type Variant, analysisFor, fitValue, loadData, loadModel, readJson } from './helpers.ts';

interface Population {
  indicators: Array<{ column: string; standardizedLoading: number }>;
  latentCorrelation: { matrix: number[][]; order: string[] };
  structuralCoefficients: Array<{ source: string; target: string; coefficient: number }>;
}

async function run(caseId: string, variant: Variant, model?: SemModel) {
  const out = await estimateCb({
    model: model ?? loadModel(caseId),
    analysis: analysisFor(variant),
    data: loadData(caseId),
  });
  return out;
}

async function runOk(
  caseId: string,
  variant: Variant,
  model?: SemModel,
): Promise<NormalizedSemResult> {
  const out = await run(caseId, variant, model);
  if (!out.ok) throw new Error(`${out.error.code}: ${out.error.message}`);
  expect(NormalizedSemResult.safeParse(out.result).success).toBe(true);
  return out.result;
}

function std(res: NormalizedSemResult, key: string): number {
  const p = res.parameters.find((q) => q.key === key && q.scale === 'standardized');
  if (!p || p.est === null) throw new Error(`no standardized ${key}`);
  return p.est;
}

function unstd(res: NormalizedSemResult, key: string): number {
  const p = res.parameters.find((q) => q.key === key && q.scale === 'unstandardized');
  if (!p || p.est === null) throw new Error(`no ${key}`);
  return p.est;
}

function idOfColumn(model: SemModel, column: string): string {
  return model.indicators.find((i) => i.column === column)!.id;
}

function constructOf(model: SemModel, indicatorId: string): string {
  return model.constructs.find((c) => c.indicatorIds.includes(indicatorId))!.id;
}

function constructByName(model: SemModel, name: string): string {
  return model.constructs.find((c) => c.name === name)!.id;
}

describe('exact fixtures recover the population (analytic oracle)', () => {
  it.each<Variant>(['ml-marker', 'ml-stdlv'])(
    'cfa-two-factor-exact (%s): χ² = 0, df = 19, std loadings = λ, r = .40',
    async (v) => {
      const model = loadModel('cfa-two-factor-exact');
      const pop = readJson<Population>('synthetic/cfa-two-factor-exact/population.json');
      const res = await runOk('cfa-two-factor-exact', v);
      expect(Math.abs(fitValue(res, 'chisq', 'standard')!.value!)).toBeLessThan(1e-8);
      expect(fitValue(res, 'df')!.value).toBe(19);
      for (const ind of pop.indicators) {
        const iid = idOfColumn(model, ind.column);
        expect(
          Math.abs(std(res, `loading:${constructOf(model, iid)}:${iid}`) - ind.standardizedLoading),
        ).toBeLessThan(1e-7);
      }
      const [a, b] = model.constructs.map((c) => c.id);
      expect(Math.abs(std(res, `covariance:${a}~~${b}`) - 0.4)).toBeLessThan(1e-7);
      expect(res.estimation.admissible).toBe(true);
    },
  );

  it.each<Variant>(['ml-marker', 'ml-stdlv'])(
    'tam-mediation-exact (%s): paths .60/.20/.50, df = 41',
    async (v) => {
      const model = loadModel('tam-mediation-exact');
      const pop = readJson<Population>('synthetic/tam-mediation-exact/population.json');
      const res = await runOk('tam-mediation-exact', v);
      expect(fitValue(res, 'df')!.value).toBe(41);
      expect(Math.abs(fitValue(res, 'chisq', 'standard')!.value!)).toBeLessThan(1e-8);
      expect(pop.structuralCoefficients.map((s) => s.coefficient)).toEqual([0.6, 0.2, 0.5]);
      for (const s of pop.structuralCoefficients) {
        const key = `path:${constructByName(model, s.source)}->${constructByName(model, s.target)}`;
        expect(Math.abs(std(res, key) - s.coefficient)).toBeLessThan(1e-7);
      }
      for (const ind of pop.indicators) {
        const iid = idOfColumn(model, ind.column);
        expect(
          Math.abs(std(res, `loading:${constructOf(model, iid)}:${iid}`) - ind.standardizedLoading),
        ).toBeLessThan(1e-7);
      }
      // R² of the endogenous factors = 1 − disturbance variance (.36 and .41)
      const r2 = (name: string): number =>
        res.constructMetrics.find(
          (m) => m.constructId === constructByName(model, name) && m.metric === 'r2',
        )!.value!;
      expect(Math.abs(r2('PU') - 0.36)).toBeLessThan(1e-7);
      expect(Math.abs(r2('BI') - 0.41)).toBeLessThan(1e-7);
    },
  );
});

describe('Heywood case (cb-heywood-exact): closed form, reported unclamped with a warning', () => {
  it.each<Variant>(['ml-marker', 'ml-stdlv'])('%s', async (v) => {
    const res = await runOk('cb-heywood-exact', v);
    const N = 200;
    // correlation metric: λ1² = r12 r13 / r23 = 1.445, θ1 = −0.445 (standardized, unchanged by the
    // N divisor); unstandardized θ1 = −0.445 · (N−1)/N because the data have unit (N−1) variances.
    expect(Math.abs(std(res, 'loading:c_h:i_h1') ** 2 - 1.445)).toBeLessThan(1e-7);
    expect(Math.abs(std(res, 'residual-variance:i_h1') - -0.445)).toBeLessThan(1e-7);
    expect(Math.abs(unstd(res, 'residual-variance:i_h1') - (-0.445 * (N - 1)) / N)).toBeLessThan(
      1e-7,
    );
    expect(Math.abs(std(res, 'residual-variance:i_h2') - 0.5)).toBeLessThan(1e-7);
    expect(res.estimation.admissible).toBe(false);
    const w = res.warnings.find((x) => x.code === 'CB_NEGATIVE_VARIANCE');
    expect(w?.severity).toBe('warning');
    expect(w?.elementIds).toEqual(['i_h1']);
    // df = 0: no fit indices presented as evidence of fit
    expect(fitValue(res, 'df')!.value).toBe(0);
    for (const name of ['cfi', 'tli', 'rmsea', 'srmr', 'pvalue']) {
      const f = fitValue(res, name, 'standard')!;
      expect(f.value).toBeNull();
      expect(f.missing).toBe('not-applicable');
    }
    expect(res.warnings.some((x) => x.code === 'CB_JUST_IDENTIFIED')).toBe(true);
  });
});

describe('singular sample covariance (cb-singular)', () => {
  it('fails with an actionable error naming the linear dependency s7 = s1 + s2', async () => {
    const out = await run('cb-singular', 'ml-marker');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe('DATA_ZERO_VARIANCE');
    expect(out.error.details?.reason).toBe('singular-covariance');
    expect([...(out.error.details?.elementIds as string[])].sort()).toEqual([
      'i_s1',
      'i_s2',
      'i_s7',
    ]);
    const dep = out.error.details?.dependency as Record<string, number>;
    // normalised on the leading variable: s7 − s1 − s2 = 0 up to sign
    const lead = Object.keys(dep).find((k) => dep[k] === 1)!;
    expect(lead).toBeDefined();
    for (const k of Object.keys(dep)) expect(Math.abs(Math.abs(dep[k]!) - 1)).toBeLessThan(1e-6);
    expect(out.error.message).toMatch(/singular/);
  });
});

describe('error paths', () => {
  const base = (): SemModel => loadModel('cfa-two-factor');
  it('composite construct ⇒ CAPABILITY_UNSUPPORTED', async () => {
    const m = base();
    m.constructs[0]!.measurement = 'composite-formative';
    const out = await run('cfa-two-factor', 'ml-marker', m);
    expect(!out.ok && out.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });
  it('structural cycle ⇒ REQUEST_INVALID', async () => {
    const m = base();
    const [a, b] = m.constructs.map((c) => c.id);
    m.relationships = [
      { id: 'r1', kind: 'structural', sourceId: a!, targetId: b! },
      { id: 'r2', kind: 'structural', sourceId: b!, targetId: a! },
    ];
    const out = await run('cfa-two-factor', 'ml-marker', m);
    expect(!out.ok && out.error.code).toBe('REQUEST_INVALID');
    expect(!out.ok && out.error.details?.reason).toBe('structural-cycle');
  });
  it('t-rule (df < 0) ⇒ MODEL_NOT_IDENTIFIED', async () => {
    const m = base();
    const ids = m.constructs[0]!.indicatorIds;
    // free every residual covariance within the first block: 6 extra parameters > 19 df? add across blocks too
    const all = m.constructs.flatMap((c) => c.indicatorIds);
    let k = 0;
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        m.relationships.push({
          id: `rc${k++}`,
          kind: 'covariance',
          sourceId: all[i]!,
          targetId: all[j]!,
        });
    expect(ids.length).toBeGreaterThan(0);
    const out = await run('cfa-two-factor', 'ml-marker', m);
    expect(!out.ok && out.error.code).toBe('MODEL_NOT_IDENTIFIED');
  });
  it('unmapped / absent column ⇒ DATA_COLUMN_MISSING', async () => {
    const m = base();
    m.indicators[0]!.column = 'does-not-exist';
    const out = await run('cfa-two-factor', 'ml-marker', m);
    expect(!out.ok && out.error.code).toBe('DATA_COLUMN_MISSING');
  });
  it('unsupported estimator ⇒ CAPABILITY_UNSUPPORTED', async () => {
    const out = await estimateCb({
      model: base(),
      analysis: { ...analysisFor('ml-marker'), estimator: 'WLSMV' },
      data: loadData('cfa-two-factor'),
    });
    expect(!out.ok && out.error.code).toBe('CAPABILITY_UNSUPPORTED');
  });
  it('empirical under-identification ⇒ warning and null SEs with a reason', async () => {
    // two-indicator factor whose only link to the rest is a covariance fixed at 0
    const m = base();
    const c1 = m.constructs[0]!;
    c1.indicatorIds = c1.indicatorIds.slice(0, 2);
    m.indicators = m.indicators.filter((i) =>
      m.constructs.some((c) => c.indicatorIds.includes(i.id)),
    );
    m.relationships = [
      {
        id: 'rz',
        kind: 'covariance',
        sourceId: c1.id,
        targetId: m.constructs[1]!.id,
        fixedValue: 0,
      },
    ];
    const out = await run('cfa-two-factor', 'ml-marker', m);
    if (!out.ok) throw new Error(out.error.message);
    expect(NormalizedSemResult.safeParse(out.result).success).toBe(true);
    expect(out.result.warnings.some((w) => w.code === 'CB_INFORMATION_SINGULAR')).toBe(true);
    const free = out.result.parameters.filter(
      (p) => p.scale === 'unstandardized' && p.status === 'estimated',
    );
    expect(free.every((p) => p.se === null && p.missing?.se === 'failed')).toBe(true);
  });
  it('cancellation ⇒ CANCELLED', async () => {
    const ac = new AbortController();
    ac.abort();
    const out = await estimateCb(
      { model: base(), analysis: analysisFor('ml-marker'), data: loadData('cfa-two-factor') },
      { signal: ac.signal },
    );
    expect(!out.ok && out.error.code).toBe('CANCELLED');
  });
});

describe('parameter counting vs apps/web cbDegreesOfFreedom', () => {
  it('agrees on every CB fixture', async () => {
    // dynamic import keeps the web app's module graph out of this package's type-check
    const path = new URL('../../../../apps/web/src/domain/validation/validate.ts', import.meta.url)
      .href;
    const web = (await import(/* @vite-ignore */ path)) as {
      cbDegreesOfFreedom: (
        m: SemModel,
      ) => { moments: number; parameters: number; df: number } | null;
    };
    const expected: Record<string, number> = {
      'cfa-one-factor': 5,
      'cfa-two-factor': 19,
      'cfa-two-factor-exact': 19,
      'tam-mediation-exact': 41,
      'service-quality': 62,
      'cb-heywood-exact': 0,
      'missing-mcar': 19,
      'cb-singular': 13,
    };
    for (const [caseId, df] of Object.entries(expected)) {
      const model = loadModel(caseId);
      const ours = cbParameterCount(model);
      expect(ours?.df, caseId).toBe(df);
      expect(web.cbDegreesOfFreedom(model), caseId).toEqual(ours);
      // std.lv and the mean structure do not change df
      expect(cbParameterCount(model, 'std-lv')?.df).toBe(df);
      expect(cbParameterCount(model, 'marker', true)?.df).toBe(df);
    }
  });

  it('counts lavaan auto.cov.y disturbance covariances (which cbDegreesOfFreedom does not)', () => {
    // A → B, A → C: lavaan frees B~~C (both "pure" endogenous); verified with lavaanify().
    const m = loadModel('tam-mediation-exact');
    const [peou, pu, bi] = m.constructs.map((c) => c.id);
    m.relationships = [
      { id: 'r1', kind: 'structural', sourceId: peou!, targetId: pu! },
      { id: 'r2', kind: 'structural', sourceId: peou!, targetId: bi! },
    ];
    const ours = cbParameterCount(m)!;
    // 8 loadings + 11 residuals + 3 latent variances + 2 paths + 1 disturbance covariance
    expect(ours.parameters).toBe(25);
  });
});

describe('performance', () => {
  it('ms per fit (tam-mediation-exact, service-quality; ML and MLR)', async () => {
    const cases: Array<[string, Variant]> = [
      ['tam-mediation-exact', 'ml-marker'],
      ['service-quality', 'ml-marker'],
      ['service-quality', 'mlr-marker'],
      ['missing-mcar', 'ml-fiml'],
      ['missing-mcar', 'mlr-fiml'],
    ];
    for (const [c, v] of cases) {
      const model = loadModel(c);
      const data = loadData(c);
      await estimateCb({ model, analysis: analysisFor(v), data }); // warm-up
      const reps = 5;
      const t0 = performance.now();
      for (let i = 0; i < reps; i++) await estimateCb({ model, analysis: analysisFor(v), data });
      const ms = (performance.now() - t0) / reps;
      process.stdout.write(`[cb perf] ${c} ${v}: ${ms.toFixed(1)} ms per fit\n`);
      expect(ms).toBeLessThan(2000);
    }
  });
});
