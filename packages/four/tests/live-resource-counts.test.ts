import { describe, expect, it } from "vitest";

import { UnlitMaterial } from "@four/materials";

import { readLiveResourceCounts } from "../src/live-resource-counts.js";

describe("readLiveResourceCounts", () => {
  it("returns the §83 accounting fields from the owning packages", () => {
    const counts = readLiveResourceCounts();
    expect(typeof counts.geometries).toBe("number");
    expect(typeof counts.bufferBytes).toBe("number");
    expect(typeof counts.textures).toBe("number");
    expect(typeof counts.renderTargets).toBe("number");
    expect(typeof counts.textureBytes).toBe("number");
    expect(typeof counts.materials).toBe("number");
    expect(typeof counts.solverBodies).toBe("number");
    expect(typeof counts.solverColliders).toBe("number");
    expect(typeof counts.solverJoints).toBe("number");
    expect(typeof counts.solverHandles).toBe("number");
    expect(counts.geometries).toBeGreaterThanOrEqual(0);
    expect(counts.bufferBytes).toBeGreaterThanOrEqual(0);
    expect(counts.solverHandles).toBe(
      (counts.solverBodies ?? 0) +
        (counts.solverColliders ?? 0) +
        (counts.solverJoints ?? 0),
    );
  });

  it("moves materials when an UnlitMaterial is constructed and disposed", () => {
    const before = readLiveResourceCounts();
    const material = new UnlitMaterial();
    const during = readLiveResourceCounts();
    expect(during.materials).toBe((before.materials ?? 0) + 1);
    material.dispose();
    const after = readLiveResourceCounts();
    expect(after.materials).toBe(before.materials);
  });
});
