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
import type {
  AngularVelocityInput,
  CCDMode,
  ColliderDescriptor,
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
  RaycastHit,
  RaycastQuery,
  RigidBodyDescriptor,
  RotationInput,
  ShapeCastHit,
  ShapeCastQuery,
  SolverBodyAccess,
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
    this.#record("destroyCollider", collider.id);
  }

  createJoint(desc: JointDescriptor): PhysicsJointHandle {
    throw new FourError(
      "NOT_IMPLEMENTED",
      `Joints are staged to Phase 6 (plan P5-4); the fake adapter cannot create a ${desc.type} joint.`,
    );
  }

  destroyJoint(): void {
    throw new FourError(
      "NOT_IMPLEMENTED",
      "Joints are staged to Phase 6 (plan P5-4).",
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
      const type = body.descriptor.type;
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

  getBodyMass(handle: PhysicsBodyHandle): number {
    const body = this.#requireBody(handle);
    this.#record("getBodyMass", body.id);
    return body.descriptor.type === "dynamic" ? body.mass : 0;
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
