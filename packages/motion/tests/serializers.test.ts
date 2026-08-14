/**
 * `MOTION_COMPONENT_SERIALIZER` (§11, §79, PH-17 — 2026-08-06),
 * `KINEMATIC_CONTROLLER_SERIALIZER` (§12, 2026-08-07), and the three rig
 * serializers (§44/§12, 2026-08-13).
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
  DEFAULT_ORBIT_PITCH_LIMIT,
  FOLLOW_RIG_SERIALIZER,
  FollowRig,
  KINEMATIC_CONTROLLER_SERIALIZER,
  KinematicController,
  LOOK_AT_CONSTRAINT_SERIALIZER,
  LookAtConstraint,
  MOTION_COMPONENT_SERIALIZER,
  MotionComponent,
  ORBIT_RIG_SERIALIZER,
  OrbitRig,
  SpringDamper,
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

/**
 * The §44/§12 rig components (2026-08-13). Three claims per serializer: the
 * authored configuration round-trips, a live `Node` target is dropped while a
 * `Vector3` target is written, and the corrupt-field policy holds — total for
 * shape, refusing for range.
 */
describe("ORBIT_RIG_SERIALIZER", () => {
  it("is assignable to the ComponentSerializer contract it targets", () => {
    const mirror: ComponentSerializerMirror<OrbitRig> = ORBIT_RIG_SERIALIZER;

    expect(
      mirror.deserialize(mirror.serialize(new OrbitRig()), new Group()),
    ).toBeInstanceOf(OrbitRig);
  });

  it("writes the live angles and the limits they are clamped by", () => {
    const rig = new OrbitRig({
      target: new Vector3(1, 2, 3),
      yaw: 0.5,
      pitch: 0.25,
      distance: 7,
      minPitch: -1,
      maxPitch: 1,
      minDistance: 2,
      maxDistance: 20,
    });

    expect(ORBIT_RIG_SERIALIZER.serialize(rig)).toEqual({
      yaw: 0.5,
      pitch: 0.25,
      distance: 7,
      minPitch: -1,
      maxPitch: 1,
      minDistance: 2,
      maxDistance: 20,
      target: { x: 1, y: 2, z: 3 },
    });
  });

  it("round-trips through JSON text, limits included", () => {
    const rig = new OrbitRig({
      target: new Vector3(-1, 0.5, 4),
      yaw: 1.25,
      pitch: -0.75,
      distance: 12.5,
      minPitch: -1.5,
      maxPitch: 1.5,
      minDistance: 0.5,
      maxDistance: 40,
    });
    const restored = ORBIT_RIG_SERIALIZER.deserialize(
      JSON.parse(
        JSON.stringify(ORBIT_RIG_SERIALIZER.serialize(rig)),
      ) as JsonValue,
      new Group(),
    );

    expect(restored.yaw).toBe(1.25);
    expect(restored.pitch).toBe(-0.75);
    expect(restored.distance).toBe(12.5);
    expect(restored.minPitch).toBe(-1.5);
    expect(restored.maxPitch).toBe(1.5);
    expect(restored.minDistance).toBe(0.5);
    expect(restored.maxDistance).toBe(40);
    expect(restored.target).toBeInstanceOf(Vector3);
    expect(
      (restored.target as Vector3).equalsApprox(new Vector3(-1, 0.5, 4), 0),
    ).toBe(true);
    // A restored rig starts with clean counters: they describe a run, not a scene.
    expect(restored.pitchLimitHits).toBe(0);
    expect(restored.skippedSteps).toBe(0);
  });

  it("omits an infinite maxDistance, which JSON cannot carry", () => {
    const payload = ORBIT_RIG_SERIALIZER.serialize(new OrbitRig()) as Record<
      string,
      JsonValue
    >;

    expect("maxDistance" in payload).toBe(false);
    expect(
      ORBIT_RIG_SERIALIZER.deserialize(payload, new Group()).maxDistance,
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("drops a live Node target, which the application re-binds", () => {
    const subject = new Group();
    const rig = new OrbitRig({ target: subject });
    const payload = ORBIT_RIG_SERIALIZER.serialize(rig) as Record<
      string,
      JsonValue
    >;

    expect("target" in payload).toBe(false);
    expect(ORBIT_RIG_SERIALIZER.deserialize(payload, new Group()).target).toBe(
      null,
    );
  });

  it("restores the class defaults from a payload that carries nothing", () => {
    for (const payload of [null, {}, [1, 2], "nonsense"] as JsonValue[]) {
      const restored = ORBIT_RIG_SERIALIZER.deserialize(payload, new Group());
      expect(restored.yaw).toBe(0);
      expect(restored.pitch).toBe(0);
      expect(restored.distance).toBe(1);
      expect(restored.minPitch).toBe(-DEFAULT_ORBIT_PITCH_LIMIT);
      expect(restored.maxPitch).toBe(DEFAULT_ORBIT_PITCH_LIMIT);
      expect(restored.target).toBe(null);
    }
  });

  it("is total for shape and refusing for range (§79 vs §85)", () => {
    // A field of the wrong *shape* falls back to the default …
    const restored = ORBIT_RIG_SERIALIZER.deserialize(
      { yaw: "east", distance: null, target: [1, 2, 3] },
      new Group(),
    );
    expect(restored.yaw).toBe(0);
    expect(restored.distance).toBe(1);
    expect(restored.target).toBe(null);

    // … while a well-formed number describing a rig that cannot exist is
    // refused by the constructor rather than silently substituted.
    expect(() =>
      ORBIT_RIG_SERIALIZER.deserialize({ distance: -4 }, new Group()),
    ).toThrow(RangeError);
    expect(() =>
      ORBIT_RIG_SERIALIZER.deserialize(
        { minPitch: 1, maxPitch: -1 },
        new Group(),
      ),
    ).toThrow(RangeError);
  });
});

describe("FOLLOW_RIG_SERIALIZER", () => {
  it("is assignable to the ComponentSerializer contract it targets", () => {
    const mirror: ComponentSerializerMirror<FollowRig> = FOLLOW_RIG_SERIALIZER;

    expect(
      mirror.deserialize(mirror.serialize(new FollowRig()), new Group()),
    ).toBeInstanceOf(FollowRig);
  });

  it("round-trips the offset, the frame and the spring's coefficients", () => {
    const rig = new FollowRig({
      target: new Vector3(0, 1, 0),
      offset: new Vector3(0, 2, 5),
      frame: "target",
      spring: new SpringDamper({ frequencyHz: 2.5, dampingRatio: 0.8 }),
    });
    const payload = FOLLOW_RIG_SERIALIZER.serialize(rig);
    expect(payload).toEqual({
      offset: { x: 0, y: 2, z: 5 },
      frame: "target",
      spring: {
        stiffness: rig.spring?.stiffness,
        damping: rig.spring?.damping,
      },
      target: { x: 0, y: 1, z: 0 },
    });

    const restored = FOLLOW_RIG_SERIALIZER.deserialize(
      JSON.parse(JSON.stringify(payload)) as JsonValue,
      new Group(),
    );
    expect(restored.offset.equalsApprox(new Vector3(0, 2, 5), 0)).toBe(true);
    expect(restored.frame).toBe("target");
    // Coefficient form, so the tuning survives bit for bit rather than through
    // a square root and a division by 2π.
    expect(restored.spring?.stiffness).toBe(rig.spring?.stiffness);
    expect(restored.spring?.damping).toBe(rig.spring?.damping);
    expect(restored.smoothing).toBe(false);
  });

  it("omits an absent spring, which is a different rig from a stiff one", () => {
    const payload = FOLLOW_RIG_SERIALIZER.serialize(new FollowRig()) as Record<
      string,
      JsonValue
    >;

    expect(payload).toEqual({ offset: { x: 0, y: 0, z: 0 }, frame: "world" });
    expect(FOLLOW_RIG_SERIALIZER.deserialize(payload, new Group()).spring).toBe(
      null,
    );
  });

  it("drops a live Node target and defaults an unknown frame to world", () => {
    const rig = new FollowRig({ target: new Group(), frame: "target" });
    const payload = FOLLOW_RIG_SERIALIZER.serialize(rig) as Record<
      string,
      JsonValue
    >;
    expect("target" in payload).toBe(false);

    const restored = FOLLOW_RIG_SERIALIZER.deserialize(
      { frame: "sideways", spring: "fast" },
      new Group(),
    );
    expect(restored.frame).toBe("world");
    expect(restored.spring).toBe(null);
    expect(restored.target).toBe(null);
  });

  it("defaults a spring's damping when only its stiffness is carried", () => {
    const restored = FOLLOW_RIG_SERIALIZER.deserialize(
      { spring: { stiffness: 64 } },
      new Group(),
    );

    expect(restored.spring?.stiffness).toBe(64);
    expect(restored.spring?.damping).toBe(0);
  });
});

describe("LOOK_AT_CONSTRAINT_SERIALIZER", () => {
  it("is assignable to the ComponentSerializer contract it targets", () => {
    const mirror: ComponentSerializerMirror<LookAtConstraint> =
      LOOK_AT_CONSTRAINT_SERIALIZER;

    expect(
      mirror.deserialize(mirror.serialize(new LookAtConstraint()), new Group()),
    ).toBeInstanceOf(LookAtConstraint);
  });

  it("round-trips the up direction, the slew limit and a point target", () => {
    const aim = new LookAtConstraint({
      target: new Vector3(4, 0, -2),
      up: new Vector3(0, 0, 1),
      maxAngularSpeed: 2.5,
    });
    const payload = LOOK_AT_CONSTRAINT_SERIALIZER.serialize(aim);
    expect(payload).toEqual({
      up: { x: 0, y: 0, z: 1 },
      maxAngularSpeed: 2.5,
      target: { x: 4, y: 0, z: -2 },
    });

    const restored = LOOK_AT_CONSTRAINT_SERIALIZER.deserialize(
      JSON.parse(JSON.stringify(payload)) as JsonValue,
      new Group(),
    );
    expect(restored.up.equalsApprox(new Vector3(0, 0, 1), 0)).toBe(true);
    expect(restored.maxAngularSpeed).toBe(2.5);
    expect(
      (restored.target as Vector3).equalsApprox(new Vector3(4, 0, -2), 0),
    ).toBe(true);
  });

  it("treats an absent slew limit as unlimited on both sides", () => {
    const payload = LOOK_AT_CONSTRAINT_SERIALIZER.serialize(
      new LookAtConstraint({ target: new Group() }),
    ) as Record<string, JsonValue>;

    expect(payload).toEqual({ up: { x: 0, y: 1, z: 0 } });
    const restored = LOOK_AT_CONSTRAINT_SERIALIZER.deserialize(
      payload,
      new Group(),
    );
    expect(restored.maxAngularSpeed).toBeUndefined();
    expect(restored.target).toBe(null);
  });

  it("is total for shape and refusing for range (§79 vs §85)", () => {
    // A component of the `up` vector that is not a number reads as zero, which
    // still leaves a usable direction here.
    const restored = LOOK_AT_CONSTRAINT_SERIALIZER.deserialize(
      { up: { x: "north", y: 2, z: 3 }, maxAngularSpeed: "quick" },
      new Group(),
    );
    expect(restored.up.equalsApprox(new Vector3(0, 2, 3), 0)).toBe(true);
    expect(restored.maxAngularSpeed).toBeUndefined();

    // A zero `up`, or a slew limit that can never reach its aim, is refused.
    expect(() =>
      LOOK_AT_CONSTRAINT_SERIALIZER.deserialize(
        { up: { x: 0, y: 0, z: 0 } },
        new Group(),
      ),
    ).toThrow(RangeError);
    expect(() =>
      LOOK_AT_CONSTRAINT_SERIALIZER.deserialize(
        { maxAngularSpeed: -3 },
        new Group(),
      ),
    ).toThrow(RangeError);
  });
});
