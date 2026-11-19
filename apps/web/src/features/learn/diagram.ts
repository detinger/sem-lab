/**
 * Read-only model diagrams for lessons, theories and example cards: automatic layout (the
 * modeler's ELK layout) → the modeler's scene → its SVG exporter. Layout is cached per model.
 */
import { type SemLayout, type SemModel } from '@sem-lab/contracts';
import { computeAutoLayout, mergeLayout } from '@/features/modeler/layout/auto-layout';
import { emptyLayout } from '@/features/modeler/store';
import { buildScene } from '@/features/modeler/scene';
import { escapeXml, sceneToSvg } from '@/features/modeler/export/svg-export';

const cache = new Map<string, Promise<string>>();

/** Add a `hl` class to the groups/paths whose data-id is highlighted (styled in learn.css). */
export function markHighlights(svg: string, highlight: readonly string[]): string {
  let out = svg;
  for (const id of highlight) {
    const needle = `data-id="${escapeXml(id)}"`;
    out = out.split(needle).join(`${needle} class="hl"`);
  }
  return out;
}

export function modelSvg(
  model: SemModel,
  opts: { title?: string; highlight?: readonly string[]; layout?: SemLayout | undefined } = {},
): Promise<string> {
  const key = JSON.stringify([model, opts.title ?? '', opts.highlight ?? [], opts.layout ?? null]);
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      let layout: SemLayout;
      if (opts.layout) layout = opts.layout;
      else {
        const base = emptyLayout();
        const computed = await computeAutoLayout(model, base.settings);
        layout = { ...base, nodes: mergeLayout(model, base, computed, base.settings, false) };
      }
      const scene = buildScene(model, layout);
      const svg = sceneToSvg(scene, {
        background: 'white',
        padding: 12,
        ...(opts.title ? { title: opts.title } : {}),
      });
      return markHighlights(svg, opts.highlight ?? []);
    })();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

/** Accessible text description of a model (the non-visual equivalent of the diagram). */
export function describeModel(model: SemModel): string[] {
  const byId = new Map(model.constructs.map((c) => [c.id, c]));
  const ind = new Map(model.indicators.map((i) => [i.id, i]));
  const lines: string[] = [];
  for (const c of model.constructs) {
    const names = c.indicatorIds.map((id) => ind.get(id)?.name ?? id).join(', ');
    lines.push(
      `${c.name}: ${c.measurement === 'reflective' ? 'reflective' : 'composite (formative)'}${names ? `, indicators ${names}` : ''}`,
    );
  }
  for (const r of model.relationships) {
    const a = byId.get(r.sourceId)?.name ?? r.sourceId;
    const b = byId.get(r.targetId)?.name ?? r.targetId;
    lines.push(r.kind === 'structural' ? `${a} → ${b}` : `${a} ↔ ${b}`);
  }
  return lines;
}
