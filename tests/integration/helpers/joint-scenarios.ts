/**
 * Shared builders for the §28 joints integration suite (WP-6.4): mechanisms
 * assembled from the **public** joint API — `four/application` + `@four/physics`
 * + `@four/physics-rapier` — plus the measurement helpers the analytic
 * assertions in `../physics-joints.test.ts` are written against.
 *
 * This file is the joint half of what `physics-scenarios.ts` (WP-5.6) is for
 * bodies, and it builds on that file rather than restating it: the
 * {@link DimensionKit} pair, {@link createRig}, {@link createWorld}, and
 * {@link DT} all come from there, so a joint scenario differs from a Phase 5
 * scenario only in what it constrains.
 *
 * ## Why the rigs here look the way they do
 *
 * - **Anchors carry no collider.** A joint's fixed side is a `"static"`
 *   `RigidBody` with no `Collider` component (§23 permits it, §24 does not
 *   require one), so nothing in these worlds can *contact* anything: every
 *   number the suite measures is the constraint's, not a contact's.
 * - **Sleeping is off** in every world {@link createJointWorld} builds (§32).
 *   Rapier puts a slow pendulum to sleep inside a second and it then never moves
 *   again, which would make a period unmeasurable — the same measurement the two
 *   adapter packets (WP-6.2/6.3) had to make.
 * - **Mechanisms are spread along X** in {@link buildMechanism}, far enough
 *   apart that their bodies never meet, because §109's stability question is
 *   about constraints and a stray contact would answer a different one.
 * - **Nothing reads a clock or `Math.random`** (§33): every run is
 *   `Application.step(DT)` with a constant injected delta.
 *
 * ## The scripted solver at the bottom of this file
 *
 * {@link ScriptedJointAdapter} is a `PhysicsSolverAdapter & SolverBodyAccess &
 * SolverJointAccess` with no solver behind it, and it exists for exactly one
 * case: **breakage**. Both Rapier adapters report
 * `reportsJointReactions: false` (Rapier 0.19.3 exposes no joint reaction at
 * all — verified three ways by WP-6.2/6.3), so a breakable joint on Rapier is
 * *refused*, and §28's break path can never run on the solver this repository
 * ships. `@four/physics` has its own `FakeJointSolverAdapter`, but it is
 * test-internal to that package and unreachable from here.
 *
 * So this double is the local, minimal equivalent: monotonic ids in creation
 * order, real destruction, recorded limit/motor commands, and **scripted
 * reaction impulses** — the one thing no fake can derive. What that buys the
 * suite is the half `packages/physics/tests/world-joints.test.ts` cannot reach:
 * a break driven end to end through `Application.step` → `PhysicsSystem` →
 * `PhysicsWorld.step` → `dispatchEvents` (§39 steps 6 and 9), rather than
 * through direct `world.step()` calls.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import {
  Collider,
  HingeJoint,
  PhysicsWorld,
  RigidBody,
  RopeJoint,
  SliderJoint,
  SpringJoint,
  resolveAngularVelocity,
  resolveRotation,
  widenToVector3,
  type AngularVelocityInput,
  type CCDMode,
  type ColliderDescriptor,
  type JointDescriptor,
  type OverlapHit,
  type OverlapQuery,
  type PhysicsBodyHandle,
  type PhysicsCapabilities,
  type PhysicsColliderHandle,
  type PhysicsEvent,
  type PhysicsJointHandle,
  type PhysicsSolverAdapter,
  type PhysicsWorldOptions,
  type PointHit,
  type PointQuery,
  type RaycastHit,
  type RaycastQuery,
  type RigidBodyDescriptor,
  type RotationInput,
  type ShapeCastHit,
  type ShapeCastQuery,
  type SolverBodyAccess,
  type SolverJointAccess,
  type SolverJointMotor,
  type Vector3Input,
} from "@four/physics";
import { Group, type Node } from "@four/scene";
import type { Application } from "four/application";

import {
  DT,
  GRAVITY_Y,
  addSlab,
  createWorld,
  type BodyOptions,
  type BodyParts,
  type DimensionKit,
  type PhysicsRig,
  type WorldOptions,
} from "./physics-scenarios.js";

/** Gravity's magnitude in m/s², the value every closed form below assumes. */
export const G = -GRAVITY_Y;

