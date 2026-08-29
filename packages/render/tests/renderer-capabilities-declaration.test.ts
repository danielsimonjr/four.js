/**
 * §62's *"applications may declare required and optional capabilities"*
 * (WP-R1.9): validation per §85, the tri-state honesty rule (`undefined` is
 * not an affirmative answer), the `"auto"` skip with its
 * `"missing-capability"` fallback report, the explicit fail-fast, and the
 * optional-shortfall diagnostics — all over scripted backend doubles.
 */

import { EventEmitter, isFourError } from "@four/core";
import { describe, expect, it, vi } from "vitest";

import {
  RENDERER_CAPABILITY_NAMES,
  RendererRegistry,
  missingCapabilities,
  validateCapabilityDeclaration,
  type Renderer,
  type RendererBackend,
  type RendererCapabilities,
  type RendererCapabilityDeclaration,
  type RendererCapabilityShortfall,
  type RendererEventMap,
  type RendererFallbackReport,
} from "../src/index.js";

/** A backend double whose §62 record is scripted per test. */
class CapableBackend implements Renderer {
  readonly events = new EventEmitter<RendererEventMap>();

  readonly capabilities: RendererCapabilities;

  disposeCount = 0;

  constructor(
    backend: RendererBackend,
    capabilities: Partial<RendererCapabilities> = {},
  ) {
    this.capabilities = {
      backend,
      maxTextureSize: 0,
      ...capabilities,
    };
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  render(): void {
    // A double draws nothing.
  }

  resize(): void {
    // A double has no surface.
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}

interface Entry {
  readonly backend: RendererBackend;
  readonly capabilities?: Partial<RendererCapabilities>;
}

function withBackends(entries: readonly Entry[]): {
  registry: RendererRegistry;
  built: Map<RendererBackend, CapableBackend>;
} {
  const registry = new RendererRegistry();
  const built = new Map<RendererBackend, CapableBackend>();
  for (const entry of entries) {
    registry.register({
      backend: entry.backend,
      isSupported: () => true,
      create: () => {
        const renderer = new CapableBackend(entry.backend, entry.capabilities);
        built.set(entry.backend, renderer);
        return renderer;
      },
    });
  }
  return { registry, built };
}

describe("validateCapabilityDeclaration (§85)", () => {
  it("accepts an absent declaration, empty halves, and every known name", () => {
    expect(() => {
      validateCapabilityDeclaration(undefined);
    }).not.toThrow();
    expect(() => {
      validateCapabilityDeclaration({});
    }).not.toThrow();
    expect(() => {
      validateCapabilityDeclaration({
        required: [...RENDERER_CAPABILITY_NAMES],
      });
    }).not.toThrow();
  });

  it("refuses an unknown name, naming the declarable set", () => {
    expect(() => {
      validateCapabilityDeclaration({
        required: ["computShaders"],
      } as unknown as RendererCapabilityDeclaration);
    }).toThrow(/computShaders.*declarable/s);
    expect(() => {
      validateCapabilityDeclaration({
        optional: ["maxTextureSize"],
      } as unknown as RendererCapabilityDeclaration);
    }).toThrow(RangeError);
  });

  it("refuses a half that is not an array", () => {
    expect(() => {
      validateCapabilityDeclaration({
        required: "computeShaders",
      } as unknown as RendererCapabilityDeclaration);
    }).toThrow(/must be an array/);
  });

  it("refuses a name declared both required and optional", () => {
    expect(() => {
      validateCapabilityDeclaration({
        required: ["computeShaders"],
        optional: ["computeShaders"],
      });
    }).toThrow(/both.*required and optional/s);
  });
});

describe("missingCapabilities — the tri-state honesty rule", () => {
  const record = {
    backend: "webgl2",
    maxTextureSize: 0,
    computeShaders: false,
    multisampling: true,
    // `timestampQueries` deliberately unreported.
  } as RendererCapabilities;

  it("treats false and undefined as shortfalls, true as satisfaction", () => {
    expect(
      missingCapabilities(record, [
        "multisampling",
        "computeShaders",
        "timestampQueries",
      ]),
    ).toEqual(["computeShaders", "timestampQueries"]);
  });

  it("answers an absent declaration with no shortfalls", () => {
    expect(missingCapabilities(record, undefined)).toEqual([]);
  });
});

describe('"auto" under a required declaration (§62)', () => {
  it("skips a backend that cannot affirm, reporting reason and answers", async () => {
    const { registry, built } = withBackends([
      // WebGPU answers `false`; WebGL 2 never learned to answer — both are
      // shortfalls, and the walk lands on canvas2d, which affirms.
      { backend: "webgpu", capabilities: { computeShaders: false } },
      { backend: "webgl2", capabilities: {} },
      { backend: "canvas2d", capabilities: { computeShaders: true } },
    ]);
    const fallbacks: RendererFallbackReport[] = [];
    const shortfalls: RendererCapabilityShortfall[] = [];
    const renderer = await registry.resolve("auto", {
      capabilities: { required: ["computeShaders"] },
      onFallback: (report) => fallbacks.push(report),
      onCapabilityShortfall: (report) => shortfalls.push(report),
    });
    expect(renderer.capabilities.backend).toBe("canvas2d");
    // Both skipped backends were disposed — they had initialized.
    expect(built.get("webgpu")?.disposeCount).toBe(1);
    expect(built.get("webgl2")?.disposeCount).toBe(1);
    expect(fallbacks).toEqual([
      {
        backend: "webgpu",
        reason: "missing-capability",
        missing: ["computeShaders"],
      },
      {
        backend: "webgl2",
        reason: "missing-capability",
        missing: ["computeShaders"],
      },
    ]);
    // The tri-state answers are kept apart in the shortfall reports.
    expect(shortfalls).toEqual([
      {
        backend: "webgpu",
        capability: "computeShaders",
        answer: false,
        requirement: "required",
      },
      {
        backend: "webgl2",
        capability: "computeShaders",
        answer: undefined,
        requirement: "required",
      },
    ]);
  });

  it("exhausts the order when nothing affirms, naming every skip", async () => {
    const { registry } = withBackends([
      { backend: "webgl2", capabilities: { computeShaders: false } },
    ]);
    const rejection = await registry
      .resolve("auto", { capabilities: { required: ["computeShaders"] } })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isFourError(rejection)).toBe(true);
    expect(String(rejection)).toContain("missing-capability");
  });

  it("reports the selected backend's optional shortfalls, never gating", async () => {
    const { registry, built } = withBackends([
      {
        backend: "webgl2",
        capabilities: { multisampling: true, computeShaders: false },
      },
    ]);
    const shortfalls: RendererCapabilityShortfall[] = [];
    const renderer = await registry.resolve("auto", {
      capabilities: {
        required: ["multisampling"],
        optional: ["computeShaders", "timestampQueries"],
      },
      onCapabilityShortfall: (report) => shortfalls.push(report),
    });
    expect(renderer).toBe(built.get("webgl2"));
    expect(built.get("webgl2")?.disposeCount).toBe(0);
    expect(shortfalls).toEqual([
      {
        backend: "webgl2",
        capability: "computeShaders",
        answer: false,
        requirement: "optional",
      },
      {
        backend: "webgl2",
        capability: "timestampQueries",
        answer: undefined,
        requirement: "optional",
      },
    ]);
  });

  it("changes nothing when the declaration is satisfied — or absent", async () => {
    const { registry, built } = withBackends([
      { backend: "webgl2", capabilities: { multisampling: true } },
    ]);
    const onCapabilityShortfall = vi.fn();
    const first = await registry.resolve("auto", {
      capabilities: { required: ["multisampling"] },
      onCapabilityShortfall,
    });
    expect(first).toBe(built.get("webgl2"));
    expect(onCapabilityShortfall).not.toHaveBeenCalled();
    const bare = withBackends([{ backend: "webgl2" }]);
    const second = await bare.registry.resolve("auto");
    expect(second).toBe(bare.built.get("webgl2"));
  });

  it("validates the declaration before constructing anything (§85)", async () => {
    const { registry, built } = withBackends([{ backend: "webgl2" }]);
    await expect(
      registry.resolve("auto", {
        capabilities: {
          required: ["bloom"],
        } as unknown as RendererCapabilityDeclaration,
      }),
    ).rejects.toThrow(RangeError);
    expect(built.size).toBe(0);
  });
});

describe("an explicitly named backend under a required declaration (§62)", () => {
  it("fails fast, disposes the renderer, and spells out each non-answer", async () => {
    const { registry, built } = withBackends([
      { backend: "webgpu", capabilities: { computeShaders: false } },
    ]);
    const onCapabilityShortfall = vi.fn();
    const rejection = await registry
      .resolve("webgpu", {
        capabilities: { required: ["computeShaders", "storageBuffers"] },
        onCapabilityShortfall,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isFourError(rejection)).toBe(true);
    const message = String(rejection);
    expect(message).toContain('"computeShaders" (reports it cannot)');
    expect(message).toContain(
      '"storageBuffers" (does not report it — not an affirmative answer)',
    );
    expect(built.get("webgpu")?.disposeCount).toBe(1);
    // Thrown, not reported — the onFallback rule, extended.
    expect(onCapabilityShortfall).not.toHaveBeenCalled();
  });

  it("returns an affirming backend, reporting only optional shortfalls", async () => {
    const { registry, built } = withBackends([
      { backend: "webgpu", capabilities: { computeShaders: true } },
    ]);
    const shortfalls: RendererCapabilityShortfall[] = [];
    const renderer = await registry.resolve("webgpu", {
      capabilities: {
        required: ["computeShaders"],
        optional: ["indirectDraw"],
      },
      onCapabilityShortfall: (report) => shortfalls.push(report),
    });
    expect(renderer).toBe(built.get("webgpu"));
    expect(shortfalls).toEqual([
      {
        backend: "webgpu",
        capability: "indirectDraw",
        answer: undefined,
        requirement: "optional",
      },
    ]);
  });

  it("does not let a throwing dispose mask the refusal (§83)", async () => {
    const registry = new RendererRegistry();
    const renderer = new CapableBackend("webgpu", { computeShaders: false });
    renderer.dispose = () => {
      throw new Error("dispose refused");
    };
    registry.register({
      backend: "webgpu",
      isSupported: () => true,
      create: () => renderer,
    });
    const rejection = await registry
      .resolve("webgpu", { capabilities: { required: ["computeShaders"] } })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isFourError(rejection)).toBe(true);
    expect(String(rejection)).toContain("computeShaders");
  });

  it("survives a throwing dispose under auto's missing-capability skip too", async () => {
    const registry = new RendererRegistry();
    const broken = new CapableBackend("webgpu", { computeShaders: false });
    broken.dispose = () => {
      throw new Error("dispose refused");
    };
    registry.register({
      backend: "webgpu",
      isSupported: () => true,
      create: () => broken,
    });
    const { built } = { built: new Map<RendererBackend, CapableBackend>() };
    void built;
    const fallback = new CapableBackend("webgl2", { computeShaders: true });
    registry.register({
      backend: "webgl2",
      isSupported: () => true,
      create: () => fallback,
    });
    const renderer = await registry.resolve("auto", {
      capabilities: { required: ["computeShaders"] },
    });
    expect(renderer).toBe(fallback);
  });
});
