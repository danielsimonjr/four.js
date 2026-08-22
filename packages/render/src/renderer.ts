/**
 * The renderer interface (§61) — the seam every backend implements.
 *
 * §61 declares one interface:
 *
 * ```ts
 * interface Renderer {
 *   readonly capabilities: RendererCapabilities;
 *   initialize(options: RendererOptions): Promise<void>;
 *   render(scene: Scene, views: readonly Viewport[]): void;
 *   resize(width: number, height: number, resolution: number): void;
 *   createTexture(source: TextureSource): Texture;
 *   createRenderTarget(options: RenderTargetOptions): RenderTarget;
 *   readPixels?(target: RenderTarget, region?: Rectangle2): Promise<ArrayBuffer>;
 *   dispose(): void;
 * }
 * ```
 *
 * and the sentence that gives this package its reason to exist: *"the logical
 * scene shall remain independent of the selected backend."* Nothing in
 * `@four/scene`, `@four/motion`, or `@four/physics` may name a GL context, a
 * WebGPU device, or a canvas; a backend is chosen at the application edge and
 * reaches the engine only through this interface. That is why the interface
 * lives here, in the backend-independent `@four/render`, and why
 * `@four/render-webgl` (WP-3.5) depends on this package rather than the other
 * way round.
 *
 * ## What this packet ships, and what it defers
 *
 * The MVP tier (§120: WebGL 2, unlit colored geometry) needs four of §61's
 * eight members. The other three are **deferred, not dropped**, and are written
 * out as a typed TODO on {@link Renderer} with the sections that define the
 * types they need. Adding methods to an interface later is a breaking change
 * for implementors — which is exactly why the deferrals are named in the type's
 * documentation now, so a backend author knows what is coming.
 *
 * Two shapes depart from §61's literal text, both forced by the landed types:
 *
 * - **`render(root, views)` takes a `Node`, not a `Scene`.** §64's render list
 *   is built from any subtree root (`buildRenderList(root, out)`), a `Scene`
 *   *is* a `Node`, and the looser parameter costs nothing while making
 *   off-screen and preview passes over a subtree expressible without a second
 *   entry point (decision, WP-3.4).
 * - **`resize`'s `resolution` is optional.** §61 makes it required; §45's
 *   `ApplicationOptions.resolution` is optional and its natural default is
 *   `devicePixelRatio`, which a headless caller does not have. Defaulting to
 *   `1` here keeps `resize(w, h)` meaningful in tests and Node (decision,
 *   WP-3.4). Passing a resolution explicitly is the browser path.
 * - **`render` takes a third, optional {@link RenderInterpolation}
 *   argument.** §61's signature is `render(scene, views)`, which has nowhere to
 *   put §43's `interpolationAlpha` — and §43 is not optional behaviour: a
 *   renderer that draws the raw fixed-step poses judders whenever the display
 *   rate is not a multiple of the simulation rate. Passing the pose buffer and
 *   the alpha *per call* rather than configuring them on the renderer keeps the
 *   backend stateless about time, lets one renderer serve two applications, and
 *   keeps the non-interpolated path (an editor preview, a single-step
 *   screenshot) a matter of omitting an argument (decision, WP-3.6).
 * - **`render` takes a fourth, optional {@link @four/render!RenderTarget | RenderTarget}
 *   argument** (R-4, 2026-08-07). §48 puts the target on the *viewport*
 *   (`Viewport.renderTarget`), which is where it belongs and where it will
 *   land; `Viewport` is `@four/scene`'s type and R-4's file set did not include
 *   that package, so the minimal tier routes the target through the render call
 *   instead. The two are compatible rather than competing: a per-view target is
 *   a loop around this argument, so the packet that adds the field implements
 *   it by calling `render` once per target group and this parameter keeps
 *   working for the single-target case (deviation from R-4's closure plan,
 *   recorded here and in `render-target.ts`).
 *
 * ## Interface, not base class (§6b composition)
 *
 * §61's context-loss contract requires the renderer to *emit* events, and
 * `EventEmitter` (§6b) is a class. A TypeScript interface cannot extend a
 * class, and forcing every backend to inherit from `EventEmitter` would spend
 * the one base class a backend has — WebGL and WebGPU backends may well want
 * their own hierarchy. So {@link Renderer} **composes** an emitter through a
 * readonly {@link Renderer.events} property rather than inheriting one
 * (decision, WP-3.4). `Node` inherits (plan D1) because a node *is* an event
 * target; a renderer merely *has* an event channel.
 *
 * ## Clear and viewport semantics (shared by all backends)
 *
 * Stated here once so backends agree and tests can assert against one contract;
 * see {@link Renderer.render}.
 */

import type { Disposable } from "@four/core";
import { EventEmitter, FourError } from "@four/core";
import type { Node, PoseBuffer, Viewport } from "@four/scene";

import type { EffectRenderPass } from "./effect-pass.js";
import type { RenderTarget } from "./render-target.js";
import type { RenderStatistics } from "./statistics.js";

