/**
 * The WebGL 2 picking service (§71, §62; RFC 0005, 2026-08-28) — the id-buffer
 * pass and its asynchronous read-back, reached only through
 * {@link registerPickingPipeline}.
 *
 * ## What one pass draws
 *
 * `@four/render`'s `PickingService` contract, executed: the service owns an
 * offscreen `RenderTarget` sized to the drawing buffer, builds the **same
 * render list the frame builds** (`buildRenderList` → `buildViewRenderList`
 * with the view's own frustum, in the same §66 order — order *is* the picture
 * for co-planar 2D content), and draws every item through one flat id program
 * whose colour is the candidate's table index + 1 (`encodePickId`).
 * The table is traversal-ordered and rebuilt per pass
 * (`collectPickCandidates` — the §33 obligations live there); a sorted item
 * joins back to its table index through its `worldMatrix` **object**, which
 * the non-interpolated builder documents as the node's own.
 *
 * Per-item state mirrors what decides *which surface is on top* in the real
 * frame — depth test/write, colour write, and §67's clip stencils (mask
 * draws write their bit plane with colour off; clipped content tests it), so
 * a scrolled-away list row does not pick — and deliberately nothing else:
 *
 * - **blending is ignored** — a transparent surface writes its id over its
 *   full geometry; per-texel alpha accuracy is §71's `"pixel"` strategy, the
 *   CPU tier `@four/input`'s `PickableAlphaMask` ships (RFC 0005
 *   alternative D, adopted);
 * - **`material.stencil` (R-7's hand-composed tier) is not applied** — the
 *   id target carries stencil bits only for §67 clips, and a hand-composed
 *   mask is the author's picture, not the engine's to reproduce here;
 * - **skinned items are skipped** — a bind-pose id is a different picture
 *   (the §69 caster exclusion, third application); the bounds tier serves
 *   them;
 * - **particle items are skipped** — §36's batched item has one node and no
 *   per-particle geometry the flat program could transform; the instanced id
 *   variant is RFC 0005's staged residue, recorded in `TODO.md` at landing.
 *
 * ## The read-back is asynchronous, honestly (§61; RFC 0005 §4)
 *
 * `pick` reads one texel. Where the context has the fence entry points
 * (`PIXEL_PACK_BUFFER` + `fenceSync`/`clientWaitSync`/`getBufferSubData` —
 * core WebGL 2, optional on doubles), the read is **non-stalling**: issued
 * into a pack buffer, polled without blocking, copied back once the GPU
 * signals. Where they are absent the stalling `readPixels` answers — same
 * shape, same `Promise`, one frame less honest about latency. §96's
 * cross-origin hazard is enforced by the browser itself: a tainted surface
 * makes `readPixels` throw, and that failure is reported (a rejection), never
 * masked.
 *
 * ## Cost discipline (pipeline-cost law, R-6)
 *
 * Nothing here is reachable from `WebglRenderer` — it resolves the registry
 * slot (`gl-picking-registry.ts`) and this module links only when the
 * application calls {@link registerPickingPipeline}. The id program compiles
 * lazily on the first pass, never at registration or creation, so a scene
 * that registers and never picks issues its byte-identical GL sequence — and
 * a pass restores every piece of GL state it touched to the renderer's
 * between-frames baseline, so the *next* frame's transcript is byte-identical
 * too (asserted in `tests/integration/pixel-picking.test.ts`).
 */

import { DEV, FourError, devWarnOnce } from "@four/core";
import { Frustum, Matrix4 } from "@four/math";
import {
  RenderTarget,
  assertEncodableCandidateCount,
  buildRenderList,
  buildViewRenderList,
  collectPickCandidates,
  decodePickId,
  encodePickId,
  type PickRequest,
  type PickResult,
  type PickingService,
  type RenderItem,
  type RenderItemClip,
  type RenderItemStencil,
} from "@four/render";

import type { GeometryCache } from "./gl-geometry.js";
import {
  setPickingServiceFactory,
  type PickingRendererHost,
} from "./gl-picking-registry.js";
import {
  GL,
  createLinkedProgram,
  matrixScratch,
  requireUniform,
  type GlProgramHandle,
  type GlUniformLocation,
  type WebglContext,
} from "./gl-program.js";
import type { RenderTargetRecord } from "./gl-render-target.js";

