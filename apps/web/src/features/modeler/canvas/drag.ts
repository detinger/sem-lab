/**
 * Drag behaviour (STYLE §9 "Grid and guides"), as a pure function of the drag state.
 *
 * - The whole moving set is translated by ONE delta computed from the primary (grabbed) node,
 *   so multi-selection drags keep their relative arrangement exactly.
 * - Smart guides win over grid snapping per axis; Alt/Option bypasses both; Shift constrains
 *   the movement to the dominant axis.
 * - Positions are always derived from the drag-start coordinates plus a delta, never
 *   accumulated, so no rounding error builds up over a long drag.
 */
import { type Guide, type Point, type Rect, smartGuides, snap } from '../geometry';

export interface DragStart {
  primaryId: string;
  /** drag-start positions of every node that moves (selection + followers) */
  start: ReadonlyMap<string, Point>;
  primarySize: { width: number; height: number };
  /** rects of nodes that do NOT move (guide targets) */
  staticRects: readonly Rect[];
}

export interface DragInput {
  /** where React Flow would put the primary node now (unsnapped) */
  rawPrimary: Point;
  grid: number;
  snapToGrid: boolean;
  bypass: boolean; // Alt / Option held
  constrain: boolean; // Shift held
  /** guide threshold in world px (screen px / zoom) */
  threshold: number;
}

export function dragPositions(
  s: DragStart,
  i: DragInput,
): { positions: Map<string, Point>; guides: Guide[] } {
  const origin = s.start.get(s.primaryId)!;
  let dx = i.rawPrimary.x - origin.x;
  let dy = i.rawPrimary.y - origin.y;
  if (i.constrain) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  let target = { x: origin.x + dx, y: origin.y + dy };
  let guides: Guide[] = [];
  if (!i.bypass) {
    const g = smartGuides({ ...target, ...s.primarySize }, s.staticRects, i.threshold);
    guides = g.guides.filter(
      (gd) => !(i.constrain && ((gd.axis === 'x' && dx === 0) || (gd.axis === 'y' && dy === 0))),
    );
    target = {
      x:
        g.snappedX && !(i.constrain && dx === 0)
          ? g.position.x
          : i.snapToGrid && !(i.constrain && dx === 0)
            ? snap(target.x, i.grid)
            : target.x,
      y:
        g.snappedY && !(i.constrain && dy === 0)
          ? g.position.y
          : i.snapToGrid && !(i.constrain && dy === 0)
            ? snap(target.y, i.grid)
            : target.y,
    };
  }
  const ddx = target.x - origin.x;
  const ddy = target.y - origin.y;
  const positions = new Map<string, Point>();
  for (const [id, p] of s.start) positions.set(id, { x: p.x + ddx, y: p.y + ddy });
  return { positions, guides };
}
