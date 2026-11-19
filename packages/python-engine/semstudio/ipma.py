"""Importance-performance map analysis (port of packages/engine/src/pls/ipma.ts; semantics of
the R engine's pls_ipma.R, which matched cSEM::doIPMA() on rescaled data):

 1. reverse scoring first (already in the analysis matrix), then x100 = (x - min)/(max - min)*100
    with the DECLARED endpoints;
 2. classic PLS (same scheme / iteration cap / tolerance) on the rescaled data;
 3. unstandardised weight = standardised weight / sd(x100), normalised to sum to 1 per block;
 4. construct score = weighted sum of rescaled indicators; performance = mean score;
 5. importance = unstandardised total effect: OLS (with intercept) of each endogenous score on
    its predictors' scores gives B, total = (I - B)^-1 - I; the sign is kept;
 6. indicator importance = normalised weight x construct importance; indicator performance =
    mean rescaled indicator.
"""

import math

import numpy as np

from .errors import EngineError
from .linalg import correlation, inverse_r, r_mean, r_sd, solve_r
from .pls_core import core_model, fit_weights

IPMA_CONVENTION = " ".join(
    [
        "Each indicator is first reverse scored where flagged ((min + max) - x), then rescaled to 0-100 as (x - min)/(max - min)*100",
        "with its declared original scale endpoints (never the observed minimum/maximum).",
        "Classic PLS-SEM (no consistency correction; same inner weighting scheme, iteration cap and tolerance as the main fit) is re-estimated on the rescaled data.",
        "Unstandardized outer weights = standardized weight / sd(rescaled indicator), normalized to sum to 1 within each block;",
        "construct score = weighted sum of the rescaled indicators (0-100 when no weight is negative).",
        "Performance = mean construct score (constructs) or mean rescaled indicator (indicators), on the 0-100 scale.",
        "Importance = unstandardized total effect of the construct on the target: OLS of each endogenous score on its predictors' scores gives B, total effects = (I - B)^-1 - I.",
        "Indicator importance = normalized weight x the construct's importance. Negative importance keeps its sign.",
        "Constructs listed are all predecessors of the target (any directed path); 'direct' means a direct structural path exists.",
        "Point estimates only (no bootstrap intervals).",
    ]
)


def _fin(x):
    return float(x) if math.isfinite(x) else None


def compute_ipma(spec, data):
    ip = spec.ipma
    model = core_model(spec)
    n = data.n
    lo = np.array([ind.scale[0] for ind in spec.indicators], dtype=float)
    hi = np.array([ind.scale[1] for ind in spec.indicators], dtype=float)
    X100 = ((data.X - lo[None, :]) / (hi - lo)[None, :]) * 100
    S, _ = correlation(X100)
    wr = fit_weights(S, model)
    if not wr.converged:
        raise EngineError(
            "ENGINE_NONCONVERGENCE",
            "The classic PLS fit on the 0-100 rescaled data (IPMA) did not converge.",
            {"stage": "ipma"},
        )
    k = model.k
    wn = []
    scores = []
    with np.errstate(all="ignore"):
        for j in range(k):
            block = model.blocks[j]
            wu = [float(wr.W[j, a]) / r_sd(X100[:, a]) for a in block]
            total = 0.0
            for v in wu:
                total += v
            w = [v / total if total != 0 else float(np.divide(v, total)) for v in wu]
            wn.append(w)
            sc = np.zeros(n)
            for idx, a in enumerate(block):
                sc = sc + X100[:, a] * w[idx]
            scores.append(sc)
        means = [r_mean(s) for s in scores]
        Bu = np.zeros((k, k))
        for t in range(k):
            src = [p.source for p in spec.paths if p.target == t]
            if not src:
                continue

            def cov(a, b):
                return float(np.sum((scores[a] - means[a]) * (scores[b] - means[b])))

            A = np.array([[cov(a, b) for b in src] for a in src])
            coef = solve_r(A, np.array([cov(a, t) for a in src]))
            Bu[t, src] = coef
        eye = np.eye(k)
        inv = inverse_r(eye - Bu)
        Tu = inv - eye
        imp = [float(Tu[ip.target, c]) for c in ip.predecessors]

    warnings = []
    constructs = [
        {
            "constructId": spec.constructs[c].id,
            "importance": _fin(imp[j]),
            "performance": _fin(means[c]),
            "predecessor": "direct" if ip.direct[j] else "indirect",
        }
        for j, c in enumerate(ip.predecessors)
    ]
    indicators = []
    for j, c in enumerate(ip.predecessors):
        for idx, a in enumerate(spec.constructs[c].indicators):
            indicators.append(
                {
                    "indicatorId": spec.indicators[a].id,
                    "constructId": spec.constructs[c].id,
                    "importance": _fin(wn[c][idx] * imp[j]),
                    "performance": _fin(r_mean(X100[:, a])),
                }
            )
    neg = [
        spec.indicators[a].id
        for c in ip.predecessors
        for idx, a in enumerate(spec.constructs[c].indicators)
        if wn[c][idx] < 0
    ]
    if neg:
        warnings.append(
            {
                "code": "IPMA_NEGATIVE_WEIGHT",
                "severity": "warning",
                "message": f"{len(neg)} normalized IPMA weight(s) are negative; the construct score is then not a weighted mean and its performance can fall outside 0-100.",
                "elementIds": neg,
            }
        )
    if any(c["importance"] is None or c["performance"] is None for c in constructs):
        warnings.append(
            {
                "code": "IPMA_NON_FINITE",
                "severity": "error",
                "message": "Some IPMA values could not be computed (non-finite; e.g. weights of a block summing to zero) and are null.",
            }
        )
    if spec.bootstrap is not None:
        warnings.append(
            {
                "code": "IPMA_NO_INTERVALS",
                "severity": "info",
                "message": "IPMA importance and performance are point estimates in this version (no bootstrap intervals).",
            }
        )
    return (
        {
            "targetConstructId": spec.constructs[ip.target].id,
            "constructs": constructs,
            "indicators": indicators,
            "convention": IPMA_CONVENTION,
        },
        warnings,
    )
