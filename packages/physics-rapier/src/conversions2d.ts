/**
 * The §21/P5-3 mapping between the engine's 3D-typed physics API and Rapier's
 * two-dimensional one.
 *
 * `@four/physics` is typed **once, in 3D** (`Vector3` positions, `Quaternion`
 * rotations) for both dimensions — §21 and plan P5-3. Rapier 2D speaks
 * `{ x, y }` and a scalar angle. Every crossing of that boundary happens in this
 * module, so the mapping can be read, tested, and reasoned about in one place
 * instead of being re-derived at forty call sites.
 *
 * ## The mapping, precisely
 *
 * | four.js (3D-typed)                    | Rapier 2D                       |
 * | ------------------------------------- | ------------------------------- |
 * | `Vector3(x, y, z)` with `z === 0`     | `{ x, y }`                      |
 * | `Vector2(x, y)`                       | `{ x, y }`                      |
 * | `Quaternion(0, 0, sin(θ/2), cos(θ/2))`| `θ` radians                     |
 * | angular velocity `(0, 0, ω)`          | `ω` rad/s                       |
 * | torque `(0, 0, τ)`                    | `τ` N·m                         |
 *
 * Both directions are exact and total on the values a `"2d"` world may hold:
 *
 * - **quaternion → angle** is `θ = 2 · atan2(q.z, q.w)`. For the pure Z rotation
 *   `(0, 0, sin(θ/2), cos(θ/2))` this returns `θ` for `θ ∈ (−2π, 2π]`, and
 *   because `q` and `−q` name the same rotation, the two representations map to
 *   angles `2π` apart — the same orientation, a different winding. Rapier
 *   itself normalizes the angle it stores, so a round trip through the solver
 *   returns the wrapped value.
 * - **angle → quaternion** is a rotation about **+Z**: `(0, 0, sin(θ/2),
 *   cos(θ/2))`. §7a puts +Y up and the world right-handed in *both* dimensions,
 *   so +Z is out of the screen and a positive angle turns counter-clockwise.
 *
 * A `Vector3` with a non-zero `z`, a quaternion with a non-zero `x` or `y`, and
 * an angular velocity outside the Z axis are **rejected**, never projected:
 * §85 asks for invalid dimensions to be detected, and silently dropping the
 * out-of-plane part yields a body that is subtly somewhere else rather than
 * obviously wrong. The rejection is delegated to `@four/physics`'s own
 * `resolveRotation` / `resolveAngularVelocity`, so this adapter cannot drift
 * from the engine's rule.
 *
 * ## Collision filtering: 32 bits in, 16 bits out
 *
 * §24's `collisionGroups` and `collisionMask` are 32-bit sets, and
 * `ALL_COLLISION_GROUPS` is `0xffffffff`. Rapier packs **both** into a single
 * `u32` `InteractionGroups` — the high 16 bits are membership, the low 16 the
 * filter — so it offers 16 groups, not 32. {@link packInteractionGroups} does
 * that packing and **throws** on a value that would not survive it, rather than
 * truncating a group into `0` and quietly disabling every interaction the caller
 * configured. `ALL_COLLISION_GROUPS` is exempt, since "every bit" packs to
 * "every bit" in either width.
 *
 * ## Allocation (§7b, D7)
 *
 * Every converter takes the destination as a parameter and returns it. Nothing
 * here allocates on a hot path. The Rapier bindings themselves *do* allocate —
 * `body.translation()` builds a fresh `{ x, y }` on every call — which is a
 * property of the 0.19.3 JavaScript binding this package cannot avoid; the
 * `out` parameters below at least stop that allocation from spreading into
 * `@four/math` types.
 *
 * Every function here requires `initializeRapier2d()` to have resolved: the
 * shape constructors trap into wasm.
 */

import { FourError } from "@four/core";
import type { Quaternion, Vector3 } from "@four/math";
import {
  ALL_COLLISION_GROUPS,
  resolveAngularVelocity,
  resolveRotation,
} from "@four/physics";
import type {
  AngularVelocityInput,
  BodyType,
  CollisionShape,
  RotationInput,
  Vector3Input,
} from "@four/physics";

