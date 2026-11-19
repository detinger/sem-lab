/**
 * Shared ELK helpers for the Phase 0 layout spike. Phase 1 replaces these with the real layout
 * module in src/features/modeler; the spike tests then keep running against elkjs directly.
 */
import type { ElkExtendedEdge, ElkNode, ElkPoint, LayoutOptions } from 'elkjs/lib/elk-api';

import { CONSTRUCT_SIZE, INDICATOR_SIZE, shuffled, type SpikeModel } from './sem-graphs';

/** The option set the spike measured. Keys are the short `elk.*` aliases ELK accepts. */
export const BASE_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '24',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  // 1 is ELK's default. It is written down because 0 means "seed from the clock".
  'elk.randomSeed': '1',
};

export const structuralEdgeId = (from: string, to: string) => `s:${from}->${to}`;
export const measurementEdgeId = (construct: string, indicator: string) =>
  `m:${construct}->${indicator}`;

export interface BuildOptions {
  layoutOptions?: LayoutOptions;
  /** When set, children and edges are shuffled with this seed before they are handed to ELK. */
  shuffleSeed?: number;
  /** When true, children and edges are sorted by id (after any shuffle). */
  sortById?: boolean;
}

/**
 * Flat graph: every construct and every indicator is a root-level node. A NEW object is built on
 * every call because elk.bundled.js writes the result into the object it was given.
 */
export function toFlatElkGraph(model: SpikeModel, options: BuildOptions = {}): ElkNode {
  let children: ElkNode[] = [];
  let edges: ElkExtendedEdge[] = [];

  for (const block of model.blocks) {
    children.push({ id: block.construct, ...CONSTRUCT_SIZE });
  }
  for (const block of model.blocks) {
    for (const indicator of block.indicators) {
      children.push({ id: indicator, ...INDICATOR_SIZE });
      edges.push({
        id: measurementEdgeId(block.construct, indicator),
        sources: [block.construct],
        targets: [indicator],
      });
    }
  }
  for (const [from, to] of model.paths) {
    edges.push({ id: structuralEdgeId(from, to), sources: [from], targets: [to] });
  }

  if (options.shuffleSeed !== undefined) {
    children = shuffled(children, options.shuffleSeed);
    edges = shuffled(edges, options.shuffleSeed + 1);
  }
  if (options.sortById) {
    children = [...children].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    edges = [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  return {
    id: 'root',
    layoutOptions: { ...BASE_LAYOUT_OPTIONS, ...options.layoutOptions },
    children,
    edges,
  };
}

/** Constructs only: the graph the structural layout stage of a two-stage layout would see. */
export function toConstructOnlyElkGraph(
  model: SpikeModel,
  nodeSize: { width: number; height: number },
  layoutOptions: LayoutOptions = {},
): ElkNode {
  return {
    id: 'root',
    layoutOptions: { ...BASE_LAYOUT_OPTIONS, ...layoutOptions },
    children: model.blocks.map((block) => ({ id: block.construct, ...nodeSize })),
    edges: model.paths.map(([from, to]) => ({
      id: structuralEdgeId(from, to),
      sources: [from],
      targets: [to],
    })),
  };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSnapshot {
  width: number;
  height: number;
  nodes: Record<string, Box>;
  /** Polyline per edge: start point, bend points, end point, in drawing order. */
  edges: Record<string, ElkPoint[]>;
}

function required(value: number | undefined, what: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`ELK did not return a finite ${what}`);
  }
  return value;
}

export function sectionPoints(edge: ElkExtendedEdge): ElkPoint[] {
  const points: ElkPoint[] = [];
  for (const section of edge.sections ?? []) {
    points.push(section.startPoint, ...(section.bendPoints ?? []), section.endPoint);
  }
  return points;
}

/** Order-independent view of a layout result, keyed by id, for exact comparison. */
export function snapshot(result: ElkNode): LayoutSnapshot {
  const nodes: Record<string, Box> = {};
  for (const child of result.children ?? []) {
    nodes[child.id] = {
      x: required(child.x, `x for ${child.id}`),
      y: required(child.y, `y for ${child.id}`),
      width: required(child.width, `width for ${child.id}`),
      height: required(child.height, `height for ${child.id}`),
    };
  }
  const edges: Record<string, ElkPoint[]> = {};
  for (const edge of result.edges ?? []) {
    edges[edge.id] = sectionPoints(edge);
  }
  return {
    width: required(result.width, 'graph width'),
    height: required(result.height, 'graph height'),
    nodes: Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => (a < b ? -1 : 1))),
    edges: Object.fromEntries(Object.entries(edges).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

export function nodeBox(snap: LayoutSnapshot, id: string): Box {
  const box = snap.nodes[id];
  if (!box) {
    throw new Error(`Node ${id} is missing from the layout result`);
  }
  return box;
}

/** Largest coordinate difference between two layouts of the same node set. */
export function positionDelta(a: LayoutSnapshot, b: LayoutSnapshot) {
  let maxDelta = 0;
  let moved = 0;
  const ids = Object.keys(a.nodes);
  for (const id of ids) {
    const p = nodeBox(a, id);
    const q = nodeBox(b, id);
    const delta = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
    if (delta > 0) {
      moved += 1;
    }
    maxDelta = Math.max(maxDelta, delta);
  }
  return { maxDelta, moved, nodes: ids.length };
}

export function overlappingPairs(snap: LayoutSnapshot): [string, string][] {
  const entries = Object.entries(snap.nodes);
  const pairs: [string, string][] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [idA, a] = entries[i] as [string, Box];
      const [idB, b] = entries[j] as [string, Box];
      const separate =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      if (!separate) {
        pairs.push([idA, idB]);
      }
    }
  }
  return pairs;
}

/** True when every consecutive pair of points shares an x or a y coordinate. */
export function isAxisAligned(points: ElkPoint[], epsilon = 1e-9): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i - 1] as ElkPoint;
    const q = points[i] as ElkPoint;
    if (Math.abs(p.x - q.x) > epsilon && Math.abs(p.y - q.y) > epsilon) {
      return false;
    }
  }
  return true;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('median of an empty list');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export const round3 = (value: number) => Math.round(value * 1000) / 1000;
