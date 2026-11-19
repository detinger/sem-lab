# Phase 0: R capability spike (cSEM, seminr, lavaan)

Status: complete for the scope in PLAN.md §5 Phase 0, "R PLS" and "R CB" pathways.
Date: 2026-11-19. Machine: macOS arm64, 8 cores, shared with other jobs while the
scripts ran, so wall-clock timings are inflated. CPU seconds are given next to them.

Rule applied throughout: a feature is **verified** only if it was executed here AND its
numbers were checked against something independent: `_ref_pls.R` (a base-R PLS
implementation), a second package, a hand computation, or an analytic identity.
**smoke-only** means it ran and the output structure is recorded, but the numbers were not
checked. **failed** and **absent** mean what they say. Every claim below points to a JSON
evidence file in `docs/validation/phase-0/evidence/r/`. Those files are produced by the
scripts in `services/r-engine/spike/`.

## 1. Environment

| Item | Value |
|---|---|
| R | 4.6.2 (2026-10-29), Homebrew build, `aarch64-apple-darwin27.0.0`, `/opt/homebrew/bin/Rscript` |
| Library | `services/r-engine/r-lib` (121 packages), first on `.libPaths()`. `_common.R` asserts this. |
| Launcher | `services/r-engine/bin/rscript`: sets `R_LIBS` and sets `OMP_NUM_THREADS=1` unless already set |
| Build | `services/r-engine/scripts/install_packages.R`: **source** builds from `https://cloud.r-project.org`, 6 parallel jobs. Logs and JSON reports are in `services/r-engine/install-logs/`. |
| Lock file | **`services/r-engine/renv.lock`**, written by `renv::snapshot(type = "all", library = r-lib)` using renv 1.3.1. All 121 packages are present with exact versions, with no missing, extra or mismatched entries (`r_environment.json`). The fallback `r-packages.lock.json` was **not** needed. |

Core versions: **cSEM 0.7.1**, **seminr 2.6.0**, **lavaan 0.7-3**, jsonlite 2.0.0, digest 0.6.39,
testthat 3.3.2, renv 1.3.1, future 1.82.0, future.apply 1.21.0, matrixStats 1.5.0.

Licenses (from each DESCRIPTION, `r_environment.json`):

| Package | License |
|---|---|
| cSEM, seminr, cubature, TruncatedNormal, clipr | GPL-3 |
| lavaan, future.apply, psych, Rcpp, RcppArmadillo, expm, digest, igraph, pbivnorm, quadprog | GPL (>= 2) |
| numDeriv | GPL-2 |
| mnormt, MASS (R installation) | GPL-2 \| GPL-3 |
| Matrix (R installation) | GPL (>= 2) \| file LICENCE |
| future, progressr | Apache (>= 2) |
| parallelly | LGPL (>= 2.1) |
| matrixStats | Artistic-2.0 |
| stringi | file LICENSE (not inspected further) |
| jsonlite, renv, testthat, dplyr, ggplot2, rlang, DiagrammeR, V8 | MIT + file LICENSE |

Across the library: MIT 69, GPL variants 41, Apache 5, LGPL 2, Artistic 1, BSD-3 1, other 2.
cSEM, seminr and lavaan are GPL. This fits the process-boundary design in
`docs/architecture/overview.md`.

Not installed: `rootSolve`, which `cSEM::doNonlinearEffectsAnalysis()` needs, and `polycor`.

Not re-verified in this session: the launcher's comment says that with more than one
OpenMP thread an R process hangs at exit inside libomp once its stdout pipe is closed. The
earlier agent recorded this and I did not reproduce it. What I did measure: 100 cSEM
resamples took 9.5 s with `OMP_NUM_THREADS=1` and 10.2 s with 8, so extra threads give no
speed-up (`csem_resampling.json` → `threads`).

## 2. Scripts and evidence

