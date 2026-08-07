/**
 * `FakeSolverAdapter` — a structural `PhysicsSolverAdapter & SolverBodyAccess`
 * with no solver behind it (the fake-GL pattern, plan WP-5.3).
 *
 * The world is the object under test; the adapter is a seam. This double
 * implements both halves of that seam in the smallest way that keeps every
 * observable the world depends on **real**:
 *
 * - **monotonic ids** that ascend in creation order, are never reused, and
 *   survive a snapshot restore (§33, §34);
 * - **`forEachBody` / `forEachCollider` in creation order**, which is the
 *   ascending-id iteration §33's checksum is defined over;
 * - **settable body state** — pose, velocities, sleep, mass, CCD mode — so a
 *   test can put the "solver" in any state and watch what the world publishes;
 * - **scripted events**, one array per step, returned by `drainEvents` in the
 *   order they were scripted (§37 requires a deterministic order; the fake's is
 *   "exactly what the test asked for");
 * - **recorded calls**, every method with its arguments, so call *order* — the
 *   §37/§39 pipeline order the world promises — is assertable;
 * - **a toy integrator** in `step`, so poses actually change between steps and a
 *   §33 checksum has something to hash.
 *
 * It is deliberately **not exported from the package**: it is a test fixture,
 * not a shipped adapter, and `@four/physics` ships no solver (§20).
 *
 * ## Two doubles, on purpose (WP-6.1)
 *
 * `FakeSolverAdapter` has **no joints**: its `createJoint` throws
 * `NOT_IMPLEMENTED`, exactly as both Rapier adapters still do, and
 * `supportsSolverJointAccess` answers `false` for it — which is what proves the
 * world's structural seam detection. `FakeJointSolverAdapter` (bottom of this
 * file) is the same double *with* `SolverJointAccess`, including scripted
 * reaction impulses for the plan P6-2 break monitor.
 *
 * ## Three doubles, then (PH-1 stage 2, 2026-08-07)
 *
 * `FakeTuningSolverAdapter` is the same double *with* `SolverBodyTuningAccess`,
 * §37's post-registration property-change seam. It exists for the same reason
 * as the joint variant: the world detects that seam structurally too, so the
 * plain `FakeSolverAdapter` — which implements none of it — is what keeps
 * `RigidBody`'s "this write reaches no solver" warnings under test, and the
 * tuning variant is what proves a write does reach one.
 *
 * ## Mass model
 *
 * `mass = descriptor.mass ?? Σ collider density` — every shape has unit volume
 * here, which makes the derived mass exactly readable in a test while keeping
 * §23's rule ("authored mass wins; otherwise the solver derives it from collider
 * density") structurally intact. A body with no collider and no authored mass
 * has mass `0`, exactly as Rapier reports one, which is the case the world's
 * mass refresh has to leave alone.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import type { Matrix3 } from "@four/math";
import type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  ColliderDescriptor,
  JointDescriptor,
  SolverJointAccess,
  SolverJointMotor,
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
  RaycastHit,
  RaycastQuery,
  RigidBodyDescriptor,
  RotationInput,
  ShapeCastHit,
  ShapeCastQuery,
  SolverBodyAccess,
  SolverBodyTuningAccess,
  Vector3Input,
} from "../src/index.js";
import {
  DEFAULT_DENSITY,
  DEFAULT_GRAVITY_Y,
  resolveAngularVelocity,
  resolveRotation,
  widenToVector3,
} from "../src/index.js";

/** One recorded adapter call. */
export interface FakeCall {
  /** The method name, e.g. `"applyImpulse"`. */
  readonly method: string;
  /** The monotonic id of the body or collider it addressed, when it had one. */
  readonly id?: number;
  /** The arguments worth asserting on, already snapshotted where mutable. */
  readonly args: readonly unknown[];
}

/** The live state of one fake body — settable from a test. */
export interface FakeBody {
  readonly id: number;
  readonly handle: PhysicsBodyHandle;
  readonly descriptor: RigidBodyDescriptor;
  readonly position: Vector3;
  readonly rotation: Quaternion;
  readonly linearVelocity: Vector3;
  readonly angularVelocity: Vector3;
  /** Accumulated force, cleared by `resetForces` — §26's one-step semantics. */
  readonly force: Vector3;
  /** Accumulated torque, cleared by `resetForces`. */
  readonly torque: Vector3;
  /** The pending `"kinematic-position"` target, or `null`. */
  kinematicTarget: { position: Vector3; rotation: Quaternion } | null;
  /**
   * The §22 model the fake solver is currently running this body under.
   *
   * Seeded from `descriptor.type` and moved by
   * {@link FakeSolverAdapter.setBodyType} (WP-7.2). The integrator branches on
   * **this** and not on the descriptor, so a re-typed body starts behaving as
   * its new type on the very next `step` — which is the behaviour
   * `PhysicsWorld.setBodyControlMode` is asserted against.
   */
  type: BodyType;
  sleeping: boolean;
  mass: number;
  ccdMode: CCDMode;
  alive: boolean;
  /** Colliders created on this body, in creation order. */
  readonly colliders: FakeCollider[];
}

