/**
 * The solver adapter contract (§37) — the seam every physics backend
 * implements.
 *
 * §20's promise is that "users should not need to write solver-specific
 * application code for common tasks". This interface is how that promise is
 * kept: `@four/physics` is the stable API, and a concrete engine — Rapier,
 * Box2D, or a bespoke engineering solver — reaches it only through
 * {@link PhysicsSolverAdapter}. Nothing above this line names a solver type,
 * which is what lets the solver be swapped, compared against another, or left
 * out entirely.
 *
 * The interface below is §37's, member for member, with its abstract type names
 * bound to this package's concrete ones. Two shapes depart from §37's literal
 * text, both deliberately:
 *
 * - **`readonly` capability fields.** §37 writes `jointTypes: string[]`;
 *   {@link PhysicsCapabilities} makes the arrays and fields `readonly`. An
 *   adapter publishes its capabilities once and callers only read them — the
 *   same treatment `RendererCapabilities` (§62) got in `@four/render`, and for
 *   the same reason: a capability set that could be edited after negotiation
 *   would make the negotiation meaningless.
 * - **Handles are opaque.** §37's `PhysicsBodyHandle` and friends are named but
 *   not defined; `types.ts` makes them branded, unforgeable types. An adapter
 *   casts its own solver object to one and back; nobody else can.
 *
 * ## The call order the physics package guarantees (§37, §39)
 *
 * Per fixed step, and never in another order:
 *
 * 1. {@link PhysicsSolverAdapter.syncSceneToSolver} — scene-authored state goes
 *    in: kinematic targets, teleports, property changes.
 * 2. {@link PhysicsSolverAdapter.step} — the solver advances by one fixed
 *    delta.
 * 3. {@link PhysicsSolverAdapter.syncSolverToScene} — solved transforms come
 *    back out.
 * 4. {@link PhysicsSolverAdapter.drainEvents} — the step's contacts, triggers,
 *    and sleep transitions are collected, normalized (§101), and dispatched
 *    **after** the step (§6b, §29, §39 step 9).
 *
 * The pre-step body pose is retained by the physics package as the "previous"
 * pose for §43 render interpolation; interpolated poses are presentation-only
 * and are never written back into the solver (§43).
 *
 * ## What an adapter must never do
 *
 * - **Never invoke user callbacks** (§37). Events are returned from
 *   `drainEvents` and dispatched by the physics package, so a listener can
 *   safely create and destroy bodies without re-entering a running solver.
 * - **Never read the wall clock or `Math.random`** in the simulation path
 *   (§33). Time arrives as `step`'s argument; randomness comes from a seeded
 *   generator.
 * - **Never iterate in an order that is not insertion order** where that order
 *   can reach a result (§33).
 *
 * This module is types only — it ships no runtime code. The structural test
 * double that proves the interface is implementable is `FakeSolverAdapter`
 * (WP-5.3), alongside the world that drives it.
 */

import type { Disposable } from "@four/core";

import type {
  ColliderDescriptor,
  JointDescriptor,
  PhysicsWorldOptions,
  RigidBodyDescriptor,
} from "./descriptors.js";
import type { PhysicsEvent } from "./events.js";
import type {
  OverlapHit,
  OverlapQuery,
  PointHit,
  PointQuery,
  RaycastHit,
  RaycastQuery,
  ShapeCastHit,
  ShapeCastQuery,
} from "./queries.js";
import type {
  CCDMode,
  DeterminismLevel,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsDimension,
  PhysicsJointHandle,
} from "./types.js";

/**
 * Which queries an adapter implements (§37).
 *
 * Split out of {@link PhysicsCapabilities} only because §37 nests it there;
 * naming the type lets an adapter build its record with the compiler checking
 * that all four flags are answered.
 */
export interface PhysicsQueryCapabilities {
  /** Whether `raycast` is implemented (§30). */
  readonly raycast: boolean;
  /** Whether `shapeCast` is implemented (§30). */
  readonly shapeCast: boolean;
  /** Whether `overlap` is implemented (§30). */
  readonly overlap: boolean;
  /** Whether `pointQuery` is implemented (§30). */
  readonly point: boolean;
}

