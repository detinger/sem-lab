"""Phase 0 compatibility probe (standalone: imports nothing from this repository).

Exercises the code paths of plspm and semopy that SEM Studio intends to use and prints ONE
JSON object to stdout: per check either {"ok": true, "value": ...} or
{"ok": false, "error": "<ExceptionType>: <message>"}.

It is run by spike/compat_matrix.py inside throw-away environments
(`uv run --no-project --python X --with numpy==.. --with pandas==..`) so that the same
checks can be compared across interpreter / numpy / pandas / scipy combinations.

Usage:  python compat_probe.py <path-to-TAM-Data.txt>
"""

from __future__ import annotations

import importlib.metadata as md
import json
import math
import platform
import sys
import time
import traceback
import warnings

BLOCKS = {
    "PU": ["USEF1", "USEF2", "USEF3", "USEF4", "USEF5"],
    "PEOU": ["EOU1", "EOU2", "EOU3", "EOU4", "EOU5"],
    "ATU": ["ATT1", "ATT2", "ATT3", "ATT4", "ATT5"],
    "BI": ["BI1", "BI2", "BI3"],
    "USE": ["USE1", "USE2", "USE3", "USE4"],
}
PATHS = [("PEOU", "PU"), ("PEOU", "ATU"), ("PU", "ATU"), ("PU", "BI"), ("ATU", "BI"), ("BI", "USE")]

SEMOPY_SEM = """
PU =~ USEF1 + USEF2 + USEF3 + USEF4 + USEF5
PEOU =~ EOU1 + EOU2 + EOU3 + EOU4 + EOU5
ATU =~ ATT1 + ATT2 + ATT3 + ATT4 + ATT5
BI =~ BI1 + BI2 + BI3
USE =~ USE1 + USE2 + USE3 + USE4
PU ~ PEOU
ATU ~ PEOU + PU
BI ~ PU + ATU
USE ~ BI
"""