import { RAPIER_2D } from "./init.js";
import type { RapierColliderDesc, RapierShape, RapierVector } from "./init.js";

/**
 * §89 has no physics-input code and `PHYSICS_SOLVER_FAILED` means the solver
 * failed, which is a different event; bad input to this adapter is the same
 * general invalid-input code `@four/physics` uses for descriptors.
 */
const CONVERSION_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** The dimension this module converts for — every rejection message cites it. */
const DIMENSION = "2d";

/** Highest bit index Rapier's 16-bit halves of `InteractionGroups` can carry. */
const RAPIER_GROUP_BITS = 16;

/** Mask of the bits that survive the packing into a 16-bit half. */
const RAPIER_GROUP_MASK = 0xffff;

/**
 * A mutable Rapier 2D vector — the `{ x, y }` shape every Rapier entry point
 * accepts. Re-exported under this name so adapter code can declare scratch
 * buffers without importing from the solver package directly.
 */
export type RapierVector2 = RapierVector;

/** Allocates a zeroed scratch vector for the `out` parameters below. */
export function createRapierVector2(): RapierVector2 {
  return { x: 0, y: 0 };
}

/**
 * Writes a {@link Vector3Input} into a Rapier 2D vector, rejecting anything
 * out of the XY plane (§21, §85).
 *
 * `field` names the offending property in the error, because "z must be 0" is
 * useless without knowing whether it was a position, a velocity, or an anchor.
 */
export function toRapierVector2(
  field: string,
  value: Vector3Input,
  out: RapierVector2,
): RapierVector2 {
  const z = "z" in value ? value.z : 0;
  if (z !== 0) {
    throw new FourError(
      CONVERSION_ERROR_CODE,
      `A "2d" world has no z axis, so ${field}.z must be 0; got ${String(z)} (§21, §85).`,
      { context: { dimension: DIMENSION, field, z } },
    );
  }
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new FourError(
      CONVERSION_ERROR_CODE,
      `${field} must be finite; got (${String(value.x)}, ${String(value.y)}) (§85).`,
      { context: { dimension: DIMENSION, field } },
    );
  }
  out.x = value.x;
  out.y = value.y;
  return out;
}

/**
 * Writes a Rapier 2D vector into a `Vector3` with `z = 0` (§21).
 *
 * The inverse of {@link toRapierVector2}, and the only way a solved position or
 * velocity re-enters the engine's own types.
 */
export function fromRapierVector2(value: RapierVector2, out: Vector3): Vector3 {
  return out.set(value.x, value.y, 0);
}

/**
 * Converts a {@link RotationInput} to Rapier's scalar angle in radians (§7a,
 * §21).
 *
 * A `number` passes through unchanged (it is already an angle about +Z); a
 * `Quaternion` must be a pure Z rotation and becomes `2 · atan2(z, w)`. The
 * plane check is `@four/physics`'s `resolveRotation`, so the adapter and the
 * engine reject exactly the same values.
 */
export function toRapierAngle(
  rotation: RotationInput,
  scratch: Quaternion,
): number {
  const planar = resolveRotation(DIMENSION, rotation, scratch);
  return typeof rotation === "number" ? rotation : quaternionToAngleZ(planar);
}

/**
 * The Z-axis angle a pure Z-rotation quaternion represents: `2 · atan2(z, w)`.
 *
 * Exported on its own because it is the half of the mapping worth testing
 * directly, and because a caller that already knows its quaternion is planar
 * should not pay for the check again.
 */
export function quaternionToAngleZ(rotation: Quaternion): number {
  return 2 * Math.atan2(rotation.z, rotation.w);
}

/**
 * Writes Rapier's scalar angle back into a quaternion as a rotation about +Z
 * (§7a): `(0, 0, sin(θ/2), cos(θ/2))`.
 */
export function fromRapierAngle(angle: number, out: Quaternion): Quaternion {
  const half = angle / 2;
  return out.set(0, 0, Math.sin(half), Math.cos(half));
}

