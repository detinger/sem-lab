/**
 * Deterministic automatic layout for SEM path diagrams (STYLE.md §9 "Automatic layout strategy").
 *
 * Two ELK passes plus our own indicator placement:
 *  A. constructs only, ELK layered → layer membership and order within each layer;
 *  B. each construct becomes a "cluster" (construct + its indicator fan on the side facing
 *     away from the structural flow); ELK lays out the clusters with the pass-A order forced,
 *     so clusters never overlap and indicator groups stay symmetric.
 *
 * Determinism (docs/validation/phase-0/web-spike.md §2): ELK output depends on input order,
 * so every list is sorted by id before layout, and a fixed random seed is always passed.
 * Layout never reads or changes the scientific model's meaning: it only returns coordinates.
 */
import { type LayoutDirection, type SemLayout, type SemModel } from '@sem-studio/contracts';
import type { ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import type ELKType from 'elkjs/lib/elk.bundled.js';
import { longestPathLayers, structuralGraph } from '@/domain/graph';
import {
  type Point,
  type Rect,
  type Size,
  constructSize,
  indicatorSize,
  rectsOverlap,
  snap,
} from '../geometry';

export type IndicatorSide = 'before' | 'after' | 'cross-start' | 'cross-end';

export interface LayoutParams {
  direction: LayoutDirection;
  gridSize: number;
  constructShape: 'ellipse' | 'rounded';
  indicatorDensity: 'default' | 'dense';
  collapsedConstructIds: readonly string[];
}

export interface LayoutResult {
  positions: Record<string, Point>;
  /** Which side of its construct each block's indicators were placed on. */
  sides: Record<string, IndicatorSide>;
}

const SEED = '1';
/** Gap between a construct outline and its indicator fan, and between indicators. */
const FAN_GAP = 56;
const INDICATOR_GAP = 14;

const ELK_DIRECTION: Record<LayoutDirection, string> = {
  LR: 'RIGHT',
  RL: 'LEFT',
  TB: 'DOWN',
  BT: 'UP',
};
const horizontalFlow = (d: LayoutDirection): boolean => d === 'LR' || d === 'RL';

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * ELK (~1.4 MB) is loaded on first use so the app shell does not pay for it; the promise is
 * cached, so every layout after the first reuses one instance.
 */
let elkInstance: Promise<InstanceType<typeof ELKType>> | null = null;
const elk = (): Promise<InstanceType<typeof ELKType>> =>
  (elkInstance ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default()));

function baseOptions(direction: LayoutDirection): LayoutOptions {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': ELK_DIRECTION[direction],
    'elk.randomSeed': SEED,
    'elk.edgeRouting': 'POLYLINE',
    'elk.spacing.nodeNode': '56',
    'elk.layered.spacing.nodeNodeBetweenLayers': '88',
    'elk.spacing.componentComponent': '96',
    'elk.padding': '[top=32,left=32,bottom=32,right=32]',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  };
}

export function sizeOf(
  model: SemModel,
  id: string,
  p: Pick<LayoutParams, 'constructShape' | 'indicatorDensity'>,
): Size {
  const c = model.constructs.find((x) => x.id === id);
  if (c) return constructSize(c.name, p.constructShape);
  const i = model.indicators.find((x) => x.id === id);
  return indicatorSize(i?.name ?? '', p.indicatorDensity);
}

/** Choose a side per construct from its layer and its position within the layer. */
function chooseSides(
  model: SemModel,
  passA: Map<string, Point>,
  layers: Map<string, number>,
  direction: LayoutDirection,
): Record<string, IndicatorSide> {
  const g = structuralGraph(model);
  const maxLayer = Math.max(0, ...layers.values());
  const cross = (p: Point): number => (horizontalFlow(direction) ? p.y : p.x);
  const byLayer = new Map<number, string[]>();
  for (const [id, l] of layers) byLayer.set(l, [...(byLayer.get(l) ?? []), id]);
  const sides: Record<string, IndicatorSide> = {};
  for (const [layer, ids] of byLayer) {
    const ordered = [...ids].sort(
      (a, b) => cross(passA.get(a)!) - cross(passA.get(b)!) || (a < b ? -1 : 1),
    );
    ordered.forEach((id, k) => {
      const outs = g.out.get(id)?.length ?? 0;
      const ins = g.in.get(id)?.length ?? 0;
      if (layer === 0 && outs > 0) sides[id] = 'before';
      else if (outs === 0 && ins > 0 && layer === maxLayer) sides[id] = 'after';
      else if (outs === 0 && ins === 0) sides[id] = 'cross-start';
      else sides[id] = k < ordered.length / 2 || ordered.length === 1 ? 'cross-start' : 'cross-end';
    });
  }
  return sides;
}

