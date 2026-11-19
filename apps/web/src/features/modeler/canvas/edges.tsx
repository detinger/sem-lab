import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { pillSize } from '../overlay';
import type { SceneEdge } from '../scene';

export interface SemEdgeData extends Record<string, unknown> {
  scene: SceneEdge;
  showHypothesis: boolean;
}
export type SemFlowEdge = Edge<SemEdgeData, 'sem'>;

/** Marker ids are defined once by <SemMarkers/>. */
function marker(kind: SceneEdge['kind'], selected: boolean): string {
  if (selected) return 'url(#sem-arrow-selected)';
  return kind === 'measurement' ? 'url(#sem-arrow-measurement)' : 'url(#sem-arrow)';
}

/** Draws the scene's path for this edge; React Flow's handle-based geometry is ignored on purpose. */
export const SemEdge = memo(function SemEdge({ id, data, selected }: EdgeProps<SemFlowEdge>) {
  if (!data) return null;
  const e = data.scene;
  const m = marker(e.kind, !!selected);
  return (
    <>
      <BaseEdge
        id={id}
        path={e.d}
        className={`sem-edge sem-edge-${e.kind}${e.clear ? '' : ' sem-edge-unclear'}`}
        markerEnd={e.arrowEnd ? m : undefined}
        markerStart={e.arrowStart ? m : undefined}
        interactionWidth={14}
      />
      {e.pill !== undefined && (
        <g className="sem-pill" data-testid={`pill-${e.id}`}>
          <rect
            x={e.labelAt.x - pillSize(e.pill).width / 2}
            y={e.labelAt.y - pillSize(e.pill).height / 2}
            width={pillSize(e.pill).width}
            height={pillSize(e.pill).height}
            rx={4}
          />
          <text x={e.labelAt.x} y={e.labelAt.y + 4} textAnchor="middle">
            {e.pill}
          </text>
        </g>
      )}
      {data.showHypothesis && e.hypothesis && (
        <text
          className="sem-edge-hypothesis"
          x={e.labelAt.x}
          y={e.labelAt.y - (e.pill !== undefined ? 14 : 7)}
          textAnchor="middle"
        >
          {e.hypothesis}
        </text>
      )}
    </>
  );
});

export const edgeTypes = { sem: SemEdge };

export function SemMarkers() {
  const arrow = (id: string, cls: string, size: number) => (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth={size}
      markerHeight={size}
      orient="auto-start-reverse"
      markerUnits="userSpaceOnUse"
    >
      <path d="M0,1 L10,5 L0,9 z" className={cls} />
    </marker>
  );
  return (
    <svg className="sem-markers" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {arrow('sem-arrow', 'sem-arrow-fill', 9)}
        {arrow('sem-arrow-measurement', 'sem-arrow-fill-measurement', 7)}
        {arrow('sem-arrow-selected', 'sem-arrow-fill-selected', 9)}
      </defs>
    </svg>
  );
}
