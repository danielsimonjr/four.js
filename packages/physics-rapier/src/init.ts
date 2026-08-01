/**
 * Shared loading of the Rapier WebAssembly modules, and the typed view of them
 * this package programs against.
 *
 * `PhysicsSolverAdapter.initialize` (§37) is allowed to return a promise
 * precisely so a WebAssembly-backed solver can load its module there. Rapier
 * ships as wasm, so every adapter in this package has to await that load before
 * it may touch a single Rapier class — and several adapters (and several worlds
 * on one adapter) must be able to await the *same* load rather than each
 * decoding the module again.
 *
 * This module is that one load, **per dimension**: {@link initializeRapier2d}
 * for `@dimforge/rapier2d-compat` and {@link initializeRapier3d} for
 * `@dimforge/rapier3d-compat`, each with its own cache. The two Rapier builds
 * are separate npm packages with separate wasm images, so they cannot share one
 * promise; loading one does not load the other, and an application that only
 * ever creates a `"2d"` world never decodes the 3D image.
 *
 * ## Why the Rapier surface is re-declared below
 *
 * **This is a workaround for a real defect in the dependency, not a preference,
 * and it should be deleted the moment the defect is worked around at the
 * toolchain level.**
 *
 * `@dimforge/rapier2d-compat@0.19.3` and `@dimforge/rapier3d-compat@0.19.3`
 * declare `"type": "module"` and their own
 * `.d.ts` files import each other **without file extensions**
 * (`rapier.d.ts` does `export * from "./exports"`). Under the repository's
 * `module`/`moduleResolution: NodeNext` baseline (§91, plan §1 rule 7), ESM
 * resolution does not add extensions and does not do directory-index lookups,
 * so `./exports` fails to resolve and the package's public types collapse to
 * nothing:
 *
 * ```text
 * error TS2614: Module '"@dimforge/rapier2d-compat"' has no exported member 'ColliderDesc'.
 * error TS2339: Property 'World' does not exist on type 'typeof import("…/rapier")'.
 * ```
 *
 * (Verified by `--traceResolution`; the same files resolve perfectly under
 * `moduleResolution: bundler`, which is the standard fix and which this packet
 * may not apply — it would have to change `tsconfig.base.json` or the package's
 * own tsconfigs, neither of which is in WP-5.4's file list.)
 *
 * The alternative to re-declaring is importing the module as `any`, which would
 * turn every one of the ~140 Rapier calls in this package into an unchecked
 * call. The interfaces below are therefore transcribed **from the installed
 * `0.19.3` declaration files**, member for member, with the source file named on
 * each block, and they cover only what this package actually calls. Every one of
 * them is exercised by the test suite against the real wasm, so a transcription
 * error surfaces as a failing test rather than as a silent wrong simulation.
 *
 * The 2D and 3D surfaces are transcribed **separately** rather than shared with
 * a generic parameter. They genuinely differ, and not only in the width of a
 * vector: 3D rotations are quaternions where 2D rotations are scalars, 3D
 * angular velocity and torque are vectors where 2D's are scalars, and 3D's
 * `setAdditionalMassProperties` takes a principal-inertia *vector* plus a frame
 * where 2D's takes one number. A shared surface would have to be loose enough to
 * type both, which would defeat the point of transcribing anything.
 *
 * ## Other things verified against the installed 0.19.3, not from memory
 *
 * Both builds behave identically here — the 3D column was re-verified for
 * WP-5.5 rather than assumed:
 *
 * - `init()` takes **no arguments** (`init.length === 0`) and returns
 *   `Promise<void>`. Plan P5-1's note about "the object-form argument" applies
 *   to the raw wasm-bindgen entry point of the *non*-compat builds; the
 *   `-compat` package wraps it and passes the decoded base64 bytes itself, so
 *   there is nothing for a caller to pass. The `"using deprecated parameters
 *   for the initialization function; pass a single object instead"` warning the
 *   first `init()` prints is emitted **inside** the `-compat` package and
 *   cannot be suppressed from outside it. It appears at most once per process
 *   and per build.
 * - `version()` reads the version string **out of the wasm module** and throws a
 *   `TypeError` when called before `init()`. That is why
 *   {@link rapier2dVersion} and {@link rapier3dVersion} answer `undefined`
 *   rather than a placeholder: this package never invents a version number for
 *   §34's snapshot validity key.
 */

import * as RAPIER2D_UNTYPED from "@dimforge/rapier2d-compat";
import * as RAPIER3D_UNTYPED from "@dimforge/rapier3d-compat";

