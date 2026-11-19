/**
 * IPMA view model (PLAN §2.8). Pure: turns a run's `ipma` block and model into the points,
 * table rows and path decompositions the page shows. Nothing here computes importance or
 * performance; both come from the engine. Importance keeps its sign (never abs()).
 */
import type { IpmaResult, NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import { directedPaths, predecessors } from '@/domain/graph';

export type Level = 'constructs' | 'indicators';
export type Scope = 'all' | 'direct';
export type PredecessorType = 'direct' | 'indirect';

export interface IpmaPoint {
  /** construct id, or indicator id at indicator level */
  id: string;
  constructId: string;
  kind: 'construct' | 'indicator';
  label: string;
  /** longer name when the model has one */
  description: string | null;
  importance: number;
  performance: number;
  predecessor: PredecessorType;
  /** 1 = highest importance among the displayed points */
  rank: number;
}

export const constructName = (m: SemModel, id: string): string =>
  m.constructs.find((c) => c.id === id)?.name ?? id;

export function targetLabel(m: SemModel, id: string): string {
  const c = m.constructs.find((x) => x.id === id);
  return c ? (c.label ?? c.name) : id;
}

export function buildPoints(
  model: SemModel,
  ipma: IpmaResult,
  level: Level,
  scope: Scope,
): IpmaPoint[] {
  const typeOf = new Map(ipma.constructs.map((c) => [c.constructId, c.predecessor] as const));
  const raw: Array<Omit<IpmaPoint, 'rank'>> = [];
  if (level === 'indicators' && ipma.indicators) {
    for (const i of ipma.indicators) {
      if (i.importance === null || i.performance === null) continue;
      const ind = model.indicators.find((x) => x.id === i.indicatorId);
      raw.push({
        id: i.indicatorId,
        constructId: i.constructId,
        kind: 'indicator',
        label: ind?.name ?? i.indicatorId,
        description: `Indicator of ${constructName(model, i.constructId)}`,
        importance: i.importance,
        performance: i.performance,
        predecessor: typeOf.get(i.constructId) ?? 'indirect',
      });
    }
  } else {
    for (const c of ipma.constructs) {
      if (c.importance === null || c.performance === null) continue;
      const k = model.constructs.find((x) => x.id === c.constructId);
      raw.push({
        id: c.constructId,
        constructId: c.constructId,
        kind: 'construct',
        label: k?.name ?? c.constructId,
        description: k?.label && k.label !== k.name ? k.label : null,
        importance: c.importance,
        performance: c.performance,
        predecessor: c.predecessor,
      });
    }
  }
  const shown = scope === 'direct' ? raw.filter((p) => p.predecessor === 'direct') : raw;
  const order = [...shown].sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id));
  const rankOf = new Map(order.map((p, i) => [p.id, i + 1] as const));
  return order.map((p) => ({ ...p, rank: rankOf.get(p.id)! }));
}

/** Points in tab / arrow-key order: highest importance first. */
export const keyboardOrder = (points: readonly IpmaPoint[]): IpmaPoint[] =>
  [...points].sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id));

export type NavKey = 'ArrowRight' | 'ArrowDown' | 'ArrowLeft' | 'ArrowUp' | 'Home' | 'End';

/** Next index when moving with an arrow key; wraps nowhere (stops at the ends). */
export function nextIndex(current: number, count: number, key: NavKey): number {
  if (count === 0) return -1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, current + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
  }
}

// ----------------------------------------------------------------- original item bounds

export interface ItemBound {
  id: string;
  name: string;
  min: number | null;
  max: number | null;
}

export function itemBounds(model: SemModel, constructId: string): ItemBound[] {
  const c = model.constructs.find((x) => x.id === constructId);
  if (!c) return [];
  return c.indicatorIds.flatMap((id) => {
    const i = model.indicators.find((x) => x.id === id);
    return i ? [{ id, name: i.name, min: i.scale?.min ?? null, max: i.scale?.max ?? null }] : [];
  });
}

export function boundsSummary(items: readonly ItemBound[]): string {
  if (items.length === 0) return 'no items';
  const key = (b: ItemBound): string =>
    b.min === null || b.max === null ? 'not set' : `${b.min}–${b.max}`;
  const groups = new Map<string, number>();
  for (const b of items) groups.set(key(b), (groups.get(key(b)) ?? 0) + 1);
  if (groups.size === 1) {
    const [k] = [...groups.keys()];
    return `${k} (all ${items.length} item${items.length === 1 ? '' : 's'})`;
  }
  return [...groups].map(([k, n]) => `${k} (${n} item${n === 1 ? '' : 's'})`).join(', ');
}

// ----------------------------------------------------------------- path decomposition

export interface Route {
  /** construct ids from the source to the target */
  nodes: string[];
  /** path coefficients along the route; null where the parameter was not estimated */
  coefficients: Array<number | null>;
  /** product of the coefficients; null when any is missing */
  product: number | null;
  /** relationship ids of the route's edges */
  relationshipIds: string[];
}

export interface Decomposition {
  routes: Route[];
  /** sum of the route products (standardized path coefficients); null when any route is incomplete */
  total: number | null;
  /** ids to focus in the modeler: constructs on the routes and their relationships */
  supportingIds: string[];
}

export function decompose(
  model: SemModel,
  result: Pick<NormalizedSemResult, 'parameters'>,
  from: string,
  to: string,
): Decomposition {
  const coef = (s: string, t: string): number | null => {
    const p = result.parameters.find(
      (x) => x.kind === 'path' && x.sourceId === s && x.targetId === t,
    );
    return p && p.est !== null && Number.isFinite(p.est) ? p.est : null;
  };
  const rel = (s: string, t: string): string[] =>
    model.relationships
      .filter((r) => r.kind === 'structural' && r.sourceId === s && r.targetId === t)
      .map((r) => r.id);
  const routes: Route[] = directedPaths(model, from, to).map((nodes) => {
    const coefficients: Array<number | null> = [];
    const relationshipIds: string[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      coefficients.push(coef(nodes[i]!, nodes[i + 1]!));
      relationshipIds.push(...rel(nodes[i]!, nodes[i + 1]!));
    }
    const product = coefficients.some((c) => c === null)
      ? null
      : coefficients.reduce<number>((a, c) => a * (c as number), 1);
    return { nodes, coefficients, product, relationshipIds };
  });
  const total = routes.some((r) => r.product === null)
    ? null
    : routes.reduce((a, r) => a + (r.product as number), 0);
  const supporting = new Set<string>();
  for (const r of routes) {
    r.nodes.forEach((n) => supporting.add(n));
    r.relationshipIds.forEach((x) => supporting.add(x));
  }
  return { routes, total, supportingIds: [...supporting] };
}

/** The point's contributing routes, plus the indicator itself at indicator level. */
export function supportingIds(
  model: SemModel,
  result: Pick<NormalizedSemResult, 'parameters'>,
  point: IpmaPoint,
  target: string,
): string[] {
  const d = decompose(model, result, point.constructId, target);
  return point.kind === 'indicator' ? [...d.supportingIds, point.id] : d.supportingIds;
}

/** Constructs that can be an IPMA target: at least one directed path into them. */
export function eligibleTargets(model: SemModel): string[] {
  return model.constructs.filter((c) => predecessors(model, c.id).direct.size > 0).map((c) => c.id);
}

/** Indicators of constructs in the IPMA that have no declared original endpoints. */
export function missingEndpoints(model: SemModel): string[] {
  const used = new Set(model.constructs.flatMap((c) => c.indicatorIds));
  return model.indicators.filter((i) => used.has(i.id) && !i.scale).map((i) => i.id);
}
