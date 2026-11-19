import { SemModel, validateModelStructure } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_MODEL,
  addConstruct,
  addIndicators,
  checkConnection,
  connect,
  extractFragment,
  moveIndicatorInBlock,
  pasteFragment,
  removeElements,
  reverseStructuralPath,
  slug,
  uniqueId,
  updateConstruct,
  updateIndicator,
} from './model-ops';

/** PEOU → PU → BI with PEOU → BI, three indicators each. */
function tam(): SemModel {
  let m = EMPTY_MODEL;
  const ids: Record<string, string> = {};
  for (const name of ['PEOU', 'PU', 'BI']) {
    const r = addConstruct(m, { name });
    m = r.model;
    ids[name] = r.id;
    m = addIndicators(
      m,
      r.id,
      [1, 2, 3].map((k) => ({ name: `${name.toLowerCase()}${k}` })),
    ).model;
  }
  m = connect(m, ids.PEOU!, ids.PU!).model;
  m = connect(m, ids.PU!, ids.BI!).model;
  m = connect(m, ids.PEOU!, ids.BI!).model;
  return m;
}

const valid = (m: SemModel): void => {
  expect(SemModel.safeParse(m).success).toBe(true);
  expect(validateModelStructure(m)).toEqual([]);
};

describe('ids and names', () => {
  it('slugs to the contract id alphabet', () => {
    expect(slug('Perceived Usefulness (PU)')).toBe('perceived_usefulness_pu');
    expect(slug('Ünïcödé')).toBe('unicode');
    expect(slug('***')).toBe('x');
  });
  it('generates deterministic unique ids', () => {
    expect(uniqueId('c', 'PU', new Set(['c_pu', 'c_pu_2']))).toBe('c_pu_3');
  });
  it('deduplicates names on creation', () => {
    let m = addConstruct(EMPTY_MODEL, { name: 'PU' }).model;
    const r = addConstruct(m, { name: 'PU' });
    m = r.model;
    expect(m.constructs.map((c) => c.name)).toEqual(['PU', 'PU2']);
    expect(r.id).toBe('c_pu2');
  });
});

describe('building a model', () => {
  it('produces a contract-valid model', () => {
    const m = tam();
    valid(m);
    expect(m.constructs.map((c) => c.indicatorIds.length)).toEqual([3, 3, 3]);
    expect(m.relationships.filter((r) => r.kind === 'structural')).toHaveLength(3);
  });
  it('binds new indicators to a column of the same name by default', () => {
    expect(tam().indicators[0]).toMatchObject({ name: 'peou1', column: 'peou1' });
  });
});

describe('connection rules', () => {
  const m = tam();
  const [peou, pu, bi] = m.constructs.map((c) => c.id) as [string, string, string];
  const i1 = m.constructs[0]!.indicatorIds[0]!;
  const i4 = m.constructs[1]!.indicatorIds[0]!;
  it.each([
    ['self loop', peou, peou, /itself/],
    ['duplicate path', peou, pu, /already exists/],
    ['reciprocal path', pu, peou, /opposite path/],
    ['indicator to indicator', i1, i4, /Indicators are not connected/],
    ['cross-loading', pu, i1, /already measures another construct/],
    ['re-assigning to own block', peou, i1, /already belongs/],
  ])('rejects %s', (_label, s, t, reason) => {
    const c = checkConnection(m, s, t);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(reason);
  });
  it('classifies construct→construct as structural and construct↔free indicator as membership', () => {
    const extra = addIndicators(addConstruct(m, { name: 'X' }).model, 'c_x', [{ name: 'free' }]);
    const freed = removeElements(extra.model, ['meas:c_x:i_free']);
    expect(checkConnection(freed, bi, 'c_x')).toEqual({ ok: true, kind: 'structural' });
    expect(checkConnection(freed, 'i_free', bi)).toEqual({ ok: true, kind: 'membership' });
  });
  it('only allows covariances between like elements', () => {
    expect(checkConnection(m, peou, i1, 'covariance').ok).toBe(false);
    expect(checkConnection(m, i1, i4, 'covariance')).toEqual({ ok: true, kind: 'covariance' });
    const withCov = connect(m, i1, i4, 'covariance').model;
    valid(withCov);
    expect(checkConnection(withCov, i4, i1, 'covariance').ok).toBe(false);
  });
});