| Script | Evidence | Runtime (wall) |
|---|---|---|
| `csem_01_pls_core.R` | `csem_pls_core.json`, `parity_csem_pls-modeA-{path,centroid,factorial}.json`, `parity_csem_plsc.json` | < 1 min |
| `csem_02_assess.R` | `csem_assess.json` | < 1 min |
| `csem_03_effects.R` | `csem_effects.json` | < 1 min |
| `csem_04_resampling.R` | `csem_resampling.json` | 8 min 54 s (BCa jackknife ≈ 2 min) |
| `csem_04b_resampling_followup.R` | `csem_resampling_followup.json` | ≈ 2 min |
| `csem_05_ipma.R` | `csem_ipma.json` | < 1 min |
| `csem_06_smoke.R` | `csem_smoke.json` | ≈ 1 min |
| `csem_07_input.R` | `csem_input.json` | < 1 min |
| `seminr_01.R` | `seminr.json`, `parity_seminr_pls-path.json` | ≈ 1.5 min |
| `lavaan_01.R` | `lavaan.json`, `parity_lavaan_sem-ml.json` | ≈ 2 min |
| `env_01_lock_licenses.R` | `r_environment.json`, `services/r-engine/renv.lock` | < 1 min |

Scripts 01–03 were re-run in this session. Apart from timestamps and timings, their evidence
is byte-identical to the earlier run. `csem_05` was re-run after the endpoint fix in §5 and
reproduces its earlier numbers wherever the fix does not apply.

Run any script from the repo root:
`services/r-engine/bin/rscript services/r-engine/spike/<name>.R`.

## 3. Capability table

Engine C = cSEM 0.7.1, S = seminr 2.6.0, L = lavaan 0.7-3. "Δ" is the maximum absolute
difference.

