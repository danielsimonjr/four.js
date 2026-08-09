/**
 * `computeWorldBoundingSphere` — §87's world bounds (R-8).
 *
 * The assertions are analytic: a unit box's circumradius is `√3 / 2`, a plane's
 * is `√2 / 2`, and a rotation must not change either. That is the same oracle
 * `tessellation.test.ts` uses — a number derived independently of the code
 * under test — rather than a recorded snapshot, which would only pin whatever
 * the implementation happened to produce.
 */

import { BufferGeometry, boxGeometry, planeGeometry } from "@four/geometry";
import { Matrix4, Quaternion, Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  computeWorldBoundingSphere,
  type BoundingSphere,
} from "../src/index.js";

/** A fresh out-record, so no test can pass on another's leftovers. */
function sphere(): BoundingSphere {
  return { center: new Vector3(), radius: 0 };
}

/** `compose`, spelled for the three cases below. */
function transform(
  position: Vector3,
  rotation = new Quaternion(),
  scale = new Vector3(1, 1, 1),
): Matrix4 {
  return new Matrix4().compose(position, rotation, scale, new Vector3());
}

describe("computeWorldBoundingSphere — the sphere itself (§87)", () => {
  it("bounds a unit box at the origin with its circumradius", () => {
    const out = sphere();

    expect(computeWorldBoundingSphere(boxGeometry(), new Matrix4(), out)).toBe(
      true,
    );
    expect([out.center.x, out.center.y, out.center.z]).toEqual([0, 0, 0]);
    expect(out.radius).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });

  it("bounds a flat quad with its half-diagonal", () => {
    const out = sphere();

    computeWorldBoundingSphere(planeGeometry(), new Matrix4(), out);

    expect(out.radius).toBeCloseTo(Math.SQRT2 / 2, 12);
  });

  it("moves the centre with the transform and leaves the radius alone", () => {
    const out = sphere();

    computeWorldBoundingSphere(
      boxGeometry(),
      transform(new Vector3(3, -4, 5)),
      out,
    );

    expect([out.center.x, out.center.y, out.center.z]).toEqual([3, -4, 5]);
    expect(out.radius).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });

  it("scales the radius by the transform's scale", () => {
    const out = sphere();

    computeWorldBoundingSphere(
      boxGeometry(),
      transform(new Vector3(), new Quaternion(), new Vector3(2, 2, 2)),
      out,
    );

    expect(out.radius).toBeCloseTo(Math.sqrt(3), 12);
  });

  it("bounds an off-centre geometry around its own centroid, not its origin", () => {
    // The case a node-origin bound gets wrong: a box built at `x ∈ [10, 11]`
    // whose node sits at the origin.
    const geometry = new BufferGeometry({
      positions: new Float32Array([10, 0, 0, 11, 0, 0, 11, 1, 0]),
    });
    const out = sphere();

    computeWorldBoundingSphere(geometry, new Matrix4(), out);

    expect(out.center.x).toBeCloseTo(10.5, 12);
    expect(out.center.y).toBeCloseTo(0.5, 12);
  });
});

