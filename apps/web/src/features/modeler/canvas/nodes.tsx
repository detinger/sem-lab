import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { Pin } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import * as ops from '@/domain/model-ops';
import { COLUMN_MIME, addColumnsToConstruct, decodeColumns } from '../indicator-dnd';
import type { SceneNode } from '../scene';
import { useModeler } from '../store';

/**
 * Commit an inline construct rename (double-click on the node). When the construct has no label
 * yet, the new name doubles as the label so the element reads sensibly; the user can still give it
 * a distinct label in the inspector. Returns false if the model rejected the name (e.g. a
 * duplicate), in which case the reason surfaces in the inspector's error callout.
 */
function renameConstruct(id: string, value: string): boolean {
  const st = useModeler.getState();
  const c = ops.constructById(st.model, id);
  const name = value.trim();
  if (!c || !name) return false;
  const needLabel = !c.label;
  if (name === c.name && !needLabel) return true;
  return st.edit((m) =>
    ops.updateConstruct(m, id, { name, ...(needLabel ? { label: name } : {}) }),
  );
}

export interface SemNodeData extends Record<string, unknown> {
  scene: SceneNode;
  /** endogenous/exogenous etc. for the accessible name */
  description: string;
  /** focus emphasis (issue focus, IPMA link) — orange per STYLE §8 */
  focused?: boolean;
  /** position is pinned: the node is locked from dragging and kept during Arrange */
  pinned?: boolean;
}
export type ConstructFlowNode = Node<SemNodeData, 'construct'>;
export type IndicatorFlowNode = Node<SemNodeData, 'indicator'>;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;

/**
 * Connection handles: a small visible dot on each side (shown on hover/selection) to START a
 * connection, and one invisible full-size target so a connection can END anywhere on the node.
 * Edges are drawn from the scene (boundary to boundary), never from handle positions.
 */
function ConnectionHandles({ nodeId }: { nodeId: string }) {
  return (
    <>
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={`out-${side}`}
          type="source"
          position={side}
          className="sem-handle"
          aria-label={`Start a connection from this element (${side} side)`}
          data-node={nodeId}
        />
      ))}
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        className="sem-handle-target"
        isConnectableStart={false}
      />
    </>
  );
}

export const ConstructNode = memo(function ConstructNode({
  id,
  data,
  selected,
}: NodeProps<ConstructFlowNode>) {
  const { rect, shape, lines, tag, capsule } = data.scene;
  const w = rect.width;
  const h = rect.height;
  const [dropActive, setDropActive] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus and select the editor when it opens (explicit double-click, so this is expected).
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  // A data column dragged from the indicator palette drops here to become an indicator.
  const acceptsColumn = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(COLUMN_MIME);
  // Double-click opens an inline editor seeded with the current name.
  const startEditing = (): void => {
    cancelled.current = false;
    setDraft(ops.constructById(useModeler.getState().model, id)?.name ?? '');
  };
  const finishEditing = (): void => {
    const value = draft;
    setDraft(null);
    if (cancelled.current || value === null || value.trim() === '') return;
    renameConstruct(id, value);
  };
  return (
    <div
      className="sem-construct"
      data-selected={selected || undefined}
      data-focused={data.focused || undefined}
      data-drop-active={dropActive || undefined}
      data-editing={editing || undefined}
      data-pinned={data.pinned || undefined}
      style={{ width: w, height: h }}
      role="group"
      aria-label={`Construct ${lines.join(' ')}${tag ? `, ${tag.toLowerCase()}` : ''}${data.pinned ? ', position pinned' : ''}. ${data.description}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
      onDragOver={(e) => {
        if (!acceptsColumn(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        if (!acceptsColumn(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropActive(false);
        const columns = decodeColumns(e.dataTransfer.getData(COLUMN_MIME));
        if (columns.length > 0) addColumnsToConstruct(id, columns);
      }}
    >
      <svg
        className="sem-construct-shape"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        aria-hidden="true"
      >
        {shape === 'ellipse' ? (
          <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} />
        ) : (
          <rect x={1} y={1} width={w - 2} height={h - 2} rx={14} />
        )}
      </svg>
      <div className="sem-construct-label">
        {editing ? (
          <input
            ref={inputRef}
            className="sem-construct-input nodrag"
            aria-label="Construct name"
            value={draft ?? ''}
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={finishEditing}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          lines.map((l, k) => <span key={k}>{l}</span>)
        )}
        {tag && <span className="sem-construct-tag">{tag}</span>}
      </div>
      {capsule !== undefined && <span className="sem-capsule">{capsule}</span>}
      {data.pinned && (
        <span className="sem-construct-pin" aria-hidden="true" title="Position pinned">
          <Pin size={12} />
        </span>
      )}
      <ConnectionHandles nodeId={id} />
    </div>
  );
});

export const IndicatorNode = memo(function IndicatorNode({
  id,
  data,
  selected,
}: NodeProps<IndicatorFlowNode>) {
  const { rect, lines, unmapped } = data.scene;
  return (
    <div
      className="sem-indicator"
      data-selected={selected || undefined}
      data-focused={data.focused || undefined}
      data-unmapped={unmapped || undefined}
      style={{ width: rect.width, height: rect.height }}
      role="group"
      aria-label={`Indicator ${lines[0] ?? ''}. ${data.description}`}
      title={unmapped ? 'Not mapped to a data column' : undefined}
    >
      <span>{lines[0]}</span>
      {unmapped && <span className="sem-indicator-unmapped" aria-hidden="true" />}
      <ConnectionHandles nodeId={id} />
    </div>
  );
});

export const nodeTypes = { construct: ConstructNode, indicator: IndicatorNode };
