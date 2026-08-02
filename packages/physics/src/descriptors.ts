/**
 * The descriptors an adapter is built from (§37) and the §21 widening helpers
 * that feed them.
 *
 * `PhysicsSolverAdapter` (§37) takes four inputs — a world's options, a body
 * descriptor, a collider descriptor, and a joint descriptor — and this module
 * defines all four. They are **plain data**: no identity, no lifecycle, no
 * solver state. The §6a components that a user actually manipulates (`RigidBody`
 * and `Collider`, WP-5.2) hold live state and produce these descriptors when
 * they are registered with a world; keeping the two apart is what lets a
 * descriptor be serialized, replayed (§34), diffed, or handed to a second
 * adapter for comparison.
 *
 * ## Widening (§21, plan P5-3)
 *
 * The API is typed once in 3D. A `"2d"` world is the same API under a plane
 * constraint, so every positional field accepts a `Vector2` and every rotation
 * accepts a plain radian angle about +Z. The functions at the bottom of this
 * module are the *only* place that conversion happens:
 *
 * | Helper                                | Widens                        |
 * | ------------------------------------- | ----------------------------- |
 * | {@link widenToVector3}                | `Vector2` → `(x, y, 0)`       |
 * | {@link resolveGravity}                | §21 gravity, with the 2D rule |
 * | {@link resolveRotation}               | radians about +Z → quaternion |
 * | {@link resolveAngularVelocity}        | scalar rate → `(0, 0, w)`     |
 *
 * The three dimension-aware helpers **reject** a 3D value that a `"2d"` world
 * cannot represent — a gravity with a `z` component, a rotation that is not
 * about Z, an angular velocity with X or Y — instead of projecting it away.
 * §85 asks for "invalid physics dimensions" to be detected, and a silent
 * projection is precisely the failure that produces a simulation which is
 * subtly wrong rather than obviously broken (decision, WP-5.1).
 *
 * Every helper follows §7b/D7: it takes an optional `out` and writes into it,
 * allocating only when the caller omits one. Engine-internal per-frame code
 * always passes `out`.
 *
 * ## Units and conventions
 *
 * Metres, kilograms, seconds, and radians (§40, Appendix A), Y-up and
 * right-handed in both dimensions (§7a). Nothing here takes milliseconds or
 * degrees.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import type { Matrix3 } from "@four/math";
import type { Transform } from "@four/scene";

import type { PhysicsMaterial } from "./material.js";
import type { CollisionShape } from "./shapes.js";
import type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  DeterminismLevel,
  PhysicsBodyHandle,
  PhysicsDimension,
  RotationInput,
  SleepingConfig,
  Vector3Input,
} from "./types.js";
import { DEFAULT_SLEEPING_CONFIG } from "./types.js";

/** See `shapes.ts`: §89 has no physics-input code, so invalid input is this. */
const DESCRIPTOR_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * Appendix A: gravity is `(0, -9.81, 0)` m/s² in a 3D world and `(0, -9.81)` in
 * a 2D one — the same vector, because §7a puts +Y up in both.
 */
export const DEFAULT_GRAVITY_Y = -9.81;

/**
 * How a body is created in a solver (§37 `createBody`), carrying §23's state
 * plus the initial pose.
 *
 * Every field except {@link RigidBodyDescriptor.type} is optional; an omitted
 * field means "the solver's own default", which for the §23 properties is the
 * neutral value (zero velocity, zero damping, unit gravity scale, mass derived
 * from collider density per §23/§25).
 *
 * `type` is deliberately **required**. §22's four body types are semantically
 * distinct in a way no default can guess, and §23 makes the body type the sole
 * expression of "does not simulate" — so leaving it out would silently pick a
 * simulation model for the caller (decision, WP-5.1).
 */
export interface RigidBodyDescriptor {
  /** Which §22 simulation model this body follows. Required; see above. */
  type: BodyType;

  /**
   * Initial world position. `Vector2` widens to `z = 0`; in a `"2d"` world a
   * `Vector3` must have `z === 0` (§21).
   */
  position?: Vector3Input;

