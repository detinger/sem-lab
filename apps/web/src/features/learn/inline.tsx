import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useContent } from './content';
import { parseInline } from './inline-parse';

/** A [[glossary-id]] reference: a button that opens a small definition popover. */
export function GlossaryRef({ id }: { id: string }) {
  const term = useContent((c) => c.glossary.find((t) => t.id === id));
  const [open, setOpen] = useState(false);
  const popId = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const label = term?.term ?? id.replace(/-/g, ' ');
  if (!term) return <span className="learn-term learn-term--unknown">{label}</span>;
  return (
    // Escape closes the popover; the interactive element is the button inside.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span
      className="learn-term-wrap"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="learn-term"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <span id={popId} role="note" className="learn-term__pop">
          <strong>{term.term}</strong>
          <span>{plainDefinition(term.definition)}</span>
          <Link to={`/reference?term=${term.id}`}>Open in Reference</Link>
        </span>
      ) : null}
    </span>
  );
}

/** Definitions may contain markup; the popover shows them without nested glossary buttons. */
function plainDefinition(text: string): ReactNode {
  return <InlineText text={text} noTerms />;
}

/** Render a content string. Text only: nothing is ever interpreted as HTML. */
export function InlineText({ text, noTerms = false }: { text: string; noTerms?: boolean }) {
  return (
    <>
      {parseInline(text).map((t, i) => {
        switch (t.kind) {
          case 'bold':
            return <strong key={i}>{t.text}</strong>;
          case 'italic':
            return <em key={i}>{t.text}</em>;
          case 'code':
            return <code key={i}>{t.text}</code>;
          case 'term':
            return noTerms ? (
              <span key={i}>{t.id.replace(/-/g, ' ')}</span>
            ) : (
              <GlossaryRef key={i} id={t.id} />
            );
          case 'text':
            return <span key={i}>{t.text}</span>;
        }
      })}
    </>
  );
}
