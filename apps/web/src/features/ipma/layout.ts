/**
 * IPMA chart geometry: scales, ticks, reference lines and label placement. Pure, so the screen
 * chart and the exported SVG share one layout.
 */
import { median } from 'd3-array';
import { scaleLinear, type ScaleLinear } from 'd3-scale';
import type { IpmaPoint } from './data';

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const X_DOMAIN: readonly [number, number] = [0, 100];

/**
 * Y domain derived from the data. It always includes 0 (so the sign of every importance is
 * visible) and is padded and rounded to nice ticks. Never fixed to 0–1.
 */
export function yDomain(values: readonly number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  if (hi === lo) return [-1, 1];
  const span = hi - lo;
  const pad = span * 0.1;
  const min = lo < 0 ? lo - pad : 0;
  const max = hi > 0 ? hi + pad : 0;
  const [a, b] = scaleLinear().domain([min, max]).nice(6).domain() as [number, number];
  return [a, b];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export interface LabelInput {
  id: string;
  cx: number;
  cy: number;
  text: string;
  /** placed first; ties broken by input order */
  priority: number;
}

export interface PlacedLabel {
  id: string;
  rect: Rect;
  anchor: 'start' | 'middle' | 'end';
  /** text baseline position */
  tx: number;
  ty: number;
  /** leader line from the point's edge to the label when it was moved away */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

export interface LabelPlacement {
  placed: PlacedLabel[];
  hidden: string[];
}

export const LABEL_FONT = 12;
export const POINT_R = 6;
const charWidth = LABEL_FONT * 0.56;
export const textWidth = (s: string): number => Math.ceil(s.length * charWidth) + 2;

/**
 * Greedy label placement. Candidates are offsets around the point (right, left, above, below,
 * then the four corners) at three distances; the first candidate that stays inside the plot and
 * overlaps no placed label and no point wins. Labels pushed beyond the first ring get a leader
 * line. A label that fits nowhere is hidden (reported, not silently dropped).
 */
export function placeLabels(
  inputs: readonly LabelInput[],
  bounds: Rect,
  opts: { pointRadius?: number; maxLabels?: number } = {},
): LabelPlacement {
  const r = opts.pointRadius ?? POINT_R;
  const max = opts.maxLabels ?? Infinity;
  const lh = LABEL_FONT + 2;
  const obstacles: Rect[] = inputs.map((p) => ({
    x: p.cx - r - 2,
    y: p.cy - r - 2,
    w: 2 * r + 4,
    h: 2 * r + 4,
  }));
  const order = [...inputs].sort((a, b) => b.priority - a.priority);
  const placed: PlacedLabel[] = [];
  const hidden: string[] = [];
  const taken: Rect[] = [];
  for (const p of order) {
    if (placed.length >= max) {
      hidden.push(p.id);
      continue;
    }
    const w = textWidth(p.text);
    let chosen: PlacedLabel | null = null;
    outer: for (const ring of [0, 1, 2]) {
      const d = r + 4 + ring * 16;
      const cands: Array<{ rect: Rect; anchor: PlacedLabel['anchor'] }> = [
        { rect: { x: p.cx + d, y: p.cy - lh / 2, w, h: lh }, anchor: 'start' },
        { rect: { x: p.cx - d - w, y: p.cy - lh / 2, w, h: lh }, anchor: 'end' },
        { rect: { x: p.cx - w / 2, y: p.cy - d - lh, w, h: lh }, anchor: 'middle' },
        { rect: { x: p.cx - w / 2, y: p.cy + d, w, h: lh }, anchor: 'middle' },
        { rect: { x: p.cx + d * 0.75, y: p.cy - d * 0.75 - lh, w, h: lh }, anchor: 'start' },
        { rect: { x: p.cx + d * 0.75, y: p.cy + d * 0.75, w, h: lh }, anchor: 'start' },
        { rect: { x: p.cx - d * 0.75 - w, y: p.cy - d * 0.75 - lh, w, h: lh }, anchor: 'end' },
        { rect: { x: p.cx - d * 0.75 - w, y: p.cy + d * 0.75, w, h: lh }, anchor: 'end' },
      ];
      for (const c of cands) {
        const inside =
          c.rect.x >= bounds.x &&
          c.rect.y >= bounds.y &&
          c.rect.x + c.rect.w <= bounds.x + bounds.w &&
          c.rect.y + c.rect.h <= bounds.y + bounds.h;
        if (!inside) continue;
        if (taken.some((t) => overlaps(t, c.rect, 2))) continue;
        if (obstacles.some((o) => overlaps(o, c.rect))) continue;
        const tx =
          c.anchor === 'start' ? c.rect.x : c.anchor === 'end' ? c.rect.x + w : c.rect.x + w / 2;
        const ty = c.rect.y + lh - 4;
        let leader: PlacedLabel['leader'] = null;
        if (ring > 0) {
          const ex = Math.max(c.rect.x, Math.min(p.cx, c.rect.x + w));
          const ey = Math.max(c.rect.y, Math.min(p.cy, c.rect.y + lh));
          const dx = ex - p.cx;
          const dy = ey - p.cy;
          const len = Math.hypot(dx, dy) || 1;
          leader = {
            x1: p.cx + (dx / len) * r,
            y1: p.cy + (dy / len) * r,
            x2: ex,
            y2: ey,
          };
        }
        chosen = { id: p.id, rect: c.rect, anchor: c.anchor, tx, ty, leader };
        break outer;
      }
    }
    if (chosen) {
      placed.push(chosen);
      taken.push(chosen.rect);
    } else hidden.push(p.id);
  }
  return { placed, hidden };
}

export interface ChartLayout {
  width: number;
  height: number;
  plot: Rect;
  x: ScaleLinear<number, number>;
  y: ScaleLinear<number, number>;
  xTicks: number[];
  yTicks: number[];
  yDomain: [number, number];
  /** y pixel of the zero line, when the domain spans it with negatives */
  zeroY: number | null;
  hasNegative: boolean;
  dots: Array<{ point: IpmaPoint; cx: number; cy: number }>;
  labels: LabelPlacement;
  medians: { x: number; y: number } | null;
}

export interface LayoutOptions {
  width: number;
  height: number;
  margins: Margins;
  showLabels: boolean;
  /** exported figures keep every label that fits; the screen caps density */
  maxLabels?: number;
  medians: boolean;
  /** ids that must get a label first (the selected point) */
  priorityIds?: readonly string[];
}

export function formatTick(v: number): string {
  const s = Math.abs(v) < 1e-12 ? '0' : String(Number(v.toPrecision(6)));
  return s.replace('-', '−');
}

export function layoutChart(points: readonly IpmaPoint[], o: LayoutOptions): ChartLayout {
  const plot: Rect = {
    x: o.margins.left,
    y: o.margins.top,
    w: Math.max(40, o.width - o.margins.left - o.margins.right),
    h: Math.max(40, o.height - o.margins.top - o.margins.bottom),
  };
  const dom = yDomain(points.map((p) => p.importance));
  const x = scaleLinear()
    .domain([...X_DOMAIN])
    .range([plot.x, plot.x + plot.w]);
  const y = scaleLinear()
    .domain(dom)
    .range([plot.y + plot.h, plot.y]);
  const dots = points.map((p) => ({ point: p, cx: x(p.performance), cy: y(p.importance) }));
  const hasNegative = points.some((p) => p.importance < 0);
  const priority = new Set(o.priorityIds ?? []);
  const labels = o.showLabels
    ? placeLabels(
        dots.map((d, i) => ({
          id: d.point.id,
          cx: d.cx,
          cy: d.cy,
          text: d.point.label,
          priority: (priority.has(d.point.id) ? 1e6 : 0) + (points.length - i),
        })),
        plot,
        o.maxLabels !== undefined ? { maxLabels: o.maxLabels } : {},
      )
    : { placed: [], hidden: [] };
  const medX = median(points, (p) => p.performance);
  const medY = median(points, (p) => p.importance);
  return {
    width: o.width,
    height: o.height,
    plot,
    x,
    y,
    xTicks: [0, 20, 40, 60, 80, 100],
    yTicks: y.ticks(6),
    yDomain: dom,
    zeroY: hasNegative && dom[0] < 0 && dom[1] > 0 ? y(0) : null,
    hasNegative,
    dots,
    labels,
    medians: medX !== undefined && medY !== undefined ? { x: medX, y: medY } : null,
  };
}
