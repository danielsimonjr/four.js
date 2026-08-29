/**
 * §61's `readPixels` region form, on a real (SwiftShader) WebGPU adapter
 * (2026-08-29 — `Rectangle2` landed and the region form joined
 * `WebgpuRenderer.readPixels`).
 *
 * ## What only a browser can answer
 *
 * The unit suite (`wgpu-readback-region.test.ts`) proves which commands the
 * region form records against a fake device — including the §7a bottom-origin
 * → top-first `origin` conversion as *arithmetic*. What no double can prove
 * is that `copyTextureToBuffer` with an `origin` really selects the texels
 * that arithmetic names on a real implementation. So this spec renders a
 * coordinate-encoded gradient (every texel's bytes are a function of its own
 * position), reads the whole target back, reads a region back, and asserts
 * the region is **byte-for-byte the sub-rectangle of the whole** — the same
 * self-relative claim the WebGL unit test makes against its fake, now made
 * against a real adapter.
 *
 * ## Why it skips, why the page is navigated, why there are no goldens
 *
 * All three are `webgpu-unlit.spec.ts`'s recorded reasons, unchanged: no
 * adapter means skip (a contributor without the flag gets a skip, not a red
 * suite); `about:blank` is an opaque origin where `navigator.gpu` is absent,
 * so the first example site's origin is borrowed; and the assertion is
 * self-relative, never a committed image (§92 — SwiftShader is not a GPU).
 */

import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/**
 * Target size. 64 × 4 bytes is exactly 256 — WebGPU's `bytesPerRow`
 * alignment — so the whole-target readback needs no padding arithmetic; the
 * region readback pads to 256 and strips in the page, exactly as
 * `wgpu-readback.ts` does.
 */
const SIZE = 64;

/** The region under test, §7a bottom-left origin: x, y, width, height. */
const REGION = { x: 5, y: 9, width: 11, height: 7 } as const;

interface RegionResult {
  readonly adapter: boolean;
  readonly error: string | null;
  /** Whole target, tightly packed, top-first rows (raw copy order). */
  readonly whole: number[];
  /** The region, tightly packed, top-first rows (raw copy order). */
  readonly region: number[];
}

/**
 * The page-side program — a **string**, for `webgpu-unlit.spec.ts`'s recorded
 * reason: this repository pins no WebGPU typings, so `GPUTextureUsage` and
 * friends only have meaning inside the page.
 */
const PAGE_SCRIPT = `async (options) => {
  const { size, region } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();

  const target = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  // A full-screen triangle whose fragment encodes its own coordinates, so
  // every texel of the gradient is distinguishable after 8-bit quantization
  // at this size — an origin mistake of even one texel changes bytes.
  const shader = device.createShaderModule({
    code: \`
      @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
        var corners = array<vec2f, 3>(
          vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
        return vec4f(corners[index], 0.0, 1.0);
      }
      @fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
        return vec4f(position.x / \${String(size)}.0, position.y / \${String(size)}.0, 0.5, 1.0);
      }
    \`,
  });

  let error = null;
  device.pushErrorScope("validation");
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vertexMain", buffers: [] },
    fragment: {
      module: shader,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list" },
  });
  {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  const readback = async (origin, extent) => {
    const bytesPerRow = Math.ceil((extent[0] * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * extent[1],
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      origin === null ? { texture: target } : { texture: target, origin },
      { buffer, bytesPerRow, rowsPerImage: extent[1] },
      extent,
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const rowBytes = extent[0] * 4;
    const packed = new Uint8Array(rowBytes * extent[1]);
    for (let row = 0; row < extent[1]; row += 1) {
      packed.set(
        mapped.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes),
        row * rowBytes,
      );
    }
    buffer.unmap();
    buffer.destroy();
    return Array.from(packed);
  };

  // Whole target, then the region — with the very conversion
  // wgpu-readback.ts performs: bottom-origin y becomes top-first
  // size - y - height.
  const whole = await readback(null, [size, size]);
  const part = await readback(
    [region.x, size - region.y - region.height],
    [region.width, region.height],
  );
  error = await device.popErrorScope();

  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    whole,
    region: part,
  };
}`;

/** Runs the page program with `options` — `webgpu-unlit.spec.ts`'s wrapper. */
async function inPage<T>(
  page: import("@playwright/test").Page,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${PAGE_SCRIPT})(${JSON.stringify(options)})`);
}

test.describe("WebGPU §61 readPixels region, on a real adapter", () => {
  test("a copy with an origin is byte-for-byte the sub-rectangle of the whole", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<RegionResult>(page, {
      size: SIZE,
      region: REGION,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.error).toBeNull();
    expect(result.whole).toHaveLength(SIZE * SIZE * 4);
    expect(result.region).toHaveLength(REGION.width * REGION.height * 4);

    // Both buffers are in raw copy order (top-first rows); the region began
    // at top-first row SIZE - y - height. Comparing every byte of the region
    // against the whole read pins the origin semantics the backend's
    // conversion relies on — the §7a flip itself is unit-tested arithmetic.
    const topY = SIZE - REGION.y - REGION.height;
    for (let row = 0; row < REGION.height; row += 1) {
      for (let col = 0; col < REGION.width; col += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          const fromRegion =
            result.region[(row * REGION.width + col) * 4 + channel];
          const fromWhole =
            result.whole[
              ((topY + row) * SIZE + (REGION.x + col)) * 4 + channel
            ];
          expect(fromRegion).toBe(fromWhole);
        }
      }
    }
  });
});
