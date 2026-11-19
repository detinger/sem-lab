"""FastAPI application factory (PLAN.md §3.4)."""

from __future__ import annotations

import asyncio
import csv
import json
import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import Field, ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import Settings
from .contracts import AnalysisConfiguration, SemModel, validate_model_structure
from .contracts.common import Strict, dump_contract
from .errors import ApiError
from .health import HealthProbe
from .jobs import JobService
from .logging_setup import configure_logging, request_id_var
from .middleware import RequestMiddleware, TokenBucket
from .registry import Registry
from .store import JOB_ID_RE, JobStore, new_job_id

log = logging.getLogger("sem_studio.api")

JSON_BODY_LIMIT = 1024 * 1024
MULTIPART_OVERHEAD = 2 * 1024 * 1024
MIB = 1024 * 1024


class DataPreparation(Strict):
    """Rows the browser removed before upload (listwise deletion), so results can report N of M."""

    nRows: int = Field(ge=0)
    nDropped: int = Field(ge=0)
    missingData: Literal["listwise"]


class JobRequest(Strict):
    model: SemModel
    analysis: AnalysisConfiguration
    dataPreparation: DataPreparation | None = None


def _error(
    status: int, code: str, message: str, details: Any = None, headers: dict[str, str] | None = None
) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message, "requestId": request_id_var.get()}
    if details is not None:
        body["details"] = details
    return JSONResponse({"error": body}, status_code=status, headers=headers)