/** The live state of one fake collider. */
export interface FakeCollider {
  readonly id: number;
  readonly handle: PhysicsColliderHandle;
  readonly descriptor: ColliderDescriptor;
  readonly body: FakeBody;
  alive: boolean;
}

/** How a {@link FakeSolverAdapter} is configured. */
export interface FakeSolverAdapterOptions {
  /** §37 `name`. Default `"fake"`. */
  name?: string;
  /** §37 `version`, readable immediately (no wasm to wait for). Default `"1.0.0"`. */
  version?: string;
  /** Overrides merged over the default capability record. */
  capabilities?: Partial<PhysicsCapabilities>;
}

/** Default capabilities: everything, `"2d"` and `"3d"`, `same-runtime` (§37). */
function defaultCapabilities(): PhysicsCapabilities {
  return {
    dimensions: ["2d", "3d"] as readonly PhysicsDimension[],
    jointTypes: [],
    ccdModes: ["disabled", "speculative", "swept"] as readonly CCDMode[],
    determinism: "same-runtime",
    snapshots: true,
    queries: { raycast: true, shapeCast: true, overlap: true, point: true },
  };
}

/** Floats per body in a fake snapshot: id + pose (7) + velocities (6). */
const SNAPSHOT_FLOATS_PER_BODY = 14;

