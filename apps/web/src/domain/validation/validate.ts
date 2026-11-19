/**
 * Model and analysis readiness validator (PLAN §2.3, Module C).
 *
 * Severities: error = cannot estimate as configured; warning = may distort inference;
 * recommendation = improvement or additional check; info = context.
 * Every issue explains the consequence and offers at least one fix. Heuristics are labelled
 * as heuristics; identification checks are necessary conditions, never proofs.
 *
 * Inputs are plain data so the validator runs offline, in tests and (later) on the server.
 */
import {
  type AnalysisConfiguration,
  type SemMethod,
  type SemModel,
  validateModelStructure,
} from '@sem-studio/contracts';
import {
  capability,
  isOffered,
  requiredCapabilities,
  unavailableReason,
} from '@sem-studio/method-registry';
import { constructRoles, findCycles, structuralGraph } from '../graph';
import { blocksOf } from '../model-ops';

export type IssueSeverity = 'error' | 'warning' | 'recommendation' | 'info';
export type IssueLayer = 'structural' | 'measurement' | 'data' | 'estimator';

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  layer: IssueLayer;
  title: string;
  /** why it matters: the statistical consequence */
  explanation: string;
  fixes: string[];
  /** model element ids to focus */
  elementIds: string[];
  /** dataset column names involved */
  columns?: string[];
  /** Learn module topic id (Phase 6) */
  learn?: string;
}

/** Per-column summary; ColumnProfile from the Data Lab satisfies it. */
export interface DataColumnSummary {
  name: string;
  kind: 'numeric' | 'text' | 'empty';
  n: number;
  nMissing: number;
  sdSample: number | null;
  min: number | null;
  max: number | null;
  skewness?: number | null;
  kurtosis?: number | null;
  nonNumericCount?: number;
}

export interface DataSummary {
  rowCount: number;
  columns: readonly DataColumnSummary[];
  /** rows complete on every column the model uses (listwise n); computed by the caller */
  completeRows?: number;
}

export interface ValidationInput {
  model: SemModel;
  /** the method being prepared; undefined = method-independent checks only */
  method?: SemMethod;
  analysis?: AnalysisConfiguration;
  data?: DataSummary;
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  error: 0,
  warning: 1,
  recommendation: 2,
  info: 3,
};