| id | engine | feature | status | evidence (check) |
|---|---|---|---|---|
| R-01 | C | Classic PLS Mode A (no consistency correction), inner schemes path / centroid / factorial | verified | `csem_pls_core.json` (vs `_ref_pls.R`, Δ ≤ 3e-16); `seminr.json` (path and factorial vs seminr, Δ paths ≤ 6e-15) |
| R-02 | C | PLSc (consistent PLS) | verified | `csem_pls_core.json` (vs `_ref_pls.R` consistent, Δ ≤ 9e-16); `seminr.json` (vs seminr reflective, Δ 8e-15) |
| R-03 | C | Mode B composites; mixed Mode A/B; mixed with PLSc only on the common factors | verified | `csem_pls_core.json` (vs `_ref_pls.R`, Δ ≤ 1e-15) |
| R-04 | C | Convergence flag, iteration count, tolerance, `verify()` | verified | `csem_pls_core.json` (`.iter_max = 2` gives `Convergence_status = FALSE` and `verify()` code 1 TRUE) |
| R-05 | C | Cronbach α, ρ_C, AVE, ρ_A (from the PLSc run) | verified | `csem_assess.json` (formulas, Δ ≤ 9e-16); `seminr.json` (Δ ≤ 1.3e-14) |
| R-06 | C | ρ_A on a classic `.disattenuate = FALSE` object | failed (returns 1) | `csem_assess.json` → `rhoA_for_classic_modeA` |
| R-07 | C | HTMT, HTMT2; HTMT bootstrap CI | verified; CI smoke-only | `csem_assess.json` (formula, Δ ≤ 2e-16); `seminr.json` (HTMT vs seminr, Δ 2e-16) |
| R-08 | C | Fornell–Larcker | verified | `csem_assess.json`; `seminr.json` |
| R-09 | C | R², adjusted R², f² (`assess`, `calculatef2`) | verified | `csem_assess.json` (formula); `csem_smoke.json` (`calculatef2` = `assess` F2, Δ 0) |
| R-10 | C | Structural VIF; Mode B indicator VIF | verified | `csem_assess.json` (formula, Δ ≤ 4e-13) |
| R-11 | C | SRMR, d_ULS, d_G, d_ML, χ², RMSEA, GoF | verified as formulas (see the d_G caveat in §4) | `csem_assess.json` |
| R-12 | C | Direct, indirect and total effects; VAF; per-draw total effects | verified | `csem_effects.json` (total = direct + indirect, Δ 0; (I−B)⁻¹ − I; sum of specific path products; draws recomputed from path draws, Δ 0) |
| R-13 | C | Specific indirect effects | absent (we compute products) | `csem_effects.json` |
| R-14 | C | Bootstrap via `csem(.resample_method=)` and `resamplecSEMResults()` | verified | `csem_resampling.json` (each draw equals csem() on independently reproduced indices, Δ 0; identical across both entry points) |
| R-15 | C | Seed reproducibility, prefix property, identical results across sequential / multisession / multicore | verified | `csem_resampling.json` |
| R-16 | C | `infer()`: mean, sd, bias, CI_standard_z/t, CI_percentile, CI_bc | verified | `csem_resampling.json` (sd, bias, z, percentile and bc recomputed, Δ ≤ 6e-17) |
| R-17 | C | `infer()` CI_basic | verified, non-textbook default | `csem_resampling_followup.json` (default = bias-corrected variant; `.bias_corrected = FALSE` = textbook, Δ 0) |
| R-18 | C | `infer()` CI_bca | smoke-only | `csem_resampling.json` (ran, 121 s wall for R = 60; numbers unchecked) |
| R-19 | C | `infer()` CI_t_interval (double bootstrap) | smoke-only | `csem_resampling.json` (needs `.resample_method2`) |
| R-20 | C | `.handle_inadmissibles` drop / ignore / replace | smoke-only, with defects | `csem_resampling.json`, `csem_resampling_followup.json` |
| R-21 | C | `.sign_change_option` | smoke-only; `"individual"` defective | `csem_resampling.json`, `csem_resampling_followup.json` |
| R-22 | C | `.dominant_indicators` | smoke-only (no observable effect) | `csem_resampling_followup.json` |
| R-23 | C | Jackknife resampling | smoke-only | `csem_resampling.json` |
| R-24 | C | `.user_funs` in resampling (R², HTMT, IPMA per draw) | smoke-only | `csem_resampling.json`, `csem_ipma.json` |
| R-25 | C | `doIPMA()` construct and indicator level | verified | `csem_ipma.json` (vs first principles on `_ref_pls.R` weights, Δ ≤ 9e-14) |
| R-26 | C | `predict()` (PLSpredict, lm benchmark) | smoke-only (reproducible with `.seed`) | `csem_smoke.json` |
| R-27 | C | `testCVPAT()` | smoke-only | `csem_smoke.json` |
| R-28 | C | Multi-group estimation (`.id=`) | verified | `csem_smoke.json` (group "odd" = separate fit on odd rows, Δ 0) |
| R-29 | C | `testMICOM()`, `testMGD()` (Klesel, Chin, Sarstedt, Henseler) | smoke-only; grouping FABRICATED (row parity) | `csem_smoke.json` |
| R-30 | C | `testOMF()` | smoke-only | `csem_smoke.json` |
| R-31 | C | `testHausman()` | failed ("Instruments required"; needs `.instruments` in csem) | `csem_smoke.json` |
| R-32 | C | `doRedundancyAnalysis()` | verified as implemented, but it is NOT textbook redundancy analysis (§4) | `csem_smoke.json` |
| R-33 | C | Second-order construct, `.approach_2ndorder` = "2stage" / "mixed" | smoke-only | `csem_smoke.json` |
| R-34 | C | Interaction term (`PEOU.PU`) | smoke-only (OLS on scores matches to only 2e-4) | `csem_smoke.json` |
| R-35 | C | `doNonlinearEffectsAnalysis()` (floodlight) | failed (package `rootSolve` absent) | `csem_smoke.json` |
| R-36 | C | `.approach_weights` "unit", "PCA" | verified | `csem_smoke.json` (hand computation, Δ ≤ 6e-15) |
| R-37 | C | `.approach_weights` SUMCORR, MAXVAR, SSQCORR, MINVAR, GENVAR, GSCA | smoke-only | `csem_smoke.json` |
| R-38 | C | `.approach_weights` "bartlett" / "regression" on composites | failed (by design: common factors only) | `csem_smoke.json` |
| R-39 | C | NA, non-numeric and zero-variance input | behaviour recorded (§4) | `csem_input.json` |
| R-40 | S | `estimate_pls` composite Mode A, `path_weighting` / `path_factorial` | verified | `seminr.json` (vs cSEM, Δ paths 6e-15, loadings 4e-14, R² 2e-15) |
| R-41 | S | Centroid inner scheme | absent | `seminr.json` |
| R-42 | S | PLSc (automatic for `reflective()`) | verified | `seminr.json` (vs cSEM PLSc, Δ 8e-15) |
| R-43 | S | `summary()`: α, ρ_A, ρ_C, AVE, HTMT, Fornell–Larcker, cross-loadings, VIF, total effects | verified | `seminr.json` (vs cSEM and formulas, Δ ≤ 1.3e-14) |
| R-44 | S | f² | verified, different convention (re-estimation) | `seminr.json` (vs cSEM re-estimation, Δ 6e-15; vs cSEM `assess`, Δ 1.1e-3) |
| R-45 | S | `bootstrap_model` (seed, cores) | verified | `seminr.json` (first draw = own `set.seed(seed+1)` refit, Δ 0; cores 1 vs 2 identical; percentile = quantile type 7, Δ 0) |
| R-46 | S | `predict_pls` | smoke-only | `seminr.json` |
| R-47 | S | `estimate_cbsem` / `estimate_cfa` | verified as a lavaan wrapper | `seminr.json` (= lavaan with `std.lv = TRUE`, Δ 0) |
| R-48 | S | Missing data | behaviour recorded (silent mean replacement) | `seminr.json` |
| R-49 | L | CFA and SEM with ML, MLR, MLM | verified (identities) | `lavaan.json` (χ² = N·F_ML Δ 2e-11; CFI, TLI, RMSEA, SRMR, AIC, BIC, logL from formulas Δ ≤ 7e-12; observed regression = OLS Δ 3e-15). The latent-model estimates themselves were not checked against a second ML implementation. |
| R-50 | L | fitMeasures names incl. scaled and robust variants, RMSEA CI | verified (names present; non-robust values via identities) | `lavaan.json` |
| R-51 | L | `standardizedSolution()`, `parameterEstimates(ci=TRUE)`, latent correlations, `residuals(type="cor")` | verified (identities) | `lavaan.json` (Wald CI Δ 0; cor.lv = std covariances Δ 1e-16; residual correlations Δ 4e-16) |
| R-52 | L | Defined parameter `:=` (indirect effect) | verified | `lavaan.json` (est = a·b Δ 0; delta-method SE by hand Δ 0) |
| R-53 | L | Marker vs `std.lv = TRUE` | verified | `lavaan.json` (χ² Δ 6e-8, std_all Δ 4e-6, i.e. optimizer tolerance) |
| R-54 | L | `se="bootstrap"` + `iseed`; `bootstrapLavaan(iseed=)`; CI types norm, basic, perc, bca.simple | verified (perc, SE); others smoke-only; "bca" failed when R < N | `lavaan.json` |
| R-55 | L | Ordinal: `ordered=`, WLSMV, DWLS | smoke-only (converges; 133 thresholds) | `lavaan.json` |
| R-56 | L | FIML (`missing="fiml"`) with ML / MLR | smoke-only (nobs 1190 vs listwise 1072) | `lavaan.json` |
| R-57 | L | FIML with MLM or WLSMV | failed (rejected by lavaan) | `lavaan.json` |
| R-58 | L | `modindices()` | smoke-only | `lavaan.json` |
| R-59 | L | Diagnostics: non-convergence, Heywood case, non-PD/collinear data, non-identification | verified (each triggered and captured) | `lavaan.json` → `pathological` |
| R-60 | env | Lock file and licenses | verified (lock vs every DESCRIPTION) | `r_environment.json`, `services/r-engine/renv.lock` |

