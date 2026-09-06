/**
 * Steering behaviours and flocking (§12 "steering behaviours", §111), plan
 * P8-1/P8-2.
 *
 * Every behaviour here is a **pure function that writes an acceleration** into
 * an `out` vector, given a read-only view of the agent:
 *
 * ```ts
 * const agent = new SteeringAgent({ maxSpeed: 6, maxAcceleration: 20 });
 * agent.position.set(0, 0, 0);
 *
 * const acceleration = new Vector3();
 * seek(agent, target, acceleration);      // writes an acceleration
 * agent.integrate(1 / 60, acceleration);  // the caller applies it
 * ```
 *
 * Plan P8-2 pins that shape: steering **outputs an acceleration**, the caller
 * applies it. Nothing here integrates, owns a node, reads a clock, or writes a
 * transform, which is what lets the same function feed a §38 integrator, a §11
 * `MotionComponent`'s `linearAcceleration`, a §26 physics force, or a test
 * harness — none of which need to agree with each other.
 *
 * ## Reynolds' formulation, and what its units really are
 *
 * All of these are Craig Reynolds' behaviours (*Steering Behaviors For
 * Autonomous Characters*, GDC 1999), which are all built from one line:
 *
 * ```text
 * steering = truncate(desiredVelocity − velocity, maxAcceleration)
 * ```
 *
 * That difference is dimensionally a **velocity error** (m/s) used as an
 * **acceleration** (m/s²) — i.e. the classic formulation carries an implicit
 * proportional gain of `1 s⁻¹`, and then bounds the result with
 * `maxAcceleration`. This is stated rather than hidden because it has two
 * visible consequences: an agent approaches its desired velocity with a one
 * second time constant while it is not truncated, and a caller who wants a
 * different closing rate should scale the result (or drive the velocity error
 * through WP-8.1's PID controller) instead of expecting a knob here.
 *
 * Each behaviour states its own `desiredVelocity`; that is the entire
 * difference between them.
 *
 * ## Allocation and re-entrancy (§7b, plan D7)
 *
 * **This module has no scratch state at all** — not even module-level
 * temporaries. Intermediate points and sums are held in plain `number` locals
 * and reach the caller through a single `out.set(...)`, so every behaviour is
 * allocation-free, re-entrant, and safe to call from inside an integrator's
 * acceleration callback (unlike `integrators.ts`, which does own scratch).
 * `out` is written **exactly once** per call — the acceleration clamp is applied
 * to the scalars, before the write — so a hooked vector (plan D3) fires its
 * change hook once per behaviour, never twice.
 *
 * ## Conventions
 *
 * - Right-handed, **Y-up in both 2D and 3D** (§7a). 2D agents live in the XY
 *   plane at `z = 0` (§21) and the behaviours preserve that: every one of them
 *   is a linear combination of the inputs' components, so a scenario whose
 *   inputs all have `z = 0` produces `z = 0` out. The single exception is
 *   {@link wander}, whose circle is *defined* on the XY plane — see there.
 * - Angles are radians, times seconds (§7a).
 * - `maxSpeed` and `maxAcceleration` are per-agent limits in units/s and
 *   units/s². They are **not validated** on this hot path: negative values
 *   reverse or zero the result, `NaN` propagates. Validate at authoring time.
 * - A degenerate direction (target exactly on the agent, all neighbours
 *   coincident) yields a **zero desired velocity** rather than `NaN`, matching
 *   `Vector3.normalize`'s zero-length rule.
 *
 * ## Neighbour queries (decision, WP-8.2)
 *
 * {@link separation}, {@link cohesion}, and {@link alignment} take an
 * `Iterable<SteeringNeighbor>` — an array, a `Set`, a generator, anything. The
 * iterable **is** the neighbourhood: there is no radius parameter and no
 * built-in spatial query, because the caller already knows how its world is
 * indexed. Iteration is a single brute-force pass in the iterable's own order
 * (§33: insertion order, so results are reproducible), and the three behaviours
 * are `O(neighbours)` each, `O(n²)` for a self-flocking group of `n`.
 *
 * **Spatial hash (2026-09-06, WP-8.2):** {@link SpatialHash} in
 * `./spatial-hash.js` is the optional uniform-grid neighbour index. Flocking
 * behaviours still take an `Iterable<SteeringNeighbor>` — build that iterable
 * with `hash.query(...)` each frame (or keep brute force for small `n`).
 *
 * ## What is *not* here
 *
 * Obstacle avoidance, wall following, path following (§12's `followPath` is
 * already in `kinematic-controller.ts`), offset pursuit, and leader following.
 * They need a collision query, a wall set, or a path type respectively; P8-1's
 * pinned set is the one implemented above (2026-08-02).
 */

