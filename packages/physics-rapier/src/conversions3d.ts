/**
 * The §21/P5-3 mapping between the engine's 3D-typed physics API and Rapier's
 * three-dimensional one.
 *
 * `@four/physics` is typed **once, in 3D** (`Vector3` positions, `Quaternion`
 * rotations) for both dimensions — §21 and plan P5-3 — so in three dimensions
 * this module has far less to do than its 2D sibling: the mapping is essentially
 * an identity, and its job is to move numbers between `@four/math` types and
 * Rapier's plain `{ x, y, z }` / `{ x, y, z, w }` records without allocating.
 *
 * ## The mapping, precisely
 *
 * | four.js (3D-typed)                     | Rapier 3D            |
 * | -------------------------------------- | -------------------- |
 * | `Vector3(x, y, z)`                     | `{ x, y, z }`        |
 * | `Vector2(x, y)`                        | `{ x, y, z: 0 }`     |
 * | `Quaternion(x, y, z, w)`               | `{ x, y, z, w }`     |
 * | rotation angle `θ` (a `number`)        | `(0, 0, sin(θ/2), cos(θ/2))` |
 * | angular velocity `(x, y, z)`           | `{ x, y, z }` rad/s  |
 * | torque `(x, y, z)`                     | `{ x, y, z }` N·m    |
 *
 * Two of those rows are worth stating out loud, because they are the places
 * where the 3D mapping is *not* trivial:
 *
 * - **A `number` rotation is still legal in a `"3d"` world.** `RotationInput` is
 *   `Quaternion | number` in both dimensions, and §7a fixes the scalar form's
 *   meaning as radians about **+Z**. So `rotation: Math.PI / 2` builds the same
 *   quarter turn in a 3D world that it builds in a 2D one. That is a
 *   convenience, not a plane constraint: nothing here rejects an out-of-plane
 *   quaternion, because a 3D world has all three axes.
 * - **A `Vector2` still widens to `z = 0`** (`widenToVector3`'s rule), so the
 *   same descriptor can be handed to either dimension. This module does the
 *   widening itself rather than calling `widenToVector3`, only to avoid a
 *   `Vector3` round trip on a path that already has an `out` record to fill.
 *
 * Everything dimension-*aware* is delegated to `@four/physics`'s own
 * `resolveRotation` / `resolveAngularVelocity`, exactly as in 2D, so the adapter
 * cannot drift from the engine's rule for either dimension.
 *
 * ## Collision filtering: 32 bits in, 16 bits out
 *
 * Identical to 2D, and verified against the 3D build's own
 * `geometry/interaction_groups.d.ts`: Rapier packs §24's separate
 * `collisionGroups` and `collisionMask` into a **single `u32`**, high 16 bits
 * membership and low 16 bits filter, in three dimensions as in two. See
 * {@link packInteractionGroups3d}, which rejects a value that would not survive
 * the narrowing rather than truncating it.
 *
 * ## Allocation (§7b, D7)
 *
 * Every converter takes the destination as a parameter and returns it. Nothing
 * here allocates on a hot path. The Rapier bindings themselves *do* allocate —
 * `body.translation()` builds a fresh `{ x, y, z }` on every call — which is a
 * property of the 0.19.3 JavaScript binding this package cannot avoid.
 *
 * Every function here requires `initializeRapier3d()` to have resolved: the
 * shape constructors trap into wasm.
 */

import { FourError } from "@four/core";
import type { Matrix3, Quaternion, Vector3 } from "@four/math";
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

import { RAPIER_3D } from "./init.js";
import type {
  RapierColliderDesc3d,
  RapierRotation3,
  RapierShape3d,
  RapierVector3,
} from "./init.js";

/**
 * §89 has no physics-input code and `PHYSICS_SOLVER_FAILED` means the solver
 * failed, which is a different event; bad input to this adapter is the same
 * general invalid-input code `@four/physics` uses for descriptors.
 */
const CONVERSION_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** The dimension this module converts for — every rejection message cites it. */
const DIMENSION = "3d";

/** Highest bit index Rapier's 16-bit halves of `InteractionGroups` can carry. */
const RAPIER_GROUP_BITS = 16;

/** Mask of the bits that survive the packing into a 16-bit half. */
const RAPIER_GROUP_MASK = 0xffff;

