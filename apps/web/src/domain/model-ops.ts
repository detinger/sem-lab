/**
 * Pure, immutable operations on the scientific model (SemModel).
 *
 * Every edit the modeler makes goes through these functions, so the rules that keep a model
 * scientifically coherent live in one tested place and never in UI event handlers.
 * Layout is NOT touched here; see features/modeler/layout for coordinates.
 */
import {
  type MeasurementKind,
  type SemConstruct,
  type SemIndicator,
  type SemModel,
  type SemRelationship,
} from '@sem-studio/contracts';

export const EMPTY_MODEL: SemModel = { constructs: [], indicators: [], relationships: [] };

// ---------------------------------------------------------------- ids

/** Lower-case ASCII slug usable inside an Id (contracts Id regex). */
export function slug(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.length > 0 ? s.slice(0, 40) : 'x';
}

export function allIds(model: SemModel): Set<string> {
  return new Set([
    ...model.constructs.map((c) => c.id),
    ...model.indicators.map((i) => i.id),
    ...model.relationships.map((r) => r.id),
  ]);
}

/** Deterministic unique id: `<prefix>_<slug>`, then `_2`, `_3`, … if taken. */
export function uniqueId(prefix: string, base: string, taken: ReadonlySet<string>): string {
  const root = `${prefix}_${slug(base)}`;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Unique display name: `base`, then `base2`, `base3`, … (names appear in generated syntax). */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

// ---------------------------------------------------------------- lookups

export const constructById = (m: SemModel, id: string): SemConstruct | undefined =>
  m.constructs.find((c) => c.id === id);
export const indicatorById = (m: SemModel, id: string): SemIndicator | undefined =>
  m.indicators.find((i) => i.id === id);
export const isConstruct = (m: SemModel, id: string): boolean =>
  m.constructs.some((c) => c.id === id);
export const isIndicator = (m: SemModel, id: string): boolean =>
  m.indicators.some((i) => i.id === id);

/** Constructs whose block contains this indicator (normally one; more = deliberate cross-loading). */
export function blocksOf(m: SemModel, indicatorId: string): SemConstruct[] {
  return m.constructs.filter((c) => c.indicatorIds.includes(indicatorId));
}

// ---------------------------------------------------------------- create

export interface NewConstruct {
  name: string;
  label?: string;
  measurement?: MeasurementKind;
}

export function addConstruct(m: SemModel, spec: NewConstruct): { model: SemModel; id: string } {
  const name = uniqueName(
    spec.name.trim() || 'LV',
    m.constructs.map((c) => c.name),
  );
  const id = uniqueId('c', name, allIds(m));
  const construct: SemConstruct = {
    id,
    name,
    ...(spec.label ? { label: spec.label } : {}),
    measurement: spec.measurement ?? 'reflective',
    indicatorIds: [],
  };
  return { model: { ...m, constructs: [...m.constructs, construct] }, id };
}

export interface NewIndicator {
  name: string;
  column?: string | null;
  scale?: { min: number; max: number };
  level?: SemIndicator['level'];
}

/** Add indicators and append them to a construct's block (in the given order). */
export function addIndicators(
  m: SemModel,
  constructId: string,
  specs: readonly NewIndicator[],
): { model: SemModel; ids: string[] } {
  if (!isConstruct(m, constructId))
    throw new Error(`addIndicators: unknown construct ${constructId}`);
  const taken = allIds(m);
  const names = m.indicators.map((i) => i.name);
  const created: SemIndicator[] = specs.map((s) => {
    const name = uniqueName(s.name.trim() || 'x', names);
    names.push(name);
    const id = uniqueId('i', name, taken);
    taken.add(id);
    return {
      id,
      name,
      column: s.column === undefined ? name : s.column,
      ...(s.scale ? { scale: s.scale } : {}),
      ...(s.level ? { level: s.level } : {}),
    };
  });
  const ids = created.map((i) => i.id);
  return {
    model: {
      ...m,
      indicators: [...m.indicators, ...created],
      constructs: m.constructs.map((c) =>
        c.id === constructId ? { ...c, indicatorIds: [...c.indicatorIds, ...ids] } : c,
      ),
    },
    ids,
  };
}

// ---------------------------------------------------------------- connect

export type ConnectionKind = 'structural' | 'covariance' | 'membership';

export type ConnectionCheck = { ok: true; kind: ConnectionKind } | { ok: false; reason: string };

/**
 * Decide what a drag from `sourceId` to `targetId` means, or why it is not allowed.
 *  - construct → construct: structural path (rejects self-loops, duplicates, and the reverse
 *    of an existing path, which would create a two-construct feedback loop);
 *  - construct ↔ indicator (either direction): assign the indicator to that block;
 *  - indicator → indicator: not a structural relationship (residual covariances are created
 *    explicitly with `kind: 'covariance'`).
 * Cycles longer than two are allowed to be drawn but are reported by the validator, because
 * nonrecursive CB models are a deliberate advanced choice (PLAN §2.1 modeling safeguards).
 */
export function checkConnection(
  m: SemModel,
  sourceId: string,
  targetId: string,
  kind?: 'covariance',
): ConnectionCheck {
  if (sourceId === targetId)
    return { ok: false, reason: 'An element cannot be connected to itself.' };
  const sc = isConstruct(m, sourceId);
  const tc = isConstruct(m, targetId);
  const si = isIndicator(m, sourceId);
  const ti = isIndicator(m, targetId);
  if (!(sc || si) || !(tc || ti)) return { ok: false, reason: 'Unknown element.' };

  if (kind === 'covariance') {
    if (!((sc && tc) || (si && ti))) {
      return {
        ok: false,
        reason: 'A covariance connects two constructs or two indicators (correlated residuals).',
      };
    }
    const exists = m.relationships.some(
      (r) =>
        r.kind === 'covariance' &&
        ((r.sourceId === sourceId && r.targetId === targetId) ||
          (r.sourceId === targetId && r.targetId === sourceId)),
    );
    return exists
      ? { ok: false, reason: 'This covariance already exists.' }
      : { ok: true, kind: 'covariance' };
  }

  if (sc && tc) {
    const has = (a: string, b: string): boolean =>
      m.relationships.some((r) => r.kind === 'structural' && r.sourceId === a && r.targetId === b);
    if (has(sourceId, targetId)) return { ok: false, reason: 'This path already exists.' };
    if (has(targetId, sourceId)) {
      return {
        ok: false,
        reason:
          'The opposite path already exists. Reciprocal paths make the model nonrecursive, which the supported estimators do not handle.',
      };
    }
    return { ok: true, kind: 'structural' };
  }
  if (si && ti) {
    return {
      ok: false,
      reason:
        'Indicators are not connected by paths. Assign each indicator to a construct instead.',
    };
  }
  const constructId = sc ? sourceId : targetId;
  const indicatorId = sc ? targetId : sourceId;
  const c = constructById(m, constructId);
  if (c?.indicatorIds.includes(indicatorId)) {
    return { ok: false, reason: 'This indicator already belongs to that construct.' };
  }
  if (blocksOf(m, indicatorId).length > 0) {
    return {
      ok: false,
      reason:
        'This indicator already measures another construct. Cross-loadings are not supported; move the indicator instead.',
    };
  }
  return { ok: true, kind: 'membership' };
}

export function connect(
  m: SemModel,
  sourceId: string,
  targetId: string,
  kind?: 'covariance',
): { model: SemModel; relationshipId?: string } {
  const check = checkConnection(m, sourceId, targetId, kind);
  if (!check.ok) throw new Error(check.reason);
  if (check.kind === 'membership') {
    const constructId = isConstruct(m, sourceId) ? sourceId : targetId;
    const indicatorId = constructId === sourceId ? targetId : sourceId;
    return { model: assignIndicator(m, indicatorId, constructId) };
  }
  const src = constructById(m, sourceId)?.name ?? indicatorById(m, sourceId)?.name ?? sourceId;
  const tgt = constructById(m, targetId)?.name ?? indicatorById(m, targetId)?.name ?? targetId;
  const id = uniqueId(check.kind === 'structural' ? 'r' : 'cov', `${src}_${tgt}`, allIds(m));
  const rel: SemRelationship =
    check.kind === 'structural'
      ? { id, kind: 'structural', sourceId, targetId }
      : { id, kind: 'covariance', sourceId, targetId };
  return { model: { ...m, relationships: [...m.relationships, rel] }, relationshipId: id };
}

/** Move an indicator into a construct's block (removing it from any other block). */
export function assignIndicator(m: SemModel, indicatorId: string, constructId: string): SemModel {
  if (!isIndicator(m, indicatorId) || !isConstruct(m, constructId)) {
    throw new Error('assignIndicator: unknown element');
  }
  return {
    ...m,
    constructs: m.constructs.map((c) => {
      const without = c.indicatorIds.filter((x) => x !== indicatorId);
      return c.id === constructId
        ? { ...c, indicatorIds: [...without, indicatorId] }
        : { ...c, indicatorIds: without };
    }),
  };
}

// ---------------------------------------------------------------- edit

export function updateConstruct(
  m: SemModel,
  id: string,
  patch: Partial<Pick<SemConstruct, 'name' | 'label' | 'measurement' | 'plsWeightingMode'>>,
): SemModel {
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('A construct name cannot be empty.');
    if (m.constructs.some((c) => c.id !== id && c.name === name)) {
      throw new Error(`Another construct is already called "${name}".`);
    }
    patch = { ...patch, name };
  }
  return {
    ...m,
    constructs: m.constructs.map((c) => (c.id === id ? dropUndefined({ ...c, ...patch }) : c)),
  };
}

