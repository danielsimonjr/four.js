/**
 * Unit tests for the WebGPU backend, driven by the recording device double.
 *
 * ## Why a double, and why *this* double
 *
 * Node has no WebGPU at all — `globalThis.navigator.gpu` is `undefined` under
 * Node 22 — so unlike the WebGL backend there is not even a headless-gl to
 * reach for. The backend talks to WebGPU through exactly one set of structural
 * interfaces (`src/webgpu-device.ts`), so an object implementing them is a
 * *complete* double, and the double is shared with the cross-package suites
 * (`tests/integration/helpers/recording-gpu.ts`, the twin of `recording-gl.ts`)
 * rather than copied here: one tape, one set of gotchas, two consumers.
 *
 * What the double cannot check is whether the commands *mean* what we think —
 * that the WGSL compiles, that the winding is right, that a triangle appears.
 * That is `tests/browser/webgpu/`'s job against a real SwiftShader adapter, and
 * it is the reason this file asserts sequences rather than pixels.
 *
 * ## Why the scene objects are doubles too
 *
 * `@four/render-webgpu`'s dependencies are `core`, `math`, and `render` (plan
 * §3.1, frozen). Cameras, `BufferGeometry` and `UnlitMaterial` live in
 * `@four/scene`, `@four/geometry` and `@four/materials`, so importing them here
 * — even in a test — would be a phantom dependency outside the matrix. They are
 * therefore typed doubles derived from the very types the renderer consumes,
 * exactly as `packages/render-webgl/tests/webgl-renderer.test.ts` does.
 */

import { isFourError, type FourError } from "@four/core";
import { Matrix4 } from "@four/math";
import {
  Renderable,
  createRenderStatistics,
  type RenderItem,
  type Renderer,
  type UnlitRenderItem,
} from "@four/render";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  DRAW_COLOR_OFFSET,
  DRAW_MODEL_OFFSET,
  UNIFORM_STRIDE_BYTES,
  WebgpuRenderer,
  hostGpu,
} from "../src/index.js";

type RenderView = Parameters<Renderer["render"]>[1][number];
type RenderCamera = RenderView["camera"];
type ItemGeometry = RenderItem["geometry"];
type ItemMaterial = UnlitRenderItem["material"];

let nextGeometryId = 0;

/** §53's `BufferGeometry`, reduced to what a render item carries. */
class TestGeometry {
  readonly id: string;

  version = 0;

  positions: Float32Array;

  normals: Float32Array | undefined;

  uvs: Float32Array | undefined;

  colors: Float32Array | undefined;

  indices: Uint16Array | Uint32Array | undefined;

  mode: "triangles" | "lines" = "triangles";

  constructor(
    positions: Float32Array,
    indices?: Uint16Array | Uint32Array,
    mode: "triangles" | "lines" = "triangles",
    colors?: Float32Array,
  ) {
    nextGeometryId += 1;
    this.id = `test-geometry-${String(nextGeometryId)}`;
    this.positions = positions;
    this.indices = indices;
    this.mode = mode;
    this.colors = colors;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get drawCount(): number {
    return this.indices === undefined
      ? this.positions.length / 3
      : this.indices.length;
  }

  markDirty(): void {
    this.version += 1;
  }

  get asGeometry(): ItemGeometry {
    return this as unknown as ItemGeometry;
  }
}

let nextTextureId = 0;

/** §77's `MaterialTexture` read contract, reduced to what the cache reads. */
class TestTexture {
  readonly id: string;

  version = 0;

  readonly width: number;

  readonly height: number;

  data: Uint8Array | null;

  disposed = false;

  mipmaps?: boolean;

  constructor(width = 2, height = 2) {
    nextTextureId += 1;
    this.id = `test-texture-${String(nextTextureId)}`;
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  markDirty(): void {
    this.version += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.version += 1;
  }
}

/** §57's `UnlitMaterial`, reduced to the state the pipeline descriptor reads. */
class TestMaterial {
  readonly color: [number, number, number, number];

  transparent?: boolean;

  blendMode?: "normal" | "additive" | "multiply" | "screen";

  depthTest?: boolean;

  depthWrite?: boolean;

  colorWrite?: boolean;

  opacity?: number;

  vertexColors?: boolean;

  map?: TestTexture | null;

  constructor(color: [number, number, number, number] = [1, 1, 1, 1]) {
    this.color = color;
  }

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

/** §47's camera, reduced to the two matrices and the one method a frame calls. */
class TestCamera {
  readonly projectionMatrix = new Matrix4();

  readonly viewMatrix = new Matrix4();

