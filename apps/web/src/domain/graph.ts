/**
 * Structural-model graph algebra: roles, cycles, layering and effect paths.
 * Pure functions over SemModel; used by the validator, auto layout, IPMA and result tables.
 */
import { type SemModel } from '@sem-studio/contracts';

export interface StructuralGraph {
  nodes: string[];
  /** adjacency: source → targets (structural paths only) */
  out: Map<string, string[]>;
  in: Map<string, string[]>;
}

export function structuralGraph(m: SemModel): StructuralGraph {
  const nodes = m.constructs.map((c) => c.id);
  const out = new Map(nodes.map((n) => [n, [] as string[]]));
  const inn = new Map(nodes.map((n) => [n, [] as string[]]));
  for (const r of m.relationships) {
    if (r.kind !== 'structural' || !out.has(r.sourceId) || !inn.has(r.targetId)) continue;
    out.get(r.sourceId)!.push(r.targetId);
    inn.get(r.targetId)!.push(r.sourceId);
  }
  return { nodes, out, in: inn };
}

export type ConstructRole = 'exogenous' | 'endogenous' | 'isolated';

/** Exogenous: no incoming structural path but at least one outgoing; isolated: neither. */
export function constructRoles(m: SemModel): Map<string, ConstructRole> {
  const g = structuralGraph(m);
  return new Map(
    g.nodes.map((n) => {
      const ins = g.in.get(n)!.length;
      const outs = g.out.get(n)!.length;
      return [n, ins > 0 ? 'endogenous' : outs > 0 ? 'exogenous' : 'isolated'];
    }),
  );
}

/** Every directed cycle as a list of construct ids (Johnson-lite: DFS from each node, smallest-id start). */
export function findCycles(m: SemModel, limit = 50): string[][] {
  const g = structuralGraph(m);
  const order = [...g.nodes].sort();
  const rank = new Map(order.map((n, i) => [n, i]));
  const cycles: string[][] = [];
  for (const start of order) {
    const stack: string[] = [start];
    const onStack = new Set(stack);
    const visit = (n: string): void => {
      for (const t of g.out.get(n) ?? []) {
        if (cycles.length >= limit) return;
        if (t === start) cycles.push([...stack]);
        else if (!onStack.has(t) && rank.get(t)! > rank.get(start)!) {
          stack.push(t);
          onStack.add(t);
          visit(t);
          stack.pop();
          onStack.delete(t);
        }
      }
    };
    visit(start);
  }
  return cycles;
}

/**
 * Longest-path layering of an acyclic structural model (sources at layer 0). Constructs on a
 * cycle are layered by the DFS order encountered, deterministically, so the function is total.
 */
export function longestPathLayers(m: SemModel): Map<string, number> {
  const g = structuralGraph(m);
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (n: string): number => {
    const known = layer.get(n);
    if (known !== undefined) return known;
    if (visiting.has(n)) return 0; // cycle: break deterministically
    visiting.add(n);
    const preds = [...(g.in.get(n) ?? [])].sort();
    const d = preds.length === 0 ? 0 : Math.max(...preds.map((p) => depth(p) + 1));
    visiting.delete(n);
    layer.set(n, d);
    return d;
  };
  [...g.nodes].sort().forEach(depth);
  return layer;
}

/** All simple directed paths from `from` to `to` (each a list of construct ids, inclusive). */
export function directedPaths(m: SemModel, from: string, to: string, limit = 1000): string[][] {
  const g = structuralGraph(m);
  const paths: string[][] = [];
  const walk = (n: string, trail: string[]): void => {
    if (paths.length >= limit) return;
    if (n === to) {
      paths.push(trail);
      return;
    }
    for (const t of [...(g.out.get(n) ?? [])].sort())
      if (!trail.includes(t)) walk(t, [...trail, t]);
  };
  walk(from, [from]);
  return paths;
}

/** Constructs with at least one directed path into `target` (its legitimate IPMA predecessors). */
export function predecessors(
  m: SemModel,
  target: string,
): { direct: Set<string>; all: Set<string> } {
  const g = structuralGraph(m);
  const direct = new Set(g.in.get(target) ?? []);
  const all = new Set<string>();
  const stack = [...direct];
  while (stack.length) {
    const n = stack.pop()!;
    if (all.has(n) || n === target) continue;
    all.add(n);
    stack.push(...(g.in.get(n) ?? []));
  }
  return { direct, all };
}

/**
 * Total effect of every construct on every other, from a map of direct path coefficients:
 * T = B + B² + … = (I − B)⁻¹ − I for an acyclic model (computed by summing over simple paths,
 * which is exact for recursive models and avoids a matrix inverse).
 * `coef(src, tgt)` returns the estimated path coefficient.
 */
export function totalEffects(
  m: SemModel,
  coef: (src: string, tgt: string) => number,
): Map<string, Map<string, { total: number; direct: number; indirect: number }>> {
  const g = structuralGraph(m);
  const out = new Map<string, Map<string, { total: number; direct: number; indirect: number }>>();
  for (const s of g.nodes) {
    const row = new Map<string, { total: number; direct: number; indirect: number }>();
    for (const t of g.nodes) {
      if (s === t) continue;
      const paths = directedPaths(m, s, t);
      if (paths.length === 0) continue;
      let direct = 0;
      let indirect = 0;
      for (const p of paths) {
        let prod = 1;
        for (let k = 0; k + 1 < p.length; k++) prod *= coef(p[k]!, p[k + 1]!);
        if (p.length === 2) direct += prod;
        else indirect += prod;
      }
      row.set(t, { total: direct + indirect, direct, indirect });
    }
    out.set(s, row);
  }
  return out;
}
