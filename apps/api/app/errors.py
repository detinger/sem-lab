from __future__ import annotations

from typing import Any

ENGINE_ERROR_CODES = frozenset(
    {
        "REQUEST_INVALID",
        "DATA_COLUMN_MISSING",
        "DATA_NOT_NUMERIC",
        "DATA_INSUFFICIENT_ROWS",
        "DATA_ZERO_VARIANCE",
        "MODEL_NOT_IDENTIFIED",
        "ENGINE_NONCONVERGENCE",
        "ENGINE_INADMISSIBLE",
        "CAPABILITY_UNSUPPORTED",
        "CANCELLED",
        "TIMEOUT",
        "ENGINE_INTERNAL",
    }
)


class ApiError(Exception):
    """An error with a stable code and a message that never contains row-level data."""

    def __init__(
        self, status: int, code: str, message: str, details: Any = None, headers: dict[str, str] | None = None
    ):
        super().__init__(message)
        self.status, self.code, self.message, self.details, self.headers = status, code, message, details, headers or {}
