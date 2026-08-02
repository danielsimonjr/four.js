/**
 * Trajectory prediction (§111 "trajectory prediction"; plan P8-1).
 *
 * Two closed-form families, no iteration and no state:
 *
 * - **Ballistic** — where a projectile under constant acceleration is at time
 *   `t`, when it reaches its apex, how high that apex is, and when it crosses a
 *   horizontal plane. This is the same motion `ParabolicTrajectory`
 *   (`./trajectories.js`) samples, exposed as bare functions so a targeting
 *   routine, a preview line, or an AI can ask "where will this be?" without
 *   constructing a path object.
 * - **Constant-velocity lead** — the classic interception problem: given a
 *   shooter, a projectile *speed* (not a direction), and a target moving at a
 *   constant velocity, solve for the time at which a projectile fired now would
 *   meet the target, and for the point where that happens.
 *
 * Every function here is **pure**: no clock, no module state that survives a
 * call, same inputs → bit-identical outputs (§33). All times are **seconds** and
 * the world is right-handed **Y-up** in 2D as well as 3D (§7a), so
 * "plane" below means a horizontal plane `y = planeY` and gravity is the usual
 * `(0, -9.81, 0)` (Appendix A; `DEFAULT_BALLISTIC_ACCELERATION_Y` in
 * `./trajectories.js`).
 *
 * ## Allocation (§7b, plan D7)
 *
 * The vector-valued functions take an optional `out` and allocate nothing when
 * it is passed. With `out` omitted they allocate the result, which is the
 * authoring convenience, not the engine path. The scalar functions never
 * allocate.
 *
 * ## No-solution policy (decision, WP-8.3)
 *
 * Prediction questions genuinely have no answer sometimes — a projectile that
 * never reaches the plane, a target that outruns the shot. Those are ordinary
 * runtime outcomes, not programmer errors, so they are **reported, not thrown**:
 *
 * - scalar (time) results return **`NaN`**;
 * - {@link interceptPoint} returns **`null`** and leaves `out` untouched.
 *
 * `NaN` is the one number that survives arithmetic as "no answer" and fails
 * every comparison, so a caller that forgets to check gets a visibly broken
 * value rather than a plausible wrong one. `null` is used where the return is an
 * object, because an all-`NaN` vector is easy to pass on unnoticed. Callers
 * check with `Number.isNaN(t)` / `point === null`. Non-finite *inputs* are not
 * validated (they propagate as `NaN`); the only thrown error here is for a
 * negative or non-finite `projectileSpeed`, which cannot mean anything.
 *
 * ## Related staged work (2026-08-02, plan P8-1)
 *
 * Path-planning adapters (§111 "path planning adapters") are staged pending an
 * adapter RFC. Iterative IK (CCD, FABRIK) is staged; the analytic two-bone
 * solver ships in `./ik.ts`.
 */

import { Vector3 } from "@four/math";

/** `out`, or a fresh vector when the caller did not supply one (plan D7). */
function resultVector(out: Vector3 | undefined): Vector3 {
  return out ?? new Vector3();
}

/**
 * Position of a projectile under constant acceleration after `time` seconds:
 *
 * ```text
 * p(t) = position + velocity · t + ½ · gravity · t²
 * ```
 *
 * `gravity` is any constant acceleration (m/s²) — it is called `gravity`
 * because that is what it almost always is. `time` is unclamped: negative times
 * extrapolate backwards along the same parabola, matching the trajectory
 * module's rule that a path is a function of time.
 */
export function predictBallistic(
  position: Vector3,
  velocity: Vector3,
  gravity: Vector3,
  time: number,
  out?: Vector3,
): Vector3 {
  const halfTimeSquared = 0.5 * time * time;
  return resultVector(out).set(
    position.x + velocity.x * time + gravity.x * halfTimeSquared,
    position.y + velocity.y * time + gravity.y * halfTimeSquared,
    position.z + velocity.z * time + gravity.z * halfTimeSquared,
  );
}

/**
 * Position of a body moving at a constant velocity after `time` seconds:
 * `position + velocity · t`. The zero-acceleration case of {@link
 * predictBallistic}, and the model {@link interceptTime} assumes for its target.
 */
export function predictLinear(
  position: Vector3,
  velocity: Vector3,
  time: number,
  out?: Vector3,
): Vector3 {
  return resultVector(out).set(
    position.x + velocity.x * time,
    position.y + velocity.y * time,
    position.z + velocity.z * time,
  );
}

/**
 * Time in seconds at which a projectile launched with `velocity` reaches the
 * vertex of its parabola — the instant its velocity along the gravity axis is
 * zero:
 *
 * ```text
 * (velocity + gravity · t) · ĝ = 0   ⟹   t = −(velocity · gravity) / |gravity|²
 * ```
 *
 * The result is **negative when the apex is in the past** (a projectile fired
 * downwards is already past the vertex). That is the honest answer for the
 * extrapolated parabola and it keeps the apex identities below exact; callers
 * that only care about the future check the sign.
 *
 * With zero gravity there is no vertex and the result is `Infinity`, matching
 * how `ParabolicTrajectory.duration` reports a flight that never returns.
 *
 * Identities, both asserted in the tests:
 *
 * ```text
 * apexHeight = ½ · |gravity| · timeToApex²
 * flight time between two crossings of one plane = 2 · (timeToApex − t_first)
 * ```
 */
