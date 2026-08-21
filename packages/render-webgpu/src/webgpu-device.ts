/**
 * The WebGPU surface this backend touches, described structurally (§61, §62).
 *
 * This is the twin of `@four/render-webgl`'s `WebglContext`, and it exists for
 * the same two reasons, both of which matter more here than they did there:
 *
 * 1. **The package compiles without `lib.dom` and without `@webgpu/types`.**
 *    `@four/render` types `RendererOptions.canvas` as `unknown` precisely so a
 *    backend narrows it where it can validate it, and the §3.2 pin set carries
 *    no WebGPU typings — adding one would be a new toolchain dependency for
 *    declarations the engine can write itself in a page (ground rule 7).
 * 2. **A structural interface is what makes a *complete* double possible.**
 *    Node has no `navigator.gpu` at all, so every Vitest-tier test in this
 *    package runs against a fake device that records what it was asked to do
 *    (`tests/integration/helpers/recording-gpu.ts`, the twin of that directory's
 *    `recording-gl.ts`).
 *    A transcript assertion is only as honest as the interface it is written
 *    against: an interface naming exactly the entry points the backend calls
 *    makes "the frame issued these commands, in this order" checkable with no
 *    GPU and no browser.
 *
 * ## What is deliberately *not* modelled
 *
 * Everything this packet does not call: `mapAsync`, `copyTextureToBuffer`,
 * compute pipelines, query sets, external textures. Each joins the interface
 * with the packet that calls it (WP-R1.6's readback, WP-R1.8's compute), so the
 * double never has to fake a member no code path reaches — the property that
 * keeps it a double rather than a reimplementation.
 *
 * ## Names
 *
 * The interfaces are named `Gpu*` rather than `GPU*` so that nothing here
 * shadows or is mistaken for the real global types in an editor that has
 * `lib.dom` loaded. They are structurally satisfied by the real ones.
 */

/**
 * Bit flags for `GpuBufferDescriptor.usage`, from the WebGPU specification's
 * `GPUBufferUsage` namespace.
 *
 * Written out rather than read off a global for the reason `GL` in the WebGL
 * backend is written out: the values are normative constants of a published
 * specification, and reading them from `globalThis.GPUBufferUsage` would make
 * the backend un-testable in Node — where that global does not exist — for no
 * gain at all.
 */
export const GPU_BUFFER_USAGE = Object.freeze({
  /** Buffer may be mapped for reading (`mapAsync`) — WP-R1.6's readback. */
  MAP_READ: 0x0001,
  /** Buffer may be the source of a copy. */
  COPY_SRC: 0x0004,
  /** Buffer may be the destination of a copy, including `queue.writeBuffer`. */
  COPY_DST: 0x0008,
  /** Buffer may be bound as an index buffer. */
  INDEX: 0x0010,
  /** Buffer may be bound as a vertex buffer. */
  VERTEX: 0x0020,
  /** Buffer may be bound as a uniform buffer. */
  UNIFORM: 0x0040,
  /** Buffer may be bound as a storage buffer (§82, WP-R1.8). */
  STORAGE: 0x0080,
});

/** Bit flags for `GpuTextureDescriptor.usage` (`GPUTextureUsage`). */
export const GPU_TEXTURE_USAGE = Object.freeze({
  /** Texture may be the source of a copy. */
  COPY_SRC: 0x01,
  /** Texture may be the destination of a copy. */
  COPY_DST: 0x02,
  /** Texture may be sampled by a shader. */
  TEXTURE_BINDING: 0x04,
  /** Texture may be a colour or depth attachment of a render pass. */
  RENDER_ATTACHMENT: 0x10,
});

/** Bit flags for a bind-group-layout entry's `visibility` (`GPUShaderStage`). */
export const GPU_SHADER_STAGE = Object.freeze({
  /** Vertex stage. */
  VERTEX: 0x1,
  /** Fragment stage. */
  FRAGMENT: 0x2,
  /** Compute stage (§82, WP-R1.8). */
  COMPUTE: 0x4,
});

/**
 * The alignment a dynamic uniform-buffer offset must satisfy.
 *
 * 256 bytes is the WebGPU default `minUniformBufferOffsetAlignment`, and it is
 * also the specification's *maximum* permitted value for that limit — so a
 * fixed 256 is valid on every conforming device, while reading the limit and
 * using a smaller stride would only ever save memory on devices that permit it.
 * A fixed stride keeps the per-frame uniform packing arithmetic a constant
 * (§33: the frame's byte layout must not vary with the device), which is worth
 * more here than the bytes are (decision, WP-R1.1).
 */