/** A world with §32 sleeping **off**, which every oscillation here needs. */
export async function createJointWorld(
  rig: PhysicsRig,
  kit: DimensionKit,
  options: WorldOptions = {},
): Promise<PhysicsWorld> {
  return createWorld(rig, kit, { sleeping: { enabled: false }, ...options });
}

/**
 * A world on a fresh {@link ScriptedJointAdapter}, tracked on the rig's system
 * and registered for teardown exactly as {@link createJointWorld}'s worlds are.
 *
 * The dimension is `"2d"` because nothing the scripted solver does depends on
 * one: it constrains nothing, and the only thing under test through it is §28's
 * break path (see the module header).
 */
export async function createScriptedWorld(
  rig: PhysicsRig,
  adapter: ScriptedJointAdapter,
): Promise<PhysicsWorld> {
  const world = new PhysicsWorld({
    dimension: "2d",
    adapter,
    poses: rig.app.poses,
  });
  await world.initialize();
  rig.worlds.push(world);
  rig.system.track(world);
  return world;
}

/**
 * The fixed side of a joint: a `"static"` body with **no collider**, so it has
 * no contact geometry to disturb the measurement (see the module header).
 */
export function addAnchor(
  world: PhysicsWorld,
  position: Vector3,
  name = "anchor",
): { node: Node; body: RigidBody } {
  const node = new Group();
  node.name = name;
  node.transform.position.copy(position);
  const body = new RigidBody({ type: "static" });
  node.addComponent(body);
  world.addBody(node);
  return { node, body };
}

/** A dynamic ball — §24's circle in 2D, sphere in 3D. */
export function addBob(
  world: PhysicsWorld,
  kit: DimensionKit,
  position: Vector3,
  radius: number,
  options: BodyOptions = {},
): BodyParts {
  const node = new Group();
  node.name = options.name ?? "bob";
  node.transform.position.copy(position);
  node.transformAuthority = "physics";
  node.addComponent(
    new RigidBody({
      type: "dynamic",
      ...(options.mass === undefined ? {} : { mass: options.mass }),
    }),
  );
  node.addComponent(new Collider({ shape: kit.ball(radius) }));
  const body = world.addBody(node);
  const collider = node.getComponent(Collider);
  if (collider === undefined) {
    throw new Error("bob lost its collider");
  }
  return { node, body, collider };
}

/** A dynamic bar — §24's rectangle in 2D, box in 3D. */
export function addBar(
  world: PhysicsWorld,
  kit: DimensionKit,
  position: Vector3,
  halfExtents: Vector3,
  options: BodyOptions = {},
): BodyParts {
  return addSlab(world, kit, "dynamic", halfExtents, {
    name: "bar",
    position,
    ...options,
  });
}

/** A hinge pendulum: a bob on a rigid pivot, released from `amplitude`. */
export interface PendulumRig {
  /** The static pivot the hinge is anchored to. */
  readonly pivot: Vector3;
  /** The swinging bob. */
  readonly bob: BodyParts;
  /** The §28 hinge itself. */
  readonly joint: HingeJoint;
  /** Suspension length in metres. */
  readonly length: number;
}

/**
 * Builds a pendulum of `length` metres released at `amplitude` radians from the
 * downward vertical, hinged about +Z at `pivot` (§21's only 2D axis, and the
 * axis chosen in 3D so both dimensions swing in the same plane).
 */
export function buildPendulum(
  world: PhysicsWorld,
  kit: DimensionKit,
  options: {
    pivot?: Vector3;
    length?: number;
    amplitude?: number;
    radius?: number;
  } = {},
): PendulumRig {
  const pivot = options.pivot ?? new Vector3(0, 0, 0);
  const length = options.length ?? 1;
  const amplitude = options.amplitude ?? 0.2;
  const radius = options.radius ?? 0.02;
  const anchor = addAnchor(world, pivot, "pendulum-pivot");
  const bob = addBob(
    world,
    kit,
    new Vector3(
      pivot.x + length * Math.sin(amplitude),
      pivot.y - length * Math.cos(amplitude),
      pivot.z,
    ),
    radius,
    { name: "pendulum-bob" },
  );
  const joint = new HingeJoint({
    bodyA: anchor.body,
    bodyB: bob.body,
    anchor: pivot,
    axis: new Vector3(0, 0, 1),
  });
  world.addJoint(joint);
  return { pivot, bob, joint, length };
}

