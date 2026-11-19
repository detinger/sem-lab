"""dist/semstudio_bundle.py is the deterministic concatenation of the package (and committed
up to date); it exposes the same API. (Every engine test also runs against the bundle.)"""

import ast
import importlib.util
import sys

from conftest import BUNDLE, ROOT, load_engine


def _bundle_module():
    spec = importlib.util.spec_from_file_location("bundle_script", ROOT / "scripts" / "bundle.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_bundle_is_up_to_date_and_deterministic():
    b = _bundle_module()
    first = b.build()
    assert first == b.build()
    assert BUNDLE.read_text(encoding="utf-8") == first, "run: python scripts/bundle.py"


def test_bundle_is_self_contained():
    tree = ast.parse(BUNDLE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert node.level == 0, "relative import left in the bundle"
            assert not (node.module or "").startswith("semstudio")
        if isinstance(node, ast.Import):
            for a in node.names:
                assert a.name.split(".")[0] in {"math", "platform", "re", "warnings", "numpy", "scipy", "pandas", "datetime", "decimal"}, a.name


def test_same_public_api():
    pkg = load_engine("package")
    bun = load_engine("bundle")
    assert list(pkg.__all__) == list(bun.__all__)
    assert pkg.__version__ == bun.__version__ == "0.1.0"
    for name in pkg.__all__:
        assert hasattr(bun, name), name
    assert sys.modules["semstudio_bundle"].__file__ == str(BUNDLE)
