/**
 * Polygon tessellation (§52) — the isolated module that turns a closed 2D
 * outline, optionally with holes, into an indexed triangle set.
 *
 * §52 asks for a tessellation subsystem that is *"an isolated module of
 * `@four/geometry` with a stable interface so implementations can be replaced
 * without changing the scene API"*. That is this file, and
 * {@link PolygonTessellator} is that interface: one method, taking rings of
 * points and returning indices, with {@link earClippingTessellator} as the
 * implementation this release ships. Nothing outside this module knows how a
 * polygon is cut up — `polygonGeometry2D` and `extrudeGeometry` call
 * {@link triangulatePolygon} and place vertices themselves.
 *
 * ## What ships here, and what is staged (§52, 2026-08-09)
 *
 * §52 lists nine capabilities. Four are discharged by this module:
 *
 * - **concave polygons** — the whole point of the packet; the ear clipper
 *   handles any simple outline, convex or not;
 * - **holes** — bridged into the outline before clipping (see below);
 * - **index-buffer reuse** — {@link triangulatePolygon} emits *indices only*.
 *   It creates no vertices and takes no view on attributes, so one
 *   triangulation serves both caps of an extrusion, a fill and its outline, or
 *   the same shape drawn twice with different uv layouts.
 * - **stroke expansion** — {@link expandStroke} (added by `R-16`, 2026-08-09),
 *   with §58's alignment, caps, joins, miter limit and dash phase. It is the
 *   one operation here that has to place its own vertices, since a stroke's
 *   vertices do not exist until the band is built; see the section header
 *   above it for why it is a **same-runtime** §33 claim while the fill
 *   tessellator is a cross-platform one.
 *
 * The other five are deliberately **not** here, each with a named home:
 *
 * - **adaptive curve subdivision** belongs to §51's `Path` (`flatten`,
 *   `subdivide` are §51 operations, not §52 ones): the tessellator's input is
 *   already a polyline, and the flattening tolerance is a property of the curve
 *   being flattened, not of the triangulation. It lands with the `Path` model
 *   (gap `R-24`).
 * - **anti-alias fringe generation** is the half of `R-16` that did *not*
 *   land: a fringe is a second band of triangles carrying a coverage ramp,
 *   and a ramp needs somewhere to put per-vertex coverage — an attribute the
 *   §57 pipelines do not read — plus blending semantics at the seam between
 *   the fringe and the body. It is a pipeline decision, not a tessellation
 *   one, and it is staged with the `ShapeMaterial` packet that owns that
 *   pipeline.
 * - **incremental rebuild of modified path segments** needs a `Path` to hold
 *   the segment identity that would be rebuilt (gap `R-24`).
 * - **self-intersections where well-defined** needs a fill rule (§51 lists
 *   nonzero and even-odd) and a planar-subdivision pass — a genuinely different
 *   algorithm, not a tweak to this one. Until it lands, self-intersecting input
 *   is **refused loudly** (§85) rather than silently triangulated into
 *   overlapping garbage: see "Why simplicity is proved, not assumed".
 * - **compute-based tessellation** is deferred by §52 itself ("in later
 *   releases").
 *
 * ## Algorithm: ear clipping, with holes bridged in
 *
 * Ear clipping, O(n²), no dependencies. The decision (2026-08-09) is the
 * defensible-MVP one: monotone decomposition is O(n log n) and is the upgrade
 * path, but it needs a sweep-line with a balanced status structure and its
 * tie-breaking at equal-y events is exactly where a "deterministic" claim
 * quietly stops being true. Ear clipping has one loop, one predicate, and a
 * proof (the two-ears theorem) that terminates it. `PolygonTessellator` exists
 * so the swap costs one export.
 *
 * Holes are eliminated before clipping, the standard way: each hole is joined
 * to the outline by a **bridge** — a segment traversed once out and once back —
 * turning a ring-with-holes into one weakly simple ring the ear clipper can
 * eat. Holes are merged in order of decreasing rightmost x, which is what makes
 * a visible target exist for each one in turn (everything still unmerged lies
 * to the left of the vertex we bridge from).
 *
 * ## Determinism (§33) — cross-platform, not merely same-runtime
 *
 * **This section is about the fill tessellator**, and stops being true at the
 * stroke section below: a determinism tier is a property of the operation, not
 * of the module (`R-24`'s rule, confirmed a second time here). Offsetting a
 * polyline needs a unit normal and therefore `Math.sqrt`; everything from
 * {@link expandStroke} down is stated as **same-runtime** where it lives, and
 * the two are pinned by two goldens carrying two `_tier` labels rather than by
 * one that would let a transcendental hide inside the stronger claim.
 *
 * Every geometric decision in the fill half is a comparison against a value built
 * from `+`, `-`, `*`, `/` on IEEE-754 doubles. Those four are the operations
 * ECMAScript defines as *exactly* rounded, so they produce identical bits on
 * every conforming engine. There is deliberately **no** `Math.atan2`,
 * `Math.sin`/`cos`, `Math.hypot`, `Math.sqrt` or `**` anywhere below: those are
 * implementation-approximated by ECMA-262, and the classic "sort candidate
 * vertices by angle" and "pick the nearest by distance" tricks are exactly how
 * a tessellator acquires a platform dependency. Distances are compared
 * **squared**; orientation is a cross product's sign; "is this point on that
 * segment" is a zero cross product plus two sign tests on coordinate
 * differences.
 *
 * The remaining ways an algorithm can be order-dependent are closed too:
 *
 * - **Input order is the only order.** Rings are processed in input order,
 *   vertices keep their input indices, and the ear scan walks the ring from a
 *   fixed start.
 * - **Every tie is broken by an integer.** The nearest valid bridge target is
 *   chosen by squared distance, ties by position in the ring walk; holes are
 *   ordered by rightmost x with ties broken by hole index. The comparator
 *   passed to `Array.prototype.sort` is a *total* order (it never returns 0 for
 *   two different holes), so the sort's result does not depend on whether the
 *   engine's sort is stable or which algorithm it picked.
 * - **No hash iteration, no `Math.random`, no clock.**
 *
 * So: identical input arrays produce a byte-identical index array, in any
 * order, on any engine, across runs. `tests/determinism/tessellation.test.ts`
 * pins that against a committed golden, in-process twice and once in a fresh
 * `node` process.
 *
 * ## Why simplicity is proved, not assumed (§85)
 *
 * Ear clipping's correctness proof needs a *simple* polygon — no edge crossing
 * another, no ring touching another, no vertex landing on a foreign edge. Fed
 * anything else it does not loop forever and it does not obviously fail; it
 * quietly emits overlapping triangles. A pentagram is the cheap demonstration:
 * every one of its five corners passes the local convexity test, so a naive
 * clipper triangulates it into a shape that is not the pentagram and reports
 * success.
 *
 * This module therefore *proves* the input simple before it clips: a pairwise
 * edge test across every ring (O(n²), the same order as the clip itself, so it
 * costs nothing asymptotically), plus a containment test placing each hole
 * inside the outline. A violation throws `RangeError` naming the two rings
 * involved. That is the repo's no-silent-rewrites rule (§85) applied to
 * geometry: refusing a pentagram loudly is a better answer than drawing
 * something that is not one.
 *
 * A hole nested inside another hole is refused too, by the bridge search rather
 * than by a check of its own — see {@link requireHolePlacement} for why one
 * implementation of that rule is better than two.
 *
 * ## The measured tier, and where it stops (2026-08-09)
 *
 * A proved-simple ring always has an ear (the two-ears theorem), so a polygon
 * **without holes** always clips. Bridging breaks that guarantee: the merged
 * ring is only *weakly* simple, and two hole seams can between them leave no
 * clippable corner. The clip loop detects that in a full pass and refuses (§85)
 * rather than looping or guessing.
 *
 * The rate was measured rather than guessed. A 60 000-case fuzz over random
 * star outlines and axis-aligned box holes on a coarse ¼-unit grid — chosen to
 * manufacture the collinearity and coincidence that break tessellators — ran
 * every accepted result against an independent oracle (every triangle
 * counter-clockwise; the triangle areas summing to the shoelace area of the
 * outline minus the holes):
 *
 * | holes | tessellated | refused | wrong |
 * |------:|------------:|--------:|------:|
 * | 0     | 14 902      | 0       | 0     |
 * | 1     | 11 739      | 0       | 0     |
 * | 2     | 8 871       | 23      | 0     |
 * | 3     | 6 370       | 40      | 0     |
 *
 * So: the hole-free and single-hole tiers — every extrusion cap, every filled
 * §50 shape, everything `R-24`'s `Path` and `R-23`'s shape nodes need first —
 * did not fail once, and **nothing was ever wrong**; roughly two in a thousand
 * adversarial multi-hole configurations are refused. What closes that gap is a
 * split fallback (find an interior diagonal of the stalled ring and clip the
 * two halves) or the monotone tier; both are behind {@link PolygonTessellator}
 * and neither changes a caller. The fuzz harness is not committed — it is a
 * measurement, not a gate; `tests/determinism/tessellation.test.ts` and the
 * package suite are the gates.
 *
 * ## Cost
 *
 * The clip is O(n²) and the simplicity proof is O(n²); hole bridging is
 * O(h · n²) worst case, since each hole's bridge target is chosen by testing
 * every candidate vertex against every edge. Measured on a spiky star outline
 * (2026-08-09, Node 22): 100 points 7 ms, 1 000 points 12 ms, 2 000 points
 * 58 ms. That is honest MVP tier for the shapes §50 names — a rounded
 * rectangle, a star, a letter outline, a border of a few hundred points — and
 * it says plainly where it stops: a path flattened to tens of thousands of
 * points wants the O(n log n) monotone tier, not this one. A sweep-line
 * simplicity check and a spatial index for the bridge search are the
 * intermediate upgrades, and none of the three changes this module's
 * interface.
 */

