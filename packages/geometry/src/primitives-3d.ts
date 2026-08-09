/**
 * The nine 3D primitives §53 requires beyond the box and the plane — sphere,
 * cylinder, cone, capsule, torus, lathe, extrusion, tube, and height field
 * (R-20, 2026-08-07).
 *
 * §53 names eleven 3D primitives. `primitives.ts` shipped two of them with the
 * §120 MVP renderer; this module is the other nine, and it closes the gap the
 * §53 note in that file's header had been carrying since Phase 3: `@four/physics`
 * ships sphere, capsule, cylinder, and height-field *colliders*, so every
 * physics scene had to draw a box where a round body was, and §119's motor
 * model — cylinders and tori — was unbuildable.
 *
 * ## Conventions, identical to `primitives.ts` (§7a, §7b)
 *
 * - Right-handed, **Y-up**. Every surface of revolution here revolves about the
 *   **+Y axis** and is centred on the node origin, so a node's transform
 *   positions the shape's centre; another anchor is `Transform.pivot`'s job.
 * - **Front faces wind counter-clockwise seen from outside.** No builder below
 *   states its winding by listing vertices: the shared grid stitcher in
 *   `primitive-support.ts` emits every quad, and the winding tests recompute
 *   each face's normal from its positions and check it agrees with the authored
 *   vertex normals. A builder that got the winding wrong would fail there
 *   whatever its comments claimed.
 * - **Angles are radians**; segment counts are integers.
 *
 * ## Attributes (§53)
 *
 * Every builder emits `positions`, `normals`, and `uvs`. Normals are analytic —
 * derived from the surface's own parameterization, not from averaged face
 * normals — because for all nine the analytic form is both exact and cheaper,
 * and because an averaged normal quietly rounds a cone's tip and a capsule's
 * seam. `colors`, tangents, and joints/weights are not emitted: they are
 * per-instance or per-authoring data, not properties of a primitive shape.
 *
 * The uv convention throughout is **`u` around, `v` along**: `u` advances with
 * the revolution or sweep angle and wraps at the duplicated seam column, `v`
 * advances along the shape's axis with `v = 0` at the `-Y` (or path-start) end.
 * That matches §7a's Y-up and the bottom-row-first texel order
 * `@four/render`'s `TextureSource` documents, so a texture painted for a
 * cylinder is not upside down on a capsule.
 *
 * ## Validation (§85)
 *
 * Extents must be finite and positive, segment counts finite integers at or
 * above the minimum that can make a surface, arrays the length they claim.
 * Violations throw `RangeError` — see `buffer-geometry.ts` for why these are not
 * `FourError`s.
 */

import { BufferGeometry } from "./buffer-geometry.js";
import {
  createIndices,
  gridIndices,
  requireNonNegative,
  requirePositive,
  requireSegments,
  writeCap,
  type IndexArray,
} from "./primitive-support.js";
import { triangulatePolygon, type Point2D } from "./tessellation.js";

/** A point in 3D space, as {@link tubeGeometry} takes its path. */
export interface Point3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Options of {@link sphereGeometry}. */
export interface SphereGeometryOptions {
  /** Distance from the centre to the surface; defaults to 1. */
  radius?: number;
  /**
   * Meridians — segments around the +Y axis. Defaults to 32. Must be a finite
   * integer ≥ 3, since fewer cannot enclose a volume.
   */
  widthSegments?: number;
  /**
   * Parallels — segments from the south pole to the north pole. Defaults to 16.
   * Must be a finite integer ≥ 2, since one ring would make a bicone.
   */
  heightSegments?: number;
}

/** Options shared by {@link cylinderGeometry} and {@link coneGeometry}. */
export interface TaperedGeometryOptions {
  /** Radius of the `-Y` end; defaults to 1. */
  radius?: number;
  /** Extent along Y; defaults to 1. The shape spans `[-height/2, height/2]`. */
  height?: number;
  /** Segments around the axis; defaults to 32. A finite integer ≥ 3. */
  radialSegments?: number;
  /** Subdivisions along the axis; defaults to 1. A finite integer ≥ 1. */
  heightSegments?: number;
  /** Whether to close the flat end(s) with a cap disc; defaults to `true`. */
  capped?: boolean;
}

/** Options of {@link capsuleGeometry}. */
export interface CapsuleGeometryOptions {
  /** Radius of the cylindrical middle and of both hemispherical caps; 0.5. */
  radius?: number;
  /**
   * Length of the **cylindrical section only**, so the total extent along Y is
   * `height + 2 · radius`. Defaults to 1.
   *
   * That is the same measurement `@four/physics`' capsule collider takes (§24),
   * which is the whole point: a capsule body and the capsule drawn for it are
   * built from the same two numbers and cannot disagree.
   */
  height?: number;
  /** Segments around the axis; defaults to 32. A finite integer ≥ 3. */
  radialSegments?: number;
  /** Rings per hemispherical cap; defaults to 8. A finite integer ≥ 1. */
  capSegments?: number;
}

