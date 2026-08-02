/**
 * The particle pool (§36, plan P9-1) — a fixed-capacity, structure-of-arrays
 * store over `Float32Array`s, with swap-remove compaction.
 *
 * ```ts
 * const pool = new ParticlePool(1000);
 * const index = pool.spawn();            // -1 when full
 * pool.setPosition(index, 0, 1, 0);
 * pool.setLifetime(index, 2);
 * // …
 * pool.getPosition(index, out);          // writes `out`, allocates nothing
 * pool.kill(index);                      // swap-remove
 * ```
 *
 * ## Layout (decision, WP-9.1)
 *
 * Structure of arrays, one `Float32Array` per channel group, allocated once in
 * the constructor and never reallocated:
 *
 * | Channel     | Array          | Stride | Components                       |
 * | ----------- | -------------- | -----: | -------------------------------- |
 * | position    | `positions`    |      3 | `x, y, z`                        |
 * | velocity    | `velocities`   |      3 | `x, y, z`                        |
 * | age         | `ages`         |      1 | seconds lived                    |
 * | lifetime    | `lifetimes`    |      1 | seconds to live                  |
 * | size        | `sizes`        |      2 | `size₀, size₁` (start, end)      |
 * | colour      | `colors`       |      4 × 2 | `r₀ g₀ b₀ a₀ r₁ g₁ b₁ a₁`    |
 *
 * Grouped-by-channel rather than one array per scalar component: `positions`
 * with stride 3 is exactly the buffer an instanced draw wants to upload
 * (WP-9.3), and grouped-by-channel is exactly the layout an interleaved
 * per-particle struct is *not* — a step that only touches position and velocity
 * never pages in colour.
 *
 * **`Float32Array`, not `Float64Array`** (§33): binary32 is what a vertex buffer
 * holds, so the simulated value and the drawn value are the same value, with no
 * silent precision change at upload time. Arithmetic still happens in binary64
 * (JavaScript has no float32 arithmetic) and is rounded once on each store —
 * which is deterministic, since IEEE-754 round-to-nearest-even is exact and
 * platform-independent. See "Determinism" below.
 *
 * **Size and colour are stored as start/end pairs**, not as current values: the
 * over-lifetime ramp (§36 "color and size over lifetime") is a pure function of
 * normalized age, so storing the endpoints costs no per-step work and cannot
 * drift. {@link ParticlePool.getSize} and {@link ParticlePool.getColor} evaluate
 * the ramp on demand.
 *
 * ## Allocation (§7b, plan D7)
 *
 * **Nothing after the constructor allocates.** Every read writes a caller-owned
 * `out`; every write takes scalars. The `out` parameters are **required**, not
 * `out?`-optional as elsewhere in the engine (`prediction.ts`,
 * `trajectories.ts`): a pool read happens once per particle per frame, and an
 * optional `out` makes "forgot to pass one" a 100 000-allocation loop that still
 * type-checks. The engine's optional-`out` convention is for per-call APIs, not
 * per-element ones (decision, WP-9.1).
 *
 * ## Swap-remove, and what it costs — the determinism statement
 *
 * {@link ParticlePool.kill} moves the **last live particle into the dead
 * particle's slot** and decrements the live count. It is O(1) and touches no
 * other slot, which is what makes expiring thousands of particles per step free.
 *
 * **Swap-remove breaks insertion order.** After the first death, index order is
 * no longer birth order: a particle can move backwards in the array, and two
 * particles born in the same burst can end up in either relative order. Any
 * consumer that needs birth order (a trail, a sort key, a stable id) must store
 * it in a channel — index is not it. Iterating the pool "oldest first" is not a
 * thing you can do without sorting.
 *
 * **It does not cost determinism (§33).** Iteration is over `[0, aliveCount)` in
 * ascending index order, which is a total order fixed by the array itself, and
 * the array layout is a deterministic function of the history: `spawn()` always
 * takes slot `aliveCount`, `kill(i)` always moves slot `aliveCount − 1` into `i`,
 * and the emitter's expiry pass always scans ascending. Same inputs ⇒ same
 * sequence of spawn/kill calls ⇒ same permutation ⇒ same iteration order ⇒
 * bit-identical arrays. The order is *not* insertion order, and it *is*
 * reproducible; those are independent properties and only the second one is what
 * §33 asks for. (Plan P9-4 says "particle iteration insertion order"; WP-9.1
 * reads that as the determinism requirement it serves — reproducible iteration —
 * and records here that literal insertion order is **not** preserved, because
 * preserving it would mean either O(n) compaction or a free-list whose slot reuse
 * is itself not insertion-ordered. Reported to the orchestrator.)
 *
 * ## Determinism (§33)
 *
 * Every operation is integer index arithmetic plus float loads and stores. The
 * only floating-point *arithmetic* here is the two lerps in
 * {@link ParticlePool.getSize} / {@link ParticlePool.getColor} and the division
 * in {@link ParticlePool.getNormalizedAge}, all of which are IEEE-754
 * basic operations with exactly specified results. There is no iteration-order
 * dependence, no hashing, no clock, and no randomness in this module.
 */

