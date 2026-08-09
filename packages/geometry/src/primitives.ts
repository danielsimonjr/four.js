/**
 * Primitive geometry builders (§53) — the box, the plane, and the 2D circle.
 *
 * §53 lists eleven required 3D primitives (plane, box, sphere, cylinder, cone,
 * capsule, torus, lathe, extrusion, tube, height field) and §50 lists the 2D
 * shape family. This module builds **box**, **plane**, and a 2D **circle** —
 * the smallest set that exercises both dimensionalities end to end: a solid
 * with six differently-oriented faces, a flat quad, and a fan-shaped 2D shape.
 * The other nine 3D primitives live in `primitives-3d.ts`, which closed R-20 on
 * 2026-08-07 and where the note this header used to carry ("the rest are later
 * packets") was finally spent.
 *
 * ## Conventions (§7a)
 *
 * - The world is right-handed with **+Y up in both 2D and 3D**, so a 2D shape
 *   is simply a shape in the XY plane of the same space (§7) — `planeGeometry`
 *   and `circleGeometry2D` both lie in XY, facing +Z.
 * - **Front faces wind counter-clockwise** when seen from the outside (a box)
 *   or from +Z (the flat shapes). Every triangle emitted below is checked
 *   against that rule in `tests/geometry.test.ts` by taking the sign of its
 *   normal, not by re-reading the vertex list.
 * - Every builder centres its shape on the node origin, so a node's transform
 *   positions the shape's centre. Callers that want another anchor use
 *   `Transform.pivot` (§7), which exists precisely so geometry does not have to
 *   carry an origin convention.
 *
 * ## Attributes
 *
 * The **3D** builders emit positions *and* per-vertex normals — the §68
 * lighting packet (2026-08-04) is the packet the original position-only note
 * here deferred to, and it made the deferred call: a box with per-face normals
 * carries 24 vertices rather than 8, because a corner shared by three faces
 * has three different normals and an indexed vertex can hold only one. The
 * **2D** builder (`circleGeometry2D`) stays position-only for normals: 2D
 * shapes are unlit in the §120 tier, and a normal on a flat shape that never
 * lights would be dead weight in every upload.
 *
 * **Every** builder here emits `uvs` as of R-19 (2026-08-07) — §53's `uv`
 * attribute, two floats per vertex, `v = 0` at the bottom edge (§7a). Emitting
 * them costs one Float32Array per geometry and changes nothing a scene draws:
 * the unlit and lit pipelines sample a texture only when their material carries
 * a `map`, so an untextured box uploads a uv stream that no fragment reads.
 * The layouts are stated per builder below, because a uv layout is a public
 * contract the moment anyone paints a texture against it.
 *
 * Tangents, a secondary uv set, joints/weights, and instance transforms remain
 * with the packets that need them. `colors` is a `BufferGeometry` attribute
 * that no *primitive* emits: a solid-colour box wants a material colour, not
 * 24 copies of one RGBA (§113's debug draw is the caller that builds colour
 * streams, and it builds them from segments, not from primitives).
 *
 * Options are validated the way `BufferGeometry` validates its buffers: extents
 * must be finite and positive, segment counts finite integers ≥ 3, and a
 * violation throws `RangeError` (§85; see `buffer-geometry.ts` for why it is
 * not a `FourError`).
 */

import { BufferGeometry } from "./buffer-geometry.js";
import { createIndices, requirePositive } from "./primitive-support.js";
import { triangulatePolygon, type Point2D } from "./tessellation.js";

/** Options of {@link boxGeometry}. All extents default to 1. */
export interface BoxGeometryOptions {
  /** Size along X. */
  width?: number;
  /** Size along Y. */
  height?: number;
  /** Size along Z. */
  depth?: number;
}

/** Options of {@link planeGeometry}. Both extents default to 1. */
export interface PlaneGeometryOptions {
  /** Size along X. */
  width?: number;
  /** Size along Y. */
  height?: number;
}

/** Options of {@link circleGeometry2D}. */
export interface CircleGeometry2DOptions {
  /** Distance from the centre to the rim; defaults to 1. */
  radius?: number;
  /**
   * Number of rim vertices, i.e. of triangles in the fan. Defaults to 32,
   * which keeps a unit circle's silhouette error under about half a percent of
   * its radius — smooth enough for MVP-tier 2D shapes at any reasonable
   * on-screen size. Must be a finite integer ≥ 3.
   */
  segments?: number;
}

