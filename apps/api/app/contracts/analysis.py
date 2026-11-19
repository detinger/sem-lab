"""Mirrors packages/contracts/src/analysis.ts, including the cross-field rules."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import Field, StringConstraints, model_validator

from .common import Id, Int, Strict

SemMethod = Literal["pls-sem", "plsc", "cb-sem"]
EngineId = Literal["browser", "r-csem", "r-seminr", "r-lavaan", "py-semopy", "py-plspm"]

ENGINES_BY_METHOD: dict[str, tuple[str, ...]] = {
    "pls-sem": ("browser", "r-csem", "r-seminr", "py-plspm"),
    "plsc": ("browser", "r-csem", "r-seminr"),
    "cb-sem": ("browser", "r-lavaan", "py-semopy"),
}


class BootstrapConfig(Strict):
    enabled: bool
    repetitions: Annotated[Int, Field(ge=1, le=100_000)]
    ci: Literal["percentile", "bca"]
    confidenceLevel: Annotated[float, Field(gt=0.5, lt=1, allow_inf_nan=False)]
    sides: Literal["two-sided", "one-sided"]


class PlsOptions(Strict):
    innerWeighting: Literal["path", "centroid", "factorial"]
    maxIterations: Annotated[Int, Field(ge=1, le=100_000)]
    tolerance: Annotated[float, Field(gt=0, le=0.01, allow_inf_nan=False)]


class CbOptions(Strict):
    identification: Literal["marker", "std-lv"]
    meanStructure: bool


class IpmaConfig(Strict):
    targetConstructId: Id


class AnalysisConfiguration(Strict):
    method: SemMethod
    engine: EngineId
    estimator: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    missingData: Literal["listwise", "fiml"]
    seed: Annotated[Int, Field(ge=0, le=2_147_483_647)] | None = None
    bootstrap: BootstrapConfig | None = None
    pls: PlsOptions | None = None
    cb: CbOptions | None = None
    ipma: IpmaConfig | None = None

    @model_validator(mode="after")
    def _cross_field(self) -> Self:
        if self.engine not in ENGINES_BY_METHOD[self.method]:
            raise ValueError(f"engine {self.engine} cannot run method {self.method}")
        if self.bootstrap is not None and self.bootstrap.enabled and self.seed is None:
            raise ValueError("a seed is required when bootstrapping is enabled")
        if self.method == "cb-sem" and self.pls is not None:
            raise ValueError("PLS options are not valid for CB-SEM")
        if self.method != "cb-sem" and self.cb is not None:
            raise ValueError("CB options are only valid for CB-SEM")
        if self.missingData == "fiml" and self.method != "cb-sem":
            raise ValueError("FIML is only defined for CB-SEM estimators")
        return self
