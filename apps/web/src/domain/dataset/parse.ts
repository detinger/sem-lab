/**
 * CSV parsing (PLAN §2.2 import workflow, steps 1–2).
 *
 * Every cell is kept as the exact text of the file: papaparse runs WITHOUT `dynamicTyping`
 * (web-spike §6: it rounds "7.000000000000" to 7 and leaves "7,25" as a string), and column
 * types are decided later, explicitly, by `typing.ts`.
 *
 * Privacy: issue messages name columns and 1-based data row numbers only, never cell values.
 */
import Papa from 'papaparse';
import {
  DEFAULT_MISSING_TOKENS,
  type DecimalMark,
  type Delimiter,
  type ParseIssue,
  type ParseOptions,
  type ParseReport,
  type RawTable,
} from './types';

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/** Candidate delimiters, in tie-break priority order. */
export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|'];

export interface ParseCsvOptions extends ParseOptions {
  /** Refuse files larger than this many UTF-8 bytes (TOO_LARGE). Default 25 MB. */
  maxBytes?: number;
}

export interface ParseCsvResult {
  table: RawTable;
  report: ParseReport;
}

/** Row numbers listed in an issue are capped at this many (types.ts ParseIssue.rows). */
const MAX_LISTED_ROWS = 20;
/** Records inspected per candidate when guessing the delimiter. */
const DELIMITER_SAMPLE_ROWS = 200;

const DELIMITER_NAMES: Record<Delimiter, string> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};

export function delimiterName(d: Delimiter): string {
  return DELIMITER_NAMES[d];
}

