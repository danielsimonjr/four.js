/**
 * Per-handle access to a solver's bodies — the seam §37's two `sync*` methods
 * leave open.
 *
 * ## Why this interface exists
 *
 * `PhysicsSolverAdapter` (§37) is a contract about the **step**: create the
 * world, create bodies and colliders, advance by a fixed delta, hand back the
 * events, answer queries, snapshot. It deliberately says nothing about reading
 * or writing *one* body, because the transform exchange with the scene graph is
 * `@four/physics`'s business and an adapter is not allowed to know what a scene
 * is (a solver package may not import `@four/scene`).
 *
 * That leaves `PhysicsWorld` needing something it can call per body per step:
 * read the solved pose so it can be written onto a node under `"physics"`
 * authority (§42), push a kinematic target back in (§22), drain the §26 command
 * buffers into the solver, ask whether a body is asleep (§32), and walk every
 * body in monotonic id order for §33's checksum. {@link SolverBodyAccess} is
 * that surface, and a world requires its adapter to implement both interfaces:
 *
 * ```ts
 * new PhysicsWorld({ dimension: "2d", adapter }); // adapter: PhysicsSolverAdapter & SolverBodyAccess
 * ```
 *
 * ## The §37 call order is unchanged
 *
 * `syncSceneToSolver` and `syncSolverToScene` remain the **call-order hooks**:
 * the world calls them at exactly the points §37 and §39 specify, once per fixed
 * step, around `step`. What has moved is the *payload*. A solver that stages
 * writes flushes them in `syncSceneToSolver`; a solver that applies every write
 * immediately (Rapier does) documents both as no-ops. Either way the per-handle
 * calls below are how the physics package actually reads and writes solver
 * state, and they happen inside the phases those two hooks bracket:
 *
 * ```text
 * per fixed step, in order:
 *   for each body: apply* / setNextKinematicTransform / setBodyVelocities   ← scene → solver
 *   syncSceneToSolver()
 *   step(fixedDeltaTime)
 *   syncSolverToScene()
 *   for each body: getBodyTransform / getBodyVelocities / isBodySleeping    ← solver → scene
 *   drainEvents()                                                          ← dispatched after (§39 step 9)
 * ```
 *
 * ## Contract every implementor owes
 *
 * - **Handles are the adapter's own.** Every method takes a handle this adapter
 *   minted and should reject a foreign or destroyed one with a `FourError`
 *   rather than misbehaving silently.
 * - **Reads take `out` parameters** and write into them (§7b, plan D7). The
 *   world calls them once per body per step and passes the destination it wants
 *   filled — frequently a node's own `transform.position` — so a read must not
 *   allocate a result.
 * - **Ids are monotonic and never reused** (§33). `getBodyId` is the order
 *   §33's checksum is taken in; {@link SolverBodyAccess.forEachBody} must visit
 *   in ascending id, which is creation order, so that destroying a body cannot
 *   permute the sequence. A snapshot restore (§34) preserves both.
 * - **Angles are planar scalars in a `"2d"` world** (§21, plan P5-3): a
 *   `number` torque, angle, or angular velocity is about **+Z**, and a
 *   `Vector3` form must lie on the Z axis.
 * - **No user callbacks** (§37) and no clock or `Math.random` (§33), here as
 *   everywhere else in the simulation path.
 *
 * This module is types only — it ships no runtime code. `FakeSolverAdapter`
 * (`tests/fake-adapter.ts`) is the structural double that proves the interface
 * is implementable without a solver; `Rapier2dAdapter` is the first real
 * implementor, whose own `RapierBodyAccess` this interface mirrors member for
 * member.
 */

import type { Quaternion, Vector3 } from "@four/math";

import type {
  AngularVelocityInput,
  CCDMode,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  RotationInput,
  Vector3Input,
} from "./types.js";

/**
 * What `PhysicsWorld` needs from a solver body by body (§26, §32, §33, §37,
 * §42). See the module header for why it is separate from
 * `PhysicsSolverAdapter` and what an implementor owes.
 */
export interface SolverBodyAccess {
  /**
   * Reads a body's world transform — the read §42's `"physics"` authority
   * publishes onto a node.
   *
   * In a `"2d"` world `outPosition.z` is `0` and `outRotation` is the pure Z
   * quaternion equivalent to the solver's scalar angle (§21).
   */
  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void;

