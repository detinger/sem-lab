import { beforeEach, describe, expect, it } from 'vitest';
import { addConstruct, addIndicators, connect } from '@/domain/model-ops';
import { sceneToSvg } from './export/svg-export';
import { addObservedVariables, nameFromColumn } from './indicator-dnd';
import { computeAutoLayout, sizeOf } from './layout/auto-layout';
import { observedConstructs, singleIndicatorConstructs } from './observed';
import { buildScene } from './scene';
import { useModeler } from './store';

const s = () => useModeler.getState();

beforeEach(() => {
  s().newProject('Test');
});

/** Regression-shaped path model: x1, x2 → y (each a single-indicator construct), plus a block. */
function buildPathModel(): void {
  s().edit((m) => {
    let x = m;
    for (const name of ['x1', 'x2', 'y']) {
      const r = addConstruct(x, { name });
      x = addIndicators(r.model, r.id, [{ name: `${name}_item` }]).model;
    }
    const b = addConstruct(x, { name: 'LV' });
    x = addIndicators(b.model, b.id, [{ name: 'a1' }, { name: 'a2' }]).model;
    x = connect(x, 'c_x1', 'c_y').model;
    return connect(x, 'c_x2', 'c_y').model;
  });
}

describe('observed variables (path-analysis boxes)', () => {
  it('only applies to listed constructs with exactly one indicator', () => {
    buildPathModel();
    const { model } = s();
    expect(singleIndicatorConstructs(model).sort()).toEqual(['c_x1', 'c_x2', 'c_y']);
    const set = observedConstructs(model, { observedConstructIds: ['c_x1', 'c_lv', 'gone'] });
    expect([...set]).toEqual(['c_x1']);
    expect(observedConstructs(model, {}).size).toBe(0);
  });

  it('draws an observed construct as one rectangle without its indicator or loading arrow', async () => {
    buildPathModel();
    s().setLayoutSettings({ observedConstructIds: ['c_x1', 'c_x2', 'c_y'] });
    const { model, layout } = s();
    const { positions } = await computeAutoLayout(model, layout.settings);
    const scene = buildScene(model, { ...layout, nodes: positions });
    const x1 = scene.nodes.find((n) => n.id === 'c_x1')!;
    expect(x1.shape).toBe('rect');
    expect(x1.observed).toBe(true);
    expect(scene.nodes.find((n) => n.id === 'c_lv')!.shape).toBe('ellipse');
    const ids = new Set(scene.nodes.map((n) => n.id));
    for (const hidden of ['i_x1_item', 'i_x2_item', 'i_y_item'])
      expect(ids.has(hidden)).toBe(false);
    expect(ids.has('i_a1')).toBe(true);
    expect(scene.edges.filter((e) => e.kind === 'measurement')).toHaveLength(2);
    expect(scene.edges.filter((e) => e.kind === 'structural')).toHaveLength(2);
    // Boxes are sized as boxes, smaller than the construct oval.
    expect(sizeOf(model, 'c_x1', layout.settings)).toEqual({ width: 96, height: 48 });
  });

  it('exports boxes with R² above the top-right corner', async () => {
    buildPathModel();
    s().setLayoutSettings({ observedConstructIds: ['c_y'] });
    const { model, layout } = s();
    const { positions } = await computeAutoLayout(model, layout.settings);
    const scene = buildScene(model, { ...layout, nodes: positions });
    const y = scene.nodes.find((n) => n.id === 'c_y')!;
    y.capsule = 'R² = .42';
    const doc = new DOMParser().parseFromString(
      sceneToSvg(scene, { background: 'white' }),
      'image/svg+xml',
    );
    expect(doc.querySelector('[data-id="c_y"] rect')?.getAttribute('rx')).toBe('3');
    const cap = doc.querySelector('[data-capsule="c_y"]')!;
    expect(cap.getAttribute('text-anchor')).toBe('end');
    expect(Number(cap.getAttribute('y'))).toBeLessThan(y.rect.y);
  });

  it('makes a dropped column into an observed variable in one undoable step', () => {
    const ids = addObservedVariables(['Job satisfaction', '2nd score'], { x: 100, y: 100 });
    const { model, layout } = s();
    expect(ids).toHaveLength(2);
    expect(model.constructs.map((c) => c.name)).toEqual(['Job_satisfaction', 'V2nd_score']);
    expect(model.indicators.map((i) => i.column)).toEqual(['Job satisfaction', '2nd score']);
    expect(layout.settings.observedConstructIds).toEqual(ids);
    expect(observedConstructs(model, layout.settings).size).toBe(2);
    expect(s().selection).toEqual(ids);
    // Columns already in the model are skipped.
    expect(addObservedVariables(['Job satisfaction'], { x: 0, y: 0 })).toEqual([]);
    s().undo();
    expect(s().model.constructs).toHaveLength(0);
  });

  it('turns column names into valid model names', () => {
    expect(nameFromColumn('age')).toBe('age');
    expect(nameFromColumn(' income (EUR) ')).toBe('income_EUR');
    expect(nameFromColumn('1st')).toBe('V1st');
    expect(nameFromColumn('***')).toBe('V');
  });

  it('forgets observed ids of deleted constructs', () => {
    buildPathModel();
    s().setLayoutSettings({ observedConstructIds: ['c_x1', 'c_y'] });
    s().edit((m) => ({ ...m, constructs: m.constructs.filter((c) => c.id !== 'c_x1') }));
    expect(s().layout.settings.observedConstructIds).toEqual(['c_y']);
  });
});
