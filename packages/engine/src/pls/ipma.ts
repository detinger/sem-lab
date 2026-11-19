/**
 * Importance-performance map analysis with the semantics of services/r-engine/R/pls_ipma.R
 * (convention settled in Phase 0, r-spike.md §5, which matched cSEM::doIPMA() on rescaled
 * data):
 *   1. reverse scoring first (already in the analysis matrix), then x100 = (x − min)/(max − min)·100
 *      with the DECLARED endpoints;
 *   2. classic PLS (same scheme / iteration cap / tolerance) on the rescaled data;
 *   3. unstandardised weight = standardised weight / sd(x100), normalised to sum to 1 per block;
 *   4. construct score = weighted sum of rescaled indicators; performance = mean score;
 *   5. importance = unstandardised total effect: OLS (with intercept) of each endogenous score
 *      on its predictors' scores gives B, total = (I − B)⁻¹ − I; the sign is kept;
 *   6. indicator importance = normalised weight × construct importance; indicator performance =
 *      mean rescaled indicator.
 */
import type { IpmaResult, ResultWarning } from '@sem-studio/contracts';
import { correlation, identity, inverseR, mean, sd, solveR, zeros } from '../linalg/index.ts';
import { EngineError } from '../shared/errors.ts';
import { fitWeights } from './core.ts';
import { coreModel, type PlsSpec, type PreparedData } from './spec.ts';

export const IPMA_CONVENTION = [
  'Each indicator is first reverse scored where flagged ((min + max) - x), then rescaled to 0-100 as (x - min)/(max - min)*100',
  'with its declared original scale endpoints (never the observed minimum/maximum).',
  'Classic PLS-SEM (no consistency correction; same inner weighting scheme, iteration cap and tolerance as the main fit) is re-estimated on the rescaled data.',
  'Unstandardized outer weights = standardized weight / sd(rescaled indicator), normalized to sum to 1 within each block;',
  'construct score = weighted sum of the rescaled indicators (0-100 when no weight is negative).',
  'Performance = mean construct score (constructs) or mean rescaled indicator (indicators), on the 0-100 scale.',
  "Importance = unstandardized total effect of the construct on the target: OLS of each endogenous score on its predictors' scores gives B, total effects = (I - B)^-1 - I.",
  "Indicator importance = normalized weight x the construct's importance. Negative importance keeps its sign.",
  "Constructs listed are all predecessors of the target (any directed path); 'direct' means a direct structural path exists.",
  'Point estimates only (no bootstrap intervals).',
].join(' ');

function fin(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

export function computeIpma(
  spec: PlsSpec,
  data: PreparedData,
): { result: IpmaResult; warnings: ResultWarning[] } {
  const ip = spec.ipma!;
  const model = coreModel(spec);
  const { n } = data;
  const X100 = spec.indicators.map((ind, j) => {
    const { min, max } = ind.scale!;
    const src = data.columns[j]!;
    const out = new Float64Array(n);
    for (let r = 0; r < n; r++) out[r] = ((src[r]! - min) / (max - min)) * 100;
    return out;
  });
  const S = correlation(X100).S;
  const wr = fitWeights(S, model);
  if (!wr.converged) {
    throw new EngineError(
      'ENGINE_NONCONVERGENCE',
      'The classic PLS fit on the 0-100 rescaled data (IPMA) did not converge.',
      { stage: 'ipma' },
    );
  }
  const k = model.k;
  const wn: number[][] = [];
  const scores: Float64Array[] = [];
  for (let j = 0; j < k; j++) {
    const block = model.blocks[j]!;
    const wu = block.map((a) => wr.W[j]![a]! / sd(X100[a]!));
    const sum = wu.reduce((s, v) => s + v, 0);
    const w = wu.map((v) => v / sum);
    wn.push(w);
    const sc = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      let s = 0;
      block.forEach((a, idx) => (s += X100[a]![r]! * w[idx]!));
      sc[r] = s;
    }
    scores.push(sc);
  }
  // unstandardised structural coefficients: OLS with intercept = centred normal equations
  const means = scores.map((s) => mean(s));
  const Bu = zeros(k, k);
  for (let t = 0; t < k; t++) {
    const src = spec.paths.filter((p) => p.target === t).map((p) => p.source);
    if (src.length === 0) continue;
    const cov = (a: number, b: number): number => {
      const xa = scores[a]!;
      const xb = scores[b]!;
      const ma = means[a]!;
      const mb = means[b]!;
      let s = 0;
      for (let r = 0; r < n; r++) s += (xa[r]! - ma) * (xb[r]! - mb);
      return s;
    };
    const A = src.map((a) => src.map((b) => cov(a, b)));
    const coef = solveR(
      A,
      src.map((a) => cov(a, t)),
    );
    src.forEach((s, i) => (Bu[t]![s] = coef[i]!));
  }
  const I = identity(k);
  const inv = inverseR(I.map((row, i) => row.map((v, j) => v - Bu[i]![j]!)));
  const Tu = inv.map((row, i) => row.map((v, j) => v - I[i]![j]!));
  const imp = ip.predecessors.map((c) => Tu[ip.target]![c]!);

  const warnings: ResultWarning[] = [];
  const constructs = ip.predecessors.map((c, j) => ({
    constructId: spec.constructs[c]!.id,
    importance: fin(imp[j]!),
    performance: fin(means[c]!),
    predecessor: ip.direct[j] ? ('direct' as const) : ('indirect' as const),
  }));
  const indicators = ip.predecessors.flatMap((c, j) =>
    spec.constructs[c]!.indicators.map((a, idx) => ({
      indicatorId: spec.indicators[a]!.id,
      constructId: spec.constructs[c]!.id,
      importance: fin(wn[c]![idx]! * imp[j]!),
      performance: fin(mean(X100[a]!)),
    })),
  );
  const neg = ip.predecessors.flatMap((c) =>
    spec.constructs[c]!.indicators.filter((_, idx) => wn[c]![idx]! < 0).map(
      (a) => spec.indicators[a]!.id,
    ),
  );
  if (neg.length > 0) {
    warnings.push({
      code: 'IPMA_NEGATIVE_WEIGHT',
      severity: 'warning',
      message: `${neg.length} normalized IPMA weight(s) are negative; the construct score is then not a weighted mean and its performance can fall outside 0-100.`,
      elementIds: neg,
    });
  }
  if (constructs.some((c) => c.importance === null || c.performance === null)) {
    warnings.push({
      code: 'IPMA_NON_FINITE',
      severity: 'error',
      message:
        'Some IPMA values could not be computed (non-finite; e.g. weights of a block summing to zero) and are null.',
    });
  }
  if (spec.bootstrap) {
    warnings.push({
      code: 'IPMA_NO_INTERVALS',
      severity: 'info',
      message:
        'IPMA importance and performance are point estimates in this version (no bootstrap intervals).',
    });
  }
  return {
    result: {
      targetConstructId: spec.constructs[ip.target]!.id,
      constructs,
      indicators,
      convention: IPMA_CONVENTION,
    },
    warnings,
  };
}
