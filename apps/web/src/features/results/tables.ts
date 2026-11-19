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
  MISSING_REASON_TEXT,
  type NumberStyle,
  formatInterval,
  formatNumber,
  formatP,
} from '../reports/format';
import type { ReportColumn, ReportTable } from '../reports/table';

export interface TableContext {
  model: SemModel;
  result: NormalizedSemResult;
  analysis: AnalysisConfiguration;
  style?: Partial<NumberStyle>;
}

const METHOD_TEXT: Record<AnalysisConfiguration['method'], string> = {
  'pls-sem': 'PLS-SEM (classic PLS path modeling, no consistency correction)',
  plsc: 'PLSc (consistent PLS)',
  'cb-sem': 'CB-SEM',
};

const nameOf = (m: SemModel, id: string | undefined): string =>
  (id &&
    (m.constructs.find((c) => c.id === id)?.name ?? m.indicators.find((i) => i.id === id)?.name)) ||
  (id ?? '');

/** "PLS-SEM … , path weighting scheme, N = 500" */
export function methodLine(ctx: TableContext): string {
  const parts = [METHOD_TEXT[ctx.analysis.method]];
  if (ctx.analysis.pls) parts.push(`${ctx.analysis.pls.innerWeighting} weighting scheme`);
  parts.push(`N = ${ctx.result.sample.nUsed}`);
  if (ctx.result.sample.nDropped > 0)
    parts.push(
      `${ctx.result.sample.nDropped} of ${ctx.result.sample.nRows} rows removed by listwise deletion`,
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

/** A matrix (HTMT, Fornell–Larcker, …) as a lower-triangular table with construct names. */
export function matrixTable(
  ctx: TableContext,
  matrixId: string,
  triangle: 'lower' | 'full' = 'lower',
): ReportTable | null {
  const m = ctx.result.matrices.find((x) => x.id === matrixId);
  if (!m) return null;
  const rows = m.rowIds.map((rid, i) => {
    const row: Record<string, string> = { r: nameOf(ctx.model, rid) };
    m.colIds.forEach((cid, j) => {
      row[cid] =
        triangle === 'lower' && j > i ? '' : formatNumber(m.values[i]?.[j] ?? null, ctx.style);
    });
    return row;
  });
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
      ...(m.missing ? [`– ${MISSING_REASON_TEXT[m.missing]}.`] : []),
    ],
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
