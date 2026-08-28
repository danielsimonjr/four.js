/**
 * Draws four.js scenes with WebGPU (§61, §62 backend 1).
 *
 * ```ts
 * const renderer = new WebgpuRenderer();
 * await renderer.initialize({ canvas });
 * renderer.resize(800, 600, devicePixelRatio);
 * renderer.render(scene, [createFullscreenViewport(camera)]);
 * // …
 * renderer.dispose();
 * ```
 *
 * This is WP-R1.1 through WP-R1.3 of the R-1 plan: device and context
 * acquisition, the registry opt-in, per-view clears, the **unlit** tier —
 * flat, vertex-coloured and §57-`map`-textured — plus WP-R1.3's **sprite**
 * pipeline (§55; §56's `Text` needs nothing more — a label is one textured
 * unlit draw, R-28), the opt-in §65 **batching** uploader (`wgpu-batch.ts`),
 * and §67's **clip** application (masks write stencil bit planes, clipped
 * draws test them — see `DEPTH_STENCIL_FORMAT` below for the per-frame
 * stencil-format decision). All of it drawn through the real
 * `buildRenderList` → `buildViewRenderList` → draw path. The remaining
 * pipelines (lit, standard, particles, shadows, effects, compute) are packets
 * R1.4–R1.8 and are *absent*, not stubbed: an item this tier cannot draw is
 * skipped, exactly as a draw with no geometry record is, because a pipeline
 * that silently draws the wrong thing is worse than one that does not exist
 * yet (the recorded WP-9.1 rule, applied to a backend). The one exception is
 * deliberate and narrow: a §67 **mask** is coverage, not shading, so a clip
 * node of any material family masks correctly today through the flat unlit
 * pipeline with colour writes off.
 *
 * ## `initialize()` finally earns its `Promise`
 *
 * `Renderer.initialize` has always been typed `Promise<void>`; `WebglRenderer`
 * fulfils it synchronously because `getContext` returns immediately. WebGPU
 * cannot: `requestAdapter` and `requestDevice` are genuinely asynchronous, and
 * this is the first implementation for which awaiting is not a formality. Every
 * failure along the way — no `navigator.gpu`, no adapter, no device, no canvas,
 * no `"webgpu"` context — rejects with a `FourError` carrying
 * `RENDERER_INITIALIZATION_FAILED` (§89), never a silent downgrade: §62 puts
 * backend *selection* and its fallback in the registry, not in a backend.
 *
 * ## Device loss is a promise, not an event pair (§61)
 *
 * WebGL 2 signals loss with two canvas events and needs `preventDefault()` on
 * the first of them to be promised a restore. WebGPU signals it with
 * `device.lost`, a promise on the device — a better fit for §61's "first-class
 * event, not an error case", and the reason `WebgpuCanvas` needs no event
 * target at all. On loss this renderer marks itself lost, drops every cache
 * (the allocations belong to a device that no longer exists) and emits
 * `contextlost`. It does **not** emit `contextrestored`: WebGPU has no
 * automatic restore — recovery is requesting a *new* device, which is an
 * application-level decision about whether to keep going — so promising a
 * restore this backend cannot deliver would be a lie the interface would carry
 * forever. `render` and `resize` return quietly while lost, as §61 requires.
 *
 * ## Colour space and the swap-chain format (§60a)
 *
 * The canvas is configured with the host's **preferred** format, which is
 * `"bgra8unorm"` on most hosts and **not** `"rgba8unorm"`. That never widens
 * `RenderTargetFormat`: the engine's `"rgba8"` means *eight-bit unsigned
 * normalised colour*, and channel order is a backend detail. A later reader
 * looking to "fix" the mismatch should read that sentence twice — the
 * descriptor is not describing memory layout, it is describing precision.
 *
 * ## Clip depth (§3.3.8 of the R-1 plan)
 *
 * WebGPU's NDC depth is `[0, 1]`; `@four/math`'s projections are written to
 * WebGL's `[-1, 1]`. `Camera.updateProjectionMatrix` accepts `"zero-to-one"`
 * and would produce a native matrix — and this backend deliberately does not
 * call it. A renderer that rewrote an application-owned camera's projection
 * would corrupt any *other* renderer sharing that camera, and §61 is explicit
 * that rendering mutates nothing in the scene. So the remap is a
 * multiply-and-add in this backend's own vertex stage (`wgpu-unlit.ts`), the
 * frustum keeps culling against the un-remapped matrix in the one convention
 * both backends share, and the camera is left exactly as the application set
 * it.
 */

import { EventEmitter, FourError } from "@four/core";
import { Frustum, Matrix4 } from "@four/math";
import {
  buildInterpolatedRenderList,
  buildRenderList,
  buildViewRenderList,
  type RenderBatch,
  type RenderInterpolation,
  type RenderItem,
  type RenderStatistics,
  type Renderer,
  type RendererCapabilities,
  type RendererEventMap,
  type RendererOptions,
} from "@four/render";
import type { Node, Viewport } from "@four/scene";

import {
  GPU_BUFFER_USAGE,
  GPU_TEXTURE_USAGE,
  UNIFORM_STRIDE_BYTES,
  type Gpu,
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuCanvasContext,
  type GpuDevice,
  type GpuRenderPassEncoder,
  type GpuTexture,
  type GpuTextureView,
  type WebgpuCanvas,
} from "./webgpu-device.js";
import {
  DRAW_COLOR_OFFSET,
  DRAW_MODEL_OFFSET,
  DRAW_UNIFORM_BYTES,
  DRAW_VIEW_PROJECTION_OFFSET,
  MAP_BIND_GROUP_INDEX,
  createDrawBindGroupLayout,
} from "./wgpu-bindings.js";
// **`import type` only**, deliberately (R-9's seam, restated for this
// backend): a value import here would link §65's uploader — and the planner
// behind it — into every bundle that carries this renderer, whether the
// application batches or not. An application opts in by constructing one with
// `createWgpuBatching` and assigning it; see `wgpu-batch.ts`.
import type { WgpuRenderBatching } from "./wgpu-batch.js";
import { WgpuGeometryCache, type WgpuGeometryRecord } from "./wgpu-geometry.js";
import {
  WgpuPipelineCache,
  type WgpuPipelineDescriptor,
  type WgpuStencilDescriptor,
} from "./wgpu-pipeline-cache.js";
import {
  SPRITE_QUAD_OFFSET,
  SPRITE_UNIFORM_BYTES,
  createSpriteBindGroupLayout,
} from "./wgpu-sprite.js";
import { WgpuTextureCache, type WgpuTextureRecord } from "./wgpu-texture.js";
import { CLEAR_VERTEX_COUNT } from "./wgpu-unlit.js";

