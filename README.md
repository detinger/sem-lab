# SEM Lab

**A structural equation modeling workspace that runs entirely in your browser.**

Load a dataset, draw your model, estimate it, and get tables and figures you can use in a
paper. SEM Lab supports PLS-SEM and CB-SEM. You don't install anything, there's no account,
and your data never leave your computer.

It is built for researchers, students and teachers. You can use it to run a real analysis
or to learn how SEM works with ready-made examples and lessons.

## What you can do

- **Import data.** Bring in a CSV or TSV file, then check variables, types and missing values.
- **Draw the model visually.** Drag data columns onto constructs to create indicators, then
  connect the constructs with paths. Automatic layout, grid snapping and alignment guides keep
  the diagram tidy.
- **Estimate it.**
  - PLS-SEM: PLS, consistent PLS (PLSc), Mode A/Mode B, bootstrap confidence intervals.
  - CB-SEM: ML, MLR and FIML for missing data.
  - IPMA (importance–performance map analysis).
- **Read the results.**
  - Measurement model: loadings, reliability, AVE, HTMT.
  - Structural model: path coefficients, R², and direct, indirect and total effects.
  - Global fit for CB-SEM.
  - A diagram of the estimated model, with path weights, significance stars and R²
    drawn in.
- **Report.** Copy tables into Word as editable tables, including APA style (no leading
  zero). Export the diagram as SVG or PNG.
- **Reproduce elsewhere.** Export a ready-to-run R script (cSEM or lavaan) or a Python
  script. Either one reproduces the app's results on your own machine.
- **Learn.** Open worked examples, Google Colab notebooks, lessons and challenges, including
  a lesson on path models and regression and a challenge where you build a path model from
  hypotheses.

## How to use it

1. **Data.** Import your CSV file. If you just want to look around, go to _Examples & Colab_
   and open a ready-made project instead.
2. **Modeler.** Create constructs and drag data columns onto them to make indicators. Draw
   paths between constructs. If the model has a problem, such as a construct with no
   indicators, the validator flags it before you run anything.
3. **Analysis.** Choose PLS-SEM or CB-SEM and set the options (estimator, bootstrap draws,
   and so on), then run. Estimation runs in your browser, and every run is saved in the run
   history.
4. **Results.** Go through the measurement model, the structural model and fit. Choose
   standardized or unstandardized estimates and the number of decimal places, then copy
   tables into Word. To show estimates, t-values, p-values or confidence intervals directly
   on the model, switch on the overlay in the Modeler.
5. **IPMA** (optional). Plot the importance of each predictor of a target construct against
   its performance.
6. **Export.** Download the diagram, the tables, or an R or Python bundle for your appendix
   or your co-authors.

Your projects are saved automatically in the browser. The theme button at the bottom of the
sidebar switches between light, dark and your system setting.

### Path models and regression

For path analysis (or a multiple regression drawn as a path model), drag data columns from
the left pane onto **empty canvas**. Each column becomes an observed variable, drawn as a box,
and you then draw arrows between the boxes. If you drop a column onto an existing construct
instead, it becomes one of that construct's indicators.

Any construct with a single indicator can be shown as a box. Use the checkbox in its
inspector, or with nothing selected, the "draw variables as boxes" option for the whole
model. Only the diagram changes; the estimates stay the same. In CB-SEM each box is treated
as measured without error, which is the classic path-analysis assumption. CB-SEM (ML)
then gives the same unstandardized coefficients as ordinary least squares, and PLS-SEM
gives the standardized regression coefficients and the same R². The regression examples
and the tests check this. For a regression the model is just-identified (df = 0), so its
global fit is perfect by construction and tells you nothing. A full regression toolkit
(intercepts, F tests, residual diagnostics) is out of scope. Dummy variables and
interaction terms work if you create them as columns in the data first.

### Examples and notebooks

| Example                                       | Method                                           |
| --------------------------------------------- | ------------------------------------------------ |
| Technology acceptance (TAM): mediation        | PLS-SEM, bootstrap, mediation                    |
| Customer satisfaction inspired by the ACSI    | PLS-SEM, Mode A vs Mode B, IPMA                  |
| ACSI 2015 (real survey data, CC BY 4.0)       | PLS-SEM                                          |
| Information systems success (DeLone & McLean) | PLS-SEM, discriminant validity, indirect effects |
| Technology adoption inspired by UTAUT2        | PLS-SEM, hypothesis testing                      |
| Service quality → satisfaction → loyalty      | CB-SEM (ML, MLR), CFA, global fit                |
| Study success: path analysis                  | CB-SEM path model of observed variables, df = 3  |
| Job demands and resources: path model         | PLS-SEM path model, two mediated processes       |
| House prices: multiple regression             | CB-SEM, slopes in EUR, a 0/1 dummy predictor     |
| Sleep quality: multiple regression            | PLS-SEM, standardized slopes, bootstrap CIs      |

