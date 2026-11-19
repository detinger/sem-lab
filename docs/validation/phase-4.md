# Phase 4 — Mature PLS assessment, IPMA and in-browser estimation: evidence and exit review

Date: 2026-11-19. Everything runs in the browser; there is no backend. The R engine
(`services/r-engine`: R 4.6.2, cSEM 0.7.1, lavaan 0.7-3) is the verification oracle only.

## Scope change during the phase

The product owner moved estimation into the browser ("no backend needed"). The phase therefore
also delivered work PLAN placed in Phase 5:

- SEM Studio's own TypeScript engine (`packages/engine`) for PLS-SEM, PLSc, Mode B, bootstrap,
  IPMA **and CB-SEM** (ML, MLR, FIML), run in Web Workers; R-identical random numbers, so the
  bootstrap draws the same rows as R.
- The FastAPI service, Docker image and Railway deployment were removed (they remain in git
  history). Netlify serves the static app. See `docs/architecture/overview.md` §3.
- A Python port of the engine (`packages/python-engine`, single file `semstudio_bundle.py`) for
  exported scripts and the Colab notebooks.
- The lavaan R export and the Python export.

## Exit criterion (PLAN §5)

> IPMA point coordinates agree with validated reference and results are reportable with correct
> qualification.

**Met.**

| Evidence | Max \|Δ\| |
|---|---|
| Browser IPMA vs the R oracle on 4 IPMA reference runs (`packages/engine/tests/pls-reference.test.ts`); the oracle's convention matched `cSEM::doIPMA()` to 9e-14 in Phase 0 | 7.1e-14 |
| ACSI 2015 example (real data, n = 7,422 used): point estimates, assessment matrices, fit and IPMA coordinates vs `phase-4/acsi-2015-reference-result.json` (`apps/web/src/features/ipma/acsi-reference.test.ts`) | 5.0e-12 |
| Exported R script's IPMA (cSEM refit on 0–100 data, one reverse-scored indicator) vs the browser (`code-export/r-csem.test.ts`) | < 1e-12 |
| Python engine IPMA vs the R references (`packages/python-engine/tests`) | 7.1e-14 |

Reportability: IPMA is refused for PLSc and without declared scale endpoints (never observed
extrema); negative normalised weights, non-finite values and "point estimates only" are stated as
result warnings; the convention text travels with every result (`ipma.convention`).

## Checklist

- [x] Mode B composite/formative blocks, indicator VIF, assessment gates (reflective metrics
      only for Mode A; VIF for Mode B blocks; capability gate shared by validator and engine,
      `packages/method-registry/src/gating.ts` + `gating-vectors.json`).
- [x] PLSc; inner schemes path / centroid / factorial (all reference-tested); HTMT, HTMT2, f²,
      total / indirect / specific indirect effects.
- [x] IPMA: target selection, scale-metadata checks (`IPMA_SCALE_MISSING`), 0–100 map and table,
      construct and indicator level.
- [x] R export for the added algorithms (Mode B, PLSc, IPMA in cSEM; CB-SEM in lavaan) and a
      reproducibility manifest (below).
- [x] ACSI and D&M reference projects (`content/examples/`; gallery page — see "Examples").

## Numerical evidence (browser engine)

| Family (vs committed R references) | Max \|Δ\| |
|---|---|
| Classic PLS (61 runs incl. Mode B, all inner schemes) | 1.4e-15 |
| PLSc | 5.1e-15 |
| Mode B weights | 3.3e-16 |
| Construct metrics / effects / fit | 2.8e-15 / 5.1e-15 / 1.0e-15 |
| Assessment matrices (HTMT, HTMT2, VIF, f², cross-loadings) | 3.1e-13 |
| IPMA | 7.1e-14 |
| Bootstrap (7 references): valid draws / inadmissible draws / SE / t / p / CI | 1.0e-12 / 2.4e-12 / 1.5e-13 / 4.0e-13 / 2.7e-14 / 8.4e-15 |
| R Mersenne-Twister + `sample.int` | bit-exact |
| CB-SEM vs lavaan refits at tight tolerance (17 runs: ML, MLR, FIML; marker / std.lv) | estimates ≤ 4.8e-8, SE ≤ 6.8e-8, fit ≤ 1.2e-7 |
| CB-SEM vs lavaan at its default tolerance | estimates ≤ 1.8e-6 (lavaan's own optimizer stop) |

ACSI 2015, B = 1,000 in Chrome (8 logical cores): 2.4 s single worker, 1.5 s with the worker
pool; results identical to the single-worker run (`e2e/browser-engine.spec.ts`).

The validator's CB degrees of freedom now come from the engine's parameter count; the former
independent count missed lavaan's `auto.cov.y` disturbance covariances (A → B, A → C frees
B ~~ C; checked against lavaan 0.7-3: npar 21, df 24).