/** A solver-shaped test double; see the module header. */
export class FakeSolverAdapter
  implements PhysicsSolverAdapter, SolverBodyAccess
{
  readonly name: string;

  version: string;

  capabilities: PhysicsCapabilities;

  /** Every call this adapter received, in order. */
  readonly calls: FakeCall[] = [];

  /** Live bodies keyed by monotonic id; `Map` iteration is creation order. */
  readonly bodies = new Map<number, FakeBody>();

  /** Live colliders keyed by monotonic id. */
  readonly colliders = new Map<number, FakeCollider>();

  /** Hits the next `raycast` returns. */
  raycastHits: RaycastHit[] = [];

  /** Hits the next `shapeCast` returns. */
  shapeCastHits: ShapeCastHit[] = [];

  /** Hits the next `overlap` returns. */
  overlapHits: OverlapHit[] = [];

  /** Hits the next `pointQuery` returns. */
  pointHits: PointHit[] = [];

  /** World gravity, from `initialize`. */
  readonly gravity = new Vector3(0, DEFAULT_GRAVITY_Y, 0);

  /** How many times `step` ran. */
  steps = 0;

  #options: PhysicsWorldOptions | undefined;

  #nextBodyId = 1;

  #nextColliderId = 1;

  #disposed = false;

  /** One array of events per future step, consumed in order. */
  readonly #scripts: PhysicsEvent[][] = [];

  /** Events produced by the last `step`, handed over by `drainEvents`. */
  #pending: PhysicsEvent[] = [];

  constructor(options: FakeSolverAdapterOptions = {}) {
    this.name = options.name ?? "fake";
    this.version = options.version ?? "1.0.0";
    this.capabilities = { ...defaultCapabilities(), ...options.capabilities };
  }

  // --- test surface ---------------------------------------------------------

  /** The events the *next* `step` will produce. Call once per scripted step. */
  scriptEvents(...events: PhysicsEvent[]): void {
    this.#scripts.push(events);
  }

  /** Every recorded call to `method`, in order. */
  callsOf(method: string): FakeCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /** The recorded method names, in order — the pipeline's shape. */
  get callOrder(): string[] {
    return this.calls.map((call) => call.method);
  }

  /** Forgets every recorded call. */
  clearCalls(): void {
    this.calls.length = 0;
  }

  /** The live state of the body with monotonic id `id`. */
  body(id: number): FakeBody {
    const body = this.bodies.get(id);
    if (body === undefined) {
      throw new Error(`fake adapter has no body ${String(id)}`);
    }
    return body;
  }

  // --- PhysicsSolverAdapter (§37) -------------------------------------------

  initialize(options: PhysicsWorldOptions): Promise<void> {
    this.#record("initialize", undefined, options);
    this.#options = options;
    if (options.gravity !== undefined) {
      widenToVector3(options.gravity, this.gravity);
    }
    return Promise.resolve();
  }

  /** The options `initialize` received, or `undefined`. */
  get options(): PhysicsWorldOptions | undefined {
    return this.#options;
  }

  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle {
    const id = this.#nextBodyId;
    this.#nextBodyId += 1;
    const handle = { id } as unknown as PhysicsBodyHandle;
    const body: FakeBody = {
      id,
      handle,
      descriptor: desc,
      position:
        desc.position === undefined
          ? new Vector3()
          : widenToVector3(desc.position),
      rotation:
        desc.rotation === undefined
          ? new Quaternion()
          : resolveRotation("3d", desc.rotation),
      linearVelocity:
        desc.linearVelocity === undefined
          ? new Vector3()
          : widenToVector3(desc.linearVelocity),
      angularVelocity:
        desc.angularVelocity === undefined
          ? new Vector3()
          : resolveAngularVelocity("3d", desc.angularVelocity),
      force: new Vector3(),
      torque: new Vector3(),
      kinematicTarget: null,
      type: desc.type,
      sleeping: false,
      mass: desc.mass ?? 0,
      ccdMode: desc.ccdMode ?? "disabled",
      alive: true,
      colliders: [],
    };
    this.bodies.set(id, body);
    this.#record("createBody", id, desc.type);
    return handle;
  }

  destroyBody(handle: PhysicsBodyHandle): void {
    const body = this.#requireBody(handle);
    for (const collider of body.colliders) {
      if (collider.alive) {
        collider.alive = false;
        this.colliders.delete(collider.id);
      }
    }
    body.alive = false;
    this.bodies.delete(body.id);
    this.#record("destroyBody", body.id);
  }

  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle {
    const body = this.#requireBody(desc.body);
    const id = this.#nextColliderId;
    this.#nextColliderId += 1;
    const handle = { id } as unknown as PhysicsColliderHandle;
    const collider: FakeCollider = {
      id,
      handle,
      descriptor: desc,
      body,
      alive: true,
    };
    this.colliders.set(id, collider);
    body.colliders.push(collider);
    if (body.descriptor.mass === undefined) {
      // §23/§25: derived mass is the solver's job. Unit volume per shape.
      body.mass += desc.density ?? DEFAULT_DENSITY;
    }
    this.#record("createCollider", id, desc.shape.type, body.id);
    return handle;
  }

  destroyCollider(handle: PhysicsColliderHandle): void {
    const collider = this.#requireCollider(handle);
    collider.alive = false;
    this.colliders.delete(collider.id);
    // The mass model runs in both directions (PH-5): a collider that stops
    // existing stops contributing, which is what lets a test watch a
    // derived-mass body lose — and an authored-mass body keep — its mass across
    // a runtime removal. `destroyBody` never reaches here (the world tears a
    // registration down with one `destroyBody`), so this is the body-survives
    // case §37 defines `destroyCollider` for.
    const { body } = collider;
    const index = body.colliders.indexOf(collider);
    if (index >= 0) {
      body.colliders.splice(index, 1);
    }
    if (body.descriptor.mass === undefined) {
      body.mass -= collider.descriptor.density ?? DEFAULT_DENSITY;
    }
    this.#record("destroyCollider", collider.id);
  }

  createJoint(desc: JointDescriptor): PhysicsJointHandle {
    throw new FourError(
      "NOT_IMPLEMENTED",
      `Joints are staged to Phase 6 (plan P5-4); the fake adapter cannot create a ${desc.type} joint.`,
    );
  }

  destroyJoint(handle: PhysicsJointHandle): void {
    void handle;
    throw new FourError(
      "NOT_IMPLEMENTED",
      "Joints are staged to Phase 6 (plan P5-4); FakeJointSolverAdapter is the double that has them.",
    );
  }

  /**
   * Advances the toy integrator by `delta` seconds and produces the step's
   * scripted events.
   *
   * Dynamic bodies fall under gravity and move by their velocity; a
   * `"kinematic-position"` body jumps to its pending target; a
   * `"kinematic-velocity"` body moves by the velocity it was given. Sleeping
   * bodies do not move (§32). Nothing reads a clock (§33).
   */
  step(delta: number): void {
    this.#record("step", undefined, delta);
    this.steps += 1;
    for (const body of this.bodies.values()) {
      const type = body.type;
      if (type === "kinematic-position") {
        const target = body.kinematicTarget;
        if (target !== null) {
          body.position.copy(target.position);
          body.rotation.copy(target.rotation);
          body.kinematicTarget = null;
        }
        continue;
      }
      if (type === "kinematic-velocity") {
        this.#integratePosition(body, delta);
        continue;
      }
      if (type !== "dynamic" || body.sleeping) {
        continue;
      }
      const inverseMass = body.mass > 0 ? 1 / body.mass : 0;
      const gravityScale = body.descriptor.gravityScale ?? 1;
      body.linearVelocity.set(
        body.linearVelocity.x +
          (this.gravity.x * gravityScale + body.force.x * inverseMass) * delta,
        body.linearVelocity.y +
          (this.gravity.y * gravityScale + body.force.y * inverseMass) * delta,
        body.linearVelocity.z +
          (this.gravity.z * gravityScale + body.force.z * inverseMass) * delta,
      );
      body.angularVelocity.set(
        body.angularVelocity.x + body.torque.x * inverseMass * delta,
        body.angularVelocity.y + body.torque.y * inverseMass * delta,
        body.angularVelocity.z + body.torque.z * inverseMass * delta,
      );
      this.#integratePosition(body, delta);
    }
    this.#pending = this.#scripts.shift() ?? [];
  }

  drainEvents(): PhysicsEvent[] {
    this.#record("drainEvents");
    const drained = this.#pending;
    this.#pending = [];
    return drained;
  }

  syncSceneToSolver(): void {
    this.#record("syncSceneToSolver");
  }

  syncSolverToScene(): void {
    this.#record("syncSolverToScene");
  }

  raycast(query: RaycastQuery): RaycastHit[] {
    this.#record("raycast", undefined, query);
    return this.raycastHits;
  }

  shapeCast(query: ShapeCastQuery): ShapeCastHit[] {
    this.#record("shapeCast", undefined, query);
    return this.shapeCastHits;
  }

  overlap(query: OverlapQuery): OverlapHit[] {
    this.#record("overlap", undefined, query);
    return this.overlapHits;
  }

  pointQuery(query: PointQuery): PointHit[] {
    this.#record("pointQuery", undefined, query);
    return this.pointHits;
  }

  /**
   * Serializes the live bodies: the next id, then `id` and the thirteen state
   * floats per body, in creation order. Enough for a real round trip, which is
   * what makes the §34 tests meaningful.
   */
  createSnapshot(): ArrayBuffer {
    this.#record("createSnapshot");
    const bodies = [...this.bodies.values()];
    const data = new Float64Array(2 + bodies.length * SNAPSHOT_FLOATS_PER_BODY);
    data[0] = this.#nextBodyId;
    data[1] = bodies.length;
    let offset = 2;
    for (const body of bodies) {
      data[offset] = body.id;
      data[offset + 1] = body.position.x;
      data[offset + 2] = body.position.y;
      data[offset + 3] = body.position.z;
      data[offset + 4] = body.rotation.x;
      data[offset + 5] = body.rotation.y;
      data[offset + 6] = body.rotation.z;
      data[offset + 7] = body.rotation.w;
      data[offset + 8] = body.linearVelocity.x;
      data[offset + 9] = body.linearVelocity.y;
      data[offset + 10] = body.linearVelocity.z;
      data[offset + 11] = body.angularVelocity.x;
      data[offset + 12] = body.angularVelocity.y;
      data[offset + 13] = body.angularVelocity.z;
      offset += SNAPSHOT_FLOATS_PER_BODY;
    }
    return data.buffer;
  }

  /** Restores what {@link FakeSolverAdapter.createSnapshot} wrote; ids survive. */
  restoreSnapshot(snapshot: ArrayBuffer): void {
    this.#record("restoreSnapshot");
    const data = new Float64Array(snapshot);
    this.#nextBodyId = data[0];
    const count = data[1];
    let offset = 2;
    for (let i = 0; i < count; i += 1) {
      const body = this.bodies.get(data[offset]);
      if (body !== undefined) {
        body.position.set(data[offset + 1], data[offset + 2], data[offset + 3]);
        body.rotation.set(
          data[offset + 4],
          data[offset + 5],
          data[offset + 6],
          data[offset + 7],
        );
        body.linearVelocity.set(
          data[offset + 8],
          data[offset + 9],
          data[offset + 10],
        );
        body.angularVelocity.set(
          data[offset + 11],
          data[offset + 12],
          data[offset + 13],
        );
      }
      offset += SNAPSHOT_FLOATS_PER_BODY;
    }
  }

  dispose(): void {
    this.#record("dispose");
    this.#disposed = true;
    this.bodies.clear();
    this.colliders.clear();
  }

  /** Whether `dispose` has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  // --- SolverBodyAccess -----------------------------------------------------

  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void {
    const body = this.#requireBody(handle);
    this.#record("getBodyTransform", body.id);
    outPosition.copy(body.position);
    outRotation.copy(body.rotation);
  }

  setBodyTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation: RotationInput,
    wake = true,
  ): void {
    const body = this.#requireBody(handle);
    this.#record("setBodyTransform", body.id, wake);
    widenToVector3(position, body.position);
    resolveRotation("3d", rotation, body.rotation);
    if (wake) {
      body.sleeping = false;
    }
  }

  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const body = this.#requireBody(handle);
    this.#record("getBodyVelocities", body.id);
    outLinear.copy(body.linearVelocity);
    outAngular.copy(body.angularVelocity);
  }

  setBodyVelocities(
    handle: PhysicsBodyHandle,
    linear: Vector3Input,
    angular: AngularVelocityInput,
    wake = true,
  ): void {
    const body = this.#requireBody(handle);
    widenToVector3(linear, body.linearVelocity);
    resolveAngularVelocity("3d", angular, body.angularVelocity);
    this.#record(
      "setBodyVelocities",
      body.id,
      body.linearVelocity.clone(),
      body.angularVelocity.clone(),
      wake,
    );
  }

  applyForce(handle: PhysicsBodyHandle, force: Vector3Input): void {
    const body = this.#requireBody(handle);
    body.force.add(widenToVector3(force));
    this.#record("applyForce", body.id, body.force.clone());
  }

  applyForceAtPoint(
    handle: PhysicsBodyHandle,
    force: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    const body = this.#requireBody(handle);
    body.force.add(widenToVector3(force));
    this.#record(
      "applyForceAtPoint",
      body.id,
      widenToVector3(force),
      widenToVector3(worldPoint),
    );
  }

  applyTorque(handle: PhysicsBodyHandle, torque: AngularVelocityInput): void {
    const body = this.#requireBody(handle);
    body.torque.add(resolveAngularVelocity("3d", torque));
    this.#record("applyTorque", body.id, body.torque.clone());
  }

  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3Input): void {
    const body = this.#requireBody(handle);
    const value = widenToVector3(impulse);
    const inverseMass = body.mass > 0 ? 1 / body.mass : 0;
    body.linearVelocity.set(
      body.linearVelocity.x + value.x * inverseMass,
      body.linearVelocity.y + value.y * inverseMass,
      body.linearVelocity.z + value.z * inverseMass,
    );
    this.#record("applyImpulse", body.id, value);
  }

  applyImpulseAtPoint(
    handle: PhysicsBodyHandle,
    impulse: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    const body = this.#requireBody(handle);
    this.#record(
      "applyImpulseAtPoint",
      body.id,
      widenToVector3(impulse),
      widenToVector3(worldPoint),
    );
  }

  applyAngularImpulse(
    handle: PhysicsBodyHandle,
    angularImpulse: AngularVelocityInput,
  ): void {
    const body = this.#requireBody(handle);
    const value = resolveAngularVelocity("3d", angularImpulse);
    body.angularVelocity.add(value);
    this.#record("applyAngularImpulse", body.id, value);
  }

  resetForces(handle: PhysicsBodyHandle): void {
    const body = this.#requireBody(handle);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
    this.#record("resetForces", body.id);
  }

  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation?: RotationInput,
  ): void {
    const body = this.#requireBody(handle);
    body.kinematicTarget = {
      position: widenToVector3(position),
      rotation:
        rotation === undefined
          ? body.rotation.clone()
          : resolveRotation("3d", rotation),
    };
    this.#record(
      "setNextKinematicTransform",
      body.id,
      body.kinematicTarget.position.clone(),
    );
  }

  /**
   * Re-types a body in place (§22, plan P7-3), keeping its id, its place in
   * `bodies` — and therefore in {@link FakeSolverAdapter.forEachBody} — its
   * colliders, its pose, and its velocities.
   *
   * `wake` defaults to `true` and clears {@link FakeBody.sleeping}, exactly as
   * Rapier's own `setBodyType(type, wakeUp)` does; `false` leaves the §32 sleep
   * state alone.
   */
  setBodyType(handle: PhysicsBodyHandle, type: BodyType, wake = true): void {
    const body = this.#requireBody(handle);
    body.type = type;
    if (wake) {
      body.sleeping = false;
    }
    this.#record("setBodyType", body.id, type, wake);
  }

  wakeBody(handle: PhysicsBodyHandle): void {
    const body = this.#requireBody(handle);
    body.sleeping = false;
    this.#record("wakeBody", body.id);
  }

  sleepBody(handle: PhysicsBodyHandle): void {
    const body = this.#requireBody(handle);
    body.sleeping = true;
    this.#record("sleepBody", body.id);
  }

  isBodySleeping(handle: PhysicsBodyHandle): boolean {
    const body = this.#requireBody(handle);
    this.#record("isBodySleeping", body.id);
    return body.sleeping;
  }

  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode {
    return this.#requireBody(handle).ccdMode;
  }

  getBodyCenterOfMass(handle: PhysicsBodyHandle, out: Vector3): void {
    const body = this.#requireBody(handle);
    this.#record("getBodyCenterOfMass", body.id);
    // This double's simplification: uniform bodies whose centre of mass sits
    // at the transform origin. Off-centre mass is a solver derivation (Rapier
    // reads it from collider layout); what the engine contract needs proven
    // here is the out-parameter write and the handle discipline.
    out.copy(body.position);
  }

  getBodyMass(handle: PhysicsBodyHandle): number {
    const body = this.#requireBody(handle);
    this.#record("getBodyMass", body.id);
    // The **live** type, not the descriptor's: since WP-7.2 a body can be
    // re-typed in place, and the descriptor stops describing it the moment it
    // is. Reporting 0 for anything but a dynamic body is this double's own
    // simplification (Rapier reports the collider-derived mass whatever the
    // type) and is what `PhysicsWorld`'s mass refresh is written against.
    return body.type === "dynamic" ? body.mass : 0;
  }

  getBodyId(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).id;
  }

  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void {
    for (const body of this.bodies.values()) {
      visit(body.handle, body.id);
    }
  }

  getColliderBody(handle: PhysicsColliderHandle): PhysicsBodyHandle {
    return this.#requireCollider(handle).body.handle;
  }

  getColliderId(handle: PhysicsColliderHandle): number {
    return this.#requireCollider(handle).id;
  }

  forEachCollider(
    visit: (handle: PhysicsColliderHandle, id: number) => void,
  ): void {
    for (const collider of this.colliders.values()) {
      visit(collider.handle, collider.id);
    }
  }

  // --- internals ------------------------------------------------------------

  #integratePosition(body: FakeBody, delta: number): void {
    body.position.set(
      body.position.x + body.linearVelocity.x * delta,
      body.position.y + body.linearVelocity.y * delta,
      body.position.z + body.linearVelocity.z * delta,
    );
  }

  #record(method: string, id?: number, ...args: unknown[]): void {
    const call: FakeCall =
      id === undefined ? { method, args } : { method, id, args };
    this.calls.push(call);
  }

  #requireBody(handle: PhysicsBodyHandle): FakeBody {
    const id = (handle as unknown as { id: number }).id;
    const body = this.bodies.get(id);
    if (body === undefined || !body.alive) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `fake adapter: body handle ${String(id)} is foreign or destroyed (§37).`,
      );
    }
    return body;
  }

  #requireCollider(handle: PhysicsColliderHandle): FakeCollider {
    const id = (handle as unknown as { id: number }).id;
    const collider = this.colliders.get(id);
    if (collider === undefined || !collider.alive) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `fake adapter: collider handle ${String(id)} is foreign or destroyed (§37).`,
      );
    }
    return collider;
  }
}

