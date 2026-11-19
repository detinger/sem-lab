/**
 * Build report tables from a NormalizedSemResult (PLAN §2.7). Pure functions: the same result
 * always gives the same tables, in the app, in the clipboard and in downloads.
 *
 * Rules: labels come from the model (ids → names); absent numbers show an en dash and their
 * reason goes into the table note; every table states method, scale and N; nothing is
 * coloured or worded as "supported/rejected" (STYLE §13).
 */
import type {
  AnalysisConfiguration,
  MissingReason,
  NormalizedSemResult,
  ParameterEstimate,
  SemModel,
} from '@sem-studio/contracts';
import {
  MISSING,
  MISSING_REASON_TEXT,
  type NumberStyle,
  formatInterval,
  formatNumber,
  formatP,
} from '../reports/format';
import type { ReportColumn, ReportTable } from '../reports/table';

export type CbScale = 'standardized' | 'unstandardized';

export interface TableContext {
  model: SemModel;
  result: NormalizedSemResult;
  analysis: AnalysisConfiguration;
  style?: Partial<NumberStyle>;
  /** CB-SEM tables: which estimates are shown (default standardized) */
  scale?: CbScale;
}

const METHOD_TEXT: Record<AnalysisConfiguration['method'], string> = {
  'pls-sem': 'PLS-SEM (classic PLS path modeling, no consistency correction)',
  plsc: 'PLSc (consistent PLS)',
  'cb-sem': 'CB-SEM',
};

const CB_ESTIMATOR_TEXT: Record<string, string> = {
  ML: 'maximum likelihood (ML)',
  MLR: 'robust maximum likelihood (MLR)',
};

const nameOf = (m: SemModel, id: string | undefined): string =>
  (id &&
    (m.constructs.find((c) => c.id === id)?.name ?? m.indicators.find((i) => i.id === id)?.name)) ||
  (id ?? '');

/** "PLS-SEM … , path weighting scheme, N = 500" */
export function methodLine(ctx: TableContext): string {
  const parts = [METHOD_TEXT[ctx.analysis.method]];
  if (ctx.analysis.method === 'cb-sem') {
    const a = ctx.analysis;
    parts.push(CB_ESTIMATOR_TEXT[a.estimator] ?? a.estimator);
    parts.push(
      a.cb?.identification === 'std-lv' ? 'factor variances fixed to 1' : 'marker indicators',
    );
    parts.push(a.missingData === 'fiml' ? 'FIML' : 'listwise deletion');
  }
  if (ctx.analysis.pls) parts.push(`${ctx.analysis.pls.innerWeighting} weighting scheme`);
  parts.push(`N = ${ctx.result.sample.nUsed}`);
  if (ctx.result.sample.nDropped > 0)
    parts.push(
      ctx.analysis.missingData === 'fiml'
        ? `${ctx.result.sample.nDropped} of ${ctx.result.sample.nRows} rows without any observed value removed`
        : `${ctx.result.sample.nDropped} of ${ctx.result.sample.nRows} rows removed by listwise deletion`,
    );
  return parts.join(', ');
}

export function inferenceNote(ctx: TableContext): string | null {
  const b = ctx.result.bootstrap;
  if (!b)
    return 'No bootstrap was run, so standard errors, t statistics, p values and confidence intervals are not available.';
  const level = Math.round(b.confidenceLevel * 100);
  return (
    `Bootstrap with ${b.completed.toLocaleString('en')} valid of ${b.requested.toLocaleString('en')} requested samples (seed ${b.seed}` +
    `${b.failed ? `, ${b.failed} failed` : ''}${b.inadmissible ? `, ${b.inadmissible} inadmissible and excluded` : ''}). ` +
    `SE = standard deviation of the bootstrap estimates; t = estimate / SE; p from the t distribution with B − 1 degrees of freedom (${ctx.analysis.bootstrap?.sides ?? 'two-sided'}); ` +
    `${level}% ${b.ciMethod} confidence intervals.`
  );
}

