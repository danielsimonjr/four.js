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
 * ## The second seam: {@link SolverJointAccess} (WP-6.1)
 *
 * Joints need the same treatment for the same reason, and they need it *later*:
 * §37 mints and destroys a joint handle but says nothing about reading a
 * joint's reaction, reconfiguring its motor, or walking the joint set in id
 * order. {@link SolverJointAccess} is that surface, and it is a **separate**
 * interface rather than more members on {@link SolverBodyAccess} because an
 * adapter that ships no joints (every Phase 5 adapter) must keep compiling and
 * keep working: a world detects the joint seam structurally and refuses
 * `addJoint` when it is absent, instead of requiring every adapter to grow
 * stubs. See {@link supportsSolverJointAccess}.
 *
 * ## The third seam: {@link SolverBodyTuningAccess} (PH-1 stage 2, 2026-08-07)
 *
 * {@link SolverBodyAccess} covers the state the world exchanges **every step**.
 * §37 also names "property changes" among what `syncSceneToSolver` carries, and
 * until this seam existed there was nothing to carry them with: a `mass`,
 * `linearDamping`, `gravityScale`, or `ccdMode` written after `createBody`
 * reached no solver, and neither did a collider's §25 material or its §24
 * filter. {@link SolverBodyTuningAccess} is those six writes, and it is a
 * **separate, structurally detected** interface for exactly the three reasons
 * {@link supportsSolverJointAccess} lists — an adapter that implements none of
 * it stays a legal `PhysicsWorldAdapter`, and the engine tells the difference
 * by looking rather than by being told. See {@link supportsSolverBodyTuning}.
 *
 * The world drains a per-component dirty set into these methods at the top of
 * the step, before {@link SolverBodyAccess.applyForce} and the kinematic feed,
 * so a property change is in force for the step that follows it. A body nobody
 * wrote to costs zero calls.
 *
 * This module is **types plus four structural predicates** — the predicates are
 * the only runtime code it ships. `FakeSolverAdapter` (`tests/fake-adapter.ts`)
 * is the structural double that proves the interfaces are implementable without
 * a solver; `Rapier2dAdapter` is the first real implementor of
 * {@link SolverBodyAccess}, whose own `RapierBodyAccess` it mirrors member for
 * member.
 */

import type { Matrix3, Quaternion, Vector3 } from "@four/math";

import type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsJointHandle,
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

  /**
   * Re-types a body **in place** — §22's four simulation models, swapped on a
   * body that already exists (plan P7-3).
   *
   * ## In place, and why that is the whole point
   *
   * The body keeps its handle, its monotonic {@link SolverBodyAccess.getBodyId}
   * id, its position in {@link SolverBodyAccess.forEachBody}'s sequence, its
   * colliders, and its mass properties. Nothing is destroyed and nothing is
   * created, so §33's checksum stream is taken over the same bodies in the same
   * order before and after the switch: two runs that differ only in *when* a
   * body was re-typed still hash identically up to that step. Destroying and
   * re-creating the body would append a new id and permute nothing but would
   * still change the id set, which is exactly what §33 forbids a mid-run
   * control-mode change from doing.
   *
   * ## What the solver keeps and what it drops
   *
   * The pose survives every transition — a body re-typed while falling is
   * exactly where it was. Velocities are a solver's business: a body switched
   * away from `"dynamic"` stops integrating, and a body switched *to*
   * `"dynamic"` resumes from whatever velocity state it holds, which is usually
   * zero. `PhysicsWorld.setBodyControlMode` is where §19's velocity inheritance
   * seeds that (an activated ragdoll continues the motion its animation had),
   * through {@link SolverBodyAccess.setBodyVelocities}; this method never
   * invents a velocity of its own.
   *
   * ## `wake`
   *
   * `true` (the default, as on {@link SolverBodyAccess.setBodyTransform})
   * wakes a sleeping body, so a body activated into `"dynamic"` starts
   * simulating on the next step instead of staying asleep at the pose it fell
   * asleep in. `false` leaves the §32 sleep state exactly as it was.
   *
   * Re-typing to the type the body already has is a legal no-op apart from
   * `wake`.
   */
  setBodyType(handle: PhysicsBodyHandle, type: BodyType, wake?: boolean): void;

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

  /**
   * Reads the body's **world-space** centre of mass into `out` (§25).
   *
   * As the solver holds it after mass-property resolution — collider offsets,
   * densities, and authored overrides included — not a re-derivation. The
   * centre of mass differs from the transform origin for any off-centre or
   * compound body, which is exactly when a caller wants it: §113's
   * centre-of-mass display was staged on the absence of this member
   * (`DEBUG_DRAW_STAGED`, 2026-08-02) and unblocked by it (2026-08-04).
   *
   * In a `"2d"` world `out.z` is `0` (§21). Rapier serves this directly
   * (`RigidBody.worldCom()`, verified against the installed 0.19.3 typings,
   * WP-10.3).
   */
  getBodyCenterOfMass(handle: PhysicsBodyHandle, out: Vector3): void;

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

