import { describe, expect, it } from 'vitest';
import { analysisCsv } from './analysis-csv';

describe('analysisCsv', () => {
  it('writes RFC 4180 with quoted headers and "." decimals', () => {
    const data = {
      columns: ['x1', 'odd,name'],
      rows: [
        [1, 2.5],
        [3, 4],
      ],
      nRows: 3,
      nUsed: 2,
      nDropped: 1,
      missingData: 'listwise' as const,
    };
    expect(analysisCsv(data)).toBe('x1,"odd,name"\n1,2.5\n3,4\n');
  });

  it('writes a missing value (FIML) as an empty field', () => {
    const data = {
      columns: ['a', 'b'],
      rows: [
        [1, null],
        [null, 2],
      ],
      nRows: 2,
      nUsed: 2,
      nDropped: 0,
      missingData: 'fiml' as const,
    };
    expect(analysisCsv(data)).toBe('a,b\n1,\n,2\n');
  });
});
