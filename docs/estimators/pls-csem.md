# Method statement: PLS-SEM and PLSc with the `r-csem` engine

Status: Phase 3 engine, capabilities `beta` in `packages/method-registry/registry.json`.
Implementation: `services/r-engine/R/` (entry `bin/run-job`). Package versions: cSEM 0.7.1,
R 4.6.2, jsonlite 2.0.0 (pinned in `services/r-engine/renv.lock`). Every statement below
is either an exact description of what the code passes to cSEM, or is checked by a test in
`services/r-engine/tests/testthat/` or by the Phase 0 evidence in
`docs/validation/phase-0/` (cited).

## 1. What is estimated

| `analysis.method` | reflective block | composite-formative block |
|---|---|---|
| `pls-sem` (classic PLS) | composite, Mode A weights, no consistency correction | composite, Mode B weights |
| `plsc` (consistent PLS) | Mode A weights + consistency correction (common factor) | composite, Mode B weights, not corrected |

A non-default `plsWeightingMode` (Mode B on a reflective block, Mode A on a composite
block) is refused with `CAPABILITY_UNSUPPORTED`; the mode follows the measurement kind.

### Exact cSEM call

The model is written over aliases only: constructs `C1..Ck` in `model.constructs` order,
indicators `X1..Xp` block by block in `indicatorIds` order. Reflective blocks use `=~`,
composite-formative blocks `<~`; structural lines are `Ct ~ Cs1 + Cs2`. No user text
(names, labels, column names, ids) enters R code or cSEM syntax, and the data frame
handed to cSEM has columns `X1..Xp`. The text of every call (with aliases) is recorded in
`provenance.call`.

```r
cSEM::csem(.data = data, .model = model,
  .approach_weights = "PLS-PM", .approach_paths = "OLS",
  .disattenuate = FALSE,                 # TRUE for method "plsc"
  .PLS_weight_scheme_inner = "<analysis.pls.innerWeighting>",   # path | centroid | factorial
  .iter_max = <analysis.pls.maxIterations>L,
  .tolerance = <analysis.pls.tolerance>,
  .conv_criterion = "diff_absolute"
  # for "plsc" additionally: .PLS_approach_cf = "dist_squared_euclid"
)
```

All options except `.disattenuate` (classic PLS) and the three user options equal the
cSEM 0.7.1 defaults; they are passed explicitly so the recorded call is complete.
`.disattenuate = FALSE` is required for classic PLS because a plain `=~` call is PLSc
(r-spike.md §4).

### Data handed to cSEM

- Only the indicator columns of the model, numeric, read from `data.csv` as text and
  parsed with a strict decimal-number pattern (`Inf`, `NaN`, hexadecimal, decimal commas
  and any text are rejected with `DATA_NOT_NUMERIC`; cSEM would otherwise treat text
  columns as ordinal silently).
- No missing values: an empty cell in a mapped column is `REQUEST_INVALID`
  (`details.reason = "missing-values"`); the engine expects the listwise-complete data set,
  so `sample.nUsed = sample.nRows` and `nDropped = 0`.
- Reverse-scored indicators (`reverseScored: true`) are transformed as
  `x' = (scale.min + scale.max) − x` before estimation (warning
  `REVERSE_SCORED_APPLIED`); reverse scoring without scale endpoints is `REQUEST_INVALID`.
- cSEM standardizes the indicators and uses Pearson correlations. The indicator `level`
  (ordinal/binary) does not change this; no polychoric/polyserial correlations are used.
- Rejected before estimation: zero-variance columns (`DATA_ZERO_VARIANCE`), fewer than 3
  rows (`DATA_INSUFFICIENT_ROWS`), perfectly collinear Mode B blocks, constructs outside
  every structural path and models without structural paths (`MODEL_NOT_IDENTIFIED`),
  structural cycles (`REQUEST_INVALID`, recursive models only).

## 2. Convergence and admissibility

- Convergence: `fit$Information$Weight_info$Convergence_status`; iterations from
  `Number_iterations`. Non-convergence is the error `ENGINE_NONCONVERGENCE` (no result).
