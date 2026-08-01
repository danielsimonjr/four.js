/**
 * The Rapier 2D solver adapter (§37, §102, plan WP-5.4).
 *
 * `Rapier2dAdapter` is a `PhysicsSolverAdapter` backed by
 * `@dimforge/rapier2d-compat` (pinned at `0.19.3` by plan P5-1). It is the first
 * concrete solver behind `@four/physics`'s stable API, and it may import
 * *nothing* from scene, motion, or render — the whole point of §37's seam is
 * that a solver knows about bodies and colliders and not about nodes.
 *
 * Everything below was written against the installed typings and verified
 * against the real wasm; the surprises worth knowing are called out in place
 * and summarized here:
 *
 * - **Rapier handles are not integers and not stable.** A `RigidBodyHandle` is
 *   a packed `(index, generation)` pair reinterpreted as a float — real observed
 *   values include `5e-324` and `2.12e-314`. They are usable as `Map` keys and
 *   nothing else, and destroying a body does not free its handle value for
 *   comparison purposes. §33 needs a *monotonic* order that destruction cannot
 *   perturb, so this adapter keeps its own registry — see
 *   {@link Rapier2dAdapter.forEachBody}.
 * - **Colliders are invisible to queries until the next `step`.** Rapier 0.19
 *   folded the query pipeline into the broad phase, which is updated inside
 *   `World.step`. `propagateModifiedBodyPositionsToColliders()` is *not* enough
 *   (verified). A collider created after the last step therefore cannot be hit
 *   by §30 queries until one step has run. The adapter does not paper over this
 *   with a hidden zero-length step, because that would run collision detection
 *   and manufacture events (§29) that no fixed step asked for.
 * - **Additional mass is applied late.** `RigidBodyDesc.setAdditionalMass` does
 *   not show up in `body.mass()` until the first `step` or an explicit
 *   `recomputeMassPropertiesFromColliders()`, and with zero-density colliders it
 *   yields **zero angular inertia**. See {@link Rapier2dAdapter.createBody} for
 *   how §23's "mass is authoritative" is honoured without that trap.
 * - **`world.step` integrates in `numSolverIterations` substeps** of
 *   `dt / numSolverIterations` (4 by default in 0.19.3). The discrete closed
 *   form for a free fall is therefore
 *   `y = y₀ + g · h² · K(K+1)/2` with `h = dt/4` and `K = 4N`, not the
 *   single-step semi-implicit form. Linear damping, by contrast, is applied
 *   once per **full** step as `v ← v / (1 + dt · damping)`. Both were measured,
 *   not assumed, and both are pinned by tests.
 *
 * ## Where the scene seam is (§37 `syncSceneToSolver` / `syncSolverToScene`)
 *
 * Both are **documented no-ops**. This is not laziness: Rapier applies every
 * write immediately — `setTranslation`, `setLinvel`, `applyImpulse` and friends
 * mutate solver state at the moment they are called — so there is no queue for
 * a flush point to flush. The adapter also cannot know what a "scene" is
 * (dependency rule: `physics-rapier` may not import `@four/scene`).
 *
 * What the physics package (WP-5.3) needs instead is a *per-handle* accessor
 * seam, and that is {@link RapierBodyAccess}: `PhysicsSystem` reads a body's
 * transform out of the solver and writes it onto its node under `"physics"`
 * authority (§42), and pushes kinematic targets and force commands back in. The
 * §37 call order is unchanged — `syncSceneToSolver` → `step` →
 * `syncSolverToScene` → `drainEvents` — the two sync calls simply have nothing
 * of their own to do for this solver.
 *
 * ## Events (§29, §6b)
 *
 * Collision, trigger, and sleep events are collected **inside `step`**, right
 * after `world.step`, and buffered; `drainEvents` hands over the buffer. That
 * ordering is forced by Rapier: the `EventQueue` is auto-drained at the start of
 * the next `step`, and contact manifolds (with their per-contact impulses) are
 * only meaningful immediately after the solve. No user callback is ever invoked
 * from here (§37).
 *
 * `collisionstay` **is** emitted by this adapter, even though Rapier has no such
 * event — see {@link Rapier2dAdapter.step} for how and why.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import {
  ALL_COLLISION_GROUPS,
  DEFAULT_ENABLED_CCD_MODE,
  DEFAULT_FRICTION,
  DEFAULT_RESTITUTION,
  DETERMINISM_LEVELS,
  passesQueryFilter,
  resolveDensity,
  resolveGravity,
  resolveQueryOptions,
  resolveSleepingConfig,
  sortHitsByDistance,
  validateColliderDescriptor,
  validateCollisionShape,
  validatePhysicsWorldOptions,
  validateRigidBodyDescriptor,
} from "@four/physics";
import type {
  AngularVelocityInput,
  CCDMode,
  ColliderDescriptor,
  ContactPoint,
  JointDescriptor,
  OverlapHit,
  OverlapQuery,
  PhysicsBodyHandle,
  PhysicsCapabilities,
  PhysicsColliderHandle,
  PhysicsDimension,
  PhysicsEvent,
  PhysicsJointHandle,
  PhysicsSolverAdapter,
  PhysicsWorldOptions,
  PointHit,
  PointQuery,
  QueryCandidate,
  RaycastHit,
  RaycastQuery,
  ResolvedQueryOptions,
  RigidBodyDescriptor,
  RotationInput,
  ShapeCastHit,
  ShapeCastQuery,
  SleepingConfig,
  Vector3Input,
} from "@four/physics";

import {
  createRapierColliderDesc,
  createRapierShape,
  createRapierVector2,
  fromRapierAngle,
  fromRapierVector2,
  packInteractionGroups,
  toRapierAngle,
  toRapierAngularScalar,
  toRapierBodyType,
  toRapierVector2,
} from "./conversions2d.js";
import type { RapierVector2 } from "./conversions2d.js";
import { initializeRapier2d } from "./init.js";
import type {
  Rapier2dModule,
  RapierCollider,
  RapierColliderDesc,
  RapierEventQueue,
  RapierRigidBody,
  RapierRigidBodyDesc,
  RapierWorld,
} from "./init.js";

/** See `@four/physics`: §89 has no physics-input code, so misuse is this. */
const ADAPTER_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** §37 `name`. Recorded in snapshots and replays, which refuse other solvers. */
const ADAPTER_NAME = "rapier2d";

/** The one §21 dimension this adapter simulates. */
const ADAPTER_DIMENSION = "2d";

/**
 * Prediction distance, in world units, used for `"speculative"` CCD (§31).
 *
 * Rapier's soft-CCD *is* speculative contact generation — "predictive
 * constraints instead of shape-cast and substeps", in its own words — but it is
 * parameterized by a distance, and §31's `CCDMode` carries no parameter. One
 * metre is the adapter's choice: generous enough to catch the
 * slow-but-thin and moderately fast cases soft-CCD exists for, small enough that
 * the broad-phase cost stays bounded in a metre-scale world (§40). A later
 * packet that widens `RigidBodyDescriptor` with a prediction distance should
 * replace this constant with the descriptor's value (decision, WP-5.4).
 */
const SOFT_CCD_PREDICTION_DISTANCE = 1;

/** Ray and shape casts treat shapes as plain (§30): a cast from inside hits. */
const QUERY_SOLID = true;

/** `castShape` reports a hit as soon as the shapes touch, not before (§30). */
const SHAPE_CAST_TARGET_DISTANCE = 0;

/**
 * What this adapter can actually do (§37), field by field:
 *
 * - `dimensions: ["2d"]` — this class wraps `@dimforge/rapier2d-compat`; the 3D
 *   build is a separate npm package and a separate adapter (WP-5.5).
 * - `jointTypes: []` — joints are staged to Phase 6 (plan P5-4);
 *   `createJoint`/`destroyJoint` throw `NOT_IMPLEMENTED`.
 * - `ccdModes` — all three. `"swept"` is Rapier's `RigidBodyDesc.setCcdEnabled`
 *   (motion clamping with `World.maxCcdSubsteps` substeps); `"speculative"` is
 *   `setSoftCcdPrediction` (predictive contacts, see
 *   {@link SOFT_CCD_PREDICTION_DISTANCE}); `"disabled"` is neither, and is
 *   always available.
 * - `determinism: "same-runtime"` — Appendix A's target and what Rapier's wasm
 *   gives here: the same build on the same engine reproduces a run exactly
 *   (proven by test). Nothing stronger is claimed: the wasm is compiled for a
 *   fixed float model, but this adapter's own conversions use JavaScript
 *   `Math.atan2`/`Math.sin`/`Math.cos`, whose results are not specified across
 *   engines, which is exactly what `"same-platform"` forbids.
 * - `snapshots: true` — `World.takeSnapshot` / `World.restoreSnapshot`, wrapped
 *   in an envelope that carries this adapter's registry too.
 * - `queries` — all four are implemented on Rapier's query entry points. See
 *   {@link Rapier2dAdapter.shapeCast} for the one multiplicity limit.
 */
const RAPIER_2D_CAPABILITIES: PhysicsCapabilities = Object.freeze({
  dimensions: Object.freeze<PhysicsDimension[]>([ADAPTER_DIMENSION]),
  jointTypes: Object.freeze<string[]>([]),
  ccdModes: Object.freeze<CCDMode[]>(["disabled", "speculative", "swept"]),
  determinism: "same-runtime",
  snapshots: true,
  queries: Object.freeze({
    raycast: true,
    shapeCast: true,
    overlap: true,
    point: true,
  }),
});

