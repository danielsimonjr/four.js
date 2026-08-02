/**
 * Seeded pseudo-random numbers for deterministic particles (§33, §36, plan
 * P9-4).
 *
 * ## Provenance — this is a deliberate copy (2026-08-02, WP-9.1)
 *
 * **The original is `packages/motion/src/random.ts`** (`@four/motion`'s
 * `SeededRandom`, shipped by WP-8.2). This file is a copy of its generator, its
 * seeding rule, and its public surface — *not* an independent design.
 *
 * The copy exists because §3.1's dependency matrix gives `@four/particles`
 * exactly `@four/core`, `@four/math`, and `@four/scene`: there is **no
 * particles → motion edge**, and inventing one to reach a 250-line utility
 * would put a whole pillar in the dependency graph of every particle build.
 * `@four/core` still has no RNG (verified 2026-08-02: `packages/core/src` is
 * `component`, `disposable`, `errors`, `events`, `index`), so there is nothing
 * below both packages to import from.
 *
 * This is the same call, for the same reason, as the §33 FNV-1a duplication in
 * `packages/physics/src/world.ts` (the physics package has no
 * physics → diagnostics edge, so the hash is duplicated and pinned against a
 * reference implementation). **Future hoist:** when a third consumer appears,
 * move `SeededRandom` down to `@four/core` and re-export it from `@four/motion`
 * and `@four/particles`; this module imports nothing, so the move is mechanical.
 *
 * **The two copies must stay stream-identical.** The algorithm, the seed
 * expansion, and the two avalanche multipliers are byte-for-byte the originals,
 * so `new SeededRandom(s)` here and in `@four/motion` produce the same sequence
 * for every seed. `tests/random.test.ts` pins three of `@four/motion`'s own
 * known-answer vectors (seeds `0`, `12345`, `0xffffffff`) to prove it, and
 * re-derives them from an independent BigInt implementation of the documented
 * formulas so the pins are evidence about the recurrence rather than a
 * self-comparison.
 *
 * ---
 *
 * Everything below this line is the original module documentation, edited only
 * where it named motion-specific consumers.
 *
 * §33 forbids `Math.random` anywhere a result must reproduce: the engine's
 * determinism tiers, snapshots, replays, and checksum tests all assume that the
 * same inputs produce the same bits. Anything procedural therefore needs an
 * explicit, injectable stream — which is what {@link SeededRandom} is. For
 * particles that means every spawn draw (§36 lifetimes, velocity distributions,
 * cone spread) comes from here, in a fixed order — see `emitter.ts`.
 *
 * ## The generator
 *
 * **xorshift128** — Marsaglia's four-word shift-register generator (*Xorshift
 * RNGs*, Journal of Statistical Software 8(14), 2003) with the standard
 * `(11, 8, 19)` triple:
 *
 * ```text
 * t = x ^ (x << 11)
 * x = y;  y = z;  z = w
 * w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8))
 * return w
 * ```
 *
 * - **Period 2¹²⁸ − 1** — every non-zero 128-bit state is visited exactly once
 *   per cycle. At four draws per spawned particle, a 100 000-particle emitter
 *   fully recycling every second would still take on the order of 10²⁴ years to
 *   wrap.
 * - **State size 16 bytes** (four uint32s), so a stream is trivial to snapshot
 *   (§34) — see {@link SeededRandom.clone}.
 * - The all-zero state is absorbing, so it must be unreachable; see the seeding
 *   note below for how that is guaranteed *structurally* rather than by a branch
 *   that could never be taken (and therefore never tested).
 *
 * xorshift32 (period 2³² − 1) was rejected: 4.3 × 10⁹ draws is roughly twenty
 * minutes of a 100 000-particle emitter at 60 Hz, and its low bits are visibly
 * weak. SplitMix64 was rejected because JavaScript has no fast 64-bit integer
 * multiply — emulating one costs more than four xors and three shifts, and
 * `BigInt` on a hot path is out of the question.
 *
 * ## Seeding
 *
 * The public seed is a single uint32, which is what an author, a scene file, or
 * a test wants to write down. It is expanded to the four state words by a
 * SplitMix32-style avalanche stepped by the golden-ratio increment
 * `0x9E3779B9`:
 *
 * ```text
 * a  = (a + 0x9E3779B9) mod 2³²      (a starts at the seed)
 * t  = a ^ (a >>> 16)
 * t  = t * 0x21F0AAAD  mod 2³²
 * t  = t ^ (t >>> 15)
 * t  = t * 0x735A2D97  mod 2³²
 * t  = t ^ (t >>> 15)
 * ```
 *
 * The two multipliers are pinned by `@four/motion`'s copy and reproduced here;
 * nothing downstream may depend on them beyond "the same seed gives the same
 * stream". Expanding through an avalanche rather than writing the seed straight
 * into `x` matters — raw xorshift state with 127 zero bits needs dozens of draws
 * to decorrelate, so seeds `1`, `2`, `3` would produce visibly similar first
 * outputs, and a scene full of emitters seeded `0, 1, 2, …` would visibly
 * correlate.
 *
 * The first state word is OR-ed with `1`, which makes it odd and therefore
 * non-zero, so the absorbing all-zero state cannot be constructed from any seed.
 * That costs one bit of the 128-bit state space and buys a generator with no
 * unreachable defensive branch.
 *
 * ## Determinism contract
 *
 * 1. **Same seed, same sequence, everywhere.** Every state transition is a
 *    32-bit integer operation (`^`, `<<`, `>>>`, `Math.imul`), all of which
 *    ECMAScript defines exactly, on every engine, with no floating point
 *    involved. There is no platform-dependent behaviour to normalize, so
 *    **`Math.fround` is neither used nor needed** — it would in fact *lose*
 *    information, since `Math.fround` rounds to binary32 and uint32 values above
 *    2²⁴ are not representable there.
 * 2. **`nextFloat01` is exact.** It multiplies a uint32 by `2⁻³²`, a power of
 *    two, which is exact in binary64 for every input; the result is one of
 *    exactly 2³² equally spaced values in `[0, 1)`. No rounding, no
 *    engine-dependent division.
 * 3. **Streams are independent objects.** Nothing here is module-level state, so
 *    two `SeededRandom`s never interfere, and a stream's position depends only
 *    on how many draws *it* has served. Give each emitter its own stream and the
 *    scene reproduces regardless of iteration order changes elsewhere.
 * 4. **No clock, no `Math.random`, no implicit seed.** {@link SeededRandom}'s
 *    constructor *requires* a seed: a determinism contract cannot have a default
 *    that varies.
 * 5. **Draw order is the contract.** Adding a draw to a spawn changes every
 *    subsequent number, exactly as it would for any other PRNG. Determinism
 *    goldens are therefore sensitive to behaviour changes by design (§33), which
 *    is why `emitter.ts` pins its per-particle draw order and draw *count*.
 */

