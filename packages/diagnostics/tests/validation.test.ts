import { afterEach, describe, expect, it, vi } from "vitest";

import { FourError, resetDevWarnings } from "@four/core";
import { Group } from "@four/scene";

import {
  COORDINATE_ENVELOPE,
  assertFinite,
  assertNoSceneGraphCycle,
  warnCoordinateEnvelope,
} from "../src/validation.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetDevWarnings();
});

describe("validation catalogue", () => {
  it("warnCoordinateEnvelope fires once beyond the §41 envelope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      warnCoordinateEnvelope(
        { x: COORDINATE_ENVELOPE + 1, y: 0, z: 0 },
        "node test",
      ),
    ).toBe(true);
    expect(
      warnCoordinateEnvelope(
        { x: COORDINATE_ENVELOPE + 2, y: 0, z: 0 },
        "node test",
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("assertFinite throws FourError in development", () => {
    expect(() => assertFinite(Number.NaN, "mass")).toThrow(FourError);
  });

  it("assertNoSceneGraphCycle refuses a descendant parent link", () => {
    const root = new Group();
    const child = new Group();
    root.add(child);
    expect(() => assertNoSceneGraphCycle(child, root)).toThrow(FourError);
  });

  it("is inert in a production build", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const production = await import("../src/validation.js");
    expect(production.warnCoordinateEnvelope({ x: 1e6, y: 0, z: 0 }, "n")).toBe(false);
  });
});
