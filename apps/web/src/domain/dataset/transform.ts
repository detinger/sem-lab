/**
 * Documented transformations and Dataset assembly (PLAN §2.2 step 8).
 *
 * The original RawTable is immutable: working columns are always recomputed as
 * typeColumns(original) followed by the transformation log, applied in order. Nothing is
 * clamped, imputed or coerced; a transformation that cannot be applied exactly returns a
 * typed error instead. Error messages name columns and row numbers, never cell values.
 */
import { type DataCell, dataFingerprint } from '@sem-lab/contracts';
import { hasParseErrors, parseCsv, type ParseCsvOptions } from './parse';
import { mean, moments, presentValues, sdSample } from './stats';
import { typeColumns } from './typing';
import {
  DEFAULT_MISSING_TOKENS,
  type Dataset,
  type DatasetColumn,
  type ParseIssue,
  type ParseReport,
  type RawTable,
  type Transformation,
} from './types';

export type TransformErrorCode =
  | 'TRANSFORM_COLUMN_NOT_FOUND'
  | 'TRANSFORM_NOT_NUMERIC'
  | 'TRANSFORM_OUT_OF_RANGE'
  | 'TRANSFORM_INVALID_SCALE'
  | 'TRANSFORM_ZERO_VARIANCE'
  | 'TRANSFORM_NAME_COLLISION'
  | 'TRANSFORM_INVALID_NAME'
  | 'TRANSFORM_ROW_NOT_FOUND';

export interface TransformError {
  code: TransformErrorCode;
  /** 0-based position of the failing transformation in the log */
  index: number;
  column?: string;
  /** 1-based ORIGINAL data row numbers (header excluded), capped at 20 */
  rows?: number[];
  message: string;
}

export interface TransformResult {
  columns: DatasetColumn[];
  /** 0-based original row indexes still present */
  rowIndex: number[];
}

const MAX_LISTED_ROWS = 20;

/**
 * Apply a transformation log to freshly typed ORIGINAL columns. The input columns are not
 * modified; every changed column is a new object with a new value array.
 */
