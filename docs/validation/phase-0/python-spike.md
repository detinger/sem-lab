# Phase 0 — Python engine spike (plspm, semopy)

> **Moved in Phase 4.** The scripts and the pinned environment now live in `services/python-spike/` (run `cd services/python-spike && uv run python spike/<name>.py`). Paths below that say `apps/api` refer to that directory; evidence JSON files keep the original paths as recorded.

Status: complete for the scope in PLAN.md §5 Phase 0 (Python part). Date: 2026-11-19. Machine: macOS arm64,
8 cores. Every statement below was **executed here** unless it is explicitly labelled "from source".
"R parity" (cSEM / lavaan vs Python) is a separate task; one informational cross-look is noted in §7.

Status vocabulary: **verified** = executed and numbers checked against something independent (hand
formula, identity, `spike/ref_pls.py`); **smoke-only** = ran, numbers unchecked; **absent** = searched the
installed source, not there; **failed** = as it reads.

## 1. Environment and pins

Managed by `uv` in `apps/api` (`pyproject.toml` + `uv.lock`, Python `==3.12.*`). Resolved interpreter 3.12.15.

| Package | Pin | License (installed metadata) | Why this pin |
|---|---|---|---|
| numpy | 2.2.6 | BSD-3-Clause | numpy ≥ 2.4 removed `np.ma.corrcoef(bias=…)`, which semopy 2.3.11 calls in its ordinal route (`semopy/utils.py:125`, TypeError in the matrix); scipy 1.13.1 itself requires numpy < 2.3 |
| pandas | 2.3.3 | BSD-3-Clause | plspm 0.5.7 cannot estimate **any** model on pandas ≥ 3.0 (`ValueError: zip() argument 2 is longer than argument 1`, every plspm check fails) |
| scipy | 1.13.1 | BSD-3-Clause | scipy ≥ 1.14 removed `scipy.stats.mvn.mvnun`, needed by semopy's polychoric (ordinal) route; every scipy ≥ 1.14 combination fails `semopy.ordinal` |
| semopy | 2.3.11 | MIT | engine under test |
| plspm | 0.5.7 | GPL-3.0 (classifier) | engine under test |
| statsmodels | 0.14.6 (constraint) | BSD-3-Clause | imported directly by plspm (path scheme, inner OLS) |
| scikit-learn | 1.7.2 (constraint) | BSD-3-Clause | imported directly by plspm (PCA in `unidimensionality`) |
| sympy / numdifftools | 1.14.0 / 0.11.2 (lock) | BSD-3-Clause | semopy dependencies |

The pins were **not changed**: the compatibility matrix confirms each reason. Evidence:
`evidence/python/compat_matrix.json` (script `spike/compat_matrix.py`, probe `spike/compat_probe.py`, each
combination installed by `uv run --no-project --with …` into a throw-away environment).

**Other Python versions** (Colab has used 3.10–3.12): the exact pinned set
(numpy 2.2.6, pandas 2.3.3, scipy 1.13.1, statsmodels 0.14.6, scikit-learn 1.7.2, semopy 2.3.11, plspm 0.5.7)
installs from wheels and passes **all** probe checks on **3.10.22, 3.11.18 and 3.12.15**. Not checked: a real
Colab runtime, Linux (all runs are macOS arm64 wheels), Python 3.13 with scipy 1.13.1 (3.13 was only tried with
scipy 1.15.3, where the ordinal route fails as expected). Numbers agree across the passing combinations except
semopy's WLS objective value, which moves by 2.3e-3 between numpy 1.26 and 2.x (optimizer path), and
FIML / ModelMeans by ≤ 1.4e-6.

**plspm upstream status**: the package README (in the installed metadata, and on GitHub) says
*"Please note: This is not an officially supported Google product."* The GitHub repository
`GoogleCloudPlatform/plspm-python` is **archived (read-only) since 2026-07-30**, with no releases listed (checked
2026-11-19 via the web page). 0.5.7 is therefore a frozen, unmaintained dependency; its pandas-3 breakage
will not be fixed upstream.

## 2. Capability table

Evidence files are in `docs/validation/phase-0/evidence/python/`. Scripts in `apps/api/spike/`
(`plspm_probe.py`, `plspm_bootstrap.py`, `semopy_probe.py`; run `cd apps/api && uv run python spike/<name>.py`).

