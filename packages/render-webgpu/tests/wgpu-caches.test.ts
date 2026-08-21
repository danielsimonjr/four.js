/**
 * The three pieces the renderer is assembled from, tested directly: the
 * lazy pipeline cache and its canonical key, the geometry cache, and the
 * WGSL/bind-group-layout pair that RFC 0001 will one day target.
 *
 * They are exported from `src/index.ts` for exactly this reason — the same
 * argument `@four/render-webgl` makes for exporting `GL`, `UnlitProgram` and
 * `GeometryCache`: a seam a test can reach is a seam a failure can be localised
 * to.
 */

import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  CLEAR_SHADER_SOURCE,
  COLOR_SHADER_LOCATION,
  DRAW_COLOR_OFFSET,
  DRAW_MODEL_OFFSET,
  DRAW_UNIFORM_BYTES,
  DRAW_UNIFORM_FLOATS,
  DRAW_UNIFORM_WGSL,
  DRAW_VIEW_PROJECTION_OFFSET,
  GPU_BUFFER_USAGE,
  POSITION_SHADER_LOCATION,
  UNIFORM_STRIDE_BYTES,
  WgpuGeometryCache,
  WgpuPipelineCache,
  createDrawBindGroupLayout,
  pipelineKey,
  unlitShaderSource,
  unlitVertexBufferLayouts,
  type CacheableGeometry,
  type GpuDevice,
  type WgpuPipelineDescriptor,
} from "../src/index.js";

/** A device to build caches over; `device` is non-null for the default options. */
function device(): {
  device: GpuDevice;
  gpu: ReturnType<typeof createRecordingGpu>;
} {
  const gpu = createRecordingGpu();
  return { device: gpu.device as GpuDevice, gpu };
}

const BASE: WgpuPipelineDescriptor = {
  kind: "unlit",
  vertexColors: false,
  blend: "none",
  depthTest: true,
  depthWrite: true,
  colorWrite: true,
  topology: "triangle-list",
  colorFormat: "bgra8unorm",
  depthFormat: "depth24plus",
};

let nextId = 0;

/** A §53 geometry double, exactly the shape `RenderItem["geometry"]` has. */
function geometry(
  overrides: Partial<{
    positions: Float32Array;
    colors: Float32Array;
    indices: Uint16Array | Uint32Array;
    mode: "triangles" | "lines";
    version: number;
  }> = {},
): CacheableGeometry {
  nextId += 1;
  const positions =
    overrides.positions ?? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = overrides.indices;
  return {
    id: `geometry-${String(nextId)}`,
    version: overrides.version ?? 0,
    positions,
    colors: overrides.colors,
    indices,
    mode: overrides.mode ?? "triangles",
    drawCount: indices === undefined ? positions.length / 3 : indices.length,
  } as unknown as CacheableGeometry;
}

describe("pipelineKey", () => {
  it("is a total, canonical function of the descriptor", () => {
    expect(pipelineKey(BASE)).toBe(
      "unlit|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus",
    );
    expect(pipelineKey({ ...BASE, vertexColors: true })).toContain("|vc|");
    expect(pipelineKey({ ...BASE, depthFormat: null })).toMatch(/\|-$/u);
  });

  it("separates every field that a pipeline bakes in", () => {
    const keys = new Set<string>();
    for (const descriptor of [
      BASE,
      { ...BASE, kind: "clear" as const },
      { ...BASE, vertexColors: true },
      { ...BASE, blend: "normal" as const },
      { ...BASE, blend: "additive" as const },
      { ...BASE, blend: "multiply" as const },
      { ...BASE, blend: "screen" as const },
      { ...BASE, depthTest: false },
      { ...BASE, depthWrite: false },
      { ...BASE, colorWrite: false },
      { ...BASE, topology: "line-list" as const },
      { ...BASE, colorFormat: "rgba8unorm" },
      { ...BASE, depthFormat: null },
    ]) {
      keys.add(pipelineKey(descriptor));
    }
    expect(keys.size).toBe(13);
  });

  it("is stable across two structurally identical descriptors", () => {
    // The §33 hazard the string key exists for: two objects, one key.
    expect(pipelineKey({ ...BASE })).toBe(pipelineKey({ ...BASE }));
  });
});

