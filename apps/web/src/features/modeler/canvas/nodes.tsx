import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import type { SceneNode } from '../scene';

export interface SemNodeData extends Record<string, unknown> {
  scene: SceneNode;
  /** endogenous/exogenous etc. for the accessible name */
  description: string;
  /** focus emphasis (issue focus, IPMA link) — orange per STYLE §8 */
  focused?: boolean;
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
  const { rect, shape, lines, tag } = data.scene;
  const w = rect.width;
  const h = rect.height;
  return (
    <div
      className="sem-construct"
      data-selected={selected || undefined}
      data-focused={data.focused || undefined}
      style={{ width: w, height: h }}
      role="group"
      aria-label={`Construct ${lines.join(' ')}${tag ? `, ${tag.toLowerCase()}` : ''}. ${data.description}`}
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
        {lines.map((l, k) => (
          <span key={k}>{l}</span>
        ))}
        {tag && <span className="sem-construct-tag">{tag}</span>}
      </div>
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
