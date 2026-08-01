/**
 * The physics vocabulary (§21, §22, §25, §31, §32, §33) and the opaque solver
 * handles of §37.
 *
 * This module is the leaf of `@four/physics`: it imports nothing from the rest
 * of the package, so every other module can name these types without creating a
 * cycle. It holds the closed unions the specification spells out, the small
 * amount of configuration data that goes with them, and the three handle types
 * that an adapter mints and the engine passes back.
 *
 * ## Everything is a string union, never an enum
 *
 * The house style set by `TransformAuthority` (§42) and `RendererBackend`
 * (§62): a string union serializes as itself, logs as itself, compares as
 * itself, and needs no import at the call site. Each union is paired with a
 * frozen `as const` array so runtime code can enumerate or validate the domain
 * without duplicating the literals.
 *
 * ## Typing strategy (§21, plan P5-3)
 *
 * The public physics API is typed **once, in 3D** — `Vector3` positions and
 * `Quaternion` rotations — for both dimensions. A `"2d"` world is a plane
 * constraint on that one API: motion is confined to XY and rotation to the Z
 * axis, and `Vector2` arguments are accepted as a convenience that widens to
 * `z = 0`. That is why {@link Vector3Input}, {@link RotationInput}, and
 * {@link AngularVelocityInput} live here rather than a parallel 2D type set;
 * the widening functions that consume them are in `descriptors.ts`.
 *
 * Both dimensions share §7a's Y-up, right-handed world, so gravity is negative
 * Y in 2D and 3D alike, every angle is in radians, and every duration in this
 * package is in seconds.
 */

import type { Quaternion, Vector2, Vector3 } from "@four/math";

/**
 * Which dimensional model a world simulates (§21).
 *
 * `"2d"` does not select a second API — see the module header and plan P5-3.
 * It selects a plane constraint over the same 3D-typed API: positions live in
 * the world XY plane (`z = 0`), rotation is about `+Z` only, and §30's overlap
 * queries degrade to their planar forms (`overlapSphere` is a circle,
 * `overlapBox` a rectangle) exactly as §21 requires.
 */
export type PhysicsDimension = "2d" | "3d";

/** Every {@link PhysicsDimension}, in §21's order. */
export const PHYSICS_DIMENSIONS = [
  "2d",
  "3d",
] as const satisfies readonly PhysicsDimension[];

/**
 * How a body participates in simulation (§22).
 *
 * - `"static"` — does not move and is unaffected by forces.
 * - `"dynamic"` — moves according to mass, force, collisions, and constraints.
 * - `"kinematic-position"` — moves toward prescribed positions.
 * - `"kinematic-velocity"` — moves using prescribed velocity.
 *
 * §23 makes this the *only* way to express a non-simulated body: an infinite or
 * zero mass is never the mechanism, `"static"` and the two kinematic types are.
 */
export type BodyType =
  "static" | "dynamic" | "kinematic-position" | "kinematic-velocity";

/** Every {@link BodyType}, in §22's order. */
export const BODY_TYPES = [
  "static",
  "dynamic",
  "kinematic-position",
  "kinematic-velocity",
] as const satisfies readonly BodyType[];

/**
 * How a body is swept against thin geometry between steps (§31).
 *
 * - `"disabled"` — discrete collision detection only; the default
 *   ({@link DEFAULT_CCD_MODE}, Appendix A).
 * - `"speculative"` — contacts are generated ahead of the body from its
 *   predicted motion, so the solver can stop it before it passes through.
 * - `"swept"` — the body's motion over the step is swept and the step is
 *   sub-divided at the first time of impact.
 *
 * §23 exposes the on/off switch as `RigidBody.continuousCollisionDetection`;
 * this union names *which* method is used when it is on. `ColliderDescriptor`
 * and `RigidBodyDescriptor` carry both, and their relationship is validated —
 * see `RigidBodyDescriptor.ccdMode`.
 *
 * Which modes an adapter actually implements is declared in
 * `PhysicsCapabilities.ccdModes` (§37); an adapter that offers none still lists
 * `"disabled"`, because doing nothing is always available.
 */
export type CCDMode = "disabled" | "speculative" | "swept";

