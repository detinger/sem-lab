"""CB-SEM engine: ML / MLR estimation of reflective SEM models (complete data or FIML),
reproducing lavaan 0.7 ``sem()`` defaults (port of packages/engine/src/cb; conventions in
packages/engine/src/cb/README.md).

Model (LISREL all-y): Sigma = Lambda (I - B)^-1 Psi (I - B)^-T Lambda' + Theta,
mu = nu + Lambda (I - B)^-1 alpha, with lavaan's sem() free/fixed defaults (marker or std-lv
identification, auto.fix.single, auto.cov.lv.x, auto.cov.y, equality labels).

Estimation: f = sum_k (n_k/N)[log|Sigma_oo| + tr(Sigma_oo^-1 (S_k + d_k d_k'))] over
missingness patterns; Fisher scoring with analytic gradient and backtracking line search,
Newton steps on the finite-difference Hessian near the optimum. Inference: expected
information (ML, complete), observed information (FIML), Huber-White sandwich (MLR);
Yuan-Bentler (Mplus) scaled test, robust CFI/TLI/RMSEA, RMSEA CI by noncentral chi^2 inversion
with R's uniroot.
"""

import math

import numpy as np
from scipy.linalg import solve_triangular

from .distributions import (
    Z_975,
    p_two_sided_normal,
    pchisq_upper,
    pnchisq,
    rmsea_ci,
    rmsea_close_pvalue,
    rmsea_point,
)
from .jsnum import js_to_exponential, js_to_fixed
from .meta import iso_now, provenance

CB_ENGINE_VERSION = "0.1.0"
_CB_EPS = 2.220446049250313e-16
_LOG_2PI = math.log(2 * math.pi)


# =============================================================================================
# spec


class CbEntry:
    __slots__ = (
        "key",
        "kind",
        "mat",
        "row",
        "col",
        "free",
        "value",
        "source_id",
        "target_id",
        "relationship_id",
        "label",
        "where",
    )

    def __init__(self, key, kind, mat, row, col, free, value, source_id=None, target_id=None,
                 relationship_id=None, label=None, where=""):
        self.key = key
        self.kind = kind
        self.mat = mat
        #: matrix position; beta: row = target, col = source; nu/alpha: col = 0
        self.row = row
        self.col = col
        #: index into the free-parameter vector, or -1 when fixed
        self.free = free
        self.value = value
        self.source_id = source_id
        self.target_id = target_id
        self.relationship_id = relationship_id
        self.label = label
        #: short location string, e.g. "lambda[3,1]" (1-based), used as rawPath
        self.where = where


class CbSpec:
    __slots__ = ("ov_ids", "lv_ids", "p", "m", "entries", "npar", "mean_structure",
                 "identification", "endogenous")

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def _cb_find_cycle(adj):
    n = len(adj)
    state = [0] * n
    stack = []

    def visit(u):
        state[u] = 1
        stack.append(u)
        for v in adj[u]:
            if state[v] == 1:
                return stack[stack.index(v):] + [v]
            if state[v] == 0:
                c = visit(v)
                if c:
                    return c
        stack.pop()
        state[u] = 2
        return None

    for u in range(n):
        if state[u] == 0:
            c = visit(u)
            if c:
                return c
    return None


def _spec_fail(code, message, details=None):
    e = {"code": code, "message": message}
    if details is not None:
        e["details"] = details
    return None, e


def build_cb_spec(model, identification, mean_structure):
    """SemModel -> LISREL-style parameter table with lavaan's sem() default free/fixed pattern.
    Returns (spec, None) or (None, error)."""
    constructs = model.get("constructs") or []
    if len(constructs) == 0:
        return _spec_fail("REQUEST_INVALID", "The model has no constructs.", {"reason": "empty-model"})
    for c in constructs:
        if c.get("measurement") != "reflective":
            return _spec_fail(
                "CAPABILITY_UNSUPPORTED",
                f"Construct {c.get('id')} is composite-formative; CB-SEM estimates common factors only and does not convert composites.",
                {"reason": "composite-in-cb-sem", "elementIds": [c.get("id")]},
            )
        if c.get("higherOrder"):
            return _spec_fail(
                "CAPABILITY_UNSUPPORTED",
                f"Higher-order construct {c.get('id')} is not supported.",
                {"reason": "higher-order", "elementIds": [c.get("id")]},
            )
        if len(c.get("indicatorIds") or []) == 0:
            return _spec_fail(
                "REQUEST_INVALID",
                f"Construct {c.get('id')} has no indicators.",
                {"reason": "empty-block", "elementIds": [c.get("id")]},
            )

    lv_ids = [c["id"] for c in constructs]
    lv_index = {cid: i for i, cid in enumerate(lv_ids)}
    ov_ids = []
    for c in constructs:
        for i in c["indicatorIds"]:
            if i not in ov_ids:
                ov_ids.append(i)
    ov_index = {iid: i for i, iid in enumerate(ov_ids)}
    known = {i["id"] for i in model.get("indicators") or []}
    for iid in ov_ids:
        if iid not in known:
            return _spec_fail(
                "REQUEST_INVALID",
                f"Indicator {iid} is referenced but not defined.",
                {"reason": "unknown-indicator", "elementIds": [iid]},
            )
    p = len(ov_ids)
    m = len(lv_ids)
    rels = model.get("relationships") or []

    structural = [r for r in rels if r.get("kind") == "structural"]
    is_target = [False] * m
    is_source = [False] * m
    adj = [[] for _ in range(m)]
    for r in structural:
        s = lv_index.get(r.get("sourceId"))
        t = lv_index.get(r.get("targetId"))
        if s is None or t is None:
            return _spec_fail(
                "REQUEST_INVALID",
                f"Structural path {r.get('id')} must connect two constructs.",
                {"reason": "structural-endpoint", "elementIds": [r.get("id")]},
            )
        if s == t:
            return _spec_fail(
                "REQUEST_INVALID",
                f"Structural path {r.get('id')} is a self-loop.",
                {"reason": "self-loop", "elementIds": [r.get("id")]},
            )
        is_target[t] = True
        is_source[s] = True
        adj[s].append(t)
    cycle = _cb_find_cycle(adj)
    if cycle:
        return _spec_fail(
            "REQUEST_INVALID",
            f"The structural model contains a cycle ({' → '.join(lv_ids[i] for i in cycle)}); only recursive models are supported.",
            {"reason": "structural-cycle", "elementIds": [lv_ids[i] for i in cycle]},
        )

    entries = []

    def push(key, kind, mat, row, col, is_free, value, **kw):
        entries.append(CbEntry(key, kind, mat, row, col, 0 if is_free else -1, value, **kw))

    # loadings
    load_count = {}
    for c in constructs:
        for i in c["indicatorIds"]:
            load_count[i] = load_count.get(i, 0) + 1
    for j, c in enumerate(constructs):
        for t, iid in enumerate(c["indicatorIds"]):
            i = ov_index[iid]
            fixed = identification == "marker" and t == 0
            push(
                f"loading:{c['id']}:{iid}",
                "loading",
                "lambda",
                i,
                j,
                not fixed,
                1.0 if fixed else 0.0,
                source_id=c["id"],
                target_id=iid,
                where=f"lambda[{i + 1},{j + 1}]",
            )

    # structural paths
    for r in structural:
        s = lv_index[r["sourceId"]]
        t = lv_index[r["targetId"]]
        fv = r.get("fixedValue")
        push(
            f"path:{r['sourceId']}->{r['targetId']}",
            "path",
            "beta",
            t,
            s,
            fv is None,
            float(fv) if fv is not None else 0.0,
            source_id=r["sourceId"],
            target_id=r["targetId"],
            relationship_id=r["id"],
            label=r.get("parameterLabel") or None,
            where=f"beta[{t + 1},{s + 1}]",
        )

    # indicator residual variances
    single = {c["indicatorIds"][0] for c in constructs if len(c["indicatorIds"]) == 1}
    for i, iid in enumerate(ov_ids):
        fix_zero = iid in single and load_count.get(iid) == 1
        push(
            f"residual-variance:{iid}",
            "residual-variance",
            "theta",
            i,
            i,
            not fix_zero,
            0.0,
            source_id=iid,
            target_id=iid,
            where=f"theta[{i + 1},{i + 1}]",
        )

    # latent (residual) variances
    for j, cid in enumerate(lv_ids):
        endo = is_target[j]
        push(
            f"{'residual-variance' if endo else 'variance'}:{cid}",
            "residual-variance" if endo else "variance",
            "psi",
            j,
            j,
            identification == "marker",
            0.0 if identification == "marker" else 1.0,
            source_id=cid,
            target_id=cid,
            where=f"psi[{j + 1},{j + 1}]",
        )

    # covariances: explicit relationships first (they override automatic ones)
    def cov_key(a, b):
        return "\u0000".join(sorted([a, b]))

    explicit = {}
    for r in rels:
        if r.get("kind") != "covariance":
            continue
        sl = lv_index.get(r.get("sourceId"))
        tl = lv_index.get(r.get("targetId"))
        so = ov_index.get(r.get("sourceId"))
        to = ov_index.get(r.get("targetId"))
        if sl is not None and tl is not None:
            mat = "psi"
            a, b = max(sl, tl), min(sl, tl)
        elif so is not None and to is not None:
            mat = "theta"
            a, b = max(so, to), min(so, to)
        else:
            return _spec_fail(
                "REQUEST_INVALID",
                f"Covariance {r.get('id')} must connect two constructs or two indicators of the model.",
                {"reason": "covariance-endpoint", "elementIds": [r.get("id")]},
            )
        if a == b:
            return _spec_fail(
                "REQUEST_INVALID",
                f"Covariance {r.get('id')} connects an element with itself.",
                {"reason": "self-covariance", "elementIds": [r.get("id")]},
            )
        k = cov_key(r["sourceId"], r["targetId"])
        if k in explicit:
            return _spec_fail(
                "REQUEST_INVALID",
                f"Covariance {r.get('id')} duplicates another covariance.",
                {"reason": "duplicate-covariance", "elementIds": [r.get("id")]},
            )
        fv = r.get("fixedValue")
        explicit[k] = CbEntry(
            f"covariance:{r['sourceId']}~~{r['targetId']}",
            "covariance",
            mat,
            a,
            b,
            0 if fv is None else -1,
            float(fv) if fv is not None else 0.0,
            source_id=r["sourceId"],
            target_id=r["targetId"],
            relationship_id=r["id"],
            label=r.get("parameterLabel") or None,
            where=f"{mat}[{a + 1},{b + 1}]",
        )
    exo = [not is_target[j] for j in range(m)]
    pure_y = [is_target[j] and not is_source[j] for j in range(m)]
    for a in range(m):
        for b in range(a + 1, m):
            if (exo[a] and exo[b]) or (pure_y[a] and pure_y[b]):
                if cov_key(lv_ids[a], lv_ids[b]) in explicit:
                    continue
                entries.append(
                    CbEntry(
                        f"covariance:{lv_ids[a]}~~{lv_ids[b]}",
                        "covariance",
                        "psi",
                        b,
                        a,
                        0,
                        0.0,
                        source_id=lv_ids[a],
                        target_id=lv_ids[b],
                        where=f"psi[{b + 1},{a + 1}]",
                    )
                )
    # explicit covariances in model order, after the automatic ones
    entries.extend(explicit.values())

    if mean_structure:
        for i, iid in enumerate(ov_ids):
            entries.append(
                CbEntry(f"intercept:{iid}", "intercept", "nu", i, 0, 0, 0.0, source_id=iid,
                        where=f"nu[{i + 1}]")
            )
        for j, cid in enumerate(lv_ids):
            entries.append(
                CbEntry(f"intercept:{cid}", "intercept", "alpha", j, 0, -1, 0.0, source_id=cid,
                        where=f"alpha[{j + 1}]")
            )

    # number the free parameters; equal labels share one parameter
    npar = 0
    by_label = {}
    for e in entries:
        if e.free < 0:
            continue
        if e.label is not None:
            prev = by_label.get(e.label)
            if prev is not None:
                e.free = prev
                continue
            by_label[e.label] = npar
        e.free = npar
        npar += 1

    return (
        CbSpec(
            ov_ids=ov_ids,
            lv_ids=lv_ids,
            p=p,
            m=m,
            entries=entries,
            npar=npar,
            mean_structure=mean_structure,
            identification=identification,
            endogenous=is_target,
        ),
        None,
    )


