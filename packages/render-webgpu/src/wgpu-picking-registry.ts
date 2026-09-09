/**
 * The picking pipeline's registration slot (§71, §62; RFC 0005) — the
 * lazily-filled module `let` that keeps the id pipeline, the picking
 * service, and its `mapAsync` read-back out of every bundle that never
 * picks by pixel.
 *
 * The pipeline-cost law (R-6), restated for this backend: `WebgpuRenderer`
 * imports **this** module — one `let` and three functions — and never
 * `wgpu-picking.ts`; an application opts in with
 *
 * ```ts
 * import { registerPickingPipeline } from "@fourjs/render-webgpu";
 * registerPickingPipeline();
 * ```
 *
 * which is what links the heavy module. `WebgpuRenderer.createPickingService()`
 * resolves this slot; a `null` answer is a §85 refusal naming the fix —
 * service creation is an explicit call that can see the mistake.
 */

import type { PickingService } from "@fourjs/render";

import type { GpuDevice } from "./webgpu-device.js";
import type { WgpuGeometryCache } from "./wgpu-geometry.js";
import type { WgpuRenderTargetCache } from "./wgpu-render-target.js";

/**
 * The live window a `WebgpuRenderer` opens for its picking services — the
 * narrow slice of renderer state an id pass genuinely needs, and nothing
 * else.
 *
 * Every member is a **live accessor** (a method), not a snapshot, because
 * the caches change identity under the renderer's feet: a §61 device loss
 * drops them (the allocations belong to a device that no longer exists), so
 * a service that captured `geometries` once would draw with a cache the
 * renderer has already abandoned. A service re-reads all of them per pass,
 * and detects a lost device by the flag plus cache identity (`wgpu-picking.ts`).
 *
 * Sharing the renderer's caches — rather than the service owning twins — is
 * deliberate: the id pass draws the same geometries the frame drew.
 */
export interface PickingRendererHost {
  /** The renderer's device, or `null` before `initialize` / after `dispose`. */
  device(): GpuDevice | null;
  /** The renderer's geometry cache, or `null` when the device is down. */
  geometries(): WgpuGeometryCache | null;
  /** The renderer's render-target cache, or `null` when the device is down. */
  renderTargets(): WgpuRenderTargetCache | null;
  /** Drawing-buffer width in device pixels — what §48 rectangles resolve against. */
  surfaceWidth(): number;
  /** Drawing-buffer height in device pixels. */
  surfaceHeight(): number;
  /** Whether the device is currently lost (§61). */
  deviceLost(): boolean;
  /** Whether the renderer has been disposed (§83). */
  disposed(): boolean;
}

/**
 * What `registerPickingPipeline()` installs: a factory
 * `WebgpuRenderer.createPickingService()` calls once per service. Creation
 * compiles nothing — the id pipeline compiles lazily, on the service's first
 * pass, so registration and creation alone change no device transcript.
 */
export interface PickingServiceFactory {
  /** Builds one service over `host`. */
  create(host: PickingRendererHost): PickingService;
}

/** The slot. `null` until `registerPickingPipeline()` fills it. */
let pickingFactory: PickingServiceFactory | null = null;

/**
 * Installs `factory` as the process's picking pipeline. Called by
 * `registerPickingPipeline()` (`wgpu-picking.ts`); replaces any previous
 * factory — services already created keep their own state, so replacing
 * mid-run affects only services not yet created.
 */
export function setPickingServiceFactory(factory: PickingServiceFactory): void {
  pickingFactory = factory;
}

/**
 * The registered factory, or `null` — read by
 * `WebgpuRenderer.createPickingService()`. One function call; no allocation.
 */
export function resolvePickingServiceFactory(): PickingServiceFactory | null {
  return pickingFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered. Not an application API: an application that wants
 * pixel picking off simply never registers.
 */
export function clearRegisteredPickingPipeline(): void {
  pickingFactory = null;
}
