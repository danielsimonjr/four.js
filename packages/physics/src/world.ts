/**
 * `PhysicsWorld` (§20, §30, §32, §33, §34, §37, §39, §42, §43) — the object an
 * application holds and a solver adapter serves.
 *
 * §20's promise is that "users should not need to write solver-specific
 * application code for common tasks". `PhysicsWorld` is where that promise is
 * kept: it owns the registration of §6a components into a solver, the fixed-step
 * pipeline of §37/§39, the §42 transform writes, §30's named queries, §33's
 * checksum, and §34's snapshot metadata — all of it phrased over
 * `PhysicsSolverAdapter` + {@link SolverBodyAccess} and never over a solver.
 *
 * ```ts
 * const world = new PhysicsWorld({ dimension: "2d", adapter, poses: app.poses });
 * await world.initialize();
 *
 * const ball = new Group();
 * ball.transformAuthority = "physics";           // §42: the solver owns the pose
 * ball.transform.position.set(0, 5, 0);
 * ball.addComponent(new RigidBody({ type: "dynamic" }));
 * ball.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
 * world.addBody(ball);
 *
 * app.systems.register(new PhysicsSystem({ worlds: [world] }));
 * ```
 *
 * ## The fixed step (§37, §39, plan P5-2)
 *
 * {@link PhysicsWorld.step} runs one fixed step in exactly this order, and
 * {@link PhysicsWorld.dispatchEvents} delivers the step's events afterwards:
 *
 * ```text
 * 1. per body, in registration order:
 *      resetForces → the §26 command buffer → the §32 sleep command → clear
 *      kinematic bodies: setNextKinematicTransform / setBodyVelocities
 * 2. adapter.syncSceneToSolver()      ← §37 call-order hook (may be a no-op)
 * 3. adapter.step(fixedDeltaTime)     ← §10: seconds, never milliseconds
 * 4. adapter.syncSolverToScene()      ← §37 call-order hook (may be a no-op)
 * 5. per body, in registration order:
 *      dynamic → node.transform under "physics" authority (§42)
 *      every body → RigidBody velocities, RigidBody.sleeping (§23, §32)
 * 6. adapter.drainEvents() → translated to component references and queued
 * 7. dispatchEvents() → §29 events on node emitters (§39 step 9, §6b)
 * ```
 *
 * Step 7 is deliberately a separate call: §39 puts event dispatch after the
 * solve, and `PhysicsSystem` steps *every* world before dispatching any world's
 * events, so a listener that touches a second world always sees a world that has
 * finished its step. A listener may create bodies, destroy bodies, or step
 * nothing at all — the queue was handed over before the first callback ran.
 *
 * ## Poses and §43 interpolation
 *
 * A world given a `PoseBuffer` tracks the node of every **dynamic** body it
 * registers and untracks it on removal. It does not capture: §39 puts the pose
 * snapshot at step 10 (`PRIORITY_SNAPSHOT`, after the solve at step 6), so the
 * engine's one capture — `createSnapshotSystem`, registered by `Application`
 * whenever pose interpolation is on — already records the post-step pose as
 * "current" and the previous step's post-step pose (which *is* the pre-step
 * pose, since nothing else moves a body between steps) as "previous". A second
 * capture from inside the physics step would shift the pair twice per step and
 * flatten interpolation to a constant, which is the artefact §43 exists to
 * remove. See `@four/scene`'s `interpolation.ts`, which states the same
 * arrangement from the buffer's side.
 *
 * An application that drives a world without the snapshot system gets no
 * interpolation and should register `createSnapshotSystem(poses)`.
 *
 * ## What the world does not own
 *
 * The scheduler (§10: the accumulator and the sub-step clamp are the
 * application clock's), the node transforms of anything but registered dynamic
 * bodies, and the adapter's lifetime before construction. `dispose()` does
 * dispose the adapter — a world is the only thing that steps it, and §83 wants
 * one owner.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector2, Vector3 } from "@four/math";
import { warnAuthorityConflict, type Node, type PoseBuffer } from "@four/scene";

import type { PhysicsSolverAdapter } from "./adapter.js";
import type { SolverBodyAccess } from "./body-access.js";
import { Collider } from "./collider.js";
import type { ColliderTriggerEvent } from "./collider.js";
import type { PhysicsWorldOptions } from "./descriptors.js";
import { resolveGravity, resolveSleepingConfig } from "./descriptors.js";
import type { PhysicsEvent } from "./events.js";
import type {
  OverlapQuery,
  PointQuery,
  QueryOptions,
  RaycastQuery,
  ShapeCastQuery,
} from "./queries.js";
import type {
  RigidBodyCollisionEvent,
  RigidBodySleepEvent,
} from "./rigid-body.js";
import {
  RigidBody,
  clearRigidBodyCommands,
  setRigidBodySleeping,
} from "./rigid-body.js";
import type { CollisionShape } from "./shapes.js";
import type {
  BodyType,
  DeterminismLevel,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsDimension,
  RotationInput,
  SleepingConfig,
  Vector3Input,
} from "./types.js";
import { DEFAULT_DETERMINISM_LEVEL, DETERMINISM_LEVELS } from "./types.js";
import { validatePhysicsWorldOptions } from "./validation.js";

/** See the rest of the package: §89 has no physics-input code, so misuse is this. */
const WORLD_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** The §42 authority a solver writes under. */
const PHYSICS_AUTHORITY = "physics";

/** Quantization grid of §33's checksum: values snap to multiples of 1e-6. */
const QUANTIZATION_SCALE = 1e6;

/** FNV-1a 32-bit offset basis — also the digest of an empty world. */
const FNV_OFFSET_BASIS = 2166136261;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 16777619;

/** 2^32, the word boundary of §33's two-word float encoding. */
const TWO_POW_32 = 4294967296;

/**
 * A solver adapter a world can drive: §37's contract plus the per-handle access
 * of {@link SolverBodyAccess}.
 *
 * Both halves are required. §37 alone cannot move a solved pose onto a node —
 * it has no per-body read — and {@link SolverBodyAccess} alone has no world to
 * read from.
 */
export type PhysicsWorldAdapter = PhysicsSolverAdapter & SolverBodyAccess;

