"""Mirrors packages/contracts/src/result.ts."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import Field, StringConstraints, model_validator

from .analysis import EngineId
from .common import (
    SCHEMA_VERSION,
    FiniteNumber,
    Id,
    Int,
    IsoDateTime,
    MissingReason,
    Num,
    Severity,
    Strict,
)

NUMERIC_FIELDS = ("est", "se", "statistic", "pValue", "ciLower", "ciUpper")
_Pos = Annotated[Int, Field(ge=0)]
_Level = Annotated[float, Field(gt=0.5, lt=1, allow_inf_nan=False)]

ParameterKind = Literal[
    "path", "loading", "weight", "total-effect", "indirect-effect", "specific-indirect",
    "covariance", "variance", "residual-variance", "intercept", "threshold", "defined",
]  # fmt: skip


class Inference(Strict):
    method: Literal["bootstrap-percentile", "bootstrap-bca", "analytic", "robust-analytic"]
    level: _Level
    sides: Literal["two-sided", "one-sided"]
    nValid: _Pos | None = None


class ParameterEstimate(Strict):
    key: Annotated[str, StringConstraints(min_length=1, max_length=400)]
    kind: ParameterKind
    sourceId: Id | None = None
    targetId: Id | None = None
    viaIds: list[Id] | None = None
    relationshipId: Id | None = None
    scale: Literal["standardized", "unstandardized"]
    est: Num
    se: Num
    statistic: Num
    statisticType: Literal["t", "z"] | None = None
    pValue: Num
    ciLower: Num
    ciUpper: Num
    missing: dict[Literal["est", "se", "statistic", "pValue", "ciLower", "ciUpper"], MissingReason] | None = None
    status: Literal["estimated", "fixed", "not-estimated", "failed"]
    inference: Inference | None = None
    sourceMethod: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    rawPath: Annotated[str, StringConstraints(max_length=400)] | None = None

    @model_validator(mode="after")
    def _rules(self) -> Self:
        miss = self.missing or {}
        for f in NUMERIC_FIELDS:
            v = getattr(self, f)
            if v is None and f not in miss:
                raise ValueError(f"{f} is null but no reason is given in missing.{f}")
            if v is not None and f in miss:
                raise ValueError(f"{f} has a value and a missing reason")
        if self.pValue is not None and not 0 <= self.pValue <= 1:
            raise ValueError("p value must lie in [0, 1]")
        if self.ciLower is not None and self.ciUpper is not None and self.ciLower > self.ciUpper:
            raise ValueError("ciLower must not exceed ciUpper")
        return self


def _require_reason(value: float | None, missing: str | None) -> None:
    if value is None and not missing:
        raise ValueError("value is null but no missing reason is given")
    if value is not None and missing:
        raise ValueError("value is present and a missing reason is given")


_Def = Annotated[str, StringConstraints(min_length=1, max_length=1000)]


class ConstructMetric(Strict):
    constructId: Id
    metric: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    value: Num
    missing: MissingReason | None = None
    definition: _Def

    @model_validator(mode="after")
    def _rules(self) -> Self:
        _require_reason(self.value, self.missing)
        return self


class ResultMatrix(Strict):
    id: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    title: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    rowIds: list[Id]
    colIds: list[Id]
    values: list[list[Num]]
    symmetric: bool
    definition: _Def
    missing: MissingReason | None = None

    @model_validator(mode="after")
    def _shape(self) -> Self:
        if len(self.values) != len(self.rowIds):
            raise ValueError("values must have one row per rowId")
        for row in self.values:
            if len(row) != len(self.colIds):
                raise ValueError("each row must have one value per colId")
        return self


class FitIndex(Strict):
    NULLABLE_OPTIONAL = frozenset({"ciLower", "ciUpper"})

    name: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    value: Num
    missing: MissingReason | None = None
    ciLower: Num = None
    ciUpper: Num = None
    variant: Literal["standard", "scaled", "robust"] | None = None
    definition: _Def

    @model_validator(mode="after")
    def _rules(self) -> Self:
        _require_reason(self.value, self.missing)
        return self


class BootstrapSummary(Strict):
    requested: _Pos
    completed: _Pos
    failed: _Pos
    inadmissible: _Pos
    seed: _Pos
    ciMethod: Literal["percentile", "bca"]
    confidenceLevel: _Level
    chunkSize: Annotated[Int, Field(ge=1)]
    draws: dict[str, list[FiniteNumber]] | None = None

    @model_validator(mode="after")
    def _sum(self) -> Self:
        if self.completed + self.failed + self.inadmissible > self.requested:
            raise ValueError("completed + failed + inadmissible cannot exceed requested")
        return self


class IpmaConstruct(Strict):
    constructId: Id
    importance: Num
    performance: Num
    predecessor: Literal["direct", "indirect"]


class IpmaIndicator(Strict):
    indicatorId: Id
    constructId: Id
    importance: Num
    performance: Num


class IpmaResult(Strict):
    targetConstructId: Id
    constructs: list[IpmaConstruct]
    indicators: list[IpmaIndicator] | None = None
    convention: Annotated[str, StringConstraints(min_length=1, max_length=2000)]


class ResultWarning(Strict):
    code: Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9_]*$")]
    severity: Severity
    message: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    elementIds: list[Id] | None = None


class Sample(Strict):
    nRows: _Pos
    nUsed: _Pos
    nDropped: _Pos
    missingData: Literal["listwise", "fiml"]

    @model_validator(mode="after")
    def _arith(self) -> Self:
        if self.nUsed + self.nDropped != self.nRows:
            raise ValueError("nUsed + nDropped must equal nRows")
        return self


class Estimation(Strict):
    converged: bool
    iterations: Num
    admissible: bool | None
    messages: list[Annotated[str, StringConstraints(max_length=2000)]]


class Provenance(Strict):
    engine: EngineId
    packageVersions: dict[str, str]
    rVersion: str | None = None
    pythonVersion: str | None = None
    call: Annotated[str, StringConstraints(max_length=4000)]
    startedAt: IsoDateTime
    finishedAt: IsoDateTime


class NormalizedSemResult(Strict):
    schemaVersion: Literal[1]
    sample: Sample
    estimation: Estimation
    parameters: list[ParameterEstimate]
    constructMetrics: list[ConstructMetric]
    matrices: list[ResultMatrix]
    fit: list[FitIndex]
    bootstrap: BootstrapSummary | None = None
    ipma: IpmaResult | None = None
    warnings: list[ResultWarning]
    provenance: Provenance


assert SCHEMA_VERSION == 1
