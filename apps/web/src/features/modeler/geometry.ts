/**
 * Diagram geometry shared by the React Flow canvas, auto layout and the SVG/PNG exporter.
 * Pure functions, no DOM: the same input gives the same coordinates everywhere, which is
 * what makes "export matches canvas" and deterministic layout testable.
 *
 * Coordinates are world coordinates; a node position (x, y) is its TOP-LEFT corner, as in
 * React Flow. Sizes follow STYLE.md §8.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Point, Size {}

export type NodeShape = 'ellipse' | 'rounded-rect' | 'rect';

// ---------------------------------------------------------------- sizing

export const CONSTRUCT_MIN: Size = { width: 136, height: 72 };
export const INDICATOR_SIZE: Record<'default' | 'dense', Size> = {
  default: { width: 118, height: 34 },
  dense: { width: 96, height: 30 },
};

/**
 * Approximate advance widths (in em) for Inter. Used instead of canvas measureText so that
 * layout is identical in tests, in every browser and in exports. Deliberately generous:
 * a node that is a little too wide is fine, a clipped label is not.
 */
const NARROW = new Set("iIl.,:;|!'`()[]{}fjrt1 ");
const WIDE = new Set('MWmw@%&');
function textWidthEm(text: string, weight: 600 | 650): number {
  let em = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.34;
    else if (WIDE.has(ch)) em += 0.92;
    else if (ch >= 'A' && ch <= 'Z') em += 0.7;
    else if (ch >= '0' && ch <= '9') em += 0.62;
    else em += 0.6;
  }
  return em * (weight === 650 ? 1.03 : 1);
}
export function estimateTextWidth(text: string, fontSize: number, weight: 600 | 650 = 600): number {
  return Math.ceil(textWidthEm(text, weight) * fontSize);
}

