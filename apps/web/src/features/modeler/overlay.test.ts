import { DEFAULT_LAYOUT_SETTINGS, type NormalizedSemResult } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { FIXTURE_RESULT, TAM_MODEL, cbFixture } from '../analysis/test-support';
import { hasBothScales, overlayLegend } from './overlay';
import { sceneToSvg } from './export/svg-export';
import { buildScene } from './scene';

const layout = {
  nodes: Object.fromEntries(
    [...TAM_MODEL.constructs, ...TAM_MODEL.indicators].map((n, i) => [
      n.id,
      { x: (i % 6) * 180, y: Math.floor(i / 6) * 120 },
    ]),
  ),
  settings: DEFAULT_LAYOUT_SETTINGS,
};

const path = (r: NormalizedSemResult, s: string, t: string) =>
  r.parameters.find((p) => p.kind === 'path' && p.sourceId === s && p.targetId === t)!;
const pillOf = (scene: ReturnType<typeof buildScene>, s: string, t: string) =>
  scene.edges.find((e) => e.kind === 'structural' && e.sourceId === s && e.targetId === t)?.pill;

describe('result overlays on the scene', () => {
  it('adds nothing in model view', () => {
    const scene = buildScene(TAM_MODEL, layout);
    expect(scene.edges.every((e) => e.pill === undefined)).toBe(true);
    expect(scene.nodes.every((n) => n.capsule === undefined)).toBe(true);
  });

  it('shows the estimate with three decimals on a structural path, loadings on measurement edges and R² under endogenous constructs', () => {
    const scene = buildScene(TAM_MODEL, layout, {
      overlay: { mode: 'estimate', result: FIXTURE_RESULT },
    });
    const est = path(FIXTURE_RESULT, 'c_peou', 'c_pu').est!;
    expect(pillOf(scene, 'c_peou', 'c_pu')).toBe(est.toFixed(3));
    const loading = FIXTURE_RESULT.parameters.find((p) => p.kind === 'loading')!;
    const edge = scene.edges.find(
      (e) =>
        e.kind === 'measurement' &&
        (e.sourceId === loading.targetId || e.targetId === loading.targetId),
    );
    expect(edge?.pill).toBe(loading.est!.toFixed(3));
    const r2 = FIXTURE_RESULT.constructMetrics.find(
      (m) => m.metric === 'r2' && m.constructId === 'c_bi',
    )!;
    expect(scene.nodes.find((n) => n.id === 'c_bi')?.capsule).toBe(`R² = ${r2.value!.toFixed(3)}`);
    expect(scene.nodes.find((n) => n.id === 'c_peou')?.capsule).toBeUndefined();
  });

  it('shows an em dash for values that were not estimated, never 0', () => {
    const result: NormalizedSemResult = {
      ...FIXTURE_RESULT,
      parameters: FIXTURE_RESULT.parameters.map((p) =>
        p.kind === 'path' && p.sourceId === 'c_pu'
          ? { ...p, est: null, missing: { ...p.missing, est: 'not-estimated' as const } }
          : p,
      ),
    };
    const scene = buildScene(TAM_MODEL, layout, { overlay: { mode: 'estimate', result } });
    expect(pillOf(scene, 'c_pu', 'c_bi')).toBe('—');
  });

  it('shows one mode at a time: t, p and CI', () => {
    const p = path(FIXTURE_RESULT, 'c_peou', 'c_pu');
    const at = (mode: 't' | 'p' | 'ci') =>
      pillOf(
        buildScene(TAM_MODEL, layout, { overlay: { mode, result: FIXTURE_RESULT } }),
        'c_peou',
        'c_pu',
      );
    expect(at('t')).toBe(`t = ${p.statistic!.toFixed(2)}`);
    expect(at('p')).toMatch(/^p (<|=) /);
    expect(at('ci')).toBe(
      `[${p.ciLower!.toFixed(2)}, ${p.ciUpper!.toFixed(2)}]`.replace(/-/g, '−'),
    );
    const scene = buildScene(TAM_MODEL, layout, { overlay: { mode: 't', result: FIXTURE_RESULT } });
    expect(scene.nodes.every((n) => n.capsule === undefined)).toBe(true);
  });

  it('SVG export includes the selected overlay', () => {
    const scene = buildScene(TAM_MODEL, layout, {
      overlay: { mode: 'estimate', result: FIXTURE_RESULT },
    });
    const svg = sceneToSvg(scene, { background: 'white' });
    expect(svg).toContain('data-pill=');
    expect(svg).toContain('data-capsule="c_bi"');
    expect(svg).toContain(path(FIXTURE_RESULT, 'c_peou', 'c_pu').est!.toFixed(3));
    expect(sceneToSvg(buildScene(TAM_MODEL, layout), { background: 'white' })).not.toContain(
      'data-pill',
    );
  });
});

