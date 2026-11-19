/**
 * Copy a table so it pastes into Word / Google Docs as an editable table (STYLE §13):
 * text/html (semantic table) + text/plain (TSV) in one ClipboardItem via the secure-context
 * Clipboard API. Falls back to plain text, and says so — the caller shows the message.
 */
import { type HtmlOptions, type ReportTable, toHtml, toTsv } from './table';

export type CopyOutcome =
  | { kind: 'rich'; message: string }
  | { kind: 'text'; message: string }
  | { kind: 'failed'; message: string };

export const COPY_MESSAGES = {
  rich: 'Table copied — paste into Word or Google Docs',
  text: 'Copied as text; table formatting may not be preserved',
  failed: 'Copying is not available in this browser context. Use Download instead.',
} as const;

interface ClipboardLike {
  write?: (items: ClipboardItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

export async function copyTable(
  table: ReportTable,
  options: HtmlOptions = { includeCaption: true, includeNotes: true },
  clipboard: ClipboardLike | undefined = typeof navigator !== 'undefined'
    ? navigator.clipboard
    : undefined,
): Promise<CopyOutcome> {
  const html = `<meta charset="utf-8">${toHtml(table, options)}`;
  const text = toTsv(table, options);
  if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return { kind: 'rich', message: COPY_MESSAGES.rich };
    } catch {
      /* fall through to plain text (e.g. Firefox without rich clipboard permission) */
    }
  }
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return { kind: 'text', message: COPY_MESSAGES.text };
    } catch {
      /* fall through */
    }
  }
  return { kind: 'failed', message: COPY_MESSAGES.failed };
}
