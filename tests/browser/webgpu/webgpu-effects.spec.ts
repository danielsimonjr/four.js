/**
 * WP-R1.6's real-GPU gate: §70's effects and the render-to-target-then-sample
 * chain, on a real (SwiftShader) WebGPU adapter.
 *
 * ## What only a browser can answer
 *
 * The unit suites prove which commands `renderEffect` records against a fake
 * device; none of them compiles a line of WGSL. Per the recorded
 * variant-evidence rule — *"a variant family's browser evidence covers only
 * the variants it compiles; each generated module needs its own
 * compile-and-rasterise line once"* (WP-R1.4) — every one of
 * `effectShaderSource`'s three modules is compiled, drawn and read back here:
 *
 * 1. **`copy` is bit-exact.** The destination's bytes equal the source's,
 *    byte for byte — asserted by reading *both* targets back and comparing,
 *    so no assumption about float→unorm rounding sneaks into the claim.
 * 2. **`grade` is the documented arithmetic.** Exposure 0.5 halves every
 *    linear channel, within a quantization threshold.
 * 3. **`output-transform` is the IEC 61966-2-1 encode.** The expected value
 *    is computed on the Node side from the same piecewise curve, within a
 *    threshold.
 *
 * Each case is the whole WP-R1.6 chain in miniature: a pass renders into
 * target A, the effect pass samples A into target B, and `mapAsync` reads B
 * back — which is also the mechanism `readPixels` ships on.
 *
 * ## Why it skips, why the page is navigated, why there are no goldens
 *
 * All three are `webgpu-unlit.spec.ts`'s recorded reasons, unchanged: no
 * adapter means skip (a contributor without the flag gets a skip, not a red
 * suite); `about:blank` is an opaque origin where `navigator.gpu` is absent,
 * so the first example site's origin is borrowed; and every assertion is a
 * threshold or a self-relative comparison, never a committed image (§92 —
 * SwiftShader is not a GPU).
 */

import { effectShaderSource } from "@four/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/**
 * Target size. 64 × 4 bytes is exactly 256 — WebGPU's `bytesPerRow`
 * alignment — so the readbacks need no padding arithmetic.
 */
const SIZE = 64;

/** The linear-light colour target A is cleared to before the effect runs. */
const SOURCE_COLOR = [0.5, 0.25, 0.125, 1] as const;

/** Quantization tolerance for the arithmetic assertions, in 8-bit steps. */
const TOLERANCE = 2;

interface EffectResult {
  readonly adapter: boolean;
  readonly error: string | null;
  /** Target A's centre texel, read back after the chain ran. */
  readonly source: number[];
  /** Target B's centre texel. */
  readonly dest: number[];
  /** Whether every byte of B equals the corresponding byte of A. */
  readonly identical: boolean;
}

/**
 * The page-side program — a **string**, for `webgpu-unlit.spec.ts`'s recorded
 * reason: this repository pins no WebGPU typings, so `GPUTextureUsage` and
 * friends only have meaning inside the page.
 *
 * Renders into A (a cleared pass — the simplest render-to-target), draws the
 * effect module over A into B through the backend's own bind-group shape
 * (texture + sampler at group 0; the grade's 16-byte block at group 1), and
 * reads both targets back.
 */
