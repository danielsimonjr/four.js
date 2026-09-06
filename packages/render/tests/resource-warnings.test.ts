import { afterEach, describe, expect, it, vi } from "vitest";

import { resetDevWarnings } from "@four/core";

import { warnDisposedInUse } from "../src/resource-warnings.js";

afterEach(() => {
  resetDevWarnings();
  vi.restoreAllMocks();
});

describe("warnDisposedInUse (§83)", () => {
  it("warns once per disposed resource id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnDisposedInUse("texture", "t1")).toBeUndefined();
    expect(warnDisposedInUse("texture", "t1")).toBeUndefined();
    expect(warnDisposedInUse("texture", "t2")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[four]");
    expect(String(warn.mock.calls[0]?.[0])).toContain("t1");
  });
});