  readonly transform = { worldMatrix: new Matrix4() };

  layers: number | undefined = undefined;

  updateViewMatrixCalls = 0;

  updateViewMatrix(): void {
    this.updateViewMatrixCalls += 1;
  }

  get asCamera(): RenderCamera {
    return this as unknown as RenderCamera;
  }
}

/** A unit triangle at the origin, inside every default frustum. */
function triangle(colors?: Float32Array): TestGeometry {
  return new TestGeometry(
    new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    undefined,
    "triangles",
    colors,
  );
}

/** A triangle carrying the uv stream §77's textured variant samples with. */
function texturedTriangle(colors?: Float32Array): TestGeometry {
  const geometry = triangle(colors);
  geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  return geometry;
}

function renderable(
  geometry: TestGeometry,
  material: TestMaterial = new TestMaterial(),
): Renderable {
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

/** A root that draws nothing itself — an empty geometry, as the GL suite uses. */
function createRoot(): Renderable {
  return renderable(new TestGeometry(new Float32Array(0)));
}

function createView(overrides: Partial<RenderView> = {}): RenderView {
  return {
    id: "main",
    camera: new TestCamera().asCamera,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    normalized: true,
    ...overrides,
  };
}

interface Harness {
  readonly gpu: RecordingGpu;
  readonly renderer: WebgpuRenderer;
}

/** Builds an initialized renderer over a fresh recording device. */
async function initialized(
  options: Parameters<typeof createRecordingGpu>[0] = {},
): Promise<Harness> {
  const gpu = createRecordingGpu(options);
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  gpu.reset();
  return { gpu, renderer };
}

/**
 * The frame's **uniform** upload — the last `queue.writeBuffer` of the call.
 *
 * Geometry uploads use the same entry point, so "the frame's uniforms" is the
 * one issued after the passes are recorded (`webgpu-renderer.ts`: one upload
 * for the whole frame, enqueued before the submit that reads it).
 */
function uniformUpload(gpu: RecordingGpu): number[] {
  const uploads = gpu.callsOf("queue.writeBuffer");
  const last = uploads[uploads.length - 1];
  if (last === undefined) {
    throw new Error("the frame uploaded no uniforms");
  }
  return last.args[2] as number[];
}

/**
 * How many §77 map textures the tape allocates — `createTexture` calls minus
 * the frame's own depth attachment, told apart by the cache's label.
 */
function mapAllocations(gpu: RecordingGpu): number {
  return gpu
    .callsOf("device.createTexture")
    .filter((call) =>
      String((call.args[0] as { label?: string }).label).startsWith(
        "four:texture:",
      ),
    ).length;
}

/** Awaits a rejection and returns the `FourError` it carried. */
async function rejection(promise: Promise<unknown>): Promise<FourError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the promise to reject");
}

describe("hostGpu", () => {
  it("is undefined in Node, whose navigator carries no gpu", () => {
    expect(hostGpu()).toBeUndefined();
  });

  it("is undefined in a host with no navigator at all (a worker, old Node)", () => {
    const host = globalThis as object;
    const previous = Object.getOwnPropertyDescriptor(host, "navigator");
    Object.defineProperty(host, "navigator", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(hostGpu()).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete (host as Record<string, unknown>)["navigator"];
      } else {
        Object.defineProperty(host, "navigator", previous);
      }
    }
  });

  it("is undefined when a navigator carries no gpu", async () => {
    await withHostGpu(undefined, async () => {
      expect(hostGpu()).toBeUndefined();
      return Promise.resolve();
    });
  });

  it("is undefined when navigator.gpu cannot request an adapter", () => {
    const host = globalThis as object;
    const previous = Object.getOwnPropertyDescriptor(host, "navigator");
    Object.defineProperty(host, "navigator", {
      value: { gpu: { requestAdapter: 42 } },
      configurable: true,
      writable: true,
    });
    try {
      expect(hostGpu()).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete (host as Record<string, unknown>)["navigator"];
      } else {
        Object.defineProperty(host, "navigator", previous);
      }
    }
  });