export const UNIFORM_STRIDE_BYTES = 256;

/** Why a device was lost, as `GpuDevice.lost` resolves it. */
export interface GpuDeviceLostInfo {
  /** `"destroyed"` when the application called `destroy()`, else `"unknown"`. */
  readonly reason?: string;
  /** Human-readable detail from the implementation. */
  readonly message?: string;
}

/** An opaque GPU buffer handle. */
export interface GpuBuffer {
  /** Releases the allocation (§83). */
  destroy(): void;
}

/** An opaque texture view — what a render pass attaches. */
export type GpuTextureView = object;

/** An opaque GPU texture handle. */
export interface GpuTexture {
  /** A view of the whole texture; the only form this packet needs. */
  createView(): GpuTextureView;
  /** Releases the allocation (§83). Absent on a swap-chain texture. */
  destroy?(): void;
}

/** A compiled WGSL module. */
export type GpuShaderModule = object;

/** A bind-group layout — the *declared* shape of a shader's bindings (§7's RFC-0001 debt). */
export type GpuBindGroupLayout = object;

/** A pipeline layout: the ordered bind-group layouts a pipeline expects. */
export type GpuPipelineLayout = object;

/** A bound set of resources. */
export type GpuBindGroup = object;

/** An immutable, fully specified render pipeline (§4.2 of the R-1 plan). */
export type GpuRenderPipeline = object;

/** A recorded, submittable command buffer. */
export type GpuCommandBuffer = object;

/** One buffer's vertex layout inside a pipeline descriptor. */
export interface GpuVertexBufferLayout {
  /** Distance between consecutive elements, in bytes. */
  readonly arrayStride: number;
  /** `"vertex"` (this packet) or `"instance"` (WP-R1.8's particles). */
  readonly stepMode?: "vertex" | "instance";
  /** The attributes read out of this buffer. */
  readonly attributes: readonly {
    readonly format: string;
    readonly offset: number;
    readonly shaderLocation: number;
  }[];
}

/** One colour attachment's blend state. */
export interface GpuBlendState {
  /** Colour-channel blend factors and operation. */
  readonly color: GpuBlendComponent;
  /** Alpha-channel blend factors and operation. */
  readonly alpha: GpuBlendComponent;
}

/** One channel group's blend factors and operation. */
export interface GpuBlendComponent {
  /** Multiplier applied to the fragment's output. */
  readonly srcFactor: string;
  /** Multiplier applied to the attachment's existing value. */
  readonly dstFactor: string;
  /** How the two are combined; `"add"` throughout this tier. */
  readonly operation: string;
}

/** A render pipeline descriptor, reduced to the members this backend sets. */
export interface GpuRenderPipelineDescriptor {
  /** Diagnostic name, echoed by implementations in validation errors. */
  readonly label?: string;
  /** Explicit layout — never `"auto"`; see `wgpu-bindings.ts`. */
  readonly layout: GpuPipelineLayout;
  /** Vertex stage: module, entry point and buffer layouts. */
  readonly vertex: {
    readonly module: GpuShaderModule;
    readonly entryPoint: string;
    readonly buffers: readonly GpuVertexBufferLayout[];
  };
  /** Fragment stage and its colour targets. */
  readonly fragment: {
    readonly module: GpuShaderModule;
    readonly entryPoint: string;
    readonly targets: readonly {
      readonly format: string;
      readonly blend?: GpuBlendState;
      readonly writeMask: number;
    }[];
  };
  /** Topology and winding. */
  readonly primitive: {
    readonly topology: string;
    readonly frontFace?: string;
    readonly cullMode?: string;
  };
  /** Depth-stencil state, absent for a pass with no depth attachment. */
  readonly depthStencil?: {
    readonly format: string;
    readonly depthWriteEnabled: boolean;
    readonly depthCompare: string;
  };
}

