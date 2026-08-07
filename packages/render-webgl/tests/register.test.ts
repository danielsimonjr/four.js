import { isFourError } from "@four/core";
import { RendererRegistry, registeredRenderers } from "@four/render";
import { afterEach, describe, expect, it } from "vitest";

import {
  WebglRenderer,
  isWebgl2Supported,
  registerWebglRenderer,
} from "../src/index.js";

const GLOBAL = globalThis as Record<string, unknown>;
const KEY = "WebGL2RenderingContext";

/** Installs a `WebGL2RenderingContext` global, as a browser has one. */
function withWebgl2Global(present: boolean): void {
  if (present) {
    GLOBAL[KEY] = function WebGL2RenderingContext(): void {};
  } else {
    delete GLOBAL[KEY];
  }
}

afterEach(() => {
  withWebgl2Global(false);
});

describe("isWebgl2Supported", () => {
  it("answers false in a runtime with no WebGL 2 constructor", () => {
    expect(isWebgl2Supported()).toBe(false);
    expect(isWebgl2Supported({ canvas: {}, antialias: true })).toBe(false);
  });

  it("answers true when the global is present", () => {
    withWebgl2Global(true);
    expect(isWebgl2Supported()).toBe(true);
  });

  it("never touches the canvas it is given (§62)", () => {
    withWebgl2Global(true);
    // A probe that called `getContext` here would fix the context attributes
    // `WebglRenderer.initialize` later asks for — see `register.ts`.
    const canvas = {
      getContext(): never {
        throw new Error("the probe must not acquire a context");
      },
    };
    expect(isWebgl2Supported({ canvas })).toBe(true);
  });
});

describe("registerWebglRenderer", () => {
  it("registers the WebGL 2 backend into the registry it is given", () => {
    const registry = new RendererRegistry();
    expect(registerWebglRenderer(registry)).toBe(registry);
    expect(registry.backends).toEqual(["webgl2"]);
    // The shared registry is untouched, which is what keeps this test hermetic.
    expect(registeredRenderers()).toEqual([]);
  });

  it("declares the WebGL 2 probe and a factory that builds, not initializes", () => {
    const registry = new RendererRegistry();
    registerWebglRenderer(registry);
    const registration = registry.get("webgl2");
    expect(registration?.isSupported({})).toBe(isWebgl2Supported({}));
    const renderer = registration?.create();
    expect(renderer).toBeInstanceOf(WebglRenderer);
    expect((renderer as WebglRenderer).initialized).toBe(false);
    (renderer as WebglRenderer).dispose();
  });

  it("refuses a second registration in the same registry (§62)", () => {
    const registry = new RendererRegistry();
    registerWebglRenderer(registry);
    let thrown: unknown;
    try {
      registerWebglRenderer(registry);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
    }
  });

  it('is skipped by "auto" where WebGL 2 does not exist, and named there fails fast', async () => {
    const registry = new RendererRegistry();
    registerWebglRenderer(registry);
    await expect(registry.resolve("auto")).rejects.toThrow(
      /"webgl2" \(unsupported\)/,
    );
    await expect(registry.resolve("webgl2")).rejects.toThrow(/cannot run it/);
  });

  it('surfaces the backend\'s own §89 failure through "auto" when the probe passes', async () => {
    withWebgl2Global(true);
    const registry = new RendererRegistry();
    registerWebglRenderer(registry);
    // The probe says "WebGL 2 exists here"; `initialize` is the real gate, and
    // it refuses a non-canvas with RENDERER_INITIALIZATION_FAILED (§62, §89).
    await expect(registry.resolve("auto", { canvas: 42 })).rejects.toThrow(
      /"webgl2" \(initialization-failed\)/,
    );
    await expect(registry.resolve("webgl2", { canvas: 42 })).rejects.toThrow(
      /needs a canvas/,
    );
  });
});