  /**
   * Initial world rotation. A `number` is radians about +Z (§7a); in a `"2d"`
   * world a `Quaternion` must be a pure Z rotation (§21).
   */
  rotation?: RotationInput;

  /**
   * Mass in kilograms (§23). Authoritative when present and overriding the
   * density-derived value; must be **positive on a dynamic body**, and is
   * ignored for static bodies. When omitted, mass is collider density times
   * volume (§23, §24, §25).
   */
  mass?: number;

  /** Centre of mass in the body's local frame (§23). Defaults to the origin. */
  centerOfMass?: Vector3Input;

  /**
   * Rotational inertia about the centre of mass (§23). In a `"2d"` world only
   * the Z diagonal entry is used and the rest is ignored, per §23's last rule.
   */
  inertiaTensor?: Matrix3;

  /** Initial linear velocity in metres per second (§23). */
  linearVelocity?: Vector3Input;

  /**
   * Initial angular velocity in radians per second (§23). A `number` is the
   * scalar rate about +Z — the only angular freedom a `"2d"` world has.
   */
  angularVelocity?: AngularVelocityInput;

  /** Linear damping coefficient (§23). Must be finite and >= 0. */
  linearDamping?: number;

  /** Angular damping coefficient (§23). Must be finite and >= 0. */
  angularDamping?: number;

  /**
   * Multiplier on the world gravity applied to this body (§23). `1` leaves
   * gravity as-is, `0` makes the body weightless, negative values invert it.
   */
  gravityScale?: number;

  /**
   * Whether continuous collision detection is on for this body (§23, §31).
   * Defaults to `false` (Appendix A).
   */
  continuousCollisionDetection?: boolean;

  /**
   * *Which* CCD method to use when it is on (§31).
   *
   * §23 carries the boolean switch and §31 the mode; they are reconciled as
   * follows, and `validateRigidBodyDescriptor` enforces it:
   *
   * - neither given → `"disabled"` (Appendix A);
   * - `continuousCollisionDetection: true`, no mode →
   *   `DEFAULT_ENABLED_CCD_MODE` (`"swept"`);
   * - a mode other than `"disabled"` given, no boolean → that mode, on;
   * - `continuousCollisionDetection: false` **and** a non-`"disabled"` mode →
   *   a contradiction, rejected rather than silently resolved.
   */
  ccdMode?: CCDMode;
}

/**
 * How a collider is created in a solver (§37 `createCollider`), carrying §24's
 * fields.
 *
 * `body` is **required**, which §24's `Collider` interface does not itself say.
 * It follows from §23: "non-simulated mass is expressed through the static and
 * kinematic body types" — static level geometry is a `"static"` body carrying
 * colliders, never a body-less collider — and from §29, whose collision events
 * name a `bodyA` and a `bodyB` unconditionally. Requiring the parent here keeps
 * that event contract fillable (decision, WP-5.1).
 */
export interface ColliderDescriptor {
  /** The collider's geometry (§24), which must suit the world's dimension. */
  shape: CollisionShape;

  /** The body this collider is attached to (§37). See above for why required. */
  body: PhysicsBodyHandle;

  /**
   * Pose of the shape in the body's local frame (§24 `Collider.offset`).
   *
   * Only `position` and `rotation` are read: a collider has no scale, and
   * scaling a solver shape at runtime is not a §24 feature — resize the shape
   * instead. `pivot` is likewise ignored. Defaults to the identity pose.
   */
  offset?: Transform;

  /**
   * Material supplying friction, restitution, and the §25 density fallback.
   * The explicit fields below win over it where both are present.
   */
  material?: PhysicsMaterial;

  /** Coulomb friction coefficient (§24). Finite and >= 0. */
  friction?: number;

  /**
   * Bounciness in `[0, 1]` for a passive contact (§24). Values above 1 add
   * energy at every bounce; they are permitted (some engineering models want
   * them) but validated as finite and >= 0 only.
   */
  restitution?: number;

  /**
   * Mass per unit volume in kg/m³ (§24). **Authoritative** for mass derivation
   * (§25): `PhysicsMaterial.density` is only a fallback when this is absent.
   */
  density?: number;