/** Options of {@link torusGeometry}. */
export interface TorusGeometryOptions {
  /** Distance from the centre to the middle of the tube; defaults to 1. */
  radius?: number;
  /** Radius of the tube itself; defaults to 0.4. */
  tubeRadius?: number;
  /** Segments around the main ring; defaults to 32. A finite integer ≥ 3. */
  tubularSegments?: number;
  /** Segments around the tube's cross-section; defaults to 16, integer ≥ 3. */
  radialSegments?: number;
}

/** Options of {@link latheGeometry}. */
export interface LatheGeometryOptions {
  /**
   * The profile to revolve, in the XY half-plane: `x` is a radius (≥ 0) and `y`
   * a height. At least two points, ordered from the `-Y` end to the `+Y` end.
   */
  points: readonly Point2D[];
  /** Segments around the +Y axis; defaults to 32. A finite integer ≥ 3. */
  segments?: number;
}

/** Options of {@link extrudeGeometry}. */
export interface ExtrudeGeometryOptions {
  /**
   * The closed outline to extrude, in the XY plane. At least three points, in
   * either winding — the builder normalizes to counter-clockwise. The last
   * point is **not** repeated: the outline closes from the last back to the
   * first.
   *
   * Concave outlines are fine, capped or not, as of the §52 tessellation
   * packet (2026-08-09). The outline must be **simple** — no edge crossing
   * another — while the caps are on; see {@link extrudeGeometry}.
   */
  shape: readonly Point2D[];
  /** Extent along Z; defaults to 1. The solid spans `[-depth/2, depth/2]`. */
  depth?: number;
  /** Whether to close both ends with a cap; defaults to `true`. */
  capped?: boolean;
}

/** Options of {@link tubeGeometry}. */
export interface TubeGeometryOptions {
  /** The path to sweep along, as at least two distinct 3D points. */
  path: readonly Point3D[];
  /** Radius of the swept circle; defaults to 0.1. */
  radius?: number;
  /** Segments around the path; defaults to 16. A finite integer ≥ 3. */
  radialSegments?: number;
}

/** Options of {@link heightFieldGeometry}. */
export interface HeightFieldGeometryOptions {
  /**
   * Row-major heights — `heights[row * columns + column]` is the Y of the
   * sample at grid position `(row, column)`, where `column` advances along +X
   * and `row` along +Z. Length must be exactly `rows * columns`, every value
   * finite (§85).
   */
  heights: ArrayLike<number>;
  /** Samples along X. A finite integer ≥ 2. */
  columns: number;
  /** Samples along Z. A finite integer ≥ 2. */
  rows: number;
  /** Total extent along X; defaults to 1. The field is centred on the origin. */
  width?: number;
  /** Total extent along Z; defaults to 1. */
  depth?: number;
}

/**
 * A UV sphere centred on the origin (§53 "sphere").
 *
 * ```ts
 * const geometry = sphereGeometry({ radius: 0.5, widthSegments: 24 });
 * geometry.vertexCount; // (widthSegments + 1) × (heightSegments + 1)
 * ```
 *
 * Latitude/longitude tessellation rather than an icosphere: it is the layout
 * whose uv is a plain rectangle, which is what makes an equirectangular texture
 * — the one people actually have for spheres — map without a seam chart.
 * The cost is the pole singularity, where a row of quads degenerates into
 * zero-area triangles; those rasterize to nothing and the surrounding normals
 * stay exact, because they are the analytic `position / radius`.
 *
 * Uv is `u = θ / 2π` (0 at +X, advancing with the winding) and `v = 0` at the
 * south pole, `1` at the north — so `v` grows with `+Y`, matching §7a.
 */
export function sphereGeometry(
  options: SphereGeometryOptions = {},
): BufferGeometry {
  const radius = requirePositive("radius", options.radius ?? 1);
  const columns = requireSegments(
    "widthSegments",
    options.widthSegments ?? 32,
    3,
  );
  const rings = requireSegments(
    "heightSegments",
    options.heightSegments ?? 16,
    2,
  );

  const stride = columns + 1;
  const vertexCount = stride * (rings + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let ring = 0; ring <= rings; ring += 1) {
    const v = ring / rings;
    const phi = Math.PI * v;
    // `-cos` so that ring 0 is the south pole: v = 0 at −Y (§7a).
    const y = -radius * Math.cos(phi);
    const rowRadius = radius * Math.sin(phi);
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const theta = 2 * Math.PI * u;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const index = ring * stride + column;
      positions[index * 3] = rowRadius * cos;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = rowRadius * sin;
      // Exact on a sphere: the outward normal *is* the normalized position.
      normals[index * 3] = Math.sin(phi) * cos;
      normals[index * 3 + 1] = -Math.cos(phi);
      normals[index * 3 + 2] = Math.sin(phi) * sin;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }

  const indices = createIndices(rings * columns * 6, vertexCount);
  gridIndices(rings, columns, indices);
  return new BufferGeometry({
    positions,
    normals,
    uvs,
    indices,
    mode: "triangles",
  });
}