/**
 * Which backend an implementation drives (§62).
 *
 * §62's list is WebGPU, WebGL 2, Canvas 2D, SVG, and a headless/software tier;
 * `"null"` is this package's name for that last tier — see {@link NullRenderer}.
 * A string rather than an enum so it serializes, logs, and compares as itself
 * (§7a house style, matching `TransformAuthority` and `DepthRange`).
 */
export type RendererBackend = "webgpu" | "webgl2" | "canvas2d" | "svg" | "null";

/**
 * What a backend can do (§62).
 *
 * §62 requires capability reporting to cover maximum texture dimensions,
 * texture formats, multisampling, floating-point targets, timestamp queries,
 * storage buffers, compute shaders, indirect draw, compressed textures, shader
 * precision, and maximum uniforms and bindings — and requires applications to
 * be able to declare required and optional capabilities against that set.
 *
 * Two members carried this record until WP-R1.1 (2026-08-21), when the WebGPU
 * backend arrived and made the rest of §62's list answerable: a backend that
 * *can* run compute has to be able to say so, and an application that needs
 * compute has to be able to ask. The widening is deliberately done **once**,
 * with all of §62's list, rather than a field per packet — a capability record
 * that grows a member per pipeline churns every implementor once per pipeline.
 *
 * ## Every added member is optional, and absent means "not reported"
 *
 * The original wording of this doc is the reason, and it is kept because it is
 * still the rule: *reporting a field the backend has not queried would be worse
 * than not reporting it, because capability negotiation is precisely the place
 * where a confident wrong answer costs a crash.* So the members below are
 * optional rather than required, and `undefined` is a third answer distinct
 * from `false` — "this backend has not been taught to answer" rather than "this
 * backend cannot". That also makes the widening *additive* in the strict sense
 * (decision, WP-R1.1): every existing implementation, test double, and
 * third-party backend still satisfies the type unchanged, which is the hazard
 * §61 records about adding interface members.
 *
 * The three backends this monorepo ships answer **all** of them:
 * {@link NullRenderer} with the floor, `WebglRenderer` with WebGL 2's honest
 * conservative values (`computeShaders: false` is a true statement about
 * WebGL 2, not a shortfall), and `WebgpuRenderer` from the device's own limits.
 *
 * A consumer therefore reads a member as a tri-state:
 *
 * ```ts
 * if (renderer.capabilities.computeShaders === true) {
 *   // …dispatch
 * }
 * ```
 *
 * §62's *"applications may declare required and optional capabilities"* is the
 * half that still does not exist: a declaration mechanism belongs with the
 * `"auto"` selector (`renderer-registry.ts`), and it is filed as WP-R1.9 rather
 * than guessed at here.
 *
 * Treat instances as immutable: a renderer publishes its capabilities once, at
 * {@link Renderer.initialize} time, and callers only read them.
 */
export interface RendererCapabilities {
  /** Which §62 backend this is. */
  readonly backend: RendererBackend;

  /**
   * Largest texture edge length, in texels, the backend accepts
   * (§62 "maximum texture dimensions"). `0` means the backend has no textures
   * at all, which is the honest answer for {@link NullRenderer}.
   */
  readonly maxTextureSize: number;

  /**
   * §62 "texture formats": the {@link @four/render!RenderTarget | render-target}
   * and texture formats this backend accepts, by their engine-side names.
   *
   * Engine names, not backend names — `"rgba8"` means "eight-bit unsigned
   * normalised colour", and whether the backend spells that `RGBA8`,
   * `rgba8unorm` or `bgra8unorm` is its own business (§60a, `render-target.ts`).
   * A backend with no textures reports an empty list.
   */
  readonly textureFormats?: readonly string[];

  /** §62 "multisampling": whether the backend can allocate a multisampled surface. */
  readonly multisampling?: boolean;

  /**
   * §62 "floating-point targets": whether a render target may hold
   * floating-point components rather than eight-bit normalised ones.
   */
  readonly floatRenderTargets?: boolean;

  /**
   * §62 "timestamp queries": whether the backend can time GPU work
   * (§84's GPU-side half). `false` on WebGL 2 without
   * `EXT_disjoint_timer_query_webgl2`, and `false` under SwiftShader.
   */
  readonly timestampQueries?: boolean;

  /** §62 "storage buffers": whether a shader may read and write a storage buffer. */
  readonly storageBuffers?: boolean;

  /**
   * §62 "compute shaders": whether the backend can dispatch compute (§82).
   *
   * **`false` on WebGL 2 is a true statement, not a shortfall** — WebGL 2 has
   * no compute stage at all, and §62's tiers exist so that an application can
   * read that and pick the CPU path rather than discover it at dispatch time.
   */
  readonly computeShaders?: boolean;

  /** §62 "indirect draw": whether draw arguments may be read from a buffer. */
  readonly indirectDraw?: boolean;