function missingNotes(params: ParameterEstimate[]): string[] {
  const reasons = new Set<MissingReason>();
  for (const p of params) for (const r of Object.values(p.missing ?? {})) if (r) reasons.add(r);
  return [...reasons].map((r) => `– ${MISSING_REASON_TEXT[r]}.`);
}

const inferenceColumns: ReportColumn[] = [
  { key: 'se', label: 'SE', align: 'right', numeric: true },
  { key: 't', label: 't', align: 'right', numeric: true },
  { key: 'p', label: 'p', align: 'right', numeric: true },
  { key: 'ci', label: 'CI', align: 'right', numeric: true },
];

function inferenceCells(
  p: ParameterEstimate,
  style?: Partial<NumberStyle>,
): Record<string, string> {
  return {
    se: formatNumber(p.se, style),
    t: formatNumber(p.statistic, { ...style, decimals: 2 }),
    p: formatP(p.pValue, { ...style, decimals: 3 }),
    ci: formatInterval(p.ciLower, p.ciUpper, style),
  };
}

function withCiLabel(cols: ReportColumn[], ctx: TableContext): ReportColumn[] {
  const level = ctx.result.bootstrap ? Math.round(ctx.result.bootstrap.confidenceLevel * 100) : 95;
  return cols.map((c) => (c.key === 'ci' ? { ...c, label: `${level}% CI` } : c));
}

// ---------------------------------------------------------------- structural

export function pathsTable(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const paths = result.parameters.filter((p) => p.kind === 'path');
  const hyp = (p: ParameterEstimate): string => {
    const r = model.relationships.find(
      (x) =>
        x.id === p.relationshipId ||
        (x.sourceId === p.sourceId && x.targetId === p.targetId && x.kind === 'structural'),
    );
    return r && r.kind === 'structural' ? (r.hypothesis ?? '') : '';
  };
  const hasHyp = paths.some((p) => hyp(p));
  return {
    id: 'paths',
    title: 'Path coefficients',
    caption: 'Path coefficients',
    columns: withCiLabel(
      [
        ...(hasHyp ? [{ key: 'h', label: 'Hypothesis', align: 'left' as const }] : []),
        { key: 'path', label: 'Path', align: 'left' },
        { key: 'est', label: 'β', align: 'right', numeric: true },
        ...inferenceColumns,
      ],
      ctx,
    ),
    rows: paths.map((p) => ({
      h: hyp(p),
      path: `${nameOf(model, p.sourceId)} → ${nameOf(model, p.targetId)}`,
      est: formatNumber(p.est, style),
      ...inferenceCells(p, style),
    })),
    notes: [
      `${methodLine(ctx)}. Standardized coefficients.`,
      inferenceNote(ctx),
      ...missingNotes(paths),
    ].filter((x): x is string => !!x),
  };
}

export function effectsTable(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const kinds = ['total-effect', 'indirect-effect', 'specific-indirect'] as const;
  const rows = result.parameters.filter((p) => (kinds as readonly string[]).includes(p.kind));
  const label = (p: ParameterEstimate): string =>
    p.kind === 'specific-indirect'
      ? [p.sourceId, ...(p.viaIds ?? []), p.targetId].map((id) => nameOf(model, id)).join(' → ')
      : `${nameOf(model, p.sourceId)} → ${nameOf(model, p.targetId)}`;
  const kindText = {
    'total-effect': 'Total',
    'indirect-effect': 'Total indirect',
    'specific-indirect': 'Specific indirect',
  } as const;
  return {
    id: 'effects',
    title: 'Total and indirect effects',
    caption: 'Total, total indirect and specific indirect effects',
    columns: withCiLabel(
      [
        { key: 'effect', label: 'Effect', align: 'left' },
        { key: 'type', label: 'Type', align: 'left' },
        { key: 'est', label: 'Estimate', align: 'right', numeric: true },
        ...inferenceColumns,
      ],
      ctx,
    ),
    rows: rows.map((p) => ({
      effect: label(p),
      type: kindText[p.kind as (typeof kinds)[number]],
      est: formatNumber(p.est, style),
      ...inferenceCells(p, style),
    })),
    notes: [
      `${methodLine(ctx)}. Specific indirect effects are products of the path coefficients along each route, computed within every bootstrap sample.`,
      inferenceNote(ctx),
      ...missingNotes(rows),
    ].filter((x): x is string => !!x),
  };
}

