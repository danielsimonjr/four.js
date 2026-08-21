/**
 * `RIGID_BODY_SERIALIZER` / `COLLIDER_SERIALIZER` (§23, §24, §25, §79, PH-17 —
 * 2026-08-06).
 *
 * Three things are under test:
 *
 * 1. the payloads carry every field §23/§24/§25 lets a component author, and
 *    **only when authored** — the authoredness rule is the whole point of the
 *    pair (a derived mass re-emitted as an authored one is the defect
 *    `RigidBody.massAuthored` exists to prevent);
 * 2. the read side is total for values and strict for tags, per the module
 *    header's rule;
 * 3. the structural declarations still match `@four/serialization`'s
 *    `ComponentSerializer`. That is the honest cost of duck typing — no compiler
 *    checks the two declarations against each other, so a transcribed mirror is
 *    asserted here, exactly as `@four/motion`'s suite does.
 */

import { isFourError, type JsonValue } from "@four/core";
import { Matrix3, Quaternion, Vector2, Vector3 } from "@four/math";
import { Group, Transform, type Node } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  COLLIDER_SERIALIZER,
  COLLISION_SHAPE_TYPES_2D,
  COLLISION_SHAPE_TYPES_3D,
  Collider,
  PhysicsMaterial,
  RIGID_BODY_SERIALIZER,
  RigidBody,
  SWEPT_CHARACTER_CONTROLLER_SERIALIZER,
  SweptCharacterController,
  deserializeCollisionShape,
  serializeCollisionShape,
  type CollisionShape,
} from "../src/index.js";

/**
 * `@four/serialization`'s `ComponentSerializer<T>`, transcribed member for
 * member (there is no §3.1 edge from `physics` to `serialization`).
 */
interface ComponentSerializerMirror<T> {
  serialize(component: T): JsonValue;
  deserialize(data: JsonValue, node: Node): T;
}

/** The payload as the plain record the assertions below index into. */
function payload(value: JsonValue): Record<string, JsonValue> {
  expect(typeof value === "object" && value !== null).toBe(true);
  return value as Record<string, JsonValue>;
}

/** Round-trips a payload through real JSON, so nothing survives by reference. */
function throughJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** A body that authors everything §23 and §31 let it author. */
function populatedBody(): RigidBody {
  const body = new RigidBody({
    type: "dynamic",
    mass: 2.5,
    centerOfMass: new Vector3(0.1, -0.2, 0.3),
    inertiaTensor: new Matrix3().fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    position: new Vector3(3, 4, 5),
    rotation: new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2),
    linearVelocity: new Vector3(1, -2, 3),
    angularVelocity: new Vector3(0.25, 0.5, -0.75),
    linearDamping: 0.125,
    angularDamping: 0.25,
    gravityScale: 0.5,
    ccdMode: "speculative",
    ccdPredictionDistance: 0.75,
  });
  body.physicsWeight = 0.35;
  body.animationWeight = 0.65;
  return body;
}

