/**
 * The §79 serializers for this package's two components — `RigidBody` (§23) and
 * `Collider` (§24) — closing the `PH-17` remainder (2026-08-06).
 *
 * §6a says components "serialize under registered type names (§79)", and §79's
 * registry is `@four/serialization`'s — which may depend on `core`, `math`, and
 * `scene` only (plan §3.1) and so can never name `RigidBody` or `Collider`.
 * Until this module landed, the only working pair lived in a **test helper**
 * (`tests/integration/helpers/roundtrip-scenarios.ts`, WP-11.5) and every
 * application that wanted to save a physics scene had to copy it. That is what
 * this module ships instead; the helper now registers *these* and holds no
 * serializer logic of its own.
 *
 * ## Why the type is declared elsewhere and imported
 *
 * Nothing below imports `@four/serialization`. {@link ComponentSerializerShape}
 * — `@four/motion`'s structural transcription of `ComponentSerializer` — is
 * imported instead, over the `physics → motion` edge the §3.1 matrix already
 * grants this package. So `registry.register(RigidBody, RIGID_BODY_SERIALIZER)`
 * type-checks with no cast and **no new edge**, exactly as
 * `MOTION_COMPONENT_SERIALIZER` does, and there is one transcription in the
 * repository rather than two that can drift apart from each other as well as
 * from the original.
 *
 * The honest cost is the same one `@four/motion`'s header states: **nothing
 * type-checks the transcription against `ComponentSerializer` itself.** A change
 * to that interface will not fail this package's build; it will fail
 * `tests/serializers.test.ts`, which asserts assignability against a transcribed
 * mirror of it, and then `tests/integration/scene-roundtrip.test.ts`, which
 * registers these two into the real registry.
 *
 * ## What a document carries: the descriptor, not the solve
 *
 * Each payload is the component's **constructor descriptor in JSON** —
 * {@link RigidBodyDescriptor} for the body, `ColliderOptions` (§37's collider
 * descriptor minus the solver handle) for the collider — plus, for the body, the
 * three pieces of state §37 deliberately keeps out of a descriptor. Deriving the
 * document from the descriptor is what keeps the two from drifting: a field
 * added to §23 or §24 shows up here as a compile error rather than as state that
 * quietly stops being saved.
 *
 * | state | round-trips? |
 * | --- | --- |
 * | §22 body type; §23 damping, gravity scale; §31 CCD mode and prediction distance | yes |
 * | §23 linear/angular velocity (solver-refreshed each step, §42) | yes — re-seeded through the descriptor |
 * | §23 mass, centre of mass, inertia tensor | yes, **only when authored** (see below) |
 * | §37 initial pose, when a descriptor carried one | yes — it outranks the node transform at `addBody` |
 * | §19 physics/animation blend weights | yes (engine state; absent from the descriptor by design) |
 * | §24 shape, offset, sensor flag, groups, mask | yes |
 * | §25 friction / restitution / density | yes, **as authored** — absent stays absent |
 * | §25 `PhysicsMaterial` | yes, **by value**; the sharing between colliders does not |
 * | §32 `sleeping` | recorded as diagnostics, never applied — a reloaded body starts awake |
 * | §26 queued forces and impulses | **no** — a command buffer is a request in flight, not scene state |
 * | solver handles, body ids, contact manifolds, warm-start impulses | **no** — that is §34's snapshot, not §79's document |
 *
 * Four of those deserve their own paragraph.
 *
 * **Authoredness is preserved, not flattened.** §23 derives mass, centre of
 * mass, and inertia from collider density and geometry whenever they are not
 * authored, and naming any part of that triple means "do not derive it". So the
 * document carries `mass` exactly when {@link RigidBody.massAuthored} holds and
 * `centerOfMass` exactly when {@link RigidBody.centerOfMassAuthored} does —
 * which is precisely `toDescriptor()`'s own rule, reused rather than restated. A
 * body whose mass a solver derived at registration therefore reloads still
 * asking the next solver to derive it, and a reloaded body whose collider is
 * later scaled follows it exactly as the saved one did.
 *
 * **§25's fallback chain survives as a chain.** `Collider.toDescriptor` resolves
 * `effectiveFriction` / `effectiveRestitution` / `effectiveDensity` for the
 * adapter, and writing *those* into the document would pin today's defaults into
 * every file — a collider that named no friction would reload with
 * {@link DEFAULT_FRICTION} authored on it, and a later change to that constant
 * would move the *saved* scenes but not the reloaded ones. The document carries
 * the optional fields as authored, plus the material by value, so the same chain
 * resolves to the same numbers after a reload (the WP-11.5 reference serializer
 * wrote the effective values; this is the one behaviour that changed when it was
 * replaced, and it is why).
 *
 * **A material round-trips by value, not by identity.** §25's material is
 * shareable data, and two colliders pointing at one `PhysicsMaterial` reload
 * with one material each. Values are identical, so no simulation changes;
 * `material.friction = 0.1` after the reload reaches one collider instead of
 * both. Sharing is a §79 *resource* relationship (documents reference resources
 * by logical key and store none of them inline), and a resource table is not
 * something a component serializer may invent on its own.
 *
 * **Sleep is not restored (§32, §34).** `RigidBody.sleeping` is read-only
 * because only a solver report may change it, and §79 keeps simulation state out
 * of a scene document ("physics state, animation state, and replay data must be
 * separate optional sections"). It is written as diagnostics — so a saved file
 * says whether the body was simulating — and deliberately ignored on load.
 *
 * ## How strict the reader is, and where the line falls
 *
 * `@four/motion`'s reader is deliberately **total**: a missing field restores
 * its documented default rather than refusing the scene. That is right for a
 * number whose absence has a meaning — a missing damping rate *is* zero damping.
 * It is wrong for a **tag**, because there is no defensible default for one: a
 * body type guessed as `"dynamic"` drops the ground out of the world, a CCD mode
 * guessed as `"disabled"` restores tunnelling, and a collision shape cannot be
 * guessed at all. So the rule here is:
 *
 * - **numbers, vectors, booleans, and the quaternion** — absent or malformed
 *   restores the §23/§24/§25 default, exactly as `@four/motion` does;
 * - **`type`, `ccdMode`, and `shape.type`** — absent or unrecognized throws a
 *   `FourError` naming the field and the section, because loading half a
 *   simulation is worse than not loading it;
 * - **`inertiaTensor`** — absent is a statement ("derive it"), so it restores a
 *   body that derives; *present and unreadable* throws (2026-08-07), because
 *   the alternative is to silently change the body's mass mode. See
 *   {@link readMatrix3}.
 *
 * ## Conventions (§7a, §7b)
 *
 * Y-up in both dimensions, radians, seconds. Vectors are written as `{x, y, z}`
 * records and quaternions as `{x, y, z, w}` — spelled fields rather than
 * positional arrays, so a document stays readable and a reader cannot transpose
 * two components silently. The inertia tensor is the one exception: it is
 * `Matrix3`'s nine **column-major** elements as a plain array, which is the
 * layout {@link Matrix3.fromArray} reads back. Numbers are written as they are:
 * a non-finite one is refused by the document validator naming its field, rather
 * than being quietly written as the `null` `JSON.stringify` would produce.
 */