## 4. API gotchas (exact argument names)

### cSEM: how each PLS variant is requested (settled by `csem_pls_core.json`)

- **Classic PLS Mode A without consistency correction:** write constructs with `=~` AND pass
  `.disattenuate = FALSE`. An equivalent form is `<~` with `.PLS_modes = "modeA"`.
  These two forms give identical results (Δ 0).
- **PLSc:** write constructs with `=~` and leave `.disattenuate = TRUE`, which is the default.
  There is no separate PLSc switch. **A plain `csem(data, "X =~ ...")` is PLSc, not classic
  PLS.** The correction-factor method is `.PLS_approach_cf`.
- **Mode B:** `<~` defaults to Mode B. `.disattenuate` has no effect on composites.
  However, `=~` combined with `.PLS_modes = "modeB"` and the default `.disattenuate = TRUE`
  gives different paths (Δ 0.052). Never combine those.
- Inner scheme: `.PLS_weight_scheme_inner = "path" | "centroid" | "factorial"`. `match.arg`
  accepts partial names ("fact"). An invalid value errors.
- cSEM reorders constructs (exogenous first) and indicators. Always index results by name.
  Weights are scaled so that w'Sw = 1, the indicator correlations are Pearson, and the stored
  data are standardised.
- Defaults: `.tolerance = 1e-5`, `.iter_max = 100`, `.conv_criterion = "diff_absolute"`.
  Convergence status is in `res$Information$Weight_info$Convergence_status`.
  `verify(res)` returns a named logical; `sum(verify(res)) == 0` means admissible.

