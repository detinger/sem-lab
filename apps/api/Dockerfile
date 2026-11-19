# SEM Studio API image: FastAPI + the R engine in one container.
#
# Build from the REPOSITORY ROOT (the engine, the registry and renv.lock live outside apps/api):
#   docker build -f apps/api/Dockerfile -t sem-studio-api .
#
# NOTE: this file could not be built where it was written (no Docker on the development machine).
# Treat the first CI/Railway build as its verification. Known things to confirm on that build:
#   * the rocker/r-ver tag exists for the R version pinned in services/r-engine/renv.lock (4.6.2);
#   * the list of system libraries is sufficient for every package in renv.lock (add -dev packages
#     to the builder stage and the matching runtime libraries to the final stage if renv::restore fails
#     or R reports a missing shared library at load time).

ARG R_VERSION=4.6.2

# ---------------------------------------------------------------- stage 1: R packages from renv.lock
FROM rocker/r-ver:${R_VERSION} AS r-packages
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential gfortran cmake pkg-config \
      libcurl4-openssl-dev libssl-dev libxml2-dev \
      libfontconfig1-dev libfreetype6-dev libharfbuzz-dev libfribidi-dev \
      libpng-dev libtiff5-dev libjpeg-dev \
      libglpk-dev libgmp-dev libnlopt-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY services/r-engine/renv.lock renv.lock
# Restore exactly the locked versions into a standalone library (no project activation needed).
RUN mkdir -p /opt/r-lib \
 && Rscript -e 'options(repos = c(CRAN = "https://cloud.r-project.org")); install.packages("renv"); renv::restore(lockfile = "renv.lock", library = "/opt/r-lib", prompt = FALSE)'

# ---------------------------------------------------------------- stage 2: runtime (R + Python 3.12 + app)
FROM rocker/r-ver:${R_VERSION} AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      libcurl4 libssl3 libxml2 \
      libfontconfig1 libfreetype6 libharfbuzz0b libfribidi0 \
      libpng16-16 libtiff6 libjpeg-turbo8 \
      libglpk40 libgmp10 libnlopt0 \
    && rm -rf /var/lib/apt/lists/*

# uv manages the Python 3.12 interpreter and the locked environment.
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=automatic \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/app ./app

# The engine (launcher + R sources), the capability registry, and the pinned R library.
COPY services/r-engine/bin ./services/r-engine/bin
COPY services/r-engine/R ./services/r-engine/R
COPY packages/method-registry/registry.json ./registry.json
COPY --from=r-packages /opt/r-lib ./services/r-engine/r-lib

# Non-root user; the job store lives on a volume at /data.
RUN useradd --system --uid 10001 --home-dir /home/app --create-home app \
 && mkdir -p /data && chown -R app:app /data
ENV APP_ENV=production \
    DATA_DIR=/data \
    REGISTRY_PATH=/app/registry.json \
    ENGINE_R_COMMAND=/app/services/r-engine/bin/run-job \
    PATH="/app/.venv/bin:${PATH}" \
    PORT=8000
VOLUME ["/data"]
USER app
EXPOSE 8000

# /api/health probes R once (cached); allow for that on a cold start.
HEALTHCHECK --interval=30s --timeout=30s --start-period=90s --retries=3 \
  CMD ["python", "-c", "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','8000'), timeout=25)"]

# One process on purpose: the job runner and its concurrency limit live in this process.
# Scale vertically (MAX_CONCURRENT_JOBS) or run a second, separate API service.
CMD ["sh", "-c", "exec uvicorn app.main:app_factory --factory --host 0.0.0.0 --port ${PORT} --no-access-log --proxy-headers"]
