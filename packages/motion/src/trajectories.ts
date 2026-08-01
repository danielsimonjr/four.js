/**
 * Trajectory system (§13).
 *
 * §13 defines one interface and a list of built-ins:
 *
 * ```ts
 * interface Trajectory {
 *   samplePosition(time: number, out?: Vector3): Vector3;
 *   sampleVelocity(time: number, out?: Vector3): Vector3;
 *   sampleAcceleration(time: number, out?: Vector3): Vector3;
 *   duration: number;
 * }
 * ```
 *
 * A trajectory is a **pure function of time** — position, its first derivative,
 * and its second — not a stateful animator. Nothing here integrates, steps, or
 * remembers where it was last sampled, which is what lets the same object serve
 * a projectile preview, a camera move, a robot path, and a determinism test
 * that samples it backwards.
 *
 * All times and durations are **seconds** (§7a). The world is right-handed,
 * Y-up in both 2D and 3D (§7a), so the "2D" trajectories ({@link
 * CircularTrajectory}, {@link EllipticalTrajectory}) sweep the **XY plane** with
 * `z` left at the centre's `z`, and gravity points down -Y.
 *
 * ## Time outside `[0, duration]` (decision, WP-2.4)
 *
 * Sampling is **not clamped**: every built-in extrapolates its own closed form
 * for `time < 0` and `time > duration`. A trajectory is a function, and clamping
 * would put a discontinuity in the velocity exactly at the ends — where path
 * followers, previews, and central-difference checks look. `duration` is
 * therefore *metadata* describing the natural extent of the path; consumers
 * that need to stop at the end (WP-2.5's path following) clamp their own
 * progress. {@link CatmullRomTrajectory} extrapolates the polynomial of its
 * first/last segment, which is the same rule applied to a piecewise curve.
 *
 * Trajectories with no intrinsic end derive a natural `duration` instead of
 * reporting `Infinity` where a sensible finite value exists: one revolution for
 * the circular and elliptical paths, the ballistic flight time for the
 * parabolic one, and the settling time for the damped spring. Each is stated
 * on its class, and the two open-ended ones accept an explicit `duration`
 * override.
 *
 * ## Allocation (§7b, plan D7)
 *
 * Every sampler takes an optional `out`. With `out` passed, sampling allocates
 * nothing — including {@link ParametricTrajectory}, whose finite differences use
 * per-instance scratch vectors. With `out` omitted a result vector is allocated,
 * which is the documented authoring convenience, not the engine path.
 * Constructors allocate (they copy their inputs, so a caller's vectors can never
 * be mutated out from under a path).
 *
 * ## Derivatives
 *
 * Analytic wherever a closed form exists — which is all eight built-ins. Only
 * {@link ParametricTrajectory}, whose position comes from a user callback, falls
 * back to central differences with `h = 1e-4` s:
 *
 * ```text
 * v(t) ≈ (p(t + h) − p(t − h)) / (2h)
 * a(t) ≈ (p(t + h) − 2p(t) + p(t − h)) / h²
 * ```
 *
 * `h = 1e-4` is close to the error-optimal step for the second-order formula in
 * double precision (`ε^(1/4) ≈ 1.2e-4`, balancing truncation against
 * cancellation) and gives roughly 1e-8 absolute error on the first derivative.
 */

import { Vector3 } from "@four/math";

/**
 * A position, velocity, and acceleration sampled from a path (§13).
 *
 * Implementations are pure: sampling never mutates the trajectory, and the same
 * `time` always yields the same result (§33).
 */
export interface Trajectory {
  /** Position at `time` seconds. Writes into `out` when given. */
  samplePosition(time: number, out?: Vector3): Vector3;
  /** First derivative of position at `time`, per second. Writes into `out` when given. */
  sampleVelocity(time: number, out?: Vector3): Vector3;
  /** Second derivative of position at `time`, per second squared. Writes into `out` when given. */
  sampleAcceleration(time: number, out?: Vector3): Vector3;
  /** Natural extent of the path in seconds. See the module note on extrapolation. */
  duration: number;
}

/** Finite-difference step for {@link ParametricTrajectory}, in seconds. */
export const CENTRAL_DIFFERENCE_STEP = 1e-4;

/**
 * Downward acceleration of the default ballistic trajectory, matching Appendix
 * A's 3D world gravity `(0, -9.81, 0)` m/s².
 */
export const DEFAULT_BALLISTIC_ACCELERATION_Y = -9.81;

/** Smallest knot spacing {@link CatmullRomTrajectory} will accept (coincident points). */
const MIN_KNOT_SPACING = 1e-8;

/** `out`, or a fresh vector when the caller did not supply one (plan D7). */
function resultVector(out: Vector3 | undefined): Vector3 {
  return out ?? new Vector3();
}

