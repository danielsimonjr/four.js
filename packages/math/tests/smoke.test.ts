import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "../src/index.js";

describe("@fourjs/math", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@fourjs/math");
  });
});