/**
 * `"F4R2"` in ASCII, read as a little-endian `u32` — the first four bytes of
 * every snapshot this adapter produces, so a buffer from somewhere else is
 * rejected before it reaches Rapier's deserializer.
 */
const SNAPSHOT_MAGIC = 0x32523446;

/**
 * Version of the snapshot **envelope** (not of Rapier, and not of the physics
 * package). Bumped whenever the header or the metadata layout changes;
 * {@link Rapier2dAdapter.restoreSnapshot} refuses anything else.
 */
const SNAPSHOT_FORMAT_VERSION = 1;

/** Four `u32` fields: magic, format version, metadata length, Rapier length. */
const SNAPSHOT_HEADER_BYTES = 16;

/**
 * How a body's mass is decided (§23, §25), resolved once at
 * `createBody` and consumed by every `createCollider` on that body.
 *
 * Rapier's mass model is *additive* — a body's mass is its own additional mass
 * plus the sum of `density × volume` over its colliders — while §23 says an
 * explicit `mass` is authoritative and "overrides the density-derived value".
 * These three modes are how the second is expressed in terms of the first.
 */
type MassMode =
  /** No explicit mass: every collider contributes `density × volume` (§25). */
  | "collider-density"
  /**
   * Explicit mass, no inertia or centre of mass given. The **first** collider
   * on the body is created with `ColliderDesc.setMass(mass)` so Rapier derives
   * the rotational inertia from that collider's geometry — which is the
   * physically meaningful answer — and every later collider is created massless
   * (`density = 0`). A body in this mode with no collider at all has no mass,
   * exactly as Rapier reports it.
   */
  | "first-collider"
  /**
   * Explicit mass **with** an inertia tensor or a centre of mass. The body
   * carries the whole triple through `setAdditionalMassProperties`, and every
   * collider is created massless so nothing is added on top.
   */
  | "body";

/** One body in the adapter's registry. Handles are these records, cast. */
interface BodyRecord {
  /** Monotonic engine-assigned id — the §33 ordering key. Never reused. */
  readonly id: number;
  /** Rapier's own handle. Opaque, non-integral, and reused after removal. */
  rapierHandle: number;
  /** The live Rapier body. Re-pointed by `restoreSnapshot`. */
  body: RapierRigidBody;
  /** Last observed `isSleeping()`, for §32's sleep/wake transitions. */
  sleeping: boolean;
  /** How this body's mass is composed. See {@link MassMode}. */
  massMode: MassMode;
  /** The §23 `mass`, when one was given. */
  explicitMass: number;
  /** Colliders created on this body so far — `"first-collider"` reads it. */
  colliderCount: number;
  /** `false` once destroyed; a handle to a dead record is rejected. */
  alive: boolean;
}

/** One collider in the adapter's registry. Handles are these records, cast. */
interface ColliderRecord {
  /** Monotonic engine-assigned id — the ordering key, as for bodies. */
  readonly id: number;
  /** Rapier's own handle. */
  rapierHandle: number;
  /** The live Rapier collider. Re-pointed by `restoreSnapshot`. */
  collider: RapierCollider;
  /** The {@link BodyRecord.id} of the owning body (§24, §37). */
  bodyId: number;
  /** §24 `sensor`. Kept here because §30's filter needs it per candidate. */
  sensor: boolean;
  /** §24 `collisionGroups`, as given — 32 bits, before Rapier's packing. */
  collisionGroups: number;
  /** §24 `collisionMask`, as given. */
  collisionMask: number;
  /** `false` once destroyed. */
  alive: boolean;
}

/** A collider pair currently touching, tracked so `collisionstay` can exist. */
interface PairRecord {
  readonly a: ColliderRecord;
  readonly b: ColliderRecord;
  /** Whether either side is a sensor, i.e. whether this is a §29 trigger pair. */
  readonly trigger: boolean;
}

/**
 * The registry half of a snapshot, stored beside Rapier's own bytes.
 *
 * JSON rather than a packed binary block: it is a few hundred bytes next to
 * Rapier's kilobytes, and a snapshot that can be read in a debugger is worth
 * more than one that saves 200 bytes. Rapier handles are non-integral doubles
 * (see the module header); `JSON` round-trips them exactly.
 */
interface SnapshotMeta {
  /** Must equal {@link ADAPTER_NAME} (§34: snapshots are solver-specific). */
  readonly adapter: string;
  /** The Rapier version that produced it (§34's validity key). */
  readonly version: string;
  /** Next monotonic body id, so ids keep increasing across a restore. */
  readonly nextBodyId: number;
  /** Next monotonic collider id. */
  readonly nextColliderId: number;
  /** Bodies in insertion order: `[id, rapierHandle, sleeping, massMode, explicitMass, colliderCount]`. */
  readonly bodies: readonly [
    number,
    number,
    boolean,
    MassMode,
    number,
    number,
  ][];
  /** Colliders in insertion order: `[id, rapierHandle, bodyId, sensor, groups, mask]`. */
  readonly colliders: readonly [
    number,
    number,
    number,
    boolean,
    number,
    number,
  ][];
}

/**
 * Per-handle access to a Rapier body — the seam §37's two `sync*` methods leave
 * open (see the module header).
 *
 * `PhysicsSolverAdapter` deliberately says nothing about reading or writing an
 * individual body: §37's contract is about the *step*, and the transform
 * exchange with the scene is `@four/physics`'s business. That leaves the
 * physics package needing an interface it can call per body per step, which is
 * this one. It is declared here, in the adapter package, rather than added to
 * `@four/physics` — the plan reserves that as an allowed extension point, and a
 * WP-5.1 amendment can promote it later once the 3D adapter (WP-5.5) has
 * confirmed the shape is dimension-independent.
 *
 * Every method takes handles minted by the same adapter and throws a
 * `FourError` for a foreign or destroyed handle. Reading methods take `out`
 * parameters and write into them (§7b, D7); the only allocations left are the
 * `{ x, y }` objects Rapier's own bindings return, which no caller can avoid at
 * 0.19.3.
 *
 * Angles, torques, and angular velocities are the §21 planar scalars: a
 * `number` is about **+Z**, and a `Vector3` must lie on the Z axis.
 */
export interface RapierBodyAccess {
  /**
   * Reads a body's world transform (§42's `"physics"` authority reads this).
   * `outRotation` receives the pure Z quaternion for Rapier's scalar angle.
   */
  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void;

  /**
   * Teleports a body (§37 "teleports"). Use
   * {@link RapierBodyAccess.setNextKinematicTransform} for a kinematic body
   * that should push dynamic bodies on the way.
   */
  setBodyTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation: RotationInput,
    wake?: boolean,
  ): void;

  /** Reads linear (m/s) and angular (rad/s) velocity into `out` parameters. */
  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void;

  /** Writes both velocities (§23). */
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

  /** §26 `body.applyTorque(torque)` — newton-metres about +Z. */
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
   * Clears the accumulated forces and torques (not impulses, which are applied
   * immediately). Rapier keeps user forces across steps until reset.
   */
  resetForces(handle: PhysicsBodyHandle): void;

  /**
   * Sets a `"kinematic-position"` body's target pose for the next step (§22).
   * Rapier derives an artificial velocity from it so dynamic bodies react.
   */
  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation?: RotationInput,
  ): void;

  /** §32's explicit wake command. */
  wakeBody(handle: PhysicsBodyHandle): void;

  /** §32's explicit sleep command. */
  sleepBody(handle: PhysicsBodyHandle): void;

  /** §32 sleep state. The transitions are also reported as `drainEvents` events. */
  isBodySleeping(handle: PhysicsBodyHandle): boolean;

  /**
   * The §31 CCD mode the solver is actually running for this body — read back
   * from Rapier rather than remembered, so it reports what the solver does and
   * not what the descriptor asked for.
   */
  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode;

  /** The body's mass in kilograms, as the solver computed it (§23, §25). */
  getBodyMass(handle: PhysicsBodyHandle): number;

  /** The monotonic id §33's checksum orders by. */
  getBodyId(handle: PhysicsBodyHandle): number;

  /**
   * Visits every live body **in creation order**, which is ascending
   * {@link RapierBodyAccess.getBodyId} because ids are monotonic and never
   * reused. This is the iteration §33 requires: destroying a body removes it
   * from the sequence and creating one appends, so no destruction can permute
   * the order a checksum is taken in.
   */
  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void;

  /** The body a collider belongs to (§24, §37). */
  getColliderBody(handle: PhysicsColliderHandle): PhysicsBodyHandle;

  /** The collider's monotonic id, ordered like {@link RapierBodyAccess.getBodyId}. */
  getColliderId(handle: PhysicsColliderHandle): number;

  /** Visits every live collider in creation order. */
  forEachCollider(
    visit: (handle: PhysicsColliderHandle, id: number) => void,
  ): void;
}

/**
 * A `PhysicsSolverAdapter` (§37) backed by Rapier 2D.
 *
 * ```ts
 * const adapter = new Rapier2dAdapter();
 * await adapter.initialize({ dimension: "2d", gravity: new Vector2(0, -9.81) });
 * const body = adapter.createBody({ type: "dynamic", position: new Vector2(0, 5) });
 * adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
 * adapter.step(1 / 60);
 * const events = adapter.drainEvents();
 * adapter.dispose();
 * ```
 *
 * One instance owns exactly one Rapier `World`. `initialize` may be called once;
 * `dispose` is idempotent and terminal.
 */
export class Rapier2dAdapter implements PhysicsSolverAdapter, RapierBodyAccess {
  /** §37 `name`. */
  readonly name: string = ADAPTER_NAME;

