/**
 * Unit tests for §52's polygon tessellator and for `polygonGeometry2D` (R-25).
 *
 * ## The oracle, and why it is not a list of indices
 *
 * A golden index list would pin *an* answer without saying whether the answer
 * is a triangulation. Three properties do say it, and they need no ground truth
 * beyond the input:
 *
 * 1. **Every triangle is counter-clockwise** (§7a) — the sign of its own cross
 *    product, recomputed here rather than taken from the tessellator.
 * 2. **The triangles tile the region**: their areas sum to the shoelace area of
 *    the outline minus the shoelace areas of the holes. Since (1) has already
 *    shown every area positive, a sum that matches cannot hide an overlap paid
 *    for by a gap — and a triangulation that strayed outside the region would
 *    overshoot. Together these are exactly the failure modes a wrong ear clip
 *    produces.
 * 3. **Every index addresses a real input vertex**, and the outline's own
 *    winding does not change any of the above.
 *
 * {@link assertTriangulates} is those three, and most tests below are one call
 * to it on a shape chosen for what it stresses. The exact index list *is* pinned
 * — once, in `tests/determinism/tessellation.test.ts`, where the question is
 * reproducibility rather than correctness.
 *
 * ## Refusals get their own block
 *
 * Every §85 refusal the module can raise is exercised, including the two that
 * only a bridged multi-hole shape can reach. That is deliberate: a refusal
 * nobody tests is a refusal nobody has read, and this module's whole claim is
 * that it says no loudly rather than emitting overlapping triangles.
 */

import { describe, expect, it } from "vitest";

import {
  earClippingTessellator,
  polygonGeometry2D,
  triangulatePolygon,
  type Point2D,
} from "../src/index.js";

/** Builds a ring from a flat `x, y, x, y, …` list — one line per shape. */
function ring(...coordinates: readonly number[]): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i < coordinates.length; i += 2) {
    points.push({ x: coordinates[i], y: coordinates[i + 1] });
  }
  return points;
}

/** Twice the signed area of a ring; positive when counter-clockwise. */
function doubleArea(points: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Runs the three-property oracle and returns the triangle count, so a test can
 * additionally pin the count when the count is the point.
 */
function assertTriangulates(
  outline: readonly Point2D[],
  holes: readonly (readonly Point2D[])[] = [],
): number {
  const indices = triangulatePolygon(outline, holes);
  const points = [outline, ...holes].flat();

  expect(indices.length % 3, "index count is a multiple of 3").toBe(0);
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    expect(indices[i]).toBeLessThan(points.length);
    expect(indices[i + 1]).toBeLessThan(points.length);
    expect(indices[i + 2]).toBeLessThan(points.length);
    const a = points[indices[i]];
    const b = points[indices[i + 1]];
    const c = points[indices[i + 2]];
    const twice = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    expect(
      twice,
      `triangle ${String(i / 3)} winds counter-clockwise`,
    ).toBeGreaterThan(0);
    area += twice;
  }

  const expected =
    Math.abs(doubleArea(outline)) -
    holes.reduce((sum, hole) => sum + Math.abs(doubleArea(hole)), 0);
  expect(area, "the triangles tile the region exactly").toBeCloseTo(
    expected,
    10,
  );
  return indices.length / 3;
}

/** A square, counter-clockwise, spanning `[-1, 1]²`. */
const SQUARE = ring(-1, -1, 1, -1, 1, 1, -1, 1);

/** An L: the smallest outline a centroid fan cannot cap. */
const L_SHAPE = ring(0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2);

