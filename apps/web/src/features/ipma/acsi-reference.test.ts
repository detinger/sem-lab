/**
 * Phase 4 exit criterion: "IPMA point coordinates agree with a validated reference".
 * The reference is the ACSI 2015 example estimated by the R oracle (cSEM 0.7.1, IPMA convention
 * that matched cSEM::doIPMA() to 9e-14 in Phase 0): docs/validation/phase-4/acsi-2015-reference-result.json.
 * The browser engine must reproduce its point estimates, assessment and IPMA coordinates.
 * (The reference's bootstrap used the pre-Phase-4 chunked definition, so SEs/CIs are not compared;
 * bootstrap parity is covered by packages/engine/tests/pls-bootstrap.test.ts.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnalysisConfiguration, type NormalizedSemResult, SemModel } from '@sem-studio/contracts';
import { estimate } from '@sem-studio/engine';
import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { createDataset, isDatasetError } from '@/domain/dataset/transform';

const repo = join(__dirname, '..', '..', '..', '..', '..');
const read = (p: string): string => readFileSync(join(repo, p), 'utf8');

describe('ACSI 2015 example: browser engine vs validated R reference', () => {
  it('reproduces point estimates, assessment and IPMA coordinates to 1e-10', async () => {
    const example = JSON.parse(read('content/examples/acsi-2015.json')) as {
      model: unknown;
      analysis: unknown;
    };
    const model = SemModel.parse(example.model);
    const analysis = AnalysisConfiguration.parse(example.analysis);
    const ref = (
      JSON.parse(read('docs/validation/phase-4/acsi-2015-reference-result.json')) as {
        result: NormalizedSemResult;
      }
    ).result;

    const ds = await createDataset(
      read('packages/fixtures/third-party/smartpls-samples/acsi-2015/data.csv'),
      { name: 'acsi', source: { kind: 'file', fileName: 'data.csv' } },
    );
    if (isDatasetError(ds)) throw new Error(ds.error.message);
    const data = buildAnalysisData(model, ds, 'listwise');
    if ('error' in data) throw new Error(data.error.message);
    expect(data.nUsed).toBe(ref.sample.nUsed);

    const out = await estimate({
      model,
      analysis: { ...analysis, engine: 'browser', bootstrap: undefined },
      data: {
        columns: data.columns,
        rows: data.rows as number[][],
        nRows: data.nRows,
        nDropped: data.nDropped,
      },
    });
    if (!out.ok) throw new Error(out.error.message);
    const res = out.result;

    let worst = 0;
    const cmp = (a: number | null | undefined, b: number | null | undefined, what: string) => {
      if (a === null || a === undefined || b === null || b === undefined) {
        expect(a ?? null, what).toBe(b ?? null);
        return;
      }
      worst = Math.max(worst, Math.abs(a - b));
      expect(Math.abs(a - b), what).toBeLessThan(1e-10);
    };

    const mine = new Map(res.parameters.map((p) => [`${p.key}|${p.scale}`, p]));
    for (const p of ref.parameters) {
      const q = mine.get(`${p.key}|${p.scale}`);
      expect(q, p.key).toBeDefined();
      cmp(q!.est, p.est, `${p.key} est`);
    }
    const metric = new Map(res.constructMetrics.map((m) => [`${m.constructId}|${m.metric}`, m]));
    for (const m of ref.constructMetrics)
      cmp(
        metric.get(`${m.constructId}|${m.metric}`)?.value,
        m.value,
        `${m.constructId} ${m.metric}`,
      );
    const mats = new Map(res.matrices.map((m) => [m.id, m]));
    for (const m of ref.matrices) {
      const q = mats.get(m.id)!;
      expect(q, m.id).toBeDefined();
      m.values.forEach((row, i) =>
        row.forEach((v, j) => cmp(q.values[i]![j], v, `${m.id}[${i},${j}]`)),
      );
    }
    for (const f of ref.fit) cmp(res.fit.find((x) => x.name === f.name)?.value, f.value, f.name);

    expect(res.ipma!.targetConstructId).toBe(ref.ipma!.targetConstructId);
    for (const c of ref.ipma!.constructs) {
      const q = res.ipma!.constructs.find((x) => x.constructId === c.constructId)!;
      expect(q.predecessor).toBe(c.predecessor);
      cmp(q.importance, c.importance, `${c.constructId} importance`);
      cmp(q.performance, c.performance, `${c.constructId} performance`);
    }
    for (const i of ref.ipma!.indicators ?? []) {
      const q = res.ipma!.indicators!.find((x) => x.indicatorId === i.indicatorId)!;
      cmp(q.importance, i.importance, `${i.indicatorId} importance`);
      cmp(q.performance, i.performance, `${i.indicatorId} performance`);
    }
    // observed on 2026-11-19: max |Δ| = 5.0e-12 (docs/validation/phase-4.md)
    expect(worst).toBeLessThan(1e-10);
  }, 60_000);
});
