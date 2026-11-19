import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import { estimate } from '@sem-lab/engine';
import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { createDataset, isDatasetError } from '@/domain/dataset/transform';
import { exportLavaanScript } from './r-lavaan';

const repo = join(__dirname, '..', '..', '..', '..', '..');
const fixture = (name: string, file: string): string =>
  readFileSync(join(repo, 'packages/fixtures/synthetic', name, file), 'utf8');
const rscript = join(repo, 'services/r-engine/bin/rscript');

function rWorks(): boolean {
  if (!existsSync(rscript)) return false;
  try {
    execFileSync(
      rscript,
      ['-e', 'if (!requireNamespace("lavaan", quietly = TRUE)) quit(status = 1)'],
      {
        timeout: 60_000,
        stdio: 'ignore',
      },
    );
    return true;
  } catch {
    return false;
  }
}

const base = {
  projectName: 'lavaan export test',
  modelHash: 'a'.repeat(64),
  dataFingerprint: 'b'.repeat(64),
  transformations: [],
  generatedAt: '2026-11-19T12:00:00Z',
  appVersion: 'test',
};

describe('lavaan script content', () => {
  const model = SemModel.parse(JSON.parse(fixture('service-quality', 'model.json')));
  const ml: AnalysisConfiguration = {
    method: 'cb-sem',
    engine: 'browser',
    estimator: 'ML',
    missingData: 'listwise',
    cb: { identification: 'marker', meanStructure: false },
  };
  it('requests the engine settings explicitly', () => {
    const s = exportLavaanScript({ ...base, model, analysis: ml, nRows: 450, nUsed: 450 });
    expect(s).toMatch(/estimator = "ML"/);
    expect(s).toMatch(/std\.lv = FALSE/);
    expect(s).toMatch(/missing = "listwise"/);
    const fiml = exportLavaanScript({
      ...base,
      model,
      analysis: {
        ...ml,
        missingData: 'fiml',
        estimator: 'MLR',
        cb: { identification: 'std-lv', meanStructure: true },
      },
      nRows: 450,
      nUsed: 450,
    });
    expect(fiml).toMatch(/missing = "ml",\n\s+meanstructure = TRUE/);
    expect(fiml).toMatch(/std\.lv = TRUE/);
  });
  it('refuses what the browser engine does not support', () => {
    expect(() =>
      exportLavaanScript({
        ...base,
        model,
        analysis: { ...ml, estimator: 'WLSMV' },
        nRows: 1,
        nUsed: 1,
      }),
    ).toThrow(/not supported/);
    expect(() =>
      exportLavaanScript({
        ...base,
        model,
        analysis: {
          method: 'pls-sem',
          engine: 'browser',
          estimator: 'pls-pm',
          missingData: 'listwise',
        },
        nRows: 1,
        nUsed: 1,
      }),
    ).toThrow(/CB-SEM only/);
  });
});

describe.skipIf(!rWorks())(
  'the exported lavaan script reproduces the browser CB engine (requires R + lavaan)',
  () => {
    const cases: Array<[string, string, AnalysisConfiguration]> = [
      [
        'service-quality',
        'ML marker',
        {
          method: 'cb-sem',
          engine: 'browser',
          estimator: 'ML',
          missingData: 'listwise',
          cb: { identification: 'marker', meanStructure: false },
        },
      ],
      [
        'cfa-two-factor',
        'MLR std.lv',
        {
          method: 'cb-sem',
          engine: 'browser',
          estimator: 'MLR',
          missingData: 'listwise',
          cb: { identification: 'std-lv', meanStructure: false },
        },
      ],
      [
        'missing-mcar',
        'ML FIML',
        {
          method: 'cb-sem',
          engine: 'browser',
          estimator: 'ML',
          missingData: 'fiml',
          cb: { identification: 'marker', meanStructure: true },
        },
      ],
    ];
    it.each(cases)(
      '%s (%s)',
      async (name, _label, analysis) => {
        const model = SemModel.parse(JSON.parse(fixture(name, 'model.json')));
        const ds = await createDataset(fixture(name, 'data.csv'), {
          name,
          source: { kind: 'file', fileName: 'data.csv' },
        });
        if (isDatasetError(ds)) throw new Error(ds.error.message);
        const data = buildAnalysisData(model, ds, analysis.missingData);
        if ('error' in data) throw new Error(data.error.message);
        const outcome = await estimate({
          model,
          analysis,
          data: {
            columns: data.columns,
            rows: data.rows as number[][],
            nRows: data.nRows,
            nDropped: data.nDropped,
          },
        });
        if (!outcome.ok) throw new Error(outcome.error.message);
        const dir = mkdtempSync(join(tmpdir(), 'sem-lavaan-'));
        const csv = [
          data.columns.join(','),
          ...data.rows.map((r) => r.map((v) => (v === null ? '' : String(v))).join(',')),
        ].join('\n');
        writeFileSync(join(dir, 'analysis-data.csv'), `${csv}\n`);
        const script = exportLavaanScript({
          ...base,
          model,
          analysis,
          nRows: data.nRows,
          nUsed: data.nUsed,
        });
        const footer =
          '\njsonlite::write_json(list(est = estimates$est[estimates$se > 0 & !is.na(estimates$se)], fit = as.list(unclass(fit_measures))), "out.json", digits = I(17), auto_unbox = TRUE)\n';
        writeFileSync(join(dir, 'export.R'), script + footer);
        execFileSync(rscript, ['export.R'], { cwd: dir, timeout: 240_000, stdio: 'ignore' });
        const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as {
          est: number[];
          fit: Record<string, number>;
        };
        // every freely estimated unstandardized parameter of the engine has a lavaan twin
        const free = outcome.result.parameters.filter(
          (p) => p.scale === 'unstandardized' && p.status === 'estimated' && p.est !== null,
        );
        expect(free.length).toBe(out.est.length);
        for (const p of free) {
          expect(
            out.est.some((e) => Math.abs(e - p.est!) < 2e-5),
            `${p.key} ${p.est} has no lavaan estimate within 2e-5`,
          ).toBe(true);
        }
        // fit indices
        const fit = (n: string, variant = 'standard'): number | null =>
          outcome.result.fit.find((f) => f.name === n && (f.variant ?? 'standard') === variant)
            ?.value ?? null;
        for (const [lav, ours] of [
          ['chisq', 'chisq'],
          ['df', 'df'],
          ['cfi', 'cfi'],
          ['tli', 'tli'],
          ['rmsea', 'rmsea'],
          ['srmr', 'srmr'],
        ] as const) {
          const v = fit(ours);
          if (v === null) continue;
          expect(
            Math.abs(v - out.fit[lav]!),
            `${lav}: engine ${v} vs lavaan ${out.fit[lav]}`,
          ).toBeLessThan(1e-4 * Math.max(1, Math.abs(v)));
        }
      },
      300_000,
    );
  },
);