## Exports and reproducibility manifest

Each export is one ZIP: the script, the exact analysis matrix, `model.json`, `analysis.json`,
`browser-result.json`, `README.md` and `manifest.json` (app version, run id, engine and package
versions, model hash, data fingerprint, row counts, reverse-scored columns, Data Lab
transformations, options, required capabilities with status and verification level, warnings,
citations and the SHA-256 of every file).

| Export | Verified by | Agreement with the app |
|---|---|---|
| R / cSEM (PLS, PLSc, Mode B, bootstrap, IPMA) | `code-export/r-csem.test.ts` runs the script in R | ≤ 1e-12 |
| R / lavaan (ML, MLR, listwise, FIML) | `code-export/r-lavaan.test.ts` | about 1e-6 (lavaan's default tolerance) |
| Python (the app's engine) | `code-export/bundle.test.ts` runs the bundle; `e2e/browser-engine.spec.ts` downloads it from Chrome, unzips and runs it; the script itself compares every number with `browser-result.json` | observed 7.1e-14 (PLS, 203 numbers) |

**Decision — Python export uses SEM Studio's engine, not semopy / plspm.** PLAN §2.9 names
semopy and plspm but also allows "a tested optional app-owned implementation". The port
reproduces the app (whole-result JSON: PLS 2.7e-13 relative, CB 1.4e-9) including bootstrap
draws; semopy and plspm use different estimator definitions and could not match the app's
numbers. The export never substitutes a different estimator.

## Examples

`content/examples/`: ACSI 2015 (real data, CC BY 4.0, attribution shipped), TAM mediation,
IS success inspired by DeLone & McLean (with IPMA on net benefits), and service quality →
satisfaction → loyalty (CB-SEM). All synthetic data are labelled SYNTHETIC.

The **Examples & Colab** page (`apps/web/src/features/examples`) opens any example as a new
project in one click: model with automatic layout, bundled dataset linked through the Data Lab,
and the example's analysis settings; the open project is never overwritten (confirmation when it
has content). Evidence: `examples.test.ts` (every example parses, validates without errors on its
real data, estimates in the browser engine, and its settings round-trip through the form),
`examples-page.test.tsx`, and `e2e/examples.spec.ts` (opens D&M, runs it, IPMA points render;
light and dark screenshots in `apps/web/test-results/phase4-examples/`).

## Test totals at the end of the phase

Web 606 unit tests, contracts 54, engine 165, method registry 109, Python engine 345,
browser (Playwright, Chrome) 40. Real-R checks inside the web suite: cSEM export (classic,
PLSc, IPMA) and lavaan export (ML, MLR, FIML); real-Python checks: both export bundles.

The cancellation e2e clicked Cancel after a full-page screenshot; with the worker pool a
B = 10,000 run on the small test model could finish first (seen once). Cancel now comes first
(8/8 repeated runs pass).

## Known limitations / open items

- Literature citations: the 27 registry entries were checked on 2026-11-19 (authors, year,
  venue, volume, issue, pages); two were looked up online (Dijkstra 2017, pp. 55–80;
  Sarstedt, Henseler & Ringle 2011, vol. 22, pp. 195–218 — subtitle added). DOIs are not yet
  recorded. The cSEM package citation comes from R's `citation("cSEM")`.
- Not offered (gated, with reasons): BCa intervals, CB bootstrap, MLM / WLSMV, higher-order
  constructs, interactions, multigroup, PLSpredict, modification indices.
- IPMA has no bootstrap intervals (stated as a result warning).
- One-sided bootstrap tests take the direction from the sign of the estimate (stated in the
  result warnings).
- Five SmartPLS sample datasets with unverified redistribution terms stay git-ignored; their
  tests skip in CI.