export function r2Table(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const endo = model.constructs.filter((c) =>
    result.constructMetrics.some(
      (m) => m.constructId === c.id && m.metric === 'r2' && m.value !== null,
    ),
  );
  const v = (cid: string, metric: string): number | null =>
    result.constructMetrics.find((m) => m.constructId === cid && m.metric === metric)?.value ??
    null;
  return {
    id: 'r2',
    title: 'Explained variance',
    caption: 'Coefficient of determination',
    columns: [
      { key: 'c', label: 'Construct', align: 'left' },
      { key: 'r2', label: 'R²', align: 'right', numeric: true },
      { key: 'adj', label: 'Adjusted R²', align: 'right', numeric: true },
    ],
    rows: endo.map((c) => ({
      c: c.name,
      r2: formatNumber(v(c.id, 'r2'), style),
      adj: formatNumber(v(c.id, 'r2-adjusted'), style),
    })),
    notes: [
      `${methodLine(ctx)}. Adjusted R² = 1 − (1 − R²)(N − 1)/(N − k − 1), k = number of predictors.`,
    ],
  };
}

// ---------------------------------------------------------------- measurement

export function loadingsTable(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const find = (
    kind: 'loading' | 'weight',
    cid: string,
    iid: string,
  ): ParameterEstimate | undefined =>
    result.parameters.find((p) => p.kind === kind && p.sourceId === cid && p.targetId === iid) ??
    result.parameters.find((p) => p.kind === kind && p.sourceId === iid && p.targetId === cid);
  const rows: Array<Record<string, string>> = [];
  const used: ParameterEstimate[] = [];
  for (const c of model.constructs) {
    c.indicatorIds.forEach((iid, k) => {
      const l = find('loading', c.id, iid);
      const w = find('weight', c.id, iid);
      if (l) used.push(l);
      rows.push({
        c:
          k === 0
            ? `${c.name} (${c.measurement === 'reflective' ? 'reflective' : 'composite'})`
            : '',
        i: nameOf(model, iid),
        l: formatNumber(l?.est ?? null, style),
        lci: formatInterval(l?.ciLower ?? null, l?.ciUpper ?? null, style),
        w: formatNumber(w?.est ?? null, style),
      });
    });
  }
  return {
    id: 'loadings',
    title: 'Outer loadings and weights',
    caption: 'Outer loadings and outer weights',
    columns: [
      { key: 'c', label: 'Construct', align: 'left' },
      { key: 'i', label: 'Indicator', align: 'left' },
      { key: 'l', label: 'Loading', align: 'right', numeric: true },
      {
        key: 'lci',
        label: `${ctx.result.bootstrap ? Math.round(ctx.result.bootstrap.confidenceLevel * 100) : 95}% CI (loading)`,
        align: 'right',
        numeric: true,
      },
      { key: 'w', label: 'Weight', align: 'right', numeric: true },
    ],
    rows,
    notes: [
      `${methodLine(ctx)}. Standardized. Loadings describe how strongly each indicator relates to its construct; for composite (Mode B) blocks the weights carry the construct definition and loadings serve content interpretation.`,
      ...missingNotes(used),
    ],
  };
}

