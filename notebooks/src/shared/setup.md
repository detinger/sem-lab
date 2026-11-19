%% markdown
## 1. Setup: dependencies and SEM Lab's engine

**Run every cell from top to bottom** (Colab: *Runtime → Run all*). The notebook needs no
uploads, no Google Drive, no tokens and no internet access beyond what Colab already has.

**Dependencies.** The notebook uses numpy, scipy, pandas and matplotlib. Google Colab
preinstalls all four, so this notebook deliberately does **not** `pip install` them: forcing a
reinstall of numpy or scipy on Colab replaces libraries that are already imported and makes
Colab ask for a runtime restart. Instead, the next cell prints the versions it finds and checks
them against the minimum versions SEM Lab's engine supports (the engine itself also warns at
import if scipy is too old).

Tested environment (CI runs this notebook headless on it): Python {{TESTED_PYTHON}}, numpy
{{TESTED_NUMPY}}, scipy {{TESTED_SCIPY}}, pandas {{TESTED_PANDAS}}, matplotlib
{{TESTED_MATPLOTLIB}}. To reproduce exactly that environment **outside Colab** (local Jupyter),
uncomment and run the `%pip` line in the next cell, then restart the kernel. On Colab, leave it
commented out.

**Estimation engine.** All estimates come from SEM Lab's own engine, the Python port of the
engine that runs in the SEM Lab app (`semlab_bundle.py`, version 0.1.0). It reproduces the
app's numbers (whole-result agreement about 1e-13 for PLS) and the R reference implementations
cSEM 0.7.1 and lavaan 0.7-3 within tested tolerances. The collapsed cell after the version check
writes the engine file; the cell after that verifies its SHA-256 against the version committed
in the SEM Lab repository and imports it. This is the **verified Python subset** of SEM
Studio: nothing in this notebook calls R.

%% code
# Reproduce the tested environment exactly (local Jupyter only; on Colab this would force a restart):
# %pip install numpy=={{TESTED_NUMPY}} scipy=={{TESTED_SCIPY}} pandas=={{TESTED_PANDAS}} matplotlib=={{TESTED_MATPLOTLIB}}

import re
import sys

import matplotlib
import numpy
import pandas
import scipy

MINIMUM = {"python": "3.10", "numpy": "1.22.4", "scipy": "1.12", "pandas": "1.5", "matplotlib": "3.5"}
TESTED = {"python": "{{TESTED_PYTHON}}", "numpy": "{{TESTED_NUMPY}}", "scipy": "{{TESTED_SCIPY}}",
          "pandas": "{{TESTED_PANDAS}}", "matplotlib": "{{TESTED_MATPLOTLIB}}"}
FOUND = {"python": sys.version.split()[0], "numpy": numpy.__version__, "scipy": scipy.__version__,
         "pandas": pandas.__version__, "matplotlib": matplotlib.__version__}
IN_COLAB = "google.colab" in sys.modules


def version_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3])


too_old = []
for pkg, have in FOUND.items():
    ok = version_tuple(have) >= version_tuple(MINIMUM[pkg])
    print(f"{pkg:<11} {have:<10} minimum {MINIMUM[pkg]:<7} tested {TESTED[pkg]:<8} {'ok' if ok else 'TOO OLD'}")
    if not ok:
        too_old.append(pkg)
print("Running on Google Colab" if IN_COLAB else "Running outside Colab")
if too_old:
    raise RuntimeError(f"Please upgrade {', '.join(too_old)} (see the minimum versions above).")

%% engine

%% code
# Verify the engine file against the SHA-256 of packages/python-engine/dist/semlab_bundle.py
# (the version this notebook was built and tested with), then import it.
import hashlib
import importlib

ENGINE_SHA256 = "{{BUNDLE_SHA256}}"
with open("semlab_bundle.py", encoding="utf-8") as f:
    engine_text = f.read()
if engine_text.startswith("#@title"):  # the Colab form title line of the cell above
    engine_text = engine_text.split("\n", 1)[1]
engine_text = engine_text.rstrip("\n") + "\n"
engine_sha = hashlib.sha256(engine_text.encode("utf-8")).hexdigest()
assert engine_sha == ENGINE_SHA256, (
    f"semlab_bundle.py has sha256 {engine_sha}, expected {ENGINE_SHA256}: the engine cell was edited.")
with open("semlab_bundle.py", "w", encoding="utf-8", newline="\n") as f:
    f.write(engine_text)  # now byte-identical to the committed bundle

sys.modules.pop("semlab_bundle", None)
importlib.invalidate_caches()
import semlab_bundle as semlab

print(f"SEM Lab engine {semlab.__version__} (mirrors @sem-lab/engine {semlab.MIRRORS_ENGINE_VERSION}); "
      f"sha256 {engine_sha[:16]}... verified")

%% helpers
