/**
 * Diagram scene: the single description of what a SEM diagram looks like, derived from the
 * model and node positions. The canvas edges and the SVG/PNG exporter both draw from it, so
 * "export matches canvas" holds by construction (PLAN §2.1 acceptance criteria).
 *
 * Arrow direction encodes meaning (STYLE §8): reflective = construct → indicator,
 * composite/formative = indicator → construct, structural = source → target,
 * covariance = double-headed curve.
 */
import { type SemLayout, type SemModel, measurementEdges } from '@sem-lab/contracts';
import {
  type NodeShape,
  type Point,
  type Rect,
  boundaryPoint,
  center,
  curvedConnector,
  quadAt,
  wrapLabel,
} from './geometry';
import { sizeOf } from './layout/auto-layout';
import { observedConstructs } from './observed';
import { type RoutedPath, pathData, routeStructural } from './layout/routing';
import { type OverlayInput, applyOverlay } from './overlay';

export interface SceneNode {
  id: string;
  kind: 'construct' | 'indicator';
  rect: Rect;
  shape: NodeShape;
  lines: string[];
  /** small secondary tag, e.g. "Composite" — semantics are never conveyed by colour alone */
  tag?: string;
  /** indicator has no bound dataset column */
  unmapped?: boolean;
  /** result overlay: R² capsule under an endogenous construct */
  capsule?: string;
  /** single-indicator construct drawn as an observed variable (one rectangle, path analysis) */
  observed?: boolean;
}

export interface SceneEdge {
  id: string;
  kind: 'structural' | 'measurement' | 'covariance';
  /** SVG path data */
  d: string;
  arrowStart: boolean;
  arrowEnd: boolean;
  labelAt: Point;
  hypothesis?: string;
  sourceId: string;
  targetId: string;
  /** false when routing could not avoid crossing another node */
  clear: boolean;
  /** result overlay: coefficient pill at labelAt (one overlay mode at a time) */
  pill?: string;
  /** result overlay: a structural path that is not significant (p ≥ .05), drawn dashed */
  nonSignificant?: boolean;
}

export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  bounds: Rect;
}

export interface SceneOptions {
  /** ids of constructs whose indicators are hidden */
  collapsed?: ReadonlySet<string>;
  /** optional live positions overriding layout.nodes (during a drag) */
  positions?: Readonly<Record<string, Point>>;
  /** result overlay, applied last; absent = plain model view */
  overlay?: OverlayInput | null;
}

const ARROW_GAP = 1.5;

export function constructShape(layout: SemLayout): NodeShape {
  return layout.settings.constructShape === 'ellipse' ? 'ellipse' : 'rounded-rect';
}

