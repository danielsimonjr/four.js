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
 * This is WP-R1.1 through WP-R1.6 of the R-1 plan: device and context
 * acquisition, the registry opt-in, per-view clears, the **unlit** tier —
 * flat, vertex-coloured and §57-`map`-textured — plus WP-R1.3's **sprite**
 * pipeline (§55; §56's `Text` needs nothing more — a label is one textured
 * unlit draw, R-28), the opt-in §65 **batching** uploader (`wgpu-batch.ts`),
 * §67's **clip** application (masks write stencil bit planes, clipped
 * draws test them — see `DEPTH_STENCIL_FORMAT` below for the per-frame
 * stencil-format decision), WP-R1.5's two **shaded** tiers — §68's
 * Lambert `lit` family and §59's metallic-roughness `standard` family, both
 * under one per-view light uniform block (`wgpu-lights.ts`) — and WP-R1.6's
 * off-screen tier: **render targets** (`wgpu-render-target.ts`, sampled back
 * through R-4's `resolveTexture` seam with the same feedback refusal), §70's
 * **effects** (`renderEffect`, `wgpu-effect.ts`), and §61's **`readPixels`**
 * (`wgpu-readback.ts` — the whole-target, honestly asynchronous form). All of
 * it drawn through the real `buildRenderList` → `buildViewRenderList` → draw
 * path; WP-R1.4 added no pipeline — §50 shapes and §58 paints were already
 * ordinary unlit draws, and that packet's deliverable is the
 * transcript-identity tests saying so. The remaining pipelines (particles,
 * shadows, compute — packets R1.7–R1.8 — RFC 0003's
 * `skinned-unlit`/`skinned-lit`, which need a joint-palette pipeline this
 * backend does not stage yet, and RFC 0001's `"graph"` effect, which waits on
 * the WGSL emitter) are *absent*, not stubbed: an item this tier cannot draw
 * is skipped, exactly as a draw with no geometry record is, because a
 * pipeline that silently draws the wrong thing is worse than one that does
 * not exist yet (the recorded WP-9.1 rule, applied to a backend). The one
 * exception is deliberate and narrow: a §67 **mask** is coverage, not
 * shading, so a clip node of any material family masks correctly today
 * through the flat unlit pipeline with colour writes off.
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

import { DEV, EventEmitter, FourError, devWarnOnce } from "@four/core";
import { Frustum, Matrix4 } from "@four/math";
import {
  COLOR_GRADE_DEFAULTS,
  buildInterpolatedRenderList,
  buildRenderList,
  buildViewRenderList,
  collectSceneLights,
  createSceneLights,
  isRenderTargetTexture,
  type EffectRenderPass,
  type RenderBatch,
  type RenderInterpolation,
  type RenderItem,
  type RenderStatistics,
  type RenderTarget,
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
import {
  EFFECT_BIND_GROUP_INDEX,
  EFFECT_PASS_VERTEX_COUNT,
  EFFECT_UNIFORM_BYTES,
  createEffectBindGroupLayout,
  type WgpuEffectKind,
} from "./wgpu-effect.js";
import { WgpuGeometryCache, type WgpuGeometryRecord } from "./wgpu-geometry.js";
import {
  LIGHTS_BIND_GROUP_INDEX,
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_STRIDE_BYTES,
  LIGHT_UNIFORM_STRIDE_FLOATS,
  SHADED_MAP_BIND_GROUP_INDEX,
  createLightsBindGroupLayout,
  writeLightUniforms,
} from "./wgpu-lights.js";
import {
  WgpuPipelineCache,
  type WgpuPipelineDescriptor,
  type WgpuStencilDescriptor,
} from "./wgpu-pipeline-cache.js";
import { readTexturePixels } from "./wgpu-readback.js";
import {
  RENDER_TARGET_COLOR_FORMAT,
  WgpuRenderTargetCache,
  type WgpuRenderTargetRecord,
} from "./wgpu-render-target.js";
import {
  STANDARD_EMISSIVE_OFFSET,
  STANDARD_SURFACE_OFFSET,
  STANDARD_UNIFORM_BYTES,
  createStandardBindGroupLayout,
} from "./wgpu-standard.js";
import {
  SPRITE_QUAD_OFFSET,
  SPRITE_UNIFORM_BYTES,
  createSpriteBindGroupLayout,
} from "./wgpu-sprite.js";
import { WgpuTextureCache, type WgpuCacheableTexture } from "./wgpu-texture.js";
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

/** A shaded render item (§68 lit or §59 standard, WP-R1.5). */
type ShadedItem = Extract<RenderItem, { kind: "lit" | "standard" }>;

/** §59's material as this backend reads it — base colour, surface, §57 state. */
type StandardMaterialLike = Extract<
  ShadedItem,
  { kind: "standard" }
>["material"];

/**
 * The frame's flattened lighting (§68), pooled across frames exactly as the
 * GL backend's module-level record is: `collectSceneLights` rewrites every
 * field in place, and the frame consumes it synchronously. Only refreshed for
 * frames that contain a lit or standard item, so a scene that never shades
 * never pays the collection walk.
 */
const sceneLights = createSceneLights();

/**
 * Scratch for the grade's uniform upload (WP-R1.6) — one per module, exactly
 * like the GL backend's `gradeScratch`, and copied at record time by the
 * recording double, so per-call reuse cannot alias transcripts.
 */
const effectGradeScratch = new Float32Array(4);

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
    // — WP-R1.6's targets allocate exactly that (`wgpu-render-target.ts`),
    // and the report moves when the union widens (R-4's staged format tier).
    // §62's report is about what the backend offers, not about what the
    // device could do if asked — the same stance the WebGL backend takes on
    // the same member.
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

/**
 * Turns a texture a material points at into the bind group to set, whichever
 * kind it is (R-4's `resolveTexture` seam, WP-R1.6) — the one place in the
 * draw path that knows there are two.
 *
 * An ordinary `Texture` resolves through {@link WgpuTextureCache}, exactly as
 * before — one marker read away from the call it always made, which is what
 * keeps a scene that never renders to texture byte-identical at the device
 * boundary. A render-target texture has no CPU texels — it *is* a target's
 * colour attachment — so it resolves through {@link WgpuRenderTargetCache}
 * instead, which allocates the target if this is the first the backend has
 * heard of it (sampling a never-rendered target reads WebGPU's zero-filled
 * allocation: transparent black, the GL answer).
 *
 * `null` means "skip this draw": a disposed resource, or — the case only this
 * function can see — a **feedback loop**, a material sampling the very target
 * this frame is drawing into. Reading and writing one surface in a single
 * pass is undefined behaviour on every backend, and undefined content is
 * worse than a missing draw (§83, R-4). Ping-pong between two targets to
 * express what that draw was reaching for.
 *
 * Returns the bind group itself rather than a record: the group is the one
 * member every draw arm sets, and wrapping it would allocate per draw.
 */
function resolveFrameTexture(
  textures: WgpuTextureCache,
  renderTargets: WgpuRenderTargetCache,
  activeTarget: RenderTarget | null,
  texture: WgpuCacheableTexture,
): GpuBindGroup | null {
  if (!isRenderTargetTexture(texture)) {
    return textures.acquire(texture)?.bindGroup ?? null;
  }
  const source = texture.renderTarget;
  if (source === activeTarget) {
    return null;
  }
  return renderTargets.sample(source);
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

  /**
   * §61's render targets (WP-R1.6, `wgpu-render-target.ts`) — the fourth
   * id/version cache. Constructed at initialization (which allocates
   * nothing) and consulted only by a frame that names a target, an effect,
   * a readback, or a material sampling one.
   */
  #renderTargets: WgpuRenderTargetCache | null = null;

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
   * The standard draws' group-0 layout and bind group over the same strided
   * buffer, bound at {@link STANDARD_UNIFORM_BYTES} (WP-R1.5) — the sprite
   * pair's lifecycle verbatim: layout created by the first standard draw,
   * bind group dropped on regrowth and recreated by the next one.
   */
  #standardLayout: GpuBindGroupLayout | null = null;

  #standardBindGroup: GpuBindGroup | null = null;

  /**
   * §68's per-view light block (WP-R1.5, `wgpu-lights.ts`): the group-1
   * layout, one buffer holding a 768-byte-strided block per rendered view,
   * the single bind group the shaded draws offset into, and the CPU staging
   * the view loop packs. All `null`/empty until the first frame that contains
   * a lit or standard item — the WP-R1.2 lazy-subsystem precedent — so an
   * unshaded application records not one of these allocations.
   */
  #lightsLayout: GpuBindGroupLayout | null = null;

  #lightsBuffer: GpuBuffer | null = null;

  #lightsBindGroup: GpuBindGroup | null = null;

  #lightsStaging = new Float32Array(0);

  /** Light blocks the buffer and staging can hold. Only grows. */
  #lightsCapacity = 0;

  /**
   * §70's grade uniform block (WP-R1.6, `wgpu-effect.ts`): the group-1
   * layout, the 16-byte buffer, and the one bind group over it. All `null`
   * until the first **grade** — a copy or an output transform binds no
   * uniforms at all, and an application that never runs an effect allocates
   * none of these (the lazy-subsystem precedent, fourth application).
   */
  #effectLayout: GpuBindGroupLayout | null = null;

  #effectBuffer: GpuBuffer | null = null;

  #effectBindGroup: GpuBindGroup | null = null;

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

  /**
   * The colour format of the surface the **current** `render` call draws
   * into — the swap chain's for an on-screen frame,
   * {@link RENDER_TARGET_COLOR_FORMAT} for an off-screen one (WP-R1.6).
   * Written at the top of every frame and read by the descriptor builders,
   * so the six draw arms did not each grow a parameter; on-screen frames
   * write the value the arms always read, which is what keeps their
   * transcripts byte-identical.
   */
  #frameFormat = FALLBACK_CANVAS_FORMAT;

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
    // upload and by nothing else (`wgpu-texture.ts`), §55's group-0
    // layout by the first sprite draw (`wgpu-sprite.ts`), and the grade's
    // block by the first grade (`wgpu-effect.ts`) — so the pipelines
    // and the bind groups are built against one object each, without any
    // cache allocating anything at initialization.
    this.#pipelines = new WgpuPipelineCache(
      device,
      bindGroupLayout,
      () => textures.bindGroupLayout,
      () => this.#acquireSpriteLayout(device),
      () => this.#acquireLightsLayout(device),
      () => this.#acquireStandardLayout(device),
      () => this.#acquireEffectLayout(device),
    );
    this.#geometries = new WgpuGeometryCache(device);
    // Constructed here because construction allocates nothing (the family
    // rule); its sampling layout provider is the texture cache's, so a
    // sampled target binds against the object every `map` pipeline names.
    this.#renderTargets = new WgpuRenderTargetCache(
      device,
      () => textures.bindGroupLayout,
    );
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
   * Items this tier has no pipeline for are skipped (see the module header),
   * as is a draw whose geometry will not upload. Returns without drawing
   * while the device is lost, when `views` is empty, and when `target` is a
   * disposed render target (§83's "disposed resources still in use" — the
   * frame must not draw into a released surface). An off-screen frame
   * (WP-R1.6) attaches the target's own colour and depth views, resolves its
   * viewport rectangles against the target's size, and bakes the target's
   * formats into its pipelines; everything else — clears, culling, the draw
   * arms — is the identical code path, which is what makes "the same scene
   * draws the same way off screen" true by construction.
   */
  render(
    root: Node,
    views: readonly Viewport[],
    interpolation?: RenderInterpolation,
    target?: RenderTarget | null,
  ): void {
    this.#assertUsable("render");
    const device = this.#device;
    const context = this.#context;
    const pipelines = this.#pipelines;
    const geometries = this.#geometries;
    const textures = this.#textures;
    const renderTargets = this.#renderTargets;
    const layout = this.#bindGroupLayout;
    if (
      device === null ||
      context === null ||
      pipelines === null ||
      geometries === null ||
      textures === null ||
      renderTargets === null ||
      layout === null ||
      this.#deviceLost ||
      views.length === 0
    ) {
      return;
    }

    // §61's fourth argument (R-4): resolved before anything else, because a
    // disposed target skips the whole frame and an allocation is what gives
    // the frame its attachment views, size, and formats.
    const activeTarget = target ?? null;
    let targetRecord: WgpuRenderTargetRecord | null = null;
    if (activeTarget !== null) {
      targetRecord = renderTargets.acquire(activeTarget);
      if (targetRecord === null) {
        return;
      }
    }
    // The surface's colour format, baked into every pipeline this frame
    // acquires — the swap chain's on screen, `rgba8unorm` off screen
    // (`wgpu-render-target.ts` on why the two differ).
    this.#frameFormat =
      targetRecord === null ? this.#format : RENDER_TARGET_COLOR_FORMAT;

    const items =
      interpolation === undefined
        ? buildRenderList(root, this.#renderList)
        : buildInterpolatedRenderList(
            root,
            interpolation.poseBuffer,
            interpolation.alpha,
            this.#renderList,
          );

    // §67: does this frame *ask* to clip? One property read, not a scan —
    // mask draws carry the comparators' first key, so a frame that clips puts
    // one at `items[0]` (R-23). On screen the answer picks the frame's depth
    // format (see `DEPTH_STENCIL_FORMAT` for why stencil is per-frame rather
    // than always); off screen the target's attachment is fixed at its
    // allocation, so whether the frame *may* clip is the target's `stencil`
    // option — GL's `stencilAttached`, read off the record.
    const wantsClips = items.length > 0 && items[0].clip?.maskPass === true;
    const frameStencil =
      targetRecord === null ? wantsClips : targetRecord.stencil;
    const frameClips = wantsClips && frameStencil;
    // §67's exhaustion case, reachable here only off screen (the on-screen
    // attachment is this backend's own and always widens): a clip into a
    // stencil-less target has nowhere to write its mask, so the mask draws
    // are skipped and the subtree draws **unclipped** — failing toward
    // drawing, like the ninth clip (R-23), and warned like GL's same case.
    if (DEV && wantsClips && !frameStencil) {
      devWarnOnce(
        "webgpu-clip-without-stencil",
        "§67: this scene sets `clip = true` but the render target being " +
          "drawn into has no stencil buffer, so there is nothing to write " +
          "the mask into and the clipped subtrees draw unclipped. Give the " +
          "render target `{ stencil: true }` to allocate one (R-7).",
      );
    }
    const depthFormat: string | null =
      targetRecord === null
        ? frameStencil
          ? DEPTH_STENCIL_FORMAT
          : DEPTH_FORMAT
        : targetRecord.depthFormat;

    // §68 (WP-R1.5): does this frame shade at all? One `kind` comparison per
    // item, the GL backend's scan — minus the skinned-lit kind it includes
    // there, deliberately: a skinned item is transcript-invisible on this
    // backend (WP-R1.4's pinned claim), and collecting lights for draws that
    // will be skipped would allocate the light block into that byte-identical
    // tape. Collected once per call, not per view — lights are frame state,
    // like the render list; the eye is the per-view half, packed per view
    // below.
    let hasLitItems = false;
    for (const item of items) {
      if (item.kind === "lit" || item.kind === "standard") {
        hasLitItems = true;
        break;
      }
    }
    if (hasLitItems) {
      collectSceneLights(root, sceneLights);
      // Sized before recording, like the draw uniforms below: one block per
      // view at most, and growth mid-pass would orphan the bound group.
      this.#growLights(device, views.length);
    }

    // Sized before recording: one clear block per view plus, at worst, one
    // block per item per view. Growing mid-pass would orphan the bind group
    // the pass has already been handed.
    this.#growUniforms(device, layout, views.length * (1 + items.length));
    const bindGroup = this.#bindGroup;
    const uniformBuffer = this.#uniformBuffer;
    if (bindGroup === null || uniformBuffer === null) {
      return;
    }

    // Normalized viewport rectangles resolve against the surface actually
    // being drawn into: the drawing buffer on screen, the target's own size
    // off screen — read off the *record*, so the `setViewport` call and the
    // allocation agree even if the application resized the target after this
    // call began (the GL backend's rule, unchanged).
    const surfaceWidth =
      targetRecord?.width ??
      Math.max(1, Math.round(this.#width * this.#resolution));
    const surfaceHeight =
      targetRecord?.height ??
      Math.max(1, Math.round(this.#height * this.#resolution));
    // On screen the depth attachment is this renderer's own, sized to the
    // drawing buffer and format-upgraded for a clipping frame; off screen it
    // is the target's — or absent, for a `depth: false` target, in which case
    // the pass carries no depth attachment at all and §61's per-view depth
    // clear has nothing to owe.
    const depthView =
      targetRecord === null
        ? this.#acquireDepth(
            device,
            surfaceWidth,
            surfaceHeight,
            frameStencil ? DEPTH_STENCIL_FORMAT : DEPTH_FORMAT,
          )
        : targetRecord.depthView;
    const colorView =
      targetRecord === null
        ? context.getCurrentTexture().createView()
        : targetRecord.colorView;

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
      // descriptor the object WP-R1.1 recorded. Off screen the aspect is the
      // target's `stencil` option, whether or not this frame clips.
      ...(depthView === null
        ? {}
        : {
            depthStencilAttachment: frameStencil
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
          }),
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
    // §68: how many light blocks the view loop has packed — one per *rendered*
    // view, so skipped (zero-area) views leave no gap and every uploaded byte
    // was written this frame (`writeLightUniforms`' determinism contract).
    let lightBlock = 0;
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

      // §68 (WP-R1.5): this view's light block — the frame's lights plus the
      // per-view eye, read straight out of the camera's world matrix
      // translation column (`updateViewMatrix()` above resolved it; the GL
      // standard branch's read, verbatim). CPU packing only; the one upload
      // happens after the pass, beside the draw uniforms'.
      let lightBase = 0;
      if (hasLitItems) {
        lightBase = lightBlock * LIGHT_UNIFORM_STRIDE_BYTES;
        const eye = camera.transform.worldMatrix.elements;
        writeLightUniforms(
          this.#lightsStaging,
          lightBlock * LIGHT_UNIFORM_STRIDE_FLOATS,
          sceneLights,
          eye[12],
          eye[13],
          eye[14],
        );
        lightBlock += 1;
      }

      // The clear draw: colour where the view asks for it, depth whenever the
      // surface has a depth buffer (§61's shared clear semantics — a
      // `depth: false` target has no buffer to owe a clear, and a view of one
      // that also names no clearColor has nothing to clear at all, so the
      // draw is skipped whole rather than issued empty).
      const clearColor = view.clearColor;
      if (clearColor !== undefined || depthFormat !== null) {
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
          depthFormat,
          // §67: on a stencil-carrying surface the same triangle zeroes the
          // stencil rectangle — a stencil buffer that is never cleared is a
          // mask leaking between frames and between views (the §33 defect,
          // not a feature).
          frameStencil,
        );
        block += 1;
      }

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
            // unbatched paths give (`gl-batch.ts`'s rule, restated). Resolved
            // through the R-4 seam, so a batch sampling the active target is
            // a feedback loop and resolves `null` like any other draw's.
            const batchTexture =
              batch.texture === null
                ? null
                : resolveFrameTexture(
                    textures,
                    renderTargets,
                    activeTarget,
                    batch.texture,
                  );
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
                frameStencil,
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
        // §67 into a stencil-less target (the DEV warning above): the mask
        // has no planes to write, so its draw is skipped and its subtree —
        // whose stencil records resolve to nothing on this frame's format —
        // draws unclipped.
        if (maskPass && !frameClips) {
          continue;
        }
        if (
          !maskPass &&
          item.kind !== "unlit" &&
          item.kind !== "sprite" &&
          item.kind !== "lit" &&
          item.kind !== "standard"
        ) {
          // WP-R1.6 onwards (particles), and RFC 0003's skinned kinds until a
          // joint-palette pipeline exists here. Skipped, never approximated —
          // and skipped *before* the geometry cache uploads buffers nothing
          // will bind.
          continue;
        }
        // A shaded draw asks the cache for the normal stream too (WP-R1.5);
        // a mask does not — coverage, not shading — and every other kind
        // passes the default `false`, i.e. exactly the call it always made.
        const record = geometries.acquire(
          item.geometry,
          !maskPass && (item.kind === "lit" || item.kind === "standard"),
        );
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
            colorFormat: this.#frameFormat,
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
          // resolve — a disposed one (§83), a structurally typed material
          // double that carries none (`?? null`, the F16 defensive read), or
          // a feedback loop on the active target (WP-R1.6, R-4's rule) —
          // skips its draw, exactly as the GL sprite path skips it.
          const spriteMap = item.material.texture ?? null;
          const spriteTexture =
            spriteMap === null
              ? null
              : resolveFrameTexture(
                  textures,
                  renderTargets,
                  activeTarget,
                  spriteMap,
                );
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
              frameStencil,
              clip,
              stencilReference,
              statistics,
            );
            block += 1;
          }
          continue;
        }

        if (item.kind === "lit" || item.kind === "standard") {
          // WP-R1.5's two shaded arms — the unlit arm's shape with three
          // additions: the normal stream picks a variant, the light block
          // binds at group 1 with this view's offset, and the standard kind
          // writes its widened uniform block through its own group-0 layout.
          const material = item.material;
          // The variant is the record's answer, not the geometry's: a
          // normal-less geometry selects the normal-less variant, whose
          // vertex stage writes the zero vector GL's default attribute
          // yields — "ambient only", the documented shading (`wgpu-lit.ts`).
          const normals = record.normalBuffer !== null;
          // §57's `map`, resolved exactly as the unlit arm resolves it: draws
          // only with uvs to sample by and a texture that resolves; a named
          // texture that fails — disposed (§83), or a feedback loop on the
          // active target (R-4) — skips the draw, a missing uv stream
          // degrades to the untextured variant's absence.
          const map = material.map ?? null;
          const mapBindGroup =
            map === null || record.uvBuffer === null
              ? null
              : resolveFrameTexture(textures, renderTargets, activeTarget, map);
          if (
            map !== null &&
            record.uvBuffer !== null &&
            mapBindGroup === null
          ) {
            continue;
          }
          const useMap = mapBindGroup !== null;
          // The lights group is read off the *field*, not a frame local, and
          // read here — after the material's getters have run — so a
          // reentrant mid-frame `dispose()` inside application code (the
          // pinned WP-R1.3 scenario, reachable through a material accessor
          // too) skips this and every remaining shaded draw instead of
          // binding a dropped group (§61: the frame must not throw).
          const lightsBindGroup = this.#lightsBindGroup;
          if (lightsBindGroup === null) {
            continue;
          }
          // §67's resolution, the unlit arm's verbatim.
          const stencilRecord = frameStencil
            ? clip !== null
              ? clip.stencil
              : material.stencil
            : undefined;
          const pipeline = pipelines.acquire({
            kind: item.kind,
            vertexColors: false,
            map: useMap,
            blend:
              material.transparent === true
                ? (material.blendMode ?? "normal")
                : "none",
            // A pass with no depth attachment normalizes both depth bits off
            // (`depth: false` targets, WP-R1.6): the pipeline omits its
            // depth-stencil state either way, and the normalization keeps
            // the cache key canonical for that one pipeline.
            depthTest: depthFormat !== null && material.depthTest !== false,
            depthWrite: depthFormat !== null && material.depthWrite !== false,
            colorWrite: material.colorWrite !== false,
            topology: record.topology,
            colorFormat: this.#frameFormat,
            depthFormat,
            stencil:
              stencilRecord === undefined
                ? null
                : stencilDescriptor(stencilRecord),
            batch: null,
            normals,
          });
          if (pipeline === null) {
            // Unreachable given the class invariant — the unlit arm's
            // narrowing, same reason: §61 forbids throwing here.
            continue;
          }

          const opacity = material.opacity ?? 1;
          if (item.kind === "standard") {
            // §59's block: base colour in `DrawUniforms.color`'s slot, then
            // the two vec4s only this family reads — bound through the
            // widened group-0 layout over the same strided buffer.
            const baseColor = item.material.baseColor;
            this.#writeBlock(
              block,
              this.#viewProjection,
              item.worldMatrix,
              baseColor[0],
              baseColor[1],
              baseColor[2],
              baseColor[3] * opacity,
            );
            this.#writeSurface(block, item.material);
            pass.setPipeline(pipeline);
            pass.setBindGroup(
              0,
              this.#acquireStandardBindGroup(device, uniformBuffer),
              [block * UNIFORM_STRIDE_BYTES],
            );
          } else {
            const color = item.material.color;
            this.#writeBlock(
              block,
              this.#viewProjection,
              item.worldMatrix,
              color[0],
              color[1],
              color[2],
              color[3] * opacity,
            );
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup, [block * UNIFORM_STRIDE_BYTES]);
          }
          // The view's light block, at this view's dynamic offset — bound per
          // draw rather than mirrored, because slot 1 is also where the unlit
          // family binds its textures, so "what group 1 holds" is not a
          // per-view constant (and eliding rebinds here would have to model
          // that, for a saving the GL backend's per-draw uniform calls never
          // had either).
          pass.setBindGroup(LIGHTS_BIND_GROUP_INDEX, lightsBindGroup, [
            lightBase,
          ]);
          if (stencilRecord !== undefined) {
            stencilReference = applyStencilReference(
              pass,
              stencilReference,
              stencilRecord.ref,
            );
          }
          // Slots are positional, in `shadedVertexBufferLayouts`' order:
          // position, then normals if the variant shades with them, then uvs
          // if it samples. One counter, both sides.
          let slot = 0;
          pass.setVertexBuffer(slot, record.positionBuffer);
          if (normals) {
            slot += 1;
            pass.setVertexBuffer(slot, record.normalBuffer);
          }
          if (mapBindGroup !== null) {
            slot += 1;
            pass.setVertexBuffer(slot, record.uvBuffer);
            pass.setBindGroup(SHADED_MAP_BIND_GROUP_INDEX, mapBindGroup);
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
          continue;
        }
        // By elimination this is the unlit arm: masks, sprites and the shaded
        // kinds continued above, and the early guard skipped every other
        // kind. The cast is the loop's one, for `render-list.ts`'s `itemAt`
        // reason — TypeScript cannot carry the invariant across two
        // `continue`s.
        const material = (item as UnlitItem).material;
        const vertexColors =
          material.vertexColors === true && record.colorBuffer !== null;
        // §57's `map` draws only when the geometry carries the uvs to sample it
        // with and the texture will upload — a texture disposed while still
        // referenced skips the draw rather than painting undefined content
        // (§83), which is the rule `gl-texture.ts` states and this honours by
        // falling through to the untextured variant's *absence*, not to it.
        const map = material.map ?? null;
        const mapBindGroup =
          map === null || record.uvBuffer === null
            ? null
            : resolveFrameTexture(textures, renderTargets, activeTarget, map);
        if (map !== null && record.uvBuffer !== null && mapBindGroup === null) {
          continue;
        }
        const useMap = mapBindGroup !== null;
        // §67's resolution, one comparison (R-23): the engine's clip record
        // outranks the material's own §57 stencil, and `null` — every pre-§67
        // draw — resolves to the material's, which on a stencil-free surface
        // resolves to nothing at all (see `DEPTH_STENCIL_FORMAT` on the
        // material-stencil tier; off screen the aspect is the target's
        // `stencil` option, so R-7's mask-by-hand tier works into a
        // stencilled target whether or not the frame clips — GL's parity).
        const stencilRecord = frameStencil
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
        if (mapBindGroup !== null && record.uvBuffer !== null) {
          slot += 1;
          pass.setVertexBuffer(slot, record.uvBuffer);
          pass.setBindGroup(MAP_BIND_GROUP_INDEX, mapBindGroup);
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
    // §68: the frame's light blocks, one strided block per rendered view —
    // the same one-upload-per-frame shape, absent to the byte on a frame with
    // no shaded item. The buffer is re-read off the field so a reentrant
    // mid-frame dispose skips the upload along with the draws.
    const lightsBuffer = this.#lightsBuffer;
    if (lightBlock > 0 && lightsBuffer !== null) {
      device.queue.writeBuffer(
        lightsBuffer,
        0,
        this.#lightsStaging,
        0,
        lightBlock * LIGHT_UNIFORM_STRIDE_FLOATS,
      );
    }
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Draws one §70 full-screen effect (WP-R1.6) — `pass.source`'s colour
   * attachment over the whole of `pass.target`, or of the swap chain, through
   * `pass.effect`. The normative contract is on `@four/render`'s
   * `Renderer.renderEffect`; the GL backend's method documents the shared
   * readings and this one differs in exactly two ways, both structural:
   *
   * - **There is no state envelope.** GL borrows the framebuffer binding, the
   *   rectangles, the depth test and a texture unit inside a `try`/`finally`;
   *   here the effect is its own render pass in its own command encoder, and
   *   a WebGPU pass has no ambient state to corrupt — the one place this
   *   backend is structurally safer, restated for §70. No scissor or viewport
   *   is set: a pass's defaults are the whole attachment, which is exactly
   *   what "an effect covers its destination surface" means.
   * - **The effect kind is pipeline identity, not uniform state** — a lazy
   *   per-(kind × format) pipeline (`wgpu-effect.ts` carries the inverted
   *   R-19 argument), so a chain that only ever copies compiles one module
   *   and uploads no uniforms at all; only a grade touches the 16-byte block.
   *
   * ## What is skipped rather than thrown (§61, §83)
   *
   * Everything, on `render`'s terms — a lost device, a source that is not a
   * render-target texture (a caller that bypassed `validateEffectRenderPass`),
   * a disposed source or destination, an effect kind this backend does not
   * draw (RFC 0001's `"graph"` waits on the WGSL emitter and is *absent*, not
   * approximated — the closed-union rule), and the **feedback loop**: a pass
   * whose destination is the very surface it samples, refused here exactly as
   * R-4 refuses it per draw, with `RenderGraph.validate` reporting it
   * statically as `"feedback"` so the mistake is normally caught at setup.
   */
  renderEffect(pass: EffectRenderPass): void {
    this.#assertUsable("renderEffect");
    const device = this.#device;
    const context = this.#context;
    const pipelines = this.#pipelines;
    const renderTargets = this.#renderTargets;
    if (
      device === null ||
      context === null ||
      pipelines === null ||
      renderTargets === null ||
      this.#deviceLost
    ) {
      return;
    }

    // Read structurally, like every argument this backend meets: the marker
    // guard rather than the type, so a plain `Texture` handed over from
    // JavaScript gets a skipped effect instead of a black screen.
    const source = pass.source;
    if (!isRenderTargetTexture(source)) {
      return;
    }
    const sourceTarget = source.renderTarget;
    const destination = pass.target ?? null;
    if (destination === sourceTarget) {
      return;
    }
    const effect = pass.effect;
    const kind = effect.kind;
    if (kind !== "copy" && kind !== "grade" && kind !== "output-transform") {
      return;
    }

    // Resolved before anything is recorded: `sample`/`acquire` never throw,
    // so a disposed surface skips the effect rather than half-drawing it.
    const sourceGroup = renderTargets.sample(sourceTarget);
    if (sourceGroup === null) {
      return;
    }
    let destinationRecord: WgpuRenderTargetRecord | null = null;
    if (destination !== null) {
      destinationRecord = renderTargets.acquire(destination);
      if (destinationRecord === null) {
        return;
      }
    }

    if (kind === "grade") {
      // The coefficient reads are *application accessors* (a structurally
      // typed effect object may compute them), and application code can do
      // anything — including disposing this renderer (the pinned reentrant
      // scenario, reachable here through an effect descriptor's getter). So
      // they run before anything is acquired, and the pipeline acquisition
      // below is what notices a mid-call teardown: a disposed cache answers
      // `null` and the effect is skipped without resurrecting an allocation.
      // The padding lane is written, not assumed — an uploaded byte nobody
      // wrote is history (§33).
      effectGradeScratch[0] = effect.exposure ?? COLOR_GRADE_DEFAULTS.exposure;
      effectGradeScratch[1] = effect.contrast ?? COLOR_GRADE_DEFAULTS.contrast;
      effectGradeScratch[2] =
        effect.saturation ?? COLOR_GRADE_DEFAULTS.saturation;
      effectGradeScratch[3] = 0;
    }

    const pipeline = pipelines.acquire(
      this.#effectDescriptor(
        kind,
        destinationRecord === null ? this.#format : RENDER_TARGET_COLOR_FORMAT,
      ),
    );
    if (pipeline === null) {
      // A reentrant dispose inside a coefficient accessor above — the one
      // reachable path — or a broken class invariant; §61 forbids throwing
      // here either way, so the effect is skipped (the draw arms' narrowing).
      return;
    }

    let gradeGroup: GpuBindGroup | null = null;
    if (kind === "grade") {
      // The coefficients ride the shared 16-byte block, uploaded before the
      // submit that reads them (queue order).
      device.queue.writeBuffer(
        this.#acquireEffectBuffer(device),
        0,
        effectGradeScratch,
      );
      gradeGroup = this.#acquireEffectBindGroup(device);
    }

    const colorView =
      destinationRecord === null
        ? context.getCurrentTexture().createView()
        : destinationRecord.colorView;
    const encoder = device.createCommandEncoder({ label: "four:effect" });
    const renderPass = encoder.beginRenderPass({
      label: `four:effect:${kind}`,
      // "load", not "clear": an effect replaces every covered texel with its
      // own fragment, so there is nothing to clear — and §70's contract is
      // that it *replaces* what the destination held, never composites.
      colorAttachments: [{ view: colorView, loadOp: "load", storeOp: "store" }],
    });
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, sourceGroup);
    if (gradeGroup !== null) {
      renderPass.setBindGroup(EFFECT_BIND_GROUP_INDEX, gradeGroup);
    }
    renderPass.draw(EFFECT_PASS_VERTEX_COUNT);
    renderPass.end();
    device.queue.submit([encoder.finish()]);
    const statistics = this.statistics;
    if (statistics !== null) {
      // One draw call, one instance, one triangle (§84) — counted because it
      // was submitted, exactly as a scene draw is.
      countDraw(statistics, "triangle-list", EFFECT_PASS_VERTEX_COUNT, 1);
    }
  }

  /**
   * Reads back `target`'s colour attachment as tightly packed RGBA8 bytes —
   * §61's `readPixels`, in the whole-target form (WP-R1.6; the `region`
   * parameter arrives with `Rectangle2` in `@four/math`, RFC 0005's named
   * prerequisite, rather than with an invented rectangle type).
   *
   * **Asynchronous, honestly and permanently.** WebGPU has no synchronous
   * readback — `copyTextureToBuffer` + `mapAsync` is the only path (probe-
   * verified; `wgpu-readback.ts`) — and §61's own sketch types the member
   * `Promise<ArrayBuffer>`, which is the RFC 0005 argument this method is the
   * standing evidence for. The result is `width * height * 4` bytes, rows
   * **bottom-to-top** (§7a's Y-up; `wgpu-readback.ts` records the decision).
   *
   * A target that was never rendered into reads back its zero-filled
   * allocation — transparent black, the same defined answer sampling one
   * gives. Unlike the frame methods this one **rejects** rather than skips:
   * it is not called inside a frame, its caller is awaiting a value, and a
   * silently empty buffer would be undefined content by another name.
   * Rejections carry a `FourError`: `INVALID_APPLICATION_STATE` for a
   * disposed renderer, one never initialized, or a disposed target;
   * `DEVICE_LOST` while the device is lost (§89's "a caller asks for
   * something that cannot be satisfied while lost");
   * `UNSUPPORTED_GPU_FEATURE` on a device double without the readback entry
   * points (their presence is the capability — `webgpu-device.ts`).
   */
  async readPixels(target: RenderTarget): Promise<ArrayBuffer> {
    this.#assertUsable("readPixels");
    const device = this.#device;
    const renderTargets = this.#renderTargets;
    if (device === null || renderTargets === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebgpuRenderer.readPixels() needs an initialized renderer (§61).",
        { context: { method: "readPixels" } },
      );
    }
    if (this.#deviceLost) {
      throw new FourError(
        "DEVICE_LOST",
        "WebgpuRenderer.readPixels() was called while the device is lost; " +
          "there is no surface to read (§61, §89).",
      );
    }
    const record = renderTargets.acquire(target);
    if (record === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `readPixels() was asked for render target ${target.id}, which is ` +
          "disposed (§83).",
        { context: { target: target.id } },
      );
    }
    const pixels = await readTexturePixels(
      device,
      record.colorTexture,
      record.width,
      record.height,
    );
    if (pixels === null) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        "This device surface does not implement the readback entry points " +
          "(copyTextureToBuffer / mapAsync); presence is the capability " +
          "(WP-R1.6).",
      );
    }
    return pixels;
  }

  /** Builds the pipeline descriptor for one §70 effect draw (WP-R1.6). */
  #effectDescriptor(
    kind: WgpuEffectKind,
    colorFormat: string,
  ): WgpuPipelineDescriptor {
    return {
      kind: "effect",
      vertexColors: false,
      // An effect always samples its source; the flag is fixed, as §55's is.
      map: true,
      // §70: no blending — an effect replaces — and no depth attachment at
      // all, so both depth bits are off and `depthFormat` is `null`.
      blend: "none",
      depthTest: false,
      depthWrite: false,
      colorWrite: true,
      topology: "triangle-list",
      colorFormat,
      depthFormat: null,
      stencil: null,
      batch: null,
      effect: kind,
    };
  }

  /** The grade's 16-byte uniform buffer, created by the first grade. */
  #acquireEffectBuffer(device: GpuDevice): GpuBuffer {
    this.#effectBuffer ??= device.createBuffer({
      label: "four:effect-uniforms",
      size: EFFECT_UNIFORM_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    return this.#effectBuffer;
  }

  /** §70's group-1 layout, one per renderer, created on first use (WP-R1.6). */
  #acquireEffectLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#effectLayout ??= createEffectBindGroupLayout(device);
    return this.#effectLayout;
  }

  /**
   * The grade's bind group over the shared block — the sprite pair's
   * lifecycle, fourth subsystem: created by the first grade, dropped on
   * device loss and disposal. The buffer never regrows (it is one block), so
   * unlike the sprite group nothing else ever drops it.
   */
  #acquireEffectBindGroup(device: GpuDevice): GpuBindGroup {
    this.#effectBindGroup ??= device.createBindGroup({
      label: "four:effect-uniforms",
      layout: this.#acquireEffectLayout(device),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.#acquireEffectBuffer(device),
            offset: 0,
            size: EFFECT_UNIFORM_BYTES,
          },
        },
      ],
    });
    return this.#effectBindGroup;
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
      this.#renderTargets?.forget();
      // §65's uploader, when the application assigned one (R-9): its buffers
      // belong to the lost device — dropped, never destroyed.
      this.batching?.forget();
    } else {
      this.#geometries?.dispose();
      this.#textures?.dispose();
      this.#renderTargets?.dispose();
      this.batching?.dispose();
      this.#uniformBuffer?.destroy();
      this.#lightsBuffer?.destroy();
      this.#effectBuffer?.destroy();
      this.#depthTexture?.destroy?.();
      this.#context?.unconfigure?.();
      this.#device?.destroy();
    }
    this.#pipelines?.dispose();
    this.#geometries = null;
    this.#textures = null;
    this.#renderTargets = null;
    this.#pipelines = null;
    this.#uniformBuffer = null;
    this.#bindGroup = null;
    this.#bindGroupLayout = null;
    this.#spriteLayout = null;
    this.#spriteBindGroup = null;
    this.#standardLayout = null;
    this.#standardBindGroup = null;
    this.#lightsLayout = null;
    this.#lightsBuffer = null;
    this.#lightsBindGroup = null;
    this.#effectLayout = null;
    this.#effectBuffer = null;
    this.#effectBindGroup = null;
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
    depthFormat: string | null,
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
      // Normalized off on a depthless pass (WP-R1.6) — the shaded arm's note.
      depthTest: depthFormat !== null && material.depthTest !== false,
      depthWrite: depthFormat !== null && material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology,
      colorFormat: this.#frameFormat,
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
    depthFormat: string | null,
    frameStencil: boolean,
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
      // Off exactly when the surface has no depth buffer to clear — a
      // `depth: false` target's colour-only clear (WP-R1.6).
      depthWrite: depthFormat !== null,
      colorWrite: clearColor,
      topology: "triangle-list",
      colorFormat: this.#frameFormat,
      // §67: a stencil-carrying surface's clear also zeroes the stencil
      // rectangle — see `CLEAR_STENCIL`. Both comparisons ignore the stencil
      // reference, so no `setStencilReference` accompanies this draw.
      depthFormat,
      stencil: frameStencil ? CLEAR_STENCIL : null,
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
    mapBindGroup: GpuBindGroup,
    block: number,
    depthFormat: string | null,
    frameStencil: boolean,
    clip: ItemClip | null,
    stencilReference: number,
    statistics: RenderStatistics | null,
  ): number {
    const material = item.material;
    // §67's resolution — the unlit path's, verbatim: the engine's clip record
    // outranks the material's own §57 stencil.
    const stencilRecord = frameStencil
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
      // Normalized off on a depthless pass (WP-R1.6) — the shaded arm's note.
      depthTest: depthFormat !== null && material.depthTest !== false,
      depthWrite: depthFormat !== null && material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology: record.topology,
      colorFormat: this.#frameFormat,
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
    pass.setBindGroup(MAP_BIND_GROUP_INDEX, mapBindGroup);
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
    mapBindGroup: GpuBindGroup | null,
    block: number,
    depthFormat: string | null,
    frameStencil: boolean,
    stencilReference: number,
    statistics: RenderStatistics | null,
  ): number {
    const material = batch.material;
    const clip = batch.clip ?? null;
    const stencilRecord = frameStencil
      ? clip !== null
        ? clip.stencil
        : material.stencil
      : undefined;
    // An unlit batch whose named texture failed to resolve draws untextured
    // over the same interleaved stream — the uv floats are strided over
    // (`batchVertexBufferLayout`). A sprite batch never reaches here with
    // `null`; the caller skipped the whole run.
    const mapGroup = batch.hasUvs ? mapBindGroup : null;
    const topology = batch.mode === "lines" ? "line-list" : "triangle-list";
    const pipeline = pipelines.acquire({
      kind: "batch",
      vertexColors: batch.hasColors,
      map: mapGroup !== null,
      // §55's pipeline blends by construction, so a sprite batch does too;
      // an unlit batch blends only when its material asks (§57).
      blend:
        batch.kind === "sprite" || material.transparent === true
          ? (material.blendMode ?? "normal")
          : "none",
      // Normalized off on a depthless pass (WP-R1.6) — the shaded arm's note.
      depthTest: depthFormat !== null && material.depthTest !== false,
      depthWrite: depthFormat !== null && material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology,
      colorFormat: this.#frameFormat,
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
    if (mapGroup !== null) {
      pass.setBindGroup(MAP_BIND_GROUP_INDEX, mapGroup);
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

  /** §68's group-1 layout, one per renderer, created on first use (WP-R1.5). */
  #acquireLightsLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#lightsLayout ??= createLightsBindGroupLayout(device);
    return this.#lightsLayout;
  }

  /** §59's group-0 layout, one per renderer, created on first use (WP-R1.5). */
  #acquireStandardLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#standardLayout ??= createStandardBindGroupLayout(device);
    return this.#standardLayout;
  }

  /**
   * The standard draws' bind group over the current uniform buffer, created
   * by the first standard draw after initialization or after a regrowth —
   * `#acquireSpriteBindGroup`'s lifecycle, third block size over one buffer.
   */
  #acquireStandardBindGroup(
    device: GpuDevice,
    buffer: GpuBuffer,
  ): GpuBindGroup {
    this.#standardBindGroup ??= device.createBindGroup({
      label: "four:standard-uniforms",
      layout: this.#acquireStandardLayout(device),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: STANDARD_UNIFORM_BYTES },
        },
      ],
    });
    return this.#standardBindGroup;
  }

  /**
   * Packs §59's two extra vec4s — the emissive term, then metalness and
   * roughness — into the spare bytes of `block`'s stride, after the
   * `DrawUniforms`-shaped 144 `#writeBlock` wrote (`wgpu-standard.ts`'s
   * layout). The unused slots are written, not assumed: the staging array is
   * reused across frames, and an uploaded byte nobody wrote this frame is a
   * transcript that depends on history.
   */
  #writeSurface(block: number, material: StandardMaterialLike): void {
    const staging = this.#uniformStaging;
    const base = block * UNIFORM_STRIDE_FLOATS;
    const emissiveBase = base + STANDARD_EMISSIVE_OFFSET / 4;
    const emissive = material.emissive;
    staging[emissiveBase] = emissive[0];
    staging[emissiveBase + 1] = emissive[1];
    staging[emissiveBase + 2] = emissive[2];
    staging[emissiveBase + 3] = 0;
    const surfaceBase = base + STANDARD_SURFACE_OFFSET / 4;
    staging[surfaceBase] = material.metalness;
    staging[surfaceBase + 1] = material.roughness;
    staging[surfaceBase + 2] = 0;
    staging[surfaceBase + 3] = 0;
  }

  /**
   * Grows the lights buffer, its staging array and its bind group to hold at
   * least `blocks` per-view blocks (WP-R1.5). `#growUniforms`' contract one
   * buffer over: never shrinks, doubles, and everything it creates is created
   * lazily — an application that never shades never reaches this method, so
   * never allocates a lights layout, buffer or group at all.
   */
  #growLights(device: GpuDevice, blocks: number): void {
    if (blocks <= this.#lightsCapacity) {
      return;
    }
    const capacity = Math.max(blocks, this.#lightsCapacity * 2, 4);
    this.#lightsBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "four:lights",
      size: capacity * LIGHT_UNIFORM_STRIDE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#lightsBuffer = buffer;
    this.#lightsStaging = new Float32Array(
      capacity * LIGHT_UNIFORM_STRIDE_FLOATS,
    );
    this.#lightsCapacity = capacity;
    this.#lightsBindGroup = device.createBindGroup({
      label: "four:lights",
      layout: this.#acquireLightsLayout(device),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: LIGHT_UNIFORM_BYTES },
        },
      ],
    });
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
    // The sprite and standard bind groups pointed at the destroyed buffer;
    // dropped here and recreated lazily by the next draw of each kind, so a
    // scene whose sprites (or standard surfaces) are gone stops paying for
    // one. Growth happens before the pass is recorded, so no recorded draw
    // can be holding a dropped group.
    this.#spriteBindGroup = null;
    this.#standardBindGroup = null;
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
      this.#renderTargets?.forget();
      // §65's uploader (R-9): its buffers died with the device, like every
      // other handle — dropped, never destroyed.
      this.batching?.forget();
      this.#pipelines?.dispose();
      this.#spriteLayout = null;
      this.#spriteBindGroup = null;
      // §68's block, like every allocation above: the handles died with the
      // device — dropped, never destroyed.
      this.#standardLayout = null;
      this.#standardBindGroup = null;
      this.#lightsLayout = null;
      this.#lightsBuffer = null;
      this.#lightsBindGroup = null;
      this.#lightsCapacity = 0;
      // §70's grade block (WP-R1.6): same terms.
      this.#effectLayout = null;
      this.#effectBuffer = null;
      this.#effectBindGroup = null;
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
