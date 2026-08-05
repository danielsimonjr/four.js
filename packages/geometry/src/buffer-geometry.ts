/**
 * `BufferGeometry` (§53) — CPU-side vertex data, in the one shape the MVP
 * renderer draws.
 *
 * §53 describes a family (`Geometry2D`, `Geometry3D`, `IndexedGeometry`,
 * `ProceduralGeometry`, …) over an abstract base with `id`, `version`,
 * `bounds`, `computeBounds()`, `clone()`, and `dispose()`. This packet
 * implements exactly one concrete member of it — positions, an optional
 * per-vertex `normals` attribute, optional indices, a draw mode — because that
 * is what the §120 MVP renders (unlit and Lambert-lit colored primitives,
 * WebGL 2). The rest of the family, the rest of the standard attribute set
 * (tangents, uv, joints/weights, instance transforms), and `clone()` are
 * deliberately absent rather than sketched: each of them pins a public layout
 * that the WebGL backend and the §79 scene format both have to agree with, and
 * none of them is needed to draw a box.
 *
 * `normals` joined the layout with the §68 lighting packet (2026-08-04): a lit
 * surface (§120 "lighting") cannot be shaded without per-vertex normals, and
 * §53's own attribute list names them first. The attribute is **optional** —
 * 2D shapes stay position-only and unlit — and, when present, index-aligned
 * with `positions`: `normals[3 * i]` is vertex `i`'s normal x. Unit length is
 * the author's contract, not validated here (§85 checks finiteness only; the
 * lit pipeline normalizes after interpolation anyway, and re-checking length
 * per component would reject legitimately denormalized authored data).
 *
 * ## Version, not events
 *
 * Backends cache GPU buffers per geometry. The cache key is
 * {@link BufferGeometry.version}, which advances on every mutation the geometry
 * can see — the same contract `Transform.version` (§7) offers, down to the
 * rule for mutations it *cannot* see:
 *
 * ```ts
 * geometry.positions[0] = 2;  // in-place edit — invisible to the geometry
 * geometry.markDirty();       // announce it: version += 1
 * ```
 *
 * Replacing an array wholesale (`geometry.positions = next`) goes through a
 * setter which validates and bumps the version for you. There is no change
 * event: a renderer that draws a geometry every frame compares a number, and an
 * event would cost a subscription per geometry per backend for no extra
 * information.
 *
 * ## Validation (§85)
 *
 * §85 requires development builds to detect "NaN and infinite values" and
 * "invalid geometry indices". Both are checked **when an array is assigned** —
 * at construction or through a setter — and never per frame: assignment is an
 * authoring-time event, so an O(n) pass there is free, while the same pass on
 * the draw path would be the most expensive thing the renderer does. Failures
 * throw `RangeError`/`TypeError` rather than `FourError`: §89's code union has
 * no argument-validation member today, and extending it belongs to the packet
 * that owns `@four/core` (reported as a WP-3.3 decision).
 *
 * In-place edits followed by {@link BufferGeometry.markDirty} are *not*
 * re-validated. That is the fast path, and re-validating it would defeat the
 * purpose of having one.
 */

import type { Disposable } from "@four/core";
import { Vector3 } from "@four/math";

/**
 * How a geometry's vertices assemble into primitives.
 *
 * The MVP tier (§120) draws filled shapes and debug/wire lines, so the two
 * modes are `"triangles"` and `"lines"`; strips, fans, and points are not
 * exposed because nothing in this phase emits them (a fan is expanded into
 * indexed triangles by {@link circleGeometry2D} instead — see `primitives.ts`).
 * The mode fixes how many indices — or, unindexed, how many vertices — make one
 * primitive: three for `"triangles"`, two for `"lines"`.
 */
export type GeometryDrawMode = "triangles" | "lines";

/**
 * The two index element types WebGL 2 accepts (`UNSIGNED_SHORT` and
 * `UNSIGNED_INT`). Builders pick the narrower one whenever the vertex count
 * fits — see `primitives.ts`.
 */
export type GeometryIndexArray = Uint16Array | Uint32Array;