import {
  SPACE_MODES,
  FourError,
  type JsonValue,
  type SpaceMode,
} from "@four/core";
import { Matrix3, Quaternion, Vector2, Vector3 } from "@four/math";
import type { ComponentSerializerShape } from "@four/motion";
import { Transform } from "@four/scene";

import { Collider, type ColliderOptions } from "./collider.js";
import type { RigidBodyDescriptor } from "./descriptors.js";
import {
  DEFAULT_DENSITY,
  DEFAULT_FRICTION,
  DEFAULT_RESTITUTION,
  PhysicsMaterial,
  type PhysicsMaterialOptions,
} from "./material.js";
import { ALL_COLLISION_GROUPS } from "./queries.js";
import { RigidBody } from "./rigid-body.js";
import type { CollisionShape } from "./shapes.js";
import { BODY_TYPES, CCD_MODES, DEFAULT_CCD_MODE } from "./types.js";
import type { BodyType, CCDMode } from "./types.js";

/**
 * Appendix A / §23: gravity applies unscaled unless a body says otherwise.
 *
 * Restated here rather than imported because `rigid-body.ts` keeps its copy
 * module-private; the two are checked against each other by the round-trip test,
 * which asserts that a default-constructed body reloads with its defaults.
 */
const DEFAULT_GRAVITY_SCALE = 1;

