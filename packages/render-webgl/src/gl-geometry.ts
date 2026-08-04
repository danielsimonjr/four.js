/**
 * GPU-side geometry for the WebGL 2 backend: one vertex array per
 * `BufferGeometry`, cached and invalidated by version (§53, §61, §64).
 *
 * §53 gives every geometry a stable `id` and a `version` that advances on every
 * mutation the geometry can see, and states the contract this module is the
 * first consumer of: *"Backends cache GPU buffers per geometry. The cache key
 * is `BufferGeometry.version`."* So the cache is keyed by `id` and validated by
 * `version` — an `id` hit with a stale `version` deletes the old GL objects and
 * re-uploads, which is exactly what `markDirty()` and the setters are for.
 *
 * ## What one entry holds
 *
 * A vertex array object plus the one to three buffers it references —
 * positions, the optional normal stream (§68, 2026-08-04), the optional index
 * buffer — and the
 * three numbers the draw call needs (mode, element count, index type). Binding
 * a VAO restores the whole attribute *and* element-array binding state in one
 * call, so the per-draw cost in `webgl-renderer.ts` is `bindVertexArray` plus
 * `drawElements`/`drawArrays` — nothing else per object.
 *
 * The VAO is program-independent: the position stream is bound to the fixed
 * slot `POSITION_ATTRIBUTE_LOCATION`, which the shader declares with an
 * explicit `layout(location = ...)` (see `gl-program.ts`). A second pipeline
 * added later reuses these vertex arrays unchanged.
 *
 * ## Eviction policy (decision, WP-3.5)
 *
 * Entries are evicted **lazily, on the next acquire for the same geometry id**,
 * and eagerly for the whole cache on {@link GeometryCache.dispose}. There is no
 * background sweep and no finalization hook:
 *
 * - A **version bump** (in-place edit plus `markDirty()`, or an assignment
 *   through a setter) is detected on the next `acquire`, which deletes the
 *   stale VAO and buffers and uploads fresh ones. Nothing is retained twice.
 * - **`geometry.dispose()`** bumps the version and empties the arrays (§53), so
 *   the next `acquire` deletes the stale GL objects and — finding nothing left
 *   to draw — returns `null` without creating a new entry. A geometry that is
 *   disposed and then *never submitted again* therefore keeps its GL objects
 *   until the renderer is disposed. That is a deliberate, documented leak
 *   window: the alternatives are a `FinalizationRegistry` (non-deterministic
 *   timing, which §33 makes unattractive even outside the simulation) or a
 *   disposal event on `BufferGeometry` (a subscription per geometry per
 *   backend, which §53 explicitly rejected in favour of the version counter).
 *   §83 puts resource ownership on whoever created the geometry; a renderer
 *   that is done with a scene disposes, and the scene's GPU memory goes with
 *   it.
 * - **Context loss** is not eviction: {@link GeometryCache.forget} drops the
 *   records *without* calling any `delete*` entry point, because every handle
 *   is already invalid and the context must not be touched (§61).
 */

import type { RenderItem } from "@four/render";

import {
  GL,
  NORMAL_ATTRIBUTE_LOCATION,
  POSITION_ATTRIBUTE_LOCATION,
  type WebglContext,
} from "./gl-program.js";
import type { GlBuffer, GlVertexArray } from "./gl-program.js";

/**
 * The geometry type this cache stores, taken from `@four/render`'s render item
 * rather than imported from `@four/geometry`.
 *
 * `@four/render-webgl`'s dependencies are `core`, `math`, and `render` (plan
 * §3.1, frozen). Deriving the type from `RenderItem["geometry"]` gives the full
 * `BufferGeometry` surface — `id`, `version`, `positions`, `indices`, `mode`,
 * `drawCount` — with no new edge in the dependency matrix, and it stays correct
 * by construction: if `RenderItem.geometry` is ever widened, this follows.
 */
export type CacheableGeometry = RenderItem["geometry"];

