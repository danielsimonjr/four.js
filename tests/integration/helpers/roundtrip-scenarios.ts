/**
 * The Phase 11 save → reload rig (plan §6j, WP-11.5; §79–§80, §113a) — one
 * headless 2D Rapier scenario, plus **the reference `RigidBody` / `Collider`
 * `ComponentSerializer`s an application is meant to copy**.
 *
 * `@four/serialization` may depend on `core`, `math`, and `scene` only (plan
 * §3.1), so it can never name `RigidBody` or `Collider`: §79's answer is a
 * registry each package — or, when the matrix forbids even that, the
 * application wiring them together — registers its own serializers into. P11-1
 * pinned Phase 11's single cross-package registration to *this* layer, so this
 * file is where that registration lives, and it is written to be copied.
 *
 * ## The pattern
 *
 * A component serializer is two functions over one `JsonValue`:
 *
 * ```ts
 * const registry = createDefaultComponentSerializers()
 *   .register(RigidBody, RIGID_BODY_SERIALIZER)
 *   .register(Collider, COLLIDER_SERIALIZER);
 *
 * const document = serializeScene(simRoot, registry);   // §79 write
 * const reloaded = instantiateScene(document, registry); // §79 read
 * for (const node of bodyNodes(reloaded)) world.addBody(node); // re-register
 * ```
 *
 * `register` takes the component **class** (the `static readonly typeName` is
 * the document key, §6a/§79), not an instance and not a string. The writer
 * probes each registered class with `node.getComponent(type)`, so a component
 * whose class was never registered is **silently unsaved** — the known boundary
 * `serializer.ts` records, and the reason both classes are registered together
 * below rather than left to a caller to remember.
 *
 * Both serializers write **`toDescriptor()`-derived JSON**: the §37 descriptor
 * is already the canonical "everything a solver needs to rebuild this" record,
 * so deriving the document from it means the two can never drift, and a field
 * added to §23/§24 shows up as a compile error here rather than as state that
 * quietly stops being saved.
 *
 * ## What round-trips, and what is world-registration state
 *
 * | state | round-trips? |
 * | --- | --- |
 * | §23 body type, damping, gravity scale, §31 CCD mode | yes |
 * | §23 linear/angular velocity (solver-refreshed, §42) | yes — re-seeded through the descriptor |
 * | §23 mass, centre of mass (when authored) | yes, with the caveat below |
 * | §19 physics/animation blend weights | yes (engine state, absent from the descriptor by design) |
 * | node pose, authority, name, tags, metadata | yes (`@four/scene`'s own serializer) |
 * | §24 shape, offset, sensor flag, groups, mask | yes |
 * | §25 friction / restitution / density | yes, as **effective** numbers |
 * | §25 shared `PhysicsMaterial` identity | **no** — a resource reference (§79 resource ids), not component state |
 * | §32 `sleeping` | **no** — solver state; a reloaded body starts awake |
 * | solver handles, body ids, contact manifolds, warm-start impulses | **no** — that is §34's snapshot, not §79's document |
 *
 * Three of those deserve their own paragraph.
 *
 * **Mass authoredness survives the document but not registration.**
 * `PhysicsWorld.addBody` finishes by reading `getBodyMass` back onto the
 * component (`#refreshMassProperties`), so a body that asked the solver to
 * derive its mass from collider density (§23, §25) reports an *authored* mass
 * from that moment on — and so does a **static** one, whose collider still has a
 * density and therefore a positive derived mass the solver never uses (measured
 * 2026-08-02: this scenario's ground reports 20 kg and its sensor 4.8 kg). The
 * document therefore records a mass for every registered body with a collider,
 * and reloading re-authors it. That is the behaviour-preserving choice — the
 * reloaded body has the same mass the saved one had, and the suite asserts that
 * the reload's masses are bit-identical to the save's — but it is not
 * authoring-preserving: the information "this mass was derived" is destroyed by
 * registration, before serialization ever sees it. Save *before* registering to
 * keep it.
 *
 * **§25's fallback chain is resolved on the way out.**
 * `Collider.toDescriptor` emits `effectiveFriction` / `effectiveRestitution` /
 * `effectiveDensity`, so a collider that named none of the three saves the
 * defaults it was resolving to and reloads with them pinned. Again
 * behaviour-preserving, not authoring-preserving; a serializer that wanted the
 * latter would read the optional `collider.friction` fields directly and accept
 * that a later change to `DEFAULT_FRICTION` moves the reloaded simulation.
 *
 * **Sleep is not saved (§32, §34).** A `sleeping` flag is solver state, and
 * §79 keeps simulation state out of a scene document ("physics state, animation
 * state, and replay data must be separate optional sections"). It is recorded
 * in the document as *diagnostics* — see {@link RigidBodyDocument.sleeping} —
 * and deliberately not applied on load.
 *
 * ## The §79 / §34 line (the finding this rig exists to make)
 *
 * A §79 document carries **authored state**. A §34 snapshot carries the
 * **solver's world**: contact manifolds, warm-start impulses, island and sleep
 * bookkeeping — everything an iterative solver accumulates and nothing an author
 * ever wrote. So a save → load reproduces a scene, not a
 * simulation-in-progress.
 *
 * `../scene-roundtrip.test.ts` measures where that costs something, by saving
 * the *same* scene at two moments and reloading both. Measured 2026-08-02
 * against Rapier 2D 0.19.3:
 *
 * | save point | solver state | reloaded §33 checksum stream |
 * | --- | --- | --- |
 * | {@link CONTACT_FREE_SAVE_STEP} (both balls in free fall) | no contacts | **bit-identical** to the control for all 200 remaining steps — through every later collision, bounce, and §29 trigger |
 * | {@link SAVE_STEP} (both balls resting on the ground) | live manifolds | **parts from the control at step 2**; states stay within {@link CONTACT_RELOAD_POSITION_TOLERANCE} |
 *
 * In both cases the restored *authored* state is exact: poses, rotations,
 * velocities, and masses come back bit for bit (the suite asserts a drift of
 * exactly zero at step 0). So the boundary is not "§79 is lossy about numbers";
 * it is precisely **"§79 does not carry the solver's contact state"**. Where
 * there is none to carry, a §79 round trip is a perfect one; where there is,
 * bit-identity needs a §34 snapshot (`PhysicsWorld.createSnapshot`), which is
 * exactly what §34 is for.
 *
 * ## Conventions (plan §1)
 *
 * Y-up (2D gravity is negative Y, §7a), radians, **seconds** everywhere, no
 * clock and no `Math.random` anywhere in a scenario (§33): every run is driven
 * by `Application.step(DT)` with a constant, injected delta.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector2, Vector3 } from "@four/math";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type BodyType,
  type CCDMode,
  type CollisionShape,
  type PhysicsBodyHandle,
} from "@four/physics";
import { Rapier2dAdapter } from "@four/physics-rapier";
import { Group, Node, Transform } from "@four/scene";
import {
  ComponentSerializerRegistry,
  asJsonObject,
  createDefaultComponentSerializers,
  isJsonArray,
  validateQuaternionDocument,
  validateVector3Document,
  type ComponentSerializer,
  type JsonObject,
  type JsonValue,
} from "@four/serialization";
import { Application } from "four/application";

// ---------------------------------------------------------------------------
// Scenario constants (§7a: seconds and world units, never milliseconds)
// ---------------------------------------------------------------------------

/** One fixed step in **seconds** (§7a, §10; Appendix A's 1/60). */
export const DT = 1 / 60;

