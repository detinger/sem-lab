# semlab — SEM Lab's estimation engine in Python

`semlab` is SEM Lab's own estimation engine, written in Python. Python scripts and Colab
notebooks exported from SEM Lab use it, so the numbers you get on your machine are the
numbers the app shows. It mirrors **@sem-lab/engine 0.1.0**, the TypeScript engine that runs
in the browser (`packages/engine`), and it is tested against that engine and against the same
R reference results.

Why this package exists: the public Python SEM libraries cannot reproduce the app. plspm has no
PLSc and no assessment and cannot seed its bootstrap; semopy clips Heywood cases, mislabels fit
indices and has a broken FIML (see `docs/validation/phase-0/python-spike.md`). So Python exports
ship this package, which SEM Lab owns and has verified (PLAN §2.9).

## What it estimates

- **PLS-SEM and consistent PLS (PLSc)** with cSEM 0.7.1 semantics: path, centroid and factorial
  inner weighting; Mode A and Mode B; R², adjusted R², Cronbach's α, ρA, ρC, AVE, HTMT and HTMT2,
  Fornell–Larcker, cross-loadings, f², structural and Mode B VIF, SRMR, d_ULS and d_G; total,
  total-indirect and specific indirect effects; IPMA; cSEM::verify admissibility.
- **SEM Lab's bootstrap**: `set.seed(seed, "Mersenne-Twister", "Inversion", "Rejection")`,
  then `sample.int(n, n, replace = TRUE)` for each draw, bit-exact with R. Failed and
  inadmissible draws are counted and excluded. SE uses the divisor B − 1, p values come from
  t(B_valid − 1), and CIs are type-7 percentile intervals, two-sided or one-sided.
- **CB-SEM** by ML or MLR on complete data (listwise) or with FIML, using lavaan 0.7 `sem()`
  defaults:
  - marker or std-lv identification;
  - expected, observed or sandwich standard errors;
  - Yuan–Bentler scaled and robust CFI, TLI and RMSEA;
  - RMSEA confidence interval by inverting the noncentral χ² with R's `uniroot`;
  - Heywood, singular-covariance and identification diagnostics.

## Install

Option 1 is the single file the app ships next to every exported Python script. It needs only
numpy and scipy:

```sh
pip install "numpy>=1.22.4" "scipy>=1.12"
# put semlab_bundle.py next to your script (exports already include it)
```

```python
import semlab_bundle as semlab
```

On Colab, upload `semlab_bundle.py` or `!wget` it into the working directory. numpy and scipy
are already installed there.

Option 2 is the package, installed from a checkout of this repository:

```sh
pip install ./packages/python-engine        # or: uv pip install ./packages/python-engine
```

Requires Python ≥ 3.10. Runtime dependencies are numpy ≥ 1.22.4 and scipy ≥ 1.12. With
scipy < 1.12, Student-t p values can be off by up to about 1e-11; the bundle warns at import.
pandas is optional and only needed for `to_dataframe`.

## Usage

```python
import json
import semlab_bundle as semlab  # or: import semlab

project = json.load(open("analysis.json"))           # written by the export
model, analysis = project["model"], project["analysis"]  # analysis["engine"] == "browser"

columns, rows = semlab.read_csv("data.csv")
data = semlab.build_analysis_data(model, columns, rows, analysis["missingData"])
out = semlab.estimate(model, analysis, data)
if not out["ok"]:
    raise SystemExit(f"{out['error']['code']}: {out['error']['message']}")

result = out["result"]                                # NormalizedSemResult, as in the app
tables = semlab.results_tables(result, model)      # plain lists of row dicts
for row in tables["paths"]:
    print(row["from"], "->", row["to"], row["est"], row["pValue"])

if semlab.pandas_available():
    frames = semlab.to_dataframes(result, model)   # optional pandas DataFrames
```

- `estimate(model, analysis, data, on_progress=None, is_cancelled=None)` returns
  `{"ok": True, "result": ...}` or `{"ok": False, "error": {"code", "message", "details"?}}`. It
  never raises for bad input. `analysis["method"]` selects the engine: `pls-sem` or `plsc` runs
  the PLS engine, `cb-sem` runs the CB engine. The result is the app's `NormalizedSemResult` JSON
  with the same parameter keys, kinds, ids, missing reasons, warnings and error codes.
  `provenance` adds `pythonVersion` and the `semlab`, `numpy` and `scipy` versions.
- `build_analysis_data(model, columns, rows, "listwise" | "fiml")` builds the analysis matrix
  the way the app does:
  - one column per indicator column, in model order;
  - reverse scoring `min + max − x` with the declared scale;
  - listwise deletion, or for FIML, keeping rows with at least one observed value.

  It raises `AnalysisDataError` with the app's codes.
- `results_tables(result, model)` returns the tables `parameters`, `paths`, `loadings`,
  `weights`, `effects`, `variances`, `constructMetrics`, `fit`, `matrix:<id>`,
  `ipmaConstructs`/`ipmaIndicators`, `bootstrap` and `warnings`, using construct and indicator
  names. For CB results, `std` holds the std.all estimate.
- Lower-level pieces are also exported: `bootstrap_indices`, `fit_draw`,
  `RMersenneTwister`, `pt`, `quantile7`, `pnchisq`, `rmsea_ci` and `cb_parameter_count`.

## Reproducibility guarantee and tested tolerances

`cd packages/python-engine && uv run pytest` runs every check twice: once against the
`semlab` package and once against `dist/semlab_bundle.py`. The suite runs in CI on
Python 3.10 and 3.12. It has also passed on numpy 1.22.4 with scipy 1.12.0, the lowest
supported versions.

