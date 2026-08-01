/**
 * The `RigidBody` component (§6a, §23) and its §26 force/impulse command
 * buffers.
 *
 * §23 declares the body as a class with mass and state properties, `wake()` /
 * `sleep()`, and the six §26 force and impulse methods; §6a makes it a
 * *component* attached with `node.addComponent(new RigidBody(...))` rather than
 * a `Node` subclass. This module is that class. It holds **authored state
 * only** — no solver handle, no simulation, no per-frame callbacks (§6a: "per
 * frame work is driven by systems"). `PhysicsWorld` and `PhysicsSystem`
 * (WP-5.3) read this state, create the solver body from
 * {@link RigidBody.toDescriptor}, consume the command buffers once per fixed
 * step, and write the solved pose back under `"physics"` transform authority
 * (§42).
 *
 * ## Pose lives on the node, not here
 *
 * §23's property list has no position or rotation: a node's `Transform` (§7) is
 * its pose, and exactly one system owns it (§42). The component therefore keeps
 * only the *initial* pose a descriptor happened to carry
 * ({@link RigidBody.initialPosition}, {@link RigidBody.initialRotation}), so a
 * descriptor round-trips through the component unchanged.
 *
 * ## Authored state versus solved state
 *
 * {@link RigidBody.linearVelocity}, {@link RigidBody.angularVelocity},
 * {@link RigidBody.centerOfMass} and friends are what the engine pushes *into*
 * the solver at `syncSceneToSolver`. Once a body is simulating the solver owns
 * its velocities, and `syncSolverToScene` refreshes these fields from the
 * solver after every step (WP-5.3). Writing one between steps is therefore an
 * authoring action that takes effect at the next sync; reading one between
 * steps yields the last solved value.
 *
 * The §23 mass triple is the exception: a body that never named a mass, a
 * centre of mass, or an inertia tensor is asking the solver to derive all three
 * from collider density and geometry (§23, §25), so
 * {@link RigidBody.toDescriptor} omits what was never authored rather than
 * presenting a default as an instruction. See
 * {@link RigidBody.centerOfMassAuthored}.
 *
 * ## Commands, not mutations (§26, §32)
 *
 * A force applied by user code cannot reach the solver at the moment of the
 * call — the solver may be mid-step, and §6b forbids physics work during
 * dispatch. Every §26 method therefore **accumulates into a command buffer**
 * that the world drains at the next fixed step, and `wake()` / `sleep()` queue
 * a flag rather than editing {@link RigidBody.sleeping}. See
 * {@link RigidBodyCommands} for the exact clearing semantics.
 *
 * ## Events (§29, §32)
 *
 * `RigidBody` *is* an `EventEmitter` (§6b), so §29's `body.on("collisionstart",
 * …)` is literal. The emit side is **package-internal**: `PhysicsSystem`
 * normalizes the adapter's `drainEvents` output and emits after the fixed step
 * (§39 step 9). User code subscribes; nothing outside `@four/physics` should
 * call `emit` for these types.
 *
 * ## Dimension (§21, plan P5-3)
 *
 * A component does not know which world it will join, so construction-time
 * validation runs against `"3d"`, the permissive dimension: it adds no rules of
 * its own, so construction performs exactly the dimension-independent checks.
 * The `"2d"` plane constraints are checked by {@link RigidBody.validateFor}
 * when the body is registered with a world, which is the first moment the
 * dimension is known. `Vector2` arguments widen to `z = 0` everywhere (P5-3).
 */

import { EventEmitter, type Component, type ComponentHost } from "@four/core";
import { Matrix3, Quaternion, Vector3 } from "@four/math";

import type { Collider } from "./collider.js";
import type { RigidBodyDescriptor } from "./descriptors.js";
import {
  resolveAngularVelocity,
  resolveRotation,
  widenToVector3,
} from "./descriptors.js";
import type { CollisionEvent, SleepEvent } from "./events.js";
import type {
  BodyType,
  CCDMode,
  PhysicsDimension,
  Vector3Input,
} from "./types.js";
import { DEFAULT_CCD_MODE, DEFAULT_ENABLED_CCD_MODE } from "./types.js";
import { validateMass, validateRigidBodyDescriptor } from "./validation.js";

