"""R Mersenne-Twister (set.seed kind MT, sample.kind Rejection): every number in
packages/fixtures/reference-results/rng/r-mersenne-twister.json, to the last bit."""

import pytest
from helpers import REF, read_json

REFDATA = read_json(REF / "rng" / "r-mersenne-twister.json")
CASES = REFDATA["cases"]


def test_covers_edge_cases():
    seeds = [c["seed"] for c in CASES]
    assert {0, -7, 2147483646} <= set(seeds)
    ns = [s["n"] for s in CASES[0]["sample_int"]]
    assert {65536, 65537, 1000000} <= set(ns)


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"seed{c['seed']}")
def test_runif_and_sample_int_bit_identical(eng, case):
    rng = eng.r_set_seed(case["seed"])
    u = eng.runif(rng, len(case["runif"]))
    assert u == case["runif"]  # exact float equality, every bit
    # the sample.int block starts from a fresh set.seed(seed) and is drawn sequentially
    rng.set_seed(case["seed"])
    for s in case["sample_int"]:
        assert rng.sample_int_replace(s["n"], len(s["idx"])).tolist() == s["idx"], s["n"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"seed{c['seed']}")
def test_scalar_unif_index_equals_vectorised(eng, case):
    """The scalar R_unif_index (R's rbits() written out) and the vectorised sampler agree."""
    rng = eng.r_set_seed(case["seed"])
    for s in case["sample_int"]:
        got = [rng.unif_index(s["n"]) + 1 for _ in s["idx"]]
        assert got == s["idx"], s["n"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"seed{c['seed']}")
def test_bootstrap_indices_equal_r(eng, case):
    draws = [(d + 1).tolist() for d in eng.bootstrap_indices(case["seed"], 12, 3)]
    assert draws == case["bootstrap_n12_B3"]


def test_batching_does_not_change_the_stream(eng):
    """Index generation in batches of draws is the same single R stream."""
    a = [d.tolist() for d in eng.bootstrap_indices(7, 101, 9, batch_rows=101)]
    b = [d.tolist() for d in eng.bootstrap_indices(7, 101, 9, batch_rows=10**9)]
    assert a == b
    rng = eng.r_set_seed(7)
    c = [(rng.sample_int_replace(101, 101) - 1).tolist() for _ in range(9)]
    assert a == c


def test_seed_validation(eng):
    with pytest.raises(ValueError):
        eng.r_set_seed(2**31)
    with pytest.raises(ValueError):
        eng.r_set_seed(1.5)