| Check | Tolerance | Measured max \|Δ\| |
|---|---|---|
| R RNG: `runif`, `sample.int` (n up to 10⁶, incl. 65536/65537), bootstrap indices (`r-mersenne-twister.json`) | bit-exact | 0 |
| 75 R/cSEM PLS reference runs: classic PLS / PLSc estimates | 1e-10 abs | 1.0e-15 / 4.3e-15 |
| … Mode B weights · effects · construct metrics | 1e-10 abs | 2.8e-16 · 4.3e-15 · 2.8e-15 |
| … matrices (HTMT, FL, cross-loadings, f², VIF) · fit (SRMR, d_ULS, d_G) · IPMA | 1e-10 abs | 3.9e-13 · 2.1e-15 · 1.4e-13 |
| … keys, ids, statuses, missing reasons, warnings, iterations, admissibility | identical | identical |
| 7 R bootstrap references: every draw's index sum, status, failure reason / verify checks | identical | identical |
| … every draw's estimates (valid / inadmissible) | 1e-10 abs | 8.3e-13 / 1.1e-12 |
| … SE · t · p · CI | 1e-10 abs | 1.2e-13 · 3.3e-13 · 2.1e-14 · 4.9e-15 |
| 17 lavaan 0.7-3 CB runs (tight refits): estimates · std.all (ML, MLR, FIML) | 1e-6 abs | 4.8e-8 · 2.4e-8 |
| … SE (relative) | 1e-5 | 6.7e-8 |
| … fit indices (relative; ~0 values absolute) · RMSEA CI | 1e-6 (1e-7) · 1e-5 | 1.6e-7 (6.7e-9) · 8.2e-11 |
| Student t vs R `pt` (abs; tail relative) · χ², noncentral χ², RMSEA uniroot emulation | 1e-13; 5e-12 · TS tolerances | 2.2e-16; 4.3e-14 · ≤ 4e-11 |
| Population truths: tam-mediation-exact (PLSc, CB), pls-mixed-composite-exact, cfa-two-factor-exact | 1e-9 (PLS) / 1e-7 (CB) | ≤ 9e-16 |
| **Cross-language: Python result JSON vs TypeScript engine (node)**, 8 PLS requests incl. the ACSI example (IPMA, B = 1000) | 1e-10 × max(1, \|x\|), strings identical | 2.7e-13 |
| … 6 CB requests (ML, MLR, std-lv, ML/MLR FIML, Heywood) | 1e-7 × max(1, \|x\|) | parameters 1.4e-9, fit 2.9e-10 (see note) |

The values above are from Python 3.12 (numpy 2.5, scipy 1.18). The run on Python 3.10
(numpy 2.2, scipy 1.15) gives the same bounds.

On CB cross-language parity: every number agrees within the tolerance. The optimiser decides to
stop at the 1e-15 gradient level, where the summation order of the two languages differs. So
`estimation.iterations` may differ by one or two, and the printed final max |gradient| (~1e-15)
may differ. The test bounds both: |Δ iterations| ≤ 2, and gradients < 1e-9 in both languages.
For an exactly singular sample covariance, the null-vector coefficients are tied to 1e-16. Which
indicator the error message leads with is therefore rounding noise in either language. The code,
the dependent indicators and the dependency coefficients agree.

Performance, single thread (Apple M-series, Python 3.12):

- R-compatible bootstrap indices, B = 1,000 × n = 7,422: 0.07 s.
- ACSI 2015 example (n = 7,422, 12 indicators): about 25 ms per PLS fit with full assessment.
- The full example analysis (PLS-SEM + IPMA + B = 1,000 bootstrap) takes about 1.8–2 s.
- CB service-quality (13 indicators): about 45 ms with ML, about 100 ms with MLR.
- CB missing-mcar with FIML: about 0.2 s with ML, about 0.3 s with MLR.

## Not ported

Nothing in the TypeScript engine is left out. Its own deliberate limits carry over and give the
same error codes: BCa intervals, higher-order constructs, CB-SEM bootstrap, MLM or WLSMV,
multiple groups, nonrecursive models, and robust FIML fit indices (`not-supported`). The
TypeScript hooks map to Python as follows:

- the progress callback becomes `on_progress`;
- the cancellation signal becomes `is_cancelled`;
- the parallel draw executor becomes `execute_draws` in `estimate_pls`.

## Layout

```
semlab/          meta, errors, jsnum (JS number formatting), linalg, stats, rng, effects,
                    pls_core (validation + PLS-PM core), assess, bootstrap, ipma, pls (results +
                    estimate), distributions, cb, api
scripts/bundle.py   builds dist/semlab_bundle.py (deterministic; --check verifies it is current)
dist/               the single-file bundle shipped with exports (committed)
tests/              pytest suite (package + bundle), incl. cross-language tests via node
```

After changing `semlab/`, run `python scripts/bundle.py`. The `test_bundle` test fails
while the committed bundle is stale.

## Licence and provenance

MIT (the repository's `LICENSE`; the full notice is also embedded in
`dist/semlab_bundle.py`, which travels alone in exports and notebooks). See `docs/licensing.md`. It is a port of `packages/engine/src` (TypeScript). The algorithms are
re-implemented from their documented definitions: R's RNG.c algorithms, cSEM's and lavaan's
documented estimators, and Brent's zeroin as in R's `uniroot`. It contains no code from cSEM,
lavaan, plspm or semopy, which are GPL or MIT licensed and serve only as verification oracles.
Runtime dependencies are numpy and scipy (BSD-3-Clause); pandas (BSD-3-Clause) is optional.