describe("WgpuPipelineCache", () => {
  it("creates a pipeline on first use and reuses it after", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    gpu.reset();

    const first = cache.acquire(BASE);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(cache.acquire(BASE)).toBe(first);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("shares one WGSL module across a variant's pipelines", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    gpu.reset();

    cache.acquire(BASE);
    cache.acquire({ ...BASE, blend: "additive" });
    cache.acquire({ ...BASE, depthWrite: false });
    expect(gpu.countOf("device.createRenderPipeline")).toBe(3);
    expect(cache.moduleCount).toBe(1);

    cache.acquire({ ...BASE, vertexColors: true });
    cache.acquire({ ...BASE, kind: "clear" });
    expect(cache.moduleCount).toBe(3);
  });

  it("gives every §57 blend mode its WebGPU factors", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    for (const blend of ["normal", "additive", "multiply", "screen"] as const) {
      cache.acquire({ ...BASE, blend });
    }
    const blends = gpu.callsOf("device.createRenderPipeline").map(
      (call) =>
        (
          call.args[0] as {
            fragment: {
              targets: {
                blend?: { color: { srcFactor: string; dstFactor: string } };
              }[];
            };
          }
        ).fragment.targets[0]?.blend?.color,
    );
    expect(blends).toEqual([
      {
        srcFactor: "src-alpha",
        dstFactor: "one-minus-src-alpha",
        operation: "add",
      },
      { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
      { srcFactor: "dst", dstFactor: "zero", operation: "add" },
      { srcFactor: "one", dstFactor: "one-minus-src", operation: "add" },
    ]);
  });

  it("declares no blend at all for an opaque draw", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire(BASE);
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { fragment: { targets: Record<string, unknown>[] } };
    expect(descriptor.fragment.targets[0]).not.toHaveProperty("blend");
  });

  it("maps §57's depthTest onto a comparison, never onto a missing state", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire(BASE);
    cache.acquire({ ...BASE, depthTest: false });
    const compares = gpu
      .callsOf("device.createRenderPipeline")
      .map(
        (call) =>
          (call.args[0] as { depthStencil?: { depthCompare: string } })
            .depthStencil?.depthCompare,
      );
    expect(compares).toEqual(["less", "always"]);
  });

  it("omits the depth state for a pass with no depth attachment", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire({ ...BASE, depthFormat: null });
    expect(
      gpu.callsOf("device.createRenderPipeline")[0]?.args[0],
    ).not.toHaveProperty("depthStencil");
  });

  it("gives the clear pipeline no vertex buffers", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire({ ...BASE, kind: "clear" });
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { vertex: { buffers: unknown[] } };
    expect(descriptor.vertex.buffers).toEqual([]);
  });

  it("uses an explicit pipeline layout, never `auto` (§7's RFC-0001 debt)", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire(BASE);
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { layout: unknown };
    expect(descriptor.layout).not.toBe("auto");
    expect(gpu.countOf("device.createPipelineLayout")).toBe(1);
  });

  it("returns null once disposed, and disposal is idempotent", () => {
    const { device: gpuDevice } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire(BASE);
    cache.dispose();
    cache.dispose();
    expect(cache.disposed).toBe(true);
    expect(cache.size).toBe(0);
    expect(cache.moduleCount).toBe(0);
    expect(cache.acquire(BASE)).toBeNull();
  });
});

describe("WgpuGeometryCache", () => {
  it("uploads once and reuses until the version advances", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    const source = geometry();

    const first = cache.acquire(source);
    expect(first).not.toBeNull();
    expect(cache.acquire(source)).toBe(first);
    expect(gpu.countOf("device.createBuffer")).toBe(1);
    expect(cache.size).toBe(1);

    (source as unknown as { version: number }).version = 1;
    const second = cache.acquire(source);
    expect(second).not.toBe(first);
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("declares VERTEX|COPY_DST for a vertex stream and INDEX for indices", () => {
    const { device: gpuDevice, gpu } = device();
    new WgpuGeometryCache(gpuDevice).acquire(
      geometry({ indices: new Uint16Array([0, 1, 2]) }),
    );
    const usages = gpu
      .callsOf("device.createBuffer")
      .map((call) => (call.args[0] as { usage: number }).usage);
    expect(usages).toEqual([
      GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
      GPU_BUFFER_USAGE.INDEX | GPU_BUFFER_USAGE.COPY_DST,
    ]);
  });

  it("pads an allocation to a multiple of four bytes", () => {
    const { device: gpuDevice, gpu } = device();
    // Three `Uint16` indices are six bytes; `writeBuffer` needs a multiple of 4.
    new WgpuGeometryCache(gpuDevice).acquire(
      geometry({ indices: new Uint16Array([0, 1, 2]) }),
    );
    const sizes = gpu
      .callsOf("device.createBuffer")
      .map((call) => (call.args[0] as { size: number }).size);
    expect(sizes[1]).toBe(8);
  });

  it("records the index format and the topology", () => {
    const { device: gpuDevice } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    expect(
      cache.acquire(geometry({ indices: new Uint16Array([0, 1, 2]) }))
        ?.indexFormat,
    ).toBe("uint16");
    expect(
      cache.acquire(geometry({ indices: new Uint32Array([0, 1, 2]) }))
        ?.indexFormat,
    ).toBe("uint32");
    expect(cache.acquire(geometry())?.indexFormat).toBeNull();
    expect(cache.acquire(geometry({ mode: "lines" }))?.topology).toBe(
      "line-list",
    );
  });

  it("uploads the optional colour stream when there is one", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    expect(cache.acquire(geometry())?.colorBuffer).toBeNull();
    gpu.reset();
    const record = cache.acquire(
      geometry({ colors: new Float32Array(12).fill(1) }),
    );
    expect(record?.colorBuffer).not.toBeNull();
    expect(gpu.countOf("device.createBuffer")).toBe(2);
  });

  it("returns null for a geometry with nothing to draw, and caches nothing", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    expect(
      cache.acquire(geometry({ positions: new Float32Array(0) })),
    ).toBeNull();
    expect(cache.size).toBe(0);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("forgets everything without touching a lost device", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    cache.acquire(geometry());
    gpu.reset();
    cache.forget();
    expect(cache.size).toBe(0);
    expect(gpu.calls).toHaveLength(0);
  });

  it("destroys every allocation on dispose, idempotently", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    cache.acquire(geometry({ indices: new Uint16Array([0, 1, 2]) }));
    // …and one carrying the optional colour stream, so both arms of the
    // optional-chain teardown run.
    cache.acquire(geometry({ colors: new Float32Array(12).fill(1) }));
    gpu.reset();
    cache.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(4);
    gpu.reset();
    cache.dispose();
    expect(gpu.calls).toHaveLength(0);
    expect(cache.disposed).toBe(true);
    expect(cache.acquire(geometry())).toBeNull();
  });
});

