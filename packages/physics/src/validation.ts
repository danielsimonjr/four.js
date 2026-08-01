/**
 * Descriptor validation (§85), for the physics half of the checklist.
 *
 * §85 requires development builds to detect, among other things: NaN and
 * infinite values, **invalid physics dimensions**, and **impossible
 * mass/inertia values**. This module is where the physics package does that,
 * once, at the boundary where a descriptor enters the engine — before a solver
 * turns a bad number into an exploding simulation three steps later, and before
 * a WebAssembly adapter turns it into an unreadable trap.
 *
 * ## Contract
 *
 * Every validator either returns `undefined` or throws a `FourError` (§89)
 * carrying `INVALID_APPLICATION_STATE`, a message that names the section it
 * enforces, and a `context` with the offending field and value. There is no
 * "collect all errors" mode: the first problem is reported with the detail
 * needed to fix it, which is what the animation package does for the same class
 * of failure.
 *
 * `INVALID_APPLICATION_STATE` and not `PHYSICS_SOLVER_FAILED` (§89): the solver
 * has not run and has not failed — the *caller* handed the engine something it
 * cannot simulate. §89's list is explicitly the engine's current vocabulary
 * rather than a closed set, so a dedicated physics-input code can be added
 * later without changing these call sites.
 *
 * ## Where validation runs
 *
 * At descriptor level, which is the last point where all of a body's or
 * collider's properties are visible together, and the point §37 hands them to
 * an adapter. §85's "production builds may disable expensive validation while
 * preserving essential safety checks" applies to the per-step paths, not to
 * these: creating a body is not a hot path, and everything here is a handful of
 * numeric comparisons.
 *
 * These functions are pure and take the world's dimension explicitly rather
 * than reading it from a world, so they can be used by a serializer, an editor,
 * or a test with no world in existence.
 */

import { FourError } from "@four/core";
import type { Matrix3 } from "@four/math";

import type {
  ColliderDescriptor,
  JointDescriptor,
  PhysicsWorldOptions,
  RigidBodyDescriptor,
} from "./descriptors.js";
import { resolveGravity, resolveRotation } from "./descriptors.js";
import { validateCollisionShape } from "./shapes.js";
import type { BodyType, PhysicsDimension, Vector3Input } from "./types.js";
import {
  BODY_TYPES,
  CCD_MODES,
  DETERMINISM_LEVELS,
  PHYSICS_DIMENSIONS,
} from "./types.js";

/** See the module header for why every failure here uses this §89 code. */
const VALIDATION_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** Raises a §85 validation failure. */
function fail(message: string, context: Record<string, unknown>): never {
  throw new FourError(VALIDATION_ERROR_CODE, message, { context });
}

/** §85: "NaN and infinite values". */
function requireFinite(field: string, value: number): void {
  if (!Number.isFinite(value)) {
    fail(`${field} must be a finite number; got ${String(value)} (§85).`, {
      field,
      value,
    });
  }
}

/** §85: a coefficient that may be zero but never negative or non-finite. */
function requireNonNegative(field: string, value: number): void {
  requireFinite(field, value);
  if (value < 0) {
    fail(`${field} must be >= 0; got ${String(value)} (§85).`, {
      field,
      value,
    });
  }
}

/** §24: `collisionGroups` and `collisionMask` are 32-bit bit sets. */
function requireBitSet(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    fail(
      `${field} must be an integer bit set in [0, 0xffffffff]; got ${String(value)} (§24, §85).`,
      { field, value },
    );
  }
}

/**
 * §21/§85: a positional input must be finite, and in a `"2d"` world it must lie
 * in the XY plane. A `Vector2` always does; a `Vector3` must say so.
 */
function requirePlanarVector(
  field: string,
  value: Vector3Input,
  dimension: PhysicsDimension,
): void {
  requireFinite(`${field}.x`, value.x);
  requireFinite(`${field}.y`, value.y);
  if (!("z" in value)) {
    return;
  }
  requireFinite(`${field}.z`, value.z);
  if (dimension === "2d" && value.z !== 0) {
    fail(
      `A "2d" world simulates in the XY plane, so ${field}.z must be 0; got ${String(value.z)} (§21, §85). Pass a Vector2 to say the same thing.`,
      { field, dimension, z: value.z },
    );
  }
}

/**
 * §23's mass rule: *"`mass` must be positive on dynamic bodies (validated,
 * §85); non-simulated mass is expressed through the static and kinematic body
 * types, never `mass = 0`."*
 *
 * Exported because the `RigidBody` component's `mass` setter (WP-5.2) enforces
 * the same rule on assignment, and there must be exactly one statement of it.
 * An omitted mass is legal at any body type — §23 derives it from collider
 * density then (§24, §25).
 */
