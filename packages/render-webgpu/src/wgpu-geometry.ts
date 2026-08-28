/**
 * Per-device store of uploaded geometry (§61, §64 stage 7) — the WebGPU twin of
 * `gl-geometry.ts`'s `GeometryCache`.
 *
 * The pattern is §61's recorded design and is not re-argued here: `Texture` and
 * `BufferGeometry` are **CPU-side descriptors carrying an id and a version**,
 * GPU residency is a backend-owned cache keyed by that id, and a device loss is
 * handled by dropping the cache. That design is the reason a second backend is
 * cheap, and this class is the smallest possible demonstration of it.
 *
 * ## What differs from the GL twin, and what does not
 *
 * *Does not*: the id/version contract, the eviction rule, the refusal to throw,
 * the fixed allocation order.
 *
 * *Does*: there is **no vertex array object**. WebGL 2 records attribute
 * bindings into a VAO so a draw is one `bindVertexArray`; WebGPU records them
 * into the *pipeline* (`wgpu-pipeline-cache.ts`) and binds raw buffers per
 * draw. So a record here is buffers and counts, and the attribute layout it
 * would have carried lives in the pipeline descriptor instead. That is the
 * structural difference between the two APIs, and it is why this file is half
 * the length of the one it ports.
 *
 * Uploads use `queue.writeBuffer`, which copies immediately from the caller's
 * typed array — so a geometry mutated after the call is not read back, and the
 * `version` bump is what re-uploads it.
 *
 * This packet uploads **positions, optional uvs, optional colours and optional
 * indices**: exactly the streams the unlit tier draws. Uvs joined in WP-R1.2,
 * with the textured variant that reads them; normals join with the lit and
 * standard pipelines (WP-R1.5), by the same rule — a stream is uploaded when a
 * pipeline in this package can read it, never before, because a buffer nothing
 * binds is bytes nothing draws.
 */

import type { RenderItem } from "@four/render";

import {
  GPU_BUFFER_USAGE,
  type GpuBuffer,
  type GpuDevice,
} from "./webgpu-device.js";

/** What this cache needs of a geometry: exactly `RenderItem["geometry"]`. */
export type CacheableGeometry = RenderItem["geometry"];

/** Everything one cached geometry needs at draw time. */
export interface WgpuGeometryRecord {
  /** Buffer backing the position attribute (slot 0). */
  readonly positionBuffer: GpuBuffer;
  /** Buffer backing the optional per-vertex colour attribute, or `null`. */
  readonly colorBuffer: GpuBuffer | null;
  /**
   * Buffer backing the optional per-vertex uv attribute (§53, §77), or `null`.
   *
   * No slot number here, and none on `colorBuffer` any more: a slot index is
   * *positional* in the variant's vertex layout (`wgpu-unlit.ts`), so a record
   * cannot name one — a coloured, textured draw binds uvs to slot 2 and an
   * uncoloured, textured one binds them to slot 1.
   */
  readonly uvBuffer: GpuBuffer | null;
  /** Index buffer, or `null` for a non-indexed geometry. */
  readonly indexBuffer: GpuBuffer | null;
  /** `"uint16"` or `"uint32"`, or `null` when there are no indices. */
  readonly indexFormat: "uint16" | "uint32" | null;
  /** `BufferGeometry.version` this record was uploaded from. */
  readonly version: number;
  /** Vertices or indices to draw (§53's `drawCount`). */
  readonly count: number;
  /** WebGPU topology for §53's draw mode. */
  readonly topology: "triangle-list" | "line-list";
}

/**
 * Rounds a byte length up to a multiple of four.
 *
 * `createBuffer` requires a size that `writeBuffer` can fill, and
 * `writeBuffer`'s size must be a multiple of 4. A `Uint16Array` of odd length
 * — a line-list index buffer with an odd index count — is the case that hits
 * this, and padding it is correct: the pad bytes sit past `count` and are never
 * indexed.
 */
function alignedSize(byteLength: number): number {
  return Math.ceil(byteLength / 4) * 4;
}