/** A motor-driven shaft, hinged about +Z at its own centre. */
export interface ShaftRig {
  /** The driven bar. */
  readonly shaft: BodyParts;
  /** The §28 hinge carrying the motor. */
  readonly joint: HingeJoint;
}

/** Builds a shaft driven at `targetVelocity` rad/s about +Z (§28's motor). */
export function buildMotorShaft(
  world: PhysicsWorld,
  kit: DimensionKit,
  options: {
    center?: Vector3;
    targetVelocity?: number;
    maxTorque?: number;
    enabled?: boolean;
  } = {},
): ShaftRig {
  const center = options.center ?? new Vector3(0, 0, 0);
  const anchor = addAnchor(world, center, "shaft-anchor");
  const shaft = addBar(world, kit, center, new Vector3(0.4, 0.05, 0.05), {
    name: "shaft",
  });
  const joint = new HingeJoint({
    bodyA: anchor.body,
    bodyB: shaft.body,
    anchor: center,
    axis: new Vector3(0, 0, 1),
    motor: {
      enabled: options.enabled ?? true,
      targetVelocity: options.targetVelocity ?? 3,
      maxTorque: options.maxTorque ?? 50,
    },
  });
  world.addJoint(joint);
  return { shaft, joint };
}

/** A slider carriage on a limited, motor-driven X axis. */
export interface SliderRig {
  /** The carriage that travels along the axis. */
  readonly carriage: BodyParts;
  /** The §28 slider. */
  readonly joint: SliderJoint;
  /** The axis origin, which is also the carriage's start. */
  readonly origin: Vector3;
}

/** Builds a slider along +X with limits and a linear motor (§28). */
export function buildSlider(
  world: PhysicsWorld,
  kit: DimensionKit,
  options: {
    origin?: Vector3;
    limits?: { min: number; max: number };
    targetVelocity?: number;
    maxForce?: number;
  } = {},
): SliderRig {
  const origin = options.origin ?? new Vector3(0, 0, 0);
  const limits = options.limits ?? { min: -0.5, max: 0.5 };
  const anchor = addAnchor(world, origin, "slider-anchor");
  const carriage = addBar(world, kit, origin, new Vector3(0.1, 0.1, 0.1), {
    name: "carriage",
  });
  const joint = new SliderJoint({
    bodyA: anchor.body,
    bodyB: carriage.body,
    anchor: origin,
    axis: new Vector3(1, 0, 0),
    limits,
    motor: {
      enabled: true,
      targetVelocity: options.targetVelocity ?? 1,
      maxForce: options.maxForce ?? 500,
    },
  });
  world.addJoint(joint);
  return { carriage, joint, origin };
}

/** A mass hanging on a spring-damper below its anchor. */
export interface SpringRig {
  /** The oscillating mass. */
  readonly bob: BodyParts;
  /** The §28 spring. */
  readonly joint: SpringJoint;
  /** Where the spring is anchored. */
  readonly origin: Vector3;
  /** The mass the solver ended up with, in kilograms (§23). */
  readonly mass: number;
}

/**
 * Builds a `mass` kilogram bob on a spring of `stiffness` N/m, started
 * `stretch` metres below its rest length so it oscillates from release.
 */
