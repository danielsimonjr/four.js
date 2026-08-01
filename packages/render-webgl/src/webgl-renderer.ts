/**
 * The WebGL 2 backend (§61, §62, §120) — the MVP's only renderer.
 *
 * §120 fixes the MVP tier as *"WebGL 2 only, one solver adapter, basic 2D/3D
 * primitives"*, and §62 lists WebGL 2 as backend 2 of 5. {@link WebglRenderer}
 * implements `@four/render`'s `Renderer` for that tier: unlit colored geometry,
 * one shader pair, one vertex array per geometry, `"negative-one-to-one"` clip
 * depth (plan D8).
 *
 * The normative clear and viewport semantics live on `Renderer.render`'s
 * documentation in `@four/render`, not here — they are shared by every backend
 * so that a test can assert them once. This module implements them; where a
 * sentence there admitted more than one reading, the reading chosen is recorded
 * below on {@link WebglRenderer.render}.
 *
 * ## No DOM types
 *
 * Nothing in this file names `HTMLCanvasElement`, `WebGL2RenderingContext`, or
 * `Event`. The canvas is described structurally by {@link WebglCanvas} and the
 * context by `WebglContext` (`gl-program.ts`), so the package type-checks and
 * unit-tests under plain Node with no `lib.dom` and no jsdom — see
 * `gl-program.ts`'s header for the full argument. A real canvas satisfies
 * {@link WebglCanvas} structurally, so a browser passes one straight in.
 *
 * ## Testability seams
 *
 * Everything below is driven through two injected objects — the canvas and the
 * context it hands back — and both are interfaces. The unit tests
 * (`tests/webgl-renderer.test.ts`) supply a hand-rolled fake context that
 * records calls, which is what lets initialization failure, cache eviction,
 * clear ordering, uniform uploads, draw calls, context loss, restore, and
 * disposal all be asserted with no GPU and no browser. Real-GL behaviour is
 * WP-3.8's Playwright test; this file's job is to make the *sequence* of GL
 * calls checkable.
 */

import { EventEmitter, FourError } from "@four/core";
import { Matrix4 } from "@four/math";
import {
  buildRenderList,
  type RenderItem,
  type Renderer,
  type RendererCapabilities,
  type RendererEventMap,
  type RendererOptions,
} from "@four/render";

import { GeometryCache } from "./gl-geometry.js";
import { GL, UnlitProgram, type WebglContext } from "./gl-program.js";

/**
 * The subtree root {@link WebglRenderer.render} draws, and the viewports it
 * draws it into — read off the `Renderer` interface instead of imported from
 * `@four/scene`.
 *
 * `@four/render-webgl` depends on `core`, `math`, and `render` only (plan §3.1,
 * frozen). `Parameters<Renderer["render"]>` yields exactly the `Node` and
 * `Viewport` types the interface declares, with no new edge in the dependency
 * matrix and no chance of drifting from the interface being implemented
 * (decision, WP-3.5).
 */
type RenderRoot = Parameters<Renderer["render"]>[0];

/** One viewport, derived as {@link RenderRoot} is. */
type RenderView = Parameters<Renderer["render"]>[1][number];

/**
 * The minimum a DOM event has to offer this backend: a way to stop the default
 * handling of `webglcontextlost`.
 *
 * Calling `preventDefault()` on that event is what makes the browser *promise*
 * to fire `webglcontextrestored`. Without it the context never comes back, and
 * §61's restore half of the contract becomes unimplementable.
 */
export interface WebglContextEventLike {
  preventDefault(): void;
}

/**
 * The drawing surface, described by what this backend actually touches (§61's
 * `RendererOptions.canvas` is `unknown` precisely so each backend can narrow it
 * here).
 *
 * `HTMLCanvasElement` and `OffscreenCanvas`-plus-an-event-target both satisfy
 * this structurally. The narrowing is done at runtime by
 * {@link WebglRenderer.initialize}, which is why the interface exists as a
 * *target* for a checked cast rather than as a parameter type.
 */
export interface WebglCanvas {
  /** Drawing-buffer width in device pixels. Written by `resize`. */
  width: number;

  /** Drawing-buffer height in device pixels. Written by `resize`. */
  height: number;

