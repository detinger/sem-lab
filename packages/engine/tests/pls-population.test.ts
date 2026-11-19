/**
 * R-independent check: on the EXACT fixtures (sample covariance = population Σ) a consistent
 * estimator must return the generating parameters (packages/fixtures/synthetic/<case>/population.json).
 */
import { describe, expect, it } from 'vitest';
import type { AnalysisConfiguration, NormalizedSemResult } from '@sem-studio/contracts';
import { estimatePls } from '../src/index.ts';
import { analysisData, FIXTURES, loadCase, readJson } from './helpers.ts';

const TOL = 1e-9;

async function run(
  caseName: string,
  method: 'pls-sem' | 'plsc',
  scheme: 'path' | 'centroid' | 'factorial',
) {
  const { model, csv } = loadCase(caseName);
  const analysis: AnalysisConfiguration = {
    method,
    engine: 'browser',
    estimator: 'pls-pm',
    missingData: 'listwise',
    pls: { innerWeighting: scheme, maxIterations: 300, tolerance: 1e-10 },
  };
  const out = await estimatePls({ model, analysis, data: analysisData(model, csv) });
  if (!out.ok) throw new Error(out.error.message);
  return out.result;
}

function est(r: NormalizedSemResult, key: string): number {
  const p = r.parameters.find((x) => x.key === key);
  if (!p || p.est === null) throw new Error(`no estimate ${key}`);
  return p.est;
}
function metric(r: NormalizedSemResult, c: string, m: string): number | null {
  return r.constructMetrics.find((x) => x.constructId === c && x.metric === m)!.value;
}

interface Pop {
  derivedTruths: {
    classicPlsPopulationLimit: { paths: { source: string; target: string; coefficient: number }[] };
    constructs: Record<
      string,
      {
        rhoA?: number | null;
        rhoC?: number | null;
        AVE?: number | null;
        weights?: number[];
        compositeLoadings?: number[];
      }
    >;
  };
}

describe('tam-mediation-exact: population values', () => {
  const pop = readJson<Pop>(`${FIXTURES}synthetic/tam-mediation-exact/population.json`);
  const lambda: Record<string, number> = {
    i_peou1: 0.8,
    i_peou2: 0.78,
    i_peou3: 0.76,
    i_peou4: 0.74,
    i_pu1: 0.85,
    i_pu2: 0.82,
    i_pu3: 0.8,
    i_pu4: 0.78,
    i_bi1: 0.88,
    i_bi2: 0.85,
    i_bi3: 0.82,
  };
  const block: Record<string, string> = { peou: 'c_peou', pu: 'c_pu', bi: 'c_bi' };
  for (const scheme of ['path', 'centroid', 'factorial'] as const) {
    it(`PLSc (${scheme}) returns paths .60/.20/.50, indirect .30, total .50, loadings, R², AVE, ρC, ρA`, async () => {
      const r = await run('tam-mediation-exact', 'plsc', scheme);
      expect(Math.abs(est(r, 'path:c_peou->c_pu') - 0.6)).toBeLessThan(TOL);
      expect(Math.abs(est(r, 'path:c_peou->c_bi') - 0.2)).toBeLessThan(TOL);
      expect(Math.abs(est(r, 'path:c_pu->c_bi') - 0.5)).toBeLessThan(TOL);
      expect(Math.abs(est(r, 'indirect:c_peou->c_bi') - 0.3)).toBeLessThan(TOL);
      expect(Math.abs(est(r, 'total:c_peou->c_bi') - 0.5)).toBeLessThan(TOL);
      expect(Math.abs(est(r, 'specific-indirect:c_peou->c_pu->c_bi') - 0.3)).toBeLessThan(TOL);
      for (const [ind, l] of Object.entries(lambda)) {
        const c = block[ind.slice(2).replace(/\d+$/, '')]!;
        expect(Math.abs(est(r, `loading:${c}:${ind}`) - l), ind).toBeLessThan(TOL);
      }
      expect(Math.abs(metric(r, 'c_pu', 'r2')! - 0.36)).toBeLessThan(TOL);
      expect(Math.abs(metric(r, 'c_bi', 'r2')! - 0.41)).toBeLessThan(TOL);
      for (const [name, c] of [
        ['PEOU', 'c_peou'],
        ['PU', 'c_pu'],
        ['BI', 'c_bi'],
      ] as const) {
        const t = pop.derivedTruths.constructs[name]!;
        expect(Math.abs(metric(r, c, 'ave')! - t.AVE!), `${name} AVE`).toBeLessThan(TOL);
        expect(Math.abs(metric(r, c, 'rho-c')! - t.rhoC!), `${name} rhoC`).toBeLessThan(TOL);
        expect(Math.abs(metric(r, c, 'rho-a')! - t.rhoA!), `${name} rhoA`).toBeLessThan(TOL);
      }
    });
    it(`classic PLS (${scheme}) returns the classic-PLS population limit; ρA equals the population ρA`, async () => {
      const r = await run('tam-mediation-exact', 'pls-sem', scheme);
      for (const p of pop.derivedTruths.classicPlsPopulationLimit.paths) {
        const key = `path:c_${p.source.toLowerCase()}->c_${p.target.toLowerCase()}`;
        expect(Math.abs(est(r, key) - p.coefficient), key).toBeLessThan(TOL);
      }
      expect(Math.abs(est(r, 'total:c_peou->c_bi') - 0.43543038341742357)).toBeLessThan(TOL);
      expect(
        Math.abs(metric(r, 'c_pu', 'rho-a')! - pop.derivedTruths.constructs.PU!.rhoA!),
      ).toBeLessThan(TOL);
    });
  }
});

describe('pls-mixed-composite-exact: Mode B weights and composite loadings', () => {
  const pop = readJson<Pop>(`${FIXTURES}synthetic/pls-mixed-composite-exact/population.json`);
  const F = pop.derivedTruths.constructs.F!;
  for (const method of ['pls-sem', 'plsc'] as const) {
    for (const scheme of ['path', 'centroid', 'factorial'] as const) {
      it(`${method} (${scheme}): weights f1..f4 and loadings R·w equal the population values`, async () => {
        const r = await run('pls-mixed-composite-exact', method, scheme);
        F.weights!.forEach((w, i) => {
          expect(Math.abs(est(r, `weight:c_f:i_f${i + 1}`) - w)).toBeLessThan(TOL);
          expect(
            Math.abs(est(r, `loading:c_f:i_f${i + 1}`) - F.compositeLoadings![i]!),
          ).toBeLessThan(TOL);
        });
        for (const m of ['cronbach-alpha', 'rho-a', 'rho-c', 'ave']) {
          const x = r.constructMetrics.find((c) => c.constructId === 'c_f' && c.metric === m)!;
          expect(x.value).toBeNull();
          expect(x.missing).toBe('not-applicable');
        }
        if (method === 'plsc') {
          expect(Math.abs(est(r, 'path:c_f->c_y') - 0.4)).toBeLessThan(TOL);
          expect(Math.abs(est(r, 'path:c_x->c_y') - 0.3)).toBeLessThan(TOL);
          const cc = r.matrices.find((m) => m.id === 'construct-correlations')!;
          expect(
            Math.abs(cc.values[cc.rowIds.indexOf('c_f')]![cc.colIds.indexOf('c_x')]! - 0.3),
          ).toBeLessThan(TOL);
        } else {
          expect(Math.abs(est(r, 'path:c_f->c_y') - 0.3871305220309719)).toBeLessThan(TOL);
          expect(Math.abs(est(r, 'path:c_x->c_y') - 0.24927517391513318)).toBeLessThan(TOL);
        }
      });
    }
  }
});