  /**
   * A sensor reports overlaps but exerts no forces (§24, Appendix B) and emits
   * `triggerenter`/`triggerexit` rather than collision events (§29). Defaults
   * to `false`.
   */
  sensor?: boolean;

  /**
   * Bit set of the groups this collider belongs to (§24). Defaults to
   * `ALL_COLLISION_GROUPS` — see `queries.ts` for the group/mask rule,
   * which queries and contact filtering share.
   */
  collisionGroups?: number;

  /** Bit set of the groups this collider collides with (§24). */
  collisionMask?: number;
}

/**
 * The §28 joint types, as named in the specification's shared-concepts list.
 *
 * `PhysicsCapabilities.jointTypes` is `string[]` (§37 verbatim), so an adapter
 * may declare types outside this union; this union is the vocabulary the engine
 * itself knows.
 */
export type JointType =
  | "fixed"
  | "distance"
  | "spring"
  | "revolute"
  | "prismatic"
  | "spherical"
  | "rope"
  | "gear"
  | "motorized";

/** Every {@link JointType}, in §28's order. */
export const JOINT_TYPES = [
  "fixed",
  "distance",
  "spring",
  "revolute",
  "prismatic",
  "spherical",
  "rope",
  "gear",
  "motorized",
] as const satisfies readonly JointType[];

/**
 * The joint types this phase actually ships (plan P6-1), which is what
 * {@link JointDescriptor} can express.
 *
 * §28 names nine types; {@link JOINT_TYPES} keeps that vocabulary because
 * `PhysicsCapabilities.jointTypes` is `string[]` and an adapter may implement
 * more than the engine builds. The *descriptor* union is narrower on purpose,
 * exactly as `CollisionShape` is narrower than §24's shape list (plan P5-6):
 *
 * | §28 type          | Status                                              |
 * | ----------------- | --------------------------------------------------- |
 * | `fixed`           | ships, both dimensions                              |
 * | `revolute`/hinge  | ships, both dimensions, with limits and a motor     |
 * | `prismatic`/slider| ships, both dimensions, with limits and a motor     |
 * | `rope`            | ships, both dimensions                              |
 * | `spring`          | ships, both dimensions                              |
 * | `spherical`/ball  | ships, **`"3d"` only** — a plane has no ball joint  |
 * | `distance`        | **staged** (plan P6-1)                              |
 * | `gear`            | **staged** (plan P6-1)                              |
 * | `motorized`       | not a type here — see below                         |
 *
 * `distance` and `gear` are staged because no solver this repository ships can
 * honour them: Rapier 0.19.3 has no rigid distance joint (its rope caps a
 * *maximum* distance only, and emulating a rigid one with a very stiff spring
 * would misrepresent §28) and no gear joint at all. They are absent from the
 * union rather than present-and-rejected, so `{ type: "distance", … }` is a
 * compile error; {@link validateJointDescriptor} also rejects them at runtime
 * for JavaScript callers, citing plan P6-1.
 *
 * `motorized` is not a joint *type* in this API. §28 lists it beside the
 * others, but a motor is a property of a joint that has a driven degree of
 * freedom — which is what §28's own example shows, a `HingeJoint` carrying a
 * `motor` record. It is therefore expressed as
 * {@link RevoluteJointDescriptor.motor} and
 * {@link PrismaticJointDescriptor.motor} (decision, WP-6.1).
 */
export type ShippedJointType =
  "fixed" | "spring" | "revolute" | "prismatic" | "spherical" | "rope";

/** Every {@link ShippedJointType}, in §28's order (plan P6-1). */
export const SHIPPED_JOINT_TYPES = [
  "fixed",
  "spring",
  "revolute",
  "prismatic",
  "spherical",
  "rope",
] as const satisfies readonly ShippedJointType[];

/** The shipped types a `"2d"` world accepts: everything but `spherical` (P6-1). */
export const SHIPPED_JOINT_TYPES_2D = [
  "fixed",
  "spring",
  "revolute",
  "prismatic",
  "rope",
] as const satisfies readonly ShippedJointType[];

