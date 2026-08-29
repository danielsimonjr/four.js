/**
 * §82's GPU compute on the WebGPU backend (WP-R1.8) — compute pipelines, bind
 * groups over storage buffers, dispatch, and buffer readback, plus the §36
 * GPU particle **integrator** kernel that makes gap row `R-31` movable.
 *
 * ## Where §82's `ComputePass` lives, for now — the Q3 seam, stated
 *
 * The R-1 plan's owner question Q3 recommends the descriptor in
 * `@four/render` with `Renderer.compute?()` as the optional-member-is-the-
 * capability seam (the `statistics`/`renderEffect` pattern's third instance).
 * This packet lands the descriptor **here**, in the only backend that can run
 * it, because `packages/render` is inside RFC 0004's concurrent scope and a
 * shared-file edit there would collide with an in-flight sibling. The
 * promotion is a **one-re-export follow-up**: `@four/render` gains the
 * descriptor type and the optional `Renderer.compute?()` member, this module
 * re-exports the type from there, and no call site moves — the capability-
 * token identity precedent. Nothing in the shape below assumes this package:
 * {@link ComputePassDescriptor} names only WGSL, workgroup counts, and buffer
 * handles.
 *
 * §82's spec example spells `bindings` as a *named map*
 * (`{ positions, velocities, parameters }`); the backend seam takes an
 * **ordered array**, where index *i* is `@group(0) @binding(i)` — order is
 * what a bind-group layout actually consumes, and the named-map sugar is the
 * umbrella-level `Four.ComputePass`'s to add when the Q3 promotion lands.
 *
 * ## Presence is the capability (§62, R-30b)
 *
 * WebGL 2 has no compute, and a device double built before this packet has no
 * compute members. Every compute entry point on the structural device surface
 * is therefore **optional** (`webgpu-device.ts`), and the helpers here answer
 * `null`/`false` for a surface that lacks them — `WebgpuRenderer` turns that
 * into `UNSUPPORTED_GPU_FEATURE`, exactly as `readPixels` does. §82's own
 * closing sentence — *"basic graphics and physics functionality must not
 * require compute support"* — is honoured structurally: nothing in the frame
 * path calls anything in this module.
 *
 * ## Pipelines are cached on the emitted source, lazily
 *
 * A compute pipeline is immutable, like a render pipeline, so
 * {@link WgpuComputeCache} keys pipelines on the tuple that gives them
 * identity — the binding access pattern (it selects the layout), the entry
 * point, and the WGSL source itself. Keying on the *source* is the RFC 0001
 * program-cache decision one stage over: two descriptors carrying the same
 * string dispatch through one pipeline, and a shader module is compiled once
 * however many entry points or binding patterns use it. `createShaderModule`
 * and `createComputePipeline` do not throw for a shader that fails to
 * compile — the failure surfaces through the device's error scopes and the
 * dispatch does nothing — which is the render-pipeline cache's recorded
 * reading of WebGPU's error model, unchanged.
 *
 * ## The §36 integrator (R-31's GPU-simulation half)
 *
 * {@link PARTICLE_INTEGRATOR_SHADER_SOURCE} is the emitter's semi-implicit
 * Euler step (`v += g·dt`, then `p += v·dt` — `@four/particles`' documented
 * closed form) over flat `array<f32>` position/velocity lanes in the pool's
 * own x,y,z layout, under a constant gravity. It is the *integrator* the
 * WP-R1.8 packet scopes and nothing more: §27's force fields and §36's
 * `collisions: "depth-buffer"` are each their own follow-up packet, and
 * `@four/particles`' `simulation: "gpu"` option widens only in the change
 * that wires this kernel to the emitter (the recorded WP-9.1 rule: an option
 * that silently does nothing is worse than one that does not exist yet).
 * The `count` lane travels as **f32** — the light block's precedent: the
 * params pack through one `Float32Array`, and f32 is exact far beyond §112's
 * 100 000-particle budget.
 */

import { FourError } from "@four/core";