export function applyTransformations(
  typed: readonly DatasetColumn[],
  transformations: readonly Transformation[],
): TransformResult | { error: TransformError } {
  const nOriginal = typed[0] ? columnLength(typed[0]) : 0;
  let columns: DatasetColumn[] = [...typed];
  let rowIndex = Array.from({ length: nOriginal }, (_, i) => i);

  for (const [index, t] of transformations.entries()) {
    const fail = (
      code: TransformErrorCode,
      message: string,
      extra: Partial<TransformError> = {},
    ): { error: TransformError } => ({ error: { code, index, message, ...extra } });

    const find = (name: string): DatasetColumn | undefined => columns.find((c) => c.name === name);
    const requireNumeric = (
      name: string,
    ): { col: Extract<DatasetColumn, { kind: 'numeric' }> } | { error: TransformError } => {
      const col = find(name);
      if (!col)
        return fail('TRANSFORM_COLUMN_NOT_FOUND', `There is no column "${name}".`, {
          column: name,
        });
      if (col.kind !== 'numeric')
        return fail(
          'TRANSFORM_NOT_NUMERIC',
          `Column "${name}" is ${col.kind === 'text' ? 'text' : 'empty'}; this transformation needs a numeric column.`,
          { column: name },
        );
      return { col };
    };
    const checkNewName = (as: string): { error: TransformError } | null => {
      if (as.trim() === '' || as !== as.trim())
        return fail(
          'TRANSFORM_INVALID_NAME',
          'A new column needs a non-empty name without leading or trailing spaces.',
        );
      if (find(as))
        return fail('TRANSFORM_NAME_COLLISION', `A column named "${as}" already exists.`, {
          column: as,
        });
      return null;
    };

    switch (t.kind) {
      case 'missing-code': {
        if (!Number.isFinite(t.code))
          return fail('TRANSFORM_INVALID_SCALE', 'A missing-value code must be a finite number.');
        if (t.column !== '*') {
          const r = requireNumeric(t.column);
          if ('error' in r) return r;
        }
        columns = columns.map((c) =>
          c.kind === 'numeric' && (t.column === '*' || c.name === t.column)
            ? withMissingCode(c, t.code)
            : c,
        );
        break;
      }
      case 'reverse': {
        const { min, max } = t.scale;
        if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max))
          return fail(
            'TRANSFORM_INVALID_SCALE',
            'Reverse scoring needs finite scale endpoints with minimum < maximum.',
            { column: t.column },
          );
        const r = requireNumeric(t.column);
        if ('error' in r) return r;
        const collision = checkNewName(t.as);
        if (collision) return collision;
        const outside: number[] = [];
        r.col.values.forEach((v, i) => {
          if (!Number.isNaN(v) && (v < min || v > max)) outside.push((rowIndex[i] as number) + 1);
        });
        if (outside.length > 0)
          return fail(
            'TRANSFORM_OUT_OF_RANGE',
            `Column "${t.column}" has ${outside.length} value${outside.length === 1 ? '' : 's'} outside the stated scale ${min}–${max}; reverse scoring would produce impossible scores. Fix the scale endpoints or the data (see the listed rows).`,
            { column: t.column, rows: outside.slice(0, MAX_LISTED_ROWS) },
          );
        columns = [
          ...columns,
          {
            name: t.as,
            kind: 'numeric',
            values: r.col.values.map((v) => (Number.isNaN(v) ? NaN : min + max - v)),
            derivedFrom: t.column,
          },
        ];
        break;
      }
      case 'center':
      case 'standardize': {
        const r = requireNumeric(t.column);
        if ('error' in r) return r;
        const collision = checkNewName(t.as);
        if (collision) return collision;
        const xs = presentValues(r.col.values);
        let shift: number;
        let scale = 1;
        if (t.kind === 'center') {
          shift = mean(xs) as number; // a numeric column has ≥ 1 present value
        } else {
          const m = moments(xs);
          const sd = m ? sdSample(m) : null;
          if (!m || sd === null || !(sd > 0))
            return fail(
              'TRANSFORM_ZERO_VARIANCE',
              `Column "${t.column}" cannot be standardized: it needs at least two different values.`,
              { column: t.column },
            );
          shift = m.mean;
          scale = sd;
        }
        columns = [
          ...columns,
          {
            name: t.as,
            kind: 'numeric',
            values: r.col.values.map((v) => (Number.isNaN(v) ? NaN : (v - shift) / scale)),
            derivedFrom: t.column,
          },
        ];
        break;
      }
      case 'drop-column': {
        if (!find(t.column))
          return fail('TRANSFORM_COLUMN_NOT_FOUND', `There is no column "${t.column}".`, {
            column: t.column,
          });
        columns = columns.filter((c) => c.name !== t.column);
        break;
      }
      case 'drop-rows': {
        const bad = t.rows.filter((r) => !Number.isInteger(r) || r < 0 || r >= nOriginal);
        if (bad.length > 0)
          return fail(
            'TRANSFORM_ROW_NOT_FOUND',
            `${bad.length} row index${bad.length === 1 ? ' is' : 'es are'} outside the data (${nOriginal} rows).`,
          );
        const drop = new Set(t.rows);
        const keep = rowIndex.map((orig) => !drop.has(orig));
        rowIndex = rowIndex.filter((_, i) => keep[i]);
        columns = columns.map((c) => filterRows(c, keep));
        break;
      }
    }
  }
  return { columns, rowIndex };
}

function columnLength(c: DatasetColumn): number {
  return c.kind === 'empty' ? c.length : c.values.length;
}

function withMissingCode(
  c: Extract<DatasetColumn, { kind: 'numeric' }>,
  code: number,
): DatasetColumn {
  const values = c.values.map((v) => (v === code ? NaN : v));
  if (values.every((v) => Number.isNaN(v)))
    return { name: c.name, kind: 'empty', length: values.length };
  return { ...c, values };
}

function filterRows(c: DatasetColumn, keep: readonly boolean[]): DatasetColumn {
  switch (c.kind) {
    case 'empty':
      return { ...c, length: keep.filter(Boolean).length };
    case 'numeric':
      return { ...c, values: c.values.filter((_, i) => keep[i] === true) };
    case 'text':
      return { ...c, values: c.values.filter((_, i) => keep[i] === true) };
  }
}

// ---------------------------------------------------------------- fingerprint