export function updateIndicator(
  m: SemModel,
  id: string,
  patch: Partial<
    Pick<SemIndicator, 'name' | 'label' | 'column' | 'scale' | 'reverseScored' | 'level'>
  >,
): SemModel {
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('An indicator name cannot be empty.');
    if (m.indicators.some((i) => i.id !== id && i.name === name)) {
      throw new Error(`Another indicator is already called "${name}".`);
    }
    patch = { ...patch, name };
  }
  if (patch.scale && !(patch.scale.min < patch.scale.max)) {
    throw new Error('The scale minimum must be smaller than the maximum.');
  }
  return {
    ...m,
    indicators: m.indicators.map((i) => (i.id === id ? dropUndefined({ ...i, ...patch }) : i)),
  };
}

/** Reorder an indicator inside its block (block order matters: first reflective indicator = CB marker). */
export function moveIndicatorInBlock(
  m: SemModel,
  constructId: string,
  indicatorId: string,
  toIndex: number,
): SemModel {
  return {
    ...m,
    constructs: m.constructs.map((c) => {
      if (c.id !== constructId || !c.indicatorIds.includes(indicatorId)) return c;
      const rest = c.indicatorIds.filter((x) => x !== indicatorId);
      const at = Math.max(0, Math.min(toIndex, rest.length));
      return { ...c, indicatorIds: [...rest.slice(0, at), indicatorId, ...rest.slice(at)] };
    }),
  };
}