describe("the bind-group layout, declared as data (§7)", () => {
  it("declares one dynamically-offset uniform binding, visible to both stages", () => {
    const { device: gpuDevice, gpu } = device();
    createDrawBindGroupLayout(gpuDevice);
    const descriptor = gpu.callsOf("device.createBindGroupLayout")[0]
      ?.args[0] as {
      entries: {
        binding: number;
        visibility: number;
        buffer: {
          type: string;
          hasDynamicOffset: boolean;
          minBindingSize: number;
        };
      }[];
    };
    expect(descriptor.entries).toHaveLength(1);
    expect(descriptor.entries[0]?.binding).toBe(0);
    expect(descriptor.entries[0]?.visibility).toBe(0x1 | 0x2);
    expect(descriptor.entries[0]?.buffer).toEqual({
      type: "uniform",
      hasDynamicOffset: true,
      minBindingSize: DRAW_UNIFORM_BYTES,
    });
  });

  it("keeps the block size and the stride distinct", () => {
    // Conflating them would bind 112 bytes of the next draw's block into this
    // draw's shader — see `wgpu-bindings.ts`.
    expect(DRAW_UNIFORM_BYTES).toBe(144);
    expect(DRAW_UNIFORM_FLOATS).toBe(36);
    expect(UNIFORM_STRIDE_BYTES).toBe(256);
    expect(DRAW_VIEW_PROJECTION_OFFSET).toBe(0);
    expect(DRAW_MODEL_OFFSET).toBe(64);
    expect(DRAW_COLOR_OFFSET).toBe(128);
  });

  it("is the same declaration the WGSL reads", () => {
    expect(DRAW_UNIFORM_WGSL).toContain("@group(0) @binding(0)");
    expect(unlitShaderSource(false)).toContain(DRAW_UNIFORM_WGSL);
    expect(CLEAR_SHADER_SOURCE).toContain(DRAW_UNIFORM_WGSL);
  });
});

describe("the unlit WGSL", () => {
  it("remaps WebGL clip depth onto WebGPU's [0, 1]", () => {
    expect(unlitShaderSource(false)).toContain("(clip.z + clip.w) * 0.5");
  });

  it("is a pure function of its variant flag", () => {
    expect(unlitShaderSource(true)).toBe(unlitShaderSource(true));
    expect(unlitShaderSource(true)).not.toBe(unlitShaderSource(false));
  });

  it("reads the colour stream only in the vertex-coloured variant", () => {
    expect(unlitShaderSource(false)).not.toContain("vertexColor");
    expect(unlitShaderSource(true)).toContain("draw.color * vertexColor");
    expect(unlitShaderSource(true)).toContain(
      `@location(${String(COLOR_SHADER_LOCATION)}) vertexColor`,
    );
    expect(unlitShaderSource(false)).toContain(
      `@location(${String(POSITION_SHADER_LOCATION)}) position`,
    );
  });

  it("binds a second vertex buffer only for that variant", () => {
    expect(unlitVertexBufferLayouts(false)).toHaveLength(1);
    expect(unlitVertexBufferLayouts(true)).toHaveLength(2);
    expect(unlitVertexBufferLayouts(true)[1]?.arrayStride).toBe(16);
    expect(unlitVertexBufferLayouts(false)[0]?.arrayStride).toBe(12);
  });

  it("generates the clear triangle from the vertex index alone", () => {
    expect(CLEAR_SHADER_SOURCE).toContain("@builtin(vertex_index)");
    expect(CLEAR_SHADER_SOURCE).not.toContain("@location(0) position");
  });
});