/** A render pass descriptor, reduced to what this packet attaches. */
export interface GpuRenderPassDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /** Colour attachments — exactly one in this tier. */
  readonly colorAttachments: readonly {
    readonly view: GpuTextureView;
    readonly loadOp: "load" | "clear";
    readonly storeOp: "store" | "discard";
    readonly clearValue?: readonly [number, number, number, number];
  }[];
  /** The depth attachment, when the surface has one. */
  readonly depthStencilAttachment?: {
    readonly view: GpuTextureView;
    readonly depthLoadOp: "load" | "clear";
    readonly depthStoreOp: "store" | "discard";
    readonly depthClearValue?: number;
  };
}

/** The commands a render pass records. */
export interface GpuRenderPassEncoder {
  /** Selects the pipeline subsequent draws use. */
  setPipeline(pipeline: GpuRenderPipeline): void;
  /** Binds a bind group, optionally at dynamic offsets. */
  setBindGroup(
    index: number,
    bindGroup: GpuBindGroup,
    dynamicOffsets?: readonly number[],
  ): void;
  /** Binds a vertex buffer into a slot of the pipeline's vertex layout. */
  setVertexBuffer(
    slot: number,
    buffer: GpuBuffer | null,
    offset?: number,
  ): void;
  /** Binds the index buffer. */
  setIndexBuffer(
    buffer: GpuBuffer,
    indexFormat: "uint16" | "uint32",
    offset?: number,
  ): void;
  /**
   * Sets the draw rectangle, in **framebuffer** pixels with a top-left origin
   * (see `webgpu-renderer.ts` for the flip out of §48's bottom-left rectangle).
   */
  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void;
  /** Confines writes — including this backend's clear draws — to a rectangle. */
  setScissorRect(x: number, y: number, width: number, height: number): void;
  /** Non-indexed draw. */
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  /** Indexed draw. */
  drawIndexed(
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number,
  ): void;
  /** Closes the pass. Every `beginRenderPass` owes exactly one of these. */
  end(): void;
}

/** Records passes into a command buffer. */
export interface GpuCommandEncoder {
  /** Opens a render pass. */
  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPassEncoder;
  /** Closes the encoder and yields the buffer to submit. */
  finish(): GpuCommandBuffer;
}

/** The device's submission queue. */
export interface GpuQueue {
  /** Uploads CPU bytes into a buffer allocation. */
  writeBuffer(
    buffer: GpuBuffer,
    bufferOffset: number,
    data: ArrayBufferView,
    dataOffset?: number,
    size?: number,
  ): void;
  /** Submits recorded command buffers, in order. */
  submit(commandBuffers: readonly GpuCommandBuffer[]): void;
}

/** A buffer allocation request. */
export interface GpuBufferDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /** Allocation size in bytes; must be a multiple of 4 for `writeBuffer`. */
  readonly size: number;
  /** Bit set from {@link GPU_BUFFER_USAGE}. */
  readonly usage: number;
}

/** A texture allocation request — the depth attachment, in this packet. */
export interface GpuTextureDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /** Extent, as WebGPU's array form. */
  readonly size: readonly [number, number];
  /** Texel format. */
  readonly format: string;
  /** Bit set from {@link GPU_TEXTURE_USAGE}. */
  readonly usage: number;
}

/** One entry of a bind-group layout — see `wgpu-bindings.ts`. */
export interface GpuBindGroupLayoutEntry {
  /** Binding number, matching the shader's `@binding`. */
  readonly binding: number;
  /** Bit set from {@link GPU_SHADER_STAGE}. */
  readonly visibility: number;
  /** Buffer binding shape; the only kind this packet declares. */
  readonly buffer?: {
    readonly type: "uniform" | "storage" | "read-only-storage";
    readonly hasDynamicOffset?: boolean;
    readonly minBindingSize?: number;
  };
}

/** A bound resource, in this packet always a buffer range. */
export interface GpuBindGroupEntry {
  /** Binding number, matching the layout's. */
  readonly binding: number;
  /** The bound resource. */
  readonly resource: {
    readonly buffer: GpuBuffer;
    readonly offset?: number;
    readonly size?: number;
  };
}

