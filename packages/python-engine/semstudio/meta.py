"""Package version and result provenance shared by the PLS and CB engines."""

import platform
import warnings
from datetime import datetime, timezone

import numpy as np
import scipy

__version__ = "0.1.0"
#: The TypeScript engine version this implementation mirrors.
MIRRORS_ENGINE_VERSION = "0.1.0"


def _version_tuple(v):
    out = []
    for part in v.split(".")[:2]:
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out)


#: Tested lower bounds (pyproject.toml). The single-file bundle bypasses pip, so check here.
MIN_NUMPY = (1, 22)
MIN_SCIPY = (1, 12)
if _version_tuple(np.__version__) < MIN_NUMPY or _version_tuple(scipy.__version__) < MIN_SCIPY:
    warnings.warn(
        f"semstudio is tested with numpy >= 1.22.4 and scipy >= 1.12 (found numpy {np.__version__}, "
        f"scipy {scipy.__version__}); with older scipy, Student-t p values can differ from the app by "
        "up to ~1e-11. Upgrade with: pip install -U numpy scipy",
        RuntimeWarning,
        stacklevel=2,
    )


def iso_now():
    """new Date().toISOString()."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def provenance(call, started_at, package_versions):
    versions = dict(package_versions)
    versions["semstudio"] = __version__
    versions["numpy"] = np.__version__
    versions["scipy"] = scipy.__version__
    return {
        "engine": "browser",
        "packageVersions": versions,
        "pythonVersion": platform.python_version(),
        "call": call,
        "startedAt": started_at,
        "finishedAt": iso_now(),
    }