export function reliabilityTable(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const metric = (cid: string, m: string) =>
    result.constructMetrics.find((x) => x.constructId === cid && x.metric === m);
  const cols: Array<[string, string]> = [
    ['cronbach-alpha', 'Cronbach’s α'],
    ['rho-a', 'ρA'],
    ['rho-c', 'ρC'],
    ['ave', 'AVE'],
  ];
  const reasons = new Set<MissingReason>();
  const rows = model.constructs.map((c) => {
    const row: Record<string, string> = { c: c.name };
    for (const [key] of cols) {
      const m = metric(c.id, key);
      if (m?.missing) reasons.add(m.missing);
      row[key] = formatNumber(m?.value ?? null, style);
    }
    return row;
  });
  return {
    id: 'reliability',
    title: 'Reliability and convergent validity',
    caption: 'Construct reliability and convergent validity',
    columns: [
      { key: 'c', label: 'Construct', align: 'left' },
      ...cols.map(([key, label]) => ({ key, label, align: 'right' as const, numeric: true })),
    ],
    rows,
    notes: [
      `${methodLine(ctx)}. ρA (Dijkstra–Henseler) is taken from a consistent PLS estimation of the same model. ρC = composite reliability; AVE = average variance extracted.`,
      'These measures assume reflective measurement; they are not reported for composite/formative or single-indicator constructs.',
      ...[...reasons].map((r) => `– ${MISSING_REASON_TEXT[r]}.`),
    ],
  };
}

/** Discriminant-validity margin for cross-loadings: own-construct loading should exceed any
 *  cross-loading by at least this much (Gefen & Straub 2005). */
const CROSS_LOADING_MARGIN = 0.1;

/** A matrix (HTMT, Fornell–Larcker, …) as a lower-triangular table with construct names. */
export function matrixTable(
  ctx: TableContext,
  matrixId: string,
  triangle: 'lower' | 'full' = 'lower',
): ReportTable | null {
  const m = ctx.result.matrices.find((x) => x.id === matrixId);
  if (!m) return null;
  // Emphasise the cells readers look for: the Fornell–Larcker diagonal (√AVE), and in
  // cross-loadings each indicator's loading on its own construct.
  const constructOf = new Map<string, string>();
  if (matrixId === 'cross-loadings')
    for (const c of ctx.model.constructs) for (const iid of c.indicatorIds) constructOf.set(iid, c.id);
  const emphatic = (rid: string, cid: string): boolean =>
    matrixId === 'fornell-larcker'
      ? rid === cid
      : matrixId === 'cross-loadings'
        ? constructOf.get(rid) === cid
        : false;
  const bold = new Set<string>();
  const rows = m.rowIds.map((rid, i) => {
    const row: Record<string, string> = { r: nameOf(ctx.model, rid) };
    m.colIds.forEach((cid, j) => {
      const blank = triangle === 'lower' && j > i;
      row[cid] = blank ? '' : formatNumber(m.values[i]?.[j] ?? null, ctx.style);
      if (!blank && row[cid] !== '' && emphatic(rid, cid)) bold.add(`${i}:${cid}`);
    });
    return row;
  });
  // Discriminant-validity flags (both by magnitude, so a sign flip cannot hide a problem):
  //  - cross-loadings: an indicator should load on its own construct at least CROSS_LOADING_MARGIN
  //    higher than on any other (Gefen & Straub 2005);
  //  - Fornell–Larcker: a construct's √AVE (the bold diagonal) must exceed its correlation with
  //    every other construct — a strict comparison, no margin (Fornell & Larcker 1981).
  const warn = new Set<string>();
  if (matrixId === 'cross-loadings') {
    m.rowIds.forEach((rid, i) => {
      const ownCid = constructOf.get(rid);
      if (ownCid === undefined) return;
      const own = m.values[i]?.[m.colIds.indexOf(ownCid)];
      if (own === null || own === undefined) return;
      m.colIds.forEach((cid, j) => {
        if (cid === ownCid) return;
        const other = m.values[i]?.[j];
        if (other === null || other === undefined) return;
        if (Math.abs(own) - Math.abs(other) < CROSS_LOADING_MARGIN) warn.add(`${i}:${cid}`);
      });
    });
  } else if (matrixId === 'fornell-larcker') {
    m.rowIds.forEach((_rid, i) => {
      const diagI = m.values[i]?.[i];
      m.colIds.forEach((cid, j) => {
        if (j >= i) return; // only the shown lower off-diagonal correlations
        const corr = m.values[i]?.[j];
        const diagJ = m.values[j]?.[j];
        if (corr === null || corr === undefined) return;
        if (diagI === null || diagI === undefined || diagJ === null || diagJ === undefined) return;
        if (Math.abs(corr) >= Math.min(diagI, diagJ)) warn.add(`${i}:${cid}`);
      });
    });
  }
  return {
    id: m.id,
    title: m.title,
    caption: m.title,
    columns: [
      { key: 'r', label: '', align: 'left' },
      ...m.colIds.map((cid) => ({
        key: cid,
        label: nameOf(ctx.model, cid),
        align: 'right' as const,
        numeric: true,
      })),
    ],
    rows,
    notes: [
      `${methodLine(ctx)}. ${m.definition}`,
      ...(warn.size > 0 && matrixId === 'cross-loadings'
        ? [
            `Red cross-loadings come within ${CROSS_LOADING_MARGIN.toFixed(1)} of the indicator's own-construct loading (Gefen & Straub 2005) — a possible discriminant-validity concern; corroborate with HTMT.`,
          ]
        : []),
      ...(warn.size > 0 && matrixId === 'fornell-larcker'
        ? [
            `Red correlations equal or exceed a construct's √AVE (bold diagonal), so the Fornell–Larcker criterion is not met for that pair (Fornell & Larcker 1981); corroborate with HTMT.`,
          ]
        : []),
      ...(m.missing ? [`– ${MISSING_REASON_TEXT[m.missing]}.`] : []),
    ],
    ...(bold.size > 0 ? { bold } : {}),
    ...(warn.size > 0 ? { warn } : {}),
  };
}