/**
 * Converts an {@link AngularVelocityInput} — or a torque, or an angular
 * impulse, all of which are Z-axis scalars in a plane — to Rapier's scalar
 * form (§21, §23, §26).
 *
 * A `Vector3` must lie on the Z axis; `resolveAngularVelocity` enforces that
 * and the finiteness of the scalar form.
 */
export function toRapierAngularScalar(
  value: AngularVelocityInput,
  scratch: Vector3,
): number {
  return resolveAngularVelocity(DIMENSION, value, scratch).z;
}

/**
 * Maps a §22 body type to Rapier's `RigidBodyType` (verified against the
 * installed 0.19.3 enum).
 *
 * §22's `"static"` is Rapier's `Fixed`; the two kinematic types map one to one.
 */
export function toRapierBodyType(type: BodyType): number {
  switch (type) {
    case "static":
      return RAPIER_2D.RigidBodyType.Fixed;
    case "dynamic":
      return RAPIER_2D.RigidBodyType.Dynamic;
    case "kinematic-position":
      return RAPIER_2D.RigidBodyType.KinematicPositionBased;
    case "kinematic-velocity":
      return RAPIER_2D.RigidBodyType.KinematicVelocityBased;
    default: {
      const unknown: never = type;
      throw new FourError(
        CONVERSION_ERROR_CODE,
        `Unknown body type ${JSON.stringify(unknown)} (§22).`,
        { context: { bodyType: unknown } },
      );
    }
  }
}

/**
 * The sign a §28 revolute joint's axis gives the plane's one rotational degree
 * of freedom (§21, plan P6-1, WP-6.2).
 *
 * Rapier 2D's `JointData.revolute(anchor1, anchor2)` takes **no axis** — a
 * plane turns about +Z and about nothing else — while the engine's
 * `RevoluteJointDescriptor.axis` may name `±Z` (validation rejects everything
 * else, and an omitted axis means `+Z`). The two are reconciled here rather
 * than by dropping the sign: a hinge about **−Z** is the same pin with the
 * positive sense reversed, so its limits and its motor are mirrored.
 *
 * ```ts
 * revoluteAxisSignZ(undefined);                // +1 (the §21 default, +Z)
 * revoluteAxisSignZ(new Vector3(0, 0, -2));    // -1
 * ```
 *
 * A caller applies the sign as `[-max, -min]` to a limit range and as
 * `-targetVelocity` to a motor rate — the mirror of the axis, not a
 * reinterpretation of the numbers.
 */
export function revoluteAxisSignZ(axis: Vector3Input | undefined): 1 | -1 {
  if (axis === undefined) {
    return 1;
  }
  const z = "z" in axis ? axis.z : 0;
  if (axis.x !== 0 || axis.y !== 0 || z === 0 || !Number.isFinite(z)) {
    throw new FourError(
      CONVERSION_ERROR_CODE,
      `A "2d" world rotates about +Z only, so a revolute joint's axis must be along ±Z; got (${String(axis.x)}, ${String(axis.y)}, ${String(z)}) (§21, §28).`,
      { context: { dimension: DIMENSION, field: "axis" } },
    );
  }
  return z > 0 ? 1 : -1;
}

/**
 * Writes a §28 joint axis into a Rapier 2D vector as a **unit** direction in
 * the XY plane (§21, §85) — the form `JointData.prismatic` wants.
 *
 * Rapier normalizes the axis itself (measured: a prismatic joint built with
 * `(3, 0)` and limits `±1` still stops at `x = ±1`, i.e. the limits are metres
 * along the *normalized* axis), so normalizing here changes no simulation. It
 * is done anyway because it makes that fact explicit at the boundary instead of
 * leaving a reader to wonder whether `limits` are scaled by the axis length.
 *
 * The zero vector is rejected: it names no direction, and Rapier's own
 * constructor answers `undefined` for it, which would surface much later as a
 * confusing failure inside `createImpulseJoint`.
 */