/**
 * What a solver can do (§37).
 *
 * §37: *"Capability declarations drive `solver: "auto"` selection (§20) and the
 * compatibility tables of §90."* They also decide what a world may ask for — a
 * world that requests a determinism tier or a CCD mode the adapter does not
 * declare fails at construction rather than degrading quietly (WP-5.3).
 *
 * Declarations must be **honest**. Declaring a capability an adapter does not
 * have converts a clear construction-time error into a wrong simulation, which
 * is the failure mode this whole record exists to prevent.
 */
export interface PhysicsCapabilities {
  /** The §21 dimensions this adapter can simulate; at least one. */
  readonly dimensions: readonly PhysicsDimension[];

  /**
   * The §28 joint types this adapter implements, by name.
   *
   * `string` rather than the engine's `JointType` union, per §37 — an adapter
   * may expose a solver-specific constraint the engine has no name for. An
   * adapter declares exactly the `ShippedJointType`s it builds (plan P6-1);
   * `[]` means `createJoint` throws `NOT_IMPLEMENTED`, which is where the two
   * Rapier adapters stand until WP-6.2/6.3.
   *
   * This declaration is about *which* types an adapter builds. Whether the
   * engine can talk to its joints at all — ids, reactions, live reconfiguration
   * — is the separate `SolverJointAccess` seam, detected structurally rather
   * than declared here, because §37 fixes this record's six fields.
   */
  readonly jointTypes: readonly string[];

  /**
   * The §31 CCD modes this adapter implements. Always contains `"disabled"`,
   * since doing nothing is always available.
   */
  readonly ccdModes: readonly CCDMode[];

  /**
   * The strongest §33 tier this adapter can actually achieve. Not an
   * aspiration: the §92 determinism tests are written against it.
   */
  readonly determinism: DeterminismLevel;

  /**
   * Whether {@link PhysicsSolverAdapter.createSnapshot} and
   * {@link PhysicsSolverAdapter.restoreSnapshot} are implemented (§34).
   */
  readonly snapshots: boolean;

  /** Which of §30's queries are implemented. */
  readonly queries: PhysicsQueryCapabilities;
}

/**
 * A concrete physics engine, bound to the four.js API (§37).
 *
 * ```ts
 * const adapter: PhysicsSolverAdapter = new RapierAdapter2D();
 * await adapter.initialize({ dimension: "2d", gravity: new Vector2(0, -9.81) });
 * const body = adapter.createBody({ type: "dynamic", position: new Vector2(0, 5) });
 * adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
 * // …per fixed step: syncSceneToSolver → step → syncSolverToScene → drainEvents
 * adapter.dispose();
 * ```
 *
 * Extends `Disposable` (§83) rather than re-declaring `dispose()`, which §37
 * lists; the member is restated below only to carry the physics-specific
 * contract.
 */
export interface PhysicsSolverAdapter extends Disposable {
  /**
   * Stable identifier of the backing solver, e.g. `"rapier2d"`. Recorded in
   * snapshots and replays (§34), which refuse to run against a different
   * solver.
   */
  readonly name: string;

  /**
   * Version of the backing solver. Part of a snapshot's validity key (§34): a
   * snapshot is opaque adapter data, valid only for the same adapter, adapter
   * version, and world configuration that produced it.
   */
  readonly version: string;

  /** What this adapter can do (§37). Readable before `initialize`. */
  readonly capabilities: PhysicsCapabilities;

  /**
   * Creates the solver's world from `options` (§37).
   *
   * May return a promise — WebAssembly-backed solvers load their module here —
   * or nothing when the solver is synchronous; §37 allows both, and the
   * physics package awaits the result either way. Calling it twice is an
   * implementation-defined error, not a second world.
   */
  initialize(options: PhysicsWorldOptions): Promise<void> | void;

  /** Creates a body and returns its opaque handle (§37, §23). */
  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle;

