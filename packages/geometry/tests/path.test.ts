/**
 * Unit tests for §51's path model (`R-24`).
 *
 * ## What is asserted, and against what
 *
 * A flattener has an easy oracle and a hard one. The easy one — "these are the
 * points it produced" — pins an answer without saying whether the answer is the
 * curve; it belongs in `tests/determinism/path.test.ts`, where reproducibility
 * is the question. The hard one is the *contract*: the polyline stays within
 * `tolerance` of the true curve. So the Bézier tests sample the curve
 * analytically with de Casteljau written here, independently of the module, and
 * assert every sample is within tolerance of the flattening — which
 * incidentally exercises {@link Path.closestPoint}, the operation that measures
 * that distance.
 *
 * The arc tests use the same idea with the geometry an arc makes trivial: every
 * flattened vertex is exactly on the ellipse, and every chord's midpoint is
 * within the tolerance of it.
 *
 * The exact operations — subdivide, reverse, transform, simplify — are tested
 * against the property that defines them rather than against a command dump:
 * subdividing does not change the flattened shape, reversing twice is the
 * identity on the flattened shape, transforming and then flattening equals
 * flattening and then transforming.
 *
 * ## Refusals get their own block
 *
 * Every §85 refusal is exercised. A refusal nobody tests is a refusal nobody
 * has read, and half of this module's contract is what it says no to.
 */

import { Matrix3 } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FLATTEN_TOLERANCE,
  MAX_SUBDIVISION_DEPTH,
  Path,
  triangulatePolygon,
  type Point2D,
} from "../src/index.js";

/** Builds a ring from a flat `x, y, x, y, …` list. */
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

/** A cubic Bézier evaluated by de Casteljau — the independent oracle. */
function cubicAt(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number,
): Point2D {
  const lerp = (a: Point2D, b: Point2D): Point2D => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const c = lerp(p2, p3);
  return lerp(lerp(a, b), lerp(b, c));
}

/** A quadratic Bézier evaluated by de Casteljau. */
function quadraticAt(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  t: number,
): Point2D {
  const lerp = (a: Point2D, b: Point2D): Point2D => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  return lerp(lerp(p0, p1), lerp(p1, p2));
}

/** Distance from `point` to the polyline `points`, brute force. */
function distanceToPolyline(
  points: readonly Point2D[],
  point: Point2D,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const raw =
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
    const u = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const x = a.x + dx * u;
    const y = a.y + dy * u;
    best = Math.min(best, Math.hypot(point.x - x, point.y - y));
  }
  return best;
}

/** A closed unit-ish square, counter-clockwise, as a path. */
function square(): Path {
  return new Path().moveTo(0, 0).lineTo(4, 0).lineTo(4, 4).lineTo(0, 4).close();
}

describe("§51 construction", () => {
  it("records the six segment kinds §51 lists, in order", () => {
    const path = new Path()
      .moveTo(0, 0)
      .lineTo(100, 0)
      .quadraticCurveTo(150, 50, 100, 100)
      .cubicCurveTo(75, 125, 25, 125, 0, 100)
      .arc(0, 50, 25, 0, Math.PI)
      .close();

    expect(path.commands.map((command) => command.kind)).toEqual([
      "move",
      "line",
      "quadratic",
      "cubic",
      "arc",
      "close",
    ]);
    expect(path.isEmpty).toBe(false);
    expect(new Path().isEmpty).toBe(true);
  });

  it("stores an arc as a signed sweep rather than the end angle it was given", () => {
    const [, arc] = new Path().moveTo(1, 0).arc(0, 0, 1, 0, Math.PI).commands;
    expect(arc.kind).toBe("arc");
    if (arc.kind !== "arc") {
      throw new Error("unreachable");
    }
    expect(arc.deltaAngle).toBeCloseTo(Math.PI, 12);
    expect(arc.radiusX).toBe(1);
    expect(arc.radiusY).toBe(1);
    expect(arc.rotation).toBe(0);
  });

  it("normalizes every sweep into one turn, both directions", () => {
    const sweep = (
      start: number,
      end: number,
      counterclockwise: boolean,
    ): number => {
      const path = new Path().arc(0, 0, 1, start, end, counterclockwise);
      const command = path.commands[1];
      if (command.kind !== "arc") {
        throw new Error("unreachable");
      }
      return command.deltaAngle;
    };

    expect(sweep(0, Math.PI, false)).toBeCloseTo(Math.PI, 12);
    expect(sweep(0, 4 * Math.PI, false)).toBeCloseTo(2 * Math.PI, 12);
    expect(sweep(0, -Math.PI / 2, false)).toBeCloseTo(1.5 * Math.PI, 12);
    expect(sweep(0, -Math.PI, true)).toBeCloseTo(-Math.PI, 12);
    expect(sweep(0, -4 * Math.PI, true)).toBeCloseTo(-2 * Math.PI, 12);
    expect(sweep(0, Math.PI / 2, true)).toBeCloseTo(-1.5 * Math.PI, 12);
  });

  it("opens a subpath at an arc's first point when there is no current point", () => {
    const path = new Path().arc(10, 0, 5, 0, Math.PI / 2);
    const [move] = path.commands;
    expect(move.kind).toBe("move");
    if (move.kind !== "move") {
      throw new Error("unreachable");
    }
    expect(move.x).toBeCloseTo(15, 12);
    expect(move.y).toBeCloseTo(0, 12);

    // With a current point, the arc adds no move — the connecting segment is
    // implicit and appears only in the flattening.
    const continued = new Path().moveTo(0, 0).arc(10, 0, 5, 0, Math.PI / 2);
    expect(continued.commands.map((command) => command.kind)).toEqual([
      "move",
      "arc",
    ]);
  });

  it("carries the fill rule and clones share the commands", () => {
    expect(new Path().fillRule).toBe("nonzero");
    const path = new Path({ fillRule: "even-odd" }).moveTo(0, 0).lineTo(1, 1);
    const copy = path.clone();
    expect(copy.fillRule).toBe("even-odd");
    expect(copy.commands).toEqual(path.commands);
    copy.lineTo(2, 2);
    expect(path.commands).toHaveLength(2);
    expect(new Path().clone().isEmpty).toBe(true);
  });
});