export function validateMass(bodyType: BodyType, mass?: number): void {
  if (mass === undefined) {
    return;
  }
  requireFinite("mass", mass);
  if (bodyType === "dynamic" && mass <= 0) {
    fail(
      `A dynamic body's mass must be positive; got ${String(mass)} (§23, §85). Use the "static" or a kinematic body type for a body that does not respond to forces — never mass = 0.`,
      { field: "mass", bodyType, mass },
    );
  }
  if (mass < 0) {
    fail(`mass must not be negative; got ${String(mass)} (§23, §85).`, {
      field: "mass",
      bodyType,
      mass,
    });
  }
}

/**
 * §85's "impossible mass/inertia values" for the inertia tensor (§23).
 *
 * Every entry must be finite and the three diagonal entries — the principal
 * moments — must be non-negative, because a negative moment of inertia
 * describes no physical body and makes the angular solve diverge. Off-diagonal
 * products of inertia are legitimately signed and are only checked for
 * finiteness.
 *
 * In a `"2d"` world only the Z diagonal entry is used (§23), so the rest is
 * still checked for sanity but cannot affect the simulation.
 */
export function validateInertiaTensor(tensor: Matrix3): void {
  const { elements } = tensor;
  for (let i = 0; i < 9; i += 1) {
    requireFinite(`inertiaTensor[${String(i)}]`, elements[i]);
  }
  // Column-major (§7b): the diagonal is elements 0, 4, 8.
  for (const index of [0, 4, 8]) {
    if (elements[index] < 0) {
      fail(
        `inertiaTensor[${String(index)}] is a principal moment of inertia and must be >= 0; got ${String(elements[index])} (§23, §85).`,
        { field: `inertiaTensor[${String(index)}]`, value: elements[index] },
      );
    }
  }
}

/**
 * Validates a body descriptor against §22, §23, §31, and the §21 plane
 * constraint of a `"2d"` world.
 *
 * Checked: the body type is one of §22's four; the §23 mass rule; the inertia
 * tensor; every positional and velocity input is finite and in-plane; damping
 * and gravity scale; and that
 * `continuousCollisionDetection` and `ccdMode` do not contradict each other
 * (§23 carries the switch, §31 the mode — see `RigidBodyDescriptor.ccdMode`).
 */
export function validateRigidBodyDescriptor(
  desc: RigidBodyDescriptor,
  dimension: PhysicsDimension,
): void {
  if (!BODY_TYPES.includes(desc.type)) {
    fail(
      `Unknown body type ${JSON.stringify(desc.type)}; expected one of ${BODY_TYPES.join(", ")} (§22).`,
      { field: "type", value: desc.type },
    );
  }

  validateMass(desc.type, desc.mass);

  if (desc.inertiaTensor !== undefined) {
    validateInertiaTensor(desc.inertiaTensor);
  }

  if (desc.position !== undefined) {
    requirePlanarVector("position", desc.position, dimension);
  }
  if (desc.centerOfMass !== undefined) {
    requirePlanarVector("centerOfMass", desc.centerOfMass, dimension);
  }
  if (desc.linearVelocity !== undefined) {
    requirePlanarVector("linearVelocity", desc.linearVelocity, dimension);
  }

  if (desc.rotation !== undefined) {
    // resolveRotation carries the §21 "rotation is about +Z in 2d" rule and the
    // finiteness check for the scalar form; reusing it keeps one statement of
    // the rule. The resolved quaternion is discarded — this is a check.
    resolveRotation(dimension, desc.rotation);
  }

  if (desc.angularVelocity !== undefined) {
    const angular = desc.angularVelocity;
    if (typeof angular === "number") {
      requireFinite("angularVelocity", angular);
    } else {
      requireFinite("angularVelocity.x", angular.x);
      requireFinite("angularVelocity.y", angular.y);
      requireFinite("angularVelocity.z", angular.z);
      if (dimension === "2d" && (angular.x !== 0 || angular.y !== 0)) {
        fail(
          `A "2d" world spins about +Z only, so angularVelocity.x and .y must be 0; got (${String(angular.x)}, ${String(angular.y)}) (§21, §85).`,
          { field: "angularVelocity", dimension },
        );
      }
    }
  }

  if (desc.linearDamping !== undefined) {
    requireNonNegative("linearDamping", desc.linearDamping);
  }
  if (desc.angularDamping !== undefined) {
    requireNonNegative("angularDamping", desc.angularDamping);
  }
  if (desc.gravityScale !== undefined) {
    requireFinite("gravityScale", desc.gravityScale);
  }

  if (desc.ccdMode !== undefined) {
    if (!CCD_MODES.includes(desc.ccdMode)) {
      fail(
        `Unknown CCD mode ${JSON.stringify(desc.ccdMode)}; expected one of ${CCD_MODES.join(", ")} (§31).`,
        { field: "ccdMode", value: desc.ccdMode },
      );
    }
    if (
      desc.continuousCollisionDetection === false &&
      desc.ccdMode !== "disabled"
    ) {
      fail(
        `continuousCollisionDetection is false but ccdMode is ${JSON.stringify(desc.ccdMode)} (§23, §31). Drop one of the two rather than leaving the engine to guess which you meant.`,
        { field: "ccdMode", value: desc.ccdMode },
      );
    }
  }
}

