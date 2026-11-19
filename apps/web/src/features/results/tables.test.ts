import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AnalysisConfiguration, NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { updateConstruct } from '@/domain/model-ops';
import { toHtml } from '../reports/table';
import {
  effectsTable,
  fitTable,
  inferenceNote,
  loadingsTable,
  matrixTable,
  pathsTable,
  r2Table,
  reliabilityTable,
} from './tables';

const model = SemModel.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'packages',
        'fixtures',
        'synthetic',
        'tam-mediation',
        'model.json',
      ),
      'utf8',
    ),
  ),
);
const analysis: AnalysisConfiguration = {
  method: 'pls-sem',
  engine: 'r-csem',
  estimator: 'pls-pm',
  missingData: 'listwise',
  seed: 7,
  bootstrap: {
    enabled: true,
    repetitions: 1000,
    ci: 'percentile',
    confidenceLevel: 0.95,
    sides: 'two-sided',
  },
  pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-7 },
};
const est = (
  key: string,
  kind: 'path' | 'loading' | 'weight' | 'total-effect' | 'specific-indirect',
  s: string,
  t: string,
  v: number,
  via?: string[],
) => ({
  key,
  kind,
  sourceId: s,
  targetId: t,
  ...(via ? { viaIds: via } : {}),
  scale: 'standardized' as const,
  est: v,
  se: 0.03,
  statistic: v / 0.03,
  statisticType: 't' as const,
  pValue: v > 0.1 ? 0 : 0.0321,
  ciLower: v - 0.06,
  ciUpper: v + 0.06,
  status: 'estimated' as const,
  sourceMethod: 'cSEM::csem',
});
// Illustrative values for table construction only — NOT estimates.
const result = NormalizedSemResult.parse({
  schemaVersion: 1,
  sample: { nRows: 500, nUsed: 480, nDropped: 20, missingData: 'listwise' },
  estimation: { converged: true, iterations: 5, admissible: true, messages: [] },
  parameters: [
    est('path:c_peou->c_pu', 'path', 'c_peou', 'c_pu', 0.5),
    est('path:c_pu->c_bi', 'path', 'c_pu', 'c_bi', 0.45),
    est('path:c_peou->c_bi', 'path', 'c_peou', 'c_bi', 0.05),
    est('loading:c_pu:i_pu1', 'loading', 'c_pu', 'i_pu1', 0.81),
    est('weight:c_pu:i_pu1', 'weight', 'c_pu', 'i_pu1', 0.3),
    est('total-effect:c_peou->c_bi', 'total-effect', 'c_peou', 'c_bi', 0.275),
    est('specific-indirect:c_peou->c_pu->c_bi', 'specific-indirect', 'c_peou', 'c_bi', 0.225, [
      'c_pu',
    ]),
  ],
  constructMetrics: [
    { constructId: 'c_pu', metric: 'r2', value: 0.25, definition: 'R²' },
    { constructId: 'c_pu', metric: 'r2-adjusted', value: 0.248, definition: 'adj' },
    { constructId: 'c_pu', metric: 'cronbach-alpha', value: 0.86, definition: 'α' },
    {
      constructId: 'c_peou',
      metric: 'r2',
      value: null,
      missing: 'not-applicable',
      definition: 'exogenous',
    },
    {
      constructId: 'c_bi',
      metric: 'ave',
      value: null,
      missing: 'not-applicable',
      definition: 'composite',
    },
  ],
  matrices: [
    {
      id: 'htmt',
      title: 'HTMT',
      rowIds: ['c_peou', 'c_pu'],
      colIds: ['c_peou', 'c_pu'],
      values: [
        [null, 0.6],
        [0.6, null],
      ],
      symmetric: true,
      definition: 'Heterotrait–monotrait ratio.',
    },
  ],
  fit: [{ name: 'd_g', value: 0.12, definition: 'Geodesic discrepancy (log10 as in cSEM).' }],
  bootstrap: {
    requested: 1000,
    completed: 990,
    failed: 2,
    inadmissible: 8,
    seed: 7,
    ciMethod: 'percentile',
    confidenceLevel: 0.95,
    chunkSize: 100,
  },
  warnings: [],
  provenance: {
    engine: 'r-csem',
    packageVersions: { cSEM: '0.7.1' },
    call: 'test',
    startedAt: '2026-11-19T12:00:00Z',
    finishedAt: '2026-11-19T12:00:01Z',
  },
});
const ctx = { model, result, analysis };

describe('result tables', () => {
  it('labels paths by construct name, keeps hypotheses, and formats p without zero', () => {
    const t = pathsTable(ctx);
    expect(t.rows[0]).toMatchObject({
      path: 'PEOU → PU',
      est: '0.500',
      p: '< 0.001',
      ci: '[0.440, 0.560]',
      t: '16.67',
    });
    expect(t.columns.map((c) => c.label)).toContain('95% CI');
    expect(t.notes[0]).toMatch(
      /PLS-SEM \(classic PLS path modeling, no consistency correction\), path weighting scheme, N = 480, 20 of 500 rows removed/,
    );
  });
  it('states the bootstrap accounting and inference definitions', () => {
    expect(inferenceNote(ctx)).toMatch(
      /990 valid of 1,000 requested samples \(seed 7, 2 failed, 8 inadmissible and excluded\)/,
    );
    expect(inferenceNote(ctx)).toMatch(/95% percentile confidence intervals/);
    expect(inferenceNote({ ...ctx, result: { ...result, bootstrap: undefined } })).toMatch(
      /No bootstrap was run/,
    );
  });
  it('names every node of a specific indirect effect', () => {
    expect(effectsTable(ctx).rows.find((r) => r.type === 'Specific indirect')?.effect).toBe(
      'PEOU → PU → BI',
    );
  });
  it('shows absent values as dashes and explains them in the note', () => {
    const rel = reliabilityTable(ctx);
    expect(rel.rows.find((r) => r.c === 'BI')?.ave).toBe('–');
    expect(rel.notes.join(' ')).toMatch(/not applicable/);
    const r2 = r2Table(ctx);
    expect(r2.rows.map((r) => r.c)).toEqual(['PU']); // exogenous constructs have no R² row
  });
  it('marks block type in the loadings table', () => {
    const composite = loadingsTable({
      ...ctx,
      model: updateConstruct(model, 'c_pu', { measurement: 'composite-formative' }),
    });
    expect(composite.rows.find((r) => r.c?.startsWith('PU'))?.c).toBe('PU (composite)');
    expect(loadingsTable(ctx).rows.find((r) => r.i === 'pu1')).toMatchObject({
      l: '0.810',
      w: '0.300',
    });
  });
  it('renders matrices lower-triangular with names, and fit with definitions', () => {
    const h = matrixTable(ctx, 'htmt')!;
    expect(h.columns.map((c) => c.label)).toEqual(['', 'PEOU', 'PU']);
    expect(h.rows[0]).toMatchObject({ r: 'PEOU', c_peou: '–', c_pu: '' });
    expect(h.rows[1]).toMatchObject({ r: 'PU', c_peou: '0.600' });
    expect(matrixTable(ctx, 'nope')).toBeNull();
    expect(fitTable(ctx).rows[0]).toMatchObject({ n: 'D G', v: '0.120' });
  });
  it('produces Word HTML for every table without throwing', () => {
    for (const t of [
      pathsTable(ctx),
      effectsTable(ctx),
      r2Table(ctx),
      loadingsTable(ctx),
      reliabilityTable(ctx),
      fitTable(ctx),
    ]) {
      expect(toHtml(t)).toContain('<table');
    }
  });
});