/** Throws unless `value` is a finite number strictly greater than zero. */
function assertPositiveDuration(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${what} must be a finite positive number of seconds (§7a); received ${String(value)}`,
    );
  }
}

/** Options for {@link LinearTrajectory}. */
export interface LinearTrajectoryOptions {
  /** Position at `time = 0`. Copied. */
  from: Vector3;
  /** Position at `time = duration`. Copied. */
  to: Vector3;
  /** Travel time in seconds; must be finite and positive. */
  duration: number;
}

/**
 * Straight line at constant speed (§13 "linear").
 *
 * ```text
 * p(t) = from + (to − from) · t / duration
 * v(t) = (to − from) / duration
 * a(t) = 0
 * ```
 */
export class LinearTrajectory implements Trajectory {
  /** Position at `time = 0`. */
  readonly from: Vector3;

  /** Position at `time = duration`. */
  readonly to: Vector3;

  readonly duration: number;

  /** Constant velocity, precomputed. */
  readonly #velocity: Vector3;

  constructor(options: LinearTrajectoryOptions) {
    assertPositiveDuration(options.duration, "LinearTrajectory duration");
    this.from = options.from.clone();
    this.to = options.to.clone();
    this.duration = options.duration;
    this.#velocity = new Vector3(
      (this.to.x - this.from.x) / this.duration,
      (this.to.y - this.from.y) / this.duration,
      (this.to.z - this.from.z) / this.duration,
    );
  }

  samplePosition(time: number, out?: Vector3): Vector3 {
    const v = this.#velocity;
    return resultVector(out).set(
      this.from.x + v.x * time,
      this.from.y + v.y * time,
      this.from.z + v.z * time,
    );
  }

  sampleVelocity(time: number, out?: Vector3): Vector3 {
    const v = this.#velocity;
    return resultVector(out).set(v.x, v.y, v.z);
  }

  sampleAcceleration(time: number, out?: Vector3): Vector3 {
    return resultVector(out).set(0, 0, 0);
  }
}

/** Options for {@link ParabolicTrajectory}. */
export interface ParabolicTrajectoryOptions {
  /** Position at `time = 0`. Copied. */
  from: Vector3;
  /** Velocity at `time = 0`, per second. Copied. */
  initialVelocity: Vector3;
  /** Constant acceleration, per second squared. Copied. */
  acceleration: Vector3;
  /**
   * Overrides the derived flight time. Optional; see
   * {@link ParabolicTrajectory.duration}.
   */
  duration?: number;
}

/**
 * Constant-acceleration flight (§13 "parabolic"; "ballistic" with gravity — see
 * {@link BallisticTrajectory}).
 *
 * ```text
 * p(t) = from + v₀ · t + ½ · a · t²
 * v(t) = v₀ + a · t
 * a(t) = a
 * ```
 */
export class ParabolicTrajectory implements Trajectory {
  /** Position at `time = 0`. */
  readonly from: Vector3;

  /** Velocity at `time = 0`. */
  readonly initialVelocity: Vector3;

  /** Constant acceleration. */
  readonly acceleration: Vector3;

  /**
   * Ballistic flight time: the time at which the path returns to the plane
   * through `from` perpendicular to `acceleration`, i.e.
   * `-2 · (v₀ · â) / |a|`.
   *
   * For the usual case — launched upward under gravity — this is the familiar
   * `2 · v₀ᵧ / 9.81`, and `duration / 2` is the apex. It is `Infinity` when the
   * path never returns (zero acceleration, or an initial velocity with no
   * component opposing the acceleration), because there is no other honest
   * answer; pass `duration` explicitly for a fixed preview window.
   */
  readonly duration: number;

  constructor(options: ParabolicTrajectoryOptions) {
    this.from = options.from.clone();
    this.initialVelocity = options.initialVelocity.clone();
    this.acceleration = options.acceleration.clone();
    if (options.duration === undefined) {
      this.duration = flightTime(this.initialVelocity, this.acceleration);
    } else {
      assertPositiveDuration(options.duration, "ParabolicTrajectory duration");
      this.duration = options.duration;
    }
  }

  samplePosition(time: number, out?: Vector3): Vector3 {
    const p = this.from;
    const v = this.initialVelocity;
    const a = this.acceleration;
    const halfTimeSquared = 0.5 * time * time;
    return resultVector(out).set(
      p.x + v.x * time + a.x * halfTimeSquared,
      p.y + v.y * time + a.y * halfTimeSquared,
      p.z + v.z * time + a.z * halfTimeSquared,
    );
  }

  sampleVelocity(time: number, out?: Vector3): Vector3 {
    const v = this.initialVelocity;
    const a = this.acceleration;
    return resultVector(out).set(
      v.x + a.x * time,
      v.y + a.y * time,
      v.z + a.z * time,
    );
  }

  sampleAcceleration(time: number, out?: Vector3): Vector3 {
    const a = this.acceleration;
    return resultVector(out).set(a.x, a.y, a.z);
  }
}

/** Time at which `v₀ · t + ½ · a · t²` returns to zero along `a`, or `Infinity`. */
function flightTime(initialVelocity: Vector3, acceleration: Vector3): number {
  const magnitude = acceleration.length();
  if (magnitude === 0) {
    return Number.POSITIVE_INFINITY;
  }
  // Component of v₀ along the acceleration direction.
  const along =
    (initialVelocity.x * acceleration.x +
      initialVelocity.y * acceleration.y +
      initialVelocity.z * acceleration.z) /
    magnitude;
  const time = (-2 * along) / magnitude;
  return time > 0 ? time : Number.POSITIVE_INFINITY;
}

/** Options for {@link BallisticTrajectory}. */
export interface BallisticTrajectoryOptions {
  /** Launch position. Copied. */
  from: Vector3;
  /** Launch velocity, per second. Copied. */
  initialVelocity: Vector3;
  /**
   * Constant acceleration. Defaults to gravity,
   * `(0, {@link DEFAULT_BALLISTIC_ACCELERATION_Y}, 0)` (Appendix A).
   */
  acceleration?: Vector3;
  /** Overrides the derived flight time. Optional. */
  duration?: number;
}

/**
 * §13's "ballistic" trajectory: {@link ParabolicTrajectory} with `acceleration`
 * defaulted to gravity `(0, -9.81, 0)` (Appendix A, Y-up per §7a). Everything
 * else — sampling, extrapolation, the derived flight-time `duration` — is
 * inherited unchanged.
 */
export class BallisticTrajectory extends ParabolicTrajectory {
  constructor(options: BallisticTrajectoryOptions) {
    super({
      from: options.from,
      initialVelocity: options.initialVelocity,
      acceleration:
        options.acceleration ??
        new Vector3(0, DEFAULT_BALLISTIC_ACCELERATION_Y, 0),
      duration: options.duration,
    });
  }
}

/** Options for {@link CircularTrajectory}. */
export interface CircularTrajectoryOptions {
  /** Centre of the circle. Copied. */
  center: Vector3;
  /** Radius in world units. */
  radius: number;
  /** Sweep rate in radians per second; negative sweeps clockwise. */
  angularVelocity: number;
  /** Angle at `time = 0`, in radians. Default `0` (the +X point). */
  phase?: number;
}

/**
 * Circle in the **XY plane** (§7a: Y-up in 2D as well as 3D), swept at a
 * constant rate.
 *
 * ```text
 * θ(t) = phase + angularVelocity · t
 * p(t) = center + (r·cos θ, r·sin θ, 0)
 * v(t) = r·ω · (−sin θ, cos θ, 0)
 * a(t) = −r·ω² · (cos θ, sin θ, 0)          // centripetal, toward the centre
 * ```
 *
 * `duration` is one revolution, `2π / |ω|`, so `duration / 2` is the
 * diametrically opposite point. With `ω = 0` the path is a fixed point and
 * `duration` is `Infinity`.
 */
export class CircularTrajectory implements Trajectory {
  /** Centre of the circle. */
  readonly center: Vector3;

  readonly radius: number;

  /** Sweep rate in radians per second. */
  readonly angularVelocity: number;

  /** Angle at `time = 0`, in radians. */
  readonly phase: number;

  /** One revolution in seconds, or `Infinity` when `angularVelocity` is 0. */
  readonly duration: number;

  constructor(options: CircularTrajectoryOptions) {
    this.center = options.center.clone();
    this.radius = options.radius;
    this.angularVelocity = options.angularVelocity;
    this.phase = options.phase ?? 0;
    this.duration = revolutionTime(this.angularVelocity);
  }

  samplePosition(time: number, out?: Vector3): Vector3 {
    const angle = this.phase + this.angularVelocity * time;
    const c = this.center;
    return resultVector(out).set(
      c.x + this.radius * Math.cos(angle),
      c.y + this.radius * Math.sin(angle),
      c.z,
    );
  }

  sampleVelocity(time: number, out?: Vector3): Vector3 {
    const angle = this.phase + this.angularVelocity * time;
    const speed = this.radius * this.angularVelocity;
    return resultVector(out).set(
      -speed * Math.sin(angle),
      speed * Math.cos(angle),
      0,
    );
  }

  sampleAcceleration(time: number, out?: Vector3): Vector3 {
    const angle = this.phase + this.angularVelocity * time;
    const magnitude =
      -this.radius * this.angularVelocity * this.angularVelocity;
    return resultVector(out).set(
      magnitude * Math.cos(angle),
      magnitude * Math.sin(angle),
      0,
    );
  }
}

/** Options for {@link EllipticalTrajectory}. */
export interface EllipticalTrajectoryOptions {
  /** Centre of the ellipse. Copied. */
  center: Vector3;
  /** Semi-axis along X. */
  radiusX: number;
  /** Semi-axis along Y. */
  radiusY: number;
  /** Sweep rate of the parameter angle in radians per second. */
  angularVelocity: number;
  /** Parameter angle at `time = 0`, in radians. Default `0`. */
  phase?: number;
}

/**
 * Axis-aligned ellipse in the XY plane, swept at a constant *parameter* rate
 * (not constant arc speed).
 *
 * ```text
 * θ(t) = phase + angularVelocity · t
 * p(t) = center + (rx·cos θ, ry·sin θ, 0)
 * v(t) = ω · (−rx·sin θ, ry·cos θ, 0)
 * a(t) = −ω² · (rx·cos θ, ry·sin θ, 0)
 * ```
 *
 * `duration` is one revolution of the parameter, `2π / |ω|`.
 */
export class EllipticalTrajectory implements Trajectory {
  /** Centre of the ellipse. */
  readonly center: Vector3;

  readonly radiusX: number;

  readonly radiusY: number;

  /** Parameter sweep rate in radians per second. */
  readonly angularVelocity: number;

  /** Parameter angle at `time = 0`, in radians. */
  readonly phase: number;

  /** One revolution in seconds, or `Infinity` when `angularVelocity` is 0. */
  readonly duration: number;

  constructor(options: EllipticalTrajectoryOptions) {
    this.center = options.center.clone();
    this.radiusX = options.radiusX;
    this.radiusY = options.radiusY;
    this.angularVelocity = options.angularVelocity;
    this.phase = options.phase ?? 0;
    this.duration = revolutionTime(this.angularVelocity);
  }

  samplePosition(time: number, out?: Vector3): Vector3 {
    const angle = this.phase + this.angularVelocity * time;
    const c = this.center;
    return resultVector(out).set(
      c.x + this.radiusX * Math.cos(angle),
      c.y + this.radiusY * Math.sin(angle),
      c.z,
    );
  }

  sampleVelocity(time: number, out?: Vector3): Vector3 {
    const angle = this.phase + this.angularVelocity * time;
    const w = this.angularVelocity;
    return resultVector(out).set(
      -this.radiusX * w * Math.sin(angle),
      this.radiusY * w * Math.cos(angle),
      0,
    );
  }

  sampleAcceleration(time: number, out?: Vector3): Vector3 {
    const angle = this.phase + this.angularVelocity * time;
    const wSquared = this.angularVelocity * this.angularVelocity;
    return resultVector(out).set(
      -this.radiusX * wSquared * Math.cos(angle),
      -this.radiusY * wSquared * Math.sin(angle),
      0,
    );
  }
}

/** One revolution in seconds, or `Infinity` for a zero sweep rate. */
function revolutionTime(angularVelocity: number): number {
  const magnitude = Math.abs(angularVelocity);
  return magnitude > 0 ? (2 * Math.PI) / magnitude : Number.POSITIVE_INFINITY;
}

/** Options for {@link CubicBezierTrajectory}. */
export interface CubicBezierTrajectoryOptions {
  /** Start point, reached at `time = 0`. Copied. */
  p0: Vector3;
  /** First control point. Copied. */
  p1: Vector3;
  /** Second control point. Copied. */
  p2: Vector3;
  /** End point, reached at `time = duration`. Copied. */
  p3: Vector3;
  /** Travel time in seconds; must be finite and positive. */
  duration: number;
}

/**
 * Cubic Bézier curve (§13 "Bézier"), traversed with the parameter advancing
 * linearly in time (`u = t / duration`).
 *
 * ```text
 * B(u)   = (1−u)³·p0 + 3(1−u)²u·p1 + 3(1−u)u²·p2 + u³·p3
 * B'(u)  = 3(1−u)²(p1−p0) + 6(1−u)u(p2−p1) + 3u²(p3−p2)
 * B''(u) = 6(1−u)(p2−2p1+p0) + 6u(p3−2p2+p1)
 * ```
 *
 * Velocity is `B'(u) / duration` and acceleration `B''(u) / duration²` by the
 * chain rule. The parameter is uniform, not arc length, so the speed along the
 * curve varies with the control-point spacing.
 */
export class CubicBezierTrajectory implements Trajectory {
  readonly p0: Vector3;

  readonly p1: Vector3;

  readonly p2: Vector3;

  readonly p3: Vector3;

  readonly duration: number;

  constructor(options: CubicBezierTrajectoryOptions) {
    assertPositiveDuration(options.duration, "CubicBezierTrajectory duration");
    this.p0 = options.p0.clone();
    this.p1 = options.p1.clone();
    this.p2 = options.p2.clone();
    this.p3 = options.p3.clone();
    this.duration = options.duration;
  }

  samplePosition(time: number, out?: Vector3): Vector3 {
    const u = time / this.duration;
    const v = 1 - u;
    const b0 = v * v * v;
    const b1 = 3 * v * v * u;
    const b2 = 3 * v * u * u;
    const b3 = u * u * u;
    return resultVector(out).set(
      b0 * this.p0.x + b1 * this.p1.x + b2 * this.p2.x + b3 * this.p3.x,
      b0 * this.p0.y + b1 * this.p1.y + b2 * this.p2.y + b3 * this.p3.y,
      b0 * this.p0.z + b1 * this.p1.z + b2 * this.p2.z + b3 * this.p3.z,
    );
  }

  sampleVelocity(time: number, out?: Vector3): Vector3 {
    const u = time / this.duration;
    const v = 1 - u;
    const c0 = (3 * v * v) / this.duration;
    const c1 = (6 * v * u) / this.duration;
    const c2 = (3 * u * u) / this.duration;
    return resultVector(out).set(
      c0 * (this.p1.x - this.p0.x) +
        c1 * (this.p2.x - this.p1.x) +
        c2 * (this.p3.x - this.p2.x),
      c0 * (this.p1.y - this.p0.y) +
        c1 * (this.p2.y - this.p1.y) +
        c2 * (this.p3.y - this.p2.y),
      c0 * (this.p1.z - this.p0.z) +
        c1 * (this.p2.z - this.p1.z) +
        c2 * (this.p3.z - this.p2.z),
    );
  }

  sampleAcceleration(time: number, out?: Vector3): Vector3 {
    const u = time / this.duration;
    const v = 1 - u;
    const scale = 6 / (this.duration * this.duration);
    const c0 = scale * v;
    const c1 = scale * u;
    return resultVector(out).set(
      c0 * (this.p2.x - 2 * this.p1.x + this.p0.x) +
        c1 * (this.p3.x - 2 * this.p2.x + this.p1.x),
      c0 * (this.p2.y - 2 * this.p1.y + this.p0.y) +
        c1 * (this.p3.y - 2 * this.p2.y + this.p1.y),
      c0 * (this.p2.z - 2 * this.p1.z + this.p0.z) +
        c1 * (this.p3.z - 2 * this.p2.z + this.p1.z),
    );
  }
}

/** Options for {@link CatmullRomTrajectory}. */
export interface CatmullRomTrajectoryOptions {
  /** At least two waypoints, in order. Each is copied. */
  points: readonly Vector3[];
  /** Travel time for the whole spline in seconds; must be finite and positive. */
  duration: number;
  /**
   * Knot parameterization exponent: `0` uniform, `0.5` centripetal (the
   * default, §13's spline of choice), `1` chordal.
   */
  alpha?: number;
}

/**
 * Catmull-Rom spline through every waypoint (§13 "Catmull-Rom spline"), with
 * **centripetal** knot parameterization by default (`alpha = 0.5`).
 *
 * Centripetal parameterization is the default because it is the variant that
 * provably produces no cusps and no self-intersections within a segment, which
 * is what makes a waypoint path safe to hand to a camera or a robot. `alpha = 0`
 * gives the classic uniform spline (which can loop near sharp turns) and
 * `alpha = 1` the chordal one.
 *
 * ## Construction
 *
 * Knots are cumulative chord lengths raised to `alpha`
 * (`k[i+1] = k[i] + |p[i+1] − p[i]|^alpha`, floored at 1e-8 so coincident
 * waypoints cannot divide by zero). The two end conditions are **reflected**
 * virtual points — `2·p₀ − p₁` before the start and `2·pₙ₋₁ − pₙ₋₂` after the
 * end — rather than duplicated endpoints, which would produce a zero knot
 * spacing in exactly the formula that divides by it. With two waypoints the
 * reflection makes the spline the straight line between them at constant speed.
 *
 * Each segment is the non-uniform cubic Hermite whose tangents are the
 * Catmull-Rom finite differences
 *
 * ```text
 * m₁ = (t₂−t₁)·((p₁−p₀)/(t₁−t₀) − (p₂−p₀)/(t₂−t₀) + (p₂−p₁)/(t₂−t₁))
 * m₂ = (t₂−t₁)·((p₂−p₁)/(t₂−t₁) − (p₃−p₁)/(t₃−t₁) + (p₃−p₂)/(t₃−t₂))
 * ```
 *
 * ## Time mapping
 *
 * `time` maps affinely onto the knot span: `s(t) = k₀ + (t / duration)·span`.
 * Each segment therefore gets a share of `duration` proportional to its knot
 * length, so with `alpha = 1` the traversal is close to constant speed and with
 * the default `alpha = 0.5` it slows through tight turns. Because the mapping is
 * affine, velocity and acceleration are exact: no derivative-of-the-mapping term
 * appears.
 *
 * Sampling outside `[0, duration]` extrapolates the first or last segment's
 * cubic (see the module note).
 */
export class CatmullRomTrajectory implements Trajectory {
  /** The waypoints, copied. */
  readonly points: readonly Vector3[];

  readonly duration: number;

  /** Knot exponent: 0 uniform, 0.5 centripetal, 1 chordal. */
  readonly alpha: number;

  /** Waypoints with the two reflected virtual end points, indices 0…n+1. */
  readonly #extended: readonly Vector3[];

  /** Knot value per entry of {@link CatmullRomTrajectory.#extended}. */
  readonly #knots: readonly number[];

  /** `#knots[n] − #knots[1]`: the span covered by the real waypoints. */
  readonly #span: number;

  constructor(options: CatmullRomTrajectoryOptions) {
    if (options.points.length < 2) {
      throw new RangeError(
        `CatmullRomTrajectory needs at least two points; received ${String(options.points.length)}`,
      );
    }
    assertPositiveDuration(options.duration, "CatmullRomTrajectory duration");
    const alpha = options.alpha ?? 0.5;
    if (!Number.isFinite(alpha) || alpha < 0) {
      throw new RangeError(
        `CatmullRomTrajectory alpha must be a finite number >= 0; received ${String(alpha)}`,
      );
    }

    const points = options.points.map((p) => p.clone());
    const last = points.length - 1;
    const extended: Vector3[] = [
      reflect(points[0], points[1]),
      ...points,
      reflect(points[last], points[last - 1]),
    ];
    const knots: number[] = [0];
    for (let i = 1; i < extended.length; i += 1) {
      knots.push(
        knots[i - 1] + knotSpacing(extended[i - 1], extended[i], alpha),
      );
    }

    this.points = points;
    this.duration = options.duration;
    this.alpha = alpha;
    this.#extended = extended;
    this.#knots = knots;
    this.#span = knots[knots.length - 2] - knots[1];
  }

  samplePosition(time: number, out?: Vector3): Vector3 {
    return this.#sample(time, 0, resultVector(out));
  }

  sampleVelocity(time: number, out?: Vector3): Vector3 {
    return this.#sample(time, 1, resultVector(out));
  }

  sampleAcceleration(time: number, out?: Vector3): Vector3 {
    return this.#sample(time, 2, resultVector(out));
  }

  /**
   * Evaluates the `derivative`-th derivative (0, 1, or 2) at `time` into `out`.
   *
   * One routine for all three because segment lookup, the Hermite basis, and
   * the tangents are shared; only the basis polynomials and the chain-rule
   * factor differ.
   */
  #sample(time: number, derivative: number, out: Vector3): Vector3 {
    const knots = this.#knots;
    const extended = this.#extended;
    const s = knots[1] + (time / this.duration) * this.#span;

    // Segment j spans extended[j] → extended[j+1]; clamp so out-of-range times
    // extrapolate the end segments (module note).
    const lastSegment = extended.length - 3;
    let j = 1;
    while (j < lastSegment && s >= knots[j + 1]) {
      j += 1;
    }

    const t0 = knots[j - 1];
    const t1 = knots[j];
    const t2 = knots[j + 1];
    const t3 = knots[j + 2];
    const p0 = extended[j - 1];
    const p1 = extended[j];
    const p2 = extended[j + 1];
    const p3 = extended[j + 2];

    const segment = t2 - t1;
    const u = (s - t1) / segment;
    // Hermite tangents in `u`: the Catmull-Rom finite differences at p1 and p2,
    // each scaled by this segment's knot span.
    const m1x = segment * tangent(p0.x, p1.x, p2.x, t0, t1, t2);
    const m1y = segment * tangent(p0.y, p1.y, p2.y, t0, t1, t2);
    const m1z = segment * tangent(p0.z, p1.z, p2.z, t0, t1, t2);
    const m2x = segment * tangent(p1.x, p2.x, p3.x, t1, t2, t3);
    const m2y = segment * tangent(p1.y, p2.y, p3.y, t1, t2, t3);
    const m2z = segment * tangent(p1.z, p2.z, p3.z, t1, t2, t3);
    // ds/dt is constant (affine map); du/ds = 1 / segment.
    const scale = this.#span / (this.duration * segment);
    const factor =
      derivative === 0 ? 1 : derivative === 1 ? scale : scale * scale;

    let h00: number;
    let h10: number;
    let h01: number;
    let h11: number;
    if (derivative === 0) {
      h00 = 2 * u * u * u - 3 * u * u + 1;
      h10 = u * u * u - 2 * u * u + u;
      h01 = -2 * u * u * u + 3 * u * u;
      h11 = u * u * u - u * u;
    } else if (derivative === 1) {
      h00 = 6 * u * u - 6 * u;
      h10 = 3 * u * u - 4 * u + 1;
      h01 = -6 * u * u + 6 * u;
      h11 = 3 * u * u - 2 * u;
    } else {
      h00 = 12 * u - 6;
      h10 = 6 * u - 4;
      h01 = -12 * u + 6;
      h11 = 6 * u - 2;
    }

    return out.set(
      factor * (h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x),
      factor * (h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y),
      factor * (h00 * p1.z + h10 * m1z + h01 * p2.z + h11 * m2z),
    );
  }
}

