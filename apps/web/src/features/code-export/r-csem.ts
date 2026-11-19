/**
 * R script export for PLS-SEM / PLSc with cSEM (PLAN §2.9).
 *
 * The script is derived from the same canonical model and analysis configuration as the job
 * the app sends to the R engine, and reproduces the engine's numbers EXACTLY:
 *  - csem() gets the same options as services/r-engine/R/pls_estimate.R csem_options();
 *  - the bootstrap follows SEM Lab's definition (the browser engine implements the same):
 *    set.seed(seed, "Mersenne-Twister", "Inversion", "Rejection"), then for b = 1..B in order
 *    rows = sample.int(n, n, replace = TRUE) and a full re-estimation; failed = error or
 *    non-convergence, inadmissible = verify() flags; percentile CI = quantile(type = 7);
 *    SE = sd (B − 1); p from the t distribution with B_valid − 1 df.
 *  - it reads the exact analysis matrix the app analysed (exported with the script).
 *
 * Safety: user text never becomes R code. Names become sanitized identifiers; column names
 * appear only inside fully escaped string literals; comment text is stripped of control
 * characters so a label cannot end a comment line.
 */
import type { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import type { Transformation } from '@/domain/dataset/types';
import { directedPaths, structuralGraph } from '@/domain/graph';

export const TESTED_VERSIONS = { R: '4.6.2', cSEM: '0.7.1' } as const;

const R_RESERVED = new Set([
  'if',
  'else',
  'repeat',
  'while',
  'function',
  'for',
  'next',
  'break',
  'TRUE',
  'FALSE',
  'NULL',
  'Inf',
  'NaN',
  'NA',
  'NA_integer_',
  'NA_real_',
  'NA_character_',
  'NA_complex_',
  'in',
  'T',
  'F',
]);

/** R string literal with every non-printable or non-ASCII character escaped. */
export function rString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20 || cp === 0x7f || cp > 0x7e)
      out += cp > 0xffff ? `\\U{${cp.toString(16)}}` : `\\u{${cp.toString(16)}}`;
    else out += ch;
  }
  return `${out}"`;
}

/** Text safe to place after "# " on one line. */
export function rComment(s: string): string {
  // control characters plus the Unicode line/paragraph separators (U+2028, U+2029)
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
}

/** Deterministic, unique, syntactically safe identifiers for constructs and indicators. */
export function identifiers(model: SemModel): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  const make = (raw: string): string => {
    let base = raw
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!/^[A-Za-z]/.test(base)) base = `v_${base}`;
    if (base === 'v_') base = 'v';
    if (R_RESERVED.has(base)) base = `${base}_`;
    let id = base;
    for (let k = 2; used.has(id.toLowerCase()); k++) id = `${base}_${k}`;
    used.add(id.toLowerCase());
    return id;
  };
  for (const c of model.constructs) out.set(c.id, make(c.name));
  for (const i of model.indicators) out.set(i.id, make(i.name));
  return out;
}

export interface RExportInput {
  model: SemModel;
  analysis: AnalysisConfiguration;
  projectName: string;
  modelHash: string;
  dataFingerprint: string;
  /** columns of the analysis matrix, in order (AnalysisData.columns) */
  dataColumns: string[];
  /** nRows / nUsed of the analysis data, for the header */
  nRows: number;
  nUsed: number;
  transformations: Transformation[];
  generatedAt: string;
  appVersion: string;
  dataFileName?: string;
}

const num = (v: number): string => (Number.isInteger(v) ? `${v}` : `${v}`);

