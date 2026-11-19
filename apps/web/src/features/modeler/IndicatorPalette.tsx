import { GripVertical, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, IconButton, Input } from '@/components/ui';
import * as ops from '@/domain/model-ops';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from './store';
import { COLUMN_MIME, encodeColumns } from './indicator-dnd';
import { ResizeHandle } from './ResizeHandle';

export interface IndicatorPaletteProps {
  collapsed: boolean;
  onToggle: () => void;
  /** px the pane should grow (positive) or shrink (negative) as the divider is dragged */
  onResize: (deltaX: number) => void;
}

/**
 * Left pane: the linked dataset's numeric columns, each draggable onto a construct to become an
 * indicator. Columns already present in the model are shown but not draggable, so a column is
 * never added twice. Collapses to a thin rail on the left; its inner edge is drag-resizable.
 */
export function IndicatorPalette({ collapsed, onToggle, onResize }: IndicatorPaletteProps) {
  const dataset = useDataLab((st) => st.dataset);
  const indicators = useModeler((st) => st.model.indicators);
  const hasConstructs = useModeler((st) => st.model.constructs.length > 0);
  const [scaleLo, setScaleLo] = useState('1');
  const [scaleHi, setScaleHi] = useState('7');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelected = (name: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const lo = Number(scaleLo.trim().replace(',', '.'));
  const hi = Number(scaleHi.trim().replace(',', '.'));
  const scaleValid = Number.isFinite(lo) && Number.isFinite(hi) && lo < hi;
  const noScale = indicators.filter((i) => !i.scale).length;
  // Set one response scale on every indicator (one undo step) — the common data-first case where
  // all items share a Likert range. Per-indicator overrides stay in the inspector.
  const applyScaleToAll = (): void => {
    if (!scaleValid) return;
    useModeler
      .getState()
      .edit((m) =>
        m.indicators.reduce(
          (acc, i) => ops.updateIndicator(acc, i.id, { scale: { min: lo, max: hi } }),
          m,
        ),
      );
  };

  if (collapsed) {
    return (
      <aside className="modeler-rail" data-side="left" aria-label="Data indicators (collapsed)">
        <IconButton size="small" aria-label="Show data indicators" onClick={onToggle}>
          <PanelLeftOpen size={16} />
        </IconButton>
        <span className="modeler-rail__label">Data indicators</span>
      </aside>
    );
  }

  const used = new Set(indicators.map((i) => i.column).filter((c): c is string => !!c));
  const numeric = dataset?.columns.filter((c) => c.kind === 'numeric') ?? [];

  return (
    <aside className="modeler-palette" aria-label="Data indicators">
      <header className="modeler-palette-header">
        <h2>Data indicators</h2>
        <IconButton size="small" aria-label="Hide data indicators" onClick={onToggle}>
          <PanelLeftClose size={16} />
        </IconButton>
      </header>
      <div className="modeler-palette-body">
        {!dataset ? (
          <p className="inspector-hint">
            No data linked yet. Import a CSV in the <Link to="/data">Data</Link> step, then drag its
            columns onto a construct here.
          </p>
        ) : numeric.length === 0 ? (
          <p className="inspector-hint">
            This dataset has no numeric columns to use as indicators.
          </p>
        ) : (
          <>
            <p className="inspector-hint">
              {selected.size > 0
                ? `${selected.size} selected — drag any of them onto a construct to add them together.`
                : hasConstructs
                  ? 'Drag a column onto a construct. Click several to select, then drag them together.'
                  : 'Add a construct first, then drag columns onto it. Click several to drag them together.'}
            </p>
            <ul className="modeler-palette-list">
              {numeric.map((c) => {
                const inUse = used.has(c.name);
                const isSelected = !inUse && selected.has(c.name);
                return (
                  <li key={c.name}>
                    <button
                      type="button"
                      className="modeler-palette-chip"
                      data-used={inUse || undefined}
                      data-selected={isSelected || undefined}
                      aria-pressed={inUse ? undefined : isSelected}
                      disabled={inUse}
                      draggable={!inUse}
                      onClick={() => toggleSelected(c.name)}
                      onDragStart={(e) => {
                        // Drag the whole selection if this chip is part of it; otherwise just this one.
                        const cols =
                          isSelected && selected.size > 1
                            ? numeric
                                .filter((n) => !used.has(n.name) && selected.has(n.name))
                                .map((n) => n.name)
                            : [c.name];
                        e.dataTransfer.setData(COLUMN_MIME, encodeColumns(cols));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onDragEnd={() => setSelected(new Set())}
                      title={
                        inUse
                          ? `${c.name} is already an indicator in this model`
                          : `Drag ${c.name} onto a construct, or click to select`
                      }
                    >
                      <GripVertical size={14} aria-hidden="true" className="modeler-palette-grip" />
                      <span className="modeler-palette-name">{c.name}</span>
                      {inUse ? <Badge variant="neutral">in model</Badge> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      {indicators.length > 0 ? (
        <div className="modeler-palette-footer" role="group" aria-label="Response scale">
          <span className="modeler-palette-footer__label">Response scale (min/max)</span>
          <div className="modeler-palette-scale">
            <Input
              size="small"
              inputMode="decimal"
              aria-label="Scale minimum"
              value={scaleLo}
              onChange={(e) => setScaleLo(e.target.value)}
            />
            <span aria-hidden="true">–</span>
            <Input
              size="small"
              inputMode="decimal"
              aria-label="Scale maximum"
              value={scaleHi}
              onChange={(e) => setScaleHi(e.target.value)}
            />
          </div>
          <Button
            size="small"
            variant="primary"
            disabled={!scaleValid}
            onClick={applyScaleToAll}
          >
            Apply to all {indicators.length} indicators
          </Button>
          <p className="inspector-hint">
            {noScale > 0
              ? `${noScale} of ${indicators.length} have no scale yet. IPMA and reverse scoring need it.`
              : 'All indicators have a scale. Override any one in the inspector.'}
          </p>
        </div>
      ) : null}
      <ResizeHandle side="right" ariaLabel="Resize data indicators pane" onResize={onResize} />
    </aside>
  );
}
