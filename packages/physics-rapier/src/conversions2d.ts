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
 * Only the plan P5-6 2D tier is reachable — circle, rectangle, capsule, convex
 * polygon — because `validateCollisionShape(shape, "2d")` runs first everywhere
 * this is called. The 3D tags are rejected here rather than silently promoted.
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
 * That cannot happen for a shape `validateCollisionShape` accepted (it rejects
 * outlines that enclose no area), so the `null` branch is a defensive
 * conversion to a `FourError` rather than an expected path.
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
    case "polygon": {
      const desc = RAPIER_2D.ColliderDesc.convexHull(
        polygonVertices(shape.vertices),
      );
      if (desc === null) {
        throw new FourError(
          CONVERSION_ERROR_CODE,
          "polygon shape: Rapier could not build a convex hull from the outline (§24, §85).",
          { context: { dimension: DIMENSION, shape: shape.type } },
        );
      }
      return desc;
    }
    default:
      throw unsupportedShape(shape.type);
  }
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

/** The error for a shape that exists in `CollisionShape` but not in 2D. */
function unsupportedShape(type: string): FourError {
  return new FourError(
    CONVERSION_ERROR_CODE,
    `${type} shape is not valid in a "2d" world (§21, §24).`,
    { context: { dimension: DIMENSION, shape: type } },
  );
}