  /**
   * Acquires a rendering context. Typed to return `unknown` because this
   * package does not name `WebGL2RenderingContext`; the result is validated
   * structurally before use.
   */
  getContext(contextId: "webgl2", attributes?: WebglContextAttributes): unknown;

  addEventListener(
    type: string,
    listener: (event: WebglContextEventLike) => void,
  ): void;

  removeEventListener(
    type: string,
    listener: (event: WebglContextEventLike) => void,
  ): void;
}

/**
 * Context attributes this backend requests (a subset of WebGL's
 * `WebGLContextAttributes`).
 *
 * Only the four that the MVP has an opinion about are named; everything else is
 * left at the browser's default, because requesting a value the engine does not
 * use is how a backend ends up with a framebuffer nobody asked for.
 */
export interface WebglContextAttributes {
  /** Alpha in the drawing buffer, so a canvas can composite with the page. */
  alpha?: boolean;
  /** Multisampling; driven by `RendererOptions.antialias` (§45). */
  antialias?: boolean;
  /** A depth buffer — required, since every view clears and tests depth (§61). */
  depth?: boolean;
  /** No stencil until §67's masks land. */
  stencil?: boolean;
}

/** Error code for use-after-dispose, mirroring `NullRenderer` (§45, §83, §89). */
const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * Methods a candidate context must have before this backend will believe it is
 * a WebGL 2 context.
 *
 * `createVertexArray` is the discriminating one: it exists on WebGL 2 and not
 * on WebGL 1, so a page that fell back to `"webgl"` — or a stub that implements
 * half the surface — is rejected with `RENDERER_INITIALIZATION_FAILED` rather
 * than crashing on the first draw.
 */
const REQUIRED_CONTEXT_METHODS = [
  "createVertexArray",
  "bindVertexArray",
  "createBuffer",
  "createProgram",
  "useProgram",
  "drawArrays",
  "drawElements",
  "isContextLost",
] as const;

/**
 * The render list, module-owned and reused across frames and renderers.
 *
 * `buildRenderList` pools its items per `out` array (§64, plan D7), so one
 * array here means one pool and zero steady-state allocation. Sharing it
 * between two `WebglRenderer` instances is safe because
 * {@link WebglRenderer.render} builds the list and consumes every item
 * synchronously before returning — no item ever outlives the call that produced
 * it. Two *simultaneously live* lists would need two arrays, which is why
 * `@four/render` keys its pools on the array rather than on a module global.
 */
const renderList: RenderItem[] = [];

/** Scratch for `projection * view`; see {@link renderList} for the policy. */
const viewProjection = new Matrix4();

/** Resolved viewport rectangle in drawing-buffer pixels, reused per view. */
const rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Narrows `value` to a {@link WebglCanvas}, or throws
 * `RENDERER_INITIALIZATION_FAILED`.
 *
 * The check is on the three members this backend calls, not on a constructor
 * name: an `OffscreenCanvas` wrapper, a test double, and an
 * `HTMLCanvasElement` are all equally acceptable, and `instanceof
 * HTMLCanvasElement` would additionally fail across realms (an iframe's canvas
 * is not the parent's `HTMLCanvasElement`).
 */
function requireCanvas(value: unknown): WebglCanvas {
  if (typeof value !== "object" || value === null) {
    throw new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "The WebGL 2 backend needs a canvas: pass one as " +
        "`initialize({ canvas })` (§61, §45).",
      { context: { received: typeof value } },
    );
  }

  const candidate = value as Partial<WebglCanvas>;
  if (
    typeof candidate.getContext !== "function" ||
    typeof candidate.addEventListener !== "function" ||
    typeof candidate.removeEventListener !== "function"
  ) {
    throw new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "The value passed as `canvas` is not a canvas: it lacks " +
        "getContext/addEventListener/removeEventListener (§61).",
      { context: { received: typeof value } },
    );
  }

  return value as WebglCanvas;
}

/**
 * Narrows a `getContext` result to a {@link WebglContext}, or returns `null`
 * (the caller turns that into `RENDERER_INITIALIZATION_FAILED` with the reason
 * attached).
 */
function asContext(value: unknown): WebglContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  for (const name of REQUIRED_CONTEXT_METHODS) {
    if (typeof candidate[name] !== "function") {
      return null;
    }
  }
  return value as WebglContext;
}