def sample_moments(p, mean_structure):
    """Number of observed sample moments: p(p+1)/2 (+ p with a mean structure)."""
    return (p * (p + 1)) // 2 + (p if mean_structure else 0)


def cb_parameter_count(model, identification="marker", mean_structure=False):
    """{moments, parameters, df} exactly as the CB engine (and lavaan sem()) uses them, or None."""
    spec, err = build_cb_spec(model, identification, mean_structure)
    if spec is None:
        return None
    moments = sample_moments(spec.p, mean_structure)
    return {"moments": moments, "parameters": spec.npar, "df": moments - spec.npar}


# =============================================================================================
# small matrix kernel (exact counterparts of cb/matrix.ts where the algorithm matters)


def gj_inverse(a):
    """General inverse by Gauss-Jordan with partial pivoting (cb/matrix.ts ``inverse``); None
    when (numerically) singular: a pivot <= max|a| * n * eps."""
    a = np.asarray(a, dtype=float)
    n = a.shape[0]
    if n == 0:
        return np.zeros((0, 0))
    if not np.all(np.isfinite(a)):
        return None
    m = a.copy()
    inv = np.eye(n)
    tiny = float(np.max(np.abs(a))) * n * _CB_EPS
    for col in range(n):
        piv = col + int(np.argmax(np.abs(m[col:, col])))
        best = abs(m[piv, col])
        if not (best > tiny):
            return None
        if piv != col:
            m[[col, piv]] = m[[piv, col]]
            inv[[col, piv]] = inv[[piv, col]]
        d = m[col, col]
        m[col] = m[col] / d
        inv[col] = inv[col] / d
        f = m[:, col].copy()
        f[col] = 0.0
        m -= np.outer(f, m[col])
        inv -= np.outer(f, inv[col])
    return inv


def gj_solve(a, b):
    inv = gj_inverse(a)
    return None if inv is None else inv @ b


def cholesky_lower(a):
    """Lower Cholesky factor, or None when not (numerically) positive definite."""
    try:
        L = np.linalg.cholesky(a)
    except np.linalg.LinAlgError:
        return None
    if not np.all(np.isfinite(L)):
        return None
    return L


def spd_inverse(a):
    """(inverse, log-determinant) of a symmetric positive-definite matrix; None if not PD."""
    L = cholesky_lower(a)
    if L is None:
        return None
    logdet = 2.0 * float(np.sum(np.log(np.diag(L))))
    Li = solve_triangular(L, np.eye(a.shape[0]), lower=True)
    inv = Li.T @ Li
    iu = np.triu_indices(a.shape[0], 1)
    inv[iu] = inv.T[iu]
    return inv, logdet


def sym_eigen(a):
    """Eigen-decomposition of a symmetric matrix: values descending, vectors as columns."""
    w, v = np.linalg.eigh(a)
    return w[::-1].copy(), v[:, ::-1].copy()


def sym_eigenvalues(a):
    return np.linalg.eigvalsh(a)[::-1].copy()


# =============================================================================================
# data


class Pattern:
    __slots__ = ("obs", "n", "mean", "cov", "rows", "full")

    def __init__(self, obs, n, mean, cov, rows, full):
        #: observed variable indices (into the model's ov order)
        self.obs = obs
        self.n = n
        self.mean = mean
        #: divisor-n covariance of the pattern's observed values
        self.cov = cov
        #: observed values of each case (n x len(obs))
        self.rows = rows
        self.full = full


class PatternGroup:
    """Missingness patterns with the same number q of observed variables, stacked so that the
    per-pattern likelihood terms are evaluated in one batched (LAPACK) call; the arithmetic per
    pattern is unchanged."""

    __slots__ = ("q", "idx", "rows_ix", "cols_ix", "w", "mean", "cov")

    def __init__(self, q, patterns, n_total):
        self.q = q
        self.idx = np.array([pt.obs for pt in patterns], dtype=int)  # k x q
        self.rows_ix = self.idx[:, :, None]
        self.cols_ix = self.idx[:, None, :]
        self.w = np.array([pt.n / n_total for pt in patterns])
        self.mean = np.array([pt.mean for pt in patterns])
        self.cov = np.array([pt.cov for pt in patterns])


class SampleData:
    __slots__ = ("p", "n", "patterns", "complete", "mean", "cov", "groups")

    def __init__(self, p, n, patterns, complete, mean, cov):
        self.p = p
        self.n = n
        self.patterns = patterns
        self.complete = complete
        self.mean = mean
        self.cov = cov
        by_q = {}
        for pt in patterns:
            by_q.setdefault(pt.obs.shape[0], []).append(pt)
        self.groups = [PatternGroup(q, by_q[q], n) for q in sorted(by_q)]


def _is_finite_number(x):
    return isinstance(x, (int, float, np.integer, np.floating)) and not isinstance(x, bool) and math.isfinite(x)