/**
 * The dimension a dimension-agnostic check runs under.
 *
 * `"3d"` is the permissive one: every §21 rule that `"2d"` adds — position in
 * the XY plane, rotation about +Z, angular velocity about +Z — is a *restriction*
 * of the 3D rules, so validating with `"3d"` performs exactly the
 * dimension-independent checks (finiteness, the §23 mass rule, inertia, damping,
 * the §31 CCD reconciliation) and rejects nothing a `"2d"` world would accept.
 */
const WIDENING_DIMENSION: PhysicsDimension = "3d";

/** Appendix A / §23: gravity applies unscaled unless a body says otherwise. */
const DEFAULT_GRAVITY_SCALE = 1;

/**
 * A torque or angular impulse (§26), in the same two forms §23's angular
 * velocity accepts (plan P5-3).
 *
 * A `number` is the scalar about **+Z** — the only angular degree of freedom a
 * `"2d"` world has — and widens to `(0, 0, w)`. Units are newton-metres for a
 * torque and newton-metre-seconds for an angular impulse.
 */
export type TorqueInput = Vector3 | number;

/**
 * One point-applied load: `applyForceAtPoint`'s force or
 * `applyImpulseAtPoint`'s impulse, with the world-space point it acts at (§26).
 *
 * Both vectors are **owned by the body** and are recycled between steps — the
 * command buffers are pools, so the entry you read this step is overwritten the
 * next time the same slot is used. Copy anything you intend to keep.
 */
export interface PointLoad {
  /** The applied vector: newtons for a force, newton-seconds for an impulse. */
  readonly value: Vector3;
  /** World-space point of application (§26). */
  readonly point: Vector3;
}

/** A queued {@link RigidBody.wake} or {@link RigidBody.sleep} (§32). */
export type SleepCommand = "wake" | "sleep";

/**
 * What a body has been asked to do since the world last drained it (§26, §32).
 *
 * Read-only view of live, body-owned storage: the vectors and the pool entries
 * are the body's own instances, so a reference taken here reflects later
 * accumulation and is reset in place when the world clears the buffers. Nothing
 * in this record is simulation state — it is a queue of requests.
 *
 * ## Clearing semantics
 *
 * The world consumes the whole record once per fixed step, hands it to the
 * adapter, and clears it. That single rule produces the two behaviours §26
 * describes:
 *
 * - a **force** or **torque** acts for one step only. To push continuously,
 *   call `applyForce` every step (from a `fixedUpdate` listener, §10) — the
 *   buffer is empty again by the time the next step begins;
 * - an **impulse** is a one-shot change of momentum. Applying it once is
 *   enough, and the same clearing rule guarantees it is not applied twice.
 *
 * ## Point loads are pooled
 *
 * `pointForces` and `pointImpulses` are pools that grow to the high-water mark
 * of a single step and never shrink; only the first `pointForceCount` /
 * `pointImpulseCount` entries are live. Clearing resets the counts, not the
 * arrays, so a steady-state body accumulating point loads every step allocates
 * nothing (§7b, plan D7).
 */
export interface RigidBodyCommands {
  /** Accumulated linear force in newtons (§26 `applyForce`). */
  readonly force: Vector3;

  /** Accumulated torque in newton-metres (§26 `applyTorque`). */
  readonly torque: Vector3;

  /** Accumulated linear impulse in newton-seconds (§26 `applyImpulse`). */
  readonly impulse: Vector3;

  /**
   * Accumulated angular impulse in newton-metre-seconds (§26
   * `applyAngularImpulse`).
   */
  readonly angularImpulse: Vector3;

  /** Pooled `applyForceAtPoint` entries; see the record documentation. */
  readonly pointForces: readonly PointLoad[];

  /** How many entries of {@link RigidBodyCommands.pointForces} are live. */
  readonly pointForceCount: number;

  /** Pooled `applyImpulseAtPoint` entries; see the record documentation. */
  readonly pointImpulses: readonly PointLoad[];

  /** How many entries of {@link RigidBodyCommands.pointImpulses} are live. */
  readonly pointImpulseCount: number;