/** Reads the §62 limits this tier can honestly report. */
function readCapabilities(gl: WebglContext): RendererCapabilities {
  const maxTextureSize = gl.getParameter(GL.MAX_TEXTURE_SIZE);
  return Object.freeze({
    backend: "webgl2",
    maxTextureSize: typeof maxTextureSize === "number" ? maxTextureSize : 0,
  } satisfies RendererCapabilities);
}

/**
 * Resolves a viewport's rectangle into drawing-buffer pixels, into the shared
 * {@link rect} (§48; the semantics are pinned on `Renderer.render`).
 *
 * `normalized` fractions multiply the drawing-buffer size — i.e. the size last
 * given to `resize`, times the resolution. Pixel rectangles are used verbatim:
 * the shared contract multiplies by the resolution *only* for the normalized
 * case, so an unnormalized rectangle is read as drawing-buffer pixels, which is
 * also the only reading under which `scissor` and `viewport` take the numbers
 * unchanged (ambiguity resolved here; decision, WP-3.5).
 *
 * No flip: WebGL's `viewport` and `scissor` origin is already the bottom-left
 * corner with +Y up, which is the convention §48 and §7a state. The "backends
 * whose native rectangle is top-left based flip on the way in" clause is for
 * Canvas 2D and SVG.
 *
 * Values are rounded (GL takes integers) and extents are clamped at zero, since
 * a negative width or height is a GL error rather than an empty rectangle.
 */
function resolveRect(
  view: RenderView,
  bufferWidth: number,
  bufferHeight: number,
): void {
  const scaleX = view.normalized === true ? bufferWidth : 1;
  const scaleY = view.normalized === true ? bufferHeight : 1;
  rect.x = Math.round(view.x * scaleX);
  rect.y = Math.round(view.y * scaleY);
  rect.width = Math.max(0, Math.round(view.width * scaleX));
  rect.height = Math.max(0, Math.round(view.height * scaleY));
}

/**
 * Draws four.js scenes with WebGL 2 (§61, §62, §120).
 *
 * ```ts
 * const renderer = new WebglRenderer();
 * await renderer.initialize({ canvas });
 * renderer.resize(800, 600, devicePixelRatio);
 * renderer.render(scene, [createFullscreenViewport(camera)]);
 * // …
 * renderer.dispose();
 * ```
 *
 * ## Fixed GL state (decisions, WP-3.5)
 *
 * Set once at initialization and re-applied on context restore:
 *
 * - **Depth test on, `LEQUAL`, cleared to 1 per view.** §61's shared contract
 *   makes the per-view depth clear mandatory; `LEQUAL` rather than `LESS` so
 *   that co-planar geometry drawn later wins, which is what 2D content stacked
 *   in render order expects.
 * - **`"negative-one-to-one"` clip depth (plan D8).** GL's default depth range,
 *   and the default `Camera.updateProjectionMatrix` already writes — so this
 *   backend never rewrites a camera's projection. A `"zero-to-one"` backend
 *   (WebGPU) must, which is why the argument is on the camera method.
 * - **Counter-clockwise front faces**, matching the right-handed, Y-up world of
 *   §7a and the winding the §53 primitive builders emit.
 * - **Back-face culling OFF.** The MVP tier draws planar 2D shapes as much as
 *   3D meshes, and a plane seen from behind is a legitimate view of it, not a
 *   back face to discard. Culling becomes a per-material state when §57's
 *   `Material` base lands with `depthTest`/`depthWrite`/`colorWrite`; turning
 *   it on globally now would make half the 2D scenes in §93's examples
 *   disappear when the camera crosses their plane.
 * - **Scissor test on for the renderer's lifetime.** §61 requires clears to be
 *   confined to the viewport rectangle, and a `scissor` that is never enabled
 *   does not confine anything. Drawing is confined too, which is what stops a
 *   minimap's geometry from spilling into the main view.
 *
 * ## Context loss (§61)
 *
 * `webglcontextlost` is captured, defaulted-prevented (without which the
 * browser never restores), and turned into a `contextlost` event; GPU handles
 * are dropped without being deleted, because they are already invalid.
 * `render` then returns silently until `webglcontextrestored` arrives, at which
 * point the program and the geometry cache are rebuilt, the fixed state and the
 * surface size are re-applied, capabilities are re-read, and `contextrestored`
 * is emitted — after the rebuild, so the first frame a listener triggers
 * already draws.
 *
 * ## Lifecycle
 *
 * `dispose()` is idempotent and terminal, succeeds while the context is lost,
 * and leaves no listeners on the canvas or on {@link WebglRenderer.events}
 * (§83). Every other method throws `INVALID_APPLICATION_STATE` afterwards, as
 * `NullRenderer` does — disposal is the application's own doing, unlike a lost
 * context, and a silent no-op would hide the bug.
 */
