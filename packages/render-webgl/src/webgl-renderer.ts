/**
 * The WebGL 2 backend (§61, §62, §120) — the MVP's only renderer.
 *
 * §120 fixes the MVP tier as *"WebGL 2 only, one solver adapter, basic 2D/3D
 * primitives"*, and §62 lists WebGL 2 as backend 2 of 5. {@link WebglRenderer}
 * implements `@four/render`'s `Renderer` for that tier and its later additions:
 * five scene pipelines (unlit, lit, standard, sprite, particles — see the class
 * documentation) plus §70's full-screen effect program, one vertex array per
 * geometry, `"negative-one-to-one"` clip depth (plan D8).
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
  buildInterpolatedRenderList,
  buildRenderList,
  collectSceneLights,
  createSceneLights,
  isLitItem,
  isParticlesItem,
  isRenderTargetTexture,
  isSpriteItem,
  isStandardItem,
  viewLayerMask,
  COLOR_GRADE_DEFAULTS,
  type EffectRenderPass,
  type RenderItem,
  type RenderItemKind,
  type RenderStatistics,
  type Renderer,
  type RendererCapabilities,
  type RendererEventMap,
  type RendererOptions,
  type ScreenEffectRenderer,
} from "@four/render";

import {
  EFFECT_TEXTURE_UNIT,
  EFFECT_VERTEX_COUNT,
  EffectProgram,
} from "./gl-effect.js";
import { GeometryCache } from "./gl-geometry.js";
import {
  ParticleBatchCache,
  ParticleProgram,
  type ParticleGlContext,
} from "./gl-particles.js";
import {
  GL,
  LitProgram,
  MAP_TEXTURE_UNIT,
  SpriteProgram,
  UnlitProgram,
  type GlTexture,
} from "./gl-program.js";
import {
  RenderTargetCache,
  type RenderTargetRecord,
} from "./gl-render-target.js";
import { StandardProgram } from "./gl-standard.js";
import { TextureCache, type CacheableTexture } from "./gl-texture.js";

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
 * The §43 interpolation record, derived as {@link RenderRoot} is — the pose
 * buffer it carries is `@four/scene`'s, named here only through the interface
 * this class implements, so the frozen dependency matrix is untouched.
 */
type RenderInterpolationArgument = NonNullable<
  Parameters<Renderer["render"]>[2]
>;

/**
 * The off-screen surface `render` draws into when it is given one (§61, §48;
 * R-4), derived from the interface as {@link RenderRoot} is.
 *
 * `@four/render`'s `RenderTarget` — a *type* import through the interface, so
 * this file still names nothing outside the frozen matrix. `gl-render-target.ts`
 * imports the class by name for a reason written out there.
 */
type RenderTargetArgument = NonNullable<Parameters<Renderer["render"]>[3]>;

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
  // The particle pipeline's three (WP-9.3). All core WebGL 2 — the two
  // instancing entry points WebGL 1 needed `ANGLE_instanced_arrays` for, plus
  // `bufferSubData` — so a context that lacks them is not a WebGL 2 context,
  // and this check is the one place that has to notice. See `gl-particles.ts`
  // for why they are declared as an extension of `WebglContext` rather than in
  // it.
  "bufferSubData",
  "vertexAttribDivisor",
  "drawArraysInstanced",
  // The standard pipeline's one (§59, R-13, 2026-08-08): `metalness` and
  // `roughness` are scalars. Core WebGL 1 and 2, so it discriminates nothing —
  // listed for the same fail-fast courtesy as `uniform3fv` below.
  "uniform1f",
  // The lit pipeline's one (§68, 2026-08-04): its light uniforms are vec3s.
  // Core WebGL 1 *and* 2, so it discriminates nothing — it is here so an
  // incomplete stub fails fast at initialize rather than at the first lit
  // draw, the same courtesy the check extends to every other entry point the
  // backend cannot draw without.
  "uniform3fv",
  // The render-target path's five (R-4, 2026-08-07). Core WebGL 1 and 2 too,
  // so they discriminate nothing either; they are checked for the same reason
  // as `uniform3fv` — a stub that cannot allocate a framebuffer should say so
  // at `initialize`, not on the first off-screen pass, which may be minutes
  // into a session. `createRenderbuffer` and friends are not listed
  // individually: no context implements half of `gl-render-target.ts`'s set,
  // and a check per entry point would cost a loop iteration per initialize for
  // a case that does not exist. See `gl-render-target.ts`.
  "createFramebuffer",
  "bindFramebuffer",
  "framebufferTexture2D",
  "checkFramebufferStatus",
  "createRenderbuffer",
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

/**
 * The frame's collected lighting (§68), module-owned and reused exactly as
 * {@link renderList} is, and safe for the same reason: `render` collects and
 * consumes it synchronously. Only refreshed for frames that contain a lit
 * item, so a scene that never lights never pays the collection walk.
 */
const sceneLights = createSceneLights();

/** Resolved viewport rectangle in drawing-buffer pixels, reused per view. */
const rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * §57's material as this backend reads it, derived from the render item union
 * rather than imported.
 *
 * `@four/render-webgl` depends on `core`, `math`, and `render` only (plan §3.1,
 * frozen), so it may not name `@four/materials`' `Material`. `RenderItem`'s
 * `material` is that type, so taking it back off the union gives the same
 * contract with no new edge — the technique this file already uses for the
 * scene root and the viewport (decision, WP-3.5).
 */
type ItemMaterial = NonNullable<RenderItem["material"]>;

/** §57's `BlendMode`, derived from the material for the same reason. */
type ItemBlendMode = ItemMaterial["blendMode"];

/**
 * §57's `blendMode` as a GL blend function — `[sourceFactor, destination
 * Factor]`, over **straight (non-premultiplied) alpha**, which is the policy
 * §66 requires this engine to state and this tier commits to everywhere.
 *
 * Four modes, four `blendFunc` pairs, no blend *equation* changes: every one of
 * them is `src × sourceFactor + dst × destinationFactor`, so the equation stays
 * at GL's default `FUNC_ADD` and this backend needs no `blendEquation` entry
 * point. Modes that do need one (`darken`, `lighten`, the Porter-Duff set)
 * are not in §57's vocabulary here and would arrive with it.
 */
const BLEND_FUNCTIONS: Record<ItemBlendMode, readonly [number, number]> = {
  normal: [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA],
  additive: [GL.SRC_ALPHA, GL.ONE],
  multiply: [GL.DST_COLOR, GL.ZERO],
  screen: [GL.ONE, GL.ONE_MINUS_SRC_COLOR],
};

/**
 * The GL state this backend toggles per draw (§57), mirrored on the CPU so a
 * frame issues a call only where a draw actually *changes* something.
 *
 * That mirroring is not an optimization, it is the compatibility guarantee:
 * with §57's defaults — opaque, depth-tested, depth-writing, colour-writing —
 * every comparison below is equal and the frame issues **exactly the GL
 * sequence it issued before material render state existed**, down to the single
 * `useProgram`. A scene pays for state only where it asks for it.
 *
 * ## One mirror per renderer (F13, 2026-08-07)
 *
 * This was a module-level object until 2026-08-07, shared by every
 * `WebglRenderer` in the process and therefore by every *context* — §61 allows
 * several renderers over one application, and two of them mirror two different
 * GL states. The sharing was masked, never fixed, by `render` resetting the
 * mirror on entry. It is a per-instance field now
 * ({@link WebglRenderer.render} passes it to each helper), which is also what
 * makes the reset-on-entry an assertion the class can *keep* rather than a
 * hope: nothing outside one renderer's own frame can move it.
 *
 * The values a fresh mirror carries are the fixed state `#applyFixedState`
 * establishes (blending off, `LEQUAL` depth test on) plus GL's own defaults
 * (depth mask on, colour mask on) — the state a frame starts and ends in.
 */
