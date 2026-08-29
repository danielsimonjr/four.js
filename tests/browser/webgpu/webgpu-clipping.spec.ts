/**
 * WP-R1.3's real-GPU gate for §67 clipping: the stencil *mechanism* the
 * backend's clip application is built on — `depth24plus-stencil8`, per-plane
 * writes with colour off, an `equal` test over accumulated bits — proved on a
 * real adapter.
 *
 * The unit and integration layers prove the backend *encodes* R-23's records
 * into exactly this state (`webgpu-renderer.test.ts`,
 * `webgpu-clipping.test.ts`); what only a rasteriser can prove is that the
 * state *masks*: that SwiftShader's Dawn honours the combined depth-stencil
 * format the per-frame format decision commits to, and that two planes
 * conjoin. The assertion is R-23's recorded intersection argument, restated:
 * full-surface content under two offset masks leaves a footprint that one
 * mask alone (3/4) or their union (1) cannot produce — the intersection
 * (1/2). A masking bug fails the ratio in a *direction that names it*.
 *
 * Skip-when-no-adapter, served origin, thresholds not goldens — the recorded
 * WP-R1.1 pattern; `webgpu-unlit.spec.ts` carries the three arguments.
 */

import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface size; 64 × 4 bytes is WebGPU's `bytesPerRow` alignment. */
const SIZE = 64;

interface ClipResult {
  readonly adapter: boolean;
  readonly orangePixels: number;
  readonly total: number;
  readonly leftEdge: number;
  readonly rightEdge: number;
  readonly error: string | null;
}

/**
 * Two scissored full-surface mask draws write stencil bits 1 and 2 over the
 * left and right three-quarters of the surface (colour writes off — a §67
 * mask contributes no pixels), then full-surface content tests `equal` with
 * reference and read mask 3. Exactly the state the backend derives from two
 * sibling clips whose regions overlap — the scissor here plays the role the
 * mask geometry plays in a scene.
 *
 * A string, not a function, for the repository's no-WebGPU-typings reason.
 */
const CLIP_SCRIPT = `async (size) => {
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();

  const target = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  // The format the backend's clipping frames allocate.
  const depth = device.createTexture({
    size: [size, size],
    format: "depth24plus-stencil8",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const readback = device.createBuffer({
    size: size * size * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const shader = device.createShaderModule({
    code: \`
@vertex
fn vertexMain(@builtin(vertex_index) index : u32) -> @builtin(position) vec4<f32> {
  let corner = i32(index);
  let x = f32(corner / 2) * 4.0 - 1.0;
  let y = f32(corner & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.5, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.5, 0.0, 1.0);
}
\`,
  });

  const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
  // A mask pipeline: colour writes off, always/replace onto one plane — the
  // state the backend bakes for a §67 mask draw.
  const maskPipeline = (planeBit) => {
    const face = { compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "replace" };
    return device.createRenderPipeline({
      layout,
      vertex: { module: shader, entryPoint: "vertexMain", buffers: [] },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm", writeMask: 0 }],
      },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: "depth24plus-stencil8",
        depthWriteEnabled: false,
        depthCompare: "always",
        stencilFront: face,
        stencilBack: face,
        stencilReadMask: 0xff,
        stencilWriteMask: planeBit,
      },
    });
  };
  const maskA = maskPipeline(1);
  const maskB = maskPipeline(2);
  // The content pipeline: equal over the accumulated planes, read-only.
  const content = device.createRenderPipeline({
    layout,
    vertex: { module: shader, entryPoint: "vertexMain", buffers: [] },
    fragment: {
      module: shader,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus-stencil8",
      depthWriteEnabled: false,
      depthCompare: "always",
      stencilFront: { compare: "equal", failOp: "keep", depthFailOp: "keep", passOp: "keep" },
      stencilBack: { compare: "equal", failOp: "keep", depthFailOp: "keep", passOp: "keep" },
      stencilReadMask: 3,
      stencilWriteMask: 0,
    },
  });

  device.pushErrorScope("validation");
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
    ],
    depthStencilAttachment: {
      view: depth.createView(),
      depthLoadOp: "clear",
      depthClearValue: 1,
      depthStoreOp: "store",
      stencilLoadOp: "clear",
      stencilClearValue: 0,
      stencilStoreOp: "store",
    },
  });
  const threeQuarters = (size / 4) * 3;
  // Mask A: the left three quarters, plane 1.
  pass.setPipeline(maskA);
  pass.setStencilReference(1);
  pass.setScissorRect(0, 0, threeQuarters, size);
  pass.draw(3);
  // Mask B: the right three quarters, plane 2.
  pass.setPipeline(maskB);
  pass.setStencilReference(2);
  pass.setScissorRect(size / 4, 0, threeQuarters, size);
  pass.draw(3);
  // Content: the whole surface, surviving only where both planes were written.
  pass.setPipeline(content);
  pass.setStencilReference(3);
  pass.setScissorRect(0, 0, size, size);
  pass.draw(3);
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: size * 4, rowsPerImage: size },
    [size, size],
  );
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange().slice(0));
  readback.unmap();

  let orangePixels = 0;
  let leftEdge = size;
  let rightEdge = -1;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] >= 200 && pixels[i + 1] >= 64 && pixels[i + 2] < 64) {
      orangePixels += 1;
      const x = (i / 4) % size;
      if (x < leftEdge) leftEdge = x;
      if (x > rightEdge) rightEdge = x;
    }
  }
  return {
    adapter: true,
    orangePixels,
    total: size * size,
    leftEdge,
    rightEdge,
    error: error === null ? null : String(error.message),
  };
}`;

test.describe("WebGPU §67 clipping, on a real adapter", () => {
  test("two offset masks intersect — content survives only in the overlap", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await page.evaluate<ClipResult>(
      `(${CLIP_SCRIPT})(${String(SIZE)})`,
    );
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.error).toBeNull();
    // The intersection is the middle half: 2048 of 4096 texels. One mask
    // alone would keep 3/4, the union the whole surface, no mask none — so
    // the band below is produced by intersection and nothing else. Scissors
    // are pixel-exact, but the band stays generous on principle (§92).
    const ratio = result.orangePixels / result.total;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
    // And it is the *right* half of the surface: columns 16…47.
    expect(result.leftEdge).toBeGreaterThanOrEqual(SIZE / 4 - 1);
    expect(result.rightEdge).toBeLessThanOrEqual((SIZE / 4) * 3);
  });
});