/** The live state of one fake joint — scriptable from a test (WP-6.1). */
export interface FakeJoint {
  readonly id: number;
  readonly handle: PhysicsJointHandle;
  readonly descriptor: JointDescriptor;
  /**
   * Reaction impulse in newton-seconds the next `getJointReaction` reports.
   * Scripted by a test; the fake solves nothing, so nothing else writes it.
   */
  readonly reactionLinear: Vector3;
  /** Reaction angular impulse in newton-metre-seconds. See `reactionLinear`. */
  readonly reactionAngular: Vector3;
  /** The last limits `setJointLimits` received, or `null`. */
  limits: { min: number; max: number } | null;
  /** The last motor `setJointMotor` received, or `null`. */
  motor: SolverJointMotor | null;
  alive: boolean;
}

/**
 * `FakeSolverAdapter` plus the WP-6.1 joint seam — a structural
 * `PhysicsSolverAdapter & SolverBodyAccess & SolverJointAccess`.
 *
 * Kept as a **subclass** rather than folded into `FakeSolverAdapter` for one
 * reason: `PhysicsWorld` detects the joint seam *structurally*, so a double
 * that lacks it is exactly what proves the detection works. `FakeSolverAdapter`
 * stays the jointless Phase 5 adapter (its `createJoint` throws
 * `NOT_IMPLEMENTED`, as both Rapier adapters still do) and this one is the
 * Phase 6 adapter.
 *
 * Everything the world observes about a joint is real here: monotonic ids in
 * creation order, `forEachJoint` in that order, destroyed handles rejected, and
 * limits/motors recorded as the world pushes them. The one thing the fake
 * cannot derive — the constraint reaction — is **scripted** through
 * {@link FakeJointSolverAdapter.scriptJointReaction}, which is what lets a test
 * drive the break monitor to an exact threshold.
 */