def cb_prepare_data(model, ov_ids, inp, missing):
    """Column resolution, listwise deletion or FIML pattern grouping, divisor-N moments.
    Returns ((data, n_used, n_excluded), None) or (None, error)."""

    def fail(code, message, details=None):
        e = {"code": code, "message": message}
        if details is not None:
            e["details"] = details
        return None, e

    rows_in = inp.get("rows") or []
    columns = list(inp.get("columns") or [])
    if inp.get("nRows") - inp.get("nDropped") != len(rows_in):
        return fail(
            "REQUEST_INVALID",
            f"nRows − nDropped ({inp.get('nRows')} − {inp.get('nDropped')}) does not equal the number of rows supplied ({len(rows_in)}).",
            {"reason": "data-preparation-mismatch"},
        )
    by_id = {i["id"]: i for i in model.get("indicators") or []}
    col_index = {}
    for i, c in enumerate(columns):
        col_index[c] = i  # Map semantics: the last occurrence wins
    unmapped = []
    absent = []
    cols = []
    for iid in ov_ids:
        col = (by_id.get(iid) or {}).get("column")
        if col is None:
            unmapped.append(iid)
            continue
        k = col_index.get(col)
        if k is None:
            absent.append(col)
        else:
            cols.append(k)
    if unmapped or absent:
        parts = []
        if unmapped:
            parts.append(f"indicators without a bound column: {', '.join(unmapped)}")
        if absent:
            parts.append(f"columns not in the data: {', '.join(absent)}")
        return fail("DATA_COLUMN_MISSING", "; ".join(parts), {"elementIds": unmapped, "columns": absent})

    p = len(ov_ids)
    used = []
    for r, row in enumerate(rows_in):
        if len(row) != len(columns):
            return fail(
                "REQUEST_INVALID",
                f"Row {r + 1} has {len(row)} values for {len(columns)} columns.",
                {"reason": "ragged-rows"},
            )
        v = np.empty(p)
        n_obs = 0
        for j in range(p):
            x = row[cols[j]]
            if x is None:
                v[j] = math.nan
            elif not _is_finite_number(x):
                return fail(
                    "DATA_NOT_NUMERIC",
                    f"Column {columns[cols[j]]} contains a non-numeric or non-finite value.",
                    {"columns": [columns[cols[j]]], "elementIds": [ov_ids[j]]},
                )
            else:
                v[j] = float(x)
                n_obs += 1
        if (n_obs == p) if missing == "listwise" else (n_obs > 0):
            used.append(v)
    n = len(used)
    if n < 2:
        return fail(
            "DATA_INSUFFICIENT_ROWS",
            f"Only {n} usable row(s) after {'listwise deletion' if missing == 'listwise' else 'removing empty rows'}.",
            {"nUsed": n},
        )
    U = np.array(used)
    zero = []
    for j in range(p):
        col = U[:, j]
        obs = col[~np.isnan(col)]
        if obs.shape[0] < 2 or float(np.min(obs)) == float(np.max(obs)):
            zero.append(ov_ids[j])
    if zero:
        return fail(
            "DATA_ZERO_VARIANCE",
            f"Indicator(s) without variance in the analysed rows: {', '.join(zero)}.",
            {"elementIds": zero},
        )

    # group into missingness patterns (first-appearance order)
    groups = {}
    for v in used:
        obs = tuple(j for j in range(p) if not math.isnan(v[j]))
        g = groups.get(obs)
        if g is None:
            g = []
            groups[obs] = g
        g.append(v[list(obs)])
    patterns = []
    for obs, rows in groups.items():
        R = np.array(rows)
        k = R.shape[0]
        mean = np.sum(R, axis=0) / k
        D = R - mean
        cov = (D.T @ D) / k
        il = np.tril_indices(len(obs), -1)
        cov[il[1], il[0]] = cov[il]
        patterns.append(Pattern(np.array(obs, dtype=int), k, mean, cov, R, len(obs) == p))
    complete = len(patterns) == 1 and patterns[0].full
    data = SampleData(
        p,
        n,
        patterns,
        complete,
        patterns[0].mean if complete else None,
        patterns[0].cov if complete else None,
    )
    return (data, n, len(rows_in) - n), None


def em_saturated(data, tol=1e-13, max_iter=20000):
    """Saturated ML moments under MAR (EM). Start: available-case means and divisor-n
    variances (as lavaan); iterate to max |delta| < tol. None if a conditional covariance
    becomes singular. Returns (mu, sigma, iterations, converged)."""
    p = data.p
    if data.complete:
        return data.mean, data.cov, 0, True
    s = np.zeros(p)
    cnt = np.zeros(p)
    for pat in data.patterns:
        s[pat.obs] += pat.n * pat.mean
        cnt[pat.obs] += pat.n
    mu = s / cnt
    ss = np.zeros(p)
    for pat in data.patterns:
        ss[pat.obs] += np.sum((pat.rows - mu[pat.obs]) ** 2, axis=0)
    sigma = np.diag(ss / cnt)
    n = data.n
    for it in range(1, max_iter + 1):
        T1 = np.zeros(p)
        T2 = np.zeros((p, p))
        for pat in data.patterns:
            o = pat.obs
            nk = pat.n
            sy = nk * pat.mean
            syy = nk * (pat.cov + np.outer(pat.mean, pat.mean))
            T1[o] += sy
            T2[np.ix_(o, o)] += syy
            if pat.full:
                continue
            mis = np.array([j for j in range(p) if j not in set(o.tolist())], dtype=int)
            res = spd_inverse(sigma[np.ix_(o, o)])
            if res is None:
                return None
            inv = res[0]
            Bm = sigma[np.ix_(mis, o)] @ inv
            C = sigma[np.ix_(mis, mis)] - Bm @ sigma[np.ix_(o, mis)]
            a = mu[mis] - Bm @ mu[o]
            bsy = Bm @ sy
            bSyy = Bm @ syy
            T1[mis] += nk * a + bsy
            cross = np.outer(a, sy) + bSyy
            T2[np.ix_(mis, o)] += cross
            T2[np.ix_(o, mis)] += cross.T
            T2[np.ix_(mis, mis)] += (
                nk * C + nk * np.outer(a, a) + np.outer(a, bsy) + np.outer(bsy, a) + bSyy @ Bm.T
            )
        mu_new = T1 / n
        sig_new = (0.5 * (T2 + T2.T)) / n - np.outer(mu_new, mu_new)
        il = np.tril_indices(p, -1)
        sig_new[il[1], il[0]] = sig_new[il]
        delta = max(float(np.max(np.abs(mu_new - mu))), float(np.max(np.abs(sig_new - sigma))))
        mu = mu_new
        sigma = sig_new
        if delta < tol:
            return mu, sigma, it, True
    return mu, sigma, max_iter, False


# =============================================================================================
# parameterizations


class ModelState:
    __slots__ = ("lam", "beta", "psi", "theta", "nu", "alpha", "a", "phi", "sigma", "mu", "la",
                 "a_alpha")


def fill_matrices(spec, x):
    p, m = spec.p, spec.m
    st = ModelState()
    st.lam = np.zeros((p, m))
    st.beta = np.zeros((m, m))
    st.psi = np.zeros((m, m))
    st.theta = np.zeros((p, p))
    st.nu = np.zeros(p)
    st.alpha = np.zeros(m)
    for e in spec.entries:
        v = x[e.free] if e.free >= 0 else e.value
        if e.mat == "lambda":
            st.lam[e.row, e.col] = v
        elif e.mat == "beta":
            st.beta[e.row, e.col] = v
        elif e.mat == "psi":
            st.psi[e.row, e.col] = v
            st.psi[e.col, e.row] = v
        elif e.mat == "theta":
            st.theta[e.row, e.col] = v
            st.theta[e.col, e.row] = v
        elif e.mat == "nu":
            st.nu[e.row] = v
        elif e.mat == "alpha":
            st.alpha[e.row] = v
    return st


def model_state(spec, x):
    st = fill_matrices(spec, x)
    m = spec.m
    a = np.zeros((0, 0)) if m == 0 else gj_inverse(np.eye(m) - st.beta)
    if a is None:
        return None
    st.a = a
    st.phi = (a @ st.psi) @ a.T
    st.la = st.lam @ a
    sigma = (st.lam @ st.phi) @ st.lam.T + st.theta
    sigma = 0.5 * (sigma + sigma.T)  # exact symmetry
    st.sigma = sigma
    st.a_alpha = a @ st.alpha
    st.mu = st.nu + st.la @ st.alpha if spec.mean_structure else None
    return st


class ModelParameterization:
    """theta -> (Sigma, mu) of the LISREL all-y model with the analytic Jacobian."""

    def __init__(self, spec):
        self.spec = spec
        self.npar = spec.npar
        self.p = spec.p
        self.mean_structure = spec.mean_structure
        self._free = [e for e in spec.entries if e.free >= 0]
        idx = np.array([e.free for e in self._free], dtype=int)
        self._idx = idx
        self._dup = len(set(idx.tolist())) != len(idx)

    def moments(self, x):
        st = model_state(self.spec, x)
        return None if st is None else (st.sigma, st.mu)

    def jacobian(self, x):
        st = model_state(self.spec, x)
        if st is None:
            return None
        p = self.p
        lphi = st.lam @ st.phi  # Lambda Phi (p x m)
        ne = len(self._free)
        U = np.zeros((ne, p))
        V = np.zeros((ne, p))
        Mu = np.zeros((ne, p)) if self.mean_structure else None
        for t, e in enumerate(self._free):
            r, c = e.row, e.col
            if e.mat == "lambda":
                U[t, r] = 1.0
                V[t] = lphi[:, c]
                if Mu is not None:
                    Mu[t, r] += st.a_alpha[c]
            elif e.mat == "beta":
                U[t] = st.la[:, r]
                V[t] = lphi[:, c]
                if Mu is not None:
                    Mu[t] += st.la[:, r] * st.a_alpha[c]
            elif e.mat == "psi":
                U[t] = st.la[:, r]
                V[t] = 0.5 * st.la[:, r] if r == c else st.la[:, c]
            elif e.mat == "theta":
                U[t, r] = 1.0
                if r == c:
                    V[t, r] = 0.5
                else:
                    V[t, c] = 1.0
            elif e.mat == "nu":
                if Mu is not None:
                    Mu[t, r] += 1.0
            elif e.mat == "alpha":
                if Mu is not None:
                    Mu[t] += st.la[:, r]
        D = U[:, :, None] * V[:, None, :]
        D = D + D.transpose(0, 2, 1)
        if self._dup:
            dS = np.zeros((self.npar, p, p))
            np.add.at(dS, self._idx, D)
            dM = None
            if Mu is not None:
                dM = np.zeros((self.npar, p))
                np.add.at(dM, self._idx, Mu)
        else:
            dS = np.zeros((self.npar, p, p))
            dS[self._idx] = D
            dM = None
            if Mu is not None:
                dM = np.zeros((self.npar, p))
                dM[self._idx] = Mu
        return dS, dM


