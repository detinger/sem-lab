/**
 * Model builder: SemModel → LISREL-style parameter table with lavaan's `sem()` default
 * free/fixed pattern (lavaan 0.6/0.7 `lavaanify` defaults):
 *
 * - marker identification: the first indicator loading of every factor is fixed to 1
 *   (auto.fix.first); `std-lv`: all loadings free, every latent (residual) variance fixed to 1;
 * - all indicator residual variances free (auto.var), except the residual of an indicator that
 *   is the only indicator of a factor and loads on nothing else, which is fixed to 0
 *   (auto.fix.single);
 * - latent (residual) variances free (marker);
 * - covariances among exogenous factors free (auto.cov.lv.x). "Exogenous" = not the target of a
 *   structural path (an isolated factor counts as exogenous);
 * - covariances among the disturbances of "pure" endogenous factors free (auto.cov.y): factors
 *   that are a target and never a source (lavaan does this; the web validator reuses this
 *   count through `cbParameterCount`);
 * - explicit covariance relationships: factor↔factor (disturbance covariance for endogenous
 *   factors) or indicator↔indicator (residual covariance); `fixedValue` fixes, a
 *   `parameterLabel` shared by several free parameters is an equality constraint;
 * - mean structure (optional): indicator intercepts free, latent means fixed to 0.
 */
import type { SemModel } from '@sem-studio/contracts';

export type MatName = 'lambda' | 'beta' | 'psi' | 'theta' | 'nu' | 'alpha';
export type EntryKind =
  'loading' | 'path' | 'covariance' | 'variance' | 'residual-variance' | 'intercept';

export interface ParamEntry {
  key: string;
  kind: EntryKind;
  mat: MatName;
  /** Matrix position. For beta: row = target (η_i), col = source (η_j). nu/alpha: col = 0. */
  row: number;
  col: number;
  /** Index into the free-parameter vector, or −1 when fixed. */
  free: number;
  /** Fixed value (meaningful when free = −1). */
  value: number;
  sourceId?: string;
  targetId?: string;
  relationshipId?: string;
  label?: string;
  /** Short location string, e.g. "lambda[3,1]" (1-based), used as rawPath. */
  where: string;
}

export interface ModelSpec {
  ovIds: string[];
  lvIds: string[];
  p: number;
  m: number;
  entries: ParamEntry[];
  npar: number;
  meanStructure: boolean;
  identification: 'marker' | 'std-lv';
  /** Per latent: target of at least one structural path. */
  endogenous: boolean[];
}

export interface SpecError {
  code: 'CAPABILITY_UNSUPPORTED' | 'REQUEST_INVALID';
  message: string;
  details?: Record<string, unknown>;
}

