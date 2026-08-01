/**
 * Shared loading of the Rapier 2D WebAssembly module, and the typed view of it
 * this package programs against.
 *
 * `PhysicsSolverAdapter.initialize` (§37) is allowed to return a promise
 * precisely so a WebAssembly-backed solver can load its module there. Rapier
 * ships as wasm, so every adapter in this package has to await that load before
 * it may touch a single Rapier class — and several adapters (and several worlds
 * on one adapter) must be able to await the *same* load rather than each
 * decoding the module again.
 *
 * This module is that one load, per dimension. The 2D entry point lives here; a
 * sibling `initializeRapier3d` will be added by the 3D packet (WP-5.5) beside
 * it, with the same shape and its own cache — the two Rapier builds are separate
 * npm packages with separate wasm images, so they cannot share one promise.
 *
 * ## Why the Rapier surface is re-declared below
 *
 * **This is a workaround for a real defect in the dependency, not a preference,
 * and it should be deleted the moment the defect is worked around at the
 * toolchain level.**
 *
 * `@dimforge/rapier2d-compat@0.19.3` declares `"type": "module"` and its own
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
 * turn every one of the ~70 Rapier calls in this package into an unchecked
 * call. The interfaces below are therefore transcribed **from the installed
 * `0.19.3` declaration files**, member for member, with the source file named on
 * each block, and they cover only what this package actually calls. Every one of
 * them is exercised by the test suite against the real wasm, so a transcription
 * error surfaces as a failing test rather than as a silent wrong simulation.
 *
 * ## Other things verified against the installed 0.19.3, not from memory
 *
 * - `init()` takes **no arguments** (`init.length === 0`) and returns
 *   `Promise<void>`. Plan P5-1's note about "the object-form argument" applies
 *   to the raw wasm-bindgen entry point of the *non*-compat builds; the
 *   `-compat` package wraps it and passes the decoded base64 bytes itself, so
 *   there is nothing for a caller to pass. The `"using deprecated parameters
 *   for the initialization function; pass a single object instead"` warning the
 *   first `init()` prints is emitted **inside** `@dimforge/rapier2d-compat` and
 *   cannot be suppressed from outside it. It appears at most once per process.
 * - `version()` reads the version string **out of the wasm module** and throws a
 *   `TypeError` when called before `init()`. That is why {@link rapier2dVersion}
 *   answers `undefined` rather than a placeholder: this package never invents a
 *   version number for §34's snapshot validity key.
 */

import * as RAPIER2D_UNTYPED from "@dimforge/rapier2d-compat";

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