import { Vector3 } from "@four/math";

import { interceptTime as predictedInterceptTime } from "./prediction.js";
import type { SeededRandom } from "./random.js";

/**
 * The read-only view of a neighbouring agent that flocking needs (§12).
 *
 * Structural, and deliberately smaller than {@link SteeringContext}: a
 * neighbour contributes only where it is and how fast it is going, so anything
 * with a position and a velocity — a `SteeringAgent`, a `{ position, velocity }`
 * literal, a physics body wrapper — is a neighbour without adapting to a class.
 *
 * `readonly` marks intent: no behaviour in this module ever mutates a
 * neighbour's or a context's vectors. It cannot be enforced deeper — TypeScript
 * `readonly` stops reassignment of the property, not mutation of the `Vector3`
 * it points at — so the guarantee is the implementation's, and is tested.
 */
export interface SteeringNeighbor {
  /** World position of the agent. Never mutated by a behaviour. */
  readonly position: Vector3;
  /** World velocity in units per second. Never mutated by a behaviour. */
  readonly velocity: Vector3;
}

/**
 * The read-only view of the steering agent itself (plan P8-2).
 *
 * A {@link SteeringNeighbor} plus the two limits that turn a desired velocity
 * into a bounded acceleration.
 */
export interface SteeringContext extends SteeringNeighbor {
  /** Top speed in units per second; the magnitude of any desired velocity. */
  readonly maxSpeed: number;
  /** Acceleration budget in units per second squared; the truncation limit. */
  readonly maxAcceleration: number;
}

/**
 * Clamps `vector` to at most `maxLength`, in place, and returns it.
 *
 * Shorter vectors are left **bit-identical and unwritten** (no round-trip
 * through a normalize, no change hook), so `truncate` is a no-op exactly when it
 * should be. A non-positive `maxLength` zeroes the vector: `0` because that is
 * the limit, and negative because scaling by a negative limit would reverse the
 * direction, which is never what a caller means.
 *
 * The common case costs one squared-length comparison and no square root.
 *
 * This is the public form of the clamp every behaviour applies. The behaviours
 * do not call it: they clamp the scalars they are about to write, which keeps
 * `out` to a single write (see the module note on allocation), and
 * `writeTruncated` is that shared scalar form.
 */
export function truncate(vector: Vector3, maxLength: number): Vector3 {
  if (maxLength <= 0) {
    return vector.set(0, 0, 0);
  }
  const lengthSquared = vector.lengthSq();
  if (lengthSquared > maxLength * maxLength) {
    vector.scale(maxLength / Math.sqrt(lengthSquared));
  }
  return vector;
}

/**
 * Writes `(x, y, z)` into `out`, clamped to `maxLength` — one write, whether or
 * not the clamp bit. See {@link truncate} for the non-positive-limit rule.
 */
function writeTruncated(
  out: Vector3,
  x: number,
  y: number,
  z: number,
  maxLength: number,
): Vector3 {
  if (maxLength <= 0) {
    return out.set(0, 0, 0);
  }
  const lengthSquared = x * x + y * y + z * z;
  if (lengthSquared > maxLength * maxLength) {
    const scale = maxLength / Math.sqrt(lengthSquared);
    return out.set(x * scale, y * scale, z * scale);
  }
  return out.set(x, y, z);
}

/**
 * The one line every behaviour is built from: steer toward the desired velocity
 * `(dx, dy, dz)` and truncate to the agent's acceleration budget.
 *
 * Scalar arguments rather than a vector so no caller needs a scratch vector for
 * the desired velocity — that is what keeps this module allocation-free.
 */