class SaturatedParameterization:
    """theta = (sigma_ij for i >= j, row-wise lower triangle; then mu when modelled)."""

    def __init__(self, p, mean_structure):
        self.p = p
        self.mean_structure = mean_structure
        self.pairs = [(i, j) for i in range(p) for j in range(i + 1)]
        n_cov = len(self.pairs)
        self.n_cov = n_cov
        self.npar = n_cov + (p if mean_structure else 0)
        dS = np.zeros((self.npar, p, p))
        dM = np.zeros((self.npar, p)) if mean_structure else None
        for k, (i, j) in enumerate(self.pairs):
            dS[k, i, j] = 1.0
            dS[k, j, i] = 1.0
        if mean_structure:
            for i in range(p):
                dM[n_cov + i, i] = 1.0
        self._jac = (dS, dM)
        self._ri = np.array([i for i, _ in self.pairs], dtype=int)
        self._ci = np.array([j for _, j in self.pairs], dtype=int)

    def moments(self, x):
        sigma = np.zeros((self.p, self.p))
        sigma[self._ri, self._ci] = x[: self.n_cov]
        sigma[self._ci, self._ri] = x[: self.n_cov]
        return sigma, (np.array(x[self.n_cov :], dtype=float) if self.mean_structure else None)

    def jacobian(self, x):
        return self._jac


def saturated_theta(sigma, mu):
    p = sigma.shape[0]
    out = [sigma[i, j] for i in range(p) for j in range(i + 1)]
    if mu is not None:
        out.extend(mu.tolist())
    return np.array(out, dtype=float)


class IndependenceParameterization:
    """theta = (sigma_11 ... sigma_pp; then mu when modelled)."""

    def __init__(self, p, mean_structure):
        self.p = p
        self.mean_structure = mean_structure
        self.npar = p + (p if mean_structure else 0)
        dS = np.zeros((self.npar, p, p))
        dM = np.zeros((self.npar, p)) if mean_structure else None
        for k in range(p):
            dS[k, k, k] = 1.0
        if mean_structure:
            for i in range(p):
                dM[p + i, i] = 1.0
        self._jac = (dS, dM)

    def moments(self, x):
        return np.diag(np.asarray(x[: self.p], dtype=float)), (
            np.array(x[self.p :], dtype=float) if self.mean_structure else None
        )

    def jacobian(self, x):
        return self._jac


# =============================================================================================
# objective


def _effective_mu(data, mu):
    if mu is not None:
        return mu
    if data.mean is None:
        raise RuntimeError("a mean structure is required for incomplete data")
    return data.mean


def _sub(M, pat):
    return M if pat.full else M[np.ix_(pat.obs, pat.obs)]


def evaluate(data, sigma, mu):
    """f and its derivatives G = df/dSigma, g = df/dmu (None without mean structure). None when
    some Sigma_oo is not PD. Patterns are evaluated in stacks of equal size (PatternGroup)."""
    p = data.p
    mu_e = _effective_mu(data, mu)
    G = np.zeros((p, p))
    g = np.zeros(p) if mu is not None else None
    f = 0.0
    for grp in data.groups:
        S = sigma[grp.rows_ix, grp.cols_ix]  # k x q x q
        if not np.all(np.isfinite(S)):
            return None
        try:
            L = np.linalg.cholesky(S)
        except np.linalg.LinAlgError:
            return None
        diag = np.diagonal(L, axis1=1, axis2=2)
        if not np.all(diag > 0):
            return None
        logdet = 2.0 * np.sum(np.log(diag), axis=1)
        Li = np.linalg.inv(L)
        inv = np.matmul(np.swapaxes(Li, 1, 2), Li)
        inv = 0.5 * (inv + np.swapaxes(inv, 1, 2))
        d = grp.mean - mu_e[grp.idx]
        M = grp.cov + d[:, :, None] * d[:, None, :]
        sm = np.matmul(inv, M)
        tr = np.trace(sm, axis1=1, axis2=2)
        f += float(np.sum(grp.w * (logdet + tr)))
        Gk = grp.w[:, None, None] * (inv - np.matmul(sm, inv))
        np.add.at(G, (grp.rows_ix, grp.cols_ix), Gk)
        if g is not None:
            gk = -2 * grp.w[:, None] * np.matmul(inv, d[:, :, None])[:, :, 0]
            np.add.at(g, grp.idx, gk)
    if not math.isfinite(f):
        return None
    return f, G, g


def _gradient(G, g, jac):
    dS, dM = jac
    out = np.tensordot(dS, G, axes=([1, 2], [0, 1]))
    if g is not None and dM is not None:
        out = out + dM @ g
    return out


def objective_and_gradient(par, data, x):
    mom = par.moments(x)
    if mom is None:
        return None
    ev = evaluate(data, mom[0], mom[1])
    if ev is None:
        return None
    jac = par.jacobian(x)
    if jac is None:
        return None
    return ev[0], _gradient(ev[1], ev[2], jac)


def objective_only(par, data, x):
    mom = par.moments(x)
    if mom is None:
        return None
    ev = evaluate(data, mom[0], mom[1])
    return None if ev is None else ev[0]


def expected_hessian(par, data, x):
    """Expected Hessian of f: sum_k (n_k/N)[tr(S^-1 S_a S^-1 S_b) + 2 mu_a' S^-1 mu_b]."""
    mom = par.moments(x)
    jac = par.jacobian(x)
    if mom is None or jac is None:
        return None
    sigma, mu = mom
    dS, dM = jac
    npar = dS.shape[0]
    H = np.zeros((npar, npar))
    for pat in data.patterns:
        o = pat.obs
        q = o.shape[0]
        res = spd_inverse(_sub(sigma, pat))
        if res is None:
            return None
        inv = res[0]
        w = pat.n / data.n
        dSo = dS if pat.full else dS[:, o][:, :, o]
        Ms = np.matmul(inv[None, :, :], dSo)
        A = Ms.reshape(npar, q * q)
        Bt = Ms.transpose(0, 2, 1).reshape(npar, q * q)
        T = A @ Bt.T
        if dM is not None and mu is not None:
            dMo = dM[:, o]
            Vs = dMo @ inv.T
            T = T + 2 * (dMo @ Vs.T)
        T = np.tril(T)
        T = T + np.tril(T, -1).T
        H += w * T
    return H


def casewise_scores(par, data, x):
    """Casewise scores of logL_i with respect to theta (rows: patterns in order, cases in order)."""
    mom = par.moments(x)
    jac = par.jacobian(x)
    if mom is None or jac is None:
        return None
    sigma, mu_m = mom
    mu = _effective_mu(data, mu_m)
    dS, dM = jac
    npar = dS.shape[0]
    out = []
    for pat in data.patterns:
        o = pat.obs
        res = spd_inverse(_sub(sigma, pat))
        if res is None:
            return None
        inv = res[0]
        dSo = dS if pat.full else dS[:, o][:, :, o]
        Z = pat.rows - mu[o]
        Vv = Z @ inv.T
        # 0.5 * sum_ij (v_i v_j - inv_ij) dS_a,ij + v . dmu_a
        quad = np.einsum("ri,aij,rj->ra", Vv, dSo, Vv, optimize=True)
        tr = np.einsum("ij,aij->a", inv, dSo)
        s = 0.5 * (quad - tr[None, :])
        if dM is not None and mu_m is not None:
            s = s + Vv @ dM[:, o].T
        out.append(s.reshape(-1, npar))
    return np.vstack(out) if out else np.zeros((0, npar))


def first_order_information(par, data, x):
    """B = (1/N) sum_i s_i s_i'."""
    sc = casewise_scores(par, data, x)
    if sc is None:
        return None
    B = (sc.T @ sc) / data.n
    iu = np.triu_indices(B.shape[0], 1)
    B[iu] = B.T[iu]
    return B


def observed_information(par, data, x, h=1e-6):
    """Observed information per case (Hessian of f/2) by Richardson extrapolation of the
    analytic gradient, step h = 1e-6 (lavaan::lav_model_hessian)."""
    k = par.npar
    H = np.zeros((k, k))
    for j in range(k):
        def at(delta):
            y = np.array(x, dtype=float)
            y[j] = y[j] + delta
            r = objective_and_gradient(par, data, y)
            return None if r is None else r[1]

        gl = at(-h)
        gl2 = at(-2 * h)
        gr = at(h)
        gr2 = at(2 * h)
        if gl is None or gl2 is None or gr is None or gr2 is None:
            return None
        H[:, j] = (0.5 * (gl2 - 8 * gl + 8 * gr - gr2)) / (12 * h)
    return 0.5 * (H + H.T)


# =============================================================================================
# optimizer


