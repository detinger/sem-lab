import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  type NodeChange,
  type OnConnect,
  ReactFlow,
  useReactFlow,
  ViewportPortal,
  type IsValidConnection,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { constructRoles } from '@/domain/graph';
import {
  checkConnection,
  connect,
  extractFragment,
  removeElements,
  type ModelFragment,
} from '@/domain/model-ops';
import { type Guide, type Point } from '../geometry';
import { sizeOf } from '../layout/auto-layout';
import { buildScene } from '../scene';
import { useModeler } from '../store';
import type { OverlayInput } from '../overlay';
import { type DragStart, dragPositions } from './drag';
import { type SemFlowEdge, SemMarkers, edgeTypes } from './edges';
import { type ConstructFlowNode, type IndicatorFlowNode, nodeTypes } from './nodes';
import '../modeler.css';

type FlowNode = ConstructFlowNode | IndicatorFlowNode;

/** In-app clipboard for model fragments (the system clipboard is not used for model data). */
let clipboard: { fragment: ModelFragment; positions: Record<string, Point> } | null = null;

const isTextTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/**
 * Nodes and edges are controlled by the store, so React Flow's selection changes must be
 * written back to it (otherwise a click would never select anything).
 */
function applySelectionChanges(
  changes: ReadonlyArray<{ type: string; id?: string; selected?: boolean }>,
): void {
  const sel = changes.filter(
    (c): c is { type: 'select'; id: string; selected: boolean } =>
      c.type === 'select' && typeof c.id === 'string',
  );
  if (sel.length === 0) return;
  const st = useModeler.getState();
  const next = new Set(st.selection);
  for (const c of sel) {
    if (c.selected) next.add(c.id);
    else next.delete(c.id);
  }
  const ordered = [...next];
  if (ordered.length !== st.selection.length || ordered.some((id, k) => id !== st.selection[k]))
    st.select(ordered);
}

export interface SemCanvasProps {
  /** connection mode chosen in the toolbar */
  connectKind: 'path' | 'covariance';
  showHypotheses: boolean;
  showMiniMap: boolean;
  onRequestShortcuts?: () => void;
  focusedIds?: ReadonlySet<string>;
  /** result overlay (estimates, t, p, CI, hypotheses); null = model view */
  overlay?: OverlayInput | null;
}

