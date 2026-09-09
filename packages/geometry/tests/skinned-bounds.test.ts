import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Vector3 } from "@fourjs/math";

import {
  BufferGeometry,
  computeSkinnedBounds,
  type BoundingVolume,
} from "../src/index.js";
import * as geometryApi from "../src/index.js";

/** One CCW triangle in the XY plane — bind-pose min (0,0,0) max (1,1,0). */
function triangle(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
}

/** Four influences, every weight on joint 0. */
function weightsOnJoint0(vertexCount: number, weight = 1): Float32Array {
  const values = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) {
    values[i * 4] = weight;
  }
  return values;
}

function jointsAllZero(vertexCount: number): Uint16Array {
  return new Uint16Array(vertexCount * 4);
}

/** `n` identity mat4s, column-major, matching `Skeleton.jointMatrices`. */
function identityPalette(n: number): Float32Array {
  const palette = new Float32Array(n * 16);
  for (let i = 0; i < n; i += 1) {
    const base = i * 16;
    palette[base] = 1;
    palette[base + 5] = 1;
    palette[base + 10] = 1;
    palette[base + 15] = 1;
  }
  return palette;
}

/** Identity palette whose joint 0 is a translation of `(tx, ty, tz)`. */
function translationPalette(
  tx: number,
  ty: number,
  tz: number,
  n = 1,
): Float32Array {
  const palette = identityPalette(n);
  palette[12] = tx;
  palette[13] = ty;
  palette[14] = tz;
  return palette;
}