def minimize(par, data, start, max_iter=500, grad_tol=1e-9, step_tol=1e-12):
    """Fisher scoring with backtracking line search (Sigma kept PD), Newton steps on the
    finite-difference Hessian near the optimum, ridge-regularised fallbacks."""
    x = np.array(start, dtype=float)
    cur = objective_and_gradient(par, data, x)
    if cur is None:
        return {
            "x": x,
            "f": math.nan,
            "grad": np.zeros(par.npar),
            "iterations": 0,
            "converged": False,
            "message": "the starting values imply a non-positive-definite covariance matrix",
        }

    def max_abs(v):
        return float(np.max(np.abs(v))) if v.size else 0.0

    small = 0
    newton = False
    it = 1
    while it <= max_iter:
        H = None
        if newton:
            obs = observed_information(par, data, x)
            if obs is not None:
                H = obs * 2
                if cholesky_lower(H) is None:
                    H = None
        if H is None:
            H = expected_hessian(par, data, x)
        f0, g0 = cur
        directions = [lambda H=H, g0=g0: gj_solve(H, g0) if H is not None else None]
        if H is not None:
            tr = float(np.sum(np.abs(np.diag(H))))
            for kk in range(6):

                def ridge_dir(kk=kk, H=H, g0=g0, tr=tr):
                    ridge = (tr / max(H.shape[0], 1)) * math.pow(10, -8 + 2 * kk)
                    return gj_solve(H + ridge * np.eye(H.shape[0]), g0)

                directions.append(ridge_dir)
        directions.append(lambda g0=g0: np.array(g0, dtype=float))
        accepted = None
        step = g0
        alpha = 1.0
        for dir_fn in directions:
            s = dir_fn()
            if s is None or not np.all(np.isfinite(s)):
                continue
            slope = float(s @ g0)
            if not (slope > 0):
                continue
            alpha = 1.0
            for _ in range(40):
                y = x - alpha * s
                fy = objective_only(par, data, y)
                if (
                    fy is not None
                    and math.isfinite(fy)
                    and fy <= f0 - 1e-4 * alpha * slope + 1e-13 * abs(f0)
                ):
                    accepted = (y, fy)
                    break
                alpha /= 2
            if accepted is not None:
                step = s
                break
        if accepted is None:
            break
        step_size = max_abs(step) * alpha
        x = accepted[0]
        nxt = objective_and_gradient(par, data, x)
        if nxt is None:
            break
        df = f0 - nxt[0]
        cur = nxt
        g = max_abs(cur[1])
        if g < 1e-4:
            newton = True
        if step_size < step_tol or (g < grad_tol and abs(df) < 1e-15):
            small += 1
            if small >= 2 or g < grad_tol * 1e-3:
                break
        else:
            small = 0
        it += 1
    g = max_abs(cur[1])
    return {
        "x": x,
        "f": cur[0],
        "grad": cur[1],
        "iterations": min(it, max_iter),
        "converged": g < max(grad_tol * 100, 1e-7),
    }


# =============================================================================================
# starting values


def start_values(spec, S, mean):
    """Starting values from the (h1) sample moments (triad loadings, remainder residuals,
    cross-block factor covariances, paths 0, intercepts = means)."""
    m, p = spec.m, spec.p
    x = np.zeros(spec.npar)
    blocks = [[] for _ in range(m)]
    for e in spec.entries:
        if e.mat == "lambda":
            blocks[e.col].append(e.row)
    lam = np.zeros((p, m))
    phi = np.zeros(m)
    for j in range(m):
        idx = blocks[j]
        cs = []
        for i in idx:
            sii = S[i, i]
            others = [k for k in idx if k != i]
            if len(others) >= 2:
                s = 0.0
                cnt = 0
                for a in range(len(others)):
                    for b in range(a + 1, len(others)):
                        ka, kb = others[a], others[b]
                        sab = S[ka, kb]
                        if abs(sab) < 1e-8 * math.sqrt(S[ka, ka] * S[kb, kb]):
                            continue
                        s += abs((S[i, ka] * S[i, kb]) / sab)
                        cnt += 1
                c2 = s / cnt if cnt else 0.5 * sii
            elif len(others) == 1:
                c2 = abs(S[i, others[0]])
            else:
                c2 = sii
            c2 = min(max(c2, 0.05 * sii), 0.95 * sii if others else sii)
            cs.append(math.sqrt(c2))
        marker = idx[0]
        signed = [cs[t] if (t == 0 or S[i, marker] >= 0) else -cs[t] for t, i in enumerate(idx)]
        if spec.identification == "marker":
            phi[j] = signed[0] ** 2
            for t, i in enumerate(idx):
                lam[i, j] = signed[t] / signed[0]
        else:
            phi[j] = 1.0
            for t, i in enumerate(idx):
                lam[i, j] = signed[t]

    def latent_cov(a, b):
        s = 0.0
        cnt = 0
        for i in blocks[a]:
            for k in blocks[b]:
                if i == k:
                    continue
                la = lam[i, a]
                lb = lam[k, b]
                if la == 0 or lb == 0:
                    continue
                s += S[i, k] / (la * lb)
                cnt += 1
        if not cnt:
            return 0.0
        lim = 0.9 * math.sqrt(phi[a] * phi[b])
        return max(-lim, min(lim, s / cnt))

    for e in spec.entries:
        if e.free < 0:
            continue
        v = 0.0
        if e.mat == "lambda":
            v = lam[e.row, e.col]
        elif e.mat == "beta":
            v = 0.0
        elif e.mat == "psi":
            v = phi[e.row] if e.row == e.col else latent_cov(e.row, e.col)
        elif e.mat == "theta":
            if e.row == e.col:
                common = 0.0
                for j in range(m):
                    common += lam[e.row, j] ** 2 * phi[j]
                sii = S[e.row, e.row]
                v = max(sii - common, 0.1 * sii)
            else:
                v = 0.0
        elif e.mat == "nu":
            v = mean[e.row] if mean is not None else 0.0
        elif e.mat == "alpha":
            v = 0.0
        x[e.free] = v
    # keep the implied covariance positive definite
    for _ in range(30):
        st = model_state(spec, x)
        if st is not None and cholesky_lower(st.sigma) is not None:
            break
        for e in spec.entries:
            if e.free < 0:
                continue
            if e.row != e.col and e.mat in ("psi", "theta"):
                x[e.free] = x[e.free] * 0.5
            if e.row == e.col and e.mat == "theta":
                x[e.free] = x[e.free] + 0.1 * S[e.row, e.row]
    return x


# =============================================================================================
# inference

_SINGULAR_REL = 1e-10


def information_matrix(par, data, x, kind):
    if kind == "expected":
        H = expected_hessian(par, data, x)
        return None if H is None else H * 0.5
    return observed_information(par, data, x)


def compute_vcov(par, data, x, kind, robust):
    """{'vcov', 'information', 'first_order', 'info_inverse', 'problem'?, 'min_eigen'?}."""
    info = information_matrix(par, data, x, kind)
    if info is None or not np.all(np.isfinite(info)):
        return {"vcov": None, "information": None, "first_order": None, "info_inverse": None,
                "problem": "information-failed"}
    ev = sym_eigenvalues(info)
    max_ev = max(float(np.max(np.abs(ev))) if ev.size else 0.0, 0.0)
    min_ev = float(np.min(ev)) if ev.size else math.inf
    inv = gj_inverse(info)
    if inv is None or not (min_ev > _SINGULAR_REL * max_ev):
        return {"vcov": None, "information": info, "first_order": None, "info_inverse": None,
                "problem": "information-singular", "min_eigen": min_ev}
    n = data.n
    if not robust:
        return {"vcov": inv / n, "information": info, "first_order": None, "info_inverse": inv}
    B = first_order_information(par, data, x)
    if B is None:
        return {"vcov": None, "information": info, "first_order": None, "info_inverse": inv,
                "problem": "information-failed"}
    s = ((inv @ B) @ inv) / n
    return {"vcov": s, "information": info, "first_order": B, "info_inverse": inv}


def _trace_product(B, Ainv):
    """tr(B A^-1) given A^-1."""
    return float(np.sum(B * Ainv.T))


def h1_trace(sat, data, xh1):
    A1 = observed_information(sat, data, xh1)
    B1 = first_order_information(sat, data, xh1)
    if A1 is None or B1 is None:
        return None
    A1inv = gj_inverse(A1)
    if A1inv is None:
        return None
    return _trace_product(B1, A1inv)


def h0_trace(par, data, x, info_inverse=None, first_order=None):
    Iinv = info_inverse
    if Iinv is None:
        I = observed_information(par, data, x)
        Iinv = None if I is None else gj_inverse(I)
    B0 = first_order if first_order is not None else first_order_information(par, data, x)
    if Iinv is None or B0 is None:
        return None
    return _trace_product(B0, Iinv)


# =============================================================================================
# engine


def _err(code, message, details=None):
    e = {"code": code, "message": message}
    if details is not None:
        e["details"] = details
    return {"ok": False, "error": e}


def estimate_cb(model, analysis, data, on_progress=None, is_cancelled=None):
    """Estimate a CB-SEM model. Never raises: failures are {'ok': False, 'error'}."""
    try:
        with np.errstate(all="ignore"):
            return _estimate_cb(model, analysis, data, on_progress, is_cancelled)
    except Exception as e:  # noqa: BLE001 - mirrors estimateCb's catch-all
        return _err("ENGINE_INTERNAL", f"Unexpected error in the CB engine: {e}")


def _max_abs(v):
    return float(np.max(np.abs(v))) if np.size(v) else 0.0