/**
 * An axis-aligned bounding box in the geometry's own local space, as returned
 * by {@link BufferGeometry.computeBounds}.
 *
 * §53 spells this as a `bounds: BoundingVolume` field plus a
 * `computeBounds(): void` that fills it. The volume hierarchy (spheres, capsule
 * bounds, hierarchical volumes) belongs to the culling packet (§87), so this
 * packet returns the one volume it can compute exactly — the AABB — and returns
 * it from the method instead of publishing a field whose type would have to
 * change when §87 lands.
 *
 * The `Vector3`s are **live**: they belong to the geometry, are rewritten in
 * place by the next recompute, and must not be mutated by callers. Copy them if
 * you need to keep them (the same rule `resolveWorldTransform` states for a
 * returned world matrix).
 */
export interface GeometryBounds {
  /** Lowest corner. `+Infinity` on every axis when the geometry has no vertices. */
  readonly min: Vector3;
  /** Highest corner. `-Infinity` on every axis when the geometry has no vertices. */
  readonly max: Vector3;
}

/** Construction arguments of {@link BufferGeometry}. */
export interface BufferGeometryOptions {
  /**
   * Vertex positions as xyz triplets — `positions[3 * i]` is vertex `i`'s x.
   * Length must be a multiple of 3 and every value must be finite (§85).
   */
  positions: Float32Array;
  /**
   * Optional per-vertex normals as xyz triplets, index-aligned with
   * `positions` (§53, §68). Length must equal `positions.length` and every
   * value must be finite (§85). Unit length is the author's contract — see the
   * module header.
   */
  normals?: Float32Array;
  /**
   * Optional index buffer. Every entry must be a valid vertex index and the
   * length must be a multiple of the mode's primitive size (§85).
   */
  indices?: GeometryIndexArray;
  /** Primitive assembly; defaults to `"triangles"`. */
  mode?: GeometryDrawMode;
}

/**
 * Source of geometry ids. Monotonic and process-wide, exactly like `Node`'s:
 * §33 forbids random or clock-derived identity, and a counter makes two
 * identical construction sequences produce identical ids.
 */
let nextGeometryId = 1;

function assignGeometryId(): string {
  const id = `geometry-${String(nextGeometryId)}`;
  nextGeometryId += 1;
  return id;
}

/** Shared empty backing store handed to a disposed geometry. */
const EMPTY_POSITIONS = new Float32Array(0);

/** Vertices (or indices) that make up one primitive, per draw mode. */
function primitiveSize(mode: GeometryDrawMode): number {
  return mode === "triangles" ? 3 : 2;
}

/**
 * Runs the §85 checks for one (positions, normals, indices, mode) quadruple.
 * Throws on the first violation; returns nothing.
 */
function validate(
  positions: Float32Array,
  normals: Float32Array | undefined,
  indices: GeometryIndexArray | undefined,
  mode: GeometryDrawMode,
): void {
  if (positions.length % 3 !== 0) {
    throw new RangeError(
      `Geometry positions must be xyz triplets, so their length must be a ` +
        `multiple of 3; got ${String(positions.length)} (§53).`,
    );
  }
  for (let i = 0; i < positions.length; i += 1) {
    if (!Number.isFinite(positions[i])) {
      throw new RangeError(
        `Geometry position ${String(i)} is ${String(positions[i])}; positions ` +
          "must be finite (§85: NaN and infinite values).",
      );
    }
  }

  if (normals !== undefined) {
    if (normals.length !== positions.length) {
      throw new RangeError(
        `Geometry normals must be index-aligned with positions — one xyz ` +
          `triplet per vertex — so their length must be ` +
          `${String(positions.length)}; got ${String(normals.length)} ` +
          "(§53, §68).",
      );
    }
    for (let i = 0; i < normals.length; i += 1) {
      if (!Number.isFinite(normals[i])) {
        throw new RangeError(
          `Geometry normal ${String(i)} is ${String(normals[i])}; normals ` +
            "must be finite (§85: NaN and infinite values).",
        );
      }
    }
  }

  const vertexCount = positions.length / 3;
  const size = primitiveSize(mode);

  if (indices === undefined) {
    if (vertexCount % size !== 0) {
      throw new RangeError(
        `A non-indexed "${mode}" geometry needs a multiple of ${String(size)} ` +
          `vertices; got ${String(vertexCount)} (§85).`,
      );
    }
    return;
  }

  if (indices.length % size !== 0) {
    throw new RangeError(
      `An indexed "${mode}" geometry needs a multiple of ${String(size)} ` +
        `indices; got ${String(indices.length)} (§85: invalid geometry indices).`,
    );
  }
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] >= vertexCount) {
      throw new RangeError(
        `Geometry index ${String(i)} refers to vertex ${String(indices[i])}, ` +
          `but the geometry has ${String(vertexCount)} vertices ` +
          "(§85: invalid geometry indices).",
      );
    }
  }
}

