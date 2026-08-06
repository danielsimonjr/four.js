/**
 * `MOTION_COMPONENT_SERIALIZER` (§11, §79, PH-17 — 2026-08-06).
 *
 * Two things are under test: the payload round-trips every §11 field exactly,
 * and the structural declaration still matches `@four/serialization`'s
 * `ComponentSerializer`. The second is what the module header calls the honest
 * cost of duck typing — no compiler checks the two declarations against each
 * other, so a transcribed mirror is asserted here instead.
 */

import type { JsonValue } from "@four/core";
import { Vector3 } from "@four/math";
import { Group, type Node } from "@four/scene";
import { describe, expect, it } from "vitest";

import { MOTION_COMPONENT_SERIALIZER, MotionComponent } from "../src/index.js";

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
