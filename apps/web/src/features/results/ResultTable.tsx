import { ClipboardCopy } from 'lucide-react';
import { Button, Menu, Table, Td, Th, useToast } from '@/components/ui';
import { copyTable } from '../reports/clipboard';
import { type ReportTable, toCsv, toHtml, toMarkdown } from '../reports/table';
import { TABLE_NOTES } from './notes';
import { download } from './ExportR';
import { useResultStyle } from './store';

export function ResultTable({ table }: { table: ReportTable }) {
  const { toast } = useToast();
  const style = useResultStyle();
  const note = TABLE_NOTES[table.id];
  const opts = { includeCaption: style.includeCaption, includeNotes: style.includeNotes };
  const base = table.id.replace(/[^a-z0-9-]+/gi, '-');

  const copy = async (): Promise<void> => {
    const outcome = await copyTable(table, opts);
    toast({
      title: outcome.message,
      variant: outcome.kind === 'rich' ? 'success' : outcome.kind === 'text' ? 'warning' : 'error',
    });
  };

  return (
    <div className="rs-table" role="group" aria-labelledby={`rs-t-${base}`}>
      <div className="rs-table__head">
        <h3 id={`rs-t-${base}`} className="rs-table__title">
          <ClipboardCopy size={14} aria-hidden="true" />
          {table.title}
        </h3>
        <div className="rs-table__tools" role="toolbar" aria-label={`${table.title} table tools`}>
          <span className="rs-rows">
            {table.rows.length} row{table.rows.length === 1 ? '' : 's'}
          </span>
          <Button size="small" icon={<ClipboardCopy size={14} />} onClick={() => void copy()}>
            Copy table
          </Button>
          <Menu
            label="More"
            size="small"
            align="end"
            items={[
              {
                id: 'caption',
                label: `Include caption: ${style.includeCaption ? 'on' : 'off'}`,
                onSelect: () => style.set({ includeCaption: !style.includeCaption }),
              },
              {
                id: 'notes',
                label: `Include notes: ${style.includeNotes ? 'on' : 'off'}`,
                onSelect: () => style.set({ includeNotes: !style.includeNotes }),
              },
              {
                id: 'md',
                label: 'Copy as Markdown',
                onSelect: () =>
                  void navigator.clipboard
                    ?.writeText(toMarkdown(table))
                    .then(() => toast({ title: 'Markdown copied', variant: 'success' }))
                    .catch(() =>
                      toast({
                        title:
                          'Copying is not available in this browser context. Use Download instead.',
                        variant: 'error',
                      }),
                    ),
              },
              {
                id: 'csv',
                label: 'Download CSV',
                onSelect: () => download(`${base}.csv`, toCsv(table), 'text/csv;charset=utf-8'),
              },
              {
                id: 'html',
                label: 'Download HTML',
                onSelect: () =>
                  download(
                    `${base}.html`,
                    `<!doctype html><meta charset="utf-8">${toHtml(table, opts)}`,
                    'text/html;charset=utf-8',
                  ),
              },
            ]}
          />
        </div>
      </div>
      <Table aria-label={table.title} className="rs-grid">
        <thead>
          <tr>
            {table.columns.map((c) => (
              <Th key={c.key} numeric={c.numeric}>
                {c.label || <span className="sr-only">Row</span>}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {table.columns.map((c) => {
                const cell = r[c.key] ?? '';
                const key = `${i}:${c.key}`;
                if (table.warn?.has(key))
                  return (
                    <Td key={c.key} numeric={c.numeric}>
                      <span className="rs-cell-warn">{cell}</span>
                    </Td>
                  );
                return (
                  <Td key={c.key} numeric={c.numeric}>
                    {table.bold?.has(key) ? <strong>{cell}</strong> : cell}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
      {table.notes.length > 0 ? (
        <p className="rs-notes">
          <em>Note.</em> {table.notes.join(' ')}
        </p>
      ) : null}
      {note ? (
        <div className="rs-interp">
          <p>
            <strong>What this shows.</strong> {note.shows}
          </p>
          <p>
            <strong>What it does not show.</strong> {note.notShown}
          </p>
        </div>
      ) : null}
    </div>
  );
}