/** The point `b` mirrored through `a`, used as a virtual spline end point. */
function reflect(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(2 * a.x - b.x, 2 * a.y - b.y, 2 * a.z - b.z);
}

/** `|b − a|^alpha`, floored so coincident points cannot collapse a knot span. */
function knotSpacing(a: Vector3, b: Vector3, alpha: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.max(distance ** alpha, MIN_KNOT_SPACING);
}

/**
 * One component of the non-uniform Catmull-Rom tangent **at the middle point**,
 * as a derivative with respect to the knot parameter:
 *
 * ```text
 * d(p) = (p − pPrev)/(t − tPrev) − (pNext − pPrev)/(tNext − tPrev)
 *      + (pNext − p)/(tNext − t)
 * ```
 *
 * The caller scales it by the segment's knot span to turn it into a Hermite
 * tangent in `u`. Called once per segment end: `(p0, p1, p2)` for the tangent at
 * `p1`, `(p1, p2, p3)` for the one at `p2`.
 */
function tangent(
  previous: number,
  current: number,
  next: number,
  previousKnot: number,
  knot: number,
  nextKnot: number,
): number {
  return (
    (current - previous) / (knot - previousKnot) -
    (next - previous) / (nextKnot - previousKnot) +
    (next - current) / (nextKnot - knot)
  );
}

