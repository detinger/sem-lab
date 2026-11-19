"""Stable engine error codes and the handled EngineError (port of packages/engine/src/shared/errors.ts)."""

ENGINE_ERROR_CODES = (
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
)


class EngineError(Exception):
    """A handled engine error. Messages and details may name model ids, column names and
    counts, never a data value."""

    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details

    def to_info(self):
        if self.details:
            return {"code": self.code, "message": self.message, "details": self.details}
        return {"code": self.code, "message": self.message}


def invalid(message, details=None):
    return EngineError("REQUEST_INVALID", message, details)