export function fitTable(ctx: TableContext): ReportTable {
  return {
    id: 'fit',
    title: 'Model fit',
    caption: 'Model fit and discrepancy measures',
    columns: [
      { key: 'n', label: 'Measure', align: 'left' },
      { key: 'v', label: 'Value', align: 'right', numeric: true },
      { key: 'd', label: 'Definition', align: 'left' },
    ],
    rows: ctx.result.fit.map((f) => ({
      n: f.name.toUpperCase().replace('_', ' '),
      v: formatNumber(f.value, ctx.style),
      d: f.definition,
    })),
    notes: [
      `${methodLine(ctx)}. No universal cut-offs are applied; interpret discrepancy measures with their definitions and limitations.`,
    ],
  };
}

// =============================================================== CB-SEM

const CB_ROWS_NOTE =
  'Standard errors, z and p are analytic and belong to the unstandardized estimates; they are not computed for standardized ones.';

export const scaleOf = (ctx: TableContext): CbScale => ctx.scale ?? 'standardized';
export const SCALE_LABEL: Record<CbScale, string> = {
  standardized: 'Standardized',
  unstandardized: 'Unstandardized',
};
const SHORT: Record<CbScale, string> = { standardized: 'Std.', unstandardized: 'Unstd.' };

/** The legend line shown with the Standardized / Unstandardized toggle. */
export function scaleLegend(scale: CbScale): string {
  return scale === 'standardized'
    ? 'Showing standardized estimates (lavaan std.all): loadings, paths and (co)variances are scaled by the model-implied standard deviations. Standard errors, z and p are not computed for standardized estimates and show an en dash; switch to Unstandardized for them.'
    : 'Showing unstandardized estimates, in the units of the indicators and of the identification scaling (marker indicator or fixed factor variance). Standard errors, z and p are analytic.';
}

function inferenceMethodNote(ctx: TableContext): string {
  const a = ctx.analysis;
  const how =
    a.estimator === 'MLR'
      ? 'robust (Huber–White sandwich) standard errors'
      : a.missingData === 'fiml'
        ? 'standard errors from the observed information matrix'
        : 'standard errors from the expected information matrix';
  return `Analytic ${how}; z = estimate / SE; two-sided normal p; 95% Wald confidence intervals. No bootstrap was run.`;
}

function cbParam(
  ctx: TableContext,
  scale: CbScale,
  kind: ParameterEstimate['kind'],
  match: (p: ParameterEstimate) => boolean,
): ParameterEstimate | undefined {
  return ctx.result.parameters.find((p) => p.kind === kind && p.scale === scale && match(p));
}