/** Options for {@link DampedSpringTrajectory}. */
export interface DampedSpringTrajectoryOptions {
  /** Position at `time = 0`, released from rest. Copied. */
  from: Vector3;
  /** Rest position the spring settles to. Copied. */
  to: Vector3;
  /** Undamped natural frequency in hertz; must be finite and positive. */
  frequencyHz: number;
  /** Damping ratio: `< 1` oscillates, `1` critical, `> 1` overdamped. `>= 0`. */
  dampingRatio: number;
  /** Overrides the derived settling time. Optional. */
  duration?: number;
}

/**
 * Damped harmonic motion from `from` to `to` (§13 "damped spring"), released
 * from rest.
 *
 * The closed form of `x'' + 2ζωₙ·x' + ωₙ²·(x − to) = 0` with `x(0) = from` and
 * `x'(0) = 0`, where `ωₙ = 2π·frequencyHz` and `ζ = dampingRatio`. Writing
 * `d = from − to`:
 *
 * ```text
 * ζ < 1   x = to + d·e^(−σt)·(cos ω_d t + (σ/ω_d)·sin ω_d t)
 *         v = −d·(ωₙ²/ω_d)·e^(−σt)·sin ω_d t          σ = ζωₙ, ω_d = ωₙ√(1−ζ²)
 * ζ = 1   x = to + d·e^(−ωₙt)·(1 + ωₙt)
 *         v = −d·ωₙ²·t·e^(−ωₙt)
 * ζ > 1   x = to + c₁·e^(r₁t) + c₂·e^(r₂t)             r = −ωₙ(ζ ∓ √(ζ²−1))
 *         v = c₁r₁·e^(r₁t) + c₂r₂·e^(r₂t)
 * ```
 *
 * Acceleration is taken from the differential equation itself,
 * `a = −2ζωₙ·v − ωₙ²·(x − to)`, which is exact in every regime and needs no
 * third set of coefficients.
 *
 * All three components share one scalar envelope: this is a spring pulling a
 * point along the straight line `from → to`, not three independent springs (they
 * would be identical anyway, since all three have the same frequency and start
 * at rest).
 *
 * `duration` is the settling time: four time constants of the slowest decay
 * (`4/σ`, with `σ = ζωₙ` when underdamped and the slower pole's rate when
 * over- or critically damped) — the point past which the remaining motion is
 * invisible. It is `Infinity` for an undamped spring (`ζ = 0`), which never
 * settles.
 */
