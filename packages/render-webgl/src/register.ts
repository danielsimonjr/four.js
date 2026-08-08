/**
 * This backend's opt-in to §62's renderer registry (R-2, A-8).
 *
 * `@four/render` holds the registry and knows no backend; this module is the
 * one place that names both, and it lives here — below the interface, above
 * nothing — because that is the only direction the frozen §3.1 matrix allows
 * (`render-webgl` already depends on `render`; no edge is added).
 *
 * ```ts
 * import { registerWebglRenderer } from "@four/render-webgl";
 *
 * registerWebglRenderer();
 * const app = new Application({ renderer: "auto", canvas });
 * ```
 *
 * ## Why this is a function call and not an import side effect
 *
 * `@four/render-webgl` declares `"sideEffects": false`, so a bundler is
 * entitled to delete an import whose bindings are unused — which is exactly
 * what `import "@four/render-webgl/register"` would be. The registration would
 * vanish and `renderer: "auto"` would fail at runtime with "nothing is
 * registered", on the bundler's schedule rather than the author's. A call
 * expression is a use the bundler can see, so it survives precisely when it is
 * wanted (see `renderer-registry.ts` for the full argument).
 *
 * This module is separate from `webgl-renderer.ts` for the mirror-image
 * reason: a program that constructs `new WebglRenderer()` itself must not pay
 * for the registry, and a module it never imports costs it nothing.
 */

import {
  registerRenderer,
  type RendererOptions,
  type RendererRegistry,
} from "@four/render";

import { WebglRenderer } from "./webgl-renderer.js";

/**
 * Whether this environment could run WebGL 2 at all (§62) — the cheap
 * pre-filter `"auto"` uses before it builds anything.
 *
 * The check is the presence of the `WebGL2RenderingContext` global, read off
 * `globalThis` because this package compiles without `lib.dom` (the canvas is
 * described structurally by `WebglCanvas`, and so is this). Node, a worker
 * without OffscreenCanvas, and a browser too old for WebGL 2 all answer
 * `false`; every browser that can draw answers `true`.
 *
 * **It deliberately does not touch the canvas.** A canvas hands out one
 * context per type, and a probe calling `getContext("webgl2")` with its own
 * attributes would fix the attributes of the context
 * {@link WebglRenderer.initialize} later acquires — silently turning
 * `antialias: true` off. The real gate is that `initialize`, which already
 * fails with `RENDERER_INITIALIZATION_FAILED` (§89) for a blocked GPU or a
 * canvas that already holds another context, and whose failure `"auto"`
 * recovers from by moving to §62's next backend. This probe only has to be
 * right about "there is no point trying".
 */
export function isWebgl2Supported(options?: RendererOptions): boolean {
  // `options` is accepted to satisfy `RendererRegistration.isSupported` and is
  // deliberately unread — see above: the canvas must not be touched, and
  // nothing else in a `RendererOptions` can make WebGL 2 exist or not.
  void options;
  return (
    typeof (globalThis as Record<string, unknown>)["WebGL2RenderingContext"] ===
    "function"
  );
}

/**
 * Registers the WebGL 2 backend so `renderer: "auto"` and `renderer: "webgl2"`
 * can find it (§62), and returns the registry it went into.
 *
 * Call it once, before the selection. Pass a `registry` to keep the
 * registration out of the shared one — the discipline the integration tests
 * use so that one test's backends are invisible to the next.
 *
 * @throws FourError `RENDERER_INITIALIZATION_FAILED` if a `"webgl2"` renderer
 * is already registered in that registry (§62: selection must not depend on
 * import order).
 */
export function registerWebglRenderer(
  registry?: RendererRegistry,
): RendererRegistry {
  return registerRenderer(
    {
      backend: "webgl2",
      isSupported: isWebgl2Supported,
      // Constructed, never initialized: §62's fallback is defined in terms of
      // initialization failing, so the registry owns that call.
      create: () => new WebglRenderer(),
    },
    registry,
  );
}