export function toRapierJointAxis2d(
  field: string,
  value: Vector3Input,
  out: RapierVector2,
): RapierVector2 {
  toRapierVector2(field, value, out);
  const length = Math.hypot(out.x, out.y);
  if (length === 0) {
    throw new FourError(
      CONVERSION_ERROR_CODE,
      `${field} must be a non-zero direction in the XY plane (§21, §28, §85).`,
      { context: { dimension: DIMENSION, field } },
    );
  }
  out.x /= length;
  out.y /= length;
  return out;
}

/**
 * Packs §24's separate 32-bit `collisionGroups` and `collisionMask` into the
 * single `u32` Rapier calls `InteractionGroups`.
 *
 * Rapier's rule, from its own documentation: two filters `a` and `b` interact
 * when `((a >> 16) & b) !== 0 && ((b >> 16) & a) !== 0` — the high 16 bits are
 * the *membership* groups and the low 16 the *filter* mask. That is the same
 * mutual rule `passesQueryFilter` documents in `@four/physics`, so contact
 * filtering and query filtering agree by construction.
 *
 * Values above bit 15 cannot be represented and are **rejected**;
 * `ALL_COLLISION_GROUPS` (`0xffffffff`) is the one exception, because "every
 * group" is still every group at 16 bits.
 */
export function packInteractionGroups(groups: number, mask: number): number {
  return (
    ((packGroupHalf("collisionGroups", groups) << RAPIER_GROUP_BITS) |
      packGroupHalf("collisionMask", mask)) >>>
    0
  );
}

/** Narrows one 32-bit §24 bit set to Rapier's 16-bit half. See above. */
function packGroupHalf(field: string, value: number): number {
  if (value === ALL_COLLISION_GROUPS) {
    return RAPIER_GROUP_MASK;
  }
  if (!Number.isInteger(value) || value < 0 || value > RAPIER_GROUP_MASK) {
    throw new FourError(
      CONVERSION_ERROR_CODE,
      `Rapier 2D packs collision groups and masks into one 32-bit value, 16 bits each, so ${field} must be an integer in [0, 65535] (or ALL_COLLISION_GROUPS); got ${String(value)} (§24, §37).`,
      { context: { dimension: DIMENSION, field, value } },
    );
  }
  return value;
}

/**
 * Builds the Rapier shape for a §24 collision shape, for the query entry points
 * that take a bare `Shape` (§30 `overlap` and `shapeCast`).
 *
 * Only the **convex** 2D tier is reachable — circle, rectangle, capsule, convex
 * polygon — because the query entry points run `validateQueryShape(shape,
 * "2d")` first, which refuses the 3D tags and the two composite 2D shapes
 * (`polyline`, `chain`; PH-22a). The 3D tags are rejected here rather than
 * silently promoted.
 *
 * **Capsule axis.** Rapier's `Capsule(halfHeight, radius)` puts the cylindrical
 * section along **+Y** in 2D, which is exactly §24's convention — verified
 * against 0.19.3 by dropping a capsule onto a floor and measuring its resting
 * height as `halfHeight + radius` above the surface. No axis swap is needed.
 *
 * **Polygon.** `ConvexPolygon(vertices, skipConvexHullComputation)` is built
 * with the hull computation **on** (`false`). `@four/physics` already rejects a
 * concave outline, so the hull is a no-op on valid input; leaving it on is what
 * makes either winding acceptable, which `PolygonShape` promises and Rapier's
 * `convexPolyline` (counter-clockwise only) does not.
 */
export function createRapierShape(shape: CollisionShape): RapierShape {
  switch (shape.type) {
    case "circle":
      return new RAPIER_2D.Ball(shape.radius);
    case "rectangle":
      return new RAPIER_2D.Cuboid(shape.halfExtents.x, shape.halfExtents.y);
    case "capsule":
      return new RAPIER_2D.Capsule(shape.halfHeight, shape.radius);
    case "polygon":
      return new RAPIER_2D.ConvexPolygon(
        polygonVertices(shape.vertices),
        false,
      );
    default:
      throw unsupportedShape(shape.type);
  }
}

