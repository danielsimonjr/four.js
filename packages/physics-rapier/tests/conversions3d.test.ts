/**
 * The §21/P5-3 mapping onto Rapier 3D (`src/conversions3d.ts`).
 *
 * The shape constructors trap into wasm, so the whole file runs after a real
 * `initializeRapier3d()` — there is no mock Rapier anywhere in this package.
 */

import { FourError } from "@four/core";
import { Matrix3, Quaternion, Vector2, Vector3 } from "@four/math";
import { ALL_COLLISION_GROUPS } from "@four/physics";
import type { CollisionShape } from "@four/physics";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createRapierColliderDesc3d,
  createRapierRotation3,
  createRapierShape3d,
  createRapierVector3,
  fromRapierRotation3,
  fromRapierVector3,
  packInteractionGroups3d,
  requireHullDesc3d,
  rotateVectorByRotation3,
  toPrincipalInertia3d,
  toRapierAngularVector3,
  toRapierBodyType3d,
  toRapierRotation3,
  toRapierVector3,
} from "../src/conversions3d.js";
import { RAPIER_3D, initializeRapier3d } from "../src/init.js";

beforeAll(async () => {
  await initializeRapier3d();
});

describe("vector mapping", () => {
  it("copies a Vector3 into Rapier's { x, y, z }", () => {
    const out = createRapierVector3();
    expect(toRapierVector3("position", new Vector3(3, -4, 5), out)).toBe(out);
    expect(out).toEqual({ x: 3, y: -4, z: 5 });
  });

  it("widens a Vector2 to z = 0 (§21)", () => {
    const out = createRapierVector3();
    toRapierVector3("position", new Vector2(1, 2), out);
    expect(out).toEqual({ x: 1, y: 2, z: 0 });
  });

  it("accepts a non-zero z, unlike the 2D mapping", () => {
    const out = createRapierVector3();
    expect(() =>
      toRapierVector3("position", new Vector3(1, 2, 3), out),
    ).not.toThrow();
    expect(out.z).toBe(3);
  });

  it("rejects non-finite components (§85)", () => {
    const out = createRapierVector3();
    expect(() =>
      toRapierVector3("linearVelocity", new Vector3(Number.NaN, 0, 0), out),
    ).toThrowError(/must be finite/u);
    expect(() =>
      toRapierVector3(
        "linearVelocity",
        new Vector3(0, 0, Number.POSITIVE_INFINITY),
        out,
      ),
    ).toThrowError(/must be finite/u);
  });

  it("reads a Rapier vector back as a Vector3", () => {
    const out = new Vector3(9, 9, 9);
    expect(fromRapierVector3({ x: 5, y: 6, z: 7 }, out)).toBe(out);
    expect([out.x, out.y, out.z]).toEqual([5, 6, 7]);
  });
});