- Admissibility: `cSEM::verify(fit)` — (1) convergence, (2) all absolute standardized
  loadings ≤ 1, (3) construct correlation matrix positive semi-definite, (4) all
  reliabilities ≤ 1, (5) model-implied indicator correlation matrix positive
  semi-definite. A failed check gives a result with `estimation.admissible = false`, the
  failed checks in `estimation.messages`, and the warning `INADMISSIBLE_SOLUTION`. Numbers
  are not hidden.
- cSEM warnings are passed to `estimation.messages` with aliases replaced by model ids and
  numbers replaced by `#`.

## 3. Reported quantities

All estimates are on the standardized scale (`scale: "standardized"`). Keys use model ids.

### Parameters

| kind | key | value |
|---|---|---|
| `path` | `path:<src>-><tgt>` | `Estimates$Path_estimates[tgt, src]` (OLS on construct correlations) |
| `loading` | `loading:<c>:<i>` | `Estimates$Loading_estimates[c, i]`, every block. Mode A: correlation of indicator and composite (classic) or consistency-corrected loading (PLSc); Mode B: correlation of indicator and composite |
| `weight` | `weight:<c>:<i>` | `Estimates$Weight_estimates[c, i]`, every block; scaled so the composite has unit variance (w′Sw = 1) |
| `total-effect` | `total:<src>-><tgt>` | element of (I − B)⁻¹ − I, B the path matrix; one per pair joined by at least one directed path |
| `indirect-effect` | `indirect:<src>-><tgt>` | (I − B)⁻¹ − I − B; one per pair joined by at least one path of length ≥ 2 (pairs with only a direct path have no indirect effect entry) |
| `specific-indirect` | `specific-indirect:<src>-><v1>…-><tgt>` | product of the path coefficients along one directed chain of length ≥ 2; `viaIds` lists the mediators. Computed by SEM Lab (cSEM does not report them, r-spike.md R-13). At most 500 chains are enumerated (warning `SPECIFIC_INDIRECT_TRUNCATED` otherwise); totals are exact regardless |

Single-indicator blocks: loading and weight are 1 by construction; they are reported with
`status: "fixed"` and inference null (`not-applicable`).

Phase 0 checks: total = direct + indirect, (I − B)⁻¹ − I, and the sum of specific
products equal cSEM's effects exactly (`csem_effects.json`); the unit test
`test-units.R` checks total = direct + Σ specific per draw.

### Construct metrics (`constructMetrics`)

| metric | definition | applies to |
|---|---|---|
| `r2` | `Estimates$R2` | endogenous constructs; exogenous: null, `not-applicable` |
| `r2-adjusted` | 1 − (1 − R²)(n − 1)/(n − k − 1), n rows, k predictors (`Estimates$R2adj`, formula verified Δ ≤ 2e-16, `csem_assess.json`) | endogenous constructs |
| `cronbach-alpha` | standardized (correlation-based) α = k·r̄/(1 + (k − 1)r̄) (`assess()` RhoT; it differs from the covariance-based α) | reflective, ≥ 2 indicators |
| `rho-a` | Dijkstra–Henseler ρA from a **PLSc** fit of the same model (`Estimates$Reliabilities`). For `pls-sem` an auxiliary PLSc fit is run because a classic object returns 1; the weights of both fits are identical. Test: the classic run's ρA equals the PLSc parity value | reflective, ≥ 2 indicators |
| `rho-c` | (Σλ)² / ((Σλ)² + Σ(1 − λ²)) on the reported loadings (`assess()` RhoC) | reflective, ≥ 2 indicators |
| `ave` | mean of squared reported loadings (`assess()` AVE) | reflective, ≥ 2 indicators |

Composite-formative and single-indicator constructs get `null` with `not-applicable` for
α, ρA, ρC and AVE. For PLSc, ρC and AVE use the consistency-corrected loadings.

### Matrices (`matrices`)

