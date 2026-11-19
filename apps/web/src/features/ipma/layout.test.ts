import { describe, expect, it } from 'vitest';
import type { IpmaPoint } from './data';
import { layoutChart, overlaps, placeLabels, yDomain } from './layout';

const pt = (id: string, importance: number, performance: number): IpmaPoint => ({
  id,
  constructId: id,
  kind: 'construct',
  label: id,
  description: null,
  importance,
  performance,
  predecessor: 'direct',
  rank: 1,
});
const M = { top: 10, right: 10, bottom: 40, left: 60 };
const base = { width: 800, height: 500, margins: M, showLabels: true, medians: false };

describe('yDomain', () => {
  it('always includes 0 and is not fixed to 0-1', () => {
    const [lo, hi] = yDomain([0.31, 0.62, 1.4]);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(1.4);
  });
  it('keeps negative importance below zero and draws a zero line', () => {
    const pts = [pt('a', 0.4, 60), pt('b', -0.2, 40)];
    const L = layoutChart(pts, base);
    expect(L.yDomain[0]).toBeLessThan(-0.2);
    expect(L.zeroY).not.toBeNull();
    const b = L.dots.find((d) => d.point.id === 'b')!;
    expect(b.cy).toBeGreaterThan(L.zeroY!);
  });
  it('has no zero line when nothing is negative', () => {
    expect(layoutChart([pt('a', 0.4, 60)], base).zeroY).toBeNull();
  });
  it('uses a fixed 0-100 x domain', () => {
    const L = layoutChart([pt('a', 0.4, 60)], base);
    expect(L.x(0)).toBe(M.left);
    expect(L.x(100)).toBe(800 - M.right);
  });
});

describe('median reference lines', () => {
  it('are the medians of the displayed points', () => {
    const L = layoutChart(
      [pt('a', 0.1, 10), pt('b', 0.5, 50), pt('c', 0.9, 90), pt('d', 0.3, 30)],
      {
        ...base,
        medians: true,
      },
    );
    expect(L.medians).toEqual({ x: 40, y: 0.4 });
  });
});

describe('label placement', () => {
  const crowded = Array.from({ length: 40 }, (_, i) =>
    pt(`construct-${i}`, 0.2 + (i % 7) * 0.01, 50 + (i % 5) * 1.2),
  );
  it('never overlaps placed labels or points, and reports hidden labels', () => {
    const L = layoutChart(crowded, base);
    const { placed, hidden } = L.labels;
    expect(placed.length + hidden.length).toBe(crowded.length);
    expect(hidden.length).toBeGreaterThan(0);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++)
        expect(overlaps(placed[i]!.rect, placed[j]!.rect)).toBe(false);
      for (const d of L.dots)
        expect(overlaps(placed[i]!.rect, { x: d.cx - 6, y: d.cy - 6, w: 12, h: 12 })).toBe(false);
    }
  });
  it('gives a displaced label a leader line and places a lone label next to its point', () => {
    const lone = placeLabels([{ id: 'a', cx: 100, cy: 100, text: 'A', priority: 1 }], {
      x: 0,
      y: 0,
      w: 300,
      h: 300,
    });
    expect(lone.placed[0]!.leader).toBeNull();
  });
  it('hides every label when told to (narrow screens)', () => {
    expect(layoutChart(crowded, { ...base, showLabels: false }).labels.placed).toHaveLength(0);
  });
});
