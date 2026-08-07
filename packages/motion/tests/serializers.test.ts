/**
 * `MOTION_COMPONENT_SERIALIZER` (§11, §79, PH-17 — 2026-08-06) and
 * `KINEMATIC_CONTROLLER_SERIALIZER` (§12, 2026-08-07).
 *
 * Two things are under test: the payloads round-trip every field the components
 * declare, and the structural declaration still matches
 * `@four/serialization`'s `ComponentSerializer`. The second is what the module
 * header calls the honest cost of duck typing — no compiler checks the two
 * declarations against each other, so a transcribed mirror is asserted here
 * instead.
 */

import type { JsonValue } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import { Group, type Node } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  KINEMATIC_CONTROLLER_SERIALIZER,
  KinematicController,
  MOTION_COMPONENT_SERIALIZER,
  MotionComponent,
} from "../src/index.js";

/**
 * `@four/serialization`'s `ComponentSerializer<T>`, transcribed member for
 * member (there is no §3.1 edge from `motion` to `serialization`).
 */
interface ComponentSerializerMirror<T> {
  serialize(component: T): JsonValue;
  deserialize(data: JsonValue, node: Node): T;
}

/** A fully populated component, so nothing can round-trip by accident. */
function populated(): MotionComponent {
  const component = new MotionComponent({
    linearVelocity: new Vector3(1, -2, 3),
    angularVelocity: new Vector3(0.25, 0.5, -0.75),
    linearAcceleration: new Vector3(-4, 5, -6),
    angularAcceleration: new Vector3(7, -8, 9),
    damping: 0.125,
    angularDamping: 0.25,
    maxSpeed: 12,
    maxAngularSpeed: 3,
  });
  return component;
}

describe("MOTION_COMPONENT_SERIALIZER", () => {
  it("is assignable to the ComponentSerializer contract it targets", () => {
    const mirror: ComponentSerializerMirror<MotionComponent> =
      MOTION_COMPONENT_SERIALIZER;

    expect(
      mirror.deserialize(mirror.serialize(populated()), new Group()),
    ).toBeInstanceOf(MotionComponent);
  });

  it("writes every §11 field", () => {
    expect(MOTION_COMPONENT_SERIALIZER.serialize(populated())).toEqual({
      linearVelocity: { x: 1, y: -2, z: 3 },
      angularVelocity: { x: 0.25, y: 0.5, z: -0.75 },
      linearAcceleration: { x: -4, y: 5, z: -6 },
      angularAcceleration: { x: 7, y: -8, z: 9 },
      damping: 0.125,
      angularDamping: 0.25,
      maxSpeed: 12,
      maxAngularSpeed: 3,
    });
  });

  it("round-trips every field bit for bit", () => {
    const source = populated();
    const restored = MOTION_COMPONENT_SERIALIZER.deserialize(
      JSON.parse(
        JSON.stringify(MOTION_COMPONENT_SERIALIZER.serialize(source)),
      ) as JsonValue,
      new Group(),
    );

    expect(restored.linearVelocity.equalsApprox(source.linearVelocity, 0)).toBe(
      true,
    );
    expect(
      restored.angularVelocity.equalsApprox(source.angularVelocity, 0),
    ).toBe(true);
    expect(
      restored.linearAcceleration.equalsApprox(source.linearAcceleration, 0),
    ).toBe(true);
    expect(
      restored.angularAcceleration.equalsApprox(source.angularAcceleration, 0),
    ).toBe(true);
    expect(restored.damping).toBe(source.damping);
    expect(restored.angularDamping).toBe(source.angularDamping);
    expect(restored.maxSpeed).toBe(12);
    expect(restored.maxAngularSpeed).toBe(3);
    // A restored component is a live one, not a data bag.
    expect(restored).toBeInstanceOf(MotionComponent);
    expect(restored.host).toBeNull();
  });

  it("omits the optional limits when they are unset", () => {
    const payload = MOTION_COMPONENT_SERIALIZER.serialize(
      new MotionComponent(),
    );

    expect(payload).toEqual({
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearAcceleration: { x: 0, y: 0, z: 0 },
      angularAcceleration: { x: 0, y: 0, z: 0 },
      damping: 0,
      angularDamping: 0,
    });
  });

  it("restores no limit from an absent key, rather than a limit of zero", () => {
    const restored = MOTION_COMPONENT_SERIALIZER.deserialize(
      MOTION_COMPONENT_SERIALIZER.serialize(new MotionComponent()),
      new Group(),
    );

    expect(restored.maxSpeed).toBeUndefined();
    expect(restored.maxAngularSpeed).toBeUndefined();
  });

  it("restores §11 defaults for a payload that carries nothing", () => {
    const restored = MOTION_COMPONENT_SERIALIZER.deserialize(null, new Group());

    expect(restored.linearVelocity.equalsApprox(new Vector3(), 0)).toBe(true);
    expect(restored.damping).toBe(0);
    expect(restored.angularDamping).toBe(0);
    expect(restored.maxSpeed).toBeUndefined();
  });

  it("tolerates a field of the wrong shape rather than refusing the scene", () => {
    const restored = MOTION_COMPONENT_SERIALIZER.deserialize(
      {
        linearVelocity: "nonsense",
        angularVelocity: { x: 1 },
        damping: "fast",
      },
      new Group(),
    );

    expect(restored.linearVelocity.equalsApprox(new Vector3(), 0)).toBe(true);
    expect(restored.angularVelocity.equalsApprox(new Vector3(1, 0, 0), 0)).toBe(
      true,
    );
    expect(restored.damping).toBe(0);
  });
});