  /**
   * §62 "compressed textures": the compressed texture formats available, by
   * their canonical names (`"bc7-rgba-unorm"`, `"etc2-rgba8unorm"`, …), or an
   * empty list where none are.
   */
  readonly compressedTextureFormats?: readonly string[];

  /**
   * §62 "shader precision": the highest floating-point precision the fragment
   * stage supports, or `"none"` for a backend with no shaders at all.
   *
   * `"highp"` on both WebGL 2 (GLSL ES 3.00 requires fragment-stage `highp`)
   * and WebGPU (WGSL's `f32` is single precision by definition).
   */
  readonly shaderPrecision?: "none" | "lowp" | "mediump" | "highp";

  /**
   * §62 "maximum uniforms": the largest uniform buffer binding, in bytes, a
   * single shader may see. `0` for a backend with no shaders.
   *
   * Bytes rather than WebGL 2's "uniform vectors", because a byte size is the
   * quantity both backends can state and the one a caller sizing a buffer
   * actually needs; the WebGL 2 backend converts (`MAX_VERTEX_UNIFORM_VECTORS`
   * counts `vec4`s, i.e. 16 bytes each).
   */
  readonly maxUniformBufferBytes?: number;

  /**
   * §62 "maximum bindings": how many resources one shader stage may bind at
   * once — texture units on WebGL 2, bindings per bind group on WebGPU. `0`
   * for a backend that binds nothing.
   */
  readonly maxBindings?: number;
}

/**
 * Construction-time options for {@link Renderer.initialize} (§61, §45).
 *
 * §45's `ApplicationOptions` is the full menu — `width`, `height`,
 * `resolution`, `alpha`, `powerPreference`, `autoResize` — and each of those
 * lands with the backend that can act on it. This interface carries only what
 * the MVP tier reads; a backend that needs more declares its own options type
 * extending this one.
 */
export interface RendererOptions {
  /**
   * The surface to draw into.
   *
   * **Deliberately typed `unknown`, not `HTMLCanvasElement | OffscreenCanvas`**
   * (decision, WP-3.4). This package compiles with no DOM lib: `@four/render`
   * is the backend-independent layer and must be usable — and type-checkable —
   * in Node, in a worker, and in a headless test, where those DOM types do not
   * exist. Naming them here would drag `lib.dom` into every consumer of the
   * *logical* renderer interface, which is the dependency §61 forbids in
   * spirit.
   *
   * Each backend narrows it at the point where it can actually validate it:
   * the WebGL 2 backend (WP-3.5) accepts a canvas and fails with
   * `RENDERER_INITIALIZATION_FAILED` (§89) if what it got is not one. The type
   * is therefore `unknown` rather than `any` on purpose — an implementation
   * must narrow before touching it, so the check cannot be skipped by accident.
   *
   * Absent means the backend supplies or needs no surface, which is the
   * headless case.
   */
  canvas?: unknown;

  /**
   * Request multisampled anti-aliasing (§45). A hint: a backend that cannot
   * honour it reports so through {@link RendererCapabilities}, and never fails
   * initialization over it.
   */
  antialias?: boolean;

  /**
   * Request a **stencil buffer** on the drawing surface (§67, R-7); `false` by
   * default.
   *
   * §57's `Material.stencil` describes a stencil test; this is the buffer that
   * test reads and writes. The two are separate because they are separately
   * costly: a material's stencil state costs nothing until a draw uses it,
   * while the buffer is memory the surface carries for its lifetime and a
   * clear every view issues — so a renderer asks for it once, up front, and a
   * scene that never masks never pays.
   *
   * A hint in §45's sense, like {@link RendererOptions.antialias}: a backend
   * that cannot provide one still initializes and still draws, with masking
   * materials drawing unmasked rather than not at all (§61 forbids failing a
   * frame over render state).
   *
   * Masking into an **off-screen** surface asks the render target instead —
   * `RenderTargetOptions.stencil` — and leaves this `false`.
   */
  stencil?: boolean;
}

/**
 * Events a renderer emits (§61, §6b).
 *
 * Both payloads carry the renderer itself, because one application may run
 * several (a main view plus an off-screen pass) and a shared listener has to
 * be able to tell which one lost its context.
 */
export interface RendererEventMap {
  /**
   * The backing GPU context or device was lost (§61).
   *
   * Emitted **after** the renderer has marked itself lost, so a listener
   * observing the renderer sees the lost state. Not an error: nothing is
   * thrown, no {@link @four/core!FourError | FourError} is raised, and the application keeps running.
   */
  contextlost: { renderer: Renderer };

  /**
   * The context or device was restored and engine-owned GPU resources have been
   * re-created (§61).
   *
   * Emitted **after** re-creation, so the first `render` a listener triggers in
   * response already draws normally.
   */
  contextrestored: { renderer: Renderer };
}

