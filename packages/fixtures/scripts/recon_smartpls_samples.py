#!/usr/bin/env python3
"""Reconnaissance of the SmartPLS sample folders in TEMP/ (Phase 0, data recon).

Writes machine-readable evidence to docs/validation/phase-0/evidence/data/:

    inventory.json                 every file, its size, its kind, what the plain ones contain
    parsing-facts.json             physical format of the six delimited data files
    settings-facts.json            what the plain-JSON *.settings side files say
    structural-path-search.json    search for construct-to-construct information (none exists)
    stored-correlations-check.json how the stored indicatorCorrelations were computed

Usage (repository root, standard library only):

    uv run --python 3.12 python packages/fixtures/scripts/recon_smartpls_samples.py

The encrypted project files (*.splsm, *.splscb, *.splspm, *.splsge, *.splsrm) are listed by
name and size only (os.stat). They are never opened; `read_plain()` refuses them. Whether they
are in fact encrypted is therefore NOT verified here - they are treated as such because the
architecture ground rules say so. No data row is printed or written to the evidence files.
"""

from __future__ import annotations

import collections
import hashlib
import json
import math
import re
import sys
from decimal import Decimal
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TEMP = REPO / "TEMP"
EVIDENCE = REPO / "docs" / "validation" / "phase-0" / "evidence" / "data"
ENCRYPTED_SUFFIXES = (".splsm", ".splscb", ".splspm", ".splsge", ".splsrm")
PROJECT_KIND = {
    ".splsm": "PLS-SEM model",
    ".splscb": "CB-SEM model",
    ".splspm": "path analysis / PROCESS model",
    ".splsge": "GSCA model",
    ".splsrm": "regression model",
}
SEPARATORS = {"SEMICOLON": ";", "COMMA": ",", "TAB": "\t"}
SENTINELS = ["-999", "-99", "-9", "-1", "98", "99", "999", "9999", "99999"]
STRUCTURE_KEY_RE = re.compile(
    r"from|to$|source|target|path|edge|arrow|relation|connection|inner|outer|predecessor|successor|"
    r"structural|exogenous|endogenous|dependent|independent|construct|latent|lv",
    re.IGNORECASE,
)


def read_plain(path: Path) -> bytes:
    if path.suffix.lower() in ENCRYPTED_SUFFIXES:
        raise RuntimeError(f"refusing to open encrypted SmartPLS project file: {path.name}")
    return path.read_bytes()


def load_json_lenient(path: Path):
    """Returns (object with non-finite numbers as None, number of NaN/Infinity tokens, strict-JSON ok?)."""
    text = read_plain(path).decode("utf-8")
    tokens = []
    obj = json.loads(text, parse_constant=lambda t: tokens.append(t) or float("nan"))

    def clean(node):
        if isinstance(node, dict):
            return {k: clean(v) for k, v in node.items()}
        if isinstance(node, list):
            return [clean(v) for v in node]
        if isinstance(node, float) and not math.isfinite(node):
            return None
        return node

    return clean(obj), len(tokens), len(tokens) == 0


def dump(name: str, obj) -> None:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    print(f"wrote docs/validation/phase-0/evidence/data/{name}")


