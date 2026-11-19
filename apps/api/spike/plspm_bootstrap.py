"""Phase 0 spike: plspm 0.5.7 bootstrap - how it is requested, seeding, statistics, failures, timing.

Run:    cd apps/api && uv run python spike/plspm_bootstrap.py
Writes: docs/validation/phase-0/evidence/python/plspm_bootstrap.json

Facts from the installed source (plspm/bootstrap.py) that these experiments test:
  * resampling happens inside multiprocessing.Process children (`processes` argument, default 2) with
    `np.random.randint(n, size=n)` from NumPy's GLOBAL RNG; there is no seed argument;
  * a resample whose estimation raises is skipped by a bare `except: pass` and not counted;
  * summaries: original, mean, std.error (pandas std, ddof=1), perc.025 / perc.975 (pandas quantile,
    linear interpolation), t stat. = original / std.error.
The multiprocessing start method decides whether a parent-side np.random.seed() reaches the children:
spawn (macOS / Windows default) re-imports NumPy in the child -> fresh OS-entropy state; fork (Linux
default on Python <= 3.13, i.e. Colab) copies the parent's RNG state into EVERY child.
"""

from __future__ import annotations

import multiprocessing as mp
import time

import numpy as np
import pandas as pd
import plspm.config as c
from _common import EVIDENCE_DIR, TAM_BLOCKS, TAM_PATHS, Recorder, dump_json, load_tam, max_abs_diff, versions
from plspm.mode import Mode
from plspm.plspm import Plspm
from plspm.scale import Scale
from plspm.scheme import Scheme

TOL = 1e-10
MAX_IT = 300


def build(blocks=TAM_BLOCKS) -> c.Config:
    s = c.Structure()
    for a, b in TAM_PATHS:
        s.add_path([a], [b])
    cfg = c.Config(s.path(), default_scale=Scale.NUM)
    for lv, mvs in blocks.items():
        cfg.add_lv(lv, Mode.A, *[c.MV(m) for m in mvs])
    return cfg


def boot(df, iterations, processes, seed=None, blocks=TAM_BLOCKS):
    if seed is not None:
        np.random.seed(seed)
    t0 = time.perf_counter()
    p = Plspm(df, build(blocks), Scheme.PATH, MAX_IT, TOL, bootstrap=True, bootstrap_iterations=iterations,
              processes=processes)
    return p, time.perf_counter() - t0


def paths_table(p) -> pd.DataFrame:
    return p.bootstrap().paths()


