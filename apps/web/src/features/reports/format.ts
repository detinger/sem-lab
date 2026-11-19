/**
 * Number formatting for results and reports (PLAN §2.7, STYLE §13).
 * One place decides decimals, p-value notation and missing-value display, so every table and
 * every export says the same thing.
 */
import type { MissingReason } from '@sem-lab/contracts';

export interface NumberStyle {
  decimals: number;
  /** APA-style: drop the leading zero for quantities bounded by 1 (p, r, R²) */
  leadingZero: boolean;
  /** minus sign: typographic U+2212 for documents, ASCII for CSV/TSV */
  minus: 'typographic' | 'ascii';
}

export const DEFAULT_STYLE: NumberStyle = { decimals: 3, leadingZero: true, minus: 'typographic' };

/** En dash for absent values (STYLE §13). The reason goes into a table note, never into the cell. */
export const MISSING = '–';

export function formatNumber(
  v: number | null | undefined,
  style: Partial<NumberStyle> = {},
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  const s = { ...DEFAULT_STYLE, ...style };
  // Round half away from zero on the decimal representation, never print "-0.000".
  let text = Math.abs(v).toFixed(s.decimals);
  if (Number(text) === 0) return text;
  if (!s.leadingZero && text.startsWith('0.')) text = text.slice(1);
  return v < 0 ? `${s.minus === 'typographic' ? '−' : '-'}${text}` : text;
}

/**
 * p-value notation: three decimals, "< .001" below that, never "0.000" or "p = 0"
 * (STYLE §10). `leadingZero` false gives APA style (".032").
 */
export function formatP(p: number | null | undefined, style: Partial<NumberStyle> = {}): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return MISSING;
  const s = { ...DEFAULT_STYLE, decimals: 3, ...style };
  const threshold = 10 ** -s.decimals;
  if (p < threshold) {
    const t = threshold.toFixed(s.decimals);
    return `< ${s.leadingZero ? t : t.slice(1)}`;
  }
  if (p > 1 - threshold && p <= 1)
    return s.leadingZero
      ? `> ${(1 - threshold).toFixed(s.decimals)}`
      : `> ${(1 - threshold).toFixed(s.decimals).slice(1)}`;
  return formatNumber(p, { ...s, minus: 'ascii' });
}

export function formatInterval(
  lo: number | null,
  hi: number | null,
  style: Partial<NumberStyle> = {},
): string {
  if ((lo === null || !Number.isFinite(lo)) && (hi === null || !Number.isFinite(hi)))
    return MISSING;
  return `[${formatNumber(lo, style)}, ${formatNumber(hi, style)}]`;
}

export const MISSING_REASON_TEXT: Record<MissingReason, string> = {
  'not-applicable': 'not applicable to this construct or relation',
  'not-requested': 'not computed because the option was not requested (e.g. no bootstrap)',
  'not-estimated': 'not estimated',
  'not-supported': 'not supported by the selected engine',
  failed: 'the computation failed',
  'non-finite': 'the engine returned a non-finite value',
};