  it("finds a gpu the host installed", async () => {
    const gpu = createRecordingGpu();
    await withHostGpu(gpu.gpu, async () => {
      expect(hostGpu()).toBe(gpu.gpu);
      return Promise.resolve();
    });
    expect(hostGpu()).toBeUndefined();
  });
});

describe("WebgpuRenderer.initialize", () => {
  it("acquires an adapter, a device and the canvas context, in that order", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });

    expect(gpu.calls.map((call) => call.name).slice(0, 4)).toEqual([
      "gpu.requestAdapter",
      "adapter.requestDevice",
      "context.configure",
      "device.createBindGroupLayout",
    ]);
    expect(gpu.callsOf("context.configure")[0]?.args[0]).toEqual({
      format: "bgra8unorm",
      alphaMode: "premultiplied",
    });
    renderer.dispose();
  });

  it("compiles no pipeline at initialization — pipelines are lazy", async () => {
    const { gpu } = await initialized();
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
  });

  it("publishes §62's capability record off the device", async () => {
    const { renderer } = await initialized();
    const capabilities = renderer.capabilities;

    expect(capabilities.backend).toBe("webgpu");
    expect(capabilities.maxTextureSize).toBe(8192);
    expect(capabilities.computeShaders).toBe(true);
    expect(capabilities.storageBuffers).toBe(true);
    expect(capabilities.indirectDraw).toBe(true);
    expect(capabilities.timestampQueries).toBe(true);
    expect(capabilities.shaderPrecision).toBe("highp");
    expect(capabilities.maxUniformBufferBytes).toBe(65536);
    expect(capabilities.maxBindings).toBe(640);
    expect(capabilities.textureFormats).toEqual(["rgba8"]);
    // The backend cannot make one yet, whatever the device could (WP-R1.6).
    expect(capabilities.floatRenderTargets).toBe(false);
  });

  it("reports the floor for a device that will not state its limits", async () => {
    const gpu = createRecordingGpu({ limits: {}, features: [] });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });

    expect(renderer.capabilities.maxTextureSize).toBe(0);
    expect(renderer.capabilities.computeShaders).toBe(false);
    expect(renderer.capabilities.storageBuffers).toBe(false);
    expect(renderer.capabilities.timestampQueries).toBe(false);
    expect(renderer.capabilities.compressedTextureFormats).toEqual([]);
  });

  it("reports the compressed formats the device has", async () => {
    const gpu = createRecordingGpu({
      features: ["texture-compression-bc", "texture-compression-astc"],
    });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(renderer.capabilities.compressedTextureFormats).toEqual([
      "texture-compression-bc",
      "texture-compression-astc",
    ]);
  });

  it("reports the floor before initialization", () => {
    const renderer = new WebgpuRenderer();
    expect(renderer.capabilities).toEqual({
      backend: "webgpu",
      maxTextureSize: 0,
      textureFormats: [],
      multisampling: false,
      floatRenderTargets: false,
      timestampQueries: false,
      storageBuffers: false,
      computeShaders: false,
      indirectDraw: false,
      compressedTextureFormats: [],
      shaderPrecision: "none",
      maxUniformBufferBytes: 0,
      maxBindings: 0,
    });
  });

  it("falls back to bgra8unorm when the host names no preferred format", async () => {
    const gpu = createRecordingGpu({ noPreferredFormat: true });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(gpu.callsOf("context.configure")[0]?.args[0]).toEqual({
      format: "bgra8unorm",
      alphaMode: "premultiplied",
    });
  });

  it("rejects with RENDERER_INITIALIZATION_FAILED without a canvas", async () => {
    const renderer = new WebgpuRenderer();
    const error = await rejection(renderer.initialize());
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("rejects when `canvas` is not a canvas", async () => {
    const renderer = new WebgpuRenderer();
    expect((await rejection(renderer.initialize({ canvas: {} }))).code).toBe(
      "RENDERER_INITIALIZATION_FAILED",
    );
  });

  it("rejects when the environment has no navigator.gpu", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    const error = await rejection(renderer.initialize({ canvas: gpu.canvas }));
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(error.message).toContain("navigator.gpu");
  });

  it("rejects when requestAdapter resolves null — the flagless browser", async () => {
    const gpu = createRecordingGpu({ noAdapter: true });
    const renderer = new WebgpuRenderer();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(error.message).toContain("no adapter");
  });

  it("rejects when requestDevice resolves null", async () => {
    const gpu = createRecordingGpu({ noDevice: true });
    const renderer = new WebgpuRenderer();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(error.message).toContain("no device");
  });

  it("rejects, and destroys the device, when the canvas has no webgpu context", async () => {
    const gpu = createRecordingGpu({ badContext: true });
    const renderer = new WebgpuRenderer();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(gpu.countOf("device.destroy")).toBe(1);
  });

  it("rejects when the canvas hands back no context at all", async () => {
    const gpu = createRecordingGpu({ noContext: true });
    const renderer = new WebgpuRenderer();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("reports the floor for a device that states no limits at all", async () => {
    const gpu = createRecordingGpu({ noLimits: true });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(renderer.capabilities.maxTextureSize).toBe(0);
    expect(renderer.capabilities.timestampQueries).toBe(false);
    renderer.dispose();
  });

  it("rejects a second initialize with INVALID_APPLICATION_STATE", async () => {
    const { gpu, renderer } = await initialized();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });
});

describe("WebgpuRenderer.render", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  it("draws nothing at all for an empty view list", () => {
    harness.renderer.render(createRoot(), []);
    expect(harness.gpu.calls).toHaveLength(0);
  });

  it("skips the frame when a render target is passed (WP-R1.6)", () => {
    harness.renderer.render(createRoot(), [createView()], undefined, {});
    expect(harness.gpu.calls).toHaveLength(0);
  });

  it("records one pass for the frame, with a clear draw per view", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [
      createView({ clearColor: [0.25, 0.5, 0.75, 1] }),
    ]);

    const names = harness.gpu.calls.map((call) => call.name);
    expect(
      names.filter((name) => name === "encoder.beginRenderPass"),
    ).toHaveLength(1);
    expect(names.filter((name) => name === "pass.end")).toHaveLength(1);
    expect(names.filter((name) => name === "queue.submit")).toHaveLength(1);
    // Clear draw, then the triangle.
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
    expect(harness.gpu.countOf("pass.setViewport")).toBe(1);
    expect(harness.gpu.countOf("pass.setScissorRect")).toBe(1);
  });

  it("loads rather than clears the colour attachment (§61's rectangle rule)", () => {
    harness.renderer.render(createRoot(), [createView()]);
    const descriptor = harness.gpu.callsOf("encoder.beginRenderPass")[0]
      ?.args[0] as {
      colorAttachments: { loadOp: string }[];
      depthStencilAttachment: { depthLoadOp: string };
    };
    expect(descriptor.colorAttachments[0]?.loadOp).toBe("load");
    expect(descriptor.depthStencilAttachment.depthLoadOp).toBe("load");
  });

  it("flips §48's bottom-left rectangle into WebGPU's top-left one", () => {
    harness.renderer.render(createRoot(), [
      createView({ x: 0, y: 0, width: 1, height: 0.5 }),
    ]);
    // A bottom half of a 256-pixel surface is the *lower* 128 rows, which in
    // top-left coordinates starts at y = 128.
    expect(
      harness.gpu.callsOf("pass.setViewport")[0]?.args.slice(0, 4),
    ).toEqual([0, 128, 256, 128]);
    expect(harness.gpu.callsOf("pass.setScissorRect")[0]?.args).toEqual([
      0, 128, 256, 128,
    ]);
  });

  it("takes an un-normalized rectangle as device pixels (§48)", () => {
    harness.renderer.render(createRoot(), [
      createView({ x: 8, y: 16, width: 32, height: 64, normalized: false }),
    ]);
    // Bottom-left (8, 16) of a 256-pixel surface, 64 tall, is top-left y = 176.
    expect(harness.gpu.callsOf("pass.setScissorRect")[0]?.args).toEqual([
      8, 176, 32, 64,
    ]);
  });

  it("skips a view with an empty rectangle", () => {
    harness.renderer.render(createRoot(), [
      createView({ width: 0, normalized: true }),
    ]);
    expect(harness.gpu.countOf("pass.setViewport")).toBe(0);
    expect(harness.gpu.countOf("pass.draw")).toBe(0);
  });

  it("clears colour only where the view asks for it", () => {
    const first = harness.renderer;
    first.render(createRoot(), [createView()]);
    const withoutColor = harness.gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { fragment: { targets: { writeMask: number }[] } };
    expect(withoutColor.fragment.targets[0]?.writeMask).toBe(0);

    harness.gpu.reset();
    first.render(createRoot(), [createView({ clearColor: [1, 0, 0, 1] })]);
    const withColor = harness.gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { fragment: { targets: { writeMask: number }[] } };
    expect(withColor.fragment.targets[0]?.writeMask).toBe(0xf);
  });

  it("uploads the frame's uniforms once, before the submit that reads them", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView({ clearColor: [1, 0, 0, 0.5] })]);

    const names = harness.gpu.calls.map((call) => call.name);
    expect(names.lastIndexOf("queue.writeBuffer")).toBeLessThan(
      names.indexOf("queue.submit"),
    );

    const data = uniformUpload(harness.gpu);
    // Block 0 is the clear: its colour is the view's clear colour.
    const clearColor = DRAW_COLOR_OFFSET / 4;
    expect(data.slice(clearColor, clearColor + 4)).toEqual([1, 0, 0, 0.5]);
    // Block 1 is the triangle, at the next 256-byte stride.
    const stride = UNIFORM_STRIDE_BYTES / 4;
    expect(data.slice(stride + clearColor, stride + clearColor + 4)).toEqual([
      1, 1, 1, 1,
    ]);
    // …and its model matrix is the identity the node resolves to.
    const model = stride + DRAW_MODEL_OFFSET / 4;
    expect(data[model]).toBe(1);
    expect(data[model + 5]).toBe(1);
  });

  it("copies retained typed arrays at record time (the recording gotcha)", () => {
    const root = createRoot();
    const material = new TestMaterial([1, 0, 0, 1]);
    root.add(renderable(triangle(), material));
    harness.renderer.render(root, [createView()]);
    const first = uniformUpload(harness.gpu);

    material.color[0] = 0;
    material.color[1] = 1;
    harness.renderer.render(root, [createView()]);

    const stride = UNIFORM_STRIDE_BYTES / 4;
    const colour = stride + DRAW_COLOR_OFFSET / 4;
    // The first frame's tape still reports the first frame's colour, even
    // though the staging array it was handed has since been rewritten.
    expect(first.slice(colour, colour + 3)).toEqual([1, 0, 0]);
  });

  it("multiplies §57's opacity into the uploaded alpha", () => {
    const root = createRoot();
    const material = new TestMaterial([1, 1, 1, 0.5]);
    material.opacity = 0.5;
    root.add(renderable(triangle(), material));
    harness.renderer.render(root, [createView()]);

    const data = uniformUpload(harness.gpu);
    const alpha = UNIFORM_STRIDE_BYTES / 4 + DRAW_COLOR_OFFSET / 4 + 3;
    expect(data[alpha]).toBeCloseTo(0.25);
  });

  it("binds the uniform buffer at one dynamic offset per draw", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()]);

    const offsets = harness.gpu
      .callsOf("pass.setBindGroup")
      .map((call) => (call.args[2] as number[])[0]);
    expect(offsets).toEqual([0, 256, 512]);
    // One bind group for the whole frame, created once at initialization.
    expect(harness.gpu.countOf("device.createBindGroup")).toBe(0);
  });

  it("uploads a geometry once and reuses it across frames", () => {
    const root = createRoot();
    const geometry = triangle();
    root.add(renderable(geometry));
    harness.renderer.render(root, [createView()]);
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(1);

    geometry.markDirty();
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(2);
  });

  it("compiles one pipeline per distinct descriptor, and no more", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()]);
    // The clear pipeline plus one unlit pipeline shared by both triangles.
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(2);

    harness.gpu.reset();
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(0);
  });

  it("draws indexed geometry through drawIndexed", () => {
    const root = createRoot();
    root.add(
      renderable(
        new TestGeometry(
          new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
          new Uint16Array([0, 1, 2]),
        ),
      ),
    );
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.setIndexBuffer")).toBe(1);
    expect(harness.gpu.callsOf("pass.setIndexBuffer")[0]?.args[1]).toBe(
      "uint16",
    );
    expect(harness.gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(3);
  });

  it("binds the colour stream only for a vertexColors material that has one", () => {
    const root = createRoot();
    const coloured = new TestMaterial();
    coloured.vertexColors = true;
    root.add(renderable(triangle(new Float32Array(12).fill(1)), coloured));
    // A vertexColors material whose geometry carries no colour stream falls
    // back to the flat variant rather than binding a buffer that is not there.
    const without = new TestMaterial();
    without.vertexColors = true;
    root.add(renderable(triangle(), without));

    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.setVertexBuffer")).toBe(3);
    // Clear + flat unlit + vertex-coloured unlit.
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(3);
  });

  it("samples §57's map through group 1 when the geometry carries uvs", () => {
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture();
    root.add(renderable(texturedTriangle(), material));
    harness.renderer.render(root, [createView()]);

    // The texture uploads once and binds beside its sampler at group 1. (The
    // frame's other `createTexture` is the depth attachment.)
    expect(mapAllocations(harness.gpu)).toBe(1);
    expect(harness.gpu.countOf("queue.writeTexture")).toBe(1);
    expect(harness.gpu.countOf("device.createSampler")).toBe(1);
    const groupBinds = harness.gpu
      .callsOf("pass.setBindGroup")
      .map((call) => call.args[0]);
    expect(groupBinds).toContain(1);

    // Positions at slot 0, uvs at slot 1 — the positional order.
    const slots = harness.gpu
      .callsOf("pass.setVertexBuffer")
      .map((call) => call.args[0]);
    expect(slots).toEqual([0, 1]);

    // The textured module is its own variant, and it samples.
    const sources = harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { code: string }).code);
    expect(sources.some((code) => code.includes("textureSample"))).toBe(true);
  });

  it("reuses the uploaded texture across frames, until markDirty", () => {
    const root = createRoot();
    const material = new TestMaterial();
    const map = new TestTexture();
    material.map = map;
    root.add(renderable(texturedTriangle(), material));
    harness.renderer.render(root, [createView()]);
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("queue.writeTexture")).toBe(1);

    map.markDirty();
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("queue.writeTexture")).toBe(2);
    expect(harness.gpu.countOf("texture.destroy")).toBe(1);
  });

  it("shares one sampler and one pipeline across textures sharing state", () => {
    const root = createRoot();
    const first = new TestMaterial();
    first.map = new TestTexture();
    const second = new TestMaterial();
    second.map = new TestTexture();
    root.add(renderable(texturedTriangle(), first));
    root.add(renderable(texturedTriangle(), second));
    harness.renderer.render(root, [createView()]);

    // Two textures, two bind groups — one sampler between them (§77), and
    // one textured pipeline plus the clear.
    expect(mapAllocations(harness.gpu)).toBe(2);
    expect(harness.gpu.countOf("device.createSampler")).toBe(1);
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(2);
  });

  it("draws untextured when the geometry carries no uvs to sample with", () => {
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture();
    root.add(renderable(triangle(), material));
    harness.renderer.render(root, [createView()]);

    // Clear + triangle: the draw happens, flat, with nothing uploaded.
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
    expect(mapAllocations(harness.gpu)).toBe(0);
    expect(harness.gpu.countOf("queue.writeTexture")).toBe(0);
    expect(harness.gpu.countOf("device.createSampler")).toBe(0);
  });

  it("skips the draw when its map has been disposed (§83)", () => {
    const root = createRoot();
    const material = new TestMaterial();
    const map = new TestTexture();
    material.map = map;
    root.add(renderable(texturedTriangle(), material));
    map.dispose();
    harness.renderer.render(root, [createView()]);

    // The clear draws; the textured item is skipped, never painted undefined.
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.gpu.countOf("device.createSampler")).toBe(0);
  });

  it("binds colours and uvs in slot order for a variant reading all three", () => {
    const root = createRoot();
    const material = new TestMaterial();
    material.vertexColors = true;
    material.map = new TestTexture();
    root.add(
      renderable(texturedTriangle(new Float32Array(12).fill(1)), material),
    );
    harness.renderer.render(root, [createView()]);

    const slots = harness.gpu
      .callsOf("pass.setVertexBuffer")
      .map((call) => call.args[0]);
    expect(slots).toEqual([0, 1, 2]);
    // Position, colour and uv buffers, in the geometry cache's upload order:
    // positions → uvs → colours (matching `gl-geometry.ts`), bound as
    // position → colours → uvs (the variant's slot order).
    expect(harness.gpu.countOf("device.createBuffer")).toBe(3);
  });

  it("generates a mip chain for a mipmapped map, inside the frame", () => {
    const root = createRoot();
    const material = new TestMaterial();
    const map = new TestTexture(4, 4);
    map.mipmaps = true;
    material.map = map;
    root.add(renderable(texturedTriangle(), material));
    harness.renderer.render(root, [createView()]);

    // The chain's own encoder submits before the frame's: two blit passes for
    // levels 1 and 2, then the frame pass — three passes, two submits.
    expect(harness.gpu.countOf("encoder.beginRenderPass")).toBe(3);
    expect(harness.gpu.countOf("queue.submit")).toBe(2);
    const submits = harness.gpu.calls
      .map((call) => call.name)
      .filter((name) => name === "queue.submit" || name === "pass.end");
    expect(submits[submits.length - 1]).toBe("queue.submit");
  });

  it("takes §57's blend mode from the material, defaulting to normal", () => {
    const root = createRoot();
    const plain = new TestMaterial();
    plain.transparent = true;
    root.add(renderable(triangle(), plain));
    const additive = new TestMaterial();
    additive.transparent = true;
    additive.blendMode = "additive";
    root.add(renderable(triangle(), additive));

    harness.renderer.render(root, [createView()]);
    const blends = harness.gpu.callsOf("device.createRenderPipeline").map(
      (call) =>
        (
          call.args[0] as {
            fragment: {
              targets: { blend?: { color: { dstFactor: string } } }[];
            };
          }
        ).fragment.targets[0]?.blend?.color.dstFactor,
    );
    // The clear pipeline (no blend), then the two transparent variants.
    expect(blends).toEqual([undefined, "one-minus-src-alpha", "one"]);
  });

  it("carries §57's depth and colour writes into the pipeline", () => {
    const root = createRoot();
    const material = new TestMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.colorWrite = false;
    root.add(renderable(triangle(), material));

    harness.renderer.render(root, [createView()]);
    const descriptor = harness.gpu.callsOf("device.createRenderPipeline")[1]
      ?.args[0] as {
      depthStencil: { depthWriteEnabled: boolean; depthCompare: string };
      fragment: { targets: { writeMask: number }[] };
    };
    expect(descriptor.depthStencil).toEqual({
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "always",
    });
    expect(descriptor.fragment.targets[0]?.writeMask).toBe(0);
  });

  it("skips an item this tier has no pipeline for", () => {
    const root = createRoot();
    const item = renderable(triangle());
    // A sprite-material item: `pipelineOf` gives it kind `"sprite"`, which
    // WP-R1.3 owns. It must be skipped, never approximated.
    (item.material as unknown as { kind: string }).kind = "sprite";
    root.add(item);
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
  });

  it("skips a draw whose geometry has nothing to draw", () => {
    const root = createRoot();
    root.add(renderable(new TestGeometry(new Float32Array(0))));
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
  });

  it("draws every view in array order, into one pass", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [
      createView({ id: "a" }),
      createView({ id: "b", x: 0.5, width: 0.5 }),
    ]);
    expect(harness.gpu.countOf("encoder.beginRenderPass")).toBe(1);
    expect(harness.gpu.countOf("pass.setViewport")).toBe(2);
    expect(harness.gpu.countOf("pass.draw")).toBe(4);
  });

  it("asks each view's camera for its view matrix once per frame", () => {
    const camera = new TestCamera();
    harness.renderer.render(createRoot(), [
      createView({ camera: camera.asCamera }),
    ]);
    expect(camera.updateViewMatrixCalls).toBe(1);
  });

  it("draws the §43 interpolated poses when given an interpolation record", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()], {
      // A pose buffer that tracks nothing: every node falls back to its live
      // local transform, which is exactly the untracked path §43 defines.
      poseBuffer: { computeRenderPose: () => false } as never,
      alpha: 0.5,
    });
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
  });

  it("counts §84's statistics for submitted draws only", () => {
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()]);
    // The clear draw is the backend's own, not the scene's: one draw call, one
    // triangle.
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(1);
    expect(statistics.instances).toBe(1);
  });

  it("counts no triangles for a line-list geometry", () => {
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;
    const root = createRoot();
    root.add(
      renderable(
        new TestGeometry(
          new Float32Array([-0.5, 0, 0, 0.5, 0, 0]),
          undefined,
          "lines",
        ),
      ),
    );
    harness.renderer.render(root, [createView()]);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(0);
  });

  it("grows the uniform buffer rather than reallocating mid-frame", () => {
    const root = createRoot();
    for (let index = 0; index < 40; index += 1) {
      root.add(renderable(triangle()));
    }
    harness.renderer.render(root, [createView()]);
    // Exactly one growth, and it happens before any pass command.
    const names = harness.gpu.calls.map((call) => call.name);
    const grown = names.filter((name) => name === "device.createBindGroup");
    expect(grown).toHaveLength(1);
    expect(names.indexOf("device.createBindGroup")).toBeLessThan(
      names.indexOf("encoder.beginRenderPass"),
    );
  });
});

