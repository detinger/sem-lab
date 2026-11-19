# Phase 0 — Foundation and research spike: evidence and exit review

Date: 2026-11-19. Machine: macOS arm64 (Apple silicon), R 4.6.2 (Homebrew), Python 3.12 via
uv, Node 26 / npm 11. No Docker, Linux or Colab run yet — see "Open items".

## Exit criterion (PLAN §5)

> All four minimal backend pathways either execute or are explicitly flagged as
> unavailable with a documented fallback; no bluffing about package features.

| Pathway | Result | Evidence |
|---|---|---|
| R PLS (cSEM 0.7.1, seminr 2.6.0) | **Executes.** Classic PLS (3 inner schemes), PLSc, Mode B verified against an independent reference implementation and across packages | `phase-0/r-spike.md`, `evidence/r/` |
| R CB (lavaan 0.7-3) | **Executes.** ML/MLR/MLM, fit indices, diagnostics verified by identities | `phase-0/r-spike.md`, `evidence/r/lavaan.json` |
| Python PLS (plspm 0.5.7) | **Executes for the core algorithm** with `Scale.NUM`; its bootstrap is unusable (unseeded) and many assessment features are absent — documented fallback: app-owned seeded resampling loop, R export for everything else | `phase-0/python-spike.md`, `evidence/python/` |
| Python CB (semopy 2.3.11) | **Executes** (ML CFA/SEM); FIML only via `ModelMeans`, Heywood cases are silently clipped, several fit labels are wrong — documented in the registry | `phase-0/python-spike.md` |

**Exit criterion met.** Every claim is recorded in `packages/method-registry/registry.json`
with its evidence file; the registry test fails if any `supported`/`beta` claim lacks
evidence. Nothing is `supported` yet: that status requires SEM Lab's own adapter plus a
reference test, which arrives with Phase 3.

## Checklist

- [x] Monorepo with npm workspaces (`apps/web`, `packages/*`), lint/format/test/typecheck/build
      scripts — all green (see "Commands").
- [x] PLAN.md and STYLE.md frozen as source of truth (unchanged since 2026-11-16).
- [x] Library APIs and licences validated — `phase-0/{r,python,web}-spike.md`, `docs/licensing.md`.
- [x] Tiny R PLS, R CB, Python PLS, Python CB models run in pinned environments
      (`services/r-engine/renv.lock`, `services/python-spike/uv.lock` — moved from `apps/api` in Phase 4 — and `package-lock.json`).
- [x] Capability matrix with native estimator differences — `packages/method-registry/registry.json`.
- [x] Canonical model and result JSON schemas — `packages/contracts` (Zod source, JSON Schema
      generated, 21 invalid examples, cross-language hash vectors).
- [x] Numerical fixtures — 15 synthetic cases (`packages/fixtures/synthetic`) and 6 sample
      datasets (`packages/fixtures/third-party`).
- [x] CI — `.github/workflows/ci.yml` (web/contracts/registry job; fixture reproducibility job).
      R and Python CI jobs are added in Phase 3 together with the adapters they test.

## Key numerical results

**Three independent PLS implementations agree** on tam-v1 (1,190 cases, 54 estimates):

| Comparison | Max \|Δ\| |
|---|---|
| cSEM vs independent reference (`_ref_pls.R`) | 3e-16 |
| cSEM vs seminr, path weighting | 6e-15 |
| cSEM vs plspm (Python), path / centroid / factorial | 5e-11 / 1.4e-10 / 1.3e-10 |
| plspm vs independent reference (`ref_pls.py`) | 5e-10 |

Controls: the three inner schemes differ from each other by up to 0.009 (the option is
applied), and PLSc raises paths/R² while leaving weights unchanged, as theory predicts.

**lavaan vs semopy (ML, tam-v1):** R² agree to 1.3e-4 (optimiser tolerance). The two parity
files are not directly comparable for loadings/paths because one stores standardized and the
other unstandardized estimates — the parity format must carry both scales explicitly
(Phase 5 prerequisite).

**Synthetic exact-covariance fixtures:** an independent ML fit and an independent PLSc
implementation recover the population parameters to ~1e-6 (fixture agent's verification;
`packages/fixtures/synthetic/README.md`). Not yet run through cSEM/lavaan — Phase 3/5.

**Descriptive statistics:** SmartPLS's stored statistics reproduced exactly for all 132
columns of the six datasets (population SD, G1, G2, upper median) — `phase-0/data-recon.md`.

## Decisions taken because of Phase 0 findings

1. **Classic PLS vs PLSc is explicit everywhere.** In cSEM a plain `=~` is PLSc
   (`.disattenuate = TRUE` by default) and seminr's `reflective()` is PLSc automatically. The
   R adapter always passes `.disattenuate` explicitly; method cards and provenance name it.
2. **Bootstrapping uses cSEM with an explicit seed per chunk**; our own `quantile(type = 7)`
   equals cSEM's percentile CI exactly. seminr is excluded (seed S+1 replays seed S), plspm is
   excluded (unseedable), `"replace"` and `.sign_change_option = "individual"` are excluded
   (defects). Inadmissible draws are counted and excluded, never silently replaced.
3. **IPMA is computed by SEM Lab** from a classic PLS fit on endpoint-rescaled data;
   `cSEM::doIPMA()` never rescales and must not be given a PLSc fit.
4. **The app validates data before any engine call:** cSEM errors on NA and silently treats
   text columns as ordinal; seminr mean-imputes silently; semopy silently uses pairwise
   covariances. Missing-data handling is always explicit (listwise or FIML) and reported.
5. **semopy results are post-checked** for boundary variances (Heywood cases are clipped to 0
   without a flag); GFI/AGFI/LogLik/AIC/BIC from semopy are never reported.
6. **Layout determinism:** ELK output depends on input order → ids are sorted and a fixed
   seed is passed (verified, Phase 1 tests).

## Commands

```bash
npm ci && npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
npm run check-schema --workspace @sem-lab/contracts
uv run --python 3.12 --with numpy python packages/fixtures/scripts/generate_synthetic.py --check
services/r-engine/bin/rscript services/r-engine/spike/csem_01_pls_core.R      # and the other spike scripts
cd services/python-spike && uv run python spike/plspm_probe.py                # and the other spike scripts (moved from apps/api in Phase 4)
```

## Open items carried forward

- Linux / Docker / Colab not run: fixture byte-stability on Linux (CI job will be the first
  run), R and Python environments in containers, notebook runtime.
- Literature citations in the registry and in `proposed-model.json` were entered from
  standard references without opening the sources; DOIs and pages must be checked before
  anything is published.
- Five of six sample datasets have unverified redistribution terms (see PROVENANCE.md).
- Smoke-only capabilities (BCa, PLSpredict, CVPAT, MICOM, MGA, HOC, interactions, WLSMV, FIML,
  modification indices) stay `planned` until their numbers are checked.
- The parity-file format needs explicit standardized and unstandardized blocks.