/* ------------------------------------------------------------------------- *
 * Transcribed Rapier 2D surface — see the module header for why this exists. *
 * ------------------------------------------------------------------------- */

/** `math.d.ts`: the `{ x, y }` shape every Rapier 2D entry point accepts. */
export interface RapierVector {
  x: number;
  y: number;
}

/**
 * `dynamics/rigid_body.d.ts`: `RigidBodyType`, as a numeric enum.
 *
 * Transcribed values: `Dynamic = 0`, `Fixed = 1`, `KinematicPositionBased = 2`,
 * `KinematicVelocityBased = 3`.
 */
export interface RapierRigidBodyTypes {
  readonly Dynamic: number;
  readonly Fixed: number;
  readonly KinematicPositionBased: number;
  readonly KinematicVelocityBased: number;
}

/** `pipeline/event_queue.d.ts`: `ActiveEvents` (`NONE`, `COLLISION_EVENTS`, `CONTACT_FORCE_EVENTS`). */
export interface RapierActiveEvents {
  readonly NONE: number;
  readonly COLLISION_EVENTS: number;
  readonly CONTACT_FORCE_EVENTS: number;
}

/** `geometry/collider.d.ts`: `ActiveCollisionTypes` — only `DEFAULT` and `ALL` are used. */
export interface RapierActiveCollisionTypes {
  readonly DEFAULT: number;
  readonly ALL: number;
}

/** `dynamics/coefficient_combine_rule.d.ts`: `Average = 0`, `Min = 1`, `Multiply = 2`, `Max = 3`. */
export interface RapierCoefficientCombineRules {
  readonly Average: number;
  readonly Min: number;
  readonly Multiply: number;
  readonly Max: number;
}

/** `geometry/shape.d.ts`: a shape instance, opaque to this package. */
export type RapierShape = object;

/** `geometry/point.d.ts`: `PointProjection` / `PointColliderProjection`. */
export interface RapierPointProjection {
  readonly point: RapierVector;
  readonly isInside: boolean;
}

/** `geometry/ray.d.ts`: `Ray`. */
export interface RapierRay {
  readonly origin: RapierVector;
  readonly dir: RapierVector;
}

/** `geometry/ray.d.ts`: `RayColliderIntersection` (a hit plus its normal). */
export interface RapierRayColliderIntersection {
  readonly collider: RapierCollider;
  readonly timeOfImpact: number;
  readonly normal: RapierVector;
}

/** `geometry/toi.d.ts`: `ColliderShapeCastHit`. `time_of_impact` is snake_case upstream. */
export interface RapierColliderShapeCastHit {
  readonly collider: RapierCollider;
  readonly time_of_impact: number;
  readonly witness1: RapierVector;
  readonly witness2: RapierVector;
  readonly normal1: RapierVector;
  readonly normal2: RapierVector;
}

/** `dynamics/rigid_body.d.ts`: the members of `RigidBody` this package calls. */
export interface RapierRigidBody {
  readonly handle: number;
  translation(): RapierVector;
  rotation(): number;
  linvel(): RapierVector;
  angvel(): number;
  mass(): number;
  principalInertia(): number;
  gravityScale(): number;
  linearDamping(): number;
  angularDamping(): number;
  bodyType(): number;
  isSleeping(): boolean;
  isCcdEnabled(): boolean;
  softCcdPrediction(): number;
  velocityAtPoint(point: RapierVector): RapierVector;
  setTranslation(translation: RapierVector, wakeUp: boolean): void;
  setRotation(angle: number, wakeUp: boolean): void;
  setLinvel(velocity: RapierVector, wakeUp: boolean): void;
  setAngvel(velocity: number, wakeUp: boolean): void;
  setNextKinematicTranslation(translation: RapierVector): void;
  setNextKinematicRotation(angle: number): void;
  addForce(force: RapierVector, wakeUp: boolean): void;
  addForceAtPoint(
    force: RapierVector,
    point: RapierVector,
    wakeUp: boolean,
  ): void;
  addTorque(torque: number, wakeUp: boolean): void;
  applyImpulse(impulse: RapierVector, wakeUp: boolean): void;
  applyImpulseAtPoint(
    impulse: RapierVector,
    point: RapierVector,
    wakeUp: boolean,
  ): void;
  applyTorqueImpulse(torqueImpulse: number, wakeUp: boolean): void;
  resetForces(wakeUp: boolean): void;
  resetTorques(wakeUp: boolean): void;
  wakeUp(): void;
  sleep(): void;
  recomputeMassPropertiesFromColliders(): void;
}