| id | content |
|---|---|
| `htmt`, `htmt2` | HTMT (arithmetic means) and HTMT2 (geometric means) of absolute Pearson indicator correlations (`assess()`, `.absolute = TRUE`), symmetric, diagonal null. Only reflective constructs with ≥ 2 indicators are rows/columns; if fewer than two qualify the matrix is empty with `missing: "not-applicable"` |
| `fornell-larcker` | diagonal AVE, off-diagonal squared construct correlations (`assess()` fl_criterion), same construct set as HTMT |
| `cross-loadings` | Pearson correlation of every indicator (rows) with every construct score (columns, `Estimates$Construct_scores`). For PLSc the own-block entries are proxy correlations and differ from the corrected loadings |
| `construct-correlations` | `Estimates$Construct_VCV` (PLSc: corrected for reflective constructs) |
| `f2` | rows predictors, columns endogenous constructs; f² = (R²_incl − R²_excl)/(1 − R²_incl) with R²_excl from dropping the predictor in the regression on the same construct correlations (cSEM `assess()` F2; verified Δ ≤ 1e-16). This is **not** the re-estimation definition used by seminr (differs by up to 1.7e-3, r-spike.md §4). Null where there is no path |
| `vif-structural` | rows predictors, columns endogenous constructs; diagonal of the inverse predictor correlation matrix (`Estimates$VIF`); 1 for a single predictor |
| `vif-indicator-mode-b` | rows indicators of Mode B blocks, columns Mode B constructs; diagonal of the inverse within-block indicator correlation matrix (`assess()` VIF_modeB); null off-block and for single-indicator blocks; empty with `not-applicable` when there is no Mode B block |

### Fit (`fit`)

From `cSEM::assess()` on the estimated model's model-implied indicator correlation matrix
Σ̂ (`cSEM::fit()`), empirical correlation matrix S:

- `srmr`: √(mean of (s_ij − σ̂_ij)² over the lower triangle **including** the diagonal).
- `d_uls`: 0.5 · Σ_ij (s_ij − σ̂_ij)² over all elements.
- `d_g`: 0.5 · Σ (log₁₀ λ_i)², λ_i eigenvalues of S⁻¹Σ̂. cSEM uses **log base 10**; the
  natural-log definition is (ln 10)² ≈ 5.30 times larger.

The three formulas were verified in Phase 0 (`csem_assess.json`, Δ ≤ 6e-16). No CB-SEM
cutoffs are attached.

## 4. Bootstrap

Requested with `analysis.bootstrap.enabled = true`; `analysis.seed` is required.
Only percentile intervals (`ci: "percentile"`) are offered; `bca` is `planned` in the
registry and refused with `CAPABILITY_UNSUPPORTED`.

Procedure (`R/pls_bootstrap.R`):

1. B = `repetitions` draws are taken in chunks of `min(chunkSize, remaining)`;
   `chunkSize` = 100 unless the request sets `limits.chunkSize`.
2. Chunk k = 0, 1, 2, … calls
   `cSEM::resamplecSEMResults(.object = fit, .resample_method = "bootstrap", .R = r,
   .seed = (seed + k) mod (2³¹ − 1), .handle_inadmissibles = "drop",
   .sign_change_option = "none", .eval_plan = "sequential")`. The resampled model uses
   the same csem() options as the original fit. Test: the engine's first two chunks equal
   direct calls with `.seed = seed` and `seed + 1`.