describe("rotation mapping", () => {
  it("copies a quaternion component for component", () => {
    const out = createRapierRotation3();
    const quaternion = new Quaternion(0.1, 0.2, 0.3, 0.9273618495495704);
    expect(toRapierRotation3(quaternion, new Quaternion(), out)).toBe(out);
    expect(out.x).toBeCloseTo(0.1, 12);
    expect(out.y).toBeCloseTo(0.2, 12);
    expect(out.z).toBeCloseTo(0.3, 12);
    expect(out.w).toBeCloseTo(0.9273618495495704, 12);
  });

  it("treats a scalar angle as radians about +Z (§7a)", () => {
    const out = createRapierRotation3();
    toRapierRotation3(Math.PI / 2, new Quaternion(), out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(out.w).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("does not reject an out-of-plane quaternion, unlike a 2D world", () => {
    const out = createRapierRotation3();
    expect(() =>
      toRapierRotation3(
        new Quaternion(0.5, 0, 0, 0.866),
        new Quaternion(),
        out,
      ),
    ).not.toThrow();
    expect(out.x).toBe(0.5);
  });

  it("rejects a non-finite angle (§85)", () => {
    expect(() =>
      toRapierRotation3(Number.NaN, new Quaternion(), createRapierRotation3()),
    ).toThrowError(FourError);
  });

  it("round-trips a rotation through both directions", () => {
    const source = new Quaternion()
      .setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.1)
      .normalize();
    const rapier = toRapierRotation3(
      source,
      new Quaternion(),
      createRapierRotation3(),
    );
    const back = fromRapierRotation3(rapier, new Quaternion());
    expect(back.x).toBeCloseTo(source.x, 12);
    expect(back.y).toBeCloseTo(source.y, 12);
    expect(back.z).toBeCloseTo(source.z, 12);
    expect(back.w).toBeCloseTo(source.w, 12);
  });

  it("reads a Rapier rotation back without renormalizing it", () => {
    const out = new Quaternion();
    // A deliberately non-unit record: the reader must not silently fix it, so
    // that a solver problem would be visible rather than hidden.
    expect(fromRapierRotation3({ x: 0, y: 0, z: 0, w: 2 }, out)).toBe(out);
    expect(out.w).toBe(2);
  });
});

describe("angular vector mapping", () => {
  it("keeps all three axes, unlike the 2D scalar mapping", () => {
    const out = createRapierVector3();
    toRapierAngularVector3(new Vector3(1, -2, 3), new Vector3(), out);
    expect(out).toEqual({ x: 1, y: -2, z: 3 });
  });

  it("widens a scalar rate to (0, 0, w) about +Z", () => {
    const out = createRapierVector3();
    toRapierAngularVector3(2.5, new Vector3(), out);
    expect(out).toEqual({ x: 0, y: 0, z: 2.5 });
  });

  it("rejects a non-finite scalar rate (§85)", () => {
    expect(() =>
      toRapierAngularVector3(
        Number.POSITIVE_INFINITY,
        new Vector3(),
        createRapierVector3(),
      ),
    ).toThrowError(FourError);
  });
});

describe("body type mapping (§22)", () => {
  it("maps every §22 type onto Rapier's 3D enum", () => {
    expect(toRapierBodyType3d("static")).toBe(RAPIER_3D.RigidBodyType.Fixed);
    expect(toRapierBodyType3d("dynamic")).toBe(RAPIER_3D.RigidBodyType.Dynamic);
    expect(toRapierBodyType3d("kinematic-position")).toBe(
      RAPIER_3D.RigidBodyType.KinematicPositionBased,
    );
    expect(toRapierBodyType3d("kinematic-velocity")).toBe(
      RAPIER_3D.RigidBodyType.KinematicVelocityBased,
    );
  });

  it("rejects an unknown body type reaching it from JavaScript", () => {
    expect(() =>
      toRapierBodyType3d("ghost" as unknown as "static"),
    ).toThrowError(/Unknown body type/u);
  });
});

describe("inertia tensor mapping (§23, WP-5.5 decision)", () => {
  it("reads the principal moments off a diagonal tensor", () => {
    const tensor = new Matrix3();
    // Column-major: the diagonal is elements 0, 4, 8.
    tensor.elements[0] = 2;
    tensor.elements[4] = 3;
    tensor.elements[8] = 5;
    const out = createRapierVector3();
    expect(toPrincipalInertia3d(tensor, out)).toBe(out);
    expect(out).toEqual({ x: 2, y: 3, z: 5 });
  });

  it("rejects every off-diagonal entry rather than dropping it", () => {
    for (const index of [1, 2, 3, 5, 6, 7]) {
      const tensor = new Matrix3();
      tensor.elements[index] = 0.5;
      expect(() =>
        toPrincipalInertia3d(tensor, createRapierVector3()),
      ).toThrowError(/inertiaTensor must be diagonal/u);
    }
  });

  it("reports which element offended", () => {
    const tensor = new Matrix3();
    tensor.elements[5] = -1;
    try {
      toPrincipalInertia3d(tensor, createRapierVector3());
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(FourError);
      expect((error as FourError).message).toMatch(/element 5 is -1/u);
    }
  });
});

describe("interaction group packing (§24)", () => {
  it("packs the all-groups sentinel into every bit of both halves", () => {
    expect(
      packInteractionGroups3d(ALL_COLLISION_GROUPS, ALL_COLLISION_GROUPS),
    ).toBe(0xffffffff);
  });

  it("puts membership in the high half and the filter in the low half", () => {
    expect(packInteractionGroups3d(0x0001, 0x0002)).toBe(0x00010002);
    expect(packInteractionGroups3d(0x00ff, 0xff00)).toBe(0x00ffff00);
  });

  it("rejects a group above bit 15 rather than truncating it to nothing", () => {
    expect(() => packInteractionGroups3d(0x10000, 1)).toThrowError(
      /collisionGroups must be an integer in \[0, 65535\]/u,
    );
    expect(() => packInteractionGroups3d(1, -1)).toThrowError(
      /collisionMask must be an integer/u,
    );
    expect(() => packInteractionGroups3d(1, 1.5)).toThrowError(
      /collisionMask must be an integer/u,
    );
  });
});

describe("quaternion point rotation", () => {
  it("leaves a point alone under the identity rotation", () => {
    const out = createRapierVector3();
    rotateVectorByRotation3(
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 1, y: 2, z: 3 },
      out,
    );
    expect(out).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("turns +X onto +Y for a quarter turn about +Z (§7a right-handed)", () => {
    const out = createRapierVector3();
    rotateVectorByRotation3(
      { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
      { x: 1, y: 0, z: 0 },
      out,
    );
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(1, 12);
    expect(out.z).toBeCloseTo(0, 12);
  });

  it("turns +Z onto +X for a quarter turn about +Y", () => {
    const out = createRapierVector3();
    rotateVectorByRotation3(
      { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      { x: 0, y: 0, z: 1 },
      out,
    );
    expect(out.x).toBeCloseTo(1, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(0, 12);
  });

  it("agrees with @four/math's own quaternion for a random rotation", () => {
    const rotation = new Quaternion()
      .setFromAxisAngle(new Vector3(0.3, -0.5, 0.81).normalize(), 2.2)
      .normalize();
    const point = new Vector3(1.5, -0.25, 0.75);
    const out = createRapierVector3();
    rotateVectorByRotation3(rotation, point, out);

    // The reference: q * (0, p) * q⁻¹, computed with @four/math's multiply.
    const conjugate = rotation.clone().conjugate();
    const expected = rotation
      .clone()
      .multiply(new Quaternion(point.x, point.y, point.z, 0))
      .multiply(conjugate);
    expect(out.x).toBeCloseTo(expected.x, 10);
    expect(out.y).toBeCloseTo(expected.y, 10);
    expect(out.z).toBeCloseTo(expected.z, 10);
  });
});

describe("shape mapping (§24 3D list, PH-22a)", () => {
  /** The convex tier — everything `createRapierShape3d` can also build. */
  const convexShapes: CollisionShape[] = [
    { type: "sphere", radius: 0.5 },
    { type: "box", halfExtents: new Vector3(1, 2, 3) },
    { type: "capsule", radius: 0.25, halfHeight: 1 },
    { type: "cylinder", radius: 0.25, halfHeight: 1 },
    { type: "cone", radius: 0.25, halfHeight: 1 },
    {
      type: "convex-hull",
      points: [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
      ],
    },
  ];

  /** The composite tier — collider descriptors only (see `validateQueryShape`). */
  const compositeShapes: CollisionShape[] = [
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
      columns: 2,
      heights: [0, 1, 2, 3],
      scale: new Vector3(2, 1, 2),
    },
  ];

  it("builds a Rapier shape for every convex 3D shape", () => {
    for (const shape of convexShapes) {
      expect(createRapierShape3d(shape)).toBeTypeOf("object");
    }
    expect(convexShapes).toHaveLength(6);
  });

  it("builds a Rapier collider descriptor for every §24 3D shape", () => {
    for (const shape of [...convexShapes, ...compositeShapes]) {
      expect(createRapierColliderDesc3d(shape)).toBeTypeOf("object");
    }
    // §24's 3D list is nine entries; `compound` is several colliders on one
    // body rather than a shape, so eight tags reach this conversion.
    expect(convexShapes.length + compositeShapes.length).toBe(8);
  });

  it("accepts a degenerate cloud, because Rapier 0.19.3 does (measured)", () => {
    // The `null` branch in `createRapierColliderDesc3d` is defensive, exactly
    // like the 2D polygon one: at 0.19.3 `ColliderDesc.convexHull` returns a
    // descriptor for coplanar, collinear, identical, and 1e-9-scale point
    // clouds alike — measured 2026-08-08, all four. Pinning that here means a
    // Rapier upgrade that starts refusing them turns this test red rather
    // than silently changing what a hull means.
    for (const points of [
      // coplanar
      [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(1, 1, 0),
        new Vector3(0, 1, 0),
      ],
      // collinear
      [
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(2, 0, 0),
        new Vector3(3, 0, 0),
      ],
      // four copies of one point
      [
        new Vector3(0, 0, 0),
        new Vector3(0, 0, 0),
        new Vector3(0, 0, 0),
        new Vector3(0, 0, 0),
      ],
    ]) {
      const shape: CollisionShape = { type: "convex-hull", points };
      expect(createRapierColliderDesc3d(shape)).toBeTypeOf("object");
    }
  });

  it("translates a null hull descriptor into a FourError", () => {
    // The branch `requireHullDesc3d` exists for cannot be produced by 0.19.3
    // (see the test above), so its contract is asserted directly.
    expect(() => requireHullDesc3d(null, "convex-hull")).toThrowError(
      /could not build a convex hull/u,
    );
    expect(() => requireHullDesc3d(null, "convex-hull")).toThrowError(
      FourError,
    );
    const desc = createRapierColliderDesc3d({ type: "sphere", radius: 1 });
    expect(requireHullDesc3d(desc, "convex-hull")).toBe(desc);
  });

  it("hands Rapier subdivisions where the shape counts samples", () => {
    // A 2×3-sample field is a 1×2-subdivision Rapier heightfield, and Rapier
    // wants (1+1)·(2+1) = 6 heights — exactly `rows · columns`. Building it
    // proves the conversion, because a mismatched count traps in wasm.
    expect(() =>
      createRapierColliderDesc3d({
        type: "height-field",
        rows: 2,
        columns: 3,
        heights: [0, 1, 2, 3, 4, 5],
        scale: new Vector3(4, 1, 6),
      }),
    ).not.toThrow();
  });

  it("rejects a 2D shape in a 3D world (§21, §24)", () => {
    const circle: CollisionShape = { type: "circle", radius: 1 };
    expect(() => createRapierShape3d(circle)).toThrowError(
      /circle shape is not valid in a "3d" world/u,
    );
    expect(() => createRapierColliderDesc3d(circle)).toThrowError(
      /circle shape is not valid in a "3d" world/u,
    );
    expect(() => createRapierColliderDesc3d(circle)).toThrowError(FourError);

    const rectangle: CollisionShape = {
      type: "rectangle",
      halfExtents: new Vector2(1, 1),
    };
    expect(() => createRapierShape3d(rectangle)).toThrowError(
      /rectangle shape is not valid in a "3d" world/u,
    );
  });
});
