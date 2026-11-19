/**
 * Build the numeric matrix one analysis runs on (PLAN §2.2 step 9: the missing-data method is
 * chosen explicitly and nothing is ever imputed).
 *
 * Columns: the bound columns of every indicator that belongs to at least one construct, in
 * model order (constructs, then block order), each column once.
 * Reverse scoring: an indicator with `reverseScored: true` gets min + max − x using its
 * ORIGINAL scale endpoints, so a model can point at the raw column.
 * Missing data:
 *  - 'listwise' drops every row with a missing value in any analysis column;
 *  - 'fiml' keeps rows with partial data (missing cells are `null`, never NaN) and drops only
 *    rows with no observed value in any analysis column, which carry no information.
 * Errors name columns and indicators, never cell values.
 */
import type { SemIndicator, SemModel } from '@sem-lab/contracts';
import type { AnalysisData, Dataset, DatasetColumn } from './types';

export type AnalysisDataErrorCode =
  | 'DATA_INDICATOR_UNMAPPED'
  | 'DATA_COLUMN_MISSING'
  | 'DATA_SCALE_MISSING'
  | 'DATA_REVERSE_CONFLICT'
  | 'DATA_NOT_NUMERIC'
  | 'DATA_OUT_OF_SCALE'
  | 'DATA_INSUFFICIENT_ROWS';

export interface AnalysisDataError {
  code: AnalysisDataErrorCode;
  /** dataset column names concerned (for DATA_INDICATOR_UNMAPPED: empty) */
  columns: string[];
  /** indicator ids concerned, where indicators rather than columns are at fault */
  indicatorIds?: string[];
  message: string;
}

/** Fewer usable rows than this cannot give even one correlation. */
export const MIN_ANALYSIS_ROWS = 3;

interface Binding {
  column: string;
  reverse: { min: number; max: number } | null;
  indicatorIds: string[];
}