/**
 * Where a frame's §43 render poses come from, and how far between the last two
 * fixed steps it is (§10, §43).
 *
 * ```ts
 * app.on("render", (time) => {
 *   renderer.render(scene, views, { poseBuffer: poses, alpha: time.interpolationAlpha });
 * });
 * ```
 *
 * A backend given this record draws the **interpolated** pose of every node the
 * buffer tracks — position lerped, rotation slerped — instead of the pose the
 * last fixed step left behind; a backend given `undefined` draws the resolved
 * world transforms (§7). Both are legitimate: the second is what a still frame,
 * a picking pass, or a headless determinism run wants, because it is exactly
 * the simulation state and nothing else.
 *
 * Nothing here is written to. §43's rule — "the render transform should not
 * feed back into the physics state" — is the reason the pose buffer is passed
 * as a *source* per frame rather than as something the renderer owns or
 * updates; a renderer only ever calls `computeRenderPose` (decision, WP-3.6).
 *
 * **The record may be a per-frame scratch object.** `Application` reuses one
 * (plan D7: the frame loop allocates nothing), so a backend must read
 * `poseBuffer` and `alpha` during the `render` call and never retain the record
 * itself — the same rule the views array and the pooled render items follow.
 */
export interface RenderInterpolation {
  /**
   * The engine's previous/current pose store (§37, §43) — one per application,
   * owned by whoever captures into it.
   */
  readonly poseBuffer: PoseBuffer;

  /**
   * How far the frame sits between the previous and the current fixed step:
   * `TimeState.interpolationAlpha` (§9, §10), in `[0, 1]`. `PoseBuffer` clamps
   * it, so an out-of-range or non-finite value degrades to an endpoint rather
   * than extrapolating a pose the simulation never produced.
   */
  readonly alpha: number;
}

/**
 * A backend that turns a scene into pixels (§61).
 *
 * ```ts
 * const renderer: Renderer = new NullRenderer();
 * await renderer.initialize({ canvas });
 * renderer.resize(800, 600, devicePixelRatio);
 * renderer.render(scene, [createFullscreenViewport(camera)]);
 * // …
 * renderer.dispose();
 * ```
 *
 * ## Device and context loss is a first-class event (§61, spec rev 1.3)
 *
 * §61: *"Device and context loss (WebGL context loss, WebGPU device loss) is a
 * first-class event, not an error case."* Every implementation of this
 * interface owes the following, and the §92 integration test ("renderer context
 * loss and restore") checks it:
 *
 * 1. **Emit `contextlost` on {@link Renderer.events} when the context is lost**,
 *    and `contextrestored` when it comes back. Loss is reported, never thrown —
 *    the `CONTEXT_LOST` / `DEVICE_LOST` codes of §89 exist for the case where a
 *    *caller* asks for something that cannot be satisfied while lost, not to
 *    turn the loss itself into an exception.
 * 2. **Re-create engine-owned GPU resources on restore** — pipelines, internal
 *    buffers, render targets — before emitting `contextrestored`, and re-upload
 *    user resources that retain CPU-side sources. Resources with no retained
 *    source expose a documented re-upload hook (that hook arrives with the
 *    texture API; see the deferred members below).
 * 3. **Never throw from {@link Renderer.render} while the context is lost.**
 *    Skip the frame and return. A lost context can occur between any two
 *    frames, on a driver's schedule and not the application's; a backend that
 *    throws turns a routine, recoverable event into an unwinding application
 *    loop, and an application cannot pre-empt it because the loss is
 *    asynchronous. The same applies to {@link Renderer.resize}: record the new
 *    size, apply it on restore.
 * 4. **Stay usable across the whole cycle.** `dispose()` during a lost context
 *    must succeed, and the renderer's own state (size, resolution,
 *    capabilities) survives loss — only GPU-side objects are rebuilt.
 *
 * ## Deferred §61 members (typed TODO)
 *
 * These are part of §61 and are **not** part of this interface. The list is
 * shorter than it was — {@link @four/render!RenderTarget | RenderTarget} and
 * {@link @four/render!Texture | Texture} both exist now — but the two
 * *factories* stay deferred **by decision, not by absence** (R-4, 2026-08-07),
 * and `readPixels` still names a type this monorepo does not have:
 *
 * ```ts
 * createTexture(source: TextureSource): Texture;
 * createRenderTarget(options: RenderTargetOptions): RenderTarget;
 * // Both types exist. A renderer-*owned* resource, though, cannot be built
 * // before a renderer, has to be built once per renderer, and has to be
 * // re-created by hand after a §61 context loss. `GeometryCache` and
 * // `TextureCache` in @four/render-webgl are the standing proof that the
 * // alternative works: the resource is a CPU-side descriptor with an id and a
 * // version, GPU residency is a backend cache, and a context loss is handled
 * // by dropping that cache. `texture.ts` and `render-target.ts` each carry the
 * // full argument on the class it concerns. These land with the tier that
 * // genuinely needs renderer-owned resources — compressed or GPU-only
 * // formats, which have no CPU-side description at all.
 *
 * readPixels?(target: RenderTarget, region?: Rectangle2): Promise<ArrayBuffer>;
 * // needs `Rectangle2`, which `@four/math` does not define; §92's visual
 * // regression tier is its first consumer. Optional in §61, stays optional.
 * ```
 */