  /**
   * The last {@link RigidBody.wake} or {@link RigidBody.sleep} of this step, or
   * `null`.
   *
   * Last call wins rather than two independent flags: a body told to wake and
   * then to sleep within one step has to resolve to *something*, and "the most
   * recent instruction" is the only resolution that does not depend on the
   * order in which the world happens to read two booleans (§33).
   */
  readonly sleepCommand: SleepCommand | null;
}

/** The writable face of {@link RigidBodyCommands}; module-private by design. */
interface MutableRigidBodyCommands {
  readonly force: Vector3;
  readonly torque: Vector3;
  readonly impulse: Vector3;
  readonly angularImpulse: Vector3;
  readonly pointForces: PointLoad[];
  pointForceCount: number;
  readonly pointImpulses: PointLoad[];
  pointImpulseCount: number;
  sleepCommand: SleepCommand | null;
}

/**
 * The registry-writable view of {@link RigidBody.sleeping} — the same pattern
 * `@four/core` uses for `Component.host`: the property is `readonly` in the
 * public contract so nothing else assigns it, and one named function in this
 * module performs the write.
 */
interface RigidBodySleepBinding {
  sleeping: boolean;
}

/** §29's collision payload as it reaches a node's listeners. */
export type RigidBodyCollisionEvent = CollisionEvent<RigidBody, Collider>;

/** §32's sleep-state payload as it reaches a node's listeners. */
export type RigidBodySleepEvent = SleepEvent<RigidBody>;

/**
 * What a {@link RigidBody} emits (§29, §32) — §29's five body-facing names,
 * minus the two trigger names, which belong to the sensor collider
 * (`ColliderEventMap`).
 *
 * Emission is package-internal (see the module header): `PhysicsSystem`
 * dispatches these after the fixed step, never during it (§6b, §39 step 9).
 */
export interface RigidBodyEventMap {
  /** Two colliders began touching (§29). */
  collisionstart: RigidBodyCollisionEvent;
  /** Two colliders are still touching (§29). */
  collisionstay: RigidBodyCollisionEvent;
  /** Two colliders stopped touching (§29); `contacts` is empty. */
  collisionend: RigidBodyCollisionEvent;
  /** This body stopped simulating (§32). */
  sleep: RigidBodySleepEvent;
  /** This body resumed simulating (§32). */
  wake: RigidBodySleepEvent;
}

/**
 * Returns pool slot `index`, appending a fresh one when the pool is too short.
 *
 * The append is the only allocation on the point-load path and happens at most
 * once per slot for the lifetime of the body.
 */
function pointLoadSlot(pool: PointLoad[], index: number): PointLoad {
  if (index < pool.length) {
    return pool[index];
  }
  const slot: PointLoad = { value: new Vector3(), point: new Vector3() };
  pool.push(slot);
  return slot;
}

/**
 * Reconciles §23's `continuousCollisionDetection` switch with §31's `ccdMode`
 * (the rule `RigidBodyDescriptor.ccdMode` states, minus the case
 * `validateRigidBodyDescriptor` has already rejected).
 *
 * | `continuousCollisionDetection` | `ccdMode`      | Result                     |
 * | ------------------------------ | -------------- | -------------------------- |
 * | absent                         | absent         | `"disabled"` (Appendix A)  |
 * | `true`                         | absent         | {@link DEFAULT_ENABLED_CCD_MODE} |
 * | absent or `true`               | non-`disabled` | that mode                  |
 * | `false`                        | non-`disabled` | rejected by §85 validation |
 * | `true`                         | `"disabled"`   | {@link DEFAULT_ENABLED_CCD_MODE} |
 * | `false` or absent              | `"disabled"`   | `"disabled"`               |
 *
 * The last-but-one row is a decision (WP-5.2): §23's boolean is the on/off
 * switch and §31's union names the *method*, so "on, with no method" — which is
 * what `true` plus `"disabled"` says — resolves to the default method, exactly
 * as `true` with no mode at all does. The mirrored contradiction (`false` plus
 * a real method) asks for the opposite of the switch and stays an error.
 */
function resolveCCDMode(descriptor: RigidBodyDescriptor): CCDMode {
  const mode = descriptor.ccdMode;
  if (mode !== undefined && mode !== "disabled") {
    return mode;
  }
  return descriptor.continuousCollisionDetection === true
    ? DEFAULT_ENABLED_CCD_MODE
    : DEFAULT_CCD_MODE;
}

