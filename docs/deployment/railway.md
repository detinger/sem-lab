# Deploying the API on Railway

Status: written, **not yet exercised on Railway** (no Docker or Railway access on the development
machine). The first deploy is its verification; the checklist at the end is what to look at.

## Service

1. New service from the GitHub repo. Settings, Build: builder `Dockerfile`, Dockerfile path
   `apps/api/Dockerfile`, **root directory = repository root** (the image needs `services/r-engine`,
   `packages/method-registry` and `apps/api`). Or set `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`.
2. Add a **Volume** mounted at `/data` (job store and uploaded datasets). Without it every redeploy
   loses all jobs. Railway mounts volumes root-owned while the image runs as a non-root user, so set
   `RAILWAY_RUN_UID=0` on the service (or give the volume to uid 10001 by other means) or the API
   cannot write `/data`.
3. Health check path: `/api/health` (timeout 60 s or more: the first call probes R once, then caches 5 min).
4. Run a **single replica**. Job state, the concurrency limit and the rate limiter are per process;
   two replicas would share neither and would also fight over the volume.
5. Networking: public domain for the API, or a private domain if the web app proxies to it.

## Environment variables

```env
APP_ENV=production
ALLOWED_ORIGINS=https://<your-netlify-site>.netlify.app,https://<custom-domain>
DATA_DIR=/data                      # already the image default
DATA_RETENTION_HOURS=24
MAX_CSV_MB=25
MAX_BOOTSTRAP_REPS=10000
MAX_CONCURRENT_JOBS=2
JOB_TIMEOUT_SECONDS=1800
TRUST_PROXY_HEADERS=true            # Railway terminates TLS in front of the container; needed for per-IP limits
RAILWAY_RUN_UID=0                   # see the volume note above
```

The browser app uses `VITE_API_BASE_URL` at build time on Netlify. `ALLOWED_ORIGINS` must contain the
exact origin (scheme + host, no path, no trailing slash). No secrets are needed by the API.

## Sizing guidance (starting points to be measured, not benchmarks)

- Each running job is one R process (single-threaded BLAS by design, bootstrap workers may add more).
  Plan about 1 vCPU and 1-2 GB RAM per concurrent job; `MAX_CONCURRENT_JOBS=2` therefore wants
  roughly 2 vCPU / 4 GB. SEM matrices are small; memory is dominated by R itself, the data frame
  (25 MB CSV is a few hundred MB in R) and bootstrap draws.
- Raise `MAX_CONCURRENT_JOBS` only together with CPU/RAM. Excess jobs wait as `queued`
  (up to `MAX_QUEUED_JOBS`, then 503).
- Volume: size for `MAX_CSV_MB x (jobs retained)`; with the 24 h default a few GB is plenty.

## Retention and privacy

- A sweeper deletes job directories and rows older than `DATA_RETENTION_HOURS` (every 10 minutes and at start-up).
- `DELETE /api/analysis/jobs/{id}` removes a job and its uploaded CSV immediately (the web app's
  "Delete uploaded data and jobs").
- Uploaded rows are written only to `/data/jobs/<id>/data.csv`; request bodies and CSV content are never
  logged, and error responses carry codes, column names and counts only. `engine.log` is not served
  unless `APP_ENV=development`.

## First-deploy checklist

- [ ] Build succeeds (R package restore from `renv.lock`; add missing system libraries to the Dockerfile if not).
- [ ] `GET /api/health` lists `r-csem` (and `r-lavaan`) with `available: true` and versions.
- [ ] Redeploy keeps previously created jobs (volume works, `RAILWAY_RUN_UID` correct).
- [ ] A browser request from the Netlify origin passes CORS; another origin does not.
- [ ] The reference TAM analysis returns the same numbers as locally.