function steerTowardVelocity(
  context: SteeringContext,
  dx: number,
  dy: number,
  dz: number,
  out: Vector3,
): Vector3 {
  const { velocity } = context;
  return writeTruncated(
    out,
    dx - velocity.x,
    dy - velocity.y,
    dz - velocity.z,
    context.maxAcceleration,
  );
}

/**
 * Seek the point `(tx, ty, tz)` at full speed. The scalar core of
 * {@link seek}, {@link wander}, {@link pursue}, and {@link cohesion}.
 */
function seekPoint(
  context: SteeringContext,
  tx: number,
  ty: number,
  tz: number,
  out: Vector3,
): Vector3 {
  const { position, maxSpeed } = context;
  const ox = tx - position.x;
  const oy = ty - position.y;
  const oz = tz - position.z;
  const distanceSquared = ox * ox + oy * oy + oz * oz;
  if (distanceSquared === 0) {
    // No direction to want. The desired velocity is zero, so the agent brakes.
    return steerTowardVelocity(context, 0, 0, 0, out);
  }
  const scale = maxSpeed / Math.sqrt(distanceSquared);
  return steerTowardVelocity(context, ox * scale, oy * scale, oz * scale, out);
}

/**
 * **Seek** (§12): move toward `target` at `maxSpeed`.
 *
 * ```text
 * desiredVelocity = normalize(target − position) · maxSpeed
 * ```
 *
 * From rest, and whenever the velocity error exceeds the budget, the result is
 * exactly `maxAcceleration` pointed at the target. Standing *on* the target the
 * desired velocity is zero, so seek brakes rather than producing `NaN` — which
 * is also why seek alone orbits a target it is fast enough to overshoot; that is
 * what {@link arrive} fixes.
 */
export function seek(
  context: SteeringContext,
  target: Vector3,
  out: Vector3,
): Vector3 {
  return seekPoint(context, target.x, target.y, target.z, out);
}

/**
 * Flee the point `(tx, ty, tz)` at full speed. The scalar core of {@link flee}
 * and {@link evade}, mirroring {@link seekPoint}.
 */
function fleePoint(
  context: SteeringContext,
  tx: number,
  ty: number,
  tz: number,
  out: Vector3,
): Vector3 {
  const { position, maxSpeed } = context;
  const ox = position.x - tx;
  const oy = position.y - ty;
  const oz = position.z - tz;
  const distanceSquared = ox * ox + oy * oy + oz * oz;
  if (distanceSquared === 0) {
    return steerTowardVelocity(context, 0, 0, 0, out);
  }
  const scale = maxSpeed / Math.sqrt(distanceSquared);
  return steerTowardVelocity(context, ox * scale, oy * scale, oz * scale, out);
}

/**
 * **Flee** (§12): move directly away from `target` at `maxSpeed`.
 *
 * ```text
 * desiredVelocity = normalize(position − target) · maxSpeed
 * ```
 *
 * Flee's *desired velocity* is always the exact negation of {@link seek}'s, so
 * from rest the two accelerations are exact componentwise negations. They are
 * **not** negations of one another at non-zero velocity, and deliberately so:
 * both subtract the same `velocity`, which is what makes flee brake and reverse
 * hard when the agent is charging at the threat, where a literal `−seek()` would
 * return nearly zero at exactly the wrong moment. `tests/steering.test.ts`
 * pins both halves of this.
 */
export function flee(
  context: SteeringContext,
  target: Vector3,
  out: Vector3,
): Vector3 {
  return fleePoint(context, target.x, target.y, target.z, out);
}

/**
 * **Arrive** (§12): seek `target`, but ramp the desired speed down inside
 * `slowRadius` so the agent stops *on* it.
 *
 * ```text
 * d             = |target − position|
 * desiredSpeed  = d < slowRadius ? maxSpeed · d / slowRadius : maxSpeed
 * desiredVelocity = normalize(target − position) · desiredSpeed
 * ```
 *
 * The ramp is linear in distance, and the closed form matters: at `d = 0` the
 * desired speed is exactly `0` and the desired velocity is exactly the zero
 * vector, so an agent that is stopped on its target produces **exactly**
 * `(0, 0, 0)` — no residual jitter, no epsilon dead-zone. Outside `slowRadius`
 * arrive is bit-identical to {@link seek}.
 *
 * `slowRadius <= 0` degenerates to seek (the `d < slowRadius` test can never
 * hold), which is the useful reading of "no slow-down zone" and avoids a
 * division by zero without a special case.
 */