export class DampedSpringTrajectory implements Trajectory {
  /** Position at `time = 0`. */
  readonly from: Vector3;

  /** Rest position. */
  readonly to: Vector3;

  /** Undamped natural frequency in hertz. */
  readonly frequencyHz: number;

  /** Damping ratio. */
  readonly dampingRatio: number;

  /** Settling time in seconds (four time constants), or `Infinity` when undamped. */
  readonly duration: number;

  /** Undamped natural frequency in radians per second. */
  readonly #omega: number;

  /** Damped frequency `ω_d`, or 0 when not underdamped. */
  readonly #dampedOmega: number;

  /** Slow pole `r₁` (overdamped only). */
  readonly #rate1: number;

  /** Fast pole `r₂` (overdamped only). */
  readonly #rate2: number;

  constructor(options: DampedSpringTrajectoryOptions) {
    if (!Number.isFinite(options.frequencyHz) || options.frequencyHz <= 0) {
      throw new RangeError(
        `DampedSpringTrajectory frequencyHz must be a finite positive number; received ${String(options.frequencyHz)}`,
      );
    }
    if (!Number.isFinite(options.dampingRatio) || options.dampingRatio < 0) {
      throw new RangeError(
        `DampedSpringTrajectory dampingRatio must be a finite number >= 0; received ${String(options.dampingRatio)}`,
      );
    }
    this.from = options.from.clone();
    this.to = options.to.clone();
    this.frequencyHz = options.frequencyHz;
    this.dampingRatio = options.dampingRatio;

    const omega = 2 * Math.PI * options.frequencyHz;
    const zeta = options.dampingRatio;
    this.#omega = omega;
    this.#dampedOmega = zeta < 1 ? omega * Math.sqrt(1 - zeta * zeta) : 0;
    if (zeta > 1) {
      const root = omega * Math.sqrt(zeta * zeta - 1);
      this.#rate1 = -omega * zeta + root; // slower decay
      this.#rate2 = -omega * zeta - root; // faster decay
    } else {
      this.#rate1 = 0;
      this.#rate2 = 0;
    }

    if (options.duration === undefined) {
      const decay = zeta > 1 ? -this.#rate1 : zeta * omega;
      this.duration = decay > 0 ? 4 / decay : Number.POSITIVE_INFINITY;
    } else {
      assertPositiveDuration(
        options.duration,
        "DampedSpringTrajectory duration",
      );
      this.duration = options.duration;
    }
  }

