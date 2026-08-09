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
 * §52 lists nine capabilities. Three are discharged by this module:
 *
 * - **concave polygons** — the whole point of the packet; the ear clipper
 *   handles any simple outline, convex or not;
 * - **holes** — bridged into the outline before clipping (see below);
 * - **index-buffer reuse** — {@link triangulatePolygon} emits *indices only*.
 *   It creates no vertices and takes no view on attributes, so one
 *   triangulation serves both caps of an extrusion, a fill and its outline, or
 *   the same shape drawn twice with different uv layouts.
 *
 * The other six are deliberately **not** here, each with a named home:
 *
 * - **adaptive curve subdivision** belongs to §51's `Path` (`flatten`,
 *   `subdivide` are §51 operations, not §52 ones): the tessellator's input is
 *   already a polyline, and the flattening tolerance is a property of the curve
 *   being flattened, not of the triangulation. It lands with the `Path` model
 *   (gap `R-24`).
 * - **stroke expansion** and **anti-alias fringe generation** need §58's paint
 *   model — joins, caps, alignment, dash phase — to have anything to expand
 *   *to*. They land with the paint packet (gap `R-16`); this module's name says
 *   "tessellation" only until then.
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
 * Every geometric decision in this module is a comparison against a value built
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
import { createIndices } from "./primitive-support.js";

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
