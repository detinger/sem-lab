import { describe, expect, it } from 'vitest';
import { tamModel } from './__fixtures__/content';
import { describeModel, markHighlights, modelSvg } from './diagram';

describe('model diagrams', () => {
  it('draws a model with the modeler exporter and highlights ids', async () => {
    const svg = await modelSvg(tamModel, { title: 'TAM', highlight: ['c_pu', 'r1'] });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<title>TAM</title>');
    expect(svg).toContain('data-id="c_pu" class="hl"');
    expect(svg).not.toContain('data-id="c_bi" class="hl"');
    expect(svg).toContain('>PEOU<');
  }, 20_000);

  it('escapes names (no markup from model text)', async () => {
    const evil = {
      ...tamModel,
      constructs: tamModel.constructs.map((c, i) =>
        i === 0 ? { ...c, name: '<img onerror=x>' } : c,
      ),
    };
    const svg = await modelSvg(evil);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
  }, 20_000);

  it('markHighlights only touches the named ids', () => {
    expect(markHighlights('<g data-id="a"></g><g data-id="b"></g>', ['b'])).toBe(
      '<g data-id="a"></g><g data-id="b" class="hl"></g>',
    );
  });

  it('describes a model as text', () => {
    expect(describeModel(tamModel)).toContain('PEOU → PU');
    expect(describeModel(tamModel)[0]).toMatch(/^PEOU: reflective, indicators peou1, peou2/);
  });
});