  samplePosition(time: number, out?: Vector3): Vector3 {
    const envelope = this.#envelope(time);
    return resultVector(out).set(
      this.to.x + (this.from.x - this.to.x) * envelope,
      this.to.y + (this.from.y - this.to.y) * envelope,
      this.to.z + (this.from.z - this.to.z) * envelope,
    );
  }

  sampleVelocity(time: number, out?: Vector3): Vector3 {
    const rate = this.#envelopeRate(time);
    return resultVector(out).set(
      (this.from.x - this.to.x) * rate,
      (this.from.y - this.to.y) * rate,
      (this.from.z - this.to.z) * rate,
    );
  }

  sampleAcceleration(time: number, out?: Vector3): Vector3 {
    // Straight from the differential equation: a = −2ζωₙ·v − ωₙ²·(x − to).
    const envelope = this.#envelope(time);
    const rate = this.#envelopeRate(time);
    const damping = 2 * this.dampingRatio * this.#omega;
    const stiffness = this.#omega * this.#omega;
    const factor = -damping * rate - stiffness * envelope;
    return resultVector(out).set(
      (this.from.x - this.to.x) * factor,
      (this.from.y - this.to.y) * factor,
      (this.from.z - this.to.z) * factor,
    );
  }

  /** Fraction of the initial displacement remaining at `time`; 1 at `t = 0`. */
  #envelope(time: number): number {
    const zeta = this.dampingRatio;
    const omega = this.#omega;
    if (zeta < 1) {
      const sigma = zeta * omega;
      const wd = this.#dampedOmega;
      return (
        Math.exp(-sigma * time) *
        (Math.cos(wd * time) + (sigma / wd) * Math.sin(wd * time))
      );
    }
    if (zeta === 1) {
      return Math.exp(-omega * time) * (1 + omega * time);
    }
    const r1 = this.#rate1;
    const r2 = this.#rate2;
    const c1 = r2 / (r2 - r1);
    const c2 = -r1 / (r2 - r1);
    return c1 * Math.exp(r1 * time) + c2 * Math.exp(r2 * time);
  }

  /** Time derivative of {@link DampedSpringTrajectory.#envelope}; 0 at `t = 0`. */
  #envelopeRate(time: number): number {
    const zeta = this.dampingRatio;
    const omega = this.#omega;
    if (zeta < 1) {
      const sigma = zeta * omega;
      const wd = this.#dampedOmega;
      return (
        (-omega * omega * Math.exp(-sigma * time) * Math.sin(wd * time)) / wd
      );
    }
    if (zeta === 1) {
      return -omega * omega * time * Math.exp(-omega * time);
    }
    const r1 = this.#rate1;
    const r2 = this.#rate2;
    const c1 = r2 / (r2 - r1);
    const c2 = -r1 / (r2 - r1);
    return c1 * r1 * Math.exp(r1 * time) + c2 * r2 * Math.exp(r2 * time);
  }
}