export function buildSpring(
  world: PhysicsWorld,
  kit: DimensionKit,
  options: {
    origin?: Vector3;
    restLength?: number;
    stiffness?: number;
    damping?: number;
    mass?: number;
    stretch?: number;
  } = {},
): SpringRig {
  const origin = options.origin ?? new Vector3(0, 0, 0);
  const restLength = options.restLength ?? 1;
  const stretch = options.stretch ?? 0.5;
  const mass = options.mass ?? 1;
  const anchor = addAnchor(world, origin, "spring-anchor");
  const bob = addBob(
    world,
    kit,
    new Vector3(origin.x, origin.y - restLength - stretch, origin.z),
    0.1,
    { name: "spring-bob", mass },
  );
  const joint = new SpringJoint({
    bodyA: anchor.body,
    bodyB: bob.body,
    anchor: origin,
    anchorB: new Vector3(origin.x, origin.y - restLength - stretch, origin.z),
    restLength,
    stiffness: options.stiffness ?? 100,
    damping: options.damping ?? 0,
  });
  world.addJoint(joint);
  return { bob, joint, origin, mass: bob.body.mass ?? mass };
}

/** A load on a rope, started slack so both halves of §28's rule are exercised. */
export interface RopeRig {
  /** The hanging load. */
  readonly load: BodyParts;
  /** The §28 rope. */
  readonly joint: RopeJoint;
  /** Where the rope is anchored. */
  readonly origin: Vector3;
  /** The rope's `maxLength`, in metres. */
  readonly maxLength: number;
}

/** Builds a rope of `maxLength` metres with its load starting slack. */
export function buildRope(
  world: PhysicsWorld,
  kit: DimensionKit,
  options: {
    origin?: Vector3;
    maxLength?: number;
    slack?: number;
  } = {},
): RopeRig {
  const origin = options.origin ?? new Vector3(0, 0, 0);
  const maxLength = options.maxLength ?? 1.5;
  const slack = options.slack ?? 0.2;
  const anchor = addAnchor(world, origin, "rope-anchor");
  const start = new Vector3(origin.x, origin.y - slack, origin.z);
  const load = addBob(world, kit, start, 0.05, { name: "rope-load" });
  const joint = new RopeJoint({
    bodyA: anchor.body,
    bodyB: load.body,
    anchor: origin,
    anchorB: start,
    maxLength,
  });
  world.addJoint(joint);
  return { load, joint, origin, maxLength };
}

/**
 * The §109 mechanism skeleton: a motor shaft, a hinged arm, a limited slider, a
 * spring, and a rope in **one** world, spread along X so no two of them can
 * touch (see the module header).
 */
export interface MechanismRig {
  /** The driven shaft at x = 0. */
  readonly shaft: ShaftRig;
  /** A free pendulum arm at x = 3. */
  readonly arm: PendulumRig;
  /** A motor-driven slider at x = 6. */
  readonly slider: SliderRig;
  /** A spring-damper at x = 9. */
  readonly spring: SpringRig;
  /** A rope at x = 12. */
  readonly rope: RopeRig;
  /** Every dynamic node in the mechanism, in construction order. */
  readonly nodes: readonly Node[];
}

/** Builds the {@link MechanismRig} described above. */
export function buildMechanism(
  world: PhysicsWorld,
  kit: DimensionKit,
): MechanismRig {
  const shaft = buildMotorShaft(world, kit, {
    center: new Vector3(0, 0, 0),
    targetVelocity: 2,
  });
  const arm = buildPendulum(world, kit, {
    pivot: new Vector3(3, 0, 0),
    length: 1,
    amplitude: 0.4,
  });
  const slider = buildSlider(world, kit, {
    origin: new Vector3(6, 0, 0),
    limits: { min: -0.5, max: 0.5 },
    targetVelocity: 1,
  });
  const spring = buildSpring(world, kit, {
    origin: new Vector3(9, 0, 0),
    damping: 0.5,
  });
  const rope = buildRope(world, kit, { origin: new Vector3(12, 0, 0) });
  return {
    shaft,
    arm,
    slider,
    spring,
    rope,
    nodes: [
      shaft.shaft.node,
      arm.bob.node,
      slider.carriage.node,
      spring.bob.node,
      rope.load.node,
    ],
  };
}

// --- measurement ------------------------------------------------------------

/**
 * Runs `steps` fixed steps, sampling `probe` after each, and returns the
 * interpolated times in **seconds** at which the sampled value crossed `level`.
 *
 * Linear interpolation inside the crossing step, which is what makes a period
 * measured over tens of oscillations accurate to far better than one step.
 */