interface GlState {
  blending: boolean;
  blendMode: ItemBlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  colorWrite: boolean;
}

/** A mirror of the state a frame starts and ends in; see `GlState`. */
function createGlState(): GlState {
  return {
    blending: false,
    blendMode: "normal",
    depthTest: true,
    depthWrite: true,
    colorWrite: true,
  };
}

/**
 * Resets the mirror to the state a frame starts and ends in.
 *
 * Since F13 every frame leaves through a `finally` that restores exactly this
 * state to *real* GL, so this is the cheap restatement of an invariant that
 * already holds rather than the assumption it used to be: a frame that threw
 * mid-draw no longer hands the next one a mirror that disagrees with the
 * context. It costs no GL call either way.
 */
function resetGlState(state: GlState): void {
  state.blending = false;
  state.blendMode = "normal";
  state.depthTest = true;
  state.depthWrite = true;
  state.colorWrite = true;
}

/**
 * Applies §57's blend state for the draw about to be issued.
 *
 * `blend` is the material's `transparent` flag — except on the two pipelines
 * that blend by construction (sprites and §36 particles), where the caller
 * passes `true` because they did so before the flag existed and a scene that
 * never heard of it must not lose its compositing.
 *
 * The blend *function* is only re-issued while blending is on: a mode change on
 * an opaque material would be a call with no observable effect, and `render`
 * restores the function at the end of the frame — which is what `forceMode` is
 * for, since that restore runs with blending already off (F15).
 */
function applyBlendState(
  gl: ParticleGlContext,
  state: GlState,
  blend: boolean,
  mode: ItemBlendMode,
  forceMode = false,
): void {
  if (blend !== state.blending) {
    if (blend) {
      gl.enable(GL.BLEND);
    } else {
      gl.disable(GL.BLEND);
    }
    state.blending = blend;
  }
  if ((blend || forceMode) && mode !== state.blendMode) {
    // Total over `ItemBlendMode`: §57's `Material.blendMode` validates every
    // assignment against the same four names (`@four/materials`, F14), and
    // `applyMaterialState` maps a material that declares none onto `"normal"`.
    const [source, destination] = BLEND_FUNCTIONS[mode];
    gl.blendFunc(source, destination);
    state.blendMode = mode;
  }
}

/**
 * Applies §57's depth and colour state for the draw about to be issued.
 *
 * `depthTest` is `enable`/`disable(DEPTH_TEST)`; `depthWrite` is `depthMask`;
 * `colorWrite` is `colorMask` on all four channels (§57 declares one boolean,
 * so all four move together — see `WebglContext.colorMask`).
 */
function applyDepthColorState(
  gl: ParticleGlContext,
  state: GlState,
  depthTest: boolean,
  depthWrite: boolean,
  colorWrite: boolean,
): void {
  if (depthTest !== state.depthTest) {
    if (depthTest) {
      gl.enable(GL.DEPTH_TEST);
    } else {
      gl.disable(GL.DEPTH_TEST);
    }
    state.depthTest = depthTest;
  }
  if (depthWrite !== state.depthWrite) {
    gl.depthMask(depthWrite);
    state.depthWrite = depthWrite;
  }
  if (colorWrite !== state.colorWrite) {
    gl.colorMask(colorWrite, colorWrite, colorWrite, colorWrite);
    state.colorWrite = colorWrite;
  }
}

/**
 * Applies every §57 field a material declares, defaulting each one the way a
 * material that predates the field would behave.
 *
 * The reads are deliberately defensive — `!== false`, `=== true`, `?? "normal"`
 * — rather than trusting the type. A backend meets its materials through a
 * *structural* contract (that is what lets the unit tests drive it with
 * doubles, and what lets a consumer's own material type reach it), so a missing
 * field has to mean "the default", not `undefined` leaking into a GL call or a
 * `NaN` into a uniform. `material` itself is optional for the one caller that
 * has none: §36's particles carry no material at all.
 *
 * That is the *whole* of what these fallbacks guard (F16, 2026-08-07). Every
 * real `Material` declares all six fields and validates the two that can carry
 * a bad value on assignment as well as at construction (F14) — so a fallback
 * that no structural double could reach has been removed rather than left to
 * read as a live defence.
 */
function applyMaterialState(
  gl: ParticleGlContext,
  state: GlState,
  material: ItemMaterial | undefined,
  alwaysBlend: boolean,
): void {
  applyBlendState(
    gl,
    state,
    alwaysBlend || material?.transparent === true,
    material?.blendMode ?? "normal",
  );
  applyDepthColorState(
    gl,
    state,
    material?.depthTest !== false,
    material?.depthWrite !== false,
    material?.colorWrite !== false,
  );
}

/**
 * Adds one *submitted* draw to §84's render counters (A-1, 2026-08-07).
 *
 * Called immediately after the GL draw entry point and only ever with a
 * non-null record: the frame reads `this.statistics` once, and every call site
 * is guarded by that one comparison, so a renderer with statistics off does not
 * reach this function and issues exactly the GL sequence it always did.
 *
 * `vertexCount` is the draw's element count — vertices for `drawArrays`,
 * indices for `drawElements` — which is the number GL divides by three either
 * way. This backend has only two primitive modes (`gl-geometry.ts` maps §53's
 * `"triangles"`/`"lines"` onto `GL.TRIANGLES`/`GL.LINES`), so anything that is
 * not `TRIANGLES` contributes no triangles at all; `Math.floor` because a
 * geometry whose count is not a multiple of three leaves GL a trailing partial
 * primitive that it does not draw.
 */
function countDraw(
  statistics: RenderStatistics,
  mode: number,
  vertexCount: number,
  instances: number,
): void {
  statistics.drawCalls += 1;
  statistics.instances += instances;
  if (mode === GL.TRIANGLES) {
    statistics.triangles += Math.floor(vertexCount / 3) * instances;
  }
}

/**
 * §57's `opacity`, defaulted to 1 for a material that does not declare one —
 * a structurally-typed double or a consumer's own material type, exactly as in
 * {@link applyMaterialState}. A real `Material` always declares it, and rejects
 * a non-finite value on every write (F14), so this multiplier cannot carry a
 * `NaN` into `uniform4fv`.
 */
function opacityOf(material: ItemMaterial): number {
  return material.opacity ?? 1;
}

/**
 * §57's `map` as this backend reads it (R-19) — the texture an unlit or lit
 * material samples, or `null`.
 *
 * Read defensively, exactly as `applyMaterialState` reads the render state and
 * for the same reason: a backend meets its materials through a *structural*
 * contract, so a material double that predates the field — or a consumer's own
 * material type — reports `undefined`, which has to mean "no texture" rather
 * than leaking into `TextureCache.acquire`.
 */
function mapOf(material: {
  map?: CacheableTexture | null;
}): CacheableTexture | null {
  return material.map ?? null;
}

/**
 * Turns a texture a material points at into the GL texture to bind, whichever
 * kind it is (R-4, 2026-08-07) — the one place in the draw path that knows
 * there are two.
 *
 * An ordinary `Texture` is uploaded from its CPU-side texels by
 * {@link TextureCache}. A {@link @four/render!RenderTargetTexture | render-target
 * texture} has none — it *is* a framebuffer's colour attachment — so it resolves
 * through {@link RenderTargetCache} instead, which allocates the framebuffer if
 * this is the first the backend has heard of it. That is what makes sampling a
 * target that has never been rendered into read as transparent black rather
 * than fail.
 *
 * `null` means "do not bind this": a disposed resource, an allocation GL
 * refused, or — the case only this function can see — a **feedback loop**, a
 * material sampling the very target this frame is drawing into. Reading and
 * writing one surface in a single pass is undefined behaviour on every backend,
 * and undefined content is worse than a missing draw, so the draw is dropped
 * exactly as a disposed texture's is (§83). Ping-pong between two targets to
 * express what that draw was reaching for.
 *
 * The non-target path is one `isRenderTargetTexture` marker read away from what
 * it was before, and issues the identical GL call — which is what keeps a scene
 * that never renders to texture byte-identical at the GL boundary.
 */
