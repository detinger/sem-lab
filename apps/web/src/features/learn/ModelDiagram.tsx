import type { SemLayout, SemModel } from '@sem-lab/contracts';
import { useEffect, useState } from 'react';
import { describeModel, modelSvg } from './diagram';
import './diagram.css';

/**
 * Read-only diagram of a small model with automatic layout. The SVG comes from the modeler's
 * own exporter (all labels escaped there); a text description is available as the non-visual
 * equivalent. Highlighted ids (construct, indicator or `meas:` / relationship ids) get an accent.
 */
export function ModelDiagram({
  model,
  caption,
  highlight = [],
  title,
  compact = false,
  layout,
}: {
  model: SemModel;
  caption?: string;
  highlight?: readonly string[];
  title?: string;
  compact?: boolean;
  /** a saved arrangement; automatic layout when absent */
  layout?: SemLayout | undefined;
}) {
  const key = JSON.stringify([model, highlight, title ?? '', layout ?? null]);
  const [done, setDone] = useState<{ key: string; svg: string | null }>({ key: '', svg: null });
  useEffect(() => {
    let live = true;
    modelSvg(model, { ...(title ? { title } : {}), highlight, layout })
      .then((s) => live && setDone({ key, svg: s }))
      .catch(() => live && setDone({ key, svg: null }));
    return () => {
      live = false;
    };
    // `key` captures model, highlight and title by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const svg = done.key === key ? done.svg : null;
  const failed = done.key === key && done.svg === null;
  const lines = describeModel(model);
  const label = title ?? caption ?? 'Model diagram';
  return (
    <figure className={compact ? 'diagram diagram--compact' : 'diagram'}>
      <div className="diagram__canvas" role="img" aria-label={`${label}. ${lines.join('; ')}`}>
        {svg ? (
          // The SVG is generated from the model by the modeler's exporter, which escapes every label.
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : failed ? (
          <p className="diagram__empty">The diagram could not be drawn.</p>
        ) : (
          <p className="diagram__empty">Drawing…</p>
        )}
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
      {compact ? null : (
        <details className="diagram__text">
          <summary>Describe this model as text</summary>
          <ul>
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </figure>
  );
}