/** §19: a body nobody has blended is fully physical (`rigid-body.ts`). */
const DEFAULT_PHYSICS_WEIGHT = 1;

/** §19: nothing is animated into the solve until asked. */
const DEFAULT_ANIMATION_WEIGHT = 0;

/** Every §79 failure this module raises is a bad document, i.e. §85 input. */
const DOCUMENT_ERROR_CODE = "INVALID_APPLICATION_STATE";

// ---------------------------------------------------------------------------
// JSON readers and writers (§7b)
// ---------------------------------------------------------------------------

/** A JSON object, read defensively: anything else is treated as empty. */
function record(value: JsonValue | undefined): {
  readonly [key: string]: JsonValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })
    : {};
}

/** Reads a finite number, or `fallback` for anything else. */
function readNumber(value: JsonValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Reads a JSON array, or an empty one for anything else. */
function readArray(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? (value as readonly JsonValue[]) : [];
}

/** Reads a boolean, or `fallback` for anything else. */
function readBoolean(value: JsonValue | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** A `Vector3` as the three numbers a document carries. */
function vector3Json(v: Vector3): JsonValue {
  return { x: v.x, y: v.y, z: v.z };
}

/** A `Vector2` — a §24 2D half-extent or polygon vertex — as two numbers. */
function vector2Json(v: Vector2): JsonValue {
  return { x: v.x, y: v.y };
}

/** A `Quaternion` as the four numbers a document carries (§7a). */
function quaternionJson(q: Quaternion): JsonValue {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** The nine **column-major** elements {@link Matrix3.fromArray} reads back. */
function matrix3Json(m: Matrix3): JsonValue {
  return [...m.elements];
}

/** Reads a vector payload into `out`, defaulting every absent component to 0. */
function readVector3(value: JsonValue | undefined, out: Vector3): Vector3 {
  const source = record(value);
  return out.set(
    readNumber(source.x, 0),
    readNumber(source.y, 0),
    readNumber(source.z, 0),
  );
}

/** Reads a `{x, y}` pair into a fresh `Vector2`, defaulting each to 0. */
function readVector2(value: JsonValue | undefined): Vector2 {
  const source = record(value);
  return new Vector2(readNumber(source.x, 0), readNumber(source.y, 0));
}

/**
 * Reads a quaternion into `out`, defaulting to the identity rotation.
 *
 * Component-wise defaults would let a payload carrying only `{x: 1}` restore the
 * non-unit `(1, 0, 0, 0)`; the identity is the only rotation a partial payload
 * can honestly mean.
 */
function readQuaternion(value: JsonValue | undefined, out: Quaternion): void {
  const source = record(value);
  out.set(
    readNumber(source.x, 0),
    readNumber(source.y, 0),
    readNumber(source.z, 0),
    readNumber(source.w, 1),
  );
}

/** Rejects a document field that carries no restorable value (§79, §85). */
function fail(message: string, context: Record<string, JsonValue>): never {
  throw new FourError(DOCUMENT_ERROR_CODE, message, { context });
}

/** Narrows a document value to a §22 body type, or refuses the load. */
function readBodyType(value: JsonValue | undefined): BodyType {
  for (const type of BODY_TYPES) {
    if (type === value) {
      return type;
    }
  }
  return fail(
    `A rigid-body document's "type" is ${JSON.stringify(value ?? null)}, which is not one of §22's body types (${BODY_TYPES.join(", ")}). A body type has no defensible default — guessing one would change what is simulated — so the document is refused (§22, §79).`,
    { field: "type", value: value ?? null },
  );
}

/**
 * Narrows a document value to a §8 space mode (PH-12).
 *
 * A **defaulted** field, unlike `type` and `ccdMode` above: absent or
 * unrecognized restores `"world"`, because `"world"` is the frame every world
 * can honour and is what a document written before the field existed means. The
 * asymmetry with the two refused tags is deliberate and is the module's own
 * rule — a guessed body type drops the ground out of the world, whereas a
 * guessed space is the one value that can never turn a refusal into silent
 * acceptance.
 */
function isSpaceMode(value: JsonValue | undefined): value is SpaceMode {
  for (const mode of SPACE_MODES) {
    if (mode === value) {
      return true;
    }
  }
  return false;
}

/**
 * Narrows a document value to a §31 CCD mode.
 *
 * Absent means {@link DEFAULT_CCD_MODE}, which is what a document written before
 * the field existed means and what Appendix A gives a body that never mentioned
 * CCD. An *unrecognized* mode is refused: it is a mode this build cannot honour,
 * and silently falling back to `"disabled"` would restore the tunnelling the
 * author turned off.
 */
function readCCDMode(value: JsonValue | undefined): CCDMode {
  if (value === undefined) {
    return DEFAULT_CCD_MODE;
  }
  for (const mode of CCD_MODES) {
    if (mode === value) {
      return mode;
    }
  }
  return fail(
    `A rigid-body document's "ccdMode" is ${JSON.stringify(value)}, which is not one of §31's modes (${CCD_MODES.join(", ")}) (§31, §79).`,
    { field: "ccdMode", value },
  );
}

/**
 * Reads nine column-major elements into a fresh `Matrix3`; `undefined` only
 * when the field is **absent**.
 *
 * Absent means "derive the inertia from the colliders" (§23) — a statement the
 * document is entitled to make. Present-but-unreadable means nothing, and it is
 * refused (2026-08-07): until then a malformed tensor was silently treated as
 * an absent one, which flips the body's mass mode from authored to derived on
 * load. That changes what the solver simulates and shows up as a checksum
 * divergence with nothing anywhere to point at — the failure mode this module's
 * "a tag has no defensible default" rule exists to prevent, and an authored mass
 * distribution is as much of a tag as `type` is.
 */
function readMatrix3(value: JsonValue | undefined): Matrix3 | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== 9) {
    return fail(
      `A rigid-body document's "inertiaTensor" is present but is not nine column-major elements (§23, §79); silently deriving the inertia instead would change what is simulated.`,
      { field: "inertiaTensor", value },
    );
  }
  const elements = value as readonly JsonValue[];
  const values: number[] = [];
  for (const element of elements) {
    if (typeof element !== "number" || !Number.isFinite(element)) {
      return fail(
        `A rigid-body document's "inertiaTensor" carries ${JSON.stringify(element)}, which is not a finite number (§23, §79).`,
        { field: "inertiaTensor", value: element },
      );
    }
    values.push(element);
  }
  return new Matrix3().fromArray(values);
}

// ---------------------------------------------------------------------------
// §24 collision shapes
// ---------------------------------------------------------------------------

/**
 * A §24 collision shape as JSON — every shape this build ships, discriminated by
 * the same `type` tag the union uses.
 *
 * Written as an exhaustive `switch` so that adding a shape to
 * {@link CollisionShape} fails to compile here (`shape` narrows to `never` in
 * the default branch) instead of silently saving it as an unreadable `{}`. The
 * default branch is unreachable from TypeScript and exists for JavaScript
 * callers and for a shape assembled from untyped data.
 */
export function serializeCollisionShape(shape: CollisionShape): JsonValue {
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
    case "cylinder":
    case "cone":
      return {
        type: shape.type,
        radius: shape.radius,
        halfHeight: shape.halfHeight,
      };
    case "polygon":
    case "polyline":
    case "chain":
      return {
        type: shape.type,
        vertices: shape.vertices.map((vertex) => vector2Json(vertex)),
      };
    case "convex-hull":
      return {
        type: shape.type,
        points: shape.points.map((point) => vector3Json(point)),
      };
    case "triangle-mesh":
      return {
        type: shape.type,
        vertices: shape.vertices.map((vertex) => vector3Json(vertex)),
        indices: [...shape.indices],
      };
    case "height-field":
      return {
        type: shape.type,
        rows: shape.rows,
        columns: shape.columns,
        heights: [...shape.heights],
        scale: vector3Json(shape.scale),
      };
    default: {
      const unreachable: never = shape;
      throw new FourError(
        "NOT_IMPLEMENTED",
        `No §79 document form exists for collision shape ${JSON.stringify(unreachable)} (§24).`,
        { context: { shape: JSON.stringify(unreachable) } },
      );
    }
  }
}

