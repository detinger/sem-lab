#!/usr/bin/env python3
"""Reference test: recompute the descriptive statistics of every third-party fixture.

Reads only the built fixtures (data.csv + reference-descriptives.json), so it runs without
TEMP/. For every column it recomputes n, missing count, mean, median, standard deviation,
skewness, kurtosis, min, max and the Cramer-von Mises normality p-value with the documented
conventions and compares them with the values SmartPLS stored in the *.txt.settings file.
It also evaluates the common ALTERNATIVE formulas, to show that the data discriminate
between conventions (a wrong formula misses by orders of magnitude more than the tolerance).

Usage (repository root):

    uv run --python 3.12 python packages/fixtures/scripts/verify_descriptives.py
    uv run --python 3.12 --with numpy --with scipy --with pandas \
        python packages/fixtures/scripts/verify_descriptives.py      # adds a library cross-check

Writes docs/validation/phase-0/evidence/data/descriptives-check.json and exits 1 if any
documented convention misses a stored value by more than the tolerance (1e-9).
The core implementation is standard library only (math.fsum); numpy/scipy/pandas are used
only for the optional cross-check of this implementation.
"""

from __future__ import annotations

import csv
import json
import math
import platform
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "packages" / "fixtures" / "third-party" / "smartpls-samples"
EVIDENCE = REPO / "docs" / "validation" / "phase-0" / "evidence" / "data" / "descriptives-check.json"
TOLERANCE = 1e-9
CVM_FLOOR = 7.37e-10


def phi(z: float) -> float:
    return 0.5 * math.erfc(-z / math.sqrt(2.0))


def cvm_statistic(sorted_values, mean, sd):
    n = len(sorted_values)
    return 1.0 / (12 * n) + math.fsum((phi((x - mean) / sd) - (2 * i - 1) / (2 * n)) ** 2 for i, x in enumerate(sorted_values, start=1))


def cvm_p_from_modified(ww: float) -> float:
    if ww < 0.0275:
        return 1 - math.exp(-13.953 + 775.5 * ww - 12542.61 * ww**2)
    if ww < 0.051:
        return 1 - math.exp(-5.903 + 179.546 * ww - 1515.29 * ww**2)
    if ww < 0.092:
        return math.exp(0.886 - 31.62 * ww + 10.897 * ww**2)
    if ww < 1.1:
        return math.exp(1.111 - 34.242 * ww + 12.832 * ww**2)
    return CVM_FLOOR


