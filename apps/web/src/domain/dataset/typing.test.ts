import { describe, expect, it } from 'vitest';
import { parseCsv } from './parse';
import { parseNumber, typeColumns } from './typing';
import type { DatasetColumn } from './types';

const one = (cells: string[], decimal: '.' | ',' = '.', missingTokens?: string[]) =>
  typeColumns(
    { columns: ['c'], rows: cells.map((c) => [c]) },
    { decimal, ...(missingTokens ? { missingTokens } : {}) },
  )[0] as DatasetColumn;

describe('parseNumber', () => {
  it.each([
    ['7', 7],
    [' 7 ', 7],
    ['7.000000000000', 7],
    ['+3.5', 3.5],
    ['-0.25', -0.25],
    ['.5', 0.5],
    ['5.', 5],
    ['1e3', 1000],
    ['-2.5E-2', -0.025],
    ['\t42\t', 42],
  ])('reads %j under "." as %d', (text, value) => {
    expect(parseNumber(text, '.')).toBe(value);
  });

  it.each([
    '1.2.3',
    '7,25',
    '0x1A',
    'Infinity',
    '-Infinity',
    'NaN',
    '',
    ' ',
    '1e999',
    '1 000',
    '1,234.5',
    'e5',
    '+',
    '--1',
    '7a',
  ])('rejects %j under "."', (text) => {
    expect(parseNumber(text, '.')).toBeNull();
  });

  it('reads comma decimals only under ","', () => {
    expect(parseNumber('7,25', ',')).toBe(7.25);
    expect(parseNumber('-1,5e2', ',')).toBe(-150);
    expect(parseNumber('7.25', ',')).toBeNull();
    expect(parseNumber('1.234,5', ',')).toBeNull();
  });
});

describe('typeColumns', () => {
  it('types numeric columns with NaN as the internal missing marker', () => {
    const col = one(['1', ' 2 ', '', 'NA', '3.5']);
    expect(col.kind).toBe('numeric');
    if (col.kind !== 'numeric') return;
    expect(Array.from(col.values)).toEqual([1, 2, NaN, NaN, 3.5]);
  });

  it('keeps a column with one stray "n/a " as TEXT and reports the example', () => {
    const col = one(['1', '2', 'n/a ', '4']);
    expect(col).toMatchObject({ kind: 'text', nonNumericCount: 1, examples: ['n/a '] });
    if (col.kind === 'text') expect(col.values).toEqual(['1', '2', 'n/a ', '4']);
  });

  it('reports at most 5 distinct examples, each at most 40 characters', () => {
    const long = 'x'.repeat(60);
    const col = one(['a', 'a', 'b', 'c', long, 'd', 'e', 'f', '1']);
    expect(col.kind).toBe('text');
    if (col.kind !== 'text') return;
    expect(col.nonNumericCount).toBe(8);
    expect(col.examples).toHaveLength(5);
    expect(col.examples).toEqual(['a', 'b', 'c', `${'x'.repeat(39)}…`, 'd']);
    expect(col.examples.every((e) => e.length <= 40)).toBe(true);
  });

  it('does not coerce "7,25" under "." or "7.25" under ","', () => {
    expect(one(['7,25', '1']).kind).toBe('text');
    expect(one(['7.25', '1'], ',').kind).toBe('text');
    expect(one(['7,25', '1'], ',').kind).toBe('numeric');
  });

  it('marks an all-missing column as empty', () => {
    expect(one(['', 'NA', ' '])).toEqual({ name: 'c', kind: 'empty', length: 3 });
  });

  it('uses the missing tokens given (case-sensitive) and always treats an empty cell as missing', () => {
    expect(one(['1', 'na']).kind).toBe('text');
    expect(one(['1', 'na', ''], '.', ['na']).kind).toBe('numeric');
    expect(one(['1', 'NA'], '.', ['na']).kind).toBe('text');
  });

  it('leaves -99 as a number until a missing-code transformation says otherwise', () => {
    const col = one(['-99', '3']);
    expect(col.kind).toBe('numeric');
    if (col.kind === 'numeric') expect(Array.from(col.values)).toEqual([-99, 3]);
  });

  it('types a parsed decimal-comma file end to end', () => {
    const { table, report } = parseCsv('x;y\n7,25;1,5\n3;2,75\n');
    const cols = typeColumns(table, { decimal: report.decimal });
    expect(cols.map((c) => c.kind)).toEqual(['numeric', 'numeric']);
    if (cols[0]?.kind === 'numeric') expect(Array.from(cols[0].values)).toEqual([7.25, 3]);
  });
});
