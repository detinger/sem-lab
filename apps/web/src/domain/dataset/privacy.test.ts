/**
 * Architecture ground rule 3: row-level data are never logged and never appear in error
 * messages. Two checks: (1) no Data Lab source file calls console.*; (2) every error and
 * issue message produced from data carrying a sentinel value is free of that value.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SemModel } from '@sem-lab/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAnalysisData } from './analysis-data';
import { parseCsv } from './parse';
import { applyTransformations, createDataset, isDatasetError } from './transform';
import { typeColumns } from './typing';
import type { Transformation } from './types';

const SECRET = '8675309';
const SECRET_TEXT = 'SECRETVALUE';

const sources = [
  ...readdirSync(__dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(__dirname, f)),
  join(__dirname, '..', '..', 'storage', 'datasets.ts'),
];

describe('privacy', () => {
  it.each(sources.map((s) => [s.split('/').slice(-2).join('/'), s]))(
    '%s never calls console.*',
    (_name, path) => {
      expect(readFileSync(path, 'utf8')).not.toMatch(/\bconsole\s*\./);
    },
  );

  const spies = () =>
    (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m));
  afterEach(() => vi.restoreAllMocks());

  it('keeps cell values out of every parse, transform and analysis message', async () => {
    const watched = spies();
    const messages: string[] = [];
    const collect = (x: unknown) => messages.push(JSON.stringify(x));

    // parse issues: ragged rows, unclosed quotes, ambiguous decimals, no header
    for (const text of [
      `a,b\n${SECRET},1,${SECRET_TEXT}\n2\n`,
      `a,b\n1,"${SECRET_TEXT}\n`,
      `a;b\n${SECRET},5;1.5\n`,
      `${SECRET},1\n2,3\n`,
    ]) {
      collect(parseCsv(text).report.issues);
    }
    // a failing createDataset
    collect(
      await createDataset(`x,x\n${SECRET},1\n`, {
        name: 'n',
        source: { kind: 'file', fileName: 'f' },
      }),
    );

    // transformation errors
    const cols = typeColumns(
      {
        columns: ['a', 't'],
        rows: [
          [SECRET, SECRET_TEXT],
          ['1', '2'],
        ],
      },
      { decimal: '.' },
    );
    for (const t of [
      { kind: 'reverse', column: 'a', scale: { min: 1, max: 7 }, as: 'r' },
      { kind: 'reverse', column: 't', scale: { min: 1, max: 7 }, as: 'r' },
      { kind: 'standardize', column: 'a', as: 'a' },
      { kind: 'drop-rows', rows: [Number(SECRET)], reason: 'x' },
    ] satisfies Transformation[]) {
      const r = applyTransformations(cols, [t]);
      expect('error' in r).toBe(true);
      collect(r);
    }

    // analysis-data errors
    const ds = await createDataset(`a,t\n${SECRET},${SECRET_TEXT}\n1,2\n2,3\n`, {
      name: 'n',
      source: { kind: 'file', fileName: 'f' },
    });
    if (isDatasetError(ds)) throw new Error('unexpected');
    const model = (column: string, extra: object = {}): SemModel => ({
      constructs: [{ id: 'c', name: 'C', measurement: 'reflective', indicatorIds: ['i'] }],
      indicators: [{ id: 'i', name: 'i', column, ...extra }],
      relationships: [],
    });
    for (const m of [
      model('t'),
      model('a', { reverseScored: true, scale: { min: 1, max: 7 } }),
      model('a', { reverseScored: true }),
    ]) {
      const r = buildAnalysisData(m, ds, 'listwise');
      expect('error' in r).toBe(true);
      collect(r);
    }

    expect(messages.length).toBeGreaterThan(10);
    for (const m of messages) {
      expect(m).not.toContain(SECRET);
      expect(m).not.toContain(SECRET_TEXT);
    }
    for (const spy of watched) expect(spy).not.toHaveBeenCalled();
  });
});