/** The shipped types a `"3d"` world accepts — all of them (plan P6-1). */
export const SHIPPED_JOINT_TYPES_3D =
  SHIPPED_JOINT_TYPES satisfies readonly ShippedJointType[];

/** The §28 types staged out of this phase with a loud error (plan P6-1). */
export type StagedJointType = "distance" | "gear";

/** Every {@link StagedJointType}; see {@link ShippedJointType} for why. */
export const STAGED_JOINT_TYPES = [
  "distance",
  "gear",
] as const satisfies readonly StagedJointType[];

/**
 * Whether a shipped joint type may be used in a world of `dimension` (§21,
 * §28, plan P6-1).
 *
 * Only `spherical` answers `false`, and only for `"2d"`: a ball joint's whole
 * purpose is the two swing degrees of freedom a plane does not have, and in a
 * plane it degenerates into the revolute joint that should have been asked for.
 */
export function jointTypeSupportsDimension(
  type: ShippedJointType,
  dimension: PhysicsDimension,
): boolean {
  const types: readonly ShippedJointType[] =
    dimension === "2d" ? SHIPPED_JOINT_TYPES_2D : SHIPPED_JOINT_TYPES_3D;
  return types.includes(type);
}

/**
 * A driven degree of freedom's travel range (§28 "limits").
 *
 * Radians about the joint axis for a revolute joint, metres along it for a
 * prismatic one — §7a's units in both cases, never degrees. `min` must be
 * `<= max`; equal bounds lock the axis.
 */
export interface JointLimits {
  /** Lower bound, in radians or metres. */
  min: number;
  /** Upper bound, in radians or metres. Must be `>= min`. */
  max: number;
}

/**
 * A velocity-driven motor on a revolute joint (§28's example, verbatim field
 * names).
 *
 * The solver drives the joint's angle towards `targetVelocity` with at most
 * `maxTorque` of effort. Position motors — a target *angle* with a stiffness
 * and a damping, which Rapier also offers — are **staged** (WP-6.1,
 * 2026-08-01): §28's example specifies a velocity motor, and a second motor
 * model that only some solvers implement is worth its own decision.
 */
export interface AngularJointMotor {
  /** Whether the motor drives the joint at all. Defaults to `true`. */
  enabled?: boolean;
  /** Target angular rate in radians per second (§7a). */
  targetVelocity: number;
  /**
   * Largest torque the motor may apply, in newton-metres. Must be `>= 0`.
   *
   * Solver caveat: on the Rapier adapters this is a strength *gain*, not a
   * hard ceiling — see {@link SolverJointMotor.maxEffort} for the recorded
   * deviation and the reasoning.
   */
  maxTorque: number;
}

/**
 * A velocity-driven motor on a prismatic joint — {@link AngularJointMotor}'s
 * linear twin (§28).
 */
export interface LinearJointMotor {
  /** Whether the motor drives the joint at all. Defaults to `true`. */
  enabled?: boolean;
  /** Target linear rate in metres per second (§7a). */
  targetVelocity: number;
  /**
   * Largest force the motor may apply, in newtons. Must be `>= 0`.
   *
   * Solver caveat: on the Rapier adapters this is a strength *gain*, not a
   * hard ceiling — see {@link SolverJointMotor.maxEffort}.
   */
  maxForce: number;
}

/**
 * A ball joint's angular travel (§28 "limits"), as a swing cone with an
 * optional twist range.
 *
 * ## Why a cone and not a box (decision, WP-6.1)
 *
 * A spherical joint leaves three rotational degrees of freedom, and solvers
 * express limits on them very differently. Rapier 0.19.3's typed
 * `SphericalImpulseJoint` exposes **no** limit API at all (it is not one of the
 * `UnitImpulseJoint`s that carry `setLimits`); the only route there is a
 * *generic* joint with per-axis angular limits. A per-axis "box" would leak
 * that representation into the public API and would not be a shape any user
 * asks for.
 *
 * A **cone half-angle** is what a shoulder, a universal joint, or a camera
 * gimbal is actually specified with, and it maps onto per-axis limits by
 * symmetry — an adapter builds it as `±coneAngle` on the two swing axes of
 * {@link SphericalJointDescriptor.axis}. WP-6.3 verifies that against Rapier
 * and reports honestly if it cannot be built; nothing at this layer fakes it.
 */