| id | engine | feature | status | evidence |
|---|---|---|---|---|
| P-01 | plspm | Mode A, PATH scheme, NUM route — paths, weights, loadings, R², scores | verified (ref_pls ≤ 1.8e-10; paths = OLS on own scores 2e-16) | plspm_probe.json `refPLS_maxAbsDiff.path`, parity_plspm_pls-modeA-path.json |
| P-02 | plspm | Mode A, CENTROID scheme, NUM route | verified (ref_pls ≤ 4.8e-10) | parity_plspm_pls-modeA-centroid.json |
| P-03 | plspm | Mode A, FACTORIAL scheme, NUM route | verified (ref_pls ≤ 4.5e-10) | parity_plspm_pls-modeA-factorial.json |
| P-04 | plspm | metric route `Config(scaled=True)` gives standard (per-indicator standardised) PLS | **failed** — divides all columns by ONE pooled SD; paths off by 0.026, loadings by 0.22 | plspm_probe.json `treatment`, `routes` |
| P-05 | plspm | metric route on data pre-standardised by caller (`scaled=False`) | verified (ref_pls ≤ 5e-9) | plspm_probe.json `routes.prestandardised_metric_scaled_false` |
| P-06 | plspm | R², adjusted R², communality, redundancy, AVE, GoF, crossloadings | verified (hand formulas ≤ 9e-16) | plspm_probe.json `self_consistency.*` |
| P-07 | plspm | Cronbach α (`unidimensionality`) | verified — it is the **standardised** α (diff 1e-15); raw α differs by 0.057 | idem |
| P-08 | plspm | Dillon–Goldstein ρ | verified as defined by plspm: from first-principal-component loadings (2e-16); differs from ρC on PLS loadings by 0.0038 | idem |
| P-09 | plspm | eigenvalues eig_1st / eig_2nd | verified (eig_1st vs correlation eigenvalue 2.5e-14) | idem |
| P-10 | plspm | effects direct / indirect / total; total = direct + indirect; total = (I−B)⁻¹ − I | verified (≤ 3e-17) | idem |
| P-11 | plspm | `inner_model()` std error / t / p | smoke-only — naive OLS statistics on scores, not PLS inference (t = est/se checked) | idem |
| P-12 | plspm | Mode B block (PEOU) mixed with Mode A; all-Mode-B model | verified (ref_pls ≤ 7.6e-10 NUM; ≤ 9.4e-7 metric pre-standardised) | plspm_probe.json `modeB` |
| P-13 | plspm | bootstrap summaries (mean, std.error ddof=1, perc.025/975 linear, t) for paths, R² | verified by independent replay of the same RNG stream (≤ 2e-16) under fork | plspm_bootstrap.json `independent_replication_fork` |
| P-14 | plspm | reproducible bootstrap with a seed | **failed** on spawn (macOS/Windows default: parent seed ignored); works only under fork with `processes=1` | plspm_bootstrap.json `seed_spawn`, `seed_fork` |
| P-15 | plspm | `processes > 1` under fork gives distinct resamples | **failed** — every child draws the SAME resamples (mean(2×10) = mean(1×10) to 1e-16) | plspm_bootstrap.json `fork_duplicate_resamples` |
| P-16 | plspm | failed bootstrap resamples counted | **failed** — silently dropped (`except: pass`); 10 of 20 dropped in a constructed case, no count exposed | plspm_bootstrap.json `silent_failures_*` |
| P-17 | plspm | missing values, metric route (mean imputation) | verified (= fit on hand mean-imputed data, diff 0) | plspm_probe.json `missing.metric_mean_imputation` |
| P-18 | plspm | missing values, NUM route (available-case, R-plspm style) | smoke-only | `missing.NUM_available_case` |
| P-19 | plspm | missing values with a Mode B block, NUM route | failed — `Exception: Missing nonmetric data is not supported in mode B` | `missing.NUM_modeB_with_missing` |
| P-20 | plspm | rows with a whole block missing are dropped | verified (1190 → 1187 for 3 such rows) | `missing.whole_block_missing_rows` |
| P-21 | plspm | non-numeric / inf / zero-variance / absent column handling | see §4 (string → clear ValueError; inf → statsmodels MissingDataError; constant column runs silently on metric route) | `bad_input` |
| P-22 | plspm | higher-order construct (`add_higher_order`, two-stage) | smoke-only | `higher_order` |
| P-23 | plspm | ordinal / nominal (`Scale.ORD`, `Scale.NOM`, optimal scaling) | smoke-only (compat probe `plspm.ord.path` runs) | compat_matrix.json |
| P-24 | plspm | PLSc, HTMT/HTMT2, Fornell–Larcker, f², VIF, ρA, SRMR, IPMA, PLSpredict/Q², MGA/MICOM/permutation, moderation helpers, seed argument | **absent** (0 source hits each) | plspm_probe.json `absence_search` |
| S-01 | semopy | CFA and full SEM, `obj="MLW"` | verified (F_ML by hand 8e-15; Σ by hand 2e-16) | semopy_probe.json `mlw_definition.*`, parity_semopy_{cfa,sem}-mlw.json |
| S-02 | semopy | `obj` ULS, GLS, WLS, DWLS on CFA and SEM | smoke-only (all converge) | `objective.*` |
| S-03 | semopy | `Model.fit(obj="FIML")` | **failed (silently wrong)** on raw data: no mean structure, assumes zero means — params differ from ML by 43; on centred complete data agrees with ML to 1.2e-3 | `fiml_identity.Model.*` |
| S-04 | semopy | `ModelMeans.fit(obj="ML")` (= FIML with means) | verified to optimizer tolerance on complete data (loadings vs ML 6.5e-4 and 1.2e-3 in two runs, intercepts = sample means ≤ 6e-6); 14–48 s across two runs | `fiml_identity.ModelMeans.ML.raw` |
| S-05 | semopy | `ModelMeans.fit(obj="FIML")` | failed — `NotImplementedError: Unknown method FIML` | `fiml_identity.ModelMeans.raw` |
| S-06 | semopy | missing data via ModelMeans ML (FIML) | smoke-only (runs, 31 s, loadings within 5e-3 of complete-data ML) | `missing.ModelMeans.ML` |
| S-07 | semopy | `Model.fit(obj="MLW")` with NaN | runs **silently** on a pairwise-available covariance (verified by hand 4e-14) with n_samples = all rows | `missing.Model.MLW*` |
| S-08 | semopy | `inspect()` estimates, SE (expected info), z, p | verified (SE vs hand Fisher information 1.6e-10 rel.; z, p by hand) | `inspect.expected.*` |
| S-09 | semopy | `inspect(information="observed")` | verified (vs hand finite-difference Hessian 1e-5 rel.) | `inspect.observed.*` |
| S-10 | semopy | `inspect(std_est=True)` → `Est. Std` | verified (≤ 1.1e-16) | `inspect.std.*` |
| S-11 | semopy | `inspect(se_robust=True)` ("MLR-esque sandwich") | smoke-only — SEs change by up to ×3 (median 47–54 %); not checked against an independent sandwich | `inspect.robust.*` |
| S-12 | semopy | parameter confidence intervals | absent | `inspect.expected.*.confidence_interval_columns`, `absence_search` |
| S-13 | semopy | `calc_stats`: chi2, DoF, baseline, CFI, TLI, NFI, RMSEA | verified (chi2 1e-11; CFI/TLI/NFI ≤ 5e-9, baseline chi2 8e-4 from numerical baseline fit) | `calc_stats.*` |
| S-14 | semopy | GFI / AGFI | **failed (mislabelled)** — GFI = 1 − χ²/χ²_base = NFI exactly; textbook GFI is 0.905 vs reported 0.912 (SEM) | idem |
| S-15 | semopy | LogLik / AIC / BIC | **failed (mislabelled)** — "LogLik" is the F_ML value; AIC = 2k − 2F_ML, BIC = ln(N)k − 2F_ML (not comparable with lavaan) | idem |
| S-16 | semopy | chi2 p-value | smoke-only — computed as `1 - cdf`, reports 0.0 where the true value is 1e-177 | idem |
| S-17 | semopy | SRMR; RMSEA confidence interval | absent (computed by the spike instead, labelled, in parity `extra`) | idem, `absence_search` |
| S-18 | semopy | ordinal (`DEFINE(ordinal)`, polychoric) with DWLS and MLW | smoke-only (6- and 22-item CFAs run; input is a correlation matrix; ≈1.2 s for 231 polychorics) | `ordinal.*` |
| S-19 | semopy | `predict_factors` | verified — equals regression (Thurstone) scores Ψ Λ' Σ⁻¹ (x − x̄) to 1.4e-14; not Bartlett | `predict_factors` |
| S-20 | semopy | nonparametric bootstrap | absent | `absence_search` |
| S-21 | semopy | `bias_correction` (parametric bootstrap, in place) seeded by `np.random.seed` | verified reproducible (same seed diff 0) | `bias_correction.seed` |
| S-22 | semopy | modification indices | absent | `absence_search` |
| S-23 | semopy | `semplot` | failed without the `graphviz` Python package (`ModuleNotFoundError: No graphviz module is installed.`); graphviz not installed by design | `semplot` |
| S-24 | semopy | non-convergence reported | verified: `success=False`, `message="Iteration limit reached"`, no exception (only a `logging.warning`) | `nonconvergence.maxiter3` |
| S-25 | semopy | Heywood case reported | **failed (silent)**: variances bounded at 0; a case needing θ = −0.62 returns θ = 3e-11, `success=True`, an ordinary SE, no flag | `heywood.just_identified_cov` |
| S-26 | semopy | solvers SLSQP (default), L-BFGS-B, trust-constr | smoke-only (agree to 1e-3) | `solver.*` |