export class WebglRenderer implements Renderer {
  /** The §6b channel required by `Renderer` — `contextlost`/`contextrestored`. */
  readonly events = new EventEmitter<RendererEventMap>();

  #capabilities: RendererCapabilities = Object.freeze({
    backend: "webgl2",
    maxTextureSize: 0,
  } satisfies RendererCapabilities);

  #canvas: WebglCanvas | null = null;

  #gl: WebglContext | null = null;

  #program: UnlitProgram | null = null;

  #geometries: GeometryCache | null = null;

  #contextLost = false;

  #disposed = false;

  /** Drawing-buffer size in device pixels; see {@link WebglRenderer.resize}. */
  #bufferWidth = 0;

  #bufferHeight = 0;

  /** Whether `resize` has been called, so `initialize` knows whose size wins. */
  #sizeRequested = false;

  /**
   * Bound once and stored so `removeEventListener` can match them. Arrow
   * properties rather than methods: a method reference would have to be bound,
   * and an unbound one silently fails to unregister (§83 forbids leaving
   * listeners behind).
   */
  readonly #onContextLost = (event: WebglContextEventLike): void => {
    // Without this the browser will not fire `webglcontextrestored` at all.
    event.preventDefault();
    if (this.#disposed || this.#contextLost) {
      return;
    }
    this.#contextLost = true;
    // Every handle died with the context: drop them, never delete them.
    this.#program = null;
    this.#geometries?.forget();
    this.events.emit("contextlost", { renderer: this });
  };

  readonly #onContextRestored = (): void => {
    const gl = this.#gl;
    if (this.#disposed || !this.#contextLost || gl === null) {
      return;
    }
    // If this throws (a driver that will not recompile), the renderer stays
    // lost and `contextrestored` is not emitted — a half-restored renderer that
    // claimed to be ready would fail on the next draw instead, with no clue.
    this.#program = UnlitProgram.create(gl);
    this.#geometries = new GeometryCache(gl);
    this.#applyFixedState(gl);
    this.#applySurfaceSize();
    this.#capabilities = readCapabilities(gl);
    this.#contextLost = false;
    this.events.emit("contextrestored", { renderer: this });
  };

  /**
   * §62 capability report. `maxTextureSize` is `0` until
   * {@link WebglRenderer.initialize} has queried the context, and is re-read on
   * context restore.
   */
  get capabilities(): RendererCapabilities {
    return this.#capabilities;
  }

  /** Whether the backing context is currently lost (§61). */
  get contextLost(): boolean {
    return this.#contextLost;
  }

  /** Whether {@link WebglRenderer.dispose} has run. Disposal is terminal. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Whether {@link WebglRenderer.initialize} has completed. */
  get initialized(): boolean {
    return this.#gl !== null;
  }

  /**
   * Acquires the WebGL 2 context from `options.canvas`, compiles the unlit
   * program, sets the fixed GL state, and wires the context-loss events (§61,
   * §45).
   *
   * Rejects with a {@link FourError} carrying `RENDERER_INITIALIZATION_FAILED`
   * when there is no canvas, when the canvas will not give up a `"webgl2"`
   * context (an older browser, a blocked GPU, a context already taken by
   * another API), or when what it gives back is not a WebGL 2 context; and with
   * `SHADER_COMPILATION_FAILED` when the unlit program will not build. §62
   * requires an explicit backend to fail fast rather than downgrade silently —
   * `"auto"` selection is the application's job, not this class's.
   *
   * The work is synchronous — unlike WebGPU, `getContext` returns immediately —
   * but the signature is `Promise<void>` because §61's is, so an application
   * awaits every backend the same way. The failure is delivered as a
   * *rejection* rather than a synchronous throw, which is what `await
   * app.initialize()` expects.
   *
   * Calling it twice rejects with `INVALID_APPLICATION_STATE`.
   */
  initialize(options?: RendererOptions): Promise<void> {
    try {
      this.#initializeSynchronously(options);
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return Promise.resolve();
  }

  /**
   * Draws `root`'s subtree once per viewport, in array order (§61, §48, §64).
   *
   * The per-view sequence is scissor rectangle, viewport rectangle, clears,
   * then the draws — the rectangles first so that the clears are already
   * confined when they run. Colour is cleared only when the view carries a
   * `clearColor` (absent means "composite over what an earlier view drew");
   * depth is cleared for every view to the far plane, so a later view cannot be
   * occluded by an earlier one. Both clears are issued as one `clear` call with
   * the combined mask.
   *
   * `viewProjection` is `camera.projectionMatrix * camera.viewMatrix`, uploaded
   * once per view after `camera.updateViewMatrix()` — the camera's world
   * transform is resolved by that call, so a camera moved after the frame's
   * resolve pass is still correct. The camera's *projection* is never rewritten
   * here: this backend's clip depth is `"negative-one-to-one"`, which is what
   * `Camera.updateProjectionMatrix` already defaults to (plan D8).
   *
   * The render list is built once per call, not once per view: it does not
   * depend on the camera, because §64 stage 3 (culling) is not implemented yet.
   * When culling lands, the build moves inside the view loop.
   *
   * Nothing in the scene is mutated. World matrices are **not** resolved here —
   * §7 and §64 make that a separate, earlier stage, and `Application` runs it
   * before its `render` listeners.
   *
   * Returns immediately and silently while the context is lost, and when
   * `views` is empty (which therefore also clears nothing) — §61 both times.
   * Throws only for programmer error: rendering before `initialize` or after
   * `dispose`.
   */
  render(root: RenderRoot, views: readonly RenderView[]): void {
    const gl = this.#requireContext("render");
    if (this.#contextLost || views.length === 0) {
      return;
    }

    // Unreachable given the class invariant — a live context always has both —
    // but the fields are nullable so that context loss can drop them, and the
    // narrowing has to happen somewhere. Skipping the frame is the right
    // behaviour if the invariant is ever broken: §61 forbids throwing here.
    const program = this.#program;
    const geometries = this.#geometries;
    if (program === null || geometries === null) {
      return;
    }

    const items = buildRenderList(root, renderList);
    program.use();

    for (const view of views) {
      resolveRect(view, this.#bufferWidth, this.#bufferHeight);
      gl.scissor(rect.x, rect.y, rect.width, rect.height);
      gl.viewport(rect.x, rect.y, rect.width, rect.height);

      let mask = GL.DEPTH_BUFFER_BIT;
      const clearColor = view.clearColor;
      if (clearColor !== undefined) {
        gl.clearColor(
          clearColor[0],
          clearColor[1],
          clearColor[2],
          clearColor[3],
        );
        mask |= GL.COLOR_BUFFER_BIT;
      }
      gl.clearDepth(1);
      gl.clear(mask);

      const camera = view.camera;
      camera.updateViewMatrix();
      viewProjection.copy(camera.projectionMatrix).multiply(camera.viewMatrix);
      program.setViewProjection(viewProjection);

      for (const item of items) {
        const record = geometries.acquire(item.geometry);
        if (record === null) {
          continue;
        }
        program.setModel(item.worldMatrix);
        program.setColor(item.material.color);
        gl.bindVertexArray(record.vertexArray);
        if (record.indexType === null) {
          gl.drawArrays(record.mode, 0, record.count);
        } else {
          gl.drawElements(record.mode, record.count, record.indexType, 0);
        }
      }
    }

    // Leave no vertex array bound: the next thing to touch this context may not
    // be this renderer (§61 allows several renderers over one application).
    gl.bindVertexArray(null);
  }

  /**
   * Resizes the drawing buffer to `width * resolution` × `height * resolution`
   * device pixels (§61, §45).
   *
   * The size is recorded first and applied to the canvas second, so a resize
   * during a lost context is remembered and re-applied on restore rather than
   * lost or thrown away (§61). Normalized viewport rectangles resolve against
   * the recorded size from the next frame on.
   *
   * Cameras are not touched — `aspect` is the application's to set (§47).
   */
  resize(width: number, height: number, resolution = 1): void {
    this.#assertUsable("resize");
    this.#sizeRequested = true;
    this.#bufferWidth = Math.max(0, Math.round(width * resolution));
    this.#bufferHeight = Math.max(0, Math.round(height * resolution));
    if (!this.#contextLost) {
      this.#applySurfaceSize();
    }
  }

  /**
   * Releases every GPU resource this renderer owns and detaches its listeners
   * (§83). Idempotent, terminal, and safe while the context is lost — in which
   * case the GL objects are dropped rather than deleted, since the handles are
   * already invalid.
   *
   * Geometries and materials are **not** disposed: the renderer did not create
   * them (§83).
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;

    const canvas = this.#canvas;
    if (canvas !== null) {
      canvas.removeEventListener("webglcontextlost", this.#onContextLost);
      canvas.removeEventListener(
        "webglcontextrestored",
        this.#onContextRestored,
      );
    }

    if (!this.#contextLost) {
      this.#program?.dispose();
      this.#geometries?.dispose();
    }

    this.#program = null;
    this.#geometries = null;
    this.#gl = null;
    this.#canvas = null;
    this.events.removeAllListeners();
  }

  /** The body of {@link WebglRenderer.initialize}; see it for the contract. */
  #initializeSynchronously(options?: RendererOptions): void {
    this.#assertUsable("initialize");
    if (this.#gl !== null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebglRenderer.initialize() was called twice; a renderer acquires one " +
          "context (§61).",
        { context: { method: "initialize" } },
      );
    }

    const canvas = requireCanvas(options?.canvas);
    const raw = canvas.getContext("webgl2", {
      alpha: true,
      antialias: options?.antialias ?? false,
      depth: true,
      stencil: false,
    });
    const gl = asContext(raw);
    if (gl === null) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "The canvas did not provide a WebGL 2 context (§62). WebGL 2 may be " +
          "unavailable, blocked, or the canvas may already hold a context of " +
          "another type.",
        { context: { received: raw === null ? "null" : typeof raw } },
      );
    }

    // The program is built before anything is stored, so a shader failure
    // leaves the renderer uninitialized rather than half-initialized.
    const program = UnlitProgram.create(gl);

    this.#canvas = canvas;
    this.#gl = gl;
    this.#program = program;
    this.#geometries = new GeometryCache(gl);
    this.#capabilities = readCapabilities(gl);
    this.#applyFixedState(gl);

    if (this.#sizeRequested) {
      // A resize that arrived before initialization wins over the canvas's
      // current attributes: it is the more recent instruction.
      this.#applySurfaceSize();
    } else {
      this.#bufferWidth = canvas.width;
      this.#bufferHeight = canvas.height;
    }

    canvas.addEventListener("webglcontextlost", this.#onContextLost);
    canvas.addEventListener("webglcontextrestored", this.#onContextRestored);
  }

  /** The fixed GL state — see the class documentation for each choice. */
  #applyFixedState(gl: WebglContext): void {
    gl.enable(GL.DEPTH_TEST);
    gl.depthFunc(GL.LEQUAL);
    gl.frontFace(GL.CCW);
    gl.disable(GL.CULL_FACE);
    gl.enable(GL.SCISSOR_TEST);
  }

  /** Pushes the recorded drawing-buffer size onto the canvas. */
  #applySurfaceSize(): void {
    const canvas = this.#canvas;
    if (canvas === null) {
      return;
    }
    canvas.width = this.#bufferWidth;
    canvas.height = this.#bufferHeight;
  }

  /** Throws unless the renderer is usable and initialized. */
  #requireContext(method: string): WebglContext {
    this.#assertUsable(method);
    const gl = this.#gl;
    if (gl === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `WebglRenderer.${method}() was called before initialize() (§61).`,
        { context: { method, initialized: false } },
      );
    }
    return gl;
  }

  /** Throws when the renderer has been disposed (§83). */
  #assertUsable(method: string): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `WebglRenderer.${method}() was called on a disposed renderer; ` +
          "disposal is terminal (§83).",
        { context: { method, disposed: true } },
      );
    }
  }
}
