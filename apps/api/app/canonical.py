"""Canonical JSON, sha256 and model_hash; byte-identical to packages/contracts/src/hash.ts."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


def _number(v: float) -> str:
    """ECMAScript Number::toString for a finite double."""
    if not math.isfinite(v):
        raise ValueError("canonical_json: non-finite number")
    if v == 0:
        return "0"
    r = repr(float(v))  # shortest round-trip digits
    sign = "-" if r.startswith("-") else ""
    r = r.lstrip("-")
    # Extract digits and decimal exponent n such that value = 0.d1d2...dk * 10^n
    if "e" in r:
        mant, exp = r.split("e")
        e10 = int(exp)
    else:
        mant, e10 = r, 0
    if "." in mant:
        ip, fp = mant.split(".")
    else:
        ip, fp = mant, ""
    digits = (ip + fp).lstrip("0")
    # position of decimal point relative to start of ip+fp, adjusted for stripped leading zeros
    lead = len(ip + fp) - len((ip + fp).lstrip("0"))
    n = len(ip) - lead + e10
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        es = ("+" if e >= 0 else "-") + str(abs(e))
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + es
    return sign + out


def _string(s: str) -> str:
    # JSON.stringify: escape only ", \, and U+0000-U+001F; keep non-ASCII. Lone surrogates are not
    # produced by Python's JSON parser for valid input; json.dumps(ensure_ascii=False) matches otherwise.
    out = json.dumps(s, ensure_ascii=False)
    # JSON.stringify writes \u007f literally (as does json.dumps); both use short escapes \b \f \n \r \t.
    return out


def _key(s: str) -> list[int]:
    return [ord(c) for c in s]


def canonical_json(value: Any) -> str:
    return _write(value, "$")


def _write(v: Any, path: str) -> str:
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return _number(float(v)) if abs(v) >= 2**53 else str(v)
    if isinstance(v, float):
        return _number(v)
    if isinstance(v, str):
        return _string(v)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(_write(x, f"{path}[{i}]") for i, x in enumerate(v)) + "]"
    if isinstance(v, dict):
        items = sorted(((k, x) for k, x in v.items()), key=lambda kv: _key(kv[0]))
        return "{" + ",".join(f"{_string(k)}:{_write(x, f'{path}.{k}')}" for k, x in items) + "}"
    raise ValueError(f"canonical_json: unsupported {type(v).__name__} at {path}")


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _by_id(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda x: _key(x["id"]))


def _pick(d: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {k: d[k] for k in keys if k in d and d[k] is not None}


def scientific_projection(model: dict[str, Any]) -> dict[str, Any]:
    """Operates on the plain JSON model (absent optional keys are omitted, as undefined in TS)."""
    rels = []
    for r in _by_id(model["relationships"]):
        src, tgt = r["sourceId"], r["targetId"]
        if r["kind"] == "covariance" and _key(src) > _key(tgt):
            src, tgt = tgt, src
        rel = {"id": r["id"], "kind": r["kind"], "sourceId": src, "targetId": tgt}
        rel.update(_pick(r, ("parameterLabel", "fixedValue")))
        rels.append(rel)
    return {
        "constructs": [
            _pick(c, ("id", "name", "measurement", "indicatorIds", "plsWeightingMode", "higherOrder"))
            for c in _by_id(model["constructs"])
        ],
        "indicators": [
            _pick(i, ("id", "name", "column", "scale", "reverseScored", "level")) | {"column": i.get("column")}
            for i in _by_id(model["indicators"])
        ],
        "relationships": rels,
    }


def model_hash(model: dict[str, Any]) -> str:
    return sha256_hex(canonical_json(scientific_projection(model)))