describe("computeWorldBoundingSphere — conservative under rotation (§87)", () => {
  it("never shrinks below the true bound, for any rotation of a long box", () => {
    // The property that matters: a bound that is too *small* culls something
    // visible. A 10 × 0.2 × 0.2 box is where a naive "longest column times the
    // local radius" estimate would fail, because the world AABB of a rotated
    // long box is much larger than the box.
    // Three vertices, because §53 refuses a non-indexed triangle geometry with
    // a vertex count that is not a multiple of three; the third sits inside the
    // box the first two define, so the bounds are `[-5, 5] x [-0.1, 0.1]²`.
    const geometry = new BufferGeometry({
      positions: new Float32Array([-5, -0.1, -0.1, 5, 0.1, 0.1, 0, 0, 0]),
    });
    const local = Math.hypot(5, 0.1, 0.1);
    const out = sphere();
    const rotation = new Quaternion();

    for (let step = 0; step <= 64; step += 1) {
      const angle = (step / 64) * Math.PI * 2;
      rotation.setFromAxisAngle(new Vector3(1, 2, 3).normalize(), angle);
      computeWorldBoundingSphere(
        geometry,
        transform(new Vector3(), rotation),
        out,
      );

      // A rigid rotation cannot change how far a vertex is from the centre, so
      // the true bound is the local one at every angle: the produced radius
      // must never be below it, and is allowed to be looser.
      expect(out.radius).toBeGreaterThanOrEqual(local - 1e-12);
      expect(out.radius).toBeLessThanOrEqual(local * Math.sqrt(3) + 1e-12);
    }
  });

  it("stays conservative under non-uniform scale plus rotation", () => {
    const geometry = boxGeometry();
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 4,
    );
    const matrix = transform(new Vector3(), rotation, new Vector3(4, 0.25, 1));
    const out = sphere();

    computeWorldBoundingSphere(geometry, matrix, out);

    // Every corner of the unit box, transformed, must be inside the sphere.
    const e = matrix.elements;
    for (let bits = 0; bits < 8; bits += 1) {
      const x = bits & 1 ? 0.5 : -0.5;
      const y = bits & 2 ? 0.5 : -0.5;
      const z = bits & 4 ? 0.5 : -0.5;
      const distance = Math.hypot(
        e[0] * x + e[4] * y + e[8] * z + e[12] - out.center.x,
        e[1] * x + e[5] * y + e[9] * z + e[13] - out.center.y,
        e[2] * x + e[6] * y + e[10] * z + e[14] - out.center.z,
      );
      expect(distance).toBeLessThanOrEqual(out.radius + 1e-12);
    }
  });
});

describe("computeWorldBoundingSphere — the three refusals (§61, §85)", () => {
  it("refuses an empty geometry, whose box is the union identity", () => {
    const out = sphere();

    expect(
      computeWorldBoundingSphere(
        new BufferGeometry({ positions: new Float32Array(0) }),
        new Matrix4(),
        out,
      ),
    ).toBe(false);
  });

  it("refuses a disposed geometry, for the same reason", () => {
    const geometry = boxGeometry();
    geometry.dispose();

    expect(computeWorldBoundingSphere(geometry, new Matrix4(), sphere())).toBe(
      false,
    );
  });

  it("refuses a world matrix carrying NaN rather than hiding the node", () => {
    const matrix = new Matrix4();
    matrix.elements[12] = NaN;

    expect(computeWorldBoundingSphere(boxGeometry(), matrix, sphere())).toBe(
      false,
    );
  });

  it("refuses a structurally-typed geometry with no computeBounds", () => {
    // The `TestGeometry` case: a double written before §87 existed. A missing
    // method must read as "cannot be bounded", never as a `TypeError` inside a
    // frame (§61).
    const double = { positions: new Float32Array([0, 0, 0]) };

    expect(
      computeWorldBoundingSphere(
        double as unknown as BufferGeometry,
        new Matrix4(),
        sphere(),
      ),
    ).toBe(false);
  });

  it("leaves a zero-size geometry as a point-sized sphere, not a refusal", () => {
    // One vertex is a legal, bounded geometry: radius 0, centre at the vertex.
    const out = sphere();

    expect(
      computeWorldBoundingSphere(
        new BufferGeometry({
          positions: new Float32Array([1, 2, 3, 1, 2, 3, 1, 2, 3]),
        }),
        new Matrix4(),
        out,
      ),
    ).toBe(true);
    expect(out.radius).toBe(0);
    expect([out.center.x, out.center.y, out.center.z]).toEqual([1, 2, 3]);
  });
});

describe("computeWorldBoundingSphere — allocation (§7b, plan D7)", () => {
  it("writes into the caller's record and returns nothing new", () => {
    const out = sphere();
    const center = out.center;

    computeWorldBoundingSphere(boxGeometry(), new Matrix4(), out);
    computeWorldBoundingSphere(
      planeGeometry(),
      transform(new Vector3(1, 0, 0)),
      out,
    );

    expect(out.center).toBe(center);
    expect(out.center.x).toBe(1);
  });
});