import {
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuComputePipeline,
  type GpuDevice,
  type GpuPipelineLayout,
  type GpuShaderModule,
  type GpuBuffer,
} from "./webgpu-device.js";

/** Entry point name of every compute stage this backend ships. */
export const COMPUTE_ENTRY_POINT = "computeMain";

/**
 * How a dispatch binds one storage buffer: writable, or read-only.
 *
 * `"read-write"` is WGSL's `var<storage, read_write>`; `"read-only"` is
 * `var<storage, read>`. The access mode is **layout identity** — WebGPU
 * validates the shader's declared access against the bind-group layout's
 * buffer type — which is why it is part of the descriptor rather than assumed.
 */
export type ComputeBindingAccess = "read-write" | "read-only";

/** One storage-buffer binding of a {@link ComputePassDescriptor}. */
export interface ComputeBinding {
  /** The buffer to bind. */
  readonly buffer: WgpuComputeBuffer;
  /** The shader's declared access; `"read-write"` when omitted. */
  readonly access?: ComputeBindingAccess;
}

/**
 * §82's `ComputePass`, as this backend runs it: a WGSL kernel, the workgroup
 * grid to dispatch, and the storage buffers it reads and writes — bound at
 * `@group(0)`, `@binding(i)` for array index *i* (module header on the
 * ordered-array shape).
 */
export interface ComputePassDescriptor {
  /** Diagnostic name, echoed on the pass and pipeline labels. */
  readonly label?: string;
  /** The compute shader, as WGSL source. */
  readonly shader: string;
  /** The kernel's entry point; {@link COMPUTE_ENTRY_POINT} when omitted. */
  readonly entryPoint?: string;
  /**
   * Workgroup counts along x, y, z — §82's `workgroups: [1024, 1, 1]`.
   * Non-negative integers; a zero count is WebGPU's defined no-op dispatch.
   */
  readonly workgroups: readonly [number, number, number];
  /** The storage buffers, in binding order. A bare buffer binds read-write. */
  readonly bindings: readonly (WgpuComputeBuffer | ComputeBinding)[];
}

/** Options for {@link createComputeBuffer}: a byte size, or initial contents. */
export interface ComputeBufferOptions {
  /** Diagnostic name. */
  readonly label?: string;
  /**
   * Allocation size in bytes — a positive multiple of 4 (`writeBuffer`'s own
   * rule, §62). Exactly one of `size` and `data` must be given.
   */
  readonly size?: number;
  /** Initial contents; the allocation takes the view's `byteLength`. */
  readonly data?: ArrayBufferView;
}

/**
 * A storage buffer the application owns (§82, §83) — created by
 * `WebgpuRenderer.createComputeBuffer`, disposed by whoever created it.
 *
 * Allocated `STORAGE | COPY_DST | COPY_SRC`, so every compute buffer can be
 * written (`writeComputeBuffer`), bound to a kernel, and read back
 * (`readComputeBufferBytes`) — three usage bits against a per-usage-tier
 * split that would complicate §82's tiny surface for no measured saving.
 */
export class WgpuComputeBuffer {
  /**
   * The device allocation — a backend seam, not an application surface: the
   * dispatch and readback paths read it, and nothing else should.
   */
  readonly buffer: GpuBuffer;

  /** Allocation size in bytes. */
  readonly byteLength: number;

  #disposed = false;

  /** Internal — obtain instances through `WebgpuRenderer.createComputeBuffer`. */
  constructor(buffer: GpuBuffer, byteLength: number) {
    this.buffer = buffer;
    this.byteLength = byteLength;
  }