function cbInference(
  p: ParameterEstimate | undefined,
  scale: CbScale,
  style?: Partial<NumberStyle>,
): Record<string, string> {
  // inference exists for the unstandardized record only: standardized rows show an en dash
  const q = scale === 'unstandardized' ? p : undefined;
  return {
    se: formatNumber(q?.se ?? null, style),
    z: formatNumber(q?.statistic ?? null, { ...style, decimals: 2 }),
    p: formatP(q?.pValue ?? null, { ...style, decimals: 3 }),
    ci: formatInterval(q?.ciLower ?? null, q?.ciUpper ?? null, style),
  };
}

const cbInferenceColumns = (): ReportColumn[] => [
  { key: 'se', label: 'SE', align: 'right', numeric: true },
  { key: 'z', label: 'z', align: 'right', numeric: true },
  { key: 'p', label: 'p', align: 'right', numeric: true },
  { key: 'ci', label: '95% CI', align: 'right', numeric: true },
];

function cbNotes(ctx: TableContext, extra: string[], params: ParameterEstimate[]): string[] {
  const scale = scaleOf(ctx);
  const fixed = params.some((p) => p.status === 'fixed');
  return [
    `${methodLine(ctx)}. ${SCALE_LABEL[scale]} estimates.`,
    ...extra,
    ...(fixed ? ['Fixed parameters (identification constraints) have no standard error.'] : []),
    inferenceMethodNote(ctx),
    ...(scale === 'standardized' ? [`– ${CB_ROWS_NOTE}`] : []),
    ...missingNotes(scale === 'unstandardized' ? params.filter((p) => p.status !== 'fixed') : []),
  ];
}

/** CB-SEM loadings: the selected scale first, then SE / z / p / CI, then the other scale. */
export function cbLoadingsTable(ctx: TableContext): ReportTable {
  const { model, style } = ctx;
  const scale = scaleOf(ctx);
  const other: CbScale = scale === 'standardized' ? 'unstandardized' : 'standardized';
  const rows: Array<Record<string, string>> = [];
  const used: ParameterEstimate[] = [];
  for (const c of model.constructs) {
    c.indicatorIds.forEach((iid, k) => {
      const isMine = (p: ParameterEstimate): boolean => p.sourceId === c.id && p.targetId === iid;
      const mine = cbParam(ctx, scale, 'loading', isMine);
      const unstd = cbParam(ctx, 'unstandardized', 'loading', isMine);
      const alt = cbParam(ctx, other, 'loading', isMine);
      if (unstd) used.push(unstd);
      rows.push({
        c: k === 0 ? c.name : '',
        i: nameOf(model, iid),
        est:
          formatNumber(mine?.est ?? null, style) +
          (unstd?.status === 'fixed' && scale === 'unstandardized' ? ' (fixed)' : ''),
        ...cbInference(unstd, scale, style),
        alt: formatNumber(alt?.est ?? null, style),
      });
    });
  }
  return {
    id: 'cb-loadings',
    title: `Factor loadings (${scale})`,
    caption: `Factor loadings, ${scale} estimates`,
    columns: [
      { key: 'c', label: 'Factor', align: 'left' },
      { key: 'i', label: 'Indicator', align: 'left' },
      { key: 'est', label: `${SCALE_LABEL[scale]} loading`, align: 'right', numeric: true },
      ...cbInferenceColumns(),
      { key: 'alt', label: `${SCALE_LABEL[other]} loading`, align: 'right', numeric: true },
    ],
    rows,
    notes: cbNotes(
      ctx,
      [`The last column repeats the loading on the ${other} scale (${SHORT[other]}).`],
      used,
    ),
  };
}

export function cbPathsTable(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const scale = scaleOf(ctx);
  const paths = result.parameters.filter((p) => p.kind === 'path' && p.scale === 'unstandardized');
  const rows = paths.map((u) => {
    const mine = cbParam(ctx, scale, 'path', (p) => p.key === u.key);
    return {
      path: `${nameOf(model, u.sourceId)} → ${nameOf(model, u.targetId)}`,
      est: formatNumber(mine?.est ?? null, style),
      ...cbInference(u, scale, style),
    };
  });
  return {
    id: 'cb-paths',
    title: `Structural paths (${scale})`,
    caption: `Structural paths, ${scale} estimates`,
    columns: [
      { key: 'path', label: 'Path', align: 'left' },
      {
        key: 'est',
        label: scale === 'standardized' ? 'β (standardized)' : 'B (unstandardized)',
        align: 'right',
        numeric: true,
      },
      ...cbInferenceColumns(),
    ],
    rows,
    notes: cbNotes(ctx, [], paths),
  };
}