/**
 * How a {@link PhysicsWorld} is constructed: §20's world options plus the
 * adapter instance (plan P5-5) and the optional §43 pose store.
 *
 * Named `…Init` rather than `…Options` because `PhysicsWorldOptions` is already
 * §37's own record — the one handed to `adapter.initialize` — and this type is
 * that record *plus* the engine-side wiring, which is not part of what a solver
 * is configured with.
 */
export interface PhysicsWorldInit extends PhysicsWorldOptions {
  /**
   * The solver this world drives (plan P5-5: an instance, not a `solver: "auto"`
   * string — that selection joins the §45 registry backlog).
   *
   * Its `capabilities` are checked against `dimension` and `determinism` at
   * construction, so a world that cannot be simulated fails immediately rather
   * than degrading quietly (§37).
   */
  adapter: PhysicsWorldAdapter;

  /**
   * The engine's previous/current pose store (§43). When given, the node of
   * every dynamic body is tracked on registration and untracked on removal;
   * see the module header for why the world never captures into it.
   */
  poses?: PoseBuffer;
}

/** What every world-level query hit identifies: one collider and its body (§30). */
export interface WorldQueryHit {
  /** The collider that was hit, as the §6a component. */
  readonly collider: Collider;
  /** The body owning {@link WorldQueryHit.collider}. */
  readonly body: RigidBody;
}

/** One intersection along a ray (§30 `world.raycast`). */
export interface WorldRaycastHit extends WorldQueryHit {
  /** Intersection point in world space. */
  readonly point: Vector3;
  /** Unit surface normal in world space, pointing out of the hit collider. */
  readonly normal: Vector3;
  /** Distance from the ray origin, in world units. */
  readonly distance: number;
}

/** One impact of a swept shape (§30 `world.shapeCast`). */
export interface WorldShapeCastHit extends WorldQueryHit {
  /** The witness point on the hit collider, in world space. */
  readonly point: Vector3;
  /** Unit contact normal at the impact, in world space. */
  readonly normal: Vector3;
  /** Distance the shape travelled before touching, in world units. */
  readonly distance: number;
}

/** One collider overlapping the query volume (§30 `overlapSphere`/`overlapBox`). */
export type WorldOverlapHit = WorldQueryHit;

/** One collider containing the queried point (§30 `world.pointQuery`). */
export interface WorldPointHit extends WorldQueryHit {
  /** The closest point on the collider's surface, in world space. */
  readonly point: Vector3;
  /** Distance from the query point to that surface; `0` when inside. */
  readonly distance: number;
}

/**
 * A §29 event as it reaches node listeners: the same payload the adapter
 * returned, with handles swapped for the §6a components (§101 "event
 * normalization").
 */
export type WorldPhysicsEvent = PhysicsEvent<RigidBody, Collider>;

/**
 * A solver snapshot plus the validity key §34 requires.
 *
 * §34: *"Snapshots are opaque adapter data: a snapshot is valid only for the
 * same adapter, adapter version, and world configuration that produced it"*, and
 * a replay "refuses to run against a different solver". The world therefore
 * never hands out a bare `ArrayBuffer`: {@link PhysicsWorld.restoreSnapshot}
 * checks the two recorded fields before the bytes reach the adapter, which turns
 * "restored into the wrong solver" from silent corruption into an error at the
 * call site.
 */
export interface PhysicsSnapshot {
  /** `PhysicsSolverAdapter.name` at capture time, e.g. `"rapier2d"`. */
  readonly adapterName: string;
  /** `PhysicsSolverAdapter.version` at capture time. */
  readonly adapterVersion: string;
  /** The adapter's opaque bytes (§34). */
  readonly data: ArrayBuffer;
}

/** One registered collider: the component, its handle, and its monotonic id. */
interface ColliderRegistration {
  readonly collider: Collider;
  readonly handle: PhysicsColliderHandle;
  readonly id: number;
  readonly body: BodyRegistration;
}

/** One registered body and everything the per-step pipeline needs about it. */
interface BodyRegistration {
  readonly node: Node;
  readonly body: RigidBody;
  readonly handle: PhysicsBodyHandle;
  readonly id: number;
  /**
   * The §22 type at registration time.
   *
   * The pipeline branches on this rather than on the live `body.type` so that a
   * type assigned after registration cannot desynchronize the engine from the
   * solver: no §37 method re-types an existing solver body, so a component that
   * changed type must be removed and added again (documented on
   * {@link PhysicsWorld.addBody}).
   */
  readonly type: BodyType;
  /** Registered colliders in creation order; destroyed in reverse. */
  readonly colliders: ColliderRegistration[];
  /** Whether the node was tracked in the §43 pose buffer by this registration. */
  readonly tracked: boolean;
}

/**
 * Quantizes one value to §33's 1e-6 grid, normalizing `-0` to `+0` first.
 *
 * Identical to `@four/diagnostics`'s D6 hasher, which `@four/physics` may not
 * import (the frozen dependency matrix gives this package core, math, scene, and
 * motion only). The two implementations must agree byte for byte; see
 * {@link PhysicsWorld.checksum}.
 */
function quantize(x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(
      `Checksum inputs must be finite numbers (§33 quantization is undefined for ${String(x)}).`,
    );
  }
  const normalized = x === 0 ? 0 : x;
  const q = Math.round(normalized * QUANTIZATION_SCALE);
  if (Math.abs(q) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `Checksum input ${String(x)} quantizes to ${String(q)}, outside the 53-bit-safe range ` +
        `(±${String(Number.MAX_SAFE_INTEGER)}); §41 supports coordinates within ~1e5 units of the origin.`,
    );
  }
  return q === 0 ? 0 : q;
}

/** Absorbs the four little-endian bytes of a 32-bit word into an FNV-1a state. */
function absorbWord(state: number, word: number): number {
  const w = word >>> 0;
  let h = state;
  h = Math.imul(h ^ (w & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 8) & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 16) & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 24) & 0xff), FNV_PRIME) >>> 0;
  return h;
}

/** Absorbs one float as its quantized low then high uint32 word (§33, D6). */
function absorbFloat(state: number, x: number): number {
  const q = quantize(x);
  let low = q % TWO_POW_32;
  if (low < 0) {
    low += TWO_POW_32;
  }
  const high = (q - low) / TWO_POW_32;
  return absorbWord(absorbWord(state, low), high);
}

/**
 * A simulated world (§20) driven by one solver adapter.
 *
 * See the module header for the pipeline, the pose contract, and what the world
 * does not own.
 */
