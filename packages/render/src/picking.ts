/**
 * Pixel/GPU-id picking — the backend-neutral half (§71; RFC 0005, accepted
 * 2026-08-21).
 *
 * §71 lists seven picking strategies. The bounds tier lives in `@four/input`
 * (`pick.ts` there says why the candidates are structural), and this module is
 * the seam for the two strategies that cannot live there because they need a
 * renderer: `"pixel"` and `"gpu"`. The design is RFC 0005's, split exactly as
 * the render graph is — the **interface** here, backend-neutral, and the
 * **execution** in a backend (`@four/render-webgl`'s `gl-picking.ts`, behind
 * its `registerPickingPipeline()` seam).
 *
 * ## How the id pass works
 *
 * A {@link PickingService} owns an offscreen id buffer. {@link
 * PickingService.update} draws the scene's render list into it with every
 * material replaced by a flat id shader; {@link PickingService.pick} reads one
 * texel back — asynchronously, on every backend, forever (RFC 0005 §4) — and
 * resolves it to a `Node.id`.
 *
 * **A node's id is a string** (`node-<n>`, §6/§33), and an RGBA8 texel holds
 * 32 bits, so the pass can never encode `node.id` itself. It encodes a dense
 * integer index into a per-pass table, and everything about that table is a
 * §33 obligation rather than an implementation detail:
 *
 * - the table is built in **scene traversal order** — the same depth-first,
 *   insertion-ordered walk `resolveWorldTransforms` and the render list use —
 *   never in `Set`/`Map` iteration order ({@link collectPickCandidates});
 * - it is **rebuilt per pass** and never carried across frames, so a node
 *   added mid-frame cannot shift another node's index retroactively;
 * - a **pick result never enters a §33 checksum**. A pick is a §34 *input*; a
 *   GPU read-back is not reproducible across drivers. An application driving
 *   simulation from a pick records the resulting action, not the pick.
 *
 * The value written is the candidate's table index **+ 1**, so `0` is
 * unambiguously "nothing" (the target clears to zero) —
 * {@link encodePickId}/{@link decodePickId}. A pass with more candidates than
 * the encoding can express **refuses** (§85), never wraps —
 * {@link assertEncodableCandidateCount}.
 *
 * ## Where the service comes from
 *
 * {@link Renderer.createPickingService} — optional, and **its presence is the
 * capability** (the `statistics`/`renderEffect` stance): WebGL 2 declares it
 * (behind its registration seam), the future WebGPU backend will, and Canvas
 * 2D / SVG declare the tier **absent** by omission rather than emulating it
 * (owner decision on RFC 0005 Q6 — emulation would make §71's result quality
 * vary by backend). {@link supportsPicking} is the runtime test. `@four/four`'s
 * `Application` never references any of this statically: an application that
 * never picks by pixel carries 0 B of it (the A-8 discipline).
 *
 * ## What `@four/input` sees
 *
 * Nothing from this module. Its whole seam is `PickProvider` — two numbers in,
 * a node id out, asynchronously — and the adapter that closes over a
 * {@link PickingService} and a `Viewport` is `@four/four`'s
 * `createPickProvider` (four lines; RFC 0005 §2). That is what keeps the
 * frozen `input → core, math, scene` row true while §72's event propagation
 * can still dispatch on a pixel-picked target.
 */

import { FourError } from "@four/core";
import type { Matrix4 } from "@four/math";
import type { Node, Viewport } from "@four/scene";

import { Renderable } from "./renderable.js";
import type { Renderer } from "./renderer.js";

/**
 * One pick query against a {@link PickingService} (§71; RFC 0005).
 *
 * `ndcX`/`ndcY` are the same normalized device coordinate `@four/input`'s ray
 * pick takes: `[-1, 1]` on both axes, **+Y up** (§7a), so `(-1, -1)` is the
 * bottom-left of the viewport. Converting a pointer position in CSS pixels
 * into NDC is the pointer source's job (§72), not this API's.
 */
export interface PickRequest {
  /**
   * The view the pick is against (§48) — **the same `Viewport` object the last
   * {@link PickingService.update} drew**. The id buffer holds exactly one
   * view's pass, so a request naming any other viewport is refused (§85)
   * rather than answered from the wrong picture.
   */
  readonly viewport: Viewport;
  /** Normalized device X, in `[-1, 1]`. */
  readonly ndcX: number;
  /** Normalized device Y, in `[-1, 1]`, +Y up (§7a). */
  readonly ndcY: number;
}