interface Cluster {
  id: string;
  size: Size;
  /** construct top-left relative to cluster top-left */
  constructAt: Point;
  /** indicator top-left relative to cluster top-left */
  indicatorsAt: Map<string, Point>;
}

/** Fan the block's indicators on one side, centred on the construct, preserving block order. */
function buildCluster(
  model: SemModel,
  constructId: string,
  side: IndicatorSide,
  p: LayoutParams,
  collapsed: boolean,
): Cluster {
  const c = model.constructs.find((x) => x.id === constructId)!;
  const cs = constructSize(c.name, p.constructShape);
  const inds = collapsed
    ? []
    : c.indicatorIds.filter((id) => model.indicators.some((i) => i.id === id));
  const sizes = inds.map((id) => sizeOf(model, id, p));
  // Which world side is 'before' etc. depends on the flow direction.
  const flowH = horizontalFlow(p.direction);
  const reversed = p.direction === 'RL' || p.direction === 'BT';
  type WorldSide = 'left' | 'right' | 'top' | 'bottom';
  const world: WorldSide = flowH
    ? side === 'before'
      ? reversed
        ? 'right'
        : 'left'
      : side === 'after'
        ? reversed
          ? 'left'
          : 'right'
        : side === 'cross-start'
          ? 'top'
          : 'bottom'
    : side === 'before'
      ? reversed
        ? 'bottom'
        : 'top'
      : side === 'after'
        ? reversed
          ? 'top'
          : 'bottom'
        : side === 'cross-start'
          ? 'left'
          : 'right';

  const stackVertical = world === 'left' || world === 'right';
  // Construct-centred coordinates first, then shift so the cluster's top-left is (0,0).
  const local = new Map<string, Point>();
  if (stackVertical) {
    // One column beside the construct, centred on it, block order top to bottom.
    const along =
      sizes.reduce((s, z) => s + z.height, 0) + INDICATOR_GAP * Math.max(0, sizes.length - 1);
    const thick = Math.max(0, ...sizes.map((z) => z.width));
    let cursor = -along / 2;
    inds.forEach((id, k) => {
      const z = sizes[k]!;
      const x =
        world === 'left'
          ? -cs.width / 2 - FAN_GAP - thick + (thick - z.width)
          : cs.width / 2 + FAN_GAP;
      local.set(id, { x, y: cursor });
      cursor += z.height + INDICATOR_GAP;
    });
  } else {
    // One row above/below the construct, centred on it, block order left to right — the mirror of
    // the vertical (beside-the-construct) case, so both flow directions keep a block's indicators
    // in a single line. ELK sizes each cluster to this fan, so wide blocks spread rather than wrap.
    const width =
      sizes.reduce((s, z) => s + z.width, 0) + INDICATOR_GAP * Math.max(0, sizes.length - 1);
    let cursor = -width / 2;
    inds.forEach((id, k) => {
      const z = sizes[k]!;
      const y = world === 'top' ? -cs.height / 2 - FAN_GAP - z.height : cs.height / 2 + FAN_GAP;
      local.set(id, { x: cursor, y });
      cursor += z.width + INDICATOR_GAP;
    });
  }
  const rects: Rect[] = [{ x: -cs.width / 2, y: -cs.height / 2, ...cs }];
  inds.forEach((id, k) => rects.push({ ...local.get(id)!, ...sizes[k]! }));
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  const shift = (q: Point): Point => ({ x: q.x - minX, y: q.y - minY });
  return {
    id: constructId,
    size: { width: maxX - minX, height: maxY - minY },
    constructAt: shift({ x: -cs.width / 2, y: -cs.height / 2 }),
    indicatorsAt: new Map([...local].map(([id, q]) => [id, shift(q)])),
  };
}