/** `dynamics/rigid_body.d.ts`: the fluent `RigidBodyDesc` setters this package calls. */
export interface RapierRigidBodyDesc {
  setTranslation(x: number, y: number): RapierRigidBodyDesc;
  setRotation(rotation: number): RapierRigidBodyDesc;
  setLinvel(x: number, y: number): RapierRigidBodyDesc;
  setAngvel(velocity: number): RapierRigidBodyDesc;
  setLinearDamping(damping: number): RapierRigidBodyDesc;
  setAngularDamping(damping: number): RapierRigidBodyDesc;
  setGravityScale(scale: number): RapierRigidBodyDesc;
  setCanSleep(canSleep: boolean): RapierRigidBodyDesc;
  setCcdEnabled(enabled: boolean): RapierRigidBodyDesc;
  setSoftCcdPrediction(distance: number): RapierRigidBodyDesc;
  setAdditionalMassProperties(
    mass: number,
    centerOfMass: RapierVector,
    principalAngularInertia: number,
  ): RapierRigidBodyDesc;
}

/** `geometry/collider.d.ts`: the members of `Collider` this package calls. */
export interface RapierCollider {
  readonly handle: number;
  translation(): RapierVector;
  rotation(): number;
  isSensor(): boolean;
  friction(): number;
  restitution(): number;
  density(): number;
  mass(): number;
  collisionGroups(): number;
  projectPoint(
    point: RapierVector,
    solid: boolean,
  ): RapierPointProjection | null;
}

/** `geometry/collider.d.ts`: the fluent `ColliderDesc` setters this package calls. */
export interface RapierColliderDesc {
  setTranslation(x: number, y: number): RapierColliderDesc;
  setRotation(rotation: number): RapierColliderDesc;
  setSensor(sensor: boolean): RapierColliderDesc;
  setDensity(density: number): RapierColliderDesc;
  setMass(mass: number): RapierColliderDesc;
  setFriction(friction: number): RapierColliderDesc;
  setRestitution(restitution: number): RapierColliderDesc;
  setFrictionCombineRule(rule: number): RapierColliderDesc;
  setRestitutionCombineRule(rule: number): RapierColliderDesc;
  setCollisionGroups(groups: number): RapierColliderDesc;
  setActiveEvents(activeEvents: number): RapierColliderDesc;
  setActiveCollisionTypes(activeCollisionTypes: number): RapierColliderDesc;
}

/** `pipeline/event_queue.d.ts`: the members of `EventQueue` this package calls. */
export interface RapierEventQueue {
  drainCollisionEvents(
    handler: (handle1: number, handle2: number, started: boolean) => void,
  ): void;
  clear(): void;
  free(): void;
}

/** `geometry/narrow_phase.d.ts`: `TempContactManifold`, the §29 contact source. */
export interface RapierContactManifold {
  normal(): RapierVector;
  numContacts(): number;
  localContactPoint1(index: number): RapierVector | null;
  localContactPoint2(index: number): RapierVector | null;
  contactDist(index: number): number;
  contactImpulse(index: number): number;
}

/** `geometry/narrow_phase.d.ts`: the members of `NarrowPhase` this package calls. */
export interface RapierNarrowPhase {
  contactPair(
    collider1: number,
    collider2: number,
    handler: (manifold: RapierContactManifold, flipped: boolean) => void,
  ): void;
  contactPairsWith(
    collider1: number,
    handler: (collider2: number) => void,
  ): void;
  intersectionPairsWith(
    collider1: number,
    handler: (collider2: number) => void,
  ): void;
  intersectionPair(collider1: number, collider2: number): boolean;
}