export function parseCsv(text: string, options: ParseCsvOptions = {}): ParseCsvResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const issues: ParseIssue[] = [];
  const failed = (issue: ParseIssue, extra: Partial<ParseReport> = {}): ParseCsvResult => ({
    table: { columns: [], rows: [] },
    report: {
      bom: false,
      delimiter: options.delimiter ?? ',',
      decimal: options.decimal ?? '.',
      delimiterDetected: options.delimiter === undefined,
      decimalDetected: options.decimal === undefined,
      rowCount: 0,
      columnCount: 0,
      ...extra,
      issues: [issue],
    },
  });

  const bytes = utf8ByteLength(text, maxBytes);
  if (bytes > maxBytes) {
    return failed({
      code: 'TOO_LARGE',
      severity: 'error',
      message: `The file is larger than ${formatBytes(maxBytes)}; SEM Studio refuses to import it in the browser.`,
    });
  }

  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  if (body.trim() === '') {
    return failed(
      { code: 'EMPTY_FILE', severity: 'error', message: 'The file is empty.' },
      { bom },
    );
  }

  // ---- delimiter
  let delimiter: Delimiter;
  if (options.delimiter !== undefined) {
    delimiter = options.delimiter;
  } else {
    const guess = guessDelimiter(body);
    delimiter = guess.delimiter;
    if (guess.ambiguousWith.length > 0) {
      issues.push({
        code: 'AMBIGUOUS_DELIMITER',
        severity: 'warning',
        message: `The file reads consistently with more than one separator (${[delimiter, ...guess.ambiguousWith].map(delimiterName).join(', ')}); ${delimiterName(delimiter)} was chosen. Choose another separator if the columns look wrong.`,
      });
    }
  }

  // ---- full parse, every cell as a string
  const parsed = Papa.parse<string[]>(body, {
    delimiter,
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const records = parsed.data;
  // A trailing line break yields one final record with a single empty field.
  while (records.length > 0 && isBlankRecord(records[records.length - 1])) records.pop();

  const quoteErrorRows = new Set<number>();
  for (const e of parsed.errors) {
    if (e.type === 'Quotes' && typeof e.row === 'number') quoteErrorRows.add(e.row);
  }

  const headerCells = records[0];
  if (!headerCells) {
    return failed(
      { code: 'EMPTY_FILE', severity: 'error', message: 'The file is empty.' },
      { bom, delimiter, delimiterDetected: options.delimiter === undefined },
    );
  }
  const columns = headerCells.map((c) => c.trim());
  const width = columns.length;

  // ---- header checks
  const emptyNames = columns.flatMap((c, i) => (c === '' ? [i + 1] : []));
  if (emptyNames.length > 0) {
    issues.push({
      code: 'EMPTY_COLUMN_NAME',
      severity: 'error',
      message: `The header has no name for column${emptyNames.length > 1 ? 's' : ''} ${emptyNames.join(', ')} (counting from 1). Every column needs a unique name.`,
    });
  }
  const seen = new Map<string, number>();
  const reported = new Set<string>();
  columns.forEach((c, i) => {
    if (c === '') return;
    const first = seen.get(c);
    if (first === undefined) {
      seen.set(c, i);
    } else if (!reported.has(c)) {
      reported.add(c);
      const positions = columns.flatMap((x, j) => (x === c ? [j + 1] : []));
      issues.push({
        code: 'DUPLICATE_COLUMN_NAME',
        severity: 'error',
        column: c,
        message: `The column name "${c}" appears more than once (columns ${positions.join(', ')}). Column names must be unique.`,
      });
    }
  });
  if (width > 0 && columns.every((c) => c !== '' && looksNumeric(c))) {
    issues.push({
      code: 'NO_HEADER',
      severity: 'warning',
      message:
        'Every cell of the first row is a number, so the file may have no header row. SEM Studio reads the first row as column names.',
    });
  }

  // ---- data rows, shaped to the header width
  const rows: string[][] = [];
  const shortRows: number[] = [];
  const paddedRows: number[] = [];
  const longRows: number[] = [];
  const quoteRows: number[] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r] ?? [];
    if (width > 1 && isBlankRecord(rec)) continue; // blank line between records
    const rowNumber = rows.length + 1;
    if (quoteErrorRows.has(r)) quoteRows.push(rowNumber);
    if (rec.length === width) {
      rows.push(rec);
    } else if (rec.length < width) {
      shortRows.push(rowNumber);
      rows.push([...rec, ...new Array<string>(width - rec.length).fill('')]);
    } else {
      const extra = rec.slice(width);
      if (extra.every((c) => c.trim() === '')) paddedRows.push(rowNumber);
      else longRows.push(rowNumber);
      rows.push(rec.slice(0, width));
    }
  }

  if (longRows.length > 0) {
    issues.push({
      code: 'RAGGED_ROW',
      severity: 'error',
      rows: longRows.slice(0, MAX_LISTED_ROWS),
      message: `${countRows(longRows.length)} more cells than the header has columns; the extra cells would be lost. Check the separator and quoting.`,
    });
  }
  if (shortRows.length > 0) {
    issues.push({
      code: 'RAGGED_ROW',
      severity: 'warning',
      rows: shortRows.slice(0, MAX_LISTED_ROWS),
      message: `${countRows(shortRows.length)} fewer cells than the header has columns; the missing cells are read as missing values.`,
    });
  }
  if (paddedRows.length > 0) {
    issues.push({
      code: 'RAGGED_ROW',
      severity: 'warning',
      rows: paddedRows.slice(0, MAX_LISTED_ROWS),
      message: `${countRows(paddedRows.length)} empty cells after the last column (for example a trailing separator); they were ignored.`,
    });
  }
  if (quoteRows.length > 0 || quoteErrorRows.has(0)) {
    issues.push({
      code: 'MALFORMED_QUOTES',
      severity: 'error',
      ...(quoteRows.length > 0 ? { rows: quoteRows.slice(0, MAX_LISTED_ROWS) } : {}),
      message: `A quoted field is not closed properly${quoteErrorRows.has(0) ? ' in the header' : ''}. Everything after an unclosed quote is read as one cell; check the quoting.`,
    });
  }

  // ---- decimal mark
  let decimal: DecimalMark;
  let decimalDetected = false;
  if (options.decimal !== undefined) {
    decimal = options.decimal;
  } else {
    decimalDetected = true;
    const missing = new Set(options.missingTokens ?? DEFAULT_MISSING_TOKENS);
    const guess = delimiter === ',' ? { decimal: '.' as const } : guessDecimal(rows, missing);
    decimal = guess.decimal;
    if ('issue' in guess && guess.issue) issues.push(guess.issue);
  }

  return {
    table: { columns, rows },
    report: {
      bom,
      delimiter,
      decimal,
      delimiterDetected: options.delimiter === undefined,
      decimalDetected,
      rowCount: rows.length,
      columnCount: width,
      issues,
    },
  };
}

export function hasParseErrors(report: ParseReport): boolean {
  return report.issues.some((i) => i.severity === 'error');
}

// ---------------------------------------------------------------- delimiter

interface DelimiterGuess {
  delimiter: Delimiter;
  ambiguousWith: Delimiter[];
}

/**
 * Score each candidate on the first records: the header must split into ≥ 2 fields and the
 * score is the share of sample rows with exactly the header's field count. The best score
 * wins; equal best scores keep the priority order , ; tab | and are reported as ambiguous.
 * A file where no candidate splits the header is a single column (delimiter ',').
 */