async function elkPass(
  nodes: Array<{ id: string; size: Size }>,
  edges: Array<{ id: string; source: string; target: string }>,
  options: LayoutOptions,
): Promise<Map<string, Point>> {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: options,
    children: nodes.map((n) => ({ id: n.id, width: n.size.width, height: n.size.height })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const out = await (await elk()).layout(graph);
  return new Map((out.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}

/**
 * "Triangle folding" (classic TAM figure: PU stacked above PEOU). A source construct u that
 * feeds a construct v which has no other predecessor, where u and v share a successor, is drawn
 * in one column with v stacked on u's cross-start side; the u→v path becomes a short straight
 * arrow along the cross axis. This removes a whole layer from chain-shaped models without
 * changing any relationship. Only sources are folded, one partner each, chosen by id.
 */
export function foldPairs(model: SemModel): Map<string, string> {
  const g = structuralGraph(model);
  const folded = new Map<string, string>(); // v → u
  const used = new Set<string>();
  for (const u of [...g.nodes].sort()) {
    if ((g.in.get(u)?.length ?? 0) > 0 || used.has(u)) continue;
    const outs = new Set(g.out.get(u) ?? []);
    if (outs.size < 2) continue;
    const v = [...outs].sort().find((cand) => {
      if (used.has(cand) || folded.has(cand)) return false;
      const preds = g.in.get(cand) ?? [];
      if (preds.length !== 1) return false;
      return (g.out.get(cand) ?? []).some((w) => outs.has(w));
    });
    if (v) {
      folded.set(v, u);
      used.add(u);
      used.add(v);
    }
  }
  return folded;
}

const FOLD_GAP = 72;

interface Group {
  id: string;
  size: Size;
  /** top-left of each member cluster relative to the group's top-left */
  members: Array<{ cluster: Cluster; at: Point }>;
}

export async function computeAutoLayout(model: SemModel, p: LayoutParams): Promise<LayoutResult> {
  const constructs = [...model.constructs].sort(byId);
  if (constructs.length === 0) return { positions: {}, sides: {} };
  const ids = new Set(constructs.map((c) => c.id));
  const folds = foldPairs(model);
  const rep = (id: string): string => folds.get(id) ?? id;

  // The layout graph: folded constructs are merged into their partner.
  const seen = new Set<string>();
  const edges = model.relationships
    .filter((r) => r.kind === 'structural' && ids.has(r.sourceId) && ids.has(r.targetId))
    .sort(byId)
    .map((r) => ({ id: r.id, source: rep(r.sourceId), target: rep(r.targetId) }))
    .filter((e) => {
      const key = `${e.source}\u0000${e.target}`;
      if (e.source === e.target || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const reps = constructs.filter((c) => !folds.has(c.id));
  const merged: SemModel = {
    constructs: reps,
    indicators: model.indicators,
    relationships: edges.map((e) => ({
      id: e.id,
      kind: 'structural' as const,
      sourceId: e.source,
      targetId: e.target,
    })),
  };

  // Pass A — constructs only (folded pairs as one stacked node).
  const stackedSize = (id: string): Size => {
    const a = constructSize(constructs.find((c) => c.id === id)!.name, p.constructShape);
    const partner = [...folds].find(([, u]) => u === id)?.[0];
    if (!partner) return a;
    const b = constructSize(constructs.find((c) => c.id === partner)!.name, p.constructShape);
    return horizontalFlow(p.direction)
      ? { width: Math.max(a.width, b.width), height: a.height + b.height + FOLD_GAP }
      : { width: a.width + b.width + FOLD_GAP, height: Math.max(a.height, b.height) };
  };
  const passA = await elkPass(
    reps.map((c) => ({ id: c.id, size: stackedSize(c.id) })),
    edges,
    baseOptions(p.direction),
  );
  const layers = longestPathLayers(merged);
  const sides = chooseSides(merged, passA, layers, p.direction);
  for (const [v, u] of folds) sides[v] = sides[u]!;

  // Clusters, then groups (a folded pair = two clusters with aligned construct centres).
  const collapsed = new Set(p.collapsedConstructIds);
  const clusterOf = (id: string): Cluster =>
    buildCluster(model, id, sides[id]!, p, collapsed.has(id));
  const flowH = horizontalFlow(p.direction);
  const groups = new Map<string, Group>();
  for (const c of reps) {
    const base = clusterOf(c.id);
    const partner = [...folds].find(([, u]) => u === c.id)?.[0];
    if (!partner) {
      groups.set(c.id, {
        id: c.id,
        size: base.size,
        members: [{ cluster: base, at: { x: 0, y: 0 } }],
      });
      continue;
    }
    const top = clusterOf(partner); // stacked on the cross-start side
    const centre = (cl: Cluster): Point => {
      const cs = constructSize(constructs.find((k) => k.id === cl.id)!.name, p.constructShape);
      return { x: cl.constructAt.x + cs.width / 2, y: cl.constructAt.y + cs.height / 2 };
    };
    // Align construct centres on the flow axis; separate along the cross axis.
    const a = flowH
      ? { x: centre(base).x - centre(top).x, y: top.size.height + FOLD_GAP }
      : { x: top.size.width + FOLD_GAP, y: centre(base).y - centre(top).y };
    const members = flowH
      ? [
          { cluster: top, at: { x: Math.max(0, -a.x), y: 0 } },
          { cluster: base, at: { x: Math.max(0, a.x), y: a.y } },
        ]
      : [
          { cluster: top, at: { x: 0, y: Math.max(0, -a.y) } },
          { cluster: base, at: { x: a.x, y: Math.max(0, a.y) } },
        ];
    const width = Math.max(...members.map((m) => m.at.x + m.cluster.size.width));
    const height = Math.max(...members.map((m) => m.at.y + m.cluster.size.height));
    groups.set(c.id, { id: c.id, size: { width, height }, members });
  }

  // Pass B — groups, order forced from pass A.
  const order = [...reps].sort((a, b) => {
    const pa = passA.get(a.id)!;
    const pb = passA.get(b.id)!;
    const main = flowH ? pa.x - pb.x : pa.y - pb.y;
    const cross = flowH ? pa.y - pb.y : pa.x - pb.x;
    return layers.get(a.id)! - layers.get(b.id)! || main || cross || byId(a, b);
  });
  const passB = await elkPass(
    order.map((c) => ({ id: c.id, size: groups.get(c.id)!.size })),
    edges,
    {
      ...baseOptions(p.direction),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
    },
  );

  const positions: Record<string, Point> = {};
  for (const gr of groups.values()) {
    const origin = passB.get(gr.id)!;
    for (const { cluster: cl, at } of gr.members) {
      const ox = origin.x + at.x;
      const oy = origin.y + at.y;
      // Snap the construct to the grid; move its fan by the same amount so the fan stays centred.
      const raw = { x: ox + cl.constructAt.x, y: oy + cl.constructAt.y };
      const snapped = { x: snap(raw.x, p.gridSize), y: snap(raw.y, p.gridSize) };
      const dx = snapped.x - raw.x;
      const dy = snapped.y - raw.y;
      positions[cl.id] = snapped;
      for (const [iid, q] of cl.indicatorsAt)
        positions[iid] = { x: ox + q.x + dx, y: oy + q.y + dy };
    }
  }
  // Indicators that belong to no construct keep a deterministic parking row below the diagram.
  placeOrphans(model, positions, p);
  return { positions, sides };
}

function placeOrphans(model: SemModel, positions: Record<string, Point>, p: LayoutParams): void {
  const orphans = model.indicators.filter((i) => !(i.id in positions)).sort(byId);
  if (orphans.length === 0) return;
  const rects = Object.entries(positions).map(([id, q]) => ({ ...q, ...sizeOf(model, id, p) }));
  const bottom = Math.max(0, ...rects.map((r) => r.y + r.height));
  let x = 32;
  for (const o of orphans) {
    positions[o.id] = { x, y: snap(bottom + 64, p.gridSize) };
    x += sizeOf(model, o.id, p).width + 16;
  }
}

/**
 * Apply a computed layout to an existing one. With `keepPinned`, pinned nodes keep their
 * coordinates; the rest of the layout is translated so the pinned constructs move as little
 * as possible on average, and any unpinned node that would then overlap a pinned one is
 * pushed along the cross axis until it no longer does.
 */
export function mergeLayout(
  model: SemModel,
  current: SemLayout,
  computed: LayoutResult,
  p: LayoutParams,
  keepPinned: boolean,
): Record<string, { x: number; y: number; pinned?: boolean }> {
  const pinned = keepPinned
    ? Object.keys(current.nodes).filter(
        (id) => current.nodes[id]?.pinned && id in computed.positions,
      )
    : [];
  let dx = 0;
  let dy = 0;
  if (pinned.length > 0) {
    for (const id of pinned) {
      dx += current.nodes[id]!.x - computed.positions[id]!.x;
      dy += current.nodes[id]!.y - computed.positions[id]!.y;
    }
    dx = snap(dx / pinned.length, p.gridSize);
    dy = snap(dy / pinned.length, p.gridSize);
  }
  const out: Record<string, { x: number; y: number; pinned?: boolean }> = {};
  for (const [id, q] of Object.entries(computed.positions)) out[id] = { x: q.x + dx, y: q.y + dy };
  const pinnedSet = new Set(pinned);
  for (const id of pinned) out[id] = { ...current.nodes[id]! };
  if (pinned.length > 0) {
    const rect = (id: string): Rect => ({ ...out[id]!, ...sizeOf(model, id, p) });
    const step = p.gridSize * 2;
    const crossKey = horizontalFlow(p.direction) ? 'y' : 'x';
    for (const id of Object.keys(out).sort()) {
      if (pinnedSet.has(id)) continue;
      for (
        let guard = 0;
        guard < 200 && pinned.some((pid) => rectsOverlap(rect(id), rect(pid), 8));
        guard++
      ) {
        out[id] = { ...out[id]!, [crossKey]: out[id]![crossKey] + step };
      }
    }
  }
  return out;
}