/** `2³²`, the modulus of the generator and the scale of {@link SeededRandom.nextFloat01}. */
const TWO_POW_32 = 4294967296;

/** Golden-ratio increment stepping the SplitMix32-style seed expansion. */
const SEED_INCREMENT = 0x9e3779b9;

/** First avalanche multiplier of the seed expansion. */
const SEED_MULTIPLIER_A = 0x21f0aaad;

/** Second avalanche multiplier of the seed expansion. */
const SEED_MULTIPLIER_B = 0x735a2d97;

/**
 * A deterministic uint32 stream (§33), seeded by a single number.
 *
 * ```ts
 * const random = new SeededRandom(1337);
 * random.nextFloat01();          // 0 <= x < 1
 * random.nextRange(-Math.PI, Math.PI);
 * const replay = new SeededRandom(1337); // identical sequence, forever
 * ```
 *
 * Stream-identical to `@four/motion`'s `SeededRandom` — see the module note on
 * provenance. See the module documentation for the generator, the seeding rule,
 * and the five-point determinism contract. Drawing allocates nothing; only the
 * constructor and {@link SeededRandom.clone} allocate.
 */
export class SeededRandom {
  /**
   * The seed this stream was constructed with, reduced to a uint32. Recording
   * this value is enough to reproduce the stream from the start.
   */
  readonly seed: number;

  /** Generator state word 0. Always odd, so the state is never all-zero. */
  #x = 0;