export interface Renderer extends Disposable {
  /**
   * What this backend can do (§62). Valid before {@link Renderer.initialize}
   * only as far as the backend can know statically; a backend that queries
   * device limits publishes the real values during initialization.
   */
  readonly capabilities: RendererCapabilities;

  /**
   * This renderer's event channel (§6b) — `contextlost` and `contextrestored`.
   *
   * Composition rather than inheritance: see the module header. Use it exactly
   * like any other four.js emitter, including the returned unsubscriber:
   *
   * ```ts
   * const off = renderer.events.on("contextlost", (event) => {
   *   pauseWhileLost(event.renderer);
   * });
   * ```
   */
  readonly events: EventEmitter<RendererEventMap>;

  /**
   * Where this backend accumulates §84's `drawCalls`, `triangles`, and
   * `instances`, or `null` to count nothing (A-1, 2026-08-07).
   *
   * **Optional, and its presence is the capability.** §61's interface says
   * nothing about statistics, and §84 asks the *application* for the counters —
   * but only a backend knows what it actually submitted, so the numbers have to
   * originate here. A backend that counts declares the member (the WebGL 2
   * backend does); one that cannot omits it, and
   * {@link supportsRenderStatistics} tells them apart so an application reports
   * "not measured" rather than a confident zero.
   *
   * A backend that declares it owes three things, and nothing else:
   *
   * 1. **Accumulate, never clear** — a frame may be several `render` calls
   *    (an off-screen pass, then the on-screen one) and §84's counters are the
   *    frame's totals. The owner of the record clears it per frame.
   * 2. **Count what was submitted**, not what was in the render list: a draw
   *    skipped for a missing geometry, a disposed texture, or a feedback loop
   *    did not happen.
   * 3. **Change nothing else.** Switching statistics on must not add, remove,
   *    or reorder a single GPU call — the counters are integer increments
   *    beside the draw, never around it (see `statistics.ts`).
   *
   * ```ts
   * renderer.statistics = createRenderStatistics();
   * ```
   */
  statistics?: RenderStatistics | null;

  /**
   * Acquires the backend's context or device (§61, §45).
   *
   * Asynchronous because WebGPU adapter/device acquisition is (§45's
   * `await app.initialize()`), and because a backend may compile pipelines
   * up front. Rejects with a {@link @four/core!FourError | FourError} carrying
   * `RENDERER_INITIALIZATION_FAILED` (§62, §89) when the backend cannot start —
   * explicitly, rather than silently downgrading; backend *selection* and its
   * `"auto"` fallback are the application's job (§62), not an individual
   * backend's.
   *
   * Calling it twice is an implementation-defined error, not a second
   * acquisition.
   */
  initialize(options?: RendererOptions): Promise<void>;

