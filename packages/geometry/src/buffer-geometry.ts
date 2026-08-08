/**
 * `BufferGeometry` (§53) — CPU-side vertex data, in the one shape the MVP
 * renderer draws.
 *
 * §53 describes a family (`Geometry2D`, `Geometry3D`, `IndexedGeometry`,
 * `ProceduralGeometry`, …) over an abstract base with `id`, `version`,
 * `bounds`, `computeBounds()`, `clone()`, and `dispose()`. This packet
 * implements exactly one concrete member of it — positions, the optional
 * per-vertex `normals`, `uvs`, and `colors` attributes, optional indices, a
 * draw mode — because that is what the §120 MVP renders (unlit, textured, and
 * Lambert-lit primitives, WebGL 2). The rest of the family, the rest of §53's
 * standard attribute set (tangents, a secondary uv set, joints/weights,
 * instance transforms), and `clone()` are deliberately absent rather than
 * sketched: each of them pins a public layout that the WebGL backend and the
 * §79 scene format both have to agree with, and none of them is needed to draw
 * a textured box.
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
 * `uvs` and `colors` joined it the same way (R-19), and follow the `normals`
 * precedent exactly — optional, index-aligned, §85-validated on assignment,
 * dropped by `dispose()`:
 *
 * - **`uvs`** are 2 floats per vertex (`uvs[2 * i]` is vertex `i`'s u), the
 *   texture coordinate §53 names and §55/§57's `map` samples with. `v = 0` is
 *   the bottom edge, matching §7a's Y-up world and the bottom-row-first texel
 *   order `@four/render`'s `TextureSource` documents — so a textured quad needs
 *   no flip anywhere. Values outside 0…1 are legal (they tile or clamp
 *   according to the sampler, which is backend state, not geometry state).
 * - **`colors`** are 4 floats per vertex (`colors[4 * i]` is vertex `i`'s red),
 *   straight (non-premultiplied) RGBA in the same nominal 0…1 range and with
 *   the same "no color space attached" policy `UnlitMaterial.color` states
 *   (§60a). They are what makes §113's debug-draw overlay drawable: a segment
 *   list is positions plus colors, uploaded once and drawn with
 *   `UnlitMaterial({ vertexColors: true })`.
 *
 * Neither is *consumed* unless a material asks for it: a geometry may carry uvs
 * and still draw flat-coloured, which is what keeps the attributes free to add
 * to the primitive builders without changing a single existing pixel.
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
 * geometry.uvs![0] = 0.5;     // …and so is one into any other attribute
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
 *
 * ## Resource accounting (§83, A-5)
 *
 * Every geometry reports its size ({@link BufferGeometry.byteLength}) to the
 * process-wide totals in `resource-memory.ts` — at construction, on each
 * attribute replacement, and on `dispose()` — which is what makes §84's
 * `bufferMemory` measurable and a leaked geometry visible. The accounting is
 * arithmetic on two module-level numbers, holds no reference to anything, and
 * never runs on a draw path. `resource-memory.ts` documents the design.
 */

import type { Disposable } from "@four/core";
import { Vector3 } from "@four/math";

import { noteGeometry } from "./resource-memory.js";

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
   * Optional per-vertex texture coordinates as uv pairs, index-aligned with
   * `positions` (§53, §55). Length must be `2 / 3` of `positions.length` — two
   * floats per vertex — and every value must be finite (§85). `v = 0` is the
   * bottom edge; see the module header.
   */
  uvs?: Float32Array;
  /**
   * Optional per-vertex straight RGBA colors, index-aligned with `positions`
   * (§53, §60a). Length must be `4 / 3` of `positions.length` — four floats
   * per vertex — and every value must be finite (§85). Consumed only by a
   * material that opts in (`UnlitMaterial.vertexColors`).
   */
  colors?: Float32Array;
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
 * Runs the §85 checks for one optional vertex attribute: index-aligned with
 * `positions` at `components` floats per vertex, every value finite.
 *
 * One helper for `normals`, `uvs`, and `colors` because the rule is one rule —
 * the only difference between them is the component count and the § reference
 * the message cites, and three copies of the same loop is how the three drift
 * apart.
 */