/**
 * Rebuilds a §24 collision shape from {@link serializeCollisionShape}'s form.
 *
 * Every parameter defaults to `0` when it is absent or malformed, which
 * `validateCollisionShape` then rejects at the `Collider` constructor — so a
 * damaged document fails with §85's own message about the shape, naming the
 * radius or the extent, rather than with a second message invented here. The
 * *tag* is the exception: an unknown one is refused directly, because there is
 * nothing left to construct.
 */
export function deserializeCollisionShape(
  value: JsonValue | undefined,
): CollisionShape {
  const source = record(value);
  const type = source.type;
  switch (type) {
    case "circle":
      return { type: "circle", radius: readNumber(source.radius, 0) };
    case "sphere":
      return { type: "sphere", radius: readNumber(source.radius, 0) };
    case "rectangle":
      return {
        type: "rectangle",
        halfExtents: readVector2(source.halfExtents),
      };
    case "box":
      return {
        type: "box",
        halfExtents: readVector3(source.halfExtents, new Vector3()),
      };
    case "capsule":
      return {
        type: "capsule",
        radius: readNumber(source.radius, 0),
        halfHeight: readNumber(source.halfHeight, 0),
      };
    case "cylinder":
      return {
        type: "cylinder",
        radius: readNumber(source.radius, 0),
        halfHeight: readNumber(source.halfHeight, 0),
      };
    case "cone":
      return {
        type: "cone",
        radius: readNumber(source.radius, 0),
        halfHeight: readNumber(source.halfHeight, 0),
      };
    case "polygon":
    case "polyline":
    case "chain":
      return {
        type,
        vertices: readArray(source.vertices).map((vertex) =>
          readVector2(vertex),
        ),
      };
    case "convex-hull":
      return {
        type: "convex-hull",
        points: readArray(source.points).map((point) =>
          readVector3(point, new Vector3()),
        ),
      };
    case "triangle-mesh":
      return {
        type: "triangle-mesh",
        vertices: readArray(source.vertices).map((vertex) =>
          readVector3(vertex, new Vector3()),
        ),
        /*
         * `NaN` rather than 0 for a malformed entry: 0 is a legal index, so
         * defaulting to it would turn a damaged document into a mesh that
         * builds and simulates the wrong triangle. `validateCollisionShape`
         * rejects `NaN` by name (§85).
         */
        indices: readArray(source.indices).map((index) =>
          readNumber(index, Number.NaN),
        ),
      };
    case "height-field":
      return {
        type: "height-field",
        rows: readNumber(source.rows, 0),
        columns: readNumber(source.columns, 0),
        heights: readArray(source.heights).map((height) =>
          readNumber(height, Number.NaN),
        ),
        scale: readVector3(source.scale, new Vector3()),
      };
    default:
      return fail(
        `A collider document's "shape.type" is ${JSON.stringify(type ?? null)}, which is not a §24 collision shape this build ships (plan P5-6). A shape has no default, so the document is refused (§24, §79).`,
        { field: "shape.type", value: type ?? null },
      );
  }
}

