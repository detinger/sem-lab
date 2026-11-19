"""The API's capability gating must equal the web's (packages/method-registry/src/gating.ts).

Both are tested against the same vectors; a rule changed on one side only fails here or there.
"""

import json
from pathlib import Path

import pytest

from app.contracts import AnalysisConfiguration, SemModel
from app.registry import Registry

ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((ROOT / "packages" / "method-registry" / "gating-vectors.json").read_text())
REGISTRY = Registry.load(ROOT / "packages" / "method-registry" / "registry.json")


@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_required_capabilities_match_shared_vectors(vector):
    model = SemModel.model_validate(vector["model"])
    analysis = AnalysisConfiguration.model_validate(vector["analysis"])
    assert REGISTRY.required_capabilities(model, analysis) == vector["expected"]
