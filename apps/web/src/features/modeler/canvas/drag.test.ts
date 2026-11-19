import { describe, expect, it } from 'vitest';
import { type DragInput, type DragStart, dragPositions } from './drag';

const start: DragStart = {
  primaryId: 'a',
  start: new Map([
    ['a', { x: 96, y: 96 }],
    ['a1', { x: 0, y: 80 }], // follower indicator
    ['b', { x: 320, y: 96 }], // co-selected
  ]),
  primarySize: { width: 136, height: 72 },
  staticRects: [{ x: 800, y: 400, width: 136, height: 72 }],
};
const input = (p: Partial<DragInput>): DragInput => ({
  rawPrimary: { x: 96, y: 96 },
  grid: 16,
  snapToGrid: true,
  bypass: false,
  constrain: false,
  threshold: 6,
  ...p,
});

describe('drag positions', () => {
  it('snaps the primary to the grid and moves the whole set by the same delta', () => {
    const { positions, guides } = dragPositions(start, input({ rawPrimary: { x: 141, y: 103 } }));
    expect(positions.get('a')).toEqual({ x: 144, y: 96 });
    expect(positions.get('a1')).toEqual({ x: 48, y: 80 });
    expect(positions.get('b')).toEqual({ x: 368, y: 96 });
    expect(guides).toEqual([]);
  });
  it('lets Alt bypass snapping', () => {
    expect(
      dragPositions(start, input({ rawPrimary: { x: 141, y: 103 }, bypass: true })).positions.get(
        'a',
      ),
    ).toEqual({ x: 141, y: 103 });
  });
  it('prefers a smart guide over the grid', () => {
    // static node left edge at x=800; primary left edge dragged to 797 → guide snaps to 800, not grid 800? use 803
    const r = dragPositions(start, input({ rawPrimary: { x: 803, y: 250 } }));
    expect(r.positions.get('a')!.x).toBe(800);
    expect(r.guides.some((g) => g.axis === 'x' && g.value === 800)).toBe(true);
    expect(r.positions.get('a')!.y).toBe(256); // y snapped to grid (no guide nearby)
  });
  it('constrains to the dominant axis with Shift', () => {
    const r = dragPositions(start, input({ rawPrimary: { x: 300, y: 130 }, constrain: true }));
    expect(r.positions.get('a')).toEqual({ x: 304, y: 96 });
  });
  it('never accumulates error: repeated events give the position for the latest pointer only', () => {
    let last = { x: 0, y: 0 };
    for (let k = 0; k < 500; k++)
      last = dragPositions(start, input({ rawPrimary: { x: 96 + k * 0.37, y: 96 } })).positions.get(
        'a',
      )!;
    expect(last).toEqual({ x: 288, y: 96 }); // 96 + 184.63 = 280.63 → grid 288
  });
});