  /** Whether {@link WgpuComputeBuffer.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Releases the allocation (§83). Idempotent — and safe after a device loss:
   * WebGPU's `destroy()` on an invalidated buffer is a defined no-op, unlike
   * GL's delete-on-a-lost-context.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.buffer.destroy();
  }
}

/** Throws `INVALID_APPLICATION_STATE` for a descriptor this module refuses. */
function refuse(message: string, context: Record<string, unknown>): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/**
 * Allocates one storage buffer (§82), uploading `data` when given.
 *
 * Throws a `FourError` carrying `INVALID_APPLICATION_STATE` for an option
 * record naming both `size` and `data`, neither, a size that is not a
 * positive multiple of 4, or contents whose `byteLength` is not a multiple
 * of 4 — `writeBuffer`'s and the storage-address-space's shared granularity,
 * surfaced at creation rather than as a device-side validation error later.
 */
export function createComputeBuffer(
  device: GpuDevice,
  options: ComputeBufferOptions,
): WgpuComputeBuffer {
  const data = options.data;
  const size = data === undefined ? options.size : data.byteLength;
  if (
    size === undefined ||
    (data !== undefined && options.size !== undefined)
  ) {
    refuse(
      "createComputeBuffer takes exactly one of `size` (bytes) and `data` " +
        "(initial contents) (§82).",
      { size: options.size, hasData: data !== undefined },
    );
  }
  if (!Number.isInteger(size) || size <= 0 || size % 4 !== 0) {
    refuse(
      "A compute buffer's size must be a positive multiple of 4 bytes (§62).",
      { size },
    );
  }
  const buffer = device.createBuffer({
    label: options.label ?? "four:compute-buffer",
    size,
    usage:
      GPU_BUFFER_USAGE.STORAGE |
      GPU_BUFFER_USAGE.COPY_DST |
      GPU_BUFFER_USAGE.COPY_SRC,
  });
  if (data !== undefined) {
    device.queue.writeBuffer(buffer, 0, data);
  }
  return new WgpuComputeBuffer(buffer, size);
}

/**
 * Uploads `data` into `buffer` at `byteOffset` (§82) — `queue.writeBuffer`,
 * with the range validated here so a mistake is a named `FourError` rather
 * than a device-side validation message: the buffer must be live (§83), the
 * offset a non-negative multiple of 4, and the written range inside the
 * allocation.
 */
export function writeComputeBuffer(
  device: GpuDevice,
  buffer: WgpuComputeBuffer,
  data: ArrayBufferView,
  byteOffset = 0,
): void {
  if (buffer.disposed) {
    refuse("writeComputeBuffer was given a disposed buffer (§83).", {
      byteLength: buffer.byteLength,
    });
  }
  if (
    !Number.isInteger(byteOffset) ||
    byteOffset < 0 ||
    byteOffset % 4 !== 0 ||
    byteOffset + data.byteLength > buffer.byteLength
  ) {
    refuse(
      "writeComputeBuffer's range must sit inside the allocation at a " +
        "4-byte-aligned offset (§62).",
      {
        byteOffset,
        dataBytes: data.byteLength,
        bufferBytes: buffer.byteLength,
      },
    );
  }
  device.queue.writeBuffer(buffer.buffer, byteOffset, data);
}

/**
 * Copies `buffer`'s contents into a tightly packed `ArrayBuffer` —
 * `copyBufferToBuffer` + `mapAsync`, `readTexturePixels`' shape for a buffer
 * instead of a texture, with the same discipline: the staging buffer is
 * created per call and destroyed before resolving.
 *
 * Resolves `null` when the device surface lacks the entry points
 * (`copyBufferToBuffer`, the mapping trio — presence is the capability); the
 * caller turns that into `UNSUPPORTED_GPU_FEATURE`. Throws
 * `INVALID_APPLICATION_STATE` for a disposed buffer (§83) — a validation
 * fact, not a capability one.
 */
export async function readComputeBufferBytes(
  device: GpuDevice,
  buffer: WgpuComputeBuffer,
): Promise<ArrayBuffer | null> {
  if (buffer.disposed) {
    refuse("readComputeBufferBytes was given a disposed buffer (§83).", {
      byteLength: buffer.byteLength,
    });
  }
  const encoder = device.createCommandEncoder({
    label: "four:compute-readback",
  });
  if (encoder.copyBufferToBuffer === undefined) {
    return null;
  }
  const staging = device.createBuffer({
    label: "four:compute-readback",
    size: buffer.byteLength,
    usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
  });
  if (
    staging.mapAsync === undefined ||
    staging.getMappedRange === undefined ||
    staging.unmap === undefined
  ) {
    staging.destroy();
    return null;
  }

  encoder.copyBufferToBuffer(buffer.buffer, 0, staging, 0, buffer.byteLength);
  device.queue.submit([encoder.finish()]);

  try {
    await staging.mapAsync(GPU_MAP_MODE.READ);
    const bytes = new Uint8Array(staging.getMappedRange()).slice();
    staging.unmap();
    return bytes.buffer;
  } finally {
    staging.destroy();
  }
}

/** A binding normalized to its buffer-and-access pair. */
interface ResolvedBinding {
  readonly buffer: WgpuComputeBuffer;
  readonly access: ComputeBindingAccess;
}

/**
 * Per-device store of compute pipelines, layouts and modules (§82) — the
 * compute half of `WgpuPipelineCache`, kept separate so the frame path never
 * links it: the renderer creates one lazily on the first `compute()` call
 * (the lazy-subsystem precedent), and drops it whole on device loss and
 * disposal (nothing here has a `destroy()`; dropping the maps is the
 * release, the render cache's §83 reading).
 */
export class WgpuComputeCache {
  readonly #device: GpuDevice;

