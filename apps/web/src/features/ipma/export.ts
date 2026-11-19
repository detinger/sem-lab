/**
 * IPMA figure export: a self-contained SVG with title, axes with units, legend and a
 * method/target footnote, in fixed publication colours (not the UI theme). PNG goes through the
 * modeler's svgToPng at the preset's own pixel size. All text is escaped.
 */
import { escapeXml } from '../modeler/export/svg-export';
import type { IpmaPoint } from './data';
import { FOOTNOTE } from './text';
import { LABEL_FONT, POINT_R, formatTick, layoutChart } from './layout';

export const FONT = "Inter, 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";
/** Category colours in fixed publication values; the screen uses the same hues from CSS tokens. */
export const PALETTE = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#8a5fc7',
  '#c9477e',
  '#b98a00',
  '#1496b8',
  '#6b7787',
] as const;

export type ExportPreset = 'widescreen' | 'square' | 'academic';
export const PRESET_LABELS: Record<ExportPreset, string> = {
  widescreen: '16:9 (1600 × 900 px)',
  square: 'Square (1200 × 1200 px)',
  academic: 'Academic figure (about 1800 × 1200 px)',
};

export function presetSize(p: ExportPreset, pointCount: number): { w: number; h: number } {
  if (p === 'widescreen') return { w: 1600, h: 900 };
  if (p === 'square') return { w: 1200, h: 1200 };
  // content-aware: more points get more height for label room
  return { w: 1800, h: Math.round(Math.min(1300, Math.max(1000, 900 + 12 * pointCount))) };
}

export const shapePath = (
  kind: IpmaPoint['predecessor'],
  cx: number,
  cy: number,
  r: number,
): string => {
  const n = (v: number): string => String(Math.round(v * 100) / 100);
  if (kind === 'direct')
    return `M${n(cx - r)},${n(cy)}a${n(r)},${n(r)} 0 1,0 ${n(2 * r)},0a${n(r)},${n(r)} 0 1,0 ${n(-2 * r)},0z`;
  const d = r * 1.3;
  return `M${n(cx)},${n(cy - d)}L${n(cx + d)},${n(cy)}L${n(cx)},${n(cy + d)}L${n(cx - d)},${n(cy)}z`;
};

export interface SvgInput {
  points: readonly IpmaPoint[];
  /** construct ids in model order; index picks the palette colour */
  colorIndex: ReadonlyMap<string, number>;
  /** legend names for constructs present in `points` */
  constructNames: ReadonlyMap<string, string>;
  targetName: string;
  methodLine: string;
  preset: ExportPreset;
  background: 'white' | 'transparent';
  medians: boolean;
}

const INK = '#22242a';
const MUTED = '#4b5867';
const GRID = '#e1e0d9';
const AXIS = '#9a9a90';

const f = (n: number): string => String(Math.round(n * 100) / 100);

function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).trim().length > maxChars) {
      out.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}