export function buildScene(model: SemModel, layout: SemLayout, opts: SceneOptions = {}): Scene {
  const collapsed = opts.collapsed ?? new Set(layout.settings.collapsedConstructIds);
  const observed = observedConstructs(model, layout.settings);
  const hiddenIndicators = new Set(
    model.constructs
      .filter((c) => collapsed.has(c.id) || observed.has(c.id))
      .flatMap((c) => c.indicatorIds),
  );
  const cShape = constructShape(layout);
  const pos = (id: string): Point | undefined => opts.positions?.[id] ?? layout.nodes[id];

  const nodes: SceneNode[] = [];
  for (const c of model.constructs) {
    const p = pos(c.id);
    if (!p) continue;
    const size = sizeOf(model, c.id, layout.settings);
    const isObserved = observed.has(c.id);
    nodes.push({
      id: c.id,
      kind: 'construct',
      rect: { ...p, ...size },
      shape: isObserved ? 'rect' : cShape,
      lines: wrapLabel(c.name, 14, 150),
      // With a single indicator the measurement type has no meaning, so no "Composite" tag.
      ...(c.measurement === 'composite-formative' && !isObserved ? { tag: 'Composite' } : {}),
      ...(isObserved ? { observed: true } : {}),
    });
  }
  for (const i of model.indicators) {
    const p = pos(i.id);
    if (!p || hiddenIndicators.has(i.id)) continue;
    nodes.push({
      id: i.id,
      kind: 'indicator',
      rect: { ...p, ...sizeOf(model, i.id, layout.settings) },
      shape: 'rounded-rect',
      lines: [i.name],
      ...(i.column === null ? { unmapped: true } : {}),
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: SceneEdge[] = [];

  for (const e of measurementEdges(model)) {
    const c = byId.get(e.constructId);
    const i = byId.get(e.indicatorId);
    if (!c || !i) continue;
    const reflective = e.direction === 'construct-to-indicator';
    const start = boundaryPoint(c.rect, c.shape, center(i.rect));
    const end = boundaryPoint(i.rect, i.shape, center(c.rect));
    const [from, to] = reflective ? [start, end] : [end, start];
    const tip = reflective
      ? boundaryPoint(i.rect, i.shape, center(c.rect), ARROW_GAP)
      : boundaryPoint(c.rect, c.shape, center(i.rect), ARROW_GAP);
    edges.push({
      id: e.id,
      kind: 'measurement',
      d: pathData({ start: from, end: tip, labelAt: from, bend: 0, clear: true }),
      arrowStart: false,
      arrowEnd: true,
      labelAt: { x: from.x + (to.x - from.x) * 0.45, y: from.y + (to.y - from.y) * 0.45 },
      sourceId: reflective ? c.id : i.id,
      targetId: reflective ? i.id : c.id,
      clear: true,
    });
  }

  for (const r of model.relationships) {
    const s = byId.get(r.sourceId);
    const t = byId.get(r.targetId);
    if (!s || !t) continue;
    if (r.kind === 'structural') {
      const obstacles = nodes.filter((n) => n.id !== s.id && n.id !== t.id).map((n) => n.rect);
      const route: RoutedPath = routeStructural(
        s.rect,
        s.shape,
        t.rect,
        t.shape,
        obstacles,
        ARROW_GAP,
      );
      edges.push({
        id: r.id,
        kind: 'structural',
        d: pathData(route),
        arrowStart: false,
        arrowEnd: true,
        labelAt: route.labelAt,
        ...(r.hypothesis ? { hypothesis: r.hypothesis } : {}),
        sourceId: r.sourceId,
        targetId: r.targetId,
        clear: route.clear,
      });
    } else {
      // Covariances curve to the side so they never coincide with a structural path.
      const bend = Math.max(
        36,
        Math.hypot(center(t.rect).x - center(s.rect).x, center(t.rect).y - center(s.rect).y) * 0.18,
      );
      const c = curvedConnector(s.rect, s.shape, t.rect, t.shape, bend);
      const start = boundaryPoint(s.rect, s.shape, c.control, ARROW_GAP);
      const end = boundaryPoint(t.rect, t.shape, c.control, ARROW_GAP);
      edges.push({
        id: r.id,
        kind: 'covariance',
        d: pathData({ start, end, control: c.control, labelAt: start, bend, clear: true }),
        arrowStart: true,
        arrowEnd: true,
        labelAt: quadAt(start, c.control, end, 0.5),
        sourceId: r.sourceId,
        targetId: r.targetId,
        clear: true,
      });
    }
  }

  const rects = nodes.map((n) => n.rect);
  const minX = Math.min(...rects.map((q) => q.x), 0);
  const minY = Math.min(...rects.map((q) => q.y), 0);
  const maxX = Math.max(...rects.map((q) => q.x + q.width), 0);
  const maxY = Math.max(...rects.map((q) => q.y + q.height), 0);
  const bounds = nodes.length
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 0, height: 0 };
  const scene: Scene = { nodes, edges, bounds };
  return opts.overlay ? applyOverlay(scene, model, opts.overlay) : scene;
}
