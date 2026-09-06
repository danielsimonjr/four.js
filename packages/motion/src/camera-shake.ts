/**
 * §44 camera shake: an additive pose offset driven by interpolated value
 * noise, sampled at `simulationTime` so the character is independent of the
 * fixed-step rate (§33).
 *
 * Staged in `camera-rigs.ts` (R-36/R-37 residue) until this packet: a per-step
 * white-noise kick would change with `fixedDeltaTime`, which is exactly the
 * character a replay or a retuned accumulator must not have. The field is the
 * same hash / quintic-fade value noise `@four/particles` uses for turbulence
 * — ported here, not imported, because the §3.1 matrix has no motion →
 * particles edge.
 *
 * ```ts
 * const shake = camera.addComponent(
 *   new CameraShake({
 *     amplitude: new Vector3(0.08, 0.08, 0.04),
 *     frequency: 12,
 *     seed: 7,
 *     traumaDecay: 1.5,
 *   }),
 * );
 * camera.transformAuthority = "constraint";
 * constraints.track(camera);
 * shake.impulse(1);
 * ```
 *
 * {@link ConstraintSystem} runs this **after** the placement rigs and the
 * look-at aim, so the offset is layered on the pose those wrote this step.
 * A node that carries only {@link CameraShake} is also legal: the offset is
 * added to whatever transform is already there.
 *
 * ## Trauma
 *
 * `trauma` is a unitless 0–1 envelope. The sampled offset is scaled by
 * `trauma²` (Perlin's falloff — a linear envelope looks like a step). 
 * {@link CameraShake.impulse} raises it (clamped); `traumaDecay` is the
 * drop per second. Default trauma is `1` and default decay is `0`, so a
 * shake with no impulse still runs at full amplitude until the application
 * turns it down.
 *
 * ## Determinism (§33)
 *
 * The seed is a hash salt, not a stream consumed per step — two shakes with
 * the same seed and the same `simulationTime` are bit-identical regardless
 * of how many times `apply` has been called. `SeededRandom` is accepted as
 * a seed *source* (`random.seed`); its draws are never taken. No clock, no
 * `Math.random`, no per-step allocation.
 */

import type { Component, ComponentHost } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import type { Node } from "@four/scene";

import { SeededRandom } from "./random.js";
import { placeAtWorldPosition, worldPositionOf } from "./rig-target.js";

/** Options for {@link CameraShake} (§44). */
export interface CameraShakeOptions {
  /**
   * Peak positional offset, in metres (§7a). **Copied**. Default
   * `(1, 1, 1)`.
   */
  amplitude?: Vector3;
  /**
   * Peak rotational offset, in radians about world `+X`/`+Y`/`+Z`. **Copied**.
   * Default `(0, 0, 0)` — position-only shake.
   */
  rotationAmplitude?: Vector3;
  /**
   * Value-noise frequency in hertz. The lattice coordinate is
   * `simulationTime · frequency`, so the waveform is a function of
   * simulation time, not of step count. Finite and `>= 0`. Default `1`.
   */
  frequency?: number;
  /**
   * Hash salt. A `SeededRandom` contributes its `seed` only — the stream is
   * not advanced. Default `0`.
   */
  seed?: number | SeededRandom;
  /**
   * Initial trauma in `[0, 1]`. Default `1` (full amplitude, no impulse
   * required).
   */
  trauma?: number;
  /**
   * Trauma drop per second. Finite and `>= 0`. Default `0` (no decay).
   */
  traumaDecay?: number;
}

/** Throws unless `value` is a finite number. */
function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${what} must be a finite number (§85); received ${String(value)}`,
    );
  }
}

/** Throws unless `value` is a finite number `>= 0`. */
function assertNonNegative(value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${what} must be a finite number >= 0 (§85); received ${String(value)}`,
    );
  }
}

/** Clamps `value` to `[0, 1]`. */
function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * §44's shake rig: an additive world-space position offset (and an optional
 * local rotation offset) sampled from interpolated value noise.
 *
 * **Placement is additive**, never a replacement: {@link OrbitRig} and
 * {@link FollowRig} write the clean pose, then this component layers the
 * kick. Rotation, when requested, is composed on the right of the current
 * quaternion (`q' = q · Δ`) so a look-at that ran this step is preserved
 * and then shaken.
 */
export class CameraShake implements Component {
  /**
   * Component key (plan D2) and §79 serialization name. PascalCase is the
   * published spelling for this component — the kebab-case names on the
   * placement rigs predate it and stay as they are.
   */
  static readonly typeName = "CameraShake";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * Peak positional offset, in metres. Written in place — the instance is
   * the component's own copy of what the constructor was given.
   */
  readonly amplitude = new Vector3(1, 1, 1);

  /**
   * Peak rotational offset, in radians about world `+X`/`+Y`/`+Z`. Written
   * in place. `(0, 0, 0)` disables the rotational channel.
   */
  readonly rotationAmplitude = new Vector3();