export function reverseStructuralPath(m: SemModel, relationshipId: string): SemModel {
  const r = m.relationships.find((x) => x.id === relationshipId);
  if (r?.kind !== 'structural') return m;
  const without = { ...m, relationships: m.relationships.filter((x) => x.id !== relationshipId) };
  const check = checkConnection(without, r.targetId, r.sourceId);
  if (!check.ok) throw new Error(check.reason);
  return {
    ...m,
    relationships: m.relationships.map((x) =>
      x.id === relationshipId ? { ...x, sourceId: r.targetId, targetId: r.sourceId } : x,
    ),
  };
}

// ---------------------------------------------------------------- delete

/**
 * Remove elements with consistent cascading:
 *  - a construct takes its block's indicators with it (they were created for it), and every
 *    relationship touching it or them;
 *  - an indicator is removed from its block and from residual covariances;
 *  - a relationship id removes just that relationship;
 *  - a derived measurement-edge id (`meas:<c>:<i>`) unassigns the indicator from that block
 *    but keeps the indicator.
 */
export function removeElements(m: SemModel, ids: Iterable<string>): SemModel {
  const req = new Set(ids);
  const constructsGone = new Set(m.constructs.filter((c) => req.has(c.id)).map((c) => c.id));
  const indicatorsGone = new Set(m.indicators.filter((i) => req.has(i.id)).map((i) => i.id));
  for (const c of m.constructs)
    if (constructsGone.has(c.id)) c.indicatorIds.forEach((i) => indicatorsGone.add(i));
  const unassign = new Map<string, Set<string>>();
  for (const id of req) {
    const match = /^meas:(.+?):(.+)$/.exec(id);
    if (match?.[1] && match[2]) {
      const set = unassign.get(match[1]) ?? new Set<string>();
      set.add(match[2]);
      unassign.set(match[1], set);
    }
  }
  const gone = (id: string): boolean => constructsGone.has(id) || indicatorsGone.has(id);
  return {
    constructs: m.constructs
      .filter((c) => !constructsGone.has(c.id))
      .map((c) => ({
        ...c,
        indicatorIds: c.indicatorIds.filter(
          (i) => !indicatorsGone.has(i) && !unassign.get(c.id)?.has(i),
        ),
      })),
    indicators: m.indicators.filter((i) => !indicatorsGone.has(i.id)),
    relationships: m.relationships.filter(
      (r) => !req.has(r.id) && !gone(r.sourceId) && !gone(r.targetId),
    ),
  };
}

