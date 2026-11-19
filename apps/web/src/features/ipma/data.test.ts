import { NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import request from './__fixtures__/ipma-request.json';
import resultJson from './__fixtures__/ipma-result.json';
import {
  boundsSummary,
  buildPoints,
  decompose,
  itemBounds,
  keyboardOrder,
  nextIndex,
} from './data';

const model = SemModel.parse(request.model);
const result = NormalizedSemResult.parse(resultJson);
const ipma = result.ipma!;

describe('fixture', () => {
  it('is a real engine result, not a test fixture', () => {
    expect(ipma.convention).not.toMatch(/TEST FIXTURE/);
    expect(result.provenance.call).toMatch(/csem/);
  });
});

describe('path decomposition', () => {
  it('sums to the standardized total effect in the result parameters', () => {
    const d = decompose(model, result, 'c_peou', 'c_bi');
    expect(d.routes).toHaveLength(2);
    const total = result.parameters.find((p) => p.key === 'total:c_peou->c_bi')!.est!;
    expect(d.total).toBeCloseTo(total, 10);
    expect(d.supportingIds).toEqual(expect.arrayContaining(['c_peou', 'c_pu', 'c_bi', 'r_pu_bi']));
  });
  it('reports a missing coefficient instead of inventing one', () => {
    const d = decompose(model, { parameters: [] }, 'c_pu', 'c_bi');
    expect(d.total).toBeNull();
    expect(d.routes[0]!.product).toBeNull();
  });
});

describe('points', () => {
  const withIndirect = {
    ...ipma,
    constructs: [
      {
        constructId: 'c_peou',
        importance: -0.25,
        performance: 40,
        predecessor: 'indirect' as const,
      },
      { constructId: 'c_pu', importance: 0.4, performance: 60, predecessor: 'direct' as const },
    ],
  };
  it('filters direct predecessors and keeps negative importance (no abs)', () => {
    const all = buildPoints(model, withIndirect, 'constructs', 'all');
    const direct = buildPoints(model, withIndirect, 'constructs', 'direct');
    expect(all.map((p) => p.id)).toEqual(['c_pu', 'c_peou']);
    expect(direct.map((p) => p.id)).toEqual(['c_pu']);
    expect(all[1]!.importance).toBe(-0.25);
    expect(all[1]!.rank).toBe(2);
  });
  it('builds indicator points from the indicator block', () => {
    const pts = buildPoints(model, ipma, 'indicators', 'all');
    expect(pts).toHaveLength(ipma.indicators!.length);
    expect(pts.every((p) => p.kind === 'indicator')).toBe(true);
  });
  it('skips non-finite (null) values rather than plotting them', () => {
    const nulls = {
      ...ipma,
      constructs: [{ ...ipma.constructs[0]!, importance: null }, ipma.constructs[1]!],
    };
    expect(buildPoints(model, nulls, 'constructs', 'all')).toHaveLength(1);
  });
});

describe('keyboard order', () => {
  it('orders by importance, highest first', () => {
    const pts = buildPoints(model, ipma, 'constructs', 'all');
    const order = keyboardOrder([...pts].reverse());
    expect(order.map((p) => p.importance)).toEqual(
      [...order.map((p) => p.importance)].sort((a, b) => b - a),
    );
  });
  it('moves with the arrow keys and stops at the ends', () => {
    expect(nextIndex(0, 3, 'ArrowRight')).toBe(1);
    expect(nextIndex(2, 3, 'ArrowRight')).toBe(2);
    expect(nextIndex(0, 3, 'ArrowLeft')).toBe(0);
    expect(nextIndex(1, 3, 'End')).toBe(2);
    expect(nextIndex(2, 3, 'Home')).toBe(0);
  });
});

describe('item bounds', () => {
  it('summarizes original endpoints', () => {
    expect(boundsSummary(itemBounds(model, 'c_peou'))).toBe('1–7 (all 4 items)');
  });
  it('shows mixed endpoints per group', () => {
    expect(
      boundsSummary([
        { id: 'a', name: 'a', min: 1, max: 7 },
        { id: 'b', name: 'b', min: 1, max: 11 },
      ]),
    ).toBe('1–7 (1 item), 1–11 (1 item)');
  });
});