/** Everything one cached geometry needs at draw time. */
export interface GeometryRecord {
  /** Vertex array holding the attribute and element-array bindings. */
  readonly vertexArray: GlVertexArray;

  /** Buffer backing the position attribute. */
  readonly positionBuffer: GlBuffer;

  /**
   * Buffer backing the optional normal attribute (§53, §68), or `null` for a
   * position-only geometry. Bound at the fixed `NORMAL_ATTRIBUTE_LOCATION`
   * inside the vertex array, so the lit pipeline reads it with no extra
   * per-draw call — and the unlit pipeline, which declares no normal input,
   * ignores it for free.
   */
  readonly normalBuffer: GlBuffer | null;

  /** Index buffer, or `null` for a non-indexed geometry. */
  readonly indexBuffer: GlBuffer | null;

  /** `BufferGeometry.version` this record was uploaded from. */
  readonly version: number;

  /** Primitive mode: {@link GL.TRIANGLES} or {@link GL.LINES}. */
  readonly mode: number;

  /** Elements one draw call issues — indices when indexed, vertices otherwise. */
  readonly count: number;

  /**
   * Index element type ({@link GL.UNSIGNED_SHORT} or {@link GL.UNSIGNED_INT}),
   * or `null` when the geometry is not indexed — which is also the flag that
   * selects `drawArrays` over `drawElements`.
   */
  readonly indexType: number | null;
}

/** Maps §53's draw mode onto its GL enumerant. */
function glMode(mode: CacheableGeometry["mode"]): number {
  return mode === "lines" ? GL.LINES : GL.TRIANGLES;
}

/**
 * Maps an index array onto its GL element type. `BufferGeometry` accepts
 * exactly `Uint16Array` and `Uint32Array` (§53), which are exactly WebGL 2's
 * two element types, so the mapping is total.
 */
function glIndexType(
  indices: NonNullable<CacheableGeometry["indices"]>,
): number {
  return indices instanceof Uint16Array ? GL.UNSIGNED_SHORT : GL.UNSIGNED_INT;
}

/**
 * Per-context store of uploaded geometry (§61, §64 stage 7).
 *
 * One cache belongs to one GL context: the renderer builds it during
 * `initialize` and builds a *new* one on context restore, since every handle
 * the old one held died with the context.
 *
 * ```ts
 * const cache = new GeometryCache(gl);
 * const record = cache.acquire(item.geometry);
 * if (record !== null) {
 *   gl.bindVertexArray(record.vertexArray);
 *   // draw…
 * }
 * ```
 */
export class GeometryCache {
  readonly #gl: WebglContext;

  /** Records by `BufferGeometry.id`; see the module header for eviction. */
  readonly #records = new Map<string, GeometryRecord>();

  #disposed = false;

  constructor(gl: WebglContext) {
    this.#gl = gl;
  }

  /** Number of geometries currently uploaded. Diagnostics and tests (§83). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link GeometryCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the vertex array for `geometry`, uploading it on first use and
   * re-uploading it whenever `geometry.version` has advanced.
   *
   * Returns `null` — and creates no entry — when there is nothing to draw
   * (`drawCount === 0`, which includes every disposed geometry) or when GL
   * refuses to allocate an object. **Never throws**: this runs inside
   * `Renderer.render`, and §61 forbids throwing there for a lost context; a
   * failed allocation is the same class of asynchronous, driver-scheduled
   * event, so it skips the object rather than unwinding the frame.
   */
  acquire(geometry: CacheableGeometry): GeometryRecord | null {
    const existing = this.#records.get(geometry.id);
    if (existing !== undefined) {
      if (existing.version === geometry.version) {
        return existing;
      }
      this.#deleteRecord(existing);
      this.#records.delete(geometry.id);
    }

    if (geometry.drawCount === 0) {
      return null;
    }

    const record = this.#upload(geometry);
    if (record === null) {
      return null;
    }
    this.#records.set(geometry.id, record);
    return record;
  }

