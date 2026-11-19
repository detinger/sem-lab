# SEM Studio R engine (`r-csem`)

PLS-SEM (classic) and PLSc estimation with cSEM, run as a separate process on a job
directory. Method statement: `docs/estimators/pls-csem.md`. Protocol:
`docs/architecture/engine-protocol.md`.

## Layout

```text
bin/rscript        Rscript launcher (project library r-lib first, OMP_NUM_THREADS=1)
bin/run-job        entry point: run-job <job-dir>  (execs bin/rscript R/main.R)
bin/test           test runner (testthat)
R/main.R           sources the modules, calls run_job(), sets the exit status
R/run_job.R        orchestration, result assembly, warnings, provenance
R/job_io.R         progress.ndjson, atomic result.json, JSON encoding, cancel flag
R/job_errors.R     stable error codes, sanitized messages
R/job_validate.R   request.json validation, data.csv parsing and checks
R/registry.R       capability-registry gate (packages/method-registry/registry.json)
R/model_graph.R    cycle detection, directed-path enumeration
R/pls_alias.R      C1..Ck / X1..Xp aliases and cSEM syntax (no user text in code)
R/pls_estimate.R   csem() options and calls, convergence, verify(), rho_A fit
R/pls_results.R    parameters, effects, construct metrics, matrices, fit
R/pls_bootstrap.R  chunked seeded bootstrap with per-draw fallback
R/pls_ipma.R       IPMA (endpoint rescaling, classic refit, importance/performance)
tests/             testthat suite + validate-result.mjs (ajv schema check)
spike/             Phase 0 scripts (not used by the engine)
```

## Run a job by hand

```sh
mkdir -p /tmp/job1
cp packages/fixtures/synthetic/tam-mediation/data.csv /tmp/job1/data.csv
cat > /tmp/job1/request.json <<'EOF'
{ "protocolVersion": 1, "jobId": "job1",
  "model": <contents of packages/fixtures/synthetic/tam-mediation/model.json>,
  "analysis": { "method": "pls-sem", "engine": "r-csem", "estimator": "pls-pm",
                "missingData": "listwise", "seed": 20261119,
                "pls": { "innerWeighting": "path", "maxIterations": 300, "tolerance": 1e-7 },
                "bootstrap": { "enabled": true, "repetitions": 1000, "ci": "percentile",
                               "confidenceLevel": 0.95, "sides": "two-sided" } },
  "limits": { "maxBootstrap": 10000, "timeoutSeconds": 1800 } }
EOF
services/r-engine/bin/run-job /tmp/job1 2> /tmp/job1/engine.log
cat /tmp/job1/progress.ndjson
node services/r-engine/tests/validate-result.mjs /tmp/job1/result.json   # schema check
```

`touch /tmp/job1/cancel` while it runs stops it before the next bootstrap chunk.

## Protocol summary

- In: `request.json` (`protocolVersion` 1, `model` = SemModel, `analysis` =
  AnalysisConfiguration, `limits.maxBootstrap`, `limits.timeoutSeconds`, optional
  `limits.chunkSize`, default 100) and `data.csv` (UTF-8, comma, header, empty = missing).
- Out: `progress.ndjson` (one flushed line per event: `validating`, `estimating`,
  `bootstrapping` with `done/total/failed/inadmissible` after each chunk, `summarizing`)
  and `result.json`, written to `result.json.tmp` then renamed:
  `{"ok": true, "result": NormalizedSemResult}` or
  `{"ok": false, "error": {"code", "message", "details"?}}`.
- IPMA: `analysis.ipma = {targetConstructId}` (classic `pls-sem` only, every indicator
  needs `scale: {min, max}`); adds `result.ipma` (see docs/estimators/pls-csem.md §5).
  Enabled only when the registry marks `ipma.construct` `beta`/`supported` for r-csem.
- Exit status 0 = result.json written (success or handled error); non-zero = crash.
- Error codes: `REQUEST_INVALID` (bad request, cycles, empty cells in mapped columns;
  IPMA: `details.reason` `ipma-target-unknown`, `ipma-no-predecessors`,
  `ipma-scale-missing`, `ipma-out-of-scale`),
  `DATA_COLUMN_MISSING`, `DATA_NOT_NUMERIC`, `DATA_INSUFFICIENT_ROWS` (< 3 rows),
  `DATA_ZERO_VARIANCE`, `MODEL_NOT_IDENTIFIED` (isolated construct, no structural path,
  collinear Mode B block), `ENGINE_NONCONVERGENCE`, `CAPABILITY_UNSUPPORTED` (anything the
  registry does not mark `supported`/`beta` for r-csem), `CANCELLED`, `TIMEOUT`,
  `ENGINE_INTERNAL`. `ENGINE_INADMISSIBLE` is not used: an inadmissible original estimate
  is returned with `estimation.admissible = false` and a warning.
- stderr (the API's `engine.log`) and error messages contain ids, column names and counts,
  never data values.
- Environment: `SEM_STUDIO_REGISTRY` overrides the registry path (default
  `packages/method-registry/registry.json` relative to the repository).

## Tests

```sh
services/r-engine/bin/test                # all (~80 s)
services/r-engine/bin/test bootstrap      # one file
# equivalent:
services/r-engine/bin/rscript -e 'testthat::test_dir("services/r-engine/tests/testthat")'
```

Schema validation uses `node` and the ajv installed for `packages/contracts`
(`npm install` at the repository root); without them the schema checks are skipped.
The tam-v1 parity tests need the git-ignored `TEMP/Example - TAM/Data.txt` and are skipped
without it.