export function ipmaSvg(input: SvgInput): string {
  const { w: W, h: H } = presetSize(input.preset, input.points.length);
  const s = W / 1600; // type scales with the canvas so a 1200 px square stays legible
  const padX = 48 * s;
  const headerH = 96 * s;
  const footLines = wrap(`${FOOTNOTE} ${input.methodLine}`, Math.floor((W - 2 * padX) / (7.2 * s)));
  const legendNames = [...new Set(input.points.map((p) => p.constructId))];
  const footerH = (64 + 20 * footLines.length) * s + 30 * s;
  const L = layoutChart(input.points, {
    width: W,
    height: H - headerH - footerH,
    margins: { top: 16 * s, right: 48 * s, bottom: 64 * s, left: 96 * s },
    showLabels: true,
    medians: input.medians,
  });
  const colour = (id: string): string => PALETTE[(input.colorIndex.get(id) ?? 0) % PALETTE.length]!;
  const R = POINT_R * 1.15 * s;
  const fs = (n: number): string => f(n * s);
  const o: string[] = [];
  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${escapeXml(FONT)}">`,
    `<title>${escapeXml(`IPMA, target ${input.targetName}`)}</title>`,
  );
  if (input.background === 'white') o.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  o.push(
    `<text x="${f(padX)}" y="${f(44 * s)}" font-size="${fs(26)}" font-weight="700" fill="${INK}">${escapeXml(`Importance-performance map — target: ${input.targetName}`)}</text>`,
    `<text x="${f(padX)}" y="${f(72 * s)}" font-size="${fs(15)}" fill="${MUTED}">${escapeXml('Importance = total effect on the target; performance = 0–100 score from original scale endpoints')}</text>`,
  );
  o.push(`<g transform="translate(0 ${f(headerH)})">`);
  const { plot, x, y } = L;
  // grid
  for (const t of L.yTicks)
    o.push(
      `<line x1="${f(plot.x)}" x2="${f(plot.x + plot.w)}" y1="${f(y(t))}" y2="${f(y(t))}" stroke="${GRID}" stroke-width="1"/>`,
      `<text x="${f(plot.x - 10 * s)}" y="${f(y(t) + 4 * s)}" text-anchor="end" font-size="${fs(13)}" fill="${MUTED}">${formatTick(t)}</text>`,
    );
  for (const t of L.xTicks)
    o.push(
      `<line y1="${f(plot.y)}" y2="${f(plot.y + plot.h)}" x1="${f(x(t))}" x2="${f(x(t))}" stroke="${GRID}" stroke-width="1"/>`,
      `<text x="${f(x(t))}" y="${f(plot.y + plot.h + 22 * s)}" text-anchor="middle" font-size="${fs(13)}" fill="${MUTED}">${t}</text>`,
    );
  o.push(
    `<rect x="${f(plot.x)}" y="${f(plot.y)}" width="${f(plot.w)}" height="${f(plot.h)}" fill="none" stroke="${AXIS}"/>`,
  );
  if (L.zeroY !== null)
    o.push(
      `<line x1="${f(plot.x)}" x2="${f(plot.x + plot.w)}" y1="${f(L.zeroY)}" y2="${f(L.zeroY)}" stroke="${INK}" stroke-width="1.5"/>`,
    );
  if (input.medians && L.medians) {
    const mx = x(L.medians.x);
    const my = y(L.medians.y);
    o.push(
      `<line x1="${f(mx)}" x2="${f(mx)}" y1="${f(plot.y)}" y2="${f(plot.y + plot.h)}" stroke="${MUTED}" stroke-dasharray="2 4" stroke-width="1.5"/>`,
      `<line x1="${f(plot.x)}" x2="${f(plot.x + plot.w)}" y1="${f(my)}" y2="${f(my)}" stroke="${MUTED}" stroke-dasharray="2 4" stroke-width="1.5"/>`,
      `<text x="${f(plot.x + plot.w - 6 * s)}" y="${f(my + 16 * s)}" text-anchor="end" font-size="${fs(12)}" fill="${MUTED}">Median of displayed ${input.points[0]?.kind === 'indicator' ? 'indicators' : 'constructs'}</text>`,
    );
  }
  // axis titles
  o.push(
    `<text x="${f(plot.x + plot.w / 2)}" y="${f(plot.y + plot.h + 52 * s)}" text-anchor="middle" font-size="${fs(15)}" font-weight="600" fill="${INK}">Performance (0–100)</text>`,
    `<text transform="translate(${f(28 * s)} ${f(plot.y + plot.h / 2)}) rotate(-90)" text-anchor="middle" font-size="${fs(15)}" font-weight="600" fill="${INK}">${escapeXml(`Importance (total effect on ${input.targetName})`)}</text>`,
  );
  // leader lines, points, labels
  for (const l of L.labels.placed)
    if (l.leader)
      o.push(
        `<line x1="${f(l.leader.x1)}" y1="${f(l.leader.y1)}" x2="${f(l.leader.x2)}" y2="${f(l.leader.y2)}" stroke="${AXIS}" stroke-width="1"/>`,
      );
  for (const d of L.dots)
    o.push(
      `<path d="${shapePath(d.point.predecessor, d.cx, d.cy, R)}" fill="${colour(d.point.constructId)}" stroke="#ffffff" stroke-width="${fs(2)}"/>`,
    );
  for (const l of L.labels.placed) {
    const p = input.points.find((q) => q.id === l.id)!;
    o.push(
      `<text x="${f(l.tx)}" y="${f(l.ty)}" text-anchor="${l.anchor}" font-size="${fs(LABEL_FONT + 1)}" fill="${INK}">${escapeXml(p.label)}</text>`,
    );
  }
  o.push('</g>');
  // legend + footnote
  let ly = headerH + (H - headerH - footerH) + 20 * s;
  let lx = padX;
  const itemGap = 28 * s;
  const legendItem = (shape: string, text: string): void => {
    const width = (text.length * 7.4 + 30) * s;
    if (lx + width > W - padX) {
      lx = padX;
      ly += 24 * s;
    }
    o.push(
      shape.replace('%X%', f(lx + 8 * s)).replace('%Y%', f(ly)),
      `<text x="${f(lx + 22 * s)}" y="${f(ly + 4.5 * s)}" font-size="${fs(13)}" fill="${INK}">${escapeXml(text)}</text>`,
    );
    lx += width + itemGap;
  };
  for (const id of legendNames)
    legendItem(
      `<circle cx="%X%" cy="%Y%" r="${f(6 * s)}" fill="${colour(id)}"/>`,
      input.constructNames.get(id) ?? id,
    );
  const sh = (kind: IpmaPoint['predecessor']): string =>
    `<path transform="translate(%X% %Y%)" d="${shapePath(kind, 0, 0, 5.5 * s)}" fill="none" stroke="${INK}" stroke-width="${fs(1.5)}"/>`;
  legendItem(sh('direct'), 'Direct predecessor (circle)');
  legendItem(sh('indirect'), 'Indirect predecessor (diamond)');
  ly += 34 * s;
  footLines.forEach((line, i) =>
    o.push(
      `<text x="${f(padX)}" y="${f(ly + i * 20 * s)}" font-size="${fs(13)}" fill="${MUTED}">${escapeXml(line)}</text>`,
    ),
  );
  if (L.labels.hidden.length > 0)
    o.push(
      `<text x="${f(padX)}" y="${f(ly + footLines.length * 20 * s)}" font-size="${fs(13)}" fill="${MUTED}">${L.labels.hidden.length} label${L.labels.hidden.length === 1 ? '' : 's'} hidden; see table</text>`,
    );
  o.push('</svg>');
  return o.join('\n');
}