describe("WebgpuRenderer.resize", () => {
  it("scales the swap chain by the resolution", async () => {
    const { gpu, renderer } = await initialized();
    renderer.resize(200, 100, 2);
    expect(gpu.canvas.width).toBe(400);
    expect(gpu.canvas.height).toBe(200);
  });

  it("defaults the resolution to 1 and never goes below one pixel", async () => {
    const { gpu, renderer } = await initialized();
    renderer.resize(0, 0);
    expect(gpu.canvas.width).toBe(1);
    expect(gpu.canvas.height).toBe(1);
  });

  it("records a size before initialization without touching a canvas", () => {
    const renderer = new WebgpuRenderer();
    expect(() => {
      renderer.resize(640, 480);
    }).not.toThrow();
  });

  it("reallocates the depth attachment only when the size changes", async () => {
    const { gpu, renderer } = await initialized();
    const root = createRoot();
    renderer.render(root, [createView()]);
    expect(gpu.countOf("device.createTexture")).toBe(1);
    renderer.render(root, [createView()]);
    expect(gpu.countOf("device.createTexture")).toBe(1);
    renderer.resize(128, 128, 1);
    renderer.render(root, [createView()]);
    expect(gpu.countOf("device.createTexture")).toBe(2);
  });
});

describe("WebgpuRenderer device loss (§61)", () => {
  it("emits contextlost, drops the caches and stops drawing", async () => {
    const { gpu, renderer } = await initialized();
    const seen: string[] = [];
    renderer.events.on("contextlost", (event) => {
      seen.push(event.renderer === renderer ? "self" : "other");
    });

    gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual(["self"]);
    expect(renderer.deviceLost).toBe(true);

    gpu.reset();
    renderer.render(createRoot(), [createView()]);
    renderer.resize(64, 64);
    expect(gpu.calls).toHaveLength(0);
  });

  it("forgets uploaded textures on loss without touching the dead device", async () => {
    const { gpu, renderer } = await initialized();
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture();
    root.add(renderable(texturedTriangle(), material));
    renderer.render(root, [createView()]);

    gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    gpu.reset();
    renderer.dispose();
    // No `texture.destroy` for the map: its allocation died with the device.
    expect(gpu.countOf("texture.destroy")).toBe(0);
  });

  it("does not report teardown as a loss", async () => {
    const { gpu, renderer } = await initialized();
    let lost = 0;
    renderer.events.on("contextlost", () => {
      lost += 1;
    });
    gpu.loseDevice("destroyed");
    await Promise.resolve();
    await Promise.resolve();
    expect(lost).toBe(0);
    expect(renderer.deviceLost).toBe(false);
  });

  it("does not report a loss that arrives after disposal", async () => {
    const { gpu, renderer } = await initialized();
    let lost = 0;
    renderer.events.on("contextlost", () => {
      lost += 1;
    });
    renderer.dispose();
    gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    expect(lost).toBe(0);
  });

  it("disposes cleanly while lost, without calling into the dead device", async () => {
    const { gpu, renderer } = await initialized();
    gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    gpu.reset();
    renderer.dispose();
    expect(gpu.countOf("device.destroy")).toBe(0);
    expect(renderer.disposed).toBe(true);
  });

  it("tolerates a device that exposes no `lost` promise at all", async () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as unknown as Record<string, unknown>;
    delete device["lost"];
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(renderer.deviceLost).toBe(false);
    renderer.dispose();
  });
});

