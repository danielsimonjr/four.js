import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "../src/index.js";

describe("@fourjs/animation", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@fourjs/animation");
  });
});
