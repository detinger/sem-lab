/**
 * Report tables: a presentation-neutral table model plus renderers for Word/Google Docs
 * (semantic HTML with inline styles), TSV, Markdown and CSV. All cell text is data and is
 * escaped; nothing from a user label is ever interpreted as markup (STYLE §13 item 6).
 */

export type Align = 'left' | 'right' | 'center';

export interface ReportColumn {
  key: string;
  label: string;
  align: Align;
  /** numeric columns use tabular figures and right alignment */
  numeric?: boolean;
}

export interface ReportTable {
  id: string;
  title: string;
  /** e.g. "Table 2. Outer loadings (PLS-SEM, path weighting, N = 500)" — editable by the user */
  caption: string;
  columns: ReportColumn[];
  /** formatted cell text, keyed by column key */
  rows: Array<Record<string, string>>;
  /** footnotes: method, definitions, missing-value reasons */
  notes: string[];
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export interface HtmlOptions {
  includeCaption: boolean;
  includeNotes: boolean;
  fontFamily?: string;
  fontSizePt?: number;
}

/**
 * Word-compatible HTML: one header row, no merged cells, inline borders and padding (Word and
 * Google Docs ignore stylesheets on paste), tabular figures, explicit alignment per cell.
 */
export function toHtml(
  t: ReportTable,
  o: HtmlOptions = { includeCaption: true, includeNotes: true },
): string {
  const font = `font-family:${o.fontFamily ?? "Calibri, 'Helvetica Neue', Arial, sans-serif"};font-size:${o.fontSizePt ?? 10}pt`;
  const cell = 'padding:3pt 6pt;border:none';
  const th = (c: ReportColumn): string =>
    `<th style="${cell};border-top:1px solid #000;border-bottom:1px solid #000;text-align:${c.align};font-weight:bold">${escapeHtml(c.label)}</th>`;
  const td = (c: ReportColumn, text: string, last: boolean): string =>
    `<td style="${cell};text-align:${c.align}${c.numeric ? ';font-variant-numeric:tabular-nums' : ''}${last ? ';border-bottom:1px solid #000' : ''}">${escapeHtml(text)}</td>`;
  const parts: string[] = [];
  if (o.includeCaption && t.caption)
    parts.push(`<p style="${font};margin:0 0 4pt 0"><i>${escapeHtml(t.caption)}</i></p>`);
  parts.push(`<table style="${font};border-collapse:collapse" cellspacing="0" cellpadding="0">`);
  parts.push(`<thead><tr>${t.columns.map(th).join('')}</tr></thead>`);
  parts.push('<tbody>');
  t.rows.forEach((r, i) =>
    parts.push(
      `<tr>${t.columns.map((c) => td(c, r[c.key] ?? '', i === t.rows.length - 1)).join('')}</tr>`,
    ),
  );
  parts.push('</tbody></table>');
  if (o.includeNotes && t.notes.length) {
    parts.push(
      `<p style="${font};font-size:${(o.fontSizePt ?? 10) - 1}pt;margin:4pt 0 0 0"><i>Note.</i> ${t.notes.map(escapeHtml).join(' ')}</p>`,
    );
  }
  return parts.join('');
}

const tsvCell = (s: string): string => s.replace(/[\t\r\n]+/g, ' ');

/** Plain-text fallback: header + rows, tab separated. Caption/notes on their own lines when requested. */
export function toTsv(
  t: ReportTable,
  o: { includeCaption: boolean; includeNotes: boolean } = {
    includeCaption: false,
    includeNotes: false,
  },
): string {
  const lines: string[] = [];
  if (o.includeCaption && t.caption) lines.push(tsvCell(t.caption));
  lines.push(t.columns.map((c) => tsvCell(c.label)).join('\t'));
  for (const r of t.rows) lines.push(t.columns.map((c) => tsvCell(r[c.key] ?? '')).join('\t'));
  if (o.includeNotes && t.notes.length) lines.push(`Note. ${tsvCell(t.notes.join(' '))}`);
  return lines.join('\n');
}

const mdCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function toMarkdown(t: ReportTable): string {
  const align = (a: Align): string => (a === 'right' ? '---:' : a === 'center' ? ':---:' : ':---');
  return [
    t.caption ? `*${mdCell(t.caption)}*\n` : '',
    `| ${t.columns.map((c) => mdCell(c.label)).join(' | ')} |`,
    `| ${t.columns.map((c) => align(c.align)).join(' | ')} |`,
    ...t.rows.map((r) => `| ${t.columns.map((c) => mdCell(r[c.key] ?? '')).join(' | ')} |`),
    t.notes.length ? `\n*Note.* ${mdCell(t.notes.join(' '))}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * CSV for spreadsheets, RFC 4180 quoting, with formula-injection mitigation (PLAN §2.2):
 * a cell starting with = + - @ tab or CR is prefixed with an apostrophe — EXCEPT plain
 * numbers such as "-0.123", which must stay numeric.
 */
export function toCsv(t: ReportTable): string {
  const safe = (s: string): string => {
    const plainNumber = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s);
    const guarded = !plainNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  return [
    t.columns.map((c) => safe(c.label)).join(','),
    ...t.rows.map((r) => t.columns.map((c) => safe(r[c.key] ?? '')).join(',')),
  ].join('\r\n');
}
