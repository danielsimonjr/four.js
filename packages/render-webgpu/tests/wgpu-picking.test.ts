/**
 * The WebGPU picking service (§71; RFC 0005), driven host-first: the
 * `PickingRendererHost` seam is a plain object here, so every §61 lifecycle
 * — loss, disposal under the service — is one field write, and the
 * `mapAsync` read-back is reachable on a recording device with no GPU.
 *
 * The scene objects are `@fourjs/render`'s real `Renderable` over structural
 * geometry/material doubles — `webgpu-renderer.test.ts`'s argument: `core`,
 * `math`, `render` is this package's whole dependency row (plan §3.1), so
 * `@fourjs/scene` and `@fourjs/geometry` may not appear even in a test.
 */

import { isFourError, resetDevWarnings } from "@fourjs/core";
import { Matrix4 } from "@fourjs/math";
import {
  Renderable,
  encodePickId,
  supportsPicking,
  type PickingService,
  type RenderItem,
  type UnlitRenderItem,
} from "@fourjs/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  GPU_BUFFER_USAGE,
  ID_PICK_OFFSET,
  ID_SHADER_SOURCE,
  UNIFORM_STRIDE_BYTES,
  WebgpuPickingService,
  WebgpuRenderer,
  WgpuGeometryCache,
  WgpuRenderTargetCache,
  clearRegisteredPickingPipeline,
  registerPickingPipeline,
  resolvePickingServiceFactory,
  type GpuDevice,
  type PickingRendererHost,
} from "../src/index.js";

type PickView = Parameters<PickingService["update"]>[1];
type PickCameraContract = PickView["camera"];
type ItemGeometry = RenderItem["geometry"];
type ItemMaterial = UnlitRenderItem["material"];

let nextGeometryId = 0;

class PickGeometry {
  readonly id: string;

  version = 0;

  positions: Float32Array;

  indices: Uint16Array | undefined;

  mode: "triangles" | "lines" = "triangles";

  joints: Uint16Array | undefined;

  weights: Float32Array | undefined;

  constructor(positions: Float32Array, indices?: Uint16Array) {
    nextGeometryId += 1;
    this.id = `pick-geometry-${String(nextGeometryId)}`;
    this.positions = positions;
    this.indices = indices;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get drawCount(): number {
    return this.indices === undefined
      ? this.positions.length / 3
      : this.indices.length;
  }

  get asGeometry(): ItemGeometry {
    return this as unknown as ItemGeometry;
  }
}

class PickMaterial {
  readonly color: [number, number, number, number] = [1, 1, 1, 1];

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

class PickSpriteMaterial {
  readonly kind = "sprite";

  readonly tint: [number, number, number, number] = [1, 1, 1, 1];