function guessDelimiter(body: string): DelimiterGuess {
  const scored = DELIMITERS.map((d) => {
    const sample = Papa.parse<string[]>(body, {
      delimiter: d,
      header: false,
      preview: DELIMITER_SAMPLE_ROWS + 1,
      skipEmptyLines: true,
    }).data;
    const width = sample[0]?.length ?? 0;
    const dataRows = sample.slice(1);
    const score =
      width < 2
        ? -1
        : dataRows.length === 0
          ? 1
          : dataRows.filter((r) => r.length === width).length / dataRows.length;
    return { d, score };
  });
  const best = Math.max(...scored.map((s) => s.score));
  if (best < 0) return { delimiter: ',', ambiguousWith: [] };
  const top = scored.filter((s) => s.score === best).map((s) => s.d);
  const [first, ...rest] = top;
  return { delimiter: first ?? ',', ambiguousWith: rest };
}

// ---------------------------------------------------------------- decimal mark

const COMMA_DECIMAL = /^[+-]?\d+,\d+$/;
const DOT_DECIMAL = /^[+-]?\d*\.\d+$/;
/** A comma followed by exactly three digits could be a thousands separator ("1,234"). */
const COMMA_THREE = /^[+-]?\d{1,3},\d{3}$/;
/** Both marks in one number ("1.234,5", "1,234.5"): thousands separators. */
const BOTH_MARKS = /^[+-]?\d[\d.,]*[.,]\d+$/;

interface DecimalGuess {
  decimal: DecimalMark;
  issue?: ParseIssue;
}

/**
 * Decide the decimal mark of a file with a non-comma delimiter. ',' is assumed only when
 * comma-decimal cells exist, no cell uses '.', and at least one comma cell cannot be a
 * thousands separator (not exactly three digits after the comma). Everything else that
 * involves a comma inside a number is flagged and left as '.', so those cells stay text and
 * are shown to the user — nothing is guessed.
 */
function guessDecimal(
  rows: readonly (readonly string[])[],
  missing: ReadonlySet<string>,
): DecimalGuess {
  let commaCells = 0;
  let commaUnambiguous = 0;
  let dotCells = 0;
  let bothCells = 0;
  const commaColumns = new Set<number>();
  for (const row of rows) {
    for (let j = 0; j < row.length; j++) {
      const cell = (row[j] ?? '').trim();
      if (cell === '' || missing.has(cell)) continue;
      if (COMMA_DECIMAL.test(cell)) {
        commaCells++;
        commaColumns.add(j);
        if (!COMMA_THREE.test(cell)) commaUnambiguous++;
      } else if (DOT_DECIMAL.test(cell)) {
        dotCells++;
      } else if (cell.includes(',') && cell.includes('.') && BOTH_MARKS.test(cell)) {
        bothCells++;
      }
    }
  }
  if (commaCells === 0 && bothCells === 0) return { decimal: '.' };
  if (commaCells > 0 && dotCells === 0 && bothCells === 0 && commaUnambiguous > 0) {
    return {
      decimal: ',',
      issue: {
        code: 'DECIMAL_COMMA_ASSUMED',
        severity: 'info',
        message: `Numbers in ${commaColumns.size} column${commaColumns.size === 1 ? '' : 's'} use a comma as the decimal mark, so ',' was assumed. Change the decimal mark if this is wrong.`,
      },
    };
  }
  return {
    decimal: '.',
    issue: {
      code: 'DECIMAL_MARK_AMBIGUOUS',
      severity: 'warning',
      message:
        bothCells > 0 || dotCells > 0
          ? 'Some numbers use a comma and others a point (or both, as thousands separators). The decimal mark was left as "." and such cells are treated as text; choose the decimal mark explicitly and remove thousands separators.'
          : 'Numbers with a comma all have exactly three digits after it, which could be a thousands separator or a decimal mark. The decimal mark was left as "." and such cells are treated as text; choose the decimal mark explicitly.',
    },
  };
}

// ---------------------------------------------------------------- helpers

function isBlankRecord(rec: readonly string[] | undefined): boolean {
  return rec !== undefined && rec.length === 1 && rec[0] === '';
}

function looksNumeric(s: string): boolean {
  return /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(s.trim());
}

function countRows(n: number): string {
  return n === 1 ? '1 row has' : `${n} rows have`;
}

/** UTF-8 byte length, computed exactly only when the cheap bounds cannot decide. */
function utf8ByteLength(text: string, limit: number): number {
  // Every UTF-16 code unit encodes to 1–3 bytes (a surrogate pair: 2 units → 4 bytes).
  if (text.length > limit) return text.length;
  if (text.length * 3 <= limit) return text.length;
  return new TextEncoder().encode(text).length;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
  return `${n} bytes`;
}
