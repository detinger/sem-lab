/**
 * Data Lab core types (PLAN §2.2). Pure data; no React, no storage.
 *
 * Privacy (overview.md ground rule 3): a Dataset holds row-level values and must never be
 * logged, put in a URL, sent anywhere without an explicit user action, or embedded in an
 * exported project file. Only `DatasetRef` (contracts) — fingerprint + column schema — may
 * leave this module freely.
 */

export type Delimiter = ',' | ';' | '\t' | '|';
export type DecimalMark = '.' | ',';

export interface ParseOptions {
  /** undefined = detect */
  delimiter?: Delimiter;
  /** undefined = detect per file (a ',' decimal mark is only possible with a non-',' delimiter) */
  decimal?: DecimalMark;
  /** cell texts (after trimming) treated as missing; default DEFAULT_MISSING_TOKENS */
  missingTokens?: readonly string[];
}

export const DEFAULT_MISSING_TOKENS: readonly string[] = [
  '',
  'NA',
  'N/A',
  'NaN',
  'null',
  'NULL',
  '#NULL!',
];

export interface ParseIssue {
  code:
    | 'EMPTY_FILE'
    | 'NO_HEADER'
    | 'DUPLICATE_COLUMN_NAME'
    | 'EMPTY_COLUMN_NAME'
    | 'RAGGED_ROW'
    | 'DECIMAL_COMMA_ASSUMED'
    /** comma and point both used inside numbers, or "1,234"-style cells: nothing is guessed */
    | 'DECIMAL_MARK_AMBIGUOUS'
    | 'AMBIGUOUS_DELIMITER'
    /** an unclosed or malformed quoted field (papaparse "Quotes" error) */
    | 'MALFORMED_QUOTES'
    | 'TOO_LARGE';
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** 1-based data row numbers (header excluded), capped at 20 */
  rows?: number[];
  column?: string;
}

export interface ParseReport {
  bom: boolean;
  delimiter: Delimiter;
  decimal: DecimalMark;
  delimiterDetected: boolean;
  decimalDetected: boolean;
  rowCount: number;
  columnCount: number;
  issues: ParseIssue[];
}

/** Immutable original as text cells. Never modified after import. */
export interface RawTable {
  columns: string[];
  rows: string[][];
}

export type ColumnKind = 'numeric' | 'text' | 'empty';

/**
 * Working column. Numeric values live in a Float64Array with NaN meaning MISSING (internal
 * representation only — NaN never crosses a JSON/contract boundary).
 */
export type DatasetColumn =
  | { name: string; kind: 'numeric'; values: Float64Array; derivedFrom?: string }
  | {
      name: string;
      kind: 'text';
      values: (string | null)[];
      nonNumericCount: number;
      examples: string[];
    }
  | { name: string; kind: 'empty'; length: number };

export type Transformation =
  /** declare a numeric sentinel (e.g. -99) as missing in one column, or in every numeric column when `column` is '*' */
  | { kind: 'missing-code'; column: string; code: number }
  /** new column `as` = min + max − x, using the ORIGINAL permissible endpoints */
  | { kind: 'reverse'; column: string; scale: { min: number; max: number }; as: string }
  /** new column `as` = x − mean */
  | { kind: 'center'; column: string; as: string }
  /** new column `as` = (x − mean) / sd (sample sd, divisor n − 1) */
  | { kind: 'standardize'; column: string; as: string }
  | { kind: 'drop-column'; column: string }
  /** 0-based indexes into the ORIGINAL row order */
  | { kind: 'drop-rows'; rows: number[]; reason: string };

export interface Dataset {
  id: string;
  name: string;
  source: { kind: 'file'; fileName: string } | { kind: 'bundled'; exampleId: string };
  importedAt: string;
  parseOptions: Required<Pick<ParseOptions, 'delimiter' | 'decimal'>> & { missingTokens: string[] };
  parse: ParseReport;
  original: RawTable;
  transformations: Transformation[];
  /** working columns = original typed, then transformations applied in order */
  columns: DatasetColumn[];
  /** 0-based original row indexes still present after drop-rows */
  rowIndex: number[];
  /** sha256 of the canonical working table (contracts dataFingerprint) */
  fingerprint: string;
}

/**
 * Descriptive statistics per column, computed over non-missing values. Conventions are fixed
 * and documented (docs/validation/phase-0/data-recon.md) and reproduce SmartPLS's stored
 * statistics; both standard deviations are provided and labelled.
 */
export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  n: number;
  nMissing: number;
  nUnique: number;
  /** null when not computable (no values / zero variance), never NaN */
  mean: number | null;
  median: number | null; // UPPER median: sorted[floor(n/2)]
  sdSample: number | null; // divisor n − 1
  sdPopulation: number | null; // divisor n
  skewness: number | null; // G1 (adjusted Fisher–Pearson)
  kurtosis: number | null; // G2 (excess, adjusted)
  min: number | null;
  max: number | null;
  integerValued: boolean;
  /** ≤ 15 distinct integer values: frequency table, ascending by value */
  valueCounts?: Array<{ value: number; count: number }>;
  /** 10–30 equal-width bins over [min, max] for numeric columns with more distinct values */
  histogram?: Array<{ from: number; to: number; count: number }>;
  /** text columns: number of cells that could not be read as numbers, and up to 5 examples */
  nonNumericCount?: number;
  nonNumericExamples?: string[];
}

export interface CorrelationMatrix {
  columns: string[];
  /** Pearson r; null when undefined (zero variance or < 3 complete pairs) */
  values: (number | null)[][];
  /** pairwise: per-pair complete n; listwise: one n for all */
  method: 'pairwise' | 'listwise';
  n: number[][];
}

export interface MissingnessSummary {
  rows: number;
  completeRows: number;
  /** per column: missing count */
  byColumn: Array<{ column: string; missing: number }>;
  /** distinct missingness patterns (true = missing), most frequent first, capped at 50 */
  patterns: Array<{ missing: boolean[]; count: number }>;
}

export interface MappingSuggestion {
  indicatorId: string;
  column: string | null;
  match: 'exact' | 'case-insensitive' | 'normalized' | 'none';
}

/**
 * Numeric matrix handed to an engine for one analysis (Phase 3 consumes it). Row-major,
 * never NaN: listwise rows are complete; fiml rows keep missing cells as `null`.
 */
export type AnalysisData = {
  columns: string[];
  /** working rows before missing-data handling */
  nRows: number;
  nUsed: number;
  nDropped: number;
} & (
  { missingData: 'listwise'; rows: number[][] } | { missingData: 'fiml'; rows: (number | null)[][] }
);