### cSEM: assessment

- **ρ_A on a classic run is wrong.** `RhoC_weighted`, `Reliability$"Dijkstra-Henselers_rho_A"`
  and `Estimates$Reliabilities` are all 1. Take ρ_A from a PLSc run's
  `Estimates$Reliabilities`. The weights are identical in both runs. seminr reports the same
  ρ_A (Δ 1.3e-14).
- Cronbach's α (`RhoT`) is the **standardised** (correlation-based) α. It differs from the
  covariance-based α by up to 0.057 on tam-v1. seminr's α is also the standardised one.
- **d_G uses log base 10** (`calculateDG`: `log(Eigen$values, base = 10)`). The
  natural-log definition is larger by a factor of (ln 10)² ≈ 5.30. SRMR includes the
  diagonal.
- f² in cSEM drops the predictor from the regression on the same construct correlations.
  seminr re-estimates the whole model without the predictor. The two differ by up to 1.1e-3
  (classic) or 1.7e-3 (PLSc).
- HTMT is returned as a lower triangle, in cSEM's construct order, with zeros above the
  diagonal.
- `doRedundancyAnalysis(.object)` takes no criterion argument. For each Mode B block it
  re-estimates the model with that block in Mode A and returns the slope of the Mode A score
  on the Mode B score (reproduced, Δ 9e-15). This is **not** the Chin (1998) redundancy
  analysis against a global single item: for our single-item design the textbook value
  differs by 0.22.
- `testHausman()` needs `.instruments`. `doIPMA()` refuses second-order and nonlinear models.
  The second-order "2stage" approach overrides `.disattenuate = FALSE` with a warning.

### cSEM: resampling

- Arguments: `.resample_method = "bootstrap"|"jackknife"`, `.R`, `.seed`,
  `.handle_inadmissibles = "drop"|"ignore"|"replace"`,
  `.sign_change_option = "none"|"individual"|"individual_reestimate"|"construct_reestimate"`,
  `.eval_plan = "sequential"|"multicore"|"multisession"`, `.user_funs`,
  `.resample_method2`/`.R2`.
- Raw draws are in `res$Estimates$Estimates_resample$Estimates1$<Path_estimates|Loading_estimates|Weight_estimates|Indirect_effect|Total_effect>$Resampled`.
  Each is a matrix of draws × parameters, with column names like `"PU ~ PEOU"` and
  `"PU =~ USEF1"`. `$Original` holds the point estimate. Bookkeeping is in
  `res$Information$Information_resample`, which has Number_of_admissibles, Number_of_runs,
  Seed, Handle_inadmissibles and Sign_change_option.
- **`.seed = NULL` is not reproducible even after `set.seed()`.** cSEM calls `set.seed(NULL)`
  and records a random seed. Always pass `.seed`. A seeded run leaves the global RNG
  untouched.
- **An error in one replication aborts the entire call** for every `.handle_inadmissibles`
  value. Example: a zero-variance indicator in a resample gives "NAs are not allowed in
  subscripted assignments". `.handle_inadmissibles` only governs `verify()` failures. The
  engine must therefore guard against zero-variance columns or catch the error per chunk.
- With `"ignore"`, `Number_of_admissibles` counts **all** kept draws, including inadmissible
  ones. With `"drop"`, a run with fewer than 2 admissible draws errors.
- `"replace"` draws replacements with `.seed + 1, + 2, …`. I read this in the source but
  could not demonstrate it (no configuration found). In one test, "replace" crashed with the
  zero-variance error described above.
- **`.sign_change_option = "individual"` is broken.** Every replication that needs a flip
  fails in `reverseSign()` with the warning "Element k must be length 5, not 0" and silently
  disappears from the draw matrix: 55 rows remained while `Number_of_admissibles` reported
  100. The `*_reestimate` options run.
- `.dominant_indicators` must be a **named character vector**, for example
  `c(ATU = "ATT1")`. A named list errors with "invalid subscript type 'list'". In every setup
  I tried it changed nothing. cSEM already orients each construct so that its loadings are
  positive: on a reverse-coded block the loadings stay positive and the paths change sign.
