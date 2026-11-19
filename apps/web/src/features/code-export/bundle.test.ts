import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import { estimate } from '@sem-lab/engine';
import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { createDataset, isDatasetError } from '@/domain/dataset/transform';
import { type BundleInput, buildExportBundle, exportBlock } from './bundle';

const repo = join(__dirname, '..', '..', '..', '..', '..');
const fixture = (name: string, file: string): string =>
  readFileSync(join(repo, 'packages/fixtures/synthetic', name, file), 'utf8');
const python = join(repo, 'packages/python-engine/.venv/bin/python');
const engineSource = readFileSync(
  join(repo, 'packages/python-engine/dist/semlab_bundle.py'),
  'utf8',
);

async function prepare(
  name: string,
  analysis: AnalysisConfiguration,
  patch?: (m: { indicators: Array<{ id: string; reverseScored?: boolean }> }) => void,
): Promise<Omit<BundleInput, 'language'>> {
  const raw = JSON.parse(fixture(name, 'model.json')) as {
    indicators: Array<{ id: string; reverseScored?: boolean }>;
  };
  patch?.(raw);
  const model = SemModel.parse(raw);
  const ds = await createDataset(fixture(name, 'data.csv'), {
    name,
    source: { kind: 'file', fileName: 'data.csv' },
  });
  if (isDatasetError(ds)) throw new Error(ds.error.message);
  const data = buildAnalysisData(model, ds, analysis.missingData === 'fiml' ? 'fiml' : 'listwise');
  if ('error' in data) throw new Error(data.error.message);
  const out = await estimate({
    model,
    analysis,
    data: {
      columns: data.columns,
      rows: data.rows as number[][],
      nRows: data.nRows,
      nDropped: data.nDropped,
    },
  });
  if (!out.ok) throw new Error(out.error.message);
  return {
    projectName: `Test ${name}`,
    model,
    analysis,
    result: out.result,
    modelHash: 'a'.repeat(64),
    dataFingerprint: ds.fingerprint,
    runId: 'run_test',
    runCreatedAt: '2026-11-19T12:00:00.000Z',
    data,
    transformations: [],
    generatedAt: '2026-11-19T12:00:00.000Z',
    appVersion: 'test',
    pythonEngineSource: engineSource,
  };
}

const plsIpmaBoot: AnalysisConfiguration = {
  method: 'pls-sem',
  engine: 'browser',
  estimator: 'pls-pm',
  missingData: 'listwise',
  seed: 99,
  bootstrap: {
    enabled: true,
    repetitions: 100,
    ci: 'percentile',
    confidenceLevel: 0.95,
    sides: 'two-sided',
  },
  ipma: { targetConstructId: 'c_bi' },
  pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-7 },
};
const cbMl: AnalysisConfiguration = {
  method: 'cb-sem',
  engine: 'browser',
  estimator: 'MLR',
  missingData: 'listwise',
  cb: { identification: 'marker', meanStructure: false },
};
const reverse = (m: { indicators: Array<{ id: string; reverseScored?: boolean }> }): void => {
  m.indicators.find((i) => i.id === 'i_peou1')!.reverseScored = true;
};

describe('export bundle', () => {
  it('lists every file with a correct SHA-256 and states versions, capabilities and data', async () => {
    const b = await buildExportBundle({
      language: 'r',
      ...(await prepare('tam-mediation', plsIpmaBoot, reverse)),
    });
    const m = b.manifest;
    expect(b.fileName).toBe('Test-tam-mediation-R-export.zip');
    expect(m.files.map((f) => f.path)).toEqual([
      'Test-tam-mediation-cSEM.R',
      'model.json',
      'analysis.json',
      'analysis-data.csv',
      'browser-result.json',
      'README.md',
    ]);
    for (const f of m.files) {
      const content = b.files.find((x) => x.path === f.path)!.content;
      expect(f.sha256).toBe(createHash('sha256').update(content, 'utf8').digest('hex'));
    }
    expect(m.script.testedWith).toEqual({ R: '4.6.2', cSEM: '0.7.1' });
    expect(m.data).toMatchObject({
      rows: 500,
      used: 500,
      missingData: 'listwise',
      reverseScoredColumns: ['peou1'],
    });
    expect(m.capabilities.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'pls.estimation.classic',
        'resampling.bootstrap-percentile',
        'ipma.construct',
      ]),
    );
    for (const c of m.capabilities) expect(c.status).toBe('supported');
    expect(m.citations.map((c) => c.key)).toEqual(
      expect.arrayContaining(['efron1993', 'ringle2016', 'rademaker2020']),
    );
    const readme = b.files.find((f) => f.path === 'README.md')!.content;
    expect(readme).toContain('This folder contains your data');
    for (const f of m.files) expect(readme).toContain(`\`${f.path}\``);
    expect(readme).toContain('Rscript Test-tam-mediation-cSEM.R');
    expect(readme).toMatch(/IPMA for BI: /);
    expect(readme).toContain('`peou1` was reverse scored');
  });

  it('refuses what the lavaan export cannot express', () => {
    const m = SemModel.parse(JSON.parse(fixture('pls-mixed-composite', 'model.json')));
    expect(exportBlock('r', { ...cbMl, estimator: 'WLSMV' }, m)).toMatch(/ML and MLR only/);
    expect(exportBlock('r', cbMl, m)).toMatch(/reflective constructs only/);
    expect(exportBlock('python', cbMl, m)).toBeNull();
  });

  describe.skipIf(!existsSync(python))(
    'the Python bundle runs and reproduces the app (needs packages/python-engine/.venv)',
    () => {
      it.each([
        ['PLS + bootstrap + IPMA, reverse-scored indicator', 'tam-mediation', plsIpmaBoot, reverse],
        ['CB-SEM MLR', 'cfa-two-factor', cbMl, undefined],
      ] as const)(
        '%s',
        async (_label, name, analysis, patch) => {
          const b = await buildExportBundle({
            language: 'python',
            ...(await prepare(name, analysis, patch)),
          });
          const dir = mkdtempSync(join(tmpdir(), 'sem-py-export-'));
          for (const f of b.files) {
            const p = join(dir, f.path);
            mkdirSync(join(p, '..'), { recursive: true });
            writeFileSync(p, f.content);
          }
          const out = execFileSync(python, ['-I', 'run_analysis.py'], {
            cwd: dir,
            encoding: 'utf8',
            timeout: 120_000,
          });
          expect(out).toMatch(/Check against the app: \d+ numbers, largest difference .* -> OK/);
          const n = Number(/Check against the app: (\d+) numbers/.exec(out)![1]);
          expect(n).toBeGreaterThan(30);
        },
        150_000,
      );
    },
  );
});
