/**
 * Structural path routing: straight when the straight line is clear, otherwise the gentlest
 * quadratic curve that clears every other node (STYLE §9: "prefer orthogonal / gently curved
 * segments … minimize crossings and overlap"). Deterministic: candidates are tried in a fixed
 * order and ties never depend on input order.
 */
import {
  type NodeShape,
  type Point,
  type Rect,
  boundaryPoint,
  center,
  curvedConnector,
  quadAt,
} from '../geometry';

export interface RoutedPath {
  start: Point;
  end: Point;
  /** quadratic control point (gentle bend) */
  control?: Point;
  /** cubic control points (S-curve between facing sides) */
  cubic?: [Point, Point];
  /** where to put the coefficient / hypothesis label */
  labelAt: Point;
  bend: number;
  /** false when no candidate curve cleared every obstacle (the least-crossing one is returned) */
  clear: boolean;
}

const GENTLE = [36, -36, 72, -72, 112, -112];
const STRONG = [160, -160, 220, -220, 300, -300, 400, -400];
const SAMPLES = 24;
const ANCHORS = [0.5, 0.3, 0.7];

function cubicAt(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

interface Candidate {
  path: RoutedPath;
  samples: Point[];
}

function segmentHitsRect(a: Point, b: Point, r: Rect, pad: number): boolean {
  const rx = r.x - pad;
  const ry = r.y - pad;
  const rw = r.width + 2 * pad;
  const rh = r.height + 2 * pad;
  // Liang–Barsky clipping
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: Array<[number, number]> = [
    [-dx, a.x - rx],
    [dx, rx + rw - a.x],
    [-dy, a.y - ry],
    [dy, ry + rh - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

function polylineHits(points: readonly Point[], obstacles: readonly Rect[], pad: number): number {
  let hits = 0;
  for (const r of obstacles) {
    for (let k = 0; k + 1 < points.length; k++) {
      if (segmentHitsRect(points[k]!, points[k + 1]!, r, pad)) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

export function routeStructural(
  from: Rect,
  fromShape: NodeShape,
  to: Rect,
  toShape: NodeShape,
  obstacles: readonly Rect[],
  arrowGap = 2,
): RoutedPath {
  const a = center(from);
  const b = center(to);

  const straight = (): Candidate => {
    const start = boundaryPoint(from, fromShape, b);
    const end = boundaryPoint(to, toShape, a, arrowGap);
    const path = {
      start,
      end,
      labelAt: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      bend: 0,
      clear: true,
    };
    return { path, samples: [boundaryPoint(from, fromShape, b), boundaryPoint(to, toShape, a)] };
  };
  const quad = (bend: number, at: number): Candidate => {
    const c = curvedConnector(from, fromShape, to, toShape, bend, at);
    const end = boundaryPoint(to, toShape, c.control, arrowGap);
    return {
      path: {
        start: c.start,
        end,
        control: c.control,
        labelAt: quadAt(c.start, c.control, end, 0.5),
        bend,
        clear: true,
      },
      samples: Array.from({ length: SAMPLES + 1 }, (_, i) =>
        quadAt(c.start, c.control, c.end, i / SAMPLES),
      ),
    };
  };
  /** Leave the source from the side facing the target and enter the target from its facing side. */
  const sCurve = (axis: 'h' | 'v'): Candidate => {
    const dir = axis === 'h' ? Math.sign(b.x - a.x) || 1 : Math.sign(b.y - a.y) || 1;
    const out = axis === 'h' ? { x: a.x + dir * 1e4, y: a.y } : { x: a.x, y: a.y + dir * 1e4 };
    const into = axis === 'h' ? { x: b.x - dir * 1e4, y: b.y } : { x: b.x, y: b.y - dir * 1e4 };
    const start = boundaryPoint(from, fromShape, out);
    const tip = boundaryPoint(to, toShape, into);
    const end = boundaryPoint(to, toShape, into, arrowGap);
    const k = Math.max(
      40,
      (axis === 'h' ? Math.abs(tip.x - start.x) : Math.abs(tip.y - start.y)) * 0.5,
    );
    const c1 =
      axis === 'h' ? { x: start.x + dir * k, y: start.y } : { x: start.x, y: start.y + dir * k };
    const c2 = axis === 'h' ? { x: end.x - dir * k, y: end.y } : { x: end.x, y: end.y - dir * k };
    return {
      path: {
        start,
        end,
        cubic: [c1, c2],
        labelAt: cubicAt(start, c1, c2, end, 0.5),
        bend: 0,
        clear: true,
      },
      samples: Array.from({ length: SAMPLES + 1 }, (_, i) =>
        cubicAt(start, c1, c2, tip, i / SAMPLES),
      ),
    };
  };

  const horizontalFirst = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const candidates: Array<() => Candidate> = [
    straight,
    ...GENTLE.flatMap((bend) => ANCHORS.map((at) => () => quad(bend, at))),
    () => sCurve(horizontalFirst ? 'h' : 'v'),
    () => sCurve(horizontalFirst ? 'v' : 'h'),
    ...STRONG.flatMap((bend) => ANCHORS.map((at) => () => quad(bend, at))),
  ];
  let best: { c: Candidate; hits: number } | null = null;
  for (const make of candidates) {
    const c = make();
    const hits = polylineHits(c.samples, obstacles, 6);
    if (!best || hits < best.hits) best = { c, hits };
    if (hits === 0) break;
  }
  return { ...best!.c.path, clear: best!.hits === 0 };
}

/** SVG path data for a routed path. */
export function pathData(r: RoutedPath): string {
  const f = (n: number): string => (Math.round(n * 100) / 100).toString();
  const m = `M ${f(r.start.x)} ${f(r.start.y)}`;
  if (r.cubic) {
    const [c1, c2] = r.cubic;
    return `${m} C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(r.end.x)} ${f(r.end.y)}`;
  }
  return r.control
    ? `${m} Q ${f(r.control.x)} ${f(r.control.y)} ${f(r.end.x)} ${f(r.end.y)}`
    : `${m} L ${f(r.end.x)} ${f(r.end.y)}`;
}
