/**
 * Tests for §85's build-mode flag (A-4, 2026-08-07).
 *
 * ## Why half of these tests re-import the module
 *
 * `DEV` is resolved **once, at module evaluation**, from a global that a
 * bundler is expected to have replaced with a literal. There is no setter and
 * there must not be one — a runtime switch would defeat the whole mechanism,
 * because a value that can change is a value a tree-shaker cannot fold.
 *
 * So the production half of the contract is exercised the only honest way:
 * define the global, throw away the module registry, and import a *fresh* copy.
 * `vi.resetModules()` plus a dynamic `import()` gives exactly one module
 * instance per case, so the two builds are tested as two builds rather than as
 * two settings of one.
 *
 * The bundle-level half — that a real bundler folds the guard away and drops
 * the guarded code — is `tests/integration/dev-build-mode.test.ts`, which runs
 * Vite over the built packages twice and compares the two outputs. This file
 * proves the *semantics*; that one proves the *stripping*. Neither implies the
 * other.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Component, ComponentHost } from "../src/component.js";
import {
  DEV,
  devAssert,
  devWarn,
  devWarnOnce,
  resetDevWarnings,
} from "../src/dev.js";
import { isFourError } from "../src/errors.js";

/** Imports a fresh `dev.ts` with `__FOUR_DEV__` defined as `value`. */
async function importWithFlag(
  value: boolean,
): Promise<typeof import("../src/dev.js")> {
  vi.stubGlobal("__FOUR_DEV__", value);
  vi.resetModules();
  return import("../src/dev.js");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  resetDevWarnings();
});

describe("DEV", () => {
  it("defaults to true when nothing defines the global", () => {
    // The test runner never defines `__FOUR_DEV__`, which is the same situation
    // as a `<script type=module>` or a plain `node` process: bare consumption is
    // development, and nobody has to opt in to warnings.
    expect(globalThis).not.toHaveProperty("__FOUR_DEV__");
    expect(DEV).toBe(true);
  });

  it("is false when the global is defined as false", async () => {
    const production = await importWithFlag(false);
    expect(production.DEV).toBe(false);
  });

  it("is true when the global is defined as true", async () => {
    const development = await importWithFlag(true);
    expect(development.DEV).toBe(true);
  });
});

describe("devWarn", () => {
  it("prefixes the message and writes it to console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    devWarn("something is off");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("[four] something is off");
  });

  it("warns every time — deduplication is devWarnOnce's job", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    devWarn("again");
    devWarn("again");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("is a no-op in a production build", async () => {
    const production = await importWithFlag(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    production.devWarn("nobody should see this");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("devWarnOnce", () => {
  it("emits the first time and reports that it did", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(devWarnOnce("k", "first")).toBe(true);
    expect(warn).toHaveBeenCalledWith("[four] first");
  });

  it("stays silent for a repeated key, even with a different message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    devWarnOnce("k", "first");
    expect(devWarnOnce("k", "a different message, same mistake")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats distinct keys as distinct mistakes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    devWarnOnce("node:1", "conflict");
    devWarnOnce("node:2", "conflict");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warns again after resetDevWarnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    devWarnOnce("k", "first");
    resetDevWarnings();
    expect(devWarnOnce("k", "first")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("is a no-op returning false in a production build", async () => {
    const production = await importWithFlag(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(production.devWarnOnce("k", "nobody should see this")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("clears its keys in a production build without touching the console", async () => {
    const production = await importWithFlag(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    production.resetDevWarnings();
    expect(production.devWarnOnce("k", "still nothing")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("devAssert", () => {
  it("does nothing when the condition holds", () => {
    expect(() => {
      devAssert(true, "INVALID_SCENE_GRAPH", "unreachable");
    }).not.toThrow();
  });

  it("throws a FourError carrying the code and message", () => {
    let thrown: unknown;
    try {
      devAssert(false, "INVALID_SCENE_GRAPH", "the graph has a cycle (§85).");
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (!isFourError(thrown)) return;
    expect(thrown.code).toBe("INVALID_SCENE_GRAPH");
    expect(thrown.message).toContain("cycle");
    expect(thrown.context).toBeUndefined();
  });

  it("attaches the context when one is given", () => {
    let thrown: unknown;
    try {
      devAssert(false, "INVALID_SCENE_GRAPH", "bad", { nodeId: 7 });
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (!isFourError(thrown)) return;
    expect(thrown.context).toEqual({ nodeId: 7 });
  });

  it("does not check at all in a production build", async () => {
    // §85: "Production builds may disable expensive validation." The asymmetry
    // is deliberate and is why `devAssert` must never guard essential safety —
    // those throws stay unconditional `FourError`s.
    const production = await importWithFlag(false);
    expect(() => {
      production.devAssert(false, "INVALID_SCENE_GRAPH", "never thrown");
    }).not.toThrow();
  });
});

describe("§6a's duplicate-component warning follows the flag", () => {
  /**
   * The first call site converted to the flag (`component.ts`), proven at both
   * settings from one place — the component suite covers the warning's content,
   * this covers its build-mode gate.
   */
  async function importRegistry(
    flag: boolean | undefined,
  ): Promise<typeof import("../src/component.js")> {
    if (flag !== undefined) vi.stubGlobal("__FOUR_DEV__", flag);
    vi.resetModules();
    return import("../src/component.js");
  }

  class Marker implements Component {
    static readonly typeName = "test.marker";

    host: ComponentHost | null = null;
  }

  it("warns in a development build", async () => {
    const { ComponentRegistry } = await importRegistry(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const registry = new ComponentRegistry();
    registry.add(new Marker());
    registry.add(new Marker());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("test.marker");
  });

  it("is silent in a production build, and still replaces the component", async () => {
    const { ComponentRegistry } = await importRegistry(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const registry = new ComponentRegistry();
    const first = new Marker();
    const second = new Marker();
    registry.add(first);
    registry.add(second);
    // The *behaviour* §6a specifies — one component of a type per node — is not
    // a development check and does not move with the flag; only the warning does.
    expect(registry.get(Marker)).toBe(second);
    expect(warn).not.toHaveBeenCalled();
  });
});