def _estimate_cb(model, analysis, inp, on_progress, is_cancelled):
    started_at = iso_now()

    def cancelled():
        return is_cancelled is not None and is_cancelled() is True

    def progress(stage):
        if on_progress is not None:
            on_progress({"stage": stage})

    progress("validating")
    if analysis.get("method") != "cb-sem":
        return _err("REQUEST_INVALID", f"The CB engine cannot run method {analysis.get('method')}.",
                    {"reason": "method"})
    estimator = str(analysis.get("estimator")).upper()
    if estimator not in ("ML", "MLR"):
        return _err(
            "CAPABILITY_UNSUPPORTED",
            f"Estimator {analysis.get('estimator')} is not implemented in the browser CB engine (ML and MLR are).",
            {"reason": "estimator", "estimator": analysis.get("estimator")},
        )
    if (analysis.get("bootstrap") or {}).get("enabled"):
        return _err("CAPABILITY_UNSUPPORTED",
                    "Bootstrap inference for CB-SEM is not implemented in the browser engine.",
                    {"reason": "cb-bootstrap"})
    robust = estimator == "MLR"
    fiml = analysis.get("missingData") == "fiml"
    cbopt = analysis.get("cb") or {}
    identification = cbopt.get("identification") or "marker"
    requested_means = cbopt.get("meanStructure") or False
    mean_structure = bool(requested_means or fiml)
    warnings = []
    messages = []
    if fiml and not requested_means:
        warnings.append({
            "code": "CB_MEANSTRUCTURE_ADDED",
            "severity": "info",
            "message": 'FIML requires a mean structure; indicator intercepts were added (as lavaan does for missing = "ml").',
        })

    spec, serr = build_cb_spec(model, identification, mean_structure)
    if spec is None:
        return {"ok": False, "error": serr}
    moments = sample_moments(spec.p, mean_structure)
    df = moments - spec.npar
    if df < 0:
        return _err(
            "MODEL_NOT_IDENTIFIED",
            f"The model has more free parameters ({spec.npar}) than sample moments ({moments}); df = {df} < 0 (t-rule).",
            {"reason": "t-rule", "npar": spec.npar, "moments": moments, "df": df},
        )

    prep, perr = cb_prepare_data(model, spec.ov_ids, inp, "fiml" if fiml else "listwise")
    if prep is None:
        return {"ok": False, "error": perr}
    data, n_used, _ = prep
    N = data.n
    if not fiml and not data.complete:
        return _err("ENGINE_INTERNAL", "listwise data are incomplete")

    # h1 (saturated) moments
    if data.complete:
        h1_sigma, h1_mu = data.cov, data.mean
    else:
        em = em_saturated(data)
        if em is None:
            return _err("ENGINE_INADMISSIBLE",
                        "The EM estimate of the saturated covariance matrix became singular.",
                        {"reason": "em-singular"})
        if not em[3]:
            warnings.append({
                "code": "CB_EM_NOT_CONVERGED",
                "severity": "warning",
                "message": f"The EM algorithm for the saturated (h1) moments did not converge in {em[2]} iterations.",
            })
        h1_mu, h1_sigma = em[0], em[1]
    singular = _singular_covariance_error(h1_sigma, spec, model, data.complete)
    if singular is not None:
        return {"ok": False, "error": singular}
    if N <= spec.npar:
        warnings.append({"code": "CB_N_BELOW_PARAMETERS", "severity": "warning",
                         "message": f"Only {N} cases for {spec.npar} free parameters."})

    if cancelled():
        return _err("CANCELLED", "Cancelled.")
    progress("estimating")

    par = ModelParameterization(spec)
    start = start_values(spec, h1_sigma, h1_mu)
    opt = minimize(par, data, start)
    if not opt["converged"]:
        msg = f"; {opt['message']}" if opt.get("message") else ""
        return _err("ENGINE_NONCONVERGENCE",
                    f"The ML optimiser did not converge ({opt['iterations']} iterations{msg}).",
                    {"iterations": opt["iterations"]})
    x = opt["x"]
    st = model_state(spec, x)
    messages.append(
        f"ML by Fisher scoring with Newton refinement: {opt['iterations']} iterations, max |gradient| {js_to_exponential(_max_abs(opt['grad']), 2)}."
    )
    if cancelled():
        return _err("CANCELLED", "Cancelled.")

    # --- inference
    info_kind = "observed" if (robust or fiml) else "expected"
    vc = compute_vcov(par, data, x, info_kind, robust)
    se_problem = None
    if vc["vcov"] is None:
        se_problem = "failed"
        if vc.get("problem") == "information-singular":
            me = vc.get("min_eigen")
            msg = f"The {info_kind} information matrix is singular (smallest eigenvalue {js_to_exponential(me if me is not None else math.nan, 2)}): the model is empirically under-identified at this solution. Standard errors are not reported."
        else:
            msg = "The information matrix could not be computed; standard errors are not reported."
        warnings.append({"code": "CB_INFORMATION_SINGULAR", "severity": "warning", "message": msg})

    progress("summarizing")

    # --- admissibility (lavaan post.check)
    admissible, adm_warnings = _admissibility(spec, st)
    warnings.extend(adm_warnings)

    # --- fit
    fit = _fit_measures(spec, data, x, opt["f"], df, h1_sigma, h1_mu, robust, fiml,
                        vc["info_inverse"], vc["first_order"], warnings)

    # --- parameters
    std = _standardized(spec, st)
    source_method = f"sem-lab:cb-sem:{estimator}"
    parameters = []
    inference_method = "robust-analytic" if robust else "analytic"
    for k, e in enumerate(spec.entries):
        ids = {}
        if e.source_id:
            ids["sourceId"] = e.source_id
        if e.target_id:
            ids["targetId"] = e.target_id
        if e.relationship_id:
            ids["relationshipId"] = e.relationship_id
        est = float(x[e.free]) if e.free >= 0 else float(e.value)
        if e.free < 0:
            parameters.append({
                "key": e.key, "kind": e.kind, **ids, "scale": "unstandardized", "est": est,
                "se": None, "statistic": None, "pValue": None, "ciLower": None, "ciUpper": None,
                "missing": {f: "not-applicable" for f in ("se", "statistic", "pValue", "ciLower", "ciUpper")},
                "status": "fixed", "sourceMethod": source_method, "rawPath": e.where,
            })
        else:
            variance = float(vc["vcov"][e.free, e.free]) if vc["vcov"] is not None else math.nan
            se = math.sqrt(variance) if variance >= 0 else math.nan
            if not math.isfinite(se):
                reason = se_problem or "non-finite"
                parameters.append({
                    "key": e.key, "kind": e.kind, **ids, "scale": "unstandardized", "est": est,
                    "se": None, "statistic": None, "pValue": None, "ciLower": None, "ciUpper": None,
                    "missing": {f: reason for f in ("se", "statistic", "pValue", "ciLower", "ciUpper")},
                    "status": "estimated", "sourceMethod": source_method, "rawPath": e.where,
                })
            else:
                z = est / se if se > 0 else math.nan
                z_ok = math.isfinite(z)
                p = {
                    "key": e.key, "kind": e.kind, **ids, "scale": "unstandardized", "est": est,
                    "se": se, "statistic": z if z_ok else None, "statisticType": "z",
                    "pValue": p_two_sided_normal(z) if z_ok else None,
                    "ciLower": est - Z_975 * se, "ciUpper": est + Z_975 * se,
                }
                if not z_ok:
                    p["missing"] = {"statistic": "non-finite", "pValue": "non-finite"}
                p["status"] = "estimated"
                p["inference"] = {"method": inference_method, "level": 0.95, "sides": "two-sided"}
                p["sourceMethod"] = source_method
                p["rawPath"] = e.where
                parameters.append(p)
        sv = std[k]
        std_missing = {f: "not-supported" for f in ("se", "statistic", "pValue", "ciLower", "ciUpper")}
        if not math.isfinite(sv):
            std_missing["est"] = "non-finite"
        parameters.append({
            "key": e.key, "kind": e.kind, **ids, "scale": "standardized",
            "est": float(sv) if math.isfinite(sv) else None,
            "se": None, "statistic": None, "pValue": None, "ciLower": None, "ciUpper": None,
            "missing": std_missing,
            "status": "fixed" if e.mat == "alpha" else "estimated",
            "sourceMethod": f"{source_method}:std.all",
            "rawPath": f"std.all:{e.where}",
        })

    # --- construct metrics: R² of endogenous factors
    construct_metrics = []
    for j, cid in enumerate(spec.lv_ids):
        if not spec.endogenous[j]:
            construct_metrics.append({"constructId": cid, "metric": "r2", "value": None,
                                      "missing": "not-applicable",
                                      "definition": "R² of an exogenous factor is not defined."})
            continue
        r2 = 1 - st.psi[j, j] / st.phi[j, j]
        definition = "R² = 1 − ψ_jj / Var(η_j), model-implied."
        if math.isfinite(r2):
            construct_metrics.append({"constructId": cid, "metric": "r2", "value": float(r2),
                                      "definition": definition})
        else:
            construct_metrics.append({"constructId": cid, "metric": "r2", "value": None,
                                      "missing": "non-finite", "definition": definition})

    # --- latent correlation matrix
    m = spec.m
    latent_values = []
    for a in range(m):
        row = []
        for b in range(m):
            v = st.phi[a, b] / math.sqrt(st.phi[a, a] * st.phi[b, b]) if st.phi[a, a] * st.phi[b, b] >= 0 else math.nan
            row.append(float(v) if math.isfinite(v) else None)
        latent_values.append(row)
    latent_bad = any(v is None for r in latent_values for v in r)
    lc = {
        "id": "latent-correlations",
        "title": "Model-implied factor correlations",
        "rowIds": list(spec.lv_ids),
        "colIds": list(spec.lv_ids),
        "values": latent_values,
        "symmetric": True,
        "definition": "Φ = (I − B)⁻¹ Ψ (I − B)⁻ᵀ scaled to unit diagonal.",
    }
    if latent_bad:
        lc["missing"] = "non-finite"

    n_rows = inp.get("nRows")
    result = {
        "schemaVersion": 1,
        "sample": {
            "nRows": n_rows,
            "nUsed": n_used,
            "nDropped": n_rows - n_used,
            "missingData": "fiml" if fiml else "listwise",
        },
        "estimation": {
            "converged": True,
            "iterations": opt["iterations"],
            "admissible": admissible,
            "messages": messages,
        },
        "parameters": parameters,
        "constructMetrics": construct_metrics,
        "matrices": [lc],
        "fit": fit,
        "warnings": warnings,
        "provenance": provenance(
            f"estimateCb(estimator={estimator}, missing={'fiml' if fiml else 'listwise'}, identification={identification}, meanStructure={'true' if mean_structure else 'false'})",
            started_at,
            {"@sem-lab/engine/cb": CB_ENGINE_VERSION},
        ),
    }
    return {"ok": True, "result": result}


