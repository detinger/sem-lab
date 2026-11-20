/**
 * Path models and regressions of observed variables (single-indicator constructs): the browser
 * engine must reproduce ordinary least squares on the bundled data, which the fixture generator
 * computed independently (packages/fixtures/synthetic/<case>/manifest.json → sampleOls).
 *
 * - CB-SEM ML: in a recursive model with uncorrelated disturbances, the unstandardised path
 *   coefficients equal equation-by-equation OLS slopes.
 * - Classic PLS-SEM: each construct score is its standardised column, so path coefficients equal
 *   standardised OLS slopes and R² equals the OLS R².
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalysisConfiguration, NormalizedSemResult } from '@sem-lab/contracts';
import { estimate } from '@sem-lab/engine';
import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { loadBundledCsv } from '@/domain/dataset/bundled';
import { createDataset, isDatasetError } from '@/domain/dataset/transform';
import { EXAMPLES } from './examples';

const FIXTURES = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'fixtures', 'synthetic');

interface OlsEquation {
  r2: string;
  unstandardized: Record<string, string>;
  standardized: Record<string, string>;
}

const CASES = [
  'path-study-success',
  'path-work-wellbeing',
  'regression-house-prices',
  'regression-sleep-quality',
];

const CB: AnalysisConfiguration = {
  method: 'cb-sem',
  engine: 'browser',
  estimator: 'ML',
  missingData: 'listwise',
  cb: { identification: 'marker', meanStructure: false },
};
const PLS: AnalysisConfiguration = {
  method: 'pls-sem',
  engine: 'browser',
  estimator: 'pls-pm',
  missingData: 'listwise',
  pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-7 },
};

async function run(id: string, analysis: AnalysisConfiguration): Promise<NormalizedSemResult> {
  const ex = EXAMPLES.find((e) => e.id === id)!;
  const ds = await createDataset(await loadBundledCsv(ex.dataset.bundledId), {
    name: id,
    source: { kind: 'bundled', exampleId: ex.dataset.bundledId },
  });
  if (isDatasetError(ds)) throw new Error(ds.error.message);
  const data = buildAnalysisData(ex.model, ds, 'listwise');
  if ('error' in data) throw new Error(data.error.message);
  const out = await estimate({
    model: ex.model,
    analysis,
    data: {
      columns: data.columns,
      rows: data.rows as number[][],
      nRows: data.nRows,
      nDropped: data.nDropped,
    },
  });
  if (!out.ok) throw new Error(out.error.message);
  return out.result;
}

const cid = (name: string): string => `c_${name.toLowerCase()}`;

describe.each(CASES)('%s reproduces OLS', (id) => {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, id, 'manifest.json'), 'utf8')) as {
    sampleOls: Record<string, OlsEquation>;
  };
  const paths = Object.entries(manifest.sampleOls).flatMap(([target, eq]) =>
    Object.keys(eq.unstandardized).map((source) => ({ target, source, eq })),
  );

  it('is opened in observed-variable view', () => {
    expect(EXAMPLES.find((e) => e.id === id)?.observedVariables).toBe(true);
  });

  it('CB-SEM ML: unstandardised paths equal the OLS slopes', async () => {
    const r = await run(id, CB);
    for (const { target, source, eq } of paths) {
      const p = r.parameters.find(
        (x) => x.key === `path:${cid(source)}->${cid(target)}` && x.scale === 'unstandardized',
      );
      expect(p?.est, `${source} -> ${target}`).toBeCloseTo(Number(eq.unstandardized[source]), 3);
    }
  }, 60_000);

  it('PLS-SEM: paths equal the standardised OLS slopes and R² the OLS R²', async () => {
    const r = await run(id, PLS);
    for (const { target, source, eq } of paths) {
      const p = r.parameters.find((x) => x.key === `path:${cid(source)}->${cid(target)}`);
      expect(p?.est, `${source} -> ${target}`).toBeCloseTo(Number(eq.standardized[source]), 4);
    }
    for (const [target, eq] of Object.entries(manifest.sampleOls)) {
      const r2 = r.constructMetrics.find((m) => m.constructId === cid(target) && m.metric === 'r2');
      expect(r2?.value, `R² ${target}`).toBeCloseTo(Number(eq.r2), 4);
    }
  }, 60_000);
});
