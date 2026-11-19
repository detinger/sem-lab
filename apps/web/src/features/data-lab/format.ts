export const EN_DASH = '–';

/** Consistent number display: integers plain, others to `digits` decimals; null = en dash. */
export function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EN_DASH;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(digits);
}

export const pct = (part: number, whole: number, digits = 1): string =>
  whole === 0 ? EN_DASH : `${((100 * part) / whole).toFixed(digits)}%`;

export function truncate(text: string, max = 18): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** "3, 5-8" -> 0-based indexes [2, 4, 5, 6, 7]; null when the text is not a row list. */
export function parseRowList(text: string, maxRow: number): number[] | null {
  const out = new Set<number>();
  const parts = text
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < a || b > maxRow) return null;
    for (let r = a; r <= b; r++) out.add(r - 1);
  }
  return [...out].sort((x, y) => x - y);
}