/**
 * A simulated body attached to a node (§23), created from a
 * {@link RigidBodyDescriptor}.
 *
 * ```ts
 * const body = node.addComponent(
 *   new RigidBody({ type: "dynamic", mass: 2, linearDamping: 0.1 }),
 * );
 * node.addComponent(new Collider({ shape: { type: "sphere", radius: 0.5 } }));
 *
 * body.on("collisionstart", (event) => {
 *   console.log(event.totalImpulse.length());
 * });
 *
 * body.applyImpulse(new Vector3(0, 5, 0)); // applied at the next fixed step
 * ```
 *
 * One per node (§6a). See the module header for the pose, command, event, and
 * dimension contracts.
 */
export class RigidBody
  extends EventEmitter<RigidBodyEventMap>
  implements Component
{
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "rigid-body";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * Centre of mass in the body's local frame (§23). Owned by the component and
   * never replaced — write into it. The origin by default.
   *
   * §23 makes this always present, which is *not* the same as always
   * *authored*: a body that never mentioned a centre of mass is asking the
   * solver to derive one from its colliders (§23, §25), and a body that placed
   * one is overriding that derivation. {@link RigidBody.centerOfMassAuthored}
   * is that distinction and {@link RigidBody.toDescriptor} emits the field only
   * when it holds.
   */
  readonly centerOfMass: Vector3;

  /**
   * Linear velocity in metres per second (§23). Authored state going in,
   * solved state coming back — see the module header.
   */
  readonly linearVelocity: Vector3;

  /**
   * Angular velocity in radians per second (§23), as an axis-angle rate vector;
   * in a `"2d"` world only `z` is meaningful (§21).
   */
  readonly angularVelocity: Vector3;

  /**
   * Rotational inertia about the centre of mass (§23), or `undefined` to let
   * the solver derive it from the colliders and the mass.
   *
   * §23 declares this non-optional, but §23 also derives mass (and with it
   * inertia) from collider density when it is not authored — and "derive it"
   * and "the identity tensor" are different instructions. The component keeps
   * them distinguishable: `undefined` **is** this field's authored flag, which
   * is why it needs no companion to
   * {@link RigidBody.centerOfMassAuthored}. In a `"2d"` world only the Z
   * diagonal entry is used (§23).
   *
   * For the same reason a future `syncSolverToScene` must **not** publish a
   * solver-derived tensor back into this field (WP-5.2-fix1): doing so would
   * turn a derivation into an authored mass distribution, which is exactly the
   * defect {@link RigidBody.centerOfMassAuthored} exists to prevent. A derived
   * tensor belongs in a separate read-only field.
   */
  inertiaTensor?: Matrix3;

  /** Linear damping coefficient, `>= 0` (§23). */
  linearDamping: number;

  /** Angular damping coefficient, `>= 0` (§23). */
  angularDamping: number;

  /**
   * Multiplier on world gravity for this body (§23). `1` leaves gravity as-is,
   * `0` makes the body weightless, a negative value inverts it.
   */
  gravityScale: number;

  /**
   * Whether the solver has put this body to sleep (§23, §32).
   *
   * Read-only state, exactly as §23 requires: {@link RigidBody.wake} and
   * {@link RigidBody.sleep} are the commands, and the flag changes only when
   * the solver reports the transition after a step — at which point the body
   * also emits `"sleep"` or `"wake"` (WP-5.3).
   */
  readonly sleeping: boolean = false;

  /**
   * The initial world position a descriptor carried, or `undefined` (§37).
   *
   * The live pose is the node's `Transform` (§7, §42); this is only what the
   * descriptor asked for, kept so a descriptor round-trips through the
   * component unchanged. A `Vector2` has already been widened to `z = 0`.
   */
  readonly initialPosition?: Vector3;

  /**
   * The initial world rotation a descriptor carried, or `undefined`. A scalar
   * angle has already been resolved to its quaternion about +Z (§7a).
   */
  readonly initialRotation?: Quaternion;

  /** Backing store for {@link RigidBody.type}. */
  #type: BodyType;

  /** Backing store for {@link RigidBody.mass}; `undefined` means "derive it". */
  #mass?: number;

  /**
   * Whether a centre of mass was named by the constructor descriptor or by
   * {@link RigidBody.markCenterOfMassAuthored} — the *sticky* half of
   * {@link RigidBody.centerOfMassAuthored}, whose other half is "the vector is
   * not at the origin".
   */
  #centerOfMassAuthored: boolean;

  /** Backing store for {@link RigidBody.ccdMode} (§31). */
  #ccdMode: CCDMode;

  /** The §26 command buffers; see {@link RigidBodyCommands}. */
  readonly #commands: MutableRigidBodyCommands = {
    force: new Vector3(),
    torque: new Vector3(),
    impulse: new Vector3(),
    angularImpulse: new Vector3(),
    pointForces: [],
    pointForceCount: 0,
    pointImpulses: [],
    pointImpulseCount: 0,
    sleepCommand: null,
  };

  /**
   * Widening workspace for the §26 methods, so accumulating a load allocates
   * nothing (§7b, plan D7). Never escapes this class.
   */
  readonly #scratch = new Vector3();

  /**
   * Builds a body from `descriptor`, which is validated against §22, §23, §31,
   * and §85 (dimension-independently — see the module header).
   *
   * Vectors and the inertia tensor are **copied**, so the caller keeps
   * ownership of whatever it passes in.
   */
  constructor(descriptor: RigidBodyDescriptor) {
    super();
    validateRigidBodyDescriptor(descriptor, WIDENING_DIMENSION);

    this.#type = descriptor.type;
    this.#mass = descriptor.mass;
    this.#ccdMode = resolveCCDMode(descriptor);

    this.#centerOfMassAuthored = descriptor.centerOfMass !== undefined;
    this.centerOfMass =
      descriptor.centerOfMass === undefined
        ? new Vector3()
        : widenToVector3(descriptor.centerOfMass);
    this.linearVelocity =
      descriptor.linearVelocity === undefined
        ? new Vector3()
        : widenToVector3(descriptor.linearVelocity);
    this.angularVelocity =
      descriptor.angularVelocity === undefined
        ? new Vector3()
        : resolveAngularVelocity(
            WIDENING_DIMENSION,
            descriptor.angularVelocity,
          );
    if (descriptor.inertiaTensor !== undefined) {
      this.inertiaTensor = new Matrix3().copy(descriptor.inertiaTensor);
    }

    this.linearDamping = descriptor.linearDamping ?? 0;
    this.angularDamping = descriptor.angularDamping ?? 0;
    this.gravityScale = descriptor.gravityScale ?? DEFAULT_GRAVITY_SCALE;

    if (descriptor.position !== undefined) {
      this.initialPosition = widenToVector3(descriptor.position);
    }
    if (descriptor.rotation !== undefined) {
      this.initialRotation = resolveRotation(
        WIDENING_DIMENSION,
        descriptor.rotation,
      );
    }
  }

  // --- §22/§23 state --------------------------------------------------------

  /**
   * Which §22 simulation model this body follows (§23). Settable; the §23 mass
   * rule is re-checked against the new type, so promoting a zero-mass body to
   * `"dynamic"` fails here rather than in the solver.
   */
  get type(): BodyType {
    return this.#type;
  }

  set type(value: BodyType) {
    validateMass(value, this.#mass);
    this.#type = value;
  }

  /**
   * Mass in kilograms (§23), or `undefined` when it is to be derived from
   * collider density times volume (§23, §24, §25).
   *
   * Authoritative when present and re-validated on assignment: a dynamic body's
   * mass must be positive, and non-simulated mass is expressed through the body
   * *type*, never `mass = 0` (§23, §85).
   */
  get mass(): number | undefined {
    return this.#mass;
  }

  set mass(value: number | undefined) {
    validateMass(this.#type, value);
    this.#mass = value;
  }

  /**
   * Derived reciprocal mass (§23), read-only:
   *
   * - `0` for `"static"` and both kinematic types — they do not respond to
   *   forces (§22), which is what an infinite effective mass means;
   * - `1 / mass` for a dynamic body with an authored mass;
   * - `NaN` for a dynamic body whose mass has not been authored and has not yet
   *   been derived from collider density (§23). `NaN` and not `0`: an
   *   unknown mass is not an infinite one, and a value that silently reads as
   *   "immovable" would turn a missing collider into a body that quietly
   *   refuses to move.
   */
  get inverseMass(): number {
    if (this.#type !== "dynamic") {
      return 0;
    }
    return this.#mass === undefined ? Number.NaN : 1 / this.#mass;
  }

  /**
   * Whether {@link RigidBody.centerOfMass} is an **authored mass
   * distribution** rather than the always-present default §23 gives every body
   * (WP-5.2-fix1).
   *
   * ## Why the distinction has to exist
   *
   * §23 derives a body's mass from collider density times volume whenever
   * `mass` is not authored, and a solver derives the centre of mass and the
   * rotational inertia from the same geometry in the same breath — mass,
   * centre, and inertia are one triple. Naming any part of that triple means
   * "do not derive it", so a component that reported its default origin as an
   * authored centre would make the density-derived mass unreachable: an adapter
   * asked for a distribution with no mass to distribute has nothing to do but
   * refuse.
   *
   * ## The rule, and why it cannot silently drop what a caller asked for
   *
   * A centre of mass counts as authored when **either** holds:
   *
   * 1. the constructor descriptor carried `centerOfMass` (whatever its value,
   *    including the origin), or {@link RigidBody.markCenterOfMassAuthored}
   *    has been called — the sticky half;
   * 2. {@link RigidBody.centerOfMass} is not at the origin right now — the
   *    live half, which catches `body.centerOfMass.set(…)` after construction
   *    without asking the caller to announce it.
   *
   * The union is what makes the omission safe. Rule 1 keeps an explicitly
   * authored origin — the one value rule 2 cannot see — and rule 2 keeps every
   * post-construction edit. The only state that is omitted is a centre that is
   * at the origin *and* was never mentioned, which is precisely the state that
   * carries no instruction. `-0` reads as the origin (`-0 !== 0` is `false`),
   * and a non-finite component reads as authored, so §85 validation rejects it
   * rather than the descriptor quietly losing it.
   *
   * The one case rule 2 alone would get wrong is "pin the centre to the origin
   * even though the colliders sit off it", which is a real instruction that
   * looks identical to the default. Authoring `centerOfMass` in the descriptor
   * states it; {@link RigidBody.markCenterOfMassAuthored} states it after the
   * fact.
   */
  get centerOfMassAuthored(): boolean {
    if (this.#centerOfMassAuthored) {
      return true;
    }
    const { x, y, z } = this.centerOfMass;
    return x !== 0 || y !== 0 || z !== 0;
  }

  /**
   * Declares {@link RigidBody.centerOfMass} an authored mass distribution from
   * now on, so {@link RigidBody.toDescriptor} emits it even at the origin.
   *
   * The escape hatch for the one case the live half of
   * {@link RigidBody.centerOfMassAuthored} cannot infer: a centre deliberately
   * pinned to the body origin while the colliders sit elsewhere. One-way by
   * design — nothing un-authors a distribution, because "forget what I asked
   * for" is the silent data loss this whole mechanism exists to avoid. To go
   * back to a derived centre, build a body whose descriptor omits
   * `centerOfMass`.
   *
   * Remember that an authored distribution needs an authored {@link
   * RigidBody.mass} as well: solvers set mass, centre, and inertia as one
   * triple (§23), and an adapter is entitled to reject half of it.
   */
  markCenterOfMassAuthored(): void {
    this.#centerOfMassAuthored = true;
  }

  // --- §31 continuous collision detection -----------------------------------

  /**
   * Which §31 method sweeps this body, `"disabled"` when it is not swept.
   *
   * This is the authoritative field;
   * {@link RigidBody.continuousCollisionDetection} is §23's on/off view of it.
   */
  get ccdMode(): CCDMode {
    return this.#ccdMode;
  }

  set ccdMode(value: CCDMode) {
    this.#ccdMode = value;
  }

  /**
   * §23's switch, expressed over {@link RigidBody.ccdMode} so the two can never
   * disagree: reading it asks whether a method is selected, and
   * `body.continuousCollisionDetection = true` (§31's own example) selects
   * {@link DEFAULT_ENABLED_CCD_MODE} unless a method is already set. Assigning
   * `false` clears the method.
   */
  get continuousCollisionDetection(): boolean {
    return this.#ccdMode !== "disabled";
  }

  set continuousCollisionDetection(value: boolean) {
    if (!value) {
      this.#ccdMode = "disabled";
      return;
    }
    if (this.#ccdMode === "disabled") {
      this.#ccdMode = DEFAULT_ENABLED_CCD_MODE;
    }
  }

  // --- §26 forces and impulses, §32 sleep commands --------------------------

  /**
   * What this body has been asked to do since the world last drained it (§26,
   * §32). A live read-only view — see {@link RigidBodyCommands}.
   */
  get commands(): RigidBodyCommands {
    return this.#commands;
  }

  /**
   * Requests that the solver wake this body at the next fixed step (§23, §32).
   *
   * Queued, not immediate: {@link RigidBody.sleeping} changes when the solver
   * reports the transition. Calling `wake()` then `sleep()` in the same step
   * leaves the later command standing.
   */
  wake(): void {
    this.#commands.sleepCommand = "wake";
  }

  /** Requests that the solver put this body to sleep (§23, §32). See {@link RigidBody.wake}. */
  sleep(): void {
    this.#commands.sleepCommand = "sleep";
  }

  /**
   * Accumulates a force in newtons, applied at the centre of mass (§26).
   *
   * Acts for one fixed step; call it every step to push continuously. Applying
   * a force does not implicitly wake a sleeping body — call
   * {@link RigidBody.wake} as well, so that what wakes a body is always
   * something the caller asked for (decision, WP-5.2).
   *
   * Per-step path: the components are widened but not range-checked, matching
   * §85's allowance that per-step validation may be skipped. A non-finite force
   * is caught by the solver, not here.
   */
  applyForce(force: Vector3Input): void {
    this.#commands.force.add(widenToVector3(force, this.#scratch));
  }

  /**
   * Accumulates a force in newtons applied at `worldPoint`, a **world-space**
   * position (§26).
   *
   * Kept as a point load rather than being decomposed into a force and a torque
   * at the call site: the lever arm is measured from the *world-space* centre
   * of mass, which the component does not know — §23's `centerOfMass` is in the
   * body's local frame and the pose belongs to the node and the solver. The
   * adapter, which has both, does the decomposition.
   */
  applyForceAtPoint(force: Vector3Input, worldPoint: Vector3Input): void {
    const commands = this.#commands;
    const slot = pointLoadSlot(commands.pointForces, commands.pointForceCount);
    widenToVector3(force, slot.value);
    widenToVector3(worldPoint, slot.point);
    commands.pointForceCount += 1;
  }

  /**
   * Accumulates a torque in newton-metres (§26). A `number` is the scalar about
   * +Z (plan P5-3). Acts for one fixed step, like {@link RigidBody.applyForce}.
   */
  applyTorque(torque: TorqueInput): void {
    this.#commands.torque.add(
      resolveAngularVelocity(WIDENING_DIMENSION, torque, this.#scratch),
    );
  }

  /**
   * Accumulates a linear impulse in newton-seconds, applied at the centre of
   * mass (§26).
   *
   * One-shot: the world applies it at the next fixed step and clears the
   * buffer, so a single call changes momentum exactly once.
   */
  applyImpulse(impulse: Vector3Input): void {
    this.#commands.impulse.add(widenToVector3(impulse, this.#scratch));
  }

  /**
   * Accumulates an impulse in newton-seconds applied at `worldPoint` (§26).
   * See {@link RigidBody.applyForceAtPoint} for why the point is kept.
   */
  applyImpulseAtPoint(impulse: Vector3Input, worldPoint: Vector3Input): void {
    const commands = this.#commands;
    const slot = pointLoadSlot(
      commands.pointImpulses,
      commands.pointImpulseCount,
    );
    widenToVector3(impulse, slot.value);
    widenToVector3(worldPoint, slot.point);
    commands.pointImpulseCount += 1;
  }

  /**
   * Accumulates an angular impulse in newton-metre-seconds (§26). A `number` is
   * the scalar about +Z (plan P5-3).
   */
  applyAngularImpulse(impulse: TorqueInput): void {
    this.#commands.angularImpulse.add(
      resolveAngularVelocity(WIDENING_DIMENSION, impulse, this.#scratch),
    );
  }

  // --- world registration ---------------------------------------------------

  /**
   * Re-validates this body against a world of `dimension` (§21, §85).
   *
   * Called when the body is registered with a `PhysicsWorld` (WP-5.3), which is
   * the first moment the dimension is known: a `"2d"` world rejects an
   * out-of-plane centre of mass, initial position, or angular velocity here
   * rather than projecting it away. Not a per-step path — it builds a
   * descriptor.
   */
  validateFor(dimension: PhysicsDimension): void {
    validateRigidBodyDescriptor(this.toDescriptor(), dimension);
  }

  /**
   * The descriptor an adapter would be handed for this body (§37 `createBody`).
   *
   * A fresh record whose vectors and tensor are **references to this
   * component's live state**, not copies: the adapter reads them during
   * `createBody` and must not retain them. `mass`, `centerOfMass`,
   * `inertiaTensor`, `position`, and `rotation` are present only when authored,
   * so a descriptor that omitted them round-trips unchanged.
   *
   * `centerOfMass` is the subtle one: §23 keeps it always present on the
   * component, so emitting it unconditionally would tell every adapter that
   * every body carries an authored mass distribution and make §23's
   * density-derived mass unreachable (WP-5.2-fix1). It is emitted exactly when
   * {@link RigidBody.centerOfMassAuthored} holds, which that property documents.
   */
  toDescriptor(): RigidBodyDescriptor {
    const descriptor: RigidBodyDescriptor = {
      type: this.#type,
      linearVelocity: this.linearVelocity,
      angularVelocity: this.angularVelocity,
      linearDamping: this.linearDamping,
      angularDamping: this.angularDamping,
      gravityScale: this.gravityScale,
      continuousCollisionDetection: this.continuousCollisionDetection,
      ccdMode: this.#ccdMode,
    };
    if (this.#mass !== undefined) {
      descriptor.mass = this.#mass;
    }
    if (this.centerOfMassAuthored) {
      descriptor.centerOfMass = this.centerOfMass;
    }
    if (this.inertiaTensor !== undefined) {
      descriptor.inertiaTensor = this.inertiaTensor;
    }
    if (this.initialPosition !== undefined) {
      descriptor.position = this.initialPosition;
    }
    if (this.initialRotation !== undefined) {
      descriptor.rotation = this.initialRotation;
    }
    return descriptor;
  }

  // --- §6a lifecycle --------------------------------------------------------

  /**
   * Drops every listener and every queued command (§6a, §83).
   *
   * Detaching a component does **not** dispose it (§6a), so this runs only from
   * an explicit `dispose()` or `ComponentRegistry.disposeAll`. Removing the
   * body from its world is the world's business, not the component's.
   */
  dispose(): void {
    this.removeAllListeners();
    clearRigidBodyCommands(this);
  }
}

/**
 * Empties `body`'s §26 command buffers and its §32 sleep command.
 *
 * **Package-internal**: `PhysicsWorld` calls it once per fixed step, after the
 * commands have been handed to the adapter. Deliberately a free function
 * outside the barrel rather than a public method — clearing another
 * component's queue is not something application code should be able to do by
 * accident. The pools keep their slots (see {@link RigidBodyCommands}).
 */
export function clearRigidBodyCommands(body: RigidBody): void {
  const commands = body.commands as MutableRigidBodyCommands;
  commands.force.set(0, 0, 0);
  commands.torque.set(0, 0, 0);
  commands.impulse.set(0, 0, 0);
  commands.angularImpulse.set(0, 0, 0);
  commands.pointForceCount = 0;
  commands.pointImpulseCount = 0;
  commands.sleepCommand = null;
}

/**
 * Publishes a solver-reported sleep transition onto `body` (§32).
 *
 * **Package-internal**, and the only writer of {@link RigidBody.sleeping} —
 * mirroring how `@four/core` binds `Component.host`. Returns whether the state
 * actually changed, which is what tells `PhysicsSystem` to emit `"sleep"` or
 * `"wake"`; the emit itself happens after the fixed step (§6b, §39 step 9).
 */
export function setRigidBodySleeping(
  body: RigidBody,
  sleeping: boolean,
): boolean {
  if (body.sleeping === sleeping) {
    return false;
  }
  (body as RigidBodySleepBinding).sleeping = sleeping;
  return true;
}
