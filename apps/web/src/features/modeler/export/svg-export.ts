/**
 * Publication SVG export (PLAN §2.1, STYLE §13 "Figure and report output").
 *
 * Built from the same Scene as the canvas, in "presentation view": no grid, handles,
 * selection or warning markers. Colours are fixed publication colours (not the UI theme), so
 * an export made in dark mode still prints correctly; background is white or transparent.
 * All text is escaped; labels are data, never markup.
 */
import { pillSize } from '../overlay';
import { type Scene } from '../scene';

export interface SvgExportOptions {
  background: 'white' | 'transparent';
  /** extra space around the content bounds, px */
  padding?: number;
  showHypotheses?: boolean;
  title?: string;
}

const INK = '#22242a';
const EDGE = '#526174';
const MEASURE = '#6b7787';
const FONT = "Inter, 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";

export function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]!,
  );
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

export function sceneToSvg(scene: Scene, opts: SvgExportOptions): string {
  const pad = opts.padding ?? 24;
  const b = scene.bounds;
  const vb = { x: b.x - pad, y: b.y - pad, w: b.width + 2 * pad, h: b.height + 2 * pad };
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(vb.w)}" height="${f(vb.h)}" viewBox="${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}" font-family="${escapeXml(FONT)}">`,
  );
  if (opts.title) out.push(`<title>${escapeXml(opts.title)}</title>`);
  out.push(
    '<defs>',
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,1 L10,5 L0,9 z" fill="${EDGE}"/></marker>`,
    `<marker id="arrow-m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,1 L10,5 L0,9 z" fill="${MEASURE}"/></marker>`,
    '</defs>',
  );
  if (opts.background === 'white')
    out.push(
      `<rect x="${f(vb.x)}" y="${f(vb.y)}" width="${f(vb.w)}" height="${f(vb.h)}" fill="#ffffff"/>`,
    );

  // Edges first so node outlines sit on top of line ends.
  for (const e of scene.edges) {
    const measurement = e.kind === 'measurement';
    const marker = measurement ? 'url(#arrow-m)' : 'url(#arrow)';
    out.push(
      `<path data-id="${escapeXml(e.id)}" data-kind="${e.kind}" d="${e.d}" fill="none" stroke="${measurement ? MEASURE : EDGE}" stroke-width="${measurement ? 1.25 : 1.8}"${e.arrowEnd ? ` marker-end="${marker}"` : ''}${e.arrowStart ? ` marker-start="${marker}"` : ''}/>`,
    );
    if (opts.showHypotheses && e.hypothesis) {
      out.push(
        `<text x="${f(e.labelAt.x)}" y="${f(e.labelAt.y - 6)}" text-anchor="middle" font-size="11" font-style="italic" fill="${INK}">${escapeXml(e.hypothesis)}</text>`,
      );
    }
  }
  // Result overlay pills sit on top of the edges, before the nodes.
  for (const e of scene.edges) {
    if (e.pill === undefined) continue;
    const { width: pw, height: ph } = pillSize(e.pill);
    out.push(
      `<g data-pill="${escapeXml(e.id)}"><rect x="${f(e.labelAt.x - pw / 2)}" y="${f(e.labelAt.y - ph / 2)}" width="${f(pw)}" height="${f(ph)}" rx="4" fill="#ffffff" stroke="${MEASURE}" stroke-width="0.75"/>`,
      `<text x="${f(e.labelAt.x)}" y="${f(e.labelAt.y + 4)}" text-anchor="middle" font-size="11" fill="${INK}" style="font-variant-numeric:tabular-nums">${escapeXml(e.pill)}</text></g>`,
    );
  }
  for (const n of scene.nodes) {
    const { x, y, width: w, height: h } = n.rect;
    if (n.kind === 'construct') {
      const shape =
        n.shape === 'ellipse'
          ? `<ellipse cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" rx="${f(w / 2)}" ry="${f(h / 2)}"`
          : `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="14"`;
      out.push(
        `<g data-id="${escapeXml(n.id)}" data-kind="construct">${shape} fill="#ffffff" stroke="${INK}" stroke-width="1.75"/>`,
      );
      const lineH = 17;
      const total = n.lines.length * lineH + (n.tag ? 13 : 0);
      let ty = y + h / 2 - total / 2 + 12.5;
      for (const line of n.lines) {
        out.push(
          `<text x="${f(x + w / 2)}" y="${f(ty)}" text-anchor="middle" font-size="14" font-weight="650" fill="${INK}">${escapeXml(line)}</text>`,
        );
        ty += lineH;
      }
      if (n.tag)
        out.push(
          `<text x="${f(x + w / 2)}" y="${f(ty - 3)}" text-anchor="middle" font-size="10" fill="${MEASURE}">${escapeXml(n.tag)}</text>`,
        );
      out.push('</g>');
      if (n.capsule !== undefined) {
        const { width: cw, height: ch } = pillSize(n.capsule);
        out.push(
          `<g data-capsule="${escapeXml(n.id)}"><rect x="${f(x + w / 2 - cw / 2)}" y="${f(y + h + 4)}" width="${f(cw)}" height="${f(ch)}" rx="8" fill="#ffffff" stroke="${MEASURE}" stroke-width="0.75"/>`,
          `<text x="${f(x + w / 2)}" y="${f(y + h + 4 + 12)}" text-anchor="middle" font-size="11" fill="${INK}">${escapeXml(n.capsule)}</text></g>`,
        );
      }
    } else {
      out.push(
        `<g data-id="${escapeXml(n.id)}" data-kind="indicator"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="6" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`,
        `<text x="${f(x + w / 2)}" y="${f(y + h / 2 + 4)}" text-anchor="middle" font-size="12" font-weight="600" fill="${INK}">${escapeXml(n.lines[0] ?? '')}</text></g>`,
      );
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

/**
 * Rasterise an SVG string to a PNG blob at `scale` × its CSS size. Browser only.
 * The physical size at a given DPI is width_px / dpi inches; callers state it in the UI.
 */
export async function svgToPng(svg: string, scale: number): Promise<Blob> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The diagram could not be rendered for PNG export.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(img.width * scale);
    canvas.height = Math.ceil(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available.');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