/** Options of {@link polygonGeometry2D}. */
export interface PolygonGeometry2DOptions {
  /**
   * The closed outer ring, in the XY plane, in either winding. At least three
   * points; the last is **not** repeated.
   */
  outline: readonly Point2D[];
  /**
   * Closed inner rings cut out of {@link PolygonGeometry2DOptions.outline},
   * each in either winding, each strictly inside it and disjoint from the
   * others. Omitted means a solid shape.
   */
  holes?: readonly (readonly Point2D[])[];
}

/**
 * An axis-aligned box centred on the origin, as 24 vertices — four per face,
 * each carrying that face's outward normal — and 12 counter-clockwise
 * triangles (§53 "box", §68).
 *
 * ```ts
 * const geometry = boxGeometry({ width: 2, height: 1, depth: 1 });
 * geometry.vertexCount; // 24 — 4 per face; corners split for per-face normals
 * geometry.drawCount;   // 36 indices
 * ```
 *
 * Corners sit at `(±width/2, ±height/2, ±depth/2)`, so the box spans exactly
 * the requested extents and its bounds are `[-half, +half]` per axis. Until
 * the §68 lighting packet (2026-08-04) the builder shared 8 corner vertices;
 * a corner belongs to three faces with three different normals, so a lit box
 * needs the split — exactly the trade the original attribute note predicted.
 * The triangles drawn are the same 12, so unlit rendering is unchanged.
 *
 * ## Uv layout (§53, R-19)
 *
 * **Per face, not an atlas**: each of the six faces maps the *whole* `[0, 1]²`
 * texture, with `(0, 0)` at the face's first listed corner and `v` growing
 * towards the face's "up". A single texture therefore appears once on every
 * side — the behaviour a crate, a die, or a debug grid wants — instead of six
 * strips of one image. An atlased box, where each face takes a sub-rectangle,
 * is what §55's `frame` regions are for and needs a layout convention this
 * builder must not invent (decision, R-19).
 */
export function boxGeometry(options: BoxGeometryOptions = {}): BufferGeometry {
  const hx = requirePositive("width", options.width ?? 1) / 2;
  const hy = requirePositive("height", options.height ?? 1) / 2;
  const hz = requirePositive("depth", options.depth ?? 1) / 2;

  // Face order +Z, -Z, +X, -X, +Y, -Y; each face's four corners are listed
  // counter-clockwise as seen from outside the box (§7a) — verified in the
  // tests by the sign of every face normal. One vertex per line, index in the
  // comment — the layout is the documentation, hence `prettier-ignore`.
  // prettier-ignore
  const positions = new Float32Array([
    -hx, -hy,  hz, //  0  +Z (front)
     hx, -hy,  hz, //  1
     hx,  hy,  hz, //  2
    -hx,  hy,  hz, //  3
     hx, -hy, -hz, //  4  -Z (back)
    -hx, -hy, -hz, //  5
    -hx,  hy, -hz, //  6
     hx,  hy, -hz, //  7
     hx, -hy,  hz, //  8  +X (right)
     hx, -hy, -hz, //  9
     hx,  hy, -hz, // 10
     hx,  hy,  hz, // 11
    -hx, -hy, -hz, // 12  -X (left)
    -hx, -hy,  hz, // 13
    -hx,  hy,  hz, // 14
    -hx,  hy, -hz, // 15
    -hx,  hy,  hz, // 16  +Y (top)
     hx,  hy,  hz, // 17
     hx,  hy, -hz, // 18
    -hx,  hy, -hz, // 19
    -hx, -hy, -hz, // 20  -Y (bottom)
     hx, -hy, -hz, // 21
     hx, -hy,  hz, // 22
    -hx, -hy,  hz, // 23
  ]);

  // The face's outward unit normal, repeated for its four vertices (§68).
  // prettier-ignore
  const normals = new Float32Array([
     0,  0,  1,   0,  0,  1,   0,  0,  1,   0,  0,  1, // +Z
     0,  0, -1,   0,  0, -1,   0,  0, -1,   0,  0, -1, // -Z
     1,  0,  0,   1,  0,  0,   1,  0,  0,   1,  0,  0, // +X
    -1,  0,  0,  -1,  0,  0,  -1,  0,  0,  -1,  0,  0, // -X
     0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0, // +Y
     0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0, // -Y
  ]);

  // Each face's four corners are listed bottom-left, bottom-right, top-right,
  // top-left as seen from outside, so one uv quad serves all six (§53, R-19).
  // prettier-ignore
  const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1, // +Z
    0, 0,  1, 0,  1, 1,  0, 1, // -Z
    0, 0,  1, 0,  1, 1,  0, 1, // +X
    0, 0,  1, 0,  1, 1,  0, 1, // -X
    0, 0,  1, 0,  1, 1,  0, 1, // +Y
    0, 0,  1, 0,  1, 1,  0, 1, // -Y
  ]);

  // Two triangles per face over its four corners: (0, 1, 2) and (0, 2, 3)
  // within the face, offset by the face's base vertex.
  const indices = new Uint16Array(36);
  for (let face = 0; face < 6; face += 1) {
    const base = face * 4;
    const offset = face * 6;
    indices[offset] = base;
    indices[offset + 1] = base + 1;
    indices[offset + 2] = base + 2;
    indices[offset + 3] = base;
    indices[offset + 4] = base + 2;
    indices[offset + 5] = base + 3;
  }

  return new BufferGeometry({
    positions,
    normals,
    uvs,
    indices,
    mode: "triangles",
  });
}