/** Error code for use-after-dispose, mirroring the other two backends (§83, §89). */
const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** The depth format this tier allocates (§62's tier; `depth24plus` is universal). */
const DEPTH_FORMAT = "depth24plus";

/**
 * The depth format of a frame that clips (§67, WP-R1.3): the same 24-bit depth
 * plus the eight stencil bit planes `MAX_CLIP_PLANES` budgets — WebGPU's
 * spelling of the packed `DEPTH24_STENCIL8` the WebGL backend's `stencil`
 * option allocates, and guaranteed available on every device.
 *
 * **Per frame, not always** — the R-6 pipeline-cost law applied to a format:
 * the depth format is baked into every pipeline, so allocating stencil
 * unconditionally would re-key (and recompile) every pipeline of every
 * application and move every landed transcript's `createTexture` and
 * `createRenderPipeline` lines. Instead the frame asks the O(1) question R-23
 * built the sort key for — `items[0].clip?.maskPass` — and only a frame that
 * actually clips pays for stencil-carrying pipelines and the attachment's
 * extra byte per pixel. A scene that starts or stops clipping reallocates the
 * depth texture and compiles the other format's pipelines once, which is the
 * same class of cost as its first frame; a scene that never clips records the
 * WP-R1.1 transcript byte for byte.
 *
 * There is deliberately **no `stencil` renderer option and no no-stencil
 * diagnostic** here. The WebGL backend needs both because its stencil buffer
 * is a context-creation attribute it cannot add after the fact, so a clip can
 * arrive on a surface that has nowhere to write its mask. This backend owns
 * its depth attachment and can always allocate the stencil aspect the frame
 * needs — the diagnostic's condition is unreachable, and an option would gate
 * something that costs nothing when unused. The one behavioural asymmetry
 * left: a §57 `material.stencil` (R-7's mask-by-hand tier) only reaches the
 * hardware on a frame that also clips, because only such a frame carries
 * stencil bits — on any other frame it is inert, which is exactly what the
 * same material does on a WebGL surface created without `{ stencil: true }`.
 */
const DEPTH_STENCIL_FORMAT = "depth24plus-stencil8";

/** Every bit of the eight-plane stencil buffer (§67; `STENCIL_INDEX8`). */
const STENCIL_ALL_BITS = 0xff;

/**
 * The clear draw's stencil state on a frame that clips: both tests always
 * pass, and the pass operation stores **zero** into every plane — which makes
 * the §61 clear triangle clear the stencil rectangle exactly as it clears
 * depth, scissored per view. (`loadOp: "clear"` would clear the whole
 * attachment; `wgpu-unlit.ts`'s argument, third application.)
 */
const CLEAR_STENCIL: WgpuStencilDescriptor = Object.freeze({
  func: "always",
  readMask: STENCIL_ALL_BITS,
  writeMask: STENCIL_ALL_BITS,
  failOp: "keep",
  depthFailOp: "keep",
  passOp: "zero",
});

/** The swap-chain format used when the host will not name a preferred one. */
const FALLBACK_CANVAS_FORMAT = "bgra8unorm";

/** `UNIFORM_STRIDE_BYTES` in `Float32Array` elements. */
const UNIFORM_STRIDE_FLOATS = UNIFORM_STRIDE_BYTES / 4;

/** An unlit render item (§64). */
type UnlitItem = Extract<RenderItem, { kind: "unlit" }>;

/** §57's state as this backend reads it off an unlit item's material. */
type UnlitMaterialLike = UnlitItem["material"];

/** A sprite render item (§55, WP-R1.3). */
type SpriteItem = Extract<RenderItem, { kind: "sprite" }>;

/** §55's material as this backend reads it — texture, tint, §57 state. */
type SpriteMaterialLike = SpriteItem["material"];

/** §67's per-item clip record, non-null — `webgl-renderer.ts`'s `ItemClip`. */
type ItemClip = NonNullable<RenderItem["clip"]>;

/**
 * A §57/§67 stencil record as a draw resolves it: the engine-composed clip
 * record (every field present) or a material's own `StencilState` — read
 * defensively below for the reason the GL backend reads it defensively: a
 * structurally-typed material double may carry a partial record, and a missing
 * field must mean the documented default.
 */
type ItemStencilLike =
  ItemClip["stencil"] | NonNullable<UnlitMaterialLike["stencil"]>;

/**
 * Resolves a stencil record into the canonical pipeline-descriptor form, with
 * §57's documented defaults applied — so two draws under one pooled record
 * always produce one pipeline key (`WgpuStencilDescriptor`'s note).
 */
function stencilDescriptor(stencil: ItemStencilLike): WgpuStencilDescriptor {
  return {
    func: stencil.func ?? "always",
    readMask: stencil.readMask ?? STENCIL_ALL_BITS,
    writeMask: stencil.writeMask ?? STENCIL_ALL_BITS,
    failOp: stencil.failOp ?? "keep",
    depthFailOp: stencil.depthFailOp ?? "keep",
    passOp: stencil.passOp ?? "keep",
  };
}

/**
 * The `navigator`-shaped host object, read off `globalThis`.
 *
 * Read structurally rather than through a DOM type for this package's standing
 * reason: it compiles without `lib.dom`, and a double supplies its own `gpu`.
 */
interface GpuHost {
  readonly gpu?: Gpu;
}

/** Reads `navigator.gpu`, or `undefined` where WebGPU is absent (Node, an old browser). */
export function hostGpu(): Gpu | undefined {
  const navigatorLike = (globalThis as Record<string, unknown>)["navigator"];
  if (typeof navigatorLike !== "object" || navigatorLike === null) {
    return undefined;
  }
  const gpu = (navigatorLike as GpuHost).gpu;
  return typeof gpu === "object" &&
    gpu !== null &&
    typeof gpu.requestAdapter === "function"
    ? gpu
    : undefined;
}

/** Narrows `value` to a {@link WebgpuCanvas}, or throws `RENDERER_INITIALIZATION_FAILED`. */
function requireCanvas(value: unknown): WebgpuCanvas {
  if (typeof value !== "object" || value === null) {
    throw new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "The WebGPU backend needs a canvas: pass one as " +
        "`initialize({ canvas })` (§61, §45).",
      { context: { received: typeof value } },
    );
  }
  const candidate = value as Partial<WebgpuCanvas>;
  if (typeof candidate.getContext !== "function") {
    throw new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "The value passed as `canvas` is not a canvas: it has no getContext (§61).",
      { context: { received: typeof value } },
    );
  }
  return value as WebgpuCanvas;
}

/**
 * Narrows a `getContext("webgpu")` result to a {@link GpuCanvasContext}, or
 * returns `null` (the caller turns that into `RENDERER_INITIALIZATION_FAILED`).
 *
 * `configure` and `getCurrentTexture` are the discriminating pair: a canvas
 * that handed back a 2D context, or a stub implementing half the surface, is
 * rejected here rather than crashing on the first frame.
 */
function asCanvasContext(value: unknown): GpuCanvasContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<GpuCanvasContext>;
  return typeof candidate.configure === "function" &&
    typeof candidate.getCurrentTexture === "function"
    ? (value as GpuCanvasContext)
    : null;
}

/**
 * Reads the §62 report off the device (WP-R1.1).
 *
 * Everything here is either a device limit or a feature query — no value is
 * assumed. Where a double omits `limits` or `features` the numeric members read
 * `0` and the boolean ones `false`, which is the same floor `NullRenderer`
 * reports and is honest about a device that will not say.
 *
 * `timestampQueries` is a genuine query and is expected to be **false in CI**:
 * SwiftShader does not implement `timestamp-query`. A test asserting the
 * *value* of a capability rather than its *shape* is a test that breaks on
 * somebody's laptop (R-1 plan §2.3), so the unit suite asserts the plumbing and
 * the browser gate asserts only that the record is complete.
 */
