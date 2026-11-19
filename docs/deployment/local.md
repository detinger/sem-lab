# Running the API locally

## Without Docker (the verified path)

```bash
cd apps/api
uv sync                       # Python 3.12 + pinned dependencies (uv.lock)
uv run pytest                 # tests use a fake engine; R is not required
APP_ENV=development ALLOWED_ORIGINS=http://localhost:5173 \
  uv run uvicorn app.main:app_factory --factory --reload --port 8000
```

Then `npm run dev` in `apps/web` (its `.env` points at `http://localhost:8000`).

R engine: install the locked packages once with `services/r-engine/scripts/install_packages.R`
(through `services/r-engine/bin/rscript`). The API starts jobs with
`services/r-engine/bin/run-job <job-dir>`; override with `ENGINE_R_COMMAND` (a command line, split
shell-style, never executed through a shell). `GET /api/health` lists which engines were actually
probed as available. Until `run-job` exists, R engines are reported unavailable and jobs fail with
`ENGINE_INTERNAL`.

Job data lives in `DATA_DIR` (default `./.sem-studio-data`, git-ignored): `jobs.sqlite3` plus
`jobs/<id>/`. Delete the directory to reset everything; `DELETE /api/analysis/jobs/{id}` removes one job.

## With Docker (not verified on the development machine: Docker is not installed there)

```bash
docker compose up --build     # API on http://localhost:8000, data in the `sem-data` volume
```

The image is built from the repository root (`apps/api/Dockerfile`).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `APP_ENV` | `production` | `development` enables `/api/docs` and `GET /api/analysis/jobs/{id}/engine-log` |
| `ALLOWED_ORIGINS` | empty | comma list of browser origins allowed by CORS (none by default) |
| `DATA_DIR` | `./.sem-studio-data` | SQLite job store and job directories |
| `DATA_RETENTION_HOURS` | `24` | jobs (and their uploaded CSV) older than this are deleted by the sweeper |
| `MAX_CSV_MB` | `25` | upload size limit (413 above it) |
| `MAX_ROWS` / `MAX_COLUMNS` | `200000` / `500` | CSV shape limits (422) |
| `MAX_BOOTSTRAP_REPS` | `10000` | bootstrap repetition cap (422) |
| `MAX_CONCURRENT_JOBS` | `2` | engine processes at once; others stay `queued` |
| `MAX_QUEUED_JOBS` | `20` | further submissions get 503 `QUEUE_FULL` |
| `JOB_TIMEOUT_SECONDS` | `1800` | wall-clock limit per job (`TIMEOUT`) |
| `CANCEL_GRACE_SECONDS` | `10` | SIGTERM to SIGKILL grace |
| `RATE_LIMIT_JOBS_PER_MINUTE` | `10` | per-IP job creation limit, in memory, per API instance (0 = off) |
| `TRUST_PROXY_HEADERS` | off | use the first `X-Forwarded-For` entry as the client IP (only behind a trusted proxy) |
| `ENGINE_R_COMMAND` | `services/r-engine/bin/run-job` | engine entry point |
| `ENGINE_RSCRIPT_COMMAND` | wrapper next to the engine, else `Rscript` | used only by the health probe |
| `REGISTRY_PATH` | `packages/method-registry/registry.json` | capability registry served and enforced |