export interface SphericalJointLimits {
  /**
   * Largest angle, in radians, that {@link SphericalJointDescriptor.axis} may
   * swing away from its rest direction. Must be in `(0, π]`.
   */
  coneAngle: number;

  /**
   * Optional twist range **about** the axis, in radians. Omitted means the
   * twist is free.
   */
  twist?: JointLimits;
}

/**
 * What every joint descriptor carries, whatever its type (§28, §37).
 *
 * ## Anchor space (decision, WP-6.1 — pinned)
 *
 * `anchorA` and `anchorB` are in the **local frame of their own body**, which
 * is what §37's original descriptor already said and what every solver wants
 * (Rapier's `JointData.*` anchors are body-local). The user-facing
 * {@link Joint} classes take **world-space** anchors instead, because that is
 * where §28's example puts them — the point in the scene where the hinge pin
 * goes — and `PhysicsWorld.addJoint` converts world to local **once, at
 * registration**, from each body's pose as the solver holds it at that moment.
 * Descriptors are therefore pose-independent and replayable (§34); the class
 * surface is the ergonomic one.
 *
 * An omitted anchor means the body's own origin.
 */
export interface JointDescriptorBase {
  /** First constrained body. Must differ from {@link JointDescriptorBase.bodyB}. */
  bodyA: PhysicsBodyHandle;

  /** Second constrained body. */
  bodyB: PhysicsBodyHandle;

  /** Attachment point in `bodyA`'s local frame. Defaults to its origin. */
  anchorA?: Vector3Input;

  /** Attachment point in `bodyB`'s local frame. Defaults to its origin. */
  anchorB?: Vector3Input;

  /**
   * Whether the two jointed bodies still collide with each other (§28
   * "collision enable/disable"). Defaults to `false`, the usual choice for
   * bodies that overlap by construction.
   */
  collisionEnabled?: boolean;

  /**
   * Reaction force, in newtons, above which the joint breaks (§28 "break
   * force"). Omitted means the joint never breaks under load.
   *
   * Enforced by `PhysicsWorld`, not by the solver (plan P6-2): the world reads
   * the joint's reaction impulse after every fixed step, divides by the step
   * delta, and destroys the joint when the magnitude *exceeds* this value —
   * strictly, so a joint sitting exactly at its threshold survives. Requires an
   * adapter that reports reactions (`SolverJointAccess.reportsJointReactions`);
   * `addJoint` refuses a breakable joint on an adapter that does not, rather
   * than accepting a threshold it can never enforce.
   */
  breakForce?: number;

  /**
   * Reaction torque, in newton-metres, above which the joint breaks (§28
   * "break torque"). See {@link JointDescriptorBase.breakForce}; either
   * threshold alone is enough to break the joint.
   */
  breakTorque?: number;
}

/**
 * A weld: no relative motion at all (§28 "fixed"). Both dimensions.
 *
 * The bodies keep the relative pose they had when the joint was created, so
 * pose them where they belong before registering it.
 */
export interface FixedJointDescriptor extends JointDescriptorBase {
  type: "fixed";
}

/**
 * A hinge: one rotational degree of freedom about
 * {@link RevoluteJointDescriptor.axis} (§28 "revolute/hinge"). Both dimensions.
 */
export interface RevoluteJointDescriptor extends JointDescriptorBase {
  type: "revolute";

  /**
   * Hinge axis in **`bodyA`'s local frame**, resolved from the world-space axis
   * the {@link Joint} class was given (see {@link JointDescriptorBase}).
   *
   * Required in a `"3d"` world — a hinge with no axis is not a hinge. In a
   * `"2d"` world the axis must be along ±Z, the plane's only rotational freedom
   * (§21), and defaults to `+Z` when omitted.
   */
  axis?: Vector3Input;

  /** Angular travel in radians, or free rotation when omitted (§28 "limits"). */
  limits?: JointLimits;

  /** Velocity motor about the axis, or none when omitted (§28 "motors"). */
  motor?: AngularJointMotor;
}