/**
 * The **post-registration property writes** §37 names and
 * {@link SolverBodyAccess} leaves out (§23, §24, §25, §31; PH-1 stage 2,
 * 2026-08-07).
 *
 * ## What it is for
 *
 * Everything in {@link SolverBodyAccess} is per-step traffic: pose, velocity,
 * forces, sleep. The six methods here are the *rare* writes — a mass that
 * changed, a damping coefficient a tuning slider moved, a collider that became
 * a sensor. They are called only for a component that was actually written to
 * since the last step, so an adapter may implement them without any concern for
 * per-step cost.
 *
 * ## Optional, and honest about it
 *
 * An adapter implements **all six or none**: `supportsSolverBodyTuning` is a
 * structural all-or-nothing check, so a half-implemented seam is treated as
 * absent rather than producing writes that reach the solver for two properties
 * out of six. A world whose adapter does not implement it keeps `RigidBody`'s
 * warn-once machinery on (see the truth table at the top of `rigid-body.ts`):
 * the write is refused loudly instead of being dropped, which is the
 * `PhysicsTuningCapabilities` rule applied to a whole seam.
 *
 * ## `wake`
 *
 * Where a method takes `wake`, `true` (the default, as everywhere else on this
 * seam) wakes a sleeping body so the new property is felt on the next step;
 * `false` leaves §32 sleep state alone. The two collider methods take none:
 * Rapier's collider setters do not touch the parent body's sleep state, and
 * inventing a wake here would make a filter change move a body.
 */
export interface SolverBodyTuningAccess {
  /**
   * Replaces §23's **mass triple** — mass, centre of mass, rotational inertia —
   * on a body that already exists.
   *
   * `mass` is in kilograms and is always defined: "derive my mass from collider
   * density again" is *not* expressible here, because undoing an authored mass
   * means restoring every collider's own density, which only the registration
   * path knows (see `PhysicsWorld`'s drain, which never queues an un-authoring).
   *
   * `centerOfMass` (body-local metres) and `inertiaTensor` are `undefined` when
   * the component never authored them, which is §23's instruction to derive
   * *those two* from the colliders and the new mass — not an instruction to use
   * the origin and the identity tensor. An implementor must reproduce whatever
   * its `createBody` does for the same combination, so that writing `mass` and
   * re-registering the body give the same simulation.
   *
   * In a `"2d"` world only the tensor's Z diagonal entry is meaningful (§21,
   * §23).
   *
   * Neither vector nor the tensor is retained: both are the component's own
   * live objects, and an adapter that keeps a reference would alias them.
   */
  setBodyMassProperties(
    handle: PhysicsBodyHandle,
    mass: number,
    centerOfMass: Vector3 | undefined,
    inertiaTensor: Matrix3 | undefined,
    wake?: boolean,
  ): void;

  /** Replaces §23's two damping coefficients, both `>= 0`. */
  setBodyDamping(
    handle: PhysicsBodyHandle,
    linear: number,
    angular: number,
  ): void;

  /** Replaces §23's gravity multiplier: `1` leaves gravity as-is, `0` is weightless. */
  setBodyGravityScale(
    handle: PhysicsBodyHandle,
    scale: number,
    wake?: boolean,
  ): void;

  /**
   * Selects §31's continuous-collision method on a live body.
   *
   * `predictionDistance` is `"speculative"`'s prediction distance in world
   * units, `undefined` for the adapter's documented default; it is ignored for
   * every other mode. `"disabled"` must turn off whatever the body was using,
   * which is what makes this reversible.
   */
  setBodyCcdMode(
    handle: PhysicsBodyHandle,
    mode: CCDMode,
    predictionDistance?: number,
  ): void;