function validateAttribute(
  name: string,
  values: Float32Array | undefined,
  components: number,
  vertexCount: number,
  reference: string,
): void {
  if (values === undefined) {
    return;
  }
  const expected = vertexCount * components;
  if (values.length !== expected) {
    throw new RangeError(
      `Geometry ${name} must be index-aligned with positions — ` +
        `${String(components)} floats per vertex — so their length must be ` +
        `${String(expected)}; got ${String(values.length)} (${reference}).`,
    );
  }
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) {
      throw new RangeError(
        `Geometry ${name.slice(0, -1)} ${String(i)} is ${String(values[i])}; ` +
          `${name} must be finite (§85: NaN and infinite values).`,
      );
    }
  }
}

/**
 * Runs the §85 checks for one (positions, normals, uvs, colors, indices, mode)
 * tuple. Throws on the first violation; returns nothing.
 */
function validate(
  positions: Float32Array,
  normals: Float32Array | undefined,
  uvs: Float32Array | undefined,
  colors: Float32Array | undefined,
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

  const vertexCount = positions.length / 3;
  validateAttribute("normals", normals, 3, vertexCount, "§53, §68");
  validateAttribute("uvs", uvs, 2, vertexCount, "§53, §55");
  validateAttribute("colors", colors, 4, vertexCount, "§53, §60a");

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

  #uvs: Float32Array | undefined;

  #colors: Float32Array | undefined;

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
    validate(
      options.positions,
      options.normals,
      options.uvs,
      options.colors,
      options.indices,
      mode,
    );
    this.#positions = options.positions;
    this.#normals = options.normals;
    this.#uvs = options.uvs;
    this.#colors = options.colors;
    this.#indices = options.indices;
    this.#mode = mode;
    noteGeometry(1, this.byteLength);
  }

  /**
   * Announces a mutation that may have changed how many bytes this geometry
   * holds: reconciles the §83 totals against `bytesBefore` and bumps the
   * version. The one place attribute replacement and disposal share, so the two
   * cannot drift apart.
   */
  #mutated(bytesBefore: number): void {
    noteGeometry(0, this.byteLength - bytesBefore);
    this.markDirty();
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
    validate(
      value,
      this.#normals,
      this.#uvs,
      this.#colors,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#positions = value;
    this.#mutated(before);
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
    validate(
      this.#positions,
      value,
      this.#uvs,
      this.#colors,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#normals = value;
    this.#mutated(before);
  }

  /**
   * Optional per-vertex texture coordinates as uv pairs, or `undefined` for a
   * geometry that carries none (§53, §55). Held by reference, like
   * {@link BufferGeometry.positions}, and subject to the same rules: assigning
   * validates (two floats per vertex, index-aligned, finite, §85) and bumps the
   * version; **in-place edits are invisible and need
   * {@link BufferGeometry.markDirty}**. Assigning `undefined` drops the
   * attribute — a textured draw of a uv-less geometry then samples the texel at
   * `(0, 0)` for every fragment, because GL's constant attribute default is
   * `(0, 0, 0, 1)`.
   *
   * Replacing `positions` with an array of a different vertex count while uvs
   * are present therefore throws: drop or replace the uvs first, exactly as for
   * {@link BufferGeometry.normals}.
   */
  get uvs(): Float32Array | undefined {
    return this.#uvs;
  }

  set uvs(value: Float32Array | undefined) {
    validate(
      this.#positions,
      this.#normals,
      value,
      this.#colors,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#uvs = value;
    this.#mutated(before);
  }

  /**
   * Optional per-vertex straight RGBA colors, or `undefined` for a geometry
   * that carries none (§53, §60a). Held by reference, like
   * {@link BufferGeometry.positions}, and subject to the same rules: assigning
   * validates (four floats per vertex, index-aligned, finite, §85) and bumps
   * the version; **in-place edits are invisible and need
   * {@link BufferGeometry.markDirty}** — which is the fast path a debug-draw
   * overlay rewriting its segment colors every frame takes. Assigning
   * `undefined` drops the attribute; a `vertexColors` material drawing a
   * color-less geometry then multiplies by GL's constant default
   * `(0, 0, 0, 1)`, i.e. renders black.
   *
   * Replacing `positions` with an array of a different vertex count while
   * colors are present therefore throws: drop or replace the colors first.
   */
  get colors(): Float32Array | undefined {
    return this.#colors;
  }

  set colors(value: Float32Array | undefined) {
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      value,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#colors = value;
    this.#mutated(before);
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
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      this.#colors,
      value,
      this.#mode,
    );
    const before = this.byteLength;
    this.#indices = value;
    this.#mutated(before);
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
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      this.#colors,
      this.#indices,
      value,
    );
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
   * Bytes this geometry holds (§83, §84's `bufferMemory`) — the sum of the
   * `byteLength`s of `positions` and whichever of `normals`, `uvs`, `colors`,
   * and `indices` are present, and therefore exactly what a backend uploads
   * for it.
   *
   * ```ts
   * // 3 vertices × 3 floats × 4 bytes
   * new BufferGeometry({ positions: new Float32Array(9) }).byteLength; // 36
   * ```
   *
   * **`0` once disposed**, because a disposed geometry holds nothing — that is
   * the same fact `positions` reports by becoming empty, stated as a single
   * rule so that a write into a disposed geometry (already a §83 "disposed
   * resource still in use" mistake) cannot resurrect its bytes in the
   * process-wide totals.
   *
   * Derived on every read rather than cached: it is five property reads and an
   * addition, nothing on the draw path calls it, and a cached copy would be one
   * more thing an in-place edit could invalidate.
   */
  get byteLength(): number {
    if (this.#disposed) {
      return 0;
    }
    return (
      this.#positions.byteLength +
      (this.#normals?.byteLength ?? 0) +
      (this.#uvs?.byteLength ?? 0) +
      (this.#colors?.byteLength ?? 0) +
      (this.#indices?.byteLength ?? 0)
    );
  }

  /**
   * Announces a mutation the geometry could not see — an in-place write into
   * `positions`, `normals`, `uvs`, `colors`, or `indices`. Bumps
   * {@link BufferGeometry.version} by one, which invalidates the cached bounds
   * and every backend buffer keyed on the version.
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
   * The typed arrays are dropped — `positions` becomes empty, `normals`,
   * `uvs`, `colors`, and
   * `indices` become `undefined` — so a large mesh's memory is reclaimable the moment
   * its owner is done with it, and the version is bumped so any backend cache
   * keyed on it re-reads (and finds nothing to draw). Nothing throws
   * afterwards: {@link BufferGeometry.disposed} is the flag renderers and the
   * §83 "disposed resource still in use" diagnostic check.
   *
   * Disposing does **not** notify the renderables pointing at this geometry;
   * ownership is explicit and upwards (§83), so whoever created the geometry
   * decides when nothing needs it any more.
   *
   * It **does** remove this geometry and its bytes from the process-wide §83
   * totals (`geometryMemoryBytes`, `liveGeometryCount`), exactly once: the
   * idempotence guard above is what makes a double `dispose()` subtract once
   * rather than twice.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    const before = this.byteLength;
    this.#disposed = true;
    this.#positions = EMPTY_POSITIONS;
    this.#normals = undefined;
    this.#uvs = undefined;
    this.#colors = undefined;
    this.#indices = undefined;
    noteGeometry(-1, -before);
    this.markDirty();
  }
}
