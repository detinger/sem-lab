/**
 * R script export for CB-SEM with lavaan (PLAN §2.9).
 *
 * The browser CB engine (packages/engine/src/cb) implements lavaan's sem() defaults; this
 * script requests exactly those settings so a user's local run reproduces the app's estimates,
 * standard errors and fit indices (up to lavaan's own convergence tolerance, ~1e-6 — the
 * engine converges more tightly). Settings: estimator ML or MLR; marker identification
 * (auto.fix.first) or std.lv = TRUE; missing = "listwise" or "ml" (FIML, which implies a mean
 * structure); exogenous latent covariances free; covariance relationships of the model as `~~`.
 *
 * Safety as in r-csem.ts: user text never becomes R code (identifiers are sanitized, column
 * names are escaped string literals, comments are stripped of control characters).
 */
import type { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import type { Transformation } from '@/domain/dataset/types';
import { structuralGraph } from '@/domain/graph';
import { identifiers, rComment, rString } from './r-csem';

export const LAVAAN_TESTED = { R: '4.6.2', lavaan: '0.7-3' } as const;

export interface LavaanExportInput {
  model: SemModel;
  analysis: AnalysisConfiguration;
  projectName: string;
  modelHash: string;
  dataFingerprint: string;
  nRows: number;
  nUsed: number;
  transformations: Transformation[];
  generatedAt: string;
  appVersion: string;
  dataFileName?: string;
}

export function exportLavaanScript(input: LavaanExportInput): string {
  const { model, analysis: a } = input;
  if (a.method !== 'cb-sem') throw new Error('The lavaan export covers CB-SEM only.');
  if (a.estimator !== 'ML' && a.estimator !== 'MLR')
    throw new Error(
      `Estimator ${a.estimator} is not exported (not supported by the browser engine).`,
    );
  if (model.constructs.some((c) => c.measurement !== 'reflective'))
    throw new Error('CB-SEM export needs reflective constructs only.');
  const ids = identifiers(model);
  const id = (x: string): string => ids.get(x)!;
  const fiml = a.missingData === 'fiml';
  const stdLv = a.cb?.identification === 'std-lv';
  const used = new Set(model.constructs.flatMap((c) => c.indicatorIds));
  const indicators = model.indicators.filter((i) => used.has(i.id) && i.column !== null);
  const file = input.dataFileName ?? 'analysis-data.csv';
  const L: string[] = [];
  const push = (...l: string[]): void => void L.push(...l);

  push(
    '# =============================================================================',
    '# SEM Lab — reproducible R script (lavaan, CB-SEM)',
    `# Project: ${rComment(input.projectName)}`,
    `# Estimator: ${a.estimator}${fiml ? ' with FIML (missing = "ml")' : ', listwise complete data'}; identification: ${stdLv ? 'factor variances fixed to 1 (std.lv)' : 'first loading fixed to 1 (marker)'}`,
    `# Generated ${rComment(input.generatedAt)} by SEM Lab ${rComment(input.appVersion)}`,
    `# Model hash:       ${input.modelHash}`,
    `# Data fingerprint: ${input.dataFingerprint}`,
    `# Tested with R ${LAVAAN_TESTED.R} and lavaan ${LAVAAN_TESTED.lavaan}.`,
    '#',
    "# Reproduces SEM Lab's CB-SEM estimates, standard errors and fit indices on the analysis",
    `# data file exported with it (${rComment(file)}). lavaan stops its optimiser at a slightly looser`,
    '# tolerance than SEM Lab, so the last digits (about 1e-6) may differ.',
    '# =============================================================================',
    '',
  );
  if (input.transformations.length) {
    push('# Data Lab transformations applied before export (already contained in the data file):');
    for (const t of input.transformations)
      push(
        `#   - ${rComment(t.kind === 'drop-rows' ? `${t.rows.length} rows removed (${t.reason})` : JSON.stringify(t))}`,
      );
    push('');
  }
  push(
    'if (!requireNamespace("lavaan", quietly = TRUE)) stop("Please install lavaan first: install.packages(\\"lavaan\\")")',
    'library(lavaan)',
    '',
    '# ---- Data ---------------------------------------------------------------------',
    `raw <- utils::read.csv(${rString(file)}, check.names = FALSE, na.strings = "")`,
    'columns <- c(',
  );
  indicators.forEach((i, k) =>
    push(`  ${id(i.id)} = ${rString(i.column!)}${k < indicators.length - 1 ? ',' : ''}`),
  );
  push(
    ')',
    'missing_cols <- setdiff(unname(columns), names(raw))',
    'if (length(missing_cols)) stop("The data file lacks columns: ", paste(missing_cols, collapse = ", "))',
    'data <- raw[, unname(columns), drop = FALSE]',
    'names(data) <- names(columns)',
    fiml
      ? `stopifnot(nrow(data) == ${input.nUsed}L)  # FIML uses every row with at least one observed value`
      : `stopifnot(nrow(data) == ${input.nUsed}L, !anyNA(data))  # listwise-complete (${input.nRows - input.nUsed} of ${input.nRows} rows removed)`,
    '',
    '# ---- Model ----------------------------------------------------------------------',
    'model <- "',
    '# Measurement model (reflective common factors)',
  );
  for (const c of model.constructs) push(`${id(c.id)} =~ ${c.indicatorIds.map(id).join(' + ')}`);
  const g = structuralGraph(model);
  const targets = model.constructs.filter((c) => (g.in.get(c.id)?.length ?? 0) > 0);
  if (targets.length) push('# Structural model');
  for (const t of targets)
    push(
      `${id(t.id)} ~ ${model.constructs
        .filter((c) => g.in.get(t.id)!.includes(c.id))
        .map((c) => id(c.id))
        .join(' + ')}`,
    );
  const covs = model.relationships.filter((r) => r.kind === 'covariance');
  if (covs.length) push('# Covariances');
  for (const r of covs)
    push(
      `${id(r.sourceId)} ~~ ${r.fixedValue !== undefined ? `${r.fixedValue}*` : ''}${id(r.targetId)}`,
    );
  push(
    '"',
    '',
    '# ---- Estimation (the same settings as the SEM Lab browser engine) ------------',
    'fit <- sem(model, data = data,',
    `           estimator = ${rString(a.estimator)},`,
    `           std.lv = ${stdLv ? 'TRUE' : 'FALSE'},`,
    `           missing = ${fiml ? '"ml"' : '"listwise"'}${fiml ? ',\n           meanstructure = TRUE' : ''})`,
    'stopifnot(lavInspect(fit, "converged"))',
    'if (!isTRUE(lavInspect(fit, "post.check"))) warning("lavaan post.check failed: e.g. a negative variance (Heywood case). Inspect before interpreting.")',
    'summary(fit, fit.measures = TRUE, standardized = TRUE)',
    'estimates <- parameterEstimates(fit)',
    'standardized <- standardizedSolution(fit)',
    `fit_measures <- fitMeasures(fit, c("chisq", "df", "pvalue", "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "srmr", "aic", "bic"${a.estimator === 'MLR' ? ', "chisq.scaled", "cfi.scaled", "tli.scaled", "rmsea.scaled"' : ''}))`,
    'print(fit_measures, digits = 4)',
    '',
    '# Modification indices are diagnostic suggestions, never an automatic model repair:',
    '# head(modindices(fit, sort. = TRUE), 10)',
    '',
    '# End of script',
  );
  return `${L.join('\n')}\n`;
}