/** Options for {@link ParametricTrajectory}. */
export interface ParametricTrajectoryOptions {
  /**
   * Position at `time` seconds, written into `out` and returned. Must be pure —
   * the same `time` must always produce the same point (§33) — and must not
   * capture a wall clock.
   */
  position: (time: number, out: Vector3) => Vector3;
  /** Natural extent of the path in seconds; must be finite and positive. */
  duration: number;
}

/**
 * §13's "custom parametric trajectory": any position function of time.
 *
 * ```ts
 * new ParametricTrajectory({
 *   duration: 4,
 *   position: (t, out) => out.set(Math.cos(t), Math.sin(t), t * 0.1),
 * });
 * ```
 *
 * Velocity and acceleration are central differences with
 * `h = {@link CENTRAL_DIFFERENCE_STEP}` (see the module note on why that value).
 * The callback is invoked twice per velocity sample and three times per
 * acceleration sample.
 *
 * The three scratch vectors are per instance, so sampling allocates nothing when
 * `out` is passed — provided the callback does not allocate either. Each
 * callback result is copied into scratch before the next call, so a callback
 * that ignores `out` and returns its own vector still produces correct
 * differences.
 */
export class ParametricTrajectory implements Trajectory {
  readonly duration: number;

  readonly #position: (time: number, out: Vector3) => Vector3;

