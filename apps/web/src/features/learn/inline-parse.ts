/**
 * Inline markup used by every text field in the learning content: **bold**, *italic*,
 * `code` and [[glossary-id]]. Parsing returns plain tokens; rendering (inline.tsx) maps them to
 * React elements, so content is never interpreted as HTML.
 */
export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'term'; id: string };

const PATTERN = /\*\*([^*]+?)\*\*|\*([^*\s](?:[^*]*?[^*\s])?)\*|`([^`]+)`|\[\[([a-z0-9-]+)\]\]/g;

export function parseInline(source: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of source.matchAll(PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: source.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'italic', text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: 'code', text: m[3] });
    else if (m[4] !== undefined) out.push({ kind: 'term', id: m[4] });
    last = at + m[0].length;
  }
  if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
  return out;
}

/** Plain text of inline markup (for aria-labels, search and tests): markers removed. */
export function plainInline(source: string): string {
  return parseInline(source)
    .map((t) => (t.kind === 'term' ? t.id.replace(/-/g, ' ') : t.text))
    .join('');
}