export function crossingTimes(
  app: Application,
  steps: number,
  probe: () => number,
  level = 0,
  direction: "falling" | "rising" | "either" = "falling",
): number[] {
  const times: number[] = [];
  let previous = probe() - level;
  for (let step = 1; step <= steps; step += 1) {
    app.step(DT);
    const value = probe() - level;
    const falls = previous > 0 && value <= 0;
    const rises = previous < 0 && value >= 0;
    if (
      (direction === "falling" && falls) ||
      (direction === "rising" && rises) ||
      (direction === "either" && (falls || rises))
    ) {
      times.push((step - 1 + previous / (previous - value)) * DT);
    }
    previous = value;
  }
  return times;
}

/** The mean interval between successive {@link crossingTimes}, in seconds. */
export function meanInterval(times: readonly number[]): number {
  if (times.length < 2) {
    throw new Error(
      `a period needs at least two crossings; got ${String(times.length)}`,
    );
  }
  return (times[times.length - 1] - times[0]) / (times.length - 1);
}

/**
 * The elevation of `node` above `pivot`, in radians: `0` when the two are level
 * on +X, which is the zero a hinge's authored limits are measured from when the
 * arm was built horizontal.
 */
export function elevationAngle(node: Node, pivot: Vector3): number {
  const at = node.transform.position;
  return Math.atan2(at.y - pivot.y, at.x - pivot.x);
}

/** The distance from `node` to `point`, in metres. */
export function distanceTo(node: Node, point: Vector3): number {
  const at = node.transform.position;
  return Math.hypot(at.x - point.x, at.y - point.y, at.z - point.z);
}

/** Angular velocity about +Z in rad/s — §21's only rotational freedom in 2D. */
export function spinZ(body: RigidBody): number {
  return body.angularVelocity.z;
}

/** The local maxima of `samples`, in order — the apexes a decay test reads. */
export function apexes(samples: readonly number[]): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < samples.length - 1; i += 1) {
    if (samples[i] > samples[i - 1] && samples[i] >= samples[i + 1]) {
      peaks.push(samples[i]);
    }
  }
  return peaks;
}

