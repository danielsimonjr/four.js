/**
 * Deterministic checksums over float sequences (§33, plan D6).
 *
 * §33 defines the per-step determinism checksum as "FNV-1a over each existing
 * body's transform and velocities … quantized to 1e-6, visited in ascending
 * engine-assigned monotonic body id". This module implements the *hash* half of
 * that definition — the numeric core reused by phase-exit golden hashes (§92),
 * physics world checksums (§37), and replay verification (§34). Choosing the
 * values and their visit order is the caller's job; this module only guarantees
 * that the same numbers fed in the same order always produce the same uint32,
 * in any process, on any run.
 *
 * Determinism is structural, not best-effort: every operation below is exact
 * integer arithmetic on doubles (`Math.round`, `%`, exact subtraction, `Math.imul`,
 * `>>> 0`). No floating-point rounding mode, no transcendental, no iteration over
 * an unordered collection, and no wall clock takes part, so the result cannot
 * vary between JS engines or platforms (§33 `cross-platform` tier for the hash
 * itself — the *inputs* still decide the achievable tier).
 *
 * ## Algorithm (D6)
 *
 * 1. **Normalize.** `-0` becomes `+0` before anything else, so the two zeros are
 *    indistinguishable to the hash.
 * 2. **Quantize.** `q = Math.round(x * 1e6)` — a 1e-6 grid. `Math.round` is
 *    half-up (ties round toward `+Infinity`): `5e-7 → 1`, `1.5e-6 → 2`,
 *    `2.5e-6 → 3`, and `-5e-7 → -0` (normalized back to `0` by step 3).
 * 3. **Encode.** `q` is a 53-bit-safe integer, split into two uint32 words as
 *    the low and high halves of its two's-complement 64-bit representation:
 *
 *    ```text
 *    low  = ((q % 2^32) + 2^32) % 2^32   // 0 … 2^32-1, exact (fmod is exact)
 *    high = ((q - low) / 2^32) >>> 0     // exact; negative q yields a negative
 *                                        // quotient, and >>> 0 reinterprets it
 *                                        // as the two's-complement high word
 *    ```
 *
 *    That is plain floor division: `q === high * 2^32 + low` with
 *    `0 <= low < 2^32`. `q - low` is an exact multiple of 2^32 whose quotient
 *    needs at most 22 bits, so both steps are exact without BigInt.
 * 4. **Feed.** The **low word first, then the high word**, each as **4
 *    little-endian bytes** (least significant byte first), into FNV-1a 32:
 *    offset basis `2166136261`, prime `16777619`, `h = imul(h ^ byte, prime) >>> 0`.
 *
 * So each float contributes exactly 8 bytes and the empty sequence digests to
 * the bare offset basis, `2166136261`.
 *
 * ## Rejected inputs
 *
 * `NaN` has no meaningful quantization and would silently poison a golden hash,
 * so it throws. `±Infinity` and any value whose quantization leaves the
 * 53-bit-safe range (`|x| > ~9.007e9`, far outside §41's 1e5 coordinate
 * envelope) throw for the same reason: D6's two-word encoding is only defined
 * for safe integers.
 *
 * The throw is a plain {@link RangeError}, not a `FourError` (§89): §89's code
 * list has no validation/argument code, `INVALID_SCENE_GRAPH` would be a lie
 * here (the hasher never sees a scene graph), and this packet may not extend the
 * `FourErrorCode` union in `@four/core`. A domain violation on a numeric
 * argument is exactly what `RangeError` means in JS. (Decision recorded for
 * WP-1.13; revisit if §89 ever gains an `INVALID_ARGUMENT` code.)
 */

/** Quantization grid: values are snapped to multiples of 1e-6 (§33, D6). */
const QUANTIZATION_SCALE = 1e6;

/** FNV-1a 32-bit offset basis — also the digest of an empty sequence. */
const FNV_OFFSET_BASIS = 2166136261;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 16777619;

/** 2^32, the word boundary of the two-word encoding. */
const TWO_POW_32 = 4294967296;

/**
 * Largest quantized magnitude the two-word encoding is defined for
 * (`Number.MAX_SAFE_INTEGER`); see the module note on rejected inputs.
 */
const MAX_QUANTIZED = Number.MAX_SAFE_INTEGER;

