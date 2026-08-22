/**
 * Shared particle types (§27, §36) — the vocabulary WP-9.1's pool and emitter
 * speak, and the seam WP-9.2's force fields implement against.
 *
 * Nothing here has behaviour: it is the interface plus the option records, kept
 * in one module so `pool.ts`, `emitter.ts`, and (next packet) the built-in field
 * set do not have to import each other to agree on a shape.
 *
 * ## Where `ParticleForceField` comes from — and where it does *not*
 *
 * **The interface is §27's, not this packet's.** §27 (*Force Fields*) declares:
 *
 * ```ts
 * interface ForceField {
 *   sample(
 *     position: Vector3,
 *     velocity: Vector3,
 *     time: number,
 *     out?: Vector3
 *   ): Vector3;
 * }
 * ```
 *
 * {@link ParticleForceField} below is that declaration, transcribed
 * member-for-member. Two honest notes about it:
 *
 * 1. **The name is local.** §27 calls the type `ForceField`; the plan gives its
 *    built-in set (uniform gravity, radial gravity, vortex, wind, drag,
 *    turbulence, …) to **WP-9.2**, in this same package (plan P9-2), and §27
 *    also serves physics force volumes (§26) which are not particles. The
 *    `Particle` prefix marks this declaration as *the particle system's view of*
 *    §27's contract, so that if a later packet lands a general `ForceField` in
 *    another package, the two can be reconciled without a rename churn here.
 *    They are structurally identical, so any §27 field satisfies this type
 *    without an adapter.
 * 2. **This packet implements no fields.** WP-9.1 ships only the *application*
 *    of fields (`emitter.ts` samples every field once per particle per step, in
 *    declaration order). **WP-9.2 ships the implementations** and §27's
 *    volume-based inclusion and filtering. Anything you can write that has a
 *    conforming `sample` works today — that is the point of taking the type as
 *    the seam.
 *
 * ## Units, and what a sampled vector means (decision, WP-9.1)
 *
 * §27 names the type "force field" but MVP particles carry **no mass channel**
 * (see `pool.ts`: position, velocity, age, lifetime, size, colour — no mass), so
 * there is nothing to divide by. WP-9.1 therefore pins: **a sampled vector is
 * applied as an acceleration, in units/s², i.e. particles are unit-mass.** For
 * every field in §27's built-in list this is the same thing up to a constant the
 * author picks anyway (a "gravity" field is authored as −9.81 m/s², not as
 * newtons), and it keeps a per-particle divide off the hot path. If a mass
 * channel is ever added, the interface does not change — the application in
 * `emitter.ts` does.
 *
 * Times are seconds and angles radians throughout (§7a); the world is
 * right-handed and **Y-up in both 2D and 3D**, so the conventional gravity is
 * `(0, −9.81, 0)`.
 */

import type { Vector3 } from "@four/math";

/**
 * §27's `ForceField`, as particles consume it. See the module note for the
 * naming and the units.
 *
 * ```ts
 * const wind: ParticleForceField = {
 *   sample(_position, _velocity, time, out) {
 *     const target = out ?? new Vector3();
 *     return target.set(Math.sin(time), 0, 0);
 *   },
 * };
 * ```
 *
 * Contract for an implementation:
 *
 * - **Do not mutate `position` or `velocity`.** They are the caller's scratch
 *   copies of the particle's live state; writing to them corrupts the step.
 * - **Write into `out` when it is supplied and return it** — the emitter always
 *   supplies one, and doing so is what keeps the hot path allocation-free
 *   (§7b, plan D7). Returning a *different* vector is legal (the caller reads
 *   the return value, never `out`), but that vector must stay valid until the
 *   next call.
 * - **`out` is not zeroed** by the caller. Write every component.
 * - **Be a pure function of its arguments** (§33). No clock — the absolute
 *   simulation time arrives as `time`, in seconds. No `Math.random` — take a
 *   `SeededRandom` at construction if the field is procedural.
 */
export interface ParticleForceField {
  /**
   * Acceleration contributed at `position`, for a particle moving at
   * `velocity`, at absolute simulation time `time` (seconds).
   */
  sample(
    position: Vector3,
    velocity: Vector3,
    time: number,
    out?: Vector3,
  ): Vector3;