/** The device: everything the backend allocates and submits through. */
export interface GpuDevice {
  /** The submission queue. */
  readonly queue: GpuQueue;
  /**
   * The device's limits, by their WebGPU names. Optional because a double need
   * not carry them — an absent limit is reported as "not reported" rather than
   * guessed (`renderer.ts`'s tri-state).
   */
  readonly limits?: Readonly<Record<string, number>>;
  /** The device's optional features; `has` is the §62 query. */
  readonly features?: { has(name: string): boolean };
  /**
   * Resolves when the device is lost (§61's first-class loss event). Optional
   * so that a double may omit it; the renderer subscribes only when present.
   */
  readonly lost?: Promise<GpuDeviceLostInfo>;
  /** Allocates a buffer. */
  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer;
  /** Allocates a texture. */
  createTexture(descriptor: GpuTextureDescriptor): GpuTexture;
  /** Compiles a WGSL module. */
  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }): GpuShaderModule;
  /** Declares a bind-group layout (§7's "layouts as data"). */
  createBindGroupLayout(descriptor: {
    readonly label?: string;
    readonly entries: readonly GpuBindGroupLayoutEntry[];
  }): GpuBindGroupLayout;
  /** Composes bind-group layouts into a pipeline layout. */
  createPipelineLayout(descriptor: {
    readonly label?: string;
    readonly bindGroupLayouts: readonly GpuBindGroupLayout[];
  }): GpuPipelineLayout;
  /** Binds resources against a layout. */
  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: GpuBindGroupLayout;
    readonly entries: readonly GpuBindGroupEntry[];
  }): GpuBindGroup;
  /** Creates an immutable render pipeline (lazily — see `wgpu-pipeline-cache.ts`). */
  createRenderPipeline(
    descriptor: GpuRenderPipelineDescriptor,
  ): GpuRenderPipeline;
  /** Opens a command encoder. */
  createCommandEncoder(descriptor?: {
    readonly label?: string;
  }): GpuCommandEncoder;
  /** Releases the device (§83). */
  destroy(): void;
}

/** The adapter a device is requested from. */
export interface GpuAdapter {
  /** Optional vendor/architecture strings, where the implementation exposes them. */
  readonly info?: Readonly<Record<string, unknown>>;
  /** The adapter's optional features. */
  readonly features?: { has(name: string): boolean };
  /** Requests a device; resolves `null` — or rejects — when none can be had. */
  requestDevice(descriptor?: {
    readonly label?: string;
  }): Promise<GpuDevice | null>;
}

/** `navigator.gpu`, reduced to what this backend calls. */
export interface Gpu {
  /** Requests an adapter; resolves `null` where WebGPU is present but unusable. */
  requestAdapter(options?: {
    readonly powerPreference?: string;
  }): Promise<GpuAdapter | null>;
  /**
   * The format the host prefers for a canvas swap chain — commonly
   * `"bgra8unorm"`, **not** `"rgba8unorm"` (§60a; see `webgpu-renderer.ts` on
   * why that never widens `RenderTargetFormat`). Optional: a double may omit
   * it, and the backend falls back to `"bgra8unorm"`.
   */
  getPreferredCanvasFormat?(): string;
}

/** The canvas's `"webgpu"` context. */
export interface GpuCanvasContext {
  /** Configures the swap chain. Must precede the first `getCurrentTexture`. */
  configure(configuration: {
    readonly device: GpuDevice;
    readonly format: string;
    readonly alphaMode?: string;
  }): void;
  /** Releases the swap chain (§83). */
  unconfigure?(): void;
  /** The texture for this frame. A fresh one per frame, cleared to zero. */
  getCurrentTexture(): GpuTexture;
}

/**
 * The drawing surface, described by what this backend touches — the twin of
 * `WebglCanvas`, and narrowed at runtime by `WebgpuRenderer.initialize` for the
 * same reason (`RendererOptions.canvas` is `unknown` by design).
 *
 * There is no `addEventListener` here, and its absence is the interesting half:
 * WebGL 2 signals loss through two canvas events, while WebGPU signals it
 * through `GpuDevice.lost`, a promise on the *device*. The surface therefore
 * needs no event target at all, which is why an `OffscreenCanvas` satisfies
 * this interface with nothing added.
 */
export interface WebgpuCanvas {
  /** Swap-chain width in device pixels. Written by `resize`. */
  width: number;
  /** Swap-chain height in device pixels. Written by `resize`. */
  height: number;
  /**
   * Acquires the `"webgpu"` context. Typed to return `unknown` because this
   * package does not name `GPUCanvasContext`; the result is validated
   * structurally before use.
   */
  getContext(contextId: "webgpu"): unknown;
}