/** Split a construct name into at most 3 lines of roughly `maxWidth` px (words never cut). */
export function wrapLabel(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines = 3,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (
      line &&
      estimateTextWidth(candidate, fontSize, 650) > maxWidth &&
      lines.length < maxLines - 1
    ) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const GRID = 16;
const ceilTo = (v: number, step: number): number => Math.ceil(v / step) * step;

/**
 * Construct size: at least 136×72, grown to fit up to three lines of 14px/650 text inside
 * the ellipse. Text in an ellipse needs ~1/√2 of the axis, hence the 1.42 factor. Sizes are
 * multiples of the grid so snapped nodes align on their centres too.
 */
export function constructSize(
  name: string,
  shape: 'ellipse' | 'rounded' = 'ellipse',
  extraLine = false,
): Size {
  const lines = wrapLabel(name, 14, 150);
  const textW = Math.max(...lines.map((l) => estimateTextWidth(l, 14, 650)));
  const factor = shape === 'ellipse' ? 1.42 : 1.0;
  const pad = shape === 'ellipse' ? 16 : 28;
  const textH = lines.length * 18 + (extraLine ? 16 : 0);
  return {
    width: Math.max(CONSTRUCT_MIN.width, ceilTo(textW * factor + pad, GRID / 2)),
    height: Math.max(CONSTRUCT_MIN.height, ceilTo(textH * factor + 12, GRID / 2)),
  };
}

export function indicatorSize(name: string, density: 'default' | 'dense' = 'default'): Size {
  const base = INDICATOR_SIZE[density];
  return {
    width: Math.max(base.width, ceilTo(estimateTextWidth(name, 12) + 20, GRID / 2)),
    height: base.height,
  };
}

// ---------------------------------------------------------------- boundaries

export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/**
 * Point where the ray from the shape's centre towards `toward` leaves the shape boundary.
 * Ellipse: exact. Rectangle: exact. Rounded rectangle: treated as its rectangle (radius 6px
 * is below a visible error at normal zoom).
 */
export function boundaryPoint(r: Rect, shape: NodeShape, toward: Point, gap = 0): Point {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const a = r.width / 2 + gap;
  const b = r.height / 2 + gap;
  let t: number;
  if (shape === 'ellipse') {
    t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
  } else {
    const tx = dx === 0 ? Number.POSITIVE_INFINITY : a / Math.abs(dx);
    const ty = dy === 0 ? Number.POSITIVE_INFINITY : b / Math.abs(dy);
    t = Math.min(tx, ty);
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Straight connector between two shapes, ending `endGap` px before the target outline (room for the arrowhead). */
export function connector(
  from: Rect,
  fromShape: NodeShape,
  to: Rect,
  toShape: NodeShape,
  endGap = 0,
): { start: Point; end: Point } {
  return {
    start: boundaryPoint(from, fromShape, center(to)),
    end: boundaryPoint(to, toShape, center(from), endGap),
  };
}

/**
 * Gently curved connector for covariances (double-headed) and for separating parallel paths.
 * Returns a quadratic Bézier control point offset perpendicular to the chord by `bend` px
 * (positive = left of the direction of travel).
 */
export function curvedConnector(
  from: Rect,
  fromShape: NodeShape,
  to: Rect,
  toShape: NodeShape,
  bend: number,
  /** where along the chord the curve bulges (0.5 = symmetric; <0.5 near the source) */
  at = 0.5,
): { start: Point; control: Point; end: Point } {
  const a = center(from);
  const b = center(to);
  const mx = a.x + (b.x - a.x) * at;
  const my = a.y + (b.y - a.y) * at;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const control = { x: mx + nx * bend, y: my + ny * bend };
  return {
    start: boundaryPoint(from, fromShape, control),
    control,
    end: boundaryPoint(to, toShape, control),
  };
}

/** Point at parameter t on a quadratic Bézier. */
export function quadAt(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

// ---------------------------------------------------------------- grid, align, distribute

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}
export function snapPoint(p: Point, grid: number): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** New top-left positions aligning the given rects to the selection's bounding box edge/centre. */
export function align(rects: ReadonlyMap<string, Rect>, mode: AlignMode): Map<string, Point> {
  const rs = [...rects.values()];
  const out = new Map<string, Point>();
  if (rs.length < 2) return out;
  const minX = Math.min(...rs.map((r) => r.x));
  const maxX = Math.max(...rs.map((r) => r.x + r.width));
  const minY = Math.min(...rs.map((r) => r.y));
  const maxY = Math.max(...rs.map((r) => r.y + r.height));
  for (const [id, r] of rects) {
    switch (mode) {
      case 'left':
        out.set(id, { x: minX, y: r.y });
        break;
      case 'right':
        out.set(id, { x: maxX - r.width, y: r.y });
        break;
      case 'center':
        out.set(id, { x: (minX + maxX) / 2 - r.width / 2, y: r.y });
        break;
      case 'top':
        out.set(id, { x: r.x, y: minY });
        break;
      case 'bottom':
        out.set(id, { x: r.x, y: maxY - r.height });
        break;
      case 'middle':
        out.set(id, { x: r.x, y: (minY + maxY) / 2 - r.height / 2 });
        break;
    }
  }
  return out;
}

/**
 * Equalise the gaps between ≥3 rects along an axis, keeping the two outermost in place
 * (STYLE §9 "preserve endpoints"). Ties in position are broken by id for determinism.
 */
export function distribute(
  rects: ReadonlyMap<string, Rect>,
  axis: 'horizontal' | 'vertical',
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (rects.size < 3) return out;
  const pos = axis === 'horizontal' ? (r: Rect) => r.x : (r: Rect) => r.y;
  const len = axis === 'horizontal' ? (r: Rect) => r.width : (r: Rect) => r.height;
  const sorted = [...rects].sort(([ia, a], [ib, b]) => pos(a) - pos(b) || (ia < ib ? -1 : 1));
  const first = sorted[0]![1];
  const last = sorted.at(-1)![1];
  const span = pos(last) + len(last) - pos(first);
  const gap = (span - sorted.reduce((s, [, r]) => s + len(r), 0)) / (sorted.length - 1);
  let cursor = pos(first);
  for (const [id, r] of sorted) {
    out.set(id, axis === 'horizontal' ? { x: cursor, y: r.y } : { x: r.x, y: cursor });
    cursor += len(r) + gap;
  }
  return out;
}

export function boundsOf(rects: Iterable<Rect>): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return Number.isFinite(minX)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : null;
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

// ---------------------------------------------------------------- smart guides

export interface Guide {
  axis: 'x' | 'y';
  /** world coordinate of the guide line */
  value: number;
  /** extent to draw */
  from: number;
  to: number;
}

/**
 * Snap a dragged rect to the edges/centres of other rects within `threshold` px.
 * Returns the adjusted top-left and the guides to show. Alignment snapping takes precedence
 * over grid snapping on each axis independently (a guide match is the user's intent).
 */
export function smartGuides(
  dragged: Rect,
  others: readonly Rect[],
  threshold: number,
): { position: Point; guides: Guide[]; snappedX: boolean; snappedY: boolean } {
  const xs = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width];
  const ys = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height];
  let best: { dx: number; value: number; target: Rect } | null = null;
  let bestY: { dy: number; value: number; target: Rect } | null = null;
  for (const o of others) {
    for (const ox of xs(o))
      for (const dxv of xs(dragged)) {
        const d = ox - dxv;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.dx)))
          best = { dx: d, value: ox, target: o };
      }
    for (const oy of ys(o))
      for (const dyv of ys(dragged)) {
        const d = oy - dyv;
        if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.dy)))
          bestY = { dy: d, value: oy, target: o };
      }
  }
  const position = { x: dragged.x + (best?.dx ?? 0), y: dragged.y + (bestY?.dy ?? 0) };
  const moved = { ...dragged, ...position };
  const guides: Guide[] = [];
  if (best)
    guides.push({
      axis: 'x',
      value: best.value,
      from: Math.min(moved.y, best.target.y),
      to: Math.max(moved.y + moved.height, best.target.y + best.target.height),
    });
  if (bestY)
    guides.push({
      axis: 'y',
      value: bestY.value,
      from: Math.min(moved.x, bestY.target.x),
      to: Math.max(moved.x + moved.width, bestY.target.x + bestY.target.width),
    });
  return { position, guides, snappedX: best !== null, snappedY: bestY !== null };
}
