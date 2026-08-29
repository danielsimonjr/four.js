/**
 * §36 `simulation: "gpu"` on a real adapter (R-31 wiring, 2026-08-29): the
 * residency claim end to end — a particle integrated **on the device** by
 * `PARTICLE_INTEGRATOR_SHADER_SOURCE` is drawn **from the same storage
 * buffer** by `PARTICLE_SHADER_SOURCE` through the three-buffer
 * `PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS`, with no readback between the
 * dispatch and the draw.
 *
 * The fake-device suites pin the plumbing (the emitter's calls, the `|gi:y`
 * pipeline variant, the three `setVertexBuffer`s); what no transcript can
 * prove is that a real WGSL front end accepts the split vertex layout — the
 * billboard module's `@location(1)` re-sourced from a 12-byte-stride
 * `STORAGE | VERTEX` buffer while locations 2–3 keep riding the interleaved
 * stream — and that the drawn quad sits where the *kernel* put it. So this
 * spec dispatches one semi-implicit Euler step (inputs exact in f32) and
 * then rasterises: the moved centre must sample each instance's own colour,
 * and the spawn position must have been left behind (clear colour), which
 * is the pixel-level statement of "the draw read the integrated buffer,
 * not the uploaded one".
 *
 * Mechanics follow the sibling specs' recorded decisions verbatim: WGSL and
 * layout tables **imported**, never retyped; a string page program (no
 * WebGPU typings pinned); a served page; self-skip without an adapter;
 * thresholds and specification-fixed values only, no goldens. Two stated
 * simplifications against the backend's own binding mode, neither touching
 * the claim: the uniform bind is static-offset (the backend's dynamic
 * offset is transcript-pinned elsewhere) and the target is opaque (the
 * §36 blend is `webgpu-particles.spec.ts`'s claim).
 *
 * **First-run measurements pending** — this spec was written at the R-31
 * wiring landing and awaits the next `test:browser` run (a sibling owns the
 * browser gate); record the first-run observations here then, per the gate
 * convention.
 */

import {
  COMPUTE_ENTRY_POINT,
  PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS,
  PARTICLE_INTEGRATOR_SHADER_SOURCE,
  PARTICLE_SHADER_SOURCE,
  PARTICLE_UNIFORM_BYTES,
  particleIntegratorWorkgroups,
} from "@four/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface size; 64 × 4 bytes meets the 256-byte `bytesPerRow` rule. */
const SIZE = 64;

/** Particles integrated and drawn. */
const COUNT = 2;

interface GpuParticleResult {
  readonly adapter: boolean;
  readonly error: string | null;
  /** RGBA at each particle's *integrated* centre. */
  readonly moved: number[][];
  /** RGBA at particle 0's spawn position — must be the clear colour. */
  readonly left: number[];
}

/**
 * The page-side program. Identity matrices throughout, so NDC is world:
 *
 * - particle 0: p (−0.5, 0, 0), v (2, 0, 0); one step at dt 0.25 under
 *   g (0, −4, 0) gives v′ (2, −1, 0), p′ (0, −0.25, 0);
 * - particle 1: p (0.5, 0.5, 0), v (0, 0, 0) → v′ (0, −1, 0),
 *   p′ (0.5, 0.25, 0).
 *
 * Every input is exact in binary f32, so the integrated centres are exact;
 * each quad (size 0.25 NDC) is sampled at its integrated centre, and the
 * spawn point of particle 0 lies 0.5 NDC from its quad — far outside it.
 */