/**
 * Fixed steps run before the scene is saved — 2 s at {@link DT}, the step the
 * packet names. By then both balls have landed and are **in resting contact**
 * with the ground, which is what makes this the interesting save point: the
 * solver is holding contact manifolds and warm-start impulses that no §79
 * document carries.
 */
export const SAVE_STEP = 120;

/**
 * The second save point — 0.667 s at {@link DT}, while both balls are still in
 * free fall and the solver holds **no contacts at all**.
 *
 * The controlled half of the experiment: same scene, same serializers, same
 * reload path, and the only difference is whether the solver had accumulated
 * contact state. See the module header's §79 / §34 section for what that
 * difference turns out to be worth.
 */
export const CONTACT_FREE_SAVE_STEP = 40;

/** Fixed steps the control run performs in one go — 4 s at {@link DT}. */
export const CONTROL_STEPS = 240;

/**
 * Position tolerance for the contact-carrying reload, in metres.
 *
 * Derived rather than tuned: the smaller ball's radius is 0.25 m, and 1 mm is
 * 0.4 % of it — far too small for any *behavioural* difference (a ball resting
 * somewhere else, or still bouncing when the control has settled) to hide under,
 * and far larger than the drift a lost warm-start actually produces. Measured on
 * 2026-08-02: **9.54e-7 m** after the 120 steps that follow the reload, which is
 * below §33's own 1e-6 quantization step.
 */
export const CONTACT_RELOAD_POSITION_TOLERANCE = 1e-3;