  /** §37 `capabilities`. Readable before `initialize`, and frozen. */
  readonly capabilities: PhysicsCapabilities = RAPIER_2D_CAPABILITIES;

  #rapier: Rapier2dModule | undefined;

  #world: RapierWorld | undefined;

  #eventQueue: RapierEventQueue | undefined;

  #version = "";

  #sleeping: SleepingConfig = resolveSleepingConfig();

  #initializeStarted = false;

  #disposed = false;

  #nextBodyId = 1;

  #nextColliderId = 1;

  /** Live bodies keyed by monotonic id. `Map` iteration is insertion order. */
  readonly #bodies = new Map<number, BodyRecord>();

  /** Live colliders keyed by monotonic id. */
  readonly #colliders = new Map<number, ColliderRecord>();

  /** Reverse index for event handling: Rapier body handle → record. */
  readonly #bodiesByRapierHandle = new Map<number, BodyRecord>();

  /** Reverse index for event handling: Rapier collider handle → record. */
  readonly #collidersByRapierHandle = new Map<number, ColliderRecord>();

  /** Pairs currently touching, keyed by `"idA|idB"` with `idA < idB`. */
  readonly #activePairs = new Map<string, PairRecord>();

  /** Events collected during the last `step`, handed over by `drainEvents`. */
  #pendingEvents: PhysicsEvent[] = [];

  /** Flat `[a, b, a, b, …]` scratch for the pairs that started this step. */
  readonly #startedPairs: ColliderRecord[] = [];

  /** Flat `[a, b, a, b, …]` scratch for the pairs that stopped this step. */
  readonly #stoppedPairs: ColliderRecord[] = [];

  /** Keys of the pairs that stopped this step, so `stay` can skip them. */
  readonly #stoppedKeys = new Set<string>();

  readonly #scratchVector3 = new Vector3();

  readonly #scratchQuaternion = new Quaternion();

  readonly #scratchRapierA: RapierVector2 = createRapierVector2();

  readonly #scratchRapierB: RapierVector2 = createRapierVector2();

  /**
   * §37 `version` — Rapier's own version string, once it is known.
   *
   * Empty until {@link Rapier2dAdapter.initialize} resolves, because the value
   * lives *inside* the wasm module: calling `version()` before `init()` throws
   * a `TypeError` from the bindings (verified at 0.19.3). This adapter would
   * rather report "not known yet" than invent a number that §34 will bake into
   * a snapshot's validity key.
   */
  get version(): string {
    return this.#version;
  }

  /**
   * Creates the Rapier world (§37).
   *
   * Loads the wasm module (once per process — see `init.ts`), then builds a
   * `World` with the §21-resolved gravity. Options are validated with
   * `@four/physics`'s own validators, so this adapter accepts exactly what the
   * engine accepts and no more.
   *
   * ## §32 sleeping: what maps, and what does not
   *
   * `SleepingConfig.enabled` maps to `RigidBodyDesc.setCanSleep`, applied to
   * every body this adapter creates. `linearThreshold`, `angularThreshold`, and
   * `timeThreshold` **do not map**: `IntegrationParameters` in 0.19.3 exposes
   * `dt`, `contact_erp`, `lengthUnit`, `normalizedAllowedLinearError`,
   * `normalizedPredictionDistance`, `numSolverIterations`,
   * `numInternalPgsIterations`, `minIslandSize`, `maxCcdSubsteps`, and
   * `contact_natural_frequency` — and no sleeping thresholds at all (verified by
   * enumerating the prototype). Rapier's thresholds are compiled into the wasm.
   * The adapter therefore honours the on/off switch and leaves the three
   * thresholds unimplemented rather than pretending; a world that depends on
   * them is depending on something no Rapier 0.19.3 binding can deliver.
   */
  async initialize(options: PhysicsWorldOptions): Promise<void> {
    this.#assertNotDisposed();
    if (this.#initializeStarted) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier2dAdapter.initialize was called twice; one adapter owns one world (§37). Create a second adapter instead.",
      );
    }
    this.#initializeStarted = true;