export function arrive(
  context: SteeringContext,
  target: Vector3,
  slowRadius: number,
  out: Vector3,
): Vector3 {
  const { position, maxSpeed } = context;
  const ox = target.x - position.x;
  const oy = target.y - position.y;
  const oz = target.z - position.z;
  const distanceSquared = ox * ox + oy * oy + oz * oz;
  if (distanceSquared === 0) {
    return steerTowardVelocity(context, 0, 0, 0, out);
  }
  const distance = Math.sqrt(distanceSquared);
  const desiredSpeed =
    distance < slowRadius ? (maxSpeed * distance) / slowRadius : maxSpeed;
  const scale = desiredSpeed / distance;
  return steerTowardVelocity(context, ox * scale, oy * scale, oz * scale, out);
}

/**
 * Time at which an agent travelling at `maxSpeed` from `context.position` can
 * meet a target that moves from `(targetPosition)` at constant
 * `(targetVelocity)` — the closed-form interception time, in seconds.
 *
 * With `r = targetPosition − position`, `v = targetVelocity`, `s = maxSpeed`,
 * interception requires `|r + v·t| = s·t`, i.e.
 *
 * ```text
 * (|v|² − s²) · t² + 2(r · v) · t + |r|² = 0
 * ```
 *
 * The smallest non-negative root is the answer. The roots are computed in the
 * numerically stable form `q = −½(b + sign(b)·√Δ)`, `t ∈ {q/a, c/q}` (Press et
 * al., *Numerical Recipes*), which also removes every special case: a target
 * moving at exactly `maxSpeed` makes `a = 0` and leaves only the `c/q` root, and
 * a stationary agent at the target's position makes `c = 0` and gives `t = 0`.
 *
 * When no non-negative root exists — the target is faster and opening the range,
 * so it can never be caught — the function falls back to Reynolds' heuristic
 * horizon `|r| / maxSpeed`, "however long it would take me to reach where the
 * target is now". That keeps pursuit pointed usefully ahead instead of
 * collapsing to a stern chase, and is stated here because it is the one place
 * this solver is not a closed form.
 *
 * The quadratic lives in `prediction.ts` (`interceptTime`). The two call
 * sites here pass the steering policy — Reynolds' heuristic on a miss, no
 * throw on a bad `maxSpeed` — so pursue/evade keep the behaviour they had
 * when this helper was a private copy (2026-08-02 fold; the 2026-08-05
 * review's policy split is now an options bag on that export rather than a
 * second solver).
 */
function interceptTime(
  context: SteeringContext,
  targetPosition: Vector3,
  targetVelocity: Vector3,
): number {
  return predictedInterceptTime(
    context.position,
    context.maxSpeed,
    targetPosition,
    targetVelocity,
    { onMiss: "heuristic", validateSpeed: false },
  );
}

/**
 * **Pursue** (§12): seek where a constant-velocity target *will be*.
 *
 * The lead time comes from the closed-form interception solution described on
 * this module's `interceptTime` helper — not from Reynolds' `distance /
 * maxSpeed` heuristic, which lags a crossing target — and the predicted point is
 * `targetPosition + targetVelocity · t`. Pursue then {@link seek}s that point,
 * so everything true of seek (full-speed desired velocity, truncation, braking
 * when standing on the point) is true here.
 *
 * The prediction assumes the target holds its velocity for `t` seconds; a
 * manoeuvring target simply gets a fresh prediction every step, which is the
 * standard treatment and converges because `t` shrinks as the range closes.
 */
export function pursue(
  context: SteeringContext,
  targetPosition: Vector3,
  targetVelocity: Vector3,
  out: Vector3,
): Vector3 {
  const t = interceptTime(context, targetPosition, targetVelocity);
  return seekPoint(
    context,
    targetPosition.x + targetVelocity.x * t,
    targetPosition.y + targetVelocity.y * t,
    targetPosition.z + targetVelocity.z * t,
    out,
  );
}