export function exportCsemScript(input: RExportInput): string {
  const { model, analysis: a } = input;
  if (a.method !== 'pls-sem' && a.method !== 'plsc')
    throw new Error('The cSEM export covers PLS-SEM and PLSc only.');
  const pls = a.pls ?? { innerWeighting: 'path', maxIterations: 300, tolerance: 1e-7 };
  const ids = identifiers(model);
  const id = (x: string): string => ids.get(x)!;
  const inBlocks = model.constructs.flatMap((c) => c.indicatorIds);
  const disattenuate = a.method === 'plsc';
  const L: string[] = [];
  const push = (...lines: string[]): number => L.push(...lines);

  push(
    '# =============================================================================',
    `# SEM Lab — reproducible R script (cSEM)`,
    `# Project: ${rComment(input.projectName)}`,
    `# Method:  ${a.method === 'plsc' ? 'PLSc (consistent PLS)' : 'PLS-SEM (classic PLS path modeling, no consistency correction)'}`,
    `# Generated ${rComment(input.generatedAt)} by SEM Lab ${rComment(input.appVersion)}`,
    `# Model hash:       ${input.modelHash}`,
    `# Data fingerprint: ${input.dataFingerprint}`,
    `# Tested with R ${TESTED_VERSIONS.R} and cSEM ${TESTED_VERSIONS.cSEM}. Other versions may differ numerically.`,
    '#',
    "# This script reproduces SEM Lab's estimates exactly when run on the analysis data",
    `# file exported with it (${rComment(input.dataFileName ?? 'analysis-data.csv')}): the same rows and columns the app analysed.`,
    '# =============================================================================',
    '',
  );
  const reversed = model.indicators.filter(
    (i) => inBlocks.includes(i.id) && i.reverseScored === true && i.scale && i.column !== null,
  );
  if (reversed.length) {
    push(
      '# Reverse-scored indicators (the exported file already holds min + max − x for these columns):',
    );
    for (const i of reversed)
      push(`#   - ${rComment(i.column!)} (scale ${i.scale!.min}–${i.scale!.max})`);
    push('');
  }
  if (input.transformations.length) {
    push(
      '# Data Lab transformations applied before export (the exported file already contains them):',
    );
    for (const t of input.transformations) push(`#   - ${rComment(describeTransformation(t))}`);
    push('');
  }
  push(
    'if (!requireNamespace("cSEM", quietly = TRUE)) stop("Please install cSEM first: install.packages(\\"cSEM\\")")',
    `if (utils::packageVersion("cSEM") != ${rString(TESTED_VERSIONS.cSEM)}) warning("This script was tested with cSEM ${TESTED_VERSIONS.cSEM}; you have ", utils::packageVersion("cSEM"))`,
    'library(cSEM)',
    '',
    '# ---- Data ---------------------------------------------------------------------',
    `data_file <- ${rString(input.dataFileName ?? 'analysis-data.csv')}`,
    'raw <- utils::read.csv(data_file, check.names = FALSE, na.strings = "")',
    '# model name = column in the data file',
    'columns <- c(',
  );
  const indicatorRows = model.indicators.filter(
    (i) => inBlocks.includes(i.id) && i.column !== null,
  );
  indicatorRows.forEach((i, k) =>
    push(`  ${id(i.id)} = ${rString(i.column!)}${k < indicatorRows.length - 1 ? ',' : ''}`),
  );
  push(
    ')',
    'missing_cols <- setdiff(unname(columns), names(raw))',
    'if (length(missing_cols)) stop("The data file lacks columns: ", paste(missing_cols, collapse = ", "))',
    'data <- raw[, unname(columns), drop = FALSE]',
    'names(data) <- names(columns)',
    `if (anyNA(data)) stop("cSEM needs complete data; SEM Lab exported the listwise-complete analysis matrix.")`,
    `stopifnot(nrow(data) == ${input.nUsed}L)  # rows analysed by SEM Lab (${input.nRows - input.nUsed} of ${input.nRows} removed by listwise deletion)`,
    '',
    '# ---- Model ----------------------------------------------------------------------',
    'model <- "',
    '# Measurement model',
  );
  for (const c of model.constructs) {
    const op = c.measurement === 'reflective' ? '=~' : '<~';
    push(`${id(c.id)} ${op} ${c.indicatorIds.map(id).join(' + ')}`);
  }
  const g = structuralGraph(model);
  const targets = model.constructs.filter((c) => (g.in.get(c.id)?.length ?? 0) > 0);
  if (targets.length) push('# Structural model');
  for (const t of targets) {
    const preds = model.constructs.filter((c) => g.in.get(t.id)!.includes(c.id));
    push(`${id(t.id)} ~ ${preds.map((p) => id(p.id)).join(' + ')}`);
  }
  push(
    '"',
    '',
    '# ---- Estimation (identical options to the SEM Lab R engine) ------------------',
    'options <- list(',
    '  .approach_weights = "PLS-PM",',
    '  .approach_paths = "OLS",',
    `  .disattenuate = ${disattenuate ? 'TRUE' : 'FALSE'},  # ${disattenuate ? 'PLSc' : 'FALSE = classic PLS; a plain "=~" call in cSEM would be PLSc'}`,
    `  .PLS_weight_scheme_inner = ${rString(pls.innerWeighting)},`,
    `  .iter_max = ${pls.maxIterations},`,
    `  .tolerance = ${num(pls.tolerance)},`,
    `  .conv_criterion = "diff_absolute"${disattenuate ? ',' : ''}`,
    ...(disattenuate ? ['  .PLS_approach_cf = "dist_squared_euclid"'] : []),
    ')',
    'fit <- do.call(csem, c(list(.data = data, .model = model), options))',
    'print(verify(fit))  # admissibility checks (all FALSE = admissible)',
    'summarize(fit)',
    'assess(fit)',
    '',
  );

  if (a.bootstrap?.enabled) {
    const b = a.bootstrap;
    push(
      "# ---- Bootstrap (SEM Lab's definition — the app draws exactly these rows) ------",
      '# One random stream: set.seed(), then for each draw b = 1..B, in order,',
      '# rows = sample.int(n, n, replace = TRUE) and a full re-estimation. A draw that errors or',
      '# does not converge is "failed"; one that verify() flags is "inadmissible"; both are',
      '# excluded and counted. SE = sd (divisor B - 1); p from the t distribution with B_valid - 1 df;',
      '# percentile intervals with quantile(type = 7).',
      `B <- ${b.repetitions}L`,
      `seed <- ${a.seed ?? 0}L`,
      `level <- ${num(b.confidenceLevel)}`,
      'theta <- function(f) {',
      '  s <- summarize(f)$Estimates',
      '  c(stats::setNames(s$Path_estimates$Estimate, s$Path_estimates$Name),',
      '    stats::setNames(s$Loading_estimates$Estimate, s$Loading_estimates$Name),',
      '    stats::setNames(s$Weight_estimates$Estimate, s$Weight_estimates$Name))',
      '}',
      'est <- theta(fit)',
      'draws <- matrix(NA_real_, 0L, length(est), dimnames = list(NULL, names(est)))',
      'failed <- 0L; inadmissible <- 0L; n <- nrow(data)',
      'set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")',
      'for (b in seq_len(B)) {',
      '  idx <- sample.int(n, n, replace = TRUE)',
      '  f <- tryCatch(suppressMessages(suppressWarnings(',
      '    do.call(csem, c(list(.data = data[idx, , drop = FALSE], .model = model), options)))), error = function(e) NULL)',
      '  if (is.null(f) || !isTRUE(all(f$Information$Weight_info$Convergence_status))) { failed <- failed + 1L; next }',
      '  if (any(verify(f))) { inadmissible <- inadmissible + 1L; next }',
      '  t <- theta(f)[names(est)]',
      '  if (!all(is.finite(t))) { failed <- failed + 1L; next }',
      '  draws <- rbind(draws, t)',
      '}',
      'cat(sprintf("Bootstrap: %d valid of %d requested (%d failed, %d inadmissible excluded)\\n", nrow(draws), B, failed, inadmissible))',
      'se <- apply(draws, 2, stats::sd)                         # divisor B - 1',
      't_stat <- est / se',
      `p_value <- ${b.sides === 'one-sided' ? 'stats::pt(-abs(t_stat), df = nrow(draws) - 1)  # one-sided, direction = sign of the estimate' : '2 * stats::pt(-abs(t_stat), df = nrow(draws) - 1)  # two-sided'}`,
      'alpha <- 1 - level',
      `ci <- t(apply(draws, 2, stats::quantile, probs = ${b.sides === 'one-sided' ? 'c(alpha, 1 - alpha)' : 'c(alpha / 2, 1 - alpha / 2)'}, type = 7, names = FALSE))`,
      'bootstrap_table <- data.frame(parameter = names(est), estimate = est, se = se, t = t_stat, p = p_value,',
      '                              ci_lower = ci[, 1], ci_upper = ci[, 2], row.names = NULL)',
      'print(bootstrap_table, digits = 3)',
      '',
    );
  }

  if (a.ipma)
    pushIpma(
      push,
      input,
      id,
      targets.map((t) => t.id),
    );

  const indirect = model.constructs.some((s) =>
    model.constructs.some((t) => directedPaths(model, s.id, t.id).some((p) => p.length > 2)),
  );
  if (indirect) {
    push(
      '# Specific indirect effects are products of the path coefficients along each route;',
      '# SEM Lab computes them inside every bootstrap draw (see its Results > Structural tab).',
      '',
    );
  }
  push('# End of script');
  return `${L.join('\n')}\n`;
}