import type { Vector3, Vector4 } from "@four/math";

/** Components per particle in {@link ParticlePool.positions} / `velocities`. */
const VECTOR_STRIDE = 3;

/** Components per particle in {@link ParticlePool.sizes} (start, end). */
const SIZE_STRIDE = 2;

/** Components per particle in {@link ParticlePool.colors} (RGBA start, RGBA end). */
const COLOR_STRIDE = 8;

/**
 * Fixed-capacity structure-of-arrays particle storage. See the module
 * documentation for the layout, the allocation policy, and the swap-remove
 * determinism statement.
 */
export class ParticlePool {
  /**
   * Maximum simultaneously live particles. Fixed at construction — §36's
   * `maxParticles` is a budget, and growing a pool mid-frame would allocate on
   * the hot path (§7b).
   */
  readonly capacity: number;

  /** Positions, stride 3 (`x, y, z`), `capacity` entries. Slots `>= aliveCount` are stale. */
  readonly positions: Float32Array;

  /** Velocities in units/s, stride 3 (`x, y, z`). */
  readonly velocities: Float32Array;

  /** Seconds each particle has lived, stride 1. */
  readonly ages: Float32Array;

  /** Seconds each particle may live, stride 1. */
  readonly lifetimes: Float32Array;

  /** Size ramp endpoints, stride 2 (`size₀, size₁`). */
  readonly sizes: Float32Array;

  /** Colour ramp endpoints, stride 8 (`r₀ g₀ b₀ a₀ r₁ g₁ b₁ a₁`). */
  readonly colors: Float32Array;

  /** Live particle count; the live slots are `[0, aliveCount)`. */
  #aliveCount = 0;

