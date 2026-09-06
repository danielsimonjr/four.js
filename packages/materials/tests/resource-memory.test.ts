import { describe, expect, it } from "vitest";

import { UnlitMaterial } from "../src/unlit-material.js";
import { liveMaterialCount } from "../src/resource-memory.js";

describe("material resource memory", () => {
  it("tracks live materials across construct and dispose", () => {
    const before = liveMaterialCount();
    const material = new UnlitMaterial();
    expect(liveMaterialCount()).toBe(before + 1);
    material.dispose();
    expect(liveMaterialCount()).toBe(before);
  });
});
