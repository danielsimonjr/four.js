import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "../src/index.js";

describe("@four/render-canvas", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@four/render-canvas");
  });
});
