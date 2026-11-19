# SEM Studio

An interactive workspace for structural equation modeling (PLS-SEM and CB-SEM): draw a
model, map survey data, estimate it with validated engines, and report the results.

`PLAN.md` (product) and `STYLE.md` (design) are the specifications. Nothing in this README
claims a feature beyond what the phase records in `docs/validation/` demonstrate.

## Status

| Phase | Scope | State | Evidence |
|---|---|---|---|
| 0 | Foundation, library verification, contracts, fixtures | **Done** | `docs/validation/phase-0.md` |
| 1 | Design system, visual modeler, persistence, diagram export | **Done** | `docs/validation/phase-1.md` |
| 2 | Data Lab (CSV import, mapping) and model validator | **Done** | `docs/validation/phase-2.md` |
| 3 | First PLS-SEM vertical slice (R/cSEM backend, bootstrap, Word tables, R export) | **Done** | `docs/validation/phase-3.md` |
| 4 | In-browser engine (PLS, PLSc, Mode B, bootstrap, IPMA, CB-SEM ML/MLR/FIML), R and Python export bundles, Python engine, examples | **Done** | `docs/validation/phase-4.md` |
| 5–8 | Remaining CB features, notebooks + learning, advanced methods, hardening | Planned | — |

**Architecture:** everything runs in the browser — modeling, data, estimation and reporting.
There is no backend; data never leave the user's machine. R and Python are provided as
exported scripts and notebooks that reproduce the app's results locally. The R engine in
`services/r-engine` is a verification oracle used in development and CI only
(`docs/architecture/overview.md` §3).

What each engine can and cannot do — verified by execution, with evidence files — is in
`packages/method-registry/registry.json`. The browser engine is being verified against the R
reference results now; until a capability reproduces them it stays `planned`.

## Repository

```text
apps/web/                  React 19 + TypeScript + Vite single-page app (the modeler lives in src/features/modeler)
packages/engine/           in-browser estimation engine (TypeScript): PLS-PM, PLSc, CB-SEM ML/MLR/FIML, IPMA, bootstrap
packages/python-engine/    the same engine in Python (numpy/scipy), shipped with Python exports and notebooks
services/r-engine/         R verification oracle (cSEM, lavaan): produces the committed reference results
services/python-spike/     Phase 0 verification of plspm/semopy (evidence only)
packages/contracts/        Zod contracts (model, layout, analysis, results) → generated JSON Schema
packages/method-registry/  capability registry with evidence
packages/fixtures/         synthetic benchmark datasets + converted sample datasets with provenance
docs/                      architecture, validation evidence per phase, licensing, research notes
```

## Local development

Requirements: Node ≥ 22 (developed on 26), npm. For the engines: R ≥ 4.6 and
[uv](https://docs.astral.sh/uv/) (Python 3.12).

```bash
npm ci
npm run dev            # http://localhost:5173 — the modeler works fully offline
```

Quality gates (all must pass; CI runs the same commands):

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test           # web, contracts and registry unit tests
npm run build
npm run check-schema --workspace @sem-studio/contracts         # JSON Schema in sync with Zod
uv run --python 3.12 --with numpy python packages/fixtures/scripts/generate_synthetic.py --check
npm run e2e --workspace @sem-studio/web                         # browser tests (uses installed Google Chrome)
```

R engine (packages are installed into `services/r-engine/r-lib`, never into the system library):

```bash
services/r-engine/bin/rscript services/r-engine/scripts/install_packages.R   # first time; compiles from source
services/r-engine/bin/rscript services/r-engine/spike/csem_01_pls_core.R      # example verification script
```

Python engine:

```bash
cd packages/python-engine && uv run pytest
```

## Deployment

- **Netlify** (web): `netlify.toml` builds `apps/web` and serves it as an SPA with deep-link
  fallback. Set `VITE_API_BASE_URL` in the Netlify UI once the API exists.
- **No server.** The former API/R worker was removed in Phase 4 when estimation moved into the
  browser (it remains in git history).

## Data and privacy

Models, data and results stay in the browser (IndexedDB). Nothing is sent to a server.
Sample data: `packages/fixtures/third-party/smartpls-samples/PROVENANCE.md` — only the ACSI
2015 dataset (CC BY 4.0) may be redistributed; the others are local test fixtures.

## Licences

See `docs/licensing.md`. The R and Python statistics packages are GPL- or MIT-licensed and
are run as separate processes; elkjs is used under EPL-2.0.
