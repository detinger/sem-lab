/**
 * Normalisation of a PLS fit into NormalizedSemResult pieces (docs/architecture/contracts.md
 * §6), with the keys, kinds, ordering, definitions and missing reasons of
 * services/r-engine/R/pls_results.R and run_job.R (collect_warnings). Every number is tied
 * to model ids and every null carries a reason; non-finite numbers never escape.
 */
import type {
  ConstructMetric,
  FitIndex,
  MissingReason,
  ParameterEstimate,
  ResultMatrix,
  ResultWarning,
} from '@sem-studio/contracts';
import { type Mat, NumericalError } from '../linalg/index.ts';
import {
  ave,
  cronbachAlpha,
  crossLoadings,
  f2,
  fitIndices,
  htmtPair,
  reliabilityEligible,
  rhoA,
  rhoC,
  rhoCSigma,
  vifModeB,
} from './assess.ts';
import type { Inference, ThetaSlot } from './bootstrap.ts';
import type { CoreFit, CoreModel } from './core.ts';
import { VERIFY_CHECKS, type VerifyCheck } from './core.ts';
import { type EffectsSpec, type EffectValues, MAX_SPECIFIC_INDIRECT } from './effects.ts';
import type { BootstrapSpec, PlsSpec } from './spec.ts';

export const SOURCE_PLS = '@sem-studio/engine pls-pm (cSEM 0.7.1 semantics)';
export const SOURCE_EFFECTS = '@sem-studio/engine effects from the path estimates';
export const INFERENCE_NOTE =
  'se = sd(valid draws, divisor B_valid-1); t = est/se; p from t distribution, df = B_valid-1; CI = percentile, quantile(type 7)';

type NumField = 'est' | 'se' | 'statistic' | 'pValue' | 'ciLower' | 'ciUpper';
const INF_FIELDS = ['se', 'statistic', 'pValue', 'ciLower', 'ciUpper'] as const;

/** A theta entry: one path / loading / weight with its result key and location. */
export interface ThetaEntry extends ThetaSlot {
  key: string;
  sourceId: string;
  targetId: string;
  relationshipId?: string;
  single: boolean;
  rawPath: string;
}

/** Paths in relationship order, then every block's (loading, weight) per indicator (R theta_spec). */
export function thetaEntries(spec: PlsSpec): ThetaEntry[] {
  const out: ThetaEntry[] = [];
  for (const p of spec.paths) {
    const s = spec.constructs[p.source]!.id;
    const t = spec.constructs[p.target]!.id;
    out.push({
      key: `path:${s}->${t}`,
      kind: 'path',
      row: p.target,
      col: p.source,
      sourceId: s,
      targetId: t,
      relationshipId: p.id,
      single: false,
      rawPath: `path coefficient B[${t}, ${s}] (OLS on the construct correlations)`,
    });
  }
  spec.constructs.forEach((c, j) => {
    const single = c.indicators.length === 1;
    c.indicators.forEach((a) => {
      const ii = spec.indicators[a]!.id;
      out.push({
        key: `loading:${c.id}:${ii}`,
        kind: 'loading',
        row: j,
        col: a,
        sourceId: c.id,
        targetId: ii,
        single,
        rawPath: `loading Lambda[${c.id}, ${ii}]`,
      });
      out.push({
        key: `weight:${c.id}:${ii}`,
        kind: 'weight',
        row: j,
        col: a,
        sourceId: c.id,
        targetId: ii,
        single,
        rawPath: `weight W[${c.id}, ${ii}] (scaled to unit composite variance)`,
      });
    });
  });
  return out;
}

function numOrReason(
  x: number | null | undefined,
  reason: MissingReason,
): { value: number | null; reason?: MissingReason } {
  if (x === null || x === undefined) return { value: null, reason };
  if (!Number.isFinite(x)) return { value: null, reason: 'non-finite' };
  return { value: x };
}

interface ParamArgs {
  key: string;
  kind: ParameterEstimate['kind'];
  est: number;
  sourceId?: string;
  targetId?: string;
  viaIds?: string[];
  relationshipId?: string;
  inf: Inference | null;
  boot: BootstrapSpec | null;
  fixedReason?: MissingReason;
  sourceMethod: string;
  rawPath: string;
}

