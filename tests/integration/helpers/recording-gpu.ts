/**
 * A recording WebGPU device, adapter and canvas — the twin of
 * `recording-gl.ts` (WP-R1.1, 2026-08-21).
 *
 * The WebGPU backend's entire device surface is one set of structural
 * interfaces (`webgpu-device.ts`), so an object implementing them is a
 * *complete* double — failure paths and call **order** included — with no GPU
 * and no browser. That matters more here than it does for WebGL: Node has no
 * `navigator.gpu` at all (`globalThis.navigator.gpu` is `undefined` under Node
 * 22), so there is no "run it for real in a unit test" option to fall back on,
 * and every Vitest-tier claim about this backend is a claim about a transcript.
 *
 * ## The gotcha, carried over verbatim
 *
 * `recording-gl.ts` records the argument *array* a call was made with, and
 * `transcript()` renders it lazily. That is fine for GL, whose typed-array
 * arguments are per-call scratch — but this backend uploads **one uniform
 * staging array, retained across frames**, so a transcript read after a later
 * frame would report the later frame's uniform values for the earlier frame's
 * `writeBuffer`. So: **retained typed-array arguments are copied at record
 * time.** Every `ArrayBufferView` argument is snapshotted into a plain array
 * the moment the call is made, which is what makes "frame 1 uploaded these
 * bytes" an assertion that survives frame 2.
 *
 * ## Handles
 *
 * Every `create*` call mints `{ kind, serial }`, exactly as `recording-gl.ts`
 * does, so a transcript matches another only when the *same* objects were
 * passed in the same order — which is what "byte-identical command sequence"
 * means here.
 */

import type {
  Gpu,
  GpuAdapter,
  GpuBindGroup,
  GpuBuffer,
  GpuCanvasContext,
  GpuCommandBuffer,
  GpuCommandEncoder,
  GpuComputePassEncoder,
  GpuDevice,
  GpuRenderPassEncoder,
  GpuTexture,
  WebgpuCanvas,
} from "@four/render-webgpu";

/** One recorded entry point call, with the arguments it was given. */
export interface RecordedGpuCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** A minted handle, identifying itself in a transcript. */
interface Handle {
  readonly kind: string;
  readonly serial: number;
}

/** How the double should behave where a real host could refuse. */
export interface RecordingGpuOptions {
  /** Resolve `requestAdapter()` with `null`, as a flagless browser does. */
  readonly noAdapter?: boolean;
  /** Resolve `requestDevice()` with `null`. */
  readonly noDevice?: boolean;
  /** Hand back something that is not a WebGPU context from `getContext`. */
  readonly badContext?: boolean;
  /** Hand back `null` from `getContext`, as a canvas with a 2D context does. */
  readonly noContext?: boolean;
  /** Omit `limits` and `features` entirely, as a minimal double may. */
  readonly noLimits?: boolean;
  /** Omit `getPreferredCanvasFormat`, exercising the fallback format. */
  readonly noPreferredFormat?: boolean;
  /** Device limits to report; omit for a plausible SwiftShader-ish set. */
  readonly limits?: Readonly<Record<string, number>>;
  /** Feature names `device.features.has` answers `true` for. */
  readonly features?: readonly string[];
}

/** The double, plus the tape it writes to. */
export interface RecordingGpu {
  /** Hand this to the renderer as `navigator.gpu` (see {@link withHostGpu}). */
  readonly gpu: Gpu;

  /** The adapter `requestAdapter` resolves. */
  readonly adapter: GpuAdapter | null;

  /** The device `requestDevice` resolves. */
  readonly device: GpuDevice | null;

  /** A canvas whose `getContext("webgpu")` yields the recording context. */
  readonly canvas: WebgpuCanvas;

  /** Every call since the last {@link RecordingGpu.reset}, in order. */
  readonly calls: RecordedGpuCall[];

  /** Just the calls to `name`, in order. */
  callsOf(name: string): RecordedGpuCall[];

  /** How many times `name` was called. */
  countOf(name: string): number;

  /** A comparable transcript: one `name(json, json, …)` line per call. */
  transcript(): string[];