  /**
   * Replaces a collider's §25 surface properties.
   *
   * `friction` and `restitution` are the *effective* coefficients the engine
   * resolved from the collider's own fields and its `PhysicsMaterial` — an
   * adapter never re-runs that precedence. `density` is `undefined` when the
   * body's mass is not derived from collider density, in which case the
   * implementor must leave the collider's mass contribution exactly as it is:
   * writing a density into a body whose mass was authored would silently
   * un-author it.
   *
   * §25's `rollingFriction` and `spinningFriction` are deliberately absent —
   * they are declared through `PhysicsTuningCapabilities` (PH-14/PH-15) and
   * neither shipped adapter applies them, so a parameter here would be a
   * promise no implementor keeps.
   */
  setColliderMaterial(
    handle: PhysicsColliderHandle,
    friction: number,
    restitution: number,
    density: number | undefined,
  ): void;

  /**
   * Replaces a collider's §24 participation: whether it is a sensor, the bit
   * set of groups it belongs to, and the bit set it collides with.
   *
   * Both bit sets are 16-bit masks (§24). Turning a collider into a sensor
   * mid-simulation changes which §29 events it emits from the next step on;
   * pairs that were already touching are re-classified by the engine, not here.
   */
  setColliderFilter(
    handle: PhysicsColliderHandle,
    sensor: boolean,
    collisionGroups: number,
    collisionMask: number,
  ): void;
}

/**
 * A motor as the solver receives it (§28 "motors"), with the units the joint's
 * own degree of freedom implies.
 *
 * One record for both kinds, because the joint type already says which it is:
 * on a revolute joint the rate is rad/s and the effort is newton-metres, on a
 * prismatic joint they are m/s and newtons. The public
 * `AngularJointMotor.maxTorque` / `LinearJointMotor.maxForce` both resolve to
 * {@link SolverJointMotor.maxEffort} here, which is what stops the seam from
 * needing two near-identical methods.
 */
export interface SolverJointMotor {
  /** Whether the motor drives the joint. A disabled motor exerts nothing. */
  readonly enabled: boolean;

  /** Target rate: radians per second, or metres per second (§7a). */
  readonly targetVelocity: number;

  /**
   * Largest effort the motor may apply: newton-metres, or newtons. `>= 0`.
   *
   * Solver caveat (recorded at the Phase 6 exit): Rapier 0.19.3 exposes no
   * JS-reachable motor-force ceiling, so both Rapier adapters supply this as
   * a `ForceBased` gain — effort ≈ `maxEffort · (target − current)` — which
   * is monotone in strength but not §28's hard cap. Adapters that do cap
   * (e.g. Box2D's `maxMotorTorque`) may honour it literally; see each
   * adapter's `setJointMotor` documentation.
   */
  readonly maxEffort: number;
}

/**
 * What `PhysicsWorld` needs from a solver joint by joint (§28, §33, §37; plan
 * P6-1, P6-2).
 *
 * See the module header for why this is separate from `PhysicsSolverAdapter`
 * *and* from {@link SolverBodyAccess}. Everything
 * {@link SolverBodyAccess} owes — handles are the adapter's own, reads take
 * `out` parameters, ids are monotonic and never reused, no user callbacks, no
 * clock — applies here unchanged.
 *
 * ## Reactions are impulses (decision, WP-6.1)
 *
 * {@link SolverJointAccess.getJointReaction} reports the **impulse** the
 * constraint applied during the last step, in newton-seconds and
 * newton-metre-seconds, because that is what a constraint solver actually
 * accumulates — a force would be a number the adapter had to invent a delta
 * for. `PhysicsWorld` divides by its own fixed delta to get the newtons and
 * newton-metres §28's break thresholds are stated in, which keeps the
 * conversion in one place and makes it visible.
 *
 * An adapter whose solver cannot report reactions declares
 * {@link SolverJointAccess.reportsJointReactions} `false` and is never asked;
 * the world then **refuses** a joint carrying a break threshold rather than
 * accepting one it can never enforce (plan P6-2: "if unavailable, breakage is
 * staged with a dated note, not faked"). Rapier 0.19.3's JavaScript bindings
 * expose no joint reaction (verified against the installed typings, WP-6.1);
 * WP-6.2/6.3 confirm that against the wasm and report honestly.
 */