  /**
   * Teleports a body (§37 "teleports").
   *
   * Use {@link SolverBodyAccess.setNextKinematicTransform} for a
   * `"kinematic-position"` body that should push dynamic bodies on the way:
   * a teleport moves the body without deriving the motion that a contact
   * response needs.
   */
  setBodyTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation: RotationInput,
    wake?: boolean,
  ): void;

  /** Reads linear (m/s) and angular (rad/s) velocity into `out` parameters (§23). */
  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void;

  /**
   * Writes both velocities (§23). This is also how a `"kinematic-velocity"`
   * body is driven (§22).
   */
  setBodyVelocities(
    handle: PhysicsBodyHandle,
    linear: Vector3Input,
    angular: AngularVelocityInput,
    wake?: boolean,
  ): void;

  /** §26 `body.applyForce(force)` — newtons, at the centre of mass. */
  applyForce(handle: PhysicsBodyHandle, force: Vector3Input): void;

  /** §26 `body.applyForceAtPoint(force, worldPoint)`. */
  applyForceAtPoint(
    handle: PhysicsBodyHandle,
    force: Vector3Input,
    worldPoint: Vector3Input,
  ): void;

  /** §26 `body.applyTorque(torque)` — newton-metres, about +Z in a plane. */
  applyTorque(handle: PhysicsBodyHandle, torque: AngularVelocityInput): void;

  /** §26 `body.applyImpulse(impulse)` — newton-seconds at the centre of mass. */
  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3Input): void;

  /** §26 `body.applyImpulseAtPoint(impulse, worldPoint)`. */
  applyImpulseAtPoint(
    handle: PhysicsBodyHandle,
    impulse: Vector3Input,
    worldPoint: Vector3Input,
  ): void;

  /** §26 `body.applyAngularImpulse(angularImpulse)` about +Z. */
  applyAngularImpulse(
    handle: PhysicsBodyHandle,
    angularImpulse: AngularVelocityInput,
  ): void;

  /**
   * Clears the accumulated forces and torques (not impulses, which change
   * momentum at the moment they are applied).
   *
   * §26's rule is that a force acts for one step; solvers commonly keep user
   * forces until they are reset, so the world resets before it re-applies the
   * step's command buffer. An implementor whose forces are already per-step may
   * implement this as a no-op.
   */
  resetForces(handle: PhysicsBodyHandle): void;

  /**
   * Sets a `"kinematic-position"` body's target pose for the next step (§22).
   *
   * The solver derives the motion from the current pose to the target, so
   * dynamic bodies in the way react to it — which is what distinguishes this
   * from {@link SolverBodyAccess.setBodyTransform}.
   */
  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation?: RotationInput,
  ): void;

  /** §32's explicit wake command, queued by `RigidBody.wake()`. */
  wakeBody(handle: PhysicsBodyHandle): void;

  /** §32's explicit sleep command, queued by `RigidBody.sleep()`. */
  sleepBody(handle: PhysicsBodyHandle): void;

  /**
   * §32 sleep state, as the solver holds it after the step. The transitions are
   * also reported through `drainEvents`; this is the state the world publishes
   * onto `RigidBody.sleeping`.
   */
  isBodySleeping(handle: PhysicsBodyHandle): boolean;

  /**
   * The §31 CCD mode the solver is actually running for this body — read back
   * from the solver rather than remembered, so it reports what the solver does
   * and not what the descriptor asked for.
   */
  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode;

  /**
   * The body's mass in kilograms, as the solver computed it (§23, §25).
   *
   * §23 derives mass from collider density when it is not authored, and that
   * derivation belongs to the solver (plan §6d, 2026-08-01): the world reads it
   * back here after registration so `RigidBody.inverseMass` stops reporting
   * `NaN`.
   */
  getBodyMass(handle: PhysicsBodyHandle): number;

  /** The monotonic id §33's checksum orders by. */
  getBodyId(handle: PhysicsBodyHandle): number;

  /**
   * Visits every live body **in creation order**, which is ascending
   * {@link SolverBodyAccess.getBodyId} because ids are monotonic and never
   * reused.
   *
   * This is the iteration §33 requires: destroying a body removes it from the
   * sequence and creating one appends, so no destruction can permute the order
   * a checksum is taken in.
   */
  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void;

  /** The body a collider belongs to (§24, §37). */
  getColliderBody(handle: PhysicsColliderHandle): PhysicsBodyHandle;

  /** The collider's monotonic id, ordered like {@link SolverBodyAccess.getBodyId}. */
  getColliderId(handle: PhysicsColliderHandle): number;

  /** Visits every live collider in creation order. */
  forEachCollider(
    visit: (handle: PhysicsColliderHandle, id: number) => void,
  ): void;
}
