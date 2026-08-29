/**
 * §57's material-stencil tier on a real adapter (WP-R1.7, 2026-08-29) — the
 * WebGPU mirror of `tests/browser/stencil.spec.ts`, by its own 1/6 claim.
 *
 * The GL spec proves R-7's mask-by-hand tier against a real driver: a mask
 * rectangle writes stencil bit 1 with colour off, a fill tests `equal`, and
 * the masked frame paints exactly one sixth of the unmasked frame's orange —
 * the ratio the two rectangles' geometry fixes (2 × 2 against 6 × 4). What
 * only a browser can answer here is the same question one API over: whether
 * `depth24plus-stencil8` — the format WP-R1.7's frame scan now selects for a
 * clipless frame that names a `material.stencil` — actually masks under
 * SwiftShader's Dawn, with the exact pipeline state the backend bakes
 * (always/replace with colour writes off for the mask, equal/read-only for
 * the fill, one `setStencilReference`).
 *
 * The fill draws through the backend's **own** flat unlit module with an
 * orthographic `DrawUniforms` block, so the WGSL under test is the WGSL the
 * renderer ships, not a retyped copy. The measurement is `stencil.spec.ts`'s,
 * restated: the same scene twice — fill's stencil test off, then on — and the
 * three assertions that each catch a different failure (a blank surface, a
 * wrong ratio, a right ratio in the wrong place). Thresholds and ratios,
 * never goldens (§92; R-1 plan §5).
 *
 * **Measured on the first run (2026-08-29, SwiftShader — the WP-R1.9 gate,
 * this spec's first execution since WP-R1.7 committed it):** 18 432 orange
 * pixels unmasked, 3 072 masked — ratio 0.1667 against the geometric 1/6
 * exactly; masked box x 72…119, y 64…127.
 */

import { unlitShaderSource } from "@four/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface: 192 × 4 bytes meets the 256-byte `bytesPerRow` rule. */
const WIDTH = 192;
const HEIGHT = 192;

/**
 * The scene's world extents, restated from the GL spec: an 8 × 6 view, a
 * 2 × 2 mask, a 6 × 4 fill — so the masked frame's share of the unmasked
 * frame's orange is (2 × 2) / (6 × 4) = 1/6, from the geometry alone.
 */
const VIEW_WIDTH = 8;
const VIEW_HEIGHT = 6;
const MASK_WIDTH = 2;
const MASK_HEIGHT = 2;
const FILL_WIDTH = 6;
const FILL_HEIGHT = 4;

/** The masked frame's share of the unmasked frame's orange, from the geometry. */
const EXPECTED_RATIO = (MASK_WIDTH * MASK_HEIGHT) / (FILL_WIDTH * FILL_HEIGHT);

/** Tolerance on that ratio — the GL spec's 10%: edge rounding, nothing else. */
const RATIO_TOLERANCE = 0.1;

/** Half the mask's size in device pixels, plus one pixel of edge allowance. */
const MASK_HALF_X = (MASK_WIDTH / VIEW_WIDTH) * WIDTH * 0.5 + 1;
const MASK_HALF_Y = (MASK_HEIGHT / VIEW_HEIGHT) * HEIGHT * 0.5 + 1;

interface StencilProbe {
  readonly adapter: boolean;
  readonly error: string | null;
  readonly pixels: number[];
}

/**
 * Renders the two-draw R-7 composition once, with the fill's stencil test on
 * or off, and reads the surface back — both frames on one device, exactly as
 * the GL fixture reads its drawing buffer inside each probe call.
 *
 * The stencil states are the ones the backend derives from the two
 * `StencilState` records the parity scene names
 * (`tests/integration/webgpu-shadows.test.ts` pins that derivation on the
 * fake device): mask = always/replace over write mask 0xff with colour writes
 * off; fill = equal over read mask 0xff, write mask 0 — reference 1 for both,
 * one recorded pass command.
 */
