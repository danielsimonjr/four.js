import { isFourError } from "@four/core";
import { Vector2, Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import type { CollisionShape } from "../src/shapes.js";
import {
  COLLISION_SHAPE_TYPES_2D,
  COLLISION_SHAPE_TYPES_3D,
  shapeSupportsDimension,
  validateCollisionShape,
} from "../src/shapes.js";

/** Asserts that `run` throws a `FourError` with the §89 invalid-input code. */
function expectFourError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as Error & { code: string };
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

const circle: CollisionShape = { type: "circle", radius: 1 };
const rectangle: CollisionShape = {
  type: "rectangle",
  halfExtents: new Vector2(1, 2),
};
const capsule: CollisionShape = { type: "capsule", radius: 0.5, halfHeight: 1 };
const squareVertices = [
  new Vector2(0, 0),
  new Vector2(1, 0),
  new Vector2(1, 1),
  new Vector2(0, 1),
];
const square: CollisionShape = { type: "polygon", vertices: squareVertices };
const sphere: CollisionShape = { type: "sphere", radius: 1 };
const box: CollisionShape = { type: "box", halfExtents: new Vector3(1, 2, 3) };

describe("P5-6 shape tier", () => {
  it("lists exactly the shipped shape tags", () => {
    expect(COLLISION_SHAPE_TYPES_2D).toEqual([
      "circle",
      "rectangle",
      "capsule",
      "polygon",
    ]);
    expect(COLLISION_SHAPE_TYPES_3D).toEqual(["sphere", "box", "capsule"]);
  });

  it("does not make the staged §24 shapes representable (plan P5-6)", () => {
    // A shape the engine refuses to build must not be expressible: these are
    // compile errors, which is the whole point of staging them out of the
    // union rather than validating them out at runtime.

    // @ts-expect-error - "polyline" is staged to a later packet (§24, P5-6).
    const polyline: CollisionShape = { type: "polyline", vertices: [] };
    // @ts-expect-error - "chain" is staged to a later packet (§24, P5-6).
    const chain: CollisionShape = { type: "chain", vertices: [] };
    // prettier-ignore
    // @ts-expect-error - "cylinder" is staged to a later packet (§24, P5-6).
    const cylinder: CollisionShape = { type: "cylinder", radius: 1, halfHeight: 1 };
    // @ts-expect-error - "cone" is staged to a later packet (§24, P5-6).
    const cone: CollisionShape = { type: "cone", radius: 1, halfHeight: 1 };
    // @ts-expect-error - "convex-hull" is staged to a later packet (§24, P5-6).
    const hull: CollisionShape = { type: "convex-hull", points: [] };
    // @ts-expect-error - "trimesh" is staged to a later packet (§24, P5-6).
    const trimesh: CollisionShape = { type: "trimesh", vertices: [] };
    // @ts-expect-error - "heightfield" is staged to a later packet (§24, P5-6).
    const heightfield: CollisionShape = { type: "heightfield", heights: [] };
    // @ts-expect-error - "compound" is staged to a later packet (§24, P5-6).
    const compound: CollisionShape = { type: "compound", children: [] };

    expect([
      polyline,
      chain,
      cylinder,
      cone,
      hull,
      trimesh,
      heightfield,
      compound,
    ]).toHaveLength(8);
  });

  it("rejects a staged shape that reaches the validator from JavaScript", () => {
    const error = expectFourError(() => {
      validateCollisionShape({ type: "cylinder" } as unknown as CollisionShape);
    });
    expect(error.message).toContain("Unknown collision shape");
  });
});

describe("shapeSupportsDimension (§21, §24)", () => {
  it("places each 2D shape in 2D only", () => {
    for (const shape of [circle, rectangle, square]) {
      expect(shapeSupportsDimension(shape, "2d")).toBe(true);
      expect(shapeSupportsDimension(shape, "3d")).toBe(false);
    }
  });

  it("places each 3D shape in 3D only", () => {
    for (const shape of [sphere, box]) {
      expect(shapeSupportsDimension(shape, "3d")).toBe(true);
      expect(shapeSupportsDimension(shape, "2d")).toBe(false);
    }
  });

  it("accepts a capsule in both dimensions", () => {
    expect(shapeSupportsDimension(capsule, "2d")).toBe(true);
    expect(shapeSupportsDimension(capsule, "3d")).toBe(true);
  });
});

describe("validateCollisionShape — dimensions (§21)", () => {
  it("accepts every shipped shape in its own dimension", () => {
    for (const shape of [circle, rectangle, capsule, square]) {
      expect(() => {
        validateCollisionShape(shape, "2d");
      }).not.toThrow();
    }
    for (const shape of [sphere, box, capsule]) {
      expect(() => {
        validateCollisionShape(shape, "3d");
      }).not.toThrow();
    }
  });

  it("accepts any shipped shape when no dimension is given", () => {
    expect(() => {
      validateCollisionShape(circle);
    }).not.toThrow();
    expect(() => {
      validateCollisionShape(sphere);
    }).not.toThrow();
  });

  it("rejects a circle in a 3d world and a sphere in a 2d world", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape(circle, "3d");
      }).message,
    ).toContain('not valid in a "3d" world');
    expect(
      expectFourError(() => {
        validateCollisionShape(sphere, "2d");
      }).message,
    ).toContain('not valid in a "2d" world');
  });
});