describe("§51 flatten", () => {
  it("returns one ring per subpath, closing implicitly", () => {
    const [outline] = square().flatten();
    expect(outline).toEqual(ring(0, 0, 4, 0, 4, 4, 0, 4));
  });

  it("drops a final point that repeats the first of a closed ring", () => {
    const [outline] = new Path()
      .moveTo(0, 0)
      .lineTo(4, 0)
      .lineTo(4, 4)
      .lineTo(0, 0)
      .close()
      .flatten();
    expect(outline).toEqual(ring(0, 0, 4, 0, 4, 4));
  });

  it("never emits two equal points in a row", () => {
    const [outline] = new Path()
      .moveTo(0, 0)
      .lineTo(1, 0)
      .lineTo(1, 0)
      .lineTo(1, 1)
      .flatten();
    expect(outline).toEqual(ring(0, 0, 1, 0, 1, 1));
  });

  it("keeps a lone moveTo as a one-point subpath", () => {
    expect(new Path().moveTo(3, 4).flatten()).toEqual([ring(3, 4)]);
    expect(new Path().flatten()).toEqual([]);
  });

  it("starts a new subpath after close, at the closed subpath's first point", () => {
    const rings = new Path()
      .moveTo(0, 0)
      .lineTo(2, 0)
      .close()
      .lineTo(0, 3)
      .flatten();
    expect(rings).toEqual([ring(0, 0, 2, 0), ring(0, 0, 0, 3)]);
  });

  it("keeps a cubic within the tolerance, adaptively", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 0, y: 10 };
    const p2 = { x: 10, y: 10 };
    const p3 = { x: 10, y: 0 };
    const path = new Path()
      .moveTo(p0.x, p0.y)
      .cubicCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);

    for (const tolerance of [0.5, 0.05, 0.005]) {
      const [points] = path.flatten(tolerance);
      expect(points[0]).toEqual(p0);
      expect(points[points.length - 1]).toEqual(p3);
      for (let i = 0; i <= 200; i += 1) {
        const sample = cubicAt(p0, p1, p2, p3, i / 200);
        expect(distanceToPolyline(points, sample)).toBeLessThanOrEqual(
          tolerance,
        );
      }
    }

    const coarse = path.flatten(0.5)[0].length;
    const fine = path.flatten(0.005)[0].length;
    expect(fine).toBeGreaterThan(coarse);
  });

  it("keeps a quadratic within the tolerance", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 5, y: 12 };
    const p2 = { x: 10, y: 0 };
    const path = new Path()
      .moveTo(p0.x, p0.y)
      .quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
    const tolerance = 0.02;
    const [points] = path.flatten(tolerance);
    for (let i = 0; i <= 200; i += 1) {
      expect(
        distanceToPolyline(points, quadraticAt(p0, p1, p2, i / 200)),
      ).toBeLessThanOrEqual(tolerance);
    }
  });

  it("flattens a curve that returns to its start (a degenerate chord)", () => {
    const loop = new Path()
      .moveTo(0, 0)
      .cubicCurveTo(10, 10, -10, 10, 0, 0)
      .flatten(0.05);
    expect(loop[0].length).toBeGreaterThan(8);

    // A quadratic that returns to its start *is* a straight segment traversed
    // out and back — `B(t) = p₀ + 2t(1−t)(p₁−p₀)` — and flattens to exactly
    // that, reaching half way to the control point.
    expect(
      new Path().moveTo(0, 0).quadraticCurveTo(3, 4, 0, 0).flatten(0.05)[0],
    ).toEqual(ring(0, 0, 1.5, 2, 0, 0));

    // A curve whose control points are all within the tolerance of the start
    // is flat by the same test, and collapses to a single emitted point.
    const tiny = new Path()
      .moveTo(0, 0)
      .cubicCurveTo(1e-9, 0, 2e-9, 0, 0, 0)
      .flatten(0.05);
    expect(tiny[0]).toEqual(ring(0, 0));
    const tinyQuadratic = new Path()
      .moveTo(0, 0)
      .quadraticCurveTo(1e-9, 0, 0, 0)
      .flatten(0.05);
    expect(tinyQuadratic[0]).toEqual(ring(0, 0));
  });

  it("stops subdividing at the depth cap rather than hanging", () => {
    const cubic = new Path()
      .moveTo(0, 0)
      .cubicCurveTo(0, 1, 1, 1, 1, 0)
      .flatten(1e-13);
    expect(cubic[0]).toHaveLength(2 ** MAX_SUBDIVISION_DEPTH + 1);

    const quadratic = new Path()
      .moveTo(0, 0)
      .quadraticCurveTo(0.5, 1, 1, 0)
      .flatten(1e-13);
    expect(quadratic[0]).toHaveLength(2 ** MAX_SUBDIVISION_DEPTH + 1);
  });

  it("samples an arc on its ellipse, within the sagitta tolerance", () => {
    const tolerance = 0.01;
    const [points] = new Path()
      .arc(0, 0, 10, 0, Math.PI * 2)
      .flatten(tolerance);
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 9);
    }
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const midpoint = Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2);
      expect(10 - midpoint).toBeLessThanOrEqual(tolerance);
    }
    expect(points.length).toBeGreaterThanOrEqual(3);
  });

  it("gives a full circle at least three chords however coarse the tolerance", () => {
    // Four points, the last returning exactly to the first: the sweep is a
    // full turn, so its end point *is* its start point and is reused rather
    // than recomputed from `cos(θ + 2π)`, which would miss it by an ulp.
    const [points] = new Path().arc(0, 0, 1, 0, Math.PI * 2).flatten(50);
    expect(points).toHaveLength(4);
    expect(points[3]).toEqual(points[0]);
    // Closed, the duplicate goes, leaving a triangle §52 can tessellate.
    const [closed] = new Path()
      .arc(0, 0, 1, 0, Math.PI * 2)
      .close()
      .flatten(50);
    expect(closed).toHaveLength(3);
    expect(triangulatePolygon(closed)).toHaveLength(3);
  });

  it("materializes the implicit segment from the current point to an arc", () => {
    const [points] = new Path()
      .moveTo(-5, 0)
      .arc(0, 0, 1, 0, Math.PI / 2)
      .flatten(0.05);
    expect(points[0]).toEqual({ x: -5, y: 0 });
    expect(points[1].x).toBeCloseTo(1, 12);
    expect(points[1].y).toBeCloseTo(0, 12);
  });

  it("flattens a rotated ellipse arc in its own frame", () => {
    const [points] = new Path()
      .ellipse(0, 0, 4, 1, Math.PI / 2, 0, Math.PI * 2)
      .flatten(0.01);
    // Rotating the semi-axes by a quarter turn puts the long axis on Y. The
    // extremes are only approached as closely as a sample lands, so the bound
    // that matters is that no sample leaves the ellipse.
    const maxX = Math.max(...points.map((point) => Math.abs(point.x)));
    const maxY = Math.max(...points.map((point) => Math.abs(point.y)));
    expect(maxX).toBeLessThanOrEqual(1);
    expect(maxX).toBeGreaterThan(0.99);
    expect(maxY).toBeLessThanOrEqual(4);
    expect(maxY).toBeGreaterThan(3.99);
    for (const point of points) {
      expect(point.y * point.y + 16 * point.x * point.x).toBeCloseTo(16, 6);
    }
  });
});