/**
 * Velocity tolerance for the contact-carrying reload, in metres per second.
 * Measured 2026-08-02: **7.15e-7 m/s**. See
 * {@link CONTACT_RELOAD_POSITION_TOLERANCE}.
 */
export const CONTACT_RELOAD_VELOCITY_TOLERANCE = 1e-2;

/**
 * The static ground: 20 units wide, half a unit thick, centred so its **top
 * surface sits at y = 0**, which is the datum every height below is measured
 * from.
 */
export const GROUND = { halfWidth: 10, halfHeight: 0.5, centerY: -0.5 };

/**
 * The static sensor volume (§24 `sensor`, §29 triggers): a box the falling
 * balls pass through on their way down, so a reloaded scene can be shown to
 * still *be* a sensor rather than merely to have the flag set.
 */
export const SENSOR = {
  halfWidth: 3,
  halfHeight: 0.4,
  centerX: 0,
  centerY: 1.4,
};

/**
 * The two dynamic balls, in registration order — which is §33's checksum order,
 * so reordering this array changes every digest in the suite.
 *
 * Masses are **authored** on one ball and **derived** on the other, on purpose:
 * the derived one is what makes the mass-authoredness paragraph in the module
 * header a claim this suite tests rather than a claim it asserts.
 */
export const BALLS = [
  {
    name: "ball-authored",
    x: -1.4,
    y: 3.2,
    radius: 0.3,
    mass: 1.5,
    restitution: 0.45,
    friction: 0.3,
    velocityX: 1.1,
  },
  {
    name: "ball-derived",
    x: 1.1,
    y: 4.1,
    radius: 0.25,
    mass: undefined,
    restitution: 0.2,
    friction: 0.6,
    velocityX: -0.8,
  },
] as const;

/** Bodies the scenario registers: the ground, the sensor, and {@link BALLS}. */
export const BODY_COUNT = 2 + BALLS.length;

/** Name of the `Group` that roots the serialized subtree. */
export const SIM_ROOT_NAME = "sim-root";

// ---------------------------------------------------------------------------
// Shape documents (§24)
// ---------------------------------------------------------------------------