/** Column-major indices of a `Matrix3`'s off-diagonal entries (§7b). */
const OFF_DIAGONAL_INDICES = [1, 2, 3, 5, 6, 7] as const;

export type { RapierRotation3, RapierVector3 } from "./init.js";

/** Allocates a zeroed scratch vector for the `out` parameters below. */
export function createRapierVector3(): RapierVector3 {
  return { x: 0, y: 0, z: 0 };
}

/** Allocates an identity scratch rotation for the `out` parameters below. */
export function createRapierRotation3(): RapierRotation3 {
  return { x: 0, y: 0, z: 0, w: 1 };
}

/**
 * Writes a {@link Vector3Input} into a Rapier 3D vector, widening a `Vector2`
 * to `z = 0` (§21).
 *
 * Unlike its 2D counterpart there is no plane to violate, so the only rejection
 * is non-finiteness (§85). `field` names the offending property in the error,
 * because "must be finite" is useless without knowing whether it was a
 * position, a velocity, or an anchor.
 */
export function toRapierVector3(
  field: string,
  value: Vector3Input,
  out: RapierVector3,
): RapierVector3 {
  const z = "z" in value ? value.z : 0;
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(z)
  ) {
    throw new FourError(
      CONVERSION_ERROR_CODE,
      `${field} must be finite; got (${String(value.x)}, ${String(value.y)}, ${String(z)}) (§85).`,
      { context: { dimension: DIMENSION, field } },
    );
  }
  out.x = value.x;
  out.y = value.y;
  out.z = z;
  return out;
}

/**
 * Writes a Rapier 3D vector into a `Vector3` — the inverse of
 * {@link toRapierVector3}, and the only way a solved position or velocity
 * re-enters the engine's own types.
 */
export function fromRapierVector3(value: RapierVector3, out: Vector3): Vector3 {
  return out.set(value.x, value.y, value.z);
}

/**
 * Converts a {@link RotationInput} to Rapier's quaternion form (§7a, §21).
 *
 * A `Quaternion` is copied component for component; a `number` is radians about
 * **+Z** and becomes `(0, 0, sin(θ/2), cos(θ/2))`. `resolveRotation` performs
 * both conversions, so a 3D world and a 2D world agree on what a scalar angle
 * means.
 *
 * `scratch` is the caller's reusable `Quaternion`; `out` is the Rapier record
 * that is filled and returned (§7b, D7).
 */
export function toRapierRotation3(
  rotation: RotationInput,
  scratch: Quaternion,
  out: RapierRotation3,
): RapierRotation3 {
  const resolved = resolveRotation(DIMENSION, rotation, scratch);
  out.x = resolved.x;
  out.y = resolved.y;
  out.z = resolved.z;
  out.w = resolved.w;
  return out;
}

/**
 * Writes a Rapier 3D rotation back into a `Quaternion`.
 *
 * No normalization is applied. Rapier stores a *unit* quaternion and
 * re-normalizes it as it integrates, so what comes back is already normalized to
 * within 32-bit rounding (measured: `|q| - 1 < 4e-8` after 900 steps of a
 * tumbling box); normalizing again here would only add error and would hide a
 * solver problem if one ever appeared.
 */
export function fromRapierRotation3(
  value: RapierRotation3,
  out: Quaternion,
): Quaternion {
  return out.set(value.x, value.y, value.z, value.w);
}

/**
 * Converts an {@link AngularVelocityInput} — or a torque, or an angular
 * impulse, all of which are axial vectors — to Rapier's `{ x, y, z }` form
 * (§21, §23, §26).
 *
 * A `number` is the scalar rate about **+Z** and widens to `(0, 0, w)`, which is
 * `resolveAngularVelocity`'s rule and therefore the same in both dimensions.
 * This is where 3D differs most from 2D: there the angular quantities collapse
 * to a scalar, here they stay vectors all the way into the solver.
 */
export function toRapierAngularVector3(
  value: AngularVelocityInput,
  scratch: Vector3,
  out: RapierVector3,
): RapierVector3 {
  const resolved = resolveAngularVelocity(DIMENSION, value, scratch);
  out.x = resolved.x;
  out.y = resolved.y;
  out.z = resolved.z;
  return out;
}