def _pydantic_issues(e: ValidationError) -> list[dict[str, str]]:
    """Locations and rule messages only. The offending input is deliberately dropped."""
    return [{"path": ".".join(str(x) for x in err["loc"]), "message": err["msg"]} for err in e.errors()][:50]


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or Settings.from_env()
    configure_logging()
    store = JobStore(s.data_dir)
    service = JobService(s, store)
    probe = HealthProbe(s)
    bucket = TokenBucket(s.rate_limit_jobs_per_minute)
    registry: Registry | None
    try:
        registry = Registry.load(s.registry_path)
    except (OSError, ValueError):
        registry = None
        log.error("capability registry could not be loaded")
    stop = threading.Event()

    def sweeper() -> None:
        while not stop.wait(s.sweep_interval_seconds):
            try:
                service.sweep()
            except Exception as e:
                log.error("sweep failed", extra={"error_type": type(e).__name__})

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        n = service.recover_all()
        service.sweep()
        if n:
            log.info("recovered jobs", extra={"removed": n})
        threading.Thread(target=sweeper, name="retention-sweeper", daemon=True).start()
        # Warm the (slow, cached) R availability probe so the first /api/health is not the one that pays for it.
        threading.Thread(target=probe.r, name="r-probe", daemon=True).start()
        yield
        stop.set()
        await asyncio.to_thread(service.shutdown)
        store.close()

    app = FastAPI(
        title="SEM Studio API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs" if s.development else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if s.development else None,
    )
    app.state.settings, app.state.service, app.state.store = s, service, store

    def max_body(method: str, path: str) -> int:
        if method == "POST" and path == "/api/analysis/jobs":
            return s.max_csv_mb * MIB + MULTIPART_OVERHEAD
        return JSON_BODY_LIMIT

    app.add_middleware(RequestMiddleware, max_body=max_body)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.allowed_origins,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Location", "Retry-After"],
        max_age=600,
    )

    # ---- error handling: stable codes, no stack traces, no input echo ---------------------------------------------------

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError) -> JSONResponse:
        return _error(e.status, e.code, e.message, e.details, e.headers)

    @app.exception_handler(RequestValidationError)
    async def _req_validation(_: Request, e: RequestValidationError) -> JSONResponse:
        issues = [{"path": ".".join(str(x) for x in err["loc"]), "message": err["msg"]} for err in e.errors()][:50]
        return _error(422, "REQUEST_INVALID", "The request is not valid.", {"issues": issues})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(e.status_code, "HTTP_ERROR")
        return _error(e.status_code, code, "Not found." if e.status_code == 404 else "Request refused.")

    def job_or_404(job_id: str):
        if not JOB_ID_RE.match(job_id):
            raise ApiError(404, "NOT_FOUND", "No such job.")
        row = service.get(job_id)
        if row is None:
            raise ApiError(404, "NOT_FOUND", "No such job.")
        return row

    # ---- meta ---------------------------------------------------------------------------------------------------------

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        engines = await asyncio.to_thread(probe.engines)
        return {
            "status": "ok",
            "version": __version__,
            "env": s.app_env,
            "engines": engines,
            "limits": {
                "maxCsvMb": s.max_csv_mb,
                "maxRows": s.max_rows,
                "maxColumns": s.max_columns,
                "maxBootstrapReps": s.max_bootstrap_reps,
                "maxConcurrentJobs": s.max_concurrent_jobs,
                "jobTimeoutSeconds": s.job_timeout_seconds,
                "dataRetentionHours": s.data_retention_hours,
            },
        }

    @app.get("/api/capabilities")
    async def capabilities() -> dict[str, Any]:
        if registry is None:
            raise ApiError(503, "REGISTRY_UNAVAILABLE", "The capability registry could not be loaded.")
        return registry.data

    @app.get("/api/examples")
    async def examples() -> dict[str, Any]:
        return {"examples": []}

    @app.post("/api/export/code")
    async def export_code() -> JSONResponse:
        return _error(501, "NOT_IMPLEMENTED", "Code export is not implemented in this API version.")

    # ---- model validation ---------------------------------------------------------------------------------------------

    @app.post("/api/models/validate")
    async def validate_model(request: Request) -> dict[str, Any]:
        try:
            body = await request.json()
        except ValueError as e:
            raise ApiError(400, "REQUEST_INVALID", "The body is not valid JSON.") from e
        note = (
            "Basic shape and referential-integrity checks only. The authoritative validator is the web "
            "app's (apps/web); method- and engine-dependent rules are not evaluated here."
        )
        if not isinstance(body, dict):
            raise ApiError(422, "REQUEST_INVALID", "Expected a JSON object with a `model` member.")
        issues: list[dict[str, Any]] = []
        try:
            model = SemModel.model_validate(body.get("model"))
        except ValidationError as e:
            issues = [{"code": "SHAPE", "severity": "error", **i} for i in _pydantic_issues(e)]
            return {"valid": False, "issues": issues, "note": note}
        for it in validate_model_structure(model):
            issues.append(
                {"code": it.code, "severity": "error", "message": it.message, "elementIds": list(it.elementIds)}
            )
        if "analysis" in body:
            try:
                AnalysisConfiguration.model_validate(body["analysis"])
            except ValidationError as e:
                issues += [
                    {"code": "SHAPE", "severity": "error", "path": "analysis." + i["path"], "message": i["message"]}
                    for i in _pydantic_issues(e)
                ]
        return {"valid": not issues, "issues": issues, "note": note}

    # ---- jobs ---------------------------------------------------------------------------------------------------------

    def client_key(request: Request) -> str:
        if s.trust_proxy_headers:
            xff = request.headers.get("x-forwarded-for", "")
            if xff:
                return xff.split(",")[0].strip()[:64]
        return request.client.host if request.client else "unknown"

    def scan_csv(path, columns_needed: list[str]) -> tuple[int, list[str]]:
        """Header + row/column counts; streams the file. Never returns or logs cell contents."""
        rows = 0
        try:
            with open(path, encoding="utf-8", newline="") as f:
                reader = csv.reader(f)
                try:
                    header = next(reader)
                except StopIteration as e:
                    raise ApiError(422, "REQUEST_INVALID", "The CSV file is empty.") from e
                if len(header) > s.max_columns:
                    raise ApiError(422, "LIMIT_EXCEEDED", f"The CSV has more than {s.max_columns} columns.")
                for _ in reader:
                    rows += 1
                    if rows > s.max_rows:
                        raise ApiError(422, "LIMIT_EXCEEDED", f"The CSV has more than {s.max_rows} rows.")
        except UnicodeDecodeError as e:
            raise ApiError(422, "REQUEST_INVALID", "The CSV is not valid UTF-8.") from e
        except csv.Error as e:
            raise ApiError(422, "REQUEST_INVALID", "The CSV could not be parsed.") from e
        return rows, header

    @app.post("/api/analysis/jobs", status_code=202)
    async def create_job(
        request: Request,
        request_json: str = Form(alias="request"),
        data: UploadFile = File(),
    ) -> JSONResponse:
        wait = bucket.take(client_key(request))
        if wait > 0:
            raise ApiError(
                429,
                "RATE_LIMITED",
                "Too many jobs created; try again shortly.",
                headers={"Retry-After": str(int(wait) + 1)},
            )
        if registry is None:
            raise ApiError(503, "REGISTRY_UNAVAILABLE", "The capability registry could not be loaded.")
        try:
            raw = json.loads(request_json)
        except ValueError as e:
            raise ApiError(400, "REQUEST_INVALID", "The `request` field is not valid JSON.") from e
        try:
            jr = JobRequest.model_validate(raw)
        except ValidationError as e:
            raise ApiError(
                422,
                "REQUEST_INVALID",
                "The request does not match the model/analysis contracts.",
                {"issues": _pydantic_issues(e)},
            ) from e
        structure = validate_model_structure(jr.model)
        if structure:
            raise ApiError(
                422,
                "REQUEST_INVALID",
                "The model has structural errors.",
                {
                    "issues": [
                        {"code": i.code, "message": i.message, "elementIds": list(i.elementIds)} for i in structure
                    ][:50]
                },
            )
        a = jr.analysis
        if a.bootstrap is not None and a.bootstrap.enabled and a.bootstrap.repetitions > s.max_bootstrap_reps:
            raise ApiError(422, "LIMIT_EXCEEDED", f"At most {s.max_bootstrap_reps} bootstrap repetitions are allowed.")
        if not a.engine.startswith("r-"):
            raise ApiError(422, "CAPABILITY_UNSUPPORTED", f"Engine {a.engine} has no job runner in this API version.")
        missing_caps = registry.unsupported(jr.model, a)
        if missing_caps:
            raise ApiError(
                422,
                "CAPABILITY_UNSUPPORTED",
                "The method registry does not offer this analysis for the chosen engine.",
                {"unsupported": missing_caps},
            )
        if service.queued_count() >= s.max_queued_jobs:
            raise ApiError(503, "QUEUE_FULL", "The job queue is full; try again later.", headers={"Retry-After": "30"})

        job_id = new_job_id()
        job_dir = store.job_dir(job_id)
        job_dir.mkdir(parents=True)
        try:
            await _save_upload(data, job_dir / "data.csv")
            rows, header = await asyncio.to_thread(scan_csv, job_dir / "data.csv", [])
            if len(set(header)) != len(header):
                raise ApiError(422, "REQUEST_INVALID", "The CSV header contains duplicate column names.")
            bound = [i.column for i in jr.model.indicators if i.column is not None]
            missing_cols = sorted({c for c in bound if c not in set(header)})
            if missing_cols:
                raise ApiError(
                    422,
                    "DATA_COLUMN_MISSING",
                    "Some bound columns are not in the CSV header.",
                    {"columns": missing_cols[:50]},
                )
            used = {iid for c in jr.model.constructs for iid in c.indicatorIds}
            unbound = [i.id for i in jr.model.indicators if i.id in used and i.column is None]
            if unbound:
                raise ApiError(
                    422, "DATA_COLUMN_MISSING", "Some indicators have no bound column.", {"indicatorIds": unbound[:50]}
                )
            request_doc = {
                "protocolVersion": 1,
                "jobId": job_id,
                "model": dump_contract(jr.model),
                "analysis": dump_contract(a),
                "limits": {"maxBootstrap": s.max_bootstrap_reps, "timeoutSeconds": s.job_timeout_seconds},
            }
            if jr.dataPreparation is not None:
                request_doc["dataPreparation"] = dump_contract(jr.dataPreparation)
            (job_dir / "request.json").write_text(json.dumps(request_doc), encoding="utf-8")
            store.create(job_id, a.engine)
        except BaseException:
            store.delete(job_id)
            raise
        service.start(job_id)
        log.info("job created", extra={"job_id": job_id})
        return JSONResponse(
            {"id": job_id, "status": "queued", "statusUrl": f"/api/analysis/jobs/{job_id}"},
            status_code=202,
            headers={"Location": f"/api/analysis/jobs/{job_id}"},
        )

    async def _save_upload(upload: UploadFile, dest) -> None:
        first = True
        with open(dest, "wb") as out:
            while chunk := await upload.read(1024 * 1024):
                if first and chunk.startswith(b"\xef\xbb\xbf"):
                    chunk = chunk[3:]  # a UTF-8 BOM would otherwise become part of the first column name
                first = False
                out.write(chunk)
        await upload.close()

    @app.get("/api/analysis/jobs/{job_id}")
    async def job_status(job_id: str) -> dict[str, Any]:
        row = job_or_404(job_id)
        return service.status(row)

    @app.post("/api/analysis/jobs/{job_id}/cancel")
    async def job_cancel(job_id: str) -> dict[str, Any]:
        job_or_404(job_id)
        await asyncio.to_thread(service.cancel, job_id)
        return service.status(job_or_404(job_id))

    @app.delete("/api/analysis/jobs/{job_id}", status_code=204)
    async def job_delete(job_id: str) -> Response:
        job_or_404(job_id)
        await asyncio.to_thread(service.delete, job_id)
        return Response(status_code=204)

    @app.get("/api/analysis/jobs/{job_id}/result")
    async def job_result(job_id: str) -> JSONResponse:
        row = job_or_404(job_id)
        if row.state != "complete":
            raise ApiError(
                409, "RESULT_NOT_AVAILABLE", f"The job is {row.state}; a result exists only when it is complete."
            )
        kind, payload = await asyncio.to_thread(service.result, job_id)
        if kind != "ok":
            raise ApiError(500, "ENGINE_INTERNAL", "The engine result failed contract validation and was withheld.")
        return JSONResponse(dump_contract(payload))

    @app.get("/api/analysis/jobs/{job_id}/engine-log")
    async def engine_log(job_id: str) -> Response:
        """Technical-panel debug aid. Disabled (404) unless APP_ENV=development."""
        if not s.development:
            raise ApiError(404, "NOT_FOUND", "Not found.")
        job_or_404(job_id)
        try:
            with open(store.job_dir(job_id) / "engine.log", "rb") as f:
                f.seek(0, 2)
                f.seek(max(0, f.tell() - 65536))
                text = f.read().decode("utf-8", errors="replace")
        except OSError:
            text = ""
        return PlainTextResponse(text)

    return app


def app_factory() -> FastAPI:
    """uvicorn --factory entry point."""
    return create_app()
