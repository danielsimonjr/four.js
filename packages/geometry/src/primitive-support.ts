/**
 * Shared building blocks of the §53 primitive builders — index allocation,
 * option validation, and the two closed-surface helpers every revolved shape
 * needs.
 *
 * Extracted when the nine missing 3D primitives landed (R-20): `primitives.ts`
 * and `primitives-3d.ts` validate their options the same way, allocate the same
 * narrowest index type, and — for the sphere, the cylinder, the cone, the
 * capsule, the torus, the lathe, and the tube — stitch the same
 * `rings × segments` grid into the same counter-clockwise triangles. Written
 * once here, the winding rule has one place to be reviewed and one place to be
 * wrong.
 *
 * Nothing in this module is part of the package's public surface: `index.ts`
 * exports the *builders*, not their scaffolding, because every helper below is
 * an implementation detail whose signature exists to serve those builders and
 * would otherwise become a compatibility promise.
 */

/**
 * Highest vertex count addressable by a `Uint16Array` index — 65 536 vertices
 * means a maximum index of 65 535.
 */
const UINT16_VERTEX_LIMIT = 65536;

/** The two index element types WebGL 2 accepts. */
export type IndexArray = Uint16Array | Uint32Array;

/**
 * Allocates the narrowest index array that can address `vertexCount` vertices.
 * WebGL 2 accepts both element types, and the 16-bit form halves the upload for
 * every primitive this package builds.
 */
export function createIndices(
  indexCount: number,
  vertexCount: number,
): IndexArray {
  return vertexCount <= UINT16_VERTEX_LIMIT
    ? new Uint16Array(indexCount)
    : new Uint32Array(indexCount);
}

/** Validates one extent (width/height/depth/radius/length). */
export function requirePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a finite positive number; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/**
 * Validates one extent that is allowed to be zero — a cone's tip radius, a
 * capsule's cylindrical middle. Zero is a *degenerate but meaningful* value
 * there (a closed cone, a sphere), which is exactly why it needs its own
 * check rather than a `requirePositive` call with an apology.
 */
export function requireNonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${name} must be a finite non-negative number; got ${String(value)} ` +
        "(§85).",
    );
  }
  return value;
}

/**
 * Validates a segment count: a finite integer of at least `minimum` (3 for a
 * ring that has to enclose an area, 1 for a subdivision count along an axis).
 */
export function requireSegments(
  name: string,
  value: number,
  minimum: number,
): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `${name} must be a finite integer of at least ${String(minimum)}; got ` +
        `${String(value)} (§85).`,
    );
  }
  return value;
}

/**
 * Triangulates a `(rings + 1) × (columns + 1)` vertex grid — the shape every
 * revolved or swept surface in this package produces — into
 * `rings × columns × 2` counter-clockwise triangles.
 *
 * The grid is stored row-major, and for a *closed* surface the **seam is
 * duplicated**: column `columns` repeats column `0` at the same position but
 * with `u = 1` rather than `u = 0`, which is what stops the last quad of a
 * sphere from sampling the whole texture backwards. Vertex `(ring, column)`
 * therefore lives at index `ring * stride + column`, with `stride` defaulting
 * to `columns + 1` — an open grid (a height field) passes its own `columns`
 * instead, having no seam to duplicate.
 *
 * Winding: the convention every caller follows is **rings advance along the
 * surface's sweep axis, columns advance with increasing θ in
 * `(ρ cos θ, y, ρ sin θ)`**. Under it the two triangles `(a, d, b)` and
 * `(b, d, c)` — where `a` is the current corner, `b` its column-next
 * neighbour, `d` the ring-next of `a`, and `c` the ring-next of `b` — are
 * counter-clockwise seen from outside (§7a). The order is not the obvious
 * `(a, b, d)`: in a right-handed Y-up frame, θ advancing in `+z = sin θ` runs
 * *clockwise* seen from `+y`, so the naive order winds every quad inwards.
 * Every builder that uses this helper is checked against the rule by the
 * winding tests, which recompute each face normal from positions and compare it
 * with the authored vertex normals.
 *
 * Degenerate rows (a sphere's poles, a cone's tip) are **not** skipped: the two
 * triangles of such a quad collapse to zero area and rasterize to nothing,
 * while keeping the grid — and therefore the uv layout — regular. Skipping them
 * would save one degenerate triangle per column and cost the uniform indexing
 * every uv assertion depends on.
 */
export function gridIndices(
  rings: number,
  columns: number,
  indices: IndexArray,
  offset = 0,
  vertexOffset = 0,
  stride = columns + 1,
): number {
  let next = offset;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = vertexOffset + ring * stride + column;
      const b = a + 1;
      const d = a + stride;
      const c = d + 1;
      indices[next] = a;
      indices[next + 1] = d;
      indices[next + 2] = b;
      indices[next + 3] = b;
      indices[next + 4] = d;
      indices[next + 5] = c;
      next += 6;
    }
  }
  return next;
}

/**
 * Writes a flat, centred cap disc — the end of a cylinder, cone, or tube — as
 * `segments + 1` vertices (a centre plus a rim) and `segments` triangles.
 *
 * `sign` is `+1` for a cap whose outward normal is `+Y` and `-1` for `-Y`, and
 * it flips both the normal and the winding, so both caps are counter-clockwise
 * seen from outside (§7a). Uv is the disc's own unit square, `(0.5, 0.5)` at
 * the centre — the mapping §53 implies for a cap and the one an author expects
 * when they put a circular decal on the end of a cylinder.
 *
 * Returns the number of vertices written, so a builder can advance its cursor
 * without recomputing the arithmetic.
 */
export function writeCap(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: IndexArray,
  vertexOffset: number,
  indexOffset: number,
  radius: number,
  y: number,
  sign: number,
  segments: number,
): number {
  let v = vertexOffset;
  positions[v * 3] = 0;
  positions[v * 3 + 1] = y;
  positions[v * 3 + 2] = 0;
  normals[v * 3] = 0;
  normals[v * 3 + 1] = sign;
  normals[v * 3 + 2] = 0;
  uvs[v * 2] = 0.5;
  uvs[v * 2 + 1] = 0.5;
  const centre = v;
  v += 1;

  for (let i = 0; i < segments; i += 1) {
    const angle = (2 * Math.PI * i) / segments;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    positions[v * 3] = radius * cos;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = radius * sin;
    normals[v * 3] = 0;
    normals[v * 3 + 1] = sign;
    normals[v * 3 + 2] = 0;
    uvs[v * 2] = 0.5 + 0.5 * cos;
    uvs[v * 2 + 1] = 0.5 + 0.5 * sin;
    v += 1;
  }

  let next = indexOffset;
  for (let i = 0; i < segments; i += 1) {
    const first = centre + 1 + i;
    const second = centre + 1 + ((i + 1) % segments);
    indices[next] = centre;
    // A +Y cap seen from above has its rim advancing clockwise in the XZ plane
    // (z = sin grows towards the viewer's *near* side), so the +Y winding is
    // (centre, second, first) and the -Y winding is its mirror.
    indices[next + 1] = sign > 0 ? second : first;
    indices[next + 2] = sign > 0 ? first : second;
    next += 3;
  }

  return v - vertexOffset;
}