describe("RIGID_BODY_SERIALIZER (§23, §79)", () => {
  it("is assignable to the ComponentSerializer contract it targets", () => {
    const mirror: ComponentSerializerMirror<RigidBody> = RIGID_BODY_SERIALIZER;

    expect(
      mirror.deserialize(mirror.serialize(populatedBody()), new Group()),
    ).toBeInstanceOf(RigidBody);
  });

  it("writes every §23/§31/§19 field a body authored", () => {
    expect(RIGID_BODY_SERIALIZER.serialize(populatedBody())).toEqual({
      type: "dynamic",
      mass: 2.5,
      centerOfMass: { x: 0.1, y: -0.2, z: 0.3 },
      inertiaTensor: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      position: { x: 3, y: 4, z: 5 },
      rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
      linearVelocity: { x: 1, y: -2, z: 3 },
      angularVelocity: { x: 0.25, y: 0.5, z: -0.75 },
      linearDamping: 0.125,
      angularDamping: 0.25,
      gravityScale: 0.5,
      ccdMode: "speculative",
      ccdPredictionDistance: 0.75,
      physicsWeight: 0.35,
      animationWeight: 0.65,
      sleeping: false,
    });
  });

  it("round-trips every authored field bit for bit", () => {
    const source = populatedBody();
    const restored = RIGID_BODY_SERIALIZER.deserialize(
      throughJson(RIGID_BODY_SERIALIZER.serialize(source)),
      new Group(),
    );

    expect(restored).toBeInstanceOf(RigidBody);
    expect(restored.host).toBeNull();
    expect(restored.type).toBe("dynamic");
    expect(restored.mass).toBe(2.5);
    expect(restored.massAuthored).toBe(true);
    expect(restored.centerOfMass.equalsApprox(source.centerOfMass, 0)).toBe(
      true,
    );
    expect(restored.centerOfMassAuthored).toBe(true);
    expect([...(restored.inertiaTensor?.elements ?? [])]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(
      restored.initialPosition?.equalsApprox(new Vector3(3, 4, 5), 0),
    ).toBe(true);
    expect(restored.initialRotation?.z).toBe(Math.SQRT1_2);
    expect(restored.initialRotation?.w).toBe(Math.SQRT1_2);
    expect(restored.linearVelocity.equalsApprox(source.linearVelocity, 0)).toBe(
      true,
    );
    expect(
      restored.angularVelocity.equalsApprox(source.angularVelocity, 0),
    ).toBe(true);
    expect(restored.linearDamping).toBe(0.125);
    expect(restored.angularDamping).toBe(0.25);
    expect(restored.gravityScale).toBe(0.5);
    expect(restored.ccdMode).toBe("speculative");
    expect(restored.ccdPredictionDistance).toBe(0.75);
    expect(restored.physicsWeight).toBe(0.35);
    expect(restored.animationWeight).toBe(0.65);
  });

  it("omits mass, centre of mass, inertia, pose and CCD distance when unauthored", () => {
    const document = payload(
      RIGID_BODY_SERIALIZER.serialize(new RigidBody({ type: "static" })),
    );

    expect(document).toEqual({
      type: "static",
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearDamping: 0,
      angularDamping: 0,
      gravityScale: 1,
      ccdMode: "disabled",
      physicsWeight: 1,
      animationWeight: 0,
      sleeping: false,
    });
  });

  it("does not launder a solver-derived mass into an authored one (§23, §25)", () => {
    // The defect `RigidBody.massAuthored` exists to prevent: a body that asked
    // the solver to derive its mass must still be asking after a round trip, or
    // scaling its collider afterwards silently changes nothing.
    const body = new RigidBody({ type: "dynamic" });
    body.mass = 4;
    expect(payload(RIGID_BODY_SERIALIZER.serialize(body)).mass).toBe(4);

    body.mass = undefined;
    expect("mass" in payload(RIGID_BODY_SERIALIZER.serialize(body))).toBe(
      false,
    );
    expect(
      RIGID_BODY_SERIALIZER.deserialize(
        RIGID_BODY_SERIALIZER.serialize(body),
        new Group(),
      ).massAuthored,
    ).toBe(false);
  });

  it("writes a centre of mass authored at the origin, which no value can show", () => {
    const body = new RigidBody({ type: "dynamic", mass: 1 });
    expect(
      "centerOfMass" in payload(RIGID_BODY_SERIALIZER.serialize(body)),
    ).toBe(false);

    body.markCenterOfMassAuthored();
    const restored = RIGID_BODY_SERIALIZER.deserialize(
      throughJson(RIGID_BODY_SERIALIZER.serialize(body)),
      new Group(),
    );
    expect(restored.centerOfMassAuthored).toBe(true);
  });

  it("drops the §31 prediction distance the descriptor itself drops", () => {
    // §85 rejects a distance with any non-speculative resolved mode, and
    // `toDescriptor()` already elides it there — the document must agree, or a
    // reload would build a descriptor the validator refuses.
    const body = new RigidBody({
      type: "dynamic",
      mass: 1,
      ccdMode: "speculative",
      ccdPredictionDistance: 2,
    });
    body.ccdMode = "swept";

    const document = payload(RIGID_BODY_SERIALIZER.serialize(body));
    expect(document.ccdMode).toBe("swept");
    expect("ccdPredictionDistance" in document).toBe(false);
  });

  it("records §32 sleep as diagnostics and never applies it on load", () => {
    const restored = RIGID_BODY_SERIALIZER.deserialize(
      { type: "dynamic", mass: 1, sleeping: true },
      new Group(),
    );

    expect(restored.sleeping).toBe(false);
  });

  it("restores §23/§19 defaults for fields a payload does not carry", () => {
    const restored = RIGID_BODY_SERIALIZER.deserialize(
      { type: "kinematic-velocity" },
      new Group(),
    );

    expect(restored.linearVelocity.equalsApprox(new Vector3(), 0)).toBe(true);
    expect(restored.angularVelocity.equalsApprox(new Vector3(), 0)).toBe(true);
    expect(restored.linearDamping).toBe(0);
    expect(restored.angularDamping).toBe(0);
    expect(restored.gravityScale).toBe(1);
    expect(restored.ccdMode).toBe("disabled");
    expect(restored.physicsWeight).toBe(1);
    expect(restored.animationWeight).toBe(0);
    expect(restored.mass).toBeUndefined();
    expect(restored.inertiaTensor).toBeUndefined();
    expect(restored.initialPosition).toBeUndefined();
    expect(restored.initialRotation).toBeUndefined();
  });

  it("tolerates malformed values, restoring their documented defaults", () => {
    const restored = RIGID_BODY_SERIALIZER.deserialize(
      {
        type: "dynamic",
        mass: 1,
        linearVelocity: "nonsense",
        angularVelocity: { x: 1 },
        linearDamping: "fast",
        gravityScale: null,
        physicsWeight: [],
        rotation: { x: 0 },
      },
      new Group(),
    );

    expect(restored.linearVelocity.equalsApprox(new Vector3(), 0)).toBe(true);
    expect(restored.angularVelocity.equalsApprox(new Vector3(1, 0, 0), 0)).toBe(
      true,
    );
    expect(restored.linearDamping).toBe(0);
    expect(restored.gravityScale).toBe(1);
    expect(restored.physicsWeight).toBe(1);
    // A partial quaternion restores the identity, not a non-unit rotation.
    expect(restored.initialRotation?.w).toBe(1);
    // An absent tensor is the "derive it" statement, and restores as one.
    expect(restored.inertiaTensor).toBeUndefined();
  });

  // 2026-08-07: a present-but-unreadable tensor used to restore as an *absent*
  // one, silently flipping the body from an authored mass distribution to a
  // derived one — a divergence with nothing to point at. It fails loudly now,
  // like every other tag this module reads.
  it("refuses an inertia tensor that is present and not nine finite numbers", () => {
    const of = (inertiaTensor: JsonValue): Matrix3 | undefined =>
      RIGID_BODY_SERIALIZER.deserialize(
        { type: "dynamic", mass: 1, inertiaTensor },
        new Group(),
      ).inertiaTensor;

    for (const malformed of [
      "not-an-array",
      [1, 2, 3],
      [1, 2, 3, 4, 5, 6, 7, 8, "nine"],
      [1, 2, 3, 4, 5, 6, 7, 8, null],
    ] as JsonValue[]) {
      let thrown: unknown;
      try {
        of(malformed);
      } catch (error) {
        thrown = error;
      }
      expect(isFourError(thrown) && thrown.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(isFourError(thrown) && thrown.message).toContain("inertiaTensor");
    }

    expect(of([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeInstanceOf(Matrix3);
    expect(
      RIGID_BODY_SERIALIZER.deserialize({ type: "dynamic" }, new Group())
        .inertiaTensor,
    ).toBeUndefined();
  });

  it("refuses a document whose body type is missing or unknown (§22)", () => {
    for (const type of [undefined, "ghost", 3]) {
      let thrown: unknown;
      try {
        RIGID_BODY_SERIALIZER.deserialize(
          type === undefined ? {} : { type: type as JsonValue },
          new Group(),
        );
      } catch (error) {
        thrown = error;
      }
      expect(isFourError(thrown) && thrown.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(isFourError(thrown) && thrown.message).toMatch(/body type/);
    }
  });

  it("refuses an unrecognized §31 CCD mode rather than silently disabling it", () => {
    let thrown: unknown;
    try {
      RIGID_BODY_SERIALIZER.deserialize(
        { type: "dynamic", mass: 1, ccdMode: "psychic" },
        new Group(),
      );
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(isFourError(thrown) && thrown.message).toMatch(/ccdMode/);
  });

  it("reads a payload that is not an object at all as an empty one", () => {
    // Which then fails on the missing body type, rather than on a property
    // access against `null`.
    expect(() => RIGID_BODY_SERIALIZER.deserialize(null, new Group())).toThrow(
      /body type/,
    );
    expect(() => RIGID_BODY_SERIALIZER.deserialize([], new Group())).toThrow(
      /body type/,
    );
  });
});

describe("collision shape documents (§24)", () => {
  const SHAPES: readonly CollisionShape[] = [
    { type: "circle", radius: 0.5 },
    { type: "sphere", radius: 0.75 },
    { type: "rectangle", halfExtents: new Vector2(2, 0.5) },
    { type: "box", halfExtents: new Vector3(1, 2, 3) },
    { type: "capsule", radius: 0.3, halfHeight: 0.9 },
    {
      type: "polygon",
      vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1)],
    },
    {
      type: "polyline",
      vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1)],
    },
    {
      type: "chain",
      vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1)],
    },
    { type: "cylinder", radius: 0.4, halfHeight: 1.2 },
    { type: "cone", radius: 0.6, halfHeight: 0.8 },
    {
      type: "convex-hull",
      points: [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      ],
    },
    {
      type: "triangle-mesh",
      vertices: [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(0, 0, 1),
      ],
      indices: [0, 1, 2],
    },
    {
      type: "height-field",
      rows: 2,
      columns: 3,
      heights: [0, 1, 2, 3, 4, 5],
      scale: new Vector3(4, 1, 6),
    },
  ];

  it("round-trips every shipped shape (§24, PH-22a)", () => {
    for (const shape of SHAPES) {
      const restored = deserializeCollisionShape(
        throughJson(serializeCollisionShape(shape)),
      );
      expect(restored).toEqual(shape);
    }
    // Every §24 tag the build ships has a document form — the list above is
    // exhaustive, not a sample.
    expect(new Set(SHAPES.map((shape) => shape.type))).toEqual(
      new Set([...COLLISION_SHAPE_TYPES_2D, ...COLLISION_SHAPE_TYPES_3D]),
    );
  });

  it("refuses to write a shape the union does not cover", () => {
    let thrown: unknown;
    try {
      serializeCollisionShape({
        type: "voxels",
        radius: 1,
      } as unknown as CollisionShape);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe("NOT_IMPLEMENTED");
  });

  it("refuses to read a shape tag this build does not ship", () => {
    expect(() => deserializeCollisionShape({ type: "compound" })).toThrow(
      /collision shape/,
    );
    expect(() => deserializeCollisionShape(undefined)).toThrow(
      /collision shape/,
    );
  });

  it("reads a malformed vertex, index, or height list as empty (§79, §85)", () => {
    // The list-valued shapes default to an empty list, which then fails the
    // §85 minimum-count rule naming the shape — the same "let the shape
    // report itself" rule the scalar parameters follow.
    expect(deserializeCollisionShape({ type: "polyline" })).toEqual({
      type: "polyline",
      vertices: [],
    });
    expect(
      deserializeCollisionShape({ type: "convex-hull", points: 7 }),
    ).toEqual({ type: "convex-hull", points: [] });
    // A malformed index becomes NaN rather than 0: 0 is a legal index, and a
    // damaged document must not build a plausible wrong triangle.
    expect(
      deserializeCollisionShape({
        type: "triangle-mesh",
        vertices: [{ x: 0, y: 0, z: 0 }],
        indices: [0, "two", 2],
      }),
    ).toEqual({
      type: "triangle-mesh",
      vertices: [new Vector3(0, 0, 0)],
      indices: [0, Number.NaN, 2],
    });
    expect(
      deserializeCollisionShape({
        type: "height-field",
        rows: 2,
        columns: 2,
        heights: [0, null, 0, 0],
        scale: { x: 1, y: 1, z: 1 },
      }),
    ).toEqual({
      type: "height-field",
      rows: 2,
      columns: 2,
      heights: [0, Number.NaN, 0, 0],
      scale: new Vector3(1, 1, 1),
    });
  });

  it("defaults malformed parameters to 0, so §85 reports the shape", () => {
    expect(deserializeCollisionShape({ type: "circle" })).toEqual({
      type: "circle",
      radius: 0,
    });
    expect(deserializeCollisionShape({ type: "capsule" })).toEqual({
      type: "capsule",
      radius: 0,
      halfHeight: 0,
    });
    expect(deserializeCollisionShape({ type: "polygon" })).toEqual({
      type: "polygon",
      vertices: [],
    });
    expect(
      deserializeCollisionShape({ type: "rectangle", halfExtents: 7 }),
    ).toEqual({ type: "rectangle", halfExtents: new Vector2(0, 0) });
    // …which is then what the constructor rejects, naming §85's rule.
    expect(
      () => new Collider({ shape: { type: "circle", radius: 0 } }),
    ).toThrow(/radius/);
  });
});

/** A collider that authors every §24 field and carries a §25 material. */
function populatedCollider(): Collider {
  const offset = new Transform();
  offset.position.set(0.5, -0.25, 0);
  offset.rotation.set(0, 0, Math.SQRT1_2, Math.SQRT1_2);
  return new Collider({
    shape: { type: "circle", radius: 0.4 },
    offset,
    friction: 0.65,
    restitution: 0.2,
    density: 850,
    material: new PhysicsMaterial({
      friction: 0.9,
      restitution: 0.1,
      density: 1100,
      rollingFriction: 0.02,
      spinningFriction: 0.03,
    }),
    sensor: true,
    collisionGroups: 0b0110,
    collisionMask: 0b1010,
  });
}

describe("COLLIDER_SERIALIZER (§24, §25, §79)", () => {
  it("is assignable to the ComponentSerializer contract it targets", () => {
    const mirror: ComponentSerializerMirror<Collider> = COLLIDER_SERIALIZER;

    expect(
      mirror.deserialize(mirror.serialize(populatedCollider()), new Group()),
    ).toBeInstanceOf(Collider);
  });

  it("writes every §24 field and the §25 material by value", () => {
    expect(COLLIDER_SERIALIZER.serialize(populatedCollider())).toEqual({
      shape: { type: "circle", radius: 0.4 },
      offset: {
        position: { x: 0.5, y: -0.25, z: 0 },
        rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
      },
      friction: 0.65,
      restitution: 0.2,
      density: 850,
      material: {
        friction: 0.9,
        restitution: 0.1,
        density: 1100,
        rollingFriction: 0.02,
        spinningFriction: 0.03,
      },
      sensor: true,
      collisionGroups: 0b0110,
      collisionMask: 0b1010,
    });
  });

  it("round-trips every §24 field bit for bit", () => {
    const source = populatedCollider();
    const restored = COLLIDER_SERIALIZER.deserialize(
      throughJson(COLLIDER_SERIALIZER.serialize(source)),
      new Group(),
    );

    expect(restored).toBeInstanceOf(Collider);
    expect(restored.host).toBeNull();
    expect(restored.shape).toEqual(source.shape);
    expect(
      restored.offset.position.equalsApprox(source.offset.position, 0),
    ).toBe(true);
    expect(restored.offset.rotation.z).toBe(Math.SQRT1_2);
    expect(restored.friction).toBe(0.65);
    expect(restored.restitution).toBe(0.2);
    expect(restored.density).toBe(850);
    expect(restored.sensor).toBe(true);
    expect(restored.collisionGroups).toBe(0b0110);
    expect(restored.collisionMask).toBe(0b1010);
    expect(restored.material?.friction).toBe(0.9);
    expect(restored.material?.rollingFriction).toBe(0.02);
    expect(restored.material?.spinningFriction).toBe(0.03);
    // By value, not by identity — the module header's third paragraph.
    expect(restored.material).not.toBe(source.material);
  });

  it("keeps §25's fallback chain a chain rather than pinning its defaults", () => {
    // A collider that authored nothing must reload authoring nothing, so a later
    // change to DEFAULT_FRICTION moves the reloaded scene exactly as it moves
    // the saved one. The *effective* values are identical either way.
    const source = new Collider({ shape: { type: "sphere", radius: 1 } });
    const document = payload(COLLIDER_SERIALIZER.serialize(source));

    expect("friction" in document).toBe(false);
    expect("restitution" in document).toBe(false);
    expect("density" in document).toBe(false);
    expect("material" in document).toBe(false);
    expect(document.offset).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });

    const restored = COLLIDER_SERIALIZER.deserialize(
      throughJson(document),
      new Group(),
    );
    expect(restored.friction).toBeUndefined();
    expect(restored.restitution).toBeUndefined();
    expect(restored.density).toBeUndefined();
    expect(restored.material).toBeUndefined();
    expect(restored.effectiveFriction).toBe(source.effectiveFriction);
    expect(restored.effectiveRestitution).toBe(source.effectiveRestitution);
    expect(restored.effectiveDensity).toBe(source.effectiveDensity);
  });

  it("keeps a material's unspecified §25 coefficients unspecified", () => {
    const source = new Collider({
      shape: { type: "sphere", radius: 1 },
      material: new PhysicsMaterial({ friction: 0.2 }),
    });
    const document = payload(COLLIDER_SERIALIZER.serialize(source));

    expect(document.material).toEqual({
      friction: 0.2,
      restitution: 0,
      density: 1,
    });

    const restored = COLLIDER_SERIALIZER.deserialize(
      throughJson(document),
      new Group(),
    );
    expect(restored.material?.rollingFriction).toBeUndefined();
    expect(restored.material?.spinningFriction).toBeUndefined();
  });

  it("restores §24 defaults for a payload carrying only a shape", () => {
    const restored = COLLIDER_SERIALIZER.deserialize(
      { shape: { type: "sphere", radius: 2 } },
      new Group(),
    );

    expect(restored.sensor).toBe(false);
    expect(restored.collisionGroups).toBe(0xffffffff);
    expect(restored.collisionMask).toBe(0xffffffff);
    expect(restored.offset.position.equalsApprox(new Vector3(), 0)).toBe(true);
    expect(restored.offset.rotation.w).toBe(1);
  });

  it("tolerates malformed §24 values but not a malformed shape tag", () => {
    const restored = COLLIDER_SERIALIZER.deserialize(
      {
        shape: { type: "sphere", radius: 1 },
        sensor: "yes",
        collisionGroups: "all",
        material: "rubber",
      },
      new Group(),
    );

    expect(restored.sensor).toBe(false);
    expect(restored.collisionGroups).toBe(0xffffffff);
    // A material that is not a record restores the §25 defaults rather than
    // dropping the material the document said was there.
    expect(restored.material?.friction).toBe(0.5);
    expect(restored.material?.density).toBe(1);

    expect(() => COLLIDER_SERIALIZER.deserialize(null, new Group())).toThrow(
      /collision shape/,
    );
  });

  it("resolves its body from the scene graph, not from the document", () => {
    // Nothing about a body is saved: rebuilding the hierarchy rebuilds the
    // association (§24, and `Collider.body`'s lazy ancestor walk).
    const node = new Group();
    const body = node.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
    const collider = node.addComponent(
      COLLIDER_SERIALIZER.deserialize(
        COLLIDER_SERIALIZER.serialize(populatedCollider()),
        node,
      ),
    );

    expect(collider.body).toBe(body);
  });
});