/** Variances and covariances of the factors (and covariances between indicator residuals). */
export function cbCovariancesTable(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const scale = scaleOf(ctx);
  const unstd = result.parameters.filter(
    (p) =>
      p.scale === 'unstandardized' &&
      (p.kind === 'covariance' || (p.kind === 'variance' && !p.key.includes('intercept'))),
  );
  const rows = unstd.map((u) => {
    const mine = cbParam(ctx, scale, u.kind, (p) => p.key === u.key);
    const label =
      u.kind === 'variance'
        ? `${nameOf(model, u.sourceId)} (variance)`
        : `${nameOf(model, u.sourceId)} ↔ ${nameOf(model, u.targetId)}`;
    return {
      label,
      est: formatNumber(mine?.est ?? null, style),
      ...cbInference(u, scale, style),
    };
  });
  return {
    id: 'cb-covariances',
    title: `Factor variances and covariances (${scale})`,
    caption: `Factor variances and covariances, ${scale} estimates`,
    columns: [
      { key: 'label', label: 'Parameter', align: 'left' },
      {
        key: 'est',
        label:
          scale === 'standardized'
            ? 'Estimate (standardized: variance 1 / correlation)'
            : 'Estimate (unstandardized)',
        align: 'right',
        numeric: true,
      },
      ...cbInferenceColumns(),
    ],
    rows,
    notes: cbNotes(ctx, [], unstd),
  };
}

/** Model-implied factor correlations (the same on both scales). */
export function cbCorrelationsTable(ctx: TableContext): ReportTable | null {
  return matrixTable(ctx, 'latent-correlations', 'lower');
}

export function cbResidualsTable(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const scale = scaleOf(ctx);
  const unstd = result.parameters.filter(
    (p) => p.scale === 'unstandardized' && p.kind === 'residual-variance',
  );
  const rows = unstd.map((u) => {
    const mine = cbParam(ctx, scale, 'residual-variance', (p) => p.key === u.key);
    const isInd = model.indicators.some((i) => i.id === u.sourceId);
    return {
      label: `${nameOf(model, u.sourceId)} (${isInd ? 'indicator residual' : 'disturbance'})`,
      est: formatNumber(mine?.est ?? null, style),
      ...cbInference(u, scale, style),
    };
  });
  return {
    id: 'cb-residuals',
    title: `Residual variances (${scale})`,
    caption: `Residual variances, ${scale} estimates`,
    columns: [
      { key: 'label', label: 'Residual', align: 'left' },
      {
        key: 'est',
        label:
          scale === 'standardized' ? 'Standardized (share of variance)' : 'Unstandardized variance',
        align: 'right',
        numeric: true,
      },
      ...cbInferenceColumns(),
    ],
    rows,
    notes: cbNotes(
      ctx,
      [
        'A negative residual variance is reported as estimated, never clamped; see the diagnostics.',
      ],
      unstd,
    ),
  };
}

export function cbR2Table(ctx: TableContext): ReportTable {
  const { model, result, style } = ctx;
  const rows = model.constructs
    .map((c) => ({
      c,
      m: result.constructMetrics.find((x) => x.constructId === c.id && x.metric === 'r2'),
    }))
    .filter((x) => x.m && x.m.value !== null)
    .map(({ c, m }) => ({ c: c.name, r2: formatNumber(m!.value, style) }));
  return {
    id: 'cb-r2',
    title: 'Explained variance (R²)',
    caption: 'Coefficient of determination of the endogenous factors',
    columns: [
      { key: 'c', label: 'Factor', align: 'left' },
      { key: 'r2', label: 'R²', align: 'right', numeric: true },
    ],
    rows,
    notes: [
      `${methodLine(ctx)}. R² = 1 − ψ / Var(η), model-implied; it is the same on the standardized and the unstandardized scale. Exogenous factors have no R².`,
    ],
  };
}