/** `pipeline/world.d.ts`: the members of `World` this package calls. */
export interface RapierWorld {
  timestep: number;
  readonly numSolverIterations: number;
  readonly narrowPhase: RapierNarrowPhase;
  free(): void;
  step(eventQueue?: RapierEventQueue): void;
  takeSnapshot(): Uint8Array;
  createRigidBody(desc: RapierRigidBodyDesc): RapierRigidBody;
  createCollider(
    desc: RapierColliderDesc,
    parent?: RapierRigidBody,
  ): RapierCollider;
  getRigidBody(handle: number): RapierRigidBody;
  getCollider(handle: number): RapierCollider;
  removeRigidBody(body: RapierRigidBody): void;
  removeCollider(collider: RapierCollider, wakeUp: boolean): void;
  castRayAndGetNormal(
    ray: RapierRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider,
    filterExcludeRigidBody?: RapierRigidBody,
    filterPredicate?: (collider: RapierCollider) => boolean,
  ): RapierRayColliderIntersection | null;
  intersectionsWithRay(
    ray: RapierRay,
    maxToi: number,
    solid: boolean,
    callback: (intersection: RapierRayColliderIntersection) => boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider,
    filterExcludeRigidBody?: RapierRigidBody,
    filterPredicate?: (collider: RapierCollider) => boolean,
  ): void;
  castShape(
    shapePosition: RapierVector,
    shapeRotation: number,
    shapeVelocity: RapierVector,
    shape: RapierShape,
    targetDistance: number,
    maxToi: number,
    stopAtPenetration: boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider,
    filterExcludeRigidBody?: RapierRigidBody,
    filterPredicate?: (collider: RapierCollider) => boolean,
  ): RapierColliderShapeCastHit | null;
  intersectionsWithShape(
    shapePosition: RapierVector,
    shapeRotation: number,
    shape: RapierShape,
    callback: (collider: RapierCollider) => boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider,
    filterExcludeRigidBody?: RapierRigidBody,
    filterPredicate?: (collider: RapierCollider) => boolean,
  ): void;
  intersectionsWithPoint(
    point: RapierVector,
    callback: (collider: RapierCollider) => boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider,
    filterExcludeRigidBody?: RapierRigidBody,
    filterPredicate?: (collider: RapierCollider) => boolean,
  ): void;
}

/**
 * The Rapier 2D module namespace, once {@link initializeRapier2d} has resolved
 * — the constructors, statics, and enums this package uses.
 */
export interface Rapier2dModule {
  init(): Promise<void>;
  version(): string;
  readonly RigidBodyType: RapierRigidBodyTypes;
  readonly ActiveEvents: RapierActiveEvents;
  readonly ActiveCollisionTypes: RapierActiveCollisionTypes;
  readonly CoefficientCombineRule: RapierCoefficientCombineRules;
  readonly World: {
    new (gravity: RapierVector): RapierWorld;
    restoreSnapshot(data: Uint8Array): RapierWorld;
  };
  readonly EventQueue: new (autoDrain: boolean) => RapierEventQueue;
  readonly RigidBodyDesc: new (status: number) => RapierRigidBodyDesc;
  readonly ColliderDesc: {
    ball(radius: number): RapierColliderDesc;
    cuboid(halfWidth: number, halfHeight: number): RapierColliderDesc;
    capsule(halfHeight: number, radius: number): RapierColliderDesc;
    convexHull(points: Float32Array): RapierColliderDesc | null;
  };
  readonly Ray: new (origin: RapierVector, dir: RapierVector) => RapierRay;
  readonly Ball: new (radius: number) => RapierShape;
  readonly Cuboid: new (halfWidth: number, halfHeight: number) => RapierShape;
  readonly Capsule: new (halfHeight: number, radius: number) => RapierShape;
  readonly ConvexPolygon: new (
    vertices: Float32Array,
    skipConvexHullComputation: boolean,
  ) => RapierShape;
}

/**
 * The Rapier 2D namespace under the transcribed types.
 *
 * Not part of the package barrel: it is the typed view the other modules in
 * this package share, and it is **only valid once {@link initializeRapier2d}
 * has resolved** — every member traps into wasm.
 */
export const RAPIER_2D = RAPIER2D_UNTYPED as unknown as Rapier2dModule;

/* ------------------------------------------------------------------------- *
 * Loading                                                                    *
 * ------------------------------------------------------------------------- */

/** The in-flight or completed load; `undefined` before the first call. */
let loadPromise: Promise<Rapier2dModule> | undefined;

/** The module once its wasm is live — the flag {@link rapier2dVersion} reads. */
let loadedModule: Rapier2dModule | undefined;

/**
 * Loads the Rapier 2D wasm module once and returns the initialized namespace.
 *
 * Idempotent: concurrent and later callers receive the same promise, so the
 * base64 image is decoded exactly once per process no matter how many adapters
 * or worlds are created.
 *
 * ```ts
 * const rapier = await initializeRapier2d();
 * const world = new rapier.World({ x: 0, y: -9.81 });
 * ```
 *
 * A failed load is **not** cached: the promise is cleared before the rejection
 * propagates, so a caller that retries after a transient failure gets a fresh
 * attempt rather than the same rejected promise forever.
 */
