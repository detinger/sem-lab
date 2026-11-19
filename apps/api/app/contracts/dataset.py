from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from .common import FiniteNumber, Int, IsoDateTime, Sha256Hex, Strict


class ColumnSchema(Strict):
    name: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    type: Literal["numeric", "text", "empty"]
    nMissing: Annotated[Int, Field(ge=0)]
    nUnique: Annotated[Int, Field(ge=0)]
    observedMin: FiniteNumber | None
    observedMax: FiniteNumber | None


class Provenance(Strict):
    synthetic: bool
    licence: Annotated[str, StringConstraints(max_length=200)] | None = None
    attribution: Annotated[str, StringConstraints(max_length=2000)] | None = None


class DatasetRef(Strict):
    """No row-level values: safe to store and log."""

    fingerprint: Sha256Hex
    importedAt: IsoDateTime
    rowCount: Annotated[Int, Field(ge=0)]
    columns: list[ColumnSchema]
    source: Annotated[str, StringConstraints(max_length=500)] | None = None
    provenance: Provenance | None = None
