import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SemModel } from '@sem-studio/contracts';
import { describe, expect, it } from 'vitest';
import { type Rect, center, rectsOverlap } from '../geometry';
import {
  type LayoutParams,
  computeAutoLayout,
  foldPairs,
  mergeLayout,
  sizeOf,
} from './auto-layout';
import { routeStructural } from './routing';

const repo = join(__dirname, '..', '..', '..', '..', '..', '..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), 'utf8'));

/** Convert a third-party proposed-model.json (codes + paths) into a SemModel. */
function fromProposed(path: string): SemModel {
  const pm = readJson(path) as {
    constructs: Array<{ code: string; indicators: string[] }>;
    paths: Array<{ from: string; to: string }>;
  };
  const cid = (code: string): string => `c_${code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const iid = (name: string): string => `i_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  return SemModel.parse({
    constructs: pm.constructs.map((c) => ({
      id: cid(c.code),
      name: c.code,
      measurement: 'reflective',
      indicatorIds: c.indicators.map(iid),
    })),
    indicators: pm.constructs.flatMap((c) =>
      c.indicators.map((i) => ({ id: iid(i), name: i, column: i })),
    ),
    relationships: pm.paths.map((p, k) => ({
      id: `r_${k}`,
      kind: 'structural',
      sourceId: cid(p.from),
      targetId: cid(p.to),
    })),
  });
}

/** 15 constructs × 4 indicators in a layered DAG (STYLE §9 visual target). */
function large(): SemModel {
  const constructs = Array.from({ length: 15 }, (_, k) => ({
    id: `c_${String(k).padStart(2, '0')}`,
    name: `Construct ${k + 1}`,
    measurement: 'reflective' as const,
    indicatorIds: [1, 2, 3, 4].map((j) => `i_${k}_${j}`),
  }));
  const relationships = [];
  for (let k = 3; k < 15; k++) {
    relationships.push({
      id: `r_a${k}`,
      kind: 'structural' as const,
      sourceId: `c_${String(k - 3).padStart(2, '0')}`,
      targetId: `c_${String(k).padStart(2, '0')}`,
    });
    if (k % 2 === 0)
      relationships.push({
        id: `r_b${k}`,
        kind: 'structural' as const,
        sourceId: `c_${String(k - 2).padStart(2, '0')}`,
        targetId: `c_${String(k).padStart(2, '0')}`,
      });
  }
  return SemModel.parse({
    constructs,
    indicators: constructs.flatMap((c) =>
      c.indicatorIds.map((id) => ({ id, name: id.toUpperCase().slice(2), column: id })),
    ),
    relationships,
  });
}

const models: Record<string, SemModel> = {
  'tam-v1': SemModel.parse(readJson('packages/contracts/examples/valid/model.tam-v1.json')),
  utaut: fromProposed('packages/fixtures/third-party/smartpls-samples/utaut/proposed-model.json'),
  acsi: fromProposed(
    'packages/fixtures/third-party/smartpls-samples/acsi-2015/proposed-model.json',
  ),
  oi: fromProposed('packages/fixtures/third-party/smartpls-samples/oi/proposed-model.json'),
  'large-15x4': large(),
};
const synthDir = join(repo, 'packages/fixtures/synthetic');
for (const d of readdirSync(synthDir)) {
  if (
    existsSync(join(synthDir, d, 'model.json')) &&
    !existsSync(join(synthDir, d, 'data.csv')) === false
  ) {
    models[`synthetic/${d}`] = SemModel.parse(
      readJson(`packages/fixtures/synthetic/${d}/model.json`),
    );
  }
}

const params = (direction: LayoutParams['direction'] = 'LR'): LayoutParams => ({
  direction,
  gridSize: 16,
  constructShape: 'ellipse',
  indicatorDensity: 'default',
  collapsedConstructIds: [],
});

const rectsOf = (m: SemModel, pos: Record<string, { x: number; y: number }>): Map<string, Rect> =>
  new Map(Object.entries(pos).map(([id, q]) => [id, { ...q, ...sizeOf(m, id, params()) }]));

function shuffled(m: SemModel, seed: number): SemModel {
  // A real permutation: order by a seeded hash of each element's id.
  const key = (id: string): number => {
    let h = 2166136261 ^ seed;
    for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  const rot = <T extends { id: string }>(xs: readonly T[]): T[] =>
    [...xs].sort((a, b) => key(a.id) - key(b.id));
  return {
    constructs: rot(m.constructs),
    indicators: rot(m.indicators),
    relationships: rot(m.relationships),
  };
}

describe.each(Object.entries(models))('auto layout: %s', (_name, model) => {
  it('places every construct and indicator with no overlaps', async () => {
    const { positions } = await computeAutoLayout(model, params());
    const rects = rectsOf(model, positions);
    expect(rects.size).toBe(model.constructs.length + model.indicators.length);
    const list = [...rects];
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        expect(
          rectsOverlap(list[a]![1], list[b]![1], 4),
          `${list[a]![0]} overlaps ${list[b]![0]}`,
        ).toBe(false);
      }
  });

  it('is deterministic, including under shuffled input order', async () => {
    const ref = await computeAutoLayout(model, params());
    expect(await computeAutoLayout(model, params())).toEqual(ref);
    for (const seed of [1, 3])
      expect((await computeAutoLayout(shuffled(model, seed), params())).positions).toEqual(
        ref.positions,
      );
  });

  it.each(['LR', 'RL', 'TB', 'BT'] as const)(
    'direction %s points every structural path downstream (folded pairs stack across the flow)',
    async (dir) => {
      const { positions } = await computeAutoLayout(model, params(dir));
      const rects = rectsOf(model, positions);
      const folds = foldPairs(model);
      for (const r of model.relationships.filter((x) => x.kind === 'structural')) {
        const s = center(rects.get(r.sourceId)!);
        const t = center(rects.get(r.targetId)!);
        if (folds.get(r.targetId) === r.sourceId) {
          // v stacked on u's cross-start side, construct centres aligned on the flow axis
          const horizontal = dir === 'LR' || dir === 'RL';
          expect(horizontal ? t.y : t.x).toBeLessThan(horizontal ? s.y : s.x);
          expect(Math.abs(horizontal ? t.x - s.x : t.y - s.y)).toBeLessThanOrEqual(8);
          continue;
        }
        const forward = { LR: t.x - s.x, RL: s.x - t.x, TB: t.y - s.y, BT: s.y - t.y }[dir];
        expect(forward, `${r.sourceId}→${r.targetId} in ${dir}`).toBeGreaterThan(0);
      }
    },
  );

  it('snaps constructs to the grid and keeps each fan centred on its construct', async () => {
    const { positions, sides } = await computeAutoLayout(model, params());
    const rects = rectsOf(model, positions);
    for (const c of model.constructs) {
      expect(positions[c.id]!.x % 16).toBe(0);
      expect(positions[c.id]!.y % 16).toBe(0);
      if (c.indicatorIds.length === 0) continue;
      // The fan's bounding box is centred on the construct along the fan's axis.
      const cc = center(rects.get(c.id)!);
      const fan = c.indicatorIds.map((i) => rects.get(i)!);
      const vertical = sides[c.id] === 'before' || sides[c.id] === 'after';
      const lo = Math.min(...fan.map((r) => (vertical ? r.y : r.x)));
      const hi = Math.max(...fan.map((r) => (vertical ? r.y + r.height : r.x + r.width)));
      expect(Math.abs((lo + hi) / 2 - (vertical ? cc.y : cc.x))).toBeLessThan(0.001);
    }
  });

  it('routes structural paths around other constructs', async () => {
    const { positions } = await computeAutoLayout(model, params());
    const rects = rectsOf(model, positions);
    for (const r of model.relationships.filter((x) => x.kind === 'structural')) {
      const others = model.constructs
        .filter((c) => c.id !== r.sourceId && c.id !== r.targetId)
        .map((c) => rects.get(c.id)!);
      const route = routeStructural(
        rects.get(r.sourceId)!,
        'ellipse',
        rects.get(r.targetId)!,
        'ellipse',
        others,
      );
      expect(route.clear, `${r.sourceId}→${r.targetId} crosses another construct`).toBe(true);
    }
  });
});

describe('triangle folding', () => {
  it('folds PU onto PEOU in TAM and nothing in models without that shape', () => {
    expect(Object.fromEntries(foldPairs(models['tam-v1']!))).toEqual({ c_pu: 'c_peou' });
    expect(foldPairs(models['synthetic/pls-two-construct']!).size).toBe(0);
  });
});

describe('pinned nodes', () => {
  it('keep their coordinates and nothing overlaps them', async () => {
    const model = models['tam-v1']!;
    const computed = await computeAutoLayout(model, params());
    const current = {
      nodes: { c_pu: { x: 2000, y: 2000, pinned: true } },
      settings: {
        direction: 'LR' as const,
        gridSize: 16,
        snapToGrid: true,
        gridVisibility: 'dots' as const,
        constructShape: 'ellipse' as const,
        indicatorDensity: 'default' as const,
        collapsedConstructIds: [],
      },
    };
    const merged = mergeLayout(model, current, computed, params(), true);
    expect(merged.c_pu).toEqual({ x: 2000, y: 2000, pinned: true });
    const rects = rectsOf(model, merged);
    for (const [id, r] of rects)
      if (id !== 'c_pu') expect(rectsOverlap(r, rects.get('c_pu')!, 0), id).toBe(false);
  });
});
