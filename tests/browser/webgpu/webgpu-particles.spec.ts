/**
 * §36's instanced particle billboard on a real adapter (WP-R1.8, 2026-08-29).
 *
 * The fake-device suites pin the command sequence; what no transcript can
 * prove is that `PARTICLE_SHADER_SOURCE` satisfies a real WGSL front end —
 * the per-instance `stepMode: "instance"` layout included — and that the
 * view-space billboard puts each instance's quad where its centre says, in
 * its own colour. This file makes exactly those claims, per the WP-R1.4
 * variant-evidence rule: the particle family's one module gets its own
 * compile-and-rasterise line.
 *
 * Mechanics follow the sibling specs' recorded decisions verbatim: the WGSL
 * and layout constants are **imported** from `@four/render-webgpu`, never
 * retyped; the page program is a string because this repository pins no
 * WebGPU typings; the page is *served* (an opaque origin loses
 * `navigator.gpu`); the spec **skips** when `requestAdapter()` resolves
 * `null`; every assertion is a threshold or a specification-fixed value — no
 * goldens (§92, R-1 plan §5).
 */

import {
  PARTICLE_INSTANCE_BUFFER_LAYOUT,
  PARTICLE_SHADER_SOURCE,
  PARTICLE_UNIFORM_BYTES,
} from "@four/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface size; 64 × 4 bytes meets the 256-byte `bytesPerRow` rule. */
const SIZE = 64;

interface ParticleResult {
  readonly adapter: boolean;
  readonly error: string | null;
  /** Centre texel of each particle's quad, RGBA. */
  readonly samples: number[][];
  /** A corner texel no quad covers — must stay the clear colour. */
  readonly corner: number[];
}

/**
 * The page-side program: three particles at distinct NDC centres with
 * distinct colours and sizes, drawn as `draw(6, 3)` over the shared unit
 * quad through the backend's own module, under identity matrices — so a
 * particle's quad spans `size` NDC units around its centre, and the centre
 * texel must come back its own instance colour.
 */
const PAGE_SCRIPT = `async (options) => {
  const { size, shader, uniformBytes, instanceLayout } = options;
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

  // The particle group-0 layout the backend declares as data
  // (wgpu-particles.ts): a vertex-only uniform block of three matrices.
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform", minBindingSize: uniformBytes },
      },
    ],
  });
  const uniforms = device.createBuffer({
    size: uniformBytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // projection = view = model = identity: a centre lands at its own NDC.
  const block = new Float32Array(uniformBytes / 4);
  for (let i = 0; i < 4; i += 1) {
    block[i * 5] = 1;
    block[16 + i * 5] = 1;
    block[32 + i * 5] = 1;
  }
  device.queue.writeBuffer(uniforms, 0, block);
  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniforms, offset: 0, size: uniformBytes } },
    ],
  });

  // The shared unit quad, exactly as @four/render's particleQuadGeometry
  // authors it: six vertices, corner offsets in [-0.5, 0.5].
  const corners = new Float32Array([
    -0.5, -0.5, 0,  0.5, -0.5, 0,  0.5, 0.5, 0,
    -0.5, -0.5, 0,  0.5, 0.5, 0,  -0.5, 0.5, 0,
  ]);
  const cornerBuffer = device.createBuffer({
    size: corners.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(cornerBuffer, 0, corners);

  // Three instances of @four/render's 8-float stride: centre, size, RGBA.
  const instances = new Float32Array([
    -0.5, -0.5, 0,  0.4,  1, 0, 0, 1,
     0.5,  0.5, 0,  0.4,  0, 1, 0, 1,
     0.5, -0.5, 0,  0.3,  0, 0, 1, 1,
  ]);
  const instanceBuffer = device.createBuffer({
    size: instances.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(instanceBuffer, 0, instances);

  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module,
      entryPoint: "vertexMain",
      // Slot 0 the corner quad, slot 1 the instance stream — the backend's
      // own declared layouts, passed through verbatim.
      buffers: [
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
        },
        instanceLayout,
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
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, cornerBuffer);
  pass.setVertexBuffer(1, instanceBuffer);
  pass.draw(6, 3);
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

  // NDC (x, y) onto the top-left-origin texel grid.
  const texel = (x, y) => {
    const px = Math.floor(((x + 1) / 2) * size);
    const py = Math.floor(((1 - y) / 2) * size);
    const base = (py * size + px) * 4;
    return Array.from(pixels.slice(base, base + 4));
  };
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    samples: [texel(-0.5, -0.5), texel(0.5, 0.5), texel(0.5, -0.5)],
    corner: texel(-0.9, 0.9),
  };
}`;

/** Runs the page program with `options` — the sibling specs' wrapped-call gotcha. */
async function inPage<T>(
  page: import("@playwright/test").Page,
  program: string,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${program})(${JSON.stringify(options)})`);
}

test.describe("WebGPU particles, on a real adapter (§36, WP-R1.8)", () => {
  test("compiles the particle WGSL and billboards each instance in place", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<ParticleResult>(page, PAGE_SCRIPT, {
      size: SIZE,
      // The real thing, imported rather than retyped.
      shader: PARTICLE_SHADER_SOURCE,
      uniformBytes: PARTICLE_UNIFORM_BYTES,
      instanceLayout: PARTICLE_INSTANCE_BUFFER_LAYOUT,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    // A validation error names the mistake — far more useful than three
    // black samples.
    expect(result.error).toBeNull();

    // Each instance's quad centre reads its own instance colour: the stream
    // survived stepMode "instance", the billboard put the quad at its
    // centre, and the interpolated colour reached the fragment stage.
    const [red, green, blue] = result.samples;
    expect(red[0]).toBeGreaterThan(200);
    expect(red[1]).toBeLessThan(50);
    expect(green[1]).toBeGreaterThan(200);
    expect(green[0]).toBeLessThan(50);
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(50);
    // A texel outside every quad keeps the clear colour: the quads are
    // sized by the instance stream, not stretched over the surface.
    expect(result.corner.slice(0, 3)).toEqual([0, 0, 0]);
  });
});