  /**
   * Draws `root`'s subtree once for every viewport in `views`, in order (§61,
   * §48).
   *
   * `root` is usually the `Scene`. Nothing in the scene is mutated: rendering
   * reads world transforms (or §43 interpolated render poses) and writes
   * pixels — §42's transform authority and §43's "render poses never feed back"
   * rule both depend on that, and it is what lets a renderer be swapped, run
   * twice, or omitted entirely without changing simulation results.
   *
   * ### Shared viewport and clear semantics (all backends)
   *
   * - Viewports are drawn in array order, each into its own rectangle. An empty
   *   `views` array draws nothing — and, importantly, clears nothing.
   * - A viewport's rectangle is `x`/`y`/`width`/`height` in **pixels**, or
   *   fractions of the current drawing-buffer size when `normalized` is true
   *   (§48). Fractions are resolved against the size last given to
   *   {@link Renderer.resize}, multiplied by the resolution — so a normalized
   *   full-surface view stays correct across resizes with no per-frame work by
   *   the application.
   * - The rectangle's origin is the **bottom-left** corner with +Y up, matching
   *   the world convention (§7a) and the clip space of the D8 projections. A
   *   backend whose native scissor rectangle is top-left based flips on the way
   *   in; the flip never leaks into `Viewport`.
   * - `clearColor` present means clear that rectangle to that colour (RGBA in
   *   `[0, 1]`, straight alpha, linear-light per §60a) before drawing it;
   *   absent means **do not clear colour**, which is how a minimap or
   *   picture-in-picture view composites over what an earlier view drew.
   * - Depth is cleared per view whenever the backend has a depth buffer, so a
   *   later view's geometry cannot be occluded by an earlier view's. §48's
   *   configurable `clearDepth` is deferred; the cleared value is the far plane.
   * - Clears are confined to the viewport rectangle, never the whole surface.
   *
   * ### Interpolated poses (§43)
   *
   * With `interpolation` present the backend draws each node at its §43 render
   * pose — the previous and current fixed-step poses blended at
   * `interpolation.alpha`, positions lerped and rotations slerped — instead of
   * at its resolved world transform. In `@four/render` terms that is
   * {@link buildInterpolatedRenderList} rather than {@link buildRenderList},
   * and it is what makes motion smooth when the display rate and the fixed
   * simulation rate disagree (§10). Nodes the buffer does not track are drawn
   * from their live transforms at every alpha, so a mixed scene needs no
   * bookkeeping.
   *
   * With `interpolation` omitted the backend draws the resolved world
   * transforms, which requires the caller to have run `resolveWorldTransforms`
   * for the frame (§7, §64) — the interpolated path derives its matrices itself
   * and does not.
   *
   * ### Rendering into a target (§61, §48; R-4, 2026-08-07)
   *
   * With `target` present the frame is drawn into that off-screen surface
   * instead of the backend's default drawing buffer, and
   * `target.colorTexture` can then be sampled by any material — which is the
   * whole of render-to-texture, and what §48's minimaps, mirrors, portals and
   * previews, §63's transient resources, and §70's effect chain are all built
   * out of. Everything else is unchanged: the same views, the same clears, the
   * same interpolation.
   *
   * Three rules bind every backend:
   *
   * - **Normalized viewport rectangles resolve against the *target's* size**,
   *   not the surface's, so a full-target view is the same
   *   `{ x: 0, y: 0, width: 1, height: 1, normalized: true }` it is on screen.
   *   Pixel rectangles are target pixels, and are not scaled by the
   *   {@link Renderer.resize} resolution — the target has a size of its own.
   * - **The target is bound for the call and unbound before it returns**, even
   *   if the frame throws. A backend leaves nothing bound behind: the next
   *   thing to touch the device may be another renderer, or the same one
   *   drawing to screen.
   * - **A material sampling the target currently being drawn into is skipped**
   *   rather than drawn. That is a read-write feedback loop on one surface,
   *   which is undefined behaviour on every backend; the draw is dropped the
   *   same way a disposed texture's is (§83). Ping-pong between two targets.
   *
   * A disposed target draws nothing at all, and a target the backend cannot
   * allocate (an incomplete framebuffer, a device out of memory) skips the
   * frame rather than throwing — same reasoning as the lost-context rule.
   *
   * Returns immediately if the context is lost (see the context-loss contract
   * above): never throws for that reason.
   */
  render(
    root: Node,
    views: readonly Viewport[],
    interpolation?: RenderInterpolation,
    target?: RenderTarget | null,
  ): void;

  /**
   * Draws one §70 full-screen effect: `pass.source`'s texels over the whole of
   * `pass.target` (or of the drawing buffer) through `pass.effect` (R-6,
   * 2026-08-07).
   *
   * **Optional, and its presence is the capability** — the same stance
   * {@link Renderer.statistics} takes, for the same two reasons: adding a
   * required member to a published interface breaks every implementor, and a
   * backend with no fragment stage to run an effect in (§62's SVG tier draws
   * DOM nodes) should say so by omission rather than by silently copying.
   * {@link supportsScreenEffects} is the runtime test;
   * {@link RenderGraph.execute} uses it before forwarding an
   * {@link EffectRenderPass}.
   *
   * A backend that declares it owes exactly what {@link Renderer.render} owes,
   * restated because the two are separate entry points into the same device:
   *
   * - the destination is **bound for the call and unbound before it returns**,
   *   even if the call throws, and nothing else is left bound either;
   * - a lost context, a disposed source or destination, and an allocation the
   *   device refused all **skip the effect** and return, rather than throwing
   *   (§61, §83);
   * - a pass whose destination *is* the surface it samples is refused, not
   *   drawn — R-4's feedback rule, which {@link RenderGraph.validate} also
   *   reports statically;
   * - the effect covers the whole destination surface, replaces rather than
   *   composites (no blend, no depth test, no clear), and leaves the §57 state
   *   mirror where the next frame expects it.
   *
   * See `effect-pass.ts` for which of §70's effects this tier ships and what
   * each staged one is waiting on.
   */
  renderEffect?(pass: EffectRenderPass): void;

  /**
   * Resizes the drawing surface to `width` × `height` **logical** pixels at
   * `resolution` device pixels per logical pixel (§61, §45).
   *
   * The drawing buffer becomes `width * resolution` × `height * resolution`.
   * `resolution` defaults to `1` (see the module header); pass
   * `devicePixelRatio` in a browser.
   *
   * Cameras are **not** updated: a camera's `aspect` is the application's to
   * set, because only the application knows which camera belongs to which
   * viewport and whether a resize should change the field of view, the visible
   * extent, or neither (§47's explicit-recomputation rule).
   */
  resize(width: number, height: number, resolution?: number): void;