describe("SWEPT_CHARACTER_CONTROLLER_SERIALIZER (§12, §30, §79 — PH-11b)", () => {
  it("round-trips the capsule, the resolution parameters and the vertical state", () => {
    const controller = new SweptCharacterController({
      radius: 0.4,
      halfHeight: 0.6,
      yaw: 1.25,
      moveSpeed: 5,
      gravity: -12,
      jumpSpeed: 6,
      maxFallSpeed: 20,
      stepHeight: 0.45,
      slopeLimit: 0.7,
      skinWidth: 0.02,
      groundSnapDistance: 0.2,
      maxSlides: 6,
      collisionGroups: 0b1010,
      collisionMask: 0b0110,
      verticalVelocity: -3.5,
      grounded: false,
    });
    controller.setMoveIntent(1, 0);

    const document = payload(
      SWEPT_CHARACTER_CONTROLLER_SERIALIZER.serialize(controller),
    );
    expect(document.maxFallSpeed).toBe(20);
    // The move intent is this frame's input; a §79 document does not carry it.
    expect(document.intentForward).toBeUndefined();
    expect(document.world).toBeUndefined();
    expect(document.groundBody).toBeUndefined();
    expect(document.skippedSteps).toBeUndefined();

    const restored = SWEPT_CHARACTER_CONTROLLER_SERIALIZER.deserialize(
      document,
      new Group(),
    );
    expect(restored.radius).toBe(0.4);
    expect(restored.halfHeight).toBe(0.6);
    expect(restored.yaw).toBe(1.25);
    expect(restored.moveSpeed).toBe(5);
    expect(restored.gravity).toBe(-12);
    expect(restored.jumpSpeed).toBe(6);
    expect(restored.maxFallSpeed).toBe(20);
    expect(restored.stepHeight).toBe(0.45);
    expect(restored.slopeLimit).toBe(0.7);
    expect(restored.skinWidth).toBe(0.02);
    expect(restored.groundSnapDistance).toBe(0.2);
    expect(restored.maxSlides).toBe(6);
    expect(restored.collisionGroups).toBe(0b1010);
    expect(restored.collisionMask).toBe(0b0110);
    expect(restored.verticalVelocity).toBe(-3.5);
    expect(restored.grounded).toBe(false);
    // Re-bound by the application, exactly as a reloaded RigidBody is
    // registered: the document carries no live world.
    expect(restored.world).toBeUndefined();
    expect(restored.intentForward).toBe(0);
    expect(restored.intentRight).toBe(0);
  });

  it("writes an infinite maxFallSpeed by omission, and a grounded character's state", () => {
    const controller = new SweptCharacterController({
      radius: 0.4,
      halfHeight: 0.6,
      grounded: true,
    });
    const document = payload(
      SWEPT_CHARACTER_CONTROLLER_SERIALIZER.serialize(controller),
    );
    expect("maxFallSpeed" in document).toBe(false);

    const restored = SWEPT_CHARACTER_CONTROLLER_SERIALIZER.deserialize(
      document,
      new Group(),
    );
    expect(restored.maxFallSpeed).toBe(Number.POSITIVE_INFINITY);
    expect(restored.grounded).toBe(true);
  });

  it("restores every documented default from an otherwise empty document", () => {
    const restored = SWEPT_CHARACTER_CONTROLLER_SERIALIZER.deserialize(
      { radius: 0.5, halfHeight: 0.5 },
      new Group(),
    );
    expect(restored.stepHeight).toBe(0.3);
    expect(restored.slopeLimit).toBeCloseTo(Math.PI / 4, 12);
    expect(restored.skinWidth).toBe(0.01);
    expect(restored.groundSnapDistance).toBe(0.1);
    expect(restored.maxSlides).toBe(4);
    expect(restored.grounded).toBe(false);
    expect(restored.moveSpeed).toBe(1);
  });

  it("refuses a document with no capsule: geometry has no defensible default", () => {
    expect(() =>
      SWEPT_CHARACTER_CONTROLLER_SERIALIZER.deserialize({}, new Group()),
    ).toThrow(/"radius"/);
    expect(() =>
      SWEPT_CHARACTER_CONTROLLER_SERIALIZER.deserialize(
        { radius: 0.5 },
        new Group(),
      ),
    ).toThrow(/"halfHeight"/);
    expect(() =>
      SWEPT_CHARACTER_CONTROLLER_SERIALIZER.deserialize(null, new Group()),
    ).toThrow(/"radius"/);
  });

  it("still matches @four/serialization's structural ComponentSerializer", () => {
    const mirror: ComponentSerializerMirror<SweptCharacterController> =
      SWEPT_CHARACTER_CONTROLLER_SERIALIZER;
    expect(typeof mirror.serialize).toBe("function");
  });
});
