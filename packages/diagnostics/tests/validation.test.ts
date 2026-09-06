import { afterEach, describe, expect, it, vi } from "vitest";

import { FourError, resetDevWarnings } from "@four/core";
import { Group } from "@four/scene";

import {
  COORDINATE_ENVELOPE,
  NEAR_ZERO_SCALE,
  UNSTABLE_SCALE_RATIO,
  assertFinite,
  assertNoSceneGraphCycle,
  validateSceneNode,
  validateSceneSubtree,
  warnCoordinateEnvelope,
  warnSingularScale,
  warnUnstableScale,
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

  it("assertNoSceneGraphCycle refuses adding a node to itself", () => {
    const node = new Group();
    expect(() => assertNoSceneGraphCycle(node, node)).toThrow(FourError);
  });

  it("warnCoordinateEnvelope stays quiet inside the envelope", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnCoordinateEnvelope({ x: 1, y: 2, z: 3 }, "near origin")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warnSingularScale fires on a zero component", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnSingularScale({ x: 1, y: 0, z: 1 }, "node scale")).toBe(true);
    expect(warnSingularScale({ x: 1, y: 1, z: 1 }, "node scale")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warnUnstableScale fires on extreme and near-zero ratios", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      warnUnstableScale(
        { x: UNSTABLE_SCALE_RATIO + 1, y: 1, z: 1 },
        "extreme",
      ),
    ).toBe(true);
    expect(
      warnUnstableScale(
        { x: 1, y: NEAR_ZERO_SCALE / 2, z: 1 },
        "microscopic",
      ),
    ).toBe(true);
    expect(warnUnstableScale({ x: 1, y: 1, z: 1 }, "balanced")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("validateSceneNode and validateSceneSubtree count warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const root = new Group();
    root.transform.scale.set(0, 1, 1);
    const child = new Group();
    child.transform.position.set(COORDINATE_ENVELOPE + 10, 0, 0);
    root.add(child);
    expect(validateSceneNode(root)).toBe(2);
    resetDevWarnings();
    expect(validateSceneSubtree(root)).toBe(3);
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("is inert in a production build", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const production = await import("../src/validation.js");
    expect(production.warnCoordinateEnvelope({ x: 1e6, y: 0, z: 0 }, "n")).toBe(false);
  });
});