describe('editing', () => {
  it('rejects empty and duplicate names', () => {
    const m = tam();
    expect(() => updateConstruct(m, m.constructs[0]!.id, { name: '  ' })).toThrow(/empty/);
    expect(() => updateConstruct(m, m.constructs[0]!.id, { name: 'PU' })).toThrow(/already called/);
    expect(() => updateIndicator(m, m.indicators[0]!.id, { scale: { min: 7, max: 1 } })).toThrow(
      /smaller/,
    );
  });
  it('flipping measurement kind keeps the block and is contract-valid', () => {
    const m = tam();
    const flipped = updateConstruct(m, m.constructs[0]!.id, { measurement: 'composite-formative' });
    valid(flipped);
    expect(flipped.constructs[0]!.indicatorIds).toEqual(m.constructs[0]!.indicatorIds);
  });
  it('reorders a block (the first reflective indicator is the CB marker)', () => {
    const m = tam();
    const c = m.constructs[0]!;
    const moved = moveIndicatorInBlock(m, c.id, c.indicatorIds[2]!, 0);
    expect(moved.constructs[0]!.indicatorIds).toEqual([
      c.indicatorIds[2],
      c.indicatorIds[0],
      c.indicatorIds[1],
    ]);
  });
  it('reverses a path only when the reverse is allowed', () => {
    const m = tam();
    const rel = m.relationships.find((r) => r.sourceId === 'c_pu' && r.targetId === 'c_bi')!;
    const rev = reverseStructuralPath(m, rel.id);
    expect(rev.relationships.find((r) => r.id === rel.id)).toMatchObject({
      sourceId: 'c_bi',
      targetId: 'c_pu',
    });
    valid(rev);
  });
});

describe('removal cascades', () => {
  it('removing a construct removes its indicators and every touching relationship', () => {
    const m = tam();
    const out = removeElements(m, ['c_pu']);
    valid(out);
    expect(out.constructs.map((c) => c.id)).toEqual(['c_peou', 'c_bi']);
    expect(out.indicators.some((i) => i.name.startsWith('pu'))).toBe(false);
    expect(out.relationships.map((r) => [r.sourceId, r.targetId])).toEqual([['c_peou', 'c_bi']]);
  });
  it('removing a derived measurement edge unassigns but keeps the indicator', () => {
    const m = tam();
    const out = removeElements(m, ['meas:c_pu:i_pu1']);
    expect(out.indicators.some((i) => i.id === 'i_pu1')).toBe(true);
    expect(out.constructs[1]!.indicatorIds).not.toContain('i_pu1');
  });
});

describe('copy and paste', () => {
  it('pastes with fresh ids and names, keeps internal paths, drops parameter labels', () => {
    const m = tam();
    const withLabel = {
      ...m,
      relationships: m.relationships.map((r) => ({ ...r, parameterLabel: 'a' + r.id.length })),
    };
    const frag = extractFragment(withLabel, ['c_peou', 'c_pu']);
    expect(frag.relationships).toHaveLength(1);
    const { model, idMap } = pasteFragment(withLabel, frag);
    expect(model.constructs.map((c) => c.name)).toEqual(['PEOU', 'PU', 'BI', 'PEOU2', 'PU2']);
    expect(idMap.get('c_peou')).toBe('c_peou2');
    const pasted = model.relationships.at(-1)!;
    expect(pasted).toMatchObject({ sourceId: 'c_peou2', targetId: 'c_pu2' });
    expect(pasted.parameterLabel).toBeUndefined();
    expect(SemModel.safeParse(model).success).toBe(true);
  });
});
