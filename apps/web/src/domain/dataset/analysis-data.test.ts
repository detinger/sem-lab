import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SemModel } from '@sem-studio/contracts';
import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from './analysis-data';
import { createDataset, isDatasetError } from './transform';
import type { Dataset } from './types';

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
const readJson = (...p: string[]): unknown =>
  JSON.parse(readFileSync(join(SYNTHETIC, ...p), 'utf8'));
const loadModel = (id: string): SemModel => SemModel.parse(readJson(id, 'model.json'));

async function loadData(id: string, text?: string): Promise<Dataset> {
  const r = await createDataset(text ?? readFileSync(join(SYNTHETIC, id, 'data.csv'), 'utf8'), {
    name: id,
    source: { kind: 'bundled', exampleId: id },
    id: 'd',
    importedAt: '2026-11-19T00:00:00Z',
  });
  if (isDatasetError(r)) throw new Error(r.error.message);
  return r;
}

describe('buildAnalysisData', () => {
  it('listwise on missing-mcar keeps exactly the complete rows from the manifest', async () => {
    const manifest = readJson('missing-mcar', 'manifest.json') as { completeRows: number };
    const ds = await loadData('missing-mcar');
    const r = buildAnalysisData(loadModel('missing-mcar'), ds, 'listwise');
    if ('error' in r) throw new Error(r.error.message);
    expect(r.columns).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8']);
    expect(r).toMatchObject({ nRows: 500, nUsed: manifest.completeRows, nDropped: 500 - 258 });
    expect(r.rows).toHaveLength(258);
    expect(r.rows.flat().every((v) => Number.isFinite(v))).toBe(true);
    // the kept rows are exactly the rows with no empty field, in order
    const lines = readFileSync(join(SYNTHETIC, 'missing-mcar', 'data.csv'), 'utf8')
      .trim()
      .split('\n')
      .slice(1)
      .filter((l) => !l.split(',').includes(''));
    expect(r.rows.map((row) => row.join(','))).toEqual(
      lines.map((l) => l.split(',').map(Number).join(',')),
    );
  });

  it('fiml keeps every row with missing cells as null, never NaN', async () => {
    const ds = await loadData('missing-mcar');
    const r = buildAnalysisData(loadModel('missing-mcar'), ds, 'fiml');
    if ('error' in r) throw new Error(r.error.message);
    expect(r).toMatchObject({ missingData: 'fiml', nRows: 500, nUsed: 500, nDropped: 0 });
    const cells = r.rows.flat();
    expect(cells.filter((v) => v === null)).toHaveLength(306);
    expect(cells.some((v) => typeof v === 'number' && Number.isNaN(v))).toBe(false);
  });

  it('fiml drops rows with no observed analysis value', async () => {
    const ds = await loadData('m', 'a,b\n1,2\n,\n3,\n4,5\n');
    const m: SemModel = {
      constructs: [{ id: 'c', name: 'C', measurement: 'reflective', indicatorIds: ['ia', 'ib'] }],
      indicators: [
        { id: 'ia', name: 'a', column: 'a' },
        { id: 'ib', name: 'b', column: 'b' },
      ],
      relationships: [],
    };
    const r = buildAnalysisData(m, ds, 'fiml');
    expect('error' in r ? r.error : r.rows).toEqual([
      [1, 2],
      [3, null],
      [4, 5],
    ]);
  });

  it('broken-mapping names exactly the missing columns ["pu5", "bi_4"]', async () => {
    const ds = await loadData('tam-mediation');
    const r = buildAnalysisData(loadModel('broken-mapping'), ds, 'listwise');
    expect('error' in r && r.error).toMatchObject({
      code: 'DATA_COLUMN_MISSING',
      columns: ['pu5', 'bi_4'],
      indicatorIds: ['i_pu4', 'i_bi3'],
    });
  });

  it('applies reverse scoring from the indicator scale, so the raw column can be used', async () => {
    const ds = await loadData('pls-two-construct');
    const base = loadModel('pls-two-construct');
    const m: SemModel = {
      ...base,
      indicators: base.indicators.map((i) => (i.id === 'i_x3' ? { ...i, reverseScored: true } : i)),
    };
    const r = buildAnalysisData(m, ds, 'listwise');
    if ('error' in r) throw new Error(r.error.message);
    expect(r.columns).toEqual(['x1', 'x2', 'x3', 'y1', 'y2', 'y3']);
    const rev = ds.columns.find((c) => c.name === 'x3_rev');
    if (rev?.kind !== 'numeric') throw new Error();
    expect(r.rows.map((row) => row[2])).toEqual(Array.from(rev.values));
  });

  it('refuses reverse scoring without a scale, with DATA_SCALE_MISSING', async () => {
    const ds = await loadData('pls-two-construct');
    const base = loadModel('pls-two-construct');
    const m: SemModel = {
      ...base,
      indicators: base.indicators.map((i) => {
        if (i.id !== 'i_x3') return i;
        const { scale: _scale, ...rest } = i;
        return { ...rest, reverseScored: true };
      }),
    };
    const r = buildAnalysisData(m, ds, 'listwise');
    expect('error' in r && r.error).toMatchObject({
      code: 'DATA_SCALE_MISSING',
      columns: ['x3'],
      indicatorIds: ['i_x3'],
    });
  });

  it('refuses text columns, unmapped indicators and too few rows', async () => {
    const ds = await loadData('m', 'a,b\n1,x\n2,3\n');
    const m = (cols: (string | null)[]): SemModel => ({
      constructs: [
        {
          id: 'c',
          name: 'C',
          measurement: 'reflective',
          indicatorIds: cols.map((_, i) => `i${i}`),
        },
      ],
      indicators: cols.map((column, i) => ({ id: `i${i}`, name: `n${i}`, column })),
      relationships: [],
    });
    const err = (r: ReturnType<typeof buildAnalysisData>) => ('error' in r ? r.error : null);
    expect(err(buildAnalysisData(m(['a', 'b']), ds, 'listwise'))).toMatchObject({
      code: 'DATA_NOT_NUMERIC',
      columns: ['b'],
    });
    expect(err(buildAnalysisData(m(['a', null]), ds, 'listwise'))).toMatchObject({
      code: 'DATA_INDICATOR_UNMAPPED',
      indicatorIds: ['i1'],
    });
    expect(err(buildAnalysisData(m(['a']), ds, 'listwise'))).toMatchObject({
      code: 'DATA_INSUFFICIENT_ROWS',
    });
  });

  it('uses only indicators in a construct, in construct then block order, each column once', async () => {
    const ds = await loadData('m', 'a,b,c,d\n1,2,3,4\n2,3,4,5\n3,4,5,7\n');
    const m: SemModel = {
      constructs: [
        { id: 'c1', name: 'C1', measurement: 'reflective', indicatorIds: ['ic', 'ia'] },
        { id: 'c2', name: 'C2', measurement: 'reflective', indicatorIds: ['ib', 'ia2'] },
      ],
      indicators: [
        { id: 'ia', name: 'a', column: 'a' },
        { id: 'ia2', name: 'a again', column: 'a' },
        { id: 'ib', name: 'b', column: 'b' },
        { id: 'ic', name: 'c', column: 'c' },
        { id: 'id', name: 'd', column: 'd' },
      ],
      relationships: [],
    };
    const r = buildAnalysisData(m, ds, 'listwise');
    expect('error' in r ? r.error : r.columns).toEqual(['c', 'a', 'b']);
  });
});
