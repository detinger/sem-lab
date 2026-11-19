# SEM Studio — architecture and ownership map

Status: living document. `PLAN.md` and `STYLE.md` are the frozen product and design
specifications; this file records the concrete engineering decisions made while
implementing them. When this file and the code disagree, the code is wrong or this
file is stale — fix one of them, do not leave the disagreement.

## 1. Ground rules (apply to every contributor, human or agent)

1. **No unverified statistical claims.** A method, option, metric or engine pathway is
   only marked `supported` in the capability registry when a script in this repository
   executes it and a reference test checks its numbers. Everything else is `beta`,
   `planned` or `unsupported`, with the reason written down.
2. **Canonical model is the single source of scientific truth.** Diagram layout, the
   estimator request, generated R/Python code and result overlays are all *derived*
   from the canonical model JSON. Nothing reads statistical meaning from node positions.
3. **Row-level data is private.** Never log it, never put it in URLs, error messages or
   telemetry. Data leaves the browser only after an explicit "Run on server" action.
4. **Generated code is inert text.** Never `eval`/`exec`/shell-interpolate model labels,
   column names or user text. Identifiers are validated and escaped before they reach R
   or Python source.
5. **JSON never contains `NaN`/`Infinity`.** Missing numbers are `null` plus a
   machine-readable reason.
6. **SmartPLS is a feature benchmark only.** The `.splsm/.splscb/.splspm/.splsge/.splsrm`
   project files supplied in `TEMP/` are encrypted and are *not* decrypted, parsed or
   reverse-engineered. Only the plain-JSON `*.settings` side files (indicator → construct
   assignment, scale endpoints, descriptive statistics) and the delimited data files are
   used. Structural paths for the bundled examples are specified by us from the published
   theory and are labelled as SEM Studio's own specification.

## 2. Repository layout

```text
sem-studio/
├── PLAN.md, STYLE.md            frozen specifications
├── package.json                 npm workspaces root (apps/web, packages/contracts, packages/method-registry)
├── apps/
│   ├── web/                     React 19 + TypeScript + Vite SPA (Netlify)
│   │   └── src/{app,features,domain,components/ui,storage,styles,tests}
│   └── api/                     FastAPI service (Railway) — Python 3.12, managed with uv
│       ├── app/                 endpoints, job store, engine runners, code export
│       └── tests/               pytest
├── services/
│   └── r-engine/                R adapters run as a subprocess by the API
│       ├── R/                   cSEM / lavaan adapters, result normalisation
│       ├── tests/testthat/
│       ├── scripts/             install + maintenance scripts
│       ├── r-lib/               project-local R library (git-ignored)
│       └── renv.lock            pinned package versions
├── packages/
│   ├── contracts/               Zod schemas (source of truth) → emitted JSON Schema + shared examples
│   ├── fixtures/                numerical benchmark cases (model + data + expected results + provenance)
│   └── method-registry/         capability registry: supported / beta / planned / unsupported per engine
├── notebooks/colab/             five Python notebooks
├── content/                     lessons, challenges, examples, citations (data, not code)
├── docs/                        architecture, estimators, validation evidence, security, deployment
└── .github/workflows/           CI
```

## 3. Runtime architecture

```text
Browser (React SPA)
  ├─ canonical model + layout  ── IndexedDB (private, local-first)
  ├─ Data Lab (CSV parsed client-side with Papa Parse)
  ├─ validator + capability registry (pure TS, runs offline)
  └─ explicit "Run on server"  ──HTTP──▶  FastAPI  (apps/api)
                                            ├─ validates request (Pydantic, mirrors Zod contracts)
                                            ├─ job store: SQLite + per-job directory (retention sweeper)
                                            ├─ runner: spawns ONE subprocess per job
                                            │     ├─ Rscript services/r-engine/R/run_job.R <job-dir>   (cSEM, lavaan)
                                            │     └─ python -m app.engines.py_worker <job-dir>         (semopy, plspm subset)
                                            └─ result: normalised JSON validated against the contract
```

