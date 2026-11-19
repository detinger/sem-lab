/**
 * Neutral interpretation notes: "what this shows / what it does not show". Statements follow
 * docs/estimators/pls-csem.md; they describe quantities, never verdicts ("supported",
 * "rejected"), and never give cut-offs (STYLE §13, PLAN §2.7 interpretation cards).
 */
export interface TableNote {
  shows: string;
  notShown: string;
}

const NO_VERDICT =
  'It does not decide whether a hypothesis is supported or rejected, and it says nothing about causation.';

export const TABLE_NOTES: Record<string, TableNote> = {
  paths: {
    shows:
      'The standardized estimate of each structural path, with its bootstrap standard error, t, p and percentile confidence interval when a bootstrap was run.',
    notShown: `An interval that contains 0 means the data are compatible with no effect of that size; it is not evidence that the effect is absent. ${NO_VERDICT}`,
  },
  effects: {
    shows:
      'Total effects, total indirect effects and each specific indirect route, computed from the path coefficients within every bootstrap sample.',
    notShown: `A specific indirect effect is a product of paths along one route. ${NO_VERDICT}`,
  },
  r2: {
    shows:
      'The share of each endogenous construct’s variance accounted for by its predictors in this sample, and the adjusted value that accounts for the number of predictors.',
    notShown:
      'It is not a measure of out-of-sample prediction, and no value is “good” or “bad” without the research context.',
  },
  loadings: {
    shows:
      'For every indicator, its loading (correlation with its construct’s composite for Mode A and Mode B blocks) and its outer weight. Single-indicator blocks are fixed at 1.',
    notShown:
      'Loadings do not establish that an indicator measures the intended concept. For composite blocks the weights define the construct and loadings serve interpretation.',
  },
  reliability: {
    shows:
      'Standardized Cronbach’s α, ρA (from a consistent PLS fit of the same model), ρC and AVE for reflective constructs with at least two indicators.',
    notShown:
      'They assume reflective measurement and are not reported for composite or single-indicator constructs. They do not assess validity on their own.',
  },
  htmt: {
    shows:
      'The heterotrait–monotrait ratio of absolute indicator correlations (arithmetic means) between pairs of reflective constructs.',
    notShown:
      'No bootstrap interval is computed for it in this release, and the table applies no cut-off.',
  },
  htmt2: {
    shows: 'The HTMT variant that uses geometric means of the absolute indicator correlations.',
    notShown:
      'No bootstrap interval is computed for it in this release, and the table applies no cut-off.',
  },
  'fornell-larcker': {
    shows:
      'AVE on the diagonal and squared correlations between constructs off the diagonal, for reflective constructs with at least two indicators.',
    notShown: 'It is one view of discriminant validity and is not a test.',
  },
  'cross-loadings': {
    shows:
      'The correlation of every indicator with every construct score. For PLSc the own-block entries are proxy correlations and differ from the corrected loadings.',
    notShown: 'It does not test whether the measurement model is correct.',
  },
  'construct-correlations': {
    shows: 'The correlations between construct scores (PLSc: corrected for reflective constructs).',
    notShown: 'Correlations between constructs are not structural effects.',
  },
  f2: {
    shows:
      'The change in R² of an endogenous construct when a predictor is dropped from the regression, relative to 1 − R² of the full model (cSEM definition on the construct correlations).',
    notShown:
      'This is not the re-estimation definition some other programs use, so values can differ slightly from them. Blank cells mean no path.',
  },
  'vif-structural': {
    shows:
      'Collinearity among the predictors of each endogenous construct: the diagonal of the inverse predictor correlation matrix.',
    notShown: 'A single predictor always has 1.',
  },
  'vif-indicator-mode-b': {
    shows: 'Collinearity among the indicators within each composite (Mode B) block.',
    notShown: 'It applies to composite blocks only.',
  },
  fit: {
    shows:
      'SRMR, d_ULS and d_G: discrepancies between the empirical indicator correlation matrix and the one the estimated model implies.',
    notShown:
      'No universal cut-offs are attached, and these discrepancy measures are not tests of the model. They are not comparable with CB-SEM fit indices.',
  },
};
