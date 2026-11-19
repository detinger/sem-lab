"""Build the Colab notebooks in notebooks/colab/ from reviewable sources.

Sources (edit these, never the .ipynb files):

    notebooks/src/NN_*.md        one file per notebook: cells separated by "%% <kind>" lines
    notebooks/src/shared/*.md    cells shared by several notebooks ("%% include <name>")
    notebooks/src/sem_helpers.py figure / table / export helpers, embedded as a form cell

Embedded verbatim at build time (so a notebook needs no local files):

    packages/python-engine/dist/semstudio_bundle.py       SEM Studio's engine (%%writefile cell)
    packages/fixtures/scripts/generate_synthetic.py       the case's data function and every
                                                          function/constant it depends on,
                                                          extracted with ast (not hand-copied)
    packages/fixtures/synthetic/<case>/model.json         the canonical model
    packages/fixtures/synthetic/<case>/manifest.json      seed, N and the data sha256

Cell kinds:

    %% markdown                 a markdown cell
    %% code                     a code cell
    %% form <title>             a collapsed Colab form cell (first line "#@title <title>")
    %% include <name>           the cells of src/shared/<name>.md
    %% engine                   the engine bundle cell (%%writefile semstudio_bundle.py)
    %% helpers                  sem_helpers.py as a form cell
    %% generator <fn> [extra]   two cells: the generator's shared functions (form cell) and the
                                case-specific spec / data function (visible); extra roots are
                                further generator names the notebook uses (e.g. derived_truths)

Placeholders {{NAME}} are replaced from the notebook's context (see NOTEBOOKS below).

Usage (repository root):

    uv run --project notebooks python notebooks/build_notebooks.py           # write
    uv run --project notebooks python notebooks/build_notebooks.py --check   # CI: exit 1 if stale
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NB_DIR = ROOT / "notebooks"
SRC = NB_DIR / "src"
OUT = NB_DIR / "colab"
BUNDLE = ROOT / "packages" / "python-engine" / "dist" / "semstudio_bundle.py"
GENERATOR = ROOT / "packages" / "fixtures" / "scripts" / "generate_synthetic.py"
FIXTURES = ROOT / "packages" / "fixtures" / "synthetic"
GENERATOR_REL = "packages/fixtures/scripts/generate_synthetic.py"

# Notebook -> fixture case, generator data function, case-specific generator names (shown in a
# visible cell; everything else they need goes into the collapsed form cell) and analysis.
NOTEBOOKS = {
    "01_tam_pls_sem": {"case": "tam-mediation", "data_fn": "data_tam_mediation",
                       "case_names": ["TAM_COLS", "spec_tam", "data_tam_mediation"]},
    "02_acsi_pls_sem": {"case": "acsi-inspired", "data_fn": "data_acsi_inspired",
                        "case_names": ["ACSI_COLS", "spec_acsi_inspired", "data_acsi_inspired"]},
    "03_delone_mclean_is_success_pls_sem": {"case": "delone-mclean", "data_fn": "data_delone_mclean",
                                            "case_names": ["DM_COLS", "spec_delone_mclean", "data_delone_mclean"]},
    "04_utaut2_pls_sem": {"case": "utaut2-inspired", "data_fn": "data_utaut2_inspired",
                          "case_names": ["UT_COLS", "spec_utaut2_inspired", "data_utaut2_inspired"]},
    "05_service_quality_cb_sem": {"case": "service-quality", "data_fn": "data_service_quality",
                                  "case_names": ["SQ_COLS", "spec_service_quality", "data_service_quality"]},
}

GENERATOR_IMPORTS = {"math", "csv", "io", "hashlib", "np"}
CELL_RE = re.compile(r"^%% (markdown|code|form|include|engine|helpers|generator)(?:[ \t]+(.*))?$")


class BuildError(RuntimeError):
    pass


# ---------------------------------------------------------------------------------------------
# Generator extraction (ast): a root function plus the closure of top-level names it uses
# ---------------------------------------------------------------------------------------------

def _top_level(source):
    tree = ast.parse(source)
    defs = []  # (names defined, node)
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            defs.append(({node.name}, node))
        elif isinstance(node, ast.Assign):
            names = {t.id for t in node.targets if isinstance(t, ast.Name)}
            if names:
                defs.append((names, node))
    return defs


def _used_names(node):
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}


def _segment(source, node):
    lines = source.splitlines()
    start = node.lineno
    if getattr(node, "decorator_list", None):
        start = min(d.lineno for d in node.decorator_list)
    return "\n".join(lines[start - 1: node.end_lineno])


def extract_generator(roots):
    """Return [(name-set, source)] for `roots` and every top-level definition they depend on,
    in the order of the generator file."""
    source = GENERATOR.read_text(encoding="utf-8")
    defs = _top_level(source)
    by_name = {}
    for names, node in defs:
        for n in names:
            by_name[n] = node
    needed, stack = set(), list(roots)
    while stack:
        n = stack.pop()
        if n in needed:
            continue
        if n not in by_name:
            raise BuildError(f"generator name {n!r} is not a top-level definition of {GENERATOR_REL}")
        needed.add(n)
        node = by_name[n]
        if getattr(node, "decorator_list", None):
            raise BuildError(f"{n} is decorated; extract an undecorated function instead")
        # names that are not top-level definitions are locals, parameters, builtins or the
        # module imports in GENERATOR_IMPORTS (the extracted cell imports those itself)
        stack.extend(u for u in _used_names(node) if u in by_name and u not in needed)
    out = []
    for names, node in defs:
        if names & needed:
            out.append((names, _segment(source, node)))
    return out


def generator_cells(data_fn, case_names, extra_roots):
    parts = extract_generator([data_fn, "csv_bytes"] + list(extra_roots))
    case_set = set(case_names)
    missing = case_set - {n for names, _ in parts for n in names}
    if missing:
        raise BuildError(f"case-specific names not reached from {data_fn}: {sorted(missing)}")
    shared = [src for names, src in parts if not names & case_set]
    specific = [src for names, src in parts if names & case_set]
    head = (
        f"# Extracted automatically from {GENERATOR_REL} by notebooks/build_notebooks.py\n"
        "# (byte-for-byte the code that wrote the fixture; do not edit here).\n"
        "import csv\nimport hashlib\nimport io\nimport math\n\nimport numpy as np\n\n\n"
    )
    shared_src = head + "\n\n\n".join(shared) + "\n"
    specific_src = (
        f"# The case's population model and data function, extracted from {GENERATOR_REL}.\n\n"
        + "\n\n\n".join(specific) + "\n"
    )
    return shared_src, specific_src


# ---------------------------------------------------------------------------------------------
# Cells
# ---------------------------------------------------------------------------------------------

def _cell_id(nb_name, index, kind):
    return hashlib.sha256(f"{nb_name}:{index}:{kind}".encode()).hexdigest()[:12]


def _lines(text):
    text = text.strip("\n")
    lines = text.split("\n")
    return [ln + "\n" for ln in lines[:-1]] + [lines[-1]]


def md_cell(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text}


def code_cell(text, form=False):
    meta = {"cellView": "form"} if form else {}
    return {"cell_type": "code", "metadata": meta, "source": text, "execution_count": None, "outputs": []}


def parse_cells(path):
    cells, kind, arg, buf = [], None, None, []

    def flush():
        if kind is not None:
            cells.append((kind, arg, "\n".join(buf).strip("\n")))

    for line in path.read_text(encoding="utf-8").split("\n"):
        m = CELL_RE.match(line)
        if m:
            flush()
            kind, arg, buf = m.group(1), (m.group(2) or "").strip(), []
        else:
            if kind is None and line.strip():
                raise BuildError(f"{path}: text before the first '%%' cell marker")
            buf.append(line)
    flush()
    return cells


def substitute(text, ctx, where):
    def rep(m):
        key = m.group(1)
        if key not in ctx:
            raise BuildError(f"{where}: unknown placeholder {{{{{key}}}}}")
        return str(ctx[key])
    return re.sub(r"\{\{([A-Z0-9_]+)\}\}", rep, text)


def expand(path, ctx, depth=0):
    if depth > 3:
        raise BuildError("include nesting too deep")
    out = []
    for kind, arg, body in parse_cells(path):
        where = f"{path.relative_to(NB_DIR)}"
        if kind == "include":
            out += expand(SRC / "shared" / f"{arg}.md", ctx, depth + 1)
        elif kind == "markdown":
            out.append(md_cell(substitute(body, ctx, where)))
        elif kind == "code":
            out.append(code_cell(substitute(body, ctx, where)))
        elif kind == "form":
            out.append(code_cell(f"#@title {substitute(arg, ctx, where)}\n" + substitute(body, ctx, where), form=True))
        elif kind == "engine":
            bundle = BUNDLE.read_text(encoding="utf-8")
            out.append(code_cell(
                "%%writefile semstudio_bundle.py\n"
                "#@title SEM Studio engine: writes semstudio_bundle.py (about 5,600 lines; click to expand)\n"
                + bundle, form=True))
        elif kind == "helpers":
            helpers = (SRC / "sem_helpers.py").read_text(encoding="utf-8")
            out.append(code_cell("#@title Helper functions: model figure, charts, tables, export (click to expand)\n"
                                 + helpers, form=True))
        elif kind == "generator":
            extra = arg.split()
            shared, specific = generator_cells(ctx["DATA_FN"], ctx["CASE_NAMES"], extra)
            out.append(code_cell("#@title Synthetic data generator: shared functions (click to expand)\n" + shared, form=True))
            out.append(code_cell(specific))
    return out


def tested_versions():
    """Versions of the notebook test environment, from notebooks/uv.lock."""
    import tomllib
    lock = tomllib.loads((NB_DIR / "uv.lock").read_text(encoding="utf-8"))
    want = ("numpy", "scipy", "pandas", "matplotlib", "semopy")
    found = {p["name"]: p["version"] for p in lock["package"] if p["name"] in want}
    missing = [w for w in want if w not in found]
    if missing:
        raise BuildError(f"notebooks/uv.lock has no {missing}")
    return found


def context(name, spec):
    case = spec["case"]
    cdir = FIXTURES / case
    manifest = json.loads((cdir / "manifest.json").read_text(encoding="utf-8"))
    model_text = (cdir / "model.json").read_text(encoding="utf-8")
    if "'''" in model_text or "\\" in model_text:
        raise BuildError(f"{case}/model.json cannot be embedded in a raw triple-quoted string")
    bundle = BUNDLE.read_bytes()
    tv = tested_versions()
    return {
        "TESTED_PYTHON": "3.12",
        "TESTED_NUMPY": tv["numpy"], "TESTED_SCIPY": tv["scipy"], "TESTED_PANDAS": tv["pandas"],
        "TESTED_MATPLOTLIB": tv["matplotlib"], "SEMOPY_VERSION": tv["semopy"],
        "NOTEBOOK": name,
        "CASE_ID": case,
        "SEED": manifest["seed"],
        "N": manifest["n"],
        "DATA_SHA256": manifest["sha256"],
        "DATA_FN": spec["data_fn"],
        "CASE_NAMES": spec["case_names"],
        "MODEL_JSON": model_text.rstrip("\n"),
        "MODEL_SHA256": hashlib.sha256(model_text.encode("utf-8")).hexdigest(),
        "BUNDLE_SHA256": hashlib.sha256(bundle).hexdigest(),
        "GENERATOR_PATH": GENERATOR_REL,
        "TITLE": manifest["title"],
    }


def build_notebook(name, spec):
    ctx = context(name, spec)
    cells = expand(SRC / f"{name}.md", ctx)
    for i, c in enumerate(cells):
        c["id"] = _cell_id(name, i, c["cell_type"])
        c["source"] = _lines(c["source"])
    nb = {
        "cells": cells,
        "metadata": {
            "colab": {"provenance": [], "toc_visible": True, "name": f"{name}.ipynb"},
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return (json.dumps(nb, indent=1, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def build_all(only=None):
    return {f"{name}.ipynb": build_notebook(name, spec) for name, spec in NOTEBOOKS.items()
            if not only or name in only}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if a notebook on disk is not current")
    ap.add_argument("only", nargs="*", help="build only these notebooks (names without .ipynb); not with --check")
    args = ap.parse_args(argv)
    if args.check and args.only:
        ap.error("--check always checks every notebook")
    try:
        built = build_all(args.only)
    except BuildError as exc:
        print(f"BUILD FAILED: {exc}", file=sys.stderr)
        return 2
    if args.check:
        bad = [n for n, b in built.items() if not (OUT / n).is_file() or (OUT / n).read_bytes() != b]
        extra = sorted(p.name for p in OUT.glob("*.ipynb") if p.name not in built)
        for n in bad:
            print(f"STALE: notebooks/colab/{n}", file=sys.stderr)
        for n in extra:
            print(f"UNEXPECTED: notebooks/colab/{n}", file=sys.stderr)
        if bad or extra:
            print("Rebuild with: uv run --project notebooks python notebooks/build_notebooks.py", file=sys.stderr)
            return 1
        print(f"--check OK: {len(built)} notebooks are current")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for n, b in built.items():
        p = OUT / n
        if not p.is_file() or p.read_bytes() != b:
            p.write_bytes(b)
            print(f"wrote notebooks/colab/{n} ({len(b) // 1024} KiB)")
        else:
            print(f"unchanged notebooks/colab/{n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
