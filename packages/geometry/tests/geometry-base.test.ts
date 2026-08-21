import { describe, expect, it } from "vitest";

import {
  BufferGeometry,
  Geometry,
  boxGeometry,
  geometryMemoryBytes,
  liveGeometryCount,
} from "../src/index.js";

/** A minimal valid triangle: one CCW face in the XY plane. */
function triangle(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
}

/** A geometry carrying every optional attribute, so `clone()` has work to do. */
function fullyDressed(): BufferGeometry {
  return new BufferGeometry({
    positions: triangle(),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]),
    indices: new Uint16Array([0, 1, 2]),
  });
}

describe("§53 Geometry base (R-21)", () => {
  it("BufferGeometry is a Geometry", () => {
    const geometry = new BufferGeometry({ positions: triangle() });
    expect(geometry).toBeInstanceOf(Geometry);
  });

  it("ids come from one ascending process-wide sequence", () => {
    const first = new BufferGeometry({ positions: triangle() });
    const second = new BufferGeometry({ positions: triangle() });
    expect(first.id).toMatch(/^geometry-\d+$/);
    const firstNumber = Number(first.id.slice("geometry-".length));
    const secondNumber = Number(second.id.slice("geometry-".length));
    expect(secondNumber).toBe(firstNumber + 1);
  });

  it("exposes the abstract surface §53 declares", () => {
    const geometry: Geometry = new BufferGeometry({ positions: triangle() });
    expect(typeof geometry.id).toBe("string");
    expect(geometry.version).toBe(0);
    expect(geometry.disposed).toBe(false);
    expect(geometry.bounds).toBe(geometry.computeBounds());
    expect(geometry.clone()).toBeInstanceOf(BufferGeometry);
    geometry.dispose();
    expect(geometry.disposed).toBe(true);
  });
});

describe("§53 BoundingVolume (R-21)", () => {
  it("`bounds` is the same object `computeBounds()` returns", () => {
    const geometry = new BufferGeometry({ positions: triangle() });
    expect(geometry.bounds).toBe(geometry.computeBounds());
  });

  it("keeps the box exactly as it was before the volume was named", () => {
    const geometry = boxGeometry({ width: 2, height: 4, depth: 6 });
    const bounds = geometry.bounds;
    expect([bounds.min.x, bounds.min.y, bounds.min.z]).toEqual([-1, -2, -3]);
    expect([bounds.max.x, bounds.max.y, bounds.max.z]).toEqual([1, 2, 3]);
  });

  it("centre and radius circumscribe the box", () => {
    const geometry = boxGeometry({ width: 2, height: 4, depth: 6 });
    const bounds = geometry.bounds;
    expect([bounds.center.x, bounds.center.y, bounds.center.z]).toEqual([
      0, 0, 0,
    ]);
    expect(bounds.radius).toBeCloseTo(Math.sqrt(1 + 4 + 9), 12);
  });

  it("an off-centre box gets an off-centre volume", () => {
    const geometry = new BufferGeometry({
      positions: new Float32Array([1, 2, 3, 3, 2, 3, 1, 6, 3]),
    });
    const bounds = geometry.bounds;
    expect([bounds.center.x, bounds.center.y, bounds.center.z]).toEqual([
      2, 4, 3,
    ]);
    expect(bounds.radius).toBeCloseTo(Math.sqrt(1 + 4 + 0), 12);
  });

  it("an empty geometry has an identity box and no volume", () => {
    const geometry = new BufferGeometry({ positions: new Float32Array(0) });
    const bounds = geometry.bounds;
    expect(bounds.min.x).toBe(Infinity);
    expect(bounds.max.x).toBe(-Infinity);
    expect(Number.isNaN(bounds.center.x)).toBe(true);
    expect(Number.isNaN(bounds.center.y)).toBe(true);
    expect(Number.isNaN(bounds.center.z)).toBe(true);
    expect(Number.isNaN(bounds.radius)).toBe(true);
  });

  it("a disposed geometry becomes empty, and says so", () => {
    const geometry = new BufferGeometry({ positions: triangle() });
    expect(Number.isFinite(geometry.bounds.radius)).toBe(true);
    geometry.dispose();
    expect(Number.isNaN(geometry.bounds.radius)).toBe(true);
  });

  it("a single point has a zero radius, not a NaN one", () => {
    const geometry = new BufferGeometry({
      positions: new Float32Array([5, 5, 5, 5, 5, 5]),
      mode: "lines",
    });
    expect(geometry.bounds.radius).toBe(0);
    expect(geometry.bounds.center.x).toBe(5);
  });

  it("recomputes the whole volume after a mutation", () => {
    const geometry = new BufferGeometry({ positions: triangle() });
    const before = geometry.bounds.radius;
    geometry.positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    expect(geometry.bounds.radius).toBeGreaterThan(before);
    expect(geometry.bounds.center.x).toBe(5);
  });
});