export class FakeJointSolverAdapter
  extends FakeSolverAdapter
  implements SolverJointAccess
{
  /** Whether reactions are reported at all (plan P6-2). Settable by a test. */
  reportsJointReactions = true;

  /** Live joints keyed by monotonic id; `Map` iteration is creation order. */
  readonly joints = new Map<number, FakeJoint>();

  #nextJointId = 1;

  // --- test surface ---------------------------------------------------------

  /** The live state of the joint with monotonic id `id`. */
  joint(id: number): FakeJoint {
    const joint = this.joints.get(id);
    if (joint === undefined) {
      throw new Error(`fake adapter has no joint ${String(id)}`);
    }
    return joint;
  }

  /**
   * Scripts what the joint with id `id` will report as its reaction impulses
   * until it is scripted again — newton-seconds and newton-metre-seconds, the
   * units `SolverJointAccess.getJointReaction` is defined in.
   */
  scriptJointReaction(
    id: number,
    linear: Vector3Input,
    angular: Vector3Input,
  ): void {
    const joint = this.joint(id);
    widenToVector3(linear, joint.reactionLinear);
    widenToVector3(angular, joint.reactionAngular);
  }

  // --- PhysicsSolverAdapter (§37) -------------------------------------------

  override createJoint(desc: JointDescriptor): PhysicsJointHandle {
    this.#requireBodyAlive(desc.bodyA);
    this.#requireBodyAlive(desc.bodyB);
    const id = this.#nextJointId;
    this.#nextJointId += 1;
    const handle = { id } as unknown as PhysicsJointHandle;
    this.joints.set(id, {
      id,
      handle,
      descriptor: desc,
      reactionLinear: new Vector3(),
      reactionAngular: new Vector3(),
      limits: null,
      motor: null,
      alive: true,
    });
    this.#recordJoint("createJoint", id, desc.type);
    return handle;
  }

  override destroyJoint(handle: PhysicsJointHandle): void {
    const joint = this.#requireJoint(handle);
    joint.alive = false;
    this.joints.delete(joint.id);
    this.#recordJoint("destroyJoint", joint.id);
  }

  // --- SolverJointAccess (WP-6.1) -------------------------------------------

  getJointReaction(
    handle: PhysicsJointHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const joint = this.#requireJoint(handle);
    this.#recordJoint("getJointReaction", joint.id);
    outLinear.copy(joint.reactionLinear);
    outAngular.copy(joint.reactionAngular);
  }

  setJointLimits(handle: PhysicsJointHandle, min: number, max: number): void {
    const joint = this.#requireJoint(handle);
    joint.limits = { min, max };
    this.#recordJoint("setJointLimits", joint.id, min, max);
  }

  setJointMotor(handle: PhysicsJointHandle, motor: SolverJointMotor): void {
    const joint = this.#requireJoint(handle);
    joint.motor = { ...motor };
    this.#recordJoint("setJointMotor", joint.id, { ...motor });
  }

  getJointId(handle: PhysicsJointHandle): number {
    return this.#requireJoint(handle).id;
  }

  forEachJoint(visit: (handle: PhysicsJointHandle, id: number) => void): void {
    for (const joint of this.joints.values()) {
      visit(joint.handle, joint.id);
    }
  }

  override dispose(): void {
    this.joints.clear();
    super.dispose();
  }

  // --- internals ------------------------------------------------------------

  #recordJoint(method: string, id: number, ...args: unknown[]): void {
    this.calls.push({ method, id, args });
  }

  #requireJoint(handle: PhysicsJointHandle): FakeJoint {
    const id = (handle as unknown as { id: number }).id;
    const joint = this.joints.get(id);
    if (joint === undefined || !joint.alive) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `fake adapter: joint handle ${String(id)} is foreign or destroyed (§37).`,
      );
    }
    return joint;
  }

  #requireBodyAlive(handle: PhysicsBodyHandle): void {
    const id = (handle as unknown as { id: number }).id;
    const body = this.bodies.get(id);
    if (body === undefined || !body.alive) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `fake adapter: joint body handle ${String(id)} is foreign or destroyed (§37).`,
      );
    }
  }
}

