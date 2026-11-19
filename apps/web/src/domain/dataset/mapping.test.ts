import type { SemModel } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { applyMapping, normalizeName, suggestMapping } from './mapping';

const model = (names: string[]): SemModel => ({
  constructs: [],
  indicators: names.map((name, i) => ({ id: `i${i}`, name, column: null })),
  relationships: [],
});

const pick = (s: ReturnType<typeof suggestMapping>) => s.map((x) => [x.column, x.match]);

describe('suggestMapping', () => {
  it('prefers exact, then case-insensitive, then normalized matches', () => {
    const s = suggestMapping(model(['x1', 'Pu1', 'USEF_1', 'none']), [
      'usef1',
      'pu1',
      'x1',
      'other',
    ]);
    expect(pick(s)).toEqual([
      ['x1', 'exact'],
      ['pu1', 'case-insensitive'],
      ['usef1', 'normalized'],
      [null, 'none'],
    ]);
    expect(s.map((x) => x.indicatorId)).toEqual(['i0', 'i1', 'i2', 'i3']);
  });

  it('normalizes case, punctuation and compatibility forms', () => {
    expect(normalizeName('USEF_1')).toBe('usef1');
    expect(normalizeName('EOU-2 (rev)')).toBe('eou2rev');
    expect(normalizeName('ｘ１')).toBe('x1');
  });

  it('gives no suggestion when an indicator matches several columns', () => {
    expect(pick(suggestMapping(model(['usef1']), ['USEF1', 'Usef1']))).toEqual([[null, 'none']]);
    expect(pick(suggestMapping(model(['usef1']), ['USEF_1', 'usef-1']))).toEqual([[null, 'none']]);
  });

  it('never maps two indicators to one column', () => {
    // two indicators normalise to the same column: both ambiguous
    expect(pick(suggestMapping(model(['bi_1', 'BI-1']), ['bi1']))).toEqual([
      [null, 'none'],
      [null, 'none'],
    ]);
    // an exact match claims the column first; the weaker candidate gets nothing
    expect(pick(suggestMapping(model(['X1', 'x1']), ['x1']))).toEqual([
      [null, 'none'],
      ['x1', 'exact'],
    ]);
    const s = suggestMapping(model(['a', 'A', 'a_', 'b']), ['a', 'A', 'b']);
    const cols = s.map((x) => x.column).filter((c) => c !== null);
    expect(new Set(cols).size).toBe(cols.length);
  });
});

describe('applyMapping', () => {
  it('returns a new model with columns set only for real suggestions', () => {
    const m: SemModel = {
      ...model(['x1', 'zz']),
      indicators: [
        { id: 'i0', name: 'x1', column: null },
        { id: 'i1', name: 'zz', column: 'kept' },
      ],
    };
    const next = applyMapping(m, suggestMapping(m, ['x1']));
    expect(next.indicators).toEqual([
      { id: 'i0', name: 'x1', column: 'x1' },
      { id: 'i1', name: 'zz', column: 'kept' },
    ]);
    expect(m.indicators[0]!.column).toBeNull();
    expect(next).not.toBe(m);
  });
});