def main() -> None:
    df = load_tam()
    rec = Recorder()
    out: dict = {"generated_by": "apps/api/spike/plspm_bootstrap.py", "versions": versions(),
                 "default_start_method": mp.get_start_method(), "checks": rec.results}

    # --- what comes back --------------------------------------------------------------------------
    def _shape():
        p, secs = boot(df, 20, 1)
        b = p.bootstrap()
        return {fam: {"columns": list(getattr(b, fam)().columns), "rows": int(getattr(b, fam)().shape[0]),
                      "index_head": [str(i) for i in list(getattr(b, fam)().index)[:4]]}
                for fam in ["weights", "loading", "paths", "total_effects", "r_squared"]} | {"seconds": secs}

    out["families"] = rec.run("d.families_and_columns", _shape)

    def _arg_rules():
        res = {}
        for it, pr in [(5, 1), (30, 4)]:
            try:
                p, _ = boot(df, it, pr)
                res[f"iterations={it},processes={pr}"] = {"ran": True}
            except Exception as e:  # noqa: BLE001
                res[f"iterations={it},processes={pr}"] = {"ran": False, "error": f"{type(e).__name__}: {e}"}
        return res

    out["argument_rules"] = rec.run("d.argument_rules", _arg_rules)

    # --- seeding under spawn (this machine's default) --------------------------------------------------
    mp.set_start_method("spawn", force=True)

    def _spawn_seed():
        a, _ = boot(df, 20, 1, seed=12345)
        b, _ = boot(df, 20, 1, seed=12345)
        return {"same_seed_two_runs_maxAbsDiff_paths_mean": max_abs_diff(paths_table(a)["mean"], paths_table(b)["mean"]),
                "reproducible": bool(np.allclose(paths_table(a)["mean"], paths_table(b)["mean"], rtol=0, atol=0))}

    out["seed_spawn"] = rec.run("d.seed.spawn.processes1", _spawn_seed)

    # --- seeding under fork (Linux / Colab default on Python 3.12) --------------------------------------
    mp.set_start_method("fork", force=True)

    def _fork_seed():
        a, _ = boot(df, 20, 1, seed=12345)
        b, _ = boot(df, 20, 1, seed=12345)
        c2, _ = boot(df, 20, 1, seed=999)
        return {"same_seed_maxAbsDiff_paths_mean": max_abs_diff(paths_table(a)["mean"], paths_table(b)["mean"]),
                "same_seed_maxAbsDiff_std_error": max_abs_diff(paths_table(a)["std.error"], paths_table(b)["std.error"]),
                "different_seed_maxAbsDiff_paths_mean": max_abs_diff(paths_table(a)["mean"], paths_table(c2)["mean"])}

    out["seed_fork"] = rec.run("d.seed.fork.processes1", _fork_seed)

    def _fork_duplicates():
        """With fork every child inherits the same RNG state -> processes=2 draws the same resamples twice."""
        one, _ = boot(df, 10, 1, seed=777)
        two, _ = boot(df, 20, 2, seed=777)
        t1, t2 = paths_table(one), paths_table(two)
        # if the two children duplicate each other, the mean over 20 equals the mean over the first child's 10,
        # and std.error(20) = std.error(10) * sqrt(((10-1)/10) * (20/(20-1)))
        return {"mean_p2x20_vs_mean_p1x10_maxAbsDiff": max_abs_diff(t1["mean"], t2["mean"]),
                "se_ratio_observed": [float(x) for x in (t2["std.error"] / t1["std.error"])],
                "se_ratio_if_duplicated": float(np.sqrt(9 / 10 * 20 / 19))}

    out["fork_duplicate_resamples"] = rec.run("d.seed.fork.processes2_duplicates", _fork_duplicates)

    def _replicate():
        """Independent replication of the bootstrap summaries: same RNG stream, own loop, own statistics."""
        B, seed = 50, 4242
        p, _ = boot(df, B, 1, seed=seed)
        bt = p.bootstrap()
        np.random.seed(seed)
        n = len(df)
        draws = []
        for _ in range(B):
            idx = np.random.randint(n, size=n)
            q = Plspm(df.iloc[idx, :], build(), Scheme.PATH, MAX_IT, TOL)
            pc = q.path_coefficients()
            draws.append({f"{a} -> {b}": pc.loc[b, a] for a, b in TAM_PATHS} |
                         {f"R2 {e}": q.inner_summary().loc[e, "r_squared"] for e in ["PU", "ATU", "BI", "USE"]})
        D = pd.DataFrame(draws)
        pcols = [f"{a} -> {b}" for a, b in TAM_PATHS]
        tbl = bt.paths().loc[pcols]
        r2 = bt.r_squared().loc[["PU", "ATU", "BI", "USE"]]
        r2cols = [f"R2 {e}" for e in ["PU", "ATU", "BI", "USE"]]
        return {
            "B": B,
            "paths_mean": max_abs_diff(tbl["mean"], D[pcols].mean()),
            "paths_std_error_ddof1": max_abs_diff(tbl["std.error"], D[pcols].std(ddof=1)),
            "paths_std_error_vs_ddof0": max_abs_diff(tbl["std.error"], D[pcols].std(ddof=0)),
            "paths_perc025_numpy_linear": max_abs_diff(tbl["perc.025"], np.percentile(D[pcols], 2.5, axis=0)),
            "paths_perc975_numpy_linear": max_abs_diff(tbl["perc.975"], np.percentile(D[pcols], 97.5, axis=0)),
            "paths_t_equals_original_over_se": float((tbl["t stat."] - tbl["original"] / tbl["std.error"]).abs().max()),
            "r2_mean": max_abs_diff(r2["mean"], D[r2cols].mean()),
        }

    out["independent_replication_fork"] = rec.run("d.replication.fork.B50", _replicate)

    def _silent_failures():
        """A rare binary indicator: resamples that miss its single non-zero row make it constant -> that
        resample raises in the NUM route and is silently skipped. Count the expected failures ourselves."""
        d = df.copy()
        d["RARE"] = 0.0
        d.loc[d.index[0], "RARE"] = 1.0
        blocks = {k: (v + ["RARE"] if k == "USE" else v) for k, v in TAM_BLOCKS.items()}
        B, seed = 20, 31337
        p, _ = boot(d, B, 1, seed=seed, blocks=blocks)
        np.random.seed(seed)
        n = len(d)
        expected_fail = sum(1 for _ in range(B) if 0 not in set(np.random.randint(n, size=n)))
        bt = p.bootstrap()
        return {"requested": B, "expected_failures_by_replay": expected_fail,
                "any_count_reported_by_plspm": False,
                "paths_std_error_finite": bool(np.isfinite(bt.paths()["std.error"]).all()),
                "note": "plspm returns summaries over the successful resamples only; the number used is not exposed"}

    out["silent_failures_fork"] = rec.run("d.silent_failures.fork", _silent_failures)

    def _count_failures_used():
        """Verify the skip by replaying with an instrumented estimator in the parent (fork copies the patch)."""
        import plspm.bootstrap as pb

        d = df.copy()
        d["RARE"] = 0.0
        d.loc[d.index[0], "RARE"] = 1.0
        blocks = {k: (v + ["RARE"] if k == "USE" else v) for k, v in TAM_BLOCKS.items()}
        rows = []
        orig = pb._create_summary

        def spy(data, original):
            rows.append(int(data.shape[0]))
            return orig(data, original)

        pb._create_summary = spy
        try:
            boot(d, 20, 1, seed=31337, blocks=blocks)
        finally:
            pb._create_summary = orig
        return {"rows_per_family_actually_summarised": rows}

    out["silent_failures_rows_used"] = rec.run("d.silent_failures.rows_used", _count_failures_used)

    # --- timing -------------------------------------------------------------------------------------
    timing = {}
    for method, procs in [("spawn", 1), ("spawn", 4), ("fork", 1), ("fork", 4)]:
        mp.set_start_method(method, force=True)

        def _t(procs=procs):
            _, secs = boot(df, 100, procs)
            return {"seconds_per_100": secs}

        timing[f"{method}.processes{procs}"] = rec.run(f"d.timing.{method}.p{procs}.B100", _t)
    out["timing"] = timing
    out["cpu_count"] = mp.cpu_count()
    out["failed_checks"] = [k for k, v in rec.results.items() if not v["ok"]]
    dump_json(EVIDENCE_DIR / "plspm_bootstrap.json", out)


if __name__ == "__main__":
    main()