function readCapabilities(device: GpuDevice): RendererCapabilities {
  const limits = device.limits;
  const features = device.features;
  const has = (name: string): boolean => features?.has(name) ?? false;
  const limit = (name: string): number => limits?.[name] ?? 0;
  return Object.freeze({
    backend: "webgpu",
    maxTextureSize: limit("maxTextureDimension2D"),
    textureFormats: Object.freeze(["rgba8"]),
    multisampling: true,
    // WebGPU *devices* can render to `rgba16float`; this **backend** cannot
    // yet, because `RenderTargetFormat` is the single-member union `"rgba8"`
    // and off-screen targets are WP-R1.6. §62's report is about what the
    // backend offers, not about what the device could do if asked — the same
    // stance the WebGL backend takes on the same member.
    floatRenderTargets: false,
    timestampQueries: has("timestamp-query"),
    storageBuffers: limit("maxStorageBuffersPerShaderStage") > 0,
    computeShaders: limit("maxComputeWorkgroupSizeX") > 0,
    indirectDraw: true,
    compressedTextureFormats: Object.freeze(
      [
        "texture-compression-bc",
        "texture-compression-etc2",
        "texture-compression-astc",
      ].filter((name) => has(name)),
    ),
    shaderPrecision: "highp",
    maxUniformBufferBytes: limit("maxUniformBufferBindingSize"),
    maxBindings: limit("maxBindingsPerBindGroup"),
  } satisfies RendererCapabilities);
}

/** The resolved viewport rectangle, in §48's bottom-left pixel convention. */
interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Resolves a viewport's rectangle into drawing-buffer pixels — the same
 * arithmetic `webgl-renderer.ts` performs, kept identical on purpose so that
 * "the same viewport covers the same pixels on both backends" is true by
 * construction rather than by coincidence (§48).
 */
function resolveRect(
  view: Viewport,
  bufferWidth: number,
  bufferHeight: number,
  out: PixelRect,
): void {
  const scaleX = view.normalized === true ? bufferWidth : 1;
  const scaleY = view.normalized === true ? bufferHeight : 1;
  out.x = Math.round(view.x * scaleX);
  out.y = Math.round(view.y * scaleY);
  out.width = Math.max(0, Math.round(view.width * scaleX));
  out.height = Math.max(0, Math.round(view.height * scaleY));
}

/**
 * Issues `setStencilReference` when — and only when — `ref` differs from the
 * pass's current value, returning the value now in effect (§67, WP-R1.3).
 *
 * A one-line mirror rather than the GL backend's eight-field `GlState`,
 * because everything else GL mirrors is pipeline identity here; the reference
 * is the one §57 stencil field WebGPU leaves as a pass command. `ref` is read
 * defensively (`?? 0`) for the reason every §57 field is: a structurally-typed
 * material double may omit it, and the documented default is 0.
 */
function applyStencilReference(
  pass: GpuRenderPassEncoder,
  current: number,
  ref: number | undefined,
): number {
  const value = ref ?? 0;
  if (value !== current) {
    pass.setStencilReference(value);
  }
  return value;
}

/** Adds one *submitted* draw to §84's counters — the twin of the GL backend's. */
function countDraw(
  statistics: RenderStatistics,
  topology: string,
  vertexCount: number,
  instances: number,
): void {
  statistics.drawCalls += 1;
  statistics.instances += instances;
  if (topology === "triangle-list") {
    statistics.triangles += Math.floor(vertexCount / 3) * instances;
  }
}

/**
 * The WebGPU backend (§62 backend 1).
 *
 * ## Uniforms: one buffer, one bind group, a dynamic offset per draw
 *
 * See `wgpu-bindings.ts` for the layout and the argument. The consequence here
 * is the shape of a frame: the whole frame's uniform blocks are packed into one
 * CPU staging array while the command encoder records, uploaded with a single
 * `queue.writeBuffer` **before** `submit`, and read back by the recorded draws
 * through their dynamic offsets. Queue ordering makes that safe — a
 * `writeBuffer` enqueued before a `submit` is visible to it — and it means a
 * frame issues exactly one buffer upload however many objects it draws.
 *
 * The staging array and the GPU buffer are sized *before* recording, from an
 * upper bound (one block per view, plus one per view per item), so no
 * reallocation can happen mid-frame and invalidate the bind group the pass has
 * already been told to use. They only ever grow.
 *
 * ## One render pass per frame
 *
 * WebGPU's scissor and viewport are pass *commands*, not ambient device state,
 * so all the views of a frame are recorded into a single render pass with
 * `setViewport` / `setScissorRect` between them. This is the one place the
 * WebGPU backend is structurally safer than the GL one: there is no state
 * mirror to keep, nothing to restore in a `finally`, and a draw that throws
 * cannot leave state behind for the next frame — the pass is simply never
 * submitted.
 */
export class WebgpuRenderer implements Renderer {
  /** The §6b channel required by `Renderer` — `contextlost` (see the module header). */
  readonly events = new EventEmitter<RendererEventMap>();

  /**
   * §84's render counters (A-1). `null` until an application assigns a record;
   * the frame reads this once and every call site is guarded by that one
   * comparison, so a renderer with statistics off issues exactly the commands
   * it always did.
   */
  statistics: RenderStatistics | null = null;