/** Every {@link CCDMode}, in §31's order. */
export const CCD_MODES = [
  "disabled",
  "speculative",
  "swept",
] as const satisfies readonly CCDMode[];

/** Appendix A: continuous collision detection is off unless asked for (§31). */
export const DEFAULT_CCD_MODE: CCDMode = "disabled";

/**
 * The CCD method used when {@link CCDMode} is left unspecified but
 * `continuousCollisionDetection` is `true` (§23, §31).
 *
 * `"swept"` rather than `"speculative"`: §31's stated purpose is that "fast
 * objects may tunnel through thin geometry", and sweeping is the mode that
 * actually prevents tunnelling in every case, where speculative contacts can
 * still miss geometry thinner than the speculative margin. A caller who wants
 * the cheaper mode names it (decision, WP-5.1).
 */
export const DEFAULT_ENABLED_CCD_MODE: CCDMode = "swept";

/**
 * Declared reproducibility of a simulation (§33).
 *
 * - `"none"` — no reproducibility is claimed.
 * - `"same-runtime"` — identical results for the same build on the same JS
 *   engine, OS, and hardware. The engine's initial target
 *   ({@link DEFAULT_DETERMINISM_LEVEL}, Appendix A).
 * - `"same-platform"` — additionally stable across runs and engine minor
 *   versions on one platform, which requires avoiding JS `Math` transcendentals
 *   in simulation paths.
 * - `"cross-platform"` — additionally stable across OS and hardware;
 *   effectively the whole simulation path must run in deterministic
 *   WebAssembly or software floating point.
 *
 * The tiers are ordered by strength — see {@link DETERMINISM_LEVELS}, whose
 * index is that order. Adapters declare the tier they can actually achieve in
 * `PhysicsCapabilities.determinism` (§37); a world may not ask for more than
 * its adapter declares.
 */
export type DeterminismLevel =
  "none" | "same-runtime" | "same-platform" | "cross-platform";

/**
 * Every {@link DeterminismLevel}, in §33's order — which is also weakest to
 * strongest, so `DETERMINISM_LEVELS.indexOf(a) >= DETERMINISM_LEVELS.indexOf(b)`
 * reads "tier `a` is at least as strong as tier `b`".
 */
export const DETERMINISM_LEVELS = [
  "none",
  "same-runtime",
  "same-platform",
  "cross-platform",
] as const satisfies readonly DeterminismLevel[];

/** Appendix A: the engine's determinism target is `same-runtime` (§33). */
export const DEFAULT_DETERMINISM_LEVEL: DeterminismLevel = "same-runtime";

/**
 * How two colliders' material values are reduced to the single value a contact
 * uses (§25).
 *
 * Appendix A fixes the two defaults: friction combines by `"average"`,
 * restitution by `"maximum"`. See `material.ts` for the resolution helpers.
 */
export type CombineMode = "average" | "minimum" | "maximum" | "multiply";

/** Every {@link CombineMode}, in §25's order. */
export const COMBINE_MODES = [
  "average",
  "minimum",
  "maximum",
  "multiply",
] as const satisfies readonly CombineMode[];

/**
 * When dynamic bodies at rest stop being simulated (§32).
 *
 * §32's example assigns the whole record at once (`world.sleeping = {...}`);
 * `PhysicsWorldOptions.sleeping` accepts a partial and fills the gaps from
 * {@link DEFAULT_SLEEPING_CONFIG} through `resolveSleepingConfig`.
 *
 * Fields are `readonly` because this is resolved configuration, not live state:
 * whether a *body* is asleep is read-only state on the body with `wake()` and
 * `sleep()` as the commands (§23, §32).
 */
export interface SleepingConfig {
  /** Whether bodies may sleep at all. */
  readonly enabled: boolean;
  /** Linear speed below which a body counts as at rest, in metres per second. */
  readonly linearThreshold: number;
  /** Angular speed below which a body counts as at rest, in radians per second. */
  readonly angularThreshold: number;
  /**
   * How long a body must stay below both thresholds before it sleeps, **in
   * seconds** (§7a: every duration in this engine is seconds).
   */
  readonly timeThreshold: number;
}

/**
 * Appendix A: sleeping is enabled, with linear 0.01, angular 0.01, and a 0.5 s
 * time threshold (§32).
 */
