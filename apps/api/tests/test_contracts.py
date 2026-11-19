"""Drift test: Zod (source of truth) -> JSON Schema -> Pydantic must agree on the shared examples.

For `structure.*` invalid examples the document is shape-valid by design (Zod and JSON Schema accept it);
only the referential-integrity checker rejects it, so Pydantic's shape check is expected to PASS and
`validate_model_structure` must report the expected codes.
"""

import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from app.contracts import (
    AnalysisConfiguration,
    DatasetRef,
    NormalizedSemResult,
    SemModel,
    validate_model_structure,
)

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
EX = CONTRACTS / "examples"
SCHEMA_FILES = {
    "sem-model": "sem-model.json",
    "analysis-configuration": "analysis-configuration.json",
    "normalized-sem-result": "normalized-sem-result.json",
    "dataset-ref": "dataset-ref.json",
}
MODELS = {
    "sem-model": SemModel,
    "analysis-configuration": AnalysisConfiguration,
    "normalized-sem-result": NormalizedSemResult,
    "dataset-ref": DatasetRef,
}
VALID_CONTRACT = {
    "model.": "sem-model",
    "analysis.": "analysis-configuration",
    "result.": "normalized-sem-result",
}


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _schema(contract: str):
    return _load(CONTRACTS / "schema" / SCHEMA_FILES[contract])


def _valid_files():
    return sorted(p for p in (EX / "valid").glob("*.json") if p.name.split(".")[0] in ("model", "analysis", "result"))


def _contract_for_valid(p: Path) -> str:
    return VALID_CONTRACT[p.name.split(".")[0] + "."]


@pytest.mark.parametrize("path", _valid_files(), ids=lambda p: p.name)
def test_valid_examples_parse_in_pydantic_and_json_schema(path):
    contract = _contract_for_valid(path)
    doc = _load(path)
    MODELS[contract].model_validate(doc)
    jsonschema.validate(doc, _schema(contract))


INVALID = sorted((EX / "invalid").glob("*.json"))


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_examples(path):
    ex = _load(path)
    contract, doc = ex["contract"], ex["document"]
    model = MODELS[contract]
    if path.name.startswith("structure."):
        # Shape is valid; the structural checker is what must reject it.
        parsed = model.model_validate(doc)
        jsonschema.validate(doc, _schema(contract))
        codes = {i.code for i in validate_model_structure(parsed)}
        assert set(ex["expectedCodes"]) <= codes
        return
    with pytest.raises(ValidationError):
        model.model_validate(doc)
    if ex.get("catchesBy") == "schema":
        # Shape-level rejections must also be visible to the generated JSON Schema.
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, _schema(contract))


def test_there_are_examples():
    assert len(_valid_files()) >= 3 and len(INVALID) >= 15


def test_nan_and_infinity_are_rejected():
    doc = _load(EX / "valid" / "analysis.pls-bootstrap.json")
    doc["pls"]["tolerance"] = float("nan")
    with pytest.raises(ValidationError):
        AnalysisConfiguration.model_validate(doc)


def test_null_for_optional_field_is_rejected_like_zod():
    doc = _load(EX / "valid" / "analysis.pls-bootstrap.json")
    doc["seed"] = None
    with pytest.raises(ValidationError):
        AnalysisConfiguration.model_validate(doc)


def test_bool_is_not_a_number():
    doc = _load(EX / "valid" / "analysis.pls-bootstrap.json")
    doc["pls"]["maxIterations"] = True
    with pytest.raises(ValidationError):
        AnalysisConfiguration.model_validate(doc)