- `infer()` takes `.quantity` from "all", "mean", "sd", "bias", "CI_standard_z",
  "CI_standard_t", "CI_percentile", "CI_basic", "CI_bc", "CI_bca", "CI_t_interval", plus
  `.alpha` and `.bias_corrected = TRUE`.
  - "all" does **not** include CI_bca, and CI_t_interval only when a second resample exists.
  - `.alpha = 0.05` gives the central 95 % interval with row names "95%L"/"95%U". A vector of
    alphas is allowed.
  - CI_bca re-runs an n-row jackknife on every call (≈ 2 min here for n = 1190).
  - CI_t_interval needs `.resample_method2`.
  - CI_standard_z and CI_basic are bias-corrected by default.
  - Calling `infer()` on an object without resamples silently runs a bootstrap (38 s).
- `summarize()` gives t = estimate / bootstrap sd and a two-sided **normal** p-value.
- For jackknife, `Number_of_runs` reports 499 although n = 120 rows were jackknifed.
- PLSc bootstrap on full tam-v1 kept only 90 of 100 draws (10 % inadmissible).

### cSEM: input handling (`csem_input.json`)

- csem() has no missing-data argument. **Any NA in a model indicator is an error** that
  names the rows ("Data set contains missing values in rows: …"). NAs in unused columns are
  ignored.
- **Character, factor and logical indicator columns are silently treated as ordinal.**
  `Type_of_indicator_correlation` becomes Pearson + polyserial, and paths change by up to
  0.011. A character column containing "n/a" is accepted as one more category. Numeric types
  must be validated before calling cSEM.
- A zero-variance indicator gives the opaque error "NAs are not allowed in subscripted
  assignments" (warning: "the standard deviation is zero"). An unknown indicator gives
  "Unknown indicator(s): `BI9`". An indicator assigned to two constructs errors in
  `parseModel()`. Extra unused columns are ignored.

### seminr

- Measurement: `composite(name, items, weights = mode_A | mode_B)`. The default weights are
  `correlation_weights`, which is Mode A.
- **`reflective()` constructs are estimated with PLSc automatically**: mmMatrix type "C".
  Classic PLS needs `composite(..., weights = mode_A)`. `PLSc()` on a composite model
  changes nothing.
- `inner_weights = path_weighting | path_factorial`. Pass the functions, not strings. There
  is no centroid scheme. `stopCriterion = 7` means a tolerance of 1e-7; with it, the paths
  differ from cSEM at tolerance 1e-12 by 2e-12.
- **`missing = mean_replacement` is the default.** NAs are silently replaced by column
  means, and a warning appears only above 5 % missing.
- `bootstrap_model(seminr_model, nboot, cores, seed)`: replication i runs
  `set.seed(seed + i)`. So **seed S+1 replays seed S shifted by one draw** (verified, Δ 0):
  consecutive chunk seeds must not be used with seminr. Results are identical for any
  `cores`.
  - Any warning or error in a replication drops it (`boots_dropped`). There is no "replace"
    option.
  - Draws are stored in `boot_paths` as an array [from, to, replication], with
    `boot_loadings`, `boot_weights`, `boot_HTMT` and `boot_total_paths` alongside.
  - The percentile interval is quantile type 7.
- `summary(pls)` returns `$reliability` (alpha, rhoA, rhoC, AVE),
  `$validity$htmt|fl_criteria|cross_loadings|vif_items`, `$vif_antecedents`, `$fSquare`,
  `$total_effects`, `$total_indirect_effects`, and `$it_criteria` (AIC/BIC).
  - For a PLSc model, the Fornell–Larcker table shows **score** correlations, not PLSc
    construct correlations (Δ 0.089).
- `predict_pls(model, technique = predict_DA, noFolds, reps)` has no seed argument. Call
  `set.seed()` first; it is then reproducible.
- `estimate_cbsem(..., estimator = "MLR")`: the default estimator is MLR and the generated
  lavaan model uses **`std.lv = TRUE`**. It is identical to lavaan with the same options
  (Δ 0) and differs from lavaan's default marker parameterisation in unstandardised values.

### lavaan 0.7-3

- **snake_case arguments:** `parameterEstimates(boot_ci_type =)`,
  `standardizedSolution(type = "std_all")`, `bootstrapLavaan(r =, fun =, iseed =)`. The 0.6
  spellings (`boot.ci.type`, `"std.all"`, `R`, `FUN`) still work.
- χ² = **N**·F_ML, not (N−1)·F_ML, and the sample covariance has divisor N. RMSEA uses N.
  SRMR is Bentler's version including the diagonal.
