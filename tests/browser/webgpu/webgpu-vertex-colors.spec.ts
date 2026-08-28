/**
 * The vertex-colour unlit variant on a real adapter (WP-R1.4, 2026-08-28).
 *
 * `webgpu-unlit.spec.ts` compiles and rasterises `unlitShaderSource(false)` —
 * the flat variant. The `useVertexColors` variant is a *different* WGSL module
 * (a second vertex stream at location 1, `draw.color * vertexColor` in place
 * of the flat colour) and a different vertex layout, and no transcript can
 * prove that it compiles or that the colour stream survives interpolation to
 * the fragment stage. This file makes exactly those two claims — nothing the
 * fake-device suites already make — for the module every §50 painted shape
 * and §58 stroke draws through (`tests/integration/webgpu-shapes.test.ts`).
 *
 * Everything else follows the sibling spec's recorded decisions verbatim: the
 * shader is **imported** from `@four/render-webgpu`, never retyped; the page
 * program is a string because this repository pins no WebGPU typings; the
 * page is *served* (an opaque origin loses `navigator.gpu`); the spec
 * **skips** when `requestAdapter()` resolves `null`; and every assertion is a
 * threshold or a specification-fixed value — no goldens, per §92 and the R-1
 * plan §5.
 */

import { unlitShaderSource } from "@four/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface size; 64 × 4 bytes meets the 256-byte `bytesPerRow` rule. */
const SIZE = 64;

interface VertexColorResult {
  readonly adapter: boolean;
  readonly redDominant: number;
  readonly greenDominant: number;
  readonly blueDominant: number;
  readonly total: number;
  readonly centroid: number[];
  readonly error: string | null;
}

/**
 * The page-side program: a triangle with pure red, green and blue vertices
 * through the backend's own vc variant, read back over `mapAsync`.
 *
 * The uniform colour is opaque white, so the fragment expression
 * `draw.color * vertexColor` passes the interpolated stream through
 * unchanged — a corner that comes back its own colour and a centroid that
 * comes back the mix is the whole variant working: layout, location 1,
 * interpolation, multiply.
 */
const PAGE_SCRIPT = `async (options) => {
  const { size, shader } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();

  const target = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: size * size * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // The bind-group layout the backend declares as data (wgpu-bindings.ts).
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 144 },
      },
    ],
  });
  const uniforms = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: uniforms, offset: 0, size: 144 } }],
  });

  // viewProjection = identity, model = identity, color = opaque white.
  const block = new Float32Array(36);
  for (let i = 0; i < 4; i += 1) {
    block[i * 5] = 1;
    block[16 + i * 5] = 1;
  }
  block[32] = 1;
  block[33] = 1;
  block[34] = 1;
  block[35] = 1;
  device.queue.writeBuffer(uniforms, 0, block);

  const positions = new Float32Array([-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0]);
  const vertices = device.createBuffer({
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertices, 0, positions);

  // §53's colour stream: red, green, blue — one per corner, in vertex order.
  const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]);
  const colorBuffer = device.createBuffer({
    size: colors.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colorBuffer, 0, colors);

  let error = null;
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module,
      entryPoint: "vertexMain",
      // The vc variant's layout, as unlitVertexBufferLayouts(true) builds it:
      // position at slot 0, the colour stream at slot 1, location 1.
      buffers: [
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
        },
        {
          arrayStride: 16,
          stepMode: "vertex",
          attributes: [{ format: "float32x4", offset: 0, shaderLocation: 1 }],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list" },
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: [0, 0, 0, 1],
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup, [0]);
  pass.setVertexBuffer(0, vertices);
  pass.setVertexBuffer(1, colorBuffer);
  pass.draw(3);
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: size * 4, rowsPerImage: size },
    [size, size],
  );
  device.queue.submit([encoder.finish()]);
  error = await device.popErrorScope();

  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange().slice(0));
  readback.unmap();

  // Dominant-channel counts: near each corner one channel outweighs the other
  // two, and the region where one barycentric weight exceeds one half is a
  // quarter of the triangle — far more than the thresholds below ask for.
  let redDominant = 0;
  let greenDominant = 0;
  let blueDominant = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (r >= 150 && r > g + 50 && r > b + 50) redDominant += 1;
    else if (g >= 150 && g > r + 50 && g > b + 50) greenDominant += 1;
    else if (b >= 150 && b > r + 50 && b > g + 50) blueDominant += 1;
  }
  // The barycentre in NDC is (0, -0.2667); its texel row is below the middle
  // because the framebuffer origin is top-left.
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size * 0.6333);
  const centroid = (cy * size + cx) * 4;
  return {
    adapter: true,
    redDominant,
    greenDominant,
    blueDominant,
    total: size * size,
    centroid: Array.from(pixels.slice(centroid, centroid + 4)),
    error: error === null ? null : String(error.message),
  };
}`;

/**
 * Runs the page program with `options` and returns its result. The program is
 * an arrow-function *expression*, so it is wrapped in a call — `page.evaluate`
 * given a bare function expression would evaluate to the function rather than
 * call it (the sibling spec's recorded gotcha).
 */
async function inPage<T>(
  page: import("@playwright/test").Page,
  program: string,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${program})(${JSON.stringify(options)})`);
}

test.describe("WebGPU vertex colours, on a real adapter", () => {
  test("compiles the vc unlit WGSL and interpolates the colour stream", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<VertexColorResult>(page, PAGE_SCRIPT, {
      size: SIZE,
      // The real thing, imported rather than retyped.
      shader: unlitShaderSource(true),
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    // A validation error here is a WGSL or vertex-layout mistake, and its
    // message is far more useful than three counts of zero.
    expect(result.error).toBeNull();

    // Each corner's dominant region is roughly an eighth of the triangle
    // (~4% of the surface); ask for a quarter of that, so the claim is "each
    // vertex colour arrived, roughly in its corner", not a pixel census.
    expect(result.redDominant).toBeGreaterThan(result.total * 0.01);
    expect(result.greenDominant).toBeGreaterThan(result.total * 0.01);
    expect(result.blueDominant).toBeGreaterThan(result.total * 0.01);

    // The barycentre interpolates to a genuine mix: every channel present,
    // none dominant, alpha exactly 1 (the stream's own alpha times white).
    for (const channel of result.centroid.slice(0, 3)) {
      expect(channel).toBeGreaterThan(40);
      expect(channel).toBeLessThan(180);
    }
    expect(result.centroid[3]).toBe(255);
  });
});
