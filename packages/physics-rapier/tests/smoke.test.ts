import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "../src/index.js";

describe("@fourjs/physics-rapier", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@fourjs/physics-rapier");
  });
});
