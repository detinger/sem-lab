# Browser CB-SEM engine (`src/cb`)

Covariance-based SEM / CFA by normal-theory maximum likelihood, in TypeScript, reproducing
lavaan 0.7-3 `sem()` defaults. lavaan is the reference oracle; R/Python remain only as exported
scripts.

```ts
import { estimateCb } from './cb/index.ts';
const out = await estimateCb({ model, analysis, data: { columns, rows, nRows, nDropped } }, hooks?);
// out: { ok: true, result: NormalizedSemResult } | { ok: false, error: { code, message, details? } }
```

- `analysis.method` must be `cb-sem`; `estimator` `ML` or `MLR` (others ⇒ `CAPABILITY_UNSUPPORTED`);
  `missingData` `listwise` | `fiml`; `cb.identification` `marker` (default) | `std-lv`;
  `cb.meanStructure` (default false; FIML always adds it, with an info warning).
  Bootstrap ⇒ `CAPABILITY_UNSUPPORTED` (out of scope).
- `data.rows` are row-major values in `columns` order, `null` = missing. `nRows − nDropped` must
  equal `rows.length` (else `REQUEST_INVALID`, `reason: data-preparation-mismatch`).
  `sample.nRows = nRows`, `sample.nDropped = nRows − nUsed` (caller-dropped + listwise/empty rows).
- `hooks.onProgress({stage})` (`validating | estimating | summarizing`), `hooks.signal` (AbortSignal ⇒ `CANCELLED`).
- `provenance.engine = 'browser'`. `estimateCbSync` is the same without the promise.
- `cbParameterCount(model, identification?, meanStructure?)` returns `{moments, parameters, df}` as used.

## Model (lavaan `sem()` defaults)

LISREL all-y: Σ = Λ(I−B)⁻¹Ψ(I−B)⁻ᵀΛᵀ + Θ, μ = ν + Λ(I−B)⁻¹α.

| element                      | free / fixed                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| loadings                     | marker: first indicator of each factor = 1 (construct `indicatorIds` order); std-lv: all free |
| factor (residual) variances  | marker: free; std-lv: fixed 1 (also disturbances of endogenous factors)                       |
| indicator residual variances | free; fixed 0 for the only indicator of a factor (auto.fix.single)                            |
| factor covariances           | free among exogenous factors (not a path target; isolated factors count)                      |
| disturbance covariances      | free among _pure_ endogenous factors (target, never a source) — lavaan auto.cov.y             |
| covariance relationships     | factor↔factor or indicator↔indicator (residual); `fixedValue` fixes                           |
| structural paths             | free unless `fixedValue`                                                                      |
| `parameterLabel`             | the same label on several free parameters = one parameter (equality)                          |
| means (mean structure)       | indicator intercepts free, latent means fixed 0                                               |

Refused: composite-formative constructs, `higherOrder` (`CAPABILITY_UNSUPPORTED`), structural
cycles / self-loops / mixed covariance endpoints (`REQUEST_INVALID`), df < 0 (`MODEL_NOT_IDENTIFIED`, t-rule).

**Known difference to `apps/web` `cbDegreesOfFreedom`:** it does not count the auto.cov.y
disturbance covariances (e.g. A→B, A→C frees B~~C in lavaan), and it counts an exogenous factor
pair as free even when an explicit covariance fixes it. For every committed fixture the counts agree
(tested).

## Estimation

- Sample covariance with divisor N; objective f = Σ_k (n_k/N)[log|Σ_oo| + tr(Σ_oo⁻¹(S_k + d_k d_kᵀ))]
  over missingness patterns (complete data = one pattern); χ² = N(f − f_h1) = N·F_ML.
- Fisher scoring with analytic gradient and backtracking line search (Σ kept PD), Newton steps on the
  finite-difference Hessian near the optimum, ridge-regularised steps when the information is
  singular. Converged ⇔ max |∂f/∂θ| < 1e-7 (typically 1e-12…1e-14). Not converged ⇒ `ENGINE_NONCONVERGENCE`.
- FIML: casewise likelihood by patterns; rows with every indicator missing are excluded (lavaan).
  h1 moments by EM (tolerance 1e-13).

## Inference

| case              | vcov                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ML, complete data | (N·I_E)⁻¹, expected information at the model-implied Σ (lavaan default)                                                          |
| ML, FIML          | (N·I_O)⁻¹, observed information = Richardson finite differences (h = 1e-6) of the analytic gradient (lavaan `lav_model_hessian`) |
| MLR               | I_O⁻¹ B₀ I_O⁻¹ / N, B₀ = mean casewise score cross-product at the structured moments (Huber–White)                               |

z = est/se, two-sided normal p computed in the tail (lavaan's `2·(1−pnorm)` underflows to 0; ours does
not), 95% Wald CI. A singular information matrix (eigenvalue < 1e-10·max) ⇒ warning
`CB_INFORMATION_SINGULAR`, SEs `null` with `missing.se = 'failed'`.

Standardized (`scale: 'standardized'`) = lavaan `std.all` with `cov.std = TRUE`: loadings λ·sd(η)/sd(y),
paths β·sd(η_src)/sd(η_tgt), variances / model-implied total variance, off-diagonal (residual)
covariances / sqrt of the two residual variances, intercepts / sd. Standardized SEs are not
computed (`null`, `not-supported`).