    validatePhysicsWorldOptions(options);
    if (options.dimension !== ADAPTER_DIMENSION) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Rapier2dAdapter simulates "2d" worlds only; got ${JSON.stringify(options.dimension)} (§21, §37). Use the 3D Rapier adapter for a "3d" world.`,
        { context: { dimension: options.dimension } },
      );
    }
    if (
      options.determinism !== undefined &&
      DETERMINISM_LEVELS.indexOf(options.determinism) >
        DETERMINISM_LEVELS.indexOf(RAPIER_2D_CAPABILITIES.determinism)
    ) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Rapier2dAdapter declares determinism ${JSON.stringify(RAPIER_2D_CAPABILITIES.determinism)} and the world asked for ${JSON.stringify(options.determinism)} (§33, §37).`,
        { context: { requested: options.determinism } },
      );
    }

    const rapier = await initializeRapier2d();
    const gravity = resolveGravity(
      ADAPTER_DIMENSION,
      options.gravity,
      this.#scratchVector3,
    );
    this.#rapier = rapier;
    this.#version = rapier.version();
    this.#sleeping = resolveSleepingConfig(options.sleeping);
    // A fresh object, never a scratch buffer: Rapier's `World` *retains* the
    // vector it is constructed with as its live `gravity` field and reads it on
    // every step (verified at 0.19.3), so handing it a reused buffer would let
    // the next position conversion silently rewrite the world's gravity.
    this.#world = new rapier.World({ x: gravity.x, y: gravity.y });
    this.#eventQueue = new rapier.EventQueue(true);
  }

  /**
   * Creates a body (§37, §22, §23).
   *
   * §22's four types map to Rapier's `Fixed`, `Dynamic`,
   * `KinematicPositionBased`, and `KinematicVelocityBased`. Position, rotation,
   * both velocities, both damping coefficients, and `gravityScale` are applied
   * from the descriptor; §31's CCD mode is resolved from the §23 boolean and the
   * §31 mode together, exactly as `RigidBodyDescriptor.ccdMode` documents.
   *
   * ## Mass (§23, §25)
   *
   * Rapier composes a body's mass additively, so an explicit `mass` cannot
   * simply be handed to `RigidBodyDesc`: `setAdditionalMass(5)` on a body with a
   * density-1 collider yields mass 6, and on a body with only zero-density
   * colliders yields mass 5 with **zero rotational inertia** (both measured at
   * 0.19.3). §23 says `mass` is authoritative, so the adapter resolves one of
   * three {@link MassMode}s here and every `createCollider` on this body honours
   * it. In particular, an explicit `mass` with no inertia tensor is carried by
   * the body's *first* collider through `ColliderDesc.setMass`, which gives the
   * requested mass **and** a geometry-derived inertia.
   *
   * A `centerOfMass` or `inertiaTensor` **without** a `mass` is rejected:
   * Rapier can only set the three together, and silently dropping the one the
   * caller did supply is the kind of quiet substitution §85 exists to prevent.
   */
  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle {
    const world = this.#requireWorld();
    const rapier = this.#requireRapier();
    validateRigidBodyDescriptor(desc, ADAPTER_DIMENSION);

    const rigidBodyDesc: RapierRigidBodyDesc = new rapier.RigidBodyDesc(
      toRapierBodyType(desc.type),
    );

    if (desc.position !== undefined) {
      const position = toRapierVector2(
        "position",
        desc.position,
        this.#scratchRapierA,
      );
      rigidBodyDesc.setTranslation(position.x, position.y);
    }
    if (desc.rotation !== undefined) {
      rigidBodyDesc.setRotation(
        toRapierAngle(desc.rotation, this.#scratchQuaternion),
      );
    }
    if (desc.linearVelocity !== undefined) {
      const velocity = toRapierVector2(
        "linearVelocity",
        desc.linearVelocity,
        this.#scratchRapierA,
      );
      rigidBodyDesc.setLinvel(velocity.x, velocity.y);
    }
    if (desc.angularVelocity !== undefined) {
      rigidBodyDesc.setAngvel(
        toRapierAngularScalar(desc.angularVelocity, this.#scratchVector3),
      );
    }
    if (desc.linearDamping !== undefined) {
      rigidBodyDesc.setLinearDamping(desc.linearDamping);
    }
    if (desc.angularDamping !== undefined) {
      rigidBodyDesc.setAngularDamping(desc.angularDamping);
    }
    if (desc.gravityScale !== undefined) {
      rigidBodyDesc.setGravityScale(desc.gravityScale);
    }
    rigidBodyDesc.setCanSleep(this.#sleeping.enabled);

    const ccdMode = resolveCcdMode(desc);
    if (ccdMode === "swept") {
      rigidBodyDesc.setCcdEnabled(true);
    } else if (ccdMode === "speculative") {
      rigidBodyDesc.setSoftCcdPrediction(SOFT_CCD_PREDICTION_DISTANCE);
    }

    const massMode = resolveMassMode(desc);
    const explicitMass = desc.mass ?? 0;
    if (massMode === "body") {
      const centerOfMass = toRapierVector2(
        "centerOfMass",
        desc.centerOfMass ?? this.#scratchVector3.set(0, 0, 0),
        this.#scratchRapierA,
      );
      // §23's last rule: in a `"2d"` world only the tensor's Z diagonal entry
      // is used, which is `Matrix3.elements[8]` in the column-major layout.
      rigidBodyDesc.setAdditionalMassProperties(
        explicitMass,
        centerOfMass,
        desc.inertiaTensor?.elements[8] ?? 0,
      );
    }

    const body = world.createRigidBody(rigidBodyDesc);
    if (massMode === "body") {
      // `setAdditionalMassProperties` is otherwise not visible in `mass()` until
      // the first step (measured at 0.19.3), which would make `getBodyMass`
      // report 0 for a freshly created body.
      body.recomputeMassPropertiesFromColliders();
    }

    const record: BodyRecord = {
      id: this.#nextBodyId,
      rapierHandle: body.handle,
      body,
      sleeping: body.isSleeping(),
      massMode,
      explicitMass,
      colliderCount: 0,
      alive: true,
    };
    this.#nextBodyId += 1;
    this.#bodies.set(record.id, record);
    this.#bodiesByRapierHandle.set(record.rapierHandle, record);
    return record as unknown as PhysicsBodyHandle;
  }

  /**
   * Destroys a body and everything attached to it (§37).
   *
   * Rapier removes the body's colliders with it, so their records are dropped
   * here too, along with any contact pair they were part of. The monotonic id
   * is *not* reused, which is what keeps
   * {@link Rapier2dAdapter.forEachBody}'s order stable under destruction (§33).
   */
  destroyBody(handle: PhysicsBodyHandle): void {
    const world = this.#requireWorld();
    const record = this.#requireBody(handle);

    for (const collider of [...this.#colliders.values()]) {
      if (collider.bodyId === record.id) {
        this.#forgetCollider(collider);
      }
    }

    world.removeRigidBody(record.body);
    record.alive = false;
    this.#bodies.delete(record.id);
    this.#bodiesByRapierHandle.delete(record.rapierHandle);
  }

  /**
   * Creates a collider on `desc.body` (§37, §24, §25).
   *
   * The plan P5-6 2D tier — circle, rectangle, capsule, convex polygon — maps to
   * `ColliderDesc.ball`, `.cuboid`, `.capsule`, and `.convexHull`; see
   * `conversions2d.ts` for the capsule axis and the polygon winding rule.
   *
   * Friction and restitution come from the explicit fields, then the material,
   * then `@four/physics`'s defaults. Their **combine rules** are set to
   * Appendix A's — friction `Average`, restitution `Max` — because Rapier's own
   * default for restitution is `Average`, which would quietly contradict §25 for
   * every contact in the world. §25's `rollingFriction` and `spinningFriction`
   * have no Rapier 2D binding at 0.19.3 and are ignored (their `undefined`
   * default means most callers never notice).
   *
   * `collisionGroups`/`collisionMask` are packed into Rapier's single
   * `InteractionGroups` word; `sensor` sets the sensor flag *and* widens
   * `ActiveCollisionTypes` to `ALL`, because Rapier's default excludes
   * kinematic-vs-fixed and fixed-vs-fixed pairs — a static trigger volume would
   * otherwise never notice a kinematic character walking through it (verified,
   * and a §29 requirement rather than a preference). Solid colliders keep
   * Rapier's default, where those pairs are genuinely uninteresting.
   *
   * `ActiveEvents.COLLISION_EVENTS` is enabled on every collider: §29's five
   * event names are part of the engine's contract, not an opt-in.
   * `CONTACT_FORCE_EVENTS` is deliberately **not** enabled — the contact
   * manifolds read in `step` carry per-contact impulses, which is strictly more
   * information than a contact-force event's summed force and needs no
   * threshold to be configured.
   */
  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle {
    const world = this.#requireWorld();
    const rapier = this.#requireRapier();
    validateColliderDescriptor(desc, ADAPTER_DIMENSION);
    const bodyRecord = this.#requireBody(desc.body);

    const colliderDesc: RapierColliderDesc = createRapierColliderDesc(
      desc.shape,
    );

    if (desc.offset !== undefined) {
      const offset = toRapierVector2(
        "offset.position",
        desc.offset.position,
        this.#scratchRapierA,
      );
      colliderDesc.setTranslation(offset.x, offset.y);
      colliderDesc.setRotation(
        toRapierAngle(desc.offset.rotation, this.#scratchQuaternion),
      );
    }

    colliderDesc.setFriction(
      desc.friction ?? desc.material?.friction ?? DEFAULT_FRICTION,
    );
    colliderDesc.setRestitution(
      desc.restitution ?? desc.material?.restitution ?? DEFAULT_RESTITUTION,
    );
    colliderDesc.setFrictionCombineRule(rapier.CoefficientCombineRule.Average);
    colliderDesc.setRestitutionCombineRule(rapier.CoefficientCombineRule.Max);

    applyColliderMass(colliderDesc, desc, bodyRecord);

    const sensor = desc.sensor ?? false;
    colliderDesc.setSensor(sensor);
    if (sensor) {
      colliderDesc.setActiveCollisionTypes(rapier.ActiveCollisionTypes.ALL);
    }
    colliderDesc.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);

    const collisionGroups = desc.collisionGroups ?? ALL_COLLISION_GROUPS;
    const collisionMask = desc.collisionMask ?? ALL_COLLISION_GROUPS;
    colliderDesc.setCollisionGroups(
      packInteractionGroups(collisionGroups, collisionMask),
    );

    const collider = world.createCollider(colliderDesc, bodyRecord.body);
    bodyRecord.colliderCount += 1;
    // Keep `getBodyMass` truthful before the first step, as for `createBody`.
    bodyRecord.body.recomputeMassPropertiesFromColliders();

    const record: ColliderRecord = {
      id: this.#nextColliderId,
      rapierHandle: collider.handle,
      collider,
      bodyId: bodyRecord.id,
      sensor,
      collisionGroups,
      collisionMask,
      alive: true,
    };
    this.#nextColliderId += 1;
    this.#colliders.set(record.id, record);
    this.#collidersByRapierHandle.set(record.rapierHandle, record);
    return record as unknown as PhysicsColliderHandle;
  }

  /** Destroys a collider (§37). Any contact pair it was part of is forgotten. */
  destroyCollider(handle: PhysicsColliderHandle): void {
    const world = this.#requireWorld();
    const record = this.#requireCollider(handle);
    world.removeCollider(record.collider, true);
    this.#forgetCollider(record);
  }

  /**
   * Staged to Phase 6 (plan P5-4): throws `NOT_IMPLEMENTED`, matching
   * `capabilities.jointTypes: []`.
   */
  createJoint(desc: JointDescriptor): PhysicsJointHandle {
    throw new FourError(
      "NOT_IMPLEMENTED",
      `Joints are staged to Phase 6 (§109, plan P5-4); Rapier2dAdapter declares capabilities.jointTypes: [] and cannot create a ${JSON.stringify(desc.type)} joint yet (§28, §37).`,
      { context: { adapter: ADAPTER_NAME, jointType: desc.type } },
    );
  }

  /** Staged with {@link Rapier2dAdapter.createJoint}: throws `NOT_IMPLEMENTED`. */
  destroyJoint(handle: PhysicsJointHandle): void {
    void handle;
    throw new FourError(
      "NOT_IMPLEMENTED",
      "Joints are staged to Phase 6 (§109, plan P5-4); Rapier2dAdapter never mints a joint handle, so there is none to destroy (§28, §37).",
      { context: { adapter: ADAPTER_NAME } },
    );
  }

  /**
   * Advances the solver by exactly `delta` seconds (§37, §10) and collects the
   * step's events.
   *
   * The events are gathered here rather than in `drainEvents` for two reasons,
   * both Rapier's: the `EventQueue` is auto-drained at the start of the *next*
   * `step`, and contact manifolds only carry the impulses the solver just
   * applied for as long as no further stepping has happened.
   *
   * ## `collisionstay`, which Rapier does not have
   *
   * Rapier reports only *started* and *stopped*. §29 names three collision
   * phases, so somebody has to derive the middle one, and this adapter does it
   * rather than leaving each caller to reinvent the bookkeeping (decision,
   * WP-5.4 — the alternative, "the adapter emits start/end only and `@four/physics`
   * derives stay", was rejected because the contact manifold a `collisionstay`
   * payload needs is only readable *here*, immediately after the solve).
   *
   * The rule: a pair that Rapier reported as started is remembered; on every
   * later step where it has not been reported as stopped, a `collisionstay`
   * carrying a fresh manifold is emitted; when Rapier reports it stopped, a
   * `collisionend` is emitted and the pair is forgotten. Trigger (sensor) pairs
   * are tracked the same way but produce no `stay`, because §29 defines only
   * `triggerenter` and `triggerexit`.
   *
   * ## Ordering (§33)
   *
   * Deterministic and documented: all `collisionstart`/`triggerenter` in
   * Rapier's queue order, then every `collisionstay` in pair-creation order,
   * then all `collisionend`/`triggerexit` in queue order, then every §32
   * `sleep`/`wake` in body-creation order.
   */
  step(delta: number): void {
    const world = this.#requireWorld();
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `step(delta) takes a finite positive number of seconds (§7a, §10); got ${String(delta)}.`,
        { context: { adapter: ADAPTER_NAME, delta } },
      );
    }

    world.timestep = delta;
    world.step(this.#eventQueue);
    this.#collectEvents();
  }

  /**
   * Returns and clears the events collected during the preceding `step` (§37).
   *
   * The array is handed over, not shared: the adapter starts a fresh buffer, so
   * a caller may keep, sort, or splice the result. Contact vectors are freshly
   * allocated per event and are never pooled, so they stay valid for as long as
   * the caller holds them.
   */
  drainEvents(): PhysicsEvent[] {
    const drained = this.#pendingEvents;
    this.#pendingEvents = [];
    return drained;
  }

  /**
   * §37's pre-step hook. **A documented no-op for this adapter.**
   *
   * Rapier applies every write the moment it is made — there is no staging
   * buffer for this call to flush. Scene-authored state reaches the solver
   * through {@link RapierBodyAccess}, which `@four/physics` calls from inside
   * its own `syncSceneToSolver` phase; see the module header.
   */
  syncSceneToSolver(): void {
    this.#requireWorld();
  }

  /**
   * §37's post-step hook. **A documented no-op for this adapter**, for the same
   * reason as {@link Rapier2dAdapter.syncSceneToSolver}: solved transforms are
   * read per body through {@link RapierBodyAccess.getBodyTransform}, which is
   * the only way an adapter that cannot see the scene graph could publish them.
   */
  syncSolverToScene(): void {
    this.#requireWorld();
  }

  /**
   * Casts a ray (§30).
   *
   * The direction is normalized before the cast, so Rapier's time of impact —
   * which is measured in units of the ray direction's length — equals the
   * distance in world units that `RaycastHit.distance` promises.
   *
   * Filtering is done **entirely** by `@four/physics`'s `passesQueryFilter`
   * rather than by Rapier's own group words: one implementation of §30's filter
   * semantics means Rapier and every future adapter answer a query identically,
   * which is exactly the portability the §37 seam exists for.
   *
   * `mode: "first"` uses Rapier's nearest-hit entry point; `"all"` enumerates
   * and then applies `maxHits` in traversal order and `sorted` afterwards.
   *
   * Note the module header's warning: a collider created since the last `step`
   * is not yet in the broad phase and cannot be hit.
   */
  raycast(query: RaycastQuery): RaycastHit[] {
    const world = this.#requireWorld();
    const rapier = this.#requireRapier();
    const options = resolveQueryOptions(query);

    const origin = toRapierVector2(
      "origin",
      query.origin,
      this.#scratchRapierA,
    );
    const direction = toRapierVector2(
      "direction",
      query.direction,
      this.#scratchRapierB,
    );
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "raycast direction must have non-zero length (§30, §85).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    const ray = new rapier.Ray(
      { x: origin.x, y: origin.y },
      { x: direction.x / length, y: direction.y / length },
    );
    const maxToi = query.maxDistance ?? Number.MAX_VALUE;
    const predicate = (collider: RapierCollider): boolean =>
      this.#passesFilter(collider, options);

    const hits: RaycastHit[] = [];
    if (options.mode === "first") {
      const hit = world.castRayAndGetNormal(
        ray,
        maxToi,
        QUERY_SOLID,
        undefined,
        undefined,
        undefined,
        undefined,
        predicate,
      );
      if (hit !== null) {
        const record = this.#collidersByRapierHandle.get(hit.collider.handle);
        if (record !== undefined) {
          hits.push(
            this.#buildRaycastHit(record, ray, hit.timeOfImpact, hit.normal),
          );
        }
      }
      return hits;
    }

    world.intersectionsWithRay(
      ray,
      maxToi,
      QUERY_SOLID,
      (intersection) => {
        const record = this.#collidersByRapierHandle.get(
          intersection.collider.handle,
        );
        if (record !== undefined) {
          hits.push(
            this.#buildRaycastHit(
              record,
              ray,
              intersection.timeOfImpact,
              intersection.normal,
            ),
          );
        }
        return hits.length < options.maxHits;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      predicate,
    );
    if (options.sorted) {
      sortHitsByDistance(hits);
    }
    return hits;
  }

  /**
   * Sweeps a shape (§30).
   *
   * **Multiplicity limit, declared rather than hidden:** Rapier 0.19.3's 2D
   * query surface exposes `castShape`, which returns the *first* impact and
   * nothing else — there is no "all shape-cast hits" entry point. This method
   * therefore returns at most one hit whatever `mode`, `maxHits`, or `sorted`
   * ask for. `capabilities.queries.shapeCast` stays `true` because the query is
   * implemented; the cap is a property of the solver, and a caller that needs
   * every crossing should step the sweep or use `overlap`.
   *
   * `ShapeCastHit.point` is Rapier's `witness1`, which is world-space on the hit
   * collider, and `normal` is `witness1`'s normal, pointing out of it (both
   * verified at 0.19.3 — `witness2` is in the *cast* shape's local frame and is
   * not used).
   */
  shapeCast(query: ShapeCastQuery): ShapeCastHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    validateCollisionShape(query.shape, ADAPTER_DIMENSION);

    const position = toRapierVector2(
      "position",
      query.position,
      this.#scratchRapierA,
    );
    const start = { x: position.x, y: position.y };
    const rotation =
      query.rotation === undefined
        ? 0
        : toRapierAngle(query.rotation, this.#scratchQuaternion);
    const direction = toRapierVector2(
      "direction",
      query.direction,
      this.#scratchRapierB,
    );
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "shapeCast direction must have non-zero length (§30, §85).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }

    const hit = world.castShape(
      start,
      rotation,
      { x: direction.x / length, y: direction.y / length },
      createRapierShape(query.shape),
      SHAPE_CAST_TARGET_DISTANCE,
      query.maxDistance ?? Number.MAX_VALUE,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.#passesFilter(collider, options),
    );
    if (hit === null) {
      return [];
    }
    const record = this.#collidersByRapierHandle.get(hit.collider.handle);
    if (record === undefined) {
      return [];
    }
    return [
      {
        collider: record as unknown as PhysicsColliderHandle,
        body: this.#bodyHandleOf(record),
        point: new Vector3(hit.witness1.x, hit.witness1.y, 0),
        normal: new Vector3(hit.normal1.x, hit.normal1.y, 0),
        distance: hit.time_of_impact,
      },
    ];
  }

  /**
   * Tests a static shape for overlaps (§30).
   *
   * §21's planar forms fall out of the shape union: an overlap with a
   * `"circle"` is §30's `overlapSphere` in a 2D world, and one with a
   * `"rectangle"` is `overlapBox`. Hits carry no distance, so `sorted` does
   * nothing here — `OverlapHit` has nothing to sort by, which `QueryOptions`
   * already says.
   */
  overlap(query: OverlapQuery): OverlapHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    validateCollisionShape(query.shape, ADAPTER_DIMENSION);

    const position = toRapierVector2(
      "position",
      query.position,
      this.#scratchRapierA,
    );
    const rotation =
      query.rotation === undefined
        ? 0
        : toRapierAngle(query.rotation, this.#scratchQuaternion);

    const hits: OverlapHit[] = [];
    world.intersectionsWithShape(
      { x: position.x, y: position.y },
      rotation,
      createRapierShape(query.shape),
      (collider) => {
        const record = this.#collidersByRapierHandle.get(collider.handle);
        if (record !== undefined) {
          hits.push({
            collider: record as unknown as PhysicsColliderHandle,
            body: this.#bodyHandleOf(record),
          });
        }
        return hits.length < options.maxHits;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.#passesFilter(collider, options),
    );
    return hits;
  }

  /**
   * Tests a point (§30) — every collider that contains it.
   *
   * Each hit's `point` and `distance` come from Rapier's `projectPoint(point,
   * solid: true)`, which returns the query point itself for a point inside a
   * plain shape. Since a point query only ever reports *containing* colliders,
   * `distance` is `0` on every hit; that is `PointHit`'s documented meaning of
   * "the point is inside", not a field this adapter failed to fill.
   */
  pointQuery(query: PointQuery): PointHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    const point = toRapierVector2("point", query.point, this.#scratchRapierA);
    const target = { x: point.x, y: point.y };

    const hits: PointHit[] = [];
    world.intersectionsWithPoint(
      target,
      (collider) => {
        const record = this.#collidersByRapierHandle.get(collider.handle);
        if (record !== undefined) {
          const projection = collider.projectPoint(target, QUERY_SOLID);
          const projected = projection?.point ?? target;
          hits.push({
            collider: record as unknown as PhysicsColliderHandle,
            body: this.#bodyHandleOf(record),
            point: new Vector3(projected.x, projected.y, 0),
            distance: Math.hypot(
              projected.x - target.x,
              projected.y - target.y,
            ),
          });
        }
        return hits.length < options.maxHits;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.#passesFilter(collider, options),
    );
    if (options.sorted) {
      sortHitsByDistance(hits);
    }
    return hits;
  }

  /**
   * Serializes the world (§34).
   *
   * Rapier's `World.takeSnapshot()` captures the solver — bodies, colliders,
   * contacts, integration parameters, gravity — and preserves its own handles
   * across `World.restoreSnapshot` (verified). It does **not** know about this
   * adapter's monotonic ids, mass modes, or collision-group values, all of which
   * §33's checksum and §30's filters depend on. The buffer this method returns
   * is therefore an envelope:
   *
   * ```text
   * offset  0  u32  magic            0x32523446 ("F4R2", little-endian)
   * offset  4  u32  format version   1
   * offset  8  u32  metadata length  in bytes
   * offset 12  u32  Rapier length    in bytes
   * offset 16  …    metadata         UTF-8 JSON (SnapshotMeta)
   * offset 16+m …   Rapier snapshot  World.takeSnapshot() bytes, verbatim
   * ```
   *
   * The envelope is opaque adapter data in §37's sense: valid only for this
   * adapter, this Rapier version, and this world configuration.
   */
  createSnapshot(): ArrayBuffer {
    const world = this.#requireWorld();
    const rapierBytes = world.takeSnapshot();

    const meta: SnapshotMeta = {
      adapter: ADAPTER_NAME,
      version: this.#version,
      nextBodyId: this.#nextBodyId,
      nextColliderId: this.#nextColliderId,
      bodies: [...this.#bodies.values()].map((record) => [
        record.id,
        record.rapierHandle,
        record.sleeping,
        record.massMode,
        record.explicitMass,
        record.colliderCount,
      ]),
      colliders: [...this.#colliders.values()].map((record) => [
        record.id,
        record.rapierHandle,
        record.bodyId,
        record.sensor,
        record.collisionGroups,
        record.collisionMask,
      ]),
    };
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));

    const buffer = new ArrayBuffer(
      SNAPSHOT_HEADER_BYTES + metaBytes.byteLength + rapierBytes.byteLength,
    );
    const header = new DataView(buffer);
    header.setUint32(0, SNAPSHOT_MAGIC, true);
    header.setUint32(4, SNAPSHOT_FORMAT_VERSION, true);
    header.setUint32(8, metaBytes.byteLength, true);
    header.setUint32(12, rapierBytes.byteLength, true);
    const bytes = new Uint8Array(buffer);
    bytes.set(metaBytes, SNAPSHOT_HEADER_BYTES);
    bytes.set(rapierBytes, SNAPSHOT_HEADER_BYTES + metaBytes.byteLength);
    return buffer;
  }

  /**
   * Restores a world previously captured by
   * {@link Rapier2dAdapter.createSnapshot} (§34).
   *
   * The Rapier world is replaced wholesale — `World.restoreSnapshot` builds a
   * new one — and the old one is freed. The adapter's registry is then rebuilt
   * from the envelope's metadata, **reusing the existing record objects wherever
   * an id survives**: that is what makes handles minted before the snapshot keep
   * working afterwards, so "body identity and ordering survive the round trip"
   * is true in the sense §33's checksum needs. A record whose id is not in the
   * snapshot is marked dead, and its handle is rejected from then on.
   *
   * The touching-pair set is rebuilt from the restored narrow phase, so
   * `collisionstay` and `collisionend` keep working for pairs that were already
   * in contact when the snapshot was taken — Rapier will not re-report those as
   * *started*, so without this they would go silent.
   */
  restoreSnapshot(snapshot: ArrayBuffer): void {
    const rapier = this.#requireRapier();
    const world = this.#requireWorld();

    if (snapshot.byteLength < SNAPSHOT_HEADER_BYTES) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Snapshot is too small to be a ${ADAPTER_NAME} envelope (§34).`,
        { context: { adapter: ADAPTER_NAME, byteLength: snapshot.byteLength } },
      );
    }
    const header = new DataView(snapshot);
    if (header.getUint32(0, true) !== SNAPSHOT_MAGIC) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Snapshot was not produced by ${ADAPTER_NAME}; a snapshot is opaque adapter data and is valid only for the adapter that wrote it (§34, §37).`,
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    const formatVersion = header.getUint32(4, true);
    if (formatVersion !== SNAPSHOT_FORMAT_VERSION) {
      throw new FourError(
        "SERIALIZATION_VERSION_MISMATCH",
        `Snapshot envelope version ${String(formatVersion)} is not ${String(SNAPSHOT_FORMAT_VERSION)} (§34).`,
        { context: { adapter: ADAPTER_NAME, formatVersion } },
      );
    }
    const metaLength = header.getUint32(8, true);
    const rapierLength = header.getUint32(12, true);
    const bytes = new Uint8Array(snapshot);
    const meta = JSON.parse(
      new TextDecoder().decode(
        bytes.subarray(
          SNAPSHOT_HEADER_BYTES,
          SNAPSHOT_HEADER_BYTES + metaLength,
        ),
      ),
    ) as SnapshotMeta;
    if (meta.adapter !== ADAPTER_NAME || meta.version !== this.#version) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Snapshot was written by ${JSON.stringify(meta.adapter)} ${JSON.stringify(meta.version)} and this adapter is ${JSON.stringify(ADAPTER_NAME)} ${JSON.stringify(this.#version)} (§34).`,
        { context: { adapter: ADAPTER_NAME, snapshotAdapter: meta.adapter } },
      );
    }

    const restored = rapier.World.restoreSnapshot(
      bytes.slice(
        SNAPSHOT_HEADER_BYTES + metaLength,
        SNAPSHOT_HEADER_BYTES + metaLength + rapierLength,
      ),
    );
    world.free();
    this.#world = restored;

    this.#rebuildRegistries(restored, meta);
    this.#eventQueue?.clear();
    this.#pendingEvents = [];
    this.#rebuildActivePairs(restored);
  }

  /**
   * Releases the Rapier world and event queue (§37, §83). Idempotent and
   * terminal: every handle this adapter minted is invalid afterwards, and every
   * other method throws.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#eventQueue?.free();
    this.#eventQueue = undefined;
    this.#world?.free();
    this.#world = undefined;
    this.#rapier = undefined;
    for (const record of this.#bodies.values()) {
      record.alive = false;
    }
    for (const record of this.#colliders.values()) {
      record.alive = false;
    }
    this.#bodies.clear();
    this.#colliders.clear();
    this.#bodiesByRapierHandle.clear();
    this.#collidersByRapierHandle.clear();
    this.#activePairs.clear();
    this.#pendingEvents = [];
  }

  // ---------------------------------------------------------------- accessors

  /** @inheritDoc */
  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void {
    const record = this.#requireBody(handle);
    fromRapierVector2(record.body.translation(), outPosition);
    fromRapierAngle(record.body.rotation(), outRotation);
  }

  /** @inheritDoc */
  setBodyTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation: RotationInput,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    record.body.setTranslation(
      toRapierVector2("position", position, this.#scratchRapierA),
      wake,
    );
    record.body.setRotation(
      toRapierAngle(rotation, this.#scratchQuaternion),
      wake,
    );
  }

  /** @inheritDoc */
  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const record = this.#requireBody(handle);
    fromRapierVector2(record.body.linvel(), outLinear);
    outAngular.set(0, 0, record.body.angvel());
  }

  /** @inheritDoc */
  setBodyVelocities(
    handle: PhysicsBodyHandle,
    linear: Vector3Input,
    angular: AngularVelocityInput,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    record.body.setLinvel(
      toRapierVector2("linearVelocity", linear, this.#scratchRapierA),
      wake,
    );
    record.body.setAngvel(
      toRapierAngularScalar(angular, this.#scratchVector3),
      wake,
    );
  }

  /** @inheritDoc */
  applyForce(handle: PhysicsBodyHandle, force: Vector3Input): void {
    const record = this.#requireBody(handle);
    record.body.addForce(
      toRapierVector2("force", force, this.#scratchRapierA),
      true,
    );
  }

  /** @inheritDoc */
  applyForceAtPoint(
    handle: PhysicsBodyHandle,
    force: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    const record = this.#requireBody(handle);
    record.body.addForceAtPoint(
      toRapierVector2("force", force, this.#scratchRapierA),
      toRapierVector2("worldPoint", worldPoint, this.#scratchRapierB),
      true,
    );
  }

  /** @inheritDoc */
  applyTorque(handle: PhysicsBodyHandle, torque: AngularVelocityInput): void {
    const record = this.#requireBody(handle);
    record.body.addTorque(
      toRapierAngularScalar(torque, this.#scratchVector3),
      true,
    );
  }

  /** @inheritDoc */
  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3Input): void {
    const record = this.#requireBody(handle);
    record.body.applyImpulse(
      toRapierVector2("impulse", impulse, this.#scratchRapierA),
      true,
    );
  }

  /** @inheritDoc */
  applyImpulseAtPoint(
    handle: PhysicsBodyHandle,
    impulse: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    const record = this.#requireBody(handle);
    record.body.applyImpulseAtPoint(
      toRapierVector2("impulse", impulse, this.#scratchRapierA),
      toRapierVector2("worldPoint", worldPoint, this.#scratchRapierB),
      true,
    );
  }

  /** @inheritDoc */
  applyAngularImpulse(
    handle: PhysicsBodyHandle,
    angularImpulse: AngularVelocityInput,
  ): void {
    const record = this.#requireBody(handle);
    record.body.applyTorqueImpulse(
      toRapierAngularScalar(angularImpulse, this.#scratchVector3),
      true,
    );
  }

  /** @inheritDoc */
  resetForces(handle: PhysicsBodyHandle): void {
    const record = this.#requireBody(handle);
    record.body.resetForces(false);
    record.body.resetTorques(false);
  }

  /** @inheritDoc */
  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation?: RotationInput,
  ): void {
    const record = this.#requireBody(handle);
    record.body.setNextKinematicTranslation(
      toRapierVector2("position", position, this.#scratchRapierA),
    );
    if (rotation !== undefined) {
      record.body.setNextKinematicRotation(
        toRapierAngle(rotation, this.#scratchQuaternion),
      );
    }
  }

  /** @inheritDoc */
  wakeBody(handle: PhysicsBodyHandle): void {
    this.#requireBody(handle).body.wakeUp();
  }

  /** @inheritDoc */
  sleepBody(handle: PhysicsBodyHandle): void {
    this.#requireBody(handle).body.sleep();
  }

  /** @inheritDoc */
  isBodySleeping(handle: PhysicsBodyHandle): boolean {
    return this.#requireBody(handle).body.isSleeping();
  }

  /** @inheritDoc */
  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode {
    const body = this.#requireBody(handle).body;
    if (body.isCcdEnabled()) {
      return "swept";
    }
    return body.softCcdPrediction() > 0 ? "speculative" : "disabled";
  }

  /** @inheritDoc */
  getBodyMass(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).body.mass();
  }

  /** @inheritDoc */
  getBodyId(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).id;
  }

  /** @inheritDoc */
  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void {
    this.#requireWorld();
    for (const record of this.#bodies.values()) {
      visit(record as unknown as PhysicsBodyHandle, record.id);
    }
  }

  /** @inheritDoc */
  getColliderBody(handle: PhysicsColliderHandle): PhysicsBodyHandle {
    return this.#bodyHandleOf(this.#requireCollider(handle));
  }

  /** @inheritDoc */
  getColliderId(handle: PhysicsColliderHandle): number {
    return this.#requireCollider(handle).id;
  }

  /** @inheritDoc */
  forEachCollider(
    visit: (handle: PhysicsColliderHandle, id: number) => void,
  ): void {
    this.#requireWorld();
    for (const record of this.#colliders.values()) {
      visit(record as unknown as PhysicsColliderHandle, record.id);
    }
  }

  // ------------------------------------------------------------------ private

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier2dAdapter has been disposed; dispose() is terminal (§37, §83).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
  }

  #requireWorld(): RapierWorld {
    this.#assertNotDisposed();
    if (this.#world === undefined) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier2dAdapter.initialize has not completed; await it before using the adapter (§37).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return this.#world;
  }

  #requireRapier(): Rapier2dModule {
    this.#assertNotDisposed();
    if (this.#rapier === undefined) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier2dAdapter.initialize has not completed; await it before using the adapter (§37).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return this.#rapier;
  }

  /**
   * Recovers a body record from an opaque handle (§37).
   *
   * The handle *is* the record, cast — which is the adapter's whole privilege
   * over handles per `types.ts`. The identity check against the registry is what
   * makes a foreign object, a destroyed body, or a handle from another adapter
   * fail loudly instead of corrupting a world.
   */
  #requireBody(handle: PhysicsBodyHandle): BodyRecord {
    this.#requireWorld();
    const record = handle as unknown as BodyRecord;
    if (!record.alive || this.#bodies.get(record.id) !== record) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Body handle is not valid for this Rapier2dAdapter: it was destroyed, or it was minted by another adapter (§37).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return record;
  }

  /** Collider counterpart of {@link Rapier2dAdapter.#requireBody}. */
  #requireCollider(handle: PhysicsColliderHandle): ColliderRecord {
    this.#requireWorld();
    const record = handle as unknown as ColliderRecord;
    if (!record.alive || this.#colliders.get(record.id) !== record) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Collider handle is not valid for this Rapier2dAdapter: it was destroyed, or it was minted by another adapter (§37).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return record;
  }

  /** The handle of a collider's owning body — every event and hit needs it. */
  #bodyHandleOf(record: ColliderRecord): PhysicsBodyHandle {
    const body = this.#bodies.get(record.bodyId);
    if (body === undefined) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Collider outlived its body, which cannot happen through the public API (§24, §37).",
        { context: { adapter: ADAPTER_NAME, colliderId: record.id } },
      );
    }
    return body as unknown as PhysicsBodyHandle;
  }

  /** Drops a collider from every index, including any pair it was part of. */
  #forgetCollider(record: ColliderRecord): void {
    record.alive = false;
    this.#colliders.delete(record.id);
    this.#collidersByRapierHandle.delete(record.rapierHandle);
    for (const [key, pair] of [...this.#activePairs]) {
      if (pair.a === record || pair.b === record) {
        this.#activePairs.delete(key);
      }
    }
  }

  /** §30's filter, applied to one Rapier collider. See `raycast`. */
  #passesFilter(
    collider: RapierCollider,
    options: ResolvedQueryOptions,
  ): boolean {
    const record = this.#collidersByRapierHandle.get(collider.handle);
    if (record === undefined) {
      return false;
    }
    const candidate: QueryCandidate = {
      collider: record as unknown as PhysicsColliderHandle,
      body: this.#bodyHandleOf(record),
      collisionGroups: record.collisionGroups,
      collisionMask: record.collisionMask,
      sensor: record.sensor,
    };
    return passesQueryFilter(candidate, options);
  }

  /** Builds one §30 ray hit; `normal` is Rapier's world-space surface normal. */
  #buildRaycastHit(
    record: ColliderRecord,
    ray: { origin: RapierVector2; dir: RapierVector2 },
    timeOfImpact: number,
    normal: RapierVector2,
  ): RaycastHit {
    return {
      collider: record as unknown as PhysicsColliderHandle,
      body: this.#bodyHandleOf(record),
      point: new Vector3(
        ray.origin.x + ray.dir.x * timeOfImpact,
        ray.origin.y + ray.dir.y * timeOfImpact,
        0,
      ),
      normal: new Vector3(normal.x, normal.y, 0),
      distance: timeOfImpact,
    };
  }

  /** The §33-stable key of a collider pair: ascending monotonic ids. */
  #pairKey(a: ColliderRecord, b: ColliderRecord): string {
    return a.id < b.id
      ? `${String(a.id)}|${String(b.id)}`
      : `${String(b.id)}|${String(a.id)}`;
  }

  /**
   * Turns the last step's Rapier events into §29/§32 payloads. See
   * {@link Rapier2dAdapter.step} for the ordering contract.
   */
  #collectEvents(): void {
    const started = this.#startedPairs;
    const stopped = this.#stoppedPairs;
    started.length = 0;
    stopped.length = 0;
    this.#stoppedKeys.clear();

    this.#eventQueue?.drainCollisionEvents((handleA, handleB, isStarted) => {
      const a = this.#collidersByRapierHandle.get(handleA);
      const b = this.#collidersByRapierHandle.get(handleB);
      if (a === undefined || b === undefined) {
        return;
      }
      if (isStarted) {
        started.push(a, b);
      } else {
        stopped.push(a, b);
        this.#stoppedKeys.add(this.#pairKey(a, b));
      }
    });

    for (let i = 0; i < started.length; i += 2) {
      this.#emitPair(started[i], started[i + 1], "start");
    }

    for (const pair of this.#activePairs.values()) {
      if (
        pair.trigger ||
        this.#stoppedKeys.has(this.#pairKey(pair.a, pair.b))
      ) {
        continue;
      }
      this.#emitPair(pair.a, pair.b, "stay");
    }

    for (let i = 0; i < started.length; i += 2) {
      const a = started[i];
      const b = started[i + 1];
      const key = this.#pairKey(a, b);
      if (!this.#activePairs.has(key)) {
        this.#activePairs.set(key, { a, b, trigger: a.sensor || b.sensor });
      }
    }

    for (let i = 0; i < stopped.length; i += 2) {
      const a = stopped[i];
      const b = stopped[i + 1];
      this.#emitPair(a, b, "end");
      this.#activePairs.delete(this.#pairKey(a, b));
    }

    for (const record of this.#bodies.values()) {
      const sleeping = record.body.isSleeping();
      if (sleeping !== record.sleeping) {
        record.sleeping = sleeping;
        this.#pendingEvents.push({
          type: sleeping ? "sleep" : "wake",
          body: record as unknown as PhysicsBodyHandle,
        });
      }
    }
  }

  /** Emits the §29 event(s) for one collider pair in one phase. */
  #emitPair(
    a: ColliderRecord,
    b: ColliderRecord,
    phase: "start" | "stay" | "end",
  ): void {
    if (a.sensor || b.sensor) {
      const type = phase === "start" ? "triggerenter" : "triggerexit";
      if (a.sensor) {
        this.#pendingEvents.push({
          type,
          sensor: a as unknown as PhysicsColliderHandle,
          sensorBody: this.#bodyHandleOf(a),
          other: b as unknown as PhysicsColliderHandle,
          otherBody: this.#bodyHandleOf(b),
        });
      }
      if (b.sensor) {
        // §29: when two sensors overlap the pair is reported from each side, so
        // a listener on either sensor sees its own event.
        this.#pendingEvents.push({
          type,
          sensor: b as unknown as PhysicsColliderHandle,
          sensorBody: this.#bodyHandleOf(b),
          other: a as unknown as PhysicsColliderHandle,
          otherBody: this.#bodyHandleOf(a),
        });
      }
      return;
    }

    const contacts: ContactPoint[] = [];
    const totalImpulse = new Vector3();
    const relativeVelocity = new Vector3();
    if (phase !== "end") {
      this.#buildContacts(a, b, contacts, totalImpulse, relativeVelocity);
    }
    this.#pendingEvents.push({
      type:
        phase === "start"
          ? "collisionstart"
          : phase === "stay"
            ? "collisionstay"
            : "collisionend",
      bodyA: this.#bodyHandleOf(a),
      bodyB: this.#bodyHandleOf(b),
      colliderA: a as unknown as PhysicsColliderHandle,
      colliderB: b as unknown as PhysicsColliderHandle,
      contacts,
      relativeVelocity,
      totalImpulse,
    });
  }

  /**
   * Fills a §29 contact manifold from Rapier's narrow phase.
   *
   * Every field is taken from Rapier where Rapier has it, and the two it does
   * not are documented rather than faked:
   *
   * - `pointOnA` / `pointOnB` — `localContactPoint1/2` transformed by each
   *   collider's world isometry. Rapier's manifold may be *flipped* relative to
   *   the pair as this adapter names it; the `flipped` flag is honoured so
   *   `pointOnA` is always on `colliderA`.
   * - `normal` — the manifold's world-space normal, negated when flipped so it
   *   always points **from A towards B**, as `ContactPoint` requires.
   * - `separation` — `contactDist`, negative while interpenetrating.
   * - `impulse` — `contactImpulse`, the normal impulse the solver applied at
   *   that point during the step, in newton-seconds.
   * - `totalImpulse` — the sum of those impulses along the normal. This is
   *   equivalent to what `CONTACT_FORCE_EVENTS` would report (measured: the
   *   event's total force is exactly this sum divided by the timestep) without
   *   needing a force threshold configured per collider.
   * - `relativeVelocity` — **computed by this adapter**, not reported by Rapier:
   *   the difference of the two bodies' velocities at the first contact point,
   *   read *after* the solve. It is therefore the post-impact relative velocity,
   *   not the approach velocity; scale impact responses by `totalImpulse`,
   *   which is the quantity the solver actually applied. Zero when the pair has
   *   no contacts.
   */
  #buildContacts(
    a: ColliderRecord,
    b: ColliderRecord,
    contacts: ContactPoint[],
    totalImpulse: Vector3,
    relativeVelocity: Vector3,
  ): void {
    const world = this.#requireWorld();
    let impulseSum = 0;
    let normalX = 0;
    let normalY = 0;

    world.narrowPhase.contactPair(
      a.rapierHandle,
      b.rapierHandle,
      (manifold, flipped) => {
        const manifoldNormal = manifold.normal();
        normalX = flipped ? -manifoldNormal.x : manifoldNormal.x;
        normalY = flipped ? -manifoldNormal.y : manifoldNormal.y;
        const first = flipped ? b : a;
        const second = flipped ? a : b;
        const count = manifold.numContacts();
        for (let i = 0; i < count; i += 1) {
          const localFirst = manifold.localContactPoint1(i);
          const localSecond = manifold.localContactPoint2(i);
          if (localFirst === null || localSecond === null) {
            continue;
          }
          const worldFirst = toWorldPoint(first.collider, localFirst);
          const worldSecond = toWorldPoint(second.collider, localSecond);
          const impulse = manifold.contactImpulse(i);
          impulseSum += impulse;
          contacts.push({
            pointOnA: flipped ? worldSecond : worldFirst,
            pointOnB: flipped ? worldFirst : worldSecond,
            normal: new Vector3(normalX, normalY, 0),
            separation: manifold.contactDist(i),
            impulse,
          });
        }
      },
    );

    totalImpulse.set(normalX * impulseSum, normalY * impulseSum, 0);

    const contact = contacts[0];
    if (contact === undefined) {
      return;
    }
    const bodyA = this.#bodies.get(a.bodyId);
    const bodyB = this.#bodies.get(b.bodyId);
    if (bodyA === undefined || bodyB === undefined) {
      return;
    }
    this.#scratchRapierA.x = contact.pointOnA.x;
    this.#scratchRapierA.y = contact.pointOnA.y;
    const velocityA = bodyA.body.velocityAtPoint(this.#scratchRapierA);
    const velocityB = bodyB.body.velocityAtPoint(this.#scratchRapierA);
    relativeVelocity.set(
      velocityA.x - velocityB.x,
      velocityA.y - velocityB.y,
      0,
    );
  }

  /** Re-points every surviving record at the restored world. See `restoreSnapshot`. */
  #rebuildRegistries(world: RapierWorld, meta: SnapshotMeta): void {
    const survivingBodies = new Map<number, BodyRecord>();
    const survivingColliders = new Map<number, ColliderRecord>();
    this.#bodiesByRapierHandle.clear();
    this.#collidersByRapierHandle.clear();

    for (const [
      id,
      rapierHandle,
      sleeping,
      massMode,
      explicitMass,
      colliderCount,
    ] of meta.bodies) {
      const existing = this.#bodies.get(id);
      const body = world.getRigidBody(rapierHandle);
      const record: BodyRecord = existing ?? {
        id,
        rapierHandle,
        body,
        sleeping,
        massMode,
        explicitMass,
        colliderCount,
        alive: true,
      };
      record.rapierHandle = rapierHandle;
      record.body = body;
      record.sleeping = sleeping;
      record.massMode = massMode;
      record.explicitMass = explicitMass;
      record.colliderCount = colliderCount;
      record.alive = true;
      survivingBodies.set(id, record);
      this.#bodiesByRapierHandle.set(rapierHandle, record);
    }

    for (const [
      id,
      rapierHandle,
      bodyId,
      sensor,
      collisionGroups,
      collisionMask,
    ] of meta.colliders) {
      const existing = this.#colliders.get(id);
      const collider = world.getCollider(rapierHandle);
      const record: ColliderRecord = existing ?? {
        id,
        rapierHandle,
        collider,
        bodyId,
        sensor,
        collisionGroups,
        collisionMask,
        alive: true,
      };
      record.rapierHandle = rapierHandle;
      record.collider = collider;
      record.bodyId = bodyId;
      record.sensor = sensor;
      record.collisionGroups = collisionGroups;
      record.collisionMask = collisionMask;
      record.alive = true;
      survivingColliders.set(id, record);
      this.#collidersByRapierHandle.set(rapierHandle, record);
    }

    for (const record of this.#bodies.values()) {
      if (!survivingBodies.has(record.id)) {
        record.alive = false;
      }
    }
    for (const record of this.#colliders.values()) {
      if (!survivingColliders.has(record.id)) {
        record.alive = false;
      }
    }

    this.#bodies.clear();
    for (const [id, record] of survivingBodies) {
      this.#bodies.set(id, record);
    }
    this.#colliders.clear();
    for (const [id, record] of survivingColliders) {
      this.#colliders.set(id, record);
    }
    this.#nextBodyId = meta.nextBodyId;
    this.#nextColliderId = meta.nextColliderId;
  }

  /** Rebuilds the touching-pair set from a restored narrow phase. */
  #rebuildActivePairs(world: RapierWorld): void {
    this.#activePairs.clear();
    const narrowPhase = world.narrowPhase;
    for (const record of this.#colliders.values()) {
      narrowPhase.contactPairsWith(record.rapierHandle, (otherHandle) => {
        const other = this.#collidersByRapierHandle.get(otherHandle);
        if (other === undefined) {
          return;
        }
        let touching = false;
        narrowPhase.contactPair(
          record.rapierHandle,
          otherHandle,
          (manifold) => {
            touching ||= manifold.numContacts() > 0;
          },
        );
        if (touching) {
          this.#rememberPair(record, other);
        }
      });
      narrowPhase.intersectionPairsWith(record.rapierHandle, (otherHandle) => {
        const other = this.#collidersByRapierHandle.get(otherHandle);
        if (
          other !== undefined &&
          narrowPhase.intersectionPair(record.rapierHandle, otherHandle)
        ) {
          this.#rememberPair(record, other);
        }
      });
    }
  }

  /** Adds a pair to the active set if it is not already there. */
  #rememberPair(a: ColliderRecord, b: ColliderRecord): void {
    const key = this.#pairKey(a, b);
    if (!this.#activePairs.has(key)) {
      this.#activePairs.set(key, { a, b, trigger: a.sensor || b.sensor });
    }
  }
}