import type { GeometryIndexArray } from "./buffer-geometry.js";
import { createIndices, requirePositive } from "./primitive-support.js";

/**
 * A point in the XY plane — the input currency of every 2D builder and of the
 * tessellator (§7a: the 2D plane of this engine is the XY plane of the same
 * right-handed, Y-up space 3D lives in).
 *
 * Declared here rather than beside the 3D primitives because §52's module is
 * the one that owns 2D geometry; `primitives-3d.ts` imports it for the outline
 * of an extrusion and the profile of a lathe.
 */
export interface Point2D {
  /** Horizontal coordinate. For `latheGeometry` this is a **radius**. */
  readonly x: number;
  /** Vertical coordinate. For `latheGeometry` this is the height. */
  readonly y: number;
}

/**
 * §52's replaceable-implementation seam: everything a tessellator has to be
 * able to do for the rest of the package.
 *
 * `polygonGeometry2D` and `extrudeGeometry` are written against
 * {@link triangulatePolygon} directly today, but the interface is what makes
 * "implementations can be replaced without changing the scene API" a checkable
 * claim rather than a hope — a monotone-decomposition or compute-based
 * tessellator satisfies this type and nothing else in the repository has to
 * know.
 */
export interface PolygonTessellator {
  /** Stable identifier for diagnostics and capability reporting. */
  readonly name: string;
  /** See {@link triangulatePolygon} for the contract this method implements. */
  triangulate(
    outline: readonly Point2D[],
    holes?: readonly (readonly Point2D[])[],
  ): GeometryIndexArray;
}

/**
 * Triangulates a simple polygon, with optional holes, into an indexed triangle
 * set (§52 "concave polygons", "holes", "index-buffer reuse").
 *
 * ```ts
 * const indices = triangulatePolygon([
 *   { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
 *   { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 },
 * ]);
 * indices.length / 3; // 4 triangles for this L
 * ```
 *
 * ## What the indices index
 *
 * The **concatenation** of the rings, in the order they were passed: the
 * outline occupies `0 … outline.length - 1`, the first hole the block after it,
 * and so on. A caller that lays its vertices out the same way — and both
 * builders in this package do — can upload the returned array unchanged. No
 * vertices are created, moved, or merged, which is what makes one triangulation
 * reusable for two caps of an extrusion.
 *
 * The array is the narrowest type that can address those vertices
 * (`Uint16Array` up to 65 536 points), matching every other builder here.
 *
 * ## Winding
 *
 * **Either input winding is accepted, for the outline and for each hole
 * independently** — the tessellator reads each ring's signed area and walks it
 * in whichever direction it needs. Every emitted triangle is
 * **counter-clockwise seen from +Z** (§7a), so a caller placing the points in
 * the XY plane gets front faces without inspecting its own input.
 *
 * ## Collinear vertices
 *
 * A vertex lying exactly on the segment between its two neighbours is dropped
 * before clipping: it adds nothing to the region and would only produce a
 * zero-area triangle. Such a vertex therefore appears in **no** triangle, and
 * `indices.length / 3` is `effective vertices + 2 × holes − 2`, not
 * `points − 2`. The vertex itself is untouched in the caller's array — this
 * function never rewrites input (§85).
 *
 * ## What is refused (§85)
 *
 * Every one of these throws `RangeError` rather than producing triangles that
 * do not describe the requested region:
 *
 * - a ring of fewer than 3 points, or any non-finite coordinate;
 * - a ring that repeats a point consecutively (a zero-length edge), or doubles
 *   straight back on itself (a spike);
 * - a ring enclosing zero area — including the symmetric figure-of-eight whose
 *   lobes cancel;
 * - **any self-intersection or touching**: two edges that cross, two rings that
 *   touch, a vertex sitting on a foreign edge (§52's "self-intersections where
 *   well-defined" is staged; see this module's header);
 * - a hole that is not inside the outline, or that is inside another hole
 *   (islands are not a §52 requirement and would need a nesting-parity pass);
 * - a configuration of two or more holes whose bridges leave the ear clipper
 *   no corner to cut — measured at roughly two per thousand adversarial cases,
 *   never wrong when it succeeds; see this module's header.
 *
 * @param outline The closed outer ring. The last point is **not** repeated; the
 *   ring closes from the last point back to the first.
 * @param holes Closed inner rings, each in either winding, each strictly inside
 *   `outline` and disjoint from the others.
 */
export function triangulatePolygon(
  outline: readonly Point2D[],
  holes: readonly (readonly Point2D[])[] = [],
): GeometryIndexArray {
  const rings = prepareRings(outline, holes);
  requireSimpleRings(rings);
  requireHolePlacement(rings);
  return clipEars(rings, buildMergedRing(rings));
}

/**
 * The ear-clipping tessellator, published as a {@link PolygonTessellator} so a
 * replacement can be dropped in behind the same type.
 */
export const earClippingTessellator: PolygonTessellator = {
  name: "ear-clipping",
  triangulate: triangulatePolygon,
};

// ---------------------------------------------------------------------------
// Exact predicates
//
// Every one of these is a comparison on a value built from +, -, * and / — the
// exactly-rounded IEEE-754 operations — so their answers are identical on every
// conforming engine. See the module header on determinism.
// ---------------------------------------------------------------------------

/**
 * Twice the signed area of triangle `abc`: positive when `a → b → c` turns
 * counter-clockwise, zero when the three are collinear, negative clockwise.
 */
function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Whether `r` lies on the closed segment `pq`, **given** that the three are
 * collinear. Written as two sign tests on coordinate products rather than as
 * `min`/`max` comparisons so the degenerate `p === q` case answers "only if
 * `r` is that point too" without a special branch.
 */
function betweenCollinear(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): boolean {
  return (rx - px) * (rx - qx) <= 0 && (ry - py) * (ry - qy) <= 0;
}

/** Whether `r` lies on the closed segment `pq`. */
function onSegment(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): boolean {
  return (
    orient(px, py, qx, qy, rx, ry) === 0 &&
    betweenCollinear(px, py, qx, qy, rx, ry)
  );
}

/**
 * Whether the closed segments `ab` and `cd` share any point at all — crossing
 * *or* merely touching.
 *
 * Touching counts because the tessellator refuses non-simple input: a vertex
 * that lands on a foreign edge, or two rings that kiss at a point, are exactly
 * the configurations whose triangulation is ambiguous, and pretending they are
 * fine is how a tessellator ships wrong triangles.
 */
