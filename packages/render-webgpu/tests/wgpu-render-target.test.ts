/**
 * WP-R1.6's render-target tier, at both seams: the cache directly (format
 * table, eviction, the lazy sampling group) and the renderer's off-screen
 * frame (attachment wiring, viewport resolution, the R-4 feedback refusal,
 * §67 into targets).
 *
 * Driven by the recording device double for the reasons
 * `webgpu-renderer.test.ts` gives at length; the scene objects are typed
 * doubles for its reason too (`@four/scene` is outside this package's frozen
 * §3.1 row). `RenderTarget` itself is the real class — it lives in
 * `@four/render`, which is a dependency, and the GL twin's cache tests made
 * the same choice for the same recorded reason.
 */

import { resetDevWarnings } from "@four/core";
import { Matrix4 } from "@four/math";
import {
  Renderable,
  RenderTarget,
  type RenderItem,
  type Renderer,
  type UnlitRenderItem,
} from "@four/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  RENDER_TARGET_COLOR_FORMAT,
  RENDER_TARGET_DEPTH_FORMAT,
  RENDER_TARGET_DEPTH_STENCIL_FORMAT,
  RENDER_TARGET_DEPTH_TEXTURE_FORMAT,
  GPU_TEXTURE_USAGE,
  WebgpuRenderer,
  WgpuRenderTargetCache,
  createTextureBindGroupLayout,
  renderTargetDepthFormat,
  type GpuDevice,
} from "../src/index.js";

type RenderView = Parameters<Renderer["render"]>[1][number];
type RenderCamera = RenderView["camera"];
type ItemGeometry = RenderItem["geometry"];
type ItemMaterial = UnlitRenderItem["material"];

let nextGeometryId = 0;

/** A §53 geometry double: a unit triangle, optionally with uvs. */
function triangle(uvs = false): ItemGeometry {
  nextGeometryId += 1;
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  return {
    id: `target-test-geometry-${String(nextGeometryId)}`,
    version: 0,
    positions,
    uvs: uvs ? new Float32Array([0, 0, 1, 0, 0.5, 1]) : undefined,
    mode: "triangles",
    drawCount: 3,
  } as unknown as ItemGeometry;
}

/** §57's material double, reduced to what these tests set. */
function material(
  overrides: Partial<{
    map: unknown;
    stencil: Record<string, unknown>;
  }> = {},
): ItemMaterial {
  return {
    color: [1, 1, 1, 1] as const,
    ...overrides,
  } as unknown as ItemMaterial;
}

/** §47's camera double: identity matrices, one counted update. */
function camera(): RenderCamera {
  return {
    projectionMatrix: new Matrix4(),
    viewMatrix: new Matrix4(),
    transform: { worldMatrix: new Matrix4() },
    layers: undefined,
    updateViewMatrix(): void {},
  } as unknown as RenderCamera;
}