export function initializeRapier2d(): Promise<Rapier2dModule> {
  loadPromise ??= RAPIER_2D.init().then(
    () => {
      loadedModule = RAPIER_2D;
      return RAPIER_2D;
    },
    (error: unknown) => {
      loadPromise = undefined;
      throw error;
    },
  );
  return loadPromise;
}

/**
 * The initialized Rapier 2D module, or `undefined` while it is still loading.
 *
 * For code that must stay synchronous — a `readonly` property on an adapter, a
 * diagnostic dump — and does not want to force a load it cannot await.
 */
export function rapier2dModule(): Rapier2dModule | undefined {
  return loadedModule;
}

/**
 * The version string Rapier itself reports, or `undefined` before the module is
 * initialized.
 *
 * The value comes from the wasm module (`0.19.3` for the pinned build), not from
 * a constant in this repository: §34 makes the adapter version part of a
 * snapshot's validity key, and a hardcoded number would keep looking right after
 * the dependency moved.
 */
export function rapier2dVersion(): string | undefined {
  return loadedModule?.version();
}

/* ------------------------------------------------------------------------- *
 * Transcribed Rapier 3D surface — see the module header for why this exists. *
 * ------------------------------------------------------------------------- */

/** `math.d.ts`: the `{ x, y, z }` shape every Rapier 3D entry point accepts. */
export interface RapierVector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * `math.d.ts`: `Rotation` — the `{ x, y, z, w }` quaternion Rapier 3D uses
 * wherever Rapier 2D uses a scalar angle.
 */
export interface RapierRotation3 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * `dynamics/rigid_body.d.ts`: `RigidBodyType`, as a numeric enum.
 *
 * Transcribed values: `Dynamic = 0`, `Fixed = 1`, `KinematicPositionBased = 2`,
 * `KinematicVelocityBased = 3` — the same four values, in the same order, as the
 * 2D build (verified against the installed 3D `.d.ts`, not assumed).
 */
export interface RapierRigidBodyTypes3d {
  readonly Dynamic: number;
  readonly Fixed: number;
  readonly KinematicPositionBased: number;
  readonly KinematicVelocityBased: number;
}

/** `pipeline/event_queue.d.ts`: `ActiveEvents` (`NONE = 0`, `COLLISION_EVENTS = 1`, `CONTACT_FORCE_EVENTS = 2`). */
export interface RapierActiveEvents3d {
  readonly NONE: number;
  readonly COLLISION_EVENTS: number;
  readonly CONTACT_FORCE_EVENTS: number;
}

/**
 * `geometry/collider.d.ts`: `ActiveCollisionTypes` — only `DEFAULT` and `ALL`
 * are used. `DEFAULT = 15` and `ALL = 60943` in the 3D build, and `DEFAULT`
 * excludes the kinematic-vs-fixed pair exactly as it does in 2D (verified: a
 * fixed sensor sees a kinematic body only once `ALL` is set).
 */
export interface RapierActiveCollisionTypes3d {
  readonly DEFAULT: number;
  readonly ALL: number;
}

/** `dynamics/coefficient_combine_rule.d.ts`: `Average = 0`, `Min = 1`, `Multiply = 2`, `Max = 3`. */
export interface RapierCoefficientCombineRules3d {
  readonly Average: number;
  readonly Min: number;
  readonly Multiply: number;
  readonly Max: number;
}

/** `geometry/shape.d.ts`: a shape instance, opaque to this package. */
export type RapierShape3d = object;

/** `geometry/point.d.ts`: `PointProjection` / `PointColliderProjection`. */
export interface RapierPointProjection3d {
  readonly point: RapierVector3;
  readonly isInside: boolean;
}

/** `geometry/ray.d.ts`: `Ray`. */
export interface RapierRay3d {
  readonly origin: RapierVector3;
  readonly dir: RapierVector3;
}

/** `geometry/ray.d.ts`: `RayColliderIntersection` (a hit plus its normal). */
export interface RapierRayColliderIntersection3d {
  readonly collider: RapierCollider3d;
  readonly timeOfImpact: number;
  readonly normal: RapierVector3;
}

/** `geometry/toi.d.ts`: `ColliderShapeCastHit`. `time_of_impact` is snake_case upstream. */
export interface RapierColliderShapeCastHit3d {
  readonly collider: RapierCollider3d;
  readonly time_of_impact: number;
  readonly witness1: RapierVector3;
  readonly witness2: RapierVector3;
  readonly normal1: RapierVector3;
  readonly normal2: RapierVector3;
}