describe("§51 fill rules and the §52 handoff", () => {
  const outer = (path: Path): Path =>
    path.moveTo(-4, -4).lineTo(4, -4).lineTo(4, 4).lineTo(-4, 4).close();
  const innerClockwise = (path: Path): Path =>
    path.moveTo(-2, -2).lineTo(-2, 2).lineTo(2, 2).lineTo(2, -2).close();
  const innerCounterClockwise = (path: Path): Path =>
    path.moveTo(-2, -2).lineTo(2, -2).lineTo(2, 2).lineTo(-2, 2).close();

  it("treats a counter-wound inner ring as a hole under either rule", () => {
    for (const fillRule of ["nonzero", "even-odd"] as const) {
      const path = new Path({ fillRule });
      innerClockwise(outer(path));
      const groups = path.fillRings();
      expect(groups).toHaveLength(1);
      expect(groups[0].holes).toHaveLength(1);
      // `doubleArea` is twice the area: the 8 × 8 outline and its 4 × 4 hole.
      expect(Math.abs(doubleArea(groups[0].outline))).toBe(128);
      expect(Math.abs(doubleArea(groups[0].holes[0]))).toBe(32);
    }
  });

  it("separates nonzero from even-odd on a same-wound inner ring", () => {
    const nonzero = new Path();
    innerCounterClockwise(outer(nonzero));
    const solid = nonzero.fillRings();
    expect(solid).toHaveLength(2);
    expect(solid[0].holes).toHaveLength(0);
    expect(solid[1].holes).toHaveLength(0);

    const evenOdd = new Path({ fillRule: "even-odd" });
    innerCounterClockwise(outer(evenOdd));
    const holed = evenOdd.fillRings();
    expect(holed).toHaveLength(1);
    expect(holed[0].holes).toHaveLength(1);
  });

  it("hands an island back as its own region, not as a hole in a hole", () => {
    // Authored middle-ring-first on purpose: the innermost container has to be
    // found by container count, not by position in the list.
    const path = new Path({ fillRule: "even-odd" })
      .moveTo(-3, -3)
      .lineTo(3, -3)
      .lineTo(3, 3)
      .lineTo(-3, 3)
      .close()
      .moveTo(-4, -4)
      .lineTo(4, -4)
      .lineTo(4, 4)
      .lineTo(-4, 4)
      .close()
      .moveTo(-1, -1)
      .lineTo(1, -1)
      .lineTo(1, 1)
      .lineTo(-1, 1)
      .close();

    const groups = path.fillRings();
    expect(groups).toHaveLength(2);
    const [outerRegion, island] = groups;
    expect(Math.abs(doubleArea(outerRegion.outline))).toBe(128);
    expect(outerRegion.holes).toHaveLength(1);
    expect(Math.abs(doubleArea(outerRegion.holes[0]))).toBe(72);
    expect(Math.abs(doubleArea(island.outline))).toBe(8);
    expect(island.holes).toHaveLength(0);
  });

  it("counts a clockwise container the other way round", () => {
    // The winding number is signed: a clockwise outline contributes −1, and a
    // counter-clockwise ring inside it sums to zero and so is a hole.
    const path = new Path()
      .moveTo(-4, -4)
      .lineTo(-4, 4)
      .lineTo(4, 4)
      .lineTo(4, -4)
      .close()
      .moveTo(-2, -2)
      .lineTo(2, -2)
      .lineTo(2, 2)
      .lineTo(-2, 2)
      .close();
    const groups = path.fillRings();
    expect(groups).toHaveLength(1);
    expect(doubleArea(groups[0].outline)).toBe(-128);
    expect(groups[0].holes).toHaveLength(1);
  });

  it("fills an unclosed subpath that returned to its own start", () => {
    // The arc's own end point is its start point, and filling treats every
    // subpath as closed — so the repeat is the closing edge, not a segment.
    const [region] = new Path().arc(0, 0, 1, 0, Math.PI * 2).fillRings(50);
    expect(region.outline).toHaveLength(3);
    expect(triangulatePolygon(region.outline)).toHaveLength(3);
  });

  it("drops rings that bound nothing", () => {
    const path = new Path()
      .moveTo(9, 9)
      .moveTo(0, 0)
      .lineTo(1, 0)
      .close()
      .moveTo(0, 0)
      .lineTo(1, 0)
      .lineTo(2, 0)
      .close();
    expect(path.fillRings()).toEqual([]);
  });

  it("fills every ring of a letter O straight through §52's tessellator", () => {
    const letterO = new Path()
      .moveTo(-2, -3)
      .lineTo(2, -3)
      .lineTo(2, 3)
      .lineTo(-2, 3)
      .close()
      .moveTo(-1, -2)
      .lineTo(-1, 2)
      .lineTo(1, 2)
      .lineTo(1, -2)
      .close();

    const [region] = letterO.fillRings(0.05);
    const indices = triangulatePolygon(region.outline, region.holes);
    const points = [region.outline, ...region.holes].flat();
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = points[indices[i]];
      const b = points[indices[i + 1]];
      const c = points[indices[i + 2]];
      const twice = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      expect(twice).toBeGreaterThan(0);
      area += twice;
    }
    expect(area).toBeCloseTo(48 - 16, 9);
  });

  it("fills a rounded rectangle of arcs and implicit edges through §52's tessellator", () => {
    // §50's rounded rectangle, written the way an arc-bearing shape wants to
    // be written: four corner arcs, the four straight edges implicit. A
    // hand-written `lineTo` at an arc's analytic start point would miss it by
    // an ulp and leave a hairline spike (see `flatten`'s documentation).
    const radius = 1;
    const width = 8;
    const height = 4;
    const path = new Path()
      .arc(width / 2 - radius, -height / 2 + radius, radius, -Math.PI / 2, 0)
      .arc(width / 2 - radius, height / 2 - radius, radius, 0, Math.PI / 2)
      .arc(
        -width / 2 + radius,
        height / 2 - radius,
        radius,
        Math.PI / 2,
        Math.PI,
      )
      .arc(
        -width / 2 + radius,
        -height / 2 + radius,
        radius,
        Math.PI,
        1.5 * Math.PI,
      )
      .close();

    const [region] = path.fillRings(0.01);
    const indices = triangulatePolygon(region.outline, region.holes);
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = region.outline[indices[i]];
      const b = region.outline[indices[i + 1]];
      const c = region.outline[indices[i + 2]];
      area += (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    }
    // A chord cuts a sliver off the arc it replaces, so the tessellated area
    // is a little under the true one — by less than the flattening tolerance
    // times the perimeter, never over it.
    const exact = width * height - (4 - Math.PI) * radius * radius;
    expect(area / 2).toBeLessThan(exact);
    expect(area / 2).toBeGreaterThan(exact - 0.05);
  });
});