## 3. Exact API (as installed)

**plspm 0.5.7**
```python
import plspm.config as c
from plspm.plspm import Plspm
from plspm.scheme import Scheme      # Scheme.PATH | Scheme.CENTROID | Scheme.FACTORIAL
from plspm.mode import Mode          # Mode.A | Mode.B
from plspm.scale import Scale        # Scale.NUM | Scale.RAW | Scale.ORD | Scale.NOM
s = c.Structure(); s.add_path(["PEOU"], ["PU"])            # one side must be a single-item list
cfg = c.Config(s.path(), scaled=True, default_scale=Scale.NUM)
cfg.add_lv("PU", Mode.A, c.MV("USEF1"), ...)              # also add_lv_with_columns_named, add_higher_order
p = Plspm(data, cfg, Scheme.PATH, iterations=300, tolerance=1e-12,
          bootstrap=False, bootstrap_iterations=100, processes=2)
```
Accessors (all DataFrames unless noted): `scores()` [LV columns]; `outer_model()` [weight, loading,
communality, redundancy]; `inner_model()` [from, to, estimate, std error, t, p>|t|]; `path_coefficients()`
(square, row = to, column = from); `crossloadings()`; `inner_summary()` [type, r_squared, r_squared_adj,
block_communality, mean_redundancy, ave]; `unidimensionality()` [mode, mvs, cronbach_alpha,
dillon_goldstein_rho, eig_1st, eig_2nd]; `effects()` [from, to, direct, indirect, total]; `goodness_of_fit()`
(float); `bootstrap()` → object with `weights()`, `loading()`, `paths()`, `total_effects()`, `r_squared()`,
each [original, mean, std.error, perc.025, perc.975, t stat.]. `bootstrap()` raises unless `bootstrap=True`.