/** What a resolved pick reports (§71; RFC 0005). */
export interface PickResult {
  /**
   * `Node.id` of the front-most candidate under the point, or `undefined` for
   * "nothing there". A **string** — the service owns the index↔id table and
   * never leaks the integer it wrote into the texel, so the encoding can
   * change (RGBA8 → `r32uint` on WebGPU) without a public break.
   *
   * §96: this is an internal identifier (`node-<n>`, deliberately not
   * user-controlled); an application echoing it into a DOM string is doing
   * that on its own head.
   */
  readonly nodeId: string | undefined;
  /**
   * Which {@link PickingService.update} produced the id buffer this pick read
   * — the service's own update ordinal, starting at 1. A pick resolved a
   * frame late is *correct* for the picture the user actually clicked on and
   * *stale* for the picture now on screen; which of those an application
   * wants is an application decision, and this field is what lets it tell
   * (RFC 0005 §4).
   */
  readonly frame: number;
}

/**
 * §71's `"gpu"`/`"pixel"` tier: an offscreen id pass plus an asynchronous
 * single-texel read-back (RFC 0005).
 *
 * ```ts
 * import { registerPickingPipeline } from "@four/render-webgl";
 *
 * registerPickingPipeline();                       // once, at setup
 * const picking = renderer.createPickingService!();
 * // per frame that wants pixel picking (opt-in — the pass costs a frame):
 * picking.update(scene, view);
 * // in a pointer handler:
 * const { nodeId } = await picking.pick({ viewport: view, ndcX, ndcY });
 * ```
 *
 * ## The contract is asynchronous on every backend, forever
 *
 * WebGL 2's plain `readPixels` is a synchronous stall; the non-stalling paths
 * (`PIXEL_PACK_BUFFER` + fence on WebGL 2, `mapAsync` on WebGPU) are both
 * asynchronous. A capability tier may change quality or availability; it must
 * never change an API's **shape** (§62) — so `pick` returns a `Promise` even
 * on a backend that could answer synchronously, and the result carries the
 * {@link PickResult.frame} it came from.
 *
 * ## Cost, and why the pass is opt-in per frame
 *
 * `update` is a second render pass proportional to the render list (§86 gains
 * a row). Nothing runs it for you: an application calls it only on frames it
 * intends to pick against — typically the frame under the pointer event —
 * and a scene that never picks never pays.
 *
 * ## §96
 *
 * An id pass is a *read-back of rendered content* — the classic cross-origin
 * texture hazard. This engine's `TextureSource` carries raw texels (no
 * origin-tainted handles), so the browser's own canvas-tainting rules are the
 * enforcement tier here: a backend surface that could ever hold tainted
 * content will throw on read-back, and the service reports that failure
 * rather than masking it.
 */
export interface PickingService {
  /**
   * Renders the id pass for `root`/`view` into the service's own target.
   *
   * Draws the resolved world transforms (§7) — the caller must have run
   * `resolveWorldTransforms` for the frame, exactly as `Renderer.render`'s
   * non-interpolated path requires. Deliberately **never** the §43
   * interpolated pose: a picking pass wants exactly the simulation state
   * (`renderer.ts` records this as the interpolation contract's own example).
   *
   * §85 refusals (thrown from here, the call that can see the mistake): a
   * disposed service, a view whose resolved rectangle has zero area, a
   * candidate count the encoding cannot express. §61 skips (never thrown): a
   * lost context, a target or program the driver refused — the pass is
   * skipped, and the next {@link PickingService.pick} reports that there is
   * no id buffer to read.
   */
  update(root: Node, view: Viewport): void;

  /**
   * Reads back one texel of the last {@link PickingService.update}'s id
   * buffer and resolves it to a node id. Asynchronous, always — see the
   * interface documentation.
   *
   * Refused (§85/§89, as a rejection carrying a `FourError`): a disposed
   * service, a pick before any successful `update`, `ndcX`/`ndcY` outside
   * `[-1, 1]` or non-finite, a `viewport` other than the one the last update
   * drew, and — `CONTEXT_LOST` — a context lost (or lost-and-restored) since
   * the id buffer was drawn, because a stale `undefined` would be
   * indistinguishable from "nothing there".
   */
  pick(request: PickRequest): Promise<PickResult>;

  /** Whether {@link PickingService.dispose} has run. */
  readonly disposed: boolean;

  /**
   * Releases the service's GPU resources — its render target and id program
   * (§83). Idempotent and terminal: `update` and `pick` refuse afterwards.
   */
  dispose(): void;
}

/**
 * Whether `renderer` can build a {@link PickingService} (§62, §71).
 *
 * The optional-member test, same shape as `supportsRenderStatistics` and
 * `supportsScreenEffects`: presence is the capability. `false` for
 * `NullRenderer` (no pixels at all) and for the Canvas 2D / SVG tiers, which
 * declare the id-buffer strategy absent rather than emulating it (RFC 0005
 * Q6's adopted disposition).
 *
 * A `true` answer says the backend *can*; the WebGL 2 backend additionally
 * requires its `registerPickingPipeline()` — the capability says what is
 * possible, registration is the application opting in to paying for it (the
 * skinning precedent).
 */
export function supportsPicking(
  renderer: Renderer,
): renderer is Renderer & { createPickingService(): PickingService } {
  return typeof renderer.createPickingService === "function";
}