/**
 * An incremental FNV-1a hasher over quantized floats.
 *
 * The digest depends on the values *and their insertion order*; feeding the
 * same sequence to two hashers always yields the same digest.
 */
export interface Checksum {
  /**
   * Absorbs one value.
   *
   * @throws RangeError if `x` is `NaN`, infinite, or quantizes outside the
   * 53-bit-safe integer range.
   */
  addFloat(x: number): void;

  /**
   * Absorbs every value of `xs` in iteration order.
   *
   * @throws RangeError on the first unusable value; values already absorbed
   * stay absorbed, so a hasher that threw should be discarded.
   */
  addFloats(xs: Iterable<number>): void;

  /**
   * The current digest as a uint32.
   *
   * Non-destructive: FNV-1a has no finalization step, so the hasher may keep
   * absorbing values afterwards and `digest()` may be called repeatedly.
   */
  digest(): number;
}

/**
 * Quantizes one value to the 1e-6 grid (§33), normalizing `-0` to `+0` first.
 *
 * @throws RangeError if the value is not finite or lands outside the
 * 53-bit-safe integer range.
 */
function quantize(x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(
      `Checksum inputs must be finite numbers (§33 quantization is undefined for ${String(x)}).`,
    );
  }
  // -0 → +0 before quantization, so both zeros hash identically (D6).
  const normalized = x === 0 ? 0 : x;
  const q = Math.round(normalized * QUANTIZATION_SCALE);
  if (Math.abs(q) > MAX_QUANTIZED) {
    throw new RangeError(
      `Checksum input ${String(x)} quantizes to ${String(q)}, outside the 53-bit-safe range ` +
        `(±${String(MAX_QUANTIZED)}); §41 supports coordinates within ~1e5 units of the origin.`,
    );
  }
  // Math.round(-0.5) is -0; fold it onto +0 so the encoding never sees -0.
  return q === 0 ? 0 : q;
}

/**
 * Absorbs the four little-endian bytes of a 32-bit word into an FNV-1a state.
 *
 * @param state current hash state (uint32)
 * @param word word to absorb; interpreted via `>>> 0`
 * @returns the new hash state (uint32)
 */
function absorbWord(state: number, word: number): number {
  const w = word >>> 0;
  let h = state;
  h = Math.imul(h ^ (w & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 8) & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 16) & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 24) & 0xff), FNV_PRIME) >>> 0;
  return h;
}

/**
 * Absorbs one already-quantized integer as its low then high uint32 word.
 *
 * @param state current hash state (uint32)
 * @param q quantized value, a 53-bit-safe integer
 * @returns the new hash state (uint32)
 */
function absorbQuantized(state: number, q: number): number {
  // `%` on integral doubles is exact, so `low` is exact; `q - low` is an exact
  // multiple of 2^32 (its quotient needs ≤ 22 bits), so the division is exact.
  let low = q % TWO_POW_32;
  if (low < 0) {
    low += TWO_POW_32;
  }
  const high = (q - low) / TWO_POW_32;
  return absorbWord(absorbWord(state, low), high);
}

/**
 * Creates an incremental checksum hasher (§33, D6).
 *
 * @returns a fresh {@link Checksum} seeded with the FNV-1a offset basis
 *
 * @example
 * ```ts
 * const checksum = createChecksum();
 * checksum.addFloats(node.transform.worldMatrix.elements);
 * const digest = checksum.digest();
 * ```
 */
export function createChecksum(): Checksum {
  let state = FNV_OFFSET_BASIS >>> 0;
  return {
    addFloat(x: number): void {
      state = absorbQuantized(state, quantize(x));
    },
    addFloats(xs: Iterable<number>): void {
      for (const x of xs) {
        state = absorbQuantized(state, quantize(x));
      }
    },
    digest(): number {
      return state >>> 0;
    },
  };
}

/**
 * One-shot convenience: the digest of `xs` in iteration order.
 *
 * Exactly equivalent to feeding the same values to a {@link createChecksum}
 * hasher.
 *
 * @param xs values to hash, in a deterministic order chosen by the caller
 * @returns the uint32 digest (`2166136261` for an empty sequence)
 * @throws RangeError on a `NaN`, infinite, or out-of-range value
 */
export function hashFloats(xs: Iterable<number>): number {
  let state = FNV_OFFSET_BASIS >>> 0;
  for (const x of xs) {
    state = absorbQuantized(state, quantize(x));
  }
  return state >>> 0;
}
