# How JASP implements PLS-SEM and CB-SEM — reference notes

Source read: <https://github.com/jasp-stats/jaspSem>, package `jaspSem` 0.97.1, commit
`e2d2e1dd47408493d62c073c36170f2efb6e9a3d` (2026-11-14). Files: `R/plssem.R`, `R/sem.R`,
`R/common.R`, `R/SEMWrapper.R`, `inst/qml/PLSSEM.qml`, `inst/qml/SEM.qml`.
Read on 2026-11-19. Everything below is what the source does at that commit, not what the
documentation says.

**Licence note.** `jaspSem`'s DESCRIPTION says GPL (≥ 2); its QML files carry AGPL-3 headers.
These notes describe behaviour only. No JASP code, text or UI was copied into SEM Lab.

## Why it matters

JASP uses the same engines SEM Lab has chosen: **cSEM** for PLS-SEM and **lavaan** for
CB-SEM. With equivalent settings, its numbers should match ours, so JASP can serve as an
independent manual cross-check during user testing. Its choices are also a useful contrast
when we set our own defaults.

## PLS-SEM (`R/plssem.R`, `PLSSEM.qml`)

| Aspect | JASP behaviour | Source |
|---|---|---|
| Model input | Text editor for cSEM/lavaan-style syntax. No visual editor. `~~` is rejected ("not supported"). | `checkCSemModel`, QML `TextArea` |
| Engine call | `cSEM::csem()` with `.approach_weights = "PLS-PM"`, `.approach_cor_robust = "none"` | `.plsSemOptionsTocSemOptions` |
| **PLSc vs PLS** | The "Consistent partial least squares" checkbox is **on by default**: `.disattenuate = TRUE`, `.PLS_approach_cf = "dist_squared_euclid"`. Unchecked gives `.disattenuate = FALSE` (classic PLS). | QML `checked: true`; R lines 339–345 |
| Inner weighting | path / centroid / factorial via `.PLS_weight_scheme_inner` | |
| Convergence | `.conv_criterion` from absolute / squared / relative difference | |
| **Tolerance** | The UI has a Tolerance field (default 1e-5), but **it is not passed to `csem()`**: the options mapper never sets `.tolerance`, so cSEM's own default applies whatever the user types. | grep: `tolerance` only appears in the wrapper signature |
| Convergence failure | Checks `fit$Information$Weight_info$Convergence_status` and stops with an error | lines 267–272 |
| Bootstrap | `cSEM::resamplecSEMResults(.R, .resample_method = "bootstrap", .handle_inadmissibles, .sign_change_option = "none", .seed)`. Default 200 samples. Seed is optional. | lines 289–295, QML |
| Inadmissible draws | Default **"replace"** (redraw); also "ignore" or "drop" | QML |
| Progress | A `.user_funs` callback that ticks a progress bar once per resample | lines 280–284 |
| CIs | `cSEM::infer(.alpha = 1 − level)`, then `CI_percentile` is displayed | lines 739, 1073 |
| Reliability | Cronbach's α, Jöreskog's ρ (ρ_C), Dijkstra–Henseler ρ_A; help text says "values above 0.70 indicate acceptable reliability" | `.plsSemReliabilities` |
| Model fit | `cSEM::testOMF` bootstrap test (dG, dL, dML) with critical values. Additional measures include CFI, GFI, RMSEA and SRMR on the implied indicator correlations, plus GoF. Fit is refused if `verify()` flags inadmissibility. | `.plsSemFitTab`, line 1266 |
| f², VIF | `calculatef2`, `assess(.quality_criterion = "vif")`, `calculateVIFModeB` (notes that a single-weight block returns NA) | lines 898, 2075–2100 |
| Prediction | `cSEM::predict(.cv_folds, .r, .benchmark ∈ lm/GSCA/PCA/MAXVAR)`, default 10 folds × 10 repetitions | lines 1172–1189 |
| Groups | `.id = grouping variable` for multigroup estimation | |
| Not present | HTMT for PLS, IPMA (`doIPMA`), MICOM, permutation MGA, CVPAT | grep of `R/` |

## CB-SEM (`R/sem.R`, `R/common.R`, `SEM.qml`)

| Aspect | JASP behaviour |
|---|---|
| Engine | `lavaan::lavaan()` with a full `lavOptions()` list built from the UI. A `mimic` option is exposed ("emulation", default lavaan). |
| Identification | Factor loading (marker, `auto.fix.first`; default), factor variance (`std.lv`), effects coding, or none |
| Estimator | `default` or an explicit lavaan estimator. The table footnote names the estimator lavaan actually used. |
| Missing data | Default `naAction = "fiml"`, applied **only if the data contain NAs**. Two-stage, robust two-stage and doubly robust are also offered. |
| SEs | default / robust.sem / robust.huber.white / bootstrap |
| Bootstrap | `lavaan::bootstrapLavaan(type = "nonparametric", iseed = seed)`, default 1000 samples. CI type defaults to **`bca.simple`** ("percentile bias-corrected"); also `perc` and `norm`. |
| Test statistic | standard, Satorra–Bentler, Yuan–Bentler (and Mplus variant), mean-and-variance adjusted, scaled-shifted, Bollen–Stine bootstrap, Browne residual (ADF/NT) |
| Output | Fit indices (AIC/BIC footnoted as ML-only), R², AVE, reliability (α and ω), **HTMT**, Mardia's coefficients, modification indices with a threshold, group equality constraints |

## Decisions for SEM Lab

1. **No hidden method default.** JASP defaults to PLSc and SmartPLS defaults to classic PLS,
   so the same "PLS-SEM" click gives different estimands in different tools. SEM Lab's
   method cards make the choice explicit (`pls-sem` vs `plsc`), and the run provenance line
   always names it.
2. **Every UI option must reach the engine.** JASP's tolerance field is a real example of an
   option that is shown but ignored. SEM Lab adds a round-trip test: each
   `AnalysisConfiguration` field must appear in the engine call recorded in
   `result.provenance.call`, and the R adapter must reject arguments it does not map.
3. **Inadmissible bootstrap draws.** JASP's default "replace" redraws until admissible, which
   conditions the bootstrap distribution on admissibility without reporting it. SEM Lab
   counts and excludes (drop) by default, reports requested / completed / failed /
   inadmissible counts as the engine protocol already requires, and offers "replace" only as
   an explicit, disclosed option.
4. **Seeds are mandatory** for SEM Lab bootstrap runs (JASP: optional).
5. **CB bootstrap CIs.** JASP defaults to `bca.simple`. SEM Lab's baseline is percentile,
   and BCa is offered only where the R spike verified it.
6. **Thresholds are context, not verdicts.** JASP's help text states 0.70 as "acceptable".
   SEM Lab's interpretation cards present cutoffs with their source and caveats (PLAN
   §2.7), not as pass/fail.
7. **What SEM Lab adds beyond JASP:** visual modeler, IPMA, HTMT for PLS, Word-ready
   tables, and R/Python code export. These are the parts of SEM Lab where we have no
   external GUI reference and must rely on our own reference tests.
8. **Cross-check opportunity.** For Phase 3/5 acceptance, run the TAM fixtures in JASP desktop
   with matched settings (classic PLS: PLSc unchecked; CB: marker, ML, listwise) and record
   the comparison in `docs/validation/`. This needs a manual run; JASP is not installed here.
