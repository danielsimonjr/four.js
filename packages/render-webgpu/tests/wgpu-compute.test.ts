/**
 * WP-R1.8's §82 compute tier, tested against the recording device: buffer
 * creation and writes, the dispatch sequence, pipeline/module caching on the
 * emitted source, the readback path, presence-is-the-capability refusals, and
 * the renderer methods' lifecycle contract. What the tape cannot prove — that
 * the kernel computes — is `tests/browser/webgpu/webgpu-compute.spec.ts`'s
 * claim against a real adapter, where the integrator's known result is read
 * back exactly.
 */

import { isFourError, type FourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  COMPUTE_ENTRY_POINT,
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
  GPU_SHADER_STAGE,
  PARTICLE_INTEGRATOR_SHADER_SOURCE,
  PARTICLE_INTEGRATOR_WORKGROUP_SIZE,
  PARTICLE_SIMULATION_PARAMS_FLOATS,
  WebgpuRenderer,
  WgpuComputeBuffer,
  WgpuComputeCache,
  createComputeBuffer,
  particleIntegratorWorkgroups,
  readComputeBufferBytes,
  writeComputeBuffer,
  writeParticleSimulationParams,
  type ComputePassDescriptor,
  type GpuDevice,
} from "../src/index.js";

/** A trivial kernel for dispatch tests — content never runs on the double. */
const DOUBLING_SHADER = `@group(0) @binding(0) var<storage, read_write> data : array<f32>;

@compute @workgroup_size(1)
fn ${COMPUTE_ENTRY_POINT}(@builtin(global_invocation_id) id : vec3<u32>) {
  data[id.x] = data[id.x] * 2.0;
}
`;

