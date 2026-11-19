import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SemModel } from '@sem-studio/contracts';
import { describe, expect, it } from 'vitest';
import {
  constructRoles,
  directedPaths,
  findCycles,
  longestPathLayers,
  predecessors,
  totalEffects,
} from './graph';
import { connect } from './model-ops';

const fixtures = join(__dirname, '..', '..', '..', '..', 'packages', 'fixtures');
const loadModel = (path: string): SemModel =>
  SemModel.parse(JSON.parse(readFileSync(join(fixtures, path), 'utf8')));
const tamMed = loadModel('synthetic/tam-mediation/model.json');
const tamV1 = SemModel.parse(
  JSON.parse(
    readFileSync(
      join(fixtures, '..', 'contracts', 'examples', 'valid', 'model.tam-v1.json'),
      'utf8',
    ),
  ),
);

describe('structural graph', () => {
  it('classifies roles', () => {
    expect(Object.fromEntries(constructRoles(tamV1))).toEqual({
      c_peou: 'exogenous',
      c_pu: 'endogenous',
      c_atu: 'endogenous',
      c_bi: 'endogenous',
      c_use: 'endogenous',
    });
  });
  it('layers by longest path', () => {
    expect(Object.fromEntries(longestPathLayers(tamV1))).toEqual({
      c_peou: 0,
      c_pu: 1,
      c_atu: 2,
      c_bi: 3,
      c_use: 4,
    });
  });
  it('enumerates directed paths and predecessors', () => {
    expect(directedPaths(tamV1, 'c_peou', 'c_bi')).toEqual([
      ['c_peou', 'c_atu', 'c_bi'],
      ['c_peou', 'c_pu', 'c_atu', 'c_bi'],
      ['c_peou', 'c_pu', 'c_bi'],
    ]);
    const p = predecessors(tamV1, 'c_bi');
    expect([...p.direct].sort()).toEqual(['c_atu', 'c_pu']);
    expect([...p.all].sort()).toEqual(['c_atu', 'c_peou', 'c_pu']);
  });
  it('finds cycles and stays total on cyclic models', () => {
    expect(findCycles(tamV1)).toEqual([]);
    const cyclic = connect(tamV1, 'c_use', 'c_pu').model;
    // PU→ATU→BI→USE→PU and PU→BI→USE→PU, each reported once from its smallest id
    expect(findCycles(cyclic)).toEqual([
      ['c_atu', 'c_bi', 'c_use', 'c_pu'],
      ['c_bi', 'c_use', 'c_pu'],
    ]);
    expect(longestPathLayers(cyclic).size).toBe(5);
  });
});

describe('total effects', () => {
  it('reproduces the synthetic TAM population decomposition (indirect .30, total .50)', () => {
    const population = JSON.parse(
      readFileSync(join(fixtures, 'synthetic/tam-mediation/population.json'), 'utf8'),
    ) as unknown;
    expect(population).toBeTruthy();
    const coef: Record<string, number> = {
      'c_peou>c_pu': 0.6,
      'c_peou>c_bi': 0.2,
      'c_pu>c_bi': 0.5,
    };
    const eff = totalEffects(tamMed, (s, t) => coef[`${s}>${t}`] ?? Number.NaN);
    const e = eff.get('c_peou')!.get('c_bi')!;
    expect(e.direct).toBeCloseTo(0.2, 12);
    expect(e.indirect).toBeCloseTo(0.3, 12);
    expect(e.total).toBeCloseTo(0.5, 12);
    expect(e.total).toBeCloseTo(e.direct + e.indirect, 15);
  });
});
