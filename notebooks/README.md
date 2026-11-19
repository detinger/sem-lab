# SEM Lab Colab notebooks

Five self-contained teaching notebooks (PLAN §2.10). Each one generates its own **synthetic**
data, draws the model from SEM Lab's canonical model file, estimates it with SEM Lab's own
engine (the Python port, `semlab_bundle.py`, embedded in the notebook), interprets every
result, and exports CSV tables, PNG figures and Word-ready tables.

| Notebook | Model | Method | Fixture / app example |
|---|---|---|---|
| [`01_tam_pls_sem.ipynb`](colab/01_tam_pls_sem.ipynb) | Technology Acceptance Model (PEOU → PU → BI) | PLS-SEM, bootstrap, mediation | `tam-mediation` |
| [`02_acsi_pls_sem.ipynb`](colab/02_acsi_pls_sem.ipynb) | Customer satisfaction model inspired by the ACSI (10-point items) | PLS-SEM, Mode A vs Mode B, IPMA | `acsi-inspired` |
| [`03_delone_mclean_is_success_pls_sem.ipynb`](colab/03_delone_mclean_is_success_pls_sem.ipynb) | IS success, inspired by DeLone & McLean | PLS-SEM, discriminant validity, specific indirect effects, IPMA | `delone-mclean` |
| [`04_utaut2_pls_sem.ipynb`](colab/04_utaut2_pls_sem.ipynb) | Technology adoption inspired by UTAUT2 | PLS-SEM, nine hypothesis tests incl. a non-significant one | `utaut2-inspired` |
| [`05_service_quality_cb_sem.ipynb`](colab/05_service_quality_cb_sem.ipynb) | Service quality → satisfaction → loyalty | CB-SEM (ML, MLR), CFA, global fit, PLS vs CB estimands, optional semopy cross-check | `service-quality` |

All data are SYNTHETIC teaching data generated from stated population models; none of them
represents a real study, and the ACSI-inspired notebook does not use ACSI data.

## Opening the notebooks

**Google Colab.** Open a notebook straight from GitHub and choose *Runtime → Run all*:

- [01_tam_pls_sem.ipynb](https://colab.research.google.com/github/detinger/sem-lab/blob/main/notebooks/colab/01_tam_pls_sem.ipynb)
- [02_acsi_pls_sem.ipynb](https://colab.research.google.com/github/detinger/sem-lab/blob/main/notebooks/colab/02_acsi_pls_sem.ipynb)
- [03_delone_mclean_is_success_pls_sem.ipynb](https://colab.research.google.com/github/detinger/sem-lab/blob/main/notebooks/colab/03_delone_mclean_is_success_pls_sem.ipynb)
- [04_utaut2_pls_sem.ipynb](https://colab.research.google.com/github/detinger/sem-lab/blob/main/notebooks/colab/04_utaut2_pls_sem.ipynb)
- [05_service_quality_cb_sem.ipynb](https://colab.research.google.com/github/detinger/sem-lab/blob/main/notebooks/colab/05_service_quality_cb_sem.ipynb)

Nothing else is needed: the notebook writes the engine file and generates its data itself,
needs no Google Drive, no uploads and no tokens, and installs nothing that Colab does not
already have (05 optionally installs `semopy` for its cross-check). Alternatively download a
file from `notebooks/colab/` and use *File → Upload notebook* in Colab.

**Locally (Jupyter).**

```sh
cd notebooks
uv sync                                    # Python 3.12 + the pinned test environment (uv.lock)
uv run --with jupyterlab jupyter lab colab/
```

## What a notebook contains

1. Title, attribution, learning objectives, theory and illustrative hypotheses.
2. Dependencies: a version check against the engine's minimums (numpy ≥ 1.22.4, scipy ≥ 1.12)
   instead of reinstalling Colab's preinstalled packages, which would force a runtime restart.
   The exact tested versions are listed and can be installed outside Colab.
3. The engine as a collapsed form cell (`%%writefile semlab_bundle.py`) followed by a SHA-256
   check against `packages/python-engine/dist/semlab_bundle.py`.
4. The generator code, extracted from `packages/fixtures/scripts/generate_synthetic.py`, run with
   the fixture's seed and N; the CSV's SHA-256 must equal the fixture manifest's, so the notebook
   and the SEM Lab app example use byte-identical data. The population model is shown.
5. Indicator dictionary, descriptives and response distributions.
6. The model figure, drawn from the canonical `model.json` (layered left to right; reflective
   arrows construct → indicator, composite arrows indicator → construct).
7. Estimation, quality criteria, structural results with seeded bootstrap intervals (PLS),
   effects, IPMA (02, 03) or CFA / global fit / estimand comparison (05), each followed by an
   interpretation with caveats.
8. Export (CSV, PNG, `tables_word.html`, full `result.json`, zipped; auto-download on Colab).
9. Summary questions and two challenges.

**Bootstrap.** The PLS notebooks use B = 5,000 draws with the app example's seed. The app's
TAM and D&M examples open with B = 1,000 for speed: point estimates are identical, and the same
seed with 5,000 draws in the app gives exactly the notebook's intervals (SEM Lab's bootstrap
draws the same resamples in the browser, in Python and in R).

**Runtimes** (whole notebook, headless, Apple M-series laptop; the PLS estimation cell with
B = 5,000 is most of it): 01 ≈ 6 s, 02 ≈ 9 s, 03 ≈ 9 s, 04 ≈ 9 s, 05 ≈ 4 s (plus the optional
semopy install on Colab). These were not timed on Colab; a free Colab CPU can be a few times slower.

## Editing and regenerating

Never edit the `.ipynb` files. Their sources are:

- `src/NN_*.md` — one file per notebook; cells separated by `%% markdown`, `%% code`,
  `%% form <title>`, `%% include <shared>`, `%% engine`, `%% helpers`, `%% generator [names]`;
- `src/shared/*.md` — cells shared by several notebooks (setup, data, model, estimation, export);
- `src/sem_helpers.py` — figure, table and export helpers (embedded as a collapsed cell);
- the engine bundle, the generator and the fixture files, embedded at build time.

```sh
uv run --project notebooks python notebooks/build_notebooks.py            # rebuild
uv run --project notebooks python notebooks/build_notebooks.py --check    # CI: fails if stale
cd notebooks && uv run pytest -q                                          # execute and verify
```

Rebuild after changing the engine bundle (`packages/python-engine/scripts/bundle.py`), the
generator or a fixture; `--check` fails otherwise.

## Tests

`notebooks/tests` executes every notebook headless with nbclient in a fresh temporary directory
(Python 3.12 and the versions locked in `uv.lock`: current numpy, scipy, pandas, matplotlib;
semopy pinned for 05's optional cross-check) and checks that

- no cell raises; the data SHA-256, the engine file and `model.json` equal the fixture and the
  committed bundle;
- the exported `result.json` equals the `semlab` package's result on the fixture files
  (1e-12 relative) and the analysis equals the app example's (except the number of bootstrap
  draws) or the fixture's browser analysis;
- the statements in the interpretation cells hold (e.g. which paths are significant, the IPMA
  ordering, the fit of the one-factor model, the semopy agreement);
- the built notebooks are current and contain no Open-in-Colab links, no `!pip` and no
  reinstall of Colab's core packages.

CI runs the same (`.github/workflows/ci.yml`, job `notebooks`).
