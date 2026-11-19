# SEM Studio API

FastAPI service that runs SEM jobs through engines using the job-directory protocol
(`docs/architecture/engine-protocol.md`).

```bash
uv sync && uv run pytest            # fake engine; R not required
uv run ruff check && uv run ruff format --check
APP_ENV=development uv run uvicorn app.main:app_factory --factory --port 8000
```

Layout: `app/contracts` (Pydantic mirror of `packages/contracts`), `app/canonical.py` (canonical JSON / model
hash identical to `hash.ts`), `app/store.py` (SQLite + job dirs), `app/runner.py` (subprocess runner),
`app/jobs.py` (lifecycle), `app/main.py` (endpoints). `spike/` is the frozen Phase 0 evidence.
Deployment: `docs/deployment/`. Configuration: `docs/deployment/local.md`.

Endpoints: `GET /api/health`, `GET /api/capabilities`, `GET /api/examples`, `POST /api/models/validate`,
`POST /api/analysis/jobs` (multipart: `request` JSON `{model, analysis}` + `data` CSV),
`GET|DELETE /api/analysis/jobs/{id}`, `POST /api/analysis/jobs/{id}/cancel`, `GET /api/analysis/jobs/{id}/result`,
`POST /api/export/code` (501).