/** R param_entry(). */
export function paramEntry(a: ParamArgs): ParameterEstimate {
  const missing: Partial<Record<NumField, MissingReason>> = {};
  let status: ParameterEstimate['status'] = a.fixedReason ? 'fixed' : 'estimated';
  const e = numOrReason(a.est, 'non-finite');
  if (e.reason) {
    missing.est = e.reason;
    status = 'failed';
  }
  const vals: Record<(typeof INF_FIELDS)[number], number | null> = {
    se: null,
    statistic: null,
    pValue: null,
    ciLower: null,
    ciUpper: null,
  };
  const useBoot = a.boot !== null && !a.fixedReason;
  for (const f of INF_FIELDS) {
    if (a.fixedReason) missing[f] = a.fixedReason;
    else if (!useBoot) missing[f] = 'not-requested';
    else {
      const v = a.inf![f];
      if (v === null) {
        missing[f] =
          a.inf!.reason ?? (f === 'ciLower' || f === 'ciUpper' ? 'not-applicable' : 'failed');
      } else {
        const nv = numOrReason(v, 'failed');
        vals[f] = nv.value;
        if (nv.reason) missing[f] = nv.reason;
      }
    }
  }
  const p: ParameterEstimate = {
    key: a.key,
    kind: a.kind,
    ...(a.sourceId !== undefined ? { sourceId: a.sourceId } : {}),
    ...(a.targetId !== undefined ? { targetId: a.targetId } : {}),
    ...(a.viaIds !== undefined ? { viaIds: a.viaIds } : {}),
    ...(a.relationshipId !== undefined ? { relationshipId: a.relationshipId } : {}),
    scale: 'standardized',
    est: e.value,
    ...vals,
    ...(useBoot ? { statisticType: 't' as const } : {}),
    ...(Object.keys(missing).length > 0 ? { missing } : {}),
    status,
    ...(useBoot
      ? {
          inference: {
            method: 'bootstrap-percentile' as const,
            level: a.boot!.level,
            sides: a.boot!.sides,
            nValid: a.inf!.nValid,
          },
        }
      : {}),
    sourceMethod: a.sourceMethod,
    rawPath: a.rawPath.slice(0, 400),
  };
  return p;
}

export interface BootstrapInference {
  boot: BootstrapSpec;
  theta: Inference[];
  total: Inference[];
  indirect: Inference[];
  specific: Inference[];
}

/** All ParameterEstimates: paths, loadings, weights, totals, total indirect, specific indirect. */
export function buildParameters(
  spec: PlsSpec,
  theta: readonly ThetaEntry[],
  thetaValues: readonly number[],
  es: EffectsSpec,
  eff: EffectValues,
  bs: BootstrapInference | null,
): ParameterEstimate[] {
  const ids = spec.constructs.map((c) => c.id);
  const out: ParameterEstimate[] = [];
  theta.forEach((t, i) => {
    const fixed = t.single;
    let raw = t.rawPath;
    if (bs && !fixed) raw += `; ${INFERENCE_NOTE}`;
    if (fixed) raw += '; single-indicator block: fixed at 1 by construction';
    out.push(
      paramEntry({
        key: t.key,
        kind: t.kind,
        est: thetaValues[i]!,
        sourceId: t.sourceId,
        targetId: t.targetId,
        ...(t.relationshipId !== undefined ? { relationshipId: t.relationshipId } : {}),
        inf: bs && !fixed ? bs.theta[i]! : null,
        boot: bs && !fixed ? bs.boot : null,
        ...(fixed ? { fixedReason: 'not-applicable' as const } : {}),
        sourceMethod: SOURCE_PLS,
        rawPath: raw,
      }),
    );
  });
  const note = bs ? `; per draw; ${INFERENCE_NOTE}` : '';
  es.pairs.forEach((pr, j) => {
    out.push(
      paramEntry({
        key: `total:${ids[pr.source]!}->${ids[pr.target]!}`,
        kind: 'total-effect',
        est: eff.total[j]!,
        sourceId: ids[pr.source]!,
        targetId: ids[pr.target]!,
        inf: bs ? bs.total[j]! : null,
        boot: bs ? bs.boot : null,
        sourceMethod: SOURCE_EFFECTS,
        rawPath: `(I - B)^-1 - I, B = path coefficients${note}`,
      }),
    );
  });
  es.pairs.forEach((pr, j) => {
    if (!pr.hasIndirect) return;
    out.push(
      paramEntry({
        key: `indirect:${ids[pr.source]!}->${ids[pr.target]!}`,
        kind: 'indirect-effect',
        est: eff.indirect[j]!,
        sourceId: ids[pr.source]!,
        targetId: ids[pr.target]!,
        inf: bs ? bs.indirect[j]! : null,
        boot: bs ? bs.boot : null,
        sourceMethod: SOURCE_EFFECTS,
        rawPath: `(I - B)^-1 - I - B, B = path coefficients${note}`,
      }),
    );
  });
  es.specific.forEach((sp, j) => {
    const key = `specific-indirect:${sp.nodes.map((c) => ids[c]!).join('->')}`;
    if (key.length > 400) return;
    out.push(
      paramEntry({
        key,
        kind: 'specific-indirect',
        est: eff.specific[j]!,
        sourceId: ids[sp.source]!,
        targetId: ids[sp.target]!,
        viaIds: sp.via.map((c) => ids[c]!),
        inf: bs ? bs.specific[j]! : null,
        boot: bs ? bs.boot : null,
        sourceMethod: SOURCE_EFFECTS,
        rawPath: `product of the path coefficients along the chain${note}`,
      }),
    );
  });
  return out;
}

