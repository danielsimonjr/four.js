import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "../src/index.js";

describe("@four/animation", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@four/animation");
  });
});