/**
 * Builds the Rapier collider descriptor for a §24 collision shape — the
 * `createCollider` counterpart of {@link createRapierShape}.
 *
 * `ColliderDesc.convexHull` returns `null` when the point cloud is degenerate.
 * `validateCollisionShape` already rejects an outline that encloses no area
 * exactly, so this only fires for an outline that is non-degenerate in exact
 * arithmetic and degenerate under Rapier's own epsilon — a real difference of
 * opinion between the two, reported rather than passed on.
 *
 * **Polyline and chain (PH-22a).** Both are `ColliderDesc.polyline`; the whole
 * difference is the index buffer. An `N`-vertex polyline gets `N − 1` segments
 * `(0,1), (1,2), …`; an `N`-vertex chain gets `N`, the last one `(N−1, 0)`.
 * Indices are always passed explicitly — the upstream "omit for a line strip"
 * default would make the open case implicit and the closed case explicit, and
 * one code path that reads the same for both is worth the extra array.
 */
export function createRapierColliderDesc(
  shape: CollisionShape,
): RapierColliderDesc {
  switch (shape.type) {
    case "circle":
      return RAPIER_2D.ColliderDesc.ball(shape.radius);
    case "rectangle":
      return RAPIER_2D.ColliderDesc.cuboid(
        shape.halfExtents.x,
        shape.halfExtents.y,
      );
    case "capsule":
      return RAPIER_2D.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    case "polygon":
      return requireHullDesc(
        RAPIER_2D.ColliderDesc.convexHull(polygonVertices(shape.vertices)),
        shape.type,
      );
    case "polyline":
      return RAPIER_2D.ColliderDesc.polyline(
        polygonVertices(shape.vertices),
        segmentIndices(shape.vertices.length, false),
      );
    case "chain":
      return RAPIER_2D.ColliderDesc.polyline(
        polygonVertices(shape.vertices),
        segmentIndices(shape.vertices.length, true),
      );
    default:
      throw unsupportedShape(shape.type);
  }
}

/**
 * Turns `ColliderDesc.convexHull`'s `null` into a `FourError` (§24, §85).
 *
 * Rapier's typings declare the return as `ColliderDesc | null`, so this branch
 * must exist. **No 0.19.3 input reaches it**: measured 2026-08-08, the 2D
 * build returns a descriptor for empty, single-point, collinear, and
 * `NaN`-bearing outlines alike. Rather than write a `!` — a promise about a
 * solver this package does not own — the translation is a named, exported
 * function, so the contract is testable at the version that never produces the
 * `null` as well as at one that might. (Before PH-22a this was an inline
 * branch, and the one uncovered fragment of this module.)
 */
export function requireHullDesc(
  desc: RapierColliderDesc | null,
  shapeType: string,
): RapierColliderDesc {
  if (desc === null) {
    throw new FourError(
      CONVERSION_ERROR_CODE,
      `${shapeType} shape: Rapier could not build a convex hull from the outline (§24, §85).`,
      { context: { dimension: DIMENSION, shape: shapeType } },
    );
  }
  return desc;
}

/** Flattens a polygon outline into the `Float32Array` Rapier expects. */
function polygonVertices(
  vertices: readonly { x: number; y: number }[],
): Float32Array {
  const flat = new Float32Array(vertices.length * 2);
  for (let i = 0; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    flat[i * 2] = vertex.x;
    flat[i * 2 + 1] = vertex.y;
  }
  return flat;
}

/**
 * The segment index buffer for a run of `count` vertices — `count` segments
 * when `closed`, `count − 1` when not (§24, PH-22a).
 *
 * Ascending and contiguous, so the solver sees the vertices in the order the
 * caller wrote them (§33).
 */
function segmentIndices(count: number, closed: boolean): Uint32Array {
  const segments = closed ? count : count - 1;
  const indices = new Uint32Array(segments * 2);
  for (let i = 0; i < segments; i += 1) {
    indices[i * 2] = i;
    indices[i * 2 + 1] = (i + 1) % count;
  }
  return indices;
}

/** The error for a shape that exists in `CollisionShape` but not in 2D. */
function unsupportedShape(type: string): FourError {
  return new FourError(
    CONVERSION_ERROR_CODE,
    `${type} shape is not valid in a "2d" world (§21, §24).`,
    { context: { dimension: DIMENSION, shape: type } },
  );
}