  /** Value-noise frequency in hertz. Fixed at construction. */
  readonly frequency: number;

  /**
   * Hash salt, reduced to a uint32. Two shakes with this seed and the same
   * `simulationTime` produce bit-identical offsets.
   */
  readonly seed: number;

  /** Trauma drop per second. Fixed at construction. */
  readonly traumaDecay: number;

  /**
   * Steps on which a non-zero offset could not be written — a singular
   * parent, the same refusal {@link OrbitRig.apply} counts.
   */
  skippedSteps = 0;

  /** Backing store for {@link CameraShake.trauma}; always in `[0, 1]`. */
  #trauma: number;

  /**
   * Fallback clock used when `apply` is called without a `simulationTime`
   * (standalone tests). `ConstraintSystem` always passes the injected
   * {@link TimeState.simulationTime}, so this is idle on the engine path.
   */
  #elapsed = 0;

  /** World-space origin scratch, so stepping allocates nothing (D7). */
  readonly #origin = new Vector3();

  /** Incremental rotation about `+X`. */
  readonly #deltaX = new Quaternion();

  /** Incremental rotation about `+Y`. */
  readonly #deltaY = new Quaternion();

  /** Incremental rotation about `+Z`. */
  readonly #deltaZ = new Quaternion();

  /**
   * @throws RangeError if a number is not finite, if `frequency` or
   * `traumaDecay` is negative, or if `trauma` is not in `[0, 1]` after
   * clamping a non-finite refusal (§85).
   */
  constructor(options: CameraShakeOptions = {}) {
    if (options.amplitude !== undefined) {
      this.amplitude.copy(options.amplitude);
    }
    if (options.rotationAmplitude !== undefined) {
      this.rotationAmplitude.copy(options.rotationAmplitude);
    }
    const frequency = options.frequency ?? 1;
    assertNonNegative(frequency, "CameraShakeOptions.frequency");
    this.frequency = frequency;

    const seedSource = options.seed;
    if (seedSource instanceof SeededRandom) {
      this.seed = seedSource.seed;
    } else if (seedSource === undefined) {
      this.seed = 0;
    } else {
      assertFinite(seedSource, "CameraShakeOptions.seed");
      this.seed = seedSource >>> 0;
    }

    const traumaDecay = options.traumaDecay ?? 0;
    assertNonNegative(traumaDecay, "CameraShakeOptions.traumaDecay");
    this.traumaDecay = traumaDecay;

    const trauma = options.trauma ?? 1;
    assertFinite(trauma, "CameraShakeOptions.trauma");
    this.#trauma = clampUnit(trauma);
  }

  /**
   * Unitless 0–1 envelope. The sampled offset is scaled by `trauma²`.
   * Assignment clamps; a non-finite value is refused (§85).
   */
  get trauma(): number {
    return this.#trauma;
  }

  set trauma(value: number) {
    assertFinite(value, "CameraShake.trauma");
    this.#trauma = clampUnit(value);
  }

  /**
   * Raises {@link CameraShake.trauma} by `amount` and clamps to `[0, 1]`.
   * A negative amount lowers it; that is still a clamp, not a second API.
   *
   * @throws RangeError if `amount` is not finite (§85).
   */
  impulse(amount: number): void {
    assertFinite(amount, "CameraShake.impulse amount");
    this.trauma = this.#trauma + amount;
  }