/**
 * The subtree root an update draws and the viewport it draws it into — read
 * off the `PickingService` interface rather than imported from `@four/scene`:
 * this package depends on `core`, `math`, and `render` only (plan §3.1,
 * frozen), and `Parameters<…>` yields exactly the `Node` and `Viewport` types
 * the interface declares — `webgl-renderer.ts`'s `RenderRoot` move.
 */
type PickRoot = Parameters<PickingService["update"]>[0];

/** One viewport, derived as {@link PickRoot} is. */
type PickView = Parameters<PickingService["update"]>[1];

/**
 * The GL enumerants only the picking read-back uses — the `PARTICLE_GL`
 * precedent: kept beside their one consumer rather than widening the shared
 * {@link GL} object every `WebglRenderer` bundle carries.
 */
export const PICKING_GL = {
  /** `GL_PIXEL_PACK_BUFFER` — the non-stalling read-back's destination. */
  PIXEL_PACK_BUFFER: 0x88eb,
  /** `GL_STREAM_READ` — written by GL once, read back by the CPU once. */
  STREAM_READ: 0x88e1,
  /** `GL_SYNC_GPU_COMMANDS_COMPLETE` — the only condition `fenceSync` accepts. */
  SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
  /** `GL_SYNC_FLUSH_COMMANDS_BIT` — flush on the first wait, so the fence is reachable. */
  SYNC_FLUSH_COMMANDS_BIT: 0x00000001,
  /** `GL_ALREADY_SIGNALED`. */
  ALREADY_SIGNALED: 0x911a,
  /** `GL_TIMEOUT_EXPIRED` — not yet; poll again. */
  TIMEOUT_EXPIRED: 0x911b,
  /** `GL_CONDITION_SATISFIED`. */
  CONDITION_SATISFIED: 0x911c,
  /** `GL_WAIT_FAILED` — the wait itself failed (a lost context, typically). */
  WAIT_FAILED: 0x911d,
} as const;

/** §67's stencil comparisons, by their §57 names (`webgl-renderer.ts`'s map, restated for this pass). */
const STENCIL_FUNC: Record<RenderItemStencil["func"], number> = {
  never: GL.NEVER,
  less: GL.LESS,
  equal: GL.EQUAL,
  lequal: GL.LEQUAL,
  greater: GL.GREATER,
  notequal: GL.NOTEQUAL,
  gequal: GL.GEQUAL,
  always: GL.ALWAYS,
};

/** §67's stencil operations, by their §57 names. */
const STENCIL_OP: Record<RenderItemStencil["failOp"], number> = {
  keep: GL.KEEP,
  zero: GL.ZERO,
  replace: GL.REPLACE,
  increment: GL.INCR,
  "increment-wrap": GL.INCR_WRAP,
  decrement: GL.DECR,
  "decrement-wrap": GL.DECR_WRAP,
  invert: GL.INVERT,
};

/** All eight stencil bits — the write mask's between-frames baseline. */
const STENCIL_ALL_BITS = 0xff;

/**
 * The id pass's vertex stage: the unlit program's `gl_Position` expression
 * exactly — same attribute slot, same `viewProjection · model` split — so
 * every surface item rasterises the *same fragments* its real draw does
 * (§55's sprite quad included: its vertex stage is this same expression, uv
 * derivation aside).
 */
const ID_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 viewProjection;
uniform mat4 model;

