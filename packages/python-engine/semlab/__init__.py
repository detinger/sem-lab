"""semlab — SEM Lab's verified estimation engine in Python.

Mirrors @sem-lab/engine 0.1.0 (the TypeScript engine that runs in the SEM Lab app,
packages/engine): PLS-SEM and consistent PLS (cSEM 0.7.1 semantics: path / centroid /
factorial inner weighting, Mode A / Mode B, all quality criteria, effects incl. specific
indirect effects, IPMA, cSEM::verify admissibility), SEM Lab's seeded bootstrap (R's
Mersenne-Twister and sample.int(), bit-exact), and CB-SEM by ML / MLR, complete data or FIML
(lavaan 0.7 sem() defaults; Yuan-Bentler scaled and robust fit indices; RMSEA CI with R's
uniroot). Python scripts and notebooks exported from the app reproduce the app's numbers
with this package; the tested tolerances are in README.md.

Provenance: a line-by-line port of packages/engine/src (TypeScript) of the SEM Lab
repository, verified against it and against the committed R (cSEM 0.7.1, lavaan 0.7-3)
reference results; algorithms re-implemented from their documented definitions (no code from
cSEM, lavaan, plspm or semopy). Licence: MIT (see the LICENSE file of the SEM Lab
repository). Runtime dependencies: numpy, scipy (BSD-3-Clause).

    from semlab import estimate, build_analysis_data, read_csv, results_tables
    columns, rows = read_csv("data.csv")
    data = build_analysis_data(model, columns, rows, analysis["missingData"])
    out = estimate(model, analysis, data)          # {'ok': True, 'result': {...}}
    tables = results_tables(out["result"], model)  # plain dict tables
"""

from .api import (
    AnalysisDataError,
    build_analysis_data,
    estimate,
    pandas_available,
    read_csv,
    results_tables,
    to_dataframe,
    to_dataframes,
)
from .bootstrap import (
    BootstrapProblem,
    DrawResult,
    extract_theta,
    fit_draw,
    infer_from_draws,
    summarise_bootstrap,
)
from .cb import CB_ENGINE_VERSION, cb_parameter_count, estimate_cb
from .distributions import (
    gamma_p,
    gamma_q,
    p_two_sided_normal,
    pchisq,
    pchisq_upper,
    pnchisq,
    pnorm_upper,
    rmsea_ci,
    zeroin,
)
from .errors import ENGINE_ERROR_CODES, EngineError
from .linalg import correlation
from .meta import MIRRORS_ENGINE_VERSION, __version__
from .pls import ENGINE_VERSION, estimate_pls, theta_entries
from .pls_core import core_model, fit_pls, pls_prepare_data, validate_request, verify
from .rng import RMersenneTwister, bootstrap_indices, r_set_seed, runif
from .stats import pt, pt_lower_tail_abs, quantile7, sample_sd

__all__ = [
    "AnalysisDataError",
    "BootstrapProblem",
    "CB_ENGINE_VERSION",
    "DrawResult",
    "ENGINE_ERROR_CODES",
    "ENGINE_VERSION",
    "EngineError",
    "MIRRORS_ENGINE_VERSION",
    "RMersenneTwister",
    "__version__",
    "bootstrap_indices",
    "build_analysis_data",
    "cb_parameter_count",
    "core_model",
    "correlation",
    "estimate",
    "estimate_cb",
    "estimate_pls",
    "extract_theta",
    "fit_draw",
    "fit_pls",
    "gamma_p",
    "gamma_q",
    "infer_from_draws",
    "p_two_sided_normal",
    "pandas_available",
    "pchisq",
    "pchisq_upper",
    "pls_prepare_data",
    "pnchisq",
    "pnorm_upper",
    "pt",
    "pt_lower_tail_abs",
    "quantile7",
    "r_set_seed",
    "read_csv",
    "results_tables",
    "rmsea_ci",
    "runif",
    "sample_sd",
    "summarise_bootstrap",
    "theta_entries",
    "to_dataframe",
    "to_dataframes",
    "validate_request",
    "verify",
    "zeroin",
]