/**
 * §12's controller (2026-08-07). It carries no authored state at all — its
 * constructor takes no options — so the interesting assertions are that the
 * payload is complete-and-empty, that reading anything at all produces a live
 * idle controller, and that an in-flight command is deliberately not carried.
 */
describe("KINEMATIC_CONTROLLER_SERIALIZER", () => {
  it("is assignable to the ComponentSerializer contract it targets", () => {
    const mirror: ComponentSerializerMirror<KinematicController> =
      KINEMATIC_CONTROLLER_SERIALIZER;

    expect(
      mirror.deserialize(
        mirror.serialize(new KinematicController()),
        new Group(),
      ),
    ).toBeInstanceOf(KinematicController);
  });

  it("writes an empty payload for a controller with nothing authored", () => {
    expect(
      KINEMATIC_CONTROLLER_SERIALIZER.serialize(new KinematicController()),
    ).toEqual({});
  });

  it("round-trips through JSON into a live, idle controller", () => {
    const controller = new KinematicController();
    const restored = KINEMATIC_CONTROLLER_SERIALIZER.deserialize(
      JSON.parse(
        JSON.stringify(KINEMATIC_CONTROLLER_SERIALIZER.serialize(controller)),
      ) as JsonValue,
      new Group(),
    );

    expect(restored).toBeInstanceOf(KinematicController);
    expect(restored.translationActive).toBe(false);
    expect(restored.rotationActive).toBe(false);
    expect(restored.commandGeneration).toBe(0);
    expect(restored.host).toBeNull();
  });

  it("does not carry an in-flight command — a document is a scene, not a run", () => {
    const controller = new KinematicController();
    controller.moveTo(new Vector3(10, 0, 0), { duration: 2 });
    controller.rotateTo(new Quaternion(), { duration: 1 });
    expect(controller.translationActive).toBe(true);

    const restored = KINEMATIC_CONTROLLER_SERIALIZER.deserialize(
      KINEMATIC_CONTROLLER_SERIALIZER.serialize(controller),
      new Group(),
    );

    expect(restored.translationActive).toBe(false);
    expect(restored.rotationActive).toBe(false);
  });

  it("restores an idle controller from any payload a document can carry", () => {
    for (const payload of [
      null,
      {},
      { commands: 3 },
      [1, 2, 3],
    ] as JsonValue[]) {
      const restored = KINEMATIC_CONTROLLER_SERIALIZER.deserialize(
        payload,
        new Group(),
      );
      expect(restored.translationActive).toBe(false);
      expect(restored.commandGeneration).toBe(0);
    }
  });
});