export function validate(input: ValidationInput): ValidationIssue[] {
  const method = input.analysis?.method ?? input.method;
  const issues = [
    ...structuralIssues(input.model, method),
    ...measurementIssues(input.model, method),
    ...(method === 'cb-sem' ? identificationIssues(input.model) : []),
    ...(input.data ? dataIssues(input.model, input.data, method, input.analysis) : []),
    ...(input.analysis ? estimatorIssues(input.model, input.analysis) : []),
  ];
  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export const hasBlockingIssues = (issues: readonly ValidationIssue[]): boolean =>
  issues.some((i) => i.severity === 'error');

const methodLabel = (m: SemMethod): string =>
  ({ 'pls-sem': 'PLS-SEM', plsc: 'PLSc', 'cb-sem': 'CB-SEM' })[m];
const isPls = (m: SemMethod | undefined): m is 'pls-sem' | 'plsc' =>
  m === 'pls-sem' || m === 'plsc';

// ---------------------------------------------------------------- structural

function structuralIssues(model: SemModel, method: SemMethod | undefined): ValidationIssue[] {
  const out: ValidationIssue[] = validateModelStructure(model).map((s) => ({
    code: `STRUCTURE_${s.code}`,
    severity: 'error',
    layer: 'structural',
    title: s.message,
    explanation:
      'The model file is internally inconsistent, so its meaning is ambiguous and it cannot be estimated.',
    fixes: ['Remove or reconnect the affected element in the Modeler.'],
    elementIds: s.elementIds,
  }));
  if (model.constructs.length === 0) {
    out.push({
      code: 'MODEL_EMPTY',
      severity: 'error',
      layer: 'structural',
      title: 'The model has no constructs',
      explanation: 'There is nothing to estimate.',
      fixes: ['Add constructs in the Modeler or start from a template.'],
      elementIds: [],
    });
    return out;
  }
  const g = structuralGraph(model);
  const nPaths = [...g.out.values()].reduce((s, t) => s + t.length, 0);

  for (const cycle of findCycles(model)) {
    out.push({
      code: 'STRUCTURAL_CYCLE',
      severity: 'error',
      layer: 'structural',
      title: `Feedback loop: ${cycle.map((id) => nameOf(model, id)).join(' → ')} → ${nameOf(model, cycle[0]!)}`,
      explanation:
        'Nonrecursive (feedback) models need special identification and estimation. Standard PLS path modeling assumes a recursive model, and nonrecursive CB-SEM is outside the scope of this version.',
      fixes: ['Remove or reverse one path in the loop, if theory allows.'],
      elementIds: cycle,
      learn: 'recursive-models',
    });
  }

  if (nPaths === 0) {
    if (isPls(method)) {
      out.push({
        code: 'PLS_NO_STRUCTURAL_MODEL',
        severity: 'error',
        layer: 'structural',
        title: 'PLS path modeling needs at least one structural path',
        explanation:
          "The PLS algorithm builds each construct's inner proxy from the constructs it is connected to; without paths that step is undefined.",
        fixes: [
          'Draw the hypothesised paths between constructs.',
          'For a measurement-only model, use CB-SEM (CFA).',
        ],
        elementIds: [],
        learn: 'pls-algorithm',
      });
    } else if (method === 'cb-sem') {
      out.push({
        code: 'CB_MEASUREMENT_ONLY',
        severity: 'info',
        layer: 'structural',
        title: 'Measurement model only: this is a confirmatory factor analysis (CFA)',
        explanation: 'All factors are allowed to correlate; no structural hypotheses are tested.',
        fixes: [],
        elementIds: [],
        learn: 'cfa',
      });
    }
  } else {
    const roles = constructRoles(model);
    for (const c of model.constructs) {
      if (roles.get(c.id) !== 'isolated') continue;
      out.push({
        code: 'CONSTRUCT_ISOLATED',
        severity: isPls(method) ? 'error' : 'warning',
        layer: 'structural',
        title: `${c.name} is not connected to any other construct`,
        explanation: isPls(method)
          ? 'In PLS an unconnected construct has no inner proxy, so its weights cannot be estimated by the iterative algorithm.'
          : 'An unconnected factor only correlates with the others; it tests no hypothesis. Check that this is intended.',
        fixes: [`Connect ${c.name} with a structural path, or remove it.`],
        elementIds: [c.id],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- measurement

function measurementIssues(model: SemModel, method: SemMethod | undefined): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const c of model.constructs) {
    const n = c.indicatorIds.length;
    if (n === 0) {
      out.push({
        code: 'CONSTRUCT_NO_INDICATORS',
        severity: 'error',
        layer: 'measurement',
        title: `${c.name} has no indicators`,
        explanation: 'A construct without indicators has no data and cannot be estimated.',
        fixes: [`Add indicators to ${c.name} in the inspector.`],
        elementIds: [c.id],
      });
      continue;
    }
    if (n === 1) {
      out.push({
        code: 'SINGLE_INDICATOR',
        severity: method === 'cb-sem' ? 'warning' : 'info',
        layer: 'measurement',
        title: `${c.name} has a single indicator`,
        explanation:
          method === 'cb-sem'
            ? 'With one indicator the factor is identified only by fixing the residual variance (lavaan fixes it to 0, i.e. the item is assumed to be measured without error). That assumption should be stated.'
            : 'The construct score equals its standardized indicator. Reliability and convergent validity measures do not apply.',
        fixes: ['Add indicators if the instrument has them, or report the assumption explicitly.'],
        elementIds: [c.id],
        learn: 'single-item-constructs',
      });
    }
    if (c.measurement === 'composite-formative') {
      if (method === 'cb-sem') {
        out.push({
          code: 'CB_COMPOSITE_UNSUPPORTED',
          severity: 'error',
          layer: 'measurement',
          title: `${c.name} is composite/formative, which CB-SEM does not support here`,
          explanation:
            'Covariance-based SEM estimates common factors. Composites need a specialised specification (e.g. H–O models), which this version does not implement; it never converts a block silently.',
          fixes: [
            `Use PLS-SEM, or change ${c.name} to reflective if the theory says its indicators reflect a common cause.`,
          ],
          elementIds: [c.id],
          learn: 'reflective-vs-formative',
        });
      } else if (method === 'plsc') {
        out.push({
          code: 'PLSC_COMPOSITE_NOT_CORRECTED',
          severity: 'info',
          layer: 'measurement',
          title: `${c.name} is a composite: PLSc estimates it with Mode B and applies no consistency correction`,
          explanation: 'The correction applies to reflective (common-factor) blocks only.',
          fixes: [],
          elementIds: [c.id],
        });
      }
    }
    if (c.higherOrder) {
      out.push({
        code: 'HIGHER_ORDER_UNSUPPORTED',
        severity: 'error',
        layer: 'measurement',
        title: `${c.name} is declared as a higher-order construct`,
        explanation:
          'Higher-order constructs are planned but not yet verified in any engine (capability registry).',
        fixes: [
          'Remove the higher-order declaration, or estimate it in R with an exported script once supported.',
        ],
        elementIds: [c.id],
      });
    }
  }
  for (const i of model.indicators) {
    const blocks = blocksOf(model, i.id);
    if (blocks.length === 0) {
      out.push({
        code: 'INDICATOR_ORPHAN',
        severity: 'warning',
        layer: 'measurement',
        title: `${i.name} does not measure any construct`,
        explanation: 'It will be ignored by every estimator.',
        fixes: ['Connect it to a construct, or delete it.'],
        elementIds: [i.id],
      });
    } else if (blocks.length > 1) {
      out.push({
        code: 'CROSS_LOADING',
        severity: isPls(method) ? 'error' : 'warning',
        layer: 'measurement',
        title: `${i.name} measures several constructs (${blocks.map((b) => b.name).join(', ')})`,
        explanation: isPls(method)
          ? 'PLS assigns each indicator to exactly one block.'
          : 'A cross-loading is a deliberate CB specification; make sure it is theoretically justified and not an accident.',
        fixes: ['Keep the indicator in one construct only.'],
        elementIds: [i.id, ...blocks.map((b) => b.id)],
      });
    }
  }
  const covs = model.relationships.filter((r) => r.kind === 'covariance');
  if (covs.length > 0 && isPls(method)) {
    out.push({
      code: 'PLS_IGNORES_COVARIANCES',
      severity: 'info',
      layer: 'measurement',
      title: `${covs.length} covariance${covs.length > 1 ? 's are' : ' is'} ignored by ${methodLabel(method)}`,
      explanation:
        'PLS path modeling has no free covariance parameters; double-headed arrows only matter in CB-SEM.',
      fixes: [],
      elementIds: covs.map((r) => r.id),
    });
  }
  return out;
}

// ---------------------------------------------------------------- CB identification (necessary conditions)

/**
 * Free parameters of the CB model as lavaan's sem() defaults specify it (marker
 * identification, no mean structure): loadings (k − 1 per factor), residual variances (one per
 * indicator), (residual) factor variances, structural paths, covariances among exogenous
 * factors (auto.cov.lv.x), and explicit covariance relationships not already free.
 * Returns null if the model is not a pure reflective model (then the count is not defined here).
 */
export function cbDegreesOfFreedom(
  model: SemModel,
): { moments: number; parameters: number; df: number } | null {
  if (model.constructs.some((c) => c.measurement !== 'reflective' || c.indicatorIds.length === 0))
    return null;
  const indicators = new Set(model.constructs.flatMap((c) => c.indicatorIds));
  const p = indicators.size;
  const roles = constructRoles(model);
  const exo = model.constructs.filter((c) => roles.get(c.id) !== 'endogenous').map((c) => c.id);
  const loadings = model.constructs.reduce((s, c) => s + c.indicatorIds.length - 1, 0);
  const residuals = p;
  const factorVariances = model.constructs.length;
  const paths = model.relationships.filter((r) => r.kind === 'structural').length;
  const exoPairs = new Set<string>();
  for (let a = 0; a < exo.length; a++)
    for (let b = a + 1; b < exo.length; b++) exoPairs.add([exo[a], exo[b]].sort().join('|'));
  let extra = 0;
  for (const r of model.relationships) {
    if (r.kind !== 'covariance' || r.fixedValue !== undefined) continue;
    if (!exoPairs.has([r.sourceId, r.targetId].sort().join('|'))) extra++;
  }
  const parameters = loadings + residuals + factorVariances + paths + exoPairs.size + extra;
  const moments = (p * (p + 1)) / 2;
  return { moments, parameters, df: moments - parameters };
}

function identificationIssues(model: SemModel): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const dof = cbDegreesOfFreedom(model);
  if (dof && dof.df < 0) {
    out.push({
      code: 'CB_NOT_IDENTIFIED_T_RULE',
      severity: 'error',
      layer: 'measurement',
      title: `The model has more free parameters (${dof.parameters}) than observed moments (${dof.moments})`,
      explanation:
        'With negative degrees of freedom the model cannot be identified (t-rule). Note that df ≥ 0 is necessary but not sufficient for identification.',
      fixes: ['Add indicators, remove free covariances, or fix parameters on theoretical grounds.'],
      elementIds: [],
      learn: 'identification',
    });
  } else if (dof && dof.df === 0) {
    out.push({
      code: 'CB_JUST_IDENTIFIED',
      severity: 'info',
      layer: 'measurement',
      title: 'The model is just-identified (df = 0)',
      explanation:
        'It reproduces the data exactly, so global fit statistics carry no information about model fit.',
      fixes: [],
      elementIds: [],
    });
  }
  const g = structuralGraph(model);
  for (const c of model.constructs) {
    if (c.measurement !== 'reflective' || c.indicatorIds.length !== 2) continue;
    const connected =
      (g.in.get(c.id)?.length ?? 0) + (g.out.get(c.id)?.length ?? 0) > 0 ||
      model.constructs.length > 1;
    if (!connected) {
      out.push({
        code: 'CB_TWO_INDICATOR_FACTOR_ALONE',
        severity: 'error',
        layer: 'measurement',
        title: `${c.name} has two indicators and no other factor to borrow information from`,
        explanation:
          'A two-indicator factor is identified only through its covariances with other factors.',
        fixes: ['Add a third indicator, or include other factors in the model.'],
        elementIds: [c.id],
        learn: 'identification',
      });
    } else {
      out.push({
        code: 'CB_TWO_INDICATOR_FACTOR',
        severity: 'recommendation',
        layer: 'measurement',
        title: `${c.name} has only two indicators`,
        explanation:
          'It is identified through its covariances with other factors, which makes estimates unstable when those covariances are small (empirical under-identification).',
        fixes: ['Use three or more indicators per factor where the instrument allows.'],
        elementIds: [c.id],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- data

function dataIssues(
  model: SemModel,
  data: DataSummary,
  method: SemMethod | undefined,
  analysis?: AnalysisConfiguration,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const cols = new Map(data.columns.map((c) => [c.name, c]));
  const used = model.indicators.filter((i) => blocksOf(model, i.id).length > 0);

  const unmapped = used.filter((i) => i.column === null);
  if (unmapped.length) {
    out.push({
      code: 'INDICATOR_UNMAPPED',
      severity: 'error',
      layer: 'data',
      title: `${unmapped.length} indicator${unmapped.length > 1 ? 's are' : ' is'} not mapped to a data column`,
      explanation: 'An estimator needs a column for every indicator.',
      fixes: ['Map them in the Data Lab (suggestions are offered for matching names).'],
      elementIds: unmapped.map((i) => i.id),
    });
  }
  const missingCols = used.filter((i) => i.column !== null && !cols.has(i.column));
  if (missingCols.length) {
    out.push({
      code: 'DATA_COLUMN_MISSING',
      severity: 'error',
      layer: 'data',
      title: `Column${missingCols.length > 1 ? 's' : ''} not in the dataset: ${missingCols.map((i) => i.column).join(', ')}`,
      explanation: 'These indicators are bound to columns that the imported file does not contain.',
      fixes: ['Check the spelling of the column names, or re-map the indicators in the Data Lab.'],
      elementIds: missingCols.map((i) => i.id),
      columns: missingCols.map((i) => i.column!),
    });
  }
  const byColumn = new Map<string, string[]>();
  for (const i of used)
    if (i.column !== null) byColumn.set(i.column, [...(byColumn.get(i.column) ?? []), i.id]);
  for (const [column, ids] of byColumn) {
    if (ids.length > 1) {
      out.push({
        code: 'DATA_COLUMN_REUSED',
        severity: 'error',
        layer: 'data',
        title: `${ids.length} indicators read the same column ${column}`,
        explanation:
          'Identical indicators make the correlation matrix singular and their weights or loadings unidentified.',
        fixes: ['Bind each indicator to its own column.'],
        elementIds: ids,
        columns: [column],
      });
    }
  }
  for (const i of used) {
    const col = i.column !== null ? cols.get(i.column) : undefined;
    if (!col) continue;
    if (col.kind !== 'numeric') {
      out.push({
        code: 'DATA_NOT_NUMERIC',
        severity: 'error',
        layer: 'data',
        title: `${i.column} is not numeric${col.nonNumericCount ? ` (${col.nonNumericCount} non-numeric values)` : ''}`,
        explanation:
          'Indicators must be numeric. Some engines silently treat text as ordinal categories, which would change the analysis without telling you; SEM Studio refuses instead.',
        fixes: [
          'Inspect the column in the Data Lab and recode or declare its non-numeric codes as missing.',
        ],
        elementIds: [i.id],
        columns: [i.column!],
      });
      continue;
    }
    if (col.sdSample === 0 || (col.sdSample === null && col.n > 0)) {
      out.push({
        code: 'DATA_ZERO_VARIANCE',
        severity: 'error',
        layer: 'data',
        title: `${i.column} is constant`,
        explanation:
          'A column without variance carries no information and makes correlation-based estimation fail.',
        fixes: ['Remove the indicator or check the import.'],
        elementIds: [i.id],
        columns: [i.column!],
      });
    }
    if (
      i.scale &&
      col.min !== null &&
      col.max !== null &&
      (col.min < i.scale.min || col.max > i.scale.max)
    ) {
      out.push({
        code: 'DATA_OUTSIDE_SCALE',
        severity: 'error',
        layer: 'data',
        title: `${i.column} has values outside its declared scale ${i.scale.min}–${i.scale.max} (observed ${col.min}–${col.max})`,
        explanation:
          'Either the declared endpoints are wrong or the data contain codes (e.g. 99 = "don\'t know") that must be declared missing. IPMA and reverse scoring depend on correct endpoints.',
        fixes: [
          'Correct the scale endpoints, or declare the out-of-range code as missing in the Data Lab.',
        ],
        elementIds: [i.id],
        columns: [i.column!],
      });
    }
    if (i.reverseScored && !i.scale) {
      out.push({
        code: 'REVERSE_WITHOUT_SCALE',
        severity: 'error',
        layer: 'data',
        title: `${i.name} is marked reverse-scored but has no scale endpoints`,
        explanation:
          "Reverse scoring computes min + max − x and needs the instrument's permissible endpoints.",
        fixes: [`Enter the scale endpoints for ${i.name}.`],
        elementIds: [i.id],
      });
    }
    if (
      method === 'cb-sem' &&
      analysis?.estimator === 'ML' &&
      (Math.abs(col.skewness ?? 0) > 2 || Math.abs(col.kurtosis ?? 0) > 7)
    ) {
      out.push({
        code: 'DATA_NONNORMAL_ML',
        severity: 'recommendation',
        layer: 'data',
        title: `${i.column} is strongly non-normal (skewness ${fmt(col.skewness)}, excess kurtosis ${fmt(col.kurtosis)})`,
        explanation:
          'Normal-theory ML standard errors and χ² can be biased under strong non-normality. The |skewness| > 2 / |kurtosis| > 7 thresholds are common heuristics, not tests.',
        fixes: ['Consider robust ML (MLR), or check the item distribution.'],
        elementIds: [i.id],
        columns: [i.column!],
        learn: 'estimators',
      });
    }
  }

  if (analysis?.ipma) {
    const target = model.constructs.find((c) => c.id === analysis.ipma!.targetConstructId);
    const noScale = used.filter((i) => !i.scale);
    if (!target) {
      out.push({
        code: 'IPMA_TARGET_UNKNOWN',
        severity: 'error',
        layer: 'data',
        title: 'The IPMA target construct does not exist',
        explanation: 'IPMA needs a target.',
        fixes: ['Choose a target construct.'],
        elementIds: [],
      });
    }
    if (noScale.length) {
      out.push({
        code: 'IPMA_SCALE_MISSING',
        severity: 'error',
        layer: 'data',
        title: 'Set the permitted minimum and maximum for each indicator to calculate performance',
        explanation:
          'IPMA performance rescales each item to 0–100 using the ORIGINAL scale endpoints. Observed minima and maxima are not a substitute: they would make performance depend on the sample.',
        fixes: [
          'Enter scale endpoints in the Data Lab (they can be applied to many indicators at once).',
        ],
        elementIds: noScale.map((i) => i.id),
        learn: 'ipma',
      });
    }
  }

  const usedCols = [...byColumn.keys()].filter((c) => cols.has(c));
  const withMissing = usedCols.filter((c) => (cols.get(c)!.nMissing ?? 0) > 0);
  const n = data.completeRows ?? data.rowCount;
  if (withMissing.length > 0) {
    const dropped = data.rowCount - n;
    const fiml = analysis?.missingData === 'fiml';
    out.push({
      code: 'DATA_MISSING_VALUES',
      severity: fiml ? 'info' : dropped / Math.max(1, data.rowCount) > 0.1 ? 'warning' : 'info',
      layer: 'data',
      title: fiml
        ? `${withMissing.length} model column${withMissing.length > 1 ? 's have' : ' has'} missing values; FIML uses all available data`
        : `Listwise deletion removes ${dropped} of ${data.rowCount} rows (${pct(dropped, data.rowCount)})`,
      explanation: fiml
        ? 'FIML is unbiased when data are missing at random (MAR); it does not fix data missing not at random.'
        : 'Listwise deletion is unbiased only if data are missing completely at random (MCAR) and reduces power. Values are never imputed silently.',
      fixes: fiml
        ? []
        : method === 'cb-sem'
          ? ['Consider FIML (CB-SEM) if MAR is plausible.']
          : [
              'Report the deletion; consider whether the missingness could relate to the constructs.',
            ],
      elementIds: [],
      columns: withMissing,
      learn: 'missing-data',
    });
  }

  // Sample size: hard floors are mathematical; everything else is a labelled heuristic.
  if (n < 3) {
    out.push({
      code: 'DATA_INSUFFICIENT_ROWS',
      severity: 'error',
      layer: 'data',
      title: `Only ${n} usable rows`,
      explanation: 'Correlations and regressions are undefined with fewer than 3 observations.',
      fixes: ['Import more data.'],
      elementIds: [],
    });
  } else {
    const g = structuralGraph(model);
    const maxPredictors = Math.max(
      0,
      ...model.constructs.map((c) =>
        Math.max(
          g.in.get(c.id)?.length ?? 0,
          c.measurement === 'composite-formative' ? c.indicatorIds.length : 0,
        ),
      ),
    );
    if (isPls(method) && n <= maxPredictors + 1) {
      out.push({
        code: 'DATA_N_BELOW_PREDICTORS',
        severity: 'error',
        layer: 'data',
        title: `${n} rows cannot support a regression with ${maxPredictors} predictors`,
        explanation:
          'PLS estimates each endogenous construct (and each Mode B block) by OLS, which needs more observations than predictors.',
        fixes: ['Collect more data or simplify the model.'],
        elementIds: [],
      });
    }
    const dof = method === 'cb-sem' ? cbDegreesOfFreedom(model) : null;
    if (dof && n <= dof.parameters) {
      out.push({
        code: 'DATA_N_BELOW_PARAMETERS',
        severity: 'error',
        layer: 'data',
        title: `${n} rows for ${dof.parameters} free parameters`,
        explanation:
          'With no more observations than parameters the ML information matrix is singular.',
        fixes: ['Collect more data or simplify the model.'],
        elementIds: [],
      });
    }
    if (method) {
      out.push({
        code: 'SAMPLE_SIZE_JUSTIFICATION',
        severity: 'recommendation',
        layer: 'data',
        title: `Justify the sample size (n = ${n}) with a power analysis`,
        explanation:
          'Rules of thumb such as the "10-times rule" are not a defensible sample-size analysis. Base n on the smallest effect you need to detect, the significance level and the desired power.',
        fixes: [
          'Report a power or minimum-sample-size analysis for the smallest path of interest.',
        ],
        elementIds: [],
        learn: 'sample-size',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- estimator (capability registry)

function estimatorIssues(model: SemModel, a: AnalysisConfiguration): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const gate = (capability: string, what: string): void => {
    if (!isOffered(capability, a.engine)) {
      out.push({
        code: 'CAPABILITY_UNAVAILABLE',
        severity: 'error',
        layer: 'estimator',
        title: `${what} is not available with ${a.engine}`,
        explanation: unavailableReason(capability, a.engine) ?? 'Not verified for this engine.',
        fixes: ['Choose another engine or option.'],
        elementIds: [],
      });
    }
  };
  // One definition shared with the API (packages/method-registry/src/gating.ts).
  for (const id of requiredCapabilities(model, a)) gate(id, capability(id)?.title ?? id);
  if (a.bootstrap?.enabled) {
    if (a.bootstrap.repetitions > 10_000) {
      out.push({
        code: 'BOOTSTRAP_TOO_LARGE',
        severity: 'error',
        layer: 'estimator',
        title: `${a.bootstrap.repetitions} bootstrap samples exceed the service limit of 10,000`,
        explanation: 'Very large runs are limited to keep the shared service responsive.',
        fixes: ['Use 5,000 or 10,000 samples.'],
        elementIds: [],
      });
    } else if (a.bootstrap.repetitions < 1000) {
      out.push({
        code: 'BOOTSTRAP_SMALL',
        severity: 'recommendation',
        layer: 'estimator',
        title: `${a.bootstrap.repetitions} bootstrap samples are fine for learning, not for reporting`,
        explanation:
          'Percentile interval endpoints are estimated from the tails of the bootstrap distribution and are noisy with few samples.',
        fixes: ['Use 5,000 or more samples for reported results.'],
        elementIds: [],
      });
    }
    if (a.bootstrap.sides === 'one-sided') {
      out.push({
        code: 'BOOTSTRAP_ONE_SIDED',
        severity: 'info',
        layer: 'estimator',
        title: 'One-sided tests',
        explanation:
          'Use one-sided tests only when the direction was hypothesised before seeing the data, and report it.',
        fixes: [],
        elementIds: [],
      });
    }
  }
  if (a.ipma && a.method === 'plsc') {
    out.push({
      code: 'IPMA_ON_PLSC',
      severity: 'error',
      layer: 'estimator',
      title: 'IPMA is computed from classic PLS, not PLSc',
      explanation:
        'IPMA performance uses the construct scores of a composite model; on a PLSc fit importance shifted by 0.086 in Phase 0 tests.',
      fixes: ['Run IPMA with PLS-SEM.'],
      elementIds: [],
    });
  }
  return out;
}

// ---------------------------------------------------------------- helpers

function nameOf(model: SemModel, id: string): string {
  return (
    model.constructs.find((c) => c.id === id)?.name ??
    model.indicators.find((i) => i.id === id)?.name ??
    id
  );
}
const fmt = (v: number | null | undefined): string =>
  v === null || v === undefined ? '–' : v.toFixed(2);
const pct = (a: number, b: number): string => `${b === 0 ? 0 : Math.round((a / b) * 1000) / 10}%`;
