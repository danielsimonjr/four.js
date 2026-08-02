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
