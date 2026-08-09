/**
 * §51 → §52 handoff: filling a `Path` through the tessellator (gaps `R-24`,
 * `R-25`).
 *
 * `R-25` shipped a tessellator that takes *one* outline and its holes.
 * `R-24` shipped the path model that produces them. The claim the two make
 * together — **"every fillable §50 shape can be authored as a `Path` and turned
 * into GPU-ready geometry today"** — is not provable inside either package, so
 * it is proved here, across the boundary, through the packages' public exports:
 *
 * ```ts
 * for (const { outline, holes } of path.fillRings(tolerance)) {
 *   triangulatePolygon(outline, holes);
 * }
 * ```
 *
 * ## The oracle is the analytic area, not a golden
 *
 * Every shape below has a closed-form area, and the tessellation's own
 * triangles are summed and compared against it. That catches both failure modes
 * at once: a wrong grouping (a hole filled as solid, or a solid dropped) moves
 * the area by a whole region, and a wrong triangulation moves it by a sliver.
 * The comparison bound is the flattening's own guarantee — a chord never
 * strays more than `tolerance` from its arc, so the area a polygon loses (or
 * gains, across a hole) is at most `tolerance × perimeter`, and the perimeter
 * is `Path.length`. No magic epsilon appears below.
 *
 * Every triangle is also checked counter-clockwise (§7a), which is what the
 * unlit 2D pipeline needs to draw a front face.
 *
 * ## What is *not* here
 *
 * Strokes: §58's paint model is gap `R-16`, and an open subpath below is
 * asserted to produce *no* fill region rather than a made-up one.
 */

import {
  Path,
  polygonGeometry2D,
  triangulatePolygon,
  type Point2D,
} from "@four/geometry";
import { describe, expect, it } from "vitest";

/** The tolerance every shape here is flattened at, in world units. */
const TOLERANCE = 0.01;

/**
 * Tessellates every region of `path` and returns the total area its triangles
 * cover, asserting each one is counter-clockwise and indexes real vertices.
 */
function tessellatedArea(path: Path, tolerance = TOLERANCE): number {
  const groups = path.fillRings(tolerance);
  expect(groups.length).toBeGreaterThan(0);
  let doubled = 0;
  for (const group of groups) {
    const indices = triangulatePolygon(group.outline, group.holes);
    const points: Point2D[] = [group.outline, ...group.holes].flat();
    expect(indices.length % 3).toBe(0);
    for (let i = 0; i < indices.length; i += 3) {
      const a = points[indices[i]];
      const b = points[indices[i + 1]];
      const c = points[indices[i + 2]];
      const twice = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      expect(twice).toBeGreaterThan(0);
      doubled += twice;
    }
  }
  return doubled / 2;
}

/**
 * Asserts a shape tessellates to its analytic area, within the flattening's own
 * bound: a chord stays within `tolerance` of its arc, so the area error cannot
 * exceed `tolerance × perimeter`.
 */
function expectArea(path: Path, exact: number, tolerance = TOLERANCE): void {
  const area = tessellatedArea(path, tolerance);
  const bound = tolerance * path.length(tolerance);
  expect(Math.abs(area - exact)).toBeLessThanOrEqual(bound);
}

/** §50's "circle", as one full-turn arc. */
function circle(radius: number, x = 0, y = 0): Path {
  return new Path().arc(x, y, radius, 0, Math.PI * 2).close();
}