export function analysisIndicators(model: SemModel): SemIndicator[] {
  const byId = new Map(model.indicators.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: SemIndicator[] = [];
  for (const c of model.constructs) {
    for (const id of c.indicatorIds) {
      const ind = byId.get(id);
      if (ind && !seen.has(id)) {
        seen.add(id);
        out.push(ind);
      }
    }
  }
  return out;
}

export function buildAnalysisData(
  model: SemModel,
  dataset: Pick<Dataset, 'columns' | 'rowIndex'>,
  missingData: 'listwise' | 'fiml',
): AnalysisData | { error: AnalysisDataError } {
  const indicators = analysisIndicators(model);
  const fail = (e: AnalysisDataError): { error: AnalysisDataError } => ({ error: e });

  const unmapped = indicators.filter((i) => i.column === null);
  if (unmapped.length > 0) {
    return fail({
      code: 'DATA_INDICATOR_UNMAPPED',
      columns: [],
      indicatorIds: unmapped.map((i) => i.id),
      message: `${unmapped.length === 1 ? 'Indicator' : 'Indicators'} ${unmapped.map((i) => `"${i.name}"`).join(', ')} ${unmapped.length === 1 ? 'is' : 'are'} not mapped to a data column.`,
    });
  }

  const byName = new Map(dataset.columns.map((c) => [c.name, c]));
  const missing = unique(indicators.map((i) => i.column as string).filter((c) => !byName.has(c)));
  if (missing.length > 0) {
    return fail({
      code: 'DATA_COLUMN_MISSING',
      columns: missing,
      indicatorIds: indicators.filter((i) => missing.includes(i.column as string)).map((i) => i.id),
      message: `The data have no column${missing.length === 1 ? '' : 's'} ${missing.map((c) => `"${c}"`).join(', ')}.`,
    });
  }

  const noScale = indicators.filter((i) => i.reverseScored === true && i.scale === undefined);
  if (noScale.length > 0) {
    return fail({
      code: 'DATA_SCALE_MISSING',
      columns: unique(noScale.map((i) => i.column as string)),
      indicatorIds: noScale.map((i) => i.id),
      message: `Reverse scoring needs the original scale endpoints (minimum and maximum) of ${noScale.map((i) => `"${i.name}"`).join(', ')}.`,
    });
  }

  // One analysis column per bound data column; all indicators bound to it must agree on reversal.
  const bindings: Binding[] = [];
  const conflicts: string[] = [];
  for (const ind of indicators) {
    const column = ind.column as string;
    const reverse = ind.reverseScored === true && ind.scale ? { ...ind.scale } : null;
    const existing = bindings.find((b) => b.column === column);
    if (!existing) {
      bindings.push({ column, reverse, indicatorIds: [ind.id] });
    } else {
      existing.indicatorIds.push(ind.id);
      if (!sameReverse(existing.reverse, reverse) && !conflicts.includes(column))
        conflicts.push(column);
    }
  }
  if (conflicts.length > 0) {
    return fail({
      code: 'DATA_REVERSE_CONFLICT',
      columns: conflicts,
      message: `Indicators bound to the same column disagree on reverse scoring or scale: ${conflicts.map((c) => `"${c}"`).join(', ')}.`,
    });
  }

  const nonNumeric = bindings.filter((b) => byName.get(b.column)?.kind !== 'numeric');
  if (nonNumeric.length > 0) {
    return fail({
      code: 'DATA_NOT_NUMERIC',
      columns: nonNumeric.map((b) => b.column),
      message: `${nonNumeric.length === 1 ? 'Column' : 'Columns'} ${nonNumeric.map((b) => `"${b.column}" (${byName.get(b.column)?.kind})`).join(', ')} ${nonNumeric.length === 1 ? 'is' : 'are'} not numeric. Fix the data or the missing-value tokens in the Data Lab.`,
    });
  }

  const values = bindings.map(
    (b) => (byName.get(b.column) as Extract<DatasetColumn, { kind: 'numeric' }>).values,
  );
  const outOfScale = bindings.filter((b, j) => {
    if (!b.reverse) return false;
    const { min, max } = b.reverse;
    return (values[j] as Float64Array).some((v) => !Number.isNaN(v) && (v < min || v > max));
  });
  if (outOfScale.length > 0) {
    return fail({
      code: 'DATA_OUT_OF_SCALE',
      columns: outOfScale.map((b) => b.column),
      message: `Reverse-scored ${outOfScale.length === 1 ? 'column' : 'columns'} ${outOfScale.map((b) => `"${b.column}"`).join(', ')} ${outOfScale.length === 1 ? 'has' : 'have'} values outside the stated scale endpoints; check the scale or the data.`,
    });
  }

  const nRows = dataset.rowIndex.length;
  const full: (number | null)[][] = [];
  const complete: number[][] = [];
  for (let i = 0; i < nRows; i++) {
    const row: (number | null)[] = [];
    let observed = 0;
    for (let j = 0; j < bindings.length; j++) {
      const v = (values[j] as Float64Array)[i] as number;
      if (Number.isNaN(v)) {
        row.push(null);
        continue;
      }
      observed++;
      const rev = (bindings[j] as Binding).reverse;
      row.push(rev ? rev.min + rev.max - v : v);
    }
    if (observed === bindings.length) complete.push(row as number[]);
    if (observed > 0) full.push(row);
  }

  const columns = bindings.map((b) => b.column);
  const nUsed = missingData === 'listwise' ? complete.length : full.length;
  if (nUsed < MIN_ANALYSIS_ROWS) {
    return fail({
      code: 'DATA_INSUFFICIENT_ROWS',
      columns,
      message: `Only ${nUsed} usable row${nUsed === 1 ? '' : 's'} remain${nUsed === 1 ? 's' : ''} after ${missingData === 'listwise' ? 'listwise deletion' : 'removing rows without any observed value'}; at least ${MIN_ANALYSIS_ROWS} are needed.`,
    });
  }
  const base = { columns, nRows, nUsed, nDropped: nRows - nUsed };
  return missingData === 'listwise'
    ? { ...base, missingData, rows: complete }
    : { ...base, missingData, rows: full };
}

function sameReverse(
  a: { min: number; max: number } | null,
  b: { min: number; max: number } | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.min === b.min && a.max === b.max;
}

function unique(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}