  /**
   * Adds the shake offset to `node`. Called by `ConstraintSystem` once per
   * fixed step, after the §42 authority check and after the placement / aim
   * components.
   *
   * @param node the node being shaken
   * @param deltaSeconds the fixed step, in seconds (§7a) — used only to
   * decay trauma
   * @param simulationTime the §9 physics clock, in seconds. The noise is
   * sampled here so two steps that share a time (or two shakes that share a
   * seed and a time) agree bit for bit. Omitted, the component accumulates
   * `deltaSeconds` itself — a convenience for tests that do not have a
   * `TimeState`.
   * @returns `true` when the offset was applied or was a no-op (zero
   * amplitude, zero trauma). `false` — and a bumped
   * {@link CameraShake.skippedSteps} — when a non-zero positional write was
   * refused by a singular parent.
   */
  apply(node: Node, deltaSeconds: number, simulationTime?: number): boolean {
    if (deltaSeconds > 0 && this.traumaDecay > 0) {
      this.#trauma = clampUnit(this.#trauma - this.traumaDecay * deltaSeconds);
    }

    const time =
      simulationTime === undefined
        ? (this.#elapsed += deltaSeconds > 0 ? deltaSeconds : 0)
        : simulationTime;
    const scale = this.#trauma * this.#trauma;
    if (scale === 0) {
      return true;
    }

    const t = time * this.frequency;
    const salt = this.seed;
    const amp = this.amplitude;
    const ox = amp.x * scale * valueNoise(t, 0, 0, salt);
    const oy = amp.y * scale * valueNoise(t, 0, 0, (salt + 1) >>> 0);
    const oz = amp.z * scale * valueNoise(t, 0, 0, (salt + 2) >>> 0);

    if (ox !== 0 || oy !== 0 || oz !== 0) {
      const origin = worldPositionOf(node, this.#origin);
      if (
        !placeAtWorldPosition(node, origin.x + ox, origin.y + oy, origin.z + oz)
      ) {
        this.skippedSteps += 1;
        return false;
      }
    }

    const rot = this.rotationAmplitude;
    const rx = rot.x * scale * valueNoise(t, 0, 0, (salt + 3) >>> 0);
    const ry = rot.y * scale * valueNoise(t, 0, 0, (salt + 4) >>> 0);
    const rz = rot.z * scale * valueNoise(t, 0, 0, (salt + 5) >>> 0);
    if (rx !== 0 || ry !== 0 || rz !== 0) {
      this.#deltaX.setFromAxisAngle(AXIS_X, rx);
      this.#deltaY.setFromAxisAngle(AXIS_Y, ry);
      this.#deltaZ.setFromAxisAngle(AXIS_Z, rz);
      node.transform.rotation
        .multiply(this.#deltaX)
        .multiply(this.#deltaY)
        .multiply(this.#deltaZ);
    }
    return true;
  }
}

/** World +X, for the rotational channel. Module-constant, never written. */
const AXIS_X = /* @__PURE__ */ new Vector3(1, 0, 0);

/** World +Y. */
const AXIS_Y = /* @__PURE__ */ new Vector3(0, 1, 0);

/** World +Z. */
const AXIS_Z = /* @__PURE__ */ new Vector3(0, 0, 1);

// ---------------------------------------------------------------------------
// Interpolated hash value-noise — ported from `@four/particles` `fields.ts`
// (`valueNoise` / `hashCell`). Integer-only hashing, quintic fade, so the
// field is C² and bit-identical on every engine (§33). Not exported: pinning
// it as public API would freeze the algorithm the way the particles copy
// refused to.
// ---------------------------------------------------------------------------

/** `2³²`, the scale that turns a uint32 hash into a fraction. */
const TWO_POW_32 = 4294967296;

/** Mixing multipliers of {@link hashCell}. Arbitrary odd constants. */
const HASH_MULTIPLIER_X = 0x27d4eb2d;
const HASH_MULTIPLIER_Y = 0x85ebca6b;
const HASH_MULTIPLIER_Z = 0xc2b2ae35;
const HASH_MULTIPLIER_FINAL = 0x9e3779b1;

/**
 * A uint32 hash of one lattice cell corner, salted per channel.
 *
 * Integer-only (`Math.imul`, `^`, `>>>`), so it is bit-identical on every
 * engine (§33).
 */
function hashCell(ix: number, iy: number, iz: number, salt: number): number {
  let h = salt | 0;
  h = Math.imul(h ^ ix, HASH_MULTIPLIER_X);
  h ^= h >>> 15;
  h = Math.imul(h ^ iy, HASH_MULTIPLIER_Y);
  h ^= h >>> 13;
  h = Math.imul(h ^ iz, HASH_MULTIPLIER_Z);
  h ^= h >>> 16;
  h = Math.imul(h, HASH_MULTIPLIER_FINAL);
  h ^= h >>> 16;
  return h >>> 0;
}

/** One lattice corner value in `[−1, 1)`. Exact: a uint32 scaled by a power of two. */
function cornerValue(ix: number, iy: number, iz: number, salt: number): number {
  return (hashCell(ix, iy, iz, salt) / TWO_POW_32) * 2 - 1;
}

/**
 * Ken Perlin's quintic fade `6t⁵ − 15t⁴ + 10t³`, whose first and second
 * derivatives vanish at the knots — that is what makes the interpolated
 * field C².
 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Trilinearly interpolated value noise at `(x, y, z)` in lattice space, in
 * `[−1, 1]`: eight hashed corner values blended with the quintic fade.
 */
function valueNoise(x: number, y: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const ux = fade(x - ix);
  const uy = fade(y - iy);
  const uz = fade(z - iz);

  const c000 = cornerValue(ix, iy, iz, salt);
  const c100 = cornerValue(ix + 1, iy, iz, salt);
  const c010 = cornerValue(ix, iy + 1, iz, salt);
  const c110 = cornerValue(ix + 1, iy + 1, iz, salt);
  const c001 = cornerValue(ix, iy, iz + 1, salt);
  const c101 = cornerValue(ix + 1, iy, iz + 1, salt);
  const c011 = cornerValue(ix, iy + 1, iz + 1, salt);
  const c111 = cornerValue(ix + 1, iy + 1, iz + 1, salt);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}
