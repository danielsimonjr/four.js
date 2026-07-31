import {
  constructionCount,
  Matrix4,
  Quaternion,
  resetConstructionCount,
  Vector3,
} from "@four/math";
import { describe, expect, it } from "vitest";

import { Transform } from "../src/index.js";

const IDENTITY_4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

const HALF_PI = Math.PI / 2;
const AXIS_Z = new Vector3(0, 0, 1);

function expectElementsCloseTo(
  actual: Matrix4,
  expected: ArrayLike<number>,
  digits = 12,
): void {
  for (let i = 0; i < 16; i += 1) {
    expect(actual.elements[i], `element ${i}`).toBeCloseTo(expected[i], digits);
  }
}

/**
 * Ground truth for the §7 composition: a freshly composed matrix built by
 * `Matrix4.compose`, which WP-1.3 verified against hand-constructed raw
 * numbers. `Transform` must agree with it exactly.
 */
function composed(t: Transform): Matrix4 {
  return new Matrix4().compose(t.position, t.rotation, t.scale, t.pivot);
}

/** Applies an affine `Matrix4` to the point `(x, y, z)`, reading `elements` only. */
function transformPoint(
  m: Matrix4,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const e = m.elements;
  return [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ];
}

describe("Transform defaults (§7)", () => {
  it("starts at the identity with unit scale and auto-update on", () => {
    const t = new Transform();

    expect([t.position.x, t.position.y, t.position.z]).toEqual([0, 0, 0]);
    expect([t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w]).toEqual([
      0, 0, 0, 1,
    ]);
    expect([t.scale.x, t.scale.y, t.scale.z]).toEqual([1, 1, 1]);
    expect([t.pivot.x, t.pivot.y, t.pivot.z]).toEqual([0, 0, 0]);
    expect(t.matrixAutoUpdate).toBe(true);
    expect(t.version).toBe(0);
    expect(t.worldVersion).toBe(0);
    expect(Array.from(t.localMatrix.elements)).toEqual(Array.from(IDENTITY_4));
    expect(Array.from(t.worldMatrix.elements)).toEqual(Array.from(IDENTITY_4));
  });

  it("keeps the same math instances for the transform's lifetime", () => {
    const t = new Transform();
    const position = t.position;
    const localMatrix = t.localMatrix;
    const elements = t.localMatrix.elements;

    t.position.set(1, 2, 3);
    t.updateLocalMatrix();

    expect(t.position).toBe(position);
    expect(t.localMatrix).toBe(localMatrix);
    expect(t.localMatrix.elements).toBe(elements);
  });
});

describe("Transform local matrix composition (§7)", () => {
  it("composes T · Tp · R · S · Tp⁻¹ exactly like Matrix4.compose", () => {
    const t = new Transform();
    t.position.set(5, -2, 3);
    t.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    t.scale.set(2, 3, 4);
    t.pivot.set(1, 1, 1);

    t.updateLocalMatrix();

    expectElementsCloseTo(t.localMatrix, composed(t).elements);
  });

  it("matches hand-computed raw elements for a rotated, scaled, pivoted transform", () => {
    const t = new Transform();
    t.position.set(5, -2, 3);
    t.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    t.scale.set(2, 3, 4);
    t.pivot.set(1, 1, 1);

    t.updateLocalMatrix();

    // R (+90° about Z) sends x→y and y→−x; its columns scaled by (2, 3, 4) give
    // the upper-left block. The translation column is
    // position + (I − R·S)·pivot = (5,−2,3) + (1,1,1) − (−3,2,4) = (9,−3,0).
    expectElementsCloseTo(
      t.localMatrix,
      [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 9, -3, 0, 1],
    );
  });

  it("leaves the matrix unchanged by the pivot when there is no rotation or scale", () => {
    const withoutPivot = new Transform();
    withoutPivot.position.set(4, 5, 6);
    withoutPivot.updateLocalMatrix();

    const withPivot = new Transform();
    withPivot.position.set(4, 5, 6);
    withPivot.pivot.set(-7, 8, 9);
    withPivot.updateLocalMatrix();

    expectElementsCloseTo(
      withPivot.localMatrix,
      withoutPivot.localMatrix.elements,
    );
  });
});

