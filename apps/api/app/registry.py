"""Capability gating against packages/method-registry/registry.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .contracts import AnalysisConfiguration, SemModel

# Statuses under which the application offers a capability (registry vocabulary: supported | beta | planned | unsupported).
OFFERED = frozenset({"supported", "beta"})


class Registry:
    def __init__(self, data: dict[str, Any]):
        self.data = data
        self._caps = {c["id"]: c for c in data.get("capabilities", [])}

    @classmethod
    def load(cls, path: Path) -> Registry:
        return cls(json.loads(path.read_text(encoding="utf-8")))

    def status(self, capability: str, engine: str) -> str:
        cap = self._caps.get(capability)
        if cap is None:
            return "unknown"
        return str(cap.get("engines", {}).get(engine, {}).get("status", "unsupported"))

    def required_capabilities(self, model: SemModel, a: AnalysisConfiguration) -> list[str]:
        """Port of packages/method-registry/src/gating.ts `requiredCapabilities` — same rules, same order.

        Both implementations are tested against packages/method-registry/gating-vectors.json.
        """
        caps: list[str] = []
        pls = a.method in ("pls-sem", "plsc")
        if a.method == "pls-sem":
            caps.append("pls.estimation.classic")
        elif a.method == "plsc":
            caps.append("pls.estimation.plsc")
        else:
            caps.append(f"cb.estimation.{a.estimator.lower()}")
        if pls:
            caps.append(f"pls.inner-weighting.{a.pls.innerWeighting if a.pls is not None else 'path'}")
        if pls and any(
            c.measurement == "composite-formative" or c.plsWeightingMode == "mode-b" for c in model.constructs
        ):
            caps.append("pls.mode-b")
        if any(c.higherOrder is not None for c in model.constructs):
            caps.append("pls.higher-order")
        if a.bootstrap is not None and a.bootstrap.enabled:
            caps.append(f"resampling.bootstrap-{a.bootstrap.ci}")
        if a.missingData == "fiml":
            caps.append("cb.missing.fiml")
        if a.ipma is not None:
            caps.append("ipma.construct")
        return caps

    def unsupported(self, model: SemModel, a: AnalysisConfiguration) -> list[dict[str, str]]:
        """Capabilities the request needs that the registry does not offer for the chosen engine."""
        out = []
        if a.method != "cb-sem" and a.estimator != "pls-pm":
            out.append({"capability": f"estimator:{a.estimator}", "status": "unknown"})
        for cap in self.required_capabilities(model, a):
            st = self.status(cap, a.engine)
            if st not in OFFERED:
                out.append({"capability": cap, "status": st})
        return out