/** Reads a required number field, naming the path §85-style. */
function requireNumber(record: JsonObject, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(
      `${path}.${key} must be a finite number, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/** Reads a required string field. */
function requireString(record: JsonObject, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(
      `${path}.${key} must be a string, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/** A `Vector3` as the three numbers `validateVector3Document` reads back. */
function vector3Json(v: Vector3): JsonObject {
  return { x: v.x, y: v.y, z: v.z };
}

/** A `Quaternion` as the four numbers `validateQuaternionDocument` reads back. */
function quaternionJson(q: Quaternion): JsonObject {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** A `Vector2` (a §24 2D half-extent or polygon vertex) as two numbers. */
function vector2Json(v: Vector2): JsonObject {
  return { x: v.x, y: v.y };
}

/** Reads a `{x, y}` pair back into a fresh `Vector2`. */
function readVector2(value: JsonValue, path: string): Vector2 {
  const record = asJsonObject(value, path);
  return new Vector2(
    requireNumber(record, "x", path),
    requireNumber(record, "y", path),
  );
}

/**
 * A §24 collision shape as JSON — every shape this build ships, discriminated
 * by the same `type` tag the union uses.
 *
 * Written as an exhaustive `switch` so that adding a shape to `CollisionShape`
 * fails to compile here (`shape` narrows to `never` in the default branch)
 * instead of silently saving a shape as an unreadable `{}`.
 */
export function serializeCollisionShape(shape: CollisionShape): JsonObject {
  switch (shape.type) {
    case "circle":
    case "sphere":
      return { type: shape.type, radius: shape.radius };
    case "rectangle":
      return { type: shape.type, halfExtents: vector2Json(shape.halfExtents) };
    case "box":
      return { type: shape.type, halfExtents: vector3Json(shape.halfExtents) };
    case "capsule":
      return {
        type: shape.type,
        radius: shape.radius,
        halfHeight: shape.halfHeight,
      };
    case "polygon":
      return {
        type: shape.type,
        vertices: shape.vertices.map((vertex) => vector2Json(vertex)),
      };
    default: {
      const unreachable: never = shape;
      throw new FourError(
        "NOT_IMPLEMENTED",
        `This reference serializer has no document form for collision shape ${JSON.stringify(unreachable)} (§24, §79).`,
      );
    }
  }
}

/** Rebuilds a §24 collision shape from {@link serializeCollisionShape}'s form. */
export function deserializeCollisionShape(
  value: JsonValue,
  path = "shape",
): CollisionShape {
  const record = asJsonObject(value, path);
  const type = requireString(record, "type", path);
  switch (type) {
    case "circle":
      return { type: "circle", radius: requireNumber(record, "radius", path) };
    case "sphere":
      return { type: "sphere", radius: requireNumber(record, "radius", path) };
    case "rectangle":
      return {
        type: "rectangle",
        halfExtents: readVector2(record.halfExtents, `${path}.halfExtents`),
      };
    case "box": {
      const extents = validateVector3Document(
        record.halfExtents,
        `${path}.halfExtents`,
      );
      return {
        type: "box",
        halfExtents: new Vector3(extents.x, extents.y, extents.z),
      };
    }
    case "capsule":
      return {
        type: "capsule",
        radius: requireNumber(record, "radius", path),
        halfHeight: requireNumber(record, "halfHeight", path),
      };
    case "polygon": {
      const vertices = record.vertices;
      if (!isJsonArray(vertices)) {
        throw new TypeError(`${path}.vertices must be an array.`);
      }
      return {
        type: "polygon",
        vertices: vertices.map((vertex, index) =>
          readVector2(vertex, `${path}.vertices[${String(index)}]`),
        ),
      };
    }
    default:
      throw new TypeError(
        `${path}.type is ${JSON.stringify(type)}, which is not a §24 collision shape this build ships.`,
      );
  }
}

// ---------------------------------------------------------------------------
// The reference component serializers (§79, plan P11-1)
// ---------------------------------------------------------------------------

/** The §22 body types, for narrowing a document string back to `BodyType`. */
const BODY_TYPES: readonly BodyType[] = [
  "dynamic",
  "static",
  "kinematic-position",
  "kinematic-velocity",
];

/** The §31 CCD modes. */
const CCD_MODES: readonly CCDMode[] = ["disabled", "speculative", "swept"];

/**
 * The document a {@link RIGID_BODY_SERIALIZER} writes — named so a reader can
 * see the shape without decoding the two functions below.
 *
 * Every field but {@link RigidBodyDocument.sleeping} is restored on load; see
 * the module header's table for why that one is not.
 */
export interface RigidBodyDocument {
  /** §22 simulation model. */
  readonly type: BodyType;
  /** Kilograms (§23), absent when the body has none — see the module header. */
  readonly mass?: number;
  /** Present only when {@link RigidBody.centerOfMassAuthored} holds (§23). */
  readonly centerOfMass?: JsonObject;
  /** Metres per second (§23), read back from the solver every step. */
  readonly linearVelocity: JsonObject;
  /** Radians per second (§23); only Z is meaningful in a `"2d"` world (§21). */
  readonly angularVelocity: JsonObject;
  /** §23 linear damping coefficient. */
  readonly linearDamping: number;
  /** §23 angular damping coefficient. */
  readonly angularDamping: number;
  /** §23 multiplier on world gravity. */
  readonly gravityScale: number;
  /** §31 continuous-collision method. */
  readonly ccdMode: CCDMode;
  /** §19 solver share of a `"blended"` pose. */
  readonly physicsWeight: number;
  /** §19 animated share of a `"blended"` pose. */
  readonly animationWeight: number;
  /**
   * §32 sleep state **as diagnostics only**.
   *
   * Recorded so a saved document says whether the body was simulating, and
   * deliberately *not* applied on load: sleep is solver state (§34), and
   * `RigidBody.sleeping` is read-only precisely because only a solver report may
   * change it (§23, §32).
   */
  readonly sleeping: boolean;
}

/** Narrows a document string to a §22 {@link BodyType}. */
function readBodyType(record: JsonObject, path: string): BodyType {
  const value = requireString(record, "type", path);
  for (const type of BODY_TYPES) {
    if (type === value) {
      return type;
    }
  }
  throw new TypeError(
    `${path}.type is ${JSON.stringify(value)}, which is not a §22 body type.`,
  );
}

/** Narrows a document string to a §31 {@link CCDMode}. */
function readCCDMode(record: JsonObject, path: string): CCDMode {
  const value = record.ccdMode;
  if (value === undefined) {
    return "disabled";
  }
  for (const mode of CCD_MODES) {
    if (mode === value) {
      return mode;
    }
  }
  throw new TypeError(
    `${path}.ccdMode is ${JSON.stringify(value)}, which is not a §31 CCD mode.`,
  );
}

/**
 * The reference `RigidBody` serializer (§23, §79) — copy this.
 *
 * The write side is `toDescriptor()` turned into JSON: the §37 descriptor is
 * exactly "what a solver needs to rebuild this body", so a field added to §23
 * appears here as a type error rather than as state that quietly stops being
 * saved. The two things the descriptor deliberately omits are added back
 * explicitly — §19's blend weights (engine state, never a solver's business)
 * and §32's sleep flag (diagnostics; see {@link RigidBodyDocument.sleeping}).
 *
 * The read side reconstructs the component: the deserializer builds it, and
 * `instantiateScene` attaches it. Re-registering the node with a world
 * (`world.addBody`) is a separate, explicit step — a document is a scene, not a
 * simulation (§79).
 */
export const RIGID_BODY_SERIALIZER: ComponentSerializer<RigidBody> = {
  serialize(body: RigidBody): JsonValue {
    const descriptor = body.toDescriptor();
    const document: Record<string, JsonValue> = {
      type: descriptor.type,
      linearVelocity: vector3Json(body.linearVelocity),
      angularVelocity: vector3Json(body.angularVelocity),
      linearDamping: descriptor.linearDamping ?? 0,
      angularDamping: descriptor.angularDamping ?? 0,
      gravityScale: descriptor.gravityScale ?? 1,
      ccdMode: descriptor.ccdMode ?? "disabled",
      physicsWeight: body.physicsWeight,
      animationWeight: body.animationWeight,
      sleeping: body.sleeping,
    };
    if (descriptor.mass !== undefined) {
      document.mass = descriptor.mass;
    }
    // Emitted exactly when §23's mass distribution was *authored*; emitting the
    // always-present default would make the density-derived mass unreachable
    // (see `RigidBody.centerOfMassAuthored`).
    if (descriptor.centerOfMass !== undefined) {
      document.centerOfMass = vector3Json(body.centerOfMass);
    }
    return document;
  },

  deserialize(data: JsonValue): RigidBody {
    const path = "rigid-body";
    const record = asJsonObject(data, path);
    const type = readBodyType(record, path);
    const linear = validateVector3Document(
      record.linearVelocity,
      `${path}.linearVelocity`,
    );
    const angular = validateVector3Document(
      record.angularVelocity,
      `${path}.angularVelocity`,
    );

    const body = new RigidBody({
      type,
      ...(record.mass === undefined
        ? {}
        : { mass: requireNumber(record, "mass", path) }),
      ...(record.centerOfMass === undefined
        ? {}
        : {
            centerOfMass: ((): Vector3 => {
              const center = validateVector3Document(
                record.centerOfMass,
                `${path}.centerOfMass`,
              );
              return new Vector3(center.x, center.y, center.z);
            })(),
          }),
      linearVelocity: new Vector3(linear.x, linear.y, linear.z),
      angularVelocity: new Vector3(angular.x, angular.y, angular.z),
      linearDamping: requireNumber(record, "linearDamping", path),
      angularDamping: requireNumber(record, "angularDamping", path),
      gravityScale: requireNumber(record, "gravityScale", path),
      ccdMode: readCCDMode(record, path),
    });
    body.physicsWeight = requireNumber(record, "physicsWeight", path);
    body.animationWeight = requireNumber(record, "animationWeight", path);
    // `sleeping` is deliberately not applied: see RigidBodyDocument.sleeping.
    return body;
  },
};

/**
 * Stand-in body handle for {@link Collider.toDescriptor}, which requires one
 * (§37: a collider always belongs to a body) and whose §24 fields never read it.
 *
 * A solver handle is world-registration state — the very thing a §79 document
 * must not carry — so the reference serializer mints a sentinel rather than
 * pretending to save one. `Collider`'s own `validateFor` does exactly this for
 * exactly this reason. The sentinel never leaves this module.
 */
const UNRESOLVED_BODY = {} as PhysicsBodyHandle;

/**
 * The document a {@link COLLIDER_SERIALIZER} writes.
 *
 * `friction`, `restitution`, and `density` are the **effective** §25 values, not
 * the optional authored fields — see the module header for what that costs.
 */
export interface ColliderDocument {
  /** §24 geometry, in {@link serializeCollisionShape}'s form. */
  readonly shape: JsonObject;
  /** §24 offset position in the body's local frame. */
  readonly offsetPosition: JsonObject;
  /** §24 offset rotation. */
  readonly offsetRotation: JsonObject;
  /** §25 effective Coulomb friction. */
  readonly friction: number;
  /** §25 effective restitution. */
  readonly restitution: number;
  /** §25 effective density, in kg/m³ (3D) or kg/m² (2D). */
  readonly density: number;
  /** §24 sensor flag — a sensor reports overlaps and exerts no force. */
  readonly sensor: boolean;
  /** §24 bit set of the groups this collider belongs to. */
  readonly collisionGroups: number;
  /** §24 bit set of the groups it collides with. */
  readonly collisionMask: number;
}

/**
 * The reference `Collider` serializer (§24, §25, §79) — copy this.
 *
 * Derived from `toDescriptor(body)` for the same reason the body's is: it is the
 * canonical record, and §25's fallback chain has already been resolved in it
 * exactly once. The body handle it demands is a sentinel — see
 * {@link UNRESOLVED_BODY}.
 *
 * The collider's *body* is not saved and does not need to be: `Collider.body`
 * resolves lazily from the scene graph (own node first, then ancestors), so
 * rebuilding the hierarchy rebuilds the association.
 */
export const COLLIDER_SERIALIZER: ComponentSerializer<Collider> = {
  serialize(collider: Collider): JsonValue {
    const descriptor = collider.toDescriptor(UNRESOLVED_BODY);
    return {
      shape: serializeCollisionShape(descriptor.shape),
      offsetPosition: vector3Json(collider.offset.position),
      offsetRotation: quaternionJson(collider.offset.rotation),
      friction: descriptor.friction ?? 0,
      restitution: descriptor.restitution ?? 0,
      density: descriptor.density ?? 0,
      sensor: descriptor.sensor ?? false,
      collisionGroups: descriptor.collisionGroups ?? 0,
      collisionMask: descriptor.collisionMask ?? 0,
    };
  },

  deserialize(data: JsonValue): Collider {
    const path = "collider";
    const record = asJsonObject(data, path);
    const offset = new Transform();
    const position = validateVector3Document(
      record.offsetPosition,
      `${path}.offsetPosition`,
    );
    offset.position.set(position.x, position.y, position.z);
    const rotation = validateQuaternionDocument(
      record.offsetRotation,
      `${path}.offsetRotation`,
    );
    offset.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);

    const sensor = record.sensor;
    if (typeof sensor !== "boolean") {
      throw new TypeError(`${path}.sensor must be a boolean.`);
    }
    return new Collider({
      shape: deserializeCollisionShape(record.shape, `${path}.shape`),
      offset,
      friction: requireNumber(record, "friction", path),
      restitution: requireNumber(record, "restitution", path),
      density: requireNumber(record, "density", path),
      sensor,
      collisionGroups: requireNumber(record, "collisionGroups", path),
      collisionMask: requireNumber(record, "collisionMask", path),
    });
  },
};

/**
 * The registry this suite saves and loads with: `@four/serialization`'s own
 * (`PoseTarget`) plus the two physics components (§79, plan P11-1).
 *
 * A fresh instance per call — registries are mutable and `register` refuses a
 * duplicate `typeName`, so a shared singleton would make two tests collide.
 */
export function createRoundtripSerializers(): ComponentSerializerRegistry {
  return createDefaultComponentSerializers()
    .register(RigidBody, RIGID_BODY_SERIALIZER)
    .register(Collider, COLLIDER_SERIALIZER);
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/** A node plus the two §6a components a physics body is made of. */
export interface BodyParts {
  readonly node: Node;
  readonly body: RigidBody;
  readonly collider: Collider;
}

/** Everything a case needs to drive, save, reload, or inspect the scenario. */
export interface RoundtripRig {
  /** The headless application (no renderer anywhere in the import graph). */
  readonly app: Application;
  /** The one §39 system, at `PRIORITY_PHYSICS_SOLVE`. */
  readonly system: PhysicsSystem;
  /** The one 2D Rapier world. */
  readonly world: PhysicsWorld;
  /** The node that roots the serialized subtree. */
  readonly root: Node;
  /** Every registered body's node, in registration order (§33). */
  readonly nodes: readonly Node[];
  /** §29 trigger events the sensor dispatched, in dispatch order. */
  readonly triggers: string[];
  /** One fixed step of this rig's application. */
  stepOnce(): void;
  /** Disposes the world and then the application (§83). */
  dispose(): void;
}

/** Subscribes to the sensor's §29 trigger events, appending their names. */
function watchSensor(collider: Collider, log: string[]): void {
  collider.on("triggerenter", () => log.push("triggerenter"));
  collider.on("triggerexit", () => log.push("triggerexit"));
}

/**
 * Builds a headless application with one {@link PhysicsSystem} and one 2D Rapier
 * world, and returns the empty rig; callers populate it.
 *
 * `poseInterpolation` is **off**: §43 pose capture is a render concern and never
 * feeds back into physics state (§10, §42), so every number this suite compares
 * is the solver's alone.
 */
async function createEmptyRig(): Promise<{
  app: Application;
  system: PhysicsSystem;
  world: PhysicsWorld;
}> {
  const app = new Application({ fixedTimeStep: DT, poseInterpolation: false });
  const system = new PhysicsSystem();
  app.systems.register(system);
  await app.initialize();

  const world = new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
  });
  await world.initialize();
  system.track(world);
  return { app, system, world };
}

/** Registers one body under `root` and with `world`, and returns its parts. */
function addBody(
  world: PhysicsWorld,
  root: Group,
  name: string,
  type: "dynamic" | "static",
  shape: CollisionShape,
  options: {
    x: number;
    y: number;
    mass?: number;
    restitution?: number;
    friction?: number;
    sensor?: boolean;
    velocityX?: number;
  },
): BodyParts {
  const node = new Group();
  node.name = name;
  node.transform.position.set(options.x, options.y, 0);
  node.transformAuthority = type === "dynamic" ? "physics" : "manual";

  const body = new RigidBody({
    type,
    ...(options.mass === undefined ? {} : { mass: options.mass }),
    ...(options.velocityX === undefined
      ? {}
      : { linearVelocity: new Vector3(options.velocityX, 0, 0) }),
  });
  node.addComponent(body);
  const collider = new Collider({
    shape,
    ...(options.restitution === undefined
      ? {}
      : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction }),
    ...(options.sensor === undefined ? {} : { sensor: options.sensor }),
  });
  node.addComponent(collider);

  root.add(node);
  world.addBody(node);
  return { node, body, collider };
}