  /** Clears the tape without disturbing the renderer's caches. */
  reset(): void;

  /**
   * Resolves the device's `lost` promise — §61's device-loss event, which
   * WebGPU delivers as a promise rather than as an event pair.
   *
   * `reason` defaults to `"unknown"`, a genuine loss. Pass `"destroyed"` for
   * the teardown case, which the renderer must *not* report as a loss.
   */
  loseDevice(reason?: string): void;
}

/** Default limits: large enough to be plausible, small enough to be obviously fake. */
const DEFAULT_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  maxTextureDimension2D: 8192,
  maxUniformBufferBindingSize: 65536,
  maxBindingsPerBindGroup: 640,
  maxStorageBuffersPerShaderStage: 8,
  maxComputeWorkgroupSizeX: 256,
});

/**
 * Snapshots an argument for the tape.
 *
 * Typed arrays are copied (see the module header); everything else is retained
 * by reference, which is what makes handle identity assertable.
 */
function snapshot(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) {
    return value.map(snapshot);
  }
  return value;
}

/** Renders one recorded argument for {@link RecordingGpu.transcript}. */
function describe(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Builds a fresh recording device tree. */
export function createRecordingGpu(
  options: RecordingGpuOptions = {},
): RecordingGpu {
  const calls: RecordedGpuCall[] = [];
  let serial = 0;

  const record = (name: string, ...args: unknown[]): void => {
    calls.push({ name, args: args.map(snapshot) });
  };

  const mint = (kind: string): Handle => {
    serial += 1;
    return { kind, serial };
  };

  const buffer = (label: string, size: number): GpuBuffer => {
    const handle = mint(label);
    return {
      ...handle,
      destroy: (): void => {
        record("buffer.destroy", handle);
      },
      // WP-R1.6's readback trio. Optional on the interface (presence is the
      // capability), always present on this double so `readPixels` is
      // testable against the tape. `getMappedRange` hands back a
      // deterministic byte pattern — byte i is `i % 251`, a prime chosen so
      // the pattern never aligns with the 256-byte padded rows — which is
      // what lets a unit test assert the padding strip and the row flip
      // *exactly* rather than over zeroes that hide both.
      mapAsync: (mode: number): Promise<void> => {
        record("buffer.mapAsync", handle, mode);
        return Promise.resolve();
      },
      getMappedRange: (): ArrayBuffer => {
        record("buffer.getMappedRange", handle);
        const bytes = new Uint8Array(size);
        for (let index = 0; index < size; index += 1) {
          bytes[index] = index % 251;
        }
        return bytes.buffer;
      },
      unmap: (): void => {
        record("buffer.unmap", handle);
      },
    };
  };

  const texture = (kind: string): GpuTexture => {
    const handle = mint(kind);
    return {
      ...handle,
      // The descriptor joined in WP-R1.2 (mip generation views a single
      // level); it is recorded only when passed, so every WP-R1.1 transcript
      // line — always the whole-texture form — stays byte-identical.
      createView: (descriptor?: unknown): object => {
        if (descriptor === undefined) {
          record("texture.createView", handle);
        } else {
          record("texture.createView", handle, descriptor);
        }
        return mint(`${kind}-view`);
      },
      destroy: (): void => {
        record("texture.destroy", handle);
      },
    };
  };

  const pass: GpuRenderPassEncoder = {
    setPipeline: (pipeline): void => {
      record("pass.setPipeline", pipeline);
    },
    setBindGroup: (index, group, offsets): void => {
      record("pass.setBindGroup", index, group, offsets);
    },
    setVertexBuffer: (slot, vertexBuffer, offset): void => {
      record("pass.setVertexBuffer", slot, vertexBuffer, offset);
    },
    setIndexBuffer: (indexBuffer, format, offset): void => {
      record("pass.setIndexBuffer", indexBuffer, format, offset);
    },
    setViewport: (x, y, width, height, minDepth, maxDepth): void => {
      record("pass.setViewport", x, y, width, height, minDepth, maxDepth);
    },
    setScissorRect: (x, y, width, height): void => {
      record("pass.setScissorRect", x, y, width, height);
    },
    // §67's stencil reference (WP-R1.3) — the one §57 stencil field WebGPU
    // leaves as a pass command rather than pipeline state.
    setStencilReference: (reference): void => {
      record("pass.setStencilReference", reference);
    },
    draw: (vertexCount, instanceCount, firstVertex, firstInstance): void => {
      record(
        "pass.draw",
        vertexCount,
        instanceCount,
        firstVertex,
        firstInstance,
      );
    },
    drawIndexed: (indexCount, instanceCount, firstIndex): void => {
      record("pass.drawIndexed", indexCount, instanceCount, firstIndex);
    },
    end: (): void => {
      record("pass.end");
    },
  };

  // WP-R1.8's compute pass — optional members on the interface (presence is
  // the capability); present on this double so §82's dispatch sequence is
  // assertable off the tape.
  const computePass: GpuComputePassEncoder = {
    setPipeline: (pipeline): void => {
      record("computePass.setPipeline", pipeline);
    },
    setBindGroup: (index, group): void => {
      record("computePass.setBindGroup", index, group);
    },
    dispatchWorkgroups: (x, y, z): void => {
      record("computePass.dispatchWorkgroups", x, y, z);
    },
    end: (): void => {
      record("computePass.end");
    },
  };

  const encoder: GpuCommandEncoder = {
    beginRenderPass: (descriptor): GpuRenderPassEncoder => {
      record("encoder.beginRenderPass", descriptor);
      return pass;
    },
    beginComputePass: (descriptor): GpuComputePassEncoder => {
      record("encoder.beginComputePass", descriptor);
      return computePass;
    },
    // WP-R1.6's readback copy — optional on the interface, present here so
    // the copy's alignment arithmetic is assertable off the tape.
    copyTextureToBuffer: (source, destination, size): void => {
      record("encoder.copyTextureToBuffer", source, destination, size);
    },
    // WP-R1.8's compute readback copy — same terms as the texture one.
    copyBufferToBuffer: (
      source,
      sourceOffset,
      destination,
      destinationOffset,
      size,
    ): void => {
      record(
        "encoder.copyBufferToBuffer",
        source,
        sourceOffset,
        destination,
        destinationOffset,
        size,
      );
    },
    finish: (): GpuCommandBuffer => {
      record("encoder.finish");
      return mint("command-buffer");
    },
  };

  const featureSet = new Set(options.features ?? ["timestamp-query"]);

  let resolveLost: (info: { reason: string; message: string }) => void = () => {
    // Replaced synchronously by the executor below.
  };
  const lost = new Promise<{ reason: string; message: string }>((resolve) => {
    resolveLost = resolve;
  });

  const device: GpuDevice = {
    queue: {
      writeBuffer: (target, bufferOffset, data, dataOffset, size): void => {
        record(
          "queue.writeBuffer",
          target,
          bufferOffset,
          data,
          dataOffset,
          size,
        );
      },
      // WP-R1.2's texture upload. The destination names a texture handle, so
      // the object survives on the tape; the texel data itself is an
      // `ArrayBufferView` and is copied at record time like every other one
      // (see the module header) — a texture edited in place after `markDirty`
      // must not rewrite what the first upload's transcript line says.
      writeTexture: (destination, data, dataLayout, size): void => {
        record("queue.writeTexture", destination, data, dataLayout, size);
      },
      submit: (buffers): void => {
        record("queue.submit", buffers);
      },
    },
    ...(options.noLimits === true
      ? {}
      : {
          limits: options.limits ?? DEFAULT_LIMITS,
          features: { has: (name: string): boolean => featureSet.has(name) },
        }),
    lost,
    createBuffer: (descriptor): GpuBuffer => {
      record("device.createBuffer", descriptor);
      return buffer("buffer", descriptor.size);
    },
    createTexture: (descriptor): GpuTexture => {
      record("device.createTexture", descriptor);
      return texture("texture");
    },
    createSampler: (descriptor): object => {
      record("device.createSampler", descriptor);
      return mint("sampler");
    },
    createShaderModule: (descriptor): object => {
      record("device.createShaderModule", descriptor);
      return mint("shader-module");
    },
    createBindGroupLayout: (descriptor): object => {
      record("device.createBindGroupLayout", descriptor);
      return mint("bind-group-layout");
    },
    createPipelineLayout: (descriptor): object => {
      record("device.createPipelineLayout", descriptor);
      return mint("pipeline-layout");
    },
    createBindGroup: (descriptor): GpuBindGroup => {
      record("device.createBindGroup", descriptor);
      return mint("bind-group");
    },
    createRenderPipeline: (descriptor): object => {
      record("device.createRenderPipeline", descriptor);
      return mint("render-pipeline");
    },
    // WP-R1.8's §82 pipeline — optional on the interface; present here so
    // the compute tier is testable against the tape.
    createComputePipeline: (descriptor): object => {
      record("device.createComputePipeline", descriptor);
      return mint("compute-pipeline");
    },
    createCommandEncoder: (descriptor): GpuCommandEncoder => {
      record("device.createCommandEncoder", descriptor);
      return encoder;
    },
    destroy: (): void => {
      record("device.destroy");
    },
  };

  const context: GpuCanvasContext = {
    configure: (configuration): void => {
      record("context.configure", {
        format: configuration.format,
        alphaMode: configuration.alphaMode,
      });
    },
    unconfigure: (): void => {
      record("context.unconfigure");
    },
    getCurrentTexture: (): GpuTexture => {
      record("context.getCurrentTexture");
      return texture("swapchain");
    },
  };

  const adapter: GpuAdapter | null =
    options.noAdapter === true
      ? null
      : {
          features: { has: (name: string): boolean => featureSet.has(name) },
          requestDevice: (): Promise<GpuDevice | null> => {
            record("adapter.requestDevice");
            return Promise.resolve(options.noDevice === true ? null : device);
          },
        };

  const gpu: Gpu = {
    requestAdapter: (): Promise<GpuAdapter | null> => {
      record("gpu.requestAdapter");
      return Promise.resolve(adapter);
    },
    ...(options.noPreferredFormat === true
      ? {}
      : { getPreferredCanvasFormat: (): string => "bgra8unorm" }),
  };

  const canvas: WebgpuCanvas = {
    width: 256,
    height: 256,
    getContext: (): unknown => {
      if (options.noContext === true) {
        return null;
      }
      return options.badContext === true
        ? { fillRect: (): void => {} }
        : context;
    },
  };

  return {
    gpu,
    adapter,
    device:
      options.noAdapter === true || options.noDevice === true ? null : device,
    canvas,
    calls,
    callsOf: (name) => calls.filter((call) => call.name === name),
    countOf: (name) => calls.filter((call) => call.name === name).length,
    transcript: () =>
      calls.map(
        (call) => `${call.name}(${call.args.map(describe).join(", ")})`,
      ),
    reset: () => {
      calls.length = 0;
    },
    loseDevice: (reason = "unknown") => {
      resolveLost({ reason, message: "recording device lost" });
    },
  };
}

/**
 * Installs `gpu` as `globalThis.navigator.gpu` for the duration of `body`, and
 * restores whatever was there before.
 *
 * Node has no `navigator.gpu`, and `WebgpuRenderer` reads it off `globalThis`
 * rather than taking it as an argument — because that is where a browser puts
 * it, and a backend that took its host as a parameter would be a backend no
 * application could construct the ordinary way. So the double is installed the
 * same way the browser would install the real thing.
 */
export async function withHostGpu<T>(
  gpu: Gpu | undefined,
  body: () => Promise<T>,
): Promise<T> {
  const host = globalThis as object;
  // Node 22 defines `navigator` as a getter-only own property of the global
  // object, so a plain assignment throws. `defineProperty` is the only way in,
  // and capturing the original descriptor is the only way back out.
  const previous = Object.getOwnPropertyDescriptor(host, "navigator");
  Object.defineProperty(host, "navigator", {
    value: gpu === undefined ? {} : { gpu },
    configurable: true,
    writable: true,
  });
  try {
    return await body();
  } finally {
    if (previous === undefined) {
      delete (host as Record<string, unknown>)["navigator"];
    } else {
      Object.defineProperty(host, "navigator", previous);
    }
  }
}