function resolveTexture(
  textures: TextureCache,
  renderTargets: RenderTargetCache,
  activeTarget: RenderTargetArgument | null,
  texture: CacheableTexture,
): GlTexture | null {
  if (!isRenderTargetTexture(texture)) {
    return textures.acquire(texture)?.texture ?? null;
  }
  const source = texture.renderTarget;
  if (source === activeTarget) {
    return null;
  }
  return renderTargets.acquire(source)?.texture ?? null;
}

/**
 * Restores the GL state a frame borrowed, issuing a call only for what it
 * actually changed — the mirror image of {@link applyMaterialState}.
 *
 * The blend function outlives the blend enable, so a frame that ended with a
 * non-default mode has to put it back explicitly even though blending is being
 * turned off in the same breath: that is `applyBlendState`'s `forceMode`, which
 * replaces the hand-written `blendFunc` this function used to issue after
 * passing a mode argument the helper ignored (F15, 2026-08-07).
 */
function restoreGlState(gl: ParticleGlContext, state: GlState): void {
  applyBlendState(gl, state, false, "normal", true);
  applyDepthColorState(gl, state, true, true, true);
}

/**
 * The texture unit the sprite pipeline samples from.
 *
 * Unit 0, permanently: this tier binds exactly one texture per draw, and §77's
 * multi-texture materials (normal maps, masks, atlases plus data maps) are what
 * will need a unit allocator. Naming the constant keeps the `activeTexture` call
 * and the sampler upload from drifting apart.
 */
const SPRITE_TEXTURE_UNIT = 0;

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
 * Narrows a `getContext` result to a {@link ParticleGlContext} — i.e. a
 * `WebglContext` plus the three instancing entry points the particle pipeline
 * needs — or returns `null` (the caller turns that into
 * `RENDERER_INITIALIZATION_FAILED` with the reason attached).
 */
function asContext(value: unknown): ParticleGlContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  for (const name of REQUIRED_CONTEXT_METHODS) {
    if (typeof candidate[name] !== "function") {
      return null;
    }
  }
  return value as ParticleGlContext;
}

/** Reads the §62 limits this tier can honestly report. */
function readCapabilities(gl: ParticleGlContext): RendererCapabilities {
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
 *   back face to discard. §57's base landed with
 *   `depthTest`/`depthWrite`/`colorWrite` (2026-08-06) and this backend honours
 *   all three per draw, but §57 declares **no** face-culling field, so culling
 *   stays a global off; turning it on would make half the 2D scenes in §93's
 *   examples disappear when the camera crosses their plane.
 * - **Scissor test on for the renderer's lifetime.** §61 requires clears to be
 *   confined to the viewport rectangle, and a `scissor` that is never enabled
 *   does not confine anything. Drawing is confined too, which is what stops a
 *   minimap's geometry from spilling into the main view.
 * - **Blend function `SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA`; blending itself off.**
 *   §66 requires the engine to state its "premultiplied and straight alpha
 *   policies": this tier is **straight alpha, not premultiplied**, on every
 *   colour it touches — `UnlitMaterial.color`, `SpriteMaterial.tint`, texel
 *   data, and `Viewport.clearColor` alike. Set once at initialization, and the
 *   state a frame is always handed back in; since 2026-08-06 a draw whose
 *   material names a different `blendMode` (§57) changes the function for its
 *   run and `render` restores it before returning.
 *
 * ## Material render state (§57, 2026-08-06)
 *
 * Every draw applies the six fields §57 puts on `Material`:
 *
 * | field        | GL                                     |
 * | ------------ | -------------------------------------- |
 * | `transparent`| `enable`/`disable(BLEND)`               |
 * | `blendMode`  | `blendFunc` (see `BLEND_FUNCTIONS`)     |
 * | `depthTest`  | `enable`/`disable(DEPTH_TEST)`          |
 * | `depthWrite` | `depthMask`                             |
 * | `colorWrite` | `colorMask`                             |
 * | `opacity`    | multiplied into the uploaded alpha      |
 *
 * This is the fix for the recorded defect that `UnlitMaterial.color[3]` and
 * `LitMaterial.color[3]` were **dead fields**: blending was disabled for both
 * pipelines unconditionally, so animating alpha was a silent no-op. It is now
 * `transparent: true` away from working, and `opacity` drives it without
 * touching the shared colour.
 *
 * The state is mirrored on the CPU (one `GlState` **per renderer**, F13)
 * and a call is issued only where a draw *changes* something, so §57's defaults
 * — which are exactly this backend's previous fixed state — issue nothing at
 * all: a scene authored before the base existed produces the same GL sequence
 * it always did. A frame always leaves through the `finally` that restores what
 * it borrowed, so the mirror cannot outlive its agreement with the context (see
 * {@link WebglRenderer.render}).
 *
 * ## Five scene pipelines (§55, §36, §59, §68; WP-3a.3, WP-9.3, lighting
 * 2026-08-04, R-13 2026-08-08)
 *
 * A render item says which pipeline draws it (`RenderItem.kind`), and this
 * backend keeps all five live (a sixth program, §70's full-screen effect, is
 * driven by {@link WebglRenderer.renderEffect} and never by a render item):
 *
 * - **unlit** — flat colour, the §120 MVP pipeline, depth-tested, and opaque
 *   unless its material declares `transparent`;
 * - **lit** — Lambert diffuse under §68's directional light plus the scene
 *   ambient term, depth-tested and opaque-by-default like unlit. The
 *   frame's lights are collected once per `render` call (`collectSceneLights`,
 *   `@four/render`) — and only for frames whose list actually contains a lit
 *   or standard item, so unlit scenes never pay the walk;
 * - **standard** — §59's metallic-roughness BRDF (GGX, Smith, Schlick) under
 *   the same one light and the same ambient term, plus the eye position the
 *   specular lobe needs (`gl-standard.ts`). It shades in the same untagged
 *   linear space and blends by the same straight-alpha rule as the lit
 *   pipeline, so a scene may mix the two families freely;
 * - **sprite** — one texture sample times a tint, with `GL_BLEND` enabled
 *   whatever the material says (the pipeline blends by construction);
 * - **particles** — one `drawArraysInstanced` per §36 particle system,
 *   screen-aligned quads coloured per instance, with `GL_BLEND` enabled
 *   (`gl-particles.ts`).
 *
 * The unlit pipeline is the frame's starting and resting state: a scene with no
 * sprites and no particles issues exactly the GL sequence it issued before
 * either existed, down to the single `useProgram`. Blending is enabled when a
 * draw asks for it and disabled when one stops asking, so an opaque draw never
 * runs through a blend equation it did not ask for.
 *
 * Draws are **not depth-sorted**: §66's key 2 (opaque before transparent)
 * arrived in the render list on 2026-08-06 and this backend sees its effect for
 * free, but key 4 (depth) is still deferred with the per-view list it needs, so
 * transparent draws are ordered by layer, then explicit render order, then
 * scene order, with depth testing and depth *writing* left on unless a material
 * turns them off. That is correct for content that does not overlap, and for
 * overlapping content an author orders with `renderOrder` and usually sets
 * `depthWrite: false`; it is wrong for arbitrary unsorted overlapping
 * transparency, which is the documented limitation §66 asks the engine to state
 * and the depth-sorting packet to fix.
 *
 * Textures are discovered from the render list and cached exactly as geometry
 * is (`gl-texture.ts`), which is why §61's `createTexture` stays deferred — the
 * argument is written out in that module's header and in `@four/render`'s
 * `texture.ts`.
 *
 * ## Render targets (§61, §48; R-4, 2026-08-07)
 *
 * `render`'s fourth argument draws the frame into an off-screen framebuffer
 * instead of the canvas, and `RenderTarget.colorTexture` is then an ordinary
 * material texture — which is the whole of render-to-texture. Three things are
 * this backend's part of the shared contract stated on `Renderer.render`:
 *
 * - **Framebuffers are a cache, keyed and invalidated exactly as geometry and
 *   textures are** (`gl-render-target.ts`), including through a context loss.
 * - **The bind lives inside the frame's `try`/`finally`**, so a draw that
 *   throws mid-pass cannot leave this renderer's framebuffer bound.
 * - **A frame with no target issues no framebuffer call at all** — not a bind,
 *   not an unbind. The on-screen GL sequence is byte-for-byte the one this
 *   backend issued before render targets existed, which is the property the
 *   pixel goldens and the recorded-sequence tests both pin.
 *
 * ## Statistics (§84; A-1, 2026-08-07)
 *
 * {@link WebglRenderer.statistics} is `null` by default and counts nothing.
 * Assign a `RenderStatistics` record and this backend adds one entry per draw
 * call it actually submits — `drawCalls`, `triangles` (per-instance count times
 * instances, lines excluded), `instances` — accumulating across every `render`
 * call until the record's owner clears it.
 *
 * The counters are integer increments *beside* the draw, never around it, and
 * the field is read once per frame. Switching them on therefore adds, removes,
 * and reorders nothing: the recorded-GL-sequence tests assert that a frame with
 * statistics on issues the byte-identical call list of the same frame with them
 * off, which is the property the pixel goldens rest on.
 *
 * ## Context loss (§61)
 *
 * `webglcontextlost` is captured, defaulted-prevented (without which the
 * browser never restores), and turned into a `contextlost` event; GPU handles
 * are dropped without being deleted, because they are already invalid.
 * `render` then returns silently until `webglcontextrestored` arrives, at which
 * point all six programs and all four caches are rebuilt, the fixed state and
 * the surface size are re-applied, capabilities are re-read, and
 * `contextrestored` is emitted — after the rebuild, so the first frame a listener triggers
 * already draws. Geometry and texture *content* re-uploads lazily from the
 * CPU-side sources the application still holds, on the next draw that needs it,
 * and so do the framebuffers of §61's "engine-owned GPU resources … render
 * targets": the cache cannot know which targets the next frame will use, so
 * each one is re-allocated by the pass that asks for it (R-4).
 *
 * ## Lifecycle
 *
 * `dispose()` is idempotent and terminal, succeeds while the context is lost,
 * and leaves no listeners on the canvas or on {@link WebglRenderer.events}
 * (§83). Every other method throws `INVALID_APPLICATION_STATE` afterwards, as
 * `NullRenderer` does — disposal is the application's own doing, unlike a lost
 * context, and a silent no-op would hide the bug.
 */
