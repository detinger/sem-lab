"""Structured logging that cannot leak request bodies: only whitelisted, non-payload fields are ever emitted."""

from __future__ import annotations

import contextvars
import json
import logging
import time

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# The complete set of extra fields a log record may carry. Nothing else is serialised.
_ALLOWED_EXTRA = ("job_id", "method", "path", "status", "duration_ms", "error_type", "removed", "client", "limit")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        doc: dict[str, object] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        for k in _ALLOWED_EXTRA:
            if hasattr(record, k):
                doc[k] = getattr(record, k)
        # Exceptions are reduced to their class name: messages and tracebacks can contain data.
        if record.exc_info and record.exc_info[0] is not None:
            doc["error_type"] = record.exc_info[0].__name__
        return json.dumps(doc, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger("sem_studio")
    root.setLevel(level)
    if not any(getattr(h, "_sem_studio", False) for h in root.handlers):
        h = logging.StreamHandler()
        h.setFormatter(JsonFormatter())
        h._sem_studio = True  # type: ignore[attr-defined]
        root.addHandler(h)
    root.propagate = True