// ---- construct metrics ---------------------------------------------------------------------

export const DEF = {
  r2: "R²: share of the endogenous construct's variance explained by its predictors (OLS on the construct correlation matrix; cSEM Estimates$R2 definition). Defined for endogenous constructs only.",
  r2adj:
    'Adjusted R² = 1 - (1 - R²)(n - 1)/(n - k - 1), n = rows used, k = number of predictors (cSEM Estimates$R2adj definition). Defined for endogenous constructs only.',
  alpha:
    "Cronbach's alpha, standardized (correlation-based): k·r̄/(1 + (k - 1)·r̄), r̄ = mean inter-item correlation of the block (cSEM assess() RhoT definition). Reflective blocks with at least 2 indicators only.",
  rhoa: 'Dijkstra–Henseler rho_A of the Mode A weights: the PLSc (consistent PLS) reliability c²·(w′w)² of the same weights (cSEM Estimates$Reliabilities of a PLSc fit; the weights equal those of the classic fit). Reflective blocks with at least 2 indicators only.',
  rhoc: 'Composite reliability rho_C = (Σλ)² / ((Σλ)² + Σ(1 - λ²)) on the reported standardized loadings (cSEM assess() RhoC definition). Reflective blocks with at least 2 indicators only.',
  ave: 'Average variance extracted: mean of the squared reported standardized loadings (cSEM assess() AVE definition). Reflective blocks with at least 2 indicators only.',
};

function metricEntry(
  constructId: string,
  metric: string,
  value: number | null,
  reason: MissingReason,
  definition: string,
): ConstructMetric {
  const v = numOrReason(value, reason);
  return v.reason
    ? { constructId, metric, value: null, missing: v.reason, definition }
    : { constructId, metric, value: v.value, definition };
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    if (e instanceof NumericalError) return null;
    throw e;
  }
}

export function buildConstructMetrics(
  spec: PlsSpec,
  model: CoreModel,
  fit: CoreFit,
  S: Mat,
  rhoAvailable: boolean,
): ConstructMetric[] {
  const eligible = reliabilityEligible(model);
  const sigmaCf = safe(() => rhoCSigma(S, fit, model));
  const out: ConstructMetric[] = [];
  spec.constructs.forEach((c, j) => {
    const endo = model.structural[j]!.some((v) => v === 1);
    out.push(
      metricEntry(c.id, 'r2', endo ? fit.R2[j]! : null, endo ? 'failed' : 'not-applicable', DEF.r2),
    );
    out.push(
      metricEntry(
        c.id,
        'r2-adjusted',
        endo ? fit.R2adj[j]! : null,
        endo ? 'failed' : 'not-applicable',
        DEF.r2adj,
      ),
    );
    const el = eligible[j]!;
    const block = c.indicators;
    const na: MissingReason = 'not-applicable';
    out.push(
      metricEntry(
        c.id,
        'cronbach-alpha',
        el ? cronbachAlpha(S, block) : null,
        el ? 'failed' : na,
        DEF.alpha,
      ),
    );
    const ra =
      el && rhoAvailable ? (fit.disattenuated ? fit.Q[j]! ** 2 : rhoA(S, fit.W, block, j)) : null;
    out.push(metricEntry(c.id, 'rho-a', ra, el ? 'failed' : na, DEF.rhoa));
    out.push(
      metricEntry(
        c.id,
        'rho-c',
        el && sigmaCf ? rhoC(sigmaCf, fit, j, block) : null,
        el ? 'failed' : na,
        DEF.rhoc,
      ),
    );
    out.push(metricEntry(c.id, 'ave', el ? ave(fit, j, block) : null, el ? 'failed' : na, DEF.ave));
  });
  return out;
}