  /** Bind-group layouts by access pattern (e.g. `"rw"`, `"rww"`). */
  readonly #layouts = new Map<string, GpuBindGroupLayout>();

  /** Pipeline layouts by the same access pattern. */
  readonly #pipelineLayouts = new Map<string, GpuPipelineLayout>();

  /** Modules by WGSL source — one compile per kernel string. */
  readonly #modules = new Map<string, GpuShaderModule>();

  /** Pipelines by `pattern|entryPoint|source`. */
  readonly #pipelines = new Map<string, GpuComputePipeline>();

  #disposed = false;

  constructor(device: GpuDevice) {
    this.#device = device;
  }

  /** How many distinct compute pipelines have been created. Diagnostics and tests. */
  get pipelineCount(): number {
    return this.#pipelines.size;
  }

  /** How many WGSL modules have been compiled. Diagnostics and tests. */
  get moduleCount(): number {
    return this.#modules.size;
  }

  /** Whether {@link WgpuComputeCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Records and submits one §82 dispatch.
   *
   * Returns `false` — having recorded nothing — when the device surface lacks
   * the compute entry points (`createComputePipeline`, `beginComputePass`);
   * the caller turns that into `UNSUPPORTED_GPU_FEATURE`. Throws
   * `INVALID_APPLICATION_STATE` for a descriptor this module refuses: a
   * workgroup count that is not a non-negative integer, a disposed buffer in
   * `bindings`, or a call on a disposed cache.
   */
  dispatch(pass: ComputePassDescriptor): boolean {
    if (this.#disposed) {
      refuse(
        "compute() was called after the renderer released its device (§83).",
        {
          label: pass.label,
        },
      );
    }
    const device = this.#device;
    if (device.createComputePipeline === undefined) {
      return false;
    }
    for (const count of pass.workgroups) {
      if (!Number.isInteger(count) || count < 0) {
        refuse(
          "ComputePass.workgroups must be three non-negative integers (§82).",
          { workgroups: pass.workgroups },
        );
      }
    }
    const bindings: ResolvedBinding[] = pass.bindings.map((entry) =>
      entry instanceof WgpuComputeBuffer
        ? { buffer: entry, access: "read-write" }
        : { buffer: entry.buffer, access: entry.access ?? "read-write" },
    );
    for (const binding of bindings) {
      if (binding.buffer.disposed) {
        refuse("ComputePass.bindings names a disposed buffer (§83).", {
          label: pass.label,
        });
      }
    }

    const pattern = bindings
      .map((binding) => (binding.access === "read-only" ? "r" : "w"))
      .join("");
    const bindGroupLayout = this.#acquireBindGroupLayout(pattern);
    const pipeline = this.#acquirePipeline(
      device.createComputePipeline.bind(device),
      pattern,
      pass.entryPoint ?? COMPUTE_ENTRY_POINT,
      pass.shader,
    );

