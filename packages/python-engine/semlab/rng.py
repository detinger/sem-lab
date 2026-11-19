"""Bit-exact port of R's default uniform generator and integer sampler, as selected by

    set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")

(port of packages/engine/src/rng/r-mt.ts). Mirrors R's src/main/RNG.c: RNG_Init with the
50-fold LCG scramble, MT19937 MT_genrand, fixup() to the open interval (0, 1), and
R_unif_index() with rbits() rejection sampling (R >= 3.6.0) for
``sample.int(n, size, replace = TRUE)``.

The MT19937 recurrence and tempering are numpy's ``MT19937`` bit generator, whose state is set
to exactly the state R's seeding produces (key = mt[0..623], pos = 624), so the 32-bit outputs
are R's. ``unif_rand`` = y * 2^-32 with R's fixup. Integer sampling is vectorised: every
rejection-sampling attempt consumes the same number of 16-bit chunks (one uniform each), so
the uniform stream partitions into fixed-size attempts; attempts are drawn in rounds of exactly
the number still known to be needed, so the generator never runs ahead of R's.
Verified against packages/fixtures/reference-results/rng/r-mersenne-twister.json.
"""

import math

import numpy as np

_N = 624
#: 1 / (2^32 - 1), R's i2_32m1
_I2_32M1 = 2.328306437080797e-10
#: 2^-32 as written in R's MT_genrand
_TWO_M32 = 2.3283064365386963e-10
_MASK32 = 0xFFFFFFFF


def _is_r_integer(seed):
    if isinstance(seed, bool):
        return False
    if isinstance(seed, (int, np.integer)):
        return -2147483647 <= int(seed) <= 2147483647
    if isinstance(seed, float) and math.isfinite(seed) and seed == math.floor(seed):
        return -2147483647 <= seed <= 2147483647
    return False


class RMersenneTwister:
    """R's Mersenne-Twister after set.seed(seed) (sample.kind = "Rejection")."""

    def __init__(self, seed):
        self._bg = np.random.MT19937(0)
        self.set_seed(seed)

    def set_seed(self, seed):
        """R's set.seed(seed) for kind "Mersenne-Twister". `seed` is an R integer (may be negative)."""
        if not _is_r_integer(seed):
            raise ValueError("seed must be an R integer")
        s = int(seed) & _MASK32
        # initial scrambling
        for _ in range(50):
            s = (69069 * s + 1) & _MASK32
        # dummy[0] (= mti) is seeded too and then overwritten by FixupSeeds(initial = TRUE)
        s = (69069 * s + 1) & _MASK32
        mt = np.empty(_N, dtype=np.uint32)
        for j in range(_N):
            s = (69069 * s + 1) & _MASK32
            mt[j] = s
        # FixupSeeds: an all-zero state cannot come from the LCG; mti = N forces a regeneration
        self._bg.state = {"bit_generator": "MT19937", "state": {"key": mt, "pos": _N}}

    # ---- raw stream ----------------------------------------------------------------------
    def _raw32(self, count):
        """`count` tempered 32-bit MT_genrand outputs (int64 array)."""
        if count <= 0:
            return np.zeros(0, dtype=np.int64)
        return np.asarray(self._bg.random_raw(int(count)), dtype=np.int64)

    def unif_rand_array(self, count):
        """unif_rand() `count` times: uniform draws in the open interval (0, 1), exactly as R."""
        x = self._raw32(count).astype(np.float64) * _TWO_M32
        x[x <= 0] = 0.5 * _I2_32M1
        x[1 - x <= 0] = 1 - 0.5 * _I2_32M1
        return x

    def unif_rand(self):
        return float(self.unif_rand_array(1)[0])

    def unif_index(self, dn):
        """R_unif_index(dn) for sample.kind = "Rejection": uniform integer in [0, dn) (scalar,
        written exactly as R's rbits()/R_unif_index())."""
        if dn <= 0:
            return 0
        bits = 0
        while 2**bits < dn:
            bits += 1
        while True:
            v = 0
            n = 0
            while n <= bits:
                v1 = math.floor(self.unif_rand() * 65536)
                v = 65536 * v + v1
                n += 16
            dv = v % (2**bits)
            if not (dn <= dv):
                return dv

    def sample_int_replace(self, n, size):
        """sample.int(n, size, replace = TRUE): 1-based indices (int32 array)."""
        if isinstance(n, bool) or not isinstance(n, (int, np.integer)) or n < 1 or n > 2147483647:
            raise ValueError("invalid n")
        return self._indices0(int(n), int(size)) + 1

    def _indices0(self, n, size):
        """R_unif_index(n) `size` times, vectorised (0-based)."""
        out = np.empty(size, dtype=np.int32)
        if size == 0:
            return out
        bits = 0
        while 2**bits < n:
            bits += 1
        chunks = bits // 16 + 1  # rbits(): for (n = 0; n <= bits; n += 16)
        mod = 1 << bits
        filled = 0
        while filled < size:
            need = size - filled  # every remaining index needs at least one more attempt
            raw = self._raw32(need * chunks).reshape(need, chunks)
            # floor(unif_rand() * 65536) == y >> 16 exactly (the fixup only touches y == 0)
            v = np.zeros(need, dtype=np.int64)
            for c in range(chunks):
                v = v * 65536 + (raw[:, c] >> 16)
            v %= mod
            acc = v[v < n]
            out[filled : filled + acc.shape[0]] = acc
            filled += acc.shape[0]
        return out


def r_set_seed(seed):
    """set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")."""
    return RMersenneTwister(seed)


def runif(rng, count):
    """runif(count) after the generator's current state."""
    return [float(v) for v in rng.unif_rand_array(count)]


def bootstrap_indices(seed, n, B, batch_rows=4_000_000):
    """The bootstrap resamples in R's order: draw b is ``sample.int(n, n, replace = TRUE) - 1``
    (0-based row indices) after set.seed(seed, "Mersenne-Twister", "Inversion", "Rejection").
    Yields int32 arrays; generated in batches of draws (one RNG stream, drawn sequentially)."""
    rng = RMersenneTwister(seed)
    per = max(1, batch_rows // max(n, 1))
    done = 0
    while done < B:
        m = min(per, B - done)
        block = rng._indices0(n, m * n).reshape(m, n)
        for b in range(m):
            yield block[b]
        done += m