/**
 * A slider: one translational degree of freedom along
 * {@link PrismaticJointDescriptor.axis} (§28 "prismatic/slider"). Both
 * dimensions.
 */
export interface PrismaticJointDescriptor extends JointDescriptorBase {
  type: "prismatic";

  /**
   * Slide axis in **`bodyA`'s local frame**. Required in both dimensions — a
   * slider with no direction has nothing to slide along — and must lie **in**
   * the XY plane in a `"2d"` world (§21), which is the mirror image of the
   * revolute rule.
   */
  axis: Vector3Input;

  /** Travel in metres, or unlimited when omitted (§28 "limits"). */
  limits?: JointLimits;

  /** Velocity motor along the axis, or none when omitted (§28 "motors"). */
  motor?: LinearJointMotor;
}

/**
 * A rope: the anchors may come no further apart than
 * {@link RopeJointDescriptor.maxLength} (§28 "rope"). Both dimensions.
 *
 * Slack below that distance is unconstrained — a rope pulls and never pushes,
 * which is exactly what distinguishes it from the staged `distance` joint.
 */
export interface RopeJointDescriptor extends JointDescriptorBase {
  type: "rope";

  /** Greatest distance between the anchors, in metres. Must be > 0. */
  maxLength: number;
}

/**
 * A spring-damper between the two anchors (§28 "spring", "damping"). Both
 * dimensions.
 *
 * The restoring force is `stiffness * (distance - restLength)` opposed by
 * `damping * closingSpeed`, which is the model every solver here implements;
 * a spring constrains nothing rigidly, so it has neither limits nor a motor.
 */
export interface SpringJointDescriptor extends JointDescriptorBase {
  type: "spring";

  /** Distance at which the spring exerts no force, in metres. Must be >= 0. */
  restLength: number;

  /** Spring constant in newtons per metre. Must be > 0. */
  stiffness: number;

  /** Damping coefficient in newton-seconds per metre. Must be >= 0; 0 by default. */
  damping?: number;
}

/**
 * A ball joint: three rotational degrees of freedom about a shared point (§28
 * "spherical/ball"). **`"3d"` only** (plan P6-1).
 */
export interface SphericalJointDescriptor extends JointDescriptorBase {
  type: "spherical";

  /**
   * Reference axis of the swing cone in **`bodyA`'s local frame**, only
   * meaningful when {@link SphericalJointDescriptor.limits} is present.
   * Defaults to `+Y`, §7a's up.
   */
  axis?: Vector3Input;

  /** Swing cone and optional twist, or free rotation when omitted. */
  limits?: SphericalJointLimits;
}

/**
 * How a joint is created in a solver (§37 `createJoint`) — the discriminated
 * union of the plan P6-1 tier.
 *
 * ```ts
 * const hinge: JointDescriptor = {
 *   type: "revolute",
 *   bodyA, bodyB,
 *   axis: new Vector3(0, 0, 1),
 *   limits: { min: -Math.PI / 2, max: Math.PI / 2 },
 *   motor: { enabled: true, targetVelocity: 2, maxTorque: 50 },
 * };
 * ```
 *
 * Plain data, like every other descriptor here: no identity, no lifecycle, no
 * solver state. The {@link Joint} classes of `joints.ts` hold the live state a
 * user manipulates and produce these when they are registered with a world —
 * the same split `RigidBody`/`RigidBodyDescriptor` already draws.
 *
 * Which types ship and which are staged is {@link ShippedJointType}; a value of
 * this type is still not necessarily legal in a given world, because
 * `spherical` is `"3d"` only ({@link jointTypeSupportsDimension}).
 */
export type JointDescriptor =
  | FixedJointDescriptor
  | RevoluteJointDescriptor
  | PrismaticJointDescriptor
  | RopeJointDescriptor
  | SpringJointDescriptor
  | SphericalJointDescriptor;