function xyz(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

/** Same-runtime bit identity of a volume's box (and the derived sphere). */
function expectBitIdentical(a: BoundingVolume, b: BoundingVolume): void {
  expect(Object.is(a.min.x, b.min.x)).toBe(true);
  expect(Object.is(a.min.y, b.min.y)).toBe(true);
  expect(Object.is(a.min.z, b.min.z)).toBe(true);
  expect(Object.is(a.max.x, b.max.x)).toBe(true);
  expect(Object.is(a.max.y, b.max.y)).toBe(true);
  expect(Object.is(a.max.z, b.max.z)).toBe(true);
  expect(Object.is(a.center.x, b.center.x)).toBe(true);
  expect(Object.is(a.center.y, b.center.y)).toBe(true);
  expect(Object.is(a.center.z, b.center.z)).toBe(true);
  expect(Object.is(a.radius, b.radius)).toBe(true);
}

describe("computeSkinnedBounds (RFC 0003 residue — skinned bounds only)", () => {
  it("identity palette ⇒ bounds equal geometry.computeBounds() (same-runtime, exact)", () => {
    const geometry = new BufferGeometry({
      positions: triangle(),
      joints: jointsAllZero(3),
      weights: weightsOnJoint0(3),
    });
    const posed = computeSkinnedBounds(geometry, identityPalette(2));
    const bind = geometry.computeBounds();
    expectBitIdentical(posed, bind);
  });

  it("known translation of (1,2,3) on joint 0 shifts min/max by that vector", () => {
    const geometry = new BufferGeometry({
      positions: triangle(),
      joints: jointsAllZero(3),
      weights: weightsOnJoint0(3),
    });
    const posed = computeSkinnedBounds(geometry, translationPalette(1, 2, 3));
    expect(xyz(posed.min)).toEqual([1, 2, 3]);
    expect(xyz(posed.max)).toEqual([2, 3, 3]);
    expect(xyz(posed.center)).toEqual([1.5, 2.5, 3]);
    expect(posed.radius).toBe(Math.sqrt(0.5 * 0.5 + 0.5 * 0.5));
  });

  it("two influences 0.5/0.5 of two translations ⇒ midpoint (golden)", () => {
    const vertexCount = 3;
    const joints = new Uint16Array(vertexCount * 4);
    const weights = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i += 1) {
      joints[i * 4] = 0;
      joints[i * 4 + 1] = 1;
      weights[i * 4] = 0.5;
      weights[i * 4 + 1] = 0.5;
    }
    const geometry = new BufferGeometry({
      positions: triangle(),
      joints,
      weights,
    });
    const palette = identityPalette(2);
    // Joint 0: + (2, 0, 0). Joint 1: + (0, 4, 0). Midpoint offset (1, 2, 0).
    palette[12] = 2;
    palette[16 + 13] = 4;
    const posed = computeSkinnedBounds(geometry, palette);
    expect(xyz(posed.min)).toEqual([1, 2, 0]);
    expect(xyz(posed.max)).toEqual([2, 3, 0]);
  });

  it("does not export or return a skinned-position array", () => {
    expect(Object.hasOwn(geometryApi, "computeSkinnedBounds")).toBe(true);
    expect(Object.hasOwn(geometryApi, "skinPositions")).toBe(false);
    expect(Object.hasOwn(geometryApi, "skinVertices")).toBe(false);

    for (const name of Object.keys(geometryApi)) {
      expect(name.toLowerCase()).not.toMatch(
        /skin(?:positions|vertices|points)/,
      );
    }

    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const index = readFileSync(join(srcRoot, "index.ts"), "utf8");
    expect(index).toContain("computeSkinnedBounds");
    expect(index).not.toMatch(/\bskinPositions\b/);
    expect(index).not.toMatch(/\bskinVertices\b/);

    const geometry = new BufferGeometry({
      positions: triangle(),
      joints: jointsAllZero(3),
      weights: weightsOnJoint0(3),
    });
    const posed: BoundingVolume = computeSkinnedBounds(
      geometry,
      identityPalette(1),
    );
    expect(Object.keys(posed).sort()).toEqual([
      "center",
      "max",
      "min",
      "radius",
    ]);
    expect(posed.min).toBeInstanceOf(Vector3);
    expect(posed.max).toBeInstanceOf(Vector3);
    expect(posed.center).toBeInstanceOf(Vector3);
    expect(typeof posed.radius).toBe("number");
    expect(posed).not.toHaveProperty("positions");
    expect(posed).not.toHaveProperty("vertices");
  });

  it("missing joints or weights ⇒ bind-pose bounds", () => {
    const positions = triangle();
    const unskinned = new BufferGeometry({ positions });
    const palette = translationPalette(9, 9, 9);
    expect(computeSkinnedBounds(unskinned, palette)).toBe(
      unskinned.computeBounds(),
    );

    const jointsOnly = new BufferGeometry({
      positions: triangle(),
      joints: jointsAllZero(3),
    });
    expect(computeSkinnedBounds(jointsOnly, palette)).toBe(
      jointsOnly.computeBounds(),
    );
    expect(xyz(jointsOnly.computeBounds().min)).toEqual([0, 0, 0]);

    const weightsOnly = new BufferGeometry({
      positions: triangle(),
      weights: weightsOnJoint0(3),
    });
    expect(computeSkinnedBounds(weightsOnly, palette)).toBe(
      weightsOnly.computeBounds(),
    );
  });

  it("empty geometry ⇒ empty volume convention", () => {
    const empty = new BufferGeometry({ positions: new Float32Array(0) });
    const posed = computeSkinnedBounds(empty, identityPalette(1));
    const bind = empty.computeBounds();
    expect(posed).toBe(bind);
    expect(posed.min.x).toBe(Number.POSITIVE_INFINITY);
    expect(posed.max.x).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(posed.center.x)).toBe(true);
    expect(Number.isNaN(posed.radius)).toBe(true);

    const emptySkinned = new BufferGeometry({
      positions: new Float32Array(0),
      joints: new Uint16Array(0),
      weights: new Float32Array(0),
    });
    const emptyPosed = computeSkinnedBounds(emptySkinned, identityPalette(1));
    expect(emptyPosed.min.x).toBe(Number.POSITIVE_INFINITY);
    expect(emptyPosed.min.y).toBe(Number.POSITIVE_INFINITY);
    expect(emptyPosed.min.z).toBe(Number.POSITIVE_INFINITY);
    expect(emptyPosed.max.x).toBe(Number.NEGATIVE_INFINITY);
    expect(emptyPosed.max.y).toBe(Number.NEGATIVE_INFINITY);
    expect(emptyPosed.max.z).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(emptyPosed.center.x)).toBe(true);
    expect(Number.isNaN(emptyPosed.center.y)).toBe(true);
    expect(Number.isNaN(emptyPosed.center.z)).toBe(true);
    expect(Number.isNaN(emptyPosed.radius)).toBe(true);
  });

  it("does not renormalise weights: (2,0,0,0) ≠ (1,0,0,0) under a translation", () => {
    const unit = new BufferGeometry({
      positions: triangle(),
      joints: jointsAllZero(3),
      weights: weightsOnJoint0(3, 1),
    });
    const doubled = new BufferGeometry({
      positions: triangle(),
      joints: jointsAllZero(3),
      weights: weightsOnJoint0(3, 2),
    });
    const palette = translationPalette(1, 2, 3);
    const unitPosed = computeSkinnedBounds(unit, palette);
    const doubledPosed = computeSkinnedBounds(doubled, palette);
    // Authored weight 1: p + (1,2,3). Weight 2: 2·(p + (1,2,3)).
    expect(xyz(unitPosed.min)).toEqual([1, 2, 3]);
    expect(xyz(unitPosed.max)).toEqual([2, 3, 3]);
    expect(xyz(doubledPosed.min)).toEqual([2, 4, 6]);
    expect(xyz(doubledPosed.max)).toEqual([4, 6, 6]);
    expect(xyz(doubledPosed.min)).not.toEqual(xyz(unitPosed.min));
  });

  it("same inputs ⇒ bit-identical min/max (no Math.random, no Date)", () => {
    const geometry = new BufferGeometry({
      positions: triangle(),
      joints: jointsAllZero(3),
      weights: weightsOnJoint0(3),
    });
    const palette = translationPalette(1, 2, 3, 2);
    const first = computeSkinnedBounds(geometry, palette);
    const second = computeSkinnedBounds(geometry, palette);
    expectBitIdentical(first, second);
  });

  it("out-of-range joint indices skip that influence (zero matrix)", () => {
    const geometry = new BufferGeometry({
      positions: triangle(),
      joints: new Uint16Array([99, 0, 0, 0, 99, 0, 0, 0, 99, 0, 0, 0]),
      weights: weightsOnJoint0(3, 1),
    });
    const palette = translationPalette(1, 2, 3);
    const posed = computeSkinnedBounds(geometry, palette);
    // Every influence is joint 99, which is not in a 1-joint palette → origin.
    expect(xyz(posed.min)).toEqual([0, 0, 0]);
    expect(xyz(posed.max)).toEqual([0, 0, 0]);
    expect(posed.radius).toBe(0);
  });

  it("a mixed in-range / out-of-range vertex uses only the in-range influence", () => {
    const vertexCount = 3;
    const joints = new Uint16Array(vertexCount * 4);
    const weights = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i += 1) {
      joints[i * 4] = 0;
      joints[i * 4 + 1] = 99;
      weights[i * 4] = 1;
      weights[i * 4 + 1] = 1;
    }
    const geometry = new BufferGeometry({
      positions: triangle(),
      joints,
      weights,
    });
    const posed = computeSkinnedBounds(geometry, translationPalette(1, 2, 3));
    // Weight 1 on the translation plus a skipped second influence — no extra.
    expect(xyz(posed.min)).toEqual([1, 2, 3]);
    expect(xyz(posed.max)).toEqual([2, 3, 3]);
  });
});