/**
 * **Evade** (§12): flee where a constant-velocity threat *will be*.
 *
 * The exact mirror of {@link pursue}: same lead time (the moment a seeker with
 * this agent's `maxSpeed` would meet the threat, which is the horizon worth
 * running from), then {@link flee} instead of seek. From rest, evade is the
 * exact componentwise negation of pursue with the same arguments.
 */
export function evade(
  context: SteeringContext,
  targetPosition: Vector3,
  targetVelocity: Vector3,
  out: Vector3,
): Vector3 {
  const t = interceptTime(context, targetPosition, targetVelocity);
  return fleePoint(
    context,
    targetPosition.x + targetVelocity.x * t,
    targetPosition.y + targetVelocity.y * t,
    targetPosition.z + targetVelocity.z * t,
    out,
  );
}

/** `2π`, for wrapping the wander angle. */
const TWO_PI = Math.PI * 2;

/** Construction options for {@link WanderState}. */
export interface WanderStateOptions {
  /** Radius of the wander circle in units; must be finite and `> 0`. */
  radius: number;
  /**
   * How far ahead of the agent the circle's centre sits, in units; must be
   * finite and `>= 0`. Keep it larger than `radius` for forward-biased wander.
   */
  distance: number;
  /**
   * Maximum angular jitter in **radians per second**; must be finite and
   * `>= 0`. Each step displaces the angle by a uniform draw from
   * `[−jitter · dt, +jitter · dt)`.
   */
  jitter: number;
  /** Initial angle on the circle in radians. Default `0` (straight ahead). */
  angle?: number;
}

/**
 * The per-agent memory {@link wander} needs: where the wander target currently
 * sits on the circle.
 *
 * Wander is the one behaviour that is not a pure function of the agent's state —
 * "random but not twitchy" *means* correlating this step's target with the last
 * one, so the correlation has to live somewhere. It lives here, one object per
 * agent, alongside the shape parameters, so the behaviour itself stays a
 * function and two agents can never share a wander phase by accident.
 */
export class WanderState {
  /** Radius of the wander circle, in units. */
  radius: number;

  /** Distance from the agent to the circle's centre, in units. */
  distance: number;

  /** Maximum angular jitter, in radians per second. */
  jitter: number;

  /**
   * Current angle of the wander target on the circle, in radians, measured in
   * the world XY plane from +X. Kept wrapped to `[−π, π)` by {@link wander}.
   */
  angle: number;

  constructor(options: WanderStateOptions) {
    assertFinite(options.radius, "WanderState radius");
    assertFinite(options.distance, "WanderState distance");
    assertFinite(options.jitter, "WanderState jitter");
    if (options.radius <= 0) {
      throw new RangeError(
        `WanderState radius must be greater than zero; received ${String(options.radius)}`,
      );
    }
    if (options.distance < 0 || options.jitter < 0) {
      throw new RangeError(
        `WanderState distance and jitter must be non-negative; received ${String(options.distance)} and ${String(options.jitter)}`,
      );
    }
    this.radius = options.radius;
    this.distance = options.distance;
    this.jitter = options.jitter;
    this.angle = options.angle ?? 0;
    if (!Number.isFinite(this.angle)) {
      throw new RangeError(
        `WanderState angle must be a finite number of radians (§7a); received ${String(this.angle)}`,
      );
    }
  }

  /** Puts the wander target back at `angle` radians (default `0`). */
  reset(angle = 0): this {
    this.angle = angle;
    return this;
  }
}

