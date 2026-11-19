#!/usr/bin/env python3
"""Build the third-party example fixtures from the SmartPLS sample folders in TEMP/.

Reads   TEMP/Example - */  (plain delimited data files and plain-JSON *.settings / *.ok
        side files only) and packages/fixtures/scripts/third_party_sources.json
Writes  packages/fixtures/third-party/smartpls-samples/<slug>/
            data.csv  columns.json  manifest.json  reference-descriptives.json
            measurement.json   (when a *.splsm.settings file lists indicator blocks)
            groups.json        (when the data settings define groups)
            proposed-model.json (when third_party_sources.json carries a proposal)
        packages/fixtures/third-party/smartpls-samples/index.json
        packages/fixtures/third-party/smartpls-samples/PROVENANCE.md

Usage (from the repository root; standard library only, no packages needed):

    uv run --python 3.12 python packages/fixtures/scripts/build_third_party.py
    uv run --python 3.12 python packages/fixtures/scripts/build_third_party.py --check

--check builds everything in memory and exits 1 if any file on disk differs.

Rules this script enforces:

* The encrypted SmartPLS project files (*.splsm, *.splscb, *.splspm, *.splsge, *.splsrm)
  are never opened. Every read goes through `read_plain()`, which refuses them.
* Deterministic and idempotent: no timestamps, no random ids, fixed key order,
  LF line endings. Two runs produce byte-identical files.
* Nothing is dropped, reordered or imputed. Missing values stay missing (empty field).
* No row of data is ever printed.
* Output JSON never contains NaN/Infinity (architecture ground rule 5): non-finite
  numbers in the source become null with a machine-readable reason.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import sys
from decimal import Decimal
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SCRIPT_REL = "packages/fixtures/scripts/build_third_party.py"
CONFIG_REL = "packages/fixtures/scripts/third_party_sources.json"
DEFAULT_TEMP = REPO / "TEMP"
DEFAULT_OUT = REPO / "packages" / "fixtures" / "third-party" / "smartpls-samples"

ENCRYPTED_SUFFIXES = (".splsm", ".splscb", ".splspm", ".splsge", ".splsrm")
SEPARATORS = {"SEMICOLON": ";", "COMMA": ",", "TAB": "\t"}
NUMBER_RE = re.compile(r"^-?\d+(\.\d+)?$")
SAFE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
CODE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")

DESCRIPTIVE_CONVENTIONS = {
    "scope": "Every statistic is computed per column over its non-missing values only.",
    "n": "Number of non-missing values (source: numberOfRecords - numberOfMissingValues; numberOfRecords is the row count).",
    "mean": "Arithmetic mean.",
    "median": "Upper median: with the values sorted ascending and 0-based indexing, x[floor(n/2)]. For even n this is the LARGER of the two middle values, not their average.",
    "standardDeviation": "Population standard deviation, sqrt(sum((x-mean)^2)/n) (divisor n, not n-1).",
    "skewness": "Adjusted Fisher-Pearson coefficient G1 = g1*sqrt(n*(n-1))/(n-2) with g1 = m3/m2^1.5 and m_k the k-th central moment with divisor n. Same as Excel SKEW, SPSS, pandas Series.skew(), scipy.stats.skew(bias=False).",
    "kurtosis": "Sample excess kurtosis G2 = (n-1)/((n-2)*(n-3))*((n+1)*g2+6) with g2 = m4/m2^2-3. Same as Excel KURT, SPSS, pandas Series.kurt(), scipy.stats.kurtosis(bias=False).",
    "min": "Smallest non-missing value.",
    "max": "Largest non-missing value.",
    "cramerVonMisesP": "p-value of the Cramer-von Mises test of normality. z_i=(x_(i)-mean)/sd with the POPULATION sd (divisor n); W = 1/(12n) + sum_i (Phi(z_i) - (2i-1)/(2n))^2; W* = W*(1+0.5/n); p = 1-exp(-13.953+775.5W*-12542.61W*^2) if W*<0.0275; 1-exp(-5.903+179.546W*-1515.29W*^2) if W*<0.051; exp(0.886-31.62W*+10.897W*^2) if W*<0.092; exp(1.111-34.242W*+12.832W*^2) if W*<1.1; otherwise the floor 7.37e-10. This is the algorithm of R nortest::cvm.test (Stephens 1986) except that nortest standardises with the n-1 sd and refuses n<8. A zero-variance column stores the floor 7.37e-10.",
    "zeroVariance": "For a constant column the source stores standardDeviation 0, skewness NaN and kurtosis NaN; here NaN is written as null with a reason.",
    "verification": "Recomputed from data.csv by packages/fixtures/scripts/verify_descriptives.py; see docs/validation/phase-0/evidence/data/descriptives-check.json.",
}


class BuildError(RuntimeError):
    pass


# --------------------------------------------------------------------------- reading


def read_plain(path: Path) -> bytes:
    """Read a plain side file or data file. Refuses the encrypted project files."""
    if path.suffix.lower() in ENCRYPTED_SUFFIXES:
        raise BuildError(f"refusing to open encrypted SmartPLS project file: {path.name}")
    return path.read_bytes()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_settings_json(path: Path):
    """Parse a *.settings file. SmartPLS writes bare NaN, which strict JSON forbids.

    Returns (object with NaN/Infinity replaced by None, list of JSON paths that were non-finite).
    """
    text = read_plain(path).decode("utf-8")
    obj = json.loads(text, parse_constant=lambda token: float("nan"))
    non_finite: list[str] = []

    def clean(node, where):
        if isinstance(node, dict):
            return {k: clean(v, f"{where}.{k}" if where else k) for k, v in node.items()}
        if isinstance(node, list):
            return [clean(v, f"{where}[{i}]") for i, v in enumerate(node)]
        if isinstance(node, float) and not math.isfinite(node):
            non_finite.append(where)
            return None
        return node

    return clean(obj, ""), non_finite


def read_source_table(path: Path, separator: str):
    """Parse a delimited SmartPLS data file. Returns a dict of physical facts and the cells as text."""
    raw = read_plain(path)
    text = raw.decode("utf-8")  # strict: fails loudly on anything that is not UTF-8/ASCII
    has_bom = text.startswith("﻿")
    if has_bom:
        text = text[1:]
    crlf = text.count("\r\n")
    lf_only = text.count("\n") - crlf
    lines = text.split("\n")
    ends_with_newline = lines[-1] == ""
    if ends_with_newline:
        lines = lines[:-1]
    lines = [ln[:-1] if ln.endswith("\r") else ln for ln in lines]
    if any(ln == "" for ln in lines):
        raise BuildError(f"{path.name}: blank line inside the file")
    if '"' in text or "'" in text:
        raise BuildError(f"{path.name}: quote characters present; this parser assumes none")
    header = lines[0].split(separator)
    if len(set(header)) != len(header):
        raise BuildError(f"{path.name}: duplicate column names")
    rows = [ln.split(separator) for ln in lines[1:]]
    for i, row in enumerate(rows):
        if len(row) != len(header):
            raise BuildError(f"{path.name}: data row {i + 1} has {len(row)} fields, expected {len(header)}")
        for j, cell in enumerate(row):
            if cell != "" and not NUMBER_RE.match(cell):
                raise BuildError(f"{path.name}: non-numeric cell in column {header[j]!r} (row {i + 1})")
    facts = {
        "bytes": len(raw),
        "sha256": sha256_bytes(raw),
        "encoding": "ASCII" if all(b < 128 for b in raw) else "UTF-8",
        "byteOrderMark": has_bom,
        "lineTerminator": "CRLF" if crlf and not lf_only else ("LF" if lf_only and not crlf else "mixed"),
        "endsWithNewline": ends_with_newline,
    }
    return facts, header, rows


# ------------------------------------------------------------------------ formatting


def minimal_number(cell: str) -> str:
    """'7.000000000000' -> '7', '8.500000000000' -> '8.5', '1.666666666667' unchanged."""
    d = Decimal(cell)
    out = "0" if d == 0 else format(d.normalize(), "f")
    if float(out) != float(cell):
        raise BuildError(f"minimal formatting changed the value of {cell!r}")
    return out


def json_number(cell: str):
    """Exact JSON number for a source cell: int when integral, else the double nearest the text."""
    d = Decimal(cell)
    return int(d) if d == d.to_integral_value() else float(cell)


def tidy_float(value):
    """Stored doubles such as 1.0 -> 1 for readability; other values unchanged (full precision)."""
    if isinstance(value, float) and math.isfinite(value) and value == int(value) and abs(value) < 2**53:
        return int(value)
    return value


def dump_json(obj) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def dump_csv(header, rows) -> bytes:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, delimiter=",", quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow(["" if cell == "" else minimal_number(cell) for cell in row])
    return buf.getvalue().encode("utf-8")


# --------------------------------------------------------------------- per-dataset


def indicator_blocks(settings: dict):
    """Return {section: ordered {construct name: [indicators]}} for every initialWeights list in a model settings file."""
    found = {}
    for section, body in settings.items():
        if isinstance(body, dict) and isinstance(body.get("initialWeights"), list):
            blocks: dict[str, list[str]] = {}
            for entry in body["initialWeights"]:
                if set(entry) != {"mv", "lv", "weight"}:
                    raise BuildError(f"unexpected keys in initialWeights entry: {sorted(entry)}")
                blocks.setdefault(entry["lv"], []).append(entry["mv"])
            found[section] = blocks
    return found


def check_acyclic(nodes, paths, what):
    incoming = {n: 0 for n in nodes}
    out = {n: [] for n in nodes}
    seen = set()
    for p in paths:
        a, b = p["from"], p["to"]
        if a not in incoming or b not in incoming:
            raise BuildError(f"{what}: path {a} -> {b} uses an unknown construct")
        if a == b:
            raise BuildError(f"{what}: self-loop on {a}")
        if (a, b) in seen:
            raise BuildError(f"{what}: duplicate path {a} -> {b}")
        seen.add((a, b))
        out[a].append(b)
        incoming[b] += 1
    queue = [n for n in nodes if incoming[n] == 0]
    visited = 0
    while queue:
        n = queue.pop()
        visited += 1
        for m in out[n]:
            incoming[m] -= 1
            if incoming[m] == 0:
                queue.append(m)
    if visited != len(nodes):
        raise BuildError(f"{what}: structural model contains a cycle")
    connected = {p["from"] for p in paths} | {p["to"] for p in paths}
    if set(nodes) - connected:
        raise BuildError(f"{what}: constructs without any path: {sorted(set(nodes) - connected)}")


def build_dataset(cfg: dict, temp: Path, label: str):
    slug = cfg["slug"]
    folder = temp / cfg["folder"]
    data_path = folder / cfg["dataFile"]
    settings_path = folder / (cfg["dataFile"] + ".settings")
    ok_path = folder / (cfg["dataFile"] + ".ok")

    settings, non_finite = load_settings_json(settings_path)
    ok = json.loads(read_plain(ok_path).decode("utf-8"))
    separator = SEPARATORS[settings["separator"]]
    facts, header, rows = read_source_table(data_path, separator)

    # ---- consistency with the side files (fail loudly, never paper over)
    if len(rows) != ok["cases"] or len(rows) != settings["numberOfCases"]:
        raise BuildError(f"{slug}: {len(rows)} rows but .ok says {ok['cases']} and settings say {settings['numberOfCases']}")
    stored = settings["indicators"]
    if [s["name"] for s in stored] != header or settings["numberOfIndicators"] != len(header):
        raise BuildError(f"{slug}: header does not match the indicator list of the settings file")
    unsafe = [name for name in header if not SAFE_NAME_RE.match(name)]
    if unsafe:
        raise BuildError(f"{slug}: column names need escaping before use in generated code: {unsafe}")
    if settings["missingValue"] is not None:
        raise BuildError(f"{slug}: settings declare a missing-value marker {settings['missingValue']!r}; this builder only handles empty fields")

    columns = []
    reference_columns = []
    total_missing = 0
    for j, (name, s) in enumerate(zip(header, stored)):
        cells = [row[j] for row in rows]
        present = [c for c in cells if c != ""]
        values = [Decimal(c) for c in present]
        n_missing = len(cells) - len(present)
        total_missing += n_missing
        if not present:
            raise BuildError(f"{slug}: column {name} is entirely missing")
        lo_cell = min(present, key=Decimal)
        hi_cell = max(present, key=Decimal)
        if n_missing != s["numberOfMissingValues"]:
            raise BuildError(f"{slug}.{name}: {n_missing} empty fields but settings say {s['numberOfMissingValues']} missing")
        if float(lo_cell) != s["lowestValue"] or float(hi_cell) != s["highestValue"]:
            raise BuildError(f"{slug}.{name}: observed min/max differ from the stored lowestValue/highestValue")
        if s["numberOfRecords"] != len(rows) or s["numberOfStrings"] != 0 or s["errors"]:
            raise BuildError(f"{slug}.{name}: unexpected numberOfRecords/numberOfStrings/errors in settings")
        scale = s["scaleInformation"]
        columns.append(
            {
                "name": name,
                "scaleType": scale["type"],
                "scaleMin": tidy_float(scale["minValue"]),
                "scaleMax": tidy_float(scale["maxValue"]),
                "observedMin": json_number(lo_cell),
                "observedMax": json_number(hi_cell),
                "nMissing": n_missing,
                "nUnique": len(set(values)),
            }
        )
        ref = {
            "name": name,
            "n": len(present),
            "nMissing": n_missing,
            "mean": s["mean"],
            "median": tidy_float(s["median"]),
            "standardDeviation": tidy_float(s["standardDeviation"]),
            "skewness": s["skewNess"],
            "kurtosis": s["kurtosis"],
            "min": tidy_float(s["lowestValue"]),
            "max": tidy_float(s["highestValue"]),
            "cramerVonMisesP": s["cramerVanMises"],
        }
        reasons = {}
        for key in ("skewness", "kurtosis"):
            if ref[key] is None:
                reasons[key] = "zero-variance-column" if len(set(values)) == 1 else "non-finite-in-source"
        if reasons:
            ref["nullReasons"] = reasons
        reference_columns.append(ref)
    if total_missing != settings["numberOfMissingValues"]:
        raise BuildError(f"{slug}: {total_missing} empty fields but settings say {settings['numberOfMissingValues']}")

    files: dict[str, bytes] = {}
    files["data.csv"] = dump_csv(header, rows)
    files["columns.json"] = dump_json(columns)
    files["reference-descriptives.json"] = dump_json(
        {
            "dataset": slug,
            "source": {
                "file": settings_path.name,
                "fields": "indicators[].{mean, median, standardDeviation, skewNess, kurtosis, lowestValue, highestValue, cramerVanMises, numberOfRecords, numberOfMissingValues}",
                "note": "Values are copied verbatim (full double precision). The source spells the keys 'skewNess' and 'cramerVanMises'.",
            },
            "conventions": DESCRIPTIVE_CONVENTIONS,
            "columns": reference_columns,
        }
    )

    # ---- measurement model (indicator -> construct assignment only)
    measurement = None
    if cfg.get("measurementSettingsFile"):
        m_path = folder / cfg["measurementSettingsFile"]
        m_settings, _ = load_settings_json(m_path)
        blocks_by_section = indicator_blocks(m_settings)
        if list(blocks_by_section) != ["plsAlgorithmSettings"]:
            raise BuildError(f"{slug}: expected initialWeights only under plsAlgorithmSettings, found {list(blocks_by_section)}")
        blocks = blocks_by_section["plsAlgorithmSettings"]
        codes = cfg["constructCodes"]
        if set(codes) != set(blocks):
            raise BuildError(f"{slug}: constructCodes in the config do not cover the stored construct names {sorted(blocks)}")
        used = [codes[n]["code"] for n in blocks]
        if len(set(used)) != len(used) or not all(CODE_RE.match(c) for c in used):
            raise BuildError(f"{slug}: construct codes must be unique identifiers: {used}")
        assigned = [mv for mvs in blocks.values() for mv in mvs]
        if len(set(assigned)) != len(assigned):
            raise BuildError(f"{slug}: an indicator is assigned to more than one construct")
        if set(assigned) - set(header):
            raise BuildError(f"{slug}: indicators not present in the data file: {sorted(set(assigned) - set(header))}")
        alternates = {name: [] for name in blocks}
        cross_checks = []
        for other in cfg.get("crossCheckSettingsFiles", []):
            o_settings, _ = load_settings_json(folder / other)
            for section, o_blocks in indicator_blocks(o_settings).items():
                by_set = {frozenset(v): k for k, v in o_blocks.items()}
                same = {frozenset(v) for v in blocks.values()} == set(by_set)
                cross_checks.append({"file": other, "jsonPath": f"{section}.initialWeights", "sameIndicatorBlocks": same})
                for name, mvs in blocks.items():
                    other_name = by_set.get(frozenset(mvs))
                    if other_name is not None and other_name != name:
                        alternates[name].append({"file": other, "name": other_name})
        constructs = []
        for name, mvs in blocks.items():
            entry = {
                "name": name,
                "code": codes[name]["code"],
                "label": codes[name]["label"],
                "indicators": mvs,
            }
            if alternates[name]:
                entry["alternateNames"] = alternates[name]
            constructs.append(entry)
        measurement = {
            "dataset": slug,
            "source": {
                "file": m_path.name,
                "jsonPath": "plsAlgorithmSettings.initialWeights",
                "note": "Plain-JSON side file. It lists indicator -> construct assignments (every stored weight is 1.0). The encrypted project file was not opened.",
            },
            "notAvailableInPlainForm": [
                "structural paths between constructs",
                "measurement mode (reflective / formative, Mode A / Mode B)",
                "construct positions and any other diagram information",
            ],
            "naming": "'name' is the construct name exactly as stored. 'code' is SEM Lab's suggested short identifier and 'label' SEM Lab's reading of the abbreviation; neither is taken from the project file unless listed under alternateNames.",
            "constructs": constructs,
            "unassignedColumns": [name for name in header if name not in assigned],
            "crossChecks": cross_checks,
        }
        files["measurement.json"] = dump_json(measurement)

    # ---- groups
    groups = settings["groupModel"]["groups"]
    if groups:
        out_groups = []
        for g in groups:
            terms = []
            mask = [True] * len(rows)
            if g["logic"] != "AND":
                raise BuildError(f"{slug}: unsupported group logic {g['logic']}")
            for t in g["terms"]:
                if t["operator"] != "EQUALS" or t["rightTerm"] is not None:
                    raise BuildError(f"{slug}: unsupported group term {t}")
                j = header.index(t["name"])
                target = Decimal(t["leftTerm"])
                mask = [m and row[j] != "" and Decimal(row[j]) == target for m, row in zip(mask, rows)]
                terms.append({"column": t["name"], "operator": "EQUALS", "value": json_number(t["leftTerm"])})
            hits = sum(mask)
            if hits != g["hits"]:
                raise BuildError(f"{slug}: group {g['name']!r} has {hits} rows but settings say {g['hits']}")
            out_groups.append({"name": g["name"], "logic": g["logic"], "terms": terms, "n": hits})
        files["groups.json"] = dump_json(
            {
                "dataset": slug,
                "source": {"file": settings_path.name, "jsonPath": "groupModel.groups"},
                "note": "'n' is the stored hit count and was re-counted from data.csv during the build. Rows with a missing value in the grouping column belong to no group.",
                "groups": out_groups,
            }
        )

    # ---- proposed structural model (SEM Lab's own specification)
    proposal = cfg.get("proposedModel")
    if proposal:
        if measurement is None:
            raise BuildError(f"{slug}: a proposed model needs a measurement assignment")
        by_code = {c["code"]: c for c in measurement["constructs"]}
        if set(proposal["constructs"]) != set(by_code):
            raise BuildError(f"{slug}: proposal constructs {proposal['constructs']} differ from the measurement constructs {sorted(by_code)}")
        check_acyclic(proposal["constructs"], proposal["paths"], f"{slug}:{proposal['id']}")
        for variant in proposal.get("variants", []):
            nodes = list(proposal["constructs"]) + [c["code"] for c in variant.get("additionalConstructs", [])]
            for extra in variant.get("additionalConstructs", []):
                if set(extra["indicators"]) - set(header):
                    raise BuildError(f"{slug}:{variant['id']}: unknown indicator in additional construct")
            for code, mvs in variant.get("indicatorOverrides", {}).items():
                if code not in by_code or set(mvs) - set(header):
                    raise BuildError(f"{slug}:{variant['id']}: bad indicator override for {code}")
            check_acyclic(nodes, proposal["paths"] + variant.get("additionalPaths", []), f"{slug}:{variant['id']}")
        out_proposal = {
            "label": label,
            "status": "proposal-awaiting-architect-approval",
            "dataset": slug,
            "id": proposal["id"],
            "summary": proposal["summary"],
            "measurementMode": proposal["measurementMode"],
            "constructs": [
                {
                    "code": code,
                    "sourceName": by_code[code]["name"],
                    "label": by_code[code]["label"],
                    "indicators": by_code[code]["indicators"],
                }
                for code in proposal["constructs"]
            ],
            "paths": proposal["paths"],
        }
        if proposal.get("variants"):
            out_proposal["variants"] = proposal["variants"]
        out_proposal["citations"] = proposal["citations"]
        out_proposal["citationBasis"] = proposal["citationBasis"]
        out_proposal["notes"] = proposal["notes"]
        files["proposed-model.json"] = dump_json(out_proposal)

    # ---- manifest
    complete_rows = sum(1 for row in rows if all(c != "" for c in row))
    model_columns = [mv for c in measurement["constructs"] for mv in c["indicators"]] if measurement else []
    idx = [header.index(mv) for mv in model_columns]
    differs = [c["name"] for c in columns if (c["scaleMin"], c["scaleMax"]) != (c["observedMin"], c["observedMax"])]
    prov = cfg["provenance"]
    manifest = {
        "dataset": slug,
        "title": cfg["title"],
        "rows": len(rows),
        "columns": len(header),
        "dataFile": "data.csv",
        "sha256": sha256_bytes(files["data.csv"]),
        "format": {
            "encoding": "UTF-8",
            "delimiter": ",",
            "header": True,
            "lineTerminator": "LF",
            "decimalSeparator": ".",
            "missing": "empty field",
            "numbers": "shortest exact decimal form of the source text (integers without a decimal point)",
        },
        "source": {
            "folder": f"TEMP/{cfg['folder']}",
            "dataFile": cfg["dataFile"],
            "dataFileSha256": facts["sha256"],
            "dataFileBytes": facts["bytes"],
            "dataFileFormat": {
                "encoding": facts["encoding"],
                "byteOrderMark": facts["byteOrderMark"],
                "delimiter": settings["separator"],
                "lineTerminator": facts["lineTerminator"],
                "endsWithNewline": facts["endsWithNewline"],
                "missing": "empty field",
            },
            "settingsFile": settings_path.name,
            "caseCountFile": ok_path.name,
            "caseCount": ok["cases"],
            "measurementSettingsFile": cfg.get("measurementSettingsFile"),
            "nonFiniteNumbersInSettings": len(non_finite),
        },
        "missing": {
            "cells": total_missing,
            "columnsWithMissing": sum(1 for c in columns if c["nMissing"]),
            "completeRows": complete_rows,
            "completeRowsOnMeasurementIndicators": (
                sum(1 for row in rows if all(row[j] != "" for j in idx)) if measurement else None
            ),
        },
        "scaleEndpoints": {
            "source": "scaleInformation.minValue / maxValue of the data settings file",
            "columnsWhereScaleDiffersFromObserved": differs,
            "interpretation": (
                "The stored scale endpoints equal the observed minimum and maximum for every column: "
                "they are observed extrema, not verified theoretical endpoints."
                if not differs
                else "For the listed columns the stored endpoints differ from the observed extrema, "
                "so they were entered deliberately; for all other columns they equal the observed extrema."
            ),
        },
        "constantColumns": [c["name"] for c in columns if c["nUnique"] == 1],
        "redistribution": {
            "status": prov["status"],
            "licence": prov["licence"],
            "detail": "packages/fixtures/third-party/smartpls-samples/PROVENANCE.md",
        },
        "encryptedProjectFilesUsed": False,
        "buildScript": SCRIPT_REL,
        "buildConfig": CONFIG_REL,
        "files": {name: sha256_bytes(blob) for name, blob in sorted(files.items())},
    }
    if "attribution" in prov:
        manifest["redistribution"]["attribution"] = prov["attribution"]
    files["manifest.json"] = dump_json(manifest)
    return files, manifest


# -------------------------------------------------------------------- collection


def md_escape(text: str) -> str:
    return text.replace("|", "\\|")


def build_provenance_md(config: dict, manifests: dict) -> bytes:
    out = []
    w = out.append
    w("# Provenance of the SmartPLS sample datasets")
    w("")
    w("<!-- GENERATED by packages/fixtures/scripts/build_third_party.py from")
    w("     packages/fixtures/scripts/third_party_sources.json. Edit the JSON, not this file. -->")
    w("")
    w(f"Checked on {config['accessed']}. Every URL below was opened on that date; nothing is asserted from memory.")
    w("")
    w("The six datasets in this directory were converted from the delimited text files that the")
    w("project owner supplied in `TEMP/` (five SmartPLS 4 sample-project folders).")
    w("")
    w("**The encrypted SmartPLS project files were not used.** The files `*.splsm`, `*.splscb`,")
    w("`*.splspm`, `*.splsge` and `*.splsrm` were never opened, decoded, decrypted or")
    w("reverse-engineered. Only the delimited `*.txt` data files and the plain-JSON `*.settings` /")
    w("`*.ok` side files were read. Structural paths are therefore **not** taken from SmartPLS: the")
    w("`proposed-model.json` files are SEM Lab's own specifications from the published theory.")
    w("")
    w("## Status vocabulary")
    w("")
    for key, text in config["statusVocabulary"].items():
        w(f"- `{key}`: {text}")
    w("")
    w("A status is only ever raised when a source that was actually opened supports it.")
    w("")
    w("## Summary")
    w("")
    w("| Dataset | Rows x columns | Origin | Licence / terms found | Status |")
    w("|---|---|---|---|---|")
    for ds in config["datasets"]:
        m = manifests[ds["slug"]]
        p = ds["provenance"]
        w(
            f"| `{ds['slug']}` | {m['rows']} x {m['columns']} | {md_escape(p['origin'])} | "
            f"{md_escape(p['licence'])} | **{p['status']}** |"
        )
    w("")
    w("## Per dataset")
    for ds in config["datasets"]:
        m = manifests[ds["slug"]]
        p = ds["provenance"]
        w("")
        w(f"### `{ds['slug']}` — {ds['title']}")
        w("")
        w(f"- **Status:** `{p['status']}`")
        w(f"- **Source file:** `TEMP/{ds['folder']}/{ds['dataFile']}` (sha256 `{m['source']['dataFileSha256']}`)")
        w(f"- **Fixture:** `{ds['slug']}/data.csv`, {m['rows']} rows x {m['columns']} columns (sha256 `{m['sha256']}`)")
        w(f"- **Origin:** {p['origin']}")
        w(f"- **Licence / terms:** {p['licence']}")
        w(f"- **Identity check against an independent copy:** {p['identityCheck']}")
        if "attribution" in p:
            w(f"- **Required attribution:** {p['attribution']}")
        w(f"- **What would change the status:** {p['whatWouldUpgradeIt']}")
        w("- **URLs opened:**")
        for url in p["urlsOpened"]:
            w(f"  - <{url}>")
        w("- **References:**")
        for ref in p["references"]:
            w(f"  - {ref}")
    w("")
    w("## What this means for the example gallery")
    w("")
    ok = [d["slug"] for d in config["datasets"] if d["provenance"]["status"] == "redistributable-with-attribution"]
    hold = [d["slug"] for d in config["datasets"] if d["provenance"]["status"] != "redistributable-with-attribution"]
    w(f"- May be bundled in a public build with the attribution above: {', '.join(f'`{s}`' for s in ok) or 'none'}.")
    w(f"- Keep out of public builds until the owner clears the terms: {', '.join(f'`{s}`' for s in hold) or 'none'}.")
    w("  They can still be used locally as numerical fixtures.")
    w("")
    return ("\n".join(out)).encode("utf-8")


def build_all(temp: Path):
    config = json.loads((REPO / CONFIG_REL).read_text(encoding="utf-8"))
    outputs: dict[str, bytes] = {}
    manifests = {}
    index = []
    for ds in config["datasets"]:
        files, manifest = build_dataset(ds, temp, config["proposalLabel"])
        manifests[ds["slug"]] = manifest
        for name, blob in files.items():
            outputs[f"{ds['slug']}/{name}"] = blob
        index.append(
            {
                "slug": ds["slug"],
                "title": ds["title"],
                "rows": manifest["rows"],
                "columns": manifest["columns"],
                "sha256": manifest["sha256"],
                "missingCells": manifest["missing"]["cells"],
                "completeRows": manifest["missing"]["completeRows"],
                "hasMeasurement": "measurement.json" in files,
                "hasGroups": "groups.json" in files,
                "proposedModel": ds["proposedModel"]["id"] if ds.get("proposedModel") else None,
                "redistributionStatus": ds["provenance"]["status"],
            }
        )
    outputs["index.json"] = dump_json(
        {
            "collection": config["collection"],
            "buildScript": SCRIPT_REL,
            "buildConfig": CONFIG_REL,
            "encryptedProjectFilesUsed": False,
            "datasets": index,
        }
    )
    outputs["PROVENANCE.md"] = build_provenance_md(config, manifests)
    return outputs


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--temp", type=Path, default=DEFAULT_TEMP, help="folder with the SmartPLS sample folders")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output folder")
    parser.add_argument("--check", action="store_true", help="do not write; exit 1 if the files on disk differ")
    args = parser.parse_args(argv)

    try:
        outputs = build_all(args.temp)
    except BuildError as exc:
        print(f"BUILD FAILED: {exc}", file=sys.stderr)
        return 2

    changed = []
    for rel, blob in sorted(outputs.items()):
        target = args.out / rel
        same = target.exists() and target.read_bytes() == blob
        if not same:
            changed.append(rel)
            if not args.check:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(blob)
    for rel, blob in sorted(outputs.items()):
        print(f"{sha256_bytes(blob)}  {rel}")
    if args.check:
        if changed:
            print(f"CHECK FAILED: {len(changed)} file(s) differ from a fresh build: {changed}", file=sys.stderr)
            return 1
        print(f"check ok: {len(outputs)} files identical to a fresh build", file=sys.stderr)
    else:
        print(f"wrote {len(changed)} changed file(s), {len(outputs) - len(changed)} already up to date", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