    const encoder = device.createCommandEncoder({ label: "four:compute" });
    if (encoder.beginComputePass === undefined) {
      return false;
    }
    const computePass = encoder.beginComputePass({
      label: `four:compute:${pass.label ?? "pass"}`,
    });
    computePass.setPipeline(pipeline);
    // `null` exactly for a binding-less kernel — the layout and the bindings
    // array empty out together, so one comparison serves both.
    if (bindGroupLayout !== null) {
      computePass.setBindGroup(
        0,
        device.createBindGroup({
          label: `four:compute:${pass.label ?? "pass"}`,
          layout: bindGroupLayout,
          entries: bindings.map((binding, index) => ({
            binding: index,
            resource: {
              buffer: binding.buffer.buffer,
              offset: 0,
              size: binding.buffer.byteLength,
            },
          })),
        }),
      );
    }
    computePass.dispatchWorkgroups(
      pass.workgroups[0],
      pass.workgroups[1],
      pass.workgroups[2],
    );
    computePass.end();
    device.queue.submit([encoder.finish()]);
    return true;
  }

  /**
   * Drops every pipeline, layout and module. Nothing is destroyed — WebGPU
   * compute pipelines and modules have no `destroy()` (§83, the render
   * cache's rule). Idempotent.
   */
  dispose(): void {
    this.#disposed = true;
    this.#layouts.clear();
    this.#pipelineLayouts.clear();
    this.#modules.clear();
    this.#pipelines.clear();
  }

  /** The pipeline for (`pattern`, `entryPoint`, `source`), created on first use. */
  #acquirePipeline(
    createComputePipeline: NonNullable<GpuDevice["createComputePipeline"]>,
    pattern: string,
    entryPoint: string,
    source: string,
  ): GpuComputePipeline {
    const key = `${pattern}|${entryPoint}|${source}`;
    const existing = this.#pipelines.get(key);
    if (existing !== undefined) {
      return existing;
    }
    let module = this.#modules.get(source);
    if (module === undefined) {
      module = this.#device.createShaderModule({
        label: "four:compute",
        code: source,
      });
      this.#modules.set(source, module);
    }
    const pipeline = createComputePipeline({
      label: `four:compute:${entryPoint}`,
      layout: this.#acquirePipelineLayout(pattern),
      compute: { module, entryPoint },
    });
    this.#pipelines.set(key, pipeline);
    return pipeline;
  }

  /**
   * The bind-group layout for `pattern`, created on first use — one
   * `COMPUTE`-visible storage entry per binding, read-only where the pattern
   * says `r` — or `null` for the empty pattern: a binding-less kernel's
   * pipeline layout carries **no** bind-group layouts at all, so nothing
   * requires a group the dispatch never sets.
   */
  #acquireBindGroupLayout(pattern: string): GpuBindGroupLayout | null {
    if (pattern.length === 0) {
      return null;
    }
    const existing = this.#layouts.get(pattern);
    if (existing !== undefined) {
      return existing;
    }
    const layout = this.#device.createBindGroupLayout({
      label: `four:compute:${pattern}`,
      entries: [...pattern].map((access, index) => ({
        binding: index,
        visibility: GPU_SHADER_STAGE.COMPUTE,
        buffer: {
          type: access === "r" ? "read-only-storage" : "storage",
        },
      })),
    });
    this.#layouts.set(pattern, layout);
    return layout;
  }

  /**
   * The pipeline layout for `pattern`, created on first use over
   * `#acquireBindGroupLayout`'s answer for it.
   */
  #acquirePipelineLayout(pattern: string): GpuPipelineLayout {
    const existing = this.#pipelineLayouts.get(pattern);
    if (existing !== undefined) {
      return existing;
    }
    const layout = this.#acquireBindGroupLayout(pattern);
    const pipelineLayout = this.#device.createPipelineLayout({
      label: `four:compute:${pattern}`,
      bindGroupLayouts: layout === null ? [] : [layout],
    });
    this.#pipelineLayouts.set(pattern, pipelineLayout);
    return pipelineLayout;
  }
}