/** Whether every entry of `values` is finite — §109's "no NaN" in one call. */
export function allFinite(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

// --- the scripted solver (breakage only) ------------------------------------

/** One body inside a {@link ScriptedJointAdapter}. */
interface ScriptedBody {
  readonly id: number;
  readonly handle: PhysicsBodyHandle;
  /** Mutable since WP-7.2: `setBodyType` re-types a body in place (§22). */
  type: RigidBodyDescriptor["type"];
  readonly position: Vector3;
  readonly rotation: Quaternion;
  readonly linear: Vector3;
  readonly angular: Vector3;
  mass: number;
  alive: boolean;
}

/** One joint inside a {@link ScriptedJointAdapter}. */
interface ScriptedJoint {
  readonly id: number;
  readonly handle: PhysicsJointHandle;
  readonly type: JointDescriptor["type"];
  /** Reaction impulse in N·s the next `getJointReaction` reports (scripted). */
  readonly reactionLinear: Vector3;
  /** Reaction angular impulse in N·m·s. See `reactionLinear`. */
  readonly reactionAngular: Vector3;
  /** The last limits the world pushed, or `null`. */
  limits: { min: number; max: number } | null;
  /** The last motor the world pushed, or `null`. */
  motor: SolverJointMotor | null;
  /** Whether the joined bodies still collide (§28); PH-22f. */
  collisionEnabled: boolean;
  alive: boolean;
}

/** Capabilities of the scripted double: everything except queries and snapshots. */
function scriptedCapabilities(): PhysicsCapabilities {
  return {
    dimensions: ["2d", "3d"],
    jointTypes: ["fixed", "revolute", "prismatic", "rope", "spring"],
    ccdModes: ["disabled"],
    determinism: "same-runtime",
    snapshots: false,
    queries: { raycast: false, shapeCast: false, overlap: false, point: false },
  };
}

/** Refuses a handle this adapter did not mint, or has destroyed (§37). */
function refuseHandle(kind: string, id: number): never {
  throw new FourError(
    "INVALID_APPLICATION_STATE",
    `scripted adapter: ${kind} handle ${String(id)} is foreign or destroyed (§37).`,
  );
}

/**
 * A solver-shaped double with **scripted joint reactions** — the only way §28's
 * break path can be exercised in this repository (see the module header).
 *
 * The integrator is deliberately the simplest thing that moves: dynamic bodies
 * accelerate under gravity and translate by their velocity, which is enough for
 * a §33 checksum to change from step to step and for "the survivors keep
 * simulating" to be a claim about something. Joints constrain nothing here; the
 * reactions they report are whatever a test scripted.
 */
export class ScriptedJointAdapter
  implements PhysicsSolverAdapter, SolverBodyAccess, SolverJointAccess
{
  readonly name = "scripted-joints";

  readonly version = "1.0.0";

  readonly capabilities: PhysicsCapabilities = scriptedCapabilities();

  /** Whether reactions are reported at all (plan P6-2). Settable by a test. */
  reportsJointReactions = true;

  /** How many times `step` ran. */
  steps = 0;

  /** World gravity, from `initialize`. */
  readonly gravity = new Vector3(0, GRAVITY_Y, 0);

  readonly #bodies = new Map<number, ScriptedBody>();

  readonly #colliders = new Map<
    number,
    { id: number; handle: PhysicsColliderHandle; body: ScriptedBody }
  >();

  readonly #joints = new Map<number, ScriptedJoint>();

  #nextBodyId = 1;

  #nextColliderId = 1;

  #nextJointId = 1;

  // --- test surface ---------------------------------------------------------

  /**
   * Scripts the reaction impulses the joint with monotonic id `id` reports from
   * now on — newton-seconds and newton-metre-seconds, the units
   * `SolverJointAccess.getJointReaction` is defined in. `PhysicsWorld` divides
   * them by the fixed delta to reach §28's newtons and newton-metres.
   */
  scriptJointReaction(
    id: number,
    linear: Vector3Input,
    angular: Vector3Input,
  ): void {
    const joint = this.#joints.get(id);
    if (joint === undefined) {
      refuseHandle("joint", id);
    }
    widenToVector3(linear, joint.reactionLinear);
    widenToVector3(angular, joint.reactionAngular);
  }

  /** The limits the world last pushed into the joint with id `id`. */
  limitsOf(id: number): { min: number; max: number } | null {
    return this.#joints.get(id)?.limits ?? null;
  }

  /** The motor the world last pushed into the joint with id `id`. */
  motorOf(id: number): SolverJointMotor | null {
    return this.#joints.get(id)?.motor ?? null;
  }

  /** How many joints this adapter still holds. */
  get jointCount(): number {
    return this.#joints.size;
  }

  // --- PhysicsSolverAdapter (§37) -------------------------------------------

  initialize(options: PhysicsWorldOptions): void {
    if (options.gravity !== undefined) {
      widenToVector3(options.gravity, this.gravity);
    }
  }

  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle {
    const id = this.#nextBodyId;
    this.#nextBodyId += 1;
    const handle = { id } as unknown as PhysicsBodyHandle;
    this.#bodies.set(id, {
      id,
      handle,
      type: desc.type,
      position:
        desc.position === undefined
          ? new Vector3()
          : widenToVector3(desc.position),
      rotation:
        desc.rotation === undefined
          ? new Quaternion()
          : resolveRotation("3d", desc.rotation),
      linear:
        desc.linearVelocity === undefined
          ? new Vector3()
          : widenToVector3(desc.linearVelocity),
      angular:
        desc.angularVelocity === undefined
          ? new Vector3()
          : resolveAngularVelocity("3d", desc.angularVelocity),
      mass: desc.mass ?? 0,
      alive: true,
    });
    return handle;
  }

  destroyBody(handle: PhysicsBodyHandle): void {
    const body = this.#requireBody(handle);
    body.alive = false;
    this.#bodies.delete(body.id);
  }

  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle {
    const body = this.#requireBody(desc.body);
    const id = this.#nextColliderId;
    this.#nextColliderId += 1;
    const handle = { id } as unknown as PhysicsColliderHandle;
    this.#colliders.set(id, { id, handle, body });
    if (body.mass === 0) {
      // §23/§25: an unauthored mass is the solver's derivation. Unit volume.
      body.mass = desc.density ?? 1;
    }
    return handle;
  }

  destroyCollider(handle: PhysicsColliderHandle): void {
    const collider = this.#requireCollider(handle);
    this.#colliders.delete(collider.id);
  }

  createJoint(desc: JointDescriptor): PhysicsJointHandle {
    this.#requireBody(desc.bodyA);
    this.#requireBody(desc.bodyB);
    const id = this.#nextJointId;
    this.#nextJointId += 1;
    const handle = { id } as unknown as PhysicsJointHandle;
    this.#joints.set(id, {
      id,
      handle,
      type: desc.type,
      reactionLinear: new Vector3(),
      reactionAngular: new Vector3(),
      limits: null,
      motor: null,
      collisionEnabled: false,
      alive: true,
    });
    return handle;
  }

  destroyJoint(handle: PhysicsJointHandle): void {
    const joint = this.#requireJoint(handle);
    joint.alive = false;
    this.#joints.delete(joint.id);
  }

  step(delta: number): void {
    this.steps += 1;
    for (const body of this.#bodies.values()) {
      if (body.type !== "dynamic") {
        continue;
      }
      body.linear.set(
        body.linear.x + this.gravity.x * delta,
        body.linear.y + this.gravity.y * delta,
        body.linear.z + this.gravity.z * delta,
      );
      body.position.set(
        body.position.x + body.linear.x * delta,
        body.position.y + body.linear.y * delta,
        body.position.z + body.linear.z * delta,
      );
    }
  }

  drainEvents(): PhysicsEvent[] {
    return [];
  }

  syncSceneToSolver(): void {
    // Every write here is applied immediately, so there is nothing to flush.
  }

  syncSolverToScene(): void {
    // See `syncSceneToSolver`.
  }

  raycast(query: RaycastQuery): RaycastHit[] {
    void query;
    return [];
  }

  shapeCast(query: ShapeCastQuery): ShapeCastHit[] {
    void query;
    return [];
  }

  overlap(query: OverlapQuery): OverlapHit[] {
    void query;
    return [];
  }

  pointQuery(query: PointQuery): PointHit[] {
    void query;
    return [];
  }

  dispose(): void {
    this.#joints.clear();
    this.#colliders.clear();
    this.#bodies.clear();
  }

  // --- SolverBodyAccess -----------------------------------------------------

  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void {
    const body = this.#requireBody(handle);
    outPosition.copy(body.position);
    outRotation.copy(body.rotation);
  }

  setBodyTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation: RotationInput,
  ): void {
    const body = this.#requireBody(handle);
    widenToVector3(position, body.position);
    resolveRotation("3d", rotation, body.rotation);
  }

  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const body = this.#requireBody(handle);
    outLinear.copy(body.linear);
    outAngular.copy(body.angular);
  }

  setBodyVelocities(
    handle: PhysicsBodyHandle,
    linear: Vector3Input,
    angular: AngularVelocityInput,
  ): void {
    const body = this.#requireBody(handle);
    widenToVector3(linear, body.linear);
    resolveAngularVelocity("3d", angular, body.angular);
  }

  applyForce(handle: PhysicsBodyHandle, force: Vector3Input): void {
    void this.#requireBody(handle);
    void force;
  }

  applyForceAtPoint(
    handle: PhysicsBodyHandle,
    force: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    void this.#requireBody(handle);
    void force;
    void worldPoint;
  }

  applyTorque(handle: PhysicsBodyHandle, torque: AngularVelocityInput): void {
    void this.#requireBody(handle);
    void torque;
  }

  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3Input): void {
    const body = this.#requireBody(handle);
    const value = widenToVector3(impulse);
    const inverseMass = body.mass > 0 ? 1 / body.mass : 0;
    body.linear.set(
      body.linear.x + value.x * inverseMass,
      body.linear.y + value.y * inverseMass,
      body.linear.z + value.z * inverseMass,
    );
  }

  applyImpulseAtPoint(
    handle: PhysicsBodyHandle,
    impulse: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    void this.#requireBody(handle);
    void impulse;
    void worldPoint;
  }

  applyAngularImpulse(
    handle: PhysicsBodyHandle,
    angularImpulse: AngularVelocityInput,
  ): void {
    const body = this.#requireBody(handle);
    body.angular.add(resolveAngularVelocity("3d", angularImpulse));
  }

  resetForces(handle: PhysicsBodyHandle): void {
    void this.#requireBody(handle);
  }

  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation?: RotationInput,
  ): void {
    const body = this.#requireBody(handle);
    widenToVector3(position, body.position);
    if (rotation !== undefined) {
      resolveRotation("3d", rotation, body.rotation);
    }
  }

  setBodyType(
    handle: PhysicsBodyHandle,
    type: RigidBodyDescriptor["type"],
  ): void {
    this.#requireBody(handle).type = type;
  }

  wakeBody(handle: PhysicsBodyHandle): void {
    void this.#requireBody(handle);
  }

  sleepBody(handle: PhysicsBodyHandle): void {
    void this.#requireBody(handle);
  }

  isBodySleeping(handle: PhysicsBodyHandle): boolean {
    void this.#requireBody(handle);
    return false;
  }

  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode {
    void this.#requireBody(handle);
    return "disabled";
  }

  getBodyMass(handle: PhysicsBodyHandle): number {
    const body = this.#requireBody(handle);
    return body.type === "dynamic" ? body.mass : 0;
  }

  getBodyCenterOfMass(handle: PhysicsBodyHandle, out: Vector3): void {
    // Uniform-body simplification, as in FakeSolverAdapter: origin = COM.
    out.copy(this.#requireBody(handle).position);
  }

  getBodyId(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).id;
  }

  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void {
    for (const body of this.#bodies.values()) {
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
    for (const collider of this.#colliders.values()) {
      visit(collider.handle, collider.id);
    }
  }

  // --- SolverJointAccess ----------------------------------------------------

  getJointReaction(
    handle: PhysicsJointHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const joint = this.#requireJoint(handle);
    outLinear.copy(joint.reactionLinear);
    outAngular.copy(joint.reactionAngular);
  }

  setJointLimits(handle: PhysicsJointHandle, min: number, max: number): void {
    this.#requireJoint(handle).limits = { min, max };
  }

  setJointMotor(handle: PhysicsJointHandle, motor: SolverJointMotor): void {
    this.#requireJoint(handle).motor = { ...motor };
  }

  setJointCollisionEnabled(handle: PhysicsJointHandle, enabled: boolean): void {
    this.#requireJoint(handle).collisionEnabled = enabled;
  }

  getJointId(handle: PhysicsJointHandle): number {
    return this.#requireJoint(handle).id;
  }

  forEachJoint(visit: (handle: PhysicsJointHandle, id: number) => void): void {
    for (const joint of this.#joints.values()) {
      visit(joint.handle, joint.id);
    }
  }

  // --- internals ------------------------------------------------------------

  #requireBody(handle: PhysicsBodyHandle): ScriptedBody {
    const id = (handle as unknown as { id: number }).id;
    const body = this.#bodies.get(id);
    if (body === undefined || !body.alive) {
      refuseHandle("body", id);
    }
    return body;
  }

  #requireCollider(handle: PhysicsColliderHandle): {
    id: number;
    handle: PhysicsColliderHandle;
    body: ScriptedBody;
  } {
    const id = (handle as unknown as { id: number }).id;
    const collider = this.#colliders.get(id);
    if (collider === undefined) {
      refuseHandle("collider", id);
    }
    return collider;
  }

  #requireJoint(handle: PhysicsJointHandle): ScriptedJoint {
    const id = (handle as unknown as { id: number }).id;
    const joint = this.#joints.get(id);
    if (joint === undefined || !joint.alive) {
      refuseHandle("joint", id);
    }
    return joint;
  }
}