const PAGE_SCRIPT = `async (options) => {
  const { size, integrator, entryPoint, billboard, uniformBytes, layouts, workgroups } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();
  device.pushErrorScope("validation");

  // The residency buffer: the simulation's own usage set —
  // STORAGE | VERTEX | COPY_DST | COPY_SRC (wgpu-particle-simulation.ts).
  const positions = device.createBuffer({
    size: 24,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX |
      GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(positions, 0,
    new Float32Array([-0.5, 0, 0, 0.5, 0.5, 0]));
  const storage = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };
  const velocities = storage(new Float32Array([2, 0, 0, 0, 0, 0]));
  // dt 0.25, count 2, pads, gravity (0, -4, 0, 0) — the params layout
  // writeParticleSimulationParams packs.
  const params = storage(new Float32Array([0.25, 2, 0, 0, 0, -4, 0, 0]));

  // Integrate one step — the backend's "rww" compute layout.
  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" } },
    ],
  });
  const computePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
    compute: { module: device.createShaderModule({ code: integrator }), entryPoint },
  });
  const computeGroup = device.createBindGroup({
    layout: computeLayout,
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: positions } },
      { binding: 2, resource: { buffer: velocities } },
    ],
  });

  // The CPU ramp stream — interleaved 8 floats per instance; its position
  // lanes deliberately carry the SPAWN values, because the draw must not
  // read them: sizes 0.25, colours red and green.
  const instances = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(instances, 0, new Float32Array([
    -0.5, 0, 0, 0.25, 1, 0, 0, 1,
    0.5, 0.5, 0, 0.25, 0, 1, 0, 1,
  ]));
  const corners = device.createBuffer({
    size: 72,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(corners, 0, new Float32Array([
    -0.5, -0.5, 0,  0.5, -0.5, 0,  0.5, 0.5, 0,
    -0.5, -0.5, 0,  0.5, 0.5, 0,  -0.5, 0.5, 0,
  ]));

  // Three identity matrices in the particle uniform block.
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const uniforms = device.createBuffer({
    size: uniformBytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniforms, 0,
    new Float32Array([...identity, ...identity, ...identity]));
  const drawLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX,
      buffer: { type: "uniform", minBindingSize: uniformBytes } }],
  });
  const drawPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
    vertex: {
      module: device.createShaderModule({ code: billboard }),
      entryPoint: "vertexMain",
      buffers: layouts,
    },
    fragment: {
      module: device.createShaderModule({ code: billboard }),
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });
  const drawGroup = device.createBindGroup({
    layout: drawLayout,
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  });

  const target = device.createTexture({
    size: { width: size, height: size },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: size * size * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // One submission: integrate, then draw from the very buffer the kernel
  // wrote — residency, with no readback in between.
  const encoder = device.createCommandEncoder();
  const compute = encoder.beginComputePass();
  compute.setPipeline(computePipeline);
  compute.setBindGroup(0, computeGroup);
  compute.dispatchWorkgroups(workgroups[0], workgroups[1], workgroups[2]);
  compute.end();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    }],
  });
  pass.setPipeline(drawPipeline);
  pass.setBindGroup(0, drawGroup);
  pass.setVertexBuffer(0, corners);
  pass.setVertexBuffer(1, positions);
  pass.setVertexBuffer(2, instances);
  pass.draw(6, 2);
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: size * 4 },
    { width: size, height: size },
  );
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange().slice(0));
  readback.unmap();
  const texel = (ndcX, ndcY) => {
    const x = Math.round((ndcX * 0.5 + 0.5) * size);
    const y = Math.round((0.5 - ndcY * 0.5) * size);
    const base = (y * size + x) * 4;
    return [pixels[base], pixels[base + 1], pixels[base + 2], pixels[base + 3]];
  };
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    moved: [texel(0, -0.25), texel(0.5, 0.25)],
    left: texel(-0.5, 0),
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

test.describe("GPU-resident particles, on a real adapter (§36, R-31)", () => {
  test("draws each instance at its kernel-integrated position", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<GpuParticleResult>(page, PAGE_SCRIPT, {
      size: SIZE,
      integrator: PARTICLE_INTEGRATOR_SHADER_SOURCE,
      entryPoint: COMPUTE_ENTRY_POINT,
      billboard: PARTICLE_SHADER_SOURCE,
      uniformBytes: PARTICLE_UNIFORM_BYTES,
      layouts: PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS,
      workgroups: particleIntegratorWorkgroups(COUNT),
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    // A validation error names the mistake — an illegal split layout, a
    // storage-and-vertex usage the front end refuses — with far more signal
    // than three wrong texels.
    expect(result.error).toBeNull();

    // Each instance's quad sits at the *integrated* centre, in its own
    // instance colour — position from the kernel-written storage buffer,
    // colour from the interleaved stream, joined per instance.
    expect(result.moved[0]).toEqual([255, 0, 0, 255]);
    expect(result.moved[1]).toEqual([0, 255, 0, 255]);

    // And the spawn position was left behind: the stale position lanes in
    // the interleaved stream were NOT what the draw read.
    expect(result.left).toEqual([0, 0, 0, 255]);
  });
});