// ---------------------------------------------------------------- copy / paste

export interface ModelFragment {
  constructs: SemConstruct[];
  indicators: SemIndicator[];
  relationships: SemRelationship[];
}

/** The selected constructs (with their whole blocks), selected indicators and internal relationships. */
export function extractFragment(m: SemModel, ids: Iterable<string>): ModelFragment {
  const sel = new Set(ids);
  const constructs = m.constructs.filter((c) => sel.has(c.id));
  const indicatorIds = new Set([
    ...constructs.flatMap((c) => c.indicatorIds),
    ...m.indicators.filter((i) => sel.has(i.id)).map((i) => i.id),
  ]);
  const inside = (id: string): boolean =>
    constructs.some((c) => c.id === id) || indicatorIds.has(id);
  return {
    constructs: constructs.map((c) => ({
      ...c,
      indicatorIds: c.indicatorIds.filter((i) => indicatorIds.has(i)),
    })),
    indicators: m.indicators.filter((i) => indicatorIds.has(i.id)),
    relationships: m.relationships.filter((r) => inside(r.sourceId) && inside(r.targetId)),
  };
}

/**
 * Insert a fragment with fresh ids and de-duplicated names. Returns the id mapping so the
 * caller can place pasted nodes relative to the originals. Column bindings are kept.
 */
export function pasteFragment(
  m: SemModel,
  f: ModelFragment,
): { model: SemModel; idMap: Map<string, string> } {
  const taken = allIds(m);
  const cNames = m.constructs.map((c) => c.name);
  const iNames = m.indicators.map((i) => i.name);
  const idMap = new Map<string, string>();
  const fresh = (prefix: string, name: string, old: string): string => {
    const id = uniqueId(prefix, name, taken);
    taken.add(id);
    idMap.set(old, id);
    return id;
  };
  const indicators = f.indicators.map((i) => {
    const name = uniqueName(i.name, iNames);
    iNames.push(name);
    return { ...i, id: fresh('i', name, i.id), name };
  });
  const constructs = f.constructs.map((c) => {
    const name = uniqueName(c.name, cNames);
    cNames.push(name);
    return {
      ...c,
      id: fresh('c', name, c.id),
      name,
      indicatorIds: c.indicatorIds.map((x) => idMap.get(x) ?? x),
    };
  });
  const relationships = f.relationships.map((r) => ({
    ...r,
    id: fresh(r.kind === 'structural' ? 'r' : 'cov', r.id, r.id),
    sourceId: idMap.get(r.sourceId) ?? r.sourceId,
    targetId: idMap.get(r.targetId) ?? r.targetId,
    // A pasted copy is a different parameter; a shared label would impose an equality constraint.
    parameterLabel: undefined,
  }));
  return {
    model: {
      constructs: [...m.constructs, ...constructs],
      indicators: [...m.indicators, ...indicators],
      relationships: [...m.relationships, ...relationships.map(dropUndefined)],
    },
    idMap,
  };
}

function dropUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