// ---------------------------------------------------------------------------
// RigidBody (§23)
// ---------------------------------------------------------------------------

/**
 * The document {@link RIGID_BODY_SERIALIZER} writes — named so a reader can see
 * the shape without decoding the two functions below.
 *
 * The optional members are exactly the state §23 lets a body leave to the
 * solver, plus the initial pose §37 lets a descriptor carry; every one of them
 * is written when, and only when, `RigidBody.toDescriptor()` emits it. See the
 * module header for the authoredness rule that makes that the interesting
 * property of this record.
 */
export interface RigidBodyDocument {
  /** §22 simulation model. Required: there is no default body type. */
  readonly type: BodyType;
  /** Kilograms (§23), present only when the mass was **authored**. */
  readonly mass?: number;
  /** Local-frame centre of mass (§23), present only when authored. */
  readonly centerOfMass?: JsonValue;
  /** Nine column-major elements (§23), present only when authored. */
  readonly inertiaTensor?: JsonValue;
  /** The initial world position a descriptor carried (§37), when it did. */
  readonly position?: JsonValue;
  /** The initial world rotation a descriptor carried (§37), when it did. */
  readonly rotation?: JsonValue;
  /** Metres per second (§23), refreshed from the solver every step. */
  readonly linearVelocity: JsonValue;
  /** Radians per second (§23); only Z is meaningful in a `"2d"` world (§21). */
  readonly angularVelocity: JsonValue;
  /** §23 linear damping coefficient. */
  readonly linearDamping: number;
  /** §23 angular damping coefficient. */
  readonly angularDamping: number;
  /** §23 multiplier on world gravity. */
  readonly gravityScale: number;
  /** §31 continuous-collision method. */
  readonly ccdMode: CCDMode;
  /** §31 speculative prediction distance, when the body authored one. */
  readonly ccdPredictionDistance?: number;
  /**
   * The §8 space the body is solved in, present only when it is **not**
   * `"world"` (PH-12).
   *
   * Absent is the default, so every document written before PH-12 reloads
   * unchanged and a `"world"` body still writes no field. It round-trips even
   * though `PhysicsWorld.addBody` refuses every non-`"world"` value: dropping
   * it would turn a body a world refuses into one it silently accepts after a
   * save-and-reload, which is the class of lie §79's authoredness rules exist
   * to prevent.
   */
  readonly space?: SpaceMode;
  /** §19 solver share of a `"blended"` pose. */
  readonly physicsWeight: number;
  /** §19 animated share of a `"blended"` pose. */
  readonly animationWeight: number;
  /**
   * §32 sleep state **as diagnostics only** — written by this serializer,
   * never read by it.
   *
   * Recorded so a saved document says whether the body was simulating, and
   * deliberately *not* applied on load: sleep is solver state (§34), and
   * `RigidBody.sleeping` is read-only precisely because only a solver report may
   * change it (§23, §32). It earns its bytes when a §79 document is read beside
   * a §34 snapshot of the same moment — "this body reloaded awake because it was
   * asleep when saved" is otherwise unanswerable from the document alone.
   *
   * **Optional on the read side** (decision, 2026-08-07). The write side always
   * emits it, so every document this build produces carries it and no existing
   * file's bytes moved; the type says `?` because `deserialize` ignores the
   * field entirely, so a hand-written or foreign document that omits it is
   * perfectly valid and must not be described as malformed. The alternative
   * considered — dropping the field — would have changed the bytes of every
   * rigid-body document to save nothing that anyone reads a document for.
   */
  readonly sleeping?: boolean;
}