3. If a chunk call errors (cSEM aborts the whole call when one replication errors, and
   errors under "drop" when fewer than 2 admissible draws remain), or the chunk has fewer
   than 3 draws (cSEM's minimum), that chunk is re-run one draw at a time: draw j = 1..r
   uses `set.seed((seed + k + j·10⁶) mod (2³¹ − 1))` (Mersenne-Twister / Inversion /
   Rejection), rows `sample.int(n, n, replace = TRUE)`, and `csem()` with the same options;
   an error counts as **failed**, a `verify()` failure as **inadmissible**. The global RNG
   state is restored afterwards.
4. Per chunk: inadmissible = requested in chunk − returned − failed; draws containing a
   non-finite value are counted as failed. requested = completed + failed + inadmissible
   always (asserted).
5. Progress (`done/total/failed/inadmissible`) is written after every chunk; the `cancel`
   file and `limits.timeoutSeconds` are checked before every chunk (`CANCELLED`, `TIMEOUT`).
6. Total, total indirect and specific indirect effects are recomputed from **each draw's**
   path coefficients, so their intervals come from the same draws.

Consequences: same seed, repetitions, chunkSize, model, data and package versions give
identical draws and intervals (tested); a different seed or chunkSize gives different draws.
`.sign_change_option = "individual"` (defective) and `.handle_inadmissibles = "replace"`
are not used.

Inference per parameter, from the B_valid = `completed` valid draws:

- `se` = sd(draws), divisor B_valid − 1.
- `statistic` = est / se, `statisticType: "t"`.
- `pValue`: two-sided 2·P(T ≤ −|t|), T ~ t with df = B_valid − 1. For
  `sides: "one-sided"`: P(T ≤ −|t|), in the direction of the sign of the point estimate.
  (cSEM's own `summarize()` uses the normal distribution; the t reference is SEM Lab's
  choice and is stated in each parameter's `rawPath`.)
- Interval: percentile, `quantile(draws, type = 7)` (equals cSEM `infer()` CI_percentile,
  r-spike.md §6). Two-sided: quantiles (1 − L)/2 and 1 − (1 − L)/2. One-sided: for
  est ≥ 0 the lower bound = quantile 1 − L and `ciUpper` null (`not-applicable`); for
  est < 0 the upper bound = quantile L and `ciLower` null.
- `inference = {method: "bootstrap-percentile", level, sides, nValid}`.
- Fewer than 2 valid draws: se/statistic/p/CI null with `failed` and warning
  `BOOTSTRAP_TOO_FEW_DRAWS`.

`bootstrap.draws` holds the draws of every path and every specific indirect effect (for
histograms), rounded to 6 significant digits to keep `result.json` small; intervals are
computed from the full-precision draws. Warnings `BOOTSTRAP_INADMISSIBLE_DROPPED` and
`BOOTSTRAP_FAILED_DRAWS` report the counts.

Measured speed (macOS arm64, sequential, `tam-mediation` n = 500, 3 constructs,
11 indicators): ≈ 0.75 s per 100 draws for both classic PLS and PLSc
(`test-bootstrap.R`, "timing").

## 5. Importance-performance map analysis (IPMA)

Requested with `analysis.ipma = { targetConstructId }`; implemented in `R/pls_ipma.R`.
The convention is the one settled in Phase 0 (r-spike.md §5), whose first-principles
computation matched `cSEM::doIPMA()` to ≤ 9e-14 when the data were rescaled before
estimation.

Preconditions (checked before estimation):

- method `pls-sem` only; `plsc` is refused with `CAPABILITY_UNSUPPORTED` (IPMA uses a
  classic fit; a PLSc fit shifted importance by 0.086 in Phase 0);
- registry gate `ipma.construct` (indicator-level output additionally needs
  `ipma.indicator`; otherwise only construct-level results with an info warning);
- the target is a model construct (`REQUEST_INVALID`, `details.reason =
  "ipma-target-unknown"`) with at least one predecessor (`"ipma-no-predecessors"`);
- every model indicator declares `scale: {min, max}`, its ORIGINAL permissible endpoints
  (`"ipma-scale-missing"`, with the indicator ids); every observed value lies in
  [min, max] (`"ipma-out-of-scale"`). Observed extrema are never used.

Computation:

1. Reverse scoring first (where flagged), then x100 = (x − min)/(max − min)·100 with the
   same declared endpoints.
2. Classic PLS (same aliases and the same csem() options as the main fit) on the rescaled
   data (`fit_ipma` in `provenance.call`). The main estimates come from the unrescaled fit
   and are unchanged by requesting IPMA (tested).
3. Unstandardized weight = standardized weight / sd(x100), normalized to sum to 1 within
   each block. Construct score = weighted sum of the rescaled indicators (0–100 when no
   weight is negative; warning `IPMA_NEGATIVE_WEIGHT` otherwise).
4. Construct performance = mean score; indicator performance = mean rescaled indicator.
5. Importance = unstandardized total effect on the target: OLS of every endogenous score
   on its predictors' scores (with intercept) gives B, total effects = (I − B)⁻¹ − I.
   Negative importance keeps its sign.
6. Indicator importance = normalized weight × the construct's importance (so indicator
   importances of a block sum to the construct importance).

Output `ipma` (contracts.md §6 `IpmaResult`): `targetConstructId`; `constructs` = every
predecessor of the target (any directed path), `predecessor: "direct"` when a direct
structural path exists, else `"indirect"`; `indicators` = the indicators of those
constructs; `convention` = the text of steps 1–6. The target's own performance is not part
of `IpmaResult`. IPMA values are point estimates: with a bootstrap the warning
`IPMA_NO_INTERVALS` is added.

Verification (`test-ipma.R`): on `ipma-range-restricted` (PEOU items observed only in 3–7,
BI items only in 1–6) every indicator performance equals (mean − 1)/6·100 (max |Δ| 7e-14);
the engine equals `cSEM::doIPMA()` on a classic fit of the rescaled data with the user's
names (max |Δ| 4e-16, construct and indicator importance and performance); on tam-v1
(settings-file endpoints) target BI gives PU 0.626/91.9, PEOU 0.263/80.9, ATU 0.205/86.1, as
in Phase 0.

## 6. Output encoding

- result.json is written to `result.json.tmp` and renamed. JSON uses jsonlite with
  `digits = NA` (jsonlite's maximum, 15 significant digits), `auto_unbox`, `na = "null"`.
- Every null number has a missing reason (`not-applicable`, `not-requested`, `failed`,
  `non-finite`); the writer refuses any NaN/Inf before encoding.
- Errors, messages and the technical log name ids, column names and counts only, never
  data values; cSEM messages are sanitized (numbers replaced by `#`).

## 7. Not reported, and why

| Quantity | Reason |
|---|---|
| BCa, studentized, basic, normal intervals | not verified (registry `planned`); BCa refused |
| ρA from a classic cSEM object | returns 1 (r-spike.md R-06); taken from PLSc instead |
| χ², RMSEA, CFI, GFI, GoF etc. from `assess()` | CB-SEM style indices; not part of the PLS fit statement |
| VAF | not requested for this slice |
| Unstandardized estimates | PLS works on standardized data; not reported |
| Bootstrap intervals for HTMT, R², f², reliabilities | not computed in this slice |
| Redundancy analysis | cSEM's `doRedundancyAnalysis()` is not the textbook procedure (r-spike.md §4) |
| IPMA bootstrap intervals; IPMA on PLSc | not implemented / not valid (§5) |
| PLSpredict, CVPAT, MICOM/MGA, higher-order, interaction, endogeneity | registry `planned`/`unsupported`; refused with `CAPABILITY_UNSUPPORTED` when requested |
| Indicator residual covariances, covariances involving endogenous constructs, fixed path values | not part of PLS-SEM in cSEM; refused. A covariance between two exogenous constructs is accepted (PLS leaves it free) with the info warning `EXOGENOUS_CORRELATION_IMPLIED` |
| Missing-data handling | engine expects listwise-complete data |

## 8. Verification (tests in `services/r-engine/tests/testthat/`)

- `test-reference.R`: on `tam-mediation-exact`, PLSc returns paths .60/.20/.50, indirect
  .30, total .50, loadings λ, R², AVE and ρC equal to the population values (max |Δ|
  ≈ 1e-15); classic PLS equals the classic-PLS population limit (paths, indirect, total,
  ≈ 4e-16) and ρA equals the population ρA. On `pls-mixed-composite-exact`, Mode B weights
  and composite loadings R·w equal the population values in classic PLS and PLSc
  (≈ 6e-16). On `pls-two-construct`, the engine equals a direct cSEM call with the user's
  names (≈ 4e-16); the reverse-scored binding reproduces every estimate.
- `test-parity-tam.R`: classic PLS (path, centroid, factorial) and PLSc equal the Phase 0
  parity evidence on tam-v1 (paths, loadings, weights, R², adjusted R², AVE, ρC, α, ρA) to
  ≤ 1e-10 (skipped when the git-ignored `TEMP/Example - TAM/Data.txt` is absent).
- `test-bootstrap.R`, `test-errors.R`, `test-hostile.R`, `test-units.R`: reproducibility,
  counts, interval definitions, failed/inadmissible counting, cancellation, error codes,
  hostile names. Every result.json is validated against
  `packages/contracts/schema/normalized-sem-result.json` (ajv) and the cross-field rules.