/**
 * What a {@link FakeTuningSolverAdapter} last received for one body — the §23
 * mass triple, §23's damping and gravity scale, and §31's mode.
 */
export interface FakeBodyTuning {
  mass: number;
  centerOfMass: Vector3 | undefined;
  inertiaTensor: Matrix3 | undefined;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  ccdMode: CCDMode;
  ccdPredictionDistance: number | undefined;
}

/** What a {@link FakeTuningSolverAdapter} last received for one collider. */
export interface FakeColliderTuning {
  friction: number;
  restitution: number;
  density: number | undefined;
  sensor: boolean;
  collisionGroups: number;
  collisionMask: number;
}

/**
 * `FakeSolverAdapter` **plus** `SolverBodyTuningAccess` — the double that
 * proves §37's post-registration property changes reach a solver (PH-1
 * stage 2, 2026-08-07).
 *
 * A subclass for exactly the reason {@link FakeJointSolverAdapter} is one:
 * `PhysicsWorld` detects this seam *structurally*, so the plain
 * `FakeSolverAdapter` — which implements none of it — is what proves the
 * detection works and keeps the warn-once path under test. Every write is
 * recorded in {@link FakeSolverAdapter.calls} (so a test can assert the drain's
 * **order**) and applied to a per-id record a test can read back.
 */
