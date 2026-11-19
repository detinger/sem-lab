# Phase 2 — Data Lab and model validator: evidence and exit review

> **Superseded in Phase 4.** The product owner moved estimation into the browser; the FastAPI service (`apps/api`) and the server deployment described here were removed (they remain in git history). The R engine continues as the verification oracle. See `docs/architecture/overview.md` §3.

Date: 2026-11-19. Runs entirely in the browser; data never leave it in this phase.

## Exit criterion (PLAN §5)

> User can map a real/synthetic CSV, identify broken specifications and prevent invalid
> analysis runs.

**Met.** Demonstrated by `apps/web/e2e/data-lab.spec.ts` (Chrome) and the Data Lab RTL tests:
load a bundled synthetic dataset → map it to a model (exact matches suggested, ambiguous names
left unbound) → readiness lists issues by severity; the broken-mapping fixture produces
`DATA_COLUMN_MISSING` naming exactly `pu5, bi_4`, the "analysis is blocked" message, and the
same issue in the Modeler's Check panel with "Focus element". The Run button that obeys
`hasBlockingIssues()` arrives with the Analysis page (Phase 3); the gate itself exists and is
tested.

## Checklist

- [x] CSV parser, type discovery, preview and statistics — `src/domain/dataset/{parse,typing,stats}.ts`
- [x] Indicator mapping and scale metadata, including reverse-coded fields — `mapping.ts`,
      Data page mapping section (bulk endpoint editing, undoable through the modeler store)
- [x] Readiness validator for PLS and CB with severity and explanation — `src/domain/validation/validate.ts`
- [x] Private data persistence (IndexedDB `datasets` table, original stored, typed columns
      recomputed on load); explicit server upload flow: the API now exists
      (`apps/api`) but the web app does not upload anything until Phase 3's Run analysis
      action with its disclosure
- [x] Synthetic teaching datasets bundled (14 cases, labelled SYNTHETIC) plus ACSI 2015 with
      its CC BY 4.0 attribution; the five datasets with unverified terms are not bundled

## PLAN §2.2 acceptance criteria

| Criterion | Evidence |
|---|---|
| Quoted CSV, different separators, missing values, numeric mapping, reverse-scored items work | `parse.test.ts` (BOM, quoted delimiter/newline, `;` `,` tab `|`, decimal comma, NA tokens, ragged rows, duplicate headers), `typing.test.ts`, `transform.test.ts` (x3_rev of `pls-two-construct` reproduced exactly), `mapping.test.ts`, `analysis-data.test.ts` |
| Data changes invalidate stale analysis runs | Projects store the dataset **fingerprint**; re-importing different data shows "differs" and does not silently relink. Runs do not exist yet — Phase 3 records the fingerprint on every run and marks mismatches historical |
| IPMA cannot run until original scale endpoints are specified | validator `IPMA_SCALE_MISSING` (error) and the Data page callout; endpoints are never inferred from observed values |

## Numerical evidence

Descriptive statistics reproduce SmartPLS's stored values for every column of all six sample
datasets (tolerance 1e-9 relative; observed max relative deviation ≈ 1e-12; median, min, max,
n exact). Only ACSI runs in CI; the other five skip there because their CSVs are git-ignored
for licensing reasons.

The validator's CB degrees-of-freedom count reproduces the fixture truths derived independently
by the fixture generator (tam-mediation-exact df = 41, cfa-two-factor-exact df = 19,
cfa-one-factor df = 5, cb-heywood-exact df = 0). The count is presented as a necessary
condition for identification only.

## Privacy

- Row-level data stay in IndexedDB; project files carry only `DatasetRef` (fingerprint + column
  schema).
- No module in `domain/dataset` calls `console.*`; error messages carry column names and row
  numbers, never cell values (`privacy.test.ts`).

## Decisions

- **Parse as strings, type columns ourselves.** papaparse's `dynamicTyping` would silently
  leave decimal-comma numbers as text; a column is numeric only if every non-missing cell
  parses under the chosen decimal mark. A stray text value keeps the column as text with
  examples — the app never lets an engine treat text as ordinal (cSEM would, silently).
- **Both standard deviations, labelled.** Sample SD (n − 1) is shown by default; population SD
  (what SmartPLS stores) is one click away, with the difference explained.
- **Transformations never modify the original;** the log is replayed on every load.
- **Validator severities are conservative:** errors only where estimation is impossible or
  meaningless (or a capability is not verified); sample size is a recommendation to run a power
  analysis, never a "10-times rule".

## Test totals at the end of the phase

Web 477 unit tests, contracts 54, registry 67, browser 27 (modeler, shell, Data Lab). All root
scripts pass. Main JS chunk reduced from 2.29 MB to 348 kB by lazy-loading ELK and page routes.

## Known limitations

- Drag-and-drop import is not covered by an automated test (the file input is).
- `listDatasets` reads whole records to list metadata (fine at current sizes).
- The registry → capability mapping used by the validator is duplicated in the API; it will move
  into the registry as data (Phase 3).
- The TAM template's indicator names match the SmartPLS TAM sample, which is not bundled (terms
  unverified); bundled synthetic cases use their own names.
