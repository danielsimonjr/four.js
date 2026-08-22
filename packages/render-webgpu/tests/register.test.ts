/**
 * The registry opt-in (§62, A-8) and the §62 fallback report a *second*
 * registered backend finally makes reachable.
 *
 * The fallback half is the part that is new to this monorepo rather than a
 * copy of the WebGL suite's: until this packet there was exactly one backend,
 * so `"auto"`'s "try the next one" rung had nothing to try. Here `"auto"` runs
 * with WebGPU registered ahead of a stand-in second backend and is watched
 * moving between them.
 */

import { isFourError } from "@four/core";
import {
  NullRenderer,
  RendererRegistry,
  registeredRenderers,
} from "@four/render";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  WebgpuRenderer,
  isWebgpuSupported,
  registerWebgpuRenderer,
} from "../src/index.js";

describe("isWebgpuSupported", () => {
  it("answers false in Node, which has no navigator.gpu", () => {
    expect(isWebgpuSupported()).toBe(false);
    expect(isWebgpuSupported({ canvas: {}, antialias: true })).toBe(false);
  });

  it("answers true where a navigator.gpu exists — optimistically (§6.2)", async () => {
    const gpu = createRecordingGpu();
    await withHostGpu(gpu.gpu, async () => {
      expect(isWebgpuSupported()).toBe(true);
      return Promise.resolve();
    });
  });

  it("never touches the canvas it is given (§62)", async () => {
    const gpu = createRecordingGpu();
    await withHostGpu(gpu.gpu, async () => {
      const canvas = {
        getContext(): never {
          throw new Error("the probe must not acquire a context");
        },
      };
      expect(isWebgpuSupported({ canvas })).toBe(true);
      return Promise.resolve();
    });
  });
});

describe("registerWebgpuRenderer", () => {
  it("registers the WebGPU backend into the registry it is given", () => {
    const registry = new RendererRegistry();
    expect(registerWebgpuRenderer(registry)).toBe(registry);
    expect(registry.backends).toEqual(["webgpu"]);
    // The shared registry is untouched, which is what keeps this test hermetic
    // — and what keeps `renderer: "auto"` an explicit opt-in (owner Q1).
    expect(registeredRenderers()).toEqual([]);
  });

  it("declares the probe and a factory that builds, not initializes", () => {
    const registry = new RendererRegistry();
    registerWebgpuRenderer(registry);
    const registration = registry.get("webgpu");
    expect(registration?.isSupported({})).toBe(isWebgpuSupported({}));
    const renderer = registration?.create();
    expect(renderer).toBeInstanceOf(WebgpuRenderer);
    expect((renderer as WebgpuRenderer).capabilities.maxTextureSize).toBe(0);
    (renderer as WebgpuRenderer).dispose();
  });

  it("refuses a second registration in the same registry (§62)", () => {
    const registry = new RendererRegistry();
    registerWebgpuRenderer(registry);
    let thrown: unknown;
    try {
      registerWebgpuRenderer(registry);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
    }
  });

  it('is skipped by "auto" where WebGPU does not exist, and named there fails fast', async () => {
    const registry = new RendererRegistry();
    registerWebgpuRenderer(registry);
    await expect(registry.resolve("auto")).rejects.toThrow(
      /"webgpu" \(unsupported\)/u,
    );
    await expect(registry.resolve("webgpu")).rejects.toThrow(/cannot run it/u);
  });

  it('selects WebGPU under "auto" when an adapter can be had', async () => {
    const gpu = createRecordingGpu();
    const registry = new RendererRegistry();
    registerWebgpuRenderer(registry);
    const renderer = await withHostGpu(gpu.gpu, () =>
      registry.resolve("auto", { canvas: gpu.canvas }),
    );
    expect(renderer.capabilities.backend).toBe("webgpu");
    renderer.dispose();
  });

  it("falls back past WebGPU to the next backend, with a §62 report", async () => {
    // The case §62 describes and this monorepo could not exercise until a
    // second backend existed: the probe says WebGPU is present (the browser
    // has `navigator.gpu`), initialization fails (no adapter — the flagless
    // browser), and selection moves on rather than failing the application.
    const gpu = createRecordingGpu({ noAdapter: true });
    const registry = new RendererRegistry();
    registerWebgpuRenderer(registry);

    // `NullRenderer` stands in for the second backend: §62's order is what is
    // under test, not what the fallback draws.
    const stand: NullRenderer[] = [];
    registry.register({
      backend: "webgl2",
      isSupported: () => true,
      create: () => {
        const renderer = new NullRenderer();
        stand.push(renderer);
        return renderer;
      },
    });

    const reports: string[] = [];
    const renderer = await withHostGpu(gpu.gpu, () =>
      registry.resolve("auto", {
        canvas: gpu.canvas,
        onFallback: (report) => {
          reports.push(`${report.backend}:${report.reason}`);
        },
      }),
    );

    expect(reports).toEqual(["webgpu:initialization-failed"]);
    expect(stand).toHaveLength(1);
    expect(renderer).toBe(stand[0]);
    renderer.dispose();
  });

  it('fails fast for an explicit "webgpu" that cannot initialize (§89)', async () => {
    const gpu = createRecordingGpu({ noAdapter: true });
    const registry = new RendererRegistry();
    registerWebgpuRenderer(registry);
    await withHostGpu(gpu.gpu, async () => {
      await expect(
        registry.resolve("webgpu", { canvas: gpu.canvas }),
      ).rejects.toThrow(/no adapter/u);
    });
  });
});