describe("§51 exact operations", () => {
  it("subdivides curves without changing the shape", () => {
    const path = new Path()
      .moveTo(0, 0)
      .quadraticCurveTo(5, 12, 10, 0)
      .cubicCurveTo(12, -4, 18, -4, 20, 0)
      .arc(25, 0, 5, Math.PI, 0, true)
      .lineTo(30, 5)
      .close();

    const once = path.subdivide();
    const thrice = path.subdivide(3);
    expect(once.commands.filter((c) => c.kind === "quadratic")).toHaveLength(2);
    expect(thrice.commands.filter((c) => c.kind === "cubic")).toHaveLength(8);
    expect(thrice.commands.filter((c) => c.kind === "arc")).toHaveLength(8);
    expect(path.subdivide(0).commands).toEqual(path.commands);

    const reference = path.flatten(0.01)[0];
    for (const variant of [once, thrice]) {
      const points = variant.flatten(0.01)[0];
      for (const point of reference) {
        expect(distanceToPolyline(points, point)).toBeLessThan(0.02);
      }
      // Subdividing flattens each half against the same tolerance, so the
      // polyline gets slightly finer and its measured length slightly longer —
      // by less than the tolerance itself, never by a change of shape.
      expect(variant.length(0.01)).toBeCloseTo(path.length(0.01), 2);
      expect(variant.length(0.01)).toBeGreaterThanOrEqual(path.length(0.01));
    }
  });

  it("reverses a subpath's direction, flipping its winding", () => {
    const forward = square();
    const backward = forward.reverse();
    expect(doubleArea(forward.flatten()[0])).toBe(32);
    expect(doubleArea(backward.flatten()[0])).toBe(-32);
    expect(backward.reverse().flatten()[0]).toEqual(forward.flatten()[0]);
    expect(new Path().reverse().isEmpty).toBe(true);
  });

  it("reverses subpath order, including one begun by a segment after close", () => {
    const path = new Path()
      .moveTo(0, 0)
      .lineTo(2, 0)
      .close()
      .lineTo(0, 5)
      .lineTo(5, 5);
    expect(path.flatten()).toEqual([ring(0, 0, 2, 0), ring(0, 0, 0, 5, 5, 5)]);
    // Reversed: the later subpath comes first, each walked backwards — the
    // closed one from its last vertex, closing over the edge it entered by.
    expect(path.reverse().flatten()).toEqual([
      ring(5, 5, 0, 5, 0, 0),
      ring(2, 0, 0, 0),
    ]);
  });

  it("reverses curves and open subpaths", () => {
    const path = new Path()
      .moveTo(0, 0)
      .quadraticCurveTo(5, 12, 10, 0)
      .cubicCurveTo(12, -4, 18, -4, 20, 0);
    const reversed = path.reverse();
    const forwardPoints = path.flatten(0.01)[0];
    const backwardPoints = reversed.flatten(0.01)[0];
    expect(backwardPoints[0].x).toBeCloseTo(20, 9);
    expect(backwardPoints[backwardPoints.length - 1]).toEqual({ x: 0, y: 0 });
    expect(backwardPoints).toHaveLength(forwardPoints.length);
  });

  it("reverses an arc, restoring the implicit segment as an explicit one", () => {
    const path = new Path().moveTo(-5, 0).arc(0, 0, 1, 0, Math.PI);
    const reversed = path.reverse();
    // (-5, 0) → (1, 0) was implicit going forward; coming back it has to be a
    // line, because the arc no longer leads to it.
    expect(reversed.commands.map((command) => command.kind)).toEqual([
      "move",
      "arc",
      "line",
    ]);
    const forward = path.flatten(0.01)[0];
    const backward = reversed.flatten(0.01)[0];
    expect(backward).toHaveLength(forward.length);
    expect(backward[backward.length - 1]).toEqual({ x: -5, y: 0 });

    // An arc entered exactly at its first point needs no such line.
    const flush = new Path().moveTo(1, 0).arc(0, 0, 1, 0, Math.PI).reverse();
    expect(flush.commands.map((command) => command.kind)).toEqual([
      "move",
      "arc",
    ]);
  });

  it("transforms points, curves and similarity-mapped arcs", () => {
    const path = new Path()
      .moveTo(1, 0)
      .lineTo(2, 0)
      .quadraticCurveTo(3, 1, 4, 0)
      .cubicCurveTo(5, 1, 6, 1, 7, 0)
      .close();

    const scale = new Matrix3();
    scale.elements[0] = 2;
    scale.elements[4] = 3;
    scale.elements[6] = 10;
    const moved = path.transform(scale);

    // The command list is mapped entry for entry — comparing flattenings would
    // compare two different subdivisions, since a stretched curve needs more
    // segments to stay within the same absolute tolerance.
    expect(moved.commands.map((command) => command.kind)).toEqual(
      path.commands.map((command) => command.kind),
    );
    const mapped = (x: number, y: number): Point2D => ({
      x: x * 2 + 10,
      y: y * 3,
    });
    expect(moved.commands[1]).toEqual({ kind: "line", ...mapped(2, 0) });
    expect(moved.commands[2]).toEqual({
      kind: "quadratic",
      controlX: mapped(3, 1).x,
      controlY: mapped(3, 1).y,
      ...mapped(4, 0),
    });
    expect(moved.commands[3]).toEqual({
      kind: "cubic",
      control1X: mapped(5, 1).x,
      control1Y: mapped(5, 1).y,
      control2X: mapped(6, 1).x,
      control2Y: mapped(6, 1).y,
      ...mapped(7, 0),
    });
    expect(path.commands[1]).toEqual({ kind: "line", x: 2, y: 0 });
  });

  it("rotates, scales and mirrors an arc as a similarity", () => {
    const circle = new Path().arc(2, 0, 1, 0, Math.PI * 2);

    const quarter = new Matrix3();
    const angle = Math.PI / 2;
    quarter.elements[0] = Math.cos(angle);
    quarter.elements[1] = Math.sin(angle);
    quarter.elements[3] = -Math.sin(angle);
    quarter.elements[4] = Math.cos(angle);
    const rotated = circle.transform(quarter).flatten(0.01)[0];
    for (const point of rotated) {
      expect(Math.hypot(point.x, point.y - 2)).toBeCloseTo(1, 9);
    }

    const mirror = new Matrix3();
    mirror.elements[0] = -2;
    mirror.elements[4] = 2;
    const mirrored = circle.transform(mirror);
    const points = mirrored.flatten(0.01)[0];
    for (const point of points) {
      expect(Math.hypot(point.x + 4, point.y)).toBeCloseTo(2, 9);
    }
    // A reflection reverses the direction the arc is swept in.
    expect(doubleArea(circle.flatten(0.01)[0])).toBeGreaterThan(0);
    expect(doubleArea(points)).toBeLessThan(0);
  });

  it("simplifies straight runs and zero-length segments, never curves", () => {
    const path = new Path()
      .moveTo(0, 0)
      .lineTo(1, 0)
      .lineTo(2, 0)
      .lineTo(3, 0.0001)
      .lineTo(4, 0)
      .lineTo(4, 4)
      .lineTo(4, 4)
      .quadraticCurveTo(2, 6, 0, 4)
      .lineTo(0.00001, 4)
      .close();

    const simplified = path.simplify(0.01);
    expect(simplified.commands.map((command) => command.kind)).toEqual([
      "move",
      "line",
      "line",
      "quadratic",
      "close",
    ]);
    expect(simplified.flatten(0.01)[0][1]).toEqual({ x: 4, y: 0 });

    // A vertex further off the chord than the tolerance survives.
    const kept = new Path()
      .moveTo(0, 0)
      .lineTo(1, 1)
      .lineTo(2, 0)
      .simplify(0.01);
    expect(kept.commands).toHaveLength(3);

    // A run that doubles back to within the tolerance of its own anchor: the
    // chord is shorter than the tolerance, so the test becomes "is the dropped
    // vertex near the anchor", and a metre away it is not.
    const spike = new Path()
      .moveTo(0, 0)
      .lineTo(1, 0)
      .lineTo(0.0001, 0)
      .simplify(0.05);
    expect(spike.commands.map((command) => command.kind)).toEqual([
      "move",
      "line",
      "line",
    ]);
  });

  it("re-checks every dropped vertex against the growing chord", () => {
    // A parabola sampled finely: each vertex is nearly on the chord of its
    // immediate neighbours, so a one-step test would swallow the whole curve.
    // Re-checking every dropped vertex against the growing chord stops the run
    // where the curvature says it must.
    const path = new Path().moveTo(0, 0);
    for (let i = 1; i <= 40; i += 1) {
      path.lineTo(i * 0.5, i * i * 0.01);
    }
    const simplified = path.simplify(0.05);
    expect(simplified.commands.length).toBeGreaterThan(3);
    expect(simplified.commands.length).toBeLessThan(41);

    // The guarantee itself: every original vertex is still within the
    // tolerance of the simplified polyline.
    const kept = simplified.flatten(0.001)[0];
    for (const point of path.flatten(0.001)[0]) {
      expect(distanceToPolyline(kept, point)).toBeLessThanOrEqual(0.05);
    }

    // A perfectly straight run collapses to one segment, whatever its length.
    const straight = new Path().moveTo(0, 0);
    for (let i = 1; i <= 20; i += 1) {
      straight.lineTo(i, i * 2);
    }
    expect(straight.simplify(0.05).commands).toHaveLength(2);
  });

  it("simplifies a path with no trailing line and one with only curves", () => {
    const closed = square().simplify(0.001);
    expect(closed.commands[closed.commands.length - 1].kind).toBe("close");
    const curves = new Path()
      .moveTo(0, 0)
      .cubicCurveTo(1, 1, 2, 1, 3, 0)
      .simplify();
    expect(curves.commands).toHaveLength(2);
  });
});

