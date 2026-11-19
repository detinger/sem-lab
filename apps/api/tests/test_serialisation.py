"""Contract documents must survive parse -> serialise unchanged, explicit nulls included.

Regression: results were serialised with exclude_none=True, which dropped required-but-null
numbers (e.g. an exogenous construct's R² value: null) and made valid results invalid in the
browser.
"""

import json
from pathlib import Path

from app.contracts import NormalizedSemResult, SemModel
from app.contracts.common import dump_contract

EXAMPLES = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "examples" / "valid"


def test_result_round_trips_exactly_including_nulls():
    raw = json.loads((EXAMPLES / "result.shape-example.json").read_text())
    out = dump_contract(NormalizedSemResult.model_validate(raw))
    assert out == raw
    peou_r2 = next(m for m in out["constructMetrics"] if m["constructId"] == "c_peou" and m["metric"] == "r2")
    assert "value" in peou_r2 and peou_r2["value"] is None


def test_unmapped_indicator_column_null_is_kept_and_absent_optionals_stay_absent():
    raw = json.loads((EXAMPLES / "model.tam-v1.json").read_text())
    raw["indicators"][0]["column"] = None
    out = dump_contract(SemModel.model_validate(raw))
    assert out["indicators"][0]["column"] is None
    assert "label" not in out["indicators"][0]  # never set -> not emitted
    assert out == raw
