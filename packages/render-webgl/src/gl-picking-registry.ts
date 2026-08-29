/**
 * The picking pipeline's registration slot (§71, §62; RFC 0005, 2026-08-28) —
 * the lazily-filled module `let` that keeps the id program, the picking
 * service, and its read-back machinery out of every bundle that never picks
 * by pixel.
 *
 * The fifth application of the seam `gl-skinning-registry.ts` states in full
 * (pipeline-cost law, R-6): `WebglRenderer` imports **this** module — one
 * `let` and three functions — and never `gl-picking.ts`; an application opts
 * in with
 *
 * ```ts
 * import { registerPickingPipeline } from "@four/render-webgl";
 * registerPickingPipeline();
 * ```
 *
 * which is what links the heavy module. `WebglRenderer.createPickingService()`
 * resolves this slot; a `null` answer is a §85 refusal naming the fix —
 * unlike a skinned *draw*, which skips inside a frame where §61 forbids
 * throwing, service creation is an explicit call that can see the mistake.
 */

import type { PickingService } from "@four/render";

import type { GeometryCache } from "./gl-geometry.js";
import type { WebglContext } from "./gl-program.js";
import type { RenderTargetCache } from "./gl-render-target.js";

/**
 * The live window a `WebglRenderer` opens for its picking services — the
 * narrow slice of renderer state an id pass genuinely needs, and nothing
 * else.
 *
 * Every member is a **live accessor** (a method, so the renderer implements
 * the whole window as seven `this`-capturing arrows), not a snapshot, because three of them
 * change identity under the renderer's feet: a §61 context restore builds
 * *new* caches (the old handles died with the context), so a service that
 * captured `geometries` once would draw with a cache the renderer has already
 * abandoned. A service re-reads all of them per pass, and detects a
 * lost-and-restored context by cache identity (`gl-picking.ts`).
 *
 * Sharing the renderer's caches — rather than the service owning twins — is
 * deliberate: the id pass draws the same geometries the frame drew, so a
 * second `GeometryCache` would hold a second VAO and a second set of buffers
 * per geometry, doubling GPU memory to draw the same bytes.
 */
export interface PickingRendererHost {
  /** The renderer's context, or `null` before `initialize` / after `dispose`. */
  context(): WebglContext | null;
  /** The renderer's geometry cache, or `null` when the context is down. */
  geometries(): GeometryCache | null;
  /** The renderer's render-target cache, or `null` when the context is down. */
  renderTargets(): RenderTargetCache | null;
  /** Drawing-buffer width in device pixels — what §48 rectangles resolve against. */
  surfaceWidth(): number;
  /** Drawing-buffer height in device pixels. */
  surfaceHeight(): number;
  /** Whether the context is currently lost (§61). */
  contextLost(): boolean;
  /** Whether the renderer has been disposed (§83). */
  disposed(): boolean;
}

/**
 * What `registerPickingPipeline()` installs: a factory
 * `WebglRenderer.createPickingService()` calls once per service. Creation
 * compiles nothing — the id program compiles lazily, on the service's first
 * pass, so registration and creation alone change no GL transcript (the
 * skinning factory's contract).
 */
export interface PickingServiceFactory {
  /** Builds one service over `host`. */
  create(host: PickingRendererHost): PickingService;
}

/** The slot. `null` until `registerPickingPipeline()` fills it. */
let pickingFactory: PickingServiceFactory | null = null;

/**
 * Installs `factory` as the process's picking pipeline. Called by
 * `registerPickingPipeline()` (`gl-picking.ts`); replaces any previous
 * factory — services already created keep their own state, so replacing
 * mid-run affects only services not yet created.
 */
export function setPickingServiceFactory(factory: PickingServiceFactory): void {
  pickingFactory = factory;
}

/**
 * The registered factory, or `null` — read by
 * `WebglRenderer.createPickingService()`. One function call; no allocation.
 */
export function resolvePickingServiceFactory(): PickingServiceFactory | null {
  return pickingFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered (the `clearRegisteredSkinningPipeline` precedent).
 * Not an application API: an application that wants pixel picking off simply
 * never registers.
 */
export function clearRegisteredPickingPipeline(): void {
  pickingFactory = null;
}