/**
 * `dynamics/rigid_body.d.ts`: the members of `RigidBody` this package calls.
 *
 * Note the shapes that differ from the 2D build and are the whole reason this
 * interface is not a copy: `rotation()` and `setRotation` speak quaternions,
 * `angvel()`/`setAngvel`/`addTorque`/`applyTorqueImpulse` speak vectors, and
 * `principalInertia()` returns the three principal moments rather than one.
 */
export interface RapierRigidBody3d {
  readonly handle: number;
  translation(): RapierVector3;
  rotation(): RapierRotation3;
  linvel(): RapierVector3;
  angvel(): RapierVector3;
  mass(): number;
  principalInertia(): RapierVector3;
  principalInertiaLocalFrame(): RapierRotation3;
  gravityScale(): number;
  linearDamping(): number;
  angularDamping(): number;
  bodyType(): number;
  isSleeping(): boolean;
  isCcdEnabled(): boolean;
  softCcdPrediction(): number;
  velocityAtPoint(point: RapierVector3): RapierVector3;
  setTranslation(translation: RapierVector3, wakeUp: boolean): void;
  setRotation(rotation: RapierRotation3, wakeUp: boolean): void;
  setLinvel(velocity: RapierVector3, wakeUp: boolean): void;
  setAngvel(velocity: RapierVector3, wakeUp: boolean): void;
  setNextKinematicTranslation(translation: RapierVector3): void;
  setNextKinematicRotation(rotation: RapierRotation3): void;
  addForce(force: RapierVector3, wakeUp: boolean): void;
  addForceAtPoint(
    force: RapierVector3,
    point: RapierVector3,
    wakeUp: boolean,
  ): void;
  addTorque(torque: RapierVector3, wakeUp: boolean): void;
  applyImpulse(impulse: RapierVector3, wakeUp: boolean): void;
  applyImpulseAtPoint(
    impulse: RapierVector3,
    point: RapierVector3,
    wakeUp: boolean,
  ): void;
  applyTorqueImpulse(torqueImpulse: RapierVector3, wakeUp: boolean): void;
  resetForces(wakeUp: boolean): void;
  resetTorques(wakeUp: boolean): void;
  wakeUp(): void;
  sleep(): void;
  recomputeMassPropertiesFromColliders(): void;
}

/**
 * `dynamics/rigid_body.d.ts`: the fluent `RigidBodyDesc` setters this package
 * calls.
 *
 * `setTranslation` and `setLinvel` take loose components (three numbers) while
 * `setRotation`, `setAngvel`, and `setAdditionalMassProperties` take objects —
 * that asymmetry is upstream's, transcribed as found.
 */
export interface RapierRigidBodyDesc3d {
  setTranslation(x: number, y: number, z: number): RapierRigidBodyDesc3d;
  setRotation(rotation: RapierRotation3): RapierRigidBodyDesc3d;
  setLinvel(x: number, y: number, z: number): RapierRigidBodyDesc3d;
  setAngvel(velocity: RapierVector3): RapierRigidBodyDesc3d;
  setLinearDamping(damping: number): RapierRigidBodyDesc3d;
  setAngularDamping(damping: number): RapierRigidBodyDesc3d;
  setGravityScale(scale: number): RapierRigidBodyDesc3d;
  setCanSleep(canSleep: boolean): RapierRigidBodyDesc3d;
  setCcdEnabled(enabled: boolean): RapierRigidBodyDesc3d;
  setSoftCcdPrediction(distance: number): RapierRigidBodyDesc3d;
  setAdditionalMassProperties(
    mass: number,
    centerOfMass: RapierVector3,
    principalAngularInertia: RapierVector3,
    angularInertiaLocalFrame: RapierRotation3,
  ): RapierRigidBodyDesc3d;
}

/** `geometry/collider.d.ts`: the members of `Collider` this package calls. */
export interface RapierCollider3d {
  readonly handle: number;
  translation(): RapierVector3;
  rotation(): RapierRotation3;
  isSensor(): boolean;
  friction(): number;
  restitution(): number;
  density(): number;
  mass(): number;
  collisionGroups(): number;
  projectPoint(
    point: RapierVector3,
    solid: boolean,
  ): RapierPointProjection3d | null;
}

