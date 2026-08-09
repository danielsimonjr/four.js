/**
 * §50 → §51 → §52: an SVG `d` attribute all the way to GPU-ready geometry
 * (gaps `R-26`, `R-24`, `R-25`).
 *
 * `R-26` shipped the SVG bridge, `R-24` the path model, `R-25` the
 * tessellator. Each is tested inside its own package against its own contract;
 * the claim the three make *together* — **"a shape authored in an illustrator
 * can be pasted into four.js and drawn today"** — belongs to none of them, so
 * it is proved here, across the boundary, through the public exports:
 *
 * ```ts
 * const path = parseSvgPathData(d);
 * for (const { outline, holes } of path.fillRings(tolerance)) {
 *   triangulatePolygon(outline, holes);
 * }
 * ```
 *
 * ## The oracle is the analytic area, not a golden
 *
 * Every `d` below describes a shape with a closed-form area, and the
 * tessellation's own triangles are summed and compared against it — the same
 * oracle `path-tessellation.test.ts` uses, extended by one link at the front.
 * That catches both failure modes at once: a mis-parsed command moves the area
 * by a whole region, and a mis-converted arc moves it by a sliver. The bound is
 * the flattening's own guarantee (`tolerance × perimeter`), not a magic
 * epsilon.
 *
 * ## What is deliberately not here
 *
 * The `<svg>` document — `viewBox`, `transform`, `<g>`, and the shape elements
 * — is staged (see `svg-path.ts`), so every case below is a bare `d`. The Y
 * flip that a `viewBox` would supply is exercised once, explicitly, because
 * "the caller applies it" is only a defensible answer if applying it is one
 * exact line.
 */

import {
  Path,
  formatSvgPathData,
  parseSvgPathData,
  polygonGeometry2D,
  triangulatePolygon,
  type Point2D,
} from "@four/geometry";
import { Matrix3 } from "@four/math";
import { describe, expect, it } from "vitest";

/** The tolerance every shape here is flattened at, in world units. */
const TOLERANCE = 0.02;

/** Total area of a tessellation, summed from its triangles. */
function tessellatedArea(path: Path): number {
  let total = 0;
  for (const { outline, holes } of path.fillRings(TOLERANCE)) {
    const indices = triangulatePolygon(outline, holes);
    const points: Point2D[] = [...outline, ...holes.flat()];
    for (let i = 0; i < indices.length; i += 3) {
      const a = points[indices[i]];
      const b = points[indices[i + 1]];
      const c = points[indices[i + 2]];
      total += ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    }
  }
  return total;
}

/** The area bound the flattening itself guarantees: tolerance × perimeter. */
function areaTolerance(path: Path): number {
  return TOLERANCE * path.length(TOLERANCE);
}

describe("§50 SVG path data reaches §52's tessellator", () => {
  const cases: readonly {
    readonly name: string;
    readonly data: string;
    readonly area: number;
  }[] = [
    {
      name: "rectangle, as an illustrator writes it",
      data: "M10,10 L110,10 L110,60 L10,60 Z",
      area: 100 * 50,
    },
    {
      name: "rounded rectangle, four arcs and four lines",
      data:
        "M 12 0 L 88 0 A 12 12 0 0 1 100 12 L 100 48 A 12 12 0 0 1 88 60 " +
        "L 12 60 A 12 12 0 0 1 0 48 L 0 12 A 12 12 0 0 1 12 0 Z",
      // A 100 × 60 rectangle with four quarter-circle corners of radius 12:
      // the corners remove 4r² − πr².
      area: 100 * 60 - (4 - Math.PI) * 12 * 12,
    },
    {
      name: "circle, the two-arc idiom every SVG writer emits",
      data: "M 50 0 A 50 50 0 0 1 -50 0 A 50 50 0 0 1 50 0 Z",
      area: Math.PI * 50 * 50,
    },
    {
      name: "washer, an outer ring with a hole wound the other way",
      data:
        "M 40 0 A 40 40 0 0 1 -40 0 A 40 40 0 0 1 40 0 Z " +
        "M 20 0 A 20 20 0 0 0 -20 0 A 20 20 0 0 0 20 0 Z",
      area: Math.PI * (40 * 40 - 20 * 20),
    },
    {
      name: "curved blob, cubics with the smooth shorthand",
      data: "M 0 0 C 0 40 60 40 60 0 S 0 -40 0 0 Z",
      // No closed form worth writing: pinned against the same path built by
      // hand below instead.
      area: Number.NaN,
    },
  ];

  for (const entry of cases) {
    it(`fills a ${entry.name}`, () => {
      const path = parseSvgPathData(entry.data);
      const area = tessellatedArea(path);
      if (Number.isNaN(entry.area)) {
        const built = new Path()
          .moveTo(0, 0)
          .cubicCurveTo(0, 40, 60, 40, 60, 0)
          .cubicCurveTo(60, -40, 0, -40, 0, 0)
          .close();
        expect(area).toBeCloseTo(tessellatedArea(built), 6);
        return;
      }
      expect(Math.abs(area)).toBeGreaterThan(0);
      expect(Math.abs(Math.abs(area) - entry.area)).toBeLessThanOrEqual(
        areaTolerance(path),
      );
    });
  }

  it("hands the same rings to `polygonGeometry2D` without a shape node", () => {
    // The remaining link: `R-23`'s shape nodes do not exist, so the geometry
    // is built directly. Nothing in the chain needed a node.
    const [ring] = parseSvgPathData("M0 0 L40 0 L40 30 L0 30 Z").fillRings(
      TOLERANCE,
    );
    const geometry = polygonGeometry2D({
      outline: ring.outline,
      holes: ring.holes,
    });
    expect(geometry.positions.length).toBe(4 * 3);
    expect(geometry.indices?.length).toBe(2 * 3);
  });

  it("round-trips a shape back out through §50's writer", () => {
    const source = "M 0 0 L 40 0 L 40 30 L 0 30 Z";
    const path = parseSvgPathData(source);
    const written = formatSvgPathData(path);
    expect(written).toBe(source);
    expect(tessellatedArea(parseSvgPathData(written))).toBeCloseTo(
      tessellatedArea(path),
      9,
    );
  });

  it("lands SVG's Y-down content in the Y-up world in one exact transform", () => {
    // The decision `svg-path.ts` records: the parser transcribes, and the
    // `viewBox` half of the correction belongs to the document tier. Here the
    // height is supplied by hand, which is exactly what that tier will do.
    const height = 60;
    const svgToWorld = new Matrix3().fromArray([
      1,
      0,
      0,
      0,
      -1,
      0,
      0,
      height,
      1,
    ]);
    const asAuthored = parseSvgPathData("M 10 10 L 110 10 L 110 60 L 10 60 Z");
    const inWorld = asAuthored.transform(svgToWorld);

    // Same area — a reflection reverses the ring's orientation, and §52's ear
    // clipper emits counter-clockwise triangles either way (`R-25`), so the
    // measurable claim is the magnitude, not the sign.
    expect(tessellatedArea(inWorld)).toBeCloseTo(
      tessellatedArea(asAuthored),
      6,
    );
    // And the content now sits above the origin, where a Y-up camera looks.
    for (const ring of inWorld.flatten(TOLERANCE)) {
      for (const point of ring) {
        expect(point.y).toBeGreaterThanOrEqual(0);
      }
    }
    // The flip is exact: applying it twice is the identity, bit for bit.
    expect(inWorld.transform(svgToWorld).commands).toEqual(asAuthored.commands);
  });
});