// ---- matrices ------------------------------------------------------------------------------

function cleanRow(row: readonly number[]): (number | null)[] {
  return row.map((v) => (Number.isFinite(v) ? v : null));
}

function matrixEntry(
  id: string,
  title: string,
  rowIds: string[],
  colIds: string[],
  M: Mat | null,
  symmetric: boolean,
  definition: string,
  missing?: MissingReason,
): ResultMatrix {
  return {
    id,
    title,
    rowIds,
    colIds,
    values: rowIds.length && M ? M.map(cleanRow) : [],
    symmetric,
    definition,
    ...(missing ? { missing } : {}),
  };
}

export function buildMatrices(
  spec: PlsSpec,
  model: CoreModel,
  fit: CoreFit,
  S: Mat,
  n: number,
): ResultMatrix[] {
  const ids = spec.constructs.map((c) => c.id);
  const k = model.k;
  const eligibleIdx = reliabilityEligible(model)
    .map((e, j) => (e ? j : -1))
    .filter((j) => j >= 0);
  const eligible = eligibleIdx.map((j) => ids[j]!);
  const out: ResultMatrix[] = [];

  for (const type of ['htmt', 'htmt2'] as const) {
    const title =
      type === 'htmt' ? 'Heterotrait–monotrait ratio (HTMT)' : 'HTMT2 (geometric-mean HTMT)';
    const def =
      (type === 'htmt'
        ? 'HTMT (Henseler, Ringle & Sarstedt, 2015): mean heterotrait correlation / sqrt(product of the mean monotrait correlations)'
        : 'HTMT2 (Roemer, Schuberth & Henseler, 2021): as HTMT with geometric instead of arithmetic means') +
      ', on Pearson indicator correlations, absolute value (cSEM assess() definition, .absolute = TRUE). Reflective constructs with at least 2 indicators only; other constructs are omitted (not applicable). Diagonal is null (not applicable).';
    if (eligible.length < 2) {
      out.push(matrixEntry(type, title, [], [], null, true, def, 'not-applicable'));
      continue;
    }
    const M = eligibleIdx.map((a) =>
      eligibleIdx.map((b) =>
        a === b ? NaN : htmtPair(S, model.blocks[a]!, model.blocks[b]!, type),
      ),
    );
    out.push(matrixEntry(type, title, eligible, eligible, M, true, def));
  }

  const flDef =
    'Fornell–Larcker matrix (cSEM assess() fl_criterion definition): diagonal = AVE, off-diagonal = squared construct correlations. Reflective constructs with at least 2 indicators only.';
  if (eligible.length === 0) {
    out.push(
      matrixEntry(
        'fornell-larcker',
        'Fornell–Larcker criterion',
        [],
        [],
        null,
        true,
        flDef,
        'not-applicable',
      ),
    );
  } else {
    const M = eligibleIdx.map((a) =>
      eligibleIdx.map((b) => (a === b ? ave(fit, a, model.blocks[a]!) : fit.P[a]![b]! ** 2)),
    );
    out.push(
      matrixEntry(
        'fornell-larcker',
        'Fornell–Larcker criterion',
        eligible,
        eligible,
        M,
        true,
        flDef,
      ),
    );
  }

  out.push(
    matrixEntry(
      'cross-loadings',
      'Cross-loadings',
      spec.indicators.map((i) => i.id),
      ids,
      crossLoadings(fit, S, model),
      false,
      'Pearson correlation of each indicator with each construct score (standardized composites, as cSEM Estimates$Construct_scores).' +
        (spec.method === 'plsc'
          ? ' For PLSc the own-block entries are composite (proxy) correlations and therefore differ from the consistency-corrected loadings.'
          : ''),
    ),
  );

  out.push(
    matrixEntry(
      'construct-correlations',
      'Construct correlations',
      ids,
      ids,
      fit.P,
      true,
      spec.method === 'plsc'
        ? 'Construct correlations (cSEM Estimates$Construct_VCV definition): consistency-corrected for reflective constructs (PLSc), composite correlations for Mode B constructs.'
        : 'Construct correlations (cSEM Estimates$Construct_VCV definition): correlations of the standardized composites (classic PLS, no consistency correction).',
    ),
  );

  const endo = Array.from({ length: k }, (_, j) => j).filter((j) =>
    model.structural[j]!.some((v) => v === 1),
  );
  const preds = Array.from({ length: k }, (_, j) => j).filter((j) =>
    model.structural.some((row) => row[j] === 1),
  );
  const F = safe(() => f2(fit, model, n));
  const M = preds.map((s) =>
    endo.map((t) => (F && model.structural[t]![s] === 1 ? F[t]![s]! : NaN)),
  );
  out.push(
    matrixEntry(
      'f2',
      'Effect size f²',
      preds.map((j) => ids[j]!),
      endo.map((j) => ids[j]!),
      M,
      false,
      'f² = (R²_incl - R²_excl) / (1 - R²_incl) per structural path (row = predictor, column = endogenous construct), cSEM definition (assess() F2): R²_excl drops the predictor from the regression on the SAME construct correlations; the model is not re-estimated. Null where there is no path.',
      F ? undefined : 'failed',
    ),
  );
  const V = preds.map((s) =>
    endo.map((t) => {
      if (model.structural[t]![s] !== 1) return NaN;
      const nPred = model.structural[t]!.filter((v) => v === 1).length;
      return nPred === 1 ? 1 : fit.vif[t]![s]!;
    }),
  );
  out.push(
    matrixEntry(
      'vif-structural',
      'Structural VIF',
      preds.map((j) => ids[j]!),
      endo.map((j) => ids[j]!),
      V,
      false,
      'Variance inflation factor of each predictor in the regression of the endogenous construct (row = predictor, column = endogenous construct): diagonal of the inverse predictor correlation matrix (cSEM Estimates$VIF definition). Equals 1 by definition for a single predictor. Null where there is no path.',
    ),
  );

  const modeB = Array.from({ length: k }, (_, j) => j).filter((j) => model.modeB[j]);
  const vbDef =
    "Indicator VIF within each Mode B block: diagonal of the inverse indicator correlation matrix of the block (cSEM assess() VIF_modeB definition). Rows = indicators of Mode B blocks, columns = Mode B constructs; null outside the indicator's own block and for single-indicator blocks.";
  if (modeB.length === 0) {
    out.push(
      matrixEntry(
        'vif-indicator-mode-b',
        'Indicator VIF (Mode B blocks)',
        [],
        [],
        null,
        false,
        vbDef,
        'not-applicable',
      ),
    );
  } else {
    const rows = modeB.flatMap((j) => model.blocks[j]!);
    const Mv = rows.map(() => new Array<number>(modeB.length).fill(NaN));
    let failed = false;
    modeB.forEach((j, col) => {
      const block = model.blocks[j]!;
      if (block.length < 2) return;
      const v = safe(() => vifModeB(S, block));
      if (!v) {
        failed = true;
        return;
      }
      block.forEach((a, idx) => (Mv[rows.indexOf(a)]![col] = v[idx]!));
    });
    out.push(
      matrixEntry(
        'vif-indicator-mode-b',
        'Indicator VIF (Mode B blocks)',
        rows.map((a) => spec.indicators[a]!.id),
        modeB.map((j) => ids[j]!),
        Mv,
        false,
        vbDef,
        failed ? 'failed' : undefined,
      ),
    );
  }
  return out;
}

