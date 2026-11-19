/**
 * Structural-model graph and effects, as services/r-engine/R/model_graph.R
 * (connected_pairs / all_paths / find_cycle) and pls_results.R (effects_spec /
 * compute_effects): total = (I − B)⁻¹ − I, total indirect = total − B, specific indirect =
 * product of the path coefficients along one directed chain of length ≥ 2 (at most 500 chains).
 */
import { identity, inverseR, type Mat } from '../linalg/index.ts';

export const MAX_SPECIFIC_INDIRECT = 500;

export interface PathEdge {
  source: number;
  target: number;
}

/** Adjacency lists in node order; each list keeps the order of the paths (R: split(to, from)). */
function adjacency(k: number, edges: readonly PathEdge[]): number[][] {
  const adj: number[][] = Array.from({ length: k }, () => []);
  for (const e of edges) adj[e.source]!.push(e.target);
  return adj;
}

/** One directed cycle (node indices, first node repeated at the end) or null. */
export function findCycle(k: number, edges: readonly PathEdge[]): number[] | null {
  const adj = adjacency(k, edges);
  const state = new Array<number>(k).fill(0);
  const stack: number[] = [];
  let found: number[] | null = null;
  const visit = (v: number): void => {
    state[v] = 1;
    stack.push(v);
    for (const w of adj[v]!) {
      if (found) return;
      if (state[w] === 1) {
        found = [...stack.slice(stack.indexOf(w)), w];
        return;
      }
      if (state[w] === 0) visit(w);
    }
    stack.pop();
    state[v] = 2;
  };
  for (let v = 0; v < k; v++) if (!found && state[v] === 0) visit(v);
  return found;
}

/** All directed paths src → tgt (node lists, source first) in a DAG, depth-first. */
export function allPaths(
  k: number,
  edges: readonly PathEdge[],
  src: number,
  tgt: number,
  limit = Infinity,
): number[][] {
  const adj = adjacency(k, edges);
  const out: number[][] = [];
  const walk = (v: number, trail: number[]): void => {
    if (out.length >= limit) return;
    for (const w of adj[v]!) {
      if (w === tgt) out.push([...trail, w]);
      else walk(w, [...trail, w]);
    }
  };
  walk(src, [src]);
  return out;
}

export interface ConnectedPair {
  source: number;
  target: number;
  direct: boolean;
  hasIndirect: boolean;
  /** enumerated chains of length ≥ 2 (node lists) */
  specific: number[][];
}

export interface EffectsSpec {
  pairs: ConnectedPair[];
  specific: { nodes: number[]; source: number; target: number; via: number[] }[];
  truncated: boolean;
}

/** Every ordered pair with at least one directed path, in construct order (R connected_pairs). */
export function effectsSpec(
  k: number,
  edges: readonly PathEdge[],
  maxSpecific = MAX_SPECIFIC_INDIRECT,
): EffectsSpec {
  const pairs: ConnectedPair[] = [];
  let nSpecific = 0;
  let truncated = false;
  for (let s = 0; s < k; s++) {
    for (let t = 0; t < k; t++) {
      if (s === t) continue;
      const ps = allPaths(k, edges, s, t);
      if (ps.length === 0) continue;
      let long = ps.filter((p) => p.length >= 3);
      if (nSpecific + long.length > maxSpecific) {
        const keep = Math.max(0, maxSpecific - nSpecific);
        truncated = truncated || keep < long.length;
        long = long.slice(0, keep);
      }
      nSpecific += long.length;
      pairs.push({
        source: s,
        target: t,
        direct: edges.some((e) => e.source === s && e.target === t),
        hasIndirect: ps.some((p) => p.length >= 3),
        specific: long,
      });
    }
  }
  const specific = pairs.flatMap((p) =>
    p.specific.map((nodes) => ({
      nodes,
      source: nodes[0]!,
      target: nodes[nodes.length - 1]!,
      via: nodes.slice(1, -1),
    })),
  );
  return { pairs, specific, truncated };
}

export interface EffectValues {
  total: number[];
  indirect: number[];
  specific: number[];
}

/** Effects for one vector of path coefficients (`pathValues[i]` belongs to `edges[i]`). */
export function computeEffects(
  k: number,
  edges: readonly PathEdge[],
  pathValues: readonly number[],
  spec: EffectsSpec,
): EffectValues {
  const B: Mat = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  edges.forEach((e, i) => (B[e.target]![e.source] = pathValues[i]!));
  const I = identity(k);
  const IminusB = I.map((row, i) => row.map((v, j) => v - B[i]![j]!));
  const inv = inverseR(IminusB);
  const T = inv.map((row, i) => row.map((v, j) => v - I[i]![j]!));
  const total = spec.pairs.map((p) => T[p.target]![p.source]!);
  const indirect = spec.pairs.map((p) => T[p.target]![p.source]! - B[p.target]![p.source]!);
  const specific = spec.specific.map((sp) => {
    let v = 1;
    for (let i = 0; i + 1 < sp.nodes.length; i++) v *= B[sp.nodes[i + 1]!]![sp.nodes[i]!]!;
    return v;
  });
  return { total, indirect, specific };
}