const PAGE_SCRIPT = `async (options) => {
  const { size, shader, grade, sourceColor } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();

  const makeTarget = () =>
    device.createTexture({
      size: [size, size],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
  const a = makeTarget();
  const b = makeTarget();

  // Render into A: the chain's first pass.
  {
    const encoder = device.createCommandEncoder();
    encoder
      .beginRenderPass({
        colorAttachments: [
          {
            view: a.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: sourceColor,
          },
        ],
      })
      .end();
    device.queue.submit([encoder.finish()]);
  }

  // The backend's bind-group shape: texture + sampler at group 0.
  const sourceLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
    ],
  });
  const layouts = [sourceLayout];
  let gradeGroup = null;
  if (grade !== null) {
    const gradeLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: 16 },
        },
      ],
    });
    layouts.push(gradeLayout);
    const gradeBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(gradeBuffer, 0, new Float32Array(grade));
    gradeGroup = device.createBindGroup({
      layout: gradeLayout,
      entries: [{ binding: 0, resource: { buffer: gradeBuffer } }],
    });
  }

  let error = null;
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
    vertex: { module, entryPoint: "vertexMain", buffers: [] },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "nearest",
  });
  const sourceGroup = device.createBindGroup({
    layout: sourceLayout,
    entries: [
      { binding: 0, resource: a.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  const readback = (texture) => {
    const buffer = device.createBuffer({
      size: size * size * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow: size * 4, rowsPerImage: size },
      [size, size],
    );
    device.queue.submit([encoder.finish()]);
    return buffer;
  };

  // The effect pass: A sampled into B by one full-screen triangle.
  {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: b.createView(), loadOp: "load", storeOp: "store" },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, sourceGroup);
    if (gradeGroup !== null) pass.setBindGroup(1, gradeGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  error = await device.popErrorScope();

  const bufferA = readback(a);
  const bufferB = readback(b);
  await bufferA.mapAsync(GPUMapMode.READ);
  const pixelsA = new Uint8Array(bufferA.getMappedRange().slice(0));
  bufferA.unmap();
  await bufferB.mapAsync(GPUMapMode.READ);
  const pixelsB = new Uint8Array(bufferB.getMappedRange().slice(0));
  bufferB.unmap();

  let identical = pixelsA.length === pixelsB.length;
  for (let i = 0; identical && i < pixelsA.length; i += 1) {
    if (pixelsA[i] !== pixelsB[i]) identical = false;
  }
  const centre = ((size / 2) * size + size / 2) * 4;
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    source: Array.from(pixelsA.slice(centre, centre + 4)),
    dest: Array.from(pixelsB.slice(centre, centre + 4)),
    identical,
  };
}`;

/** Runs the page program with `options` — `webgpu-unlit.spec.ts`'s wrapper. */
async function inPage<T>(
  page: import("@playwright/test").Page,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${PAGE_SCRIPT})(${JSON.stringify(options)})`);
}

/** The CPU half of §60a's encode — `@four/math`'s `linearToSrgb`, restated. */
function linearToSrgb(value: number): number {
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

test.describe("WebGPU §70 effects, on a real adapter", () => {
  test("compiles the copy module, and the copy is bit-exact", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<EffectResult>(page, {
      size: SIZE,
      shader: effectShaderSource("copy"),
      grade: null,
      sourceColor: SOURCE_COLOR,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.error).toBeNull();
    // Same texels in, same texels out — every byte, not a threshold: the one
    // §70 promise that is exact by contract.
    expect(result.identical).toBe(true);
  });

  test("compiles the grade module: exposure 0.5 halves the linear channels", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<EffectResult>(page, {
      size: SIZE,
      shader: effectShaderSource("grade"),
      // exposure, contrast, saturation, padding.
      grade: [0.5, 1, 1, 0],
      sourceColor: SOURCE_COLOR,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.error).toBeNull();
    for (let channel = 0; channel < 3; channel += 1) {
      const expected = result.source[channel] * 0.5;
      expect(Math.abs(result.dest[channel] - expected)).toBeLessThanOrEqual(
        TOLERANCE,
      );
    }
    // Alpha is carried through untouched.
    expect(result.dest[3]).toBe(result.source[3]);
  });

  test("compiles the output-transform module: the sRGB encode, exactly the curve", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<EffectResult>(page, {
      size: SIZE,
      shader: effectShaderSource("output-transform"),
      grade: null,
      sourceColor: SOURCE_COLOR,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.error).toBeNull();
    for (let channel = 0; channel < 3; channel += 1) {
      const expected = linearToSrgb(result.source[channel] / 255) * 255;
      expect(Math.abs(result.dest[channel] - expected)).toBeLessThanOrEqual(
        TOLERANCE,
      );
    }
    // A coverage fraction is not a light quantity: alpha is not encoded.
    expect(result.dest[3]).toBe(result.source[3]);
  });
});
