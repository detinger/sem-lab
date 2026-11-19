# Engine job protocol

The API and an engine (R or Python) communicate through a **job directory**. Nothing
else crosses the boundary: no shared memory, no sockets, no code strings.

```text
<data-dir>/jobs/<jobId>/
├── request.json      written by the API before the engine starts (immutable)
├── data.csv          the dataset as uploaded for this job (UTF-8, comma, header, empty = missing)
├── progress.ndjson   appended by the engine, one JSON object per line
├── result.json       written by the engine atomically (write to result.json.tmp, then rename)
├── engine.log        engine stdout/stderr (technical panel only; must not contain data rows)
└── cancel            empty file created by the API to request cooperative cancellation
```

## request.json

```jsonc
{
  "protocolVersion": 1,
  "jobId": "…",
  "model": { /* SemModel, already validated */ },
  "analysis": { /* AnalysisConfiguration */ },
  "limits": { "maxBootstrap": 10000, "timeoutSeconds": 1800 }
}
```

The engine resolves each indicator to its bound `column` in `data.csv`. Column names and
construct names are **data**: an engine builds model syntax only through its own quoting
helper and must reject any name it cannot represent safely instead of interpolating it.

## progress.ndjson

One line per event, flushed immediately:

```json
{"t":"2026-11-19T12:00:00Z","stage":"validating"}
{"t":"…","stage":"estimating"}
{"t":"…","stage":"bootstrapping","done":200,"total":2000,"failed":0,"inadmissible":1}
{"t":"…","stage":"summarizing"}
```

`stage` ∈ `validating | estimating | bootstrapping | summarizing`. `done/total` appear only
when the engine actually knows them. The API reports exactly what is here; it never
interpolates a percentage.

## result.json

Either a result or an error — never both, never partially written:

```jsonc
{ "ok": true,  "result": { /* NormalizedSemResult */ } }
{ "ok": false, "error": { "code": "ENGINE_NONCONVERGENCE", "message": "…", "details": { } } }
```

Stable error codes: `REQUEST_INVALID`, `DATA_COLUMN_MISSING`, `DATA_NOT_NUMERIC`,
`DATA_INSUFFICIENT_ROWS`, `DATA_ZERO_VARIANCE`, `MODEL_NOT_IDENTIFIED`,
`ENGINE_NONCONVERGENCE`, `ENGINE_INADMISSIBLE`, `CAPABILITY_UNSUPPORTED`, `CANCELLED`,
`TIMEOUT`, `ENGINE_INTERNAL`.

## Job lifecycle (API side)

`queued → validating → estimating → bootstrapping → summarizing → complete | failed | cancelled`

- State lives in SQLite (`jobs` table) keyed by `jobId`; the directory holds the payloads.
- A job whose process is gone without a `result.json` is marked `failed` with
  `ENGINE_INTERNAL` on the next status read or at API start-up. It never shows as complete.
- Cancellation: the API creates `cancel`, sends SIGTERM to the process group, and after a
  grace period SIGKILL. A cancelled job has no result.
- Retention: a sweeper deletes job directories and rows older than `DATA_RETENTION_HOURS`;
  `DELETE /api/analysis/jobs/{id}` deletes immediately.

## Bootstrap chunking

The engine draws bootstrap replications in chunks of `chunkSize` (default 100). Chunk *k*
uses seed `seed + k`. Raw draws from all completed chunks are concatenated; confidence
intervals are computed once at the end from the concatenated draws. Consequences that are
part of the contract:

- same `seed`, `repetitions`, `chunkSize`, model, data and package versions ⇒ identical
  draws and identical intervals;
- changing `chunkSize` changes the draws (documented, and `chunkSize` is recorded in the
  result);
- replications that fail or are inadmissible are counted separately and excluded from the
  intervals; the result reports `requested`, `completed`, `failed`, `inadmissible`.
