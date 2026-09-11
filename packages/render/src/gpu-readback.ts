/** Display-only GPU snapshots (RFC 0009). RasterSource is imported as a type;
 * shared limits live separately, so CanvasTexture can use the guard without a cycle.
 * Refresh between frames, never during a fixed step or render-graph execution.
 */
import { FourError, type Disposable } from "@fourjs/core";
import { Rectangle2, type ColorSpace } from "@fourjs/math";
import type { RasterSource } from "./raster.js";
import type { Renderer } from "./renderer.js";
import { RenderTarget, validateColorSpace } from "./render-target.js";
import { supportsReadPixels, validateReadbackRegion } from "./read-pixels.js";
import { DEFAULT_RASTER_MAXIMUM_BYTES } from "./raster-limits.js";
/** Fixed region and explicit color interpretation for a CPU snapshot. */
export interface GpuReadbackSourceOptions {
  readonly region?: Rectangle2;
  readonly colorSpace?: ColorSpace;
  readonly maximumBytes?: number;
}
/** Asynchronously refreshed pixels with a synchronous, stable RasterSource view. */
export class GpuReadbackSource implements RasterSource, Disposable {
  readonly isGpuReadbackSource = true as const;
  readonly target: RenderTarget;
  readonly width: number;
  readonly height: number;
  readonly origin = "bottom-left" as const;
  readonly colorSpace: ColorSpace;
  readonly #region: Rectangle2;
  readonly #targetWidth: number;
  readonly #targetHeight: number;
  #snapshot: Uint8Array | null;
  #refreshing = false;
  constructor(target: RenderTarget, options: GpuReadbackSourceOptions = {}) {
    if (target.disposed)
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Cannot snapshot a disposed render target.",
      );
    const r =
      options.region ?? new Rectangle2(0, 0, target.width, target.height);
    validateReadbackRegion(r, target.width, target.height);
    const limit = options.maximumBytes ?? DEFAULT_RASTER_MAXIMUM_BYTES;
    const bytes = r.width * r.height * 4;
    if (
      Number.isNaN(limit) ||
      limit <= 0 ||
      !Number.isSafeInteger(bytes) ||
      bytes > limit
    )
      throw new RangeError(
        "GPU snapshot exceeds its positive maximumBytes limit (§85, §96).",
      );
    this.colorSpace = options.colorSpace ?? "srgb";
    validateColorSpace(this.colorSpace, "GpuReadbackSource");
    this.target = target;
    this.width = r.width;
    this.height = r.height;
    this.#targetWidth = target.width;
    this.#targetHeight = target.height;
    this.#region = new Rectangle2(r.x, r.y, r.width, r.height);
    this.#snapshot = new Uint8Array(bytes);
  }
  /** Retained CPU bytes, excluding the target and any wrapping CanvasTexture. */
  get byteLength(): number {
    return this.#snapshot?.byteLength ?? 0;
  }
  /** Whether this source has released its snapshot. */
  get disposed(): boolean {
    return this.#snapshot === null;
  }
  /** Pull one snapshot. Concurrent refreshes are refused; backend errors propagate. */
  async refresh(renderer: Renderer): Promise<boolean> {
    if (this.disposed || !supportsReadPixels(renderer)) return false;
    if (this.#refreshing)
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Only one GPU snapshot refresh may be in flight.",
      );
    this.#assertTarget();
    this.#refreshing = true;
    try {
      // Give the backend its own rectangle; it cannot mutate the source's region.
      const r = this.#region;
      const bytes = await renderer.readPixels(
        this.target,
        new Rectangle2(r.x, r.y, r.width, r.height),
      );
      if (this.#snapshot === null) return false;
      this.#assertTarget();
      if (bytes.byteLength !== this.#snapshot.byteLength)
        throw new FourError(
          "INVALID_APPLICATION_STATE",
          "GPU readPixels returned an incorrect snapshot byte length.",
        );
      this.#snapshot.set(new Uint8Array(bytes));
      return true;
    } finally {
      this.#refreshing = false;
    }
  }
  /** Copy the last successful snapshot, initially zeros. Never calls the GPU. */
  readPixels(out: Uint8Array): void {
    if (this.#snapshot === null)
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "GPU snapshot source is disposed.",
      );
    if (out.byteLength < this.#snapshot.byteLength)
      throw new RangeError("Snapshot output is too small (§85).");
    out.set(this.#snapshot);
  }
  dispose(): void {
    this.#snapshot = null;
  }
  #assertTarget(): void {
    if (
      this.target.disposed ||
      this.target.width !== this.#targetWidth ||
      this.target.height !== this.#targetHeight
    )
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Snapshot target was disposed or resized; create a new source.",
      );
  }
}
/** Structural guard shared with CanvasTexture's feedback provenance accessor. */
export function isGpuReadbackSource(
  value: unknown,
): value is GpuReadbackSource {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<GpuReadbackSource>).isGpuReadbackSource === true
  );
}