export class WebglRenderer implements Renderer, ScreenEffectRenderer {
  /** The §6b channel required by `Renderer` — `contextlost`/`contextrestored`. */
  readonly events = new EventEmitter<RendererEventMap>();

  #capabilities: RendererCapabilities = Object.freeze({
    backend: "webgl2",
    maxTextureSize: 0,
  } satisfies RendererCapabilities);

  #canvas: WebglCanvas | null = null;

  #gl: ParticleGlContext | null = null;

  #program: UnlitProgram | null = null;

  #spriteProgram: SpriteProgram | null = null;

  #particleProgram: ParticleProgram | null = null;

  #litProgram: LitProgram | null = null;

  /**
   * §59's metallic-roughness pipeline (R-13, 2026-08-08), or `null` before
   * initialization and while the context is lost.
   *
   * Compiled by {@link WebglRenderer.initialize} beside the other five, for the
   * reason `#effectProgram` states at length and §61 requires: a shader compile
   * can throw for a driver reason no application can pre-empt, and `render` may
   * not throw. The cost is one program per renderer that never draws a
   * `StandardMaterial` — the same deal the lit, particle, and effect pipelines
   * already offer an application that uses none of them, and **measured**
   * rather than assumed (see the CHANGELOG entry for R-13).
   */
  #standardProgram: StandardProgram | null = null;

  /**
   * §70's full-screen effect pipeline (R-6), or `null` before initialization
   * and while the context is lost.
   *
   * Compiled by {@link WebglRenderer.initialize} with the other four, never
   * lazily: `renderEffect` runs inside an application's frame, and a compile
   * there could throw for a driver reason the application cannot pre-empt —
   * the same argument §61 makes about `render` (`gl-effect.ts` restates it).
   * The cost of that choice is one program per renderer that never runs an
   * effect — the same deal the lit and particle pipelines already offer a
   * purely 2D application, and **measured** rather than assumed: 0.75 kB gzip
   * per example bundle (0.42 kB for this pipeline and its two shaders, 0.33 kB
   * for {@link WebglRenderer.renderEffect}), because nothing reachable from a
   * class method can tree-shake. `@four/render`'s half — `effect-pass.ts` — is
   * a separate side-effect-free module and does tree-shake out; grepping the
   * example bundles confirms both halves of that sentence (R-6, 2026-08-07).
   */
  #effectProgram: EffectProgram | null = null;

  #geometries: GeometryCache | null = null;

  #textures: TextureCache | null = null;

  #renderTargets: RenderTargetCache | null = null;

  #particleBatches: ParticleBatchCache | null = null;

  /**
   * This renderer's own §57 state mirror (F13) — see `GlState` for why it
   * is per-instance rather than per-module, and {@link WebglRenderer.render}
   * for the `finally` that keeps it and the context in step.
   */
  readonly #glState = createGlState();

  /**
   * §84's render counters, or `null` (the default) to count nothing — the
   * optional `Renderer` capability (A-1, 2026-08-07; see
   * `@four/render`'s `statistics.ts`).
   *
   * This backend accumulates one entry per *submitted* draw call: a draw
   * skipped for a geometry it could not allocate, a texture the application
   * disposed, a zero-particle system, or a feedback loop on the current render
   * target never reaches a counter, because it never reached the GPU.
   *
   * Assign it between frames. {@link WebglRenderer.render} reads the field once
   * per call, so a record assigned from inside a frame's own listeners applies
   * from the next frame.
   */
  statistics: RenderStatistics | null = null;

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
    this.#spriteProgram = null;
    this.#particleProgram = null;
    this.#litProgram = null;
    this.#standardProgram = null;
    this.#effectProgram = null;
    this.#geometries?.forget();
    this.#textures?.forget();
    this.#renderTargets?.forget();
    this.#particleBatches?.forget();
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
    this.#spriteProgram = SpriteProgram.create(gl);
    this.#particleProgram = ParticleProgram.create(gl);
    this.#litProgram = LitProgram.create(gl);
    this.#standardProgram = StandardProgram.create(gl);
    this.#effectProgram = EffectProgram.create(gl);
    this.#geometries = new GeometryCache(gl);
    this.#textures = new TextureCache(gl);
    this.#renderTargets = new RenderTargetCache(gl);
    this.#particleBatches = new ParticleBatchCache(gl);
    this.#applyFixedState(gl);
    // Textures are re-uploaded lazily from the CPU-side sources their `Texture`
    // objects still retain — §61's "re-uploads user resources that retain
    // CPU-side sources", done on the next draw rather than eagerly, because the
    // cache cannot know which textures the next frame will actually use.
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
   * Rejects with a {@link @four/core!FourError | FourError} carrying `RENDERER_INITIALIZATION_FAILED`
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
   * ## Interpolated poses (§43, WP-3.6)
   *
   * With `interpolation` present the list is built by
   * `buildInterpolatedRenderList` instead of `buildRenderList`, so each item's
   * model matrix is the node's §43 render pose at `interpolation.alpha` —
   * position lerped, rotation slerped, composed through the hierarchy — rather
   * than its resolved world matrix. That is the whole of this backend's part in
   * §43: nothing else in the draw path changes, because the interpolated pose
   * arrives as an ordinary `RenderItem.worldMatrix`.
   *
   * Which of the two lists is built is decided **per call**, from the argument:
   * this class keeps no interpolation state, so the same renderer can draw an
   * interpolated frame for the application and a raw one for a picking or
   * screenshot pass without being reconfigured.
   *
   * Nothing in the scene is mutated — the interpolated path composes into
   * pooled matrices and never writes a render pose back (§42, §43). World
   * matrices are **not** resolved here: §7 and §64 make that a separate,
   * earlier stage, and `Application` runs it before its `render` listeners.
   * The interpolated path does not even need that pass, since it derives every
   * matrix itself.
   *
   * ## Off-screen passes (§61, §48; R-4, 2026-08-07)
   *
   * With `target` present the frame is drawn into that target's framebuffer:
   * bound as the first act of the frame's `try`, unbound in its `finally`, and
   * never left bound for the next caller. Normalized viewport rectangles
   * resolve against the *target's* size rather than the drawing buffer's, so a
   * full-target view is the same `{ 0, 0, 1, 1, normalized }` it is on screen;
   * unnormalized rectangles are target pixels, unscaled by the `resize`
   * resolution, which the target does not have.
   *
   * The pass is **skipped entirely** — no bind, no clear, no draw — when the
   * target is disposed, when GL will not allocate its framebuffer, or when the
   * assembled framebuffer is not `FRAMEBUFFER_COMPLETE`. §61 forbids throwing
   * from `render` for the asynchronous, driver-scheduled failures this is one
   * of, and half-drawing into an incomplete framebuffer would turn every
   * subsequent draw into an unread `GL_INVALID_FRAMEBUFFER_OPERATION`.
   *
   * A material whose texture is *this* target's own colour attachment is
   * skipped for the duration of the pass (`resolveTexture`): sampling the
   * surface being written is undefined on every backend.
   *
   * Without `target` — the on-screen path — **not one framebuffer call is
   * issued**, so the GL sequence is byte-for-byte what it was before render
   * targets existed.
   *
   * Returns immediately and silently while the context is lost, and when
   * `views` is empty (which therefore also clears nothing) — §61 both times.
   * Throws only for programmer error: rendering before `initialize` or after
   * `dispose`.
   *
   * ## A throw costs one frame, not the renderer (F13, 2026-08-07)
   *
   * `render` itself raises nothing else, but the frame runs *application* code
   * — a geometry or material accessor, a texture the application disposed
   * mid-frame — and that can. The draw work is therefore wrapped in a
   * `try`/`finally`: whatever escapes, the fixed GL state this frame borrowed
   * is put back, the texture unit and the vertex array are unbound, and the
   * §57 mirror ends where the next frame expects to find it. The exception is
   * re-thrown unchanged; the *next* frame draws correctly. Before this, one
   * transient exception desynced the mirror from the context permanently and
   * silently, because every later frame asserted the defaults it had just
   * stopped guaranteeing.
   */
  render(
    root: RenderRoot,
    views: readonly RenderView[],
    interpolation?: RenderInterpolationArgument,
    target?: RenderTargetArgument | null,
  ): void {
    const gl = this.#requireContext("render");
    if (this.#contextLost || views.length === 0) {
      return;
    }

    // Unreachable given the class invariant — a live context always has all
    // of these — but the fields are nullable so that context loss can drop
    // them, and the narrowing has to happen somewhere. Skipping the frame is
    // the right behaviour if the invariant is ever broken: §61 forbids
    // throwing here.
    const program = this.#program;
    const spriteProgram = this.#spriteProgram;
    const particleProgram = this.#particleProgram;
    const litProgram = this.#litProgram;
    const standardProgram = this.#standardProgram;
    const geometries = this.#geometries;
    const textures = this.#textures;
    const renderTargets = this.#renderTargets;
    const particleBatches = this.#particleBatches;
    if (
      program === null ||
      spriteProgram === null ||
      particleProgram === null ||
      litProgram === null ||
      standardProgram === null ||
      geometries === null ||
      textures === null ||
      renderTargets === null ||
      particleBatches === null
    ) {
      return;
    }

    // The off-screen surface, if this is an off-screen pass (R-4). Resolved
    // *before* the frame's `try`, because `acquire` is a pure allocation with
    // nothing to unwind and never throws (`gl-render-target.ts`): a target that
    // is disposed, that GL would not allocate, or whose framebuffer is
    // incomplete skips the whole frame here rather than half-drawing it. The
    // *binding* is inside the envelope, where its `finally` can see it.
    const activeTarget = target ?? null;
    let targetRecord: RenderTargetRecord | null = null;
    if (activeTarget !== null) {
      targetRecord = renderTargets.acquire(activeTarget);
      if (targetRecord === null) {
        return;
      }
    }

    // Normalized viewport rectangles resolve against the surface actually being
    // drawn into: the drawing buffer on screen, the target's own size off
    // screen. Read off the *record*, so the `viewport` call and the allocation
    // agree even if the application resized the target after this call began.
    const surfaceWidth = targetRecord?.width ?? this.#bufferWidth;
    const surfaceHeight = targetRecord?.height ?? this.#bufferHeight;

    // This renderer's own state mirror, and the two frame-scoped bindings the
    // `finally` below has to see (F13, 2026-08-07).
    const state = this.#glState;
    // §84's counters, read once for the frame (A-1, 2026-08-07): `null` is the
    // default and the whole of the no-statistics cost — one comparison per
    // draw, no allocation, and not a single GL call added, removed, or
    // reordered. Read *after* the early returns above, so a frame this backend
    // declines to draw counts nothing.
    const statistics = this.statistics;
    // Whether a texture is bound to unit 0 — the sprite path binds one, and
    // since R-19 so does an unlit or lit draw whose material carries a `map`,
    // so a frame of particles and untextured geometry still has nothing to
    // unbind at the end.
    let textureBound = false;
    // Whether `activeTexture` has selected the map unit this frame. The sprite
    // path selects it on every switch *to* the sprite pipeline (unchanged); a
    // mapped unlit or lit draw selects it once, on the first one — both target
    // the same unit, so a frame that mixes them issues one call either way.
    let mapUnitActive = false;

    try {
      // Inside the envelope on purpose (R-4): the `finally` below unbinds it,
      // so a draw that throws mid-pass cannot leave this renderer's framebuffer
      // bound for whatever touches the context next. On the on-screen path this
      // issues no call at all — which is what keeps that path's GL sequence
      // byte-identical to the one it issued before targets existed.
      if (targetRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, targetRecord.framebuffer);
      }

      const items =
        interpolation === undefined
          ? buildRenderList(root, renderList)
          : buildInterpolatedRenderList(
              root,
              interpolation.poseBuffer,
              interpolation.alpha,
              renderList,
            );

      // The frame's lights (§68), collected only when something will be shaded
      // by them: one `kind` comparison per item decides, so a scene with no lit
      // materials adds nothing to its frame but this loop. Collected once per
      // call, not per view — lights are frame state, like the render list.
      // Both shaded families ask for the same record (§59's standard pipeline
      // reads exactly the ambient term and directional light §68 collects), so
      // one walk serves them together and a scene with neither still pays only
      // this comparison.
      let hasLitItems = false;
      for (const item of items) {
        if (item.kind === "lit" || item.kind === "standard") {
          hasLitItems = true;
          break;
        }
      }
      if (hasLitItems) {
        collectSceneLights(root, sceneLights);
      }

      // The unlit pipeline is the frame's starting state, so a scene with no
      // sprites issues exactly the GL sequence it issued before sprites existed.
      program.use();
      let activeKind: RenderItemKind = "unlit";
      // The GL state mirror starts where `#applyFixedState` and GL's own defaults
      // left it; every draw below moves it only where its material asks.
      resetGlState(state);

      for (const view of views) {
        // §61's clears are masked by the depth and colour write state, so a view
        // that follows a `depthWrite: false` or `colorWrite: false` draw would
        // clear nothing at all. Put both back first; with §57's defaults this
        // issues no call.
        applyDepthColorState(gl, state, true, true, true);
        resolveRect(view, surfaceWidth, surfaceHeight);
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
        viewProjection
          .copy(camera.projectionMatrix)
          .multiply(camera.viewMatrix);

        // A uniform belongs to the program it was uploaded into, so the unlit
        // pipeline has to be current before its view-projection is written — and
        // the sprite pipeline needs its own copy, uploaded the first time it draws
        // into this view and valid for the rest of it.
        if (activeKind !== "unlit") {
          program.use();
          applyBlendState(gl, state, false, "normal");
          activeKind = "unlit";
        }
        program.setViewProjection(viewProjection);
        let spriteViewUploaded = false;
        let particleViewUploaded = false;
        let litViewUploaded = false;
        let standardViewUploaded = false;

        // §46's per-view filter (R-38, 2026-08-08): `view.layerMask` when this
        // view sets one, the camera's own `layers` otherwise — §48's fallback
        // rule, resolved by `@four/render` so every backend spells it the same
        // way. Both defaults are `ALL_LAYERS`, so a view that never mentions
        // layers keeps every item and issues the GL sequence it always did.
        //
        // The filter lives here, per view, rather than in list construction,
        // because this backend builds **one** list per frame and draws it into
        // every view (§64 stage 2 vs. the per-view list of R-8). That is why
        // `RenderItem` snapshots the node's mask. When R-8 lands, each view
        // builds its own list with `buildRenderList(root, list, mask)` and this
        // test becomes redundant rather than wrong.
        const viewLayers = viewLayerMask(view);

        for (const item of items) {
          // `layersMatch(item.layers, viewLayers)`, inlined: `@four/scene` is
          // not a dependency of this package (plan §3.1, frozen), and the
          // predicate is one bitwise AND.
          if ((item.layers & viewLayers) === 0) {
            continue;
          }

          const record = geometries.acquire(item.geometry);
          if (record === null) {
            continue;
          }

          if (isParticlesItem(item)) {
            // §36's whole system, one instanced draw (plan P9-3). The geometry
            // record is the *shared unit quad* every particle item points at, so
            // the corner stream is uploaded once for the application and this
            // system's own vertex array is built on top of that buffer.
            if (item.count === 0) {
              continue;
            }
            const batch = particleBatches.acquire(item, record.positionBuffer);
            if (batch === null) {
              continue;
            }
            if (activeKind !== "particles") {
              particleProgram.use();
              activeKind = "particles";
            }
            // Particles are transparent by construction (§36's colour ramp) and
            // carry no material to say otherwise, so they blend with the straight
            // alpha function and draw with §57's default depth and colour state —
            // see `gl-particles.ts` for the whole policy.
            applyMaterialState(gl, state, undefined, true);
            if (!particleViewUploaded) {
              // The billboard offset happens between the view and the projection,
              // so this pipeline takes the two matrices separately rather than
              // the premultiplied `viewProjection` the other two use.
              particleProgram.setProjection(camera.projectionMatrix);
              particleProgram.setView(camera.viewMatrix);
              particleViewUploaded = true;
            }
            particleProgram.setModel(item.worldMatrix);
            particleBatches.upload(batch, item);
            gl.bindVertexArray(batch.vertexArray);
            gl.drawArraysInstanced(record.mode, 0, record.count, item.count);
            if (statistics !== null) {
              // One draw call, `item.count` instances of the shared quad — the
              // §36 system's whole per-frame GPU cost, and the one place in
              // this backend where `instances` exceeds `drawCalls`.
              countDraw(statistics, record.mode, record.count, item.count);
            }
            continue;
          }

          if (isSpriteItem(item)) {
            const material = item.material;
            const texture = resolveTexture(
              textures,
              renderTargets,
              activeTarget,
              material.texture,
            );
            if (texture === null) {
              continue;
            }
            if (activeKind !== "sprite") {
              spriteProgram.use();
              spriteProgram.setSampler(SPRITE_TEXTURE_UNIT);
              gl.activeTexture(GL.TEXTURE0);
              activeKind = "sprite";
            }
            // §55's pipeline blends by construction — it did before §57's
            // `transparent` flag existed, and a textured quad with an alpha
            // channel has to composite whatever the flag says — so `alwaysBlend`
            // is `true` here. Everything else the material declares (blend mode,
            // depth test, depth write, colour write) applies as usual.
            applyMaterialState(gl, state, material, true);
            if (!spriteViewUploaded) {
              spriteProgram.setViewProjection(viewProjection);
              spriteViewUploaded = true;
            }
            // The quad's local rectangle, from which the vertex stage derives uv.
            // `computeBounds()` is cached against the geometry's version, so this
            // is a version comparison per draw, not a pass over the vertices.
            const bounds = item.geometry.computeBounds();
            spriteProgram.setModel(item.worldMatrix);
            spriteProgram.setQuad(
              bounds.min.x,
              bounds.min.y,
              bounds.max.x - bounds.min.x,
              bounds.max.y - bounds.min.y,
            );
            spriteProgram.setTint(material.tint, opacityOf(material));
            gl.bindTexture(GL.TEXTURE_2D, texture);
            textureBound = true;
          } else if (isLitItem(item)) {
            // The Lambert-lit pipeline (§68): depth-tested exactly like unlit,
            // and opaque unless its material says otherwise (§57) — which, at
            // the default `transparent: false`, is every material that predates
            // the flag.
            if (activeKind !== "lit") {
              litProgram.use();
              activeKind = "lit";
            }
            applyMaterialState(gl, state, item.material, false);
            if (!litViewUploaded) {
              // The view-projection and the frame's lights, once per view —
              // uniforms live in the program object, so they hold for every lit
              // draw into this view even if other pipelines run in between. The
              // lights were collected before the view loop; a frame with no
              // directional light uploads black `lightColor`, which zeroes the
              // Lambert term in the shader (no variants, no branch here).
              litProgram.setViewProjection(viewProjection);
              litProgram.setAmbientLight(sceneLights.ambientColor);
              litProgram.setDirectionalLight(
                sceneLights.direction,
                sceneLights.directionalColor,
              );
              litViewUploaded = true;
            }
            // §57's `map` (R-19): an albedo texture, bound and switched on for
            // this draw and switched off again by the next draw that has none.
            // A material with no map — every material authored before R-19 —
            // acquires nothing, binds nothing, and uploads nothing.
            const litMap = mapOf(item.material);
            const litTexture =
              litMap === null
                ? null
                : resolveTexture(textures, renderTargets, activeTarget, litMap);
            if (litTexture !== null) {
              if (!mapUnitActive) {
                gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                mapUnitActive = true;
              }
              gl.bindTexture(GL.TEXTURE_2D, litTexture);
              textureBound = true;
            }
            litProgram.setFeatures(litTexture !== null);
            litProgram.setModel(item.worldMatrix);
            litProgram.setColor(item.material.color, opacityOf(item.material));
          } else if (isStandardItem(item)) {
            // §59's metallic-roughness pipeline (R-13). Structurally the lit
            // branch above — same lights, same albedo map, same §57 render
            // state — plus the two things a specular lobe needs and a diffuse
            // one does not: the eye position, and the surface's own metalness,
            // roughness, and emissive term.
            if (activeKind !== "standard") {
              standardProgram.use();
              activeKind = "standard";
            }
            applyMaterialState(gl, state, item.material, false);
            if (!standardViewUploaded) {
              // Per-view state: uniforms live in the program object, so one
              // upload holds for every standard draw into this view even when
              // other pipelines run in between.
              standardProgram.setViewProjection(viewProjection);
              standardProgram.setAmbientLight(sceneLights.ambientColor);
              standardProgram.setDirectionalLight(
                sceneLights.direction,
                sceneLights.directionalColor,
              );
              // The eye, read straight out of the camera's world matrix
              // translation column — `updateViewMatrix()` above resolved that
              // matrix, so this needs no second resolve and allocates nothing.
              const cameraElements = camera.transform.worldMatrix.elements;
              standardProgram.setCameraPosition(
                cameraElements[12],
                cameraElements[13],
                cameraElements[14],
              );
              standardViewUploaded = true;
            }
            const standardMap = mapOf(item.material);
            const standardTexture =
              standardMap === null
                ? null
                : resolveTexture(
                    textures,
                    renderTargets,
                    activeTarget,
                    standardMap,
                  );
            if (standardTexture !== null) {
              if (!mapUnitActive) {
                gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                mapUnitActive = true;
              }
              gl.bindTexture(GL.TEXTURE_2D, standardTexture);
              textureBound = true;
            }
            standardProgram.setFeatures(standardTexture !== null);
            standardProgram.setModel(item.worldMatrix);
            standardProgram.setBaseColor(
              item.material.baseColor,
              opacityOf(item.material),
            );
            standardProgram.setSurface(
              item.material.metalness,
              item.material.roughness,
              item.material.emissive,
            );
          } else {
            if (activeKind !== "unlit") {
              program.use();
              activeKind = "unlit";
            }
            applyMaterialState(gl, state, item.material, false);
            const map = mapOf(item.material);
            const texture =
              map === null
                ? null
                : resolveTexture(textures, renderTargets, activeTarget, map);
            if (texture !== null) {
              if (!mapUnitActive) {
                gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                mapUnitActive = true;
              }
              gl.bindTexture(GL.TEXTURE_2D, texture);
              textureBound = true;
            }
            // §53's per-vertex colours (R-19) reach the screen here, and with
            // them §113's debug-draw overlay (R-35): a `"lines"` geometry of
            // positions plus colours is one draw call, not one per segment.
            program.setFeatures(
              texture !== null,
              item.material.vertexColors === true,
            );
            program.setModel(item.worldMatrix);
            program.setColor(item.material.color, opacityOf(item.material));
          }

          gl.bindVertexArray(record.vertexArray);
          if (record.indexType === null) {
            gl.drawArrays(record.mode, 0, record.count);
          } else {
            gl.drawElements(record.mode, record.count, record.indexType, 0);
          }
          if (statistics !== null) {
            // Sprite, lit, and unlit all land here: one draw call, one
            // instance, `record.count` elements either way (§84).
            countDraw(statistics, record.mode, record.count, 1);
          }
        }
      }
    } finally {
      // Restore the fixed state the frame borrowed, and leave nothing bound:
      // the next thing to touch this context may not be this renderer (§61
      // allows several renderers over one application).
      //
      // In a `finally` since F13 (2026-08-07). A draw can throw for reasons
      // that are entirely the application's — a disposed texture, a geometry
      // whose accessor raises — and before this the frame simply abandoned
      // whatever GL state it had borrowed. The mirror above then disagreed
      // with the context for the rest of the process: the next frame *asserted*
      // the defaults, so the skip logic never re-issued the calls that would
      // have fixed them, and an opaque scene drew blended (or masked, or
      // depth-testless) with nothing to point at. Restoring here makes a
      // mid-frame throw cost exactly the frame it happened in.
      restoreGlState(gl, state);
      if (textureBound) {
        gl.bindTexture(GL.TEXTURE_2D, null);
      }
      gl.bindVertexArray(null);
      // Back to the default drawing buffer (R-4). Same argument as the two
      // unbinds above, one step stronger: a framebuffer left bound by a frame
      // that threw would send *every later frame* — this renderer's on-screen
      // ones included — into an off-screen surface nobody is looking at, with
      // nothing on screen and no error anywhere to explain it.
      if (targetRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      }
    }
  }

  /**
   * Draws one §70 full-screen effect (R-6, 2026-08-07) — `pass.source`'s
   * colour attachment over the whole of `pass.target`, or of the drawing
   * buffer, through `pass.effect`.
   *
   * The normative contract is on `@four/render`'s `Renderer.renderEffect`;
   * this is what the WebGL 2 backend does with it, and the two readings that
   * sentence left open.
   *
   * ## A separate entry point, and why `render` was not touched
   *
   * An effect is not a scene: it has no root, no views, no camera, no render
   * list, and no interpolation, and it draws a triangle that exists only in
   * the vertex stage. Routing it through `render` would have meant a fifth
   * `RenderItemKind`, a synthetic node, and a branch inside the draw loop —
   * and the loop is exactly where R-4, R-5 and F13 each had to re-prove that
   * an application which uses none of those features still emits the identical
   * GL call sequence. So §70 got its own method, and the property is preserved
   * by construction rather than by proof: **`render` is byte-for-byte the
   * function it was before this method existed.** The one thing R-6 adds to a
   * frame that runs no effect is a fifth `useProgram`-able object compiled at
   * initialization, which issues no call after that.
   *
   * ## What is skipped rather than thrown (§61, §83)
   *
   * Everything, on the same terms `render` uses — a lost context, a source or
   * destination the application disposed, a framebuffer GL would not allocate,
   * an effect kind this build does not implement, and a **feedback loop**: a
   * pass whose destination is the very surface it samples. That last one is
   * R-4's rule, applied to the pass instead of to a material's `map`; reading
   * and writing one surface in a single draw is undefined behaviour on every
   * backend, and `RenderGraph.validate` reports it statically as `"feedback"`
   * so the mistake is normally caught at setup rather than here.
   *
   * ## State, and the F13 envelope
   *
   * The effect borrows four things — the framebuffer binding, the scissor and
   * viewport rectangles, the depth test, and unit 0's texture binding — inside
   * a `try`/`finally`, so whatever escapes leaves this renderer's §57 mirror
   * and the context in the state the next frame expects (F13, 2026-08-07).
   * The mirror is deliberately **not** reset on entry: `applyDepthColorState`
   * moves only what the effect needs and the `finally` puts back exactly that,
   * which is strictly more conservative than re-asserting a state this method
   * did not establish.
   *
   * The scissor and viewport rectangles are *not* restored, exactly as `render`
   * does not restore them: both are written unconditionally by the next view of
   * the next frame, and every path that reads them writes them first.
   */
  renderEffect(pass: EffectRenderPass): void {
    const gl = this.#requireContext("renderEffect");
    if (this.#contextLost) {
      return;
    }

    // Unreachable given the class invariant, exactly as in `render`; the
    // fields are nullable so context loss can drop them, and §61 forbids
    // throwing here, so the effect is skipped if it is ever broken.
    const effectProgram = this.#effectProgram;
    const renderTargets = this.#renderTargets;
    if (effectProgram === null || renderTargets === null) {
      return;
    }

    // Read structurally, like every other argument this backend meets: the
    // marker guard rather than the type, so a caller that bypassed
    // `validateEffectRenderPass` hands over a plain `Texture` and gets a
    // skipped effect instead of a black screen with no explanation.
    const source = pass.source;
    if (!isRenderTargetTexture(source)) {
      return;
    }
    const sourceTarget = source.renderTarget;
    const destination = pass.target ?? null;
    if (destination === sourceTarget) {
      return;
    }

    // Resolved before the envelope, as `render` resolves its target and for
    // the same reason: `acquire` is a pure allocation with nothing to unwind
    // and never throws, so a disposed or unallocatable surface skips the
    // effect here rather than half-drawing it.
    const sourceRecord = renderTargets.acquire(sourceTarget);
    if (sourceRecord === null) {
      return;
    }
    let destinationRecord: RenderTargetRecord | null = null;
    if (destination !== null) {
      destinationRecord = renderTargets.acquire(destination);
      if (destinationRecord === null) {
        return;
      }
    }

    // An effect kind this build does not implement is skipped, never quietly
    // copied: `ScreenEffect` is a closed union precisely so that a staged §70
    // effect is a compile error, and a value that arrived from JSON or from
    // JavaScript must not become a different picture than the one asked for.
    const effect = pass.effect;
    if (
      effect.kind !== "copy" &&
      effect.kind !== "grade" &&
      effect.kind !== "output-transform"
    ) {
      return;
    }

    const width = destinationRecord?.width ?? this.#bufferWidth;
    const height = destinationRecord?.height ?? this.#bufferHeight;
    const state = this.#glState;
    const statistics = this.statistics;
    let textureBound = false;

    try {
      if (destinationRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, destinationRecord.framebuffer);
      }
      // The whole destination surface: §70's effects are full-screen, and a
      // per-viewport rectangle is staged (`@four/render`'s `effect-pass.ts`
      // says what it would take). `SCISSOR_TEST` is on for this renderer's
      // lifetime, so the rectangle has to be written or the previous view's
      // would clip the blit.
      gl.scissor(0, 0, width, height);
      gl.viewport(0, 0, width, height);

      // An effect *replaces* its destination: no blending, so a chain is
      // predictable, and no depth test, so the triangle is never rejected by
      // whatever depth the destination happens to hold. Disabling the depth
      // test also disables depth *writes* in GL, so `depthMask` needs no
      // change and none is issued.
      applyBlendState(gl, state, false, "normal");
      applyDepthColorState(gl, state, false, true, true);

      effectProgram.use();
      effectProgram.setSampler(EFFECT_TEXTURE_UNIT);
      gl.activeTexture(GL.TEXTURE0 + EFFECT_TEXTURE_UNIT);
      gl.bindTexture(GL.TEXTURE_2D, sourceRecord.texture);
      textureBound = true;

      if (effect.kind === "grade") {
        effectProgram.setGrade(
          effect.exposure ?? COLOR_GRADE_DEFAULTS.exposure,
          effect.contrast ?? COLOR_GRADE_DEFAULTS.contrast,
          effect.saturation ?? COLOR_GRADE_DEFAULTS.saturation,
        );
      } else if (effect.kind === "output-transform") {
        // §60a's output transform, as the final render-graph pass: the encode
        // happens once, over the composited linear-light frame, and never
        // inside a material's fragment stage (R-15, 2026-08-08).
        effectProgram.setOutputTransform();
      } else {
        effectProgram.setCopy();
      }

      // No vertex data at all — the three corners come from `gl_VertexID`
      // (`gl-effect.ts`). The default vertex array is bound first because an
      // unrelated one left bound by another consumer of this context can carry
      // enabled attribute arrays, which WebGL validates against the draw count
      // whether the program reads them or not.
      gl.bindVertexArray(null);
      gl.drawArrays(GL.TRIANGLES, 0, EFFECT_VERTEX_COUNT);
      if (statistics !== null) {
        // One draw call, one instance, one triangle (§84) — counted here for
        // the same reason a scene draw is: what reached the GPU, not what was
        // asked for.
        countDraw(statistics, GL.TRIANGLES, EFFECT_VERTEX_COUNT, 1);
      }
    } finally {
      restoreGlState(gl, state);
      if (textureBound) {
        gl.bindTexture(GL.TEXTURE_2D, null);
      }
      if (destinationRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      }
    }
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
      this.#spriteProgram?.dispose();
      this.#particleProgram?.dispose();
      this.#litProgram?.dispose();
      this.#standardProgram?.dispose();
      this.#effectProgram?.dispose();
      this.#geometries?.dispose();
      this.#textures?.dispose();
      this.#renderTargets?.dispose();
      this.#particleBatches?.dispose();
    }

    this.#program = null;
    this.#spriteProgram = null;
    this.#particleProgram = null;
    this.#litProgram = null;
    this.#standardProgram = null;
    this.#effectProgram = null;
    this.#geometries = null;
    this.#textures = null;
    this.#renderTargets = null;
    this.#particleBatches = null;
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

    // All six programs are built before anything is stored, so a shader
    // failure leaves the renderer uninitialized rather than half-initialized —
    // and each failure disposes the ones already built.
    const program = UnlitProgram.create(gl);
    let spriteProgram: SpriteProgram;
    try {
      spriteProgram = SpriteProgram.create(gl);
    } catch (error: unknown) {
      program.dispose();
      throw error;
    }
    let particleProgram: ParticleProgram;
    try {
      particleProgram = ParticleProgram.create(gl);
    } catch (error: unknown) {
      spriteProgram.dispose();
      program.dispose();
      throw error;
    }
    let litProgram: LitProgram;
    try {
      litProgram = LitProgram.create(gl);
    } catch (error: unknown) {
      particleProgram.dispose();
      spriteProgram.dispose();
      program.dispose();
      throw error;
    }
    // §59's metallic-roughness pipeline (R-13), compiled here for the reason
    // every other pipeline is: §61 forbids a frame from throwing, and a shader
    // compile is exactly the operation that can.
    let standardProgram: StandardProgram;
    try {
      standardProgram = StandardProgram.create(gl);
    } catch (error: unknown) {
      litProgram.dispose();
      particleProgram.dispose();
      spriteProgram.dispose();
      program.dispose();
      throw error;
    }
    // §70's effect pipeline, compiled here rather than on first use (R-6):
    // `renderEffect` runs inside a frame, and §61's no-throw rule applies to
    // it for the same reason it applies to `render` — see `#effectProgram`.
    let effectProgram: EffectProgram;
    try {
      effectProgram = EffectProgram.create(gl);
    } catch (error: unknown) {
      standardProgram.dispose();
      litProgram.dispose();
      particleProgram.dispose();
      spriteProgram.dispose();
      program.dispose();
      throw error;
    }

    this.#canvas = canvas;
    this.#gl = gl;
    this.#program = program;
    this.#spriteProgram = spriteProgram;
    this.#particleProgram = particleProgram;
    this.#litProgram = litProgram;
    this.#standardProgram = standardProgram;
    this.#effectProgram = effectProgram;
    this.#geometries = new GeometryCache(gl);
    this.#textures = new TextureCache(gl);
    this.#renderTargets = new RenderTargetCache(gl);
    this.#particleBatches = new ParticleBatchCache(gl);
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
  #applyFixedState(gl: ParticleGlContext): void {
    gl.enable(GL.DEPTH_TEST);
    gl.depthFunc(GL.LEQUAL);
    gl.frontFace(GL.CCW);
    gl.disable(GL.CULL_FACE);
    gl.enable(GL.SCISSOR_TEST);
    // The blend *function* is fixed (§66 straight alpha); the blend *enable* is
    // not — it is toggled around sprite runs by `render`. GL's initial state
    // already has `BLEND` disabled, so nothing is disabled here.
    gl.blendFunc(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA);
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
  #requireContext(method: string): ParticleGlContext {
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