// ---- fit --------------------------------------------------------------------------------------

export function buildFit(model: CoreModel, fit: CoreFit, S: Mat): FitIndex[] {
  const fi = safe(() => fitIndices(S, fit, model));
  const defs: Record<'srmr' | 'd_uls' | 'd_g', string> = {
    srmr: 'Standardized root mean square residual: sqrt(mean of the squared differences between the empirical and the model-implied indicator correlations over the lower triangle INCLUDING the diagonal) (cSEM assess() SRMR definition; model-implied matrix as cSEM::fit()). No CB-SEM cutoffs apply.',
    d_uls:
      'Unweighted least-squares discrepancy d_ULS = 0.5 · Σ_ij (s_ij - σ̂_ij)² over all elements of the empirical (S) and model-implied (Σ̂) indicator correlation matrices (cSEM assess() DL definition). No CB-SEM cutoffs apply.',
    d_g: 'Geodesic discrepancy d_G = 0.5 · Σ_i (log10 λ_i)², λ_i the eigenvalues of S⁻¹Σ̂ — base-10 logarithm as cSEM; the natural-log definition is (ln 10)² ≈ 5.30 times larger (cSEM assess() DG definition). No CB-SEM cutoffs apply.',
  };
  const values: Record<'srmr' | 'd_uls' | 'd_g', number | null> = {
    srmr: fi ? fi.srmr : null,
    d_uls: fi ? fi.dUls : null,
    d_g: fi ? fi.dG : null,
  };
  return (['srmr', 'd_uls', 'd_g'] as const).map((name) => {
    const v = numOrReason(values[name], 'failed');
    return v.reason
      ? {
          name,
          value: null,
          missing: v.reason,
          variant: 'standard' as const,
          definition: defs[name],
        }
      : { name, value: v.value, variant: 'standard' as const, definition: defs[name] };
  });
}