  // --- R-34: §27 batched field sampling (begin) ---
  /**
   * **Optional fast path**: the same contribution as {@link
   * ParticleForceField.sample}, for `count` particles at once, **added into**
   * `out` (R-34, §27/§112).
   *
   * ```ts
   * sampleAll(positions, velocities, count, time, out) {
   *   for (let i = 0; i < count; i += 1) {
   *     const base = i * 3;
   *     out[base] += -c * velocities[base];
   *     out[base + 1] += -c * velocities[base + 1];
   *     out[base + 2] += -c * velocities[base + 2];
   *   }
   * }
   * ```
   *
   * ## Why it exists
   *
   * Measured attribution in `benchmarks/results/particles-100k.json`: the
   * integrator alone costs 1.31 ms per 100 000 particles, and **each** field
   * adds ~5.15 ms — three fields consume the whole 16.67 ms fixed-step budget.
   * Almost none of that is the field's arithmetic. It is one megamorphic
   * `sample()` call, two `Vector3.set`s, and three property reads, per particle
   * per field. A field that loops internally pays the call once per step
   * instead of once per particle, and JIT-inlines its own monomorphic body.
   *
   * ## Contract
   *
   * - **Add, do not assign.** `out` arrives carrying the emitter's gravity and
   *   every earlier field's contribution; overwriting it deletes them. (This is
   *   the one place this entry point departs from §27's `sample`, which
   *   produces a value. Producing here would force the emitter to allocate a
   *   second buffer and make a third pass over 3 × `count` floats per field,
   *   which is most of the win.)
   * - **`out` is a `Float64Array`, not `Float32Array`.** The scalar path
   *   accumulates in JavaScript numbers, i.e. binary64; a binary32 accumulator
   *   would round after every field and make a batched run differ from a scalar
   *   one in the last bits. §33 does not permit "fast, and also slightly
   *   different".
   * - **Be bit-identical to `sample`.** Same arithmetic, same order of
   *   operations, same special cases. A field that ships both owes a test that
   *   pins them against each other — every built-in field has one.
   * - `positions` and `velocities` are the pool's live arrays, `xyz` at stride
   *   3, valid for indices `[0, 3 · count)`. **Read, never write.**
   * - Same purity rules as `sample`: no clock, no `Math.random`.
   *
   * A field that does not implement this is not penalised: the emitter falls
   * back to `sample` for that field alone, in the same declaration order, with
   * the same result.
   */
  sampleAll?(
    positions: Float32Array,
    velocities: Float32Array,
    count: number,
    time: number,
    out: Float64Array,
  ): void;
  // --- R-34: §27 batched field sampling (end) ---
}

/**
 * An inclusive-ish numeric interval drawn uniformly at spawn: the draw is
 * `min + (max − min) · u` with `u ∈ [0, 1)`, so `min` is attainable and `max` is
 * not. `min === max` is the way to spell "constant".
 */
export interface ParticleRange {
  /** Lower bound, attainable. */
  readonly min: number;
  /** Upper bound, approached but not attained (unless `min === max`). */
  readonly max: number;
}

/**
 * A start/end pair interpolated linearly over a particle's normalized age
 * (§36 "color and size over lifetime"). `start` is the value at age 0, `end` the
 * value at age = lifetime.
 *
 * MVP tier: two stops and a linear ramp. Arbitrary gradient/curve stops are
 * **staged** (2026-08-02, WP-9.1) — they want the §17 curve machinery from
 * `@four/animation`, which particles may not depend on (§3.1), so they will
 * arrive as a sampled lookup table rather than as a curve reference.
 */
export interface ParticleLifetimeRamp<T> {
  /** Value at normalized age 0. */
  readonly start: T;
  /** Value at normalized age 1. */
  readonly end: T;
}

/** Straight RGBA, each component nominally in `[0, 1]`. Not validated or clamped. */
export interface ParticleColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * One §36 burst: `count` particles emitted the first time the emitter's local
 * elapsed time reaches `time`.
 *
 * Fires **once**. See `emitter.ts` for the exact firing window and the ordering
 * against rate-driven emission.
 */
export interface ParticleBurst {
  /** Emitter-local time in seconds at which this burst fires. */
  readonly time: number;
  /** How many particles to spawn. A non-negative safe integer. */
  readonly count: number;
}