export function SemCanvas({
  connectKind,
  showHypotheses,
  showMiniMap,
  onRequestShortcuts,
  focusedIds,
  overlay = null,
}: SemCanvasProps) {
  const model = useModeler((s) => s.model);
  const layout = useModeler((s) => s.layout);
  const selection = useModeler((s) => s.selection);
  const rf = useReactFlow<FlowNode, SemFlowEdge>();
  const [guides, setGuides] = useState<Guide[]>([]);
  const drag = useRef<DragStart | null>(null);
  const modifiers = useRef({ alt: false, shift: false });

  const scene = useMemo(() => buildScene(model, layout, { overlay }), [model, layout, overlay]);
  const roles = useMemo(() => constructRoles(model), [model]);
  const selected = useMemo(() => new Set(selection), [selection]);

  const nodes = useMemo<FlowNode[]>(
    () =>
      scene.nodes.map((n) => {
        const description =
          n.kind === 'construct'
            ? `${roles.get(n.id) ?? 'isolated'}, ${model.constructs.find((c) => c.id === n.id)?.indicatorIds.length ?? 0} indicators`
            : n.unmapped
              ? 'not mapped to a data column'
              : `column ${model.indicators.find((i) => i.id === n.id)?.column ?? ''}`;
        const pinned = !!layout.nodes[n.id]?.pinned;
        return {
          id: n.id,
          type: n.kind,
          position: { x: n.rect.x, y: n.rect.y },
          width: n.rect.width,
          height: n.rect.height,
          selected: selected.has(n.id),
          // Pinned nodes are locked in place: dragging them does nothing.
          draggable: !pinned,
          data: { scene: n, description, focused: focusedIds?.has(n.id) ?? false, pinned },
        };
      }),
    [scene, roles, model, selected, focusedIds, layout],
  );

  const edges = useMemo<SemFlowEdge[]>(
    () =>
      scene.edges.map((e) => ({
        id: e.id,
        type: 'sem',
        source: e.sourceId,
        target: e.targetId,
        selected: selected.has(e.id),
        data: { scene: e, showHypothesis: showHypotheses },
      })),
    [scene, selected, showHypotheses],
  );

  // ---------------------------------------------------------------- dragging

  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (_e, node) => {
      const s = useModeler.getState();
      const moving = new Set(
        s.selection.includes(node.id) ? s.selection.filter((id) => s.layout.nodes[id]) : [node.id],
      );
      // Pinned constructs stay put even when dragged as part of a multi-selection.
      for (const id of [...moving]) if (s.layout.nodes[id]?.pinned) moving.delete(id);
      // Indicators follow their construct unless they were selected themselves.
      for (const c of s.model.constructs)
        if (moving.has(c.id)) c.indicatorIds.forEach((i) => moving.add(i));
      const start = new Map(
        [...moving]
          .filter((id) => s.layout.nodes[id])
          .map((id) => [id, { x: s.layout.nodes[id]!.x, y: s.layout.nodes[id]!.y }]),
      );
      const staticRects = scene.nodes
        .filter((n) => !moving.has(n.id) && n.kind === 'construct')
        .map((n) => n.rect);
      drag.current = {
        primaryId: node.id,
        start,
        primarySize: sizeOf(s.model, node.id, s.layout.settings),
        staticRects,
      };
      s.beginTransaction();
    },
    [scene],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      applySelectionChanges(changes);
      const d = drag.current;
      if (!d) return;
      const primary = changes.find(
        (c) => c.type === 'position' && c.id === d.primaryId && c.position,
      );
      if (!primary || primary.type !== 'position' || !primary.position) return;
      const s = useModeler.getState();
      const { positions, guides: g } = dragPositions(d, {
        rawPrimary: primary.position,
        grid: s.layout.settings.gridSize,
        snapToGrid: s.layout.settings.snapToGrid,
        bypass: modifiers.current.alt,
        constrain: modifiers.current.shift,
        threshold: 6 / rf.getZoom(),
      });
      s.setPositions(Object.fromEntries(positions), { transient: true });
      setGuides(g);
    },
    [rf],
  );

  const onNodeDragStop = useCallback(() => {
    drag.current = null;
    setGuides([]);
    useModeler.getState().commitTransaction();
  }, []);

  useEffect(() => {
    const track = (e: KeyboardEvent): void => {
      modifiers.current = { alt: e.altKey, shift: e.shiftKey };
    };
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
    };
  }, []);

  // ---------------------------------------------------------------- connecting & selection

  const isValidConnection: IsValidConnection = useCallback(
    (c) =>
      !!c.source &&
      !!c.target &&
      checkConnection(
        useModeler.getState().model,
        c.source,
        c.target,
        connectKind === 'covariance' ? 'covariance' : undefined,
      ).ok,
    [connectKind],
  );

  const onConnect: OnConnect = useCallback(
    (c) => {
      if (!c.source || !c.target) return;
      useModeler
        .getState()
        .edit(
          (m) =>
            connect(m, c.source, c.target, connectKind === 'covariance' ? 'covariance' : undefined)
              .model,
        );
    },
    [connectKind],
  );

  // ---------------------------------------------------------------- keyboard (STYLE §9)

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isTextTarget(e.target)) return;
      const s = useModeler.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'a') {
        e.preventDefault();
        s.select([...s.model.constructs.map((c) => c.id), ...s.model.indicators.map((i) => i.id)]);
      } else if (mod && key === 'c' && s.selection.length) {
        const fragment = extractFragment(s.model, s.selection);
        const ids = [
          ...fragment.constructs.map((c) => c.id),
          ...fragment.indicators.map((i) => i.id),
        ];
        clipboard = {
          fragment,
          positions: Object.fromEntries(
            ids.filter((id) => s.layout.nodes[id]).map((id) => [id, s.layout.nodes[id]!]),
          ),
        };
      } else if (mod && key === 'x' && s.selection.length) {
        const fragment = extractFragment(s.model, s.selection);
        const ids = [
          ...fragment.constructs.map((c) => c.id),
          ...fragment.indicators.map((i) => i.id),
        ];
        clipboard = {
          fragment,
          positions: Object.fromEntries(
            ids.filter((id) => s.layout.nodes[id]).map((id) => [id, s.layout.nodes[id]!]),
          ),
        };
        s.edit((m) => removeElements(m, s.selection));
      } else if (mod && key === 'v' && clipboard) {
        e.preventDefault();
        s.paste(clipboard.fragment, clipboard.positions, { x: 48, y: 48 });
      } else if ((key === 'delete' || key === 'backspace') && s.selection.length) {
        e.preventDefault();
        s.edit((m) => removeElements(m, s.selection));
      } else if (key === 'escape') {
        s.select([]);
      } else if (!mod && key === 'g') {
        const order = ['dots', 'faint', 'hidden'] as const;
        s.setLayoutSettings({
          gridVisibility: order[(order.indexOf(s.layout.settings.gridVisibility) + 1) % 3]!,
        });
      } else if (!mod && key === 'f') {
        void rf.fitView({ padding: 0.15, duration: prefersReducedMotion() ? 0 : 200 });
      } else if (!mod && key === 'l') {
        void s
          .autoArrange({ keepPinned: true })
          .then(() => rf.fitView({ padding: 0.15, duration: prefersReducedMotion() ? 0 : 200 }));
      } else if (!mod && key === '?') {
        onRequestShortcuts?.();
      }
    },
    [rf, onRequestShortcuts],
  );

  const grid = layout.settings.gridVisibility;
  return (
    // role="application" is the correct ARIA role for a diagram editor with its own keyboard
    // model (STYLE §9 shortcuts); jsx-a11y classifies it as non-interactive, hence the disable.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="sem-canvas"
      role="application"
      aria-roledescription="diagram editor"
      aria-label="SEM model editor. Press question mark for keyboard shortcuts."
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see role comment above
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-grid={grid}
      data-connect={connectKind}
    >
      <SemMarkers />
      <ReactFlow<FlowNode, SemFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onEdgesChange={applySelectionChanges}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionOnDrag
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnPinch
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: false }}
        nodesFocusable
        edgesFocusable
        aria-label="SEM path diagram"
      >
        {grid !== 'hidden' && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={layout.settings.gridSize}
            size={1.25}
            className="sem-grid"
          />
        )}
        <Controls showInteractive={false} position="bottom-left" />
        {showMiniMap && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="sem-minimap"
            ariaLabel="Diagram overview"
          />
        )}
        <ViewportPortal>
          {guides.length > 0 && (
            <svg
              className="sem-guides"
              style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
              aria-hidden="true"
            >
              {guides.map((g, k) =>
                g.axis === 'x' ? (
                  <line key={k} x1={g.value} x2={g.value} y1={g.from - 24} y2={g.to + 24} />
                ) : (
                  <line key={k} y1={g.value} y2={g.value} x1={g.from - 24} x2={g.to + 24} />
                ),
              )}
            </svg>
          )}
        </ViewportPortal>
      </ReactFlow>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
