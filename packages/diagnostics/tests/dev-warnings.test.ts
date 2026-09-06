import { afterEach, describe, expect, it, vi } from "vitest";

import { resetDevWarnings } from "@four/core";

import {
  beginFrameAllocationCheck,
  endFrameAllocationCheck,
  warnDetachedNodeListeners,
  warnDisposedResourceInUse,
  warnPerFrameAllocations,
} from "../src/dev-warnings.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  resetDevWarnings();
});

describe("dev-warnings", () => {
  it("warnDisposedResourceInUse deduplicates per resource", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnDisposedResourceInUse("tex-1", "texture")).toBe(true);
    expect(warnDisposedResourceInUse("tex-1", "texture")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("endFrameAllocationCheck warns when construction count grows", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let count = 0;
    const read = (): number => count;
    const baseline = beginFrameAllocationCheck(read);
    count = 3;
    expect(endFrameAllocationCheck(baseline, read, { label: "test-span" })).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is inert in a production build", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const production = await import("../src/dev-warnings.js");
    expect(production.warnDisposedResourceInUse("g-1", "geometry")).toBe(false);
  });
});