describe("triangulatePolygon (§52)", () => {
  it("triangulates a convex outline into n − 2 triangles", () => {
    expect(assertTriangulates(SQUARE)).toBe(2);
    expect(assertTriangulates(ring(0, 0, 4, 0, 4, 3, 2, 5, 0, 3))).toBe(3);
  });

  it("accepts either winding, and answers the same shape", () => {
    const clockwise = [...SQUARE].reverse();
    expect(doubleArea(clockwise)).toBeLessThan(0);
    expect(assertTriangulates(clockwise)).toBe(2);
  });

  it("triangulates a concave outline — the case the fan could not cap", () => {
    expect(assertTriangulates(L_SHAPE)).toBe(4);
  });

  it("triangulates an outline with many reflex vertices", () => {
    // A comb: three teeth, five reflex corners. The shape ear clipping is
    // classically criticised for, and the one a fan gets catastrophically
    // wrong. One point per line — the layout is the picture, hence the ignore.
    // prettier-ignore
    const comb = ring(
      0, 0,  6, 0,  6, 3,
      5, 3,  5, 1,
      4, 1,  4, 3,
      3, 3,  3, 1,
      2, 1,  2, 3,
      1, 3,  1, 1,
      0, 1,
    );
    expect(assertTriangulates(comb)).toBe(comb.length - 2);
  });

  it("triangulates a star, whose spikes are alternately convex and reflex", () => {
    const star: Point2D[] = [];
    for (let i = 0; i < 10; i += 1) {
      // Coordinates are rounded to a grid so the fixture is exact rather than
      // a transcendental the test would then have to compare with a tolerance.
      const angle = (Math.PI * 2 * i) / 10;
      const radius = i % 2 === 0 ? 100 : 40;
      star.push({
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius),
      });
    }
    expect(assertTriangulates(star)).toBe(8);
  });

  it("drops a vertex collinear with its neighbours, and says so in the count", () => {
    // Five points, one of them the midpoint of an edge: four effective corners,
    // so two triangles rather than three. The caller's array is untouched.
    const withMidpoint = ring(-1, -1, 0, -1, 1, -1, 1, 1, -1, 1);
    expect(assertTriangulates(withMidpoint)).toBe(2);
    expect(withMidpoint).toHaveLength(5);
  });

  it("returns indices into the concatenation of outline then holes", () => {
    const hole = ring(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5);
    const indices = triangulatePolygon(SQUARE, [hole]);
    expect(Math.max(...indices)).toBe(SQUARE.length + hole.length - 1);
    expect(Math.min(...indices)).toBe(0);
    // Every vertex of both rings is used: a ring's worth of quad has no
    // redundant corner to drop.
    expect(new Set(indices).size).toBe(SQUARE.length + hole.length);
  });

  it("cuts one hole out, in either hole winding", () => {
    const clockwiseHole = ring(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5);
    const counterClockwiseHole = [...clockwiseHole].reverse();
    expect(assertTriangulates(SQUARE, [clockwiseHole])).toBe(8);
    expect(assertTriangulates(SQUARE, [counterClockwiseHole])).toBe(8);
  });

  it("cuts several holes out", () => {
    const frame = ring(-4, -2, 4, -2, 4, 2, -4, 2);
    const left = ring(-3, -1, -3, 1, -2, 1, -2, -1);
    const right = ring(2, -1, 2, 1, 3, 1, 3, -1);
    // Ring size is outline + holes + two duplicated vertices per bridge, and a
    // ring of `k` vertices yields `k − 2` triangles.
    expect(assertTriangulates(frame, [left, right])).toBe(
      frame.length + left.length + right.length + 2 * 2 - 2,
    );
  });

  it("orders equally-rightmost holes by input index, not by luck", () => {
    // Both holes end at x = 3, so the merge order is decided by the
    // comparator's integer tie-break. Two runs that disagreed here would give
    // two different (both valid) triangulations — which is exactly the kind of
    // "deterministic on this engine" that §33 rules out.
    const frame = ring(-4, -4, 4, -4, 4, 4, -4, 4);
    const lower = ring(1, -3, 3, -3, 3, -1, 1, -1);
    const upper = ring(1, 1, 3, 1, 3, 3, 1, 3);
    expect(assertTriangulates(frame, [lower, upper])).toBe(
      frame.length + lower.length + upper.length + 2 * 2 - 2,
    );
    expect([...triangulatePolygon(frame, [lower, upper])]).toEqual([
      ...triangulatePolygon(frame, [lower, upper]),
    ]);
    // Swapping the two holes swaps their vertex block, so the index list is
    // allowed to differ — what must not differ is the shape it describes.
    expect(assertTriangulates(frame, [upper, lower])).toBe(
      frame.length + lower.length + upper.length + 2 * 2 - 2,
    );
  });

  it("bridges a hole that only an already-bridged seam can reach", () => {
    // The second hole's nearest clear target is a vertex the first hole's
    // bridge already uses, so the fallback in `findBridgeTarget` is what makes
    // this shape tessellate at all.
    const outline = ring(-6, -6, 6, -6, 6, 6, -6, 6);
    const outer = ring(-4, -4, -4, 4, 4, 4, 4, -4);
    expect(() => triangulatePolygon(outline, [outer])).not.toThrow();
    expect(assertTriangulates(outline, [outer])).toBe(8);
  });

  it("emits the same narrowest index type the other builders do", () => {
    // The 32-bit arm belongs to `createIndices` and is exercised where it is
    // cheap to reach; reaching it *here* means a 65 537-point polygon, and
    // both the simplicity proof and the clip are O(n²), so that fixture would
    // cost a minute of suite time to re-test one shared branch.
    expect(triangulatePolygon(SQUARE)).toBeInstanceOf(Uint16Array);
  });

  it("is exposed as a replaceable PolygonTessellator", () => {
    expect(earClippingTessellator.name).toBe("ear-clipping");
    expect([...earClippingTessellator.triangulate(SQUARE)]).toEqual([
      ...triangulatePolygon(SQUARE),
    ]);
  });

  it("produces byte-identical output for identical input", () => {
    const hole = ring(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5);
    const first = triangulatePolygon(SQUARE, [hole]);
    const second = triangulatePolygon(SQUARE, [hole]);
    expect([...second]).toEqual([...first]);
    // …and the input is untouched: the tessellator normalizes winding by
    // walking, not by reversing the caller's array (§85, no silent rewrites).
    expect(SQUARE[0]).toEqual({ x: -1, y: -1 });
  });
});

