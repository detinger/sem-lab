import { describe, expect, it } from 'vitest';
import {
  type Rect,
  align,
  boundaryPoint,
  center,
  constructSize,
  distribute,
  indicatorSize,
  smartGuides,
  snap,
  wrapLabel,
} from './geometry';

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('sizing', () => {
  it('uses the STYLE minimums for short names', () => {
    expect(constructSize('PU')).toEqual({ width: 136, height: 72 });
    expect(indicatorSize('PU1')).toEqual({ width: 118, height: 34 });
    expect(indicatorSize('PU1', 'dense')).toEqual({ width: 96, height: 30 });
  });
  it('grows for long names instead of clipping, and wraps at most into 3 lines', () => {
    const s = constructSize('Behavioral Intention to Use the Information System Daily');
    expect(s.width).toBeGreaterThan(136);
    expect(s.height).toBeGreaterThan(72);
    expect(
      wrapLabel('Behavioral Intention to Use the Information System Daily', 14, 150).length,
    ).toBeLessThanOrEqual(3);
    expect(indicatorSize('VERY_LONG_INDICATOR_CODE_42').width).toBeGreaterThan(118);
  });
  it('keeps sizes on the half grid so centres snap too', () => {
    for (const n of ['PU', 'Perceived usefulness', 'Organizational identification']) {
      const s = constructSize(n);
      expect(s.width % 8).toBe(0);
      expect(s.height % 8).toBe(0);
    }
  });
});

describe('boundary points', () => {
  const e = r(0, 0, 200, 100); // centre (100, 50), a = 100, b = 50
  it('hits the ellipse exactly along the axes and diagonals', () => {
    expect(boundaryPoint(e, 'ellipse', { x: 500, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(boundaryPoint(e, 'ellipse', { x: 100, y: -300 })).toEqual({ x: 100, y: 0 });
    const p = boundaryPoint(e, 'ellipse', { x: 200, y: 100 });
    // point lies on the ellipse: ((x-100)/100)² + ((y-50)/50)² = 1
    expect(((p.x - 100) / 100) ** 2 + ((p.y - 50) / 50) ** 2).toBeCloseTo(1, 12);
  });
  it('hits the rectangle edge and honours a gap', () => {
    expect(boundaryPoint(e, 'rect', { x: 300, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(boundaryPoint(e, 'rect', { x: 300, y: 50 }, 6)).toEqual({ x: 206, y: 50 });
    const corner = boundaryPoint(e, 'rect', { x: 400, y: 200 });
    expect(corner.x === 200 || corner.y === 100).toBe(true);
  });
  it('returns the centre for a degenerate direction', () => {
    expect(boundaryPoint(e, 'ellipse', center(e))).toEqual(center(e));
  });
});

describe('grid, align and distribute', () => {
  it('snaps to the grid', () => {
    expect(snap(23, 16)).toBe(16);
    expect(snap(25, 16)).toBe(32);
  });
  const sel = new Map<string, Rect>([
    ['a', r(10, 10, 100, 40)],
    ['b', r(50, 100, 60, 40)],
    ['c', r(300, 40, 120, 80)],
  ]);
  it('aligns to the selection bounds', () => {
    expect(Object.fromEntries(align(sel, 'left'))).toEqual({
      a: { x: 10, y: 10 },
      b: { x: 10, y: 100 },
      c: { x: 10, y: 40 },
    });
    expect(align(sel, 'right').get('b')).toEqual({ x: 360, y: 100 });
    expect(align(sel, 'center').get('a')).toEqual({ x: 165, y: 10 });
    expect(align(sel, 'middle').get('c')).toEqual({ x: 300, y: 35 });
  });
  it('distributes with equal gaps and fixed endpoints', () => {
    const d = distribute(sel, 'horizontal');
    expect(d.get('a')).toEqual({ x: 10, y: 10 });
    expect(d.get('c')).toEqual({ x: 300, y: 40 });
    const gap1 = d.get('b')!.x - (d.get('a')!.x + 100);
    const gap2 = 300 - (d.get('b')!.x + 60);
    expect(gap1).toBeCloseTo(gap2, 12);
  });
  it('does nothing for too-small selections', () => {
    expect(align(new Map([['a', r(0, 0, 1, 1)]]), 'left').size).toBe(0);
    expect(
      distribute(
        new Map([
          ['a', r(0, 0, 1, 1)],
          ['b', r(5, 5, 1, 1)],
        ]),
        'vertical',
      ).size,
    ).toBe(0);
  });
});

describe('smart guides', () => {
  it('snaps a near-aligned centre and reports the guide', () => {
    const other = r(0, 0, 100, 50); // centre x 50
    const dragged = r(203, 400, 100, 50); // centre x 253 → not near; left edge 203
    const near = r(3, 400, 100, 50); // left 3 → snaps to 0
    expect(smartGuides(dragged, [other], 6).snappedX).toBe(false);
    const res = smartGuides(near, [other], 6);
    expect(res.position.x).toBe(0);
    expect(res.guides[0]).toMatchObject({ axis: 'x', value: 0, from: 0, to: 450 });
  });
});