/**
 * Validates a collider descriptor against §24, §25, and the world's dimension
 * (§21).
 *
 * The shape is checked by `validateCollisionShape`, including that it belongs
 * to `dimension` — a `"circle"` in a 3D world is rejected here rather than
 * silently promoted to a sphere.
 */
export function validateColliderDescriptor(
  desc: ColliderDescriptor,
  dimension: PhysicsDimension,
): void {
  validateCollisionShape(desc.shape, dimension);

  if (desc.friction !== undefined) {
    requireNonNegative("friction", desc.friction);
  }
  if (desc.restitution !== undefined) {
    requireNonNegative("restitution", desc.restitution);
  }
  if (desc.density !== undefined) {
    requireNonNegative("density", desc.density);
  }
  if (desc.collisionGroups !== undefined) {
    requireBitSet("collisionGroups", desc.collisionGroups);
  }
  if (desc.collisionMask !== undefined) {
    requireBitSet("collisionMask", desc.collisionMask);
  }
  if (desc.offset !== undefined) {
    requirePlanarVector("offset.position", desc.offset.position, dimension);
    resolveRotation(dimension, desc.offset.rotation);
  }
}

/**
 * Validates a joint descriptor against §28 and the world's dimension (§21).
 *
 * Minimal, matching the minimal descriptor (plan P5-4): a joint's type is a
 * name the *adapter* has to recognize — `PhysicsCapabilities.jointTypes` is
 * `string[]` (§37) — so what is checked here is what the engine can check
 * without a solver: that the two bodies differ and that the anchors are
 * representable in the world's dimension.
 */
export function validateJointDescriptor(
  desc: JointDescriptor,
  dimension: PhysicsDimension,
): void {
  if (desc.bodyA === desc.bodyB) {
    fail(
      "A joint must connect two different bodies; bodyA and bodyB are the same handle (§28).",
      { field: "bodyB" },
    );
  }
  if (desc.anchorA !== undefined) {
    requirePlanarVector("anchorA", desc.anchorA, dimension);
  }
  if (desc.anchorB !== undefined) {
    requirePlanarVector("anchorB", desc.anchorB, dimension);
  }
}

/**
 * Validates a world's options against §21, §32, and §33 — §85's "invalid
 * physics dimensions" in particular.
 *
 * Gravity is validated through `resolveGravity`, which owns the §21 rule that a
 * `"2d"` world has no z gravity; the resolved vector is discarded.
 */
export function validatePhysicsWorldOptions(
  options: PhysicsWorldOptions,
): void {
  if (!PHYSICS_DIMENSIONS.includes(options.dimension)) {
    fail(
      `Unknown physics dimension ${JSON.stringify(options.dimension)}; expected one of ${PHYSICS_DIMENSIONS.join(", ")} (§21, §85).`,
      { field: "dimension", value: options.dimension },
    );
  }

  if (options.gravity !== undefined) {
    requireFinite("gravity.x", options.gravity.x);
    requireFinite("gravity.y", options.gravity.y);
    if ("z" in options.gravity) {
      requireFinite("gravity.z", options.gravity.z);
    }
    resolveGravity(options.dimension, options.gravity);
  }

  if (options.determinism !== undefined) {
    if (!DETERMINISM_LEVELS.includes(options.determinism)) {
      fail(
        `Unknown determinism level ${JSON.stringify(options.determinism)}; expected one of ${DETERMINISM_LEVELS.join(", ")} (§33).`,
        { field: "determinism", value: options.determinism },
      );
    }
  }

  const sleeping = options.sleeping;
  if (sleeping !== undefined) {
    if (sleeping.linearThreshold !== undefined) {
      requireNonNegative("sleeping.linearThreshold", sleeping.linearThreshold);
    }
    if (sleeping.angularThreshold !== undefined) {
      requireNonNegative(
        "sleeping.angularThreshold",
        sleeping.angularThreshold,
      );
    }
    if (sleeping.timeThreshold !== undefined) {
      // Seconds (§7a) — nothing in this engine takes milliseconds.
      requireNonNegative("sleeping.timeThreshold", sleeping.timeThreshold);
    }
  }
}
