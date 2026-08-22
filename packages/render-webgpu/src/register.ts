/**
 * This backend's opt-in to §62's renderer registry (R-2, A-8, WP-R1.1).
 *
 * ```ts
 * import { registerWebgpuRenderer } from "@four/render-webgpu";
 *
 * registerWebgpuRenderer();
 * const app = new Application({ renderer: "auto", canvas });
 * ```
 *
 * A verbatim structural copy of `@four/render-webgl`'s `register.ts`, including
 * the reason it is a **function call and never an import side effect**: this
 * package declares `"sideEffects": false`, so a bundler is entitled to delete an
 * import whose bindings are unused, and `import "@four/render-webgpu/register"`
 * is exactly that. A call expression is a use the bundler can see.
 *
 * ## Calling this changes which backend an application uses
 *
 * `AUTO_RENDERER_ORDER` is `["webgpu", "webgl2", "canvas2d", "svg"]`, so the
 * moment a `"webgpu"` backend is registered, `renderer: "auto"` selects it
 * ahead of WebGL 2 wherever an adapter can be had. That is §62's mandated
 * order and it is not a surprise this module may paper over — a different
 * rasteriser is different pixels — so the registration stays an **explicit,
 * per-application opt-in**, and this monorepo deliberately ships no
 * "register everything" convenience that would make the switch happen by
 * accident (owner question Q1 of the R-1 plan, adopted).
 *
 * ## The probe is genuinely harder here than it is for WebGL 2
 *
 * `RendererRegistration.isSupported` is **synchronous**, and the only reliable
 * WebGPU support test — `requestAdapter()` — is **asynchronous**. Worse, the
 * two answers differ in practice rather than in theory: a headless Chromium
 * without `--enable-unsafe-webgpu` has a perfectly good `navigator.gpu` whose
 * `requestAdapter()` resolves `null` (measured; see the R-1 plan §2.2).
 *
 * Three options were considered and one is implemented:
 *
 * - **(a) An optimistic synchronous probe**, letting `initialize()` be the real
 *   gate. Costs one wasted `create()` plus a rejected `initialize()` on such a
 *   browser before `"auto"` moves to WebGL 2 — which is precisely what the
 *   registry documents the real gate to be (*"answering `true` optimistically
 *   is safe (initialization decides)"*). **Implemented.**
 * - (b) Widening `isSupported` to `boolean | Promise<boolean>` — a breaking
 *   change to a published interface, for a case (a) already handles. Rejected.
 * - (c) Caching an adapter probe at module load — a side effect at import in a
 *   `"sideEffects": false` package. Rejected.
 *
 * This module is separate from `webgpu-renderer.ts` for the mirror-image
 * reason the WebGL backend separates its own: a program that constructs
 * `new WebgpuRenderer()` itself must not pay for the registry.
 */

import {
  registerRenderer,
  type RendererOptions,
  type RendererRegistry,
} from "@four/render";

import { hostGpu } from "./webgpu-renderer.js";
import { WebgpuRenderer } from "./webgpu-renderer.js";

/**
 * Whether this environment could run WebGPU at all (§62) — the cheap
 * pre-filter `"auto"` uses before it builds anything.
 *
 * The check is the presence of a `navigator.gpu` exposing `requestAdapter`,
 * read off `globalThis` because this package compiles without `lib.dom`. Node
 * answers `false` (it has no `navigator.gpu` at all); a browser with WebGPU
 * disabled answers **`true`**, and that over-answer is deliberate — see the
 * module header. `initialize()` is the real gate and fails with
 * `RENDERER_INITIALIZATION_FAILED`, which is exactly the failure §62's
 * `"auto"` fallback is defined in terms of.
 *
 * It deliberately does not touch the canvas, for the reason
 * `isWebgl2Supported` gives at length: a probe that acquired a context would
 * fix the configuration the renderer later wants.
 */
export function isWebgpuSupported(options?: RendererOptions): boolean {
  // Accepted to satisfy `RendererRegistration.isSupported` and deliberately
  // unread: nothing in a `RendererOptions` can make WebGPU exist or not.
  void options;
  return hostGpu() !== undefined;
}

/**
 * Registers the WebGPU backend so `renderer: "auto"` and `renderer: "webgpu"`
 * can find it (§62), and returns the registry it went into.
 *
 * Call it once, before the selection. Pass a `registry` to keep the
 * registration out of the shared one — the discipline the integration tests
 * use so that one test's backends are invisible to the next.
 *
 * @throws FourError `RENDERER_INITIALIZATION_FAILED` if a `"webgpu"` renderer
 * is already registered in that registry (§62: selection must not depend on
 * import order).
 */
export function registerWebgpuRenderer(
  registry?: RendererRegistry,
): RendererRegistry {
  return registerRenderer(
    {
      backend: "webgpu",
      isSupported: isWebgpuSupported,
      // Constructed, never initialized: §62's fallback is defined in terms of
      // initialization failing, so the registry owns that call.
      create: () => new WebgpuRenderer(),
    },
    registry,
  );
}