/**
 * A rectangle in the **XY plane** centred on the origin, facing +Z: 4 vertices,
 * 2 counter-clockwise triangles (§53 "plane").
 *
 * XY rather than XZ is the whole point of §7a's "Y-up in both 2D and 3D": the
 * same quad is a 2D sprite background, a world-space UI panel, and the ground
 * of a side-on physics scene, and it never needs re-orienting between them.
 * A floor in a 3D scene is this plane rotated -π/2 about X by its node's
 * transform.
 *
 * Every vertex carries the `+Z` normal the plane faces (§68, 2026-08-04) —
 * the node's transform reorients it with the plane, so the rotated floor
 * above lights from `+Y` as expected. The back side is a legitimate view
 * (back-face culling is off, see `@four/render-webgl`) but Lambert-dark:
 * a face lit from behind receives its ambient term only.
 *
 * Uv (§53, R-19) is the quad's own unit square seen from +Z: `(0, 0)` at the
 * bottom-left corner, `u` growing with `+x`, `v` growing with `+y`. That is the
 * same mapping the sprite pipeline derives from a quad's local rectangle
 * (`@four/render-webgl`), so a textured plane and a `Sprite` of the same size
 * show a texture identically — which is what makes the derived-uv workaround
 * safe to retire when its packet gets to it.
 */
export function planeGeometry(
  options: PlaneGeometryOptions = {},
): BufferGeometry {
  const hw = requirePositive("width", options.width ?? 1) / 2;
  const hh = requirePositive("height", options.height ?? 1) / 2;

  // prettier-ignore
  const positions = new Float32Array([
    -hw, -hh, 0, // 0 bottom-left
     hw, -hh, 0, // 1 bottom-right
     hw,  hh, 0, // 2 top-right
    -hw,  hh, 0, // 3 top-left
  ]);
  // prettier-ignore
  const normals = new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]);
  // prettier-ignore
  const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  return new BufferGeometry({
    positions,
    normals,
    uvs,
    indices,
    mode: "triangles",
  });
}

/**
 * A filled circle in the **XY plane** centred on the origin, facing +Z (§50's
 * `Circle`, built as §53 buffer geometry).
 *
 * The shape is a triangle fan — centre vertex plus `segments` rim vertices —
 * but it is emitted as **indexed triangles**, not as a `TRIANGLE_FAN` draw:
 * fans cannot be batched or instanced with other geometry (§65), are absent
 * from several modern APIs, and would force the draw path to carry a second
 * primitive topology for one shape. The vertex saving is kept (`segments + 1`
 * vertices, not `3 * segments`); only the assembly is spelled out.
 *
 * Rim vertex `i` sits at angle `2πi / segments`, so vertices advance
 * counter-clockwise from +X and every triangle `(centre, i, i + 1)` is wound
 * counter-clockwise seen from +Z (§7a).
 *
 * Uv (§53, R-19) is the circle's **bounding square**: `(0.5, 0.5)` at the
 * centre and `(0.5 + 0.5·cos θ, 0.5 + 0.5·sin θ)` on the rim, so a texture is
 * mapped as if painted on the square the disc is inscribed in and the disc cuts
 * out its middle. That is the mapping a radial gauge, a clock face, or a
 * circular sprite wants; the alternative — polar uv, `u = θ/2π`, `v = r/radius`
 * — belongs to whichever packet needs a swirl and can add it as an option.
 */
