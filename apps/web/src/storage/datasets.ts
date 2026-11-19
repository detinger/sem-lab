/**
 * Local-first dataset storage (PLAN §2.2 "Data privacy and storage").
 *
 * Datasets live only in this browser's IndexedDB ('sem-studio' database, `datasets` table,
 * schema version 2 — declared in projects.ts, which owns the connection). What is stored is
 * the immutable ORIGINAL table, the resolved parse options and the transformation log; typed
 * columns and the fingerprint are recomputed on load, so a stored dataset can never disagree
 * with its original.
 *
 * A project file may contain only `toDatasetRef(dataset)`: fingerprint and column schema,
 * no row-level values.
 */
import { DatasetRef } from '@sem-studio/contracts';
import { bundledDatasetInfo } from '../domain/dataset/bundled';
import { profileColumn } from '../domain/dataset/stats';
import { buildDataset } from '../domain/dataset/transform';
import type { Dataset, ParseReport, RawTable, Transformation } from '../domain/dataset/types';
import { getDb } from './projects';

export interface StoredDataset {
  id: string;
  /** layout version of this record (not the IndexedDB schema version) */
  recordVersion: 1;
  name: string;
  importedAt: string;
  /** fingerprint at save time (indexed; recomputed on load) */
  fingerprint: string;
  rows: number;
  columns: number;
  source: Dataset['source'];
  parseOptions: Dataset['parseOptions'];
  parse: ParseReport;
  original: RawTable;
  transformations: Transformation[];
}

export interface DatasetListItem {
  id: string;
  name: string;
  /** working rows and columns (after transformations) */
  rows: number;
  columns: number;
  fingerprint: string;
  importedAt: string;
  source: Dataset['source'];
}

export async function saveDataset(dataset: Dataset): Promise<void> {
  const record: StoredDataset = {
    id: dataset.id,
    recordVersion: 1,
    name: dataset.name,
    importedAt: dataset.importedAt,
    fingerprint: dataset.fingerprint,
    rows: dataset.rowIndex.length,
    columns: dataset.columns.length,
    source: dataset.source,
    parseOptions: dataset.parseOptions,
    parse: dataset.parse,
    original: dataset.original,
    transformations: dataset.transformations,
  };
  await getDb().datasets.put(record);
}

/** Rebuild a stored dataset from its original. Throws if the stored log no longer applies. */
export async function loadDataset(id: string): Promise<Dataset | undefined> {
  const row = await getDb().datasets.get(id);
  if (!row) return undefined;
  const built = await buildDataset({
    id: row.id,
    name: row.name,
    source: row.source,
    importedAt: row.importedAt,
    parseOptions: row.parseOptions,
    parse: row.parse,
    original: row.original,
    transformations: row.transformations,
  });
  if ('error' in built) {
    throw new Error(
      `Stored dataset "${row.name}" could not be rebuilt: ${built.error.code} (transformation ${built.error.transform?.index ?? '?'}).`,
    );
  }
  return built;
}

/** Metadata only, newest import first. */
export async function listDatasets(): Promise<DatasetListItem[]> {
  const rows = await getDb().datasets.orderBy('importedAt').reverse().toArray();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    rows: r.rows,
    columns: r.columns,
    fingerprint: r.fingerprint,
    importedAt: r.importedAt,
    source: r.source,
  }));
}

export async function deleteDataset(id: string): Promise<void> {
  await getDb().datasets.delete(id);
}

/** The only description of a dataset a project file may carry: fingerprint and schema. */
export function toDatasetRef(dataset: Dataset): DatasetRef {
  const columns = dataset.columns.map((c) => {
    const p = profileColumn(c);
    return {
      name: c.name,
      type: c.kind,
      nMissing: p.nMissing,
      nUnique: p.nUnique,
      observedMin: p.min,
      observedMax: p.max,
    };
  });
  const bundled =
    dataset.source.kind === 'bundled' ? bundledDatasetInfo(dataset.source.exampleId) : undefined;
  const source =
    dataset.source.kind === 'file'
      ? dataset.source.fileName
      : `bundled example: ${dataset.source.exampleId}`;
  return DatasetRef.parse({
    fingerprint: dataset.fingerprint,
    importedAt: dataset.importedAt,
    rowCount: dataset.rowIndex.length,
    columns,
    source: source.slice(0, 500),
    ...(bundled ? { provenance: bundled.provenance } : {}),
  });
}
