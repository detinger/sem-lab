"""Shared primitives. Mirrors packages/contracts/src/common.ts."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

SCHEMA_VERSION = 1


class Strict(BaseModel):
    """Unknown keys are errors; scalars are not coerced (no "1" -> 1, no True -> 1)."""

    model_config = ConfigDict(extra="forbid", strict=True)

    # Optional fields that Zod also allows to be an explicit null (everything else: absent or a value).
    NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _no_null_for_optional(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for k, v in data.items():
                f = cls.model_fields.get(k)
                if v is None and f is not None and not f.is_required() and k not in cls.NULLABLE_OPTIONAL:
                    raise PydanticCustomError(
                        "null_optional", "optional field must be omitted, not null: {k}", {"k": k}
                    )
        return data


def _as_int(v: Any) -> Any:
    # JSON has one number type: 5.0 is the integer 5 (as in Zod's z.number().int()).
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


Int = Annotated[int, BeforeValidator(_as_int)]
FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
Num = FiniteNumber | None

Id = Annotated[
    str,
    StringConstraints(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_][A-Za-z0-9_.:-]*$"),
]
Sha256Hex = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]

_CONTROL = re.compile(r"[\u0000-\u001f\u007f]")


def _check_name(v: Any) -> Any:
    if isinstance(v, str):
        if not v.strip():
            raise PydanticCustomError("name_empty", "name must not be empty")
        if _CONTROL.search(v):
            raise PydanticCustomError("name_control", "name must not contain control characters")
    return v


Name = Annotated[str, StringConstraints(max_length=200), BeforeValidator(_check_name)]

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def _check_iso(v: Any) -> Any:
    if isinstance(v, str):
        if not _ISO.match(v):
            raise PydanticCustomError("iso_datetime", "expected an ISO 8601 datetime with offset")
        try:
            datetime.fromisoformat(v)
        except ValueError as e:
            raise PydanticCustomError("iso_datetime", "invalid ISO 8601 datetime") from e
    return v


IsoDateTime = Annotated[str, BeforeValidator(_check_iso)]

MissingReason = Literal["not-applicable", "not-requested", "not-estimated", "not-supported", "failed", "non-finite"]
Severity = Literal["error", "warning", "recommendation", "info"]


def dump_contract(obj: BaseModel) -> dict:
    """Serialise a contract model for the wire.

    `exclude_unset`, NOT `exclude_none`: absent optional fields stay absent, but a field that is
    explicitly null (a nullable result number, an unmapped indicator's `column`) is kept. Dropping
    those nulls makes the document invalid against the contract (contracts.md, "Serialisation
    quirks"): a required-but-null field must be sent as null.
    """
    return obj.model_dump(mode="json", exclude_unset=True)