function view(overrides: Partial<RenderView> = {}): RenderView {
  return {
    id: "main",
    camera: camera(),
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

/** An initialized renderer over a fresh recording device, tape cleared. */
async function initialized(): Promise<Harness> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  gpu.reset();
  return { gpu, renderer };
}

/** The labels of every texture the tape allocated. */
function textureLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createTexture")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

afterEach(() => {
  resetDevWarnings();
  vi.restoreAllMocks();
});

describe("renderTargetDepthFormat", () => {
  it("is the module header's table, one row per option shape", () => {
    expect(
      renderTargetDepthFormat(new RenderTarget({ width: 4, height: 4 })),
    ).toBe(RENDER_TARGET_DEPTH_FORMAT);
    expect(
      renderTargetDepthFormat(
        new RenderTarget({ width: 4, height: 4, depth: false }),
      ),
    ).toBeNull();
    expect(
      renderTargetDepthFormat(
        new RenderTarget({ width: 4, height: 4, depthTexture: true }),
      ),
    ).toBe(RENDER_TARGET_DEPTH_TEXTURE_FORMAT);
    expect(
      renderTargetDepthFormat(
        new RenderTarget({ width: 4, height: 4, stencil: true }),
      ),
    ).toBe(RENDER_TARGET_DEPTH_STENCIL_FORMAT);
  });
});

describe("WgpuRenderTargetCache", () => {
  function cache(): {
    gpu: RecordingGpu;
    cache: WgpuRenderTargetCache;
    device: GpuDevice;
  } {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const layout = createTextureBindGroupLayout(device);
    gpu.reset();
    return {
      gpu,
      device,
      cache: new WgpuRenderTargetCache(device, () => layout),
    };
  }

  it("allocates rgba8unorm colour with attachment, sampling and copy usage", () => {
    const { gpu, cache: targets } = cache();
    const target = new RenderTarget({ width: 32, height: 16 });
    const record = targets.acquire(target);

    expect(record).not.toBeNull();
    const color = gpu.callsOf("device.createTexture")[0]?.args[0] as {
      label: string;
      size: [number, number];
      format: string;
      usage: number;
    };
    expect(color.label).toBe(`four:render-target:${target.id}`);
    expect(color.size).toEqual([32, 16]);
    expect(color.format).toBe(RENDER_TARGET_COLOR_FORMAT);
    expect(color.usage).toBe(
      GPU_TEXTURE_USAGE.RENDER_ATTACHMENT |
        GPU_TEXTURE_USAGE.TEXTURE_BINDING |
        GPU_TEXTURE_USAGE.COPY_SRC,
    );
    target.dispose();
  });

  it("allocates the depth attachment per the format table, as attachment-only", () => {
    const { gpu, cache: targets } = cache();
    const plain = new RenderTarget({ width: 8, height: 8 });
    const record = targets.acquire(plain);
    const depth = gpu.callsOf("device.createTexture")[1]?.args[0] as {
      format: string;
      usage: number;
    };
    expect(depth.format).toBe(RENDER_TARGET_DEPTH_FORMAT);
    expect(depth.usage).toBe(GPU_TEXTURE_USAGE.RENDER_ATTACHMENT);
    expect(record?.depthFormat).toBe(RENDER_TARGET_DEPTH_FORMAT);
    expect(record?.stencil).toBe(false);
    plain.dispose();
  });

  it("gives a samplable depth target depth32float with TEXTURE_BINDING (§69)", () => {
    const { gpu, cache: targets } = cache();
    const shadowish = new RenderTarget({
      width: 8,
      height: 8,
      depthTexture: true,
    });
    const record = targets.acquire(shadowish);
    const depth = gpu.callsOf("device.createTexture")[1]?.args[0] as {
      format: string;
      usage: number;
    };
    expect(depth.format).toBe(RENDER_TARGET_DEPTH_TEXTURE_FORMAT);
    expect(depth.usage).toBe(
      GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
    );
    expect(record?.depthTexture).not.toBeNull();
    shadowish.dispose();
  });

  it("gives a stencilled target the packed format, and no depth at all to depth:false", () => {
    const { gpu, cache: targets } = cache();
    const masked = new RenderTarget({ width: 8, height: 8, stencil: true });
    const flat = new RenderTarget({ width: 8, height: 8, depth: false });
    const maskedRecord = targets.acquire(masked);
    const flatRecord = targets.acquire(flat);

    expect(maskedRecord?.depthFormat).toBe(RENDER_TARGET_DEPTH_STENCIL_FORMAT);
    expect(maskedRecord?.stencil).toBe(true);
    expect(flatRecord?.depthFormat).toBeNull();
    expect(flatRecord?.depthTexture).toBeNull();
    expect(flatRecord?.depthView).toBeNull();
    // Three allocations: masked colour + packed depth, flat colour only.
    expect(gpu.countOf("device.createTexture")).toBe(3);
    masked.dispose();
    flat.dispose();
  });

  it("caches by id and re-allocates on a version bump (resize's documented cost)", () => {
    const { gpu, cache: targets } = cache();
    const target = new RenderTarget({ width: 8, height: 8 });
    const first = targets.acquire(target);
    expect(targets.acquire(target)).toBe(first);
    expect(gpu.countOf("device.createTexture")).toBe(2);

    target.resize(16, 16);
    const second = targets.acquire(target);
    expect(second).not.toBe(first);
    expect(second?.width).toBe(16);
    // The old pair destroyed, a new pair allocated.
    expect(gpu.countOf("texture.destroy")).toBe(2);
    expect(gpu.countOf("device.createTexture")).toBe(4);
    target.dispose();
  });

  it("answers null for a disposed target and destroys its records (§83)", () => {
    const { gpu, cache: targets } = cache();
    const target = new RenderTarget({ width: 8, height: 8 });
    targets.acquire(target);
    target.dispose();
    expect(targets.acquire(target)).toBeNull();
    expect(gpu.countOf("texture.destroy")).toBe(2);
    expect(targets.size).toBe(0);
  });

  it("creates the sampling group lazily, once, over one shared sampler", () => {
    const { gpu, cache: targets } = cache();
    const first = new RenderTarget({ width: 8, height: 8 });
    const second = new RenderTarget({ width: 8, height: 8 });
    targets.acquire(first);
    targets.acquire(second);
    // Allocation alone creates no sampler and no bind group.
    expect(gpu.countOf("device.createSampler")).toBe(0);
    expect(gpu.countOf("device.createBindGroup")).toBe(0);

    const groupA = targets.sample(first);
    const again = targets.sample(first);
    const groupB = targets.sample(second);
    expect(groupA).not.toBeNull();
    expect(again).toBe(groupA);
    expect(groupB).not.toBe(groupA);
    // One linear-clamped sampler serves every sampled target; one group each.
    expect(gpu.countOf("device.createSampler")).toBe(1);
    expect(gpu.countOf("device.createBindGroup")).toBe(2);
    expect(
      (gpu.callsOf("device.createSampler")[0]?.args[0] as { label: string })
        .label,
    ).toBe("four:render-target-sampler");
    expect(targets.sample(first)).toBe(groupA);
    first.dispose();
    second.dispose();
    expect(targets.sample(first)).toBeNull();
  });

  it("forget drops without destroying; dispose destroys and is terminal", () => {
    const { gpu, cache: targets } = cache();
    const target = new RenderTarget({ width: 8, height: 8 });
    targets.acquire(target);
    targets.forget();
    expect(gpu.countOf("texture.destroy")).toBe(0);
    expect(targets.size).toBe(0);

    targets.acquire(target);
    targets.dispose();
    targets.dispose();
    expect(gpu.countOf("texture.destroy")).toBe(2);
    expect(targets.disposed).toBe(true);
    expect(targets.acquire(target)).toBeNull();
    expect(targets.sample(target)).toBeNull();
    target.dispose();
  });
});

describe("WebgpuRenderer.render into a target (WP-R1.6)", () => {
  it("attaches the target's views, sizes the viewport to it, and never touches the swap chain", async () => {
    const { gpu, renderer } = await initialized();
    const root = new Renderable(triangle(), material());
    const target = new RenderTarget({ width: 64, height: 32 });

    renderer.render(
      root,
      [view({ clearColor: [0, 0, 0, 1] })],
      undefined,
      target,
    );

    expect(gpu.countOf("context.getCurrentTexture")).toBe(0);
    expect(textureLabels(gpu)).toEqual([
      `four:render-target:${target.id}`,
      `four:render-target-depth:${target.id}`,
    ]);
    // The frame's own depth attachment is not allocated for an off-screen
    // frame — the target's is the depth buffer.
    expect(textureLabels(gpu)).not.toContain("four:depth");
    const viewport = gpu.callsOf("pass.setViewport")[0]?.args;
    expect(viewport?.slice(0, 4)).toEqual([0, 0, 64, 32]);
    const descriptor = gpu.callsOf("encoder.beginRenderPass")[0]?.args[0] as {
      depthStencilAttachment?: { stencilLoadOp?: string };
    };
    expect(descriptor.depthStencilAttachment).toBeDefined();
    expect(descriptor.depthStencilAttachment?.stencilLoadOp).toBeUndefined();
    // Off-screen pipelines bake the target's colour format.
    const pipeline = gpu.callsOf("device.createRenderPipeline")[0]?.args[0] as {
      fragment: { targets: { format: string }[] };
    };
    expect(pipeline.fragment.targets[0]?.format).toBe(
      RENDER_TARGET_COLOR_FORMAT,
    );
    expect(gpu.countOf("queue.submit")).toBe(1);

    renderer.dispose();
    target.dispose();
  });

  it("renders a depth:false target with no depth attachment and normalized depth state", async () => {
    const { gpu, renderer } = await initialized();
    const root = new Renderable(triangle(), material());
    const target = new RenderTarget({ width: 8, height: 8, depth: false });

    renderer.render(
      root,
      [view({ clearColor: [1, 0, 0, 1] })],
      undefined,
      target,
    );

    const descriptor = gpu.callsOf("encoder.beginRenderPass")[0]?.args[0] as {
      depthStencilAttachment?: unknown;
    };
    expect(descriptor.depthStencilAttachment).toBeUndefined();
    for (const call of gpu.callsOf("device.createRenderPipeline")) {
      expect(
        (call.args[0] as { depthStencil?: unknown }).depthStencil,
      ).toBeUndefined();
    }
    // Clear draw (colour only) plus the triangle.
    expect(gpu.countOf("pass.draw")).toBe(2);

    renderer.dispose();
    target.dispose();
  });

  it("skips the clear draw whole for a depth:false view with no clearColor", async () => {
    const { gpu, renderer } = await initialized();
    const root = new Renderable(triangle(), material());
    const target = new RenderTarget({ width: 8, height: 8, depth: false });

    renderer.render(root, [view()], undefined, target);

    // Only the triangle: no depth to clear, no colour asked for.
    expect(gpu.countOf("pass.draw")).toBe(1);
    renderer.dispose();
    target.dispose();
  });

  it("re-allocates on the next frame after resize, reading size off the record", async () => {
    const { gpu, renderer } = await initialized();
    const root = new Renderable(triangle(), material());
    const target = new RenderTarget({ width: 8, height: 8 });

    renderer.render(root, [view()], undefined, target);
    target.resize(32, 32);
    gpu.reset();
    renderer.render(root, [view()], undefined, target);

    expect(gpu.countOf("texture.destroy")).toBe(2);
    expect(gpu.countOf("device.createTexture")).toBe(2);
    expect(gpu.callsOf("pass.setViewport")[0]?.args.slice(0, 4)).toEqual([
      0, 0, 32, 32,
    ]);
    renderer.dispose();
    target.dispose();
  });

  it("refuses the feedback loop: a material sampling the active target skips its draw (R-4)", async () => {
    const { gpu, renderer } = await initialized();
    const target = new RenderTarget({ width: 8, height: 8 });
    const root = new Renderable(
      triangle(true),
      material({ map: target.colorTexture }),
    );

    renderer.render(root, [view()], undefined, target);
    // The clear depth draw happened; the feedback draw did not, and no
    // sampling bind group was ever created for it.
    expect(gpu.countOf("pass.draw")).toBe(1);
    expect(gpu.countOf("device.createBindGroup")).toBe(0);

    gpu.reset();
    // The same scene on screen samples the target legally.
    renderer.render(root, [view()]);
    expect(gpu.countOf("pass.draw")).toBe(2);

    renderer.dispose();
    target.dispose();
  });

  it("samples a rendered target in a later pass through one lazy bind group", async () => {
    const { gpu, renderer } = await initialized();
    const target = new RenderTarget({ width: 16, height: 16 });
    const offscreen = new Renderable(triangle(), material());
    const composite = new Renderable(
      triangle(true),
      material({ map: target.colorTexture }),
    );

    renderer.render(
      offscreen,
      [view({ clearColor: [0, 1, 0, 1] })],
      undefined,
      target,
    );
    renderer.render(composite, [view()]);
    renderer.render(composite, [view()]);

    // No texel upload — the pixels live in the attachment (R-4's point) —
    // and one sampling group created by the first sampling frame.
    expect(gpu.countOf("queue.writeTexture")).toBe(0);
    const sampleGroups = gpu
      .callsOf("device.createBindGroup")
      .filter((call) =>
        String((call.args[0] as { label?: string }).label).startsWith(
          "four:render-target-map:",
        ),
      );
    expect(sampleGroups).toHaveLength(1);
    renderer.dispose();
    target.dispose();
  });

  it("lets §57's material.stencil reach the hardware on a stencilled target without clips", async () => {
    const { gpu, renderer } = await initialized();
    const target = new RenderTarget({ width: 8, height: 8, stencil: true });
    const root = new Renderable(
      triangle(),
      material({
        stencil: { func: "equal", ref: 3, readMask: 0xff, writeMask: 0 },
      }),
    );

    renderer.render(
      root,
      [view({ clearColor: [0, 0, 0, 1] })],
      undefined,
      target,
    );

    const descriptor = gpu.callsOf("encoder.beginRenderPass")[0]?.args[0] as {
      depthStencilAttachment?: { stencilLoadOp?: string };
    };
    expect(descriptor.depthStencilAttachment?.stencilLoadOp).toBe("load");
    expect(gpu.callsOf("pass.setStencilReference")[0]?.args[0]).toBe(3);
    const stencilled = gpu
      .callsOf("device.createRenderPipeline")
      .map(
        (call) =>
          call.args[0] as {
            depthStencil?: { stencilFront?: { compare?: string } };
          },
      )
      .filter((d) => d.depthStencil?.stencilFront !== undefined);
    expect(
      stencilled.some((d) => d.depthStencil?.stencilFront?.compare === "equal"),
    ).toBe(true);
    renderer.dispose();
    target.dispose();
  });

  it("clips into a stencilled target, and warns-inert into a plain one (§67)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { gpu, renderer } = await initialized();
    const stencilled = new RenderTarget({ width: 8, height: 8, stencil: true });
    const plain = new RenderTarget({ width: 8, height: 8 });
    const root = new Renderable(triangle(), material());
    root.clip = true;
    const child = new Renderable(triangle(), material());
    root.add(child);

    renderer.render(root, [view()], undefined, stencilled);
    // Clear, the mask draw, the clip node's own content, the clipped child.
    expect(gpu.countOf("pass.draw")).toBe(4);
    expect(warn).not.toHaveBeenCalled();

    gpu.reset();
    renderer.render(root, [view()], undefined, plain);
    // The mask is skipped — nowhere to write it — and both nodes draw
    // unclipped (failing toward drawing, R-23's direction).
    expect(gpu.countOf("pass.draw")).toBe(3);
    expect(gpu.countOf("pass.setStencilReference")).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("no stencil buffer");

    renderer.dispose();
    stencilled.dispose();
    plain.dispose();
  });

  it("allocates nothing target-shaped for a frame that names no target", async () => {
    const { gpu, renderer } = await initialized();
    const root = new Renderable(triangle(), material());
    renderer.render(root, [view()]);
    expect(
      textureLabels(gpu).filter((label) =>
        label.startsWith("four:render-target"),
      ),
    ).toEqual([]);
    expect(gpu.countOf("context.getCurrentTexture")).toBe(1);
    renderer.dispose();
  });
});