def describe(values):
    """All candidate statistics for one column (values = non-missing floats)."""
    n = len(values)
    xs = sorted(values)
    mean = math.fsum(xs) / n
    m2 = math.fsum((x - mean) ** 2 for x in xs) / n
    m3 = math.fsum((x - mean) ** 3 for x in xs) / n
    m4 = math.fsum((x - mean) ** 4 for x in xs) / n
    out = {
        "n": n,
        "mean": mean,
        "min": xs[0],
        "max": xs[-1],
        "median.upper": xs[n // 2],
        "median.lower": xs[(n - 1) // 2],
        "median.average": 0.5 * (xs[(n - 1) // 2] + xs[n // 2]),
        "sd.population": math.sqrt(m2),
        "sd.sample": math.sqrt(m2 * n / (n - 1)) if n > 1 else None,
    }
    if m2 > 0:
        g1 = m3 / m2**1.5
        g2 = m4 / m2**2 - 3
        out["skewness.g1"] = g1
        out["skewness.G1"] = g1 * math.sqrt(n * (n - 1)) / (n - 2) if n > 2 else None
        out["skewness.b1"] = g1 * ((n - 1) / n) ** 1.5
        out["kurtosis.g2"] = g2
        out["kurtosis.G2"] = (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * g2 + 6) if n > 3 else None
        out["kurtosis.b2"] = (g2 + 3) * (1 - 1 / n) ** 2 - 3
        w_pop = cvm_statistic(xs, mean, out["sd.population"])
        out["cvmW.population-sd"] = w_pop
        out["cvmP.population-sd"] = cvm_p_from_modified(w_pop * (1 + 0.5 / n))
        out["cvmP.population-sd-no-modification"] = cvm_p_from_modified(w_pop)
        if n > 1:
            w_s = cvm_statistic(xs, mean, out["sd.sample"])
            out["cvmP.sample-sd(nortest)"] = cvm_p_from_modified(w_s * (1 + 0.5 / n))
    else:
        out["cvmP.population-sd"] = CVM_FLOOR  # what the source stores for a constant column
    return out


# stored key -> (documented candidate, alternatives)
SPEC = {
    "mean": ("mean", []),
    "min": ("min", []),
    "max": ("max", []),
    "median": ("median.upper", ["median.average", "median.lower"]),
    "standardDeviation": ("sd.population", ["sd.sample"]),
    "skewness": ("skewness.G1", ["skewness.g1", "skewness.b1"]),
    "kurtosis": ("kurtosis.G2", ["kurtosis.g2", "kurtosis.b2"]),
    "cramerVonMisesP": ("cvmP.population-sd", ["cvmP.sample-sd(nortest)", "cvmP.population-sd-no-modification"]),
}


def load_csv(path: Path):
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        rows = list(reader)
    return header, rows


def library_cross_check(columns_by_dataset):
    """Compare the stdlib implementation with pandas / numpy / scipy where available."""
    try:
        import numpy as np
        import pandas as pd
        import scipy
        from scipy import stats
    except Exception as exc:  # pragma: no cover - optional
        return {"ran": False, "reason": f"{type(exc).__name__}: {exc}"}
    dev = {k: 0.0 for k in ("sd.population vs numpy.std(ddof=0)", "skewness.G1 vs pandas.Series.skew", "skewness.G1 vs scipy.stats.skew(bias=False)", "kurtosis.G2 vs pandas.Series.kurt", "kurtosis.G2 vs scipy.stats.kurtosis(bias=False)", "cvmW vs scipy.stats.cramervonmises(norm, mean, population sd)")}
    compared = 0
    for cols in columns_by_dataset.values():
        for values, mine in cols:
            if "skewness.G1" not in mine or mine["skewness.G1"] is None or mine["kurtosis.G2"] is None:
                continue
            compared += 1
            a = np.asarray(values, dtype=float)
            s = pd.Series(a)
            dev["sd.population vs numpy.std(ddof=0)"] = max(dev["sd.population vs numpy.std(ddof=0)"], abs(float(a.std(ddof=0)) - mine["sd.population"]))
            dev["skewness.G1 vs pandas.Series.skew"] = max(dev["skewness.G1 vs pandas.Series.skew"], abs(float(s.skew()) - mine["skewness.G1"]))
            dev["skewness.G1 vs scipy.stats.skew(bias=False)"] = max(dev["skewness.G1 vs scipy.stats.skew(bias=False)"], abs(float(stats.skew(a, bias=False)) - mine["skewness.G1"]))
            dev["kurtosis.G2 vs pandas.Series.kurt"] = max(dev["kurtosis.G2 vs pandas.Series.kurt"], abs(float(s.kurt()) - mine["kurtosis.G2"]))
            dev["kurtosis.G2 vs scipy.stats.kurtosis(bias=False)"] = max(dev["kurtosis.G2 vs scipy.stats.kurtosis(bias=False)"], abs(float(stats.kurtosis(a, bias=False)) - mine["kurtosis.G2"]))
            w = stats.cramervonmises(a, "norm", args=(mine["mean"], mine["sd.population"])).statistic
            dev["cvmW vs scipy.stats.cramervonmises(norm, mean, population sd)"] = max(dev["cvmW vs scipy.stats.cramervonmises(norm, mean, population sd)"], abs(float(w) - mine["cvmW.population-sd"]))
    return {
        "ran": True,
        "versions": {"numpy": np.__version__, "pandas": pd.__version__, "scipy": scipy.__version__},
        "columnsCompared": compared,
        "maxAbsDeviationBetweenThisScriptAndLibrary": dev,
        "note": "scipy has no p-value for the composite (estimated-parameter) normality case, so only the W statistic is cross-checked; the p-value formula is checked against the stored values.",
    }


def main() -> int:
    index = json.loads((FIXTURES / "index.json").read_text(encoding="utf-8"))
    report = {
        "what": "Recomputation of the descriptive statistics stored by SmartPLS in *.txt.settings, from the built data.csv fixtures.",
        "script": "packages/fixtures/scripts/verify_descriptives.py",
        "python": platform.python_version(),
        "platform": f"{platform.system()} {platform.machine()}",
        "tolerance": TOLERANCE,
        "documentedConventions": {stored: doc for stored, (doc, _) in SPEC.items()},
        "datasets": {},
        "overall": {},
    }
    overall = {stored: {"documented": doc, "maxAbsDeviation": 0.0, "columnsCompared": 0, "alternatives": {a: {"maxAbsDeviation": 0.0, "columnsCompared": 0} for a in alts}} for stored, (doc, alts) in SPEC.items()}
    overall_counts = {"n": 0, "nMissing": 0, "columns": 0, "nMismatches": 0, "nMissingMismatches": 0}
    discriminating = {"median": 0}
    failures = []
    columns_by_dataset = {}

    for entry in index["datasets"]:
        slug = entry["slug"]
        header, rows = load_csv(FIXTURES / slug / "data.csv")
        ref = json.loads((FIXTURES / slug / "reference-descriptives.json").read_text(encoding="utf-8"))
        per = {stored: {"documented": doc, "maxAbsDeviation": 0.0, "columnsCompared": 0, "alternatives": {a: {"maxAbsDeviation": 0.0, "columnsCompared": 0} for a in alts}} for stored, (doc, alts) in SPEC.items()}
        n_mismatch = miss_mismatch = 0
        null_columns = []
        cols = []
        for j, col in enumerate(ref["columns"]):
            assert col["name"] == header[j], (slug, col["name"], header[j])
            cells = [r[j] for r in rows]
            values = [float(c) for c in cells if c != ""]
            mine = describe(values)
            cols.append((values, mine))
            n_mismatch += mine["n"] != col["n"]
            miss_mismatch += (len(cells) - len(values)) != col["nMissing"]
            if mine["median.upper"] != mine["median.average"]:
                discriminating["median"] += 1
            for stored, (doc, alts) in SPEC.items():
                target = col[stored]
                if target is None:
                    null_columns.append({"column": col["name"], "statistic": stored, "reason": col.get("nullReasons", {}).get(stored), "recomputedIsUndefined": doc not in mine})
                    continue
                got = mine.get(doc)
                if got is None:
                    failures.append(f"{slug}.{col['name']}.{stored}: documented convention undefined but a value is stored")
                    continue
                d = abs(got - target)
                for bucket in (per, overall):
                    bucket[stored]["maxAbsDeviation"] = max(bucket[stored]["maxAbsDeviation"], d)
                    bucket[stored]["columnsCompared"] += 1
                if d > TOLERANCE:
                    failures.append(f"{slug}.{col['name']}.{stored}: |{got!r} - {target!r}| = {d:.3e}")
                for alt in alts:
                    a = mine.get(alt)
                    if a is None:
                        continue
                    for bucket in (per, overall):
                        slot = bucket[stored]["alternatives"][alt]
                        slot["maxAbsDeviation"] = max(slot["maxAbsDeviation"], abs(a - target))
                        slot["columnsCompared"] += 1
        columns_by_dataset[slug] = cols
        overall_counts["columns"] += len(ref["columns"])
        overall_counts["nMismatches"] += n_mismatch
        overall_counts["nMissingMismatches"] += miss_mismatch
        if n_mismatch or miss_mismatch:
            failures.append(f"{slug}: n mismatches {n_mismatch}, missing-count mismatches {miss_mismatch}")
        report["datasets"][slug] = {
            "rows": len(rows),
            "columns": len(header),
            "dataSha256": entry["sha256"],
            "nMismatches": n_mismatch,
            "nMissingMismatches": miss_mismatch,
            "storedNulls": null_columns,
            "statistics": per,
        }

    report["overall"] = {
        "columns": overall_counts["columns"],
        "nMismatches": overall_counts["nMismatches"],
        "nMissingMismatches": overall_counts["nMissingMismatches"],
        "columnsWhereUpperMedianDiffersFromAverageMedian": discriminating["median"],
        "statistics": overall,
    }
    report["libraryCrossCheck"] = library_cross_check(columns_by_dataset)
    report["failures"] = failures
    report["passed"] = not failures

    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    print(f"{'statistic':<18}{'documented convention':<24}{'max |dev|':>12}{'cols':>6}   alternatives (max |dev|)")
    for stored, o in overall.items():
        alts = ", ".join(f"{a}: {v['maxAbsDeviation']:.2e}" for a, v in o["alternatives"].items())
        print(f"{stored:<18}{o['documented']:<24}{o['maxAbsDeviation']:>12.2e}{o['columnsCompared']:>6}   {alts}")
    print(f"n mismatches: {overall_counts['nMismatches']}, missing-count mismatches: {overall_counts['nMissingMismatches']} over {overall_counts['columns']} columns")
    lib = report["libraryCrossCheck"]
    print("library cross-check:", json.dumps(lib.get("maxAbsDeviationBetweenThisScriptAndLibrary", lib.get("reason"))))
    print("PASSED" if not failures else f"FAILED ({len(failures)}): {failures[:5]}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