/** Catches a synchronous `FourError` and returns it. */
function thrown(body: () => unknown): FourError {
  try {
    body();
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to throw");
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

/** A device double whose compute members are stripped, WebGL-2-shaped. */
function computelessDevice(raw: GpuDevice): GpuDevice {
  const stripped: GpuDevice = {
    ...raw,
    createCommandEncoder: (descriptor) => {
      const encoder = raw.createCommandEncoder(descriptor);
      return {
        beginRenderPass: encoder.beginRenderPass.bind(encoder),
        finish: encoder.finish.bind(encoder),
      };
    },
  };
  delete stripped.createComputePipeline;
  return stripped;
}

describe("createComputeBuffer (§82, §83)", () => {
  it("allocates storage | copy-src | copy-dst at the stated size", () => {
    const gpu = createRecordingGpu();
    const buffer = createComputeBuffer(gpu.device as GpuDevice, { size: 64 });

    expect(buffer.byteLength).toBe(64);
    expect(buffer.disposed).toBe(false);
    expect(gpu.callsOf("device.createBuffer")[0]?.args[0]).toEqual({
      label: "four:compute-buffer",
      size: 64,
      usage:
        GPU_BUFFER_USAGE.STORAGE |
        GPU_BUFFER_USAGE.COPY_DST |
        GPU_BUFFER_USAGE.COPY_SRC,
    });
    expect(gpu.countOf("queue.writeBuffer")).toBe(0);
  });

  it("uploads initial contents and takes their byteLength as the size", () => {
    const gpu = createRecordingGpu();
    const data = new Float32Array([1, 2, 3]);
    const buffer = createComputeBuffer(gpu.device as GpuDevice, {
      label: "four:test-positions",
      data,
    });

    expect(buffer.byteLength).toBe(12);
    expect(
      (gpu.callsOf("device.createBuffer")[0]?.args[0] as { label: string })
        .label,
    ).toBe("four:test-positions");
    expect(gpu.callsOf("queue.writeBuffer")[0]?.args[2]).toEqual([1, 2, 3]);
  });

  it("refuses neither-size-nor-data, and both at once", () => {
    const device = createRecordingGpu().device as GpuDevice;
    expect(thrown(() => createComputeBuffer(device, {})).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(
      thrown(() =>
        createComputeBuffer(device, { size: 16, data: new Float32Array(4) }),
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("refuses a size that is not a positive multiple of 4", () => {
    const device = createRecordingGpu().device as GpuDevice;
    for (const size of [3.5, 0, -4, 6]) {
      expect(thrown(() => createComputeBuffer(device, { size })).code).toBe(
        "INVALID_APPLICATION_STATE",
      );
    }
    // The same granularity guards the data form.
    expect(
      thrown(() => createComputeBuffer(device, { data: new Uint8Array(3) }))
        .code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("dispose destroys the allocation once, idempotently (§83)", () => {
    const gpu = createRecordingGpu();
    const buffer = createComputeBuffer(gpu.device as GpuDevice, { size: 16 });
    gpu.reset();

    buffer.dispose();
    buffer.dispose();

    expect(buffer.disposed).toBe(true);
    expect(gpu.countOf("buffer.destroy")).toBe(1);
  });
});

describe("writeComputeBuffer (§82)", () => {
  it("writes at the stated offset, defaulting it to 0", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const buffer = createComputeBuffer(device, { size: 32 });
    gpu.reset();

    writeComputeBuffer(device, buffer, new Float32Array([5]));
    writeComputeBuffer(device, buffer, new Float32Array([6]), 16);

    const writes = gpu.callsOf("queue.writeBuffer");
    expect(writes[0]?.args[1]).toBe(0);
    expect(writes[0]?.args[2]).toEqual([5]);
    expect(writes[1]?.args[1]).toBe(16);
  });

  it("refuses a disposed buffer, and a misaligned or overflowing range", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const buffer = createComputeBuffer(device, { size: 16 });
    const data = new Float32Array(1);

    for (const byteOffset of [0.5, -4, 2, 16]) {
      expect(
        thrown(() => writeComputeBuffer(device, buffer, data, byteOffset)).code,
      ).toBe("INVALID_APPLICATION_STATE");
    }
    buffer.dispose();
    expect(thrown(() => writeComputeBuffer(device, buffer, data)).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });
});

describe("WgpuComputeCache.dispatch (§82)", () => {
  it("records pipeline, bind group and dispatch in the §82 sequence", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const cache = new WgpuComputeCache(device);
    const params = createComputeBuffer(device, { size: 32 });
    const data = createComputeBuffer(device, { size: 64 });
    gpu.reset();

    const dispatched = cache.dispatch({
      label: "integrate",
      shader: DOUBLING_SHADER,
      workgroups: [4, 1, 1],
      bindings: [{ buffer: params, access: "read-only" }, data],
    });

    expect(dispatched).toBe(true);
    // The layout: one COMPUTE-visible storage entry per binding, read-only
    // where the descriptor says so.
    expect(gpu.callsOf("device.createBindGroupLayout")[0]?.args[0]).toEqual({
      label: "four:compute:rw",
      entries: [
        {
          binding: 0,
          visibility: GPU_SHADER_STAGE.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPU_SHADER_STAGE.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });
    expect(
      (
        gpu.callsOf("device.createShaderModule")[0]?.args[0] as {
          code: string;
        }
      ).code,
    ).toBe(DOUBLING_SHADER);
    expect(
      (
        gpu.callsOf("device.createComputePipeline")[0]?.args[0] as {
          compute: { entryPoint: string };
        }
      ).compute.entryPoint,
    ).toBe(COMPUTE_ENTRY_POINT);
    // The bind group binds the buffers whole, in array order.
    const group = gpu.callsOf("device.createBindGroup")[0]?.args[0] as {
      entries: { binding: number; resource: { size: number } }[];
    };
    expect(group.entries.map((entry) => entry.binding)).toEqual([0, 1]);
    expect(group.entries.map((entry) => entry.resource.size)).toEqual([32, 64]);
    // The recorded pass, in order, then one submit.
    const names = gpu.calls.map((call) => call.name);
    expect(names.filter((name) => name.startsWith("computePass."))).toEqual([
      "computePass.setPipeline",
      "computePass.setBindGroup",
      "computePass.dispatchWorkgroups",
      "computePass.end",
    ]);
    expect(gpu.callsOf("computePass.dispatchWorkgroups")[0]?.args).toEqual([
      4, 1, 1,
    ]);
    expect(gpu.countOf("queue.submit")).toBe(1);
  });

  it("defaults an object binding without an access mode to read-write", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const cache = new WgpuComputeCache(device);
    const data = createComputeBuffer(device, { size: 16 });
    gpu.reset();

    cache.dispatch({
      shader: DOUBLING_SHADER,
      workgroups: [1, 1, 1],
      bindings: [{ buffer: data }],
    });

    expect(
      (
        gpu.callsOf("device.createBindGroupLayout")[0]?.args[0] as {
          entries: { buffer: { type: string } }[];
        }
      ).entries[0]?.buffer.type,
    ).toBe("storage");
  });

  it("caches the pipeline on (pattern, entry point, source)", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const cache = new WgpuComputeCache(device);
    const data = createComputeBuffer(device, { size: 16 });
    const pass: ComputePassDescriptor = {
      shader: DOUBLING_SHADER,
      workgroups: [1, 1, 1],
      bindings: [data],
    };
    cache.dispatch(pass);
    gpu.reset();

    // Same source, same pattern: one pipeline, one module, one layout.
    cache.dispatch(pass);
    expect(gpu.countOf("device.createComputePipeline")).toBe(0);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
    expect(gpu.countOf("device.createBindGroupLayout")).toBe(0);
    // A different entry point over the same source: new pipeline, same module.
    cache.dispatch({ ...pass, entryPoint: "otherMain" });
    expect(gpu.countOf("device.createComputePipeline")).toBe(1);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
    expect(cache.pipelineCount).toBe(2);
    expect(cache.moduleCount).toBe(1);
  });

  it("dispatches a binding-less kernel with no bind group at all", () => {
    const gpu = createRecordingGpu();
    const cache = new WgpuComputeCache(gpu.device as GpuDevice);
    gpu.reset();

    cache.dispatch({
      shader: DOUBLING_SHADER,
      workgroups: [0, 1, 1],
      bindings: [],
    });

    expect(gpu.countOf("device.createBindGroupLayout")).toBe(0);
    expect(gpu.countOf("device.createBindGroup")).toBe(0);
    expect(gpu.countOf("computePass.setBindGroup")).toBe(0);
    expect(
      (
        gpu.callsOf("device.createPipelineLayout")[0]?.args[0] as {
          bindGroupLayouts: unknown[];
        }
      ).bindGroupLayouts,
    ).toEqual([]);
    // A zero workgroup count is WebGPU's defined no-op dispatch, not an error.
    expect(gpu.callsOf("computePass.dispatchWorkgroups")[0]?.args).toEqual([
      0, 1, 1,
    ]);
  });

  it("refuses non-integer or negative workgroup counts, and disposed buffers", () => {
    const device = createRecordingGpu().device as GpuDevice;
    const cache = new WgpuComputeCache(device);
    const data = createComputeBuffer(device, { size: 16 });

    expect(
      thrown(() =>
        cache.dispatch({
          shader: DOUBLING_SHADER,
          workgroups: [1.5, 1, 1],
          bindings: [],
        }),
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");
    expect(
      thrown(() =>
        cache.dispatch({
          shader: DOUBLING_SHADER,
          workgroups: [1, -1, 1],
          bindings: [],
        }),
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");
    data.dispose();
    expect(
      thrown(() =>
        cache.dispatch({
          shader: DOUBLING_SHADER,
          workgroups: [1, 1, 1],
          bindings: [data],
        }),
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("answers false on a device without the compute entry points", () => {
    const gpu = createRecordingGpu();
    const raw = gpu.device as GpuDevice;
    const cache = new WgpuComputeCache(computelessDevice(raw));

    expect(
      cache.dispatch({
        shader: DOUBLING_SHADER,
        workgroups: [1, 1, 1],
        bindings: [],
      }),
    ).toBe(false);

    // …and separately on an encoder that cannot open a compute pass.
    const encoderless: GpuDevice = {
      ...raw,
      createCommandEncoder: (descriptor) => {
        const encoder = raw.createCommandEncoder(descriptor);
        return {
          beginRenderPass: encoder.beginRenderPass.bind(encoder),
          finish: encoder.finish.bind(encoder),
        };
      },
    };
    const halfCache = new WgpuComputeCache(encoderless);
    expect(
      halfCache.dispatch({
        shader: DOUBLING_SHADER,
        workgroups: [1, 1, 1],
        bindings: [],
      }),
    ).toBe(false);
  });

  it("dispose drops the caches idempotently and refuses later dispatches", () => {
    const device = createRecordingGpu().device as GpuDevice;
    const cache = new WgpuComputeCache(device);
    cache.dispatch({
      shader: DOUBLING_SHADER,
      workgroups: [1, 1, 1],
      bindings: [],
    });

    cache.dispose();
    cache.dispose();

    expect(cache.disposed).toBe(true);
    expect(cache.pipelineCount).toBe(0);
    expect(cache.moduleCount).toBe(0);
    expect(
      thrown(() =>
        cache.dispatch({
          shader: DOUBLING_SHADER,
          workgroups: [1, 1, 1],
          bindings: [],
        }),
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });
});

describe("readComputeBufferBytes (§82)", () => {
  it("copies into a mappable staging buffer and hands the bytes back", async () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const buffer = createComputeBuffer(device, { size: 16 });
    gpu.reset();

    const bytes = await readComputeBufferBytes(device, buffer);

    expect(bytes).not.toBeNull();
    // The double's mapped range is the deterministic i % 251 pattern.
    expect(Array.from(new Uint8Array(bytes as ArrayBuffer))).toEqual(
      Array.from({ length: 16 }, (_, index) => index % 251),
    );
    expect(gpu.callsOf("device.createBuffer")[0]?.args[0]).toEqual({
      label: "four:compute-readback",
      size: 16,
      usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
    });
    const copy = gpu.callsOf("encoder.copyBufferToBuffer")[0];
    expect(copy?.args[1]).toBe(0);
    expect(copy?.args[3]).toBe(0);
    expect(copy?.args[4]).toBe(16);
    const names = gpu.calls.map((call) => call.name);
    expect(names.indexOf("queue.submit")).toBeLessThan(
      names.indexOf("buffer.mapAsync"),
    );
    expect(gpu.callsOf("buffer.mapAsync")[0]?.args[1]).toBe(GPU_MAP_MODE.READ);
    expect(names.indexOf("buffer.unmap")).toBeLessThan(
      names.indexOf("buffer.destroy"),
    );
  });

  it("throws for a disposed buffer, before anything is recorded (§83)", async () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const buffer = createComputeBuffer(device, { size: 16 });
    buffer.dispose();
    gpu.reset();

    expect((await rejection(readComputeBufferBytes(device, buffer))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(gpu.calls).toHaveLength(0);
  });

  it("resolves null on an encoder without copyBufferToBuffer", async () => {
    const gpu = createRecordingGpu();
    const raw = gpu.device as GpuDevice;
    const buffer = createComputeBuffer(raw, { size: 16 });
    gpu.reset();

    expect(
      await readComputeBufferBytes(computelessDevice(raw), buffer),
    ).toBeNull();
    // Nothing was allocated for a copy that cannot be recorded.
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("resolves null — and destroys the staging buffer — when it cannot map", async () => {
    const gpu = createRecordingGpu();
    const raw = gpu.device as GpuDevice;
    const buffer = createComputeBuffer(raw, { size: 16 });
    const stripped: GpuDevice = {
      ...raw,
      createBuffer: (descriptor) => {
        const created = raw.createBuffer(descriptor);
        return { destroy: () => created.destroy() };
      },
    };
    gpu.reset();

    expect(await readComputeBufferBytes(stripped, buffer)).toBeNull();
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    expect(gpu.countOf("encoder.copyBufferToBuffer")).toBe(0);
  });
});

describe("the §36 integrator kernel (R-31's GPU-simulation half)", () => {
  it("packs the params block whole — every lane written (§33)", () => {
    const out = new Float32Array(PARTICLE_SIMULATION_PARAMS_FLOATS).fill(9);
    const result = writeParticleSimulationParams(out, 0.5, 3, 0, -10, 2);

    expect(result).toBe(out);
    expect(Array.from(out)).toEqual([0.5, 3, 0, 0, 0, -10, 2, 0]);
  });

  it("covers count particles with ceil(count / workgroup) groups along x", () => {
    expect(particleIntegratorWorkgroups(0)).toEqual([0, 1, 1]);
    expect(particleIntegratorWorkgroups(1)).toEqual([1, 1, 1]);
    expect(
      particleIntegratorWorkgroups(PARTICLE_INTEGRATOR_WORKGROUP_SIZE),
    ).toEqual([1, 1, 1]);
    expect(
      particleIntegratorWorkgroups(PARTICLE_INTEGRATOR_WORKGROUP_SIZE + 1),
    ).toEqual([2, 1, 1]);
  });

  it("declares the three bindings and the semi-implicit Euler order", () => {
    expect(PARTICLE_INTEGRATOR_SHADER_SOURCE).toContain(
      "@group(0) @binding(0) var<storage, read> params",
    );
    expect(PARTICLE_INTEGRATOR_SHADER_SOURCE).toContain(
      "@group(0) @binding(1) var<storage, read_write> positions",
    );
    expect(PARTICLE_INTEGRATOR_SHADER_SOURCE).toContain(
      "@group(0) @binding(2) var<storage, read_write> velocities",
    );
    expect(PARTICLE_INTEGRATOR_SHADER_SOURCE).toContain(
      `@workgroup_size(${String(PARTICLE_INTEGRATOR_WORKGROUP_SIZE)})`,
    );
    expect(PARTICLE_INTEGRATOR_SHADER_SOURCE).toContain(
      `fn ${COMPUTE_ENTRY_POINT}(`,
    );
    // v += g·dt lands in the velocity lanes before p += v·dt reads them —
    // @four/particles' documented closed form, per lane.
    expect(PARTICLE_INTEGRATOR_SHADER_SOURCE).toContain(
      "let vx = velocities[base] + params.gravity.x * dt;",
    );
    expect(PARTICLE_INTEGRATOR_SHADER_SOURCE).toContain(
      "positions[base] = positions[base] + vx * dt;",
    );
  });
});

describe("WebgpuRenderer's §82 methods (WP-R1.8)", () => {
  async function initialized(): Promise<{
    gpu: ReturnType<typeof createRecordingGpu>;
    renderer: WebgpuRenderer;
  }> {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    gpu.reset();
    return { gpu, renderer };
  }

  it("creates, writes, dispatches against and reads back a storage buffer", async () => {
    const { gpu, renderer } = await initialized();

    const buffer = renderer.createComputeBuffer({
      data: new Float32Array([1, 2]),
    });
    expect(buffer).toBeInstanceOf(WgpuComputeBuffer);
    renderer.writeComputeBuffer(buffer, new Float32Array([7]), 4);
    renderer.compute({
      shader: DOUBLING_SHADER,
      workgroups: [1, 1, 1],
      bindings: [buffer],
    });
    const bytes = await renderer.readComputeBuffer(buffer);

    expect(bytes.byteLength).toBe(8);
    expect(gpu.countOf("device.createComputePipeline")).toBe(1);
    expect(gpu.countOf("computePass.dispatchWorkgroups")).toBe(1);
    // A second dispatch of the same kernel reuses the cached pipeline.
    renderer.compute({
      shader: DOUBLING_SHADER,
      workgroups: [2, 1, 1],
      bindings: [buffer],
    });
    expect(gpu.countOf("device.createComputePipeline")).toBe(1);
    buffer.dispose();
    renderer.dispose();
  });

  it("throws INVALID_APPLICATION_STATE before initialize and after dispose", async () => {
    const uninitialized = new WebgpuRenderer();
    expect(
      thrown(() => uninitialized.createComputeBuffer({ size: 16 })).code,
    ).toBe("INVALID_APPLICATION_STATE");

    const { renderer } = await initialized();
    const buffer = renderer.createComputeBuffer({ size: 16 });
    renderer.dispose();
    expect(
      thrown(() =>
        renderer.compute({
          shader: DOUBLING_SHADER,
          workgroups: [1, 1, 1],
          bindings: [buffer],
        }),
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");
    expect(
      thrown(() => renderer.writeComputeBuffer(buffer, new Float32Array(1)))
        .code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("throws DEVICE_LOST while the device is lost (§61, §89)", async () => {
    const { gpu, renderer } = await initialized();
    const buffer = renderer.createComputeBuffer({ size: 16 });
    // A live compute cache before the loss, so the loss handler's drop of
    // §82's caches is exercised, not just its null-safe path.
    renderer.compute({
      shader: DOUBLING_SHADER,
      workgroups: [1, 1, 1],
      bindings: [buffer],
    });
    gpu.loseDevice();
    await Promise.resolve();

    expect(
      thrown(() =>
        renderer.compute({
          shader: DOUBLING_SHADER,
          workgroups: [1, 1, 1],
          bindings: [buffer],
        }),
      ).code,
    ).toBe("DEVICE_LOST");
    expect((await rejection(renderer.readComputeBuffer(buffer))).code).toBe(
      "DEVICE_LOST",
    );
    renderer.dispose();
  });

  it("throws UNSUPPORTED_GPU_FEATURE on a device surface without compute", async () => {
    const base = createRecordingGpu();
    const stripped = computelessDevice(base.device as GpuDevice);
    const renderer = new WebgpuRenderer();
    await withHostGpu(
      {
        requestAdapter: () =>
          Promise.resolve({
            requestDevice: () => Promise.resolve(stripped),
          }),
      },
      async () => {
        await renderer.initialize({ canvas: base.canvas });
      },
    );
    const buffer = renderer.createComputeBuffer({ size: 16 });

    expect(
      thrown(() =>
        renderer.compute({
          shader: DOUBLING_SHADER,
          workgroups: [1, 1, 1],
          bindings: [buffer],
        }),
      ).code,
    ).toBe("UNSUPPORTED_GPU_FEATURE");
    expect((await rejection(renderer.readComputeBuffer(buffer))).code).toBe(
      "UNSUPPORTED_GPU_FEATURE",
    );
    renderer.dispose();
  });
});
