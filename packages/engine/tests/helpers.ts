/**
 * Test helpers: read fixtures and build the analysis matrix exactly as the web app does
 * (apps/web/src/domain/dataset/analysis-data.ts): one column per bound data column of every
 * indicator that belongs to a construct, in model order; reverse scoring min + max − x first;
 * listwise deletion.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AnalysisConfiguration, NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import type { AnalysisDataInput } from '../src/pls/spec.ts';

export const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export interface Csv {
  header: string[];
  rows: (number | null)[][];
}

export function readCsv(path: string): Csv {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]!.split(',').map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((l) =>
    l.split(',').map((c) => {
      const t = c.trim().replace(/^"|"$/g, '');
      if (t === '' || t === 'NA') return null;
      const v = Number(t);
      return Number.isFinite(v) ? v : null;
    }),
  );
  return { header, rows };
}

/** buildAnalysisData(model, dataset, 'listwise') for a parsed CSV. */
export function analysisData(model: SemModel, csv: Csv): AnalysisDataInput {
  const byId = new Map(model.indicators.map((i) => [i.id, i]));
  const bindings: { column: string; reverse: { min: number; max: number } | null }[] = [];
  for (const c of model.constructs) {
    for (const id of c.indicatorIds) {
      const ind = byId.get(id)!;
      const column = ind.column!;
      if (bindings.some((b) => b.column === column)) continue;
      bindings.push({
        column,
        reverse: ind.reverseScored === true && ind.scale ? { ...ind.scale } : null,
      });
    }
  }
  const idx = bindings.map((b) => csv.header.indexOf(b.column));
  const rows: number[][] = [];
  for (const r of csv.rows) {
    const row: number[] = [];
    let complete = true;
    bindings.forEach((b, j) => {
      const v = r[idx[j]!];
      if (v === null || v === undefined) {
        complete = false;
        return;
      }
      row.push(b.reverse ? b.reverse.min + b.reverse.max - v : v);
    });
    if (complete) rows.push(row);
  }
  return {
    columns: bindings.map((b) => b.column),
    rows,
    nRows: csv.rows.length,
    nDropped: csv.rows.length - rows.length,
  };
}

export interface ReferenceFile {
  request: { model: SemModel; analysis: AnalysisConfiguration };
  response: { ok: true; result: NormalizedSemResult } | { ok: false; error: { code: string } };
}

export function caseOf(file: string): string {
  return file.split('__')[0]!;
}

export function loadCase(caseName: string): { model: SemModel; csv: Csv } {
  return {
    model: readJson<SemModel>(`${FIXTURES}synthetic/${caseName}/model.json`),
    csv: readCsv(`${FIXTURES}synthetic/${caseName}/data.csv`),
  };
}