export function ballisticTimeToApex(
  velocity: Vector3,
  gravity: Vector3,
): number {
  const gravitySquared = gravity.lengthSq();
  if (gravitySquared === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return -velocity.dot(gravity) / gravitySquared;
}

/**
 * Height of the parabola's vertex above the launch point, measured along the
 * "up" axis `−ĝ`:
 *
 * ```text
 * v_up = −(velocity · gravity) / |gravity|
 * apexHeight = v_up² / (2 · |gravity|)
 * ```
 *
 * Always `>= 0`: the vertex of a parabola that curves along `gravity` is the
 * highest point of the *whole* curve, so it is at or above the launch point even
 * when {@link ballisticTimeToApex} is negative and the vertex lies in the past.
 * `Infinity` when `gravity` is zero (no vertex exists).
 *
 * The height is measured along the gravity axis only — the horizontal drift is
 * whatever {@link predictBallistic} says at `timeToApex`.
 */
export function ballisticApexHeight(
  velocity: Vector3,
  gravity: Vector3,
): number {
  const gravityLength = gravity.length();
  if (gravityLength === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const upwardSpeed = -velocity.dot(gravity) / gravityLength;
  return (upwardSpeed * upwardSpeed) / (2 * gravityLength);
}

/**
 * Earliest time `t > 0` at which a projectile launched from `position` with
 * `velocity` under `gravity` crosses the horizontal plane `y = planeY`, or `NaN`
 * when it never does again — the flight time to that plane. The bound is strict
 * so that a shot fired *from* the plane reports its landing rather than `0`; see
 * the root choice below.
 *
 * Only the Y components matter — the plane is horizontal and the world is Y-up
 * (§7a) — so this is the quadratic
 *
 * ```text
 * ½·gravity.y·t² + velocity.y·t + (position.y − planeY) = 0
 * ```
 *
 * ## Root choice (decision, WP-8.3)
 *
 * A parabola crosses a horizontal plane twice: once rising, once falling. This
 * returns the **smaller of the two roots that is strictly greater than zero** —
 * the first crossing still ahead:
 *
 * - both roots in the past → `NaN` (nothing ahead to report);
 * - one root at or before `0`, one after → the later one. This is why the bound
 *   is strict: a projectile launched **from** the plane has a root at `t = 0`,
 *   and the useful answer is its landing, not the launch. That answer is the
 *   familiar `2·velocity.y / |gravity.y|`, i.e. twice
 *   {@link ballisticTimeToApex}.
 * - both roots ahead → the earlier one. For a shot fired upward at a plane above
 *   it, that is the crossing **on the way up**; the other crossing (coming back
 *   down) is `2·timeToApex − t` when gravity is vertical.
 * - negative discriminant (the apex never reaches the plane) → `NaN`.
 *
 * Degenerate cases, all consistent with "earliest `t > 0` that satisfies the
 * equation": with `gravity.y = 0` the equation is linear (level flight crosses
 * once or never); with `velocity.y = 0` as well, the path never leaves its
 * height, so the answer is `NaN` unless that height *is* the plane — a path
 * lying in the plane at every time reports `0`.
 *
 * The roots are computed with the numerically stable form (multiply by the
 * conjugate rather than differencing two nearly equal numbers), so a nearly
 * grazing shot does not lose precision.
 */
export function ballisticTimeOfFlightToPlane(
  position: Vector3,
  velocity: Vector3,
  gravity: Vector3,
  planeY: number,
): number {
  return earliestRoot(0.5 * gravity.y, velocity.y, position.y - planeY, false);
}

/**
 * Time in seconds at which a projectile fired **now** from `shooterPosition` at
 * `projectileSpeed` meets a target that is at `targetPosition` and moving at the
 * constant `targetVelocity` — the "lead" or interception time. `NaN` when no
 * interception exists (see the module note on the no-solution policy).
 *
 * Writing `R = targetPosition − shooterPosition`, the projectile can be anywhere
 * on a sphere of radius `projectileSpeed · t` after `t` seconds, so an
 * interception is a `t >= 0` with
 *
 * ```text
 * |R + targetVelocity · t| = projectileSpeed · t
 * ```
 *
 * Squaring (safe for `t >= 0`, where both sides are non-negative, so no spurious
 * root is introduced) gives the quadratic
 *
 * ```text
 * (|targetVelocity|² − projectileSpeed²)·t² + 2·(R · targetVelocity)·t + |R|² = 0
 * ```
 *
 * The **smallest root `>= 0`** is returned: when a target faster than the
 * projectile crosses the shooter's reach there can be two future interceptions,
 * and the earlier one is the shot a player expects. A degenerate leading
 * coefficient (target speed exactly equal to projectile speed) is handled as the
 * linear equation it is: interception then exists only while the target is
 * closing (`R · targetVelocity < 0`).
 *
 * `NaN` therefore covers exactly the cases with no answer — a target receding
 * faster than the projectile, a projectile too slow to catch up, a zero
 * `projectileSpeed` against a target that is not already at the shooter.
 * `0` is returned when the target is already at the shooter.
 *
 * The direction to fire is `(interceptPoint − shooterPosition)` normalized; the
 * speed is `projectileSpeed` by construction. Gravity is **not** modelled — this
 * is the straight-line lead of §111's "trajectory prediction"; a ballistic
 * launch solve (solving for the angle under gravity) is a different problem and
 * is not part of this packet.
 *
 * @throws RangeError when `projectileSpeed` is negative or not finite.
 */
export function interceptTime(
  shooterPosition: Vector3,
  projectileSpeed: number,
  targetPosition: Vector3,
  targetVelocity: Vector3,
): number {
  if (!Number.isFinite(projectileSpeed) || projectileSpeed < 0) {
    throw new RangeError(
      `interceptTime projectileSpeed must be a finite number >= 0 (units per second); received ${String(projectileSpeed)}`,
    );
  }
  const rx = targetPosition.x - shooterPosition.x;
  const ry = targetPosition.y - shooterPosition.y;
  const rz = targetPosition.z - shooterPosition.z;
  const a = targetVelocity.lengthSq() - projectileSpeed * projectileSpeed;
  const b =
    2 * (rx * targetVelocity.x + ry * targetVelocity.y + rz * targetVelocity.z);
  const c = rx * rx + ry * ry + rz * rz;
  return earliestRoot(a, b, c, true);
}

/**
 * Where to aim: the target's position at {@link interceptTime}, i.e.
 * `targetPosition + targetVelocity · interceptTime(...)`.
 *
 * Returns `null` — and leaves `out` **unmodified** — when there is no
 * interception, so a caller cannot mistake a stale or `NaN`-filled vector for an
 * aim point. Firing a projectile of exactly `projectileSpeed` from
 * `shooterPosition` straight at the returned point hits the target; the tests
 * assert that against an independently simulated projectile.
 *
 * @throws RangeError when `projectileSpeed` is negative or not finite.
 */
export function interceptPoint(
  shooterPosition: Vector3,
  projectileSpeed: number,
  targetPosition: Vector3,
  targetVelocity: Vector3,
  out?: Vector3,
): Vector3 | null {
  const time = interceptTime(
    shooterPosition,
    projectileSpeed,
    targetPosition,
    targetVelocity,
  );
  if (!Number.isFinite(time)) {
    return null;
  }
  return predictLinear(targetPosition, targetVelocity, time, out);
}

/**
 * Earliest real root of `a·t² + b·t + c` at a non-negative time, or `NaN` when
 * there is none. `includeZero` selects whether `t = 0` counts as a solution:
 * {@link interceptTime} accepts it (a target already at the shooter is hit
 * immediately), {@link ballisticTimeOfFlightToPlane} does not (a launch from the
 * plane wants its landing).
 *
 * Both roots are computed with the stable pairing `q = −½·(b + sign(b)·√Δ)`,
 * `t₁ = q/a`, `t₂ = c/q`: the two forms of the quadratic formula each lose
 * precision on a different root, and this pairing always uses the accurate one.
 *
 * Degenerate leading coefficients are the linear (`a = 0`) and constant
 * (`a = b = 0`) equations; an identically zero equation is satisfied at every
 * time and reports `0` regardless of `includeZero`.
 */
function earliestRoot(
  a: number,
  b: number,
  c: number,
  includeZero: boolean,
): number {
  if (a === 0) {
    if (b === 0) {
      return c === 0 ? 0 : Number.NaN;
    }
    const root = -c / b;
    return accepts(root, includeZero) ? root : Number.NaN;
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return Number.NaN;
  }
  const rootOfDiscriminant = Math.sqrt(discriminant);
  const q = -0.5 * (b + (b >= 0 ? rootOfDiscriminant : -rootOfDiscriminant));
  const first = q / a;
  // `q === 0` only when b = 0 and Δ = 0, i.e. a double root at zero.
  const second = q === 0 ? first : c / q;
  const lower = Math.min(first, second);
  const upper = Math.max(first, second);
  if (accepts(lower, includeZero)) {
    return lower;
  }
  return accepts(upper, includeZero) ? upper : Number.NaN;
}

/** Whether `root` is an acceptable time: `>= 0` when `includeZero`, else `> 0`. */
function accepts(root: number, includeZero: boolean): boolean {
  return includeZero ? root >= 0 : root > 0;
}
