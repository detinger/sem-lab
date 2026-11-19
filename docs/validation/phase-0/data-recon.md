# Phase 0: sample data reconnaissance

Written by the architect from the evidence the data agent produced before it was stopped
(`docs/validation/phase-0/evidence/data/`) and from the fixtures it built
(`packages/fixtures/third-party/smartpls-samples/`). Every number below is quoted from
those files.

## Inventory (`inventory.json`, `structural-path-search.json`)

Five SmartPLS 4 sample folders in `TEMP/`: ACSI, OI, Regression (two datasets), TAM, UTAUT.

- `*.splsm / .splscb / .splspm / .splsge / .splsrm` are encrypted project files. They were
  not opened, decoded or reverse-engineered.
- `*.txt` data files and the plain-JSON `*.settings` / `*.ok` side files were read.
- `*.splsm.settings → plsAlgorithmSettings.initialWeights` lists every indicator →
  construct assignment.
- **No structural path information exists in plain form** (searched every plain JSON file).
  Structural models for the examples are therefore SEM Studio's own specifications from the
  published theory (`proposed-model.json`, status "proposal").

## Parsing facts (`parsing-facts.json`)

| File | Rows × columns | Delimiter | Missing values | Notes |
|---|---|---|---|---|
| TAM `Data.txt` | 1190 × 22 | `;` | none | 44 duplicate rows |
| UTAUT `Data.txt` | 722 × 21 | `;` | none | 1 duplicate row |
| OI `Data.txt` | 305 × 25 | `;` | none | 2 duplicate rows; `*_rev` columns are 6 − item |
| ACSI `ACSI Data 2015.txt` | 8239 × 29 | `;` | 53,925 empty fields | `YEAR` is constant; 20 duplicate rows |
| Concise guide | 1065 × 11 | `;` | 158 empty fields | `commitment` has fractional values |
| HBAT | 100 × 24 | `;` | none | x6–x22 fractional |

All files: ASCII, no BOM, header row, `.` decimal separator, every value written with 12
fraction digits (`7.000000000000`), no non-numeric cells, row count equals the `.ok` case
count. Missing values are physically **empty fields**; no sentinel value is used and
`missingValue` in the settings is `null`.

Duplicate rows are recorded, not removed: in survey data identical response patterns are
plausible and deleting them would be an undisclosed data change.

## Descriptive statistics conventions (`descriptives-check.json`)

The statistics SmartPLS stores per column were recomputed from the converted CSV files.
**All 132 columns match** with these conventions (maximum absolute deviation in brackets):

| Statistic | Convention that reproduces the stored value | Max \|Δ\| |
|---|---|---|
| mean, min, max | ordinary | 5e-14 |
| median | **upper** median (the higher middle value for even n), not the average of the two | 0 (average would differ by up to 0.5 in 7 columns) |
| standard deviation | **population** (divisor n), not sample (n − 1) | 4e-12 |
| skewness | adjusted Fisher–Pearson **G1** (as Excel/SPSS, `scipy.stats.skew(bias=False)`) | 3e-13 |
| kurtosis | adjusted **excess** kurtosis **G2** (`scipy.stats.kurtosis(bias=False)`) | 2e-12 |
| `cramerVanMises` | p-value of a Cramér–von Mises normality test with mean and population SD estimated | 1e-14 (W statistic cross-checked with scipy) |

Library cross-check: the script's own formulas agree with numpy/pandas/scipy to ≤ 3e-14.
These conventions become the Data Lab's reference tests (Phase 2). SEM Studio will label
which SD it shows rather than silently copy SmartPLS's choice.

## Scale endpoints

`scaleInformation.minValue/maxValue` in the settings equal the **observed** minimum and
maximum of each column, so they are not evidence of the instrument's permissible endpoints.
This matters for IPMA, which needs the original endpoints. For the TAM data the observed
ranges are 1–7 for most items, **1–6 for USE1–USE3 and 1–11 for USE4**. Whether those are
the questionnaire's actual endpoints must be confirmed by the user in the Data Lab; the app
never infers endpoints from observed values (STYLE §11).

## Fixtures and provenance

Built by `packages/fixtures/scripts/build_third_party.py` (deterministic; manifests carry
sha256 hashes; checked again by the architect on 2026-11-19). Redistribution status per
dataset: `packages/fixtures/third-party/smartpls-samples/PROVENANCE.md`. Only `acsi-2015`
(CC BY 4.0, Mendeley Data doi:10.17632/64xkbj2ry5.2, licence confirmed on the deposit page)
may ship in a public build; the other five are local fixtures until their terms are cleared.

## Not done

The data agent's part F (proposed structural models) exists only as `proposed-model.json`
files with status `proposal-awaiting-architect-approval`; the citations in them were
entered without opening the primary articles and must be checked before the examples ship.
