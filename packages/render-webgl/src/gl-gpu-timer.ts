/**
 * WebGL 2 GPU-frame timer — `EXT_disjoint_timer_query_webgl2` (A-1, §62, §84).
 *
 * Measures the GPU time of one `WebglRenderer.render` as seconds, published
 * on the next completed query as {@link GlGpuTimer.lastGpuFrameTimeSeconds}.
 * The result is always the **last completed** frame, never the one still
 * in flight: `TIME_ELAPSED_EXT` is asynchronous, and stalling the GPU to
 * read the current frame would be a different number from the one §84 asks
 * for.
 *
 * ## What this does not do
 *
 * - It does not query the extension, allocate a query, or issue
 *   `beginQuery`/`endQuery` until the owner asks ({@link GlGpuTimer.arm}).
 *   Reading `capabilities.timestampQueries` is a separate lazy probe and
 *   does not start measuring. That is what keeps every landed GL transcript
 *   byte-identical for a renderer whose `lastGpuFrameTimeSeconds` is never
 *   read (R-30b).
 * - It does not invent a result when the extension, the query entry points,
 *   or a completed non-disjoint sample is missing. The field stays `NaN`.
 */

import { GL, type GlQuery } from "./gl-program.js";

/** The query surface this helper needs, all optional on `WebglContext`. */
interface TimerGl {
  getExtension?(name: string): unknown;
  getParameter(pname: number): unknown;
  createQuery?(): GlQuery | null;
  deleteQuery?(query: GlQuery): void;
  beginQuery?(target: number, query: GlQuery): void;
  endQuery?(target: number): void;
  getQueryParameter?(query: GlQuery, pname: number): unknown;
}

/**
 * Seconds between `beginQuery`/`endQuery` of the last completed,
 * non-disjoint elapsed-time query, or `NaN` when none has landed.
 */
export class GlGpuTimer {
  /**
   * Last completed GPU-frame duration in seconds. `NaN` until a query
   * resolves without the disjoint flag.
   */
  lastGpuFrameTimeSeconds = Number.NaN;

  #armed = false;

  #supported: boolean | null = null;

  #active: GlQuery | null = null;

  #pending: GlQuery | null = null;

  #spare: GlQuery | null = null;

  /** Start issuing queries on subsequent {@link GlGpuTimer.begin} calls. */
  arm(): void {
    this.#armed = true;
  }

  /** Whether {@link GlGpuTimer.arm} has run. */
  get armed(): boolean {
    return this.#armed;
  }

  /**
   * Lazy extension + entry-point probe. Does not allocate. `false` on a
   * context that omitted `getExtension` or the query methods (R-30b).
   */
  isSupported(gl: TimerGl): boolean {
    this.#supported ??=
      gl.getExtension?.("EXT_disjoint_timer_query_webgl2") != null &&
      typeof gl.createQuery === "function" &&
      typeof gl.beginQuery === "function" &&
      typeof gl.endQuery === "function" &&
      typeof gl.getQueryParameter === "function";
    return this.#supported;
  }

  /**
   * Polls the previous query if it has landed, then starts a new elapsed-time
   * query. No-ops when unarmed, unsupported, or already timing this frame.
   */
  begin(gl: TimerGl): void {
    if (!this.#armed || this.#active !== null || !this.isSupported(gl)) {
      return;
    }
    this.#poll(gl);
    const query = this.#acquire(gl);
    if (query === null) {
      return;
    }
    gl.beginQuery?.(GL.TIME_ELAPSED_EXT, query);
    this.#active = query;
  }

  /**
   * Ends the query {@link GlGpuTimer.begin} started. Safe if `begin` no-oped
   * — the pair is what a `try`/`finally` around `render` needs.
   */
  end(gl: TimerGl): void {
    if (this.#active === null) {
      return;
    }
    gl.endQuery?.(GL.TIME_ELAPSED_EXT);
    this.#pending = this.#active;
    this.#active = null;
  }

  /**
   * Drops query objects without calling into GL — context loss, where the
   * handles are already gone.
   */
  forget(): void {
    this.#active = null;
    this.#pending = null;
    this.#spare = null;
    this.#supported = null;
    this.lastGpuFrameTimeSeconds = Number.NaN;
  }

  /**
   * Releases query objects on a live context (§83). After this the helper
   * may be armed again; the next `begin` reallocates.
   */
  dispose(gl: TimerGl): void {
    if (this.#active !== null) {
      gl.deleteQuery?.(this.#active);
    }
    if (this.#pending !== null) {
      gl.deleteQuery?.(this.#pending);
    }
    if (this.#spare !== null) {
      gl.deleteQuery?.(this.#spare);
    }
    this.forget();
  }

  #acquire(gl: TimerGl): GlQuery | null {
    if (this.#spare !== null) {
      const spare = this.#spare;
      this.#spare = null;
      return spare;
    }
    return gl.createQuery?.() ?? null;
  }

  #poll(gl: TimerGl): void {
    const pending = this.#pending;
    if (pending === null || gl.getQueryParameter === undefined) {
      return;
    }
    if (gl.getQueryParameter(pending, GL.QUERY_RESULT_AVAILABLE) !== true) {
      return;
    }
    const disjoint = gl.getParameter(GL.GPU_DISJOINT_EXT) === true;
    if (!disjoint) {
      const nanoseconds = gl.getQueryParameter(pending, GL.QUERY_RESULT);
      if (typeof nanoseconds === "number" && Number.isFinite(nanoseconds)) {
        this.lastGpuFrameTimeSeconds = nanoseconds * 1e-9;
      }
    }
    this.#spare = pending;
    this.#pending = null;
  }
}

/** The lazy §62 probe `readCapabilities` uses — extension only, no queries. */
export function hasDisjointTimerQuery(gl: {
  getExtension?(name: string): unknown;
}): boolean {
  return gl.getExtension?.("EXT_disjoint_timer_query_webgl2") != null;
}