/**
 * How a world is configured (§20, §21, §32, §33) — the argument to
 * `PhysicsSolverAdapter.initialize` (§37).
 *
 * §20's example also carries `solver: "auto"`. That string-based selection is
 * **not** here: a world takes a `PhysicsSolverAdapter` *instance* (plan P5-5,
 * mirroring how a renderer is injected), and `"auto"` selection joins the §45
 * registry backlog. An adapter instance already knows what it is, so nothing is
 * lost and the dependency stays explicit.
 *
 * The fixed time step is likewise absent: §10 puts the accumulator in the
 * application clock, and the physics system receives `fixedDeltaTime` per step
 * rather than owning a second copy of it.
 */
export interface PhysicsWorldOptions {
  /** `"2d"` or `"3d"` (§21). Required — there is no defensible default. */
  dimension: PhysicsDimension;

  /**
   * World gravity in m/s². Defaults to `(0, -9.81, 0)` (Appendix A); a
   * `Vector2` widens to `z = 0`, and a `"2d"` world rejects a non-zero `z`.
   */
  gravity?: Vector3Input;

  /**
   * §32 sleeping thresholds. A partial record is merged over
   * {@link DEFAULT_SLEEPING_CONFIG} by {@link resolveSleepingConfig}, so
   * `{ timeThreshold: 2 }` changes one field and keeps Appendix A's rest.
   */
  sleeping?: Partial<SleepingConfig>;

  /**
   * The reproducibility tier the world asks for (§33). Defaults to
   * `"same-runtime"` (Appendix A). A world may not ask for more than its
   * adapter declares in `PhysicsCapabilities.determinism`; the world checks
   * that at construction (WP-5.3).
   */
  determinism?: DeterminismLevel;
}

/** Reads the `z` of a {@link Vector3Input}: `0` for the two-component form. */
function inputZ(value: Vector3Input): number {
  return "z" in value ? value.z : 0;
}

/**
 * Widens any {@link Vector3Input} to a `Vector3`, with `z = 0` for a `Vector2`
 * (§21, plan P5-3).
 *
 * Dimension-agnostic on purpose: it never rejects anything, so it is safe on a
 * hot path. The §21 plane rules are enforced by the dimension-aware helpers and
 * by `validateRigidBodyDescriptor`.
 *
 * Writes into `out` when given and returns it (§7b/D7); allocates a new
 * `Vector3` otherwise. Passing the same vector as input and `out` is safe.
 */
export function widenToVector3(value: Vector3Input, out?: Vector3): Vector3 {
  const target = out ?? new Vector3();
  return target.set(value.x, value.y, inputZ(value));
}

/**
 * Resolves a world's gravity to the engine's 3D form (§21, Appendix A).
 *
 * ```ts
 * resolveGravity("2d");                            // (0, -9.81, 0)
 * resolveGravity("2d", new Vector2(0, -3));        // (0, -3, 0)
 * resolveGravity("3d", new Vector3(0, -9.81, 0));  // as given
 * resolveGravity("2d", new Vector3(0, 0, -9.81));  // throws (§21, §85)
 * ```
 *
 * Gravity is negative Y in **both** dimensions, because §7a puts +Y up in both
 * — a 2D world is not a screen-space coordinate system. Omitting `gravity`
 * yields Appendix A's default rather than zero, matching §20's and §21's
 * examples.
 *
 * A `"2d"` world rejects a gravity with a `z` component: there is no third axis
 * to accelerate along, so the caller has either mixed up a convention or built
 * the wrong world, and both are worth an error (§85 "invalid physics
 * dimensions"). Writes into `out` when given (§7b/D7).
 */
export function resolveGravity(
  dimension: PhysicsDimension,
  gravity?: Vector3Input,
  out?: Vector3,
): Vector3 {
  const target = out ?? new Vector3();
  if (gravity === undefined) {
    return target.set(0, DEFAULT_GRAVITY_Y, 0);
  }

  const z = inputZ(gravity);
  if (dimension === "2d" && z !== 0) {
    throw new FourError(
      DESCRIPTOR_ERROR_CODE,
      `A "2d" world has no z axis, so gravity.z must be 0; got ${String(z)} (§21, §85). Gravity is negative Y in both dimensions (§7a).`,
      { context: { dimension, z } },
    );
  }
  return target.set(gravity.x, gravity.y, z);
}