/**
 * IPMA with the convention of the browser engine (packages/engine/src/pls/ipma.ts) and the R
 * oracle (services/r-engine/R/pls_ipma.R): declared endpoints → 0–100, classic PLS refit,
 * normalised unstandardised weights, OLS on construct scores, total effects (I − B)⁻¹ − I.
 */
function pushIpma(
  push: (...lines: string[]) => number,
  input: RExportInput,
  id: (x: string) => string,
  endogenous: string[],
): void {
  const { model, analysis: a } = input;
  if (a.method !== 'pls-sem')
    throw new Error('IPMA is defined on classic PLS-SEM only (not PLSc).');
  const target = a.ipma!.targetConstructId;
  const g = structuralGraph(model);
  const preds = model.constructs.filter(
    (c) => c.id !== target && directedPaths(model, c.id, target).length > 0,
  );
  const direct = new Set(g.in.get(target) ?? []);
  const inds = model.indicators.filter((i) =>
    model.constructs.some((c) => c.indicatorIds.includes(i.id)),
  );
  const noScale = inds.filter((i) => !i.scale);
  if (noScale.length)
    throw new Error(
      `IPMA needs the original scale endpoints of every indicator; missing for ${noScale.map((i) => i.name).join(', ')}.`,
    );
  const vec = (pick: (i: (typeof inds)[number]) => number): string =>
    `c(${inds.map((i) => `${id(i.id)} = ${pick(i)}`).join(', ')})`;
  push(
    '# ---- IPMA (importance-performance map) -----------------------------------------',
    '# SEM Lab convention: every indicator (already reverse scored where flagged) is rescaled',
    '# to 0-100 with its DECLARED scale endpoints (never the observed min/max); classic PLS is',
    '# re-estimated on the rescaled data with the same options; unstandardized weights =',
    '# standardized weight / sd(rescaled indicator), normalized to sum to 1 per block; construct',
    '# score = weighted sum; performance = mean score; importance = unstandardized total effect',
    '# on the target from OLS of each endogenous score on its predictors: (I - B)^-1 - I.',
    '# Negative importance keeps its sign. Point estimates only (no intervals).',
    `ipma_target <- ${rString(id(target))}`,
    `scale_min <- ${vec((i) => i.scale!.min)}`,
    `scale_max <- ${vec((i) => i.scale!.max)}`,
    'data_100 <- data',
    'for (v in names(data_100)) data_100[[v]] <- (data_100[[v]] - scale_min[[v]]) / (scale_max[[v]] - scale_min[[v]]) * 100',
    'fit_100 <- do.call(csem, c(list(.data = data_100, .model = model), options))',
    'if (!isTRUE(all(fit_100$Information$Weight_info$Convergence_status))) stop("The PLS fit on the 0-100 data did not converge.")',
    'blocks <- list(',
    ...model.constructs.map(
      (c, k) =>
        `  ${id(c.id)} = c(${c.indicatorIds.map((i) => rString(id(i))).join(', ')})${k < model.constructs.length - 1 ? ',' : ''}`,
    ),
    ')',
    'W <- fit_100$Estimates$Weight_estimates',
    'w_norm <- lapply(names(blocks), function(cn) {',
    '  ids <- blocks[[cn]]',
    '  w_u <- W[cn, ids] / apply(data_100[, ids, drop = FALSE], 2L, stats::sd)',
    '  w_u / sum(w_u)',
    '})',
    'names(w_norm) <- names(blocks)',
    'scores <- sapply(names(blocks), function(cn) as.matrix(data_100[, blocks[[cn]], drop = FALSE]) %*% w_norm[[cn]])',
    'colnames(scores) <- names(blocks)',
    'k <- length(blocks)',
    'B_u <- matrix(0, k, k, dimnames = list(names(blocks), names(blocks)))  # B_u[to, from]',
    'predictors <- list(',
  );
  const tgts = endogenous;
  tgts.forEach((t, k) =>
    push(
      `  ${id(t)} = c(${(g.in.get(t) ?? []).map((s) => rString(id(s))).join(', ')})${k < tgts.length - 1 ? ',' : ''}`,
    ),
  );
  push(
    ')',
    'for (t in names(predictors)) {',
    '  src <- predictors[[t]]',
    '  B_u[t, src] <- stats::lm.fit(cbind(1, scores[, src, drop = FALSE]), scores[, t])$coefficients[-1]',
    '}',
    'total_u <- solve(diag(k) - B_u) - diag(k)',
    `ipma_predecessors <- c(${preds.map((c) => rString(id(c.id))).join(', ')})`,
    `ipma_direct <- c(${preds.map((c) => (direct.has(c.id) ? 'TRUE' : 'FALSE')).join(', ')})`,
    'ipma_constructs <- data.frame(',
    '  construct = ipma_predecessors,',
    '  importance = unname(total_u[ipma_target, ipma_predecessors]),',
    '  performance = unname(colMeans(scores)[ipma_predecessors]),',
    '  predecessor = ifelse(ipma_direct, "direct", "indirect"))',
    'ipma_indicators <- do.call(rbind, lapply(ipma_predecessors, function(cn) data.frame(',
    '  indicator = blocks[[cn]], construct = cn,',
    '  importance = unname(w_norm[[cn]] * total_u[ipma_target, cn]),',
    '  performance = unname(colMeans(data_100[, blocks[[cn]], drop = FALSE])))))',
    'if (any(unlist(w_norm[ipma_predecessors]) < 0)) warning("Some normalized IPMA weights are negative; performance can fall outside 0-100.")',
    'print(ipma_constructs, digits = 3)',
    'print(ipma_indicators, digits = 3)',
    'plot(ipma_constructs$importance, ipma_constructs$performance, pch = 19,',
    '     xlab = "Importance (unstandardized total effect)", ylab = "Performance (0-100)",',
    '     main = paste("IPMA for", ipma_target), xlim = range(0, ipma_constructs$importance), ylim = c(0, 100))',
    'text(ipma_constructs$importance, ipma_constructs$performance, ipma_constructs$construct, pos = 3)',
    'abline(v = mean(ipma_constructs$importance), h = mean(ipma_constructs$performance), lty = 3)',
    '',
  );
}

export function describeTransformation(t: Transformation): string {
  switch (t.kind) {
    case 'missing-code':
      return `value ${t.code} declared missing in ${t.column === '*' ? 'all columns' : t.column}`;
    case 'reverse':
      return `${t.as} = ${t.scale.min} + ${t.scale.max} − ${t.column} (reverse-scored)`;
    case 'center':
      return `${t.as} = ${t.column} − mean`;
    case 'standardize':
      return `${t.as} = (${t.column} − mean) / sd`;
    case 'drop-column':
      return `column ${t.column} removed`;
    case 'drop-rows':
      return `${t.rows.length} rows removed (${t.reason})`;
  }
}
