/**
 * Parity with the R engine (cSEM 0.7.1): every run in packages/fixtures/reference-results/pls.
 * Tolerances: 1e-10 absolute for every number (classic, PLSc, Mode B, assessment, fit, IPMA).
 */
import { readdirSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { NormalizedSemResult } from '@sem-studio/contracts';
import { estimatePls } from '../src/index.ts';
import {
  analysisData,
  caseOf,
  FIXTURES,
  loadCase,
  readJson,
  type ReferenceFile,
} from './helpers.ts';

const DIR = `${FIXTURES}reference-results/pls/`;
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

const TOL = 1e-10;
type Family =
  | 'classic'
  | 'plsc'
  | 'mode-b weights'
  | 'ipma'
  | 'construct metrics'
  | 'matrices'
  | 'fit'
  | 'effects';
const maxDev: Record<Family, { dev: number; where: string }> = {
  classic: { dev: 0, where: '' },
  plsc: { dev: 0, where: '' },
  'mode-b weights': { dev: 0, where: '' },
  ipma: { dev: 0, where: '' },
  'construct metrics': { dev: 0, where: '' },
  matrices: { dev: 0, where: '' },
  fit: { dev: 0, where: '' },
  effects: { dev: 0, where: '' },
};

function track(family: Family, a: number | null, b: number | null, where: string): void {
  if (a === null || b === null) {
    expect(a, `${where}: null mismatch`).toBe(b);
    return;
  }
  const d = Math.abs(a - b);
  if (d > maxDev[family].dev) maxDev[family] = { dev: d, where };
  expect(d, `${where}: ${a} vs ${b}`).toBeLessThanOrEqual(TOL);
}

afterAll(() => {
  const lines = Object.entries(maxDev).map(
    ([k, v]) => `  ${k.padEnd(18)} max |Δ| = ${v.dev.toExponential(2)}  ${v.where}`,
  );
  process.stderr.write(`PLS reference parity (${files.length} runs):\n${lines.join('\n')}\n`);
});

describe('browser PLS engine reproduces the R engine reference results', () => {
  it('has the 61 reference runs', () => {
    expect(files.length).toBe(61);
  });

  for (const file of files) {
    it(file, async () => {
      const ref = readJson<ReferenceFile>(DIR + file);
      expect(ref.response.ok).toBe(true);
      if (!ref.response.ok) return;
      const R = ref.response.result;
      const { csv } = loadCase(caseOf(file));
      const model = ref.request.model;
      const out = await estimatePls({
        model,
        analysis: { ...ref.request.analysis, engine: 'browser' },
        data: analysisData(model, csv),
      });
      if (!out.ok) throw new Error(`${out.error.code}: ${out.error.message}`);
      const T = out.result;
      expect(() => NormalizedSemResult.parse(T)).not.toThrow();

      const plsc = ref.request.analysis.method === 'plsc';
      const fam: Family = plsc ? 'plsc' : 'classic';
      expect(T.sample).toEqual(R.sample);
      expect(T.estimation.converged).toBe(R.estimation.converged);
      expect(T.estimation.iterations).toBe(R.estimation.iterations);
      expect(T.estimation.admissible).toBe(R.estimation.admissible);

      // parameters: same keys in the same order, same ids, values within tolerance
      expect(T.parameters.map((p) => p.key)).toEqual(R.parameters.map((p) => p.key));
      const modeB = new Set(
        model.constructs.filter((c) => c.measurement === 'composite-formative').map((c) => c.id),
      );
      R.parameters.forEach((rp, i) => {
        const tp = T.parameters[i]!;
        expect(
          {
            kind: tp.kind,
            s: tp.sourceId,
            t: tp.targetId,
            via: tp.viaIds,
            rel: tp.relationshipId,
            st: tp.status,
            sc: tp.scale,
            m: tp.missing,
          },
          rp.key,
        ).toEqual({
          kind: rp.kind,
          s: rp.sourceId,
          t: rp.targetId,
          via: rp.viaIds,
          rel: rp.relationshipId,
          st: rp.status,
          sc: rp.scale,
          m: rp.missing,
        });
        const f: Family = ['total-effect', 'indirect-effect', 'specific-indirect'].includes(rp.kind)
          ? 'effects'
          : rp.kind === 'weight' && modeB.has(rp.sourceId!)
            ? 'mode-b weights'
            : fam;
        track(f, tp.est, rp.est, `${file} ${rp.key}`);
        if (f === 'effects' || f === 'mode-b weights')
          track(fam, tp.est, rp.est, `${file} ${rp.key}`);
      });

      expect(T.constructMetrics.map((m) => `${m.constructId}/${m.metric}`)).toEqual(
        R.constructMetrics.map((m) => `${m.constructId}/${m.metric}`),
      );
      R.constructMetrics.forEach((rm, i) => {
        const tm = T.constructMetrics[i]!;
        expect(tm.missing, `${rm.constructId}/${rm.metric}`).toEqual(rm.missing);
        track('construct metrics', tm.value, rm.value, `${file} ${rm.constructId}/${rm.metric}`);
      });

      expect(T.matrices.map((m) => m.id)).toEqual(R.matrices.map((m) => m.id));
      R.matrices.forEach((rm, i) => {
        const tm = T.matrices[i]!;
        expect({ r: tm.rowIds, c: tm.colIds, m: tm.missing, s: tm.symmetric }, rm.id).toEqual({
          r: rm.rowIds,
          c: rm.colIds,
          m: rm.missing,
          s: rm.symmetric,
        });
        rm.values.forEach((row, a) =>
          row.forEach((v, b) =>
            track(
              'matrices',
              tm.values[a]![b]!,
              v,
              `${file} ${rm.id}[${rm.rowIds[a]}, ${rm.colIds[b]}]`,
            ),
          ),
        );
      });

      expect(T.fit.map((f) => f.name)).toEqual(R.fit.map((f) => f.name));
      R.fit.forEach((rf, i) => {
        expect(T.fit[i]!.missing).toEqual(rf.missing);
        track('fit', T.fit[i]!.value, rf.value, `${file} ${rf.name}`);
      });

      expect(Boolean(T.ipma)).toBe(Boolean(R.ipma));
      if (R.ipma && T.ipma) {
        expect(T.ipma.targetConstructId).toBe(R.ipma.targetConstructId);
        expect(T.ipma.convention).toBe(R.ipma.convention);
        expect(T.ipma.constructs.map((c) => [c.constructId, c.predecessor])).toEqual(
          R.ipma.constructs.map((c) => [c.constructId, c.predecessor]),
        );
        R.ipma.constructs.forEach((rc, i) => {
          track(
            'ipma',
            T.ipma!.constructs[i]!.importance,
            rc.importance,
            `${file} ${rc.constructId} importance`,
          );
          track(
            'ipma',
            T.ipma!.constructs[i]!.performance,
            rc.performance,
            `${file} ${rc.constructId} performance`,
          );
        });
        expect(T.ipma.indicators?.map((c) => [c.indicatorId, c.constructId])).toEqual(
          R.ipma.indicators?.map((c) => [c.indicatorId, c.constructId]),
        );
        R.ipma.indicators?.forEach((rc, i) => {
          track(
            'ipma',
            T.ipma!.indicators![i]!.importance,
            rc.importance,
            `${file} ${rc.indicatorId} importance`,
          );
          track(
            'ipma',
            T.ipma!.indicators![i]!.performance,
            rc.performance,
            `${file} ${rc.indicatorId} performance`,
          );
        });
      }

      expect(T.warnings.map((w) => [w.code, w.severity, w.elementIds])).toEqual(
        R.warnings.map((w) => [w.code, w.severity, w.elementIds]),
      );
      expect(T.provenance.engine).toBe('browser');
    });
  }
});
