/**
 * The §21/P5-3 3D↔2D mapping (`src/conversions2d.ts`).
 *
 * The shape constructors trap into wasm, so the whole file runs after a real
 * `initializeRapier2d()` — there is no mock Rapier anywhere in this package.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector2, Vector3 } from "@four/math";
import { ALL_COLLISION_GROUPS } from "@four/physics";
import type { CollisionShape } from "@four/physics";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createRapierColliderDesc,
  createRapierShape,
  createRapierVector2,
  fromRapierAngle,
  fromRapierVector2,
  packInteractionGroups,
  quaternionToAngleZ,
  toRapierAngle,
  toRapierAngularScalar,
  toRapierBodyType,
  toRapierVector2,
} from "../src/conversions2d.js";
import { RAPIER_2D, initializeRapier2d } from "../src/init.js";

beforeAll(async () => {
  await initializeRapier2d();
});

describe("vector mapping", () => {
  it("widens a Vector2 into Rapier's { x, y }", () => {
    const out = createRapierVector2();
    expect(toRapierVector2("position", new Vector2(3, -4), out)).toBe(out);
    expect(out).toEqual({ x: 3, y: -4 });
  });

  it("accepts a Vector3 that lies in the XY plane", () => {
    const out = createRapierVector2();
    toRapierVector2("position", new Vector3(1, 2, 0), out);
    expect(out).toEqual({ x: 1, y: 2 });
  });

  it("rejects a Vector3 with a z component instead of projecting it (§21, §85)", () => {
    const out = createRapierVector2();
    expect(() =>
      toRapierVector2("position", new Vector3(1, 2, 3), out),
    ).toThrowError(/position\.z must be 0/u);
  });

  it("rejects non-finite components (§85)", () => {
    const out = createRapierVector2();
    expect(() =>
      toRapierVector2("linearVelocity", new Vector2(Number.NaN, 0), out),
    ).toThrowError(/must be finite/u);
  });

  it("reads a Rapier vector back as a Vector3 with z = 0", () => {
    const out = new Vector3(9, 9, 9);
    expect(fromRapierVector2({ x: 5, y: 6 }, out)).toBe(out);
    expect([out.x, out.y, out.z]).toEqual([5, 6, 0]);
  });
});

describe("rotation mapping", () => {
  it("maps a pure +Z quaternion to 2 * atan2(z, w)", () => {
    const angle = Math.PI / 3;
    const quaternion = new Quaternion(
      0,
      0,
      Math.sin(angle / 2),
      Math.cos(angle / 2),
    );
    expect(quaternionToAngleZ(quaternion)).toBeCloseTo(angle, 12);
  });

  it("maps an angle back to a rotation about +Z", () => {
    const out = new Quaternion();
    expect(fromRapierAngle(Math.PI / 2, out)).toBe(out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(out.w).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("round-trips angle -> quaternion -> angle", () => {
    const scratch = new Quaternion();
    for (const angle of [-3, -0.5, 0, 0.25, 1.75, 3.1]) {
      fromRapierAngle(angle, scratch);
      expect(toRapierAngle(scratch, new Quaternion())).toBeCloseTo(angle, 12);
    }
  });

  it("passes a scalar angle straight through", () => {
    expect(toRapierAngle(1.25, new Quaternion())).toBe(1.25);
  });

  it("rejects a quaternion that is not a pure Z rotation (§21)", () => {
    expect(() =>
      toRapierAngle(new Quaternion(0.5, 0, 0, 0.866), new Quaternion()),
    ).toThrowError(/must have x = y = 0/u);
  });
});

describe("angular scalar mapping", () => {
  it("passes a scalar rate through", () => {
    expect(toRapierAngularScalar(2.5, new Vector3())).toBe(2.5);
  });

  it("reads the z component of a planar Vector3", () => {
    expect(toRapierAngularScalar(new Vector3(0, 0, -1.5), new Vector3())).toBe(
      -1.5,
    );
  });

  it("rejects an out-of-plane angular velocity (§21)", () => {
    expect(() =>
      toRapierAngularScalar(new Vector3(1, 0, 0), new Vector3()),
    ).toThrowError(/spins about \+Z only/u);
  });
});

describe("body type mapping (§22)", () => {
  it("maps every §22 type onto Rapier's enum", () => {
    expect(toRapierBodyType("static")).toBe(RAPIER_2D.RigidBodyType.Fixed);
    expect(toRapierBodyType("dynamic")).toBe(RAPIER_2D.RigidBodyType.Dynamic);
    expect(toRapierBodyType("kinematic-position")).toBe(
      RAPIER_2D.RigidBodyType.KinematicPositionBased,
    );
    expect(toRapierBodyType("kinematic-velocity")).toBe(
      RAPIER_2D.RigidBodyType.KinematicVelocityBased,
    );
  });

  it("rejects an unknown body type reaching it from JavaScript", () => {
    expect(() => toRapierBodyType("ghost" as unknown as "static")).toThrowError(
      /Unknown body type/u,
    );
  });
});

describe("interaction group packing (§24)", () => {
  it("packs the all-groups sentinel into every bit of both halves", () => {
    expect(
      packInteractionGroups(ALL_COLLISION_GROUPS, ALL_COLLISION_GROUPS),
    ).toBe(0xffffffff);
  });

  it("puts membership in the high half and the filter in the low half", () => {
    expect(packInteractionGroups(0x0001, 0x0002)).toBe(0x00010002);
    expect(packInteractionGroups(0x00ff, 0xff00)).toBe(0x00ffff00);
  });

  it("rejects a group above bit 15 rather than truncating it to nothing", () => {
    expect(() => packInteractionGroups(0x10000, 1)).toThrowError(
      /collisionGroups must be an integer in \[0, 65535\]/u,
    );
    expect(() => packInteractionGroups(1, -1)).toThrowError(
      /collisionMask must be an integer/u,
    );
    expect(() => packInteractionGroups(1, 1.5)).toThrowError(
      /collisionMask must be an integer/u,
    );
  });
});

describe("shape mapping (plan P5-6 tier)", () => {
  const shapes: CollisionShape[] = [
    { type: "circle", radius: 0.5 },
    { type: "rectangle", halfExtents: new Vector2(1, 2) },
    { type: "capsule", radius: 0.25, halfHeight: 1 },
    {
      type: "polygon",
      vertices: [
        new Vector2(-1, -1),
        new Vector2(1, -1),
        new Vector2(1, 1),
        new Vector2(-1, 1),
      ],
    },
  ];

  it("builds a Rapier shape for every 2D shape this phase ships", () => {
    for (const shape of shapes) {
      expect(createRapierShape(shape)).toBeTypeOf("object");
    }
  });

  it("builds a Rapier collider descriptor for every 2D shape", () => {
    for (const shape of shapes) {
      expect(createRapierColliderDesc(shape)).toBeTypeOf("object");
    }
  });

  it("accepts a polygon in either winding (the hull is recomputed)", () => {
    const clockwise: CollisionShape = {
      type: "polygon",
      vertices: [
        new Vector2(-1, 1),
        new Vector2(1, 1),
        new Vector2(1, -1),
        new Vector2(-1, -1),
      ],
    };
    expect(createRapierColliderDesc(clockwise)).toBeTypeOf("object");
    expect(createRapierShape(clockwise)).toBeTypeOf("object");
  });

  it("rejects a 3D shape in a 2D world (§21, §24)", () => {
    const sphere: CollisionShape = { type: "sphere", radius: 1 };
    expect(() => createRapierShape(sphere)).toThrowError(
      /sphere shape is not valid in a "2d" world/u,
    );
    expect(() => createRapierColliderDesc(sphere)).toThrowError(
      /sphere shape is not valid in a "2d" world/u,
    );
    expect(() => createRapierColliderDesc(sphere)).toThrowError(FourError);
  });
});
