/**
 * Bit-exact port of R's default uniform generator and integer sampler, as selected by
 *
 *   set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")
 *
 * Mirrors R's src/main/RNG.c (RNG_Init with the 50-fold LCG scramble, MT19937 MT_genrand,
 * fixup() to the open interval (0, 1)) and R_unif_index() with rbits() rejection sampling
 * (R >= 3.6.0), and do_sample() for `sample.int(n, size, replace = TRUE)`.
 * Re-implemented from the documented algorithms (Matsumoto & Nishimura 1998; R's RNG
 * documentation); verified against R 4.6.2 output in
 * packages/fixtures/reference-results/rng/r-mersenne-twister.json.
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;
const TEMPERING_MASK_B = 0x9d2c5680;
const TEMPERING_MASK_C = 0xefc60000;
/** 1 / (2^32 - 1), R's i2_32m1. */
const I2_32M1 = 2.328306437080797e-10;
/** 2^-32 as written in R's MT_genrand. */
const TWO_M32 = 2.3283064365386963e-10;

export class RMersenneTwister {
  private readonly mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed: number) {
    this.setSeed(seed);
  }

  /** R's set.seed(seed) for kind "Mersenne-Twister". `seed` is an R integer (may be negative). */
  setSeed(seed: number): void {
    if (!Number.isInteger(seed) || seed < -2147483647 || seed > 2147483647) {
      throw new RangeError('seed must be an R integer');
    }
    let s = seed >>> 0;
    // initial scrambling
    for (let j = 0; j < 50; j++) s = (Math.imul(69069, s) + 1) >>> 0;
    // dummy[0] (= mti) is seeded too and then overwritten by FixupSeeds(initial = TRUE)
    s = (Math.imul(69069, s) + 1) >>> 0;
    for (let j = 0; j < N; j++) {
      s = (Math.imul(69069, s) + 1) >>> 0;
      this.mt[j] = s;
    }
    this.mti = N;
    // FixupSeeds: an all-zero state is replaced (cannot happen from an LCG, kept for parity)
    if (this.mt.every((v) => v === 0)) this.setSeed(Math.floor(Date.now() % 1e9));
  }

  private sgenrand(seed: number): void {
    let s = seed >>> 0;
    for (let i = 0; i < N; i++) {
      this.mt[i] = s & 0xffff0000;
      s = (Math.imul(69069, s) + 1) >>> 0;
      this.mt[i] = (this.mt[i]! | ((s & 0xffff0000) >>> 16)) >>> 0;
      s = (Math.imul(69069, s) + 1) >>> 0;
    }
    this.mti = N;
  }

  /** MT_genrand(): a 32-bit draw scaled to [0, 1). */
  private genrand(): number {
    const mt = this.mt;
    let y: number;
    if (this.mti >= N) {
      if (this.mti === N + 1) this.sgenrand(4357);
      let kk = 0;
      for (; kk < N - M; kk++) {
        y = (mt[kk]! & UPPER_MASK) | (mt[kk + 1]! & LOWER_MASK);
        mt[kk] = mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk]! & UPPER_MASK) | (mt[kk + 1]! & LOWER_MASK);
        mt[kk] = mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      y = (mt[N - 1]! & UPPER_MASK) | (mt[0]! & LOWER_MASK);
      mt[N - 1] = mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.mti = 0;
    }
    y = mt[this.mti++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & TEMPERING_MASK_B;
    y ^= (y << 15) & TEMPERING_MASK_C;
    y ^= y >>> 18;
    return (y >>> 0) * TWO_M32;
  }

  /** unif_rand(): a uniform draw in the open interval (0, 1), exactly as R. */
  unifRand(): number {
    const x = this.genrand();
    if (x <= 0) return 0.5 * I2_32M1;
    if (1 - x <= 0) return 1 - 0.5 * I2_32M1;
    return x;
  }

  /** rbits(bits): `bits` random bits assembled from 16-bit chunks of unif_rand(). */
  private rbits(bits: number): number {
    let v = 0;
    for (let n = 0; n <= bits; n += 16) {
      const v1 = Math.floor(this.unifRand() * 65536);
      v = 65536 * v + v1;
    }
    // keep the low `bits` bits (v < 2^48, exact in a double)
    return v % 2 ** bits;
  }

  /** R_unif_index(dn) for sample.kind = "Rejection": uniform integer in [0, dn). */
  unifIndex(dn: number): number {
    if (dn <= 0) return 0;
    let bits = 0;
    while (2 ** bits < dn) bits++; // = ceil(log2(dn)), exact for powers of two
    let dv: number;
    do {
      dv = this.rbits(bits);
    } while (dn <= dv);
    return dv;
  }

  /** sample.int(n, size, replace = TRUE): 1-based indices. */
  sampleIntReplace(n: number, size: number): Int32Array {
    if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new RangeError('invalid n');
    const out = new Int32Array(size);
    for (let i = 0; i < size; i++) out[i] = this.unifIndex(n) + 1;
    return out;
  }
}

/** set.seed(seed, kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection"). */
export function rSetSeed(seed: number): RMersenneTwister {
  return new RMersenneTwister(seed);
}

/** runif(count) after the generator's current state. */
export function runif(rng: RMersenneTwister, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(rng.unifRand());
  return out;
}