describe("§51 measurement", () => {
  it("measures length, subpath by subpath, gaps excluded", () => {
    expect(square().length()).toBe(16);
    expect(
      new Path().moveTo(0, 0).lineTo(3, 4).moveTo(10, 0).lineTo(13, 4).length(),
    ).toBe(10);
    expect(new Path().length()).toBe(0);
    expect(new Path().moveTo(1, 1).length(0.5)).toBe(0);

    const circumference = new Path()
      .arc(0, 0, 10, 0, Math.PI * 2)
      .length(0.0001);
    expect(circumference).toBeLessThan(2 * Math.PI * 10);
    expect(circumference).toBeCloseTo(2 * Math.PI * 10, 3);
  });

  it("evaluates point, tangent and normal by arc length", () => {
    const path = square();
    expect(path.pointAt(0)).toEqual({ x: 0, y: 0 });
    expect(path.pointAt(0.125)).toEqual({ x: 2, y: 0 });
    expect(path.pointAt(0.5)).toEqual({ x: 4, y: 4 });
    expect(path.pointAt(1)).toEqual({ x: 0, y: 0 });

    const near = (actual: Point2D, x: number, y: number): void => {
      expect(actual.x).toBeCloseTo(x, 12);
      expect(actual.y).toBeCloseTo(y, 12);
    };
    near(path.tangentAt(0.125), 1, 0);
    // Counter-clockwise from the tangent: to the left of the direction of
    // travel, which on this counter-clockwise ring points inwards (§7a).
    near(path.normalAt(0.125), 0, 1);
    near(path.tangentAt(0.375), 0, 1);
    near(path.normalAt(0.375), -1, 0);

    // The edge starting at a shared vertex wins, deterministically.
    near(path.tangentAt(0.25), 0, 1);
  });

  it("advances in proportion to length along a curve", () => {
    const path = new Path().moveTo(0, 0).cubicCurveTo(0, 10, 10, 10, 10, 0);
    const total = path.length(0.001);
    let previous = 0;
    for (let i = 1; i <= 10; i += 1) {
      const t = i / 10;
      const point = path.pointAt(t, 0.001);
      const along = path.closestPoint(point, 0.001).t;
      expect(along).toBeCloseTo(t, 6);
      const walked = path.closestPoint(point, 0.001).t * total;
      expect(walked).toBeGreaterThan(previous);
      previous = walked;
    }
  });

  it("finds the closest point, its distance and its position", () => {
    const path = square();
    const outside = path.closestPoint({ x: 2, y: -3 });
    expect(outside.point).toEqual({ x: 2, y: 0 });
    expect(outside.distance).toBe(3);
    expect(outside.t).toBe(0.125);

    // Past an edge's end the projection clamps to the corner.
    const corner = path.closestPoint({ x: 7, y: -3 });
    expect(corner.point).toEqual({ x: 4, y: 0 });
    const inside = path.closestPoint({ x: 1, y: 1 });
    expect(inside.distance).toBe(1);
  });

  it("shares one flattening between the measuring operations", () => {
    const path = new Path().moveTo(0, 0).cubicCurveTo(0, 10, 10, 10, 10, 0);
    const first = path.length(0.01);
    expect(path.length(0.01)).toBe(first);
    expect(path.length(0.5)).not.toBe(first);
    expect(path.length(0.01)).toBe(first);
    // Appending invalidates it.
    path.lineTo(20, 0);
    expect(path.length(0.01)).toBeCloseTo(first + 10, 9);
  });

  it("uses the documented default tolerance", () => {
    const path = new Path().moveTo(0, 0).cubicCurveTo(0, 10, 10, 10, 10, 0);
    expect(path.length()).toBe(path.length(DEFAULT_FLATTEN_TOLERANCE));
    expect(path.flatten()).toEqual(path.flatten(DEFAULT_FLATTEN_TOLERANCE));
    expect(path.fillRings()).toEqual(path.fillRings(DEFAULT_FLATTEN_TOLERANCE));
    expect(path.pointAt(0.5)).toEqual(
      path.pointAt(0.5, DEFAULT_FLATTEN_TOLERANCE),
    );
    expect(path.tangentAt(0.5)).toEqual(
      path.tangentAt(0.5, DEFAULT_FLATTEN_TOLERANCE),
    );
    expect(path.normalAt(0.5)).toEqual(
      path.normalAt(0.5, DEFAULT_FLATTEN_TOLERANCE),
    );
    expect(path.closestPoint({ x: 0, y: 0 })).toEqual(
      path.closestPoint({ x: 0, y: 0 }, DEFAULT_FLATTEN_TOLERANCE),
    );
  });
});