const FIT_LABEL: Record<string, string> = {
  chisq: 'χ²',
  df: 'df',
  pvalue: 'p (χ² test)',
  'chisq.scaling.factor': 'χ² scaling factor',
  cfi: 'CFI',
  tli: 'TLI',
  rmsea: 'RMSEA',
  srmr: 'SRMR',
  aic: 'AIC',
  bic: 'BIC',
};
const FIT_ORDER = Object.keys(FIT_LABEL);
const VARIANT_LABEL = { standard: '', scaled: ' (scaled)', robust: ' (robust)' } as const;

/** Fit indices of a CB-SEM result; scaled / robust variants are labelled, absent values show an en dash. */
export function cbFitTable(ctx: TableContext): ReportTable {
  const { result, style } = ctx;
  const reasons = new Set<MissingReason>();
  const shown = result.fit.filter(
    (f) => FIT_ORDER.includes(f.name) && (f.variant === undefined || f.variant in VARIANT_LABEL),
  );
  const rank = (f: (typeof shown)[number]): number =>
    FIT_ORDER.indexOf(f.name) * 3 + (f.variant === 'scaled' ? 1 : f.variant === 'robust' ? 2 : 0);
  shown.sort((a, b) => rank(a) - rank(b));
  const rows = shown.map((f) => {
    if (f.missing) reasons.add(f.missing);
    const isP = f.name === 'pvalue';
    const isDf = f.name === 'df';
    const hasCi = f.ciLower !== undefined && f.ciUpper !== undefined && f.ciLower !== null;
    return {
      m: `${FIT_LABEL[f.name]}${f.variant ? VARIANT_LABEL[f.variant] : ''}${hasCi ? ' [90% CI]' : ''}`,
      v: isDf
        ? f.value === null
          ? MISSING
          : String(f.value)
        : isP
          ? formatP(f.value, style)
          : formatNumber(f.value, style),
      ci: hasCi ? formatInterval(f.ciLower ?? null, f.ciUpper ?? null, style) : '',
      d: f.definition,
    };
  });
  return {
    id: 'cb-fit',
    title: 'Model fit',
    caption: 'Global fit of the CB-SEM model',
    columns: [
      { key: 'm', label: 'Measure', align: 'left' },
      { key: 'v', label: 'Value', align: 'right', numeric: true },
      { key: 'ci', label: '90% CI', align: 'right', numeric: true },
      { key: 'd', label: 'Definition', align: 'left' },
    ],
    rows,
    notes: [
      `${methodLine(ctx)}. No universal cut-offs are applied; interpret fit indices with their definitions and limitations.`,
      ...(shown.some((f) => f.variant === 'scaled' || f.variant === 'robust')
        ? [
            '(scaled) = Yuan–Bentler scaled test statistic and the indices built from it; (robust) = robust CFI, TLI and RMSEA.',
          ]
        : []),
      ...[...reasons].map(
        (r) =>
          `– ${MISSING_REASON_TEXT[r]}${r === 'not-applicable' && shown.some((f) => f.name === 'df' && f.value === 0) ? ' (the model is just-identified, df = 0)' : ''}.`,
      ),
    ],
  };
}

/** Heywood / admissibility diagnostics of a CB result, in neutral words. */
export function cbDiagnostics(result: NormalizedSemResult): {
  admissible: boolean | null;
  heywood: string[];
  others: Array<{ code: string; severity: string; message: string }>;
} {
  const heywood = result.warnings
    .filter((w) => w.code === 'CB_NEGATIVE_VARIANCE')
    .map((w) => w.message);
  return {
    admissible: result.estimation.admissible,
    heywood,
    others: result.warnings
      .filter((w) => w.code !== 'CB_NEGATIVE_VARIANCE')
      .map((w) => ({ code: w.code, severity: w.severity, message: w.message })),
  };
}
