import { noteConstruction } from "./alloc-counter.js";
import type { Vector3 } from "./vector3.js";

/**
 * Above this dot product the two ends of a {@link Quaternion.slerp} are treated
 * as nearly parallel and normalized linear interpolation (nlerp) is used
 * instead of the trigonometric form.
 *
 * Rationale: the spherical form divides by `sin(theta)`, which goes to zero as
 * the inputs converge, so the quotient loses precision and finally becomes
 * `0 / 0`. At `dot = 0.9995` the half-angle between the quaternions is about
 * 1.8 degrees (a 3.6 degree rotation difference); across an arc that small the
 * nlerp path deviates from the true constant-speed arc by well under 1e-4
 * radians, which is far below any tolerance the engine cares about, while
 * remaining numerically stable all the way to `dot = 1`.
 */
const SLERP_LINEAR_THRESHOLD = 0.9995;

/**
 * Mutable unit quaternion `(x, y, z, w)` representing a 3D rotation (§7b). The
 * world is right-handed with +Y up (§7a) and **every angle is radians**;
 * quaternions compose with the Hamilton product, so `a.multiply(b)` yields the
 * rotation that applies `b` first and `a` second.
 *
 * The identity rotation is `(0, 0, 0, 1)` — hence `w` defaults to 1 while the
 * vector part defaults to 0.
 *
 * Allocation policy (§7b, plan D7): mutating methods mutate in place and return
 * `this`; only {@link Quaternion.clone} allocates. {@link Quaternion.rotateVector3}
 * produces a result that is *not* `this`, so it takes a required `out`
 * parameter and returns it — nothing on that path allocates either.
 *
 * Change notification (plan D3): every mutator invokes {@link Quaternion.onChanged}
 * exactly once, after the last component is written. Direct field writes
 * (`q.x = 1`) bypass the hook by design.
 *
 * Methods assume unit quaternions where the mathematics requires it
 * ({@link Quaternion.conjugate} as inverse, {@link Quaternion.rotateVector3},
 * {@link Quaternion.slerp}); nothing normalizes defensively on those hot paths.
 */