## Parameter keys (`ParameterEstimate.key`, ids only; each emitted once per `scale`)

| key                                                   | kind              | lavaan                                                                                                                                                               |
| ----------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loading:<constructId>:<indicatorId>`                 | loading           | `F =~ x`                                                                                                                                                             |
| `path:<sourceId>-><targetId>`                         | path              | `target ~ source`                                                                                                                                                    |
| `covariance:<a>~~<b>`                                 | covariance        | factor, disturbance or residual covariance; explicit ones keep the relationship's source/target order and carry `relationshipId`; automatic ones use construct order |
| `variance:<constructId>`                              | variance          | exogenous factor variance                                                                                                                                            |
| `residual-variance:<constructId>`                     | residual-variance | disturbance variance of an endogenous factor                                                                                                                         |
| `residual-variance:<indicatorId>`                     | residual-variance | indicator residual variance                                                                                                                                          |
| `intercept:<indicatorId>` / `intercept:<constructId>` | intercept         | `x ~1` / latent mean (fixed 0)                                                                                                                                       |

`rawPath` = matrix position, e.g. `lambda[2,1]` (1-based), `std.all:lambda[2,1]`.
`sourceMethod` = `sem-studio:cb-sem:<ML|MLR>` (`…:std.all` for standardized).

## Fit indices (`fit[].name` + `variant`)

`standard`: `chisq`, `df`, `pvalue`, `baseline.chisq`, `baseline.df`, `baseline.pvalue`, `cfi`, `tli`,
`rmsea` (with 90% `ciLower`/`ciUpper`), `rmsea.pvalue` (close fit, H0 .05), `srmr` (Bentler, diagonal
included; with a mean structure the standardized mean residuals are included — lavaan `srmr`),
`logl`, `unrestricted.logl`, `aic`, `bic`, `bic2`, `npar`, `ntotal`.
MLR adds `scaled`: `chisq` (Yuan–Bentler, Mplus variant), `chisq.scaling.factor`, `pvalue`,
`baseline.chisq`, `baseline.chisq.scaling.factor`, `cfi`, `tli`, `rmsea` (df = tr(UΓ), with CI) and
`robust`: `cfi`, `tli`, `rmsea` (with CI) for complete data.

- Baseline: independence model in closed form (per-variable available-case ML mean/variance).
- RMSEA CI: noncentral χ² CDF (Poisson mixture) + Brent zeroin exactly as R `uniroot` with its
  default tolerance — lavaan's limits are reproduced to ~1e-14 (the tolerance itself causes up to
  ~3e-5 relative error against the exact root).
- CFI/TLI: lavaan's formulas incl. the `all.equal` zero test.

## Deliberate deviations / not supported

- df = 0 (just-identified): `pvalue`, `cfi`, `tli`, `rmsea`, `rmsea.pvalue`, `srmr` (and scaled/robust)
  are `null` with `not-applicable` plus info `CB_JUST_IDENTIFIED` (lavaan prints CFI = 1, RMSEA = 0).
- `chisq` is clamped at 0 (rounding can make N(f − f_h1) ≈ −1e-13).
- Robust CFI/TLI/RMSEA for FIML (lavaan `lav_fit_fiml_corrected`) and the "robust" indices lavaan
  reports for plain ML + FIML are not produced (`not-supported` for MLR + FIML).
- Bootstrap, MLM, WLSMV, ordinal data, multiple groups, nonrecursive models: not supported.

## Diagnostics (warnings; lavaan `post.check` ⇒ `estimation.admissible`)

`CB_NEGATIVE_VARIANCE` (Heywood: negative indicator or factor (residual) variance; values are reported,
never clamped), `CB_LATENT_COV_NOT_PD`, `CB_THETA_NOT_PD`, `CB_PSI_NOT_PD` (PSD tolerance
eps^¾·max(1, λ₁) as lavaan) ⇒ `admissible = false`. `CB_INFORMATION_SINGULAR`, `CB_JUST_IDENTIFIED`,
`CB_N_BELOW_PARAMETERS`, `CB_EM_NOT_CONVERGED`, `CB_MEANSTRUCTURE_ADDED`.
Singular sample (or EM) covariance ⇒ error `DATA_ZERO_VARIANCE` with `details.reason =
'singular-covariance'`, the dependent indicator ids and the normalised null vector
(e.g. s1 ≈ s7 − s2); lavaan stops with "sample covariance matrix is not positive-definite".

## Verification (`tests/cb`)

- `reference.test.ts`: all 17 lavaan runs in `fixtures/reference-results/cb` and their fit measures
  (`cb-math/fit-measures.json`, produced by `fixtures/scripts/make_cb_math_references.R`, because the
  committed files have `fit: []` — see that script), plus a tightly re-optimised lavaan fit of each
  (`cb-math/tight-refits.json`): lavaan's default stopping rule leaves parameter errors up to 1.8e-6.
- `exact-and-diagnostics.test.ts`: analytic oracles, Heywood closed form, singular data, error paths,
  parameter counts vs `apps/web`, timing.
- `distributions.test.ts`: χ², noncentral χ², normal, uniroot emulation vs R.