describe("triangulatePolygon refusals (§85)", () => {
  it("refuses a ring of fewer than three points", () => {
    expect(() => triangulatePolygon(ring(0, 0, 1, 1))).toThrow(
      /outline needs at least 3 points/i,
    );
    expect(() => triangulatePolygon(SQUARE, [ring(0, 0, 1, 1)])).toThrow(
      /Hole 0 needs at least 3 points/,
    );
  });

  it("refuses a non-finite coordinate, in the outline or in a hole", () => {
    expect(() => triangulatePolygon(ring(0, 0, 1, 0, Number.NaN, 1))).toThrow(
      /outline has a non-finite point at index 2/i,
    );
    expect(() =>
      triangulatePolygon(SQUARE, [
        ring(0, 0, 0.1, 0, 0.1, Number.POSITIVE_INFINITY),
      ]),
    ).toThrow(/Hole 0 has a non-finite point at index 2/);
  });

  it("refuses a repeated point and a spike", () => {
    expect(() => triangulatePolygon(ring(0, 0, 0, 0, 2, 0, 1, 2))).toThrow(
      /repeats the point at index 0/,
    );
    expect(() => triangulatePolygon(ring(0, 0, 2, 0, 1, 0, 1, 2))).toThrow(
      /doubles back on itself at index 1/,
    );
  });

  it("refuses a ring enclosing no area", () => {
    // A symmetric figure-of-eight: two lobes of equal area, opposite signs.
    expect(() => triangulatePolygon(ring(0, 0, 2, 0, 0, 2, 2, 2))).toThrow(
      /must enclose a non-zero area/,
    );
  });

  it("refuses a self-intersecting outline rather than triangulating it", () => {
    // A pentagram. Every corner passes the local convexity test, which is
    // exactly why a clipper without this check reports success on it.
    const pentagram: Point2D[] = [];
    for (let i = 0; i < 5; i += 1) {
      const angle = (Math.PI * 2 * ((i * 2) % 5)) / 5;
      pentagram.push({
        x: Math.round(Math.cos(angle) * 1000),
        y: Math.round(Math.sin(angle) * 1000),
      });
    }
    expect(() => triangulatePolygon(pentagram)).toThrow(/is not simple/);
  });

  it("refuses rings that merely touch, and a hole crossing its outline", () => {
    // Vertex-on-edge: the hole's corner sits exactly on the outline's bottom.
    expect(() =>
      triangulatePolygon(SQUARE, [ring(-0.5, -1, 0.5, -0.5, 0, -0.2)]),
    ).toThrow(/is not simple/);
    // Crossing: half the hole is outside.
    expect(() =>
      triangulatePolygon(SQUARE, [ring(0.5, -2, 2, 0.5, 0.5, 0.5)]),
    ).toThrow(/is not simple/);
    // Two holes sharing a corner.
    expect(() =>
      triangulatePolygon(SQUARE, [
        ring(-0.8, -0.8, 0, 0, -0.8, 0.2),
        ring(0, 0, 0.8, 0.8, 0.2, 0.8),
      ]),
    ).toThrow(/is not simple/);
  });

  it("refuses collinear segments that overlap without crossing", () => {
    // Both defects live on the y = 0 and x = 0 lines, which is what makes the
    // collinear arm of the intersection test — not the straddle arm — decide.
    expect(() =>
      triangulatePolygon(ring(0, 0, 3, 0, 3, 2, 1, 2, 1, 0, 2, 0, 2, 3, 0, 3)),
    ).toThrow(/is not simple/);
  });

  it("refuses a hole outside its outline", () => {
    expect(() => triangulatePolygon(SQUARE, [ring(5, 5, 6, 5, 6, 6)])).toThrow(
      /Hole 0 is not inside the outline/,
    );
  });

  it("refuses a hole nested inside another hole", () => {
    expect(() =>
      triangulatePolygon(ring(-8, -8, 8, -8, 8, 8, -8, 8), [
        ring(-4, -4, 4, -4, 4, 4, -4, 4),
        ring(-1, -1, 1, -1, 1, 1, -1, 1),
      ]),
    ).toThrow(/No bridge joins the hole/);
  });

  it("refuses a multi-hole configuration whose seams leave no ear", () => {
    // Found by the fuzz recorded in the module header, and kept as the fixture
    // for the one §85 refusal that is a *limit* of the ear-clipping tier rather
    // than a defect in the input: this polygon is perfectly well formed. What
    // closes it is the split fallback or the monotone tier, both behind
    // `PolygonTessellator`.
    const outline = ring(14.25, 0, -3.75, 6.5, -4.75, -8.25);
    const lower = ring(-0.75, -5.25, 1.75, -5.25, 1.75, -2.75, -0.75, -2.75);
    const upper = ring(-1.25, -2.5, 0.25, -2.5, 0.25, -1.25, -1.25, -1.25);
    expect(() => triangulatePolygon(outline, [lower, upper])).toThrow(
      /found no ear/,
    );
  });
});