- MLR gives `chisq.scaled` (Yuan–Bentler) plus `*.scaled` and `*.robust` CFI/TLI/RMSEA, with
  CIs. MLM gives Satorra–Bentler. WLSMV gives "scaled.shifted". DWLS reports only the
  standard test.
- Bootstrap:
  - `iseed` gives identical draws for the same seed. Draws come from
    `lavInspect(fit, "boot")`, with attributes `error.idx`, `nonadmissible` and `seed`.
  - **The bootstrap SE uses divisor R, not R−1** (Δ 1e-17).
  - **"perc" is boot's `norm.inter` interpolation, not `quantile()`** (Δ 0; no quantile type
    matches).
  - "bca" requires R > N.
  - With R = npar, lavaan warns that the vcov is not positive definite.
- Ordinal: `ordered = <names>` or `TRUE`. ML with ordered data is rejected
  ("use WLSMV instead"). `missing = "fiml"` is rejected for MLM and for categorical data;
  `missing = "pairwise"` works with WLSMV.
- Problems surface as **warnings**, and a fitted object is still returned. Capture them with
  `withCallingHandlers` and check:
  - `lavInspect(fit, "converged")`
  - `lavInspect(fit, "post.check")`, which is FALSE for negative variances or non-PD matrices
  - negative variances in `parameterEstimates()`

  Observed behaviour:
  - Non-convergence (`control = list(iter.max = 3)`): converged FALSE, and `fitMeasures()`
    errors with "fit measures not available if model did not converge".
  - Exact duplicate column: "some observed variables are perfectly correlated", then no
    convergence.
  - Under-identified two-indicator factor: df = −1, "Could not compute standard errors",
    χ² NA.
  - Near-duplicate indicator (n = 40) or a fixed loading of 5: a negative residual variance
    (Heywood case), with post.check FALSE.

## 5. IPMA conventions (`csem_05_ipma.R`)

What `doIPMA(.object)` is:

- It takes no target, endpoint or level arguments. It returns
  `Construct$Importance` (a construct × construct matrix where `[target, predecessor]` holds
  the unstandardised total effect), `Construct$Performance`, `Indicator$Importance`
  (target × indicator) and `Indicator$Performance`.
- It requires PLS-PM weights, OLS paths, a linear model and no second-order constructs.
  It warns when a construct is `=~` or a weight is negative.
- **It never rescales.** Performance is the mean of the unstandardised construct score
  (`getConstructScores(.standardized = FALSE)`: weights rescaled to sum to one, applied to
  the indicators in their input units). Importance is the standardised total effect ×
  sd(target score) / sd(predecessor score).
- So the 0–100 mapping is entirely the caller's job. On raw data, performance comes out in
  scale units (4.70 to 6.51 on tam-v1).

First principles (no cSEM code; weights from `_ref_pls.R`, classic Mode A, path scheme):

1. Rescale each indicator to (x − lo)/(hi − lo)·100.
2. Unstandardised weight = standardised weight / sd(rescaled indicator), normalised to sum to
   1 within each block.
3. Construct score = weighted mean of the rescaled indicators, so it lies in 0–100.
4. Performance = mean score.
5. Importance = (I − B_u)⁻¹ − I, where B_u is the OLS fit on the unstandardised scores.
6. Indicator importance = normalised weight × the construct's importance.
7. SD denominators cancel.

Result: with data rescaled **before** `csem()` (composite `<~` + `.PLS_modes = "modeA"`),
doIPMA equals first principles:

| quantity | Δ |
|---|---|
| construct importance | 4.4e-15 |
| construct performance | 8.5e-14 |
| indicator importance | 2.3e-15 |
| indicator performance | 0 |

Two further identities hold:
- Rescaling doIPMA's raw-data performance by (p − 1)/6·100 gives the same result for
  constructs whose items are all 1–7 (Δ 3e-13).
- OLS on unstandardised scores equals the standardised effect × the SD ratio (Δ 8e-15).

**Data finding: the endpoints are not 1 and 7 for every item.** USE1–USE3 take values 1..6
and USE4 takes values 1..11. `Data.txt.settings` records the same min/max as
`scaleInformation`, which may have been detected from the data rather than declared. Under
the literal "1 and 7" rule, USE4 maps to 0–166.7 and USE1–3 can never reach 100.

The main analysis therefore uses per-indicator endpoints from the settings file. Under that
choice:

- Target BI: identical under both rules (Δ 0). Importance / performance: PU 0.626 / 91.9,
  PEOU 0.263 / 80.9, ATU 0.205 / 86.1.
- Target USE: depends on the rule. With settings endpoints, BI 0.235, PU 0.147, PEOU 0.062,
  ATU 0.048. With 1–7 for every item, 0.217, 0.136, 0.057, 0.045. BI performance is 83.3.

Other findings:
- Rescaling with the observed min/max instead of the endpoints moved performance by up to
  10.1 points (subsample with all items ≥ 3).
- With mixed endpoints, importance is only comparable after per-item rescaling before
  estimation. A raw-data run was off by 0.31.
- A `=~` classic object gives identical numbers plus a warning. A PLSc object changes
  importance by 0.086 and must not be used.
- Bootstrap CIs for IPMA via `.user_funs` ran (smoke-only).

## 6. Chunked bootstrap design check

| Question | Answer (evidence) |
|---|---|
| (i) Single-run reproducibility | Same `.seed` gives identical draws for all quantities. A different seed gives different draws. Draw i depends only on (seed, i), so the first k draws of an `.R = 2k` run equal an `.R = k` run. Results are identical for sequential, multisession and multicore plans. Each cSEM draw equals `csem()` refit on rows `sample(1:n, n, replace = TRUE)` from future stream i (Δ 0). Consecutive seeds S, S+1, S+2 give no duplicated or shifted draws in cSEM. They **do** in seminr. |
| (ii) Own quantile = `infer()` CI_percentile? | **Yes.** `quantile(draws, c(α/2, 1−α/2), type = 7)` equals `infer(.quantity = "CI_percentile")` on the same 500 draws (Δ 0; cSEM uses `matrixStats::colQuantiles`, type 7). Five chunks of 100 (seeds S + 1000k) vs one run of 500: interval bounds differ by at most 0.0089, which is within 2 Monte Carlo SEs (≈ 0.004–0.0047). |
| (iii) Time per 100 resamples, tam-v1 classic | 7.7–10.3 s wall and 1.9–2.1 s CPU, sequential, on the shared machine. 500 in one call: 35 s wall / 8.2 s CPU. Multicore, 8 cores: 200 draws in 5.2 s wall. PLSc: 7.4 s per 100. A hand-written `csem()` loop: 7.4 s per 100. |
| (iv) Sign indeterminacy | `.sign_change_option` applies only with PLS-PM and compares weight signs with the original estimate. "individual" silently loses draws (defect). The `*_reestimate` options work. `.dominant_indicators` (named chr vector) had no observable effect: cSEM already orients constructs to positive loadings. |

Design consequences:

- Store raw path draws per chunk with `.seed = S + k`. Compute percentile intervals with
  `quantile(type = 7)`. Recompute total and specific indirect effects from the path draws.
- Do not use `"replace"` with consecutive seeds, and do not use `"individual"`.
- Catch replication errors per chunk, because one error kills the whole chunk.

## 7. What could not be verified or failed

- CI_bca, CI_t_interval, jackknife, MICOM, MGD, OMF, CVPAT, `predict()`, `predict_pls`,
  GSCA/MAXVAR/etc. weights, second-order constructs, the interaction term, ordinal WLSMV and
  DWLS, FIML and modification indices ran but their **numbers are unchecked** (smoke-only).
  - The interaction-term paths differ from OLS on cSEM's own scores by 2e-4, which is
    unexplained.
  - Group tests used a fabricated row-parity grouping.
- lavaan latent-model parameter estimates were checked only by identities and by seminr,
  which wraps lavaan. There was no second independent ML implementation.
- `.handle_inadmissibles = "replace"` seed behaviour is known from the source only. No test
  configuration without aborting errors was found.
- `.dominant_indicators` could not be shown to have any effect.
- Failed or absent:
  - `testHausman` (needs instruments)
  - floodlight (`rootSolve` not installed)
  - ρ_A on classic cSEM objects
  - `doIPMA` on second-order or nonlinear models
  - bartlett/regression weights on composites
  - lavaan "bca" with R < N
  - FIML with MLM or WLSMV
  - seminr centroid scheme
- Not re-tested: the libomp exit-hang note in `bin/rscript`.
- Docker or Linux reproducibility of these numbers was not tested. The lock file records
  macOS Homebrew-R source builds.