/** Invocations per workgroup of the §36 integrator kernel, along x. */
export const PARTICLE_INTEGRATOR_WORKGROUP_SIZE = 64;

/**
 * Floats in the integrator's params block: `deltaSeconds`, `count`, two pad
 * lanes, then `gravity` as a vec4 (its `w` lane unread) — 32 bytes, every
 * lane written by {@link writeParticleSimulationParams} so no uploaded byte
 * is history (§33).
 */
export const PARTICLE_SIMULATION_PARAMS_FLOATS = 8;

/**
 * Packs the integrator's params block into `out` at index 0 and returns it —
 * the light-block writer's shape for §36. `count` travels as f32 (module
 * header; exact far beyond §112's budget).
 */
export function writeParticleSimulationParams(
  out: Float32Array,
  deltaSeconds: number,
  count: number,
  gravityX: number,
  gravityY: number,
  gravityZ: number,
): Float32Array {
  out[0] = deltaSeconds;
  out[1] = count;
  out[2] = 0;
  out[3] = 0;
  out[4] = gravityX;
  out[5] = gravityY;
  out[6] = gravityZ;
  out[7] = 0;
  return out;
}

/**
 * The workgroup grid that covers `count` particles along x — §82's
 * `workgroups` for the integrator. Zero for an empty system, which
 * dispatches WebGPU's defined no-op.
 */
export function particleIntegratorWorkgroups(
  count: number,
): readonly [number, number, number] {
  return [Math.ceil(count / PARTICLE_INTEGRATOR_WORKGROUP_SIZE), 1, 1];
}

/**
 * The §36 GPU particle integrator (R-31's simulation half) — semi-implicit
 * Euler under constant gravity, `@four/particles`' documented step order
 * (`v += g·dt`, then `p += v·dt`) over the pool's flat x,y,z `Float32Array`
 * lanes.
 *
 * Bindings, in {@link ComputePassDescriptor.bindings} order:
 *
 * 0. params — {@link PARTICLE_SIMULATION_PARAMS_FLOATS} floats, `"read-only"`
 *    (see {@link writeParticleSimulationParams});
 * 1. positions — `array<f32>`, 3 lanes per particle, `"read-write"`;
 * 2. velocities — `array<f32>`, 3 lanes per particle, `"read-write"`.
 *
 * One invocation integrates one particle; invocations past `count` return —
 * the workgroup rounding of {@link particleIntegratorWorkgroups} makes the
 * overshoot at most one workgroup.
 */
export const PARTICLE_INTEGRATOR_SHADER_SOURCE = `struct ParticleSimulationParams {
  deltaSeconds : f32,
  count : f32,
  pad0 : f32,
  pad1 : f32,
  gravity : vec4<f32>,
};

@group(0) @binding(0) var<storage, read> params : ParticleSimulationParams;
@group(0) @binding(1) var<storage, read_write> positions : array<f32>;
@group(0) @binding(2) var<storage, read_write> velocities : array<f32>;

@compute @workgroup_size(${String(PARTICLE_INTEGRATOR_WORKGROUP_SIZE)})
fn ${COMPUTE_ENTRY_POINT}(@builtin(global_invocation_id) id : vec3<u32>) {
  let index = id.x;
  if (f32(index) >= params.count) {
    return;
  }
  let base = index * 3u;
  let dt = params.deltaSeconds;
  let vx = velocities[base] + params.gravity.x * dt;
  let vy = velocities[base + 1u] + params.gravity.y * dt;
  let vz = velocities[base + 2u] + params.gravity.z * dt;
  velocities[base] = vx;
  velocities[base + 1u] = vy;
  velocities[base + 2u] = vz;
  positions[base] = positions[base] + vx * dt;
  positions[base + 1u] = positions[base + 1u] + vy * dt;
  positions[base + 2u] = positions[base + 2u] + vz * dt;
}
`;
