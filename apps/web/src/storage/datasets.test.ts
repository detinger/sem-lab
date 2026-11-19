import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatasetRef, SemProject } from '@sem-studio/contracts';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { ACSI_ATTRIBUTION } from '../domain/dataset/bundled';
import { createDataset, isDatasetError, withTransformations } from '../domain/dataset/transform';
import type { Dataset } from '../domain/dataset/types';
import { deleteDataset, listDatasets, loadDataset, saveDataset, toDatasetRef } from './datasets';
import { DB_NAME, getDb, loadProject, resetDbForTests } from './projects';

const example = SemProject.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'packages',
        'contracts',
        'examples',
        'valid',
        'project.tam-v1.json',
      ),
      'utf8',
    ),
  ),
);

async function make(text: string, id: string, importedAt: string): Promise<Dataset> {
  const r = await createDataset(text, {
    name: `data ${id}`,
    source: { kind: 'file', fileName: `${id}.csv` },
    id,
    importedAt,
  });
  if (isDatasetError(r)) throw new Error(r.error.message);
  return r;
}

afterEach(async () => {
  resetDbForTests();
  await Dexie.delete(DB_NAME);
});

describe('IndexedDB dataset store', () => {
  it('round-trips a dataset, recomputing columns from the stored original', async () => {
    const base = await make('a;b;t\n1,5;-99;x\n2;3;y\n4;5;z\n', 'd1', '2026-01-01T00:00:00Z');
    const ds = await withTransformations(base, [
      { kind: 'missing-code', column: 'b', code: -99 },
      { kind: 'reverse', column: 'b', scale: { min: 1, max: 5 }, as: 'b_r' },
    ]);
    if (isDatasetError(ds)) throw new Error();
    await saveDataset(ds);

    const stored = await getDb().datasets.get('d1');
    expect(stored).toBeDefined();
    // typed columns, row index and NaN-bearing arrays are never stored; only counts
    expect(stored).not.toHaveProperty('rowIndex');
    expect(typeof stored!.columns).toBe('number');
    expect(stored!.original).toEqual(ds.original);

    const back = await loadDataset('d1');
    expect(back).toEqual(ds);
    expect(back!.fingerprint).toBe(ds.fingerprint);
  });

  it('lists metadata only, newest first, and deletes', async () => {
    await saveDataset(await make('a\n1\n2\n', 'old', '2026-01-01T00:00:00Z'));
    await saveDataset(await make('a,b\n1,2\n', 'new', '2026-06-01T00:00:00Z'));
    const list = await listDatasets();
    expect(list).toEqual([
      expect.objectContaining({ id: 'new', name: 'data new', rows: 1, columns: 2 }),
      expect.objectContaining({ id: 'old', rows: 2, columns: 1 }),
    ]);
    for (const item of list) {
      expect(Object.keys(item).sort()).toEqual(
        ['columns', 'fingerprint', 'id', 'importedAt', 'name', 'rows', 'source'].sort(),
      );
    }
    await deleteDataset('old');
    expect(await loadDataset('old')).toBeUndefined();
    expect((await listDatasets()).map((d) => d.id)).toEqual(['new']);
  });

  it('upgrades a version-1 database (projects only) without losing projects', async () => {
    const v1 = new Dexie(DB_NAME);
    v1.version(1).stores({ projects: 'id, updatedAt, name' });
    await v1.table('projects').put({
      id: example.id,
      name: example.name,
      updatedAt: example.updatedAt,
      constructCount: example.model.constructs.length,
      indicatorCount: example.model.indicators.length,
      project: example,
    });
    v1.close();

    expect(await loadProject(example.id)).toEqual(example);
    expect(getDb().verno).toBe(3);
    await saveDataset(await make('a\n1\n', 'd2', '2026-01-01T00:00:00Z'));
    expect((await listDatasets()).map((d) => d.id)).toEqual(['d2']);
  });
});

describe('toDatasetRef', () => {
  it('carries fingerprint and schema only — no row values — and validates as a contract', async () => {
    const ds = await make('a,t,e\n1,secret-1,\n3,secret-2,\n', 'd', '2026-01-01T00:00:00Z');
    const ref = toDatasetRef(ds);
    expect(DatasetRef.parse(ref)).toEqual(ref);
    expect(ref).toEqual({
      fingerprint: ds.fingerprint,
      importedAt: '2026-01-01T00:00:00Z',
      rowCount: 2,
      source: 'd.csv',
      columns: [
        { name: 'a', type: 'numeric', nMissing: 0, nUnique: 2, observedMin: 1, observedMax: 3 },
        { name: 't', type: 'text', nMissing: 0, nUnique: 2, observedMin: null, observedMax: null },
        { name: 'e', type: 'empty', nMissing: 2, nUnique: 0, observedMin: null, observedMax: null },
      ],
    });
    expect(JSON.stringify(ref)).not.toContain('secret');
  });

  it('labels bundled data with their provenance', async () => {
    const r = await createDataset('x\n1\n', {
      name: 'ACSI',
      source: { kind: 'bundled', exampleId: 'acsi-2015' },
    });
    if (isDatasetError(r)) throw new Error();
    expect(toDatasetRef(r)).toMatchObject({
      source: 'bundled example: acsi-2015',
      provenance: { synthetic: false, licence: 'CC BY 4.0', attribution: ACSI_ATTRIBUTION },
    });
  });
});
