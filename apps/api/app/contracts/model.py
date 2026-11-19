"""Mirrors packages/contracts/src/model.ts and the structural invariants of structure.ts."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Annotated, Literal, Self

from pydantic import Field, StringConstraints, model_validator

from .common import FiniteNumber, Id, Name, Strict

_Label = Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")]


class ScaleEndpoints(Strict):
    min: FiniteNumber
    max: FiniteNumber

    @model_validator(mode="after")
    def _order(self) -> Self:
        if not self.min < self.max:
            raise ValueError("scale.min must be smaller than scale.max")
        return self


class HigherOrder(Strict):
    approach: Literal["repeated-indicators", "two-stage"]
    childConstructIds: Annotated[list[Id], Field(min_length=1)]


class SemConstruct(Strict):
    id: Id
    name: Name
    label: Annotated[str, StringConstraints(max_length=500)] | None = None
    measurement: Literal["reflective", "composite-formative"]
    indicatorIds: list[Id]
    plsWeightingMode: Literal["mode-a", "mode-b"] | None = None
    higherOrder: HigherOrder | None = None


class SemIndicator(Strict):
    id: Id
    name: Name
    label: Annotated[str, StringConstraints(max_length=1000)] | None = None
    column: Annotated[str, StringConstraints(min_length=1, max_length=500)] | None
    scale: ScaleEndpoints | None = None
    reverseScored: bool | None = None
    level: Literal["continuous", "ordinal", "binary"] | None = None


class StructuralRelationship(Strict):
    id: Id
    sourceId: Id
    targetId: Id
    parameterLabel: _Label | None = None
    fixedValue: FiniteNumber | None = None
    kind: Literal["structural"]
    hypothesis: Annotated[str, StringConstraints(max_length=40)] | None = None


class CovarianceRelationship(Strict):
    id: Id
    sourceId: Id
    targetId: Id
    parameterLabel: _Label | None = None
    fixedValue: FiniteNumber | None = None
    kind: Literal["covariance"]


SemRelationship = Annotated[StructuralRelationship | CovarianceRelationship, Field(discriminator="kind")]


class SemModel(Strict):
    constructs: list[SemConstruct]
    indicators: list[SemIndicator]
    relationships: list[SemRelationship]


@dataclass(frozen=True)
class StructureIssue:
    code: str
    message: str
    elementIds: tuple[str, ...]


def validate_model_structure(model: SemModel) -> list[StructureIssue]:
    """Referential integrity, a port of validateModelStructure (structure.ts)."""
    issues: list[StructureIssue] = []

    def add(code: str, message: str, ids: list[str]) -> None:
        issues.append(StructureIssue(code, message, tuple(ids)))

    construct_ids = {c.id for c in model.constructs}
    indicator_ids = {i.id for i in model.indicators}

    counts: dict[str, int] = defaultdict(int)
    for el in (*model.constructs, *model.indicators, *model.relationships):
        counts[el.id] += 1
    for eid, n in counts.items():
        if n > 1:
            add("DUPLICATE_ID", f'The id "{eid}" is used by {n} elements.', [eid])

    for code, items, what in (
        ("DUPLICATE_CONSTRUCT_NAME", model.constructs, "Construct"),
        ("DUPLICATE_INDICATOR_NAME", model.indicators, "Indicator"),
    ):
        groups: dict[str, list[str]] = defaultdict(list)
        for it in items:
            groups[it.name].append(it.id)
        for name, ids in groups.items():
            if len(ids) > 1:
                add(code, f'{what} name "{name}" is used more than once.', ids)

    for c in model.constructs:
        in_block: set[str] = set()
        for iid in c.indicatorIds:
            if iid not in indicator_ids:
                add(
                    "UNKNOWN_BLOCK_INDICATOR",
                    f'Construct "{c.name}" lists an indicator id "{iid}" that does not exist.',
                    [c.id],
                )
            if iid in in_block:
                add("DUPLICATE_BLOCK_INDICATOR", f'Construct "{c.name}" lists indicator "{iid}" twice.', [c.id, iid])
            in_block.add(iid)
        if c.higherOrder:
            for child in c.higherOrder.childConstructIds:
                if child not in construct_ids or child == c.id:
                    add(
                        "UNKNOWN_HIGHER_ORDER_CHILD",
                        f'Construct "{c.name}" has an invalid higher-order child "{child}".',
                        [c.id],
                    )

    structural: set[tuple[str, str]] = set()
    covariance: set[tuple[str, str]] = set()
    labels: dict[str, list[str]] = defaultdict(list)
    for r in model.relationships:
        if r.parameterLabel:
            labels[r.parameterLabel].append(r.id)
        known = construct_ids | indicator_ids
        if r.sourceId not in known or r.targetId not in known:
            add("UNKNOWN_ENDPOINT", f'Relationship "{r.id}" connects an element that does not exist.', [r.id])
            continue
        if r.sourceId == r.targetId:
            add("SELF_LOOP", f'Relationship "{r.id}" connects an element to itself.', [r.id])
            continue
        if r.kind == "structural":
            if r.sourceId not in construct_ids or r.targetId not in construct_ids:
                add(
                    "STRUCTURAL_ENDPOINT_NOT_CONSTRUCT",
                    f'Structural path "{r.id}" must connect two constructs.',
                    [r.id],
                )
                continue
            key = (r.sourceId, r.targetId)
            if key in structural:
                add("DUPLICATE_STRUCTURAL_PATH", f'Structural path "{r.id}" duplicates another.', [r.id])
            structural.add(key)
        else:
            both_c = r.sourceId in construct_ids and r.targetId in construct_ids
            both_i = r.sourceId in indicator_ids and r.targetId in indicator_ids
            if not both_c and not both_i:
                add(
                    "COVARIANCE_ENDPOINT_MISMATCH",
                    f'Covariance "{r.id}" must connect two constructs or two indicators (residual covariance).',
                    [r.id],
                )
                continue
            ckey = tuple(sorted((r.sourceId, r.targetId)))
            if ckey in covariance:
                add("DUPLICATE_COVARIANCE", f'Covariance "{r.id}" duplicates another.', [r.id])
            covariance.add(ckey)  # type: ignore[arg-type]
    for label, ids in labels.items():
        if len(ids) > 1:
            add("DUPLICATE_PARAMETER_LABEL", f'Parameter label "{label}" is used more than once.', ids)
    return issues
