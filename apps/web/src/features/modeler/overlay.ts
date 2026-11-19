/**
 * Results overlays for the diagram (STYLE §8 "Results inside the modeler"). Pure: given a
 * scene and a result, returns a scene whose edges carry a `pill` and whose constructs carry a
 * `capsule`. One mode at a time — estimate, t, p, CI or hypothesis — never several at once.
 * Values that were not estimated are "—", never 0.
 */
import type { NormalizedSemResult, ParameterEstimate, SemModel } from '@sem-studio/contracts';
import { formatNumber, formatP } from '../reports/format';
import type { Scene } from './scene';

export type OverlayMode = 'none' | 'estimate' | 't' | 'p' | 'ci' | 'hypothesis';

export const OVERLAY_LABELS: Record<OverlayMode, string> = {
  none: 'Model',
  estimate: 'Est.',
  t: 't',
  p: 'p',
  ci: 'CI',
  hypothesis: 'H.',
};

export type OverlayScale = 'standardized' | 'unstandardized';

export interface OverlayInput {
  mode: Exclude<OverlayMode, 'none'>;
  result: NormalizedSemResult;
  /** CB-SEM: which scale the estimate overlay shows (default standardized) */
  scale?: OverlayScale;
}

/** CB-SEM results carry both scales; PLS results carry standardized estimates only. */
export const hasBothScales = (result: NormalizedSemResult): boolean =>
  result.parameters.some((p) => p.scale === 'unstandardized');

/**
 * Which scale a mode reads. Inference (t / z, p, CI) exists for unstandardized CB estimates only,
 * so those modes always read them; the estimate mode follows the toggle.
 */
function scaleFor(overlay: OverlayInput): OverlayScale | undefined {
  if (!hasBothScales(overlay.result)) return undefined;
  return overlay.mode === 'estimate' ? (overlay.scale ?? 'standardized') : 'unstandardized';
}

/** The one-line legend that explains what the pills and capsules show. */
export function overlayLegend(overlay: OverlayInput): string {
  const { mode, result } = overlay;
  if (mode === 'hypothesis') return 'Hypothesis labels as written in the model.';
  const cb = hasBothScales(result);
  if (mode === 'estimate')
    return cb
      ? `${(overlay.scale ?? 'standardized') === 'standardized' ? 'Standardized (std.all)' : 'Unstandardized'} loadings on measurement lines and path coefficients on structural arrows; R² under endogenous factors.`
      : 'Standardized path coefficients on structural arrows, loadings or weights on measurement lines; R² under endogenous constructs.';
  const what = { t: cb ? 'z statistic' : 't statistic', p: 'p value', ci: 'confidence interval' }[
    mode
  ];
  return cb
    ? `${what} of the unstandardized estimates (analytic standard errors; not computed for standardized estimates).`
    : `${what} of the path coefficients from the bootstrap.`;
}

export const NOT_ESTIMATED = '—';
const typographic = { decimals: 3, minus: 'typographic' } as const;

function pillFor(mode: OverlayInput['mode'], p: ParameterEstimate | undefined): string {
  if (!p) return NOT_ESTIMATED;
  const v = (n: number | null, text: string): string => (n === null ? NOT_ESTIMATED : text);
  switch (mode) {
    case 'estimate':
      return v(p.est, formatNumber(p.est, typographic));
    case 't':
      return v(
        p.statistic,
        `${p.statisticType === 'z' ? 'z' : 't'} = ${formatNumber(p.statistic, { decimals: 2 })}`,
      );
    case 'p':
      return v(
        p.pValue,
        /^[<>]/.test(formatP(p.pValue)) ? `p ${formatP(p.pValue)}` : `p = ${formatP(p.pValue)}`,
      );
    case 'ci':
      return p.ciLower === null && p.ciUpper === null
        ? NOT_ESTIMATED
        : `[${formatNumber(p.ciLower, { decimals: 2 })}, ${formatNumber(p.ciUpper, { decimals: 2 })}]`;
    case 'hypothesis':
      return NOT_ESTIMATED;
  }
}

/** The coefficient shown on a measurement edge: the loading of a reflective, the weight of a composite construct. */
function measurementParam(
  model: SemModel,
  result: NormalizedSemResult,
  constructId: string,
  indicatorId: string,
  scale: OverlayScale | undefined,
): ParameterEstimate | undefined {
  const c = model.constructs.find((x) => x.id === constructId);
  const kind = c?.measurement === 'reflective' ? 'loading' : 'weight';
  return result.parameters.find(
    (p) =>
      p.kind === kind &&
      p.sourceId === constructId &&
      p.targetId === indicatorId &&
      (scale === undefined || p.scale === scale),
  );
}

export function applyOverlay(scene: Scene, model: SemModel, overlay: OverlayInput): Scene {
  const { mode, result } = overlay;
  const scale = scaleFor(overlay);
  const isConstruct = new Set(model.constructs.map((c) => c.id));
  const edges = scene.edges.map((e) => {
    if (e.kind === 'covariance') return e;
    if (e.kind === 'structural') {
      if (mode === 'hypothesis') return e.hypothesis ? { ...e, pill: e.hypothesis } : e;
      const rel = model.relationships.find((r) => r.id === e.id);
      const p = result.parameters.find(
        (x) =>
          x.kind === 'path' &&
          (scale === undefined || x.scale === scale) &&
          (x.relationshipId === e.id ||
            (x.sourceId === rel?.sourceId && x.targetId === rel?.targetId)),
      );
      return { ...e, pill: pillFor(mode, p) };
    }
    // Measurement edges are short: they carry loadings/weights in the estimate overlay only.
    if (mode !== 'estimate') return e;
    const constructId = isConstruct.has(e.sourceId) ? e.sourceId : e.targetId;
    const indicatorId = constructId === e.sourceId ? e.targetId : e.sourceId;
    return {
      ...e,
      pill: pillFor(mode, measurementParam(model, result, constructId, indicatorId, scale)),
    };
  });
  const nodes = scene.nodes.map((n) => {
    if (mode !== 'estimate' || n.kind !== 'construct') return n;
    const m = result.constructMetrics.find((x) => x.constructId === n.id && x.metric === 'r2');
    if (!m || (m.value === null && m.missing === 'not-applicable')) return n;
    return {
      ...n,
      capsule: `R² = ${m.value === null ? NOT_ESTIMATED : formatNumber(m.value, typographic)}`,
    };
  });
  return { ...scene, edges, nodes };
}

/** Approximate pill size for a text (11px tabular figures): used by canvas and SVG export alike. */
export function pillSize(text: string): { width: number; height: number } {
  return { width: Math.max(26, text.length * 6.4 + 10), height: 17 };
}