/**
 * Maps a §22 body type to Rapier's `RigidBodyType` (verified against the
 * installed 3D 0.19.3 enum, which carries the same four values as the 2D one).
 *
 * §22's `"static"` is Rapier's `Fixed`; the two kinematic types map one to one.
 */
export function toRapierBodyType3d(type: BodyType): number {
  switch (type) {
    case "static":
      return RAPIER_3D.RigidBodyType.Fixed;
    case "dynamic":
      return RAPIER_3D.RigidBodyType.Dynamic;
    case "kinematic-position":
      return RAPIER_3D.RigidBodyType.KinematicPositionBased;
    case "kinematic-velocity":
      return RAPIER_3D.RigidBodyType.KinematicVelocityBased;
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
 * Reduces §23's `inertiaTensor` to the principal moments Rapier 3D wants, and
 * **rejects anything it cannot represent exactly**.
 *
 * §23 hands the adapter a full `Matrix3`. Rapier's 3D mass API takes a principal
 * inertia *vector* plus an `angularInertiaLocalFrame` rotation — that is, the
 * tensor already diagonalized, with the frame naming the axes it was
 * diagonalized in. Turning an arbitrary symmetric tensor into that pair is an
 * eigendecomposition.
 *
 * This adapter **accepts diagonal tensors only** and throws on any non-zero
 * product of inertia (decision, WP-5.5). The reasoning:
 *
 * - A diagonal tensor is *already* expressed in its principal axes, so the
 *   mapping is exact and the frame is the identity. Nothing is approximated and
 *   nothing is silently discarded.
 * - A Jacobi eigendecomposition would introduce an iterative float computation
 *   into a path that feeds the solver, along with arbitrary eigenvector ordering
 *   and sign conventions — all of it in JavaScript `Math`, i.e. outside the
 *   deterministic wasm (§33). Getting that subtly wrong would produce a body
 *   that spins plausibly but incorrectly, which is the exact failure mode §85
 *   exists to prevent.
 * - Dropping the off-diagonal terms and keeping the diagonal would be *wrong
 *   and quiet*: the diagonal of a non-diagonal tensor is not its principal
 *   moments.
 *
 * The honest minimal answer, matching P5-6's minimalism, is therefore to
 * implement the exact case and refuse the rest with an error that says what to
 * do. A later packet may add a decomposition; widening an accepted input set is
 * backward compatible.
 */
export function toPrincipalInertia3d(
  tensor: Matrix3,
  out: RapierVector3,
): RapierVector3 {
  const { elements } = tensor;
  for (const index of OFF_DIAGONAL_INDICES) {
    if (elements[index] !== 0) {
      throw new FourError(
        CONVERSION_ERROR_CODE,
        `Rapier 3D takes a principal inertia vector plus a frame, not a full tensor, so inertiaTensor must be diagonal; element ${String(index)} is ${String(elements[index])} (§23, §37). Supply the moments about the body's principal axes on the diagonal, or omit inertiaTensor and let the solver derive it from the collider geometry.`,
        { context: { dimension: DIMENSION, index, value: elements[index] } },
      );
    }
  }
  // Column-major (§7b): the diagonal is elements 0, 4, 8.
  out.x = elements[0];
  out.y = elements[4];
  out.z = elements[8];
  return out;
}

/**
 * Packs §24's separate 32-bit `collisionGroups` and `collisionMask` into the
 * single `u32` Rapier calls `InteractionGroups`.
 *
 * Rapier's rule, quoted from the 3D build's own
 * `geometry/interaction_groups.d.ts`: two filters `a` and `b` interact when
 * `((a >> 16) & b) !== 0 && ((b >> 16) & a) !== 0` — the high 16 bits are the
 * *membership* groups and the low 16 the *filter* mask. That is the same mutual
 * rule `passesQueryFilter` documents in `@four/physics`, so contact filtering
 * and query filtering agree by construction.
 *
 * Values above bit 15 cannot be represented and are **rejected**;
 * `ALL_COLLISION_GROUPS` (`0xffffffff`) is the one exception, because "every
 * group" is still every group at 16 bits.
 *
 * This duplicates `conversions2d.ts`'s `packInteractionGroups` — about twenty
 * lines — rather than sharing it, because the shared version would have to lose
 * the dimension from its error message, and correcting the 2D message is
 * outside WP-5.5's file list (decision, WP-5.5: reported, and a candidate for a
 * later hoist into one internal module).
 */
export function packInteractionGroups3d(groups: number, mask: number): number {
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
      `Rapier 3D packs collision groups and masks into one 32-bit value, 16 bits each, so ${field} must be an integer in [0, 65535] (or ALL_COLLISION_GROUPS); got ${String(value)} (§24, §37).`,
      { context: { dimension: DIMENSION, field, value } },
    );
  }
  return value;
}