/** Cell i of a working column as a contract DataCell (missing → null; never NaN). */
export function cellValue(c: DatasetColumn, i: number): DataCell {
  switch (c.kind) {
    case 'numeric': {
      const v = c.values[i] as number;
      return Number.isNaN(v) ? null : v;
    }
    case 'text':
      return c.values[i] ?? null;
    case 'empty':
      return null;
  }
}

/** contracts `dataFingerprint` of the WORKING table. */
export function fingerprintColumns(
  columns: readonly DatasetColumn[],
  nRows: number,
): Promise<string> {
  const rows: DataCell[][] = [];
  for (let i = 0; i < nRows; i++) rows.push(columns.map((c) => cellValue(c, i)));
  return dataFingerprint(
    columns.map((c) => c.name),
    rows,
  );
}

// ---------------------------------------------------------------- Dataset assembly

export type DatasetErrorCode = 'PARSE_FAILED' | TransformErrorCode;

export interface DatasetError {
  code: DatasetErrorCode;
  message: string;
  /** present for PARSE_FAILED: the error-severity parse issues */
  issues?: ParseIssue[];
  /** present for transformation errors */
  transform?: TransformError;
}

export function isDatasetError<T extends object>(
  r: T | { error: DatasetError },
): r is { error: DatasetError } {
  return 'error' in r;
}

/** Everything a Dataset is rebuilt from (what storage keeps). */
export interface DatasetSource {
  id: string;
  name: string;
  source: Dataset['source'];
  importedAt: string;
  parseOptions: Dataset['parseOptions'];
  parse: ParseReport;
  original: RawTable;
  transformations: Transformation[];
}

/** Recompute typed columns, transformations and fingerprint from the immutable original. */
export async function buildDataset(src: DatasetSource): Promise<Dataset | { error: DatasetError }> {
  const typed = typeColumns(src.original, {
    decimal: src.parseOptions.decimal,
    missingTokens: src.parseOptions.missingTokens,
  });
  const applied = applyTransformations(typed, src.transformations);
  if ('error' in applied) {
    return {
      error: { code: applied.error.code, message: applied.error.message, transform: applied.error },
    };
  }
  return {
    ...src,
    columns: applied.columns,
    rowIndex: applied.rowIndex,
    fingerprint: await fingerprintColumns(applied.columns, applied.rowIndex.length),
  };
}

export interface CreateDatasetInput {
  name: string;
  source: Dataset['source'];
  options?: ParseCsvOptions;
  transformations?: Transformation[];
  /** defaults to crypto.randomUUID() */
  id?: string;
  /** ISO timestamp; defaults to now */
  importedAt?: string;
}

/**
 * Parse, type and transform a CSV text into a Dataset. Fails (without throwing) when the
 * parse report has an error-severity issue or a transformation cannot be applied.
 */
export async function createDataset(
  text: string,
  input: CreateDatasetInput,
): Promise<Dataset | { error: DatasetError }> {
  const { table, report } = parseCsv(text, input.options);
  if (hasParseErrors(report)) {
    const issues = report.issues.filter((i) => i.severity === 'error');
    return {
      error: {
        code: 'PARSE_FAILED',
        message: issues.map((i) => i.message).join(' '),
        issues,
      },
    };
  }
  return buildDataset({
    id: input.id ?? globalThis.crypto.randomUUID(),
    name: input.name,
    source: input.source,
    importedAt: input.importedAt ?? new Date().toISOString(),
    parseOptions: {
      delimiter: report.delimiter,
      decimal: report.decimal,
      missingTokens: [...(input.options?.missingTokens ?? DEFAULT_MISSING_TOKENS)],
    },
    parse: report,
    original: table,
    transformations: [...(input.transformations ?? [])],
  });
}

/** The same dataset with a new transformation log (recomputed from the original). */
export function withTransformations(
  dataset: Dataset,
  transformations: Transformation[],
): Promise<Dataset | { error: DatasetError }> {
  return buildDataset({
    id: dataset.id,
    name: dataset.name,
    source: dataset.source,
    importedAt: dataset.importedAt,
    parseOptions: dataset.parseOptions,
    parse: dataset.parse,
    original: dataset.original,
    transformations: [...transformations],
  });
}
