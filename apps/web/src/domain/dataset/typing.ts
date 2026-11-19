/**
 * Column typing (PLAN §2.2 step 2). A column is numeric only if EVERY non-missing cell reads
 * as a finite number under the chosen decimal mark. Nothing is coerced: one stray "n/a "
 * keeps the whole column as text and the cell is reported as an example, so a text column
 * can never slip into an estimator as if it were ordinal.
 */
import {
  DEFAULT_MISSING_TOKENS,
  type DatasetColumn,
  type DecimalMark,
  type RawTable,
} from './types';

export interface TypingOptions {
  decimal: DecimalMark;
  /** Cell texts (after trimming) read as missing. An empty cell is always missing. */
  missingTokens?: readonly string[];
}

const MAX_EXAMPLES = 5;
const MAX_EXAMPLE_LENGTH = 40;

const NUMBER_DOT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMBER_COMMA = /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Read one cell as a number. Leading/trailing whitespace, a sign, a fraction and an exponent
 * are accepted; thousands separators, hex, "Infinity", "NaN" and anything that overflows to
 * a non-finite number are not. Returns null when the text is not a number.
 */
export function parseNumber(cell: string, decimal: DecimalMark): number | null {
  const s = cell.trim();
  if (decimal === '.') {
    if (!NUMBER_DOT.test(s)) return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  }
  if (!NUMBER_COMMA.test(s)) return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

export function missingSet(tokens: readonly string[] | undefined): Set<string> {
  return new Set(['', ...(tokens ?? DEFAULT_MISSING_TOKENS)]);
}

export function isMissingCell(cell: string, missing: ReadonlySet<string>): boolean {
  return missing.has(cell.trim());
}

export function typeColumn(
  name: string,
  cells: readonly string[],
  decimal: DecimalMark,
  missing: ReadonlySet<string>,
): DatasetColumn {
  const n = cells.length;
  const values = new Float64Array(n);
  let present = 0;
  let nonNumericCount = 0;
  const examples: string[] = [];
  for (let i = 0; i < n; i++) {
    const cell = cells[i] ?? '';
    if (isMissingCell(cell, missing)) {
      values[i] = NaN;
      continue;
    }
    present++;
    const v = parseNumber(cell, decimal);
    if (v === null) {
      nonNumericCount++;
      values[i] = NaN;
      if (examples.length < MAX_EXAMPLES) {
        const ex = truncateExample(cell);
        if (!examples.includes(ex)) examples.push(ex);
      }
    } else {
      values[i] = v;
    }
  }
  if (present === 0) return { name, kind: 'empty', length: n };
  if (nonNumericCount === 0) return { name, kind: 'numeric', values };
  return {
    name,
    kind: 'text',
    values: cells.map((c) => (isMissingCell(c, missing) ? null : c)),
    nonNumericCount,
    examples,
  };
}

export function typeColumns(table: RawTable, options: TypingOptions): DatasetColumn[] {
  const missing = missingSet(options.missingTokens);
  return table.columns.map((name, j) =>
    typeColumn(
      name,
      table.rows.map((r) => r[j] ?? ''),
      options.decimal,
      missing,
    ),
  );
}

function truncateExample(cell: string): string {
  return cell.length <= MAX_EXAMPLE_LENGTH ? cell : `${cell.slice(0, MAX_EXAMPLE_LENGTH - 1)}…`;
}