  /**
   * Releases every GPU resource this renderer owns (§83).
   *
   * Declared by {@link Disposable}, which this interface extends, and restated
   * here to carry the renderer-specific contract. Implementations must make it
   * **idempotent** (a second call is a no-op) and terminal, must succeed while
   * the context is lost, and must leave no listeners attached to
   * {@link Renderer.events} (§83: teardown may not retain listeners). Resources
   * the renderer did not create — geometries, materials, textures handed in by
   * the application — are not disposed here; whoever created them owns them.
   */
  dispose(): void;
}

/** {@link NullRenderer}'s record of one {@link Renderer.resize} call. */
export interface ResizeRecord {
  /** Logical width last passed to `resize`. */
  readonly width: number;
  /** Logical height last passed to `resize`. */
  readonly height: number;
  /** Resolution last passed to `resize`; `1` when the caller omitted it. */
  readonly resolution: number;
}

/** Error code for use-after-dispose, mirroring `Application` (§45, §83, §89). */
const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * A renderer that draws nothing and records what it was asked to draw — §62's
 * headless tier, reduced to its floor.
 *
 * Two jobs:
 *
 * 1. **Headless rendering.** §62 lists a "headless/software extension" among
 *    the backends, and §104 makes headless *simulation* core from Phase 1. An
 *    application wired with a `NullRenderer` runs its whole frame loop —
 *    fixed steps, systems, `render` events, render-list construction — in Node,
 *    with no canvas and no GPU. That is what the `Application` integration
 *    tests (WP-3.6) and the §33 determinism suites need: proof that the
 *    simulation is unchanged by the presence or absence of a renderer.
 * 2. **A conformance fixture.** It is the interface's proof of implementability
 *    and the reference for backend authors: what `Renderer` requires, minus
 *    every line of GL.
 *
 * It is *not* the software rasterizer of §62's "software" tier — nothing is
 * rasterized. Naming it `"null"` rather than `"headless"` keeps that
 * distinction available for a backend that really does produce pixels off
 * screen (decision, WP-3.4).
 *
 * ```ts
 * const renderer = new NullRenderer();
 * await renderer.initialize();
 * renderer.render(scene, views);
 * expect(renderer.renderCount).toBe(1);
 * expect(renderer.lastRenderRoot).toBe(scene);
 * ```
 *
 * ## Recording
 *
 * Every call is counted and its arguments retained, so a test can assert that
 * the application drove the renderer correctly without a display. The counters
 * are plain public fields: a test double's whole purpose is inspection, and
 * hiding them behind getters would add ceremony without adding a guarantee.
 * `lastViews` retains the **array the caller passed**, not a copy — callers are
 * expected to reuse a per-frame array, so read it before the next frame or copy
 * what you need (the same rule the pooled render list follows).
 *
 * ## Events
 *
 * A null renderer has no context, so it never loses one and emits nothing on
 * its own. {@link NullRenderer.events} is a fully functional emitter regardless
 * — a test can emit `contextlost` through it to exercise application-side
 * loss handling without a GPU, which is exactly the §92 integration test's
 * cheap half.
 *
 * ## Lifecycle
 *
 * `dispose()` is idempotent and **terminal**, and every other method throws a
 * {@link @four/core!FourError | FourError} with `INVALID_APPLICATION_STATE` afterwards — the same
 * contract `Application` uses (§45, §83). A silent no-op after disposal would
 * let a test record zero calls and pass for the wrong reason (decision,
 * WP-3.4). Note the deliberate asymmetry with a *lost context*, which is
 * recoverable and must never throw: disposal is the application's own doing and
 * cannot be undone.
 */