export function circleGeometry2D(
  options: CircleGeometry2DOptions = {},
): BufferGeometry {
  const radius = requirePositive("radius", options.radius ?? 1);
  const segments = options.segments ?? 32;
  if (!Number.isInteger(segments) || segments < 3) {
    throw new RangeError(
      `segments must be a finite integer of at least 3 (fewer cannot enclose ` +
        `an area); got ${String(segments)} (§85).`,
    );
  }

  const vertexCount = segments + 1;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  // positions[0..2] is the centre, already zero; its uv is the square's middle.
  uvs[0] = 0.5;
  uvs[1] = 0.5;
  for (let i = 0; i < segments; i += 1) {
    const angle = (2 * Math.PI * i) / segments;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const offset = (i + 1) * 3;
    positions[offset] = radius * cos;
    positions[offset + 1] = radius * sin;
    positions[offset + 2] = 0;
    uvs[(i + 1) * 2] = 0.5 + 0.5 * cos;
    uvs[(i + 1) * 2 + 1] = 0.5 + 0.5 * sin;
  }

  const indices = createIndices(segments * 3, vertexCount);
  for (let i = 0; i < segments; i += 1) {
    const offset = i * 3;
    indices[offset] = 0;
    indices[offset + 1] = i + 1;
    // Wraps the last triangle back onto the first rim vertex.
    indices[offset + 2] = ((i + 1) % segments) + 1;
  }

  return new BufferGeometry({ positions, uvs, indices, mode: "triangles" });
}

/**
 * An **arbitrary polygon** filled in the XY plane, facing +Z — §50's "arbitrary
 * polygon" row, built on §52's tessellator.
 *
 * ```ts
 * const ring = polygonGeometry2D({
 *   outline: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }],
 *   holes: [[{ x: -0.4, y: -0.4 }, { x: -0.4, y: 0.4 }, { x: 0.4, y: 0.4 }, { x: 0.4, y: -0.4 }]],
 * });
 * ```
 *
 * Concave, holed, either winding: the shape is whatever `triangulatePolygon`
 * accepts, and everything it refuses (§85 — self-intersections, zero area, a
 * hole outside its outline) this builder refuses with the same error, because
 * it *is* the same error. See `tessellation.ts` for the full list and for why a
 * self-intersecting outline is refused rather than approximated.
 *
 * ## Vertices are the caller's points, in the caller's order
 *
 * Vertex `i` is outline point `i`, then the first hole's points, then the
 * second's — the concatenation §52's tessellator indexes. Nothing is inserted,
 * merged, or moved, so a caller animating the outline can rewrite `positions`
 * in place and keep the index buffer (§52 "index-buffer reuse"). A vertex the
 * tessellator found redundant — one collinear with its neighbours — is still
 * *there*; it simply appears in no triangle.
 *
 * ## Attributes
 *
 * Positions (`z = 0`) and uvs, no normals — the same choice
 * {@link circleGeometry2D} makes and for the same reason: 2D shapes are unlit
 * in the §120 tier, and a `(0, 0, 1)` repeated per vertex would be dead weight
 * in every upload. Uv is the outline's **bounding box** normalized to
 * `[0, 1]²`, matching `extrudeGeometry`'s caps, so the same texture lines up on
 * a filled shape and on the front of its extrusion.
 */
export function polygonGeometry2D(
  options: PolygonGeometry2DOptions,
): BufferGeometry {
  const { outline, holes } = options;
  const indices = triangulatePolygon(outline, holes);

  const rings: readonly (readonly Point2D[])[] = [outline, ...(holes ?? [])];
  let vertexCount = 0;
  for (const ring of rings) {
    vertexCount += ring.length;
  }

  // The uv box is the *outline's*, not the union's: a hole lies inside its
  // outline (§85 refuses anything else), so the two boxes agree, and naming
  // the outline says which ring the mapping follows if that ever stops holding.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of outline) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  // Both spans are strictly positive: a zero span in either axis puts every
  // point on one line, which encloses no area, which the tessellator refused.
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let vertex = 0;
  for (const ring of rings) {
    for (const point of ring) {
      positions[vertex * 3] = point.x;
      positions[vertex * 3 + 1] = point.y;
      positions[vertex * 3 + 2] = 0;
      uvs[vertex * 2] = (point.x - minX) / spanX;
      uvs[vertex * 2 + 1] = (point.y - minY) / spanY;
      vertex += 1;
    }
  }

  return new BufferGeometry({ positions, uvs, indices, mode: "triangles" });
}