/**
 * Builds the scenario from scratch: the ground, the sensor volume, and
 * {@link BALLS}, in that registration order (§33's checksum order).
 *
 * Awaited twice over — `Application.initialize` (§45) and
 * `PhysicsWorld.initialize` (where Rapier's wasm image loads, cached per
 * process).
 */
export async function createRoundtripRig(): Promise<RoundtripRig> {
  const { app, system, world } = await createEmptyRig();
  const root = new Group();
  root.name = SIM_ROOT_NAME;
  app.scene.add(root);
  const nodes: Node[] = [];
  const triggers: string[] = [];

  nodes.push(
    addBody(
      world,
      root,
      "ground",
      "static",
      {
        type: "rectangle",
        halfExtents: new Vector2(GROUND.halfWidth, GROUND.halfHeight),
      },
      { x: 0, y: GROUND.centerY, friction: 0.8 },
    ).node,
  );

  const sensor = addBody(
    world,
    root,
    "sensor",
    "static",
    {
      type: "rectangle",
      halfExtents: new Vector2(SENSOR.halfWidth, SENSOR.halfHeight),
    },
    { x: SENSOR.centerX, y: SENSOR.centerY, sensor: true },
  );
  watchSensor(sensor.collider, triggers);
  nodes.push(sensor.node);

  for (const ball of BALLS) {
    nodes.push(
      addBody(
        world,
        root,
        ball.name,
        "dynamic",
        { type: "circle", radius: ball.radius },
        {
          x: ball.x,
          y: ball.y,
          ...(ball.mass === undefined ? {} : { mass: ball.mass }),
          restitution: ball.restitution,
          friction: ball.friction,
          velocityX: ball.velocityX,
        },
      ).node,
    );
  }

  app.start();
  return {
    app,
    system,
    world,
    root,
    nodes,
    triggers,
    stepOnce(): void {
      app.step(DT);
    },
    dispose(): void {
      world.dispose();
      app.dispose();
    },
  };
}