describe("§51 refusals (§85)", () => {
  it("refuses a segment before any moveTo", () => {
    expect(() => new Path().lineTo(1, 1)).toThrow(/no current point/);
    expect(() => new Path().quadraticCurveTo(1, 1, 2, 2)).toThrow(
      /quadraticCurveTo/,
    );
    expect(() => new Path().cubicCurveTo(1, 1, 2, 2, 3, 3)).toThrow(
      /cubicCurveTo/,
    );
  });

  it("refuses a close with no open subpath", () => {
    expect(() => new Path().close()).toThrow(/no subpath is open/);
    expect(() => square().close()).toThrow(/no subpath is open/);
  });

  it("refuses non-finite coordinates and angles", () => {
    expect(() => new Path().moveTo(Number.NaN, 0)).toThrow(/x must be/);
    expect(() => new Path().moveTo(0, Number.POSITIVE_INFINITY)).toThrow(
      /y must be/,
    );
    expect(() => new Path().moveTo(0, 0).lineTo(Number.NaN, 0)).toThrow(/x/);
    expect(() => new Path().moveTo(0, 0).lineTo(0, Number.NaN)).toThrow(/y/);
    expect(() =>
      new Path().moveTo(0, 0).quadraticCurveTo(Number.NaN, 0, 1, 1),
    ).toThrow(/controlX/);
    expect(() =>
      new Path().moveTo(0, 0).quadraticCurveTo(0, Number.NaN, 1, 1),
    ).toThrow(/controlY/);
    expect(() =>
      new Path().moveTo(0, 0).quadraticCurveTo(0, 0, Number.NaN, 1),
    ).toThrow(/x must be/);
    expect(() =>
      new Path().moveTo(0, 0).quadraticCurveTo(0, 0, 1, Number.NaN),
    ).toThrow(/y must be/);
    for (const index of [0, 1, 2, 3, 4, 5]) {
      const args = [1, 1, 2, 2, 3, 3];
      args[index] = Number.NaN;
      expect(() =>
        new Path()
          .moveTo(0, 0)
          .cubicCurveTo(args[0], args[1], args[2], args[3], args[4], args[5]),
      ).toThrow(RangeError);
    }
    expect(() => new Path().arc(Number.NaN, 0, 1, 0, 1)).toThrow(/centerX/);
    expect(() => new Path().arc(0, Number.NaN, 1, 0, 1)).toThrow(/centerY/);
    expect(() => new Path().arc(0, 0, 1, Number.NaN, 1)).toThrow(/startAngle/);
    expect(() => new Path().arc(0, 0, 1, 0, Number.NaN)).toThrow(/endAngle/);
    expect(() => new Path().ellipse(0, 0, 1, 1, Number.NaN, 0, 1)).toThrow(
      /rotation/,
    );
  });

  it("refuses a non-positive radius", () => {
    expect(() => new Path().arc(0, 0, 0, 0, 1)).toThrow(/radiusX/);
    expect(() => new Path().ellipse(0, 0, 1, -1, 0, 0, 1)).toThrow(/radiusY/);
  });

  it("refuses a non-positive or non-finite tolerance", () => {
    expect(() => square().flatten(0)).toThrow(/tolerance/);
    expect(() => square().flatten(-1)).toThrow(/tolerance/);
    expect(() => square().fillRings(Number.NaN)).toThrow(/tolerance/);
    expect(() => square().simplify(0)).toThrow(/tolerance/);
    expect(() => square().length(0)).toThrow(/tolerance/);
  });

  it("refuses an out-of-range or non-finite t, and a path with no length", () => {
    expect(() => square().pointAt(-0.001)).toThrow(/t must lie/);
    expect(() => square().pointAt(1.001)).toThrow(/t must lie/);
    expect(() => square().pointAt(Number.NaN)).toThrow(/t must be/);
    expect(() => new Path().pointAt(0.5)).toThrow(/zero length/);
    expect(() => new Path().moveTo(1, 1).tangentAt(0.5)).toThrow(/zero length/);
    expect(() => new Path().closestPoint({ x: 0, y: 0 })).toThrow(
      /zero length/,
    );
    expect(() => square().closestPoint({ x: Number.NaN, y: 0 })).toThrow(
      /point\.x/,
    );
    expect(() => square().closestPoint({ x: 0, y: Number.NaN })).toThrow(
      /point\.y/,
    );
  });

  it("refuses an unreasonable subdivision count", () => {
    expect(() => square().subdivide(1.5)).toThrow(/integer/);
    expect(() => square().subdivide(-1)).toThrow(/integer/);
    expect(() => square().subdivide(17)).toThrow(/flatten\(\)/);
  });

  it("refuses a projective matrix", () => {
    for (const index of [2, 5]) {
      const matrix = new Matrix3();
      matrix.elements[index] = 1;
      expect(() => square().transform(matrix)).toThrow(/projective/);
    }
    const matrix = new Matrix3();
    matrix.elements[8] = 2;
    expect(() => square().transform(matrix)).toThrow(/projective/);
  });

  it("refuses a non-similarity matrix on a path containing an arc", () => {
    const circle = new Path().arc(0, 0, 1, 0, Math.PI * 2);

    const squash = new Matrix3();
    squash.elements[0] = 2;
    squash.elements[4] = 1;
    expect(() => circle.transform(squash)).toThrow(/not a similarity/);

    const shear = new Matrix3();
    shear.elements[3] = 1;
    expect(() => circle.transform(shear)).toThrow(/not a similarity/);

    const collapse = new Matrix3();
    collapse.elements[0] = 0;
    collapse.elements[4] = 0;
    expect(() => circle.transform(collapse)).toThrow(/not a similarity/);

    // The same matrices are fine on a path with no arc in it.
    expect(() => square().transform(squash)).not.toThrow();
    expect(() => square().transform(shear)).not.toThrow();
    expect(() => square().transform(collapse)).not.toThrow();
  });
});