/** `geometry/collider.d.ts`: the fluent `ColliderDesc` setters this package calls. */
export interface RapierColliderDesc3d {
  setTranslation(x: number, y: number, z: number): RapierColliderDesc3d;
  setRotation(rotation: RapierRotation3): RapierColliderDesc3d;
  setSensor(sensor: boolean): RapierColliderDesc3d;
  setDensity(density: number): RapierColliderDesc3d;
  setMass(mass: number): RapierColliderDesc3d;
  setFriction(friction: number): RapierColliderDesc3d;
  setRestitution(restitution: number): RapierColliderDesc3d;
  setFrictionCombineRule(rule: number): RapierColliderDesc3d;
  setRestitutionCombineRule(rule: number): RapierColliderDesc3d;
  setCollisionGroups(groups: number): RapierColliderDesc3d;
  setActiveEvents(activeEvents: number): RapierColliderDesc3d;
  setActiveCollisionTypes(activeCollisionTypes: number): RapierColliderDesc3d;
}

/** `pipeline/event_queue.d.ts`: the members of `EventQueue` this package calls. */
export interface RapierEventQueue3d {
  drainCollisionEvents(
    handler: (handle1: number, handle2: number, started: boolean) => void,
  ): void;
  clear(): void;
  free(): void;
}

/** `geometry/narrow_phase.d.ts`: `TempContactManifold`, the §29 contact source. */
export interface RapierContactManifold3d {
  normal(): RapierVector3;
  numContacts(): number;
  localContactPoint1(index: number): RapierVector3 | null;
  localContactPoint2(index: number): RapierVector3 | null;
  contactDist(index: number): number;
  contactImpulse(index: number): number;
}

/** `geometry/narrow_phase.d.ts`: the members of `NarrowPhase` this package calls. */
export interface RapierNarrowPhase3d {
  contactPair(
    collider1: number,
    collider2: number,
    handler: (manifold: RapierContactManifold3d, flipped: boolean) => void,
  ): void;
  contactPairsWith(
    collider1: number,
    handler: (collider2: number) => void,
  ): void;
  intersectionPairsWith(
    collider1: number,
    handler: (collider2: number) => void,
  ): void;
  intersectionPair(collider1: number, collider2: number): boolean;
}

/** `pipeline/world.d.ts`: the members of `World` this package calls. */
export interface RapierWorld3d {
  timestep: number;
  readonly numSolverIterations: number;
  readonly narrowPhase: RapierNarrowPhase3d;
  free(): void;
  step(eventQueue?: RapierEventQueue3d): void;
  takeSnapshot(): Uint8Array;
  createRigidBody(desc: RapierRigidBodyDesc3d): RapierRigidBody3d;
  createCollider(
    desc: RapierColliderDesc3d,
    parent?: RapierRigidBody3d,
  ): RapierCollider3d;
  getRigidBody(handle: number): RapierRigidBody3d;
  getCollider(handle: number): RapierCollider3d;
  removeRigidBody(body: RapierRigidBody3d): void;
  removeCollider(collider: RapierCollider3d, wakeUp: boolean): void;
  castRayAndGetNormal(
    ray: RapierRay3d,
    maxToi: number,
    solid: boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider3d,
    filterExcludeRigidBody?: RapierRigidBody3d,
    filterPredicate?: (collider: RapierCollider3d) => boolean,
  ): RapierRayColliderIntersection3d | null;
  intersectionsWithRay(
    ray: RapierRay3d,
    maxToi: number,
    solid: boolean,
    callback: (intersection: RapierRayColliderIntersection3d) => boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider3d,
    filterExcludeRigidBody?: RapierRigidBody3d,
    filterPredicate?: (collider: RapierCollider3d) => boolean,
  ): void;
  castShape(
    shapePosition: RapierVector3,
    shapeRotation: RapierRotation3,
    shapeVelocity: RapierVector3,
    shape: RapierShape3d,
    targetDistance: number,
    maxToi: number,
    stopAtPenetration: boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider3d,
    filterExcludeRigidBody?: RapierRigidBody3d,
    filterPredicate?: (collider: RapierCollider3d) => boolean,
  ): RapierColliderShapeCastHit3d | null;
  intersectionsWithShape(
    shapePosition: RapierVector3,
    shapeRotation: RapierRotation3,
    shape: RapierShape3d,
    callback: (collider: RapierCollider3d) => boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider3d,
    filterExcludeRigidBody?: RapierRigidBody3d,
    filterPredicate?: (collider: RapierCollider3d) => boolean,
  ): void;
  intersectionsWithPoint(
    point: RapierVector3,
    callback: (collider: RapierCollider3d) => boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: RapierCollider3d,
    filterExcludeRigidBody?: RapierRigidBody3d,
    filterPredicate?: (collider: RapierCollider3d) => boolean,
  ): void;
}