  readonly #before = new Vector3();

  readonly #center = new Vector3();

  readonly #after = new Vector3();

  constructor(options: ParametricTrajectoryOptions) {
    assertPositiveDuration(options.duration, "ParametricTrajectory duration");
    this.#position = options.position;
    this.duration = options.duration;
  }

  samplePosition(time: number, out?: Vector3): Vector3 {
    return this.#position(time, resultVector(out));
  }

  sampleVelocity(time: number, out?: Vector3): Vector3 {
    const h = CENTRAL_DIFFERENCE_STEP;
    const after = this.#evaluate(time + h, this.#after);
    const before = this.#evaluate(time - h, this.#before);
    const scale = 1 / (2 * h);
    return resultVector(out).set(
      (after.x - before.x) * scale,
      (after.y - before.y) * scale,
      (after.z - before.z) * scale,
    );
  }

  sampleAcceleration(time: number, out?: Vector3): Vector3 {
    const h = CENTRAL_DIFFERENCE_STEP;
    const after = this.#evaluate(time + h, this.#after);
    const center = this.#evaluate(time, this.#center);
    const before = this.#evaluate(time - h, this.#before);
    const scale = 1 / (h * h);
    return resultVector(out).set(
      (after.x - 2 * center.x + before.x) * scale,
      (after.y - 2 * center.y + before.y) * scale,
      (after.z - 2 * center.z + before.z) * scale,
    );
  }

  /** Samples the callback into `store`, tolerating a callback that ignores `out`. */
  #evaluate(time: number, store: Vector3): Vector3 {
    const result = this.#position(time, store);
    return result === store ? store : store.copy(result);
  }
}