describe("§51 paths fill through §52's tessellator", () => {
  it("fills a circle", () => {
    expectArea(circle(10), Math.PI * 100);
  });

  it("fills an ellipse", () => {
    const path = new Path().ellipse(0, 0, 12, 5, 0, 0, Math.PI * 2).close();
    expectArea(path, Math.PI * 12 * 5);
  });

  it("fills a rectangle", () => {
    const path = new Path()
      .moveTo(-6, -3)
      .lineTo(6, -3)
      .lineTo(6, 3)
      .lineTo(-6, 3)
      .close();
    expect(tessellatedArea(path)).toBeCloseTo(72, 9);
  });

  it("fills a rounded rectangle", () => {
    const radius = 1.5;
    const width = 12;
    const height = 6;
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
    expectArea(path, width * height - (4 - Math.PI) * radius * radius);
  });

  it("fills a regular polygon and a star", () => {
    const sides = 7;
    const radius = 5;
    const polygon = new Path();
    for (let i = 0; i < sides; i += 1) {
      const angle = (i / sides) * Math.PI * 2;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      if (i === 0) {
        polygon.moveTo(x, y);
      } else {
        polygon.lineTo(x, y);
      }
    }
    polygon.close();
    expect(tessellatedArea(polygon)).toBeCloseTo(
      (sides / 2) * radius * radius * Math.sin((Math.PI * 2) / sides),
      6,
    );

    const points = 5;
    const star = new Path();
    for (let i = 0; i < points * 2; i += 1) {
      const angle = (i / (points * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 6 : 2.5;
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      if (i === 0) {
        star.moveTo(x, y);
      } else {
        star.lineTo(x, y);
      }
    }
    star.close();
    // A star is a polygon, so the shoelace of its own flattening is exact.
    const ring = star.flatten(TOLERANCE)[0];
    let shoelace = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      shoelace += a.x * b.y - b.x * a.y;
    }
    expect(tessellatedArea(star)).toBeCloseTo(Math.abs(shoelace) / 2, 9);
  });

  it("fills an arbitrary concave polygon and a Bézier path", () => {
    const l = new Path()
      .moveTo(0, 0)
      .lineTo(8, 0)
      .lineTo(8, 3)
      .lineTo(3, 3)
      .lineTo(3, 9)
      .lineTo(0, 9)
      .close();
    expect(tessellatedArea(l)).toBeCloseTo(8 * 3 + 3 * 6, 9);

    // A cubic Bézier circle approximation: four arcs of the classic 0.5522847
    // handle length. Its area is within a part in a thousand of a circle's.
    const k = 0.5522847498307933;
    const r = 4;
    const bezier = new Path()
      .moveTo(r, 0)
      .cubicCurveTo(r, r * k, r * k, r, 0, r)
      .cubicCurveTo(-r * k, r, -r, r * k, -r, 0)
      .cubicCurveTo(-r, -r * k, -r * k, -r, 0, -r)
      .cubicCurveTo(r * k, -r, r, -r * k, r, 0)
      .close();
    const area = tessellatedArea(bezier);
    expect(area).toBeGreaterThan(Math.PI * r * r * 0.998);
    expect(area).toBeLessThan(Math.PI * r * r);
  });

  it("fills a sector and the segment cut off by an arc's chord", () => {
    const sweep = Math.PI / 3;
    const sector = new Path().moveTo(0, 0).arc(0, 0, 8, 0, sweep).close();
    expectArea(sector, (64 * sweep) / 2);

    // §50's "arc" as a filled shape is the circular segment its chord cuts off.
    const segment = new Path().arc(0, 0, 8, 0, sweep).close();
    expectArea(segment, (64 * (sweep - Math.sin(sweep))) / 2);
  });

  it("fills a ring, the hole found by the fill rule", () => {
    // Two full circles, the inner one wound the other way: §51's nonzero rule
    // makes it a hole, and §51's grouping hands it to §52 as one.
    // The `moveTo` is load-bearing: after a `close` the current point is the
    // closed subpath's first point, so an arc without one would be joined to
    // it by the implicit segment instead of starting a disjoint ring.
    const ring = new Path()
      .arc(0, 0, 10, 0, Math.PI * 2)
      .close()
      .moveTo(6, 0)
      .arc(0, 0, 6, 0, -Math.PI * 2, true)
      .close();
    const groups = ring.fillRings(TOLERANCE);
    expect(groups).toHaveLength(1);
    expect(groups[0].holes).toHaveLength(1);
    expectArea(ring, Math.PI * (100 - 36));
  });

  it("fills a letter O and the island inside a letter e", () => {
    const letterO = new Path()
      .moveTo(-4, -6)
      .lineTo(4, -6)
      .lineTo(4, 6)
      .lineTo(-4, 6)
      .close()
      .moveTo(-2, -4)
      .lineTo(-2, 4)
      .lineTo(2, 4)
      .lineTo(2, -4)
      .close();
    expect(tessellatedArea(letterO)).toBeCloseTo(96 - 32, 9);

    // Three nested rings under even-odd: the innermost is an island, and §52
    // refuses a hole inside a hole — so the grouping has to hand it over as a
    // region of its own. This is the configuration that would fail without it.
    const letterE = new Path({ fillRule: "even-odd" })
      .moveTo(-6, -6)
      .lineTo(6, -6)
      .lineTo(6, 6)
      .lineTo(-6, 6)
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
    const groups = letterE.fillRings(TOLERANCE);
    expect(groups).toHaveLength(2);
    expect(tessellatedArea(letterE)).toBeCloseTo(144 - 64 + 4, 9);
  });

  it("builds uploadable geometry from a filled path", () => {
    const [region] = circle(3).fillRings(TOLERANCE);
    const geometry = polygonGeometry2D({
      outline: region.outline,
      holes: region.holes,
    });
    expect(geometry.vertexCount).toBe(region.outline.length);
    expect(geometry.drawCount).toBe((region.outline.length - 2) * 3);
    const bounds = geometry.computeBounds();
    // A polygon inscribed in the circle, so its bounds sit just inside the
    // true ones — by less than the flattening tolerance.
    expect(bounds.min.x).toBeGreaterThan(-3);
    expect(bounds.min.x).toBeLessThan(-3 + TOLERANCE);
    expect(bounds.max.y).toBeLessThan(3);
    expect(bounds.max.y).toBeGreaterThan(3 - TOLERANCE);
    geometry.dispose();
  });

  it("gives an open line no fill region at all", () => {
    // §50's "line" and the degenerate cases around it: nothing to fill, and
    // saying nothing is better than inventing a sliver (§85).
    expect(new Path().moveTo(0, 0).lineTo(10, 0).fillRings()).toEqual([]);
    expect(new Path().moveTo(0, 0).fillRings()).toEqual([]);
    expect(new Path().fillRings()).toEqual([]);

    // An open *polyline* of three or more points does fill, as if closed —
    // the SVG and Canvas rule, stated in `fillRings`.
    const polyline = new Path().moveTo(0, 0).lineTo(4, 0).lineTo(4, 4);
    expect(tessellatedArea(polyline)).toBeCloseTo(8, 9);
  });

  it("refuses a self-intersecting fill loudly rather than drawing a lie", () => {
    // §52's documented refusal, reached through §51: the pentagram is the shape
    // that a naive tessellator triangulates *wrongly* while reporting success.
    const pentagram = new Path();
    for (let i = 0; i < 5; i += 1) {
      const angle = ((i * 2) / 5) * Math.PI * 2;
      const x = 5 * Math.cos(angle);
      const y = 5 * Math.sin(angle);
      if (i === 0) {
        pentagram.moveTo(x, y);
      } else {
        pentagram.lineTo(x, y);
      }
    }
    pentagram.close();
    const [region] = pentagram.fillRings(TOLERANCE);
    expect(() => triangulatePolygon(region.outline, region.holes)).toThrow(
      RangeError,
    );
  });
});