export class PhysicsWorld {
  /** The adapter this world drives (plan P5-5). */
  readonly #adapter: PhysicsWorldAdapter;

  /** The §21 dimension, fixed at construction. */
  readonly #dimension: PhysicsDimension;

  /** Resolved world gravity in m/s² (§21, Appendix A). Owned; never handed out. */
  readonly #gravity: Vector3;

  /** Resolved §32 sleeping configuration, frozen. */
  readonly #sleeping: SleepingConfig;

  /** The §33 tier this world asked for, which the adapter can meet. */
  readonly #determinism: DeterminismLevel;

  /** The exact record handed to `adapter.initialize` (§37). */
  readonly #options: PhysicsWorldOptions;

  /** The §43 pose store, when the application supplied one. */
  readonly #poses: PoseBuffer | undefined;

  /**
   * Registered bodies keyed by node, in **registration order** — `Map`
   * iteration is insertion order, which is the only order §33 permits.
   */
  readonly #bodiesByNode = new Map<Node, BodyRegistration>();

  /** Registered bodies keyed by the adapter's monotonic id (§33, event mapping). */
  readonly #bodiesById = new Map<number, BodyRegistration>();

  /** Registered colliders keyed by the adapter's monotonic id. */
  readonly #collidersById = new Map<number, ColliderRegistration>();

  /** Events drained from the last step, awaiting {@link PhysicsWorld.dispatchEvents}. */
  #queue: WorldPhysicsEvent[] = [];

  #initializeStarted = false;

  #initialized = false;

  #disposed = false;

  /** Checksum scratch, so a per-step checksum allocates nothing (§7b, D7). */
  readonly #checksumPosition = new Vector3();

  readonly #checksumRotation = new Quaternion();

  readonly #checksumLinear = new Vector3();

  readonly #checksumAngular = new Vector3();