  /**
   * Destroys a body and everything attached to it (§37).
   *
   * The handle is invalid afterwards. §33's checksum orders bodies by an
   * engine-assigned monotonic id precisely so that destruction cannot perturb
   * that order.
   */
  destroyBody(handle: PhysicsBodyHandle): void;

  /** Creates a collider on `desc.body` and returns its handle (§37, §24). */
  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle;

  /** Destroys a collider (§37). The handle is invalid afterwards. */
  destroyCollider(handle: PhysicsColliderHandle): void;

  /**
   * Creates a joint and returns its handle (§37, §28).
   *
   * `desc` is the full plan P6-1 discriminated union (WP-6.1); anchors and axes
   * in it are **body-local**, already converted from the world-space frames the
   * `Joint` classes are authored in. An adapter that does not build the type it
   * is handed throws `FourError("NOT_IMPLEMENTED")` and declares that by
   * leaving the type out of `capabilities.jointTypes`.
   *
   * An adapter with joints also implements `SolverJointAccess`, without which
   * `PhysicsWorld.addJoint` refuses to register anything: §37's two methods mint
   * and release a handle but cannot answer for the joint afterwards.
   */
  createJoint(desc: JointDescriptor): PhysicsJointHandle;

  /**
   * Destroys a joint (§37). The handle is invalid afterwards.
   *
   * The physics package destroys a joint before either of its bodies and before
   * disposal, so an adapter never has to guess what a constraint on a dead body
   * means (§83).
   */
  destroyJoint(handle: PhysicsJointHandle): void;

  /**
   * Advances the simulation by exactly `delta` **seconds** (§7a, §10).
   *
   * Called once per fixed step with the world's fixed delta; the accumulator,
   * the sub-step clamp, and the dropped time are §10's business, not the
   * adapter's. An adapter must not sub-divide the step on its own except as
   * part of CCD, and must not read a clock to decide how far to advance (§33).
   */
  step(delta: number): void;

  /**
   * Returns and clears the events accumulated during the preceding `step`
   * (§37).
   *
   * Order must be deterministic for a given step. Returning an empty array is
   * normal. The physics package normalizes these into node-facing events (§101)
   * and dispatches them after the step (§6b, §29) — an adapter never calls user
   * code itself.
   */
  drainEvents(): PhysicsEvent[];

  /**
   * Pushes scene-authored state into the solver (§37): kinematic targets,
   * teleports, and property changes made since the last step.
   */
  syncSceneToSolver(): void;

  /**
   * Publishes solved body transforms back to the scene (§37), which the
   * physics package writes under `"physics"` transform authority (§42).
   */
  syncSolverToScene(): void;

  /** Casts a ray (§30). Requires `capabilities.queries.raycast`. */
  raycast(query: RaycastQuery): RaycastHit[];

  /** Sweeps a shape (§30). Requires `capabilities.queries.shapeCast`. */
  shapeCast(query: ShapeCastQuery): ShapeCastHit[];

  /** Tests a static shape for overlaps (§30). Requires `capabilities.queries.overlap`. */
  overlap(query: OverlapQuery): OverlapHit[];

  /** Tests a point (§30). Requires `capabilities.queries.point`. */
  pointQuery(query: PointQuery): PointHit[];

  /**
   * Serializes the solver's world (§34). Optional in §37, and present only when
   * `capabilities.snapshots` is `true`.
   *
   * The buffer is **opaque adapter data**: valid only for the same adapter,
   * the same adapter version, and the same world configuration that produced
   * it. The replay format records the adapter name and version and refuses to
   * run against a different solver (§34).
   */
  createSnapshot?(): ArrayBuffer;

  /**
   * Restores a world previously captured by
   * {@link PhysicsSolverAdapter.createSnapshot} (§34). Body identity and
   * ordering survive the round trip, so §33's checksums remain comparable
   * across a restore.
   */
  restoreSnapshot?(snapshot: ArrayBuffer): void;

  /**
   * Releases the solver's world and every resource this adapter owns (§37,
   * §83). Must be idempotent and terminal; handles minted by this adapter are
   * invalid afterwards.
   */
  dispose(): void;
}