describe("polygonGeometry2D (§50 arbitrary polygon)", () => {
  it("lays vertices out in the XY plane in the caller's order", () => {
    const geometry = polygonGeometry2D({ outline: L_SHAPE });
    expect(geometry.vertexCount).toBe(L_SHAPE.length);
    expect(geometry.drawCount).toBe(4 * 3);
    for (let i = 0; i < L_SHAPE.length; i += 1) {
      expect(geometry.positions[i * 3]).toBe(L_SHAPE[i].x);
      expect(geometry.positions[i * 3 + 1]).toBe(L_SHAPE[i].y);
      expect(geometry.positions[i * 3 + 2]).toBe(0);
    }
    // 2D shapes are unlit in the §120 tier, so no normals — the same choice
    // `circleGeometry2D` makes.
    expect(geometry.normals).toBeUndefined();
  });

  it("maps uv to the outline's bounding box", () => {
    const geometry = polygonGeometry2D({
      outline: ring(0, 0, 4, 0, 4, 2, 0, 2),
    });
    expect([...(geometry.uvs ?? [])]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it("cuts holes, keeping every ring's vertices", () => {
    const hole = ring(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5);
    const geometry = polygonGeometry2D({ outline: SQUARE, holes: [hole] });
    expect(geometry.vertexCount).toBe(SQUARE.length + hole.length);
    expect(geometry.drawCount).toBe(8 * 3);
    // The hole's vertices follow the outline's, at their own positions.
    expect(geometry.positions[SQUARE.length * 3]).toBe(-0.5);
    expect(geometry.positions[SQUARE.length * 3 + 1]).toBe(-0.5);
    // Uv stays the outline's box, so the hole's rim lands inside [0, 1]².
    const uvs = geometry.uvs ?? new Float32Array();
    for (const value of uvs) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("refuses what the tessellator refuses, with the tessellator's error", () => {
    expect(() => polygonGeometry2D({ outline: ring(0, 0, 1, 1) })).toThrow(
      /at least 3 points/,
    );
  });
});