export class FakeTuningSolverAdapter
  extends FakeSolverAdapter
  implements SolverBodyTuningAccess
{
  /** The last tuning each body received, keyed by monotonic body id. */
  readonly bodyTuning = new Map<number, FakeBodyTuning>();

  /** The last tuning each collider received, keyed by monotonic collider id. */
  readonly colliderTuning = new Map<number, FakeColliderTuning>();

  /** The tuning body `id` last received, or `undefined` if it received none. */
  tuningOf(id: number): FakeBodyTuning | undefined {
    return this.bodyTuning.get(id);
  }

  setBodyMassProperties(
    handle: PhysicsBodyHandle,
    mass: number,
    centerOfMass: Vector3 | undefined,
    inertiaTensor: Matrix3 | undefined,
    wake = true,
  ): void {
    const body = this.#body(handle);
    body.mass = mass;
    const tuning = this.#tuning(body.id);
    tuning.mass = mass;
    tuning.centerOfMass = centerOfMass?.clone();
    tuning.inertiaTensor = inertiaTensor?.clone();
    this.calls.push({
      method: "setBodyMassProperties",
      id: body.id,
      args: [mass, centerOfMass?.clone(), inertiaTensor?.clone(), wake],
    });
  }

  setBodyDamping(
    handle: PhysicsBodyHandle,
    linear: number,
    angular: number,
  ): void {
    const body = this.#body(handle);
    const tuning = this.#tuning(body.id);
    tuning.linearDamping = linear;
    tuning.angularDamping = angular;
    this.calls.push({
      method: "setBodyDamping",
      id: body.id,
      args: [linear, angular],
    });
  }

  setBodyGravityScale(
    handle: PhysicsBodyHandle,
    scale: number,
    wake = true,
  ): void {
    const body = this.#body(handle);
    this.#tuning(body.id).gravityScale = scale;
    this.calls.push({
      method: "setBodyGravityScale",
      id: body.id,
      args: [scale, wake],
    });
  }

  setBodyCcdMode(
    handle: PhysicsBodyHandle,
    mode: CCDMode,
    predictionDistance?: number,
  ): void {
    const body = this.#body(handle);
    body.ccdMode = mode;
    const tuning = this.#tuning(body.id);
    tuning.ccdMode = mode;
    tuning.ccdPredictionDistance = predictionDistance;
    this.calls.push({
      method: "setBodyCcdMode",
      id: body.id,
      args: [mode, predictionDistance],
    });
  }

  setColliderMaterial(
    handle: PhysicsColliderHandle,
    friction: number,
    restitution: number,
    density: number | undefined,
  ): void {
    const collider = this.#collider(handle);
    const tuning = this.#colliderTuningOf(collider.id);
    tuning.friction = friction;
    tuning.restitution = restitution;
    tuning.density = density;
    this.calls.push({
      method: "setColliderMaterial",
      id: collider.id,
      args: [friction, restitution, density],
    });
  }

  setColliderFilter(
    handle: PhysicsColliderHandle,
    sensor: boolean,
    collisionGroups: number,
    collisionMask: number,
  ): void {
    const collider = this.#collider(handle);
    const tuning = this.#colliderTuningOf(collider.id);
    tuning.sensor = sensor;
    tuning.collisionGroups = collisionGroups;
    tuning.collisionMask = collisionMask;
    this.calls.push({
      method: "setColliderFilter",
      id: collider.id,
      args: [sensor, collisionGroups, collisionMask],
    });
  }

  // --- internals ------------------------------------------------------------

  #tuning(id: number): FakeBodyTuning {
    let tuning = this.bodyTuning.get(id);
    if (tuning === undefined) {
      tuning = {
        mass: 0,
        centerOfMass: undefined,
        inertiaTensor: undefined,
        linearDamping: 0,
        angularDamping: 0,
        gravityScale: 1,
        ccdMode: "disabled",
        ccdPredictionDistance: undefined,
      };
      this.bodyTuning.set(id, tuning);
    }
    return tuning;
  }

  #colliderTuningOf(id: number): FakeColliderTuning {
    let tuning = this.colliderTuning.get(id);
    if (tuning === undefined) {
      tuning = {
        friction: 0,
        restitution: 0,
        density: undefined,
        sensor: false,
        collisionGroups: 0,
        collisionMask: 0,
      };
      this.colliderTuning.set(id, tuning);
    }
    return tuning;
  }

  #body(handle: PhysicsBodyHandle): FakeBody {
    const id = (handle as unknown as { id: number }).id;
    const body = this.bodies.get(id);
    if (body === undefined || !body.alive) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `fake adapter: body handle ${String(id)} is foreign or destroyed (§37).`,
      );
    }
    return body;
  }

  #collider(handle: PhysicsColliderHandle): FakeCollider {
    const id = (handle as unknown as { id: number }).id;
    const collider = this.colliders.get(id);
    if (collider === undefined || !collider.alive) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `fake adapter: collider handle ${String(id)} is foreign or destroyed (§37).`,
      );
    }
    return collider;
  }
}