export function buildSpec(
  model: SemModel,
  identification: 'marker' | 'std-lv',
  meanStructure: boolean,
): { ok: true; spec: ModelSpec } | { ok: false; error: SpecError } {
  const fail = (code: SpecError['code'], message: string, details?: Record<string, unknown>) =>
    ({ ok: false, error: { code, message, ...(details ? { details } : {}) } }) as const;

  if (model.constructs.length === 0)
    return fail('REQUEST_INVALID', 'The model has no constructs.', { reason: 'empty-model' });
  for (const c of model.constructs) {
    if (c.measurement !== 'reflective')
      return fail(
        'CAPABILITY_UNSUPPORTED',
        `Construct ${c.id} is composite-formative; CB-SEM estimates common factors only and does not convert composites.`,
        { reason: 'composite-in-cb-sem', elementIds: [c.id] },
      );
    if (c.higherOrder)
      return fail('CAPABILITY_UNSUPPORTED', `Higher-order construct ${c.id} is not supported.`, {
        reason: 'higher-order',
        elementIds: [c.id],
      });
    if (c.indicatorIds.length === 0)
      return fail('REQUEST_INVALID', `Construct ${c.id} has no indicators.`, {
        reason: 'empty-block',
        elementIds: [c.id],
      });
  }

  const lvIds = model.constructs.map((c) => c.id);
  const lvIndex = new Map(lvIds.map((id, i) => [id, i]));
  const ovIds: string[] = [];
  for (const c of model.constructs)
    for (const i of c.indicatorIds) if (!ovIds.includes(i)) ovIds.push(i);
  const ovIndex = new Map(ovIds.map((id, i) => [id, i]));
  const indicatorKnown = new Set(model.indicators.map((i) => i.id));
  for (const id of ovIds)
    if (!indicatorKnown.has(id))
      return fail('REQUEST_INVALID', `Indicator ${id} is referenced but not defined.`, {
        reason: 'unknown-indicator',
        elementIds: [id],
      });
  const p = ovIds.length;
  const m = lvIds.length;

  // structural part
  const structural = model.relationships.filter((r) => r.kind === 'structural');
  const isTarget = new Array<boolean>(m).fill(false);
  const isSource = new Array<boolean>(m).fill(false);
  const adj: number[][] = lvIds.map(() => []);
  for (const r of structural) {
    const s = lvIndex.get(r.sourceId);
    const t = lvIndex.get(r.targetId);
    if (s === undefined || t === undefined)
      return fail('REQUEST_INVALID', `Structural path ${r.id} must connect two constructs.`, {
        reason: 'structural-endpoint',
        elementIds: [r.id],
      });
    if (s === t)
      return fail('REQUEST_INVALID', `Structural path ${r.id} is a self-loop.`, {
        reason: 'self-loop',
        elementIds: [r.id],
      });
    isTarget[t] = true;
    isSource[s] = true;
    adj[s]!.push(t);
  }
  const cycle = findCycle(adj);
  if (cycle)
    return fail(
      'REQUEST_INVALID',
      `The structural model contains a cycle (${cycle.map((i) => lvIds[i]).join(' → ')}); only recursive models are supported.`,
      { reason: 'structural-cycle', elementIds: cycle.map((i) => lvIds[i]!) },
    );

  const entries: ParamEntry[] = [];
  const push = (e: Omit<ParamEntry, 'free'> & { isFree: boolean }): void => {
    const { isFree, ...rest } = e;
    entries.push({ ...rest, free: isFree ? 0 : -1 });
  };

  // loadings
  const loadCount = new Map<string, number>();
  for (const c of model.constructs)
    for (const i of c.indicatorIds) loadCount.set(i, (loadCount.get(i) ?? 0) + 1);
  model.constructs.forEach((c, j) => {
    c.indicatorIds.forEach((iid, t) => {
      const i = ovIndex.get(iid)!;
      const fixed = identification === 'marker' && t === 0;
      push({
        key: `loading:${c.id}:${iid}`,
        kind: 'loading',
        mat: 'lambda',
        row: i,
        col: j,
        isFree: !fixed,
        value: fixed ? 1 : 0,
        sourceId: c.id,
        targetId: iid,
        where: `lambda[${i + 1},${j + 1}]`,
      });
    });
  });

  // structural paths
  for (const r of structural) {
    const s = lvIndex.get(r.sourceId)!;
    const t = lvIndex.get(r.targetId)!;
    push({
      key: `path:${r.sourceId}->${r.targetId}`,
      kind: 'path',
      mat: 'beta',
      row: t,
      col: s,
      isFree: r.fixedValue === undefined,
      value: r.fixedValue ?? 0,
      sourceId: r.sourceId,
      targetId: r.targetId,
      relationshipId: r.id,
      ...(r.parameterLabel ? { label: r.parameterLabel } : {}),
      where: `beta[${t + 1},${s + 1}]`,
    });
  }

  // indicator residual variances
  const singleIndicator = new Set(
    model.constructs.filter((c) => c.indicatorIds.length === 1).map((c) => c.indicatorIds[0]!),
  );
  ovIds.forEach((iid, i) => {
    const fixZero = singleIndicator.has(iid) && loadCount.get(iid) === 1;
    push({
      key: `residual-variance:${iid}`,
      kind: 'residual-variance',
      mat: 'theta',
      row: i,
      col: i,
      isFree: !fixZero,
      value: 0,
      sourceId: iid,
      targetId: iid,
      where: `theta[${i + 1},${i + 1}]`,
    });
  });

  // latent (residual) variances
  lvIds.forEach((cid, j) => {
    const endo = isTarget[j]!;
    push({
      key: `${endo ? 'residual-variance' : 'variance'}:${cid}`,
      kind: endo ? 'residual-variance' : 'variance',
      mat: 'psi',
      row: j,
      col: j,
      isFree: identification === 'marker',
      value: identification === 'marker' ? 0 : 1,
      sourceId: cid,
      targetId: cid,
      where: `psi[${j + 1},${j + 1}]`,
    });
  });

  // covariances: explicit relationships first (they override automatic ones)
  const covKey = (a: string, b: string): string => [a, b].sort().join('\u0000');
  const explicit = new Map<string, ParamEntry>();
  for (const r of model.relationships) {
    if (r.kind !== 'covariance') continue;
    const sl = lvIndex.get(r.sourceId);
    const tl = lvIndex.get(r.targetId);
    const so = ovIndex.get(r.sourceId);
    const to = ovIndex.get(r.targetId);
    let mat: MatName;
    let a: number;
    let b: number;
    if (sl !== undefined && tl !== undefined) {
      mat = 'psi';
      a = Math.max(sl, tl);
      b = Math.min(sl, tl);
    } else if (so !== undefined && to !== undefined) {
      mat = 'theta';
      a = Math.max(so, to);
      b = Math.min(so, to);
    } else
      return fail(
        'REQUEST_INVALID',
        `Covariance ${r.id} must connect two constructs or two indicators of the model.`,
        { reason: 'covariance-endpoint', elementIds: [r.id] },
      );
    if (a === b)
      return fail('REQUEST_INVALID', `Covariance ${r.id} connects an element with itself.`, {
        reason: 'self-covariance',
        elementIds: [r.id],
      });
    const k = covKey(r.sourceId, r.targetId);
    if (explicit.has(k))
      return fail('REQUEST_INVALID', `Covariance ${r.id} duplicates another covariance.`, {
        reason: 'duplicate-covariance',
        elementIds: [r.id],
      });
    const e: ParamEntry = {
      key: `covariance:${r.sourceId}~~${r.targetId}`,
      kind: 'covariance',
      mat,
      row: a,
      col: b,
      free: r.fixedValue === undefined ? 0 : -1,
      value: r.fixedValue ?? 0,
      sourceId: r.sourceId,
      targetId: r.targetId,
      relationshipId: r.id,
      ...(r.parameterLabel ? { label: r.parameterLabel } : {}),
      where: `${mat}[${a + 1},${b + 1}]`,
    };
    explicit.set(k, e);
  }
  const autoPairs: Array<[number, number]> = [];
  const exo = lvIds.map((_, j) => !isTarget[j]);
  const pureY = lvIds.map((_, j) => isTarget[j]! && !isSource[j]!);
  for (let a = 0; a < m; a++)
    for (let b = a + 1; b < m; b++)
      if ((exo[a] && exo[b]) || (pureY[a] && pureY[b])) autoPairs.push([a, b]);
  for (const [a, b] of autoPairs) {
    const k = covKey(lvIds[a]!, lvIds[b]!);
    if (explicit.has(k)) continue;
    entries.push({
      key: `covariance:${lvIds[a]}~~${lvIds[b]}`,
      kind: 'covariance',
      mat: 'psi',
      row: b,
      col: a,
      free: 0,
      value: 0,
      sourceId: lvIds[a]!,
      targetId: lvIds[b]!,
      where: `psi[${b + 1},${a + 1}]`,
    });
  }
  // explicit covariances in model order, after the automatic ones
  for (const e of explicit.values()) entries.push(e);

  if (meanStructure) {
    ovIds.forEach((iid, i) =>
      entries.push({
        key: `intercept:${iid}`,
        kind: 'intercept',
        mat: 'nu',
        row: i,
        col: 0,
        free: 0,
        value: 0,
        sourceId: iid,
        where: `nu[${i + 1}]`,
      }),
    );
    lvIds.forEach((cid, j) =>
      entries.push({
        key: `intercept:${cid}`,
        kind: 'intercept',
        mat: 'alpha',
        row: j,
        col: 0,
        free: -1,
        value: 0,
        sourceId: cid,
        where: `alpha[${j + 1}]`,
      }),
    );
  }

  // number the free parameters; equal labels share one parameter
  let npar = 0;
  const byLabel = new Map<string, number>();
  for (const e of entries) {
    if (e.free < 0) continue;
    if (e.label !== undefined) {
      const prev = byLabel.get(e.label);
      if (prev !== undefined) {
        e.free = prev;
        continue;
      }
      byLabel.set(e.label, npar);
    }
    e.free = npar++;
  }

  return {
    ok: true,
    spec: {
      ovIds,
      lvIds,
      p,
      m,
      entries,
      npar,
      meanStructure,
      identification,
      endogenous: isTarget,
    },
  };
}

function findCycle(adj: number[][]): number[] | null {
  const n = adj.length;
  const state = new Array<number>(n).fill(0);
  const stack: number[] = [];
  const visit = (u: number): number[] | null => {
    state[u] = 1;
    stack.push(u);
    for (const v of adj[u]!) {
      if (state[v] === 1) return [...stack.slice(stack.indexOf(v)), v];
      if (state[v] === 0) {
        const c = visit(v);
        if (c) return c;
      }
    }
    stack.pop();
    state[u] = 2;
    return null;
  };
  for (let u = 0; u < n; u++) {
    if (state[u] === 0) {
      const c = visit(u);
      if (c) return c;
    }
  }
  return null;
}

/** Number of observed sample moments: p(p+1)/2 (+ p with a mean structure). */
export function sampleMoments(p: number, meanStructure: boolean): number {
  return (p * (p + 1)) / 2 + (meanStructure ? p : 0);
}