  /** Generator state word 1. */
  #y = 0;

  /** Generator state word 2. */
  #z = 0;

  /** Generator state word 3; also the most recently returned output. */
  #w = 0;

  /**
   * Creates a stream from `seed`.
   *
   * The seed is reduced with ECMAScript's ToUint32, so it may be written as any
   * finite number: negatives wrap (`-1` is the same stream as `4294967295`) and
   * fractions truncate toward zero (`1.9` is the same stream as `1`). Both are
   * deterministic, both are documented, and neither is an error.
   *
   * @throws RangeError if `seed` is not a finite number — `NaN` and `Infinity`
   * both reduce to `0` under ToUint32, which would silently collapse distinct
   * mistakes onto one stream.
   */
  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new RangeError(
        `SeededRandom needs a finite seed (§33: streams must be reproducible); received ${String(seed)}`,
      );
    }
    this.seed = seed >>> 0;
    this.reset();
  }

  /**
   * Rewinds the stream to its seed, so the next draw is the first one again.
   * Returns this stream.
   */
  reset(): this {
    let a = this.seed;
    // Four SplitMix32 draws; inlined because the loop would need an array or a
    // closure and this runs once per stream.
    a = (a + SEED_INCREMENT) | 0;
    this.#x = mix32(a) | 1;
    a = (a + SEED_INCREMENT) | 0;
    this.#y = mix32(a);
    a = (a + SEED_INCREMENT) | 0;
    this.#z = mix32(a);
    a = (a + SEED_INCREMENT) | 0;
    this.#w = mix32(a);
    return this;
  }

  /**
   * Next raw output: an integer in `[0, 2³²)`, uniform over the whole range.
   *
   * This is the only method that advances the state; every other draw is
   * derived from it, so `nextFloat01()` and `nextRange(...)` each consume
   * exactly one output.
   */
  nextUint32(): number {
    const t = this.#x ^ (this.#x << 11);
    this.#x = this.#y;
    this.#y = this.#z;
    this.#z = this.#w;
    this.#w = this.#w ^ (this.#w >>> 19) ^ (t ^ (t >>> 8));
    return this.#w >>> 0;
  }

  /**
   * Next float in `[0, 1)` — one of 2³² equally spaced values, exactly
   * representable (see the module note on exactness). `1` is never returned;
   * `0` is, with probability 2⁻³².
   */
  nextFloat01(): number {
    return this.nextUint32() / TWO_POW_32;
  }

  /**
   * Next float in `[min, max)`, computed as `min + (max - min) · nextFloat01()`.
   *
   * Not validated — this is a hot path (a spawning emitter draws from it four
   * times per particle). `min === max` returns `min`; `max < min` yields
   * `(max, min]`, the same interval traversed downwards; a non-finite bound
   * propagates to the result. Rounding can make the result equal `max` only when
   * `max - min` is so large that `min + (max - min) · x` rounds up at `x` just
   * below 1, i.e. never for ranges of ordinary magnitude.
   */
  nextRange(min: number, max: number): number {
    return min + (max - min) * this.nextFloat01();
  }

  /**
   * A copy of this stream at its **current position** — not a fresh stream from
   * the seed (use `new SeededRandom(random.seed)` for that). The copy and the
   * original then advance independently, which is what makes "run the same
   * scenario twice from here" testable, and is the whole of §34 snapshot support
   * for an RNG.
   */
  clone(): SeededRandom {
    const copy = new SeededRandom(this.seed);
    copy.#x = this.#x;
    copy.#y = this.#y;
    copy.#z = this.#z;
    copy.#w = this.#w;
    return copy;
  }
}

/**
 * One SplitMix32-style avalanche of `a`, returning an int32 (the sign bit is
 * data — callers use it through `>>> 0` or as xorshift state). `Math.imul` is
 * the exact 32-bit multiply; `a * k` would lose bits above 2⁵³.
 */
function mix32(a: number): number {
  let t = a ^ (a >>> 16);
  t = Math.imul(t, SEED_MULTIPLIER_A);
  t = t ^ (t >>> 15);
  t = Math.imul(t, SEED_MULTIPLIER_B);
  return t ^ (t >>> 15);
}