export class Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;

  /**
   * Optional change hook invoked at the end of every mutator. Engine-internal:
   * owners install it, user code normally leaves it unset. It is intentionally
   * *not* copied by {@link Quaternion.copy} or {@link Quaternion.clone}.
   */
  onChanged?: () => void;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    noteConstruction();
  }

  /** Sets all four components. */
  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    this.onChanged?.();
    return this;
  }

  /** Copies the components of `q` into this quaternion. The change hook is not copied. */
  copy(q: Quaternion): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new quaternion with the same components. The clone has no
   * change hook. This is the only allocating method on the type (§7b).
   */
  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  /** Resets this quaternion to the identity rotation `(0, 0, 0, 1)`. */
  identity(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;
    this.onChanged?.();
    return this;
  }

  /**
   * Sets this quaternion to the rotation of `angleRadians` about `axis`,
   * counter-clockwise when looking down the axis toward the origin
   * (right-handed, §7a). Angles are radians (§7a) — there is no degree overload.
   *
   * `axis` need not be unit length: it is normalized from plain scalars, with
   * no temporary vector. A zero-length axis has no direction to rotate about,
   * so it produces the identity rotation rather than `NaN` (defined here; the
   * same "no-op beats poisoning the frame" reasoning as `Vector3.normalize`).
   * The change hook fires in either case.
   */
  setFromAxisAngle(axis: Vector3, angleRadians: number): this {
    const lengthSquared = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      const halfAngle = angleRadians * 0.5;
      const sinHalf = Math.sin(halfAngle);
      this.x = axis.x * inverseLength * sinHalf;
      this.y = axis.y * inverseLength * sinHalf;
      this.z = axis.z * inverseLength * sinHalf;
      this.w = Math.cos(halfAngle);
    } else {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Hamilton product `this = this * q`: the resulting rotation applies `q`
   * first and this quaternion second. Aliasing-safe — `q` may be `this`.
   */
  multiply(q: Quaternion): this {
    const { x: ax, y: ay, z: az, w: aw } = this;
    const bx = q.x;
    const by = q.y;
    const bz = q.z;
    const bw = q.w;
    this.x = aw * bx + ax * bw + ay * bz - az * by;
    this.y = aw * by - ax * bz + ay * bw + az * bx;
    this.z = aw * bz + ax * by - ay * bx + az * bw;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    this.onChanged?.();
    return this;
  }

  /**
   * Negates the vector part, giving the conjugate. For a **unit** quaternion
   * this is the inverse rotation; for a non-unit quaternion it is not (the
   * inverse would also divide by the squared length).
   */
  conjugate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this.onChanged?.();
    return this;
  }

  /**
   * Scales this quaternion to unit length.
   *
   * Zero-length behaviour (defined here): a zero-length quaternion is not a
   * rotation at all and cannot be scaled into one, so it is reset to the
   * identity rather than producing `NaN`. This differs from `Vector3.normalize`,
   * which leaves the zero vector alone — the zero *vector* is a legitimate
   * value downstream, the zero *quaternion* never is. The change hook fires in
   * either case.
   */
  normalize(): this {
    const lengthSquared =
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      this.x *= inverseLength;
      this.y *= inverseLength;
      this.z *= inverseLength;
      this.w *= inverseLength;
    } else {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Spherically interpolates this quaternion toward `target` by `t`, mutating
   * this quaternion. `t = 0` leaves it unchanged, `t = 1` makes it equal to
   * `target` (up to sign — see below). Values outside `[0, 1]` extrapolate
   * along the same arc; no clamping is applied. Both inputs are assumed unit
   * length.
   *
   * Shortest arc (plan D8): `q` and `-q` denote the same rotation, so when the
   * dot product is negative the *target's* components are negated for the
   * interpolation. The result then travels the short way round, and at `t = 1`
   * equals `-target` — the same rotation as `target`, with opposite components.
   *
   * Nearly parallel inputs (dot above {@link SLERP_LINEAR_THRESHOLD}, 0.9995)
   * fall back to normalized linear interpolation, which avoids dividing by
   * `sin(theta)` as `theta` goes to zero. See that constant for the error
   * bound.
   */
  slerp(target: Quaternion, t: number): this {
    const { x: ax, y: ay, z: az, w: aw } = this;
    let bx = target.x;
    let by = target.y;
    let bz = target.z;
    let bw = target.w;

    let cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw;
    if (cosHalfTheta < 0) {
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
      cosHalfTheta = -cosHalfTheta;
    }

    let scaleFrom: number;
    let scaleTo: number;
    if (cosHalfTheta > SLERP_LINEAR_THRESHOLD) {
      scaleFrom = 1 - t;
      scaleTo = t;
    } else {
      const halfTheta = Math.acos(cosHalfTheta);
      const inverseSinHalfTheta =
        1 / Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
      scaleFrom = Math.sin((1 - t) * halfTheta) * inverseSinHalfTheta;
      scaleTo = Math.sin(t * halfTheta) * inverseSinHalfTheta;
    }

    const x = ax * scaleFrom + bx * scaleTo;
    const y = ay * scaleFrom + by * scaleTo;
    const z = az * scaleFrom + bz * scaleTo;
    const w = aw * scaleFrom + bw * scaleTo;

    // Renormalize inline rather than calling `normalize()`, which would fire
    // the change hook a second time. The nlerp branch needs it; the spherical
    // branch is already unit length up to rounding, so this only tidies drift.
    const lengthSquared = x * x + y * y + z * z + w * w;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      this.x = x * inverseLength;
      this.y = y * inverseLength;
      this.z = z * inverseLength;
      this.w = w * inverseLength;
    } else {
      // Only reachable for antipodal inputs at exactly t = 0.5, which the
      // shortest-arc negation above already rules out for unit inputs.
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Rotates `v` by this (unit) quaternion and writes the result into `out`,
   * which is **required** (plan D7: the result is not `this`, so the caller
   * owns the storage — nothing here allocates). Returns `out`.
   *
   * Aliasing-safe: `v` and `out` may be the same vector; `v` is read into
   * scalars before `out` is written. This quaternion is not modified and its
   * change hook does not fire; `out` is written through `Vector3.set`, so
   * `out`'s hook fires exactly once.
   *
   * Uses `v' = v + 2 * w * (u x v) + 2 * (u x (u x v))` with `u = (x, y, z)`,
   * the standard expansion of `q * v * q⁻¹` for unit `q`.
   */
  rotateVector3(v: Vector3, out: Vector3): Vector3 {
    const { x: qx, y: qy, z: qz, w: qw } = this;
    const vx = v.x;
    const vy = v.y;
    const vz = v.z;

    // t = 2 * (u x v)
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);

    return out.set(
      vx + qw * tx + (qy * tz - qz * ty),
      vy + qw * ty + (qz * tx - qx * tz),
      vz + qw * tz + (qx * ty - qy * tx),
    );
  }
}