describe('CB-SEM overlay follows the Standardized / Unstandardized toggle', () => {
  const fx = cbFixture('cb-service-quality-ml');
  const cbLayout = {
    nodes: Object.fromEntries(
      [...fx.model.constructs, ...fx.model.indicators].map((n, i) => [
        n.id,
        { x: (i % 6) * 180, y: Math.floor(i / 6) * 120 },
      ]),
    ),
    settings: DEFAULT_LAYOUT_SETTINGS,
  };
  const scene = (mode: 'estimate' | 't' | 'p' | 'ci', scale?: 'standardized' | 'unstandardized') =>
    buildScene(fx.model, cbLayout, {
      overlay: { mode, result: fx.result, ...(scale ? { scale } : {}) },
    });
  const param = (scale: string) =>
    fx.result.parameters.find((p) => p.key === 'path:c_sq->c_sat' && p.scale === scale)!;

  it('shows standardized or unstandardized path estimates and the matching legend', () => {
    expect(pillOf(scene('estimate', 'standardized'), 'c_sq', 'c_sat')).toBe(
      param('standardized').est!.toFixed(3),
    );
    expect(pillOf(scene('estimate', 'unstandardized'), 'c_sq', 'c_sat')).toBe(
      param('unstandardized').est!.toFixed(3),
    );
    const l = (scale: 'standardized' | 'unstandardized') =>
      overlayLegend({ mode: 'estimate', result: fx.result, scale });
    expect(l('standardized')).toContain('Standardized (std.all)');
    expect(l('unstandardized')).toMatch(/^Unstandardized/);
  });

  it('shows measurement-line loadings on the selected scale', () => {
    const loading = (scale: string) =>
      fx.result.parameters.find(
        (p) => p.kind === 'loading' && p.targetId === 'i_sq2' && p.scale === scale,
      )!;
    const pill = (scale: 'standardized' | 'unstandardized') =>
      scene('estimate', scale).edges.find(
        (e) => e.kind === 'measurement' && (e.sourceId === 'i_sq2' || e.targetId === 'i_sq2'),
      )?.pill;
    expect(pill('standardized')).toBe(loading('standardized').est!.toFixed(3));
    expect(pill('unstandardized')).toBe(loading('unstandardized').est!.toFixed(3));
  });

  it('shows z, p and CI from the unstandardized (analytic) estimates whatever the toggle says', () => {
    const u = param('unstandardized');
    expect(pillOf(scene('t', 'standardized'), 'c_sq', 'c_sat')).toBe(
      `z = ${u.statistic!.toFixed(2)}`,
    );
    expect(pillOf(scene('p', 'standardized'), 'c_sq', 'c_sat')).toMatch(/^p [<=]/);
    expect(pillOf(scene('ci', 'standardized'), 'c_sq', 'c_sat')).toMatch(/^\[/);
    expect(overlayLegend({ mode: 't', result: fx.result })).toMatch(/unstandardized estimates/);
  });

  it('leaves PLS overlays unchanged (standardized only)', () => {
    const r = FIXTURE_RESULT;
    expect(hasBothScales(r)).toBe(false);
    expect(overlayLegend({ mode: 'estimate', result: r })).toMatch(
      /^Standardized path coefficients/,
    );
  });
});

describe('non-significant paths are dashed', () => {
  const withP = (pPeouBi: number | null, ci?: [number, number]): NormalizedSemResult => ({
    ...FIXTURE_RESULT,
    parameters: FIXTURE_RESULT.parameters.map((p) => {
      if (p.kind !== 'path') return p;
      const ns = p.sourceId === 'c_peou' && p.targetId === 'c_bi';
      return {
        ...p,
        pValue: ns ? pPeouBi : 0.001,
        ...(ci && ns ? { ciLower: ci[0], ciUpper: ci[1] } : {}),
      };
    }),
  });
  const edge = (scene: ReturnType<typeof buildScene>, s: string, t: string) =>
    scene.edges.find((e) => e.kind === 'structural' && e.sourceId === s && e.targetId === t)!;

  it('marks a path with p ≥ .05 in every overlay mode, and only that path', () => {
    for (const mode of ['estimate', 't', 'p', 'ci', 'hypothesis'] as const) {
      const scene = buildScene(TAM_MODEL, layout, { overlay: { mode, result: withP(0.21) } });
      expect(edge(scene, 'c_peou', 'c_bi').nonSignificant, mode).toBe(true);
      expect(edge(scene, 'c_peou', 'c_pu').nonSignificant, mode).toBeUndefined();
    }
  });

  it('uses the confidence interval when there is no p-value, and claims nothing without inference', () => {
    const ci = buildScene(TAM_MODEL, layout, {
      overlay: { mode: 'estimate', result: withP(null, [-0.05, 0.2]) },
    });
    expect(edge(ci, 'c_peou', 'c_bi').nonSignificant).toBe(true);
    const none: NormalizedSemResult = {
      ...FIXTURE_RESULT,
      parameters: FIXTURE_RESULT.parameters.map((p) => ({
        ...p,
        pValue: null,
        ciLower: null,
        ciUpper: null,
      })),
    };
    const scene = buildScene(TAM_MODEL, layout, { overlay: { mode: 'estimate', result: none } });
    expect(scene.edges.some((e) => e.nonSignificant)).toBe(false);
    expect(overlayLegend({ mode: 'estimate', result: none })).not.toMatch(/Dashed/);
    expect(overlayLegend({ mode: 'estimate', result: withP(0.21) })).toMatch(
      /Dashed arrows: not significant/,
    );
  });

  it('is drawn dashed in the SVG export', () => {
    const scene = buildScene(TAM_MODEL, layout, {
      overlay: { mode: 'estimate', result: withP(0.21) },
    });
    const svg = sceneToSvg(scene, { background: 'white' });
    const dashed = [...svg.matchAll(/<path [^>]*stroke-dasharray="6 4"[^>]*>/g)];
    expect(dashed).toHaveLength(1);
    expect(dashed[0]![0]).toContain('data-kind="structural"');
  });
});