Argument rules (source + executed): `iterations < 100` is silently raised to 100; `bootstrap_iterations < 10`
is silently set to 100; `bootstrap_iterations % processes != 0` → bare `AssertionError`. The iteration count
is not exposed; non-convergence raises `Exception("Could not converge after 101 iterations")`.
Estimation runs twice for models without higher-order constructs (`Estimator.estimate` treats `{}` as
"has HOCs"); harmless, but doubles cost. Outer-model rows come back in alphabetical order.

**semopy 2.3.11**
```python
import semopy
m = semopy.Model(desc, mimic_lavaan=False, baseline=False, cov_diag=False)   # lavaan-like =~, ~, ~~
res = m.fit(data, obj="MLW", solver="SLSQP", clean_slate=False, options={"maxiter": ...})
# Model objectives: MLW, ULS, GLS, WLS, DWLS, FIML ("ML"/"REML" -> KeyError)
mm = semopy.ModelMeans(desc); mm.fit(data, obj="ML")   # "ML" (FIML with means) or "REML"; "FIML" -> NotImplementedError
m.inspect(mode="list", information="expected"|"observed", std_est=False|True|"lv", se_robust=False)
semopy.calc_stats(m)    # one-row DataFrame, index "Value"
m.predict_factors(data, center=True)
semopy.bias_correction(m, n=100, ...)   # parametric bootstrap, modifies m.param_vals in place, returns None
```
`SolverResult` fields: fun, success, n_it, x, message, name_method, name_obj. `inspect()` columns: lval, op,
rval, Estimate, [Est. Std], Std. Err, z-value, p-value; **Std. Err / z / p are object dtype with "-" for fixed
parameters**. Loadings appear as `lval=indicator, op="~", rval=factor`; marker loading fixed to 1 by default.
`calc_stats` names: DoF, DoF Baseline, chi2, chi2 p-value, chi2 Baseline, CFI, GFI, AGFI, NFI, TLI, RMSEA,
AIC, BIC, LogLik. CFA DoF 199, SEM DoF 203 (22 indicators, 253 moments). Also present, not probed:
`ModelEffects`, `ModelGeneralizedEffects`, `multigroup`, `efa`, `estimate_means`, `report`,
`create_regularization`, `stats.calc_chi2_sb` (Satorra–Bentler, not in `calc_stats`).