/**
 * The Rapier 3D module namespace, once {@link initializeRapier3d} has resolved
 * — the constructors, statics, and enums this package uses.
 *
 * `ColliderDesc.cuboid` takes **three** half-extents here and `Cuboid` three
 * constructor arguments; `Capsule(halfHeight, radius)` keeps the 2D argument
 * order and the +Y axis. The 2D-only `convexHull`/`ConvexPolygon` entry points
 * are absent because the plan P5-6 3D tier is sphere, box, and capsule — the
 * 3D build does have `convexHull`, `cylinder`, and `cone`, and a later packet
 * that widens the tier adds them here.
 */
export interface Rapier3dModule {
  init(): Promise<void>;
  version(): string;
  readonly RigidBodyType: RapierRigidBodyTypes3d;
  readonly ActiveEvents: RapierActiveEvents3d;
  readonly ActiveCollisionTypes: RapierActiveCollisionTypes3d;
  readonly CoefficientCombineRule: RapierCoefficientCombineRules3d;
  readonly World: {
    new (gravity: RapierVector3): RapierWorld3d;
    restoreSnapshot(data: Uint8Array): RapierWorld3d;
  };
  readonly EventQueue: new (autoDrain: boolean) => RapierEventQueue3d;
  readonly RigidBodyDesc: new (status: number) => RapierRigidBodyDesc3d;
  readonly ColliderDesc: {
    ball(radius: number): RapierColliderDesc3d;
    cuboid(
      halfWidth: number,
      halfHeight: number,
      halfDepth: number,
    ): RapierColliderDesc3d;
    capsule(halfHeight: number, radius: number): RapierColliderDesc3d;
  };
  readonly Ray: new (origin: RapierVector3, dir: RapierVector3) => RapierRay3d;
  readonly Ball: new (radius: number) => RapierShape3d;
  readonly Cuboid: new (
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ) => RapierShape3d;
  readonly Capsule: new (halfHeight: number, radius: number) => RapierShape3d;
}

/**
 * The Rapier 3D namespace under the transcribed types.
 *
 * Not part of the package barrel: it is the typed view the other modules in
 * this package share, and it is **only valid once {@link initializeRapier3d}
 * has resolved** — every member traps into wasm.
 */
export const RAPIER_3D = RAPIER3D_UNTYPED as unknown as Rapier3dModule;

/** The in-flight or completed 3D load; `undefined` before the first call. */
let loadPromise3d: Promise<Rapier3dModule> | undefined;

/** The 3D module once its wasm is live — the flag {@link rapier3dVersion} reads. */
let loadedModule3d: Rapier3dModule | undefined;

/**
 * Loads the Rapier 3D wasm module once and returns the initialized namespace.
 *
 * The 3D counterpart of {@link initializeRapier2d}, with its own cache: the two
 * builds are separate packages with separate wasm images, so neither load
 * implies the other.
 *
 * ```ts
 * const rapier = await initializeRapier3d();
 * const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
 * ```
 *
 * A failed load is **not** cached: the promise is cleared before the rejection
 * propagates, so a caller that retries after a transient failure gets a fresh
 * attempt rather than the same rejected promise forever.
 */
export function initializeRapier3d(): Promise<Rapier3dModule> {
  loadPromise3d ??= RAPIER_3D.init().then(
    () => {
      loadedModule3d = RAPIER_3D;
      return RAPIER_3D;
    },
    (error: unknown) => {
      loadPromise3d = undefined;
      throw error;
    },
  );
  return loadPromise3d;
}

/**
 * The initialized Rapier 3D module, or `undefined` while it is still loading.
 *
 * See {@link rapier2dModule} for why a synchronous peek exists at all.
 */
export function rapier3dModule(): Rapier3dModule | undefined {
  return loadedModule3d;
}

/**
 * The version string Rapier 3D itself reports, or `undefined` before the module
 * is initialized.
 *
 * As in 2D, the value comes from the wasm module (`0.19.3` for the pinned
 * build) rather than from a constant here, because §34 makes the adapter
 * version part of a snapshot's validity key.
 */
export function rapier3dVersion(): string | undefined {
  return loadedModule3d?.version();
}