// ---- warnings ----------------------------------------------------------------------------------

export interface WarningInput {
  spec: PlsSpec;
  reversed: string[];
  verifyFailed: VerifyCheck[];
  theta: readonly ThetaEntry[];
  thetaValues: readonly number[];
  rhoMessage: string | null;
  truncated: boolean;
  boot: { requested: number; completed: number; failed: number; inadmissible: number } | null;
}

/** R collect_warnings(), preceded by the validation warnings. */
export function collectWarnings(w: WarningInput): ResultWarning[] {
  const out: ResultWarning[] = [...w.spec.warnings];
  const add = (
    code: string,
    severity: ResultWarning['severity'],
    message: string,
    ids?: string[],
  ): void => {
    out.push({
      code,
      severity,
      message: message.slice(0, 2000),
      ...(ids && ids.length > 0 ? { elementIds: [...new Set(ids)] } : {}),
    });
  };
  if (w.reversed.length > 0) {
    add(
      'REVERSE_SCORED_APPLIED',
      'info',
      `${w.reversed.length} indicator(s) were reverse scored before estimation as (scale min + scale max) - x.`,
      w.reversed,
    );
  }
  if (w.verifyFailed.length > 0) {
    add(
      'INADMISSIBLE_SOLUTION',
      'warning',
      `The estimate is not admissible according to the cSEM::verify() checks: ${w.verifyFailed.map((c) => VERIFY_CHECKS[c]).join('; ')} failed. The numbers are reported but should not be interpreted without resolving this.`,
    );
  }
  const neg = w.theta.filter(
    (t, i) =>
      t.kind === 'loading' &&
      !t.single &&
      Number.isFinite(w.thetaValues[i]!) &&
      w.thetaValues[i]! < 0,
  );
  if (neg.length > 0) {
    add(
      'NEGATIVE_LOADING',
      'warning',
      `${neg.length} loading(s) are negative. A construct's sign is arbitrary in PLS (the weights start from unit weights, so each block is oriented so that most loadings are positive); a negative loading usually means a reverse-worded item or a block whose indicators do not share one direction. Check item coding before interpreting path signs.`,
      [...neg.map((t) => t.sourceId), ...neg.map((t) => t.targetId)],
    );
  }
  if (w.rhoMessage) add('RHO_A_UNAVAILABLE', 'warning', w.rhoMessage);
  if (w.truncated) {
    add(
      'SPECIFIC_INDIRECT_TRUNCATED',
      'warning',
      `The structural model has more than ${MAX_SPECIFIC_INDIRECT} indirect chains; only the first ${MAX_SPECIFIC_INDIRECT} specific indirect effects are reported (total and total indirect effects are complete).`,
    );
  }
  const b = w.boot;
  if (b) {
    if (b.inadmissible > 0) {
      add(
        'BOOTSTRAP_INADMISSIBLE_DROPPED',
        b.inadmissible / b.requested > 0.05 ? 'warning' : 'info',
        `${b.inadmissible} of ${b.requested} bootstrap samples were inadmissible (cSEM::verify() checks) and were excluded from the standard errors and intervals.`,
      );
    }
    if (b.failed > 0) {
      add(
        'BOOTSTRAP_FAILED_DRAWS',
        'warning',
        `${b.failed} of ${b.requested} bootstrap samples could not be estimated (e.g. an indicator without variance in the resample, or no convergence) and were excluded.`,
      );
    }
    if (b.completed < 2) {
      add(
        'BOOTSTRAP_TOO_FEW_DRAWS',
        'error',
        `Only ${b.completed} valid bootstrap draw(s); standard errors, p values and intervals are not reported.`,
      );
    }
    if (w.spec.bootstrap?.sides === 'one-sided') {
      add(
        'ONE_SIDED_DIRECTION',
        'info',
        "One-sided inference is taken in the direction of each point estimate's sign: for est >= 0 the lower bound (quantile 1 - level) and p = P(T <= -|t|); for est < 0 the upper bound (quantile level).",
      );
    }
  }
  return out;
}