## 4. Estimator definitions that matter for R comparison

**plspm**
- Data treatment depends on the route. `default_scale=Scale.NUM` centres each indicator and divides by its
  own SD so that population variance = 1 (this is the route that matches standard PLS and cSEM). The metric
  route with `scaled=True` divides **every** column by one pooled scalar (SD of all stacked values ×
  √((n−1)/n)); per-column variances stay unequal, so weights/loadings/paths differ from standard PLS. This
  deviates from R plspm's `scaled=TRUE`. `scaled=False` only centres. Export code must use `Scale.NUM` (or
  pre-standardise and pass `scaled=False`).
- Weights are normalised so that each composite has population variance 1 (ddof=0), i.e. w'Rw = 1. Mode A
  outer weights = cov(x, inner proxy); Mode B = least squares of the proxy on the block.
- Convergence: metric route — Σ over indicators of (|w_old| − |w_new|)²; NUM route — Σ over all n·k score
  cells of (|Y_old| − |Y_new|)²; compared with `tolerance`. Not the same criterion as cSEM. At 1e-12, 12
  iterations on tam-v1.
- Path scheme: regression weights for predecessors, correlations for successors (same as ref_pls / Lohmöller).
  Factorial uses `np.cov` (ddof=1) — a constant factor, no effect on the estimates.
- Sign: the metric route flips **scores** of a block whose loadings are mostly negative but not its
  **weights** (from source); the NUM route has no sign correction. Not triggered on tam-v1.
- Cronbach α is standardised α; DG ρ uses first-PC loadings (not comparable with cSEM ρC — the spike adds
  ρC from PLS loadings to `extra` instead).
- Missing data: metric → column-mean imputation after dropping rows with a whole block missing;
  NUM → available-case iteration (R plspm style); `unidimensionality` returns NaN for any block with a
  missing cell.