void main() {
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The id pass's fragment stage: one flat RGBA8 id, no arithmetic
 * (`encodePickId` for the encoding). `highp` for the unlit fragment
 * stage's reason.
 */
const ID_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 pickId;

out vec4 fragColor;

void main() {
  fragColor = pickId;
}
`;

/**
 * The compiled id program — `UnlitProgram`'s creation and upload discipline
 * over the two sources above. Compiled lazily by {@link WebglPickingService}
 * on its first pass, never at registration or service creation.
 */
export class IdPassProgram {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #idLocation: GlUniformLocation;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    idLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#idLocation = idLocation;
  }

  /**
   * Compiles and links the id program on `gl` — `UnlitProgram.create`'s
   * contract: throws `SHADER_COMPILATION_FAILED` (§89) with the driver's log
   * attached, deletes shader objects on every path.
   */
  static create(gl: WebglContext): IdPassProgram {
    const program = createLinkedProgram(
      gl,
      "pick-id",
      ID_VERTEX_SHADER_SOURCE,
      ID_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new IdPassProgram(
        gl,
        program,
        requireUniform(gl, program, "viewProjection", "pick-id"),
        requireUniform(gl, program, "model", "pick-id"),
        requireUniform(gl, program, "pickId", "pick-id"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link IdPassProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Once per pass, before any upload. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /** Uploads `projection * view` for the pass. Column-major (§7b). */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /** Uploads one item's world matrix. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /** Uploads one encoded id colour (`encodePickId`'s four floats). */
  setId(encoded: Float32Array): void {
    this.#gl.uniform4fv(this.#idLocation, encoded);
  }

  /** Deletes the GL program (§83). Idempotent; live context only. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/** One pass's resolved viewport rectangle, in target pixels. */
interface PassRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What one successful {@link WebglPickingService.update} leaves behind. */
interface PassState {
  /** The `Viewport` object the pass drew — `pick` refuses any other (§85). */
  readonly viewport: PickView;
  /** The resolved rectangle NDC maps into. */
  readonly rect: PassRect;
  /** The framebuffer the ids were drawn into. */
  readonly record: RenderTargetRecord;
  /** This pass's update ordinal — `PickResult.frame`. */
  readonly frame: number;
  /**
   * The context and geometry cache the pass drew with — the **era witness**:
   * a §61 loss keeps the context *object* but kills every handle, and the
   * renderer answers by building new caches, so `pick` compares this against
   * the host's current cache and refuses (`CONTEXT_LOST`) on mismatch rather
   * than reading a framebuffer that no longer exists.
   */
  readonly era: GeometryCache;
  readonly gl: WebglContext;
}

/**
 * The optional read-back entry points, narrowed once by `pick` and handed to
 * the fenced reader as values — presence is the capability (§62), checked in
 * exactly one place.
 */
interface FenceReadEntryPoints {
  readonly readPixels: NonNullable<WebglContext["readPixels"]>;
  readonly fenceSync: NonNullable<WebglContext["fenceSync"]>;
  readonly clientWaitSync: NonNullable<WebglContext["clientWaitSync"]>;
  readonly deleteSync: NonNullable<WebglContext["deleteSync"]>;
  readonly getBufferSubData: NonNullable<WebglContext["getBufferSubData"]>;
}

/** Scratch shared by every service — consumed within one call (plan D7). */
const passItems: RenderItem[] = [];
const passViewItems: RenderItem[] = [];
const passViewProjection = new Matrix4();
const passFrustum = new Frustum();
const idScratch = new Float32Array(4);
const rectScratch: PassRect = { x: 0, y: 0, width: 0, height: 0 };

/** §48's rectangle resolution — `webgl-renderer.ts`'s `resolveRect`, restated. */
function resolvePassRect(
  view: PickView,
  surfaceWidth: number,
  surfaceHeight: number,
): PassRect {
  const scaleX = view.normalized === true ? surfaceWidth : 1;
  const scaleY = view.normalized === true ? surfaceHeight : 1;
  rectScratch.x = Math.round(view.x * scaleX);
  rectScratch.y = Math.round(view.y * scaleY);
  rectScratch.width = Math.max(0, Math.round(view.width * scaleX));
  rectScratch.height = Math.max(0, Math.round(view.height * scaleY));
  return rectScratch;
}

/**
 * One tick of the fence poll — a macrotask where the host has `setTimeout`
 * (browsers, workers, Node), a microtask where it does not, so the poll loop
 * still terminates on an exotic host instead of never running.
 */
function nextPoll(): Promise<void> {
  const host = globalThis as {
    setTimeout?: (callback: () => void, delay: number) => unknown;
  };
  const schedule = host.setTimeout;
  if (typeof schedule === "function") {
    return new Promise((resolve) => {
      schedule(resolve, 0);
    });
  }
  return Promise.resolve();
}

/** The lifecycle refusal code `NullRenderer` and `Application` use (§83, §89). */
const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * `@four/render`'s `PickingService`, executed on the WebGL 2 backend — see
 * the module header for the pass, the interface for the contract. Built by
 * `WebglRenderer.createPickingService()` once {@link registerPickingPipeline}
 * has run; one service per call, each with its own id buffer.
 */
export class WebglPickingService implements PickingService {
  readonly #host: PickingRendererHost;

  /** The offscreen id buffer; created on the first pass, resized with the surface. */
  #target: RenderTarget | null = null;

  /** Whether `#target` carries §67 stencil bits. */
  #targetStencil = false;

  #program: IdPassProgram | null = null;

  /** Latched per era, `#acquireSkinnedPrograms`'s discipline. */
  #programFailed = false;

  /** The cache era `#program` was compiled in. */
  #programEra: GeometryCache | null = null;

  /** The last successful pass, or `null` — what `pick` reads. */
  #pass: PassState | null = null;

  /** The §33 candidate table: texel value `i + 1` resolves to `ids[i]`. */
  readonly #ids: string[] = [];

  /** Traversal-order join key — see `collectPickCandidates`. */
  readonly #indexByMatrix = new Map<Matrix4, number>();

  #updateCount = 0;

  #disposed = false;

  constructor(host: PickingRendererHost) {
    this.#host = host;
  }

  /** Whether {@link WebglPickingService.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  update(root: PickRoot, view: PickView): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "PickingService.update() was called on a disposed service; " +
          "disposal is terminal (§83).",
        { context: { method: "update", disposed: true } },
      );
    }

    // §85's refusals first — they are caller mistakes and fire whatever the
    // context's state is. The surface size gates the rectangle resolution: a
    // renderer that was never resized has a 0×0 drawing buffer, and every
    // NDC→pixel mapping over it would be meaningless.
    const host = this.#host;
    const surfaceWidth = host.surfaceWidth();
    const surfaceHeight = host.surfaceHeight();
    if (!(surfaceWidth >= 1 && surfaceHeight >= 1)) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: the renderer's drawing surface has zero size — call " +
          "Renderer.resize() before the first picking pass (§85).",
        { context: { surfaceWidth, surfaceHeight } },
      );
    }
    const rect = resolvePassRect(view, surfaceWidth, surfaceHeight);
    if (!(rect.width > 0 && rect.height > 0)) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `§71: viewport "${view.id}" resolves to a zero-area rectangle; ` +
          "there is no pixel to pick against (§85, RFC 0005).",
        {
          context: {
            viewport: view.id,
            width: rect.width,
            height: rect.height,
          },
        },
      );
    }

    // The §33 table, rebuilt per pass in traversal order, and its size
    // refused before anything is drawn (§85).
    collectPickCandidates(root, this.#ids, this.#indexByMatrix);
    assertEncodableCandidateCount(this.#ids.length);

    // §61 from here on: a context that is down skips the pass — never a
    // throw — and drops the previous pass, because `pick` answering from a
    // buffer older than the caller's newest `update` would be a stale
    // `undefined` indistinguishable from "nothing there".
    const gl = host.context();
    const geometries = host.geometries();
    const renderTargets = host.renderTargets();
    if (
      gl === null ||
      geometries === null ||
      renderTargets === null ||
      host.contextLost()
    ) {
      this.#pass = null;
      return;
    }

    const program = this.#acquireProgram(gl, geometries);
    if (program === null) {
      this.#pass = null;
      return;
    }

    // The frame's list, in the frame's order (§66) — and the O(1) per-frame
    // stencil decision (WP-R1.3's move, on a target option instead of a
    // pipeline format): mask draws sort first, so the first item says whether
    // this pass needs §67 bit planes at all.
    const items = buildRenderList(root, passItems);
    const needStencil = items.length > 0 && items[0].clip?.maskPass === true;

    // The id buffer, sized to the drawing buffer so the NDC→pixel mapping is
    // the on-screen view's exactly. A stencil-ness change is a reallocation
    // (the attachment format is a construction option); a plain resize rides
    // the target's own version bump.
    let target = this.#target;
    if (target === null || this.#targetStencil !== needStencil) {
      target?.dispose();
      target = new RenderTarget({
        width: surfaceWidth,
        height: surfaceHeight,
        stencil: needStencil,
      });
      this.#target = target;
      this.#targetStencil = needStencil;
    } else if (
      target.width !== surfaceWidth ||
      target.height !== surfaceHeight
    ) {
      target.resize(surfaceWidth, surfaceHeight);
    }
    const record = renderTargets.acquire(target);
    if (record === null) {
      // An incomplete framebuffer or a refused allocation skips the pass
      // (§61), exactly as the frame renderer skips an off-screen frame.
      this.#pass = null;
      return;
    }

    // The view's own projection and cull, so the id picture keeps the frame
    // picture's item set (R-8's derivation, frustum included).
    const camera = view.camera;
    camera.updateViewMatrix();
    passViewProjection
      .copy(camera.projectionMatrix)
      .multiply(camera.viewMatrix);
    passFrustum.setFromViewProjection(passViewProjection);
    const viewItems = buildViewRenderList(items, view, passViewItems, {
      frustum: passFrustum,
    });

    this.#updateCount += 1;
    // Dropped before drawing, not after: if the pass throws mid-draw the old
    // buffer's ids no longer describe the table just built, and a pick
    // against them would resolve wrong nodes rather than refusing.
    this.#pass = null;
    this.#drawPass(gl, geometries, program, record, rect, viewItems);

    this.#pass = {
      viewport: view,
      rect: { ...rect },
      record,
      frame: this.#updateCount,
      era: geometries,
      gl,
    };
  }

  async pick(request: PickRequest): Promise<PickResult> {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "PickingService.pick() was called on a disposed service; disposal " +
          "is terminal (§83).",
        { context: { method: "pick", disposed: true } },
      );
    }
    const pass = this.#pass;
    if (pass === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: there is no id buffer to read — update() has not drawn one " +
          "(or its last attempt was skipped, §61); a stale answer would be " +
          "indistinguishable from “nothing there” (§85, RFC 0005).",
        { context: { updated: this.#updateCount > 0 } },
      );
    }
    if (request.viewport !== pass.viewport) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: this pick names a viewport the last update() did not draw — " +
          "the id buffer holds exactly one view's pass (§85, RFC 0005).",
        {
          context: {
            requested: request.viewport.id,
            drawn: pass.viewport.id,
          },
        },
      );
    }
    const ndcX = request.ndcX;
    const ndcY = request.ndcY;
    if (!(ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1)) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: pick coordinates must be normalized device coordinates in " +
          "[-1, 1] (§85; refused rather than clamped, RFC 0005).",
        { context: { ndcX, ndcY } },
      );
    }

    const host = this.#host;
    const gl = host.context();
    if (host.disposed() || gl === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: the renderer behind this picking service has been disposed " +
          "(§83).",
        { context: { rendererDisposed: true } },
      );
    }
    if (
      host.contextLost() ||
      host.geometries() !== pass.era ||
      gl !== pass.gl
    ) {
      throw new FourError(
        "CONTEXT_LOST",
        "§71: the id buffer did not survive a context loss — render and " +
          "update() again, then pick (§61).",
        { context: { contextLost: host.contextLost() } },
      );
    }
    const readPixels = gl.readPixels;
    if (readPixels === undefined) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        "§71: this context has no readPixels entry point, so an id buffer " +
          "cannot be read back (§62).",
        { context: { entryPoint: "readPixels" } },
      );
    }

    // NDC → target pixel, +Y up on both sides (§7a; framebuffer read-back is
    // bottom-left-origin like every GL rectangle). The +1 edge lands on the
    // last pixel of the rectangle rather than one past it.
    const rect = pass.rect;
    const px =
      rect.x +
      Math.min(rect.width - 1, Math.floor(((ndcX + 1) / 2) * rect.width));
    const py =
      rect.y +
      Math.min(rect.height - 1, Math.floor(((ndcY + 1) / 2) * rect.height));

    const texel = new Uint8Array(4);
    // The fence group is narrowed here, once, and handed in as values — so
    // the fenced reader carries no second presence check no caller could
    // fail (the recorded defensive-branch rule).
    const fenceSync = gl.fenceSync;
    const clientWaitSync = gl.clientWaitSync;
    const deleteSync = gl.deleteSync;
    const getBufferSubData = gl.getBufferSubData;
    let read = false;
    if (
      fenceSync !== undefined &&
      clientWaitSync !== undefined &&
      deleteSync !== undefined &&
      getBufferSubData !== undefined
    ) {
      read = await this.#readTexelFenced(
        gl,
        { readPixels, fenceSync, clientWaitSync, deleteSync, getBufferSubData },
        pass,
        px,
        py,
        texel,
      );
    }
    if (!read) {
      // The stalling fallback (RFC 0005 §4): synchronous for the CPU, still a
      // `Promise` for the caller — the shape never varies by path (§62).
      gl.bindFramebuffer(GL.FRAMEBUFFER, pass.record.framebuffer);
      try {
        readPixels.call(gl, px, py, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, texel);
      } finally {
        gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      }
    }

    const value = decodePickId(texel);
    const ids = this.#ids;
    // A value past the table is a driver anomaly (the pass never wrote one);
    // "nothing identifiable" is the honest answer for it, exactly as for 0.
    const nodeId =
      value === 0 || value > ids.length ? undefined : ids[value - 1];
    return { nodeId, frame: pass.frame };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const host = this.#host;
    const live =
      !host.disposed() && !host.contextLost() && host.geometries() !== null;
    // The program belongs to the era it compiled in; deleting a handle from a
    // dead era would be a GL call against a lost context (§61).
    if (
      this.#program !== null &&
      live &&
      host.geometries() === this.#programEra
    ) {
      this.#program.dispose();
    }
    this.#program = null;
    // Disposing the target bumps its version; asking the cache for it once
    // more is what makes the cache destroy the framebuffer *now* rather than
    // holding it until renderer disposal (the caches' documented lazy
    // eviction, driven deliberately).
    const target = this.#target;
    if (target !== null) {
      target.dispose();
      const targets = live ? host.renderTargets() : null;
      if (targets !== null) {
        targets.acquire(target);
      }
    }
    this.#target = null;
    this.#pass = null;
    this.#ids.length = 0;
    this.#indexByMatrix.clear();
  }

  /** The compiled id program for this era, or `null` — the skinning latch. */
  #acquireProgram(gl: WebglContext, era: GeometryCache): IdPassProgram | null {
    if (this.#programEra !== era) {
      // A new era means the old handles died with the old context (§61):
      // drop, never delete, and let a driver that refused last era be asked
      // once more on the new one.
      this.#program = null;
      this.#programFailed = false;
      this.#programEra = era;
    }
    if (this.#program !== null) {
      return this.#program;
    }
    if (this.#programFailed) {
      return null;
    }
    try {
      this.#program = IdPassProgram.create(gl);
      return this.#program;
    } catch (error: unknown) {
      this.#programFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgl-picking-compile-failed",
          "§71: the picking id program failed to compile on this context; " +
            `picking passes are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * Draws one id pass. Starts from — and, in its `finally`, returns GL to —
   * the renderer's between-frames baseline (blend off, depth test on, writes
   * on, stencil off with all-bits masks), which is what keeps the next
   * frame's transcript byte-identical (the F13 envelope, for a pass that runs
   * *between* frames).
   */
  #drawPass(
    gl: WebglContext,
    geometries: GeometryCache,
    program: IdPassProgram,
    record: RenderTargetRecord,
    rect: PassRect,
    viewItems: readonly RenderItem[],
  ): void {
    // The local mirror of the three states this pass may move, all starting
    // at the baseline.
    let colorWrite = true;
    let depthTest = true;
    let depthWrite = true;
    let stencilOn = false;
    let stencilTouched = false;
    let appliedClip: RenderItemClip | null = null;

    try {
      gl.bindFramebuffer(GL.FRAMEBUFFER, record.framebuffer);
      gl.viewport(rect.x, rect.y, rect.width, rect.height);
      gl.scissor(rect.x, rect.y, rect.width, rect.height);
      // Clear to id 0 — "nothing" — plus the depth every view owes and, on a
      // stencil-carrying target, clean bit planes (§67's leak rule).
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      let mask = GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT;
      if (record.stencil) {
        mask |= GL.STENCIL_BUFFER_BIT;
      }
      gl.clear(mask);

      program.use();
      program.setViewProjection(passViewProjection);

      for (let index = 0; index < viewItems.length; index += 1) {
        const item = viewItems[index];
        if (
          item.kind === "particles" ||
          item.kind === "skinned-unlit" ||
          item.kind === "skinned-lit"
        ) {
          // Absence, stated in the module header: no bind-pose ids, no
          // emitter-quad ids. The bounds tier serves both.
          continue;
        }

        const clip = item.clip ?? null;
        const maskPass = clip !== null && clip.maskPass;

        // Every skip is resolved *before* the first state or uniform call —
        // the frame renderer's own discipline ("a skipped draw contributes
        // nothing at all"), which is also what keeps a skipped item from
        // moving the state mirror or uploading an id nothing draws.
        //
        // The §33 table join first — see `collectPickCandidates` for why the
        // world-matrix object is exact. A miss is reachable in exactly one
        // way: a geometry accessor with side effects grew the scene *during*
        // the list build, after the table walked it (the pinned
        // mid-frame-reentrancy family); the new node is skipped this pass
        // and picked next pass. A mask draw writes no id and needs no index.
        let tableIndex = 0;
        if (!maskPass) {
          const joined = this.#indexByMatrix.get(item.worldMatrix);
          if (joined === undefined) {
            continue;
          }
          tableIndex = joined;
        }
        const geometry = geometries.acquire(item.geometry);
        if (geometry === null) {
          // Nothing to draw, or GL refused — the frame skips it too (§61).
          continue;
        }

        // §67's stencil state, by record identity (R-23: every item under
        // one clip carries the identical pooled record, so this is one `!==`
        // per item). `record.stencil` is true whenever any clip exists — the
        // mask draws sort first, so the target decision above saw them.
        if (clip !== appliedClip) {
          if (clip === null) {
            gl.disable(GL.STENCIL_TEST);
            stencilOn = false;
          } else {
            if (!stencilOn) {
              gl.enable(GL.STENCIL_TEST);
              stencilOn = true;
            }
            const stencil = clip.stencil;
            gl.stencilFunc(
              STENCIL_FUNC[stencil.func],
              stencil.ref,
              stencil.readMask,
            );
            gl.stencilOp(
              STENCIL_OP[stencil.failOp],
              STENCIL_OP[stencil.depthFailOp],
              STENCIL_OP[stencil.passOp],
            );
            gl.stencilMask(stencil.writeMask);
            stencilTouched = true;
          }
          appliedClip = clip;
        }

        // What decides which surface is on top, mirrored from the frame: a
        // mask draw forces colour, depth write and depth test off (R-23's
        // rule); a content draw follows its material's §57 depth/colour
        // state, read defensively (`!== false`) for the structural-double
        // reason every item snapshot is.
        const material = item.material;
        const wantColor = maskPass ? false : material.colorWrite !== false;
        const wantDepthTest = maskPass ? false : material.depthTest !== false;
        const wantDepthWrite = maskPass ? false : material.depthWrite !== false;
        if (wantColor !== colorWrite) {
          gl.colorMask(wantColor, wantColor, wantColor, wantColor);
          colorWrite = wantColor;
        }
        if (wantDepthTest !== depthTest) {
          if (wantDepthTest) {
            gl.enable(GL.DEPTH_TEST);
          } else {
            gl.disable(GL.DEPTH_TEST);
          }
          depthTest = wantDepthTest;
        }
        if (wantDepthWrite !== depthWrite) {
          gl.depthMask(wantDepthWrite);
          depthWrite = wantDepthWrite;
        }

        if (!maskPass) {
          encodePickId(tableIndex, idScratch);
          program.setId(idScratch);
        }
        program.setModel(item.worldMatrix);
        gl.bindVertexArray(geometry.vertexArray);
        if (geometry.indexType === null) {
          gl.drawArrays(geometry.mode, 0, geometry.count);
        } else {
          gl.drawElements(geometry.mode, geometry.count, geometry.indexType, 0);
        }
      }
      gl.bindVertexArray(null);
    } finally {
      // Back to the baseline, issuing a call only for what moved.
      if (!colorWrite) {
        gl.colorMask(true, true, true, true);
      }
      if (!depthWrite) {
        gl.depthMask(true);
      }
      if (!depthTest) {
        gl.enable(GL.DEPTH_TEST);
      }
      if (stencilOn) {
        gl.disable(GL.STENCIL_TEST);
      }
      if (stencilTouched) {
        gl.stencilFunc(GL.ALWAYS, 0, STENCIL_ALL_BITS);
        gl.stencilOp(GL.KEEP, GL.KEEP, GL.KEEP);
        gl.stencilMask(STENCIL_ALL_BITS);
      }
      gl.bindFramebuffer(GL.FRAMEBUFFER, null);
    }
  }

  /**
   * The non-stalling read: one texel into a `PIXEL_PACK_BUFFER`, a fence,
   * a non-blocking poll, one copy back (RFC 0005 §4). Returns `false` —
   * fall back to the stalling read — where GL refuses the buffer or the
   * fence; throws `CONTEXT_LOST` where the wait itself fails or the context
   * goes down mid-poll.
   */
  async #readTexelFenced(
    gl: WebglContext,
    entry: FenceReadEntryPoints,
    pass: PassState,
    px: number,
    py: number,
    texel: Uint8Array,
  ): Promise<boolean> {
    const {
      readPixels,
      fenceSync,
      clientWaitSync,
      deleteSync,
      getBufferSubData,
    } = entry;
    const buffer = gl.createBuffer();
    if (buffer === null) {
      return false;
    }
    try {
      gl.bindFramebuffer(GL.FRAMEBUFFER, pass.record.framebuffer);
      try {
        gl.bindBuffer(PICKING_GL.PIXEL_PACK_BUFFER, buffer);
        gl.bufferData(
          PICKING_GL.PIXEL_PACK_BUFFER,
          texel,
          PICKING_GL.STREAM_READ,
        );
        // Destination 0: a byte offset into the bound pack buffer — the
        // non-stalling overload.
        readPixels.call(gl, px, py, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, 0);
      } finally {
        gl.bindBuffer(PICKING_GL.PIXEL_PACK_BUFFER, null);
        gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      }
      const sync = fenceSync.call(gl, PICKING_GL.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (sync === null) {
        return false;
      }
      try {
        // Flush with the first wait so the fence is reachable, then poll
        // plain — `timeout` stays 0 throughout, because a blocking client
        // wait would be the stall this path exists to avoid.
        let flags: number = PICKING_GL.SYNC_FLUSH_COMMANDS_BIT;
        for (;;) {
          const status = clientWaitSync.call(gl, sync, flags, 0);
          if (
            status === PICKING_GL.ALREADY_SIGNALED ||
            status === PICKING_GL.CONDITION_SATISFIED
          ) {
            break;
          }
          if (status === PICKING_GL.WAIT_FAILED) {
            throw new FourError(
              "CONTEXT_LOST",
              "§71: clientWaitSync reported WAIT_FAILED while polling the " +
                "id read-back — the context is most likely lost (§61).",
              { context: { status } },
            );
          }
          flags = 0;
          await nextPoll();
          if (this.#disposed) {
            throw new FourError(
              LIFECYCLE_ERROR_CODE,
              "§71: the picking service was disposed while a pick was in " +
                "flight (§83).",
              { context: { method: "pick", disposed: true } },
            );
          }
          if (this.#host.contextLost()) {
            throw new FourError(
              "CONTEXT_LOST",
              "§71: the context was lost while a pick was in flight — the " +
                "id buffer is gone (§61).",
              { context: { contextLost: true } },
            );
          }
        }
      } finally {
        deleteSync.call(gl, sync);
      }
      gl.bindBuffer(PICKING_GL.PIXEL_PACK_BUFFER, buffer);
      try {
        getBufferSubData.call(gl, PICKING_GL.PIXEL_PACK_BUFFER, 0, texel);
      } finally {
        gl.bindBuffer(PICKING_GL.PIXEL_PACK_BUFFER, null);
      }
      return true;
    } finally {
      gl.deleteBuffer(buffer);
    }
  }
}

/**
 * Opts this process's `WebglRenderer`s into §71's `"gpu"` picking tier
 * (RFC 0005).
 *
 * ```ts
 * import { registerPickingPipeline } from "@four/render-webgl";
 * registerPickingPipeline();           // once, at application setup
 * const picking = renderer.createPickingService();
 * ```
 *
 * Calling it is what links this module — the id program, its GLSL, the
 * service, and the fence read-back — into the bundle; a build that never
 * calls it carries none of it (grep-proven in the packet's A/B). The id
 * program still compiles **lazily, on each service's first pass**, never here
 * and never at `createPickingService()`, so registration and creation alone
 * change no GL transcript. Idempotent; calling it twice re-installs the same
 * factory.
 */
export function registerPickingPipeline(): void {
  setPickingServiceFactory({
    create(host: PickingRendererHost): PickingService {
      return new WebglPickingService(host);
    },
  });
}
