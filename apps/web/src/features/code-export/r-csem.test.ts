import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnalysisConfiguration, SemModel } from '@sem-studio/contracts';
import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { createDataset, isDatasetError } from '@/domain/dataset/transform';
import { analysisCsv } from '@/features/code-export/analysis-csv';
import { estimate } from '@sem-studio/engine';
import { exportCsemScript, identifiers, rComment, rString } from './r-csem';

const repo = join(__dirname, '..', '..', '..', '..', '..');
const fixture = (name: string, file: string): string =>
  readFileSync(join(repo, 'packages/fixtures/synthetic', name, file), 'utf8');
const rscript = join(repo, 'services/r-engine/bin/rscript');

function rWorks(): boolean {
  if (!existsSync(rscript)) return false;
  try {
    execFileSync(rscript, ['-e', 'invisible(requireNamespace("cSEM"))'], {
      timeout: 60_000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

describe('R literal and identifier safety', () => {
  it('escapes everything that could end a string or a comment', () => {
    expect(rString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    expect(rString('é😀')).toBe('"\\u{e9}\\U{1f600}"');
    expect(rComment('line1\nsystem("rm")\r\u2028x')).toBe('line1 system("rm") x');
  });
  it('makes unique, syntactic, non-reserved identifiers', () => {
    const m = SemModel.parse({
      constructs: [
        { id: 'c1', name: 'if', measurement: 'reflective', indicatorIds: ['i1'] },
        {
          id: 'c2',
          name: 'Perceived Ease (PEOU)',
          measurement: 'reflective',
          indicatorIds: ['i2'],
        },
        { id: 'c3', name: '2nd wave', measurement: 'reflective', indicatorIds: ['i3'] },
      ],
      indicators: [
        { id: 'i1', name: 'x"); system("echo pwned', column: 'a' },
        { id: 'i2', name: 'IF', column: 'b' },
        { id: 'i3', name: 'é1', column: 'c' },
      ],
      relationships: [],
    });
    const ids = [...identifiers(m).values()];
    expect(ids).toEqual([
      'if_',
      'Perceived_Ease_PEOU',
      'v_2nd_wave',
      'x_system_echo_pwned',
      'IF',
      'e1',
    ]);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
  });
});

describe('exported script content', () => {
  const model = SemModel.parse(JSON.parse(fixture('pls-two-construct', 'model.json')));
  const base = {
    model,
    projectName: 'Two constructs\nsystem("x")',
    modelHash: 'a'.repeat(64),
    dataFingerprint: 'b'.repeat(64),
    dataColumns: ['x1', 'x2', 'x3', 'y1', 'y2', 'y3'],
    nRows: 300,
    nUsed: 300,
    transformations: [],
    generatedAt: '2026-11-19T12:00:00Z',
    appVersion: '0.3.0',
  };
  const classic: AnalysisConfiguration = {
    method: 'pls-sem',
    engine: 'r-csem',
    estimator: 'pls-pm',
    missingData: 'listwise',
    pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-7 },
  };
  it('requests classic PLS explicitly and PLSc explicitly', () => {
    expect(exportCsemScript({ ...base, analysis: classic })).toMatch(/\.disattenuate = FALSE/);
    expect(exportCsemScript({ ...base, analysis: { ...classic, method: 'plsc' } })).toMatch(
      /\.disattenuate = TRUE[\s\S]*\.PLS_approach_cf = "dist_squared_euclid"/,
    );
  });
  it('never lets a label escape a comment', () => {
    const s = exportCsemScript({ ...base, analysis: classic });
    expect(s).toContain('# Project: Two constructs system("x")');
    expect(s.split('\n').filter((l) => l.startsWith('system('))).toEqual([]);
  });
  it('refuses CB-SEM (a different exporter)', () => {
    expect(() =>
      exportCsemScript({
        ...base,
        analysis: {
          ...classic,
          method: 'cb-sem',
          engine: 'r-lavaan',
          estimator: 'ML',
          pls: undefined,
        },
      }),
    ).toThrow(/PLS-SEM and PLSc only/);
  });
});

describe.skipIf(!rWorks())(
  'the exported R script reproduces the in-app (browser) engine exactly, bootstrap included (requires R + cSEM)',
  () => {
    it.each(['pls-sem', 'plsc'] as const)(
      '%s with a 200-draw bootstrap',
      async (method) => {
        const model = SemModel.parse(JSON.parse(fixture('pls-two-construct', 'model.json')));
        const ds = await createDataset(fixture('pls-two-construct', 'data.csv'), {
          name: 'two',
          source: { kind: 'file', fileName: 'data.csv' },
        });
        if (isDatasetError(ds)) throw new Error(ds.error.message);
        const data = buildAnalysisData(model, ds, 'listwise');
        if ('error' in data) throw new Error(data.error.message);
        const analysis: AnalysisConfiguration = {
          method,
          engine: 'r-csem',
          estimator: 'pls-pm',
          missingData: 'listwise',
          seed: 4711,
          bootstrap: {
            enabled: true,
            repetitions: 200,
            ci: 'percentile',
            confidenceLevel: 0.95,
            sides: 'two-sided',
          },
          pls: { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-7 },
        };
        const dir = mkdtempSync(join(tmpdir(), 'sem-export-'));
        const csv = analysisCsv(data);
        // 1) the app's own browser engine (the numbers the user sees)
        const outcome = await estimate({
          model,
          analysis: { ...analysis, engine: 'browser' },
          data: {
            columns: data.columns,
            // listwise analysis data never contain null cells
            rows: data.rows as number[][],
            nRows: data.nRows,
            nDropped: data.nDropped,
          },
        });
        if (!outcome.ok) throw new Error(outcome.error.message);
        const engine = {
          ok: true,
          result: outcome.result as unknown as {
            parameters: Array<{
              kind: string;
              est: number;
              ciLower: number | null;
              ciUpper: number | null;
            }>;
            bootstrap: { completed: number; failed: number; inadmissible: number };
          },
        };
        expect(engine.ok).toBe(true);
        // 2) the exported script, plus a test-only footer that writes its numbers as JSON
        writeFileSync(join(dir, 'analysis-data.csv'), csv);
        const script = exportCsemScript({
          model,
          analysis,
          projectName: 'export test',
          modelHash: 'a'.repeat(64),
          dataFingerprint: ds.fingerprint,
          dataColumns: data.columns,
          nRows: data.nRows,
          nUsed: data.nUsed,
          transformations: [],
          generatedAt: '2026-11-19T12:00:00Z',
          appVersion: 'test',
        });
        const footer =
          '\njsonlite::write_json(list(est = unname(bootstrap_table$estimate), lo = unname(bootstrap_table$ci_lower), hi = unname(bootstrap_table$ci_upper), n = nrow(draws), failed = failed, inadmissible = inadmissible), "script-out.json", digits = I(17), auto_unbox = TRUE)\n';
        writeFileSync(join(dir, 'export.R'), script + footer);
        execFileSync(rscript, ['export.R'], { cwd: dir, timeout: 280_000, stdio: 'ignore' });
        const out = JSON.parse(readFileSync(join(dir, 'script-out.json'), 'utf8')) as {
          est: number[];
          lo: number[];
          hi: number[];
          n: number;
          failed: number;
          inadmissible: number;
        };
        // 3) same bootstrap accounting
        expect({ n: out.n, failed: out.failed, inadmissible: out.inadmissible }).toEqual({
          n: engine.result.bootstrap.completed,
          failed: engine.result.bootstrap.failed,
          inadmissible: engine.result.bootstrap.inadmissible,
        });
        // 4) every engine path / loading / weight has a script row with the same estimate and percentile CI
        const params = engine.result.parameters.filter((p) =>
          ['path', 'loading', 'weight'].includes(p.kind),
        );
        expect(params.length).toBeGreaterThan(0);
        for (const p of params) {
          const k = out.est.findIndex(
            (e, i) =>
              Math.abs(e - p.est) < 1e-12 && Math.abs(out.lo[i]! - (p.ciLower ?? NaN)) < 1e-12,
          );
          expect(k, `no script row reproduces ${p.kind} ${p.est}`).toBeGreaterThanOrEqual(0);
          expect(Math.abs(out.hi[k]! - (p.ciUpper ?? NaN))).toBeLessThan(1e-12);
        }
      },
      300_000,
    );
  },
);