/**
 * The §79 serializer for {@link RigidBody} (§23, §26, §31, PH-17).
 *
 * ```ts
 * import { Collider, RigidBody, RIGID_BODY_SERIALIZER, COLLIDER_SERIALIZER } from "@four/physics";
 *
 * const registry = createDefaultComponentSerializers()
 *   .register(RigidBody, RIGID_BODY_SERIALIZER)
 *   .register(Collider, COLLIDER_SERIALIZER);
 * ```
 *
 * or, from an application, one call: `registerSceneNodeTypes()` in the umbrella
 * `four` package registers both alongside the UI node types.
 *
 * Registering the reloaded node with a world (`world.addBody(node)`) is a
 * separate, explicit step. A document is a scene, not a simulation (§79): body
 * ids, contact manifolds, and warm-start impulses are assigned by the act of
 * registering, and reproducing a solve across a save needs a §34 snapshot
 * beside the §79 document.
 */
export const RIGID_BODY_SERIALIZER: ComponentSerializerShape<RigidBody> = {
  serialize(body: RigidBody): JsonValue {
    // The descriptor decides *presence* for mass, centre of mass, and the
    // prediction distance — it is where §23's authoredness rule and §31's
    // "speculative only" rule already live, and restating either here is how
    // the two would drift apart (see the module header).
    const descriptor = body.toDescriptor();
    const document: Record<string, JsonValue> = {
      type: descriptor.type,
      linearVelocity: vector3Json(body.linearVelocity),
      angularVelocity: vector3Json(body.angularVelocity),
      linearDamping: body.linearDamping,
      angularDamping: body.angularDamping,
      gravityScale: body.gravityScale,
      ccdMode: body.ccdMode,
      physicsWeight: body.physicsWeight,
      animationWeight: body.animationWeight,
      sleeping: body.sleeping,
    };
    if (descriptor.mass !== undefined) {
      document.mass = descriptor.mass;
    }
    if (descriptor.centerOfMass !== undefined) {
      document.centerOfMass = vector3Json(body.centerOfMass);
    }
    if (descriptor.ccdPredictionDistance !== undefined) {
      document.ccdPredictionDistance = descriptor.ccdPredictionDistance;
    }
    // The descriptor decides presence here too: `toDescriptor` emits `space`
    // exactly when it is not `"world"`.
    if (descriptor.space !== undefined) {
      document.space = descriptor.space;
    }
    if (body.inertiaTensor !== undefined) {
      document.inertiaTensor = matrix3Json(body.inertiaTensor);
    }
    if (body.initialPosition !== undefined) {
      document.position = vector3Json(body.initialPosition);
    }
    if (body.initialRotation !== undefined) {
      document.rotation = quaternionJson(body.initialRotation);
    }
    return document;
  },

  deserialize(data: JsonValue): RigidBody {
    const source = record(data);
    const descriptor: RigidBodyDescriptor = {
      type: readBodyType(source.type),
      linearVelocity: readVector3(source.linearVelocity, new Vector3()),
      angularVelocity: readVector3(source.angularVelocity, new Vector3()),
      linearDamping: readNumber(source.linearDamping, 0),
      angularDamping: readNumber(source.angularDamping, 0),
      gravityScale: readNumber(source.gravityScale, DEFAULT_GRAVITY_SCALE),
      ccdMode: readCCDMode(source.ccdMode),
    };
    // Absent means "derive it" (§23, §25) — the whole point of the authoredness
    // rule the write side honours, so an absent field must stay absent here.
    if (typeof source.mass === "number") {
      descriptor.mass = source.mass;
    }
    if (source.centerOfMass !== undefined) {
      descriptor.centerOfMass = readVector3(source.centerOfMass, new Vector3());
    }
    const inertiaTensor = readMatrix3(source.inertiaTensor);
    if (inertiaTensor !== undefined) {
      descriptor.inertiaTensor = inertiaTensor;
    }
    if (typeof source.ccdPredictionDistance === "number") {
      descriptor.ccdPredictionDistance = source.ccdPredictionDistance;
    }
    // A defaulted field, so a corrupt or unknown value restores the default
    // rather than refusing the scene (the module's read-side rule): `"world"`
    // is a frame every world can honour, so the reader can never turn a bad
    // document into a body that is silently somewhere else.
    if (isSpaceMode(source.space)) {
      descriptor.space = source.space;
    }
    if (source.position !== undefined) {
      descriptor.position = readVector3(source.position, new Vector3());
    }
    if (source.rotation !== undefined) {
      const rotation = new Quaternion();
      readQuaternion(source.rotation, rotation);
      descriptor.rotation = rotation;
    }

    const body = new RigidBody(descriptor);
    body.physicsWeight = readNumber(
      source.physicsWeight,
      DEFAULT_PHYSICS_WEIGHT,
    );
    body.animationWeight = readNumber(
      source.animationWeight,
      DEFAULT_ANIMATION_WEIGHT,
    );
    // `sleeping` is deliberately not applied — see RigidBodyDocument.sleeping.
    return body;
  },
};