/**
 * Reconciles §23's `continuousCollisionDetection` switch with §31's mode.
 *
 * `RigidBodyDescriptor.ccdMode` documents the table this implements, and
 * `validateRigidBodyDescriptor` has already rejected the one contradictory
 * combination (`false` plus a non-`"disabled"` mode). An explicit mode wins
 * whenever one is given; otherwise the boolean selects
 * `DEFAULT_ENABLED_CCD_MODE`.
 */
function resolveCcdMode(desc: RigidBodyDescriptor): CCDMode {
  if (desc.ccdMode !== undefined) {
    return desc.ccdMode;
  }
  return desc.continuousCollisionDetection === true
    ? DEFAULT_ENABLED_CCD_MODE
    : "disabled";
}

/** Chooses the {@link MassMode} for a body from its §23 descriptor. */
function resolveMassMode(desc: RigidBodyDescriptor): MassMode {
  const hasDistribution =
    desc.centerOfMass !== undefined || desc.inertiaTensor !== undefined;
  if (desc.mass === undefined) {
    if (hasDistribution) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier 2D sets mass, centre of mass, and rotational inertia as one triple, so centerOfMass or inertiaTensor requires an explicit mass as well (§23, §85).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return "collider-density";
  }
  return hasDistribution ? "body" : "first-collider";
}