def _singular_covariance_error(S, spec, model, complete):
    """Non-PD sample covariance: report the near-linear dependency among indicators."""
    if cholesky_lower(S) is not None:
        ev = sym_eigenvalues(S)
        if ev[-1] > 1e-12 * ev[0]:
            return None
    values, vectors = sym_eigen(S)
    k = values.shape[0] - 1
    coef = [float(vectors[i, k]) for i in range(len(spec.ov_ids))]
    mx = max(abs(c) for c in coef)
    big = [(c, i) for i, c in enumerate(coef) if abs(c) > 1e-3 * mx]
    big.sort(key=lambda t: -abs(t[0]))
    names = {i["id"]: i.get("name") for i in model.get("indicators") or []}

    def name(i):
        iid = spec.ov_ids[i]
        nm = names.get(iid)
        return nm if nm is not None else iid

    lead_c, lead_i = big[0]
    parts = []
    for c, i in big[1:]:
        w = -c / lead_c
        parts.append(f"{'+' if w >= 0 else '−'} {js_to_fixed(abs(w), 3)}·{name(i)}")
    rhs = " ".join(parts)
    if rhs.startswith("+ "):
        rhs = rhs[2:]
    return {
        "code": "DATA_ZERO_VARIANCE",
        "message": f"The {'sample' if complete else 'EM-estimated'} covariance matrix of the indicators is singular (smallest eigenvalue {js_to_exponential(float(values[k]), 2)}): a linear combination of indicators has zero variance, {name(lead_i)} ≈ {rhs}. Remove one of the linearly dependent indicators.",
        "details": {
            "reason": "singular-covariance",
            "elementIds": [spec.ov_ids[i] for _, i in big],
            "dependency": {spec.ov_ids[i]: c / lead_c for c, i in big},
            "smallestEigenvalue": float(values[k]),
        },
    }


def _psd_ok(M):
    if M.shape[0] == 0:
        return True
    ev = sym_eigenvalues(M)
    tol = _CB_EPS**0.75 * max(1.0, abs(float(ev[0])))
    return not bool(np.any(ev < -tol))


def _admissibility(spec, st):
    warnings = []
    neg_ov = [iid for i, iid in enumerate(spec.ov_ids) if st.theta[i, i] < 0]
    neg_lv = [cid for j, cid in enumerate(spec.lv_ids) if st.psi[j, j] < 0]
    ok = True
    if neg_ov:
        ok = False
        warnings.append({
            "code": "CB_NEGATIVE_VARIANCE",
            "severity": "warning",
            "message": f"Negative residual variance estimate (Heywood case) for {', '.join(neg_ov)}: the solution is inadmissible; the standardized loading exceeds 1 in absolute value. Do not interpret the fit of this solution.",
            "elementIds": neg_ov,
        })
    if neg_lv:
        ok = False
        warnings.append({
            "code": "CB_NEGATIVE_VARIANCE",
            "severity": "warning",
            "message": f"Negative (residual) variance estimate for factor(s) {', '.join(neg_lv)}: the solution is inadmissible.",
            "elementIds": neg_lv,
        })
    phi_ok = True
    if not neg_lv and spec.m > 0 and not _psd_ok(st.phi):
        ok = phi_ok = False
        warnings.append({
            "code": "CB_LATENT_COV_NOT_PD",
            "severity": "warning",
            "message": "The covariance matrix of the latent variables is not positive definite (e.g. a factor correlation beyond ±1).",
            "elementIds": list(spec.lv_ids),
        })
    theta_ok = True
    if not neg_ov and not _psd_ok(st.theta):
        ok = theta_ok = False
        warnings.append({
            "code": "CB_THETA_NOT_PD",
            "severity": "warning",
            "message": "The residual covariance matrix of the indicators (Θ) is not positive definite.",
            "elementIds": list(spec.ov_ids),
        })
    if not neg_ov and not neg_lv and phi_ok and theta_ok and spec.m > 0 and not _psd_ok(st.psi):
        ok = False
        warnings.append({
            "code": "CB_PSI_NOT_PD",
            "severity": "warning",
            "message": "The covariance matrix of the structural residuals (Ψ) is not positive definite.",
            "elementIds": list(spec.lv_ids),
        })
    return ok, warnings


def _nsqrt(v):
    return math.sqrt(v) if v >= 0 else math.nan


def _ndiv(a, b):
    with np.errstate(all="ignore"):
        return float(np.divide(a, b))


def _standardized(spec, st):
    """lavaan std.all (cov.std = TRUE). Values may be NaN (reported as null)."""
    sd_ov = [_nsqrt(st.sigma[i, i]) for i in range(spec.p)]
    sd_lv = [_nsqrt(st.phi[j, j]) for j in range(spec.m)]
    out = []
    for e in spec.entries:
        r, c = e.row, e.col
        if e.mat == "lambda":
            v = _ndiv(st.lam[r, c] * sd_lv[c], sd_ov[r])
        elif e.mat == "beta":
            v = _ndiv(st.beta[r, c] * sd_lv[c], sd_lv[r])
        elif e.mat == "psi":
            v = (_ndiv(st.psi[r, r], st.phi[r, r]) if r == c
                 else _ndiv(st.psi[r, c], _nsqrt(st.psi[r, r] * st.psi[c, c])))
        elif e.mat == "theta":
            v = (_ndiv(st.theta[r, r], st.sigma[r, r]) if r == c
                 else _ndiv(st.theta[r, c], _nsqrt(st.theta[r, r] * st.theta[c, c])))
        elif e.mat == "nu":
            v = _ndiv(st.nu[r], sd_ov[r])
        elif e.mat == "alpha":
            v = _ndiv(st.alpha[r], sd_lv[r])
        else:
            v = math.nan
        out.append(v)
    return out


def _near_zero(t):
    """|t| below lavaan's all.equal tolerance counts as zero (lav_fit_cfi)."""
    return abs(t) < 1.5e-8


def cfi_value(x2, df, x2n, dfn, c=1.0, cn=1.0):
    use_c = df > 0 and c != 1 and cn != 1
    t1 = max(x2 - (c if use_c else 1) * df, 0)
    t2 = max(x2 - (c if use_c else 1) * df, x2n - (cn if use_c else 1) * dfn, 0)
    if _near_zero(t1) and _near_zero(t2):
        return 1.0
    return 1 - _ndiv(t1, t2)


def tli_value(x2, df, x2n, dfn, c=1.0, cn=1.0):
    use_c = df > 0 and c != 1 and cn != 1
    t1 = (x2 - (c if use_c else 1) * df) * dfn
    t2 = (x2n - (cn if use_c else 1) * dfn) * df
    if df > 0 and abs(t2) > 0:
        return 1 - t1 / t2
    return 1.0


def _js_max(*vals):
    """Math.max: NaN if any argument is NaN."""
    for v in vals:
        if v != v:
            return math.nan
    return max(vals)