/** Throws unless `value` is a finite number. */
function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${what} must be a finite number; received ${String(value)}`,
    );
  }
}

/**
 * **Wander** (§12, §111): steer toward a target that jitters around a circle
 * projected ahead of the agent — the classic formulation, made deterministic.
 *
 * ```text
 * angle  += uniform(−jitter · dt, +jitter · dt)      (one draw from `random`)
 * centre  = position + normalize(velocity) · distance
 * target  = centre + (cos angle, sin angle, 0) · radius
 * result  = seek(target)
 * ```
 *
 * The angle is a bounded random walk rather than a fresh direction per step,
 * which is the entire point: an independent draw every frame averages out to
 * nothing and looks like vibration, while a walking angle produces smooth,
 * plausible meandering. The circle rides ahead of the agent so the target stays
 * mostly in front of it, and `radius / distance` sets how sharply it can turn.
 *
 * ## Determinism (plan P8-3)
 *
 * Exactly **one** draw from `random` per call, always, so a stream feeding a
 * fixed-step loop is a function of step count alone: two agents seeded alike
 * trace identical paths, and different seeds diverge. `tests/steering.test.ts`
 * asserts both.
 *
 * ## Plane, and what that costs (decision, WP-8.2)
 *
 * The circle is defined **on the XY plane** (§7a: 2D is XY, Y-up), so 2D agents
 * — the ones §111 has in mind — get exactly the classic behaviour and never
 * leave `z = 0`. A 3D agent still wanders, but only in heading, not in pitch:
 * the circle stays XY-aligned while its centre follows the 3D heading.
 * **Staged (2026-08-02, WP-8.2):** spherical wander (a jittered point on a
 * sphere, or a heading-aligned circle frame), which needs a basis convention for
 * the circle's orientation that no §111 consumer has asked for yet.
 *
 * The angle is held in the **world** frame, not the agent's local frame as
 * Buckland's variant does; the two differ by whether the wander target rotates
 * with the agent, and the world-frame form has no frame construction and no
 * accumulated rotation error.
 *
 * ## `deltaTime`
 *
 * `jitter` is a rate (radians per second, §7a) and is scaled by `deltaTime`
 * here. The angular random walk's diffusion therefore scales with `dt` rather
 * than being step-size invariant (invariance would want a `√dt` scaling); with
 * the §10 fixed step this is constant and reproducible, and the classic
 * formulation is what the parameter names mean elsewhere in the literature.
 * A zero-velocity agent has no heading, so the circle is centred on the agent
 * itself and wander pushes it off in the current angle's direction.
 */
export function wander(
  context: SteeringContext,
  state: WanderState,
  random: SeededRandom,
  deltaTime: number,
  out: Vector3,
): Vector3 {
  const spread = state.jitter * deltaTime;
  let angle = state.angle + random.nextRange(-spread, spread);
  // Wrap into [−π, π) branchlessly, for any magnitude of jitter.
  angle -= TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
  state.angle = angle;

  const { position, velocity } = context;
  const speed = velocity.length();
  let cx = position.x;
  let cy = position.y;
  let cz = position.z;
  if (speed > 0) {
    const scale = state.distance / speed;
    cx += velocity.x * scale;
    cy += velocity.y * scale;
    cz += velocity.z * scale;
  }
  return seekPoint(
    context,
    cx + Math.cos(angle) * state.radius,
    cy + Math.sin(angle) * state.radius,
    cz,
    out,
  );
}

/**
 * **Separation** (§12 flocking): steer away from crowding neighbours.
 *
 * ```text
 * repulsion = Σ (position − neighbour.position) / |position − neighbour.position|²
 * desiredVelocity = normalize(repulsion) · maxSpeed
 * ```
 *
 * Each neighbour contributes a unit vector away from it, weighted by `1 /
 * distance`, so close neighbours dominate distant ones — the standard
 * inverse-distance falloff. The neighbour set *is* the neighbourhood (see the
 * module note); a neighbour exactly on top of the agent has no direction to push
 * along and is skipped rather than producing `NaN`.
 *
 * With no neighbours — or with contributions that cancel exactly — the result is
 * the **zero vector**, not a braking `−velocity`. "Nothing to avoid" must be an
 * abstention, or a weighted blend of behaviours would silently brake whenever
 * the flock spread out.
 */
export function separation(
  context: SteeringContext,
  neighbors: Iterable<SteeringNeighbor>,
  out: Vector3,
): Vector3 {
  const { position } = context;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const neighbor of neighbors) {
    const ox = position.x - neighbor.position.x;
    const oy = position.y - neighbor.position.y;
    const oz = position.z - neighbor.position.z;
    const distanceSquared = ox * ox + oy * oy + oz * oz;
    if (distanceSquared === 0) {
      continue;
    }
    // (offset / |offset|) / |offset| === offset / |offset|²
    sx += ox / distanceSquared;
    sy += oy / distanceSquared;
    sz += oz / distanceSquared;
  }
  const magnitudeSquared = sx * sx + sy * sy + sz * sz;
  if (magnitudeSquared === 0) {
    return out.set(0, 0, 0);
  }
  const scale = context.maxSpeed / Math.sqrt(magnitudeSquared);
  return steerTowardVelocity(context, sx * scale, sy * scale, sz * scale, out);
}

/**
 * **Cohesion** (§12 flocking): steer toward the centroid of the neighbours.
 *
 * ```text
 * centroid = (Σ neighbour.position) / count
 * result   = seek(centroid)
 * ```
 *
 * Literally Reynolds' definition — cohesion *is* seek, aimed at the average
 * position — so a straggler accelerates at `maxAcceleration` toward the middle
 * of its flock. With no neighbours there is no centroid and the result is the
 * zero vector (see {@link separation} on abstention).
 */
export function cohesion(
  context: SteeringContext,
  neighbors: Iterable<SteeringNeighbor>,
  out: Vector3,
): Vector3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;
  for (const neighbor of neighbors) {
    sx += neighbor.position.x;
    sy += neighbor.position.y;
    sz += neighbor.position.z;
    count += 1;
  }
  if (count === 0) {
    return out.set(0, 0, 0);
  }
  return seekPoint(context, sx / count, sy / count, sz / count, out);
}

/**
 * **Alignment** (§12 flocking): match the neighbours' mean velocity.
 *
 * ```text
 * desiredVelocity = clamp((Σ neighbour.velocity) / count, maxSpeed)
 * ```
 *
 * The mean velocity is the desired velocity directly — not renormalized to
 * `maxSpeed`, because a flock cruising at half speed should not be accelerated
 * to full speed by alignment alone. It *is* clamped to `maxSpeed`, so an agent
 * is never asked for a velocity it cannot hold. With no neighbours the result is
 * the zero vector (see {@link separation} on abstention).
 *
 * Applied on its own from rest, alignment drives the agent's velocity to the
 * mean exponentially with a one second time constant (the implicit gain noted at
 * the top of this module), and once matched it produces exactly zero.
 */
export function alignment(
  context: SteeringContext,
  neighbors: Iterable<SteeringNeighbor>,
  out: Vector3,
): Vector3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;
  for (const neighbor of neighbors) {
    sx += neighbor.velocity.x;
    sy += neighbor.velocity.y;
    sz += neighbor.velocity.z;
    count += 1;
  }
  if (count === 0) {
    return out.set(0, 0, 0);
  }
  let dx = sx / count;
  let dy = sy / count;
  let dz = sz / count;
  const { maxSpeed } = context;
  const speedSquared = dx * dx + dy * dy + dz * dz;
  if (speedSquared > maxSpeed * maxSpeed) {
    const scale = maxSpeed / Math.sqrt(speedSquared);
    dx *= scale;
    dy *= scale;
    dz *= scale;
  }
  return steerTowardVelocity(context, dx, dy, dz, out);
}

/** Construction options for {@link SteeringAgent}. */
export interface SteeringAgentOptions {
  /** Initial position. **Copied**; the caller keeps ownership. Default origin. */
  position?: Vector3;
  /** Initial velocity in units per second. **Copied**. Default zero. */
  velocity?: Vector3;
  /** Top speed in units per second. Default `1`. */
  maxSpeed?: number;
  /** Acceleration budget in units per second squared. Default `1`. */
  maxAcceleration?: number;
}

/**
 * A mutable {@link SteeringContext} with a weighted blender and a one-line
 * integrator — the convenience wrapper plan P8-2 leaves optional.
 *
 * It exists because every real use of this module repeats the same three
 * things: hold the agent's state, add up several behaviours with weights, and
 * apply the result. None of that belongs *inside* a behaviour, and all of it is
 * tedious to rewrite.
 *
 * ```ts
 * const agent = new SteeringAgent({ maxSpeed: 6, maxAcceleration: 12 });
 * const scratch = new Vector3();
 * const steering = new Vector3();
 *
 * agent.beginSteering();
 * agent.addSteering(separation(agent, neighbors, scratch), 1.5);
 * agent.addSteering(alignment(agent, neighbors, scratch), 1.0);
 * agent.addSteering(cohesion(agent, neighbors, scratch), 1.0);
 * agent.endSteering(steering);       // weighted sum, truncated to the budget
 * agent.integrate(1 / 60, steering);
 * ```
 *
 * The blend is a **weighted sum truncated once at the end**, the simplest of the
 * combination strategies Reynolds describes. Prioritized dithering and truncated
 * running-sum arbitration are deliberately not here: they change which
 * behaviours are evaluated at all, which is an application policy.
 *
 * `integrate` is semi-implicit Euler with a speed clamp — the §38 default and
 * the same rule `MotionComponent` uses (`v += a·dt`, clamp, `x += v·dt`) — so
 * an agent driven by this class and one driven by a `MotionComponent` move
 * identically. It is a convenience for standalone agents and headless tests;
 * an agent that is a scene node should be driven by `MotionSystem` (§39) or a
 * physics body instead, with `position`/`velocity` mirroring the node.
 *
 * The three vectors are owned by the agent and never replaced. Allocation
 * happens only in the constructor.
 */
export class SteeringAgent implements SteeringContext {
  /** World position. Owned by the agent; write into it, never replace it. */
  readonly position: Vector3;

  /** World velocity in units per second. Owned by the agent. */
  readonly velocity: Vector3;

  /** Top speed in units per second. */
  maxSpeed: number;

  /** Acceleration budget in units per second squared. */
  maxAcceleration: number;

  /** Running weighted sum between {@link beginSteering} and {@link endSteering}. */
  readonly #blend = new Vector3();

  constructor(options: SteeringAgentOptions = {}) {
    this.position = options.position?.clone() ?? new Vector3();
    this.velocity = options.velocity?.clone() ?? new Vector3();
    this.maxSpeed = options.maxSpeed ?? 1;
    this.maxAcceleration = options.maxAcceleration ?? 1;
  }

  /** Clears the weighted sum. Returns this agent. */
  beginSteering(): this {
    this.#blend.set(0, 0, 0);
    return this;
  }

  /**
   * Adds `acceleration · weight` to the running sum. `acceleration` is only
   * read, so the same scratch vector can be reused for every behaviour.
   */
  addSteering(acceleration: Vector3, weight = 1): this {
    this.#blend.set(
      this.#blend.x + acceleration.x * weight,
      this.#blend.y + acceleration.y * weight,
      this.#blend.z + acceleration.z * weight,
    );
    return this;
  }

  /**
   * Writes the weighted sum into `out`, truncated to {@link maxAcceleration},
   * and returns `out` — one write, like every behaviour. The sum is left
   * intact, so it can be inspected or blended further; {@link beginSteering} is
   * what clears it.
   */
  endSteering(out: Vector3): Vector3 {
    const blend = this.#blend;
    return writeTruncated(out, blend.x, blend.y, blend.z, this.maxAcceleration);
  }

  /**
   * Advances the agent by `deltaTime` seconds under `acceleration`, using
   * semi-implicit Euler with a `maxSpeed` clamp (see the class note). Returns
   * this agent.
   */
  integrate(deltaTime: number, acceleration: Vector3): this {
    const { position, velocity, maxSpeed } = this;
    let vx = velocity.x + acceleration.x * deltaTime;
    let vy = velocity.y + acceleration.y * deltaTime;
    let vz = velocity.z + acceleration.z * deltaTime;
    const speedSquared = vx * vx + vy * vy + vz * vz;
    if (speedSquared > maxSpeed * maxSpeed) {
      const scale = maxSpeed / Math.sqrt(speedSquared);
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }
    velocity.set(vx, vy, vz);
    position.set(
      position.x + vx * deltaTime,
      position.y + vy * deltaTime,
      position.z + vz * deltaTime,
    );
    return this;
  }
}
