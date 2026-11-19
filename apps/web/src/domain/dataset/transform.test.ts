import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyTransformations,
  createDataset,
  isDatasetError,
  withTransformations,
} from './transform';
import { typeColumns } from './typing';
import type { Dataset, DatasetColumn, Transformation } from './types';

const SYNTHETIC = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'fixtures',
  'synthetic',
);
const readCase = (id: string) => readFileSync(join(SYNTHETIC, id, 'data.csv'), 'utf8');

async function make(text: string, transformations: Transformation[] = []): Promise<Dataset> {
  const r = await createDataset(text, {
    name: 'test',
    source: { kind: 'file', fileName: 'test.csv' },
    id: 'd_test',
    importedAt: '2026-11-19T00:00:00Z',
    transformations,
  });
  if (isDatasetError(r)) throw new Error(r.error.message);
  return r;
}

const values = (ds: Pick<Dataset, 'columns'>, name: string): number[] => {
  const c = ds.columns.find((x) => x.name === name);
  if (c?.kind !== 'numeric') throw new Error(`${name} is not numeric`);
  return Array.from(c.values);
};

const typed = (text: string): DatasetColumn[] => {
  const rows = text
    .trim()
    .split('\n')
    .map((l) => l.split(','));
  return typeColumns({ columns: rows[0]!, rows: rows.slice(1) }, { decimal: '.' });
};

describe('applyTransformations', () => {
  it('reverse-scores x3 of pls-two-construct into exactly the stored x3_rev column', async () => {
    const ds = await make(readCase('pls-two-construct'), [
      { kind: 'reverse', column: 'x3', scale: { min: 1, max: 7 }, as: 'x3_r' },
    ]);
    expect(values(ds, 'x3_r')).toEqual(values(ds, 'x3_rev'));
    expect(ds.columns.at(-1)).toMatchObject({ name: 'x3_r', derivedFrom: 'x3' });
  });

  it('refuses to reverse values outside the stated scale (no clamping) and lists rows', () => {
    const cols = typed('a\n1\n9\n4\n0');
    const r = applyTransformations(cols, [
      { kind: 'reverse', column: 'a', scale: { min: 1, max: 7 }, as: 'a_r' },
    ]);
    expect(r).toEqual({
      error: expect.objectContaining({
        code: 'TRANSFORM_OUT_OF_RANGE',
        index: 0,
        column: 'a',
        rows: [2, 4],
      }) as unknown,
    });
  });

  it('refuses reverse scoring of text columns, unknown columns, bad scales and name collisions', () => {
    const cols = typed('a,t\n1,x\n2,3');
    const code = (t: Transformation) => {
      const r = applyTransformations(cols, [t]);
      return 'error' in r ? r.error.code : 'ok';
    };
    expect(code({ kind: 'reverse', column: 't', scale: { min: 1, max: 7 }, as: 'n' })).toBe(
      'TRANSFORM_NOT_NUMERIC',
    );
    expect(code({ kind: 'reverse', column: 'zz', scale: { min: 1, max: 7 }, as: 'n' })).toBe(
      'TRANSFORM_COLUMN_NOT_FOUND',
    );
    expect(code({ kind: 'reverse', column: 'a', scale: { min: 7, max: 1 }, as: 'n' })).toBe(
      'TRANSFORM_INVALID_SCALE',
    );
    expect(code({ kind: 'reverse', column: 'a', scale: { min: 1, max: 7 }, as: 't' })).toBe(
      'TRANSFORM_NAME_COLLISION',
    );
    expect(code({ kind: 'center', column: 'a', as: ' ' })).toBe('TRANSFORM_INVALID_NAME');
    expect(code({ kind: 'standardize', column: 'a', as: 'a' })).toBe('TRANSFORM_NAME_COLLISION');
  });

  it('turns a sentinel into missing only through missing-code', () => {
    const cols = typed('a,b\n-99,1\n3,-99\n4,5');
    expect(Array.from((cols[0] as { values: Float64Array }).values)).toEqual([-99, 3, 4]);
    const one = applyTransformations(cols, [{ kind: 'missing-code', column: 'a', code: -99 }]);
    if ('error' in one) throw new Error();
    expect(values(one, 'a')).toEqual([NaN, 3, 4]);
    expect(values(one, 'b')).toEqual([1, -99, 5]);
    const all = applyTransformations(cols, [{ kind: 'missing-code', column: '*', code: -99 }]);
    if ('error' in all) throw new Error();
    expect(values(all, 'b')).toEqual([1, NaN, 5]);
    // a column that becomes all-missing is empty
    const allGone = applyTransformations(typed('a\n-99\n-99'), [
      { kind: 'missing-code', column: 'a', code: -99 },
    ]);
    expect('error' in allGone ? null : allGone.columns[0]).toEqual({
      name: 'a',
      kind: 'empty',
      length: 2,
    });
  });

  it('centers and standardizes (sample SD) into new derived columns', () => {
    const cols = typed('a\n1\n2\n\n6');
    const r = applyTransformations(cols, [
      { kind: 'center', column: 'a', as: 'a_c' },
      { kind: 'standardize', column: 'a', as: 'a_z' },
    ]);
    if ('error' in r) throw new Error();
    expect(values(r, 'a_c')).toEqual([-2, -1, NaN, 3]);
    const sd = Math.sqrt((4 + 1 + 9) / 2);
    expect(
      values(r, 'a_z').map((v) => (Number.isNaN(v) ? v : Math.round(v * sd * 1e12) / 1e12)),
    ).toEqual([-2, -1, NaN, 3]);
    expect(r.columns.map((c) => c.name)).toEqual(['a', 'a_c', 'a_z']);
    const zero = applyTransformations(typed('a\n2\n2'), [
      { kind: 'standardize', column: 'a', as: 'z' },
    ]);
    expect('error' in zero && zero.error.code).toBe('TRANSFORM_ZERO_VARIANCE');
  });

  it('drops columns and rows (by ORIGINAL index), in order', () => {
    const cols = typed('a,b\n1,10\n2,20\n3,30\n4,40');
    const r = applyTransformations(cols, [
      { kind: 'drop-rows', rows: [1], reason: 'test' },
      { kind: 'center', column: 'a', as: 'a_c' }, // mean over remaining rows 1, 3, 4
      { kind: 'drop-rows', rows: [3, 1], reason: 'again' },
      { kind: 'drop-column', column: 'b' },
    ]);
    if ('error' in r) throw new Error();
    expect(r.rowIndex).toEqual([0, 2]);
    expect(r.columns.map((c) => c.name)).toEqual(['a', 'a_c']);
    expect(values(r, 'a')).toEqual([1, 3]);
    expect(values(r, 'a_c')).toEqual([1 - 8 / 3, 3 - 8 / 3]);
    const bad = applyTransformations(cols, [{ kind: 'drop-rows', rows: [4], reason: 'x' }]);
    expect('error' in bad && bad.error.code).toBe('TRANSFORM_ROW_NOT_FOUND');
    const after = applyTransformations(cols, [
      { kind: 'drop-column', column: 'b' },
      { kind: 'center', column: 'b', as: 'q' },
    ]);
    expect('error' in after && [after.error.code, after.error.index]).toEqual([
      'TRANSFORM_COLUMN_NOT_FOUND',
      1,
    ]);
  });

  it('never mutates its input columns or the original table', async () => {
    const ds = await make('a,b\n-99,1\n3,2\n5,3\n');
    const originalCopy = structuredClone(ds.original);
    const before = values(ds, 'a');
    const next = await withTransformations(ds, [
      { kind: 'missing-code', column: '*', code: -99 },
      { kind: 'reverse', column: 'b', scale: { min: 1, max: 3 }, as: 'b_r' },
      { kind: 'drop-rows', rows: [2], reason: 'test' },
    ]);
    if (isDatasetError(next)) throw new Error();
    expect(values(ds, 'a')).toEqual(before);
    expect(ds.columns.map((c) => c.name)).toEqual(['a', 'b']);
    expect(ds.original).toEqual(originalCopy);
    expect(next.original).toBe(ds.original);
    expect(values(next, 'a')).toEqual([NaN, 3]);
    expect(values(next, 'b_r')).toEqual([3, 2]);
    expect(next.transformations).toHaveLength(3);
  });
});