  #capabilities: RendererCapabilities = Object.freeze({
    backend: "webgpu",
    maxTextureSize: 0,
    textureFormats: Object.freeze([]),
    multisampling: false,
    floatRenderTargets: false,
    timestampQueries: false,
    storageBuffers: false,
    computeShaders: false,
    indirectDraw: false,
    compressedTextureFormats: Object.freeze([]),
    shaderPrecision: "none",
    maxUniformBufferBytes: 0,
    maxBindings: 0,
  } satisfies RendererCapabilities);

  #canvas: WebgpuCanvas | null = null;

  #context: GpuCanvasContext | null = null;

  #device: GpuDevice | null = null;

  #format = FALLBACK_CANVAS_FORMAT;

  #pipelines: WgpuPipelineCache | null = null;

  #geometries: WgpuGeometryCache | null = null;

  #textures: WgpuTextureCache | null = null;

  #bindGroupLayout: GpuBindGroupLayout | null = null;

  #uniformBuffer: GpuBuffer | null = null;

  #bindGroup: GpuBindGroup | null = null;

  /**
   * §55's group-0 layout, created by the first sprite draw and by nothing
   * else (`wgpu-sprite.ts`) — the WP-R1.2 group-1 precedent, so a spriteless
   * application records the identical initialization transcript.
   */
  #spriteLayout: GpuBindGroupLayout | null = null;

  /**
   * The sprite draws' bind group over {@link WebgpuRenderer.#uniformBuffer} —
   * the same strided blocks, bound at {@link SPRITE_UNIFORM_BYTES} instead of
   * 144. Dropped (not destroyed — bind groups have no `destroy`) whenever the
   * buffer is regrown, and recreated by the next sprite draw.
   */
  #spriteBindGroup: GpuBindGroup | null = null;

  /**
   * §65 batching, or `null` (the default) to batch nothing — the opt-in seam
   * R-9 recorded for the GL backend, restated here byte for byte: the field is
   * read once per frame, the whole no-batching cost is one comparison per
   * item, and this class names the uploader `import type` only, so a bundle
   * that never calls `createWgpuBatching` never links it.
   *
   * ```ts
   * import { createWgpuBatching } from "@four/render-webgpu";
   * renderer.batching = createWgpuBatching();
   * ```
   */
  batching: WgpuRenderBatching | null = null;

  /** Blocks the uniform buffer and the staging array can hold. Only grows. */
  #uniformCapacity = 0;

  #uniformStaging = new Float32Array(0);

  #depthTexture: GpuTexture | null = null;

  #depthWidth = 0;

  #depthHeight = 0;

  /** The format `#depthTexture` holds — §67's clip frames upgrade it. */
  #depthFormat = DEPTH_FORMAT;

  #width = 300;

  #height = 150;

  #resolution = 1;

  #deviceLost = false;

  #disposed = false;

  /** The frame's render list, pooled across frames (§64, plan D7). */
  readonly #renderList: RenderItem[] = [];

  /** The current view's derived list, pooled across views and frames (R-8). */
  readonly #viewList: RenderItem[] = [];

  readonly #viewProjection = new Matrix4();

  readonly #frustum = new Frustum();

  readonly #rect: PixelRect = { x: 0, y: 0, width: 0, height: 0 };

  /** What this backend can do (§62), read off the device at initialization. */
  get capabilities(): RendererCapabilities {
    return this.#capabilities;
  }

  /** Whether {@link WebgpuRenderer.dispose} has run. Disposal is terminal. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Whether the device has been lost (§61). A lost renderer draws nothing. */
  get deviceLost(): boolean {
    return this.#deviceLost;
  }

  /**
   * Acquires an adapter, a device and the canvas's `"webgpu"` context (§61,
   * §45).
   *
   * Rejects with a `FourError` carrying `RENDERER_INITIALIZATION_FAILED` (§89)
   * when there is no canvas, no `navigator.gpu`, no adapter (which is what a
   * browser without the WebGPU flag reports — `navigator.gpu` exists and
   * `requestAdapter()` resolves `null`; see `register.ts`), no device, or when
   * the canvas will not give up a WebGPU context. Calling it twice rejects with
   * `INVALID_APPLICATION_STATE`.
   *
   * Nothing is compiled here. Pipelines are created lazily on first use, which
   * is a deliberate departure from the WebGL backend's compile-at-init —
   * `wgpu-pipeline-cache.ts` carries the measured argument.
   */
  async initialize(options?: RendererOptions): Promise<void> {
    this.#assertUsable("initialize");
    if (this.#device !== null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebgpuRenderer.initialize() was called twice; a renderer acquires " +
          "one device (§61).",
        { context: { method: "initialize" } },
      );
    }

    const canvas = requireCanvas(options?.canvas);
    const gpu = hostGpu();
    if (gpu === undefined) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "This environment has no `navigator.gpu`, so WebGPU is unavailable " +
          "(§62).",
      );
    }

    const adapter = await gpu.requestAdapter();
    if (adapter === null) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "WebGPU produced no adapter. `navigator.gpu` can exist in a browser " +
          "that cannot supply one — a disabled flag, a blocked GPU — which is " +
          "why initialization, not a synchronous probe, is the real gate (§62).",
      );
    }

    const device = await adapter.requestDevice();
    if (device === null) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "The WebGPU adapter produced no device (§62).",
      );
    }

    const context = asCanvasContext(canvas.getContext("webgpu"));
    if (context === null) {
      device.destroy();
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        'The canvas would not give up a `"webgpu"` context, or gave up ' +
          "something that is not one (§61).",
      );
    }

    this.#canvas = canvas;
    this.#device = device;
    this.#context = context;
    this.#format = gpu.getPreferredCanvasFormat?.() ?? FALLBACK_CANVAS_FORMAT;
    this.#capabilities = readCapabilities(device);

    context.configure({
      device,
      format: this.#format,
      // Straight alpha, so a canvas composites with the page exactly as the
      // WebGL backend's `alpha: true` drawing buffer does (§60a).
      alphaMode: "premultiplied",
    });

    const bindGroupLayout = createDrawBindGroupLayout(device);
    this.#bindGroupLayout = bindGroupLayout;
    const textures = new WgpuTextureCache(device);
    this.#textures = textures;
    // Providers, not layouts: group 1 is created by the first textured
    // upload and by nothing else (`wgpu-texture.ts`), and §55's group-0
    // layout by the first sprite draw (`wgpu-sprite.ts`) — so the pipelines
    // and the bind groups are built against one object each, without any
    // cache allocating anything at initialization.
    this.#pipelines = new WgpuPipelineCache(
      device,
      bindGroupLayout,
      () => textures.bindGroupLayout,
      () => this.#acquireSpriteLayout(device),
    );
    this.#geometries = new WgpuGeometryCache(device);
    this.#growUniforms(device, bindGroupLayout, 1);
    this.#watchDeviceLoss(device);
  }

  /**
   * Resizes the swap chain to `width` × `height` logical pixels at
   * `resolution` device pixels per logical pixel (§61, §45).
   *
   * The depth attachment is **not** reallocated here: it is allocated lazily by
   * the next frame that needs one, so a burst of resize events during a window
   * drag costs one allocation rather than one per event. Returns quietly while
   * the device is lost, recording the size for whenever a frame runs again.
   */
  resize(width: number, height: number, resolution = 1): void {
    this.#assertUsable("resize");
    this.#width = width;
    this.#height = height;
    this.#resolution = resolution;
    const canvas = this.#canvas;
    if (canvas === null || this.#deviceLost) {
      return;
    }
    canvas.width = Math.max(1, Math.round(width * resolution));
    canvas.height = Math.max(1, Math.round(height * resolution));
  }

  /**
   * Draws `root`'s subtree once per viewport, in array order (§61, §48, §64).
   *
   * The per-view sequence is: viewport rectangle, scissor rectangle, the clear
   * draw (`wgpu-unlit.ts` explains why a clear is a draw here), then this
   * view's items. §61's shared clear semantics hold unchanged — colour is
   * cleared only where the view carries a `clearColor`, depth is cleared for
   * every view, and both are confined to the rectangle.
   *
   * Items this tier has no pipeline for are skipped (see the module header), as
   * is a draw whose geometry will not upload. Returns without drawing while the
   * device is lost, when `views` is empty, and — for now — when a `target` is
   * passed: render-to-texture is WP-R1.6, and skipping the frame is the
   * behaviour §61 already defines for a target this backend cannot provide,
   * rather than a new failure mode.
   */
  render(
    root: Node,
    views: readonly Viewport[],
    interpolation?: RenderInterpolation,
    target?: unknown,
  ): void {
    this.#assertUsable("render");
    const device = this.#device;
    const context = this.#context;
    const pipelines = this.#pipelines;
    const geometries = this.#geometries;
    const textures = this.#textures;
    const layout = this.#bindGroupLayout;
    if (
      device === null ||
      context === null ||
      pipelines === null ||
      geometries === null ||
      textures === null ||
      layout === null ||
      this.#deviceLost ||
      views.length === 0 ||
      (target !== undefined && target !== null)
    ) {
      return;
    }

    const items =
      interpolation === undefined
        ? buildRenderList(root, this.#renderList)
        : buildInterpolatedRenderList(
            root,
            interpolation.poseBuffer,
            interpolation.alpha,
            this.#renderList,
          );

    // §67: does this frame clip at all? One property read, not a scan — mask
    // draws carry the comparators' first key, so a frame that clips puts one
    // at `items[0]` (R-23). The answer picks the frame's depth format; see
    // `DEPTH_STENCIL_FORMAT` for why stencil is per-frame rather than always.
    const frameClips = items.length > 0 && items[0].clip?.maskPass === true;
    const depthFormat = frameClips ? DEPTH_STENCIL_FORMAT : DEPTH_FORMAT;

    // Sized before recording: one clear block per view plus, at worst, one
    // block per item per view. Growing mid-pass would orphan the bind group
    // the pass has already been handed.
    this.#growUniforms(device, layout, views.length * (1 + items.length));
    const bindGroup = this.#bindGroup;
    const uniformBuffer = this.#uniformBuffer;
    if (bindGroup === null || uniformBuffer === null) {
      return;
    }

    const surfaceWidth = Math.max(
      1,
      Math.round(this.#width * this.#resolution),
    );
    const surfaceHeight = Math.max(
      1,
      Math.round(this.#height * this.#resolution),
    );
    const depthView = this.#acquireDepth(
      device,
      surfaceWidth,
      surfaceHeight,
      depthFormat,
    );
    const colorView = context.getCurrentTexture().createView();

    const encoder = device.createCommandEncoder({ label: "four:frame" });
    const pass = encoder.beginRenderPass({
      label: "four:views",
      colorAttachments: [
        {
          view: colorView,
          // Always "load", never "clear": §61 confines a clear to the viewport
          // rectangle, and `loadOp` has no scissor. See `wgpu-unlit.ts`.
          loadOp: "load",
          storeOp: "store",
        },
      ],
      // The stencil-aspect ops exist exactly when the format has the aspect —
      // WebGPU validation requires the pair on `depth24plus-stencil8` and
      // forbids it on `depth24plus`, which conveniently makes the clipless
      // descriptor the object WP-R1.1 recorded.
      depthStencilAttachment: frameClips
        ? {
            view: depthView,
            depthLoadOp: "load",
            depthStoreOp: "store",
            stencilLoadOp: "load",
            stencilStoreOp: "store",
          }
        : {
            view: depthView,
            depthLoadOp: "load",
            depthStoreOp: "store",
          },
    });

    const statistics = this.statistics;
    // §65's uploader (R-9's seam), read once for the frame exactly as
    // `statistics` is, and `null` by default: a renderer that never opted in
    // pays one comparison per item and records not a single extra call.
    const batching = this.batching;
    if (batching !== null) {
      batching.beginFrame();
    }
    let block = 0;
    // §67: the pass's stencil reference, a pass command mirrored here so it is
    // issued only when a stencil-carrying draw needs a different value.
    // WebGPU's initial value is 0, so a clipless frame issues none at all.
    let stencilReference = 0;

    for (const view of views) {
      resolveRect(view, surfaceWidth, surfaceHeight, this.#rect);
      const rect = this.#rect;
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }
      // §48's rectangle is bottom-left with +Y up; WebGPU's pass rectangles are
      // top-left. The flip happens here and never leaks into `Viewport` — the
      // clause §61 writes for "a backend whose native scissor rectangle is
      // top-left based".
      const top = Math.max(0, surfaceHeight - (rect.y + rect.height));
      pass.setViewport(rect.x, top, rect.width, rect.height, 0, 1);
      pass.setScissorRect(rect.x, top, rect.width, rect.height);

      const camera = view.camera;
      camera.updateViewMatrix();
      this.#viewProjection
        .copy(camera.projectionMatrix)
        .multiply(camera.viewMatrix);

      // The clear draw: colour where the view asks for it, depth always.
      const clearColor = view.clearColor;
      this.#writeBlock(
        block,
        this.#viewProjection,
        null,
        clearColor?.[0] ?? 0,
        clearColor?.[1] ?? 0,
        clearColor?.[2] ?? 0,
        clearColor?.[3] ?? 0,
      );
      this.#drawClear(
        pass,
        pipelines,
        bindGroup,
        block,
        clearColor !== undefined,
        // §67: on a clipping frame the same triangle zeroes the stencil
        // rectangle — a stencil buffer that is never cleared is a mask leaking
        // between frames and between views (the §33 defect, not a feature).
        frameClips,
      );
      block += 1;

      // §87's cull, against the un-remapped matrix in the WebGL clip convention
      // both backends share (see the module header on clip depth).
      this.#frustum.setFromViewProjection(this.#viewProjection);
      const viewItems = buildViewRenderList(items, view, this.#viewList, {
        frustum: this.#frustum,
      });

      for (let index = 0; index < viewItems.length; index += 1) {
        const item = viewItems[index];

        // §65 (R-9), and only when the application assigned an uploader: does
        // a run of compatible draws start here? The planner already broke runs
        // at clip-record boundaries (R-23), so the batch's clip is one value
        // for the whole merged draw, exactly as its material is. The check
        // sits above `geometries.acquire` for `webgl-renderer.ts`'s reason: a
        // batched run draws from the uploader's own buffers.
        if (batching !== null) {
          const batch = batching.next(viewItems, index);
          if (batch !== null) {
            // §55 and §57 resolve their texture from different fields; the
            // batch carries whichever one its material named (`batch.ts`). A
            // sprite batch whose texture will not resolve is skipped whole —
            // the run shares the material that named it — while an unlit
            // batch draws on untextured, exactly the two answers the
            // unbatched paths give (`gl-batch.ts`'s rule, restated).
            const batchTexture =
              batch.texture === null ? null : textures.acquire(batch.texture);
            if (batch.kind !== "sprite" || batchTexture !== null) {
              stencilReference = this.#drawBatch(
                pass,
                pipelines,
                bindGroup,
                batching,
                device,
                batch,
                batchTexture,
                block,
                depthFormat,
                frameClips,
                stencilReference,
                statistics,
              );
              block += 1;
            }
            // Consumed either way: a run skipped for an unresolvable texture
            // is skipped item by item in the unbatched path too.
            index += batch.items - 1;
            continue;
          }
        }

        const clip = item.clip ?? null;
        const maskPass = clip !== null && clip.maskPass;
        if (!maskPass && item.kind !== "unlit" && item.kind !== "sprite") {
          // WP-R1.5 onwards. Skipped, never approximated — and skipped
          // *before* the geometry cache uploads buffers nothing will bind.
          continue;
        }
        const record = geometries.acquire(item.geometry);
        if (record === null) {
          continue;
        }

        if (maskPass) {
          // §67's mask draw — **coverage, not shading**, whatever pipeline the
          // node's material names. The GL backend draws a mask through the
          // item's own program because a program costs nothing to reuse there;
          // here a pipeline is a compiled object, and with colour writes
          // forced off every family rasterises the identical fragment set, so
          // one flat unlit variant serves every mask (a lit or standard clip
          // node therefore masks correctly on this backend even before
          // WP-R1.5 gives its *content* a pipeline). Depth test and writes are
          // forced off with colour, per `RenderItemClip`'s contract: a mask
          // must not occlude, be occluded by, or be depth-rejected against
          // the content it masks.
          const pipeline = pipelines.acquire({
            kind: "unlit",
            vertexColors: false,
            map: false,
            blend: "none",
            depthTest: false,
            depthWrite: false,
            colorWrite: false,
            topology: record.topology,
            colorFormat: this.#format,
            depthFormat,
            stencil: stencilDescriptor(clip.stencil),
            batch: null,
          });
          if (pipeline === null) {
            // Unreachable for the reason the unlit path states; same
            // narrowing.
            continue;
          }
          // The colour is never read — writes are off — so the block carries
          // zeros rather than the material's colour: one canonical mask block,
          // whatever material the clip node wears.
          this.#writeBlock(
            block,
            this.#viewProjection,
            item.worldMatrix,
            0,
            0,
            0,
            0,
          );
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup, [block * UNIFORM_STRIDE_BYTES]);
          stencilReference = applyStencilReference(
            pass,
            stencilReference,
            clip.stencil.ref,
          );
          pass.setVertexBuffer(0, record.positionBuffer);
          if (record.indexBuffer !== null && record.indexFormat !== null) {
            pass.setIndexBuffer(record.indexBuffer, record.indexFormat);
            pass.drawIndexed(record.count);
          } else {
            pass.draw(record.count);
          }
          if (statistics !== null) {
            countDraw(statistics, record.topology, record.count, 1);
          }
          block += 1;
          continue;
        }

        if (item.kind === "sprite") {
          // §55's texture is required, and a sprite whose texture will not
          // resolve — a disposed one (§83), or a structurally typed material
          // double that carries none (`?? null`, the F16 defensive read) —
          // skips its draw, exactly as the GL sprite path skips it. (A
          // render-target texture resolves to the cache's zero-filled
          // allocation until WP-R1.6 teaches this backend to render into one
          // — the same answer the unlit `map` path gives.)
          const spriteMap = item.material.texture ?? null;
          const spriteTexture =
            spriteMap === null ? null : textures.acquire(spriteMap);
          if (spriteTexture !== null) {
            stencilReference = this.#drawSprite(
              device,
              pass,
              pipelines,
              uniformBuffer,
              item,
              record,
              spriteTexture,
              block,
              depthFormat,
              frameClips,
              clip,
              stencilReference,
              statistics,
            );
            block += 1;
          }
          continue;
        }
        // By elimination this is the unlit arm: masks and sprites continued
        // above, and the early guard skipped every other kind. The cast is the
        // loop's one, for `render-list.ts`'s `itemAt` reason — TypeScript
        // cannot carry the invariant across two `continue`s.
        const material = (item as UnlitItem).material;
        const vertexColors =
          material.vertexColors === true && record.colorBuffer !== null;
        // §57's `map` draws only when the geometry carries the uvs to sample it
        // with and the texture will upload — a texture disposed while still
        // referenced skips the draw rather than painting undefined content
        // (§83), which is the rule `gl-texture.ts` states and this honours by
        // falling through to the untextured variant's *absence*, not to it.
        const map = material.map ?? null;
        const textureRecord =
          map === null || record.uvBuffer === null
            ? null
            : textures.acquire(map);
        if (
          map !== null &&
          record.uvBuffer !== null &&
          textureRecord === null
        ) {
          continue;
        }
        const useMap = textureRecord !== null;
        // §67's resolution, one comparison (R-23): the engine's clip record
        // outranks the material's own §57 stencil, and `null` — every pre-§67
        // draw — resolves to the material's, which on a clipless frame's
        // stencil-free format resolves to nothing at all (see
        // `DEPTH_STENCIL_FORMAT` on the material-stencil tier).
        const stencilRecord = frameClips
          ? clip !== null
            ? clip.stencil
            : material.stencil
          : undefined;
        const pipeline = pipelines.acquire(
          this.#unlitDescriptor(
            material,
            vertexColors,
            useMap,
            record.topology,
            depthFormat,
            stencilRecord === undefined
              ? null
              : stencilDescriptor(stencilRecord),
          ),
        );
        if (pipeline === null) {
          // Unreachable given the class invariant — the cache answers `null`
          // only once disposed, and a disposed cache means a lost device,
          // which returned above. The narrowing has to happen somewhere, and
          // skipping the draw is the right behaviour if the invariant is ever
          // broken: §61 forbids throwing here.
          continue;
        }

        const opacity = material.opacity ?? 1;
        this.#writeBlock(
          block,
          this.#viewProjection,
          item.worldMatrix,
          material.color[0],
          material.color[1],
          material.color[2],
          material.color[3] * opacity,
        );

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup, [block * UNIFORM_STRIDE_BYTES]);
        if (stencilRecord !== undefined) {
          stencilReference = applyStencilReference(
            pass,
            stencilReference,
            stencilRecord.ref,
          );
        }
        // Slots are positional, in `unlitVertexBufferLayouts`' order: position,
        // then colours if the variant reads them, then uvs if it samples. One
        // counter, on both sides, so the two orders cannot drift.
        let slot = 0;
        pass.setVertexBuffer(slot, record.positionBuffer);
        if (vertexColors && record.colorBuffer !== null) {
          slot += 1;
          pass.setVertexBuffer(slot, record.colorBuffer);
        }
        if (textureRecord !== null && record.uvBuffer !== null) {
          slot += 1;
          pass.setVertexBuffer(slot, record.uvBuffer);
          pass.setBindGroup(MAP_BIND_GROUP_INDEX, textureRecord.bindGroup);
        }
        if (record.indexBuffer !== null && record.indexFormat !== null) {
          pass.setIndexBuffer(record.indexBuffer, record.indexFormat);
          pass.drawIndexed(record.count);
        } else {
          pass.draw(record.count);
        }
        if (statistics !== null) {
          countDraw(statistics, record.topology, record.count, 1);
        }
        block += 1;
      }
    }

    pass.end();
    // One upload for the whole frame, enqueued before the submit that reads it.
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      this.#uniformStaging,
      0,
      block * UNIFORM_STRIDE_FLOATS,
    );
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Releases every GPU resource this renderer owns (§83).
   *
   * Idempotent and terminal, and succeeds while the device is lost — the
   * caches drop their records without calling into a device that is gone. Every
   * other method throws `INVALID_APPLICATION_STATE` afterwards, as the other
   * two backends do.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#deviceLost) {
      this.#geometries?.forget();
      this.#textures?.forget();
      // §65's uploader, when the application assigned one (R-9): its buffers
      // belong to the lost device — dropped, never destroyed.
      this.batching?.forget();
    } else {
      this.#geometries?.dispose();
      this.#textures?.dispose();
      this.batching?.dispose();
      this.#uniformBuffer?.destroy();
      this.#depthTexture?.destroy?.();
      this.#context?.unconfigure?.();
      this.#device?.destroy();
    }
    this.#pipelines?.dispose();
    this.#geometries = null;
    this.#textures = null;
    this.#pipelines = null;
    this.#uniformBuffer = null;
    this.#bindGroup = null;
    this.#bindGroupLayout = null;
    this.#spriteLayout = null;
    this.#spriteBindGroup = null;
    this.#depthTexture = null;
    this.#context = null;
    this.#device = null;
    this.#canvas = null;
    this.events.removeAllListeners();
  }

  /** Builds the pipeline descriptor for one unlit draw — §57's state, as data. */
  #unlitDescriptor(
    material: UnlitMaterialLike,
    vertexColors: boolean,
    map: boolean,
    topology: "triangle-list" | "line-list",
    depthFormat: string,
    stencil: WgpuStencilDescriptor | null,
  ): WgpuPipelineDescriptor {
    return {
      kind: "unlit",
      vertexColors,
      map,
      blend:
        material.transparent === true
          ? (material.blendMode ?? "normal")
          : "none",
      depthTest: material.depthTest !== false,
      depthWrite: material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology,
      colorFormat: this.#format,
      depthFormat,
      stencil,
      batch: null,
    };
  }

  /** Records one view's clear (see `wgpu-unlit.ts` for why a clear is a draw). */
  #drawClear(
    pass: GpuRenderPassEncoder,
    pipelines: WgpuPipelineCache,
    bindGroup: GpuBindGroup,
    block: number,
    clearColor: boolean,
    frameClips: boolean,
  ): void {
    const pipeline = pipelines.acquire({
      kind: "clear",
      vertexColors: false,
      map: false,
      blend: "none",
      // `depthTest: false` compiles to `depthCompare: "always"`, which is what
      // makes this draw *set* depth to the far plane rather than test against
      // whatever the previous frame left there.
      depthTest: false,
      depthWrite: true,
      colorWrite: clearColor,
      topology: "triangle-list",
      colorFormat: this.#format,
      // §67: a clipping frame's clear also zeroes the stencil rectangle — see
      // `CLEAR_STENCIL`. Both comparisons ignore the stencil reference, so no
      // `setStencilReference` accompanies this draw.
      depthFormat: frameClips ? DEPTH_STENCIL_FORMAT : DEPTH_FORMAT,
      stencil: frameClips ? CLEAR_STENCIL : null,
      batch: null,
    });
    if (pipeline === null) {
      // Unreachable for the reason the unlit path states; same narrowing.
      return;
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup, [block * UNIFORM_STRIDE_BYTES]);
    pass.draw(CLEAR_VERTEX_COUNT);
  }

  /**
   * Records one §55 sprite draw (WP-R1.3): the sprite pipeline over the
   * quad's position stream, §55's uv derived in the vertex stage from the
   * `quad` uniform, the texture at group 1, the tint and quad in the sprite's
   * widened uniform block. Returns the stencil reference now in effect.
   *
   * §55's pipeline blends **by construction** — it did before §57's
   * `transparent` flag existed, and a textured quad with an alpha channel has
   * to composite whatever the flag says — so the blend state ignores
   * `transparent` and takes only the mode. Everything else the material
   * declares (depth test, depth write, colour write, §67's stencil) applies as
   * on any draw.
   */
  #drawSprite(
    device: GpuDevice,
    pass: GpuRenderPassEncoder,
    pipelines: WgpuPipelineCache,
    uniformBuffer: GpuBuffer,
    item: SpriteItem,
    record: WgpuGeometryRecord,
    texture: WgpuTextureRecord,
    block: number,
    depthFormat: string,
    frameClips: boolean,
    clip: ItemClip | null,
    stencilReference: number,
    statistics: RenderStatistics | null,
  ): number {
    const material = item.material;
    // §67's resolution — the unlit path's, verbatim: the engine's clip record
    // outranks the material's own §57 stencil.
    const stencilRecord = frameClips
      ? clip !== null
        ? clip.stencil
        : material.stencil
      : undefined;
    const pipeline = pipelines.acquire({
      kind: "sprite",
      vertexColors: false,
      // Not a variant: a sprite always samples (§55), so the flag is fixed
      // and the family has exactly one WGSL module.
      map: true,
      blend: material.blendMode ?? "normal",
      depthTest: material.depthTest !== false,
      depthWrite: material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology: record.topology,
      colorFormat: this.#format,
      depthFormat,
      stencil:
        stencilRecord === undefined ? null : stencilDescriptor(stencilRecord),
      batch: null,
    });
    if (pipeline === null) {
      // Unreachable for the unlit path's reason — this renderer always wires
      // both layout providers; same narrowing.
      return stencilReference;
    }

    const opacity = material.opacity ?? 1;
    const tint = material.tint;
    this.#writeBlock(
      block,
      this.#viewProjection,
      item.worldMatrix,
      tint[0],
      tint[1],
      tint[2],
      tint[3] * opacity,
    );
    this.#writeQuad(block, item, material);

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.#acquireSpriteBindGroup(device, uniformBuffer), [
      block * UNIFORM_STRIDE_BYTES,
    ]);
    pass.setBindGroup(MAP_BIND_GROUP_INDEX, texture.bindGroup);
    let reference = stencilReference;
    if (stencilRecord !== undefined) {
      reference = applyStencilReference(
        pass,
        stencilReference,
        stencilRecord.ref,
      );
    }
    pass.setVertexBuffer(0, record.positionBuffer);
    if (record.indexBuffer !== null && record.indexFormat !== null) {
      pass.setIndexBuffer(record.indexBuffer, record.indexFormat);
      pass.drawIndexed(record.count);
    } else {
      pass.draw(record.count);
    }
    if (statistics !== null) {
      countDraw(statistics, record.topology, record.count, 1);
    }
    return reference;
  }

  /**
   * Records one §65 merged draw (WP-R1.3): the batch pipeline — the unlit
   * shader family over the planner's interleaved stream — with the identity
   * model (positions arrive baked into world space, `batch.ts`), the shared
   * material's colour or tint, and the run's one clip record. The uploader
   * owns the buffers and the `drawIndexed`; see `wgpu-batch.ts`. Returns the
   * stencil reference now in effect.
   */
  #drawBatch(
    pass: GpuRenderPassEncoder,
    pipelines: WgpuPipelineCache,
    bindGroup: GpuBindGroup,
    batching: WgpuRenderBatching,
    device: GpuDevice,
    batch: RenderBatch,
    texture: WgpuTextureRecord | null,
    block: number,
    depthFormat: string,
    frameClips: boolean,
    stencilReference: number,
    statistics: RenderStatistics | null,
  ): number {
    const material = batch.material;
    const clip = batch.clip ?? null;
    const stencilRecord = frameClips
      ? clip !== null
        ? clip.stencil
        : material.stencil
      : undefined;
    // An unlit batch whose named texture failed to resolve draws untextured
    // over the same interleaved stream — the uv floats are strided over
    // (`batchVertexBufferLayout`). A sprite batch never reaches here with
    // `null`; the caller skipped the whole run.
    const mapRecord = batch.hasUvs ? texture : null;
    const topology = batch.mode === "lines" ? "line-list" : "triangle-list";
    const pipeline = pipelines.acquire({
      kind: "batch",
      vertexColors: batch.hasColors,
      map: mapRecord !== null,
      // §55's pipeline blends by construction, so a sprite batch does too;
      // an unlit batch blends only when its material asks (§57).
      blend:
        batch.kind === "sprite" || material.transparent === true
          ? (material.blendMode ?? "normal")
          : "none",
      depthTest: material.depthTest !== false,
      depthWrite: material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology,
      colorFormat: this.#format,
      depthFormat,
      stencil:
        stencilRecord === undefined ? null : stencilDescriptor(stencilRecord),
      batch: { uvs: batch.hasUvs, colors: batch.hasColors },
    });
    if (pipeline === null) {
      // Unreachable for the unlit path's reason; same narrowing.
      return stencilReference;
    }

    // `model: null` is the identity — positions arrive in world space.
    const color = batch.color;
    this.#writeBlock(
      block,
      this.#viewProjection,
      null,
      color[0],
      color[1],
      color[2],
      color[3] * batch.opacity,
    );
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup, [block * UNIFORM_STRIDE_BYTES]);
    if (mapRecord !== null) {
      pass.setBindGroup(MAP_BIND_GROUP_INDEX, mapRecord.bindGroup);
    }
    let reference = stencilReference;
    if (stencilRecord !== undefined) {
      reference = applyStencilReference(
        pass,
        stencilReference,
        stencilRecord.ref,
      );
    }
    batching.draw(device, pass, batch);
    if (statistics !== null) {
      // One draw call for `batch.items` items — which is exactly what §65
      // asks a diagnostic to make visible (§84): the triangle count is
      // unchanged and `drawCalls` falls.
      countDraw(statistics, topology, batch.indexCount, 1);
    }
    return reference;
  }

  /** §55's group-0 layout, one per renderer, created on first use. */
  #acquireSpriteLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#spriteLayout ??= createSpriteBindGroupLayout(device);
    return this.#spriteLayout;
  }

  /**
   * The sprite draws' bind group over the current uniform buffer, created by
   * the first sprite draw after initialization or after a regrowth — see the
   * field's note.
   */
  #acquireSpriteBindGroup(device: GpuDevice, buffer: GpuBuffer): GpuBindGroup {
    this.#spriteBindGroup ??= device.createBindGroup({
      label: "four:sprite-uniforms",
      layout: this.#acquireSpriteLayout(device),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: SPRITE_UNIFORM_BYTES },
        },
      ],
    });
    return this.#spriteBindGroup;
  }

  /**
   * Packs §55's `quad` — the local rectangle the whole texture maps onto —
   * into the sprite block's last sixteen bytes: the geometry's own bounds for
   * a frameless sprite, R-29's affine reparametrization for a framed one. The
   * same two expressions the GL sprite path uploads through `setQuad`, over
   * the same cached `computeBounds()` (a version comparison per draw, not a
   * pass over the vertices).
   */
  #writeQuad(
    block: number,
    item: SpriteItem,
    material: SpriteMaterialLike,
  ): void {
    const bounds = item.geometry.computeBounds();
    const minX = bounds.min.x;
    const minY = bounds.min.y;
    const width = bounds.max.x - minX;
    const height = bounds.max.y - minY;
    const staging = this.#uniformStaging;
    const base = block * UNIFORM_STRIDE_FLOATS + SPRITE_QUAD_OFFSET / 4;
    // `?? null` for the render list's reason: a structurally typed sprite item
    // built before frames existed reports `undefined`, which reads "no frame".
    const frame = item.frame ?? null;
    if (frame === null) {
      staging[base] = minX;
      staging[base + 1] = minY;
      staging[base + 2] = width;
      staging[base + 3] = height;
      return;
    }
    // The rectangle the *whole* texture would occupy, given that the quad
    // shows `frame` of it — `map` is the engine-side texture (its texel size),
    // not the GPU record this draw binds.
    const map = material.texture;
    staging[base] = minX - (frame.x * width) / frame.width;
    staging[base + 1] = minY - (frame.y * height) / frame.height;
    staging[base + 2] = (width * map.width) / frame.width;
    staging[base + 3] = (height * map.height) / frame.height;
  }

  /** Packs one `DrawUniforms` block into the staging array at `block`'s stride. */
  #writeBlock(
    block: number,
    viewProjection: Matrix4,
    model: Matrix4 | null,
    red: number,
    green: number,
    blue: number,
    alpha: number,
  ): void {
    const staging = this.#uniformStaging;
    const base = block * UNIFORM_STRIDE_FLOATS;
    const viewBase = base + DRAW_VIEW_PROJECTION_OFFSET / 4;
    const modelBase = base + DRAW_MODEL_OFFSET / 4;
    const colorBase = base + DRAW_COLOR_OFFSET / 4;
    for (let index = 0; index < 16; index += 1) {
      // `Matrix4.elements` is a `Float64Array`; the uniform block is `f32`, so
      // the narrowing happens here, element by element, rather than through an
      // intermediate allocation per draw.
      staging[viewBase + index] = viewProjection.elements[index];
      staging[modelBase + index] =
        model === null ? (index % 5 === 0 ? 1 : 0) : model.elements[index];
    }
    staging[colorBase] = red;
    staging[colorBase + 1] = green;
    staging[colorBase + 2] = blue;
    staging[colorBase + 3] = alpha;
  }

  /**
   * Grows the uniform buffer, its staging array and the bind group to hold at
   * least `blocks` blocks. Never shrinks: a frame that drew ten thousand
   * objects once is likely to again, and shrinking would trade a steady state
   * for an allocation.
   */
  #growUniforms(
    device: GpuDevice,
    layout: GpuBindGroupLayout,
    blocks: number,
  ): void {
    if (blocks <= this.#uniformCapacity) {
      return;
    }
    // Doubling, so a frame that grows by one item does not reallocate.
    const capacity = Math.max(blocks, this.#uniformCapacity * 2, 16);
    this.#uniformBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "four:draw-uniforms",
      size: capacity * UNIFORM_STRIDE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#uniformBuffer = buffer;
    this.#uniformStaging = new Float32Array(capacity * UNIFORM_STRIDE_FLOATS);
    this.#uniformCapacity = capacity;
    this.#bindGroup = device.createBindGroup({
      label: "four:draw-uniforms",
      layout,
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: DRAW_UNIFORM_BYTES },
        },
      ],
    });
    // The sprite bind group pointed at the destroyed buffer; dropped here and
    // recreated lazily by the next sprite draw, so a scene whose sprites are
    // gone stops paying for one. Growth happens before the pass is recorded,
    // so no recorded draw can be holding the dropped group.
    this.#spriteBindGroup = null;
  }

  /**
   * Allocates (or reuses) the depth attachment for the current surface size
   * and the frame's format — `depth24plus`, upgraded to carry §67's stencil
   * planes for a frame that clips (see `DEPTH_STENCIL_FORMAT`). A scene that
   * starts or stops clipping reallocates once, like a resize.
   */
  #acquireDepth(
    device: GpuDevice,
    width: number,
    height: number,
    format: string,
  ): GpuTextureView {
    if (
      this.#depthTexture === null ||
      this.#depthWidth !== width ||
      this.#depthHeight !== height ||
      this.#depthFormat !== format
    ) {
      this.#depthTexture?.destroy?.();
      this.#depthTexture = device.createTexture({
        label: "four:depth",
        size: [width, height],
        format,
        usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
      });
      this.#depthWidth = width;
      this.#depthHeight = height;
      this.#depthFormat = format;
    }
    return this.#depthTexture.createView();
  }

  /**
   * Subscribes to §61's device loss.
   *
   * The handler is attached once, at initialization, and survives `dispose` by
   * checking the disposed flag: a device destroyed by `dispose()` resolves
   * `lost` with `reason: "destroyed"`, and that is teardown, not a loss event —
   * emitting `contextlost` from it would tell an application its device
   * vanished when the application is the one that let it go.
   */
  #watchDeviceLoss(device: GpuDevice): void {
    const lost = device.lost;
    if (lost === undefined) {
      return;
    }
    void lost.then((info) => {
      if (this.#disposed || info.reason === "destroyed") {
        return;
      }
      this.#deviceLost = true;
      this.#geometries?.forget();
      this.#textures?.forget();
      // §65's uploader (R-9): its buffers died with the device, like every
      // other handle — dropped, never destroyed.
      this.batching?.forget();
      this.#pipelines?.dispose();
      this.#spriteLayout = null;
      this.#spriteBindGroup = null;
      this.events.emit("contextlost", { renderer: this });
    });
  }

  #assertUsable(method: string): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `WebgpuRenderer.${method}() was called on a disposed renderer; ` +
          "disposal is terminal (§83).",
        { context: { method, disposed: true } },
      );
    }
  }
}
