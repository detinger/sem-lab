import { describe, expect, it, vi } from 'vitest';
import { copyTable, COPY_MESSAGES } from './clipboard';
import { MISSING, formatInterval, formatNumber, formatP } from './format';
import { type ReportTable, escapeHtml, toCsv, toHtml, toMarkdown, toTsv } from './table';

describe('number formatting', () => {
  it('rounds, uses a typographic minus and never prints negative zero', () => {
    expect(formatNumber(0.4237)).toBe('0.424');
    expect(formatNumber(-0.4237)).toBe('−0.424');
    expect(formatNumber(-0.0001)).toBe('0.000');
    expect(formatNumber(-0.4237, { minus: 'ascii', decimals: 2 })).toBe('-0.42');
    expect(formatNumber(0.4237, { leadingZero: false })).toBe('.424');
    expect(formatNumber(12.5, { leadingZero: false })).toBe('12.500');
  });
  it('shows missing values as an en dash, never as 0', () => {
    expect(formatNumber(null)).toBe(MISSING);
    expect(formatNumber(Number.NaN)).toBe(MISSING);
    expect(formatInterval(null, null)).toBe(MISSING);
    expect(formatInterval(0.1, 0.25, { decimals: 2 })).toBe('[0.10, 0.25]');
  });
  it('formats p-values without p = 0.000', () => {
    expect(formatP(0)).toBe('< 0.001');
    expect(formatP(0.0004)).toBe('< 0.001');
    expect(formatP(0.0004, { leadingZero: false })).toBe('< .001');
    expect(formatP(0.0321, { leadingZero: false })).toBe('.032');
    expect(formatP(1)).toBe('> 0.999');
    expect(formatP(0.5)).toBe('0.500');
  });
});

const table: ReportTable = {
  id: 't',
  title: 'Paths',
  caption: 'Table 1. Path coefficients',
  columns: [
    { key: 'path', label: 'Path', align: 'left' },
    { key: 'b', label: 'β', align: 'right', numeric: true },
  ],
  rows: [
    { path: 'PEOU → PU', b: '0.445' },
    { path: '<b>x</b> & "y"', b: '−0.120' },
  ],
  notes: ['Standardized estimates; N = 500.'],
};

describe('renderers', () => {
  it('produces a Word-friendly HTML table with one header row and escaped labels', () => {
    const html = toHtml(table);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('table')).toHaveLength(1);
    expect(doc.querySelectorAll('thead tr')).toHaveLength(1);
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(doc.querySelector('[colspan], [rowspan]')).toBeNull();
    expect(doc.querySelectorAll('tbody b')).toHaveLength(0); // markup in a label stays text
    expect(doc.querySelectorAll('tbody td')[2]!.textContent).toBe('<b>x</b> & "y"');
    expect(html).toContain('text-align:right');
    expect(doc.body.textContent).toContain('Note. Standardized estimates; N = 500.');
    expect(escapeHtml(`<script>'"&`)).toBe('&lt;script&gt;&#39;&quot;&amp;');
  });
  it('produces TSV, Markdown and injection-safe CSV', () => {
    expect(toTsv(table).split('\n')).toEqual([
      'Path\tβ',
      'PEOU → PU\t0.445',
      '<b>x</b> & "y"\t−0.120',
    ]);
    expect(toMarkdown(table)).toContain('| Path | β |\n| :--- | ---: |');
    const csv = toCsv({
      ...table,
      rows: [
        { path: '=HYPERLINK("x")', b: '-0.12' },
        { path: '@cmd', b: '+3' },
      ],
    });
    expect(csv).toBe('Path,β\r\n"\'=HYPERLINK(""x"")",-0.12\r\n\'@cmd,+3');
  });
});

describe('copy to clipboard', () => {
  it('writes text/html and text/plain together and reports rich success', async () => {
    const written: ClipboardItem[][] = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        items: Record<string, Blob>;
        constructor(items: Record<string, Blob>) {
          this.items = items;
        }
      },
    );
    const out = await copyTable(table, undefined, {
      write: (items) => (written.push(items), Promise.resolve()),
    });
    expect(out).toEqual({ kind: 'rich', message: COPY_MESSAGES.rich });
    const item = written[0]![0] as unknown as { items: Record<string, Blob> };
    expect(Object.keys(item.items).sort()).toEqual(['text/html', 'text/plain']);
    expect(await item.items['text/html']!.text()).toContain('<table');
  });
  it('falls back to plain text and says formatting may be lost', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const writeText = vi.fn(() => Promise.resolve());
    const out = await copyTable(table, undefined, { writeText });
    expect(out.kind).toBe('text');
    expect(out.message).toBe(COPY_MESSAGES.text);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Path\tβ'));
  });
  it('reports failure honestly when no clipboard is available', async () => {
    expect((await copyTable(table, undefined, {})).kind).toBe('failed');
  });
});