def _fit_measures(spec, data, x, f, df, h1_sigma, h1_mu, robust, fiml, info_inverse,
                  first_order, warnings):
    N = data.n
    p = spec.p
    out = []

    def add(name, value, definition, variant=None, ci=None, missing=None, reason="non-finite"):
        ok = value is not None and math.isfinite(value)
        e = {"name": name, "value": (value if isinstance(value, int) else float(value)) if ok else None}
        if not ok:
            e["missing"] = missing or reason
        if variant:
            e["variant"] = variant
        if ci is not None:
            e["ciLower"] = ci[0]
            e["ciUpper"] = ci[1]
        e["definition"] = definition
        out.append(e)

    def na(name, definition, reason, variant=None):
        add(name, None, definition, variant=variant, missing=reason)

    mean_structure = spec.mean_structure
    mu_h1 = h1_mu if mean_structure else None
    f_h1 = evaluate(data, h1_sigma, mu_h1)[0]
    constant = sum(k.n * k.obs.shape[0] for k in data.patterns) * _LOG_2PI
    logl = -0.5 * (N * f + constant)
    logl_h1 = -0.5 * (N * f_h1 + constant)
    x2 = _js_max(N * (f - f_h1), 0)

    # baseline (independence) model: closed form (per-variable available-case ML moments)
    var_b = np.zeros(p)
    mu_b = np.zeros(p)
    cnt = np.zeros(p)
    for pat in data.patterns:
        mu_b[pat.obs] += pat.n * pat.mean
        cnt[pat.obs] += pat.n
    mu_b = mu_b / cnt
    for pat in data.patterns:
        var_b[pat.obs] += pat.n * (np.diag(pat.cov) + (pat.mean - mu_b[pat.obs]) ** 2)
    var_b = var_b / cnt
    sigma_b = np.diag(var_b)
    f_b = evaluate(data, sigma_b, mu_b if mean_structure else None)[0]
    x2_b = N * (f_b - f_h1)
    df_b = (p * (p - 1)) // 2

    just_id = df == 0
    add("chisq", x2, "Likelihood-ratio χ² against the saturated model, N·(F − F_h1) (lavaan: N·F_ML).",
        variant="standard")
    add("df", df, "Degrees of freedom: sample moments − free parameters.")
    if just_id:
        na("pvalue", "p value of the χ² test (not defined for df = 0).", "not-applicable", "standard")
    else:
        add("pvalue", pchisq_upper(x2, df), "p value of the χ² test, P(χ²_df > X²).", variant="standard")
    add("baseline.chisq", x2_b, "χ² of the independence (baseline) model.", variant="standard")
    add("baseline.df", df_b, "Degrees of freedom of the independence model, p(p−1)/2.")
    add("baseline.pvalue", pchisq_upper(x2_b, df_b), "p value of the baseline χ² test.", variant="standard")

    cfi_def = "CFI = 1 − max(X² − df, 0) / max(X² − df, X²_B − df_B, 0)."
    tli_def = "TLI = (X²_B/df_B − X²/df) / (X²_B/df_B − 1)."
    rmsea_def = "RMSEA = sqrt(max(X²/(N·df) − 1/N, 0)); 90% CI by noncentral χ² inversion (lavaan uniroot convention)."
    srmr_def = (
        "SRMR (Bentler): root mean square of covariance residuals scaled by the observed SDs, including the standardized mean residuals (lavaan 'srmr')."
        if mean_structure
        else "SRMR (Bentler): root mean square of the covariance residuals scaled by the observed SDs, diagonal included (lavaan 'srmr')."
    )
    if just_id:
        na("cfi", f"{cfi_def} Not informative for a just-identified model (df = 0).", "not-applicable", "standard")
        na("tli", f"{tli_def} Not informative for df = 0.", "not-applicable", "standard")
        na("rmsea", f"{rmsea_def} Not informative for df = 0.", "not-applicable", "standard")
        na("rmsea.pvalue", "Close-fit test P(RMSEA ≤ .05); not defined for df = 0.", "not-applicable", "standard")
        na("srmr", f"{srmr_def} Zero by construction for df = 0.", "not-applicable", "standard")
        warnings.append({
            "code": "CB_JUST_IDENTIFIED",
            "severity": "info",
            "message": "The model is just-identified (df = 0): it reproduces the sample moments exactly, so χ² = 0 and the global fit indices carry no information about fit.",
        })
    else:
        add("cfi", cfi_value(x2, df, x2_b, df_b), cfi_def, variant="standard")
        add("tli", tli_value(x2, df, x2_b, df_b), tli_def, variant="standard")
        ci = rmsea_ci(x2, df, N)
        add("rmsea", rmsea_point(x2, df, N), rmsea_def, variant="standard", ci=ci)
        add("rmsea.pvalue", rmsea_close_pvalue(x2, df, N, 0.05),
            "Close-fit test P(RMSEA ≤ .05): 1 − F(X²; df, λ = N·df·0.05²).", variant="standard")
        add("srmr", _srmr_bentler(h1_sigma, mu_h1, model_state(spec, x)), srmr_def, variant="standard")
    npar = spec.npar
    add("logl", logl, "Log-likelihood of the fitted model.")
    add("unrestricted.logl", logl_h1, "Log-likelihood of the saturated (h1) model.")
    add("aic", -2 * logl + 2 * npar, "AIC = −2 logL + 2·npar.")
    add("bic", -2 * logl + npar * math.log(N), "BIC = −2 logL + npar·ln N.")
    add("bic2", -2 * logl + npar * math.log((N + 2) / 24), "Sample-size adjusted BIC = −2 logL + npar·ln((N + 2)/24).")
    add("npar", npar, "Number of free parameters.")
    add("ntotal", N, "Number of cases used.")

    if not robust:
        return out

    # ---- MLR: Yuan–Bentler (Mplus variant) scaled test
    scaled_names = ["chisq", "chisq.scaling.factor", "pvalue", "baseline.chisq",
                    "baseline.chisq.scaling.factor", "cfi", "tli", "rmsea"]
    if just_id:
        for nm in scaled_names:
            na(nm, "Yuan–Bentler scaled statistic: not defined for df = 0.", "not-applicable", "scaled")
        for nm in ("cfi", "tli", "rmsea"):
            na(nm, "Robust fit index: not defined for df = 0.", "not-applicable", "robust")
        return out
    sat = SaturatedParameterization(p, mean_structure)
    tr_h1 = h1_trace(sat, data, saturated_theta(h1_sigma, mu_h1))
    par = ModelParameterization(spec)
    tr_h0 = h0_trace(par, data, x, info_inverse, first_order)
    indep = IndependenceParameterization(p, mean_structure)
    x_b = np.concatenate([var_b, mu_b]) if mean_structure else var_b.copy()
    tr_b0 = h0_trace(indep, data, x_b)
    if tr_h1 is None or tr_h0 is None or tr_b0 is None:
        for nm in scaled_names:
            na(nm, "Yuan–Bentler scaled statistic (computation failed).", "failed", "scaled")
        return out
    trace = tr_h1 - tr_h0
    c = _ndiv(trace, df)
    c_b = _ndiv(tr_h1 - tr_b0, df_b)
    x2s = _ndiv(x2, c)
    x2_bs = _ndiv(x2_b, c_b)
    yb_def = 'Yuan–Bentler scaled χ² (Mplus variant, lavaan "yuan.bentler.mplus"): X²/c, c = [tr(B₁A₁⁻¹) − tr(B₀I⁻¹)]/df.'
    add("chisq", x2s, yb_def, variant="scaled")
    add("chisq.scaling.factor", c, "Scaling factor c of the Yuan–Bentler test.", variant="scaled")
    add("pvalue", 1 - pnchisq(x2s, df, 0), "p value of the scaled χ² test.", variant="scaled")
    add("baseline.chisq", x2_bs, "Yuan–Bentler scaled χ² of the independence model.", variant="scaled")
    add("baseline.chisq.scaling.factor", c_b, "Scaling factor of the baseline Yuan–Bentler test.", variant="scaled")
    add("cfi", cfi_value(x2s, df, x2_bs, df_b),
        "CFI computed from the scaled χ² of the model and the baseline (lavaan cfi.scaled).", variant="scaled")
    add("tli", tli_value(x2s, df, x2_bs, df_b),
        "TLI computed from the scaled χ² statistics (lavaan tli.scaled).", variant="scaled")
    ci = rmsea_ci(x2, trace, N)
    add("rmsea", rmsea_point(x2, trace, N),
        "RMSEA with df replaced by tr(UΓ) (lavaan rmsea.scaled), 90% CI likewise.", variant="scaled", ci=ci)
    if fiml:
        why = "Robust (Brosseau-Liard–Savalei / Savalei FIML-corrected) index: not implemented for FIML in the browser engine."
        na("cfi", why, "not-supported", "robust")
        na("tli", why, "not-supported", "robust")
        na("rmsea", why, "not-supported", "robust")
    else:
        add("cfi", cfi_value(x2, df, x2_b, df_b, c, c_b),
            "Robust CFI (Brosseau-Liard & Savalei 2014; lavaan cfi.robust).", variant="robust")
        add("tli", tli_value(x2, df, x2_b, df_b, c, c_b), "Robust TLI (lavaan tli.robust).", variant="robust")
        ci = rmsea_ci(x2s, df, N, c)
        add("rmsea", rmsea_point(x2, df, N, c),
            "Robust RMSEA (Brosseau-Liard, Savalei & Li 2012; lavaan rmsea.robust), 90% CI.",
            variant="robust", ci=ci)
    return out


def _srmr_bentler(S, m, st):
    """Bentler SRMR (lavaan "srmr"; with a mean structure the standardized mean residuals too)."""
    p = S.shape[0]
    d = np.sqrt(np.diag(S))
    R = (S - st.sigma) / np.outer(d, d)
    il = np.tril_indices(p)
    ss = float(np.sum(R[il] ** 2))
    cnt = len(il[0])
    if m is not None and st.mu is not None:
        r = (m - st.mu) / d
        ss += float(np.sum(r * r))
        cnt += p
    return math.sqrt(ss / cnt)
