import { describe, expect, it } from 'vitest';
import { parseCsv } from './parse';
import type { ParseIssue } from './types';

const codes = (issues: ParseIssue[]) => issues.map((i) => `${i.code}:${i.severity}`);

describe('parseCsv', () => {
  it('reads a TAM-style semicolon file and keeps 12-decimal numbers as exact text', () => {
    const text =
      'USEF1;USEF2;EOU1\r\n7.000000000000;6.000000000000;1.250000000000\r\n5.000000000000;4.000000000000;3.000000000000\r\n';
    const { table, report } = parseCsv(text);
    expect(report).toMatchObject({
      bom: false,
      delimiter: ';',
      delimiterDetected: true,
      decimal: '.',
      decimalDetected: true,
      rowCount: 2,
      columnCount: 3,
      issues: [],
    });
    expect(table.columns).toEqual(['USEF1', 'USEF2', 'EOU1']);
    expect(table.rows[0]).toEqual(['7.000000000000', '6.000000000000', '1.250000000000']);
  });

  it('strips a BOM and keeps a quoted delimiter and a quoted newline inside one cell', () => {
    const text = '﻿x;y\n"a;b\nc";2\n3;4\n';
    const { table, report } = parseCsv(text);
    expect(report.bom).toBe(true);
    expect(report.delimiter).toBe(';');
    expect(table.columns).toEqual(['x', 'y']);
    expect(table.rows).toEqual([
      ['a;b\nc', '2'],
      ['3', '4'],
    ]);
    expect(report.issues).toEqual([]);
  });

  it('detects a decimal comma with a semicolon delimiter and lets the user override it', () => {
    const text = 'x;y\n7,25;1,5\n3;2,75\n';
    const auto = parseCsv(text);
    expect(auto.report.delimiter).toBe(';');
    expect(auto.report.decimal).toBe(',');
    expect(auto.report.decimalDetected).toBe(true);
    expect(codes(auto.report.issues)).toEqual(['DECIMAL_COMMA_ASSUMED:info']);
    expect(auto.table.rows[0]).toEqual(['7,25', '1,5']);

    const forced = parseCsv(text, { decimal: '.' });
    expect(forced.report.decimal).toBe('.');
    expect(forced.report.decimalDetected).toBe(false);
    expect(forced.report.issues).toEqual([]);
  });

  it.each([
    ['thousands with both marks', 'x;y\n1.234,5;2\n3;4\n'],
    ['comma and point in the same file', 'x;y\n7,25;1.5\n3;4\n'],
    ['only three-digit comma groups', 'x;y\n1,234;2\n3,500;4\n'],
  ])('does not guess the decimal mark for %s', (_label, text) => {
    const { report } = parseCsv(text);
    expect(report.decimal).toBe('.');
    expect(codes(report.issues)).toEqual(['DECIMAL_MARK_AMBIGUOUS:warning']);
  });

  it('never assumes a decimal comma in a comma-delimited file', () => {
    const { report } = parseCsv('x,y\n"7,25",1\n');
    expect(report.decimal).toBe('.');
    expect(report.issues).toEqual([]);
  });

  it('detects tab and pipe delimiters, and honours a forced delimiter', () => {
    expect(parseCsv('a\tb\n1\t2\n').report.delimiter).toBe('\t');
    expect(parseCsv('a|b\n1|2\n').report.delimiter).toBe('|');
    const forced = parseCsv('a;b\n1;2\n', { delimiter: ',' });
    expect(forced.report.delimiterDetected).toBe(false);
    expect(forced.table.columns).toEqual(['a;b']);
  });

  it('reports an ambiguous delimiter and keeps the priority order', () => {
    const { report, table } = parseCsv('a,b;c\n1,2;3\n');
    expect(report.delimiter).toBe(',');
    expect(codes(report.issues)).toContain('AMBIGUOUS_DELIMITER:warning');
    expect(table.columns).toEqual(['a', 'b;c']);
  });

  it('treats a file whose header does not split as a single column', () => {
    const { report, table } = parseCsv('score\n1\n\n3\n');
    expect(report.columnCount).toBe(1);
    // In a one-column file a blank line is a missing value, not a skipped line.
    expect(table.rows).toEqual([['1'], [''], ['3']]);
  });

  it('lists ragged rows: short rows are padded (warning), long rows are an error', () => {
    const text = 'a,b,c\n1,2,3\n4,5\n6,7,8,9\n10,11,12,,\n';
    const { table, report } = parseCsv(text);
    const ragged = report.issues.filter((i) => i.code === 'RAGGED_ROW');
    expect(ragged.map((i) => [i.severity, i.rows])).toEqual([
      ['error', [3]],
      ['warning', [2]],
      ['warning', [4]],
    ]);
    expect(table.rows[1]).toEqual(['4', '5', '']);
    expect(table.rows.every((r) => r.length === 3)).toBe(true);
  });

  it('skips blank lines between records of a multi-column file', () => {
    const { table, report } = parseCsv('a,b\n1,2\n\n3,4\n');
    expect(table.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(report.issues).toEqual([]);
  });

  it('names duplicate and empty header names as errors', () => {
    const { report } = parseCsv('x,y,x, ,z\n1,2,3,4,5\n');
    const dup = report.issues.find((i) => i.code === 'DUPLICATE_COLUMN_NAME');
    expect(dup).toMatchObject({ severity: 'error', column: 'x' });
    expect(dup?.message).toContain('columns 1, 3');
    const empty = report.issues.find((i) => i.code === 'EMPTY_COLUMN_NAME');
    expect(empty?.severity).toBe('error');
    expect(empty?.message).toContain('4');
  });

  it('warns when the first row looks like data', () => {
    expect(codes(parseCsv('1,2\n3,4\n').report.issues)).toEqual(['NO_HEADER:warning']);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '  \n\n'],
    ['BOM only', '﻿'],
  ])('refuses an %s file', (_label, text) => {
    const { table, report } = parseCsv(text);
    expect(codes(report.issues)).toEqual(['EMPTY_FILE:error']);
    expect(table).toEqual({ columns: [], rows: [] });
  });

  it('reports an unclosed quote', () => {
    const { report } = parseCsv('a,b\n1,"2\n3,4\n');
    expect(codes(report.issues)).toContain('MALFORMED_QUOTES:error');
  });

  it('keeps missing-value tokens such as NA as text cells (typing decides)', () => {
    const { table } = parseCsv('a,b\nNA,2\n-99,\n');
    expect(table.rows).toEqual([
      ['NA', '2'],
      ['-99', ''],
    ]);
  });

  it('refuses files above the size limit, which is a parameter', () => {
    const text = `a,b\n${'1,2\n'.repeat(100)}`;
    expect(codes(parseCsv(text, { maxBytes: 100 }).report.issues)).toEqual(['TOO_LARGE:error']);
    expect(parseCsv(text, { maxBytes: 10_000 }).report.issues).toEqual([]);
    // multi-byte characters count as UTF-8 bytes
    expect(codes(parseCsv('ä,ö\n1,2\n', { maxBytes: 9 }).report.issues)).toEqual([
      'TOO_LARGE:error',
    ]);
  });
});
