import { describe, expect, it } from "vitest";

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
    expect(counts.geometries).toBeGreaterThanOrEqual(0);
    expect(counts.bufferBytes).toBeGreaterThanOrEqual(0);
  });
});