describe('createDataset / fingerprint', () => {
  it('records resolved parse options and the parse report', async () => {
    const ds = await make('x;y\n7,25;1\n3;2\n');
    expect(ds.parseOptions).toEqual({
      delimiter: ';',
      decimal: ',',
      missingTokens: ['', 'NA', 'N/A', 'NaN', 'null', 'NULL', '#NULL!'],
    });
    expect(ds.rowIndex).toEqual([0, 1]);
    expect(ds.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across delimiter, decimal mark, quoting and number formatting', async () => {
    const a = await make('x,y,t\n7.25,1,a\n3,,b\n');
    const b = await make('﻿"x";"y";"t"\r\n7,25;1,0E0;"a"\r\n3;NA;b\r\n');
    expect([b.parse.delimiter, b.parse.decimal]).toEqual([';', ',']);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('changes when data or transformations change', async () => {
    const a = await make('x,y\n1,2\n3,4\n');
    const b = await make('x,y\n1,2\n3,5\n');
    expect(b.fingerprint).not.toBe(a.fingerprint);
    const c = await withTransformations(a, [{ kind: 'drop-rows', rows: [0], reason: 'test' }]);
    if (isDatasetError(c)) throw new Error();
    expect(c.fingerprint).not.toBe(a.fingerprint);
    const back = await withTransformations(c, []);
    if (isDatasetError(back)) throw new Error();
    expect(back.fingerprint).toBe(a.fingerprint);
  });

  it('returns a typed error, without throwing, for a broken file or transformation', async () => {
    const parse = await createDataset('a,a\n1,2\n', {
      name: 'x',
      source: { kind: 'file', fileName: 'x.csv' },
    });
    expect(isDatasetError(parse) && parse.error.code).toBe('PARSE_FAILED');
    expect(isDatasetError(parse) && parse.error.issues?.[0]?.code).toBe('DUPLICATE_COLUMN_NAME');
    const tr = await createDataset('a\n1\n', {
      name: 'x',
      source: { kind: 'file', fileName: 'x.csv' },
      transformations: [{ kind: 'drop-column', column: 'nope' }],
    });
    expect(isDatasetError(tr) && tr.error.code).toBe('TRANSFORM_COLUMN_NOT_FOUND');
  });
});
