import { noteConstruction } from "./alloc-counter.js";

/**
 * Default tolerance for {@link Vector3.equalsApprox}. See `vector2.ts` for the
 * rationale; all three vector types use the same value.
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Mutable three-component vector (§7b) — the primary vector type of the engine
 * (§7 transforms, §11 motion, §20+ physics). The world is right-handed with +Y
 * up in both 2D and 3D (§7a).
 *
 * Allocation policy (§7b, plan D7): instance methods that produce a
 * "this-shaped" result mutate in place and return `this`; only
 * {@link Vector3.clone} allocates. Scalar queries (`dot`, `lengthSq`,
 * `length`) and `equalsApprox` never allocate and never mutate.
 *
 * Change notification (plan D3): every mutator invokes {@link Vector3.onChanged}
 * after writing. Direct field writes (`v.x = 1`) bypass the hook by design.
 */
export class Vector3 {
  x: number;
  y: number;
  z: number;

  /**
   * Optional change hook invoked at the end of every mutator. Engine-internal:
   * owners install it, user code normally leaves it unset. It is intentionally
   * *not* copied by {@link Vector3.copy} or {@link Vector3.clone}.
   */
  onChanged?: () => void;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    noteConstruction();
  }

  /** Sets all three components. */
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.onChanged?.();
    return this;
  }

  /** Copies the components of `v` into this vector. The change hook is not copied. */
  copy(v: Vector3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new vector with the same components. The clone has no change
   * hook. This is the only allocating method on the type (§7b).
   */
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  /** Adds `v` component-wise. */
  add(v: Vector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.onChanged?.();
    return this;
  }

  /** Subtracts `v` component-wise. */
  sub(v: Vector3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this.onChanged?.();
    return this;
  }

  /** Multiplies every component by the scalar `s`. */
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    this.onChanged?.();
    return this;
  }

  /** Dot product with `v`. Does not mutate. */
  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /**
   * Right-handed cross product, mutating this vector to `this × v` (this
   * vector is the left operand). Reading the result requires the temporaries
   * below because two components are overwritten before the third is read.
   */
  cross(v: Vector3): this {
    const { x, y, z } = this;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    this.onChanged?.();
    return this;
  }

  /** Squared length. Preferred over {@link Vector3.length} for comparisons. */
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /** Euclidean length. */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  /**
   * Scales this vector to unit length.
   *
   * Zero-length behaviour (defined here): normalizing a zero-length vector
   * leaves it at `(0, 0, 0)` rather than producing `NaN` or throwing — there is
   * no meaningful direction to pick, and poisoning a hot path with `NaN` is
   * worse than a no-op. The change hook still fires.
   */
  normalize(): this {
    const lengthSquared = this.x * this.x + this.y * this.y + this.z * this.z;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      this.x *= inverseLength;
      this.y *= inverseLength;
      this.z *= inverseLength;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Moves this vector toward `target` by the factor `t`, mutating this vector.
   * `t = 0` leaves it unchanged, `t = 1` makes it equal to `target`. Values
   * outside `[0, 1]` extrapolate; no clamping is applied.
   */
  lerp(target: Vector3, t: number): this {
    this.x += (target.x - this.x) * t;
    this.y += (target.y - this.y) * t;
    this.z += (target.z - this.z) * t;
    this.onChanged?.();
    return this;
  }

  /**
   * Component-wise approximate equality: true when every component differs by
   * at most `epsilon` (absolute tolerance).
   */
  equalsApprox(v: Vector3, epsilon: number = DEFAULT_EPSILON): boolean {
    return (
      Math.abs(this.x - v.x) <= epsilon &&
      Math.abs(this.y - v.y) <= epsilon &&
      Math.abs(this.z - v.z) <= epsilon
    );
  }
}