def leaves(node, where=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from leaves(v, f"{where}.{k}" if where else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from leaves(v, f"{where}[{i}]")
    else:
        yield where, node


def blocks_of(settings: dict):
    out = {}
    for section, body in settings.items():
        if isinstance(body, dict) and isinstance(body.get("initialWeights"), list):
            blocks = collections.OrderedDict()
            for entry in body["initialWeights"]:
                blocks.setdefault(entry["lv"], []).append(entry["mv"])
            out[section] = blocks
    return out


def read_table(path: Path, sep: str):
    raw = read_plain(path)
    text = raw.decode("utf-8")
    crlf = text.count("\r\n")
    lf_only = text.count("\n") - crlf
    lines = text.split("\n")
    ends_nl = lines[-1] == ""
    if ends_nl:
        lines = lines[:-1]
    lines = [ln[:-1] if ln.endswith("\r") else ln for ln in lines]
    header = lines[0].split(sep)
    rows = [ln.split(sep) for ln in lines[1:]]
    phys = {
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "encoding": "ASCII (all bytes < 128)" if all(b < 128 for b in raw) else "non-ASCII bytes present",
        "byteOrderMark": raw[:3] == b"\xef\xbb\xbf",
        "lineTerminator": "CRLF" if crlf and not lf_only else ("LF" if lf_only and not crlf else "mixed"),
        "endsWithNewline": ends_nl,
        "physicalLines": len(lines),
        "blankLines": sum(1 for ln in lines if ln == ""),
        "quoteCharactersPresent": ('"' in text) or ("'" in text),
        "commaCharactersPresent": "," in text,
        "tabCharactersPresent": "\t" in text,
    }
    return phys, header, rows


# ----------------------------------------------------------------- statistics helpers


def pearson(xs, ys):
    n = len(xs)
    mx = math.fsum(xs) / n
    my = math.fsum(ys) / n
    sxx = math.fsum((x - mx) ** 2 for x in xs)
    syy = math.fsum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return math.fsum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(sxx * syy)


def hybrid(xs_pair, ys_pair, sd_x_all, sd_y_all):
    """Pairwise covariance (divisor = pairwise n) over the product of the population SDs of ALL valid values."""
    n = len(xs_pair)
    if n == 0 or sd_x_all == 0 or sd_y_all == 0:
        return None
    mx = math.fsum(xs_pair) / n
    my = math.fsum(ys_pair) / n
    cov = math.fsum((x - mx) * (y - my) for x, y in zip(xs_pair, ys_pair)) / n
    return cov / (sd_x_all * sd_y_all)


def pop_sd(xs):
    n = len(xs)
    m = math.fsum(xs) / n
    return math.sqrt(math.fsum((x - m) ** 2 for x in xs) / n)


# --------------------------------------------------------------------------- main


def main() -> int:
    folders = sorted(p for p in TEMP.iterdir() if p.is_dir())
    inventory = {
        "root": "TEMP",
        "note": "Encrypted project files are listed by name and size only (os.stat) and were never opened; their being encrypted is taken from the architecture ground rules, not verified here.",
        "folders": [],
    }
    parsing = {}
    settings_facts = {"dataSettings": {}, "modelSettings": {}}
    search = {
        "question": "Do the plain-JSON side files contain construct-to-construct (structural) information?",
        "method": [
            "Collect every construct name from every initialWeights list of the folder.",
            "Walk every leaf of every plain-JSON side file (*.settings, *.ok).",
            "A: record each string leaf that equals a construct name (or contains one of 6+ characters).",
            "B: record each JSON object or array element that holds two or more different construct names.",
            "C: record every key whose name hints at structure and summarise its values.",
        ],
        "folders": {},
    }
    corr_check = {
        "definitionPlain": "Pearson r on the rows where both columns are present.",
        "definitionHybrid": "cov over pairwise-complete rows (pairwise means, divisor = pairwise n) divided by the product of the two population SDs computed from ALL valid values of each column. With no missing data this equals Pearson r; with missing data it can leave [-1, 1].",
        "datasets": {},
    }
    type_by_unique = collections.defaultdict(collections.Counter)

    for folder in folders:
        entry = {"folder": folder.name, "files": []}
        constructs = set()
        plain_json = {}
        for path in sorted(folder.iterdir()):
            if path.name == ".DS_Store":
                continue
            size = path.stat().st_size
            suffix = path.suffix.lower()
            rec = {"name": path.name, "bytes": size}
            if suffix in ENCRYPTED_SUFFIXES:
                rec.update(
                    kind="smartpls-project (encrypted per ground rule 6)",
                    opened=False,
                    describes=PROJECT_KIND[suffix],
                    usableInformation="none - not opened",
                )
            elif size == 0:
                rec.update(kind="empty file", opened=True, usableInformation="none (0 bytes)")
            elif suffix in (".settings", ".ok"):
                obj, n_nan, strict = load_json_lenient(path)
                plain_json[path.name] = obj
                rec.update(kind="plain JSON", opened=True, strictJson=strict, nanTokens=n_nan)
                if path.name.endswith(".ok"):
                    rec["usableInformation"] = f"case count and covariance flag: {json.dumps(obj)}"
                elif path.name.endswith(".txt.settings"):
                    rec["usableInformation"] = (
                        "separator, missing-value marker, locale, group definitions, per-column descriptive statistics, "
                        "scale type and scale min/max, indicator correlation matrix"
                    )
                else:
                    b = blocks_of(obj)
                    for blocks in b.values():
                        constructs.update(blocks)
                    rec["sections"] = len(obj)
                    rec["indicatorBlocksUnder"] = sorted(b) or None
                    rec["usableInformation"] = (
                        "algorithm settings"
                        + ("; indicator -> construct assignment (initialWeights)" if b else "; no indicator assignment (initialWeights is null)")
                    )
            elif suffix == ".txt":
                rec.update(kind="delimited text data", opened=True, usableInformation="the data matrix (see parsing-facts.json)")
            elif suffix == ".jpg":
                rec.update(kind="JPEG image", opened=True, usableInformation="book cover; the file name carries the ISBN or edition tag")
            else:
                rec.update(kind="unknown", opened=False)
            entry["files"].append(rec)
        entry["counts"] = dict(collections.Counter(f["kind"] for f in entry["files"]))
        inventory["folders"].append(entry)

        # ---------------- model settings facts + structural search
        hits_a, hits_b, hits_c = [], [], collections.OrderedDict()
        for name, obj in plain_json.items():
            if name.endswith(".ok"):
                continue
            if not name.endswith(".txt.settings"):
                b = blocks_of(obj)
                ds = obj.get("dataSettings", {})
                boot = obj.get("bootstrappingAlgorithmSettings", {})
                pls = obj.get("plsAlgorithmSettings", {})
                ipa = obj.get("ipaAlgorithmSettings", {})
                cb = obj.get("cbsemBasicAlgorithmSettings", {})
                settings_facts["modelSettings"][f"{folder.name}/{name}"] = {
                    "sections": len(obj),
                    "missingDataAlgorithm": ds.get("algorithm"),
                    "modelName": ds.get("modelName"),
                    "selectedGroups": ds.get("selectedGroups"),
                    "weightingVector": ds.get("weightingVector"),
                    "pls": {k: pls.get(k) for k in ("weightingScheme", "maxIterations", "stopCriterium", "initialWeightsStrategy", "standardizationOption")},
                    "bootstrap": {k: boot.get(k) for k in ("samples", "confidenceIntervalMethod", "significanceLevel", "testType", "bootstrappingComplexity", "seedType")},
                    "ipma": {k: ipa.get(k) for k in ("construct", "depth")},
                    "cbsem": {k: cb.get(k) for k in ("startingValueStrategy", "meanStructureStrategy", "maximumIterations", "epsilon", "delta")},
                    "predict": {k: obj.get("predictSettings", {}).get(k) for k in ("folds", "repetitions", "predictionType")},
                    "permutation": {k: obj.get("permutationAlgorithmSettings", {}).get(k) for k in ("samples", "significanceLevel", "testType")},
                    "indicatorBlocks": {sec: {lv: mvs for lv, mvs in blocks.items()} for sec, blocks in b.items()} or None,
                    "distinctStoredWeights": sorted({e["weight"] for body in obj.values() if isinstance(body, dict) and isinstance(body.get("initialWeights"), list) for e in body["initialWeights"]}),
                }
            # A + C over leaves
            for where, value in leaves(obj):
                key = re.sub(r"\[\d+\]", "", where).split(".")[-1]
                if isinstance(value, str):
                    for c in constructs:
                        if value == c or (len(c) >= 6 and c in value):
                            hits_a.append({"file": name, "jsonPath": re.sub(r"\[\d+\]", "[]", where), "construct": c})
                if STRUCTURE_KEY_RE.search(key) and not where.startswith("indicators") and not where.startswith("indicatorCorrelations"):
                    slot = hits_c.setdefault(key, {"occurrences": 0, "distinctValues": set()})
                    slot["occurrences"] += 1
                    slot["distinctValues"].add(json.dumps(value))

            # B: objects holding two or more different construct names
            def walk(node, where=""):
                if isinstance(node, dict):
                    direct = {v for v in node.values() if isinstance(v, str) and v in constructs}
                    if len(direct) >= 2:
                        hits_b.append({"file": name, "jsonPath": where, "constructs": sorted(direct)})
                    for k, v in node.items():
                        walk(v, f"{where}.{k}" if where else k)
                elif isinstance(node, list):
                    direct = {v for v in node if isinstance(v, str) and v in constructs}
                    if len(direct) >= 2:
                        hits_b.append({"file": name, "jsonPath": where, "constructs": sorted(direct)})
                    for i, v in enumerate(node):
                        walk(v, f"{where}[{i}]")

            walk(obj)

        a_summary = collections.Counter((h["file"], h["jsonPath"]) for h in hits_a)
        search["folders"][folder.name] = {
            "constructNames": sorted(constructs),
            "plainJsonFilesSearched": sorted(plain_json),
            "A_constructNameOccurrences": [{"file": f, "jsonPath": p, "count": n} for (f, p), n in sorted(a_summary.items())],
            "A_onlyInsideInitialWeightsLv": all(p.endswith("initialWeights[].lv") for (_, p) in a_summary),
            "B_objectsWithTwoOrMoreConstructNames": hits_b,
            "C_structureLikeKeys": {
                k: {"occurrences": v["occurrences"], "distinctValues": sorted(v["distinctValues"])[:12], "nDistinctValues": len(v["distinctValues"])}
                for k, v in sorted(hits_c.items())
            },
            "structuralPathsFound": bool(hits_b) or not all(p.endswith("initialWeights[].lv") for (_, p) in a_summary),
        }

        # ---------------- data files
        for path in sorted(folder.glob("*.txt")):
            st = plain_json[path.name + ".settings"]
            ok = plain_json[path.name + ".ok"]
            sep = SEPARATORS[st["separator"]]
            phys, header, rows = read_table(path, sep)
            key = f"{folder.name}/{path.name}"
            stored = {s["name"]: s for s in st["indicators"]}
            field_counts = collections.Counter(len(r) for r in rows)
            cells = [c for r in rows for c in r]
            nonempty = [c for c in cells if c != ""]
            frac_len = collections.Counter(len(c.split(".")[1]) if "." in c else 0 for c in nonempty)
            non_numeric = sum(1 for c in nonempty if not re.match(r"^-?\d+(\.\d+)?$", c))
            per_col = []
            for j, name in enumerate(header):
                col = [r[j] for r in rows]
                present = [c for c in col if c != ""]
                vals = [Decimal(c) for c in present]
                uniq = set(vals)
                s = stored[name]
                scale = s["scaleInformation"]
                type_by_unique[len(uniq)][scale["type"]] += 1
                per_col.append(
                    {
                        "name": name,
                        "emptyFields": len(col) - len(present),
                        "storedNumberOfMissingValues": s["numberOfMissingValues"],
                        "missingCountMatches": len(col) - len(present) == s["numberOfMissingValues"],
                        "nUnique": len(uniq),
                        "constant": len(uniq) == 1,
                        "allIntegers": all(v == v.to_integral_value() for v in vals),
                        "observedMin": float(min(vals)),
                        "observedMax": float(max(vals)),
                        "scaleType": scale["type"],
                        "scaleMin": scale["minValue"],
                        "scaleMax": scale["maxValue"],
                        "scaleEqualsObserved": float(min(vals)) == scale["minValue"] and float(max(vals)) == scale["maxValue"],
                        "sentinelLikeValues": {t: n for t in SENTINELS if (n := sum(1 for v in vals if v == Decimal(t)))},
                    }
                )
            seen = set()
            dup = 0
            for r in rows:
                t = tuple(r)
                dup += t in seen
                seen.add(t)
            parsing[key] = {
                "physical": phys,
                "delimiter": {"declaredInSettings": st["separator"], "character": sep, "fieldsPerDataRow": dict(field_counts), "headerFields": len(header)},
                "header": {"present": True, "names": header, "allNamesAreIdentifiers": all(re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", h) for h in header)},
                "rows": len(rows),
                "columns": len(header),
                "okFileCases": ok["cases"],
                "settingsNumberOfCases": st["numberOfCases"],
                "rowCountMatchesOkFile": len(rows) == ok["cases"] == st["numberOfCases"],
                "decimal": {
                    "separator": ".",
                    "fractionDigitsOfNonEmptyCells": {str(k): v for k, v in sorted(frac_len.items())},
                    "negativeValues": sum(1 for c in nonempty if c.startswith("-")),
                    "thousandsSeparators": False,
                },
                "missing": {
                    "declaredMarkerInSettings": st["missingValue"],
                    "physicalEncoding": "empty field (two adjacent delimiters, or a delimiter at the end of the line)",
                    "emptyFields": len(cells) - len(nonempty),
                    "whitespaceOnlyFields": sum(1 for c in cells if c != "" and c.strip() == ""),
                    "storedNumberOfMissingValues": st["numberOfMissingValues"],
                    "matchesStoredTotal": len(cells) - len(nonempty) == st["numberOfMissingValues"],
                    "matchesStoredPerColumn": all(c["missingCountMatches"] for c in per_col),
                    "completeRows": sum(1 for r in rows if all(c != "" for c in r)),
                    "columnsWithMissing": [c["name"] for c in per_col if c["emptyFields"]],
                },
                "nonNumericCells": non_numeric,
                "constantColumns": [c["name"] for c in per_col if c["constant"]],
                "columnsWithFractionalValues": [c["name"] for c in per_col if not c["allIntegers"]],
                "duplicateRows": dup,
                "columnsWhereScaleDiffersFromObserved": [c["name"] for c in per_col if not c["scaleEqualsObserved"]],
                "perColumn": per_col,
            }

            groups = st["groupModel"]["groups"]
            settings_facts["dataSettings"][key + ".settings"] = {
                "topLevelKeys": list(st),
                "separator": st["separator"],
                "missingValue": st["missingValue"],
                "escapeSign": st["escapeSign"],
                "locale": st["locale"],
                "covarianceData": st.get("covarianceData"),
                "numberOfIndicators": st["numberOfIndicators"],
                "numberOfCases": st["numberOfCases"],
                "numberOfMissingValues": st["numberOfMissingValues"],
                "scaleTypes": dict(collections.Counter(s["scaleInformation"]["type"] for s in st["indicators"])),
                "perIndicatorKeys": sorted({k for s in st["indicators"] for k in s}),
                "hasUniqueValuesLists": any("uniqueValues" in s for s in st["indicators"]),
                "groups": [
                    {"name": g["name"], "logic": g["logic"], "terms": [f"{t['name']} {t['operator']} {t['leftTerm']}" for t in g["terms"]], "hits": g["hits"]}
                    for g in groups
                ],
            }

            # ---------------- stored correlations
            ic = st["indicatorCorrelations"]
            p = len(header)
            C = [ic["values"][i * p : (i + 1) * p] for i in range(p)]
            num = [[(float(c) if c != "" else None) for c in (r[j] for r in rows)] for j in range(p)]
            sds = [pop_sd([v for v in col if v is not None]) for col in num]
            lower_all_zero = all(C[i][j] == 0 for i in range(p) for j in range(i))
            symmetric = all(C[i][j] == C[j][i] for i in range(p) for j in range(i))
            dev_plain = dev_hybrid = 0.0
            n_plain = n_hybrid = 0
            out_of_range, stored_null, zero_for_constant = [], [], 0
            for i in range(p):
                for j in range(i, p):
                    s_val = C[i][j]
                    pair = [(a, b) for a, b in zip(num[i], num[j]) if a is not None and b is not None]
                    xs = [a for a, _ in pair]
                    ys = [b for _, b in pair]
                    if s_val is None:
                        stored_null.append({"a": header[i], "b": header[j], "pairwiseN": len(pair)})
                        continue
                    if sds[i] == 0 or sds[j] == 0:
                        zero_for_constant += s_val == 0
                        continue
                    if abs(s_val) > 1 + 1e-9:
                        out_of_range.append({"a": header[i], "b": header[j], "stored": s_val, "pairwiseN": len(pair)})
                    h = hybrid(xs, ys, sds[i], sds[j])
                    if h is not None:
                        dev_hybrid = max(dev_hybrid, abs(h - s_val))
                        n_hybrid += 1
                    r = pearson(xs, ys) if len(pair) >= 2 else None
                    if r is not None:
                        dev_plain = max(dev_plain, abs(r - s_val))
                        n_plain += 1
            corr_check["datasets"][key] = {
                "matrixOrder": p,
                "storedLayout": "full symmetric matrix" if symmetric and not lower_all_zero else ("upper triangle incl. diagonal; lower triangle stored as 0.0" if lower_all_zero else "other"),
                "missingCells": st["numberOfMissingValues"],
                "upperTriangleCellsCompared": {"hybrid": n_hybrid, "plainPairwisePearson": n_plain},
                "maxAbsDeviation": {"hybrid": dev_hybrid, "plainPairwisePearson": dev_plain},
                "storedOutsideMinus1Plus1": out_of_range,
                "storedNull_wasNaN": stored_null,
                "cellsInvolvingAConstantColumnStoredAsZero": zero_for_constant,
                "diagonalRange": [min(C[i][i] for i in range(p) if C[i][i] is not None), max(C[i][i] for i in range(p) if C[i][i] is not None)],
            }

    settings_facts["scaleTypeByNumberOfUniqueValues"] = {
        "note": "Observed association across the six data files (columns counted). Not a documented SmartPLS rule.",
        "table": {str(k): dict(v) for k, v in sorted(type_by_unique.items())},
    }
    all_models = settings_facts["modelSettings"]
    settings_facts["distinctValuesAcrossModelSettings"] = {
        field: sorted({json.dumps(m[group][field]) for m in all_models.values()})
        for group, field in (
            ("bootstrap", "samples"),
            ("bootstrap", "confidenceIntervalMethod"),
            ("bootstrap", "significanceLevel"),
            ("bootstrap", "testType"),
            ("bootstrap", "seedType"),
            ("pls", "weightingScheme"),
            ("pls", "maxIterations"),
            ("pls", "stopCriterium"),
            ("pls", "standardizationOption"),
            ("ipma", "construct"),
            ("ipma", "depth"),
            ("cbsem", "maximumIterations"),
            ("cbsem", "meanStructureStrategy"),
        )
    }
    settings_facts["distinctValuesAcrossModelSettings"]["missingDataAlgorithm"] = sorted({json.dumps(m["missingDataAlgorithm"]) for m in all_models.values()})
    search["conclusion"] = (
        "No structural path information exists in plain form."
        if not any(f["structuralPathsFound"] for f in search["folders"].values())
        else "Structural information was found - inspect the hits."
    )

    dump("inventory.json", inventory)
    dump("parsing-facts.json", parsing)
    dump("settings-facts.json", settings_facts)
    dump("structural-path-search.json", search)
    dump("stored-correlations-check.json", corr_check)

    # compact console summary (no data values)
    for key, facts in parsing.items():
        m = facts["missing"]
        print(
            f"{key}: {facts['rows']}x{facts['columns']} ok={facts['okFileCases']} {facts['physical']['lineTerminator']} "
            f"empty={m['emptyFields']} (stored {m['storedNumberOfMissingValues']}) nonNumeric={facts['nonNumericCells']} "
            f"constant={facts['constantColumns']} scale!=observed={len(facts['columnsWhereScaleDiffersFromObserved'])}"
        )
    for key, c in corr_check["datasets"].items():
        print(f"{key}: corr layout={c['storedLayout']!r} maxdev hybrid={c['maxAbsDeviation']['hybrid']:.2e} plain={c['maxAbsDeviation']['plainPairwisePearson']:.2e} |r|>1: {len(c['storedOutsideMinus1Plus1'])}")
    print(search["conclusion"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
