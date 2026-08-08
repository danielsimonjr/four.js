/**
 * Per-frame render counters (§84's `drawCalls`/`triangles`/`instances`) — the
 * backend-independent half of the statistics surface (A-1, 2026-08-07).
 *
 * §84 asks an application for `app.stats.drawCalls`, `app.stats.triangles`, and
 * `app.stats.instances`. Only the backend knows those numbers: the render list
 * says what *should* be drawn, and the backend decides what it actually
 * submits — a geometry it could not allocate, a texture the application
 * disposed, a material sampling the target being drawn into, and a
 * zero-particle system are all skipped without a draw. Counting the render list
 * instead would produce a number that is confidently wrong exactly when the
 * frame is interesting.
 *
 * So the counters live on the {@link @four/render!Renderer | Renderer}, as an
 * **optional, opt-in** member:
 *
 * ```ts
 * const stats = createRenderStatistics();
 * renderer.statistics = stats;        // opt in
 * renderer.render(scene, views);
 * stats.drawCalls;                    // what the backend really submitted
 * renderer.statistics = null;         // opt out; back to zero cost
 * ```
 *
 * ## Three properties this shape is chosen for
 *
 * 1. **`@four/render` stays backend-free.** The record is a plain object of
 *    three numbers; nothing here knows what a draw call is made of. The WebGL 2
 *    backend counts real `drawArrays`/`drawElements`/`drawArraysInstanced`
 *    calls, a future WebGPU backend counts its own, and a backend that counts
 *    nothing simply never writes.
 * 2. **The no-statistics path costs one comparison per draw and allocates
 *    nothing.** `statistics` is `null` by default; a backend reads it once per
 *    frame and skips its counting entirely. No object is allocated per frame,
 *    per view, or per draw — the application owns one record for its lifetime —
 *    and **no GL call is added, removed, or reordered by switching it on**,
 *    which is what lets the pixel goldens and the recorded-GL-sequence tests
 *    keep passing byte for byte either way (`@four/render-webgl`'s tests assert
 *    exactly that).
 * 3. **Presence is the capability.** A backend that reports statistics declares
 *    the member; one that does not, does not, and
 *    {@link supportsRenderStatistics} tells them apart at runtime. An
 *    application then reports `NaN` — "not measured" — rather than `0`, which
 *    is the same stance {@link @four/render!RendererCapabilities |
 *    RendererCapabilities} takes on limits a backend has not queried.
 *
 * ## Accumulate, never clear
 *
 * A backend **adds** to the record and never resets it, because a frame may be
 * several `render` calls — an off-screen pass into a target, then the on-screen
 * pass — and §84's counters are the frame's totals. Whoever owns the record
 * clears it once per frame with {@link resetRenderStatistics}; `Application`
 * does that at the top of each `step`. A caller that assigns a record and never
 * clears it gets a session total, which is a legitimate use and the documented
 * consequence rather than a bug.
 */

/**
 * What a backend submitted, accumulated since the last
 * {@link resetRenderStatistics}.
 *
 * Mutable and written in place; a backend never allocates one. The three fields
 * are §84's, with §84's meanings — see {@link @four/diagnostics!FrameStats |
 * FrameStats}, which is where they surface as `app.stats`.
 */
export interface RenderStatistics {
  /** Draw calls submitted. One per `drawArrays`-family call. */
  drawCalls: number;

  /**
   * Triangles submitted — per-instance triangle count times instance count, so
   * an instanced draw contributes all of its triangles. A `"lines"` geometry
   * contributes none.
   */
  triangles: number;

  /**
   * Primitive-set instances submitted. A non-instanced draw contributes `1`
   * (GL's own model: `drawArrays` is `drawArraysInstanced` with one instance),
   * an instanced draw contributes its instance count.
   */
  instances: number;
}

/** A zeroed record. The only allocation in this module. */
export function createRenderStatistics(): RenderStatistics {
  return { drawCalls: 0, triangles: 0, instances: 0 };
}

/**
 * Zeroes the record in place — the frame boundary. Zero rather than `NaN`
 * because a record that exists *is* being counted; "not measured" is the
 * absence of a record, not a value inside one.
 */
export function resetRenderStatistics(statistics: RenderStatistics): void {
  statistics.drawCalls = 0;
  statistics.triangles = 0;
  statistics.instances = 0;
}

/**
 * A renderer that reports §84 render counters — the structural capability.
 *
 * Written as its own interface rather than as a required member of
 * {@link @four/render!Renderer | Renderer} because adding a required member to
 * a published interface breaks every implementor, and because a backend with
 * nothing to count (a null renderer that draws nothing, an SVG backend whose
 * "draws" are DOM nodes) should be able to say so by omission.
 */
export interface RenderStatisticsReporter {
  /**
   * Where to accumulate this renderer's per-frame counters, or `null` (the
   * default) to count nothing.
   *
   * Assigned by whoever owns the record — normally `Application`, which assigns
   * it when the application is constructed with statistics on and clears it
   * again on `dispose`. Reassigning it mid-frame is undefined; assign it
   * between frames.
   */
  statistics: RenderStatistics | null;
}

/**
 * Whether `renderer` reports §84 render counters, narrowing it so the record
 * can be assigned.
 *
 * A property test rather than an `instanceof`: backends are separate packages,
 * and `@four/render` must not name any of them (§61). The same duck-typed
 * discipline `isDirectionalLightSource` and `isParticleDrawable` use.
 */
export function supportsRenderStatistics<TRenderer extends object>(
  renderer: TRenderer,
): renderer is TRenderer & RenderStatisticsReporter {
  return "statistics" in renderer;
}