**semopy**
- MLW: F_ML = tr(SΣ⁻¹) + log|Σ| − log|S| − p with **S using divisor N** (ddof=0, verified); chi2 = N·F_ML
  (lavaan's default `likelihood="normal"` also uses N; to be confirmed by the R comparison).
- Expected-information SEs use N (hand Fisher information with N matches to 1.6e-10; using N−1 would differ
  by 4.2e-4 relative).
- RMSEA = √((χ²/df − 1)/(N − 1)), 0 when χ² < df; the variant with N differs in the 5th decimal (0.07041 vs
  0.07038 for the SEM).
- Baseline χ² comes from fitting an independence model numerically (8e-4 off the closed form).
- Variances carry a lower bound of 0 (`bound=(0, None)` in `model.py`), so negative variances never appear.
- `Model` has no mean structure; any objective on raw data uses the covariance only — except FIML, which
  then silently assumes zero means (S-03). Use `ModelMeans(obj="ML")` for FIML.

## 5. Bootstrap (plspm) — seeding and timing

- Requested with `Plspm(..., bootstrap=True, bootstrap_iterations=B, processes=P)`. Resampling runs in
  `multiprocessing.Process` children with `np.random.randint(n, size=n)` on NumPy's **global** RNG. There is
  no seed argument.
- **spawn** (macOS/Windows default): a parent `np.random.seed(s)` has no effect; two runs with the same seed
  differ (0.015 in path means, B=20).
- **fork** (Linux default on Python ≤ 3.13, so Colab): the parent seed propagates and runs reproduce exactly,
  **but every child process starts from the same RNG state, so `processes=P>1` repeats the same B/P resamples
  P times.** The effective B is B/P and SEs are understated.
- Failed resamples are dropped silently (bare `except: pass`); the number used is not reported.
- Statistics: per family (weights, loadings, paths (direct), total effects, R²): original, mean, std.error
  (ddof=1), perc.025, perc.975 (linear interpolation), t = original/std.error. No p-values, no BCa, fixed 95 %.
- Timing on tam-v1 (B=100, NUM route, tol 1e-10, 8-core M-series): spawn P=1 56.6 s; spawn P=4 33.5 s;
  fork P=1 45.5 s; fork P=4 13.3 s (with fork P=4 the resamples are duplicates, see above). About 0.45 s per
  resample single-process, so a 5000-resample run would take roughly 38 minutes.
- Consequence for SEM Lab: plspm's bootstrap is not usable as the app's resampling engine, and exported
  Colab code should not rely on it for reproducible numbers. A tested app-owned loop (own
  `np.random.default_rng(seed)`, refitting `Plspm` per chunk, counting failures) is straightforward; the replay
  in `plspm_bootstrap.py` is a working prototype of that loop.

## 6. What is absent

- plspm (searched every `plspm/*.py`): PLSc, HTMT/HTMT2, Fornell–Larcker, f², VIF, ρA, SRMR, IPMA,
  PLSpredict/Q²/blindfolding, MGA/MICOM/permutation, moderation / interaction helpers, seed argument. The
  README lists HTMT, VIF, f², Q², moderation and PLSc as "planned but not yet implemented", and the repository
  is archived. Present but smoke-only: higher-order constructs (two-stage), ordinal/nominal scaling.
- semopy: modification indices, SRMR, RMSEA CI, parameter CIs, nonparametric bootstrap, admissibility /
  Heywood flags, R² accessor, seed arguments (only global `np.random` via `model_generation`).

## 7. Self-consistency summary

- plspm (NUM route) vs `ref_pls.py` (independent NumPy PLS-PM): max |Δ| paths 1.9e-12 / 1.7e-12 / 3.8e-12,
  weights ≤ 1.4e-10, loadings ≤ 1.1e-10, R² ≤ 1.8e-12 for path / centroid / factorial.
- PATH-scheme paths = OLS on plspm's own scores (2.2e-16); R² from residuals (2.2e-16); total = direct +
  indirect (1.4e-17) and = (I−B)⁻¹ − I (2.8e-17).
- semopy CFA: Σ rebuilt by hand matches (0); F_ML by hand (5e-15). The model-implied vs sample residuals
  are **not uniformly small**: SRMR (computed by the spike) is 0.040 for the CFA and 0.087 for the SEM, max
  |correlation residual| 0.22 / 0.27 (USE4 is the worst-fitting indicator, standardised loading 0.46). That
  is a property of tam-v1 on these data, not an engine error: the fit indices (CFI 0.942 / 0.924, RMSEA
  0.062 / 0.070) say the same.
- Informational, not the parity task: plspm NUM parity files agree with the existing
  `evidence/r/parity_csem_pls-modeA-*.json` to ≤ 1.4e-10 (paths, loadings, weights, R²), standardised α to
  3e-15, and spike-computed ρC to 6e-12.

## 8. Not verified / caveats

- Robust SEs (`se_robust=True`), ULS/GLS/WLS/DWLS estimates, ordinal (polychoric) estimates, NUM-route missing
  data, higher-order constructs, `Scale.ORD/NOM` are smoke-only: no independent reference was built.
- Linux and real Colab were not run; the fork findings were produced on macOS by forcing
  `set_start_method("fork")`. Python 3.14 changes the Linux default start method to forkserver, which was not
  tested.
- plspm sign handling was read from source only (tam-v1 never triggers it). Bootstrap behaviour for models
  with higher-order constructs was not tested.
- An earlier monolithic run of `semopy_probe.py` ran for 64 min without finishing. It was killed and split
  into per-feature subprocesses with a 150 s timeout; in that form every feature finished (slowest:
  ModelMeans ML with missing data, 31 s). The cause of the stall was **not identified**. The numdifftools
  Hessian it used takes 0.4 s on its own and was replaced by a plain finite-difference Hessian, so no
  semopy feature is recorded as hanging.
- The semopy `Heywood` evidence uses a covariance-matrix input (`fit(cov=…, n_samples=500)`); the attempt to
  provoke one from tam-v1 data with a near-duplicate indicator gave an admissible solution.