export const DEFAULT_SLEEPING_CONFIG: SleepingConfig = Object.freeze({
  enabled: true,
  linearThreshold: 0.01,
  angularThreshold: 0.01,
  timeThreshold: 0.5,
});

/**
 * A position, velocity, or offset accepted by the public API (§21, plan P5-3).
 *
 * The API is 3D-typed; a `Vector2` is a convenience that widens to `z = 0`
 * through `widenToVector3`. Passing a `Vector2` is legal in a `"3d"` world too
 * — it simply means "in the XY plane" — and passing a `Vector3` with a non-zero
 * `z` to a `"2d"` world is a validation failure (§85), not a silent projection.
 */
export type Vector3Input = Vector2 | Vector3;

/**
 * A rotation accepted by the public API (§21, plan P5-3).
 *
 * A `number` is an angle **in radians about +Z** (§7a) — the only rotation a
 * `"2d"` world has — and widens to the equivalent quaternion through
 * `resolveRotation`. A `Quaternion` given to a `"2d"` world must already be a
 * pure Z rotation; anything else is a validation failure rather than a silent
 * projection.
 */
export type RotationInput = Quaternion | number;

/**
 * An angular velocity accepted by the public API (§21, §23, plan P5-3).
 *
 * A `number` is the scalar rate **about +Z in radians per second**, the only
 * angular degree of freedom a `"2d"` world has, and widens to `(0, 0, w)`.
 */
export type AngularVelocityInput = Vector3 | number;

/**
 * Brand carrier for the §37 handle types.
 *
 * `declare const … : unique symbol` is a type-space-only declaration: it emits
 * no JavaScript, survives `declaration` emit into the package's `.d.ts`
 * (verified), and — being module-private — cannot be named by any consumer.
 * A handle is therefore **unforgeable**: no object literal can supply this
 * property, so `{}` and `{ id: 3 }` are not assignable to
 * {@link PhysicsBodyHandle}, and neither is a collider handle. An adapter mints
 * one from its own solver object with a deliberate double cast:
 *
 * ```ts
 * const handle = rapierBody as unknown as PhysicsBodyHandle;
 * ```
 *
 * and recovers it the same way. That cast is the adapter's *entire* privilege
 * over handles, it is grep-able, and it is confined to the adapter package —
 * which is exactly the boundary §37 draws (decision, WP-5.1: the repo had no
 * prior branding pattern; this establishes one).
 */
declare const physicsHandleBrand: unique symbol;

/**
 * Opaque reference to a body inside a solver, minted by
 * `PhysicsSolverAdapter.createBody` (§37).
 *
 * Handles carry no readable data on purpose. The engine-assigned monotonic body
 * id that §33's checksum orders by is owned by `@four/physics` (WP-5.3), not by
 * the adapter, so it lives beside the handle rather than inside it.
 *
 * A handle is valid until it is passed to `destroyBody`; using one afterwards
 * is undefined behaviour that adapters are expected to reject.
 */
export interface PhysicsBodyHandle {
  readonly [physicsHandleBrand]: "body";
}

/**
 * Opaque reference to a collider inside a solver, minted by
 * `PhysicsSolverAdapter.createCollider` (§37). See {@link PhysicsBodyHandle}.
 */
export interface PhysicsColliderHandle {
  readonly [physicsHandleBrand]: "collider";
}

/**
 * Opaque reference to a joint inside a solver, minted by
 * `PhysicsSolverAdapter.createJoint` (§37). See {@link PhysicsBodyHandle}.
 *
 * Joints are staged to Phase 6 (plan P5-4): the type and the §37 signatures
 * ship now, and Phase 5 adapters throw `NOT_IMPLEMENTED` from `createJoint`.
 */
export interface PhysicsJointHandle {
  readonly [physicsHandleBrand]: "joint";
}

/**
 * Any of the three §37 handles — for bookkeeping that is genuinely
 * kind-agnostic. Narrow it with the kind you expect rather than casting: the
 * three are mutually non-assignable precisely so a body handle cannot reach a
 * collider API.
 */
export type PhysicsHandle =
  PhysicsBodyHandle | PhysicsColliderHandle | PhysicsJointHandle;