def _clean(x):
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, dict):
        return {str(k): _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    try:
        import numpy as np

        if isinstance(x, np.generic):
            return _clean(x.item())
    except Exception:  # pragma: no cover
        pass
    return x


def main(data_path: str) -> dict:
    out: dict = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "versions": {},
        "checks": {},
        "warning_categories": {},
    }
    for pkg in ["numpy", "pandas", "scipy", "statsmodels", "scikit-learn", "semopy", "plspm", "sympy", "numdifftools"]:
        try:
            out["versions"][pkg] = md.version(pkg)
        except Exception as e:  # pragma: no cover
            out["versions"][pkg] = f"<missing: {e}>"

    checks = out["checks"]

    def check(name):
        def deco(fn):
            t0 = time.perf_counter()
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                try:
                    checks[name] = {"ok": True, "value": _clean(fn())}
                except Exception as e:  # noqa: BLE001 - the whole point is to record any failure
                    tb = traceback.extract_tb(e.__traceback__)
                    where = f"{tb[-1].filename.split('site-packages/')[-1]}:{tb[-1].lineno}" if tb else "?"
                    checks[name] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:300]}", "where": where}
            checks[name]["seconds"] = round(time.perf_counter() - t0, 3)
            cats: dict = {}
            for w in caught:
                key = f"{w.category.__name__} @ {str(w.filename).split('site-packages/')[-1]}:{w.lineno}"
                cats[key] = str(w.message)[:200]
            if cats:
                out["warning_categories"][name] = cats
            return fn

        return deco

    import numpy as np
    import pandas as pd

    df = pd.read_csv(data_path, sep=";")

    # ------------------------------------------------------------------ plspm
    @check("plspm.import")
    def _():
        import plspm.config  # noqa: F401
        from plspm.plspm import Plspm  # noqa: F401

        return True

    def build(scaled=True, default_scale=None, modes=None):
        import plspm.config as c
        from plspm.mode import Mode

        s = c.Structure()
        for a, b in PATHS:
            s.add_path([a], [b])
        cfg = c.Config(s.path(), scaled=scaled, default_scale=default_scale)
        for lv, mvs in BLOCKS.items():
            mode = Mode.B if (modes or {}).get(lv) == "B" else Mode.A
            cfg.add_lv(lv, mode, *[c.MV(m) for m in mvs])
        return cfg

    def paths_of(p):
        pc = p.path_coefficients()
        return {f"{a}->{b}": float(pc.loc[b, a]) for a, b in PATHS}

    @check("plspm.metric_scaled.path")
    def _():
        from plspm.plspm import Plspm
        from plspm.scheme import Scheme

        return paths_of(Plspm(df, build(), Scheme.PATH, 300, 1e-10))

    @check("plspm.metric_unscaled.path")
    def _():
        from plspm.plspm import Plspm
        from plspm.scheme import Scheme

        return paths_of(Plspm(df, build(scaled=False), Scheme.PATH, 300, 1e-10))

    @check("plspm.num.path")
    def _():
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        return paths_of(Plspm(df, build(default_scale=Scale.NUM), Scheme.PATH, 300, 1e-10))

    @check("plspm.num.centroid")
    def _():
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        return paths_of(Plspm(df, build(default_scale=Scale.NUM), Scheme.CENTROID, 300, 1e-10))

    @check("plspm.num.factorial")
    def _():
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        return paths_of(Plspm(df, build(default_scale=Scale.NUM), Scheme.FACTORIAL, 300, 1e-10))

    @check("plspm.accessors")
    def _():
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        p = Plspm(df, build(default_scale=Scale.NUM), Scheme.PATH, 300, 1e-10)
        return {
            "inner_model": list(p.inner_model().columns),
            "outer_model": list(p.outer_model().columns),
            "inner_summary": list(p.inner_summary().columns),
            "unidimensionality": list(p.unidimensionality().columns),
            "effects": list(p.effects().columns),
            "crossloadings_shape": list(p.crossloadings().shape),
            "scores_shape": list(p.scores().shape),
            "goodness_of_fit": float(p.goodness_of_fit()),
        }

    @check("plspm.modeB_mixed.num.path")
    def _():
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        return paths_of(Plspm(df, build(default_scale=Scale.NUM, modes={"PEOU": "B"}), Scheme.PATH, 300, 1e-10))

    @check("plspm.modeB_mixed.metric.path")
    def _():
        from plspm.plspm import Plspm
        from plspm.scheme import Scheme

        return paths_of(Plspm(df, build(modes={"PEOU": "B"}), Scheme.PATH, 300, 1e-10))

    @check("plspm.ord.path")
    def _():
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        return paths_of(Plspm(df, build(default_scale=Scale.ORD), Scheme.PATH, 300, 1e-7))

    def with_missing():
        d = df.copy()
        rng = np.random.default_rng(20261119)
        rows = rng.choice(len(d), size=30, replace=False)
        cols = rng.integers(0, d.shape[1], size=30)
        for r, cidx in zip(rows, cols):
            d.iat[int(r), int(cidx)] = np.nan
        return d

    @check("plspm.missing.metric_scaled")
    def _():
        from plspm.plspm import Plspm
        from plspm.scheme import Scheme

        return paths_of(Plspm(with_missing(), build(), Scheme.PATH, 300, 1e-10))

    @check("plspm.missing.num")
    def _():
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        return paths_of(Plspm(with_missing(), build(default_scale=Scale.NUM), Scheme.PATH, 300, 1e-10))

    @check("plspm.higher_order.num")
    def _():
        import plspm.config as c
        from plspm.mode import Mode
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        s = c.Structure()
        s.add_path(["BELIEFS"], ["BI"])
        s.add_path(["BI"], ["USE"])
        cfg = c.Config(s.path(), default_scale=Scale.NUM)
        cfg.add_higher_order("BELIEFS", Mode.A, ["PU", "PEOU"])
        for lv in ["PU", "PEOU", "BI", "USE"]:
            cfg.add_lv(lv, Mode.A, *[c.MV(m) for m in BLOCKS[lv]])
        p = Plspm(df, cfg, Scheme.PATH, 300, 1e-10)
        pc = p.path_coefficients()
        return {"BELIEFS->BI": float(pc.loc["BI", "BELIEFS"]), "BI->USE": float(pc.loc["USE", "BI"])}

    @check("plspm.bootstrap.num.20x1")
    def _():
        from plspm.plspm import Plspm
        from plspm.scale import Scale
        from plspm.scheme import Scheme

        p = Plspm(
            df, build(default_scale=Scale.NUM), Scheme.PATH, 300, 1e-7, bootstrap=True, bootstrap_iterations=20, processes=1
        )
        b = p.bootstrap()
        return {
            "paths_columns": list(b.paths().columns),
            "paths_rows": int(b.paths().shape[0]),
            "paths_std_error_finite": bool(np.isfinite(b.paths()["std.error"]).all()),
            "weights_rows": int(b.weights().shape[0]),
            "loading_rows": int(b.loading().shape[0]),
        }

    # ----------------------------------------------------------------- semopy
    @check("semopy.import")
    def _():
        import semopy

        return semopy.__version__

    fitted = {}

    @check("semopy.sem.mlw.fit")
    def _():
        import semopy

        m = semopy.Model(SEMOPY_SEM)
        r = m.fit(df, obj="MLW")
        fitted["sem"] = m
        return {"success": bool(r.success), "fun": float(r.fun), "n_it": int(r.n_it), "message": str(r.message)}

    @check("semopy.sem.inspect_std")
    def _():
        ins = fitted["sem"].inspect(std_est=True)
        reg = ins[(ins["op"] == "~") & ins["lval"].isin(list(BLOCKS)) & ins["rval"].isin(list(BLOCKS))]
        return {f"{r.rval}->{r.lval}": float(r["Est. Std"]) for _, r in reg.iterrows()}

    @check("semopy.sem.inspect_robust")
    def _():
        ins = fitted["sem"].inspect(se_robust=True)
        return {"columns": list(ins.columns), "rows": int(ins.shape[0])}

    @check("semopy.sem.calc_stats")
    def _():
        import semopy

        st = semopy.calc_stats(fitted["sem"])
        return {k: float(v) for k, v in st.iloc[0].items()}

    @check("semopy.sem.predict_factors")
    def _():
        f = fitted["sem"].predict_factors(df)
        return {"shape": list(f.shape), "columns": list(f.columns)}

    for obj in ["ULS", "GLS", "WLS", "DWLS", "FIML"]:

        @check(f"semopy.sem.{obj.lower()}.fit")
        def _(obj=obj):
            import semopy

            m = semopy.Model(SEMOPY_SEM)
            r = m.fit(df, obj=obj)
            return {"success": bool(r.success), "fun": float(r.fun), "n_it": int(r.n_it)}

    @check("semopy.modelmeans.ml.missing")
    def _():
        import semopy

        m = semopy.ModelMeans(SEMOPY_SEM)
        r = m.fit(with_missing(), obj="ML")
        ins = m.inspect()
        return {"success": bool(r.success), "fun": float(r.fun), "rows": int(ins.shape[0])}

    @check("semopy.ordinal.cfa2")
    def _():
        import semopy

        desc = "BI =~ BI1 + BI2 + BI3\nUSE =~ USE1 + USE2 + USE3\nDEFINE(ordinal) BI1 BI2 BI3 USE1 USE2 USE3\n"
        m = semopy.Model(desc)
        r = m.fit(df.iloc[:300], obj="DWLS")
        return {"success": bool(r.success), "fun": float(r.fun)}

    out["ok"] = all(c["ok"] for c in checks.values())
    out["failed"] = [k for k, c in checks.items() if not c["ok"]]
    return out


if __name__ == "__main__":
    result = main(sys.argv[1])
    print(json.dumps(result, allow_nan=False))