export interface SolverJointAccess {
  /**
   * Whether {@link SolverJointAccess.getJointReaction} reports anything real.
   *
   * Declared, not discovered: a world checks it when a breakable joint is
   * registered, so an adapter that cannot report reactions fails the
   * registration loudly instead of silently never breaking a joint.
   */
  readonly reportsJointReactions: boolean;

  /**
   * Reads the constraint impulses the last `step` applied through this joint,
   * in world space (§28's break force and break torque; plan P6-2).
   *
   * `outLinear` is in newton-seconds and `outAngular` in newton-metre-seconds —
   * see the interface header for why impulses and not forces. Both are written
   * (§7b, plan D7); nothing is allocated. Only ever called when
   * {@link SolverJointAccess.reportsJointReactions} is `true`.
   */
  getJointReaction(
    handle: PhysicsJointHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void;

  /**
   * Reconfigures a joint's travel limits after creation (§28 "limits").
   *
   * Radians for a revolute joint, metres for a prismatic one, with
   * `min <= max` already validated by the engine. Called at most once per
   * joint per fixed step, from the scene→solver phase, and only for a joint
   * whose class actually queued a change — a joint nobody touches costs
   * nothing.
   *
   * An adapter whose solver cannot re-limit the joint type in question must
   * throw a `FourError` naming the type rather than ignoring the command:
   * a limit that silently does not move is a wrong simulation.
   */
  setJointLimits(handle: PhysicsJointHandle, min: number, max: number): void;

  /**
   * Reconfigures a joint's motor after creation (§28 "motors"). Same call
   * discipline and same honesty requirement as
   * {@link SolverJointAccess.setJointLimits}.
   */
  setJointMotor(handle: PhysicsJointHandle, motor: SolverJointMotor): void;

  /**
   * Turns contact generation between the two joined bodies on or off after
   * creation (§28 `collisionEnabled`; PH-22f, 2026-08-08).
   *
   * The third of §28's live reconfigurations: Rapier's base `ImpulseJoint`
   * carries `setContactsEnabled` for **every** joint type in both dimensions.
   * Axis, rope length, spring terms and the spherical swing cone stay frozen
   * (see `joints.ts`'s table). Anchors are the fourth live write — see
   * {@link SolverJointAccess.setJointAnchors}.
   *
   * Same call discipline as {@link SolverJointAccess.setJointLimits}: at most
   * once per joint per fixed step, from the scene→solver phase, only for a
   * joint that queued the change.
   */
  setJointCollisionEnabled(handle: PhysicsJointHandle, enabled: boolean): void;

  /**
   * Replaces both body-local anchors after creation (§28, PH-22f).
   *
   * `anchorA` is in `bodyA`'s local frame and `anchorB` in `bodyB`'s — the
   * same space `createJoint` received after `PhysicsWorld.addJoint` converted
   * the world-space constructor options. The caller supplies local-space
   * points; this method must not re-measure against any pose.
   *
   * Rapier implements this as `ImpulseJoint.setAnchor1` / `setAnchor2`, which
   * exist on the base joint class in both dimensions, so every shipped §28
   * type can be re-anchored. Same call discipline as
   * {@link SolverJointAccess.setJointLimits}: at most once per joint per
   * fixed step, from the scene→solver phase, only for a joint that queued
   * the change.
   */
  setJointAnchors(
    handle: PhysicsJointHandle,
    anchorA: Vector3,
    anchorB: Vector3,
  ): void;

  /** The monotonic id this joint is registered and iterated under (§33). */
  getJointId(handle: PhysicsJointHandle): number;

  /**
   * Visits every live joint **in creation order**, which is ascending
   * {@link SolverJointAccess.getJointId} — the iteration §33 permits, for the
   * same reason {@link SolverBodyAccess.forEachBody} exists.
   */
  forEachJoint(visit: (handle: PhysicsJointHandle, id: number) => void): void;
}

/** The members {@link supportsSolverJointAccess} looks for, as a runtime list. */
const JOINT_ACCESS_METHODS = [
  "getJointReaction",
  "setJointLimits",
  "setJointMotor",
  "setJointCollisionEnabled",
  "setJointAnchors",
  "getJointId",
  "forEachJoint",
] as const satisfies readonly (keyof SolverJointAccess)[];

/**
 * Whether `adapter` implements {@link SolverJointAccess} — the **structural**
 * detection a world uses before it touches a joint (WP-6.1).
 *
 * Structural and not nominal, and not a capability flag, for three reasons:
 *
 * 1. `PhysicsCapabilities` (§37) is frozen at the six fields §37 lists, and
 *    adding a seventh would break every existing adapter's capability record at
 *    compile time — including the two Rapier adapters, which must keep building
 *    while their joint support lands in WP-6.2/6.3.
 * 2. `PhysicsWorldAdapter` stays `PhysicsSolverAdapter & SolverBodyAccess`, so
 *    an adapter with no joints is still a legal world adapter and every Phase 5
 *    world keeps working untouched.
 * 3. A structural check cannot disagree with reality the way a declaration can:
 *    an adapter that says it has joints but has no `getJointId` fails here, at
 *    `addJoint`, with a message naming the members it is missing.
 *
 * `capabilities.jointTypes` remains the declaration of *which* §28 types an
 * adapter builds; this predicate answers the prior question of whether the
 * engine can talk to its joints at all.
 */
export function supportsSolverJointAccess(
  adapter: object,
): adapter is SolverJointAccess {
  const candidate = adapter as Partial<SolverJointAccess>;
  if (typeof candidate.reportsJointReactions !== "boolean") {
    return false;
  }
  return JOINT_ACCESS_METHODS.every(
    (method) => typeof candidate[method] === "function",
  );
}

/**
 * The members of {@link SolverJointAccess} that `adapter` does **not**
 * implement, in declaration order — the detail
 * {@link supportsSolverJointAccess}'s `false` leaves out, and what
 * `PhysicsWorld.addJoint` puts in its error message.
 */
export function missingSolverJointAccess(adapter: object): string[] {
  const candidate = adapter as Partial<SolverJointAccess>;
  const missing: string[] = [];
  if (typeof candidate.reportsJointReactions !== "boolean") {
    missing.push("reportsJointReactions");
  }
  for (const method of JOINT_ACCESS_METHODS) {
    if (typeof candidate[method] !== "function") {
      missing.push(method);
    }
  }
  return missing;
}

/** The members {@link supportsSolverBodyTuning} looks for, as a runtime list. */
const BODY_TUNING_METHODS = [
  "setBodyMassProperties",
  "setBodyDamping",
  "setBodyGravityScale",
  "setBodyCcdMode",
  "setColliderMaterial",
  "setColliderFilter",
] as const satisfies readonly (keyof SolverBodyTuningAccess)[];

/**
 * Whether `adapter` implements {@link SolverBodyTuningAccess} — the
 * **structural** detection a world runs once, at construction, before it
 * promises anyone that a property write reaches the solver (PH-1 stage 2).
 *
 * Structural for the three reasons {@link supportsSolverJointAccess} gives, and
 * **all-or-nothing** for a fourth: the alternative — six independent capability
 * bits — would let an adapter honour `setBodyDamping` and drop
 * `setBodyMassProperties`, so the engine would have to keep a per-property warn
 * table and `RigidBody` would have to consult it from six setters. Six methods
 * are a small enough surface that "implement the seam or do not" costs an
 * adapter author nothing and costs the engine one boolean.
 *
 * `PhysicsCapabilities.tuning` (`PhysicsTuningCapabilities`) stays the
 * declaration of which §25/§32 *coefficients* an adapter applies at all; this
 * predicate answers the prior question of whether a value can be changed after
 * `createBody`.
 */
export function supportsSolverBodyTuning(
  adapter: object,
): adapter is SolverBodyTuningAccess {
  const candidate = adapter as Partial<SolverBodyTuningAccess>;
  return BODY_TUNING_METHODS.every(
    (method) => typeof candidate[method] === "function",
  );
}

/**
 * The members of {@link SolverBodyTuningAccess} that `adapter` does **not**
 * implement, in declaration order — the detail
 * {@link supportsSolverBodyTuning}'s `false` leaves out, and what
 * `PhysicsWorld` puts in the warning that tells a caller why a property write
 * stopped at the component.
 */
export function missingSolverBodyTuning(adapter: object): string[] {
  const candidate = adapter as Partial<SolverBodyTuningAccess>;
  return BODY_TUNING_METHODS.filter(
    (method) => typeof candidate[method] !== "function",
  );
}