  texture = null;

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

/** A unit triangle at the origin — inside the identity frustum. */
function triangleGeometry(): PickGeometry {
  return new PickGeometry(
    new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
  );
}

function indexedTriangleGeometry(): PickGeometry {
  return new PickGeometry(
    new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    new Uint16Array([0, 1, 2]),
  );
}

function drawable(
  geometry: PickGeometry = triangleGeometry(),
  material: PickMaterial | PickSpriteMaterial = new PickMaterial(),
): Renderable {
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

/**
 * A structural §36 emitter — not a `Renderable`, so only the particle arm
 * of `collectPickCandidates` / `buildRenderList` claims it.
 */
function particleEmitter(count: number): {
  readonly isParticleDrawable: true;
  readonly id: string;
  readonly parent: null;
  readonly children: unknown[];
  visible: boolean;
  enabled: boolean;
  renderLayer: number;
  renderOrder: number;
  particleCount: number;
  particleInstances: Float32Array;
  transform: { worldMatrix: Matrix4 };
  updateParticleInstances(): void;
} {
  return {
    isParticleDrawable: true,
    id: "test-emitter",
    parent: null,
    children: [],
    visible: true,
    enabled: true,
    renderLayer: 0,
    renderOrder: 0,
    particleCount: count,
    particleInstances: new Float32Array(Math.max(count, 1) * 8),
    transform: { worldMatrix: new Matrix4() },
    updateParticleInstances(): void {
      // repacked elsewhere
    },
  };
}

class PickCamera {
  readonly projectionMatrix = new Matrix4();

  readonly viewMatrix = new Matrix4();

  updateViewMatrixCalls = 0;

  updateViewMatrix(): void {
    this.updateViewMatrixCalls += 1;
  }

  get asCamera(): PickCameraContract {
    return this as unknown as PickCameraContract;
  }
}

function createView(
  camera: PickCamera,
  overrides: Partial<PickView> = {},
): PickView {
  return {
    id: "main",
    camera: camera.asCamera,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    normalized: true,
    ...overrides,
  };
}

/** Bytes `encodePickId(index)` writes into an RGBA8 texel. */
function texelOf(index: number): Uint8Array {
  const encoded = new Float32Array(4);
  encodePickId(index, encoded);
  return new Uint8Array([
    Math.round(encoded[0] * 255),
    Math.round(encoded[1] * 255),
    Math.round(encoded[2] * 255),
    Math.round(encoded[3] * 255),
  ]);
}

interface MappedTexel {
  bytes: Uint8Array | null;
}

/**
 * Wraps `device` so `MAP_READ` buffers return `texel.bytes` (padded into the
 * mapped range at offset 0 — a 1×1 region after the §7a flip). Other
 * allocations pass through, so the recording tape still sees them.
 */
function withMappedTexel(device: GpuDevice, texel: MappedTexel): GpuDevice {
  return {
    ...device,
    createBuffer(descriptor) {
      const buffer = device.createBuffer(descriptor);
      if ((descriptor.usage & GPU_BUFFER_USAGE.MAP_READ) === 0) {
        return buffer;
      }
      return {
        destroy: () => {
          buffer.destroy();
        },
        mapAsync: (mode: number) =>
          buffer.mapAsync?.(mode) ?? Promise.resolve(),
        getMappedRange: () => {
          if (texel.bytes === null) {
            return (
              buffer.getMappedRange?.() ?? new ArrayBuffer(descriptor.size)
            );
          }
          const mapped = new Uint8Array(descriptor.size);
          mapped.set(
            texel.bytes.subarray(0, Math.min(4, texel.bytes.length)),
            0,
          );
          return mapped.buffer;
        },
        unmap: () => {
          buffer.unmap?.();
        },
      };
    },
  };
}

interface HostState {
  device: GpuDevice | null;
  geometries: WgpuGeometryCache | null;
  renderTargets: WgpuRenderTargetCache | null;
  surfaceWidth: number;
  surfaceHeight: number;
  deviceLost: boolean;
  disposed: boolean;
}

interface Rig {
  readonly gpu: RecordingGpu;
  readonly state: HostState;
  readonly host: PickingRendererHost;
  readonly service: WebgpuPickingService;
  readonly camera: PickCamera;
  readonly view: PickView;
  readonly texel: MappedTexel;
}

function createRig(options: { throwOnPipeline?: boolean } = {}): Rig {
  const gpu = createRecordingGpu();
  const raw = gpu.device as GpuDevice;
  const texel: MappedTexel = { bytes: null };
  const device: GpuDevice = options.throwOnPipeline
    ? {
        ...withMappedTexel(raw, texel),
        createRenderPipeline(): never {
          throw new Error("pipeline refused");
        },
      }
    : withMappedTexel(raw, texel);
  const state: HostState = {
    device,
    geometries: new WgpuGeometryCache(device),
    renderTargets: new WgpuRenderTargetCache(device, () => ({})),
    surfaceWidth: 64,
    surfaceHeight: 64,
    deviceLost: false,
    disposed: false,
  };
  const host: PickingRendererHost = {
    device: () => state.device,
    geometries: () => state.geometries,
    renderTargets: () => state.renderTargets,
    surfaceWidth: () => state.surfaceWidth,
    surfaceHeight: () => state.surfaceHeight,
    deviceLost: () => state.deviceLost,
    disposed: () => state.disposed,
  };
  const camera = new PickCamera();
  return {
    gpu,
    state,
    host,
    service: new WebgpuPickingService(host),
    camera,
    view: createView(camera),
    texel,
  };
}

function idUploads(gpu: RecordingGpu): number[][] {
  const names = gpu.calls.map((call) => call.name);
  const passAt = names.indexOf("encoder.beginRenderPass");
  const uploads = gpu.calls.filter(
    (call, index) => call.name === "queue.writeBuffer" && index < passAt,
  );
  const last = uploads[uploads.length - 1];
  if (last === undefined) {
    return [];
  }
  const data = last.args[2] as number[];
  const stride = UNIFORM_STRIDE_BYTES / 4;
  const pickFloats = ID_PICK_OFFSET / 4;
  const ids: number[][] = [];
  const draws = gpu.countOf("pass.draw") + gpu.countOf("pass.drawIndexed");
  for (let block = 0; block < draws; block += 1) {
    const base = block * stride + pickFloats;
    ids.push([data[base], data[base + 1], data[base + 2], data[base + 3]]);
  }
  return ids;
}

function expectedIdUpload(index: number): number[] {
  const encoded = new Float32Array(4);
  encodePickId(index, encoded);
  return Array.from(encoded);
}

function thrown(fn: () => void): { code: string; message: string } {
  try {
    fn();
  } catch (error: unknown) {
    if (isFourError(error)) {
      return { code: error.code, message: String(error.message) };
    }
    throw error;
  }
  throw new Error("expected a FourError");
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string }> {
  try {
    await promise;
  } catch (error: unknown) {
    if (isFourError(error)) {
      return { code: error.code };
    }
    throw error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  resetDevWarnings();
  clearRegisteredPickingPipeline();
});

describe("the registration seam (pipeline-cost law)", () => {
  it("is empty until registerPickingPipeline() runs, and clearable", () => {
    expect(resolvePickingServiceFactory()).toBeNull();
    registerPickingPipeline();
    const factory = resolvePickingServiceFactory();
    expect(factory).not.toBeNull();
    clearRegisteredPickingPipeline();
    expect(resolvePickingServiceFactory()).toBeNull();
  });

  it("builds a WebgpuPickingService over the host it is given", () => {
    registerPickingPipeline();
    const { host } = createRig();
    const factory = resolvePickingServiceFactory();
    const service = factory?.create(host);
    expect(service).toBeInstanceOf(WebgpuPickingService);
    expect(service?.disposed).toBe(false);
  });

  it("registration and creation alone compile no pipeline (lazy compile)", () => {
    registerPickingPipeline();
    const { gpu, host } = createRig();
    gpu.reset();
    const factory = resolvePickingServiceFactory();
    factory?.create(host);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
  });
});

describe("WebgpuRenderer.createPickingService (§71, RFC 0005)", () => {
  it("refuses when no picking pipeline is registered (§85)", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(supportsPicking(renderer)).toBe(true);
    const error = thrown(() => renderer.createPickingService());
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.message).toContain("registerPickingPipeline");
    renderer.dispose();
  });

  it("refuses on a disposed renderer (§83)", async () => {
    registerPickingPipeline();
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    renderer.dispose();
    expect(thrown(() => renderer.createPickingService()).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });

  it("builds a service whose host window tracks the live renderer, compiling nothing at create", async () => {
    registerPickingPipeline();
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    renderer.resize(64, 64);
    gpu.reset();
    const service = renderer.createPickingService();
    expect(service).toBeInstanceOf(WebgpuPickingService);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);

    const triangle = drawable();
    service.update(triangle, createView(new PickCamera()));
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(gpu.countOf("pass.draw")).toBe(1);

    service.dispose();
    renderer.dispose();
  });
});

describe("WebgpuPickingService.update — the id pass", () => {
  it("compiles the id pipeline on the first pass only, and draws every candidate", () => {
    const { gpu, service, view } = createRig();
    const first = drawable();
    const second = drawable(indexedTriangleGeometry());
    const root = drawable(new PickGeometry(new Float32Array(0)));
    root.add(first);
    root.add(second);

    service.update(root, view);
    expect(gpu.countOf("device.createShaderModule")).toBe(1);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(gpu.countOf("pass.draw")).toBe(1);
    expect(gpu.countOf("pass.drawIndexed")).toBe(1);
    const code = (
      gpu.callsOf("device.createShaderModule")[0]?.args[0] as { code: string }
    ).code;
    expect(code).toBe(ID_SHADER_SOURCE);
    expect(code).toContain("(clip.z + clip.w) * 0.5");
    expect(code).toContain("pickId");

    service.update(root, view);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(gpu.countOf("pass.draw")).toBe(2);
    expect(gpu.countOf("pass.drawIndexed")).toBe(2);
  });

  it("encodes table index 0's colour for a single unlit triangle", () => {
    const { gpu, service, view } = createRig();
    const triangle = drawable();
    service.update(triangle, view);
    expect(idUploads(gpu)).toEqual([expectedIdUpload(0)]);
    expect(gpu.countOf("pass.draw")).toBe(1);
  });

  it("skips skinned and particle items — no id draw", () => {
    const { gpu, service, view } = createRig();
    const emitter = particleEmitter(3);
    const skinnedGeometry = triangleGeometry();
    skinnedGeometry.joints = new Uint16Array(12);
    skinnedGeometry.weights = new Float32Array(12);
    const skinned = drawable(skinnedGeometry);
    Object.assign(skinned, {
      skeleton: {
        bones: [{}],
        jointMatrices: new Float32Array(16),
        update(): void {
          // palette refreshed elsewhere
        },
      },
    });
    const plain = drawable();
    const root = {
      visible: true,
      enabled: true,
      children: [emitter, skinned, plain] as unknown[],
    };
    type PickRoot = Parameters<PickingService["update"]>[0];

    service.update(root as unknown as PickRoot, view);
    expect(gpu.countOf("pass.draw")).toBe(1);
    expect(gpu.countOf("pass.drawIndexed")).toBe(0);
    expect(idUploads(gpu)).toEqual([expectedIdUpload(2)]);
  });

  it("draws sprites through the unlit-shaped position layout", () => {
    const { gpu, service, view } = createRig();
    const sprite = drawable(triangleGeometry(), new PickSpriteMaterial());
    service.update(sprite, view);
    expect(gpu.countOf("pass.draw")).toBe(1);
    expect(idUploads(gpu)).toEqual([expectedIdUpload(0)]);
  });

  it("skips §67 mask-only draws and still draws unclipped content", () => {
    const { gpu, service, view } = createRig();
    const panel = drawable();
    panel.clip = true;
    const content = drawable();
    panel.add(content);
    const root = drawable(new PickGeometry(new Float32Array(0)));
    root.add(panel);

    service.update(root, view);
    // Mask skipped; panel content + child drawn. No stencil commands.
    expect(gpu.countOf("pass.draw")).toBe(2);
    expect(gpu.countOf("pass.setStencilReference")).toBe(0);
    expect(idUploads(gpu)).toEqual([expectedIdUpload(1), expectedIdUpload(2)]);
  });

  it("skips a drawable whose geometry has nothing to draw", () => {
    const { gpu, service, view } = createRig();
    service.update(drawable(new PickGeometry(new Float32Array(0))), view);
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(gpu.countOf("pass.drawIndexed")).toBe(0);
  });

  it("resizes the id target when the drawing buffer resizes", () => {
    const { gpu, service, state, view } = createRig();
    const triangle = drawable();
    service.update(triangle, view);
    const first = gpu
      .callsOf("device.createTexture")
      .filter((call) =>
        String((call.args[0] as { label?: string }).label).startsWith(
          "fourJS:render-target:",
        ),
      );
    expect(
      (first[0]?.args[0] as { size: readonly [number, number] }).size,
    ).toEqual([64, 64]);

    state.surfaceWidth = 128;
    state.surfaceHeight = 32;
    service.update(triangle, view);
    const uploads = gpu
      .callsOf("device.createTexture")
      .filter((call) =>
        String((call.args[0] as { label?: string }).label).startsWith(
          "fourJS:render-target:",
        ),
      );
    expect(
      (
        uploads[uploads.length - 1]?.args[0] as {
          size: readonly [number, number];
        }
      ).size,
    ).toEqual([128, 32]);
  });

  it("refuses a zero-area viewport and a zero-size surface (§85)", () => {
    const { service, state, view, camera } = createRig();
    const root = drawable();
    expect(
      thrown(() => {
        service.update(root, createView(camera, { width: 0 }));
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");

    state.surfaceWidth = 0;
    expect(
      thrown(() => {
        service.update(root, view);
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("skips a node grown by a geometry accessor mid-build (reentrancy)", () => {
    const { gpu, service, view } = createRig();
    const root = drawable(new PickGeometry(new Float32Array(0)));
    const stable = drawable();
    root.add(stable);

    class GrowingRenderable extends Renderable {
      #grown = false;

      override get geometry(): ItemGeometry {
        if (!this.#grown) {
          this.#grown = true;
          root.add(drawable());
        }
        return super.geometry;
      }
    }
    root.add(
      new GrowingRenderable(
        triangleGeometry().asGeometry,
        new PickMaterial().asMaterial,
      ),
    );

    service.update(root, view);
    // stable + growing drew; the mid-build node missed the table.
    expect(gpu.countOf("pass.draw")).toBe(2);
    expect(idUploads(gpu)).toEqual([expectedIdUpload(1), expectedIdUpload(2)]);
  });

  it("skips the pass when the host caches or device are down (§61)", () => {
    const { gpu, service, state, view } = createRig();
    const triangle = drawable();
    service.update(triangle, view);
    expect(gpu.countOf("pass.draw")).toBe(1);

    const liveDevice = state.device;
    if (liveDevice === null) {
      throw new Error("expected a live device");
    }
    state.device = null;
    service.update(triangle, view);
    expect(gpu.countOf("pass.draw")).toBe(1);

    state.device = liveDevice;
    state.geometries = null;
    service.update(triangle, view);
    expect(gpu.countOf("pass.draw")).toBe(1);

    state.geometries = new WgpuGeometryCache(liveDevice);
    state.renderTargets = null;
    service.update(triangle, view);
    expect(gpu.countOf("pass.draw")).toBe(1);
  });

  it("skips the pass when the id target cannot be acquired (§61)", () => {
    const { gpu, service, state, view } = createRig();
    state.renderTargets?.dispose();
    service.update(drawable(), view);
    expect(gpu.countOf("pass.draw")).toBe(0);
  });

  it("skips the pass while the device is lost, and drops the stale buffer", async () => {
    const { gpu, service, state, view } = createRig();
    const triangle = drawable();
    service.update(triangle, view);
    expect(gpu.countOf("pass.draw")).toBe(1);

    state.deviceLost = true;
    service.update(triangle, view);
    expect(gpu.countOf("pass.draw")).toBe(1);
    state.deviceLost = false;
    expect(
      (await rejection(service.pick({ viewport: view, ndcX: 0, ndcY: 0 })))
        .code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("latches a compile failure and warns once (§61, §89)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // silenced
    });
    try {
      const { gpu, service, view } = createRig({ throwOnPipeline: true });
      const triangle = drawable();
      service.update(triangle, view);
      service.update(triangle, view);
      expect(gpu.countOf("pass.draw")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("recompiles after a new geometry-cache era", () => {
    const { gpu, service, state, view } = createRig();
    const triangle = drawable();
    service.update(triangle, view);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);

    state.geometries = new WgpuGeometryCache(state.device as GpuDevice);
    service.update(triangle, view);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(2);
    expect(gpu.countOf("pass.draw")).toBe(2);
  });

  it("refuses after dispose (§83)", () => {
    const { service, view } = createRig();
    service.dispose();
    expect(
      thrown(() => {
        service.update(drawable(), view);
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("disposes without touching GPU when the host is already down", () => {
    const { service, state, view } = createRig();
    service.update(drawable(), view);
    state.deviceLost = true;
    service.dispose();
    expect(service.disposed).toBe(true);
    service.dispose();
  });
});

describe("WebgpuPickingService.pick — mapAsync read-back", () => {
  async function pickedAt(
    rig: Rig,
    index: number,
    ndcX = 0,
    ndcY = 0,
  ): Promise<{ nodeId: string | undefined; frame: number }> {
    rig.texel.bytes = texelOf(index);
    return rig.service.pick({ viewport: rig.view, ndcX, ndcY });
  }

  it("resolves the front-most id to its traversal-table node id via mapAsync", async () => {
    const rig = createRig();
    const triangle = drawable();
    rig.service.update(triangle, rig.view);

    expect(await pickedAt(rig, 0)).toEqual({ nodeId: triangle.id, frame: 1 });
    expect(rig.gpu.countOf("buffer.mapAsync")).toBe(1);
    expect(rig.gpu.countOf("encoder.copyTextureToBuffer")).toBe(1);

    rig.texel.bytes = new Uint8Array([0, 0, 0, 0]);
    const empty = await rig.service.pick({
      viewport: rig.view,
      ndcX: 0,
      ndcY: 0,
    });
    expect(empty.nodeId).toBeUndefined();

    rig.texel.bytes = texelOf(99);
    const anomalous = await rig.service.pick({
      viewport: rig.view,
      ndcX: 0,
      ndcY: 0,
    });
    expect(anomalous.nodeId).toBeUndefined();
  });

  it("maps NDC to the viewport's pixels, +Y up, as a 1×1 copy origin", async () => {
    const rig = createRig();
    const triangle = drawable();
    rig.service.update(triangle, rig.view);
    rig.gpu.reset();

    await pickedAt(rig, 0, -1, -1);
    await pickedAt(rig, 0, 0, 0);
    await pickedAt(rig, 0, 1, 1);
    const copies = rig.gpu.callsOf("encoder.copyTextureToBuffer");
    // §7a bottom-left → WebGPU top-first: origin.y = height - py - 1.
    expect(
      (copies[0]?.args[0] as { origin: readonly [number, number] }).origin,
    ).toEqual([0, 63]);
    expect(
      (copies[1]?.args[0] as { origin: readonly [number, number] }).origin,
    ).toEqual([32, 31]);
    expect(
      (copies[2]?.args[0] as { origin: readonly [number, number] }).origin,
    ).toEqual([63, 0]);
    expect(copies[0]?.args[2]).toEqual([1, 1]);
  });

  it("refuses before any update, out-of-range NDC, and a foreign viewport (§85)", async () => {
    const rig = createRig();
    expect(
      (
        await rejection(
          rig.service.pick({ viewport: rig.view, ndcX: 0, ndcY: 0 }),
        )
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");

    rig.service.update(drawable(), rig.view);

    for (const [ndcX, ndcY] of [
      [2, 0],
      [0, -1.5],
      [Number.NaN, 0],
    ]) {
      expect(
        (await rejection(rig.service.pick({ viewport: rig.view, ndcX, ndcY })))
          .code,
      ).toBe("INVALID_APPLICATION_STATE");
    }

    const otherView = createView(rig.camera, { id: "other" });
    expect(
      (
        await rejection(
          rig.service.pick({ viewport: otherView, ndcX: 0, ndcY: 0 }),
        )
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("refuses a disposed service and a disposed renderer (§83); dispose is idempotent", async () => {
    const rig = createRig();
    rig.service.update(drawable(), rig.view);

    rig.state.disposed = true;
    expect((await rejection(pickedAt(rig, 0))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    rig.state.disposed = false;

    rig.service.dispose();
    rig.service.dispose();
    expect(rig.service.disposed).toBe(true);
    expect((await rejection(pickedAt(rig, 0))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });

  it("rejects CONTEXT_LOST for a buffer that predates a loss or era change", async () => {
    const rig = createRig();
    rig.service.update(drawable(), rig.view);

    rig.state.deviceLost = true;
    expect((await rejection(pickedAt(rig, 0))).code).toBe("CONTEXT_LOST");
    rig.state.deviceLost = false;

    rig.state.geometries = new WgpuGeometryCache(rig.state.device as GpuDevice);
    expect((await rejection(pickedAt(rig, 0))).code).toBe("CONTEXT_LOST");
  });

  it("rejects CONTEXT_LOST when the device goes down mid-flight", async () => {
    const rig = createRig();
    rig.service.update(drawable(), rig.view);
    const pending = pickedAt(rig, 0);
    rig.state.deviceLost = true;
    expect((await rejection(pending)).code).toBe("CONTEXT_LOST");
  });

  it("rejects when the service is disposed mid-flight (§83)", async () => {
    const rig = createRig();
    rig.service.update(drawable(), rig.view);
    const pending = pickedAt(rig, 0);
    rig.service.dispose();
    expect((await rejection(pending)).code).toBe("INVALID_APPLICATION_STATE");
  });

  it("rejects UNSUPPORTED_GPU_FEATURE when mapAsync is absent", async () => {
    const rig = createRig();
    const raw = rig.state.device as GpuDevice;
    rig.state.device = {
      ...raw,
      createCommandEncoder: (descriptor) => {
        const encoder = raw.createCommandEncoder(descriptor);
        return {
          beginRenderPass: encoder.beginRenderPass.bind(encoder),
          finish: encoder.finish.bind(encoder),
        };
      },
    };
    rig.service.update(drawable(), rig.view);
    expect(
      (
        await rejection(
          rig.service.pick({ viewport: rig.view, ndcX: 0, ndcY: 0 }),
        )
      ).code,
    ).toBe("UNSUPPORTED_GPU_FEATURE");
  });
});