/**
 * Builds the lateral surface of a body of revolution that tapers linearly from
 * `radiusBottom` at `-height/2` to `radiusTop` at `+height/2`, optionally
 * capped, and wraps it in a geometry — the shared body of
 * {@link cylinderGeometry} and {@link coneGeometry}.
 *
 * The side normal is the surface's own: in the `(r, y)` half-plane the profile
 * runs `(radiusBottom, -h/2) → (radiusTop, +h/2)`, whose outward normal is
 * `(h, radiusBottom − radiusTop)` normalized. For a cylinder that reduces to
 * the radial `(1, 0)`; for a cone it is the slope normal, which is why a cone's
 * side does not shade like a cylinder's.
 */
function taperedGeometry(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  radialSegments: number,
  heightSegments: number,
  capped: boolean,
): BufferGeometry {
  const stride = radialSegments + 1;
  const sideVertices = stride * (heightSegments + 1);
  // The `-Y` end always has a radius (both callers validate it positive); the
  // `+Y` end is a point on a cone, and a point needs no disc.
  const capCount = capped ? 1 + (radiusTop > 0 ? 1 : 0) : 0;
  const vertexCount = sideVertices + capCount * (radialSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const halfHeight = height / 2;
  const slopeLength = Math.hypot(height, radiusBottom - radiusTop);
  const normalY = (radiusBottom - radiusTop) / slopeLength;
  const normalR = height / slopeLength;

  for (let ring = 0; ring <= heightSegments; ring += 1) {
    const v = ring / heightSegments;
    const rowRadius = radiusBottom + (radiusTop - radiusBottom) * v;
    const y = -halfHeight + height * v;
    for (let column = 0; column <= radialSegments; column += 1) {
      const u = column / radialSegments;
      const theta = 2 * Math.PI * u;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const index = ring * stride + column;
      positions[index * 3] = rowRadius * cos;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = rowRadius * sin;
      normals[index * 3] = normalR * cos;
      normals[index * 3 + 1] = normalY;
      normals[index * 3 + 2] = normalR * sin;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }

  const indexCount =
    heightSegments * radialSegments * 6 + capCount * radialSegments * 3;
  const indices = createIndices(indexCount, vertexCount);
  let nextIndex = gridIndices(heightSegments, radialSegments, indices);
  let nextVertex = sideVertices;
  if (capped && radiusBottom > 0) {
    nextVertex += writeCap(
      positions,
      normals,
      uvs,
      indices,
      nextVertex,
      nextIndex,
      radiusBottom,
      -halfHeight,
      -1,
      radialSegments,
    );
    nextIndex += radialSegments * 3;
  }
  if (capped && radiusTop > 0) {
    writeCap(
      positions,
      normals,
      uvs,
      indices,
      nextVertex,
      nextIndex,
      radiusTop,
      halfHeight,
      1,
      radialSegments,
    );
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
 * A cylinder about the **+Y axis**, centred on the origin (§53 "cylinder").
 *
 * ```ts
 * const geometry = cylinderGeometry({ radius: 0.25, height: 2 });
 * ```
 *
 * The axis is +Y rather than +Z because §7a's world is Y-up in 2D and 3D alike:
 * an upright cylinder is the common case (a pillar, a shaft, a rotor), and one
 * that has to lie down is rotated by its node. `@four/physics`' cylinder
 * collider (§24) takes the same radius and height about the same axis.
 *
 * `capped: false` omits both discs and leaves an open tube — cheaper, and what
 * a scene wants when the ends are never seen or are closed by something else.
 * Uv is `u` around, `v` from `0` at `-Y` to `1` at `+Y`; each cap disc carries
 * its own unit square with `(0.5, 0.5)` at the centre.
 */
export function cylinderGeometry(
  options: TaperedGeometryOptions = {},
): BufferGeometry {
  const radius = requirePositive("radius", options.radius ?? 1);
  const height = requirePositive("height", options.height ?? 1);
  const radialSegments = requireSegments(
    "radialSegments",
    options.radialSegments ?? 32,
    3,
  );
  const heightSegments = requireSegments(
    "heightSegments",
    options.heightSegments ?? 1,
    1,
  );
  return taperedGeometry(
    radius,
    radius,
    height,
    radialSegments,
    heightSegments,
    options.capped ?? true,
  );
}

/**
 * A cone about the **+Y axis**, base at `-height/2` and apex at `+height/2`,
 * centred on the origin (§53 "cone").
 *
 * ```ts
 * const geometry = coneGeometry({ radius: 0.5, height: 1 });
 * ```
 *
 * Built as a cylinder whose top radius is zero, so the apex is a degenerate
 * ring of `radialSegments + 1` coincident vertices rather than one shared
 * vertex. That is deliberate: a single apex vertex could carry only one normal
 * and one uv, which would shade the whole cone from one direction and smear the
 * texture. The degenerate quads collapse to zero-area triangles and rasterize
 * to nothing.
 *
 * Only the base is capped (`capped: false` omits it); an apex needs no disc.
 */
export function coneGeometry(
  options: TaperedGeometryOptions = {},
): BufferGeometry {
  const radius = requirePositive("radius", options.radius ?? 1);
  const height = requirePositive("height", options.height ?? 1);
  const radialSegments = requireSegments(
    "radialSegments",
    options.radialSegments ?? 32,
    3,
  );
  const heightSegments = requireSegments(
    "heightSegments",
    options.heightSegments ?? 1,
    1,
  );
  return taperedGeometry(
    radius,
    0,
    height,
    radialSegments,
    heightSegments,
    options.capped ?? true,
  );
}

/**
 * A capsule about the **+Y axis** — a cylinder of `height` closed by two
 * hemispheres of `radius` — centred on the origin (§53 "capsule").
 *
 * ```ts
 * const geometry = capsuleGeometry({ radius: 0.3, height: 1 });
 * geometry.computeBounds();   // y spans ±(height / 2 + radius)
 * ```
 *
 * The whole surface is **one grid**, hemispheres and cylinder alike: the
 * cylindrical band is simply the pair of rings whose normals are exactly
 * radial, so there is no seam ring to weld, no duplicated vertices at the
 * tangency, and one uv chart over the lot. Normals are analytic — radial about
 * the *cap centre* on a hemisphere and about the *axis* on the cylinder — which
 * is what makes the tangent circle shade continuously.
 *
 * `height` measures the cylindrical section only, matching §24's capsule
 * collider, so the total extent along Y is `height + 2 · radius`. `v` runs `0`
 * at the bottom tip to `1` at the top tip, uniformly **in ring index** rather
 * than in arc length: the caps therefore take `capSegments / (2·capSegments+1)`
 * of the texture each, whatever the cylinder's length. A texture that must not
 * stretch at the caps is a uv-parameterization option for the packet that needs
 * one (decision, R-20).
 */
export function capsuleGeometry(
  options: CapsuleGeometryOptions = {},
): BufferGeometry {
  const radius = requirePositive("radius", options.radius ?? 0.5);
  const height = requirePositive("height", options.height ?? 1);
  const columns = requireSegments(
    "radialSegments",
    options.radialSegments ?? 32,
    3,
  );
  const capSegments = requireSegments(
    "capSegments",
    options.capSegments ?? 8,
    1,
  );

  const halfHeight = height / 2;
  const rowCount = 2 * (capSegments + 1);
  const stride = columns + 1;
  const vertexCount = rowCount * stride;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let row = 0; row < rowCount; row += 1) {
    // Rows 0…capSegments sweep the bottom hemisphere from its pole to the
    // tangency; rows capSegments+1…2·capSegments+1 sweep the top one from its
    // tangency to its pole. The two middle rows share a radius and a radial
    // normal, which *is* the cylinder.
    const bottom = row <= capSegments;
    const step = bottom ? row : row - (capSegments + 1);
    const angle = bottom
      ? -Math.PI / 2 + (Math.PI / 2) * (step / capSegments)
      : (Math.PI / 2) * (step / capSegments);
    const rowRadius = radius * Math.cos(angle);
    const y = (bottom ? -halfHeight : halfHeight) + radius * Math.sin(angle);
    const normalY = Math.sin(angle);
    const normalR = Math.cos(angle);
    const v = row / (rowCount - 1);
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const theta = 2 * Math.PI * u;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const index = row * stride + column;
      positions[index * 3] = rowRadius * cos;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = rowRadius * sin;
      normals[index * 3] = normalR * cos;
      normals[index * 3 + 1] = normalY;
      normals[index * 3 + 2] = normalR * sin;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }

  const rings = rowCount - 1;
  const indices = createIndices(rings * columns * 6, vertexCount);
  gridIndices(rings, columns, indices);
  return new BufferGeometry({
    positions,
    normals,
    uvs,
    indices,
    mode: "triangles",
  });
}

/**
 * A torus lying in the **XZ plane**, its axis along +Y, centred on the origin
 * (§53 "torus").
 *
 * ```ts
 * const geometry = torusGeometry({ radius: 1, tubeRadius: 0.25 });
 * ```
 *
 * ```text
 * P(u, v) = ((R + r·cos v)·cos u,  r·sin v,  (R + r·cos v)·sin u)
 * N(u, v) = (cos v·cos u,  sin v,  cos v·sin u)
 * ```
 *
 * — with `u` around the main ring and `v` around the tube's cross-section, both
 * from `0` to `2π`. The normal is the analytic one, so it is exact at every
 * sample rather than at the ones a face-average happens to get right; `v = 0`
 * is the **outer** equator, which is where a texture's bottom edge lands.
 *
 * XZ rather than XY so the ring lies flat on the ground plane of a Y-up world
 * (§7a) — a gear, a bearing race, a rotor lamination — and a torus that has to
 * stand up is rotated by its node.
 */
export function torusGeometry(
  options: TorusGeometryOptions = {},
): BufferGeometry {
  const radius = requirePositive("radius", options.radius ?? 1);
  const tubeRadius = requirePositive("tubeRadius", options.tubeRadius ?? 0.4);
  const columns = requireSegments(
    "tubularSegments",
    options.tubularSegments ?? 32,
    3,
  );
  const rings = requireSegments(
    "radialSegments",
    options.radialSegments ?? 16,
    3,
  );

  const stride = columns + 1;
  const vertexCount = stride * (rings + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let ring = 0; ring <= rings; ring += 1) {
    const vFraction = ring / rings;
    const v = 2 * Math.PI * vFraction;
    const cosV = Math.cos(v);
    const sinV = Math.sin(v);
    const rowRadius = radius + tubeRadius * cosV;
    for (let column = 0; column <= columns; column += 1) {
      const uFraction = column / columns;
      const u = 2 * Math.PI * uFraction;
      const cosU = Math.cos(u);
      const sinU = Math.sin(u);
      const index = ring * stride + column;
      positions[index * 3] = rowRadius * cosU;
      positions[index * 3 + 1] = tubeRadius * sinV;
      positions[index * 3 + 2] = rowRadius * sinU;
      normals[index * 3] = cosV * cosU;
      normals[index * 3 + 1] = sinV;
      normals[index * 3 + 2] = cosV * sinU;
      uvs[index * 2] = uFraction;
      uvs[index * 2 + 1] = vFraction;
    }
  }

  const indices = createIndices(rings * columns * 6, vertexCount);
  gridIndices(rings, columns, indices);
  return new BufferGeometry({
    positions,
    normals,
    uvs,
    indices,
    mode: "triangles",
  });
}

/**
 * A surface of revolution: the `points` profile revolved a full turn about the
 * **+Y axis** (§53 "lathe").
 *
 * ```ts
 * // A wine-glass bowl: radius against height, bottom first.
 * const geometry = latheGeometry({
 *   points: [
 *     { x: 0.05, y: 0 },
 *     { x: 0.4, y: 0.3 },
 *     { x: 0.45, y: 0.7 },
 *   ],
 * });
 * ```
 *
 * This is the general case the sphere, the cylinder, and the cone are special
 * cases of — they are written out separately because their analytic normals are
 * exact and their option names are the ones a caller reaches for, not because
 * they are different machines.
 *
 * **Normals come from the profile, not from the faces**: at profile point `i`
 * the tangent is the central difference `P[i+1] − P[i−1]` (one-sided at the
 * ends), and the outward normal in the `(r, y)` half-plane is that tangent
 * turned a quarter turn, `(tangent.y, −tangent.x)`. Revolved, that gives
 * `(n_r·cos θ, n_y, n_r·sin θ)`. Feeding a circular arc in therefore reproduces
 * the sphere's exact radial normals, which is the property the tests check —
 * except at the two **end** rings, where the difference is necessarily
 * one-sided and the normal leans by half a segment. That is visible only if a
 * profile ends on a silhouette; {@link sphereGeometry} exists partly so the one
 * shape where it would matter has analytic normals instead.
 *
 * A profile point with `x = 0` is a pole: its ring collapses and the quads
 * touching it degenerate, exactly as at a sphere's poles. Negative radii are
 * rejected (§85) — they turn the surface inside out rather than doing anything
 * useful. Uv is `u` around and `v = i / (points.length − 1)` along the profile,
 * so `v = 0` is the first point given.
 */
export function latheGeometry(options: LatheGeometryOptions): BufferGeometry {
  const points = options.points;
  if (points.length < 2) {
    throw new RangeError(
      `latheGeometry needs at least 2 profile points to sweep a surface; got ` +
        `${String(points.length)} (§85).`,
    );
  }
  const columns = requireSegments("segments", options.segments ?? 32, 3);
  for (let i = 0; i < points.length; i += 1) {
    requireNonNegative(`points[${String(i)}].x`, points[i].x);
    if (!Number.isFinite(points[i].y)) {
      throw new RangeError(
        `points[${String(i)}].y must be finite; got ${String(points[i].y)} ` +
          "(§85).",
      );
    }
  }

  const rings = points.length - 1;
  const stride = columns + 1;
  const vertexCount = stride * points.length;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let ring = 0; ring < points.length; ring += 1) {
    const previous = points[ring === 0 ? 0 : ring - 1];
    const next = points[ring === rings ? rings : ring + 1];
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    // Quarter turn: the profile's outward normal in the (r, y) half-plane.
    const length = Math.hypot(tangentX, tangentY) || 1;
    const normalR = tangentY / length;
    const normalY = -tangentX / length;
    const v = ring / rings;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const theta = 2 * Math.PI * u;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const index = ring * stride + column;
      positions[index * 3] = points[ring].x * cos;
      positions[index * 3 + 1] = points[ring].y;
      positions[index * 3 + 2] = points[ring].x * sin;
      normals[index * 3] = normalR * cos;
      normals[index * 3 + 1] = normalY;
      normals[index * 3 + 2] = normalR * sin;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }

  const indices = createIndices(rings * columns * 6, vertexCount);
  gridIndices(rings, columns, indices);
  return new BufferGeometry({
    positions,
    normals,
    uvs,
    indices,
    mode: "triangles",
  });
}

/**
 * Twice the signed area of a closed polygon (the shoelace sum). Positive when
 * the outline is wound counter-clockwise seen from +Z.
 */
function doubleSignedArea(points: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * A 2D outline extruded **linearly along Z**, centred on the origin (§53
 * "extrusion").
 *
 * ```ts
 * const geometry = extrudeGeometry({
 *   shape: [{ x: -1, y: -0.2 }, { x: 1, y: -0.2 }, { x: 1, y: 0.2 }, { x: -1, y: 0.2 }],
 *   depth: 0.1,
 * });
 * ```
 *
 * Along **Z**, not Y, because the outline is authored in the XY plane that §7a
 * makes the 2D plane of this engine: an extruded logo, gear tooth, or panel
 * profile is drawn flat and given thickness towards the viewer, and one that
 * has to stand up is rotated by its node. The solid spans `[-depth/2, depth/2]`.
 *
 * ## Flat side walls, tessellated caps
 *
 * Each outline edge becomes **its own quad with its own normal** — four
 * vertices, not two shared ones — because an extruded profile's edges are
 * meant to look like edges; smoothing them would round a gear tooth. The
 * outward normal of edge `a → b` is `(b − a)` turned a quarter turn, which for
 * a counter-clockwise outline points out of the solid (the builder normalizes
 * either input winding to counter-clockwise first).
 *
 * The **caps are ear-clipped** by §52's tessellator (`tessellation.ts`), which
 * is what makes a concave outline — an L, a star, a gear tooth, a letter — cap
 * correctly. Until 2026-08-09 this paragraph read:
 *
 * > The **caps are a centroid fan**, which is exact for a convex outline and
 * > folds over itself for a concave one — so a concave outline with
 * > `capped: true` is **rejected** (§85) rather than drawn wrongly. §52 makes
 * > tessellation an isolated, replaceable module of this package with a stable
 * > interface; when it lands, this restriction lifts and nothing else here
 * > changes.
 *
 * §52's module landed, and that is what happened: the fan and its centroid
 * vertex are gone, one call to `triangulatePolygon` replaced them, and a capped
 * extrusion now carries `2n` cap vertices rather than `2(n + 1)`. The **same**
 * index list drives both caps (§52 "index-buffer reuse"), reversed for the `-Z`
 * end so both face outwards. What is still refused is what the tessellator
 * refuses — a **self-intersecting** outline, and one enclosing no area —
 * because §52's "self-intersections where well-defined" tier needs a fill rule
 * and a planar-subdivision pass this release does not ship, and refusing loudly
 * beats emitting overlapping triangles (§85). `capped: false` has no
 * restriction beyond finiteness: the side walls are correct for any outline.
 *
 * A cap with **holes** — a washer, an O — is not offered here: the hole would
 * need its own inward-facing side walls, which is a §50 shape-node question
 * rather than a §53 primitive one. `triangulatePolygon` already takes holes,
 * and `polygonGeometry2D` is the builder that uses them (staged, 2026-08-09).
 *
 * Uv: the side wall's `u` is arc length around the outline normalized to the
 * perimeter, `v` runs `0` at `-Z` to `1` at `+Z`; each cap's uv is the
 * outline's own bounding box normalized to `[0, 1]²`.
 */
export function extrudeGeometry(
  options: ExtrudeGeometryOptions,
): BufferGeometry {
  const depth = requirePositive("depth", options.depth ?? 1);
  const capped = options.capped ?? true;
  const source = options.shape;
  if (source.length < 3) {
    throw new RangeError(
      `An extruded outline needs at least 3 points; got ` +
        `${String(source.length)} (§85).`,
    );
  }
  for (let i = 0; i < source.length; i += 1) {
    if (!Number.isFinite(source[i].x) || !Number.isFinite(source[i].y)) {
      throw new RangeError(
        `Outline point ${String(i)} is not finite (§85: NaN and infinite ` +
          "values).",
      );
    }
  }
  // Normalize to counter-clockwise, so one winding rule serves both inputs.
  const shape =
    doubleSignedArea(source) < 0 ? [...source].reverse() : [...source];

  // One triangulation, two caps (§52 "index-buffer reuse"). It runs before the
  // buffers are sized because the cap triangle count is no longer `n`: the
  // tessellator drops collinear vertices, so it is whatever the ear clip found.
  const capIndices = capped ? triangulatePolygon(shape) : undefined;

  const n = shape.length;
  const halfDepth = depth / 2;
  const capVertices = capIndices === undefined ? 0 : 2 * n;
  const vertexCount = 4 * n + capVertices;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indexCount =
    6 * n + (capIndices === undefined ? 0 : 2 * capIndices.length);
  const indices = createIndices(indexCount, vertexCount);

  // Arc length around the outline, for the side wall's u.
  const distances = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const a = shape[i];
    const b = shape[(i + 1) % n];
    distances[i + 1] = distances[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  // A wholly degenerate uncapped outline — every point the same — has no
  // perimeter to normalize u by; fall back to 1 so uv is `0` everywhere rather
  // than NaN, which §85 would then reject and blame on the caller's arithmetic.
  // Unreachable while `capped`, since that path requires a non-zero area.
  const perimeter = distances[n] || 1;

  let vertex = 0;
  let index = 0;
  for (let i = 0; i < n; i += 1) {
    const a = shape[i];
    const b = shape[(i + 1) % n];
    const edgeX = b.x - a.x;
    const edgeY = b.y - a.y;
    const length = Math.hypot(edgeX, edgeY) || 1;
    const normalX = edgeY / length;
    const normalY = -edgeX / length;
    const u0 = distances[i] / perimeter;
    const u1 = distances[i + 1] / perimeter;
    const corners: readonly (readonly [
      number,
      number,
      number,
      number,
      number,
    ])[] = [
      [a.x, a.y, -halfDepth, u0, 0],
      [b.x, b.y, -halfDepth, u1, 0],
      [b.x, b.y, halfDepth, u1, 1],
      [a.x, a.y, halfDepth, u0, 1],
    ];
    const base = vertex;
    for (const [x, y, z, u, v] of corners) {
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
      normals[vertex * 3] = normalX;
      normals[vertex * 3 + 1] = normalY;
      normals[vertex * 3 + 2] = 0;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;
      vertex += 1;
    }
    indices[index] = base;
    indices[index + 1] = base + 1;
    indices[index + 2] = base + 2;
    indices[index + 3] = base;
    indices[index + 4] = base + 2;
    indices[index + 5] = base + 3;
    index += 6;
  }

  if (capIndices !== undefined) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of shape) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    // Both spans are strictly positive: `triangulatePolygon` has already
    // rejected an outline enclosing no area, and a zero span in either axis
    // means a degenerate segment, which encloses none.
    const spanX = maxX - minX;
    const spanY = maxY - minY;

    for (const front of [true, false]) {
      const z = front ? halfDepth : -halfDepth;
      const sign = front ? 1 : -1;
      const base = vertex;
      for (const point of shape) {
        positions[vertex * 3] = point.x;
        positions[vertex * 3 + 1] = point.y;
        positions[vertex * 3 + 2] = z;
        normals[vertex * 3 + 2] = sign;
        uvs[vertex * 2] = (point.x - minX) / spanX;
        uvs[vertex * 2 + 1] = (point.y - minY) / spanY;
        vertex += 1;
      }
      for (let i = 0; i < capIndices.length; i += 3) {
        indices[index] = base + capIndices[i];
        // The +Z cap keeps the tessellator's counter-clockwise order; the -Z
        // cap reverses each triangle, so both face outwards (§7a).
        indices[index + 1] = base + capIndices[front ? i + 1 : i + 2];
        indices[index + 2] = base + capIndices[front ? i + 2 : i + 1];
        index += 3;
      }
    }
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
 * A circular cross-section swept along a 3D polyline (§53 "tube").
 *
 * ```ts
 * const geometry = tubeGeometry({
 *   path: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0.5, z: 0 }, { x: 2, y: 0, z: 0 }],
 *   radius: 0.05,
 * });
 * ```
 *
 * The frame is **parallel-transported**, not rebuilt per point from a fixed
 * up-vector: an initial normal perpendicular to the first tangent is carried
 * along the path by projecting it onto each new tangent's plane and
 * renormalizing. A Frenet frame would flip the tube inside out wherever the
 * curvature vanishes (a straight run) or reverses (an inflection), which is
 * exactly what a cable, a pipe run, or a §119 winding path is full of.
 *
 * The tube is open at both ends: capping a swept path means answering what a
 * cap looks like at an arbitrary orientation, and a caller who needs closed
 * ends adds a sphere. Normals are the analytic radial direction in the local
 * frame. Uv is `u` around the tube and `v = i / (path.length − 1)` along it.
 */
export function tubeGeometry(options: TubeGeometryOptions): BufferGeometry {
  const path = options.path;
  if (path.length < 2) {
    throw new RangeError(
      `tubeGeometry needs at least 2 path points to sweep along; got ` +
        `${String(path.length)} (§85).`,
    );
  }
  for (let i = 0; i < path.length; i += 1) {
    if (
      !Number.isFinite(path[i].x) ||
      !Number.isFinite(path[i].y) ||
      !Number.isFinite(path[i].z)
    ) {
      throw new RangeError(
        `Path point ${String(i)} is not finite (§85: NaN and infinite values).`,
      );
    }
  }
  const radius = requirePositive("radius", options.radius ?? 0.1);
  const columns = requireSegments(
    "radialSegments",
    options.radialSegments ?? 16,
    3,
  );

  const rings = path.length - 1;
  const stride = columns + 1;
  const vertexCount = stride * path.length;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  // Carried frame: `n` is the transported normal, `t` the current tangent.
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;

  for (let ring = 0; ring < path.length; ring += 1) {
    const previous = path[ring === 0 ? 0 : ring - 1];
    const next = path[ring === rings ? rings : ring + 1];
    let tangentX = next.x - previous.x;
    let tangentY = next.y - previous.y;
    let tangentZ = next.z - previous.z;
    const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
    if (tangentLength === 0) {
      throw new RangeError(
        `Path points ${String(ring - 1)} and ${String(ring + 1)} coincide, so ` +
          "the tube has no direction to sweep in (§85).",
      );
    }
    tangentX /= tangentLength;
    tangentY /= tangentLength;
    tangentZ /= tangentLength;

    if (ring === 0) {
      // Seed the frame with the axis least aligned with the tangent, so the
      // cross product below is never degenerate.
      const ax = Math.abs(tangentX);
      const ay = Math.abs(tangentY);
      const az = Math.abs(tangentZ);
      const seed =
        ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
      normalX = seed[0];
      normalY = seed[1];
      normalZ = seed[2];
    }
    // Parallel transport: strip the tangential part and renormalize.
    const dot = normalX * tangentX + normalY * tangentY + normalZ * tangentZ;
    normalX -= dot * tangentX;
    normalY -= dot * tangentY;
    normalZ -= dot * tangentZ;
    const normalLength = Math.hypot(normalX, normalY, normalZ);
    normalX /= normalLength;
    normalY /= normalLength;
    normalZ /= normalLength;

    // `binormal = normal × tangent`, the handedness that makes the swept ring
    // advance the way `gridIndices` expects (see `primitive-support.ts`).
    const binormalX = normalY * tangentZ - normalZ * tangentY;
    const binormalY = normalZ * tangentX - normalX * tangentZ;
    const binormalZ = normalX * tangentY - normalY * tangentX;

    const v = ring / rings;
    const centre = path[ring];
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const theta = 2 * Math.PI * u;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const nx = normalX * cos + binormalX * sin;
      const ny = normalY * cos + binormalY * sin;
      const nz = normalZ * cos + binormalZ * sin;
      const index = ring * stride + column;
      positions[index * 3] = centre.x + radius * nx;
      positions[index * 3 + 1] = centre.y + radius * ny;
      positions[index * 3 + 2] = centre.z + radius * nz;
      normals[index * 3] = nx;
      normals[index * 3 + 1] = ny;
      normals[index * 3 + 2] = nz;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
    }
  }

  const indices = createIndices(rings * columns * 6, vertexCount);
  gridIndices(rings, columns, indices);
  return new BufferGeometry({
    positions,
    normals,
    uvs,
    indices,
    mode: "triangles",
  });
}

/**
 * A regular grid of height samples in the **XZ plane**, displaced along Y (§53
 * "height field").
 *
 * ```ts
 * const geometry = heightFieldGeometry({
 *   heights: samples,        // rows × columns, row-major
 *   columns: 64,
 *   rows: 64,
 *   width: 100,
 *   depth: 100,
 * });
 * ```
 *
 * XZ with Y up is the orientation `@four/physics`' height-field collider (§24)
 * uses, and it is the one terrain, a machined surface, or a scalar field over a
 * plan view arrives in. The field is centred on the origin: `x` spans
 * `[-width/2, width/2]` and `z` spans `[-depth/2, depth/2]`, whatever the
 * heights do.
 *
 * Normals are **central differences** of the sampled surface —
 * `(−∂y/∂x, 1, −∂y/∂z)` normalized, one-sided at the borders — rather than
 * averaged face normals: the height field *is* a sampled function, so its
 * gradient is the honest normal and costs two subtractions per vertex. Uv is
 * the grid's own parameter square, `u` with `+X` and `v` with `+Z`.
 *
 * Unlike every other builder here the grid is **open**: there is no seam to
 * duplicate, so a `rows × columns` field is exactly `rows · columns` vertices.
 */
export function heightFieldGeometry(
  options: HeightFieldGeometryOptions,
): BufferGeometry {
  const columns = requireSegments("columns", options.columns, 2);
  const rows = requireSegments("rows", options.rows, 2);
  const width = requirePositive("width", options.width ?? 1);
  const depth = requirePositive("depth", options.depth ?? 1);
  const heights = options.heights;
  if (heights.length !== rows * columns) {
    throw new RangeError(
      `heightFieldGeometry needs exactly rows × columns = ` +
        `${String(rows * columns)} height samples; got ` +
        `${String(heights.length)} (§85).`,
    );
  }
  for (let i = 0; i < heights.length; i += 1) {
    if (!Number.isFinite(heights[i])) {
      throw new RangeError(
        `Height sample ${String(i)} is ${String(heights[i])}; heights must be ` +
          "finite (§85: NaN and infinite values).",
      );
    }
  }

  const vertexCount = rows * columns;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const stepX = width / (columns - 1);
  const stepZ = depth / (rows - 1);

  const at = (row: number, column: number): number =>
    heights[row * columns + column];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      positions[index * 3] = -width / 2 + column * stepX;
      positions[index * 3 + 1] = at(row, column);
      positions[index * 3 + 2] = -depth / 2 + row * stepZ;

      const left = column === 0 ? column : column - 1;
      const right = column === columns - 1 ? column : column + 1;
      const back = row === 0 ? row : row - 1;
      const front = row === rows - 1 ? row : row + 1;
      const gradientX =
        (at(row, right) - at(row, left)) / ((right - left) * stepX);
      const gradientZ =
        (at(front, column) - at(back, column)) / ((front - back) * stepZ);
      const length = Math.hypot(gradientX, 1, gradientZ);
      normals[index * 3] = -gradientX / length;
      normals[index * 3 + 1] = 1 / length;
      normals[index * 3 + 2] = -gradientZ / length;

      uvs[index * 2] = column / (columns - 1);
      uvs[index * 2 + 1] = row / (rows - 1);
    }
  }

  const indices: IndexArray = createIndices(
    (rows - 1) * (columns - 1) * 6,
    vertexCount,
  );
  gridIndices(rows - 1, columns - 1, indices, 0, 0, columns);
  return new BufferGeometry({
    positions,
    normals,
    uvs,
    indices,
    mode: "triangles",
  });
}