describe("Transform pivot semantics (§7)", () => {
  it("maps the pivot point to position + pivot for any rotation and scale", () => {
    const t = new Transform();
    t.position.set(5, -2, 3);
    t.rotation.setFromAxisAngle(new Vector3(1, 2, 3), 0.7);
    t.scale.set(2, 3, 4);
    t.pivot.set(1, -1, 0.5);
    t.updateLocalMatrix();

    const [x, y, z] = transformPoint(
      t.localMatrix,
      t.pivot.x,
      t.pivot.y,
      t.pivot.z,
    );

    expect(x).toBeCloseTo(t.position.x + t.pivot.x, 12);
    expect(y).toBeCloseTo(t.position.y + t.pivot.y, 12);
    expect(z).toBeCloseTo(t.position.z + t.pivot.z, 12);
  });

  it("does not let the pivot move `position` — only which point stays fixed", () => {
    const a = new Transform();
    a.position.set(5, -2, 3);
    a.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    a.updateLocalMatrix();

    const b = new Transform();
    b.position.set(5, -2, 3);
    b.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    b.pivot.set(10, 20, 30);
    b.updateLocalMatrix();

    // The authored position field is untouched by the pivot …
    expect([b.position.x, b.position.y, b.position.z]).toEqual([5, -2, 3]);
    // … and each transform still holds its own pivot point at position + pivot.
    const aFixed = transformPoint(
      a.localMatrix,
      a.pivot.x,
      a.pivot.y,
      a.pivot.z,
    );
    expect(aFixed[0]).toBeCloseTo(5, 12);
    expect(aFixed[1]).toBeCloseTo(-2, 12);
    expect(aFixed[2]).toBeCloseTo(3, 12);
    const bFixed = transformPoint(
      b.localMatrix,
      b.pivot.x,
      b.pivot.y,
      b.pivot.z,
    );
    expect(bFixed[0]).toBeCloseTo(15, 12);
    expect(bFixed[1]).toBeCloseTo(18, 12);
    expect(bFixed[2]).toBeCloseTo(33, 12);
  });

  it("rotates about the pivot: the origin swings around a pivot on +X", () => {
    const t = new Transform();
    t.pivot.set(1, 0, 0);
    t.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    t.updateLocalMatrix();

    const [x, y, z] = transformPoint(t.localMatrix, 0, 0, 0);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(-1, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  it("scales about the pivot: the origin moves away from a pivot on +X", () => {
    const t = new Transform();
    t.pivot.set(1, 0, 0);
    t.scale.set(2, 2, 2);
    t.updateLocalMatrix();

    const [x, y, z] = transformPoint(t.localMatrix, 0, 0, 0);
    expect(x).toBeCloseTo(-1, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
  });
});

describe("Transform version (§7, plan D3)", () => {
  it("bumps once per method-based mutation of each authored member", () => {
    const t = new Transform();
    expect(t.version).toBe(0);

    t.position.set(1, 2, 3);
    expect(t.version).toBe(1);

    t.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    expect(t.version).toBe(2);

    t.scale.set(2, 2, 2);
    expect(t.version).toBe(3);

    t.pivot.set(0, 1, 0);
    expect(t.version).toBe(4);
  });

  it("bumps exactly once for a multi-component mutator and once per call", () => {
    const t = new Transform();

    t.position.add(new Vector3(1, 1, 1));
    expect(t.version).toBe(1);

    t.position.scale(2).normalize();
    expect(t.version).toBe(3);

    t.rotation
      .multiply(new Quaternion(0, 0, 0, 1))
      .normalize()
      .conjugate();
    expect(t.version).toBe(6);
  });

  it("keeps the hook when copying another vector in", () => {
    const t = new Transform();
    const source = new Vector3(7, 8, 9);

    t.position.copy(source);
    expect(t.version).toBe(1);

    t.position.copy(source);
    expect(t.version).toBe(2);
    expect([t.position.x, t.position.y, t.position.z]).toEqual([7, 8, 9]);
  });

  it("does not see direct field writes until markDirty announces them", () => {
    const t = new Transform();

    t.position.x = 5;
    expect(t.version).toBe(0);

    t.markDirty();
    expect(t.version).toBe(1);

    t.markDirty();
    expect(t.version).toBe(2);
  });

  it("is not bumped by composing the local matrix or by writing the world matrix", () => {
    const t = new Transform();
    t.position.set(1, 2, 3);
    expect(t.version).toBe(1);

    t.updateLocalMatrix();
    t.updateLocalMatrix();
    expect(t.version).toBe(1);

    // The resolver owns worldMatrix/worldVersion; neither feeds the local
    // dirty channel.
    t.worldMatrix.copy(t.localMatrix);
    t.worldVersion = t.version;
    expect(t.version).toBe(1);
  });
});

describe("Transform.updateLocalMatrix laziness", () => {
  it("recomposes only when the version advanced", () => {
    const t = new Transform();
    t.position.set(1, 2, 3);
    t.updateLocalMatrix();
    expect(t.localMatrix.elements[12]).toBe(1);

    // A raw element write is invisible to the transform (no hook on
    // localMatrix), so it survives further update calls: nothing recomposed.
    t.localMatrix.elements[12] = 999;
    t.updateLocalMatrix();
    t.updateLocalMatrix();
    expect(t.localMatrix.elements[12]).toBe(999);

    // Announcing the write makes the next update recompose over it.
    t.markDirty();
    t.updateLocalMatrix();
    expect(t.localMatrix.elements[12]).toBe(1);
  });

  it("recomposes after every fresh mutation", () => {
    const t = new Transform();

    for (let i = 1; i <= 4; i += 1) {
      t.position.set(i, 0, 0);
      t.updateLocalMatrix();
      expect(t.localMatrix.elements[12]).toBe(i);
    }
  });

  it("composes on the first call even with no mutation at all", () => {
    const t = new Transform();
    t.localMatrix.elements[12] = 42;

    t.updateLocalMatrix();

    expect(t.localMatrix.elements[12]).toBe(0);
  });
});

describe("Transform manual matrix mode (matrixAutoUpdate = false, §7)", () => {
  it("makes updateLocalMatrix a no-op", () => {
    const t = new Transform();
    t.matrixAutoUpdate = false;
    t.position.set(1, 2, 3);
    t.scale.set(4, 5, 6);

    t.updateLocalMatrix();

    expect(Array.from(t.localMatrix.elements)).toEqual(Array.from(IDENTITY_4));
  });

  it("copies the matrix and bumps the version through setLocalMatrix", () => {
    const t = new Transform();
    t.matrixAutoUpdate = false;

    const authored = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 7, 8, 9, 1,
    ]);
    t.setLocalMatrix(authored);

    expect(t.version).toBe(1);
    expect(Array.from(t.localMatrix.elements)).toEqual(
      Array.from(authored.elements),
    );
    // A copy, not an alias: later edits to the source do not leak in.
    authored.elements[12] = -1;
    expect(t.localMatrix.elements[12]).toBe(7);
    // And updating is still a no-op, so the authored matrix survives.
    t.updateLocalMatrix();
    expect(t.localMatrix.elements[12]).toBe(7);
  });

  it("never back-derives position/rotation/scale from the authored matrix", () => {
    const t = new Transform();
    t.matrixAutoUpdate = false;

    t.setLocalMatrix(
      new Matrix4().fromArray([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 7, 8, 9, 1]),
    );

    expect([t.position.x, t.position.y, t.position.z]).toEqual([0, 0, 0]);
    expect([t.scale.x, t.scale.y, t.scale.z]).toEqual([1, 1, 1]);
    expect([t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w]).toEqual([
      0, 0, 0, 1,
    ]);
  });

  it("recomposes from the authored values once auto-update is turned back on", () => {
    const t = new Transform();
    t.matrixAutoUpdate = false;
    t.position.set(1, 2, 3);
    t.setLocalMatrix(
      new Matrix4().fromArray([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 7, 8, 9, 1]),
    );

    t.matrixAutoUpdate = true;
    t.updateLocalMatrix();

    expectElementsCloseTo(t.localMatrix, composed(t).elements);
    expect(t.localMatrix.elements[12]).toBe(1);
  });
});

describe("Transform allocation policy (§7b)", () => {
  it("allocates nothing across 1000 mutate-and-update cycles", () => {
    const t = new Transform();

    resetConstructionCount();
    for (let i = 0; i < 1000; i += 1) {
      t.position.set(i, i * 2, i * 3);
      t.rotation.setFromAxisAngle(AXIS_Z, i * 0.001);
      t.scale.set(1 + i * 0.001, 1, 1);
      t.pivot.set(0, i * 0.5, 0);
      t.updateLocalMatrix();
    }
    const constructions = constructionCount();

    expect(constructions).toBe(0);
    expect(t.version).toBe(4000);
    // The cycles really did compose: the final matrix is the composition of the
    // final authored values. (`composed` allocates, so it runs after counting.)
    expectElementsCloseTo(t.localMatrix, composed(t).elements);
  });
});