  /**
   * Allocates every channel for `capacity` particles. This is the only
   * allocating operation on the type.
   *
   * @throws RangeError if `capacity` is not a non-negative safe integer. A
   * capacity of `0` is legal and useful (it makes "every spawn is dropped"
   * testable) — a fractional or negative one is always a mistake.
   */
  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError(
        `ParticlePool capacity must be a non-negative safe integer (§36 maxParticles); received ${String(capacity)}`,
      );
    }
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * VECTOR_STRIDE);
    this.velocities = new Float32Array(capacity * VECTOR_STRIDE);
    this.ages = new Float32Array(capacity);
    this.lifetimes = new Float32Array(capacity);
    this.sizes = new Float32Array(capacity * SIZE_STRIDE);
    this.colors = new Float32Array(capacity * COLOR_STRIDE);
  }

  /** Live particle count. The live slots are exactly `[0, aliveCount)`. */
  get aliveCount(): number {
    return this.#aliveCount;
  }

  /**
   * Claims the next free slot and returns its index, or **`-1` when the pool is
   * full** — the caller decides whether that is a dropped spawn (the emitter
   * counts them) or an error.
   *
   * The returned slot is **zeroed** in every channel, so a recycled slot never
   * leaks its previous occupant's state into a caller that forgets to write a
   * channel. Note that a zeroed lifetime means
   * {@link ParticlePool.getNormalizedAge} reports `1` until a real lifetime is
   * written.
   */
  spawn(): number {
    if (this.#aliveCount >= this.capacity) {
      return -1;
    }
    const index = this.#aliveCount;
    this.#aliveCount += 1;
    this.#zero(index);
    return index;
  }

  /**
   * Removes the particle at `index` by moving the last live particle into its
   * slot (swap-remove) and decrementing {@link ParticlePool.aliveCount}.
   *
   * Killing the last live particle is the degenerate case: the "move" is a
   * self-copy, skipped. See the module note on what this does and does not cost.
   *
   * @throws RangeError if `index` is not a live slot.
   */
  kill(index: number): void {
    this.#assertLive(index, "kill");
    const last = this.#aliveCount - 1;
    if (index !== last) {
      this.#copySlot(last, index);
    }
    this.#aliveCount = last;
  }

  /**
   * Drops every particle. Channel arrays keep their contents — the slots are
   * simply no longer live, and {@link ParticlePool.spawn} zeroes anything it
   * hands back — so this is O(1).
   */
  clear(): void {
    this.#aliveCount = 0;
  }

  /** Writes the position of the live particle `index` into `out`. */
  getPosition(index: number, out: Vector3): Vector3 {
    this.#assertLive(index, "getPosition");
    const base = index * VECTOR_STRIDE;
    return out.set(
      this.positions[base],
      this.positions[base + 1],
      this.positions[base + 2],
    );
  }

  /** Sets the position of the live particle `index`. */
  setPosition(index: number, x: number, y: number, z: number): void {
    this.#assertLive(index, "setPosition");
    const base = index * VECTOR_STRIDE;
    this.positions[base] = x;
    this.positions[base + 1] = y;
    this.positions[base + 2] = z;
  }

  /** Writes the velocity (units/s) of the live particle `index` into `out`. */
  getVelocity(index: number, out: Vector3): Vector3 {
    this.#assertLive(index, "getVelocity");
    const base = index * VECTOR_STRIDE;
    return out.set(
      this.velocities[base],
      this.velocities[base + 1],
      this.velocities[base + 2],
    );
  }

  /** Sets the velocity (units/s) of the live particle `index`. */
  setVelocity(index: number, x: number, y: number, z: number): void {
    this.#assertLive(index, "setVelocity");
    const base = index * VECTOR_STRIDE;
    this.velocities[base] = x;
    this.velocities[base + 1] = y;
    this.velocities[base + 2] = z;
  }

  /** Seconds the live particle `index` has lived. */
  getAge(index: number): number {
    this.#assertLive(index, "getAge");
    return this.ages[index];
  }

  /** Sets the age (seconds) of the live particle `index`. */
  setAge(index: number, age: number): void {
    this.#assertLive(index, "setAge");
    this.ages[index] = age;
  }

  /** Seconds the live particle `index` may live. */
  getLifetime(index: number): number {
    this.#assertLive(index, "getLifetime");
    return this.lifetimes[index];
  }

  /** Sets the lifetime (seconds) of the live particle `index`. */
  setLifetime(index: number, lifetime: number): void {
    this.#assertLive(index, "setLifetime");
    this.lifetimes[index] = lifetime;
  }

  /**
   * `age / lifetime`, clamped to `[0, 1]` — the parameter every over-lifetime
   * ramp is evaluated at.
   *
   * A non-positive lifetime reports `1` (fully aged) rather than `Infinity` or
   * `NaN`: a zero-lifetime particle is one the next expiry pass removes, and a
   * ramp evaluated at its end is the honest thing to draw in the meantime.
   */
  getNormalizedAge(index: number): number {
    this.#assertLive(index, "getNormalizedAge");
    const lifetime = this.lifetimes[index];
    if (!(lifetime > 0)) {
      return 1;
    }
    const t = this.ages[index] / lifetime;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /** Sets the size ramp endpoints of the live particle `index`. */
  setSize(index: number, start: number, end: number): void {
    this.#assertLive(index, "setSize");
    const base = index * SIZE_STRIDE;
    this.sizes[base] = start;
    this.sizes[base + 1] = end;
  }

  /** Size at age 0 for the live particle `index`. */
  getStartSize(index: number): number {
    this.#assertLive(index, "getStartSize");
    return this.sizes[index * SIZE_STRIDE];
  }

  /** Size at age = lifetime for the live particle `index`. */
  getEndSize(index: number): number {
    this.#assertLive(index, "getEndSize");
    return this.sizes[index * SIZE_STRIDE + 1];
  }

  /**
   * Current size of the live particle `index`: the ramp evaluated at
   * {@link ParticlePool.getNormalizedAge}, as `start + (end − start) · t`.
   *
   * That form (rather than `(1 − t)·start + t·end`) is exact at `t = 0` and
   * `t = 1` for every pair of endpoints, which is what the tests pin.
   */
  getSize(index: number): number {
    const t = this.getNormalizedAge(index);
    const base = index * SIZE_STRIDE;
    const start = this.sizes[base];
    return start + (this.sizes[base + 1] - start) * t;
  }

  /** Sets both colour ramp endpoints of the live particle `index`, as straight RGBA. */
  setColor(
    index: number,
    r0: number,
    g0: number,
    b0: number,
    a0: number,
    r1: number,
    g1: number,
    b1: number,
    a1: number,
  ): void {
    this.#assertLive(index, "setColor");
    const base = index * COLOR_STRIDE;
    this.colors[base] = r0;
    this.colors[base + 1] = g0;
    this.colors[base + 2] = b0;
    this.colors[base + 3] = a0;
    this.colors[base + 4] = r1;
    this.colors[base + 5] = g1;
    this.colors[base + 6] = b1;
    this.colors[base + 7] = a1;
  }

  /** Writes the colour at age 0 of the live particle `index` into `out` as `(r, g, b, a)`. */
  getStartColor(index: number, out: Vector4): Vector4 {
    this.#assertLive(index, "getStartColor");
    const base = index * COLOR_STRIDE;
    return out.set(
      this.colors[base],
      this.colors[base + 1],
      this.colors[base + 2],
      this.colors[base + 3],
    );
  }

  /** Writes the colour at age = lifetime of the live particle `index` into `out`. */
  getEndColor(index: number, out: Vector4): Vector4 {
    this.#assertLive(index, "getEndColor");
    const base = index * COLOR_STRIDE;
    return out.set(
      this.colors[base + 4],
      this.colors[base + 5],
      this.colors[base + 6],
      this.colors[base + 7],
    );
  }

  /**
   * Writes the current colour of the live particle `index` into `out` — the
   * ramp evaluated component-wise at {@link ParticlePool.getNormalizedAge}, in
   * the same `start + (end − start) · t` form as {@link ParticlePool.getSize}.
   *
   * Straight (non-premultiplied) RGBA, interpolated in whatever space the author
   * wrote the endpoints in; §60a colour management is the renderer's business,
   * not the pool's.
   */
  getColor(index: number, out: Vector4): Vector4 {
    const t = this.getNormalizedAge(index);
    const base = index * COLOR_STRIDE;
    const r = this.colors[base];
    const g = this.colors[base + 1];
    const b = this.colors[base + 2];
    const a = this.colors[base + 3];
    return out.set(
      r + (this.colors[base + 4] - r) * t,
      g + (this.colors[base + 5] - g) * t,
      b + (this.colors[base + 6] - b) * t,
      a + (this.colors[base + 7] - a) * t,
    );
  }

  /** Zeroes every channel of `index`. Used by {@link ParticlePool.spawn}. */
  #zero(index: number): void {
    const vectorBase = index * VECTOR_STRIDE;
    this.positions[vectorBase] = 0;
    this.positions[vectorBase + 1] = 0;
    this.positions[vectorBase + 2] = 0;
    this.velocities[vectorBase] = 0;
    this.velocities[vectorBase + 1] = 0;
    this.velocities[vectorBase + 2] = 0;
    this.ages[index] = 0;
    this.lifetimes[index] = 0;
    const sizeBase = index * SIZE_STRIDE;
    this.sizes[sizeBase] = 0;
    this.sizes[sizeBase + 1] = 0;
    const colorBase = index * COLOR_STRIDE;
    for (let i = 0; i < COLOR_STRIDE; i += 1) {
      this.colors[colorBase + i] = 0;
    }
  }

  /** Copies every channel of slot `from` over slot `to`. */
  #copySlot(from: number, to: number): void {
    const fromVector = from * VECTOR_STRIDE;
    const toVector = to * VECTOR_STRIDE;
    this.positions[toVector] = this.positions[fromVector];
    this.positions[toVector + 1] = this.positions[fromVector + 1];
    this.positions[toVector + 2] = this.positions[fromVector + 2];
    this.velocities[toVector] = this.velocities[fromVector];
    this.velocities[toVector + 1] = this.velocities[fromVector + 1];
    this.velocities[toVector + 2] = this.velocities[fromVector + 2];
    this.ages[to] = this.ages[from];
    this.lifetimes[to] = this.lifetimes[from];
    const fromSize = from * SIZE_STRIDE;
    const toSize = to * SIZE_STRIDE;
    this.sizes[toSize] = this.sizes[fromSize];
    this.sizes[toSize + 1] = this.sizes[fromSize + 1];
    const fromColor = from * COLOR_STRIDE;
    const toColor = to * COLOR_STRIDE;
    for (let i = 0; i < COLOR_STRIDE; i += 1) {
      this.colors[toColor + i] = this.colors[fromColor + i];
    }
  }

  /**
   * Rejects an index that is not a live slot.
   *
   * Validated because a `Float32Array` read past its end returns `undefined` at
   * runtime while TypeScript still types it `number` — the one place where a
   * typed-array pool silently produces `NaN` several frames later. Two integer
   * comparisons per accessor is the price; the emitter's inner loop bypasses
   * them by touching the channel arrays directly.
   */
  #assertLive(index: number, operation: string): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.#aliveCount) {
      throw new RangeError(
        `ParticlePool.${operation}: index ${String(index)} is not a live particle (aliveCount ${String(this.#aliveCount)})`,
      );
    }
  }
}