// ---------------------------------------------------------------------------
// Collider (§24) and its §25 material
// ---------------------------------------------------------------------------

/** A §25 {@link PhysicsMaterial} as JSON; see the module header on identity. */
export interface PhysicsMaterialDocument {
  /** Coulomb friction coefficient (§25). */
  readonly friction: number;
  /** Restitution (§25). */
  readonly restitution: number;
  /** Mass per unit volume (§25). */
  readonly density: number;
  /** Rolling resistance (§25), present only when the material specified one. */
  readonly rollingFriction?: number;
  /** Spin resistance (§25), present only when the material specified one. */
  readonly spinningFriction?: number;
}

/**
 * The document {@link COLLIDER_SERIALIZER} writes.
 *
 * `friction`, `restitution`, and `density` are the **authored** §24 fields, not
 * the resolved §25 values: absent means "fall back", which is a statement the
 * document has to be able to make. See the module header.
 */
export interface ColliderDocument {
  /** §24 geometry, in {@link serializeCollisionShape}'s form. */
  readonly shape: JsonValue;
  /**
   * §24 offset in the body's local frame, as `{position, rotation}`.
   *
   * Always written, unlike the three §25 coefficients below: an absent offset
   * and an identity offset mean exactly the same thing to a solver, so there is
   * no authoring statement for the absence to preserve. A document that omits
   * it — a hand-edited one, or one an older build wrote — restores the
   * identity, which is `Collider`'s own default.
   */
  readonly offset: JsonValue;
  /** §24 Coulomb friction, present only when the collider authored one. */
  readonly friction?: number;
  /** §24 restitution, present only when the collider authored one. */
  readonly restitution?: number;
  /** §24 density, present only when the collider authored one. */
  readonly density?: number;
  /** §25 shared surface properties, by value, when the collider had one. */
  readonly material?: PhysicsMaterialDocument;
  /** §24 sensor flag — a sensor reports overlaps and exerts no force. */
  readonly sensor: boolean;
  /** §24 bit set of the groups this collider belongs to. */
  readonly collisionGroups: number;
  /** §24 bit set of the groups it collides with. */
  readonly collisionMask: number;
}

