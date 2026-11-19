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

**Decision (2026-11-19, product owner): estimation runs in the browser. There is no
backend.** R and Python exist only as code that users run locally (exported scripts and the
Colab notebooks). This supersedes the original server design (FastAPI + R worker on Railway),
which was removed in Phase 4 once the browser engine reached parity (it stays in git history).

```text
Browser (React SPA, static hosting on Netlify)
  ├─ canonical model + layout  ── IndexedDB (private, local-first)
  ├─ Data Lab (CSV parsed client-side)
  ├─ validator + capability registry (pure TS)
  ├─ @sem-studio/engine (packages/engine, pure TypeScript)
  │     ├─ PLS-PM / PLSc / Mode B / assessment / effects / IPMA
  │     ├─ CB-SEM ML (CFA/SEM), FIML, MLR where verified
  │     └─ R-compatible RNG (MT19937, set.seed, sample.int "Rejection")
  │          run inside a Web Worker pool; bootstrap draws fitted in parallel,
  │          resampling indices generated in one sequential stream
  └─ exports: R script (cSEM / lavaan) + exact analysis matrix, Python script, notebooks

Verification only (developer machines and CI, never deployed):
  services/r-engine (cSEM 0.7.1, lavaan 0.7-3)  ──▶  packages/fixtures/reference-results/*.json
  The browser engine must reproduce these references before a capability is offered.
```

Decisions and their reasons:

- **Browser engine, R as oracle.** The statistical algorithms are re-implemented from their
  published definitions and the packages' documented behaviour. Correctness is not assumed:
  every capability is `planned` for engine `browser` until its tests reproduce the R
  reference results (PLS to ~1e-10, CB-SEM ML to ~1e-6), and the registry records the
  evidence.
- **Reproducibility across languages.** Point estimates are deterministic. The bootstrap is
  defined as `set.seed(seed, "Mersenne-Twister", "Inversion", "Rejection")` followed by
  `sample.int(n, n, replace = TRUE)` per draw, in order, with a full re-estimation; the
  browser implements R's generator bit-exactly, so an exported R script draws the same rows
  and reproduces the app's intervals.
- **Privacy is structural.** Row-level data never leave the browser; there is no upload path.
- **Licensing.** The browser engine is SEM Studio's own code (no GPL code is bundled). GPL R
  packages are used only by the verification oracle and by scripts users run themselves.
- **Performance.** Bootstrap draws run in a Web Worker pool sized to the device's cores;
  cancellation stops between draws; progress counts real completed draws.

## 4. Contracts

- Source of truth: Zod schemas in `packages/contracts/src`. JSON Schema is emitted into
  `packages/contracts/schema/*.json` by a script and committed.
- The Python engine (`packages/python-engine`) produces the same JSON shapes and is tested against the same references.
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
Python verification scripts run with `uv run` inside `services/python-spike`; the Python engine inside `packages/python-engine`.

## 6. Ownership map (who may change what)

| Area | Path | Owner role (PLAN §6.1) |
|---|---|---|
| Contracts, registry, hashing | `packages/contracts`, `packages/method-registry` | Agent 1 — one writer at a time |
| Theme tokens | `apps/web/src/styles/tokens.css` | Agent 1/2 — one writer at a time |
| Modeler, layout, diagram export | `apps/web/src/features/modeler` | Agent 2 |
| Data Lab, validator | `apps/web/src/features/{data-lab,validation}` | Agent 3 |
| PLS engine | `services/r-engine/R/pls_*`, fixtures for PLS | Agent 4 |
| Browser engine (PLS, CB), Python engine, code export | `packages/engine`, `packages/python-engine`, `apps/web/src/features/code-export` | Agents 4–5 |
| Results, tables, clipboard, IPMA UI | `apps/web/src/features/{results,ipma,reports}` | Agent 6 |
| Learn, challenges, notebooks | `content/`, `notebooks/`, `apps/web/src/features/{learn,challenges,examples}` | Agent 7 |
| CI, deployment, security | `.github`, `netlify.toml`, Dockerfiles, `docs/{deployment,security-and-privacy}` | Agent 8 |

Evidence for every completed phase is recorded in `docs/validation/phase-N.md`.