/**
 * Resolves a {@link RotationInput} to a quaternion (§21, §7a, plan P5-3).
 *
 * A `number` is an angle in **radians** about +Z and becomes the equivalent
 * quaternion. A `Quaternion` is copied through — except in a `"2d"` world,
 * where it must already be a pure Z rotation (`x === 0 && y === 0`): anything
 * else asks for a rotation the plane constraint cannot represent, and dropping
 * the out-of-plane part silently would leave the body facing somewhere the
 * caller never asked for.
 *
 * Writes into `out` when given (§7b/D7).
 */
export function resolveRotation(
  dimension: PhysicsDimension,
  rotation: RotationInput,
  out?: Quaternion,
): Quaternion {
  const target = out ?? new Quaternion();
  if (typeof rotation === "number") {
    if (!Number.isFinite(rotation)) {
      throw new FourError(
        DESCRIPTOR_ERROR_CODE,
        `Rotation angle must be finite radians; got ${String(rotation)} (§7a, §85).`,
        { context: { dimension, rotation } },
      );
    }
    const half = rotation / 2;
    return target.set(0, 0, Math.sin(half), Math.cos(half));
  }

  if (dimension === "2d" && (rotation.x !== 0 || rotation.y !== 0)) {
    throw new FourError(
      DESCRIPTOR_ERROR_CODE,
      `A "2d" world rotates about +Z only, so the rotation quaternion must have x = y = 0; got (${String(rotation.x)}, ${String(rotation.y)}) (§21, §85). Pass the angle in radians instead.`,
      { context: { dimension, x: rotation.x, y: rotation.y } },
    );
  }
  return target.copy(rotation);
}

/**
 * Resolves an {@link AngularVelocityInput} to the engine's 3D form (§21, §23).
 *
 * A `number` is the scalar rate about +Z in radians per second and becomes
 * `(0, 0, w)`. A `Vector3` in a `"2d"` world must have `x === y === 0`, for the
 * same reason {@link resolveRotation} restricts rotations there.
 *
 * Writes into `out` when given (§7b/D7).
 */
export function resolveAngularVelocity(
  dimension: PhysicsDimension,
  value: AngularVelocityInput,
  out?: Vector3,
): Vector3 {
  const target = out ?? new Vector3();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FourError(
        DESCRIPTOR_ERROR_CODE,
        `Angular velocity must be a finite rate in radians per second; got ${String(value)} (§23, §85).`,
        { context: { dimension, value } },
      );
    }
    return target.set(0, 0, value);
  }

  if (dimension === "2d" && (value.x !== 0 || value.y !== 0)) {
    throw new FourError(
      DESCRIPTOR_ERROR_CODE,
      `A "2d" world spins about +Z only, so angularVelocity must have x = y = 0; got (${String(value.x)}, ${String(value.y)}) (§21, §85).`,
      { context: { dimension, x: value.x, y: value.y } },
    );
  }
  return target.set(value.x, value.y, value.z);
}

/**
 * Merges a partial §32 sleeping configuration over Appendix A's defaults.
 *
 * ```ts
 * resolveSleepingConfig();                    // Appendix A
 * resolveSleepingConfig({ enabled: false });  // sleeping off, thresholds kept
 * ```
 *
 * Returns a frozen record so a resolved configuration cannot drift after the
 * world has read it. Values are *not* range-checked here — that is
 * `validatePhysicsWorldOptions`'s job, so this stays a pure merge.
 */
export function resolveSleepingConfig(
  config?: Partial<SleepingConfig>,
): SleepingConfig {
  if (config === undefined) {
    return DEFAULT_SLEEPING_CONFIG;
  }
  return Object.freeze({
    enabled: config.enabled ?? DEFAULT_SLEEPING_CONFIG.enabled,
    linearThreshold:
      config.linearThreshold ?? DEFAULT_SLEEPING_CONFIG.linearThreshold,
    angularThreshold:
      config.angularThreshold ?? DEFAULT_SLEEPING_CONFIG.angularThreshold,
    timeThreshold:
      config.timeThreshold ?? DEFAULT_SLEEPING_CONFIG.timeThreshold,
  });
}