describe("BufferGeometry.clone (§53, R-21)", () => {
  it("copies every attribute by value", () => {
    const source = fullyDressed();
    const copy = source.clone();

    expect(copy.positions).toEqual(source.positions);
    expect(copy.normals).toEqual(source.normals);
    expect(copy.uvs).toEqual(source.uvs);
    expect(copy.colors).toEqual(source.colors);
    expect(copy.indices).toEqual(source.indices);
    expect(copy.mode).toBe(source.mode);

    expect(copy.positions).not.toBe(source.positions);
    expect(copy.normals).not.toBe(source.normals);
    expect(copy.uvs).not.toBe(source.uvs);
    expect(copy.colors).not.toBe(source.colors);
    expect(copy.indices).not.toBe(source.indices);
  });

  it("an in-place edit of the clone leaves the source untouched", () => {
    const source = fullyDressed();
    const copy = source.clone();
    copy.positions[0] = 99;
    copy.markDirty();
    expect(source.positions[0]).toBe(0);
    expect(source.version).toBe(0);
  });

  it("a clone is a new geometry: new id, version 0", () => {
    const source = new BufferGeometry({ positions: triangle() });
    source.markDirty();
    source.markDirty();
    const copy = source.clone();
    expect(copy.id).not.toBe(source.id);
    expect(copy.version).toBe(0);
    expect(source.version).toBe(2);
  });

  it("carries no attribute the source lacked", () => {
    const source = new BufferGeometry({ positions: triangle() });
    const copy = source.clone();
    expect(copy.normals).toBeUndefined();
    expect(copy.uvs).toBeUndefined();
    expect(copy.colors).toBeUndefined();
    expect(copy.indices).toBeUndefined();
  });

  it("preserves a non-default draw mode", () => {
    const source = new BufferGeometry({
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      mode: "lines",
    });
    expect(source.clone().mode).toBe("lines");
  });

  it("preserves the index element type", () => {
    const source = new BufferGeometry({
      positions: triangle(),
      indices: new Uint32Array([0, 1, 2]),
    });
    expect(source.clone().indices).toBeInstanceOf(Uint32Array);
  });

  it("computes the same bounds as its source", () => {
    const source = boxGeometry({ width: 2, height: 4, depth: 6 });
    const copy = source.clone();
    expect(copy.bounds.min.y).toBe(source.bounds.min.y);
    expect(copy.bounds.max.y).toBe(source.bounds.max.y);
    expect(copy.bounds.radius).toBe(source.bounds.radius);
  });

  it("registers as a second live geometry in the §83 totals", () => {
    const source = fullyDressed();
    const bytesBefore = geometryMemoryBytes();
    const countBefore = liveGeometryCount();
    const copy = source.clone();
    expect(liveGeometryCount()).toBe(countBefore + 1);
    expect(geometryMemoryBytes()).toBe(bytesBefore + source.byteLength);
    copy.dispose();
    source.dispose();
    expect(liveGeometryCount()).toBe(countBefore - 1);
  });

  it("refuses to clone a disposed geometry (§83)", () => {
    const source = new BufferGeometry({ positions: triangle() });
    source.dispose();
    expect(() => source.clone()).toThrow(TypeError);
    expect(() => source.clone()).toThrow(/disposed/);
  });
});