describe("WebgpuRenderer.dispose", () => {
  it("releases the device, the swap chain and every allocation", async () => {
    const { gpu, renderer } = await initialized();
    const root = createRoot();
    root.add(renderable(triangle()));
    renderer.render(root, [createView()]);
    gpu.reset();

    renderer.dispose();
    expect(gpu.countOf("device.destroy")).toBe(1);
    expect(gpu.countOf("context.unconfigure")).toBe(1);
    // The geometry's vertex buffer, the depth texture and the uniform buffer.
    expect(gpu.countOf("buffer.destroy")).toBeGreaterThanOrEqual(2);
    expect(gpu.countOf("texture.destroy")).toBe(1);
  });

  it("destroys uploaded textures alongside the depth texture", async () => {
    const { gpu, renderer } = await initialized();
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture();
    root.add(renderable(texturedTriangle(), material));
    renderer.render(root, [createView()]);
    gpu.reset();

    renderer.dispose();
    // The map's allocation and the depth attachment.
    expect(gpu.countOf("texture.destroy")).toBe(2);
  });

  it("is idempotent", async () => {
    const { gpu, renderer } = await initialized();
    renderer.dispose();
    gpu.reset();
    renderer.dispose();
    expect(gpu.calls).toHaveLength(0);
  });

  it("makes every other method throw INVALID_APPLICATION_STATE", async () => {
    const { renderer } = await initialized();
    renderer.dispose();
    for (const call of [
      () => {
        renderer.render(createRoot(), [createView()]);
      },
      () => {
        renderer.resize(1, 1);
      },
    ]) {
      expect(call).toThrowError(/disposal is terminal/u);
    }
    expect((await rejection(renderer.initialize())).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });

  it("disposes a renderer that never initialized", () => {
    const renderer = new WebgpuRenderer();
    expect(() => {
      renderer.dispose();
    }).not.toThrow();
  });

  it("draws nothing after disposal of the caches but before the device", () => {
    const renderer = new WebgpuRenderer();
    renderer.render(createRoot(), [createView()]);
    expect(renderer.capabilities.backend).toBe("webgpu");
  });
});
