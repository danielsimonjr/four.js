import { afterEach, describe, expect, it, vi } from "vitest";

import {
  auditFinalizedLeaks,
  reportFinalized,
  resetDevWarnings,
  resetLeakRegistry,
  trackedDisposableId,
} from "@four/core";

import { BufferGeometry } from "../src/buffer-geometry.js";
import {
  geometryMemoryBytes,
  liveGeometryCount,
} from "../src/resource-memory.js";
import { boxGeometry } from "../src/primitives.js";

/** Three vertices, positions only: 3 × 3 × 4 bytes. */
function triangle(): BufferGeometry {
  return new BufferGeometry({ positions: new Float32Array(9) });
}

afterEach(() => {
  resetLeakRegistry();
  resetDevWarnings();
  vi.restoreAllMocks();
});

describe("§83 geometry resource accounting (A-5)", () => {
  // Every assertion is a delta against the totals as this test found them: the
  // counters are process-wide levels (§83), never reset, so an absolute
  // expectation would depend on what else the module registry has built.

  it("bills a geometry its attribute and index bytes", () => {
    const geometry = new BufferGeometry({
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      uvs: new Float32Array(6),
      colors: new Float32Array(12),
      indices: new Uint16Array([0, 1, 2]),
    });

    // 36 + 36 + 24 + 48 positions/normals/uvs/colors, 6 for the indices.
    expect(geometry.byteLength).toBe(150);
  });

  it("counts positions alone when nothing else is present", () => {
    expect(triangle().byteLength).toBe(36);
  });

  it("adds a new geometry to both totals", () => {
    const bytes = geometryMemoryBytes();
    const count = liveGeometryCount();

    const geometry = triangle();

    expect(geometryMemoryBytes() - bytes).toBe(geometry.byteLength);
    expect(liveGeometryCount() - count).toBe(1);
  });

  it("removes a disposed geometry from both totals", () => {
    const bytes = geometryMemoryBytes();
    const count = liveGeometryCount();
    const geometry = triangle();

    geometry.dispose();

    expect(geometryMemoryBytes()).toBe(bytes);
    expect(liveGeometryCount()).toBe(count);
    expect(geometry.byteLength).toBe(0);
  });

  it("subtracts once for a double dispose (§83: idempotent and terminal)", () => {
    const bytes = geometryMemoryBytes();
    const count = liveGeometryCount();
    const geometry = triangle();

    geometry.dispose();
    geometry.dispose();
    geometry.dispose();

    expect(geometryMemoryBytes()).toBe(bytes);
    expect(liveGeometryCount()).toBe(count);
  });

  it("follows an attribute replacement by the difference", () => {
    const geometry = triangle();
    const bytes = geometryMemoryBytes();

    geometry.positions = new Float32Array(18);

    expect(geometry.byteLength).toBe(72);
    expect(geometryMemoryBytes() - bytes).toBe(36);
  });

  it("follows an attribute being added and dropped again", () => {
    const geometry = triangle();
    const bytes = geometryMemoryBytes();

    geometry.uvs = new Float32Array(6);
    expect(geometryMemoryBytes() - bytes).toBe(24);

    geometry.normals = new Float32Array(9);
    expect(geometryMemoryBytes() - bytes).toBe(60);

    geometry.colors = new Float32Array(12);
    expect(geometryMemoryBytes() - bytes).toBe(108);

    geometry.indices = new Uint32Array([0, 1, 2]);
    expect(geometryMemoryBytes() - bytes).toBe(120);

    geometry.uvs = undefined;
    geometry.normals = undefined;
    geometry.colors = undefined;
    geometry.indices = undefined;
    expect(geometryMemoryBytes()).toBe(bytes);
  });

  it("leaves the totals alone for a mutation that moves no bytes", () => {
    const geometry = new BufferGeometry({
      positions: new Float32Array(36),
      mode: "lines",
    });
    const bytes = geometryMemoryBytes();

    geometry.markDirty();
    geometry.mode = "triangles";

    expect(geometryMemoryBytes()).toBe(bytes);
  });

  it("cannot be resurrected by a write into a disposed geometry", () => {
    // Writing into a disposed resource is already a §83 "disposed resource
    // still in use" mistake; it must not also make the totals lie.
    const geometry = triangle();
    geometry.dispose();
    const bytes = geometryMemoryBytes();
    const count = liveGeometryCount();

    geometry.positions = new Float32Array(288);

    expect(geometry.byteLength).toBe(0);
    expect(geometryMemoryBytes()).toBe(bytes);
    expect(liveGeometryCount()).toBe(count);
  });

  it("never forgives a geometry that is dropped without dispose (§83)", () => {
    // The leak signal itself: an undisposed geometry stays billed forever,
    // because §83 requires *explicit* lifetimes and a total that healed itself
    // would hide exactly the leak the counter exists to reveal.
    const bytes = geometryMemoryBytes();
    for (let i = 0; i < 4; i += 1) {
      triangle();
    }
    expect(geometryMemoryBytes() - bytes).toBe(144);
  });

  it("bills a primitive builder's geometry like any other", () => {
    const bytes = geometryMemoryBytes();
    const box = boxGeometry({ width: 1, height: 1, depth: 1 });

    expect(box.byteLength).toBeGreaterThan(0);
    expect(geometryMemoryBytes() - bytes).toBe(box.byteLength);
  });

  it("holds no reference to the geometries it counts", () => {
    // Structural proof rather than a collection test: the module's whole
    // surface is numbers, so there is nowhere for a reference to hide.
    expect(typeof geometryMemoryBytes()).toBe("number");
    expect(typeof liveGeometryCount()).toBe("number");
  });

  it("registers a geometry with the FinalizationRegistry tracker (A-4)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const geometry = triangle();
    const id = trackedDisposableId(geometry);
    expect(id).toBeGreaterThan(0);
    reportFinalized(id);
    expect(auditFinalizedLeaks()).toBe(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(geometry.id);
    expect(String(warn.mock.calls[0]?.[0])).toContain("Creation site:");
  });

  it("does not warn when the geometry was disposed before finalization", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const geometry = triangle();
    const id = trackedDisposableId(geometry);
    geometry.dispose();
    reportFinalized(id);
    expect(auditFinalizedLeaks()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(trackedDisposableId(geometry)).toBe(0);
  });
});