function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const da = orient(cx, cy, dx, dy, ax, ay);
  const db = orient(cx, cy, dx, dy, bx, by);
  const dc = orient(ax, ay, bx, by, cx, cy);
  const dd = orient(ax, ay, bx, by, dx, dy);
  if (da !== 0 && db !== 0 && dc !== 0 && dd !== 0) {
    // No endpoint is collinear with the other segment, so the only way to meet
    // is a proper crossing: each segment straddles the other's line.
    return da > 0 !== db > 0 && dc > 0 !== dd > 0;
  }
  const touchA = da === 0 && betweenCollinear(cx, cy, dx, dy, ax, ay);
  const touchB = db === 0 && betweenCollinear(cx, cy, dx, dy, bx, by);
  const touchC = dc === 0 && betweenCollinear(ax, ay, bx, by, cx, cy);
  const touchD = dd === 0 && betweenCollinear(ax, ay, bx, by, dx, dy);
  return touchA || touchB || touchC || touchD;
}

/**
 * Whether `p` lies inside or on the boundary of the counter-clockwise triangle
 * `abc`.
 *
 * Inclusive on purpose: a vertex sitting on a candidate ear's diagonal blocks
 * that ear, which is what stops the clipper from cutting across a bridge into a
 * hole.
 */
function pointInTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  return (
    orient(ax, ay, bx, by, px, py) >= 0 &&
    orient(bx, by, cx, cy, px, py) >= 0 &&
    orient(cx, cy, ax, ay, px, py) >= 0
  );
}

// ---------------------------------------------------------------------------
// Ring preparation and validation (§85)
// ---------------------------------------------------------------------------

/**
 * The input, flattened and checked: coordinates in one pair of arrays and one
 * index list per ring, `loops[0]` being the outline.
 *
 * Indices are into the *caller's* concatenated point order and survive to the
 * output unchanged, which is the contract {@link triangulatePolygon} documents.
 */
interface PreparedRings {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Outline first, then holes; collinear vertices already dropped. */
  readonly loops: readonly (readonly number[])[];
  /** Doubled signed area per loop — sign only; positive is counter-clockwise. */
  readonly areas: readonly number[];
}

/** Names a ring in an error message the caller can act on. */
function ringLabel(ring: number): string {
  return ring === 0 ? "The outline" : `Hole ${String(ring - 1)}`;
}

/**
 * Validates every ring and flattens it: point count, finiteness, no repeated
 * point, no spike, non-zero area — then drops collinear vertices.
 */
function prepareRings(
  outline: readonly Point2D[],
  holes: readonly (readonly Point2D[])[],
): PreparedRings {
  const sources: readonly (readonly Point2D[])[] = [outline, ...holes];
  let total = 0;
  for (const source of sources) {
    total += source.length;
  }
  const xs = new Float64Array(total);
  const ys = new Float64Array(total);
  const loops: number[][] = [];
  const areas: number[] = [];

  let offset = 0;
  for (let ring = 0; ring < sources.length; ring += 1) {
    const source = sources[ring];
    if (source.length < 3) {
      throw new RangeError(
        `${ringLabel(ring)} needs at least 3 points to enclose an area; got ` +
          `${String(source.length)} (§85).`,
      );
    }
    const indices: number[] = [];
    for (let i = 0; i < source.length; i += 1) {
      const point = source[i];
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new RangeError(
          `${ringLabel(ring)} has a non-finite point at index ${String(i)} ` +
            "(§85: NaN and infinite values).",
        );
      }
      xs[offset + i] = point.x;
      ys[offset + i] = point.y;
      indices.push(offset + i);
    }
    requireCleanCorners(xs, ys, indices, ring);
    const filtered = dropCollinear(xs, ys, indices);
    const area = doubleSignedArea(xs, ys, filtered);
    if (area === 0) {
      throw new RangeError(
        `${ringLabel(ring)} must enclose a non-zero area; this ring encloses ` +
          "none (§85).",
      );
    }
    loops.push(filtered);
    areas.push(area);
    offset += source.length;
  }

  return { xs, ys, loops, areas };
}

/**
 * Rejects the two corner defects that make "collinear" ambiguous: a repeated
 * point (a zero-length edge, whose direction is undefined) and a spike (the
 * ring doubling straight back along the edge it arrived on).
 *
 * Both have to go *before* collinear vertices are dropped, because dropping
 * assumes a collinear vertex lies strictly between its neighbours — which is
 * true exactly when neither defect is present, and is what makes the drop
 * area-preserving.
 */
function requireCleanCorners(
  xs: Float64Array,
  ys: Float64Array,
  loop: readonly number[],
  ring: number,
): void {
  const n = loop.length;
  for (let i = 0; i < n; i += 1) {
    const a = loop[(i + n - 1) % n];
    const b = loop[i];
    const c = loop[(i + 1) % n];
    if (xs[b] === xs[c] && ys[b] === ys[c]) {
      throw new RangeError(
        `${ringLabel(ring)} repeats the point at index ${String(i)}; a ` +
          "zero-length edge has no direction to build geometry from (§85).",
      );
    }
    if (
      orient(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]) === 0 &&
      (xs[a] - xs[b]) * (xs[c] - xs[b]) + (ys[a] - ys[b]) * (ys[c] - ys[b]) > 0
    ) {
      throw new RangeError(
        `${ringLabel(ring)} doubles back on itself at index ${String(i)}; a ` +
          "spike encloses no area and cannot be triangulated (§85).",
      );
    }
  }
}

/**
 * Drops every vertex that lies on the segment between its neighbours, repeating
 * until none is left.
 *
 * Removal is area-preserving — {@link requireCleanCorners} has established that
 * a collinear vertex lies *strictly between* its neighbours — so the ring keeps
 * its region and therefore its non-zero area, which is why this cannot reduce a
 * ring below three vertices.
 */
function dropCollinear(
  xs: Float64Array,
  ys: Float64Array,
  loop: readonly number[],
): number[] {
  let current = [...loop];
  let changed = true;
  while (changed) {
    changed = false;
    const kept: number[] = [];
    const n = current.length;
    for (let i = 0; i < n; i += 1) {
      const a = current[(i + n - 1) % n];
      const b = current[i];
      const c = current[(i + 1) % n];
      if (orient(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]) === 0) {
        changed = true;
      } else {
        kept.push(b);
      }
    }
    current = kept;
  }
  return current;
}

/** Twice the signed area of a ring (the shoelace sum); positive is CCW. */
function doubleSignedArea(
  xs: Float64Array,
  ys: Float64Array,
  loop: readonly number[],
): number {
  let sum = 0;
  const n = loop.length;
  for (let i = 0; i < n; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    sum += xs[a] * ys[b] - xs[b] * ys[a];
  }
  return sum;
}

/**
 * Proves the input simple: no two edges meet except where consecutive edges of
 * one ring share their vertex (§85).
 *
 * Consecutive edges are skipped rather than tested because
 * {@link requireCleanCorners} has already shown they meet only at that shared
 * vertex — a repeat or a spike is the only way two consecutive edges can
 * overlap, and both are already refused.
 */
function requireSimpleRings(rings: PreparedRings): void {
  const { xs, ys, loops } = rings;
  // One flat edge list, each edge remembering which ring and position it came
  // from so a failure can name both sides.
  const edgeRing: number[] = [];
  const edgeAt: number[] = [];
  const edgeFrom: number[] = [];
  const edgeTo: number[] = [];
  for (let ring = 0; ring < loops.length; ring += 1) {
    const loop = loops[ring];
    for (let i = 0; i < loop.length; i += 1) {
      edgeRing.push(ring);
      edgeAt.push(i);
      edgeFrom.push(loop[i]);
      edgeTo.push(loop[(i + 1) % loop.length]);
    }
  }

  for (let i = 0; i < edgeFrom.length; i += 1) {
    for (let j = i + 1; j < edgeFrom.length; j += 1) {
      if (edgeRing[i] === edgeRing[j]) {
        const size = loops[edgeRing[i]].length;
        const gap = (edgeAt[j] - edgeAt[i] + size) % size;
        if (gap === 1 || gap === size - 1) {
          continue;
        }
      }
      const a = edgeFrom[i];
      const b = edgeTo[i];
      const c = edgeFrom[j];
      const d = edgeTo[j];
      if (
        segmentsIntersect(
          xs[a],
          ys[a],
          xs[b],
          ys[b],
          xs[c],
          ys[c],
          xs[d],
          ys[d],
        )
      ) {
        throw new RangeError(
          `${ringLabel(edgeRing[i])} is not simple: its edge ` +
            `${String(edgeAt[i])} meets edge ${String(edgeAt[j])} of ` +
            `${ringLabel(edgeRing[j]).toLowerCase()}. §52's ` +
            "self-intersection tier is not implemented, so this is refused " +
            "rather than triangulated into overlapping triangles (§85).",
        );
      }
    }
  }
}