  /**
   * Drops every record **without touching the context** — the context-loss
   * path (§61). The handles are already invalid; calling `deleteBuffer` on them
   * would be a GL call against a lost context for no benefit.
   */
  forget(): void {
    this.#records.clear();
  }

  /**
   * Deletes every vertex array and buffer this cache created (§83). Idempotent.
   *
   * Only valid on a live context — the renderer calls {@link GeometryCache.forget}
   * instead when the context is lost.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#deleteRecord(record);
    }
    this.#records.clear();
  }

  /**
   * Uploads `geometry` into a fresh vertex array, or returns `null` if GL would
   * not allocate one.
   *
   * Unbinding order matters and is not incidental: the element-array binding is
   * *part of* vertex-array state, so the vertex array is unbound first and the
   * `ARRAY_BUFFER` binding cleared afterwards. Clearing `ELEMENT_ARRAY_BUFFER`
   * while the vertex array is still bound would erase the index binding that
   * was just recorded.
   */
  #upload(geometry: CacheableGeometry): GeometryRecord | null {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) {
      return null;
    }
    const positionBuffer = gl.createBuffer();
    if (positionBuffer === null) {
      gl.deleteVertexArray(vertexArray);
      return null;
    }

    const normals = geometry.normals;
    let normalBuffer: GlBuffer | null = null;
    if (normals !== undefined) {
      normalBuffer = gl.createBuffer();
      if (normalBuffer === null) {
        gl.deleteBuffer(positionBuffer);
        gl.deleteVertexArray(vertexArray);
        return null;
      }
    }

    const indices = geometry.indices;
    let indexBuffer: GlBuffer | null = null;
    if (indices !== undefined) {
      indexBuffer = gl.createBuffer();
      if (indexBuffer === null) {
        if (normalBuffer !== null) {
          gl.deleteBuffer(normalBuffer);
        }
        gl.deleteBuffer(positionBuffer);
        gl.deleteVertexArray(vertexArray);
        return null;
      }
    }

    gl.bindVertexArray(vertexArray);

    gl.bindBuffer(GL.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(GL.ARRAY_BUFFER, geometry.positions, GL.STATIC_DRAW);
    gl.enableVertexAttribArray(POSITION_ATTRIBUTE_LOCATION);
    gl.vertexAttribPointer(
      POSITION_ATTRIBUTE_LOCATION,
      3,
      GL.FLOAT,
      false,
      0,
      0,
    );

    // The optional normal stream (§53, §68): its own buffer at the second
    // fixed slot. `vertexAttribPointer` captures the *current* ARRAY_BUFFER
    // binding into the vertex array, so rebinding here does not disturb the
    // position attribute recorded above.
    if (normals !== undefined && normalBuffer !== null) {
      gl.bindBuffer(GL.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(GL.ARRAY_BUFFER, normals, GL.STATIC_DRAW);
      gl.enableVertexAttribArray(NORMAL_ATTRIBUTE_LOCATION);
      gl.vertexAttribPointer(
        NORMAL_ATTRIBUTE_LOCATION,
        3,
        GL.FLOAT,
        false,
        0,
        0,
      );
    }

    if (indices !== undefined && indexBuffer !== null) {
      gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, indices, GL.STATIC_DRAW);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);

    return {
      vertexArray,
      positionBuffer,
      normalBuffer,
      indexBuffer,
      version: geometry.version,
      mode: glMode(geometry.mode),
      count: geometry.drawCount,
      indexType: indices === undefined ? null : glIndexType(indices),
    };
  }

  /** Deletes one record's GL objects. Live context only. */
  #deleteRecord(record: GeometryRecord): void {
    const gl = this.#gl;
    gl.deleteVertexArray(record.vertexArray);
    gl.deleteBuffer(record.positionBuffer);
    if (record.normalBuffer !== null) {
      gl.deleteBuffer(record.normalBuffer);
    }
    if (record.indexBuffer !== null) {
      gl.deleteBuffer(record.indexBuffer);
    }
  }
}