describe("validateCollisionShape — parameters (§24, §85)", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a circle radius of %s",
    (radius) => {
      expectFourError(() => {
        validateCollisionShape({ type: "circle", radius });
      });
    },
  );

  it("rejects a non-positive sphere radius", () => {
    expectFourError(() => {
      validateCollisionShape({ type: "sphere", radius: 0 });
    });
  });

  it("rejects non-positive rectangle half extents on either axis", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "rectangle",
          halfExtents: new Vector2(0, 1),
        });
      }).message,
    ).toContain("halfExtents.x");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "rectangle",
          halfExtents: new Vector2(1, -2),
        });
      }).message,
    ).toContain("halfExtents.y");
  });

  it("rejects non-positive box half extents on any axis", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "box",
          halfExtents: new Vector3(0, 1, 1),
        });
      }).message,
    ).toContain("halfExtents.x");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "box",
          halfExtents: new Vector3(1, 0, 1),
        });
      }).message,
    ).toContain("halfExtents.y");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "box",
          halfExtents: new Vector3(1, 1, Number.NaN),
        });
      }).message,
    ).toContain("halfExtents.z");
  });

  it("rejects a capsule with a non-positive radius or half height", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({ type: "capsule", radius: 0, halfHeight: 1 });
      }).message,
    ).toContain("radius");
    expect(
      expectFourError(() => {
        validateCollisionShape({ type: "capsule", radius: 1, halfHeight: 0 });
      }).message,
    ).toContain("halfHeight");
  });
});

describe("validateCollisionShape — polygons (§24, §85)", () => {
  it("accepts a convex polygon in either winding", () => {
    expect(() => {
      validateCollisionShape(square, "2d");
    }).not.toThrow();
    expect(() => {
      validateCollisionShape({
        type: "polygon",
        vertices: [...squareVertices].reverse(),
      });
    }).not.toThrow();
  });

  it("tolerates a collinear (redundant) vertex", () => {
    expect(() => {
      validateCollisionShape({
        type: "polygon",
        vertices: [
          new Vector2(0, 0),
          new Vector2(1, 0),
          new Vector2(2, 0),
          new Vector2(2, 1),
          new Vector2(0, 1),
        ],
      });
    }).not.toThrow();
  });

  it("rejects fewer than three vertices", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [new Vector2(0, 0), new Vector2(1, 0)],
        });
      }).message,
    ).toContain("at least 3 vertices");
  });

  it("rejects a non-finite vertex", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [
            new Vector2(0, 0),
            new Vector2(Number.NaN, 0),
            new Vector2(1, 1),
          ],
        });
      }).message,
    ).toContain("vertex 1");
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [
            new Vector2(0, 0),
            new Vector2(1, Number.POSITIVE_INFINITY),
            new Vector2(1, 1),
          ],
        });
      }).message,
    ).toContain("vertex 1");
  });

  it("rejects a zero-length edge from two identical vertices", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [new Vector2(0, 0), new Vector2(0, 0), new Vector2(1, 1)],
        });
      }).message,
    ).toContain("zero-length edge");
  });

  it("rejects a concave outline and names the staged alternatives", () => {
    const error = expectFourError(() => {
      validateCollisionShape({
        type: "polygon",
        vertices: [
          new Vector2(0, 0),
          new Vector2(2, 0),
          new Vector2(2, 2),
          new Vector2(1, 1),
          new Vector2(0, 2),
        ],
      });
    });
    expect(error.message).toContain("not convex");
    expect(error.message).toContain("polyline");
  });

  it("rejects an outline whose vertices are all collinear", () => {
    expect(
      expectFourError(() => {
        validateCollisionShape({
          type: "polygon",
          vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(2, 0)],
        });
      }).message,
    ).toContain("encloses no area");
  });
});