/**
 * Builds the Rapier shape for a §24 collision shape, for the query entry points
 * that take a bare `Shape` (§30 `overlap` and `shapeCast`).
 *
 * Only the plan P5-6 3D tier is reachable — sphere, box, capsule — because
 * `validateCollisionShape(shape, "3d")` runs first everywhere this is called.
 * The 2D tags are rejected here rather than silently promoted: a `"circle"` is
 * not a sphere, and guessing which the caller meant is how a 2D descriptor ends
 * up quietly simulating in three dimensions.
 *
 * **Capsule axis.** Rapier's `Capsule(halfHeight, radius)` puts the cylindrical
 * section along **+Y** in 3D as in 2D, which is §24's convention — verified
 * against the 3D 0.19.3 build by dropping a capsule onto a floor and measuring
 * its resting height as `halfHeight + radius` above the surface (1.2489 for
 * 1 + 0.25, the residue being the solver's allowed penetration). No axis swap is
 * needed.
 */
export function createRapierShape3d(shape: CollisionShape): RapierShape3d {
  switch (shape.type) {
    case "sphere":
      return new RAPIER_3D.Ball(shape.radius);
    case "box":
      return new RAPIER_3D.Cuboid(
        shape.halfExtents.x,
        shape.halfExtents.y,
        shape.halfExtents.z,
      );
    case "capsule":
      return new RAPIER_3D.Capsule(shape.halfHeight, shape.radius);
    default:
      throw unsupportedShape(shape.type);
  }
}

/**
 * Builds the Rapier collider descriptor for a §24 collision shape — the
 * `createCollider` counterpart of {@link createRapierShape3d}.
 *
 * Note `ColliderDesc.cuboid` takes **three** half-extents in the 3D build where
 * it takes two in 2D; that is the only signature in the P5-6 tier that differs
 * between the dimensions.
 */
export function createRapierColliderDesc3d(
  shape: CollisionShape,
): RapierColliderDesc3d {
  switch (shape.type) {
    case "sphere":
      return RAPIER_3D.ColliderDesc.ball(shape.radius);
    case "box":
      return RAPIER_3D.ColliderDesc.cuboid(
        shape.halfExtents.x,
        shape.halfExtents.y,
        shape.halfExtents.z,
      );
    case "capsule":
      return RAPIER_3D.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    default:
      throw unsupportedShape(shape.type);
  }
}

/**
 * Rotates a collider-local point into world space by a Rapier rotation.
 *
 * The 3D counterpart of the 2D adapter's `cos`/`sin` pair, and the one piece of
 * real quaternion arithmetic this adapter does: `v' = v + 2w(q × v) + 2q × (q ×
 * v)`, written as the usual two-cross-product form. `@four/math`'s `Quaternion`
 * has no rotate-a-vector method to borrow, and building one here keeps the
 * adapter's per-contact path free of `Vector3` temporaries.
 *
 * Writes into `out` and returns it (§7b, D7).
 */
export function rotateVectorByRotation3(
  rotation: RapierRotation3,
  value: RapierVector3,
  out: RapierVector3,
): RapierVector3 {
  const { x, y, z, w } = rotation;
  // t = 2 * (q.xyz × v)
  const tx = 2 * (y * value.z - z * value.y);
  const ty = 2 * (z * value.x - x * value.z);
  const tz = 2 * (x * value.y - y * value.x);
  out.x = value.x + w * tx + (y * tz - z * ty);
  out.y = value.y + w * ty + (z * tx - x * tz);
  out.z = value.z + w * tz + (x * ty - y * tx);
  return out;
}

/** The error for a shape that exists in `CollisionShape` but not in 3D. */
function unsupportedShape(type: string): FourError {
  return new FourError(
    CONVERSION_ERROR_CODE,
    `${type} shape is not valid in a "3d" world (§21, §24).`,
    { context: { dimension: DIMENSION, shape: type } },
  );
}