/**
 * The most candidates one id pass can express: an RGBA8 texel holds 32 bits,
 * `0` is reserved for "nothing", so indices `1 … 2³²−1` remain (§85; RFC 0005
 * §3).
 */
export const MAX_PICK_CANDIDATES = 0xffffffff;

/**
 * Refuses a candidate table the id encoding cannot express (§85; RFC 0005
 * §3): a pass over it must fail loudly, never wrap an index back to a wrong
 * node.
 *
 * A separate, pure function rather than an inline comparison in the backend so
 * the refusal is testable without constructing 2³² nodes — the backend calls
 * it with the table it just built; a test calls it with a number.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` when `count` exceeds
 * {@link MAX_PICK_CANDIDATES}.
 */
export function assertEncodableCandidateCount(count: number): void {
  if (count > MAX_PICK_CANDIDATES) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      "§71: this scene has more pickable candidates than a 32-bit id buffer " +
        "can express; the id pass refuses rather than wrapping indices " +
        "(RFC 0005, §85).",
      { context: { count, maximum: MAX_PICK_CANDIDATES } },
    );
  }
}

/**
 * Builds one pass's candidate table for `root`'s subtree: `ids[i]` is the
 * `Node.id` the texel value `i + 1` resolves to, and `indexByMatrix` maps a
 * drawable node's own `transform.worldMatrix` **object** back to `i` (§33;
 * RFC 0005 §3).
 *
 * ## Traversal order is the contract
 *
 * The walk is the render list's exactly: depth-first in insertion order (§6),
 * pruning `visible === false` / `enabled === false` subtrees. Every
 * `Renderable` met is a candidate — §46 layer masks and §87 culling do *not*
 * filter the table, because they filter per view while the table is per pass;
 * a filtered node simply has no draw referencing its index, which costs
 * nothing and keeps the table a function of the scene alone (§33).
 *
 * ## Why the correlation key is the world-matrix object
 *
 * A render item deliberately carries **no node reference** (§64's compact-item
 * rule), but `buildRenderList` documents that a non-interpolated item's
 * `worldMatrix` *is* the node's own `transform.worldMatrix` — one object per
 * node, by construction. The id pass builds the plain (never interpolated)
 * list, so the matrix object is an exact, allocation-free join key between a
 * sorted item and the traversal-ordered table. A clip node's mask draw and
 * its content draw share the matrix and therefore the index, which is
 * correct: they are one candidate.
 *
 * Particle systems are **not** collected: §36's batched item has no
 * per-particle node and its id draw is the staged half of RFC 0005's tier
 * (see `@four/render-webgl`'s `gl-picking.ts`); a table entry nothing can
 * draw would only suggest otherwise.
 *
 * Both containers are cleared first, so a caller can reuse them per pass —
 * which is also what "rebuilt per pass" means: no index survives into the
 * next table.
 */
export function collectPickCandidates(
  root: Node,
  ids: string[],
  indexByMatrix: Map<Matrix4, number>,
): void {
  ids.length = 0;
  indexByMatrix.clear();
  collectInto(root, ids, indexByMatrix);
}

/** {@link collectPickCandidates}'s walk, without the per-pass reset. */
function collectInto(
  node: Node,
  ids: string[],
  indexByMatrix: Map<Matrix4, number>,
): void {
  if (!node.visible || !node.enabled) {
    return;
  }
  if (node instanceof Renderable) {
    indexByMatrix.set(node.transform.worldMatrix, ids.length);
    ids.push(node.id);
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    collectInto(children[i], ids, indexByMatrix);
  }
}

/**
 * Encodes table index `index` as the RGBA colour its id draw writes: the
 * value `index + 1` split into four bytes, little-endian, each scaled to
 * `[0, 1]` (RFC 0005 §3).
 *
 * Byte `k` of the value goes to component `k`, so {@link decodePickId} over
 * the read-back bytes is exact: an 8-bit UNORM attachment stores `b / 255`
 * as precisely `b`.
 *
 * Writes into `out` (4 floats) rather than allocating — the backend uploads
 * from one scratch per pass.
 */
export function encodePickId(index: number, out: Float32Array): void {
  const value = index + 1;
  out[0] = (value & 0xff) / 255;
  out[1] = ((value >>> 8) & 0xff) / 255;
  out[2] = ((value >>> 16) & 0xff) / 255;
  out[3] = (value >>> 24) / 255;
}

/**
 * Decodes one read-back RGBA8 texel into the id value the pass wrote: `0` for
 * "nothing" (the clear), otherwise the candidate's table index **+ 1** —
 * {@link encodePickId}'s inverse. Exact for every id up to
 * {@link MAX_PICK_CANDIDATES} (the sum stays far below 2⁵³).
 */
export function decodePickId(texel: Uint8Array): number {
  return (
    texel[0] + texel[1] * 0x100 + texel[2] * 0x10000 + texel[3] * 0x1000000
  );
}