export class NullRenderer implements Renderer {
  /**
   * §62's headless tier: no textures at all, hence `maxTextureSize: 0`.
   * Frozen — a fixture that could be reconfigured mid-test would make the
   * capability negotiation it is meant to exercise meaningless.
   *
   * Every §62 member is answered rather than omitted (WP-R1.1), and every
   * answer is the floor: this renderer has no device, no shader stage and no
   * surface, so "no" and "zero" are not conservative guesses here but the
   * literal truth. That is what makes it the conformance fixture — a backend
   * author reading it sees the complete record with nothing left to infer.
   */
  readonly capabilities: RendererCapabilities = Object.freeze({
    backend: "null",
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

  /** The §6b channel required by {@link Renderer}. Never emitted to by this class. */
  readonly events = new EventEmitter<RendererEventMap>();

  /**
   * §84's render counters (A-1). Declared, and **never written to** — this
   * renderer submits no draw calls at all, so every frame's honest contribution
   * to `drawCalls`, `triangles`, and `instances` is zero, and adding zero is
   * writing nothing.
   *
   * Declaring it rather than omitting it is deliberate: it makes a headless
   * application's statistics wiring assertable end to end
   * ({@link supportsRenderStatistics} answers `true`, `app.stats.drawCalls`
   * reads `0` rather than `NaN`), which is the same job every other recording
   * field on this class does. A backend that genuinely *cannot* count is the
   * case the optional member exists for; this one can, and the answer is zero.
   */
  statistics: RenderStatistics | null = null;

  /** Number of completed {@link NullRenderer.initialize} calls. */
  initializeCount = 0;

  /** Options of the most recent `initialize`; `null` before the first call. */
  lastInitializeOptions: RendererOptions | null = null;

  /** Number of {@link NullRenderer.render} calls. */
  renderCount = 0;

  /** Root of the most recent `render`; `null` before the first call. */
  lastRenderRoot: Node | null = null;

  /** Views of the most recent `render` (not copied); `null` before the first call. */
  lastViews: readonly Viewport[] | null = null;

  /**
   * The §43 interpolation record of the most recent `render` (**not copied**;
   * callers reuse one per frame), or `null` when that call passed none — so a
   * later non-interpolated frame clears the record rather than leaving the
   * previous frame's standing, which would let a test pass for the wrong
   * reason. `null` before the first call.
   */
  lastInterpolation: RenderInterpolation | null = null;

  /**
   * The {@link @four/render!RenderTarget | RenderTarget} of the most recent
   * `render`, or `null` when that call passed none (R-4) — cleared per call for
   * the same reason {@link NullRenderer.lastInterpolation} is: a later
   * on-screen frame must not leave the previous off-screen pass's target
   * standing, which would let a test pass for the wrong reason. `null` before
   * the first call.
   *
   * Nothing is drawn into it. A null renderer has no surfaces at all, so an
   * off-screen pass is recorded and skipped exactly as an on-screen one is —
   * which is what lets an application's render-to-texture wiring be asserted
   * headlessly (§92's cheap half).
   */
  lastRenderTarget: RenderTarget | null = null;

  /** Number of {@link NullRenderer.renderEffect} calls (R-6). */
  renderEffectCount = 0;

  /**
   * The most recent {@link EffectRenderPass} (not copied); `null` before the
   * first call.
   *
   * Retained rather than cleared per call, unlike
   * {@link NullRenderer.lastRenderTarget}, because there is no "an effect pass
   * without an effect" call to clear it: every `renderEffect` has one, so a
   * stale value is impossible.
   */
  lastEffectPass: EffectRenderPass | null = null;

  /** Number of {@link NullRenderer.resize} calls. */
  resizeCount = 0;

  /** Arguments of the most recent `resize`; `null` before the first call. */
  lastResize: ResizeRecord | null = null;

  #disposed = false;

  /** Whether {@link NullRenderer.dispose} has run. Disposal is terminal. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Resolves immediately — there is no context to acquire. Records the call and
   * its options.
   *
   * Returns an already-resolved promise rather than being `async`, so awaiting
   * it costs one microtask and nothing else; the method still satisfies §61's
   * `Promise<void>` signature and an application's `await app.initialize()`.
   */
  initialize(options?: RendererOptions): Promise<void> {
    this.#assertUsable("initialize");
    this.initializeCount += 1;
    this.lastInitializeOptions = options ?? null;
    return Promise.resolve();
  }

  /**
   * Records `root`, `views`, the §43 `interpolation` record, and the R-4
   * `target`, and draws nothing. No pose is computed: the null backend has
   * nothing to draw them into, and a test that wants the interpolated matrices
   * asks {@link buildInterpolatedRenderList} for them directly.
   */
  render(
    root: Node,
    views: readonly Viewport[],
    interpolation?: RenderInterpolation,
    target?: RenderTarget | null,
  ): void {
    this.#assertUsable("render");
    this.renderCount += 1;
    this.lastRenderRoot = root;
    this.lastViews = views;
    this.lastInterpolation = interpolation ?? null;
    this.lastRenderTarget = target ?? null;
  }

  /**
   * Records the §70 effect pass, and draws nothing (R-6).
   *
   * Declared rather than omitted, exactly as
   * {@link NullRenderer.statistics} is and for the same reason: this class is
   * the interface's conformance fixture, and an application's post-processing
   * wiring — which passes ran, in which order, over which surfaces — is
   * assertable headlessly only if the null backend accepts them. A backend
   * that genuinely *cannot* run an effect is the case the optional member
   * exists for; this one can record, and recording is the whole of what it
   * does for `render` too.
   */
  renderEffect(pass: EffectRenderPass): void {
    this.#assertUsable("renderEffect");
    this.renderEffectCount += 1;
    this.lastEffectPass = pass;
  }

  /** Records the requested size. `resolution` defaults to `1`. */
  resize(width: number, height: number, resolution = 1): void {
    this.#assertUsable("resize");
    this.resizeCount += 1;
    this.lastResize = { width, height, resolution };
  }

  /**
   * Drops every listener and marks the renderer disposed. Idempotent: a second
   * call returns without doing anything. Recorded call data is left intact so a
   * test can still assert on it after teardown.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.events.removeAllListeners();
  }

  #assertUsable(method: string): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `NullRenderer.${method}() was called on a disposed renderer; disposal is terminal (§83).`,
        { context: { method, disposed: true } },
      );
    }
  }
}