/** A §25 material as the record {@link readMaterial} reads back. */
function materialJson(material: PhysicsMaterial): JsonValue {
  const document: Record<string, JsonValue> = {
    friction: material.friction,
    restitution: material.restitution,
    density: material.density,
  };
  // §25's two optional coefficients keep their "unspecified" state: an adapter
  // that models rolling friction has to tell "no rolling resistance" from "the
  // material never said", and a default written here would erase that.
  if (material.rollingFriction !== undefined) {
    document.rollingFriction = material.rollingFriction;
  }
  if (material.spinningFriction !== undefined) {
    document.spinningFriction = material.spinningFriction;
  }
  return document;
}

/** Rebuilds a §25 material from {@link materialJson}'s form. */
function readMaterial(value: JsonValue): PhysicsMaterial {
  const source = record(value);
  const options: PhysicsMaterialOptions = {
    friction: readNumber(source.friction, DEFAULT_FRICTION),
    restitution: readNumber(source.restitution, DEFAULT_RESTITUTION),
    density: readNumber(source.density, DEFAULT_DENSITY),
  };
  if (typeof source.rollingFriction === "number") {
    options.rollingFriction = source.rollingFriction;
  }
  if (typeof source.spinningFriction === "number") {
    options.spinningFriction = source.spinningFriction;
  }
  return new PhysicsMaterial(options);
}

/**
 * The §79 serializer for {@link Collider} (§24, §25, PH-17).
 *
 * The collider's *body* is not saved and does not need to be: `Collider.body`
 * resolves lazily from the scene graph — the `RigidBody` on its own node, else
 * the nearest ancestor's — so rebuilding the hierarchy rebuilds the association.
 * A solver handle would be world-registration state, which is exactly what a §79
 * document must not carry.
 */
export const COLLIDER_SERIALIZER: ComponentSerializerShape<Collider> = {
  serialize(collider: Collider): JsonValue {
    const document: Record<string, JsonValue> = {
      shape: serializeCollisionShape(collider.shape),
      offset: {
        position: vector3Json(collider.offset.position),
        rotation: quaternionJson(collider.offset.rotation),
      },
      sensor: collider.sensor,
      collisionGroups: collider.collisionGroups,
      collisionMask: collider.collisionMask,
    };
    if (collider.friction !== undefined) {
      document.friction = collider.friction;
    }
    if (collider.restitution !== undefined) {
      document.restitution = collider.restitution;
    }
    if (collider.density !== undefined) {
      document.density = collider.density;
    }
    if (collider.material !== undefined) {
      document.material = materialJson(collider.material);
    }
    return document;
  },

  deserialize(data: JsonValue): Collider {
    const source = record(data);
    const options: ColliderOptions = {
      shape: deserializeCollisionShape(source.shape),
      sensor: readBoolean(source.sensor, false),
      collisionGroups: readNumber(source.collisionGroups, ALL_COLLISION_GROUPS),
      collisionMask: readNumber(source.collisionMask, ALL_COLLISION_GROUPS),
    };
    if (source.offset !== undefined) {
      const offset = new Transform();
      const stored = record(source.offset);
      readVector3(stored.position, offset.position);
      readQuaternion(stored.rotation, offset.rotation);
      options.offset = offset;
    }
    if (typeof source.friction === "number") {
      options.friction = source.friction;
    }
    if (typeof source.restitution === "number") {
      options.restitution = source.restitution;
    }
    if (typeof source.density === "number") {
      options.density = source.density;
    }
    if (source.material !== undefined) {
      options.material = readMaterial(source.material);
    }
    return new Collider(options);
  },
};