/**
 * Per-device store of uploaded geometry, keyed by `BufferGeometry.id`.
 *
 * ```ts
 * const record = geometries.acquire(item.geometry);
 * if (record !== null) {
 *   pass.setVertexBuffer(0, record.positionBuffer);
 *   pass.draw(record.count);
 * }
 * ```
 */
export class WgpuGeometryCache {
  readonly #device: GpuDevice;

  readonly #records = new Map<string, WgpuGeometryRecord>();

  #disposed = false;

  constructor(device: GpuDevice) {
    this.#device = device;
  }

  /** Number of geometries currently uploaded. Diagnostics and tests (§83). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link WgpuGeometryCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the buffers for `geometry`, uploading them on first use and
   * re-uploading whenever `geometry.version` has advanced.
   *
   * Returns `null` — and creates no entry — when there is nothing to draw
   * (`drawCount === 0`, which includes every disposed geometry) or once the
   * cache is disposed. **Never throws**: this runs inside `Renderer.render`,
   * and §61 forbids throwing there.
   */
  acquire(geometry: CacheableGeometry): WgpuGeometryRecord | null {
    if (this.#disposed) {
      return null;
    }
    const existing = this.#records.get(geometry.id);
    if (existing !== undefined) {
      if (existing.version === geometry.version) {
        return existing;
      }
      this.#destroyRecord(existing);
      this.#records.delete(geometry.id);
    }

    if (geometry.drawCount === 0) {
      return null;
    }

    const record = this.#upload(geometry);
    this.#records.set(geometry.id, record);
    return record;
  }

  /**
   * Drops every record **without destroying anything** — the device-loss path
   * (§61). The allocations belong to a device that no longer exists; calling
   * `destroy()` on them would be a call against a lost device for no benefit.
   */
  forget(): void {
    this.#records.clear();
  }

  /** Destroys every allocation and marks the cache disposed (§83). Idempotent. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#destroyRecord(record);
    }
    this.#records.clear();
  }

  #upload(geometry: CacheableGeometry): WgpuGeometryRecord {
    const positionBuffer = this.#uploadBuffer(
      geometry.positions,
      GPU_BUFFER_USAGE.VERTEX,
      `four:positions:${geometry.id}`,
    );

    // Allocation order is positions → uvs → colours → indices, the order
    // `gl-geometry.ts` allocates in, so the two backends' upload transcripts
    // stay readable side by side.
    const uvs = geometry.uvs;
    const uvBuffer =
      uvs === undefined
        ? null
        : this.#uploadBuffer(
            uvs,
            GPU_BUFFER_USAGE.VERTEX,
            `four:uvs:${geometry.id}`,
          );

    const colors = geometry.colors;
    const colorBuffer =
      colors === undefined
        ? null
        : this.#uploadBuffer(
            colors,
            GPU_BUFFER_USAGE.VERTEX,
            `four:colors:${geometry.id}`,
          );

    const indices = geometry.indices;
    const indexBuffer =
      indices === undefined
        ? null
        : this.#uploadBuffer(
            indices,
            GPU_BUFFER_USAGE.INDEX,
            `four:indices:${geometry.id}`,
          );

    return {
      positionBuffer,
      colorBuffer,
      uvBuffer,
      indexBuffer,
      indexFormat:
        indices === undefined
          ? null
          : indices instanceof Uint16Array
            ? "uint16"
            : "uint32",
      version: geometry.version,
      count: geometry.drawCount,
      topology: geometry.mode === "lines" ? "line-list" : "triangle-list",
    };
  }

  #uploadBuffer(
    data: ArrayBufferView,
    usage: number,
    label: string,
  ): GpuBuffer {
    const buffer = this.#device.createBuffer({
      label,
      size: alignedSize(data.byteLength),
      usage: usage | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  #destroyRecord(record: WgpuGeometryRecord): void {
    record.positionBuffer.destroy();
    record.colorBuffer?.destroy();
    record.uvBuffer?.destroy();
    record.indexBuffer?.destroy();
  }
}