  /**
   * Builds a world for `init.adapter` and validates that the adapter can
   * actually simulate it (§21, §33, §37).
   *
   * The options are checked by `validatePhysicsWorldOptions` (§85) and then
   * *resolved*: gravity is widened to the engine's 3D form (Appendix A's
   * `(0, -9.81, 0)` when omitted, in both dimensions — §7a puts +Y up in both),
   * sleeping is merged over Appendix A's defaults, and determinism defaults to
   * `"same-runtime"`. The resolved record is what `initialize` hands the
   * adapter, so the solver and the engine agree on every value.
   *
   * @throws FourError if the options are invalid (§85), if the adapter does not
   * declare `dimension` among its `capabilities.dimensions`, or if the requested
   * determinism tier is stronger than the adapter declares (§33, §37).
   */
  constructor(init: PhysicsWorldInit) {
    validatePhysicsWorldOptions(init);

    const capabilities = init.adapter.capabilities;
    if (!capabilities.dimensions.includes(init.dimension)) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Adapter ${JSON.stringify(init.adapter.name)} declares dimensions [${capabilities.dimensions.join(", ")}] and cannot simulate a ${JSON.stringify(init.dimension)} world (§21, §37).`,
        {
          context: {
            adapter: init.adapter.name,
            requested: init.dimension,
            supported: [...capabilities.dimensions],
          },
        },
      );
    }

    const determinism = init.determinism ?? DEFAULT_DETERMINISM_LEVEL;
    if (
      DETERMINISM_LEVELS.indexOf(determinism) >
      DETERMINISM_LEVELS.indexOf(capabilities.determinism)
    ) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Adapter ${JSON.stringify(init.adapter.name)} declares determinism ${JSON.stringify(capabilities.determinism)}, weaker than the requested ${JSON.stringify(determinism)} (§33, §37). Ask for a tier the solver can reach, or use another solver.`,
        {
          context: {
            adapter: init.adapter.name,
            requested: determinism,
            declared: capabilities.determinism,
          },
        },
      );
    }

    this.#adapter = init.adapter;
    this.#dimension = init.dimension;
    this.#gravity = resolveGravity(init.dimension, init.gravity);
    this.#sleeping = resolveSleepingConfig(init.sleeping);
    this.#determinism = determinism;
    this.#poses = init.poses;
    this.#options = Object.freeze({
      dimension: this.#dimension,
      gravity: this.#gravity,
      sleeping: this.#sleeping,
      determinism,
    });
  }

  // --- configuration --------------------------------------------------------

  /** The solver this world drives (§37). */
  get adapter(): PhysicsWorldAdapter {
    return this.#adapter;
  }

  /** The §21 dimension, fixed at construction. */
  get dimension(): PhysicsDimension {
    return this.#dimension;
  }

  /**
   * Resolved world gravity in m/s² (§21). The world's own vector — read it,
   * copy it, but do not write into it: the solver received it at `initialize`
   * and this object no longer decides what the solver does.
   */
  get gravity(): Vector3 {
    return this.#gravity;
  }

  /**
   * The resolved §32 sleeping configuration, kept accessible because an adapter
   * maps only what its solver exposes — Rapier 2D honours `enabled` and
   * compiles the three thresholds into its wasm — so a caller that needs to
   * know what was *asked for* can still read it here.
   */
  get sleeping(): SleepingConfig {
    return this.#sleeping;
  }

  /** The §33 tier this world asked for and the adapter accepted. */
  get determinism(): DeterminismLevel {
    return this.#determinism;
  }

  /** The exact `PhysicsWorldOptions` record handed to `adapter.initialize` (§37). */
  get options(): PhysicsWorldOptions {
    return this.#options;
  }

  /** Whether {@link PhysicsWorld.initialize} has completed. */
  get initialized(): boolean {
    return this.#initialized;
  }

  /** Whether {@link PhysicsWorld.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** How many bodies are registered. */
  get size(): number {
    return this.#bodiesByNode.size;
  }

  /** The registered nodes, in registration order (§33). */
  get nodes(): IterableIterator<Node> {
    return this.#bodiesByNode.keys();
  }

  /**
   * The events drained from the last {@link PhysicsWorld.step} and not yet
   * dispatched, in adapter order. Emptied by
   * {@link PhysicsWorld.dispatchEvents}.
   */
  get queuedEvents(): readonly WorldPhysicsEvent[] {
    return this.#queue;
  }

  // --- lifecycle ------------------------------------------------------------

  /**
   * Creates the solver's world (§37), awaiting the adapter's `initialize`.
   *
   * A WebAssembly-backed solver loads its module here (plan P5-1), which is why
   * this is asynchronous even though nothing in the physics package is. Nothing
   * may be registered or stepped before it resolves.
   *
   * @throws FourError if called twice or after `dispose`.
   */
  async initialize(): Promise<void> {
    this.#assertNotDisposed();
    if (this.#initializeStarted) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "PhysicsWorld.initialize was called twice; one world owns one solver world (§37). Construct a second world with its own adapter instead.",
        { context: { adapter: this.#adapter.name } },
      );
    }
    this.#initializeStarted = true;
    await this.#adapter.initialize(this.#options);
    this.#initialized = true;
  }

  /**
   * Registers `node`'s body and its colliders with the solver (§23, §24, §37).
   *
   * ```ts
   * node.addComponent(new RigidBody({ type: "dynamic" }));
   * node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
   * world.addBody(node);
   * ```
   *
   * ## Which colliders are registered (decision, WP-5.3)
   *
   * The **whole subtree** rooted at `node` is scanned, depth-first in child
   * insertion order and to unbounded depth, and a collider joins this body when
   * its own §24 ancestor walk (`Collider.body`: the nearest `RigidBody` at or
   * above its node) names **this** body.
   *
   * So the scan is the exact dual of the resolution a collider already performs,
   * and it needs no second rule: an intermediate node with no body is
   * transparent — a visual grouping node between a body and its collider changes
   * nothing — while a descendant that carries its own `RigidBody` claims its own
   * colliders, which are skipped here and registered by their own
   * `addBody(childNode)` call. That is why several colliders on one body are
   * expressed as child nodes (WP-5.2).
   *
   * ## The initial pose (decision, WP-5.3)
   *
   * An authored `position`/`rotation` on the `RigidBody` descriptor wins; when
   * the descriptor carried neither, the body starts at the node's **local**
   * `transform` — which is where the author put it, and refusing to read it
   * would drop a body at the origin the first time it is registered. Either way
   * the solved pose is written back onto the node after the first step (§42), so
   * the node and the solver converge immediately.
   *
   * Phase 5 reads and writes the *local* transform, so a body node is expected
   * to sit at the scene root or under an identity ancestor chain; a hierarchy
   * that scales or rotates above a body is out of scope until the §19 pipeline
   * of Phase 7.
   *
   * ## Mass (§23, §25; plan §6d note of 2026-08-01)
   *
   * Mass-from-density is the solver's derivation, so after the colliders exist
   * the world reads `getBodyMass` back onto the component: a dynamic body whose
   * mass was never authored stops reporting `inverseMass === NaN`. A solver that
   * reports a non-positive mass — a body with no collider, or a static body —
   * leaves the component's `mass` alone, because §23 forbids expressing "does
   * not simulate" as a zero mass.
   *
   * A `RigidBody` whose `type` changes after registration is **not** re-typed in
   * the solver (§37 has no such call); remove it and add it again.
   *
   * @returns the registered `RigidBody` component
   * @throws FourError if the world is not initialized, if `node` has no
   * `RigidBody`, if it is already registered, if a scanned collider has no body
   * (§23), or if the body or a collider is invalid for this dimension (§21, §85)
   */
  addBody(node: Node): RigidBody {
    this.#requireReady();
    if (this.#bodiesByNode.has(node)) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Node ${node.id} is already registered with this PhysicsWorld; a node carries one RigidBody (§6a) and one solver body (§37).`,
        { context: { node: node.id } },
      );
    }

    const body = node.getComponent(RigidBody);
    if (body === undefined) {
      throw new FourError(
        "INVALID_SCENE_GRAPH",
        `Node ${node.id} has no RigidBody component, so there is nothing to register (§23, §6a). Attach one with node.addComponent(new RigidBody({ type: … })) before calling addBody.`,
        { context: { node: node.id } },
      );
    }

    // Validate everything before the adapter is touched, so a rejected
    // registration leaves no half-built body in the solver (§85).
    const colliders: Collider[] = [];
    this.#collectColliders(node, body, colliders);
    body.validateFor(this.#dimension);
    for (const collider of colliders) {
      collider.validateFor(this.#dimension);
    }

    const descriptor = body.toDescriptor();
    if (
      descriptor.position === undefined &&
      descriptor.rotation === undefined
    ) {
      descriptor.position = node.transform.position;
      descriptor.rotation = node.transform.rotation;
    }
    const handle = this.#adapter.createBody(descriptor);
    const id = this.#adapter.getBodyId(handle);

    const tracked = this.#poses !== undefined && body.type === "dynamic";
    const registration: BodyRegistration = {
      node,
      body,
      handle,
      id,
      type: body.type,
      colliders: [],
      tracked,
    };

    for (const collider of colliders) {
      const colliderHandle = this.#adapter.createCollider(
        collider.toDescriptor(handle),
      );
      const colliderRegistration: ColliderRegistration = {
        collider,
        handle: colliderHandle,
        id: this.#adapter.getColliderId(colliderHandle),
        body: registration,
      };
      registration.colliders.push(colliderRegistration);
      this.#collidersById.set(colliderRegistration.id, colliderRegistration);
    }

    this.#bodiesByNode.set(node, registration);
    this.#bodiesById.set(id, registration);
    if (tracked) {
      this.#poses?.track(node);
    }

    this.#refreshMassProperties(registration);
    return body;
  }

  /**
   * Removes `node`'s body and its colliders from the solver, in reverse
   * creation order (§37, §83).
   *
   * Returns whether the node was registered, so teardown paths may call it
   * unconditionally. The components are left intact and can be registered with
   * another world; only the solver objects and this world's bookkeeping go away.
   * Events already queued for the removed body are still dispatched — they
   * describe a step that happened.
   */
  removeBody(node: Node): boolean {
    const registration = this.#bodiesByNode.get(node);
    if (registration === undefined) {
      return false;
    }
    this.#destroyRegistration(registration);
    this.#bodiesByNode.delete(node);
    this.#bodiesById.delete(registration.id);
    return true;
  }

  /** Whether `node` is registered with this world. */
  has(node: Node): boolean {
    return this.#bodiesByNode.has(node);
  }

  /** The `RigidBody` registered for `node`, or `undefined`. */
  getBody(node: Node): RigidBody | undefined {
    return this.#bodiesByNode.get(node)?.body;
  }

  // --- the fixed step -------------------------------------------------------

  /**
   * Advances the simulation by exactly `deltaSeconds` (§10, §37, §39).
   *
   * Runs steps 1–6 of the pipeline in the module header and leaves the step's
   * events queued; call {@link PhysicsWorld.dispatchEvents} afterwards, which is
   * what `PhysicsSystem` does once every world has stepped (§39 step 9).
   *
   * `deltaSeconds` is **seconds** (§7a) and comes from the application clock's
   * fixed delta — the accumulator, the sub-step clamp, and `droppedTime` are
   * §10's business, not the world's. Nothing here reads a clock (§33).
   *
   * Allocates nothing in steady state: the per-body loops write into the
   * components' and nodes' own vectors, and the event queue is reused unless the
   * step actually produced events.
   */
  step(deltaSeconds: number): void {
    this.#requireReady();
    for (const registration of this.#bodiesByNode.values()) {
      this.#applyCommands(registration);
      this.#feedKinematic(registration);
    }
    this.#adapter.syncSceneToSolver();
    this.#adapter.step(deltaSeconds);
    this.#adapter.syncSolverToScene();
    for (const registration of this.#bodiesByNode.values()) {
      this.#publishBody(registration);
    }
    this.#collectEvents();
  }

  /**
   * Emits every event queued by the last {@link PhysicsWorld.step} on the node
   * emitters §29 names, then empties the queue (§6b, §39 step 9).
   *
   * ## Ordering, in full
   *
   * 1. Events are dispatched **in the adapter's `drainEvents` order**, which
   *    §37 requires to be deterministic for a given step. The world neither
   *    sorts nor derives events — an adapter that reports `collisionstay`
   *    reports it itself.
   * 2. A collision event is emitted on **`bodyA`'s emitter first, then
   *    `bodyB`'s**, with the same payload object both times: §29 fixes no
   *    meaning to the A/B order beyond internal consistency, so re-labelling the
   *    pair per listener would be inventing information. A pair whose colliders
   *    share one body is emitted once.
   * 3. A trigger event is emitted on the **sensor collider's** emitter only —
   *    §29's `sensor.on("triggerenter", …)`. Two overlapping sensors are
   *    reported by the adapter as two events, once from each side, so each
   *    sensor's listeners still fire.
   * 4. A sleep or wake event is emitted on the **body**. `RigidBody.sleeping`
   *    was already refreshed during the step, so a listener sees the state the
   *    event announces.
   *
   * The queue is handed over before the first callback runs, so a listener may
   * create bodies, remove bodies, or step another world without re-entering
   * this dispatch or losing events; anything a re-entrant step queues is
   * dispatched by that step's own `dispatchEvents`.
   */
  dispatchEvents(): void {
    const queued = this.#queue;
    if (queued.length === 0) {
      return;
    }
    this.#queue = [];
    for (let i = 0; i < queued.length; i += 1) {
      const event = queued[i];
      switch (event.type) {
        case "collisionstart":
        case "collisionstay":
        case "collisionend": {
          const collision: RigidBodyCollisionEvent = event;
          collision.bodyA.emit(collision.type, collision);
          if (collision.bodyB !== collision.bodyA) {
            collision.bodyB.emit(collision.type, collision);
          }
          break;
        }
        case "triggerenter":
        case "triggerexit": {
          const trigger: ColliderTriggerEvent = event;
          trigger.sensor.emit(trigger.type, trigger);
          break;
        }
        default: {
          const sleep: RigidBodySleepEvent = event;
          sleep.body.emit(sleep.type, sleep);
          break;
        }
      }
    }
  }

  // --- §30 queries ----------------------------------------------------------

  /**
   * Casts a ray and returns the hits with component references (§30).
   *
   * ```ts
   * const hits = world.raycast({ origin: new Vector2(0, 0), direction: new Vector2(1, 0) });
   * ```
   *
   * §30's filter semantics — groups, masks, ignored bodies, first/all, sorting,
   * sensor inclusion, custom predicates — live in the query record and are
   * applied by the adapter through the package's own `passesQueryFilter`, so
   * every solver answers a query identically. Hits on colliders this world has
   * not registered are dropped: the world can only report components it knows.
   */
  raycast(query: RaycastQuery): WorldRaycastHit[] {
    this.#requireQuery("raycast");
    const hits: WorldRaycastHit[] = [];
    for (const hit of this.#adapter.raycast(query)) {
      const target = this.#resolveHit(hit.collider);
      if (target !== undefined) {
        hits.push({
          collider: target.collider,
          body: target.body.body,
          point: hit.point,
          normal: hit.normal,
          distance: hit.distance,
        });
      }
    }
    return hits;
  }

  /** Sweeps a shape through the world (§30). See {@link PhysicsWorld.raycast}. */
  shapeCast(query: ShapeCastQuery): WorldShapeCastHit[] {
    this.#requireQuery("shapeCast");
    const hits: WorldShapeCastHit[] = [];
    for (const hit of this.#adapter.shapeCast(query)) {
      const target = this.#resolveHit(hit.collider);
      if (target !== undefined) {
        hits.push({
          collider: target.collider,
          body: target.body.body,
          point: hit.point,
          normal: hit.normal,
          distance: hit.distance,
        });
      }
    }
    return hits;
  }

  /**
   * Everything overlapping a ball centred at `center` (§30 `overlapSphere`).
   *
   * §21's parallel naming: in a `"2d"` world this is a **circle** overlap and in
   * a `"3d"` world a sphere overlap — one call, the shape the dimension implies.
   */
  overlapSphere(
    center: Vector3Input,
    radius: number,
    options?: QueryOptions,
  ): WorldOverlapHit[] {
    const shape: CollisionShape =
      this.#dimension === "2d"
        ? { type: "circle", radius }
        : { type: "sphere", radius };
    return this.#overlap(shape, center, undefined, options);
  }

  /**
   * Everything overlapping a box centred at `center` (§30 `overlapBox`).
   *
   * A **rectangle** in a `"2d"` world — where only `halfExtents.x` and
   * `halfExtents.y` are read, since there is no third axis — and a box in a
   * `"3d"` world (§21).
   */
  overlapBox(
    center: Vector3Input,
    halfExtents: Vector3Input,
    rotation?: RotationInput,
    options?: QueryOptions,
  ): WorldOverlapHit[] {
    const shape: CollisionShape =
      this.#dimension === "2d"
        ? {
            type: "rectangle",
            halfExtents: new Vector2(halfExtents.x, halfExtents.y),
          }
        : {
            type: "box",
            halfExtents: new Vector3(
              halfExtents.x,
              halfExtents.y,
              "z" in halfExtents ? halfExtents.z : 0,
            ),
          };
    return this.#overlap(shape, center, rotation, options);
  }

  /** Everything containing `point` (§30 `world.pointQuery`). */
  pointQuery(point: Vector3Input, options?: QueryOptions): WorldPointHit[] {
    this.#requireQuery("point");
    const query: PointQuery = { ...options, point };
    const hits: WorldPointHit[] = [];
    for (const hit of this.#adapter.pointQuery(query)) {
      const target = this.#resolveHit(hit.collider);
      if (target !== undefined) {
        hits.push({
          collider: target.collider,
          body: target.body.body,
          point: hit.point,
          distance: hit.distance,
        });
      }
    }
    return hits;
  }

  // --- §33 determinism, §34 snapshots ---------------------------------------

  /**
   * The §33 per-step determinism checksum, as a uint32.
   *
   * §33 defines it exactly: *"FNV-1a over each existing body's transform and
   * velocities (sleeping bodies included), quantized to 1e-6, visited in
   * ascending engine-assigned monotonic body id"*. So, per body, thirteen
   * floats in this order — position `x, y, z`, rotation `x, y, z, w`, linear
   * velocity `x, y, z`, angular velocity `x, y, z` — each quantized by
   * `Math.round(v * 1e6)` and absorbed as its low then high uint32 word in
   * little-endian bytes. Sleeping bodies are visited like any other; the sleep
   * *flag* is not hashed, because §33 hashes transforms and velocities.
   *
   * The visit order is `SolverBodyAccess.forEachBody`, which is creation order
   * and therefore ascending id: destroying a body removes it from the sequence
   * and creating one appends, so no destruction can permute the order, and a
   * §34 snapshot restore preserves it. Bodies that belong to the solver but not
   * to this world's registry — there should be none — are still hashed, because
   * §33 says "each existing body".
   *
   * The algorithm is D6's, byte for byte identical to
   * `@four/diagnostics`'s `hashFloats`; it is re-implemented here because the
   * frozen dependency matrix gives `@four/physics` core, math, scene, and motion
   * only. `tests/world.test.ts` pins the digest of a known world so the two
   * cannot drift apart silently.
   *
   * Allocates nothing.
   *
   * @throws RangeError if a body's state contains a non-finite value, which has
   * no meaningful quantization and would silently poison a golden hash
   */
  checksum(): number {
    this.#requireReady();
    const position = this.#checksumPosition;
    const rotation = this.#checksumRotation;
    const linear = this.#checksumLinear;
    const angular = this.#checksumAngular;
    let state = FNV_OFFSET_BASIS >>> 0;
    this.#adapter.forEachBody((handle) => {
      this.#adapter.getBodyTransform(handle, position, rotation);
      this.#adapter.getBodyVelocities(handle, linear, angular);
      state = absorbFloat(state, position.x);
      state = absorbFloat(state, position.y);
      state = absorbFloat(state, position.z);
      state = absorbFloat(state, rotation.x);
      state = absorbFloat(state, rotation.y);
      state = absorbFloat(state, rotation.z);
      state = absorbFloat(state, rotation.w);
      state = absorbFloat(state, linear.x);
      state = absorbFloat(state, linear.y);
      state = absorbFloat(state, linear.z);
      state = absorbFloat(state, angular.x);
      state = absorbFloat(state, angular.y);
      state = absorbFloat(state, angular.z);
    });
    return state >>> 0;
  }

  /**
   * Captures the solver's world with §34's validity metadata.
   *
   * The bytes are the adapter's and opaque; the envelope records the adapter's
   * `name` and `version` so {@link PhysicsWorld.restoreSnapshot} can refuse a
   * buffer from a different solver instead of handing it to a deserializer that
   * would either throw obscurely or, worse, succeed.
   *
   * @throws FourError if the adapter does not implement snapshots
   * (`capabilities.snapshots === false`)
   */
  createSnapshot(): PhysicsSnapshot {
    this.#requireReady();
    if (
      !this.#adapter.capabilities.snapshots ||
      this.#adapter.createSnapshot === undefined
    ) {
      throw new FourError(
        "NOT_IMPLEMENTED",
        `Adapter ${JSON.stringify(this.#adapter.name)} declares capabilities.snapshots: false and cannot capture a world (§34, §37).`,
        { context: { adapter: this.#adapter.name } },
      );
    }
    return {
      adapterName: this.#adapter.name,
      adapterVersion: this.#adapter.version,
      data: this.#adapter.createSnapshot(),
    };
  }

  /**
   * Restores a snapshot taken from **this adapter and this adapter version**
   * (§34).
   *
   * This world's node ↔ body maps survive the round trip untouched, and they may:
   * §34 requires body identity and ordering to survive a restore, and §37's ids
   * are monotonic, so the id a registration recorded still names the same body
   * afterwards. What a restore *does* change is the state of those bodies —
   * poses, velocities, sleep — which the next step publishes onto the nodes.
   *
   * @throws FourError if the adapter does not implement snapshots, or if the
   * snapshot's `adapterName`/`adapterVersion` do not match this adapter's —
   * §34: "a replay refuses to run against a different solver"
   */
  restoreSnapshot(snapshot: PhysicsSnapshot): void {
    this.#requireReady();
    if (
      !this.#adapter.capabilities.snapshots ||
      this.#adapter.restoreSnapshot === undefined
    ) {
      throw new FourError(
        "NOT_IMPLEMENTED",
        `Adapter ${JSON.stringify(this.#adapter.name)} declares capabilities.snapshots: false and cannot restore a world (§34, §37).`,
        { context: { adapter: this.#adapter.name } },
      );
    }
    if (snapshot.adapterName !== this.#adapter.name) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Snapshot was taken with adapter ${JSON.stringify(snapshot.adapterName)} and this world runs ${JSON.stringify(this.#adapter.name)}; snapshots are opaque adapter data and are valid only for the adapter that produced them (§34).`,
        {
          context: {
            expected: this.#adapter.name,
            found: snapshot.adapterName,
          },
        },
      );
    }
    if (snapshot.adapterVersion !== this.#adapter.version) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Snapshot was taken with ${JSON.stringify(snapshot.adapterName)} version ${JSON.stringify(snapshot.adapterVersion)} and this world runs version ${JSON.stringify(this.#adapter.version)}; a snapshot is valid only for the adapter version that produced it (§34).`,
        {
          context: {
            adapter: this.#adapter.name,
            expected: this.#adapter.version,
            found: snapshot.adapterVersion,
          },
        },
      );
    }
    this.#adapter.restoreSnapshot(snapshot.data);
  }

  /**
   * Destroys every registered body — colliders first, in reverse creation order
   * — then disposes the adapter (§83).
   *
   * Idempotent and terminal: the world cannot be stepped or registered with
   * afterwards. Nodes are untracked from the pose buffer but their components
   * and transforms are left exactly as they were; the world owns the solver
   * objects, not the scene.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const registrations = [...this.#bodiesByNode.values()].reverse();
    for (const registration of registrations) {
      this.#destroyRegistration(registration);
    }
    this.#bodiesByNode.clear();
    this.#bodiesById.clear();
    this.#collidersById.clear();
    this.#queue = [];
    this.#adapter.dispose();
  }

  // --- internals ------------------------------------------------------------

  /**
   * Collects the colliders belonging to `body`: every `Collider` in the subtree
   * rooted at `node` whose own §24 ancestor walk names `body`.
   *
   * The walk is depth-first in child insertion order and the *test* — not the
   * traversal — is what excludes a nested body's colliders, so the world adds no
   * second rule of its own: a collider is registered by exactly the body
   * `Collider.body` resolves to. `requireBody` supplies that resolution and
   * turns a body-less collider into the §23 error naming the node.
   */
  #collectColliders(node: Node, body: RigidBody, out: Collider[]): void {
    const collider = node.getComponent(Collider);
    if (collider !== undefined && collider.requireBody() === body) {
      out.push(collider);
    }
    for (const child of node.children) {
      this.#collectColliders(child, body, out);
    }
  }

  /**
   * Reads the solver's mass back onto the component after registration (§23,
   * §25; plan §6d note of 2026-08-01). See {@link PhysicsWorld.addBody}.
   */
  #refreshMassProperties(registration: BodyRegistration): void {
    const mass = this.#adapter.getBodyMass(registration.handle);
    if (Number.isFinite(mass) && mass > 0) {
      registration.body.mass = mass;
    }
  }

  /**
   * Drains one body's §26 command buffer into the solver and clears it (§26,
   * §32).
   *
   * Forces and torques are reset first, because a solver commonly keeps user
   * forces until they are cleared and §26 makes a force act for exactly one
   * step; impulses are applied as they stand and the buffer's own clearing makes
   * them one-shot. Zero-magnitude accumulations are skipped — nothing was asked
   * for, and calling a solver with a zero force can wake a sleeping body.
   */
  #applyCommands(registration: BodyRegistration): void {
    const adapter = this.#adapter;
    const { handle, body } = registration;
    const commands = body.commands;

    adapter.resetForces(handle);
    if (!isZero(commands.force)) {
      adapter.applyForce(handle, commands.force);
    }
    if (!isZero(commands.torque)) {
      adapter.applyTorque(handle, commands.torque);
    }
    for (let i = 0; i < commands.pointForceCount; i += 1) {
      const load = commands.pointForces[i];
      adapter.applyForceAtPoint(handle, load.value, load.point);
    }
    if (!isZero(commands.impulse)) {
      adapter.applyImpulse(handle, commands.impulse);
    }
    if (!isZero(commands.angularImpulse)) {
      adapter.applyAngularImpulse(handle, commands.angularImpulse);
    }
    for (let i = 0; i < commands.pointImpulseCount; i += 1) {
      const load = commands.pointImpulses[i];
      adapter.applyImpulseAtPoint(handle, load.value, load.point);
    }
    if (commands.sleepCommand === "wake") {
      adapter.wakeBody(handle);
    } else if (commands.sleepCommand === "sleep") {
      adapter.sleepBody(handle);
    }
    clearRigidBodyCommands(body);
  }

  /**
   * Pushes a kinematic body's scene-authored target into the solver before the
   * step — §37's `syncSceneToSolver` role, expressed per handle (§22).
   *
   * - `"kinematic-position"` takes the node's local transform as the target
   *   pose, so the solver derives the motion that lets it push dynamic bodies.
   * - `"kinematic-velocity"` takes the component's authored velocities, which
   *   are §23's input for exactly this body type.
   *
   * A position-driven body whose node is under `"physics"` authority is skipped:
   * that authority means the solver owns the pose, so reading it back as a
   * target would be circular. Every other authority — `"manual"` (user code),
   * `"kinematic"` (`MotionSystem` and the §12 controller), `"animation"` (a clip
   * or timeline), and the externally-driven ones — is a scene-side writer whose
   * pose is precisely what a kinematic body should follow (decision, WP-5.3;
   * the packet named `"kinematic"`/`"animation"`, and the wider rule is the same
   * rule stated by its one exclusion).
   */
  #feedKinematic(registration: BodyRegistration): void {
    const { type, node, handle, body } = registration;
    if (type === "kinematic-position") {
      if (node.transformAuthority === PHYSICS_AUTHORITY) {
        return;
      }
      this.#adapter.setNextKinematicTransform(
        handle,
        node.transform.position,
        node.transform.rotation,
      );
      return;
    }
    if (type === "kinematic-velocity") {
      this.#adapter.setBodyVelocities(
        handle,
        body.linearVelocity,
        body.angularVelocity,
      );
    }
  }

  /**
   * Publishes one body's solved state after the step (§23, §32, §42).
   *
   * The transform is written **only for a dynamic body and only under
   * `"physics"` authority**: §42 gives a transform exactly one owner, and the
   * enforcement is the one `@four/scene` documents — the non-owner's write is
   * refused and reported once per node per writer, so the owner keeps the
   * transform. The solved pose goes straight into the node's own
   * `position`/`rotation`, which fires plan D3's change hooks and advances
   * `Transform.version` exactly once each.
   *
   * Velocities and the §32 sleep flag are refreshed for **every** body,
   * including one whose transform write was refused: they are the component
   * mirroring solver state that §23 promises ("the solver owns its velocities;
   * `syncSolverToScene` refreshes these fields"), not a transform write, so §42
   * has nothing to say about them and leaving them stale would make the
   * component lie about the simulation (decision, WP-5.3).
   */
  #publishBody(registration: BodyRegistration): void {
    const { node, body, handle, type } = registration;
    if (type === "dynamic") {
      if (node.transformAuthority === PHYSICS_AUTHORITY) {
        this.#adapter.getBodyTransform(
          handle,
          node.transform.position,
          node.transform.rotation,
        );
      } else {
        warnAuthorityConflict(node, PHYSICS_AUTHORITY);
      }
    }
    this.#adapter.getBodyVelocities(
      handle,
      body.linearVelocity,
      body.angularVelocity,
    );
    setRigidBodySleeping(body, this.#adapter.isBodySleeping(handle));
  }

  /**
   * Drains the step's events and queues them with component references (§29,
   * §37, §101).
   *
   * Translation happens **here**, immediately after the step and before any
   * listener runs, so a handle is resolved while it is still valid: a listener
   * that removes a body during dispatch cannot invalidate an event that was
   * already normalized. An event naming a body or collider this world has not
   * registered is dropped — there is no component to name in the payload.
   */
  #collectEvents(): void {
    const drained = this.#adapter.drainEvents();
    for (let i = 0; i < drained.length; i += 1) {
      const translated = this.#translate(drained[i]);
      if (translated !== undefined) {
        this.#queue.push(translated);
      }
    }
  }

  /** Swaps one event's handles for components, or `undefined` if unknown here. */
  #translate(event: PhysicsEvent): WorldPhysicsEvent | undefined {
    switch (event.type) {
      case "collisionstart":
      case "collisionstay":
      case "collisionend": {
        const bodyA = this.#bodyOf(event.bodyA);
        const bodyB = this.#bodyOf(event.bodyB);
        const colliderA = this.#colliderOf(event.colliderA);
        const colliderB = this.#colliderOf(event.colliderB);
        if (
          bodyA === undefined ||
          bodyB === undefined ||
          colliderA === undefined ||
          colliderB === undefined
        ) {
          return undefined;
        }
        return {
          type: event.type,
          bodyA: bodyA.body,
          bodyB: bodyB.body,
          colliderA: colliderA.collider,
          colliderB: colliderB.collider,
          contacts: event.contacts,
          relativeVelocity: event.relativeVelocity,
          totalImpulse: event.totalImpulse,
        };
      }
      case "triggerenter":
      case "triggerexit": {
        const sensor = this.#colliderOf(event.sensor);
        const sensorBody = this.#bodyOf(event.sensorBody);
        const other = this.#colliderOf(event.other);
        const otherBody = this.#bodyOf(event.otherBody);
        if (
          sensor === undefined ||
          sensorBody === undefined ||
          other === undefined ||
          otherBody === undefined
        ) {
          return undefined;
        }
        return {
          type: event.type,
          sensor: sensor.collider,
          sensorBody: sensorBody.body,
          other: other.collider,
          otherBody: otherBody.body,
        };
      }
      default: {
        const body = this.#bodyOf(event.body);
        if (body === undefined) {
          return undefined;
        }
        return { type: event.type, body: body.body };
      }
    }
  }

  /** The registration for a body handle, by the adapter's monotonic id (§33). */
  #bodyOf(handle: PhysicsBodyHandle): BodyRegistration | undefined {
    return this.#bodiesById.get(this.#adapter.getBodyId(handle));
  }

  /** The registration for a collider handle, by the adapter's monotonic id. */
  #colliderOf(handle: PhysicsColliderHandle): ColliderRegistration | undefined {
    return this.#collidersById.get(this.#adapter.getColliderId(handle));
  }

  /** {@link PhysicsWorld.overlapSphere} and `overlapBox` share this body (§30). */
  #overlap(
    shape: CollisionShape,
    position: Vector3Input,
    rotation: RotationInput | undefined,
    options: QueryOptions | undefined,
  ): WorldOverlapHit[] {
    this.#requireQuery("overlap");
    const query: OverlapQuery = { ...options, shape, position };
    if (rotation !== undefined) {
      query.rotation = rotation;
    }
    const hits: WorldOverlapHit[] = [];
    for (const hit of this.#adapter.overlap(query)) {
      const target = this.#resolveHit(hit.collider);
      if (target !== undefined) {
        hits.push({ collider: target.collider, body: target.body.body });
      }
    }
    return hits;
  }

  /** The registration behind a query hit, or `undefined` when unregistered. */
  #resolveHit(handle: PhysicsColliderHandle): ColliderRegistration | undefined {
    return this.#colliderOf(handle);
  }

  /** Destroys one registration's solver objects, colliders first (§37, §83). */
  #destroyRegistration(registration: BodyRegistration): void {
    for (let i = registration.colliders.length - 1; i >= 0; i -= 1) {
      const collider = registration.colliders[i];
      this.#collidersById.delete(collider.id);
      this.#adapter.destroyCollider(collider.handle);
    }
    registration.colliders.length = 0;
    this.#adapter.destroyBody(registration.handle);
    if (registration.tracked) {
      this.#poses?.untrack(registration.node);
    }
  }

  /** Guards the §30 surface against an adapter that does not implement it (§37). */
  #requireQuery(
    kind: keyof PhysicsWorldAdapter["capabilities"]["queries"],
  ): void {
    this.#requireReady();
    if (!this.#adapter.capabilities.queries[kind]) {
      throw new FourError(
        "NOT_IMPLEMENTED",
        `Adapter ${JSON.stringify(this.#adapter.name)} declares capabilities.queries.${kind}: false (§30, §37).`,
        { context: { adapter: this.#adapter.name, query: kind } },
      );
    }
  }

  /** Everything but the constructor needs an initialized, undisposed world. */
  #requireReady(): void {
    this.#assertNotDisposed();
    if (!this.#initialized) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "PhysicsWorld has not been initialized; await world.initialize() before registering bodies or stepping (§37: a WebAssembly solver loads its module there).",
        { context: { adapter: this.#adapter.name } },
      );
    }
  }

  /** A disposed world is terminal (§83). */
  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "PhysicsWorld has been disposed; its solver objects are gone and its adapter is disposed (§83). Construct a new world.",
        { context: { adapter: this.#adapter.name } },
      );
    }
  }
}

/** Whether an accumulated §26 command is empty, so the solver is left alone. */
function isZero(value: Vector3): boolean {
  return value.x === 0 && value.y === 0 && value.z === 0;
}