/**
 * Applies the body's {@link MassMode} to a collider descriptor (§23, §25).
 *
 * `Collider.density` is authoritative over `PhysicsMaterial.density` — that rule
 * is `resolveDensity`'s, reused here so the adapter cannot drift from it.
 */
function applyColliderMass(
  colliderDesc: RapierColliderDesc,
  desc: ColliderDescriptor,
  body: BodyRecord,
): void {
  switch (body.massMode) {
    case "collider-density":
      colliderDesc.setDensity(resolveDensity(desc.density, desc.material));
      return;
    case "first-collider":
      if (body.colliderCount === 0) {
        colliderDesc.setMass(body.explicitMass);
      } else {
        colliderDesc.setDensity(0);
      }
      return;
    case "body":
      colliderDesc.setDensity(0);
      return;
    default: {
      const unknown: never = body.massMode;
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Unknown mass mode ${String(unknown)}.`,
      );
    }
  }
}

/**
 * Transforms a collider-local contact point into world space.
 *
 * Rapier gives contact points in each collider's own frame; §29 wants world
 * space. The collider's world isometry is its `translation()` and `rotation()`,
 * which already include the parent body's pose.
 */
function toWorldPoint(collider: RapierCollider, local: RapierVector2): Vector3 {
  const translation = collider.translation();
  const angle = collider.rotation();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return new Vector3(
    translation.x + local.x * cos - local.y * sin,
    translation.y + local.x * sin + local.y * cos,
    0,
  );
}
