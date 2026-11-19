# Phase 3 — First complete PLS-SEM vertical slice: evidence and exit review

> **Superseded in Phase 4.** The product owner moved estimation into the browser; the FastAPI service (`apps/api`) and the server deployment described here were removed (they remain in git history). The R engine continues as the verification oracle. See `docs/architecture/overview.md` §3.

Date: 2026-11-19. Local stack: web (Vite) + API (FastAPI, uv) + R engine (R 4.6.2, cSEM 0.7.1).

## Exit criterion (PLAN §5)

> import CSV → model → validate → run → inspect → bootstrap → paste table in Word → rerun
> exported R code.

| Step | Evidence | Status |
|---|---|---|
| import CSV → model → validate | Phase 2 suite; `e2e/analysis.spec.ts` loads a bundled sample and maps the "Two constructs" template | ✔ automated |
| run (real API + real R engine) | `e2e/analysis.spec.ts` starts the API on :8000 and runs B = 200 through cSEM; also cancels a B = 10,000 run mid-bootstrap | ✔ automated (local; needs R) |
| inspect | Results tabs Summary / Measurement / Structural / Bootstrap / Fit / Reproducibility rendered from the real result | ✔ automated + screenshots reviewed |
| bootstrap | chunked, seeded, counted (requested = completed + failed + inadmissible); percentile CIs | ✔ R engine tests |
| paste table in Word | Copy table writes `text/html` (semantic table, inline styles, no merged cells) + `text/plain` TSV; the e2e reads both back from the clipboard | ✔ clipboard content automated · **pasting into Microsoft Word / Google Docs not yet checked by hand** (STYLE §13 requires that before claiming compatibility) |
| rerun exported R code | `code-export/r-csem.test.ts` runs the R engine AND the exported script on the same data: estimates, bootstrap counts and percentile intervals agree to ≤ 1e-12 (classic PLS and PLSc) | ✔ automated (skips without R) |

**Exit criterion met**, with one manual check outstanding (Word/Google Docs paste).

## Checklist

- [x] FastAPI adapter and R cSEM worker integrated (`apps/api`, `services/r-engine`; job
      directory protocol, SQLite job store, cancellation, retention, privacy-safe logging).
- [x] Estimate reflective TAM-type models with standard PLS path weighting (and PLSc, Mode B).
- [x] Loadings, reliability/validity (α, ρA, ρC, AVE, HTMT, HTMT2, Fornell–Larcker,
      cross-loadings, VIF), paths, R², adjusted R², f², total / indirect / specific indirect effects.
- [x] Bootstrap with progress, seed, cancel and results tables; bootstrap histograms.
- [x] Diagram overlays (estimates, t, p, CI, hypotheses — one mode at a time), Word-ready Copy
      table, R script export (script + the exact analysis matrix).
- [x] Numerical benchmark against documented references (below).

## Numerical evidence (R engine, `services/r-engine/bin/test`)

| Check | Max \|Δ\| |
|---|---|
| PLSc on tam-mediation-exact vs population (paths .60/.20/.50, indirect .30, total .50, loadings, R², AVE, ρC) | 6.7e-16 |
| classic PLS on tam-mediation-exact vs its population limits | 1.1e-16 |
| Mode B weights and composite loadings (pls-mixed-composite-exact) | 3.3e-16 |
| engine (aliased syntax) vs direct cSEM call with user names | 0 |
| Phase 0 parity (classic path/centroid/factorial, PLSc; 63–73 numbers each) | ≤ 5.6e-16 |
| exported R script vs engine (estimates and percentile CIs, B = 200) | < 1e-12 |

Bootstrap timing on tam-mediation (n = 500, 3 constructs, 11 indicators): ≈ 0.74 s per 100
draws sequentially on the development machine.

## Defects found and fixed during integration

1. **API dropped required nulls.** Results were serialised with `exclude_none=True`, removing
   e.g. an exogenous construct's `R² value: null`; valid results then failed the contract in the
   browser. Fixed at the source (`dump_contract` = `exclude_unset`), regression test
   `apps/api/tests/test_serialisation.py`; the temporary client-side workaround was removed so a
   future server bug cannot be masked.
2. The same `exclude_none` would have dropped `column: null` from requests written for the
   engine — fixed by the same helper.
3. Engine JSON used 15 significant digits; switched to 17 so every double round-trips (parity
   checks now show real machine-precision differences instead of an artificial 0).
4. The sidebar always said "Backend: not configured"; it now reports the health probe.

## Registry changes

Promoted to `supported` (reference-tested) for r-csem: classic PLS, PLSc, Mode B, path weighting,
percentile bootstrap, total/indirect and specific indirect effects. Centroid/factorial remain
`beta` (their reference test needs the git-ignored TAM sample, so it cannot run in CI). HTMT,
Fornell–Larcker, f², VIF and fit measures remain `beta` (engine-verified in Phase 0; no adapter
reference test yet).

## Test totals at the end of the phase

Web 505 unit tests (+ 7 exporter tests incl. 2 real-R comparisons), contracts 54, registry 67,
API 91, R engine 41 test blocks (~10,000 expectations), browser 29 (including 2 real API/R
runs). CI gained `api` and `r-engine` jobs (`.github/workflows/ci.yml`) — not yet run on
GitHub; the R job restores `renv.lock` on Linux, which may need extra system libraries.

## Known limitations / open items

- Word / Google Docs paste: manual verification pending (see above).
- Docker image and Railway deployment written but not built or deployed (no Docker locally).
- The API runs one process (in-process runner, concurrency limit and rate limiter).
- `TIMEOUT` inside a single slow estimation relies on the API killing the process group.
- One-sided tests take the direction from the sign of the estimate (the contract has no field for
  a pre-registered direction) — stated in the result warnings.
- CB-SEM (lavaan adapter) and Python export are Phase 5.
