import type { SemLayout } from './layout.ts';
import type { SemModel } from './model.ts';

/**
 * Canonical JSON and hashing (contracts.md §4).
 *
 * canonicalJson rules — the Python implementation in apps/api must produce identical bytes;
 * shared vectors live in examples/hash/vectors.json and are tested on both sides:
 *  - objects: keys sorted by Unicode code point; members whose value is `undefined` omitted;
 *  - arrays keep their order;
 *  - numbers: ECMAScript Number::toString (shortest round-trip; "1" not "1.0"; "1e-7"; "1e+21");
 *    -0 is written as 0; NaN/±Infinity are rejected;
 *  - strings: JSON.stringify escaping (only `"`, `\\` and U+0000–U+001F are escaped; non-ASCII kept);
 *  - no whitespace.
 */
export function canonicalJson(value: unknown): string {
  return write(value, '$');
}

function write(v: unknown, path: string): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new Error(`canonicalJson: non-finite number at ${path}`);
      return Object.is(v, -0) ? '0' : String(v);
    case 'string':
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) {
        return `[${v.map((x, i) => (x === undefined ? 'null' : write(x, `${path}[${i}]`))).join(',')}]`;
      }
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => compareCodePoints(a, b));
      return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${write(x, `${path}.${k}`)}`).join(',')}}`;
    }
    case 'undefined':
    case 'bigint':
    case 'function':
    case 'symbol':
      break;
  }
  throw new Error(`canonicalJson: unsupported ${typeof v} at ${path}`);
}

function compareCodePoints(a: string, b: string): number {
  const ca = Array.from(a, (ch) => ch.codePointAt(0) ?? 0);
  const cb = Array.from(b, (ch) => ch.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const d = (ca[i] ?? 0) - (cb[i] ?? 0);
    if (d !== 0) return d;
  }
  return ca.length - cb.length;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const byId = <T extends { id: string }>(a: T, b: T): number => compareCodePoints(a.id, b.id);

/**
 * The part of a model that determines what is estimated. Labels, item wording and
 * hypothesis tags are documentation and are excluded; element order is normalised by id,
 * except block order (`indicatorIds`), which is meaningful (CB marker indicator).
 */
export function scientificProjection(model: SemModel): unknown {
  return {
    constructs: [...model.constructs].sort(byId).map((c) => ({
      id: c.id,
      name: c.name,
      measurement: c.measurement,
      indicatorIds: c.indicatorIds,
      plsWeightingMode: c.plsWeightingMode,
      higherOrder: c.higherOrder,
    })),
    indicators: [...model.indicators].sort(byId).map((i) => ({
      id: i.id,
      name: i.name,
      column: i.column,
      scale: i.scale,
      reverseScored: i.reverseScored,
      level: i.level,
    })),
    relationships: [...model.relationships].sort(byId).map((r) => ({
      id: r.id,
      kind: r.kind,
      // A covariance is undirected; normalise endpoint order so drawing it the other way round is the same model.
      ...(r.kind === 'covariance' && compareCodePoints(r.sourceId, r.targetId) > 0
        ? { sourceId: r.targetId, targetId: r.sourceId }
        : { sourceId: r.sourceId, targetId: r.targetId }),
      parameterLabel: r.parameterLabel,
      fixedValue: r.fixedValue,
    })),
  };
}

export function modelHash(model: SemModel): Promise<string> {
  return sha256Hex(canonicalJson(scientificProjection(model)));
}

export function layoutHash(layout: SemLayout): Promise<string> {
  return sha256Hex(canonicalJson(layout));
}

/** A parsed table cell: number, text, or missing. */
export type DataCell = number | string | null;

/**
 * Fingerprint of parsed data: independent of the delimiter, quoting and number formatting
 * of the source file, dependent on column names, row order and every cell value.
 */
export async function dataFingerprint(
  columns: readonly string[],
  rows: readonly (readonly DataCell[])[],
): Promise<string> {
  for (const [i, r] of rows.entries()) {
    if (r.length !== columns.length)
      throw new Error(
        `dataFingerprint: row ${i} has ${r.length} cells, expected ${columns.length}`,
      );
  }
  return sha256Hex(canonicalJson({ columns, rows }));
}