/**
 * Vertex positions plus optional indices — the geometry every MVP-tier
 * renderable draws (§53).
 *
 * ```ts
 * const geometry = new BufferGeometry({
 *   positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
 * });
 * geometry.computeBounds();      // { min: (0,0,0), max: (1,1,0) }
 * geometry.dispose();            // §83: explicit lifetime
 * ```
 *
 * Geometries are **shared, not owned by nodes**: any number of `Renderable`s
 * may point at one, and disposing it is the job of whoever created it (§83).
 */
export class BufferGeometry implements Disposable {
  /**
   * Stable identity (§53), assigned at construction from a monotonic counter
   * and formatted `geometry-<n>`. Unique within a process, ascending in
   * construction order, never reused.
   */
  readonly id: string = assignGeometryId();

  #positions: Float32Array;

  #normals: Float32Array | undefined;

  #indices: GeometryIndexArray | undefined;

  #mode: GeometryDrawMode;

  #version = 0;

  #disposed = false;

  /** Bounds storage, allocated once and rewritten by every recompute. */
  readonly #boundsMin = new Vector3();

  readonly #boundsMax = new Vector3();

  readonly #bounds: GeometryBounds = {
    min: this.#boundsMin,
    max: this.#boundsMax,
  };

  /**
   * {@link BufferGeometry.version} at the last bounds computation. Starts at -1
   * — never a legal version — so the first `computeBounds()` always computes.
   */
  #boundsVersion = -1;

  constructor(options: BufferGeometryOptions) {
    const mode = options.mode ?? "triangles";
    validate(options.positions, options.normals, options.indices, mode);
    this.#positions = options.positions;
    this.#normals = options.normals;
    this.#indices = options.indices;
    this.#mode = mode;
  }

  /**
   * Vertex positions as xyz triplets. The array is held by reference, not
   * copied — a builder that generated it hands over ownership, and a renderer
   * may upload straight from it.
   *
   * Assigning a new array validates it (§85) and bumps
   * {@link BufferGeometry.version}. Editing the existing array in place is
   * legal and cheap, but invisible here: call {@link BufferGeometry.markDirty}
   * afterwards.
   */
  get positions(): Float32Array {
    return this.#positions;
  }

  set positions(value: Float32Array) {
    validate(value, this.#normals, this.#indices, this.#mode);
    this.#positions = value;
    this.markDirty();
  }

  /**
   * Optional per-vertex normals, or `undefined` for an attribute-free layout
   * (§53, §68). Held by reference, like {@link BufferGeometry.positions}, and
   * subject to the same rules: assigning validates (index-aligned with
   * positions, finite, §85) and bumps the version; in-place edits need
   * {@link BufferGeometry.markDirty}. Assigning `undefined` drops the
   * attribute — the geometry draws unlit-only from then on (a lit draw of a
   * normal-less geometry shades from its ambient term alone; see
   * `@four/render-webgl`).
   *
   * Replacing `positions` with an array of a different vertex count while
   * normals are present therefore throws: drop or replace the normals first.
   */
  get normals(): Float32Array | undefined {
    return this.#normals;
  }

  set normals(value: Float32Array | undefined) {
    validate(this.#positions, value, this.#indices, this.#mode);
    this.#normals = value;
    this.markDirty();
  }

  /**
   * Optional index buffer, or `undefined` for sequential vertices. Assigning
   * validates against the current positions and mode and bumps the version;
   * assigning `undefined` drops indexing (and then requires a vertex count that
   * divides into whole primitives).
   */
  get indices(): GeometryIndexArray | undefined {
    return this.#indices;
  }

  set indices(value: GeometryIndexArray | undefined) {
    validate(this.#positions, this.#normals, value, this.#mode);
    this.#indices = value;
    this.markDirty();
  }

  /**
   * Primitive assembly. Assigning re-validates the buffers against the new
   * mode — switching a triangle geometry to `"lines"` fails unless the counts
   * divide by 2 — and bumps the version.
   */
  get mode(): GeometryDrawMode {
    return this.#mode;
  }

  set mode(value: GeometryDrawMode) {
    validate(this.#positions, this.#normals, this.#indices, value);
    this.#mode = value;
    this.markDirty();
  }

  /**
   * Counter incremented on every mutation (§53). Backends cache GPU buffers
   * against it; treat it as opaque and compare for inequality, exactly like
   * `Transform.version`. Monotonic, never wraps in a realistic session.
   */
  get version(): number {
    return this.#version;
  }

  /** Number of vertices — `positions.length / 3`. */
  get vertexCount(): number {
    return this.#positions.length / 3;
  }

  /**
   * Number of elements one draw call issues: the index count when indexed, the
   * vertex count otherwise. Always a whole number of primitives.
   */
  get drawCount(): number {
    return this.#indices === undefined
      ? this.vertexCount
      : this.#indices.length;
  }

  /** Whether {@link BufferGeometry.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Announces a mutation the geometry could not see — an in-place write into
   * `positions`, `normals`, or `indices`. Bumps {@link BufferGeometry.version}
   * by one, which invalidates the cached bounds and every backend buffer keyed
   * on the version.
   *
   * Calling it after a setter is harmless, only wasteful: the version advances
   * again and the bounds recompute once more.
   */
  markDirty(): void {
    this.#version += 1;
  }

  /**
   * Returns this geometry's axis-aligned bounds in local space, recomputing
   * them only when {@link BufferGeometry.version} has advanced since the last
   * call (§53: bounds are computed, then cached against the version).
   *
   * Allocates nothing — the returned {@link GeometryBounds} and its two vectors
   * are owned by the geometry and rewritten in place on the next recompute, so
   * callers that keep the values must copy them.
   *
   * A geometry with no vertices returns the empty box `min = +Infinity`,
   * `max = -Infinity` (decision, WP-3.3): that is the identity element of
   * bounds union, so an empty geometry folded into a scene bound contributes
   * nothing, whereas a zero-sized box at the origin would drag the scene bound
   * to include a point that has no geometry in it.
   */
  computeBounds(): GeometryBounds {
    if (this.#boundsVersion === this.#version) {
      return this.#bounds;
    }

    const p = this.#positions;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      if (x < minX) {
        minX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (z < minZ) {
        minZ = z;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y > maxY) {
        maxY = y;
      }
      if (z > maxZ) {
        maxZ = z;
      }
    }

    this.#boundsMin.set(minX, minY, minZ);
    this.#boundsMax.set(maxX, maxY, maxZ);
    this.#boundsVersion = this.#version;
    return this.#bounds;
  }

  /**
   * Releases this geometry's CPU-side data (§83). Idempotent.
   *
   * The typed arrays are dropped — `positions` becomes empty, `normals` and
   * `indices` become `undefined` — so a large mesh's memory is reclaimable the moment
   * its owner is done with it, and the version is bumped so any backend cache
   * keyed on it re-reads (and finds nothing to draw). Nothing throws
   * afterwards: {@link BufferGeometry.disposed} is the flag renderers and the
   * §83 "disposed resource still in use" diagnostic check.
   *
   * Disposing does **not** notify the renderables pointing at this geometry;
   * ownership is explicit and upwards (§83), so whoever created the geometry
   * decides when nothing needs it any more.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#positions = EMPTY_POSITIONS;
    this.#normals = undefined;
    this.#indices = undefined;
    this.markDirty();
  }
}