Except for ACSI 2015, every example uses synthetic teaching data. The four path-model and
regression examples open with their variables drawn as boxes. Five of the examples also
come as Google Colab notebooks that run with a single _Run all_ and need no setup. Links are
in [`notebooks/README.md`](notebooks/README.md).

### Privacy

Everything happens in your browser. Models, data and results are stored locally
(IndexedDB) and are never uploaded. There is no server.

### Trustworthiness

Every estimation method is checked against reference results from established R packages
(cSEM, lavaan). A method is marked _supported_ only after the in-browser engine reproduces
those results. For each engine, the capability registry records what it can and can't do,
with evidence:
[`packages/method-registry/registry.json`](packages/method-registry/registry.json).

---

## For developers

### Status

| Phase   | Scope                                                                                                                            | State       | Evidence                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------- |
| 0       | Foundation, library verification, contracts, fixtures                                                                            | **Done**    | `docs/validation/phase-0.md` |
| 1       | Design system, visual modeler, persistence, diagram export                                                                       | **Done**    | `docs/validation/phase-1.md` |
| 2       | Data Lab (CSV import, mapping) and model validator                                                                               | **Done**    | `docs/validation/phase-2.md` |
| 3       | First PLS-SEM vertical slice (R/cSEM backend, bootstrap, Word tables, R export)                                                  | **Done**    | `docs/validation/phase-3.md` |
| 4       | In-browser engine (PLS, PLSc, Mode B, bootstrap, IPMA, CB-SEM ML/MLR/FIML), R and Python export bundles, Python engine, examples | **Done**    | `docs/validation/phase-4.md` |
| 6       | Five Colab notebooks (done: `notebooks/`); Learn levels and challenges                                                           | In progress | `notebooks/README.md`        |
| 5, 7, 8 | Remaining CB features, advanced methods, hardening                                                                               | Planned     | —                            |

The specifications are `PLAN.md` (product) and `STYLE.md` (design). This README describes
only features that the phase records in `docs/validation/` demonstrate.

### Architecture

Modeling, data handling, estimation and reporting all run in the browser, and there is no
backend. R and Python are offered as exported scripts and notebooks. The R engine in
`services/r-engine` is a verification oracle that is only used in development and CI
(`docs/architecture/overview.md` §3).

### Repository

```text
apps/web/                  React 19 + TypeScript + Vite single-page app (the modeler lives in src/features/modeler)
packages/engine/           in-browser estimation engine (TypeScript): PLS-PM, PLSc, CB-SEM ML/MLR/FIML, IPMA, bootstrap
packages/python-engine/    the same engine in Python (numpy/scipy), shipped with Python exports and notebooks
services/r-engine/         R verification oracle (cSEM, lavaan): produces the committed reference results
services/python-spike/     Phase 0 verification of plspm/semopy (evidence only)
packages/contracts/        Zod contracts (model, layout, analysis, results) → generated JSON Schema
packages/method-registry/  capability registry with evidence
packages/fixtures/         synthetic benchmark datasets + converted sample datasets with provenance
notebooks/                 five Google Colab notebooks (built by notebooks/build_notebooks.py) + execution tests
content/examples/          example projects shown on the Examples page
docs/                      architecture, validation evidence per phase, licensing, research notes
```

### Local development

Requirements: Node ≥ 22 (developed on 26) and npm. The engines also need R ≥ 4.6 and
[uv](https://docs.astral.sh/uv/) (Python 3.12).

```bash
npm ci
npm run dev            # http://localhost:5173
```

Quality gates. All of them must pass, and CI runs the same commands:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test           # web, contracts and registry unit tests
npm run build
npm run check-schema --workspace @sem-lab/contracts         # JSON Schema in sync with Zod
uv run --python 3.12 --with numpy python packages/fixtures/scripts/generate_synthetic.py --check
npm run e2e --workspace @sem-lab/web                         # browser tests (uses installed Google Chrome)
```

R engine. Packages are installed into `services/r-engine/r-lib`, never into the system library:

```bash
services/r-engine/bin/rscript services/r-engine/scripts/install_packages.R   # first time; compiles from source
services/r-engine/bin/rscript services/r-engine/spike/csem_01_pls_core.R      # example verification script
```

Python engine and notebooks:

```bash
cd packages/python-engine && uv run pytest
cd notebooks && uv run python build_notebooks.py && uv run pytest   # regenerate from notebooks/src, run all five
```

### Deployment

The site is deployed on Netlify. `netlify.toml` builds `apps/web` and serves it as an SPA
with a deep-link fallback. There is no server: the former API and R worker were removed in
Phase 4, when estimation moved into the browser. They remain in the git history.

### Sample data and licence

Sample data provenance is in
`packages/fixtures/third-party/smartpls-samples/PROVENANCE.md`. Only the ACSI 2015 dataset
(CC BY 4.0) may be redistributed. The other datasets are kept on the owner's machine only
and are git-ignored.

SEM Lab is released under the MIT licence; see `LICENSE`. Third-party components keep their
own licences (`THIRD_PARTY_NOTICES.md`). Details are in `docs/licensing.md`.