/**
 * Whether `(px, py)` is inside a ring, by crossing number.
 *
 * Only ever called for points known not to lie on any edge, so the
 * on-boundary case needs no convention.
 */
function pointInLoop(
  xs: Float64Array,
  ys: Float64Array,
  loop: readonly number[],
  px: number,
  py: number,
): boolean {
  let inside = false;
  const n = loop.length;
  for (let i = 0; i < n; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    if (ys[a] > py !== ys[b] > py) {
      const t = (py - ys[a]) / (ys[b] - ys[a]);
      if (px < xs[a] + t * (xs[b] - xs[a])) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Places every hole inside the outline (§85).
 *
 * One vertex per hole decides it: {@link requireSimpleRings} has already shown
 * no ring crosses another, so a ring is wholly inside or wholly outside any
 * other ring, and any of its vertices reports which.
 *
 * A hole inside *another hole* is refused too, but not here — the bridge search
 * refuses it, because a bridge out of a nested hole would have to pass through
 * the hole containing it, and every candidate fails the same test that keeps
 * ordinary bridges out of ordinary holes. Repeating the check here would be a
 * second implementation of the same rule and, being unreachable, a second
 * implementation nothing ever exercises.
 */
function requireHolePlacement(rings: PreparedRings): void {
  const { xs, ys, loops } = rings;
  for (let hole = 1; hole < loops.length; hole += 1) {
    const probe = loops[hole][0];
    if (!pointInLoop(xs, ys, loops[0], xs[probe], ys[probe])) {
      throw new RangeError(
        `${ringLabel(hole)} is not inside the outline; a hole has to cut ` +
          "something out of the shape it belongs to (§85).",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Merged ring construction
// ---------------------------------------------------------------------------

/** One vertex of the working ring: a position, its input index, two links. */
interface RingNode {
  /** Index into the caller's concatenated point order. */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  prev: RingNode;
  next: RingNode;
}

/** Creates a one-node ring linked to itself. */
function createNode(index: number, x: number, y: number): RingNode {
  const node = { index, x, y } as RingNode;
  node.prev = node;
  node.next = node;
  return node;
}

/** Appends a node after `tail`, keeping the ring closed. */
function appendNode(tail: RingNode, node: RingNode): RingNode {
  node.prev = tail;
  node.next = tail.next;
  tail.next.prev = node;
  tail.next = node;
  return node;
}

/**
 * Builds a linked ring from one loop, walked forwards when `forward` and
 * backwards otherwise — which is how either input winding is normalized without
 * copying or reversing the caller's array.
 */
function buildLoop(
  xs: Float64Array,
  ys: Float64Array,
  loop: readonly number[],
  forward: boolean,
): RingNode {
  const first = forward ? loop[0] : loop[loop.length - 1];
  const head = createNode(first, xs[first], ys[first]);
  let tail = head;
  for (let step = 1; step < loop.length; step += 1) {
    const at = forward ? step : loop.length - 1 - step;
    const index = loop[at];
    tail = appendNode(tail, createNode(index, xs[index], ys[index]));
  }
  return head;
}

/**
 * Turns the validated rings into the single weakly simple ring the ear clipper
 * consumes: the outline counter-clockwise, every hole clockwise and bridged in.
 */
function buildMergedRing(rings: PreparedRings): RingNode {
  const { xs, ys, loops, areas } = rings;
  const outer = buildLoop(xs, ys, loops[0], areas[0] > 0);
  if (loops.length === 1) {
    return outer;
  }

  // Merge right to left. Bridging from the rightmost vertex of the rightmost
  // remaining hole is what guarantees a target exists: everything still
  // unmerged lies at or left of it, so it cannot be walled in by a hole this
  // pass has not seen yet.
  const order: number[] = [];
  const rightmost: number[] = [];
  for (let hole = 1; hole < loops.length; hole += 1) {
    order.push(hole);
    let extreme = -Infinity;
    for (const index of loops[hole]) {
      extreme = Math.max(extreme, xs[index]);
    }
    rightmost.push(extreme);
  }
  // A total order: two different holes never compare equal, so the result does
  // not depend on the engine's sort being stable (§33).
  order.sort((a, b) =>
    rightmost[a - 1] === rightmost[b - 1]
      ? a - b
      : rightmost[b - 1] - rightmost[a - 1],
  );

  const bridgeFrom: number[] = [];
  const bridgeTo: number[] = [];
  for (const hole of order) {
    const ring = buildLoop(xs, ys, loops[hole], areas[hole] < 0);
    const from = rightmostNode(ring);
    const to = findBridgeTarget(rings, outer, from, bridgeFrom, bridgeTo);
    spliceBridge(to, from);
    bridgeFrom.push(from.index);
    bridgeTo.push(to.index);
  }
  return outer;
}

/**
 * The hole's rightmost vertex — the end of the bridge that is guaranteed to see
 * out. A tie on x goes to the highest y, which settles it: a ring cannot hold
 * two vertices at one position, because {@link requireCleanCorners} refuses a
 * repeat and {@link requireSimpleRings} refuses the touching edges that any
 * other coincidence implies. So the comparison never needs an index tie-break
 * and never depends on the order the ring happens to be walked in (§33).
 */
function rightmostNode(start: RingNode): RingNode {
  let best = start;
  let node = start.next;
  while (node !== start) {
    if (node.x > best.x || (node.x === best.x && node.y > best.y)) {
      best = node;
    }
    node = node.next;
  }
  return best;
}

/**
 * Finds the vertex of the merged ring nearest `from` that `from` can be joined
 * to without the bridge touching anything (§85 if none exists).
 *
 * "Nearest" is by **squared** distance — no `Math.hypot`, no `Math.sqrt` — with
 * ties broken by position in the ring walk, so the answer is an integer
 * decision whenever two candidates are equidistant (§33).
 *
 * A vertex that already carries a bridge is considered only when nothing else
 * will do. Stacking two seams on one vertex is legal but is where the ear
 * clipper struggles most, so the preference is a quality heuristic; falling
 * back rather than refusing keeps it *only* a heuristic, since a hole whose
 * one visible neighbour is an existing seam is still a hole worth bridging.
 */
function findBridgeTarget(
  rings: PreparedRings,
  outer: RingNode,
  from: RingNode,
  bridgeFrom: readonly number[],
  bridgeTo: readonly number[],
): RingNode {
  let best = nearestClearTarget(rings, outer, from, bridgeFrom, bridgeTo, true);
  if (best === undefined) {
    best = nearestClearTarget(rings, outer, from, bridgeFrom, bridgeTo, false);
  }

  if (best === undefined) {
    throw new RangeError(
      `No bridge joins the hole at point ${String(from.index)} to the rest ` +
        "of the shape: every candidate would leave the region. A hole inside " +
        "another hole is the usual cause — islands need a nesting-parity " +
        "pass §52 does not require — as is a hole that touches another ring " +
        "(§85).",
    );
  }
  return best;
}

/**
 * The nearest ring vertex `from` can be bridged to, or `undefined` when none
 * can. `avoidSeams` excludes vertices that already carry a bridge; see
 * {@link findBridgeTarget} for why that is a preference and not a rule.
 */
function nearestClearTarget(
  rings: PreparedRings,
  outer: RingNode,
  from: RingNode,
  bridgeFrom: readonly number[],
  bridgeTo: readonly number[],
  avoidSeams: boolean,
): RingNode | undefined {
  let best: RingNode | undefined;
  let bestDistance = Infinity;
  let node = outer;
  do {
    const dx = node.x - from.x;
    const dy = node.y - from.y;
    const distance = dx * dx + dy * dy;
    const seam =
      bridgeFrom.includes(node.index) || bridgeTo.includes(node.index);
    if (
      !(avoidSeams && seam) &&
      distance < bestDistance &&
      bridgeIsClear(rings, from, node, bridgeFrom, bridgeTo)
    ) {
      best = node;
      bestDistance = distance;
    }
    node = node.next;
  } while (node !== outer);
  return best;
}

/**
 * Whether the segment `from → to` can serve as a bridge: it must meet no ring
 * edge, no ring vertex, and no earlier bridge except at its own two endpoints,
 * and its interior must stay out of every hole — including the hole it starts
 * from, whose interior is exactly where a lazy bridge would run.
 *
 * The midpoint decides that on its own. A segment that touches no boundary
 * anywhere cannot be partly inside a hole and partly outside it, so one sample
 * is the whole answer — and the midpoint is the one sample an addition and a
 * halving away from both endpoints.
 *
 * There is no matching test against the **outline**, and that is not an
 * oversight: {@link requireHolePlacement} has put `from` inside the outline,
 * and a segment that met no outline edge and no outline vertex never reached
 * the outline's boundary, so it cannot be on the far side of it.
 */
function bridgeIsClear(
  rings: PreparedRings,
  from: RingNode,
  to: RingNode,
  bridgeFrom: readonly number[],
  bridgeTo: readonly number[],
): boolean {
  const { xs, ys, loops } = rings;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (
        a !== from.index &&
        a !== to.index &&
        onSegment(from.x, from.y, to.x, to.y, xs[a], ys[a])
      ) {
        return false;
      }
      if (a === from.index || a === to.index) {
        continue;
      }
      if (b === from.index || b === to.index) {
        continue;
      }
      if (
        segmentsIntersect(
          from.x,
          from.y,
          to.x,
          to.y,
          xs[a],
          ys[a],
          xs[b],
          ys[b],
        )
      ) {
        return false;
      }
    }
  }

  for (let i = 0; i < bridgeFrom.length; i += 1) {
    const a = bridgeFrom[i];
    const b = bridgeTo[i];
    if (
      a === from.index ||
      a === to.index ||
      b === from.index ||
      b === to.index
    ) {
      continue;
    }
    if (
      segmentsIntersect(from.x, from.y, to.x, to.y, xs[a], ys[a], xs[b], ys[b])
    ) {
      return false;
    }
  }

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  for (let hole = 1; hole < loops.length; hole += 1) {
    if (pointInLoop(xs, ys, loops[hole], midX, midY)) {
      return false;
    }
  }
  return true;
}

/**
 * Splices a hole ring into the merged ring along the bridge `to → from`.
 *
 * Both endpoints are duplicated, which is what a bridge *is*: the boundary
 * walks out along it into the hole, all the way round, and back along the same
 * segment. The result is weakly simple — two coincident edges — and the
 * clipper's inclusive point-in-triangle test is what keeps it from cutting
 * across the seam.
 */
function spliceBridge(to: RingNode, from: RingNode): void {
  const toCopy = createNode(to.index, to.x, to.y);
  const fromCopy = createNode(from.index, from.x, from.y);
  const afterTo = to.next;
  const beforeFrom = from.prev;

  to.next = from;
  from.prev = to;
  beforeFrom.next = fromCopy;
  fromCopy.prev = beforeFrom;
  fromCopy.next = toCopy;
  toCopy.prev = fromCopy;
  toCopy.next = afterTo;
  afterTo.prev = toCopy;
}

// ---------------------------------------------------------------------------
// The clip
// ---------------------------------------------------------------------------

/**
 * Clips ears off the merged ring until three vertices remain, writing
 * counter-clockwise triangles into a freshly allocated index array.
 *
 * The ring has `vertices` nodes and every clip removes exactly one, so the
 * triangle count is known before the first cut and the array is allocated once
 * at exactly the right size — no growth, no copy.
 */
function clipEars(rings: PreparedRings, ring: RingNode): GeometryIndexArray {
  let remaining = 0;
  let node = ring;
  do {
    remaining += 1;
    node = node.next;
  } while (node !== ring);

  const indices = createIndices(3 * (remaining - 2), rings.xs.length);
  let cursor = 0;
  let misses = 0;
  node = ring;
  while (remaining > 3) {
    if (isEar(node)) {
      indices[cursor] = node.prev.index;
      indices[cursor + 1] = node.index;
      indices[cursor + 2] = node.next.index;
      cursor += 3;
      node.prev.next = node.next;
      node.next.prev = node.prev;
      node = node.next;
      remaining -= 1;
      misses = 0;
    } else {
      node = node.next;
      misses += 1;
      if (misses > remaining) {
        // A full pass with no ear. For an unbridged simple ring this cannot
        // happen (two-ears theorem, and §85 proved the ring simple); with two
        // or more bridged holes it can, when their seams leave no clippable
        // corner. Refusing here is the honest end of the tier — see the module
        // header on what closes it.
        throw new RangeError(
          "The polygon could not be triangulated: a full pass over the " +
            "remaining ring found no ear. Bridging this many holes left a " +
            "seam the ear clipper cannot cut; §52's monotone tier is what " +
            "lifts this (§85).",
        );
      }
    }
  }

  indices[cursor] = node.prev.index;
  indices[cursor + 1] = node.index;
  indices[cursor + 2] = node.next.index;
  return indices;
}

/**
 * Whether the triangle at `node` may be cut off: the corner must turn
 * counter-clockwise, and no reflex vertex of the ring may lie inside or on it.
 *
 * Only reflex (and collinear) vertices are tested, which is the classical
 * condition — a convex vertex inside a candidate ear of a simple polygon would
 * force the boundary to cross one of the ear's two polygon edges, and it
 * cannot.
 */
function isEar(node: RingNode): boolean {
  const a = node.prev;
  const c = node.next;
  if (orient(a.x, a.y, node.x, node.y, c.x, c.y) <= 0) {
    return false;
  }
  let probe = c.next;
  while (probe !== a) {
    // A probe sitting exactly *on* one of this ear's three corners is a bridge
    // seam — the only way two nodes can share a position, since the §85 checks
    // proved every input vertex distinct. It must not block: the inclusive
    // containment test counts a corner as "inside", so without this a bridged
    // hole would veto every ear at its own two seam vertices, and a shape with
    // two holes whose seams meet would have no ear at all. Ignoring a
    // zero-area touch at a corner costs nothing — anything the other branch of
    // the seam actually encloses shows up as one of *its* reflex vertices,
    // which are tested normally.
    const coincident =
      (probe.x === a.x && probe.y === a.y) ||
      (probe.x === node.x && probe.y === node.y) ||
      (probe.x === c.x && probe.y === c.y);
    if (
      !coincident &&
      orient(
        probe.prev.x,
        probe.prev.y,
        probe.x,
        probe.y,
        probe.next.x,
        probe.next.y,
      ) <= 0 &&
      pointInTriangle(a.x, a.y, node.x, node.y, c.x, c.y, probe.x, probe.y)
    ) {
      return false;
    }
    probe = probe.next;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Stroke expansion (§52 "stroke expansion", the geometry half of §58)
//
// §58 describes a `StrokeStyle` — width, alignment, caps, joins, miter limit,
// dash phase — and §52 says the expansion of a path into that band is a
// tessellation-subsystem operation. Everything below is that operation and
// nothing else: it takes polylines and numbers and answers triangles. No
// paint, no colour, no material — §58's `Paint` lives in the render tier
// because a colour is not geometry, and this module would otherwise have to
// know what a texture is.
//
// Determinism (§33): **same-runtime tier**, unlike the fill tessellator above.
// Offsetting a polyline by a fixed distance needs unit normals, so
// `Math.sqrt` is unavoidable, and a round join needs `Math.acos` for its
// sample count and `Math.cos`/`Math.sin` for its sample values — the same
// three ECMA-262 leaves implementation-approximated that `flattenArc` names.
// A miter or bevel join with butt caps uses none of them, but the tier is a
// property of the operation, not of the option record, so it is stated once,
// here, for all of it.
// ---------------------------------------------------------------------------

/**
 * Which side of the path the stroke band occupies (§58 `StrokeStyle`).
 *
 * The sides are named from the path's own direction of travel: **`inside`** is
 * the band entirely to the *left* of it, **`outside`** entirely to the right,
 * and `center` straddles it. On a ring wound counter-clockwise — the winding
 * every §50 shape produces, and the one §7a's Y-up plane makes positive —
 * the enclosed region *is* the left, so `inside` and `outside` mean what they
 * say without a second rule; on a ring wound clockwise (a hole) they swap,
 * which is also what they should do, because the material of an annulus is
 * outside its inner circle.
 */
export type StrokeAlignment = "inside" | "center" | "outside";

/** How an open polyline's two ends are finished (§58 `StrokeStyle.lineCap`). */
export type StrokeLineCap = "butt" | "round" | "square";

/** How two segments meet at a corner (§58 `StrokeStyle.lineJoin`). */
export type StrokeLineJoin = "miter" | "round" | "bevel";

/**
 * Default {@link StrokeGeometryOptions.miterLimit} — 4, SVG's and Canvas's.
 *
 * The limit is the ratio of the miter's length to the stroke's width, so 4
 * bevels a corner sharper than about 29°. It is a ratio rather than a length
 * precisely so it does not have to be re-chosen when the width changes.
 */
export const DEFAULT_MITER_LIMIT = 4;

/**
 * A flattened polyline, and whether it closes back on its first point.
 *
 * The currency between §51's flattening and §52's expansion: `Path.polylines`
 * produces these, {@link expandStroke} consumes them. `closed` is the one bit
 * `Point2D[]` cannot carry and the one bit a stroke cannot do without — a
 * closed ring is joined at every vertex and capped at none.
 */
export interface Polyline2D {
  /** The polyline's points. A closed ring does **not** repeat its first. */
  readonly points: readonly Point2D[];
  /** Whether a segment runs from the last point back to the first. */
  readonly closed: boolean;
}

/**
 * The geometric half of §58's `StrokeStyle`: everything about a stroke that
 * decides where its triangles are, and nothing about what colour they are.
 *
 * `@four/render`'s `StrokeStyle` is this record plus a §58 `Paint`, which is
 * why the two halves have one name each rather than one type with a hole in
 * it.
 */
export interface StrokeGeometryOptions {
  /** Total width of the band in world units; finite and positive (§85). */
  readonly width: number;
  /**
   * Greatest distance a round join or cap may stray from the true arc, in
   * world units — the same quantity `Path.flatten` takes.
   *
   * **Required**, deliberately. A default here would be a second spelling of
   * §51's `DEFAULT_FLATTEN_TOLERANCE` that has to be kept equal to it by hand,
   * and §52's module is otherwise free of any dependency on §51's; more to the
   * point, every caller already flattened something to get the polylines it is
   * passing, and stroking at a coarser tolerance than that flattening puts
   * visible facets on the joins of a curve that has none.
   */
  readonly tolerance: number;
  /** Which side of the path the band sits on; defaults to `center`. */
  readonly alignment?: StrokeAlignment;
  /** How open ends are finished; defaults to `butt`. */
  readonly lineCap?: StrokeLineCap;
  /** How corners are filled; defaults to `miter`. */
  readonly lineJoin?: StrokeLineJoin;
  /**
   * Ratio of miter length to stroke width past which a `miter` join is drawn
   * as a `bevel`; at least 1, defaults to {@link DEFAULT_MITER_LIMIT}.
   */
  readonly miterLimit?: number;
  /**
   * Alternating on/off lengths in world units, walked along the path (§50
   * "dashes and dash offset"). Omit for a solid stroke.
   *
   * An odd number of entries is repeated to make it even, SVG's rule: `[4]` is
   * `[4, 4]`. Entries must be finite and non-negative and must not all be zero.
   * A zero-length "on" entry draws **nothing** — SVG's `[0, 4]` dot pattern
   * needs a lone point to become a round cap, and a lone point strokes to
   * nothing here for the reason {@link expandStroke} states.
   */
  readonly dash?: readonly number[];
  /** How far into the pattern the path starts; defaults to 0. May be negative. */
  readonly dashOffset?: number;
}

/**
 * An expanded stroke: vertices in the XY plane and the triangles over them.
 *
 * The same division of labour {@link triangulatePolygon} draws — this function
 * has to place its own vertices, because a stroke's vertices do not exist
 * until it is expanded — with the same guarantee about the triangles: every
 * one is **counter-clockwise seen from +Z** (§7a).
 */
export interface StrokeMesh {
  /** The band's vertices. */
  readonly positions: readonly Point2D[];
  /** Three indices into {@link StrokeMesh.positions} per triangle. */
  readonly indices: GeometryIndexArray;
}

/**
 * Expands polylines into the triangles of their stroke (§52 "stroke
 * expansion", §58 `StrokeStyle`).
 *
 * ```ts
 * const mesh = expandStroke(
 *   [{ points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], closed: false }],
 *   { width: 0.2, tolerance: 0.01, lineJoin: "round", lineCap: "square" },
 * );
 * mesh.indices.length / 3; // triangles: two quads, a round join, two caps
 * ```
 *
 * ## What it draws
 *
 * One quad per segment, offset to {@link StrokeGeometryOptions.alignment}'s
 * side; one join at every interior vertex, and at *every* vertex of a closed
 * ring; one cap at each end of an open polyline. Joins and caps are drawn on
 * the corner's **outer** side only, which is the side a gap would otherwise
 * appear on — the inner side of a corner is covered by the two quads already,
 * twice.
 *
 * That double coverage is this function's one honest defect, and it is stated
 * rather than worked around: under an opaque paint it is invisible, and under
 * a translucent one the inside of every corner blends twice. The exact answer
 * is a boolean union of the band with itself, which is the same
 * planar-subdivision pass §52's self-intersection row waits on — see this
 * module's header. `alignment: "outside"` on a convex outline avoids it
 * entirely, because no corner's inner side is on the drawn side.
 *
 * ## Joins
 *
 * A `miter` join extends both outer edges to their intersection, and falls
 * back to `bevel` when the resulting spike is longer than
 * {@link StrokeGeometryOptions.miterLimit} times the width — the SVG rule,
 * and the reason the limit exists at all: at a hairpin the intersection runs
 * off to infinity. A `bevel` join is the one triangle across the gap; a
 * `round` join is a fan whose chords stay within
 * {@link StrokeGeometryOptions.tolerance} of the true arc, the same sagitta
 * bound `Path.flatten` uses on an arc command.
 *
 * A hairpin — two segments doubling exactly back on each other — has no
 * bevel and no miter, only a round join; with the other two it leaves the
 * notch its geometry actually has, rather than a wedge nobody asked for.
 *
 * ## What contributes nothing
 *
 * A polyline of fewer than two distinct points strokes to **nothing**, and is
 * dropped rather than refused: `Path.flatten` returns a lone `moveTo` as a
 * single point and says explicitly that it is not the operation that gets to
 * decide whether that is a dot, and this is that operation deciding — a dot is
 * a `Circle`, and inventing one here would make every stray `moveTo` in an
 * imported document sprout a blob. Consecutive duplicate points are dropped
 * for the same reason: a zero-length segment has no direction to offset along.
 * Non-finite coordinates are refused (§85).
 *
 * @param polylines The polylines to stroke, in any order; each is expanded
 *   independently and their triangles are concatenated.
 * @param options The band's geometry — see {@link StrokeGeometryOptions}.
 */
export function expandStroke(
  polylines: readonly Polyline2D[],
  options: StrokeGeometryOptions,
): StrokeMesh {
  const width = requirePositive("expandStroke width", options.width);
  const tolerance = requirePositive(
    "expandStroke tolerance",
    options.tolerance,
  );
  const miterLimit = options.miterLimit ?? DEFAULT_MITER_LIMIT;
  if (!Number.isFinite(miterLimit) || miterLimit < 1) {
    throw new RangeError(
      `expandStroke miterLimit must be a finite number of at least 1; got ` +
        `${String(miterLimit)} (§85).`,
    );
  }
  const dashOffset = options.dashOffset ?? 0;
  if (!Number.isFinite(dashOffset)) {
    throw new RangeError(
      `expandStroke dashOffset must be finite; got ${String(dashOffset)} (§85).`,
    );
  }
  const dash =
    options.dash === undefined ? undefined : normalizeDash(options.dash);

  // The band as two signed distances along the left normal. `inside` is the
  // whole width to the left, `outside` the whole width to the right, `center`
  // half of each — see StrokeAlignment for why left is the inside of a
  // counter-clockwise ring.
  const alignment = options.alignment ?? "center";
  const left =
    alignment === "inside" ? width : alignment === "outside" ? 0 : width / 2;
  const right = left - width;

  const builder = new StrokeBuilder(
    left,
    right,
    options.lineCap ?? "butt",
    options.lineJoin ?? "miter",
    miterLimit,
    tolerance,
  );
  for (const polyline of polylines) {
    const cleaned = cleanPolyline(polyline);
    if (cleaned === undefined) {
      continue;
    }
    if (dash === undefined) {
      builder.add(cleaned);
    } else {
      for (const piece of dashPolyline(cleaned, dash, dashOffset)) {
        const cleanedPiece = cleanPolyline(piece);
        if (cleanedPiece !== undefined) {
          builder.add(cleanedPiece);
        }
      }
    }
  }
  return builder.finish();
}

/** Validates a dash pattern and evens its length, SVG's rule (§85). */
function normalizeDash(dash: readonly number[]): number[] {
  if (dash.length === 0) {
    throw new RangeError(
      "expandStroke dash must contain at least one length; omit the option " +
        "for a solid stroke (§85).",
    );
  }
  let total = 0;
  for (let i = 0; i < dash.length; i += 1) {
    const value = dash[i];
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `expandStroke dash[${String(i)}] must be a finite non-negative ` +
          `number; got ${String(value)} (§85).`,
      );
    }
    total += value;
  }
  if (total <= 0) {
    throw new RangeError(
      "expandStroke dash lengths must not all be zero — a pattern of length " +
        "zero never advances (§85).",
    );
  }
  return dash.length % 2 === 0 ? dash.slice() : dash.concat(dash);
}

/**
 * Validates a polyline and drops what cannot be stroked (§85), or `undefined`
 * when nothing is left: non-finite coordinates are refused, consecutive
 * duplicates and a closed ring's repeated first point are removed.
 */
function cleanPolyline(polyline: Polyline2D): Polyline2D | undefined {
  const points: Point2D[] = [];
  for (let i = 0; i < polyline.points.length; i += 1) {
    const point = polyline.points[i];
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new RangeError(
        `expandStroke point ${String(i)} must be finite; got ` +
          `(${String(point.x)}, ${String(point.y)}) (§85).`,
      );
    }
    const previous = points[points.length - 1];
    if (
      previous === undefined ||
      previous.x !== point.x ||
      previous.y !== point.y
    ) {
      points.push({ x: point.x, y: point.y });
    }
  }
  // `if`, not `while`: two trailing points equal to the first would be equal
  // to each other, and the loop above already dropped one of them.
  if (
    polyline.closed &&
    points.length > 1 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y
  ) {
    points.pop();
  }
  return points.length < 2 ? undefined : { points, closed: polyline.closed };
}

/**
 * Cuts a polyline into the "on" pieces of a dash pattern, walking arc length
 * from `offset` (§50 "dashes and dash offset").
 *
 * The pieces are open even when the input ring is closed — a dashed circle is
 * a sequence of arcs with two caps each. The one exception is a pattern that
 * never toggles over the whole ring: it comes back as the ring itself, still
 * closed, so a dash long enough to cover a circle draws a circle rather than a
 * circle with a seam. When the pattern is "on" across the ring's seam the
 * first and last pieces are joined for the same reason.
 */
function dashPolyline(
  polyline: Polyline2D,
  pattern: readonly number[],
  offset: number,
): Polyline2D[] {
  const points = polyline.points;
  const count = points.length;
  const segments = polyline.closed ? count : count - 1;
  let total = 0;
  for (const value of pattern) {
    total += value;
  }

  // Where in the pattern the path starts. A positive offset moves the pattern
  // *backwards* along the path, SVG's sense: the dash that would have started
  // at `offset` starts at 0.
  let phase = offset % total;
  if (phase < 0) {
    phase += total;
  }
  let index = 0;
  while (phase >= pattern[index]) {
    phase -= pattern[index];
    index = (index + 1) % pattern.length;
  }
  let remaining = pattern[index] - phase;
  let on = index % 2 === 0;
  const startedOn = on;

  const pieces: Polyline2D[] = [];
  let current: Point2D[] = on ? [points[0]] : [];
  let toggled = false;
  for (let s = 0; s < segments; s += 1) {
    const a = points[s];
    const b = points[(s + 1) % count];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    let walked = 0;
    while (length - walked > remaining) {
      walked += remaining;
      const t = walked / length;
      const cut = { x: a.x + dx * t, y: a.y + dy * t };
      if (on) {
        current.push(cut);
        pieces.push({ points: current, closed: false });
        current = [];
      } else {
        current = [cut];
      }
      on = !on;
      toggled = true;
      index = (index + 1) % pattern.length;
      remaining = pattern[index];
    }
    remaining -= length - walked;
    if (on) {
      current.push(b);
    }
  }

  if (!toggled) {
    return on ? [polyline] : [];
  }
  if (current.length > 1) {
    // A ring whose pattern is "on" across the seam: the tail belongs to the
    // head, or it would be two dashes with two spurious caps at the join.
    // `pieces` cannot be empty here — starting "on" means the first toggle
    // closed a piece, and `toggled` says a toggle happened.
    if (polyline.closed && startedOn) {
      pieces[0] = {
        points: current.concat(pieces[0].points.slice(1)),
        closed: false,
      };
    } else {
      pieces.push({ points: current, closed: false });
    }
  }
  return pieces;
}

/**
 * Accumulates one stroke's triangles.
 *
 * Vertices are created as they are needed and shared only inside the piece
 * that created them — a quad shares its four, a round fan shares its centre.
 * Sharing them *between* pieces would mean an index of the previous segment's
 * end offsets, which are the same points only when the join is a miter that
 * did not fall back; the bookkeeping costs more than the vertices.
 */
class StrokeBuilder {
  readonly #positions: Point2D[] = [];

  readonly #indices: number[] = [];

  readonly #left: number;

  readonly #right: number;

  readonly #lineCap: StrokeLineCap;

  readonly #lineJoin: StrokeLineJoin;

  readonly #miterLimit: number;

  readonly #tolerance: number;

  constructor(
    left: number,
    right: number,
    lineCap: StrokeLineCap,
    lineJoin: StrokeLineJoin,
    miterLimit: number,
    tolerance: number,
  ) {
    this.#left = left;
    this.#right = right;
    this.#lineCap = lineCap;
    this.#lineJoin = lineJoin;
    this.#miterLimit = miterLimit;
    this.#tolerance = tolerance;
  }

  /** Expands one cleaned polyline: quads, then joins, then caps. */
  add(polyline: Polyline2D): void {
    const points = polyline.points;
    const count = points.length;
    const segments = polyline.closed ? count : count - 1;

    // Unit direction and left normal of every segment, once: the joins need
    // both of their neighbours' and recomputing them is the only place this
    // routine could disagree with itself about where an edge is.
    const directionX: number[] = [];
    const directionY: number[] = [];
    for (let s = 0; s < segments; s += 1) {
      const a = points[s];
      const b = points[(s + 1) % count];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      directionX.push(dx / length);
      directionY.push(dy / length);
    }

    for (let s = 0; s < segments; s += 1) {
      const a = points[s];
      const b = points[(s + 1) % count];
      const nx = -directionY[s];
      const ny = directionX[s];
      this.#quad(
        { x: a.x + nx * this.#left, y: a.y + ny * this.#left },
        { x: a.x + nx * this.#right, y: a.y + ny * this.#right },
        { x: b.x + nx * this.#left, y: b.y + ny * this.#left },
        { x: b.x + nx * this.#right, y: b.y + ny * this.#right },
      );
    }

    const first = polyline.closed ? 0 : 1;
    const last = polyline.closed ? count - 1 : count - 2;
    for (let v = first; v <= last; v += 1) {
      const incoming = (v - 1 + segments) % segments;
      this.#join(points[v], incoming, v % segments, directionX, directionY);
    }

    if (!polyline.closed) {
      const end = segments - 1;
      this.#cap(
        points[0],
        0,
        -directionX[0],
        -directionY[0],
        directionX,
        directionY,
      );
      this.#cap(
        points[count - 1],
        end,
        directionX[end],
        directionY[end],
        directionX,
        directionY,
      );
    }
  }

  /** The mesh, with the narrowest index type that can address it. */
  finish(): StrokeMesh {
    const indices = createIndices(this.#indices.length, this.#positions.length);
    indices.set(this.#indices);
    return { positions: this.#positions, indices };
  }

  /**
   * Fills the outer side of the corner at `vertex` between two segments.
   *
   * Which side is outer is the sign of the turn: a left turn leaves the gap on
   * the right. When the band does not reach that side at all — `inside`
   * alignment at a right turn, `outside` at a left one — both offset points
   * are the vertex itself and there is nothing to fill, which falls out of the
   * arithmetic rather than needing a case.
   */
  #join(
    vertex: Point2D,
    incoming: number,
    outgoing: number,
    directionX: readonly number[],
    directionY: readonly number[],
  ): void {
    const d0x = directionX[incoming];
    const d0y = directionY[incoming];
    const d1x = directionX[outgoing];
    const d1y = directionY[outgoing];
    const turn = d0x * d1y - d0y * d1x;
    const cosine = d0x * d1x + d0y * d1y;
    let offset = turn > 0 ? this.#right : this.#left;
    if (offset === 0 && turn === 0 && cosine < 0) {
      // A hairpin has no outer side — both bands double back through the same
      // corner — so the join goes on whichever side the band occupies. Only
      // `outside` alignment reaches here: a hairpin's `turn` is zero, so the
      // offset above is the *left* edge, and the only alignment whose left
      // edge is on the path is `outside`, whose band is on the right.
      offset = this.#right;
    }
    if (offset === 0) {
      return;
    }
    const n0x = -d0y;
    const n0y = d0x;
    const n1x = -d1y;
    const n1y = d1x;
    const a = { x: vertex.x + n0x * offset, y: vertex.y + n0y * offset };
    const b = { x: vertex.x + n1x * offset, y: vertex.y + n1y * offset };

    if (this.#lineJoin === "round") {
      // The rotation taking `a - vertex` onto `b - vertex` is the rotation
      // taking `n0` onto `n1`, whatever the offset scales them by: its sine is
      // the turn and its cosine the segments' dot product. The `turn === 0`
      // arm is the hairpin, whose half turn bulges past the tip.
      const angle = arcAngle(cosine);
      this.#arcFan(
        vertex,
        a,
        turn > 0 || (turn === 0 && offset < 0) ? angle : -angle,
      );
      return;
    }
    if (this.#lineJoin === "miter") {
      const mx = n0x + n1x;
      const my = n0y + n1y;
      const length = Math.sqrt(mx * mx + my * my);
      if (length > 0) {
        // `cosHalf` is the cosine of half the angle between the two outer
        // normals, which is `sin(θ/2)` for the angle θ between the segments —
        // so `1 / cosHalf` is exactly SVG's miter-length-over-width ratio. It
        // is never negative (it is `√((1 + n0·n1) / 2)`), so the limit alone
        // decides: at a hairpin it is zero, `1 / 0` is `Infinity`, and every
        // finite limit bevels.
        const cosHalf = (mx * n0x + my * n0y) / length;
        if (1 / cosHalf <= this.#miterLimit) {
          const scale = offset / cosHalf / length;
          this.#triangle(vertex, a, {
            x: vertex.x + mx * scale,
            y: vertex.y + my * scale,
          });
          this.#triangle(
            vertex,
            { x: vertex.x + mx * scale, y: vertex.y + my * scale },
            b,
          );
          return;
        }
      }
    }
    this.#triangle(vertex, a, b);
  }

  /**
   * Finishes an open end at `point`, where `segment` is the segment reaching
   * it and `outward` points away from the band along that segment.
   *
   * The cap is built on the band's **end edge**: the midpoint of that edge is
   * the centre of a round cap and half the width is its radius, and a square
   * cap extends the edge by the same half width. Stating it that way is what
   * makes `inside` and `outside` alignment cap correctly without a second
   * rule — the edge is wherever the alignment put it, and the cap follows.
   */
  #cap(
    point: Point2D,
    segment: number,
    outwardX: number,
    outwardY: number,
    directionX: readonly number[],
    directionY: readonly number[],
  ): void {
    if (this.#lineCap === "butt") {
      return;
    }
    const nx = -directionY[segment];
    const ny = directionX[segment];
    const leftPoint = {
      x: point.x + nx * this.#left,
      y: point.y + ny * this.#left,
    };
    const rightPoint = {
      x: point.x + nx * this.#right,
      y: point.y + ny * this.#right,
    };
    const half = (this.#left - this.#right) / 2;
    if (this.#lineCap === "square") {
      const extentX = outwardX * half;
      const extentY = outwardY * half;
      this.#quad(
        leftPoint,
        rightPoint,
        { x: leftPoint.x + extentX, y: leftPoint.y + extentY },
        { x: rightPoint.x + extentX, y: rightPoint.y + extentY },
      );
      return;
    }
    // The half turn from the left edge to the right edge that bulges *outward*
    // is the one whose sign is the sign of the turn from the band's normal
    // onto `outward` — which is +1 at a start cap and −1 at an end one.
    const turn = nx * outwardY - ny * outwardX;
    this.#arcFan(
      {
        x: (leftPoint.x + rightPoint.x) / 2,
        y: (leftPoint.y + rightPoint.y) / 2,
      },
      leftPoint,
      turn > 0 ? Math.PI : -Math.PI,
    );
  }

  /**
   * Emits a triangle fan of `sweep` radians about `centre`, starting at
   * `start`, with chords no further than the tolerance from the true arc.
   */
  #arcFan(centre: Point2D, start: Point2D, sweep: number): void {
    const dx = start.x - centre.x;
    const dy = start.y - centre.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius === 0 || sweep === 0) {
      return;
    }
    const steps = Math.min(
      MAX_FAN_STEPS,
      Math.max(
        1,
        Math.ceil(Math.abs(sweep) / arcStep(radius, this.#tolerance)),
      ),
    );
    const cosStep = Math.cos(sweep / steps);
    const sinStep = Math.sin(sweep / steps);
    let x = dx;
    let y = dy;
    const centreIndex = this.#push(centre);
    let previous = this.#push(start);
    for (let i = 0; i < steps; i += 1) {
      const nextX = x * cosStep - y * sinStep;
      const nextY = x * sinStep + y * cosStep;
      x = nextX;
      y = nextY;
      const next = this.#push({ x: centre.x + x, y: centre.y + y });
      this.#emit(centreIndex, previous, next);
      previous = next;
    }
  }

  /** Two triangles over four corners: `a`/`b` at one end, `c`/`d` at the other. */
  #quad(a: Point2D, b: Point2D, c: Point2D, d: Point2D): void {
    const ai = this.#push(a);
    const bi = this.#push(b);
    const ci = this.#push(c);
    const di = this.#push(d);
    this.#emit(ai, bi, di);
    this.#emit(ai, di, ci);
  }

  /**
   * One triangle over three fresh vertices, or nothing at all when the three
   * are collinear — a bevel across a straight corner, or across a hairpin,
   * whose two offset points sit on a diameter through the vertex.
   */
  #triangle(a: Point2D, b: Point2D, c: Point2D): void {
    if (orient(a.x, a.y, b.x, b.y, c.x, c.y) === 0) {
      return;
    }
    this.#emit(this.#push(a), this.#push(b), this.#push(c));
  }

  #push(point: Point2D): number {
    this.#positions.push(point);
    return this.#positions.length - 1;
  }

  /**
   * Records one triangle wound counter-clockwise (§7a), whichever way round it
   * was built — a fan swept negatively builds its triangles clockwise, and a
   * bevel's winding follows the corner's.
   */
  #emit(i: number, j: number, k: number): void {
    const a = this.#positions[i];
    const b = this.#positions[j];
    const c = this.#positions[k];
    if (orient(a.x, a.y, b.x, b.y, c.x, c.y) < 0) {
      this.#indices.push(i, k, j);
    } else {
      this.#indices.push(i, j, k);
    }
  }
}

/**
 * Hard ceiling on the chords of one round join or cap — a **termination
 * guarantee, not a quality target**, in `MAX_SUBDIVISION_DEPTH`'s sense.
 *
 * `arcStep` can only return zero when `tolerance / radius` underflows, which
 * asks for a chord finer than the coordinates can express; without a cap the
 * step count would be `Infinity` and the fan would never end.
 */
const MAX_FAN_STEPS = 4096;

/**
 * The angle whose cosine is `cosine`, clamped into `acos`'s domain — the
 * cosine comes from a dot product of two unit vectors and may sit an ulp
 * outside it.
 */
function arcAngle(cosine: number): number {
  return Math.acos(Math.max(-1, Math.min(1, cosine)));
}

/**
 * Largest angular step whose chord's sagitta stays within `tolerance` on a
 * circle of radius `radius` — `flattenArc`'s bound, restated for a fan that
 * has no path command to read it from, and capped at a third of a turn for the
 * same reason (a full circle must not become a triangle).
 */
function arcStep(radius: number, tolerance: number): number {
  const ratio = 1 - tolerance / radius;
  return ratio <= -1
    ? (Math.PI * 2) / 3
    : Math.min((Math.PI * 2) / 3, 2 * Math.acos(ratio));
}