/**
 * Every node of `root`'s subtree that carries a `RigidBody`, in depth-first
 * insertion order (§6) — which is the order {@link createRoundtripRig}
 * registered them in, and therefore the §33 checksum order a reload must
 * reproduce.
 *
 * The one piece of glue a §79 document cannot carry: which nodes are bodies is
 * visible from the document, but *registering* them is an act on a world, and
 * §33's body ids are assigned by that act.
 */
export function collectBodyNodes(root: Node, out: Node[] = []): Node[] {
  if (root.getComponent(RigidBody) !== undefined) {
    out.push(root);
  }
  for (const child of root.children) {
    collectBodyNodes(child, out);
  }
  return out;
}

/**
 * Rebuilds a rig from a §79 document: a fresh application, a fresh 2D Rapier
 * world, the instantiated subtree, and one `world.addBody` per body node.
 *
 * `instantiateScene`'s result is the caller's — this function takes it rather
 * than a document, so a test can inspect the reloaded tree before it is
 * registered.
 *
 * The sensor is re-watched by node name, which is the honest reference pattern:
 * listeners are application code and a document carries none (§79), so an
 * application that reloads a scene re-attaches its own behaviour by whatever
 * stable identity it authored — here, `Node.name`.
 */
export async function loadRoundtripRig(root: Node): Promise<RoundtripRig> {
  const rig = await createEmptyRig();
  rig.app.scene.add(root);

  const nodes = collectBodyNodes(root);
  const triggers: string[] = [];
  for (const node of nodes) {
    rig.world.addBody(node);
    if (node.name === "sensor") {
      const collider = node.getComponent(Collider);
      if (collider !== undefined) {
        watchSensor(collider, triggers);
      }
    }
  }

  rig.app.start();
  return {
    app: rig.app,
    system: rig.system,
    world: rig.world,
    root,
    nodes,
    triggers,
    stepOnce(): void {
      rig.app.step(DT);
    },
    dispose(): void {
      rig.world.dispose();
      rig.app.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Runs and readbacks
// ---------------------------------------------------------------------------

/**
 * Runs `steps` fixed steps and returns `world.checksum()` after each (§33).
 *
 * One checksum per step, in step order, which is the sequence two runs must
 * agree on element by element to be called identical.
 */
export function stepChecksums(rig: RoundtripRig, steps: number): number[] {
  const digests: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    rig.stepOnce();
    digests.push(rig.world.checksum());
  }
  return digests;
}

/** One body's §33-relevant state, read back through the public API. */
export interface BodyState {
  /** `Node.name`, the stable identity this suite matches bodies by. */
  readonly name: string;
  /** World position (§42: written by the solver under `"physics"` authority). */
  readonly position: Vector3;
  /** World rotation. */
  readonly rotation: Quaternion;
  /** §23 linear velocity, refreshed from the solver every step. */
  readonly linearVelocity: Vector3;
  /** §23 angular velocity. */
  readonly angularVelocity: Vector3;
  /** §23 mass in kilograms, or `undefined` when the body has none. */
  readonly mass: number | undefined;
  /** §32 sleep flag. */
  readonly sleeping: boolean;
}

/**
 * Reads every registered body's §33-relevant state, in registration order.
 *
 * Copies, not references: the vectors are the components' live state, and a
 * caller comparing two runs needs the values as they were at the call.
 */
export function readBodyStates(rig: RoundtripRig): BodyState[] {
  const states: BodyState[] = [];
  for (const node of rig.nodes) {
    const body = node.getComponent(RigidBody);
    if (body === undefined) {
      continue;
    }
    states.push({
      name: node.name,
      position: new Vector3().copy(node.transform.position),
      rotation: new Quaternion().copy(node.transform.rotation),
      linearVelocity: new Vector3().copy(body.linearVelocity),
      angularVelocity: new Vector3().copy(body.angularVelocity),
      mass: body.mass,
      sleeping: body.sleeping,
    });
  }
  return states;
}

/**
 * The largest absolute component-wise difference between two state readbacks,
 * over positions and linear velocities.
 *
 * Bodies are matched by index — both runs registered the same scene in the same
 * order — and a length mismatch is a failure the caller should assert on before
 * calling this.
 */
export function maxStateDrift(
  a: readonly BodyState[],
  b: readonly BodyState[],
): { position: number; velocity: number } {
  let position = 0;
  let velocity = 0;
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i += 1) {
    position = Math.max(
      position,
      Math.abs(a[i].position.x - b[i].position.x),
      Math.abs(a[i].position.y - b[i].position.y),
      Math.abs(a[i].position.z - b[i].position.z),
    );
    velocity = Math.max(
      velocity,
      Math.abs(a[i].linearVelocity.x - b[i].linearVelocity.x),
      Math.abs(a[i].linearVelocity.y - b[i].linearVelocity.y),
      Math.abs(a[i].linearVelocity.z - b[i].linearVelocity.z),
    );
  }
  return { position, velocity };
}

/**
 * The 0-based index of the first element two checksum streams disagree on, or
 * `-1` when they are identical over their common length.
 */
export function firstDivergence(
  a: readonly number[],
  b: readonly number[],
): number {
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return -1;
}