const STENCIL_SCRIPT = `async (options) => {
  const { width, height, shader, masked, view } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();

  const drawLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform", minBindingSize: 144 },
    }],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [drawLayout] });
  const uniformBuffer = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };
  // An orthographic DrawUniforms block: viewProjection scales the world
  // extents onto clip space, model stays identity, colour as given.
  const drawBlock = (color) => {
    const floats = new Float32Array(36);
    floats[0] = 2 / view.width;
    floats[5] = 2 / view.height;
    floats[10] = 1;
    floats[15] = 1;
    floats[16] = 1; floats[21] = 1; floats[26] = 1; floats[31] = 1;
    floats[32] = color[0]; floats[33] = color[1];
    floats[34] = color[2]; floats[35] = color[3];
    return floats;
  };
  const quad = (w, h) => {
    const x = w / 2;
    const y = h / 2;
    return new Float32Array([
      -x, -y, 0,  x, -y, 0,  x, y, 0,
      -x, -y, 0,  x, y, 0,  -x, y, 0,
    ]);
  };
  const vertexBuffer = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };
  const buffers = [{
    arrayStride: 12, stepMode: "vertex",
    attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
  }];
  // One pipeline per stencil state — stencil is pipeline identity on this
  // backend; only the reference is a pass command.
  const module = device.createShaderModule({ code: shader });
  const pipeline = (writeMask, colorWrite, face) => device.createRenderPipeline({
    layout,
    vertex: { module, entryPoint: "vertexMain", buffers },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: colorWrite ? 0xf : 0 }],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus-stencil8",
      depthWriteEnabled: false,
      depthCompare: "always",
      stencilFront: face,
      stencilBack: face,
      stencilReadMask: 0xff,
      stencilWriteMask: writeMask,
    },
  });
  const maskPipeline = pipeline(0xff, false, {
    compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "replace",
  });
  const fillPipeline = pipeline(0, true, masked
    ? { compare: "equal", failOp: "keep", depthFailOp: "keep", passOp: "keep" }
    : { compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "keep" });

  const target = device.createTexture({
    size: [width, height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depth = device.createTexture({
    size: [width, height],
    format: "depth24plus-stencil8",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.pushErrorScope("validation");
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: [0, 0, 0, 1],
    }],
    depthStencilAttachment: {
      view: depth.createView(),
      depthLoadOp: "clear",
      depthClearValue: 1,
      depthStoreOp: "store",
      stencilLoadOp: "clear",
      stencilStoreOp: "store",
    },
  });
  const maskGroup = device.createBindGroup({
    layout: drawLayout,
    entries: [{ binding: 0, resource: {
      buffer: uniformBuffer(drawBlock([0, 0, 0, 0])),
    } }],
  });
  const fillGroup = device.createBindGroup({
    layout: drawLayout,
    entries: [{ binding: 0, resource: {
      buffer: uniformBuffer(drawBlock([0.95, 0.45, 0.1, 1])),
    } }],
  });
  pass.setStencilReference(1);
  pass.setPipeline(maskPipeline);
  pass.setBindGroup(0, maskGroup);
  pass.setVertexBuffer(0, vertexBuffer(quad(view.maskWidth, view.maskHeight)));
  pass.draw(6);
  pass.setPipeline(fillPipeline);
  pass.setBindGroup(0, fillGroup);
  pass.setVertexBuffer(0, vertexBuffer(quad(view.fillWidth, view.fillHeight)));
  pass.draw(6);
  pass.end();
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  const readback = device.createBuffer({
    size: width * height * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const copy = device.createCommandEncoder();
  copy.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: width * 4, rowsPerImage: height },
    [width, height],
  );
  device.queue.submit([copy.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const pixels = Array.from(new Uint8Array(readback.getMappedRange().slice(0)));
  readback.unmap();
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    pixels,
  };
}`;

/** Whether a pixel is the fill's orange rather than the black clear. */
function isOrange(pixels: readonly number[], index: number): boolean {
  return pixels[index] > 120 && pixels[index + 2] < 120;
}

/** Counts the orange pixels, and the bounding box they occupy. */
function orangeExtent(pixels: readonly number[]): {
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let count = 0;
  let minX = WIDTH;
  let maxX = -1;
  let minY = HEIGHT;
  let maxY = -1;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!isOrange(pixels, (y * WIDTH + x) * 4)) continue;
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { count, minX, maxX, minY, maxY };
}

/** Runs the page program with `options` — the sibling specs' wrapped-call gotcha. */
async function probe(
  page: import("@playwright/test").Page,
  masked: boolean,
): Promise<StencilProbe> {
  return await page.evaluate(
    `(${STENCIL_SCRIPT})(${JSON.stringify({
      width: WIDTH,
      height: HEIGHT,
      shader: unlitShaderSource(false, false),
      masked,
      view: {
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        maskWidth: MASK_WIDTH,
        maskHeight: MASK_HEIGHT,
        fillWidth: FILL_WIDTH,
        fillHeight: FILL_HEIGHT,
      },
    })})`,
  );
}

test.describe("§57 a material stencil masks on WebGPU (R-7, WP-R1.7)", () => {
  test("the masked fill covers the mask's rectangle and nothing else", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const unmasked = await probe(page, false);
    test.skip(
      !unmasked.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );
    const masked = await probe(page, true);

    expect(unmasked.error).toBeNull();
    expect(masked.error).toBeNull();
    expect(masked.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    const before = orangeExtent(unmasked.pixels);
    const after = orangeExtent(masked.pixels);
    const ratio = after.count / before.count;
    console.log(
      `webgpu stencil: ${String(before.count)} orange pixels unmasked, ` +
        `${String(after.count)} masked — ratio ${ratio.toFixed(4)} ` +
        `(expected ${EXPECTED_RATIO.toFixed(4)}); masked box ` +
        `x ${String(after.minX)}…${String(after.maxX)}, ` +
        `y ${String(after.minY)}…${String(after.maxY)}`,
    );

    // A blank surface would pass every ratio comparison below.
    const expectedFill =
      ((FILL_WIDTH * FILL_HEIGHT) / (VIEW_WIDTH * VIEW_HEIGHT)) *
      WIDTH *
      HEIGHT;
    expect(before.count).toBeGreaterThan(expectedFill * 0.9);

    // The mask clipped, and clipped by the right amount — the GL spec's 1/6.
    expect(ratio).toBeGreaterThan(EXPECTED_RATIO * (1 - RATIO_TOLERANCE));
    expect(ratio).toBeLessThan(EXPECTED_RATIO * (1 + RATIO_TOLERANCE));

    // And clipped in the right *place*: every surviving pixel is inside the
    // mask's rectangle, centred on the surface.
    expect(after.minX).toBeGreaterThanOrEqual(WIDTH / 2 - MASK_HALF_X);
    expect(after.maxX).toBeLessThanOrEqual(WIDTH / 2 + MASK_HALF_X);
    expect(after.minY).toBeGreaterThanOrEqual(HEIGHT / 2 - MASK_HALF_Y);
    expect(after.maxY).toBeLessThanOrEqual(HEIGHT / 2 + MASK_HALF_Y);
  });
});
