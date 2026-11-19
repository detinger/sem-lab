import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SemModel } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { updateConstruct } from '@/domain/model-ops';
import { computeAutoLayout } from '../layout/auto-layout';
import { buildScene } from '../scene';
import { emptyLayout } from '../store';
import { escapeXml, sceneToSvg } from './svg-export';

const tam = SemModel.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'packages/contracts/examples/valid/model.tam-v1.json',
      ),
      'utf8',
    ),
  ),
);

async function laidOut(model: SemModel) {
  const layout = emptyLayout();
  const { positions } = await computeAutoLayout(model, layout.settings);
  return { ...layout, nodes: positions };
}

const parse = (svg: string): Document => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('SVG export', () => {
  it('is well-formed XML with one element per node and edge', async () => {
    const layout = await laidOut(tam);
    const scene = buildScene(tam, layout);
    const doc = parse(sceneToSvg(scene, { background: 'white', title: 'TAM' }));
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.querySelectorAll('[data-kind="construct"]')).toHaveLength(5);
    expect(doc.querySelectorAll('[data-kind="indicator"]')).toHaveLength(22);
    expect(doc.querySelectorAll('path[data-kind="structural"]')).toHaveLength(6);
    expect(doc.querySelectorAll('path[data-kind="measurement"]')).toHaveLength(22);
  });

  it('places nodes exactly where the layout puts them (export matches canvas)', async () => {
    const layout = await laidOut(tam);
    const doc = parse(sceneToSvg(buildScene(tam, layout), { background: 'transparent' }));
    for (const i of tam.indicators) {
      const rect = doc.querySelector(`g[data-id="${i.id}"] rect`)!;
      expect(Number(rect.getAttribute('x'))).toBeCloseTo(layout.nodes[i.id]!.x, 2);
      expect(Number(rect.getAttribute('y'))).toBeCloseTo(layout.nodes[i.id]!.y, 2);
    }
    expect(doc.querySelector('svg > rect')).toBeNull(); // transparent: no background rect
  });

  it('flips measurement arrows when a block becomes composite-formative', async () => {
    const layout = await laidOut(tam);
    const reflective = buildScene(tam, layout).edges.find((e) => e.id === 'meas:c_pu:i_usef1')!;
    const composite = buildScene(
      updateConstruct(tam, 'c_pu', { measurement: 'composite-formative' }),
      layout,
    ).edges.find((e) => e.id === 'meas:c_pu:i_usef1')!;
    expect(reflective).toMatchObject({ sourceId: 'c_pu', targetId: 'i_usef1' });
    expect(composite).toMatchObject({ sourceId: 'i_usef1', targetId: 'c_pu' });
    const tag = buildScene(
      updateConstruct(tam, 'c_pu', { measurement: 'composite-formative' }),
      layout,
    ).nodes.find((n) => n.id === 'c_pu')!.tag;
    expect(tag).toBe('Composite');
  });

  it('escapes hostile labels instead of emitting markup', async () => {
    const hostile = updateConstruct(tam, 'c_pu', { name: '<script>alert("x")</script> & co' });
    const layout = await laidOut(hostile);
    const svg = sceneToSvg(buildScene(hostile, layout), { background: 'white' });
    expect(svg).not.toContain('<script>');
    expect(parse(svg).getElementsByTagName('script')).toHaveLength(0);
    expect(escapeXml(`a<b>&"'`)).toBe('a&lt;b&gt;&amp;&quot;&apos;');
  });

  it('hides indicators of collapsed constructs', async () => {
    const layout = await laidOut(tam);
    const scene = buildScene(tam, {
      ...layout,
      settings: { ...layout.settings, collapsedConstructIds: ['c_pu'] },
    });
    expect(scene.nodes.filter((n) => n.kind === 'indicator')).toHaveLength(17);
    expect(scene.edges.filter((e) => e.kind === 'measurement')).toHaveLength(17);
  });
});