Decisions and their reasons:

- **One API container that also contains R.** The plan warns against premature
  microservices. The API launches the R engine as a child process (`Rscript`) with a job
  directory as the only interface: `request.json` + `data.csv` in, `progress.ndjson` +
  `result.json` out. The engine boundary is a directory of files, so the R engine can be
  moved to its own worker service later without changing either side.
- **Process boundary also serves licensing.** `cSEM`, `seminr` and Python `plspm` are
  GPL-3; `lavaan` is GPL (≥2). SEM Studio's own code never links against them: it invokes
  them as separate programs and exchanges JSON files. See `docs/licensing.md`.
- **Job store is SQLite, not process memory.** Job state survives an API restart. On
  Railway the data directory must be a mounted volume (documented in
  `docs/deployment/railway.md`). Redis is not required for the single-service deployment;
  the runner interface keeps a queue backend swappable.
- **Cancellation = killing the child process group.** Progress is whatever the engine
  wrote to `progress.ndjson`; the API never invents a percentage.
- **Bootstrap runs in chunks.** The engine resamples in fixed-size chunks with
  deterministic per-chunk seeds, so progress is real, cancellation is prompt, and failed
  or inadmissible replications are counted, not hidden.

## 4. Contracts

- Source of truth: Zod schemas in `packages/contracts/src`. JSON Schema is emitted into
  `packages/contracts/schema/*.json` by a script and committed.
- Python mirrors the contracts with Pydantic models in `apps/api/app/contracts/`.
- Drift guard: every file in `packages/contracts/examples/` (valid and deliberately
  invalid) is checked by Zod (Vitest), by the emitted JSON Schema, and by Pydantic
  (pytest). A change that only one side accepts fails CI.
- Schemas are versioned (`schemaVersion`), migrations live next to the schema and are
  tested.
- Hashing: `modelHash` covers the scientific model only (constructs, indicators,
  relationships, in canonical order). Layout is hashed separately. Moving a node never
  changes `modelHash`.

## 5. Toolchain (verified on the development machine, see docs/validation/phase-0)

| Tool | Version used | Notes |
|---|---|---|
| Node.js / npm | 26.x / 11.x | npm workspaces; no pnpm/yarn |
| Python | 3.12 (via `uv`) | system Python 3.15 is too new for the scientific wheels we pin |
| R | 4.6.x | packages installed into `services/r-engine/r-lib` |
| Docker | not installed locally | Dockerfiles and compose are written but can only be verified in CI / on Railway |

R is always invoked through `services/r-engine/bin/rscript`, a wrapper that puts the
project library first on the library path. Python is always invoked through
`uv run` inside `apps/api`.

## 6. Ownership map (who may change what)

| Area | Path | Owner role (PLAN §6.1) |
|---|---|---|
| Contracts, registry, hashing | `packages/contracts`, `packages/method-registry` | Agent 1 — one writer at a time |
| Theme tokens | `apps/web/src/styles/tokens.css` | Agent 1/2 — one writer at a time |
| Modeler, layout, diagram export | `apps/web/src/features/modeler` | Agent 2 |
| Data Lab, validator | `apps/web/src/features/{data-lab,validation}` | Agent 3 |
| PLS engine | `services/r-engine/R/pls_*`, fixtures for PLS | Agent 4 |
| CB engine, Python engines, code export | `services/r-engine/R/cb_*`, `apps/api/app/{engines,export}` | Agent 5 |
| Results, tables, clipboard, IPMA UI | `apps/web/src/features/{results,ipma,reports}` | Agent 6 |
| Learn, challenges, notebooks | `content/`, `notebooks/`, `apps/web/src/features/{learn,challenges,examples}` | Agent 7 |
| CI, deployment, security | `.github`, `netlify.toml`, Dockerfiles, `docs/{deployment,security-and-privacy}` | Agent 8 |

Evidence for every completed phase is recorded in `docs/validation/phase-N.md`.
