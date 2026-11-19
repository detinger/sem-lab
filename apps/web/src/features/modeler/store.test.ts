import { SemProject } from '@sem-studio/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { addConstruct, addIndicators, connect } from '@/domain/model-ops';
import { modelHash } from '@sem-studio/contracts';
import { useModeler } from './store';

const s = () => useModeler.getState();

beforeEach(() => {
  s().newProject('Test');
});

function buildTam(): void {
  s().edit((m) => {
    let x = m;
    for (const name of ['PEOU', 'PU', 'BI']) {
      const r = addConstruct(x, { name });
      x = addIndicators(
        r.model,
        r.id,
        [1, 2, 3].map((k) => ({ name: `${name}${k}` })),
      ).model;
    }
    x = connect(x, 'c_peou', 'c_pu').model;
    x = connect(x, 'c_pu', 'c_bi').model;
    return connect(x, 'c_peou', 'c_bi').model;
  });
}

describe('editing and history', () => {
  it('records one undo step per edit and supports redo', () => {
    s().edit((m) => addConstruct(m, { name: 'A' }).model);
    s().edit((m) => addConstruct(m, { name: 'B' }).model);
    expect(s().model.constructs.map((c) => c.name)).toEqual(['A', 'B']);
    s().undo();
    expect(s().model.constructs.map((c) => c.name)).toEqual(['A']);
    s().redo();
    expect(s().model.constructs.map((c) => c.name)).toEqual(['A', 'B']);
    s().undo();
    s().edit((m) => addConstruct(m, { name: 'C' }).model);
    expect(s().future).toEqual([]);
  });

  it('turns rejected edits into a message instead of throwing, without a history entry', () => {
    buildTam();
    const before = s().past.length;
    expect(s().edit((m) => connect(m, 'c_pu', 'c_peou').model)).toBe(false);
    expect(s().lastError).toMatch(/opposite path/);
    expect(s().past.length).toBe(before);
  });

  it('groups a drag into a single undo step', () => {
    buildTam();
    s().setPositions({ c_pu: { x: 0, y: 0 } });
    const steps = s().past.length;
    s().beginTransaction();
    for (let k = 1; k <= 50; k++) s().setPositions({ c_pu: { x: k, y: k } });
    s().commitTransaction();
    expect(s().past.length).toBe(steps + 1);
    expect(s().layout.nodes.c_pu).toMatchObject({ x: 50, y: 50 });
    s().undo();
    expect(s().layout.nodes.c_pu).toMatchObject({ x: 0, y: 0 });
  });

  it('prunes layout and selection when elements are removed', async () => {
    buildTam();
    await s().autoArrange();
    s().select(['c_bi', 'i_bi1']);
    s().edit((m) => ({
      ...m,
      constructs: m.constructs.filter((c) => c.id !== 'c_bi'),
      indicators: m.indicators.filter((i) => !i.id.startsWith('i_bi')),
      relationships: m.relationships.filter((r) => r.targetId !== 'c_bi'),
    }));
    expect(Object.keys(s().layout.nodes).some((k) => k.includes('bi'))).toBe(false);
    expect(s().selection).toEqual([]);
  });
});

describe('layout never changes the science', () => {
  it('auto arrange, align, distribute and pin leave the model hash unchanged', async () => {
    buildTam();
    const hash = await modelHash(s().model);
    await s().autoArrange();
    s().select(['c_peou', 'c_pu', 'c_bi']);
    s().alignSelection('top');
    s().distributeSelection('horizontal');
    s().setPinned(['c_pu'], true);
    s().setLayoutSettings({ direction: 'TB' });
    await s().autoArrange({ keepPinned: true });
    expect(await modelHash(s().model)).toBe(hash);
  });

  it('auto arrange is undoable and keeps pinned nodes', async () => {
    buildTam();
    await s().autoArrange();
    s().setPositions({ c_pu: { x: 1600, y: 1600 } });
    s().setPinned(['c_pu'], true);
    await s().autoArrange({ keepPinned: true });
    expect(s().layout.nodes.c_pu).toEqual({ x: 1600, y: 1600, pinned: true });
    s().undo();
    expect(s().layout.nodes.c_pu).toEqual({ x: 1600, y: 1600, pinned: true });
  });
});

describe('project round trip', () => {
  it('exports a contract-valid project and loads it back identically', async () => {
    buildTam();
    await s().autoArrange();
    const p = s().toProject('2026-11-19T12:00:00.000Z');
    expect(SemProject.safeParse(p).success).toBe(true);
    const json = JSON.parse(JSON.stringify(p)) as unknown;
    s().newProject('Other');
    s().load(SemProject.parse(json));
    expect(s().model).toEqual(p.model);
    expect(s().layout).toEqual(p.layout);
    expect(s().past).toEqual([]);
  });
});
