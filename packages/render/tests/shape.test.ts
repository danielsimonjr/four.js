/**
 * §50's shape family (R-23, 2026-08-09).
 *
 * The shapes are checked against **analytic areas**, not against recorded
 * vertex lists: a tessellation is allowed to pick any triangulation it likes,
 * and the property that matters is that the triangles cover the shape §50 named
 * and nothing else. That is also what caught the three real bugs `R-24` found,
 * so it is the oracle this suite reuses.
 *
 * Every filled shape here is authored counter-clockwise, so every triangle's
 * signed area is positive and the sum is the shape's area; a ring's hole shows
 * up as area *missing* rather than as negative triangles, which is what
 * distinguishes a real hole from two overlapping fills.
 */

import { UnlitMaterial } from "@four/materials";
import { Path } from "@four/geometry";
import { describe, expect, it } from "vitest";

import {
  Arc,
  Circle,
  Ellipse,
  Line,
  PathShape,
  Polygon,
  Polyline,
  Rectangle,
  RegularPolygon,
  Ring,
  Sector,
  Shape2D,
  Star,
  type SolidPaint,
} from "../src/shape.js";
import { Renderable } from "../src/renderable.js";

const material = (): UnlitMaterial => new UnlitMaterial();

/** Sum of the signed areas of a shape's triangles, read off its fill. */
function filledArea(shape: Shape2D): number {
  const geometry = shape.geometry;
  const indices = geometry.indices;
  if (indices === undefined) {
    return 0;
  }
  const positions = geometry.positions;
  let twice = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    twice +=
      (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) -
      (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a]);
  }
  return twice / 2;
}

/**
 * Asserts that a shape's fill covers `exact` from below — a chord cuts a sliver
 * off every arc it replaces, so a tessellated area is a little under the true
 * one and never over it (the bound `R-24`'s own rounded-rectangle test uses).
 */
function expectAreaJustUnder(shape: Shape2D, exact: number, slack: number) {
  const area = filledArea(shape);
  expect(area).toBeLessThanOrEqual(exact);
  expect(area).toBeGreaterThan(exact - slack);
}

describe("Shape2D — the family's shared half", () => {
  it("derives, owns, and caches its fill", () => {
    const circle = new Circle({ radius: 1, material: material() });
    const first = circle.geometry;
    expect(first.vertexCount).toBeGreaterThan(8);
    // Reading again neither rebuilds nor replaces: same object, same version.
    const version = first.version;
    expect(circle.geometry).toBe(first);
    expect(circle.geometry.version).toBe(version);
  });

  it("keeps the geometry id across a rebuild, so a backend re-uploads rather than leaking", () => {
    const circle = new Circle({ radius: 1, material: material() });
    const id = circle.geometry.id;
    const before = circle.geometry.vertexCount;
    circle.radius = 10;
    expect(circle.geometry.id).toBe(id);
    expect(circle.geometry.vertexCount).toBeGreaterThan(before);
    expect(circle.geometry.version).toBeGreaterThan(1);
  });

  it("rebuilds once for a burst of edits, and only when read", () => {
    const rectangle = new Rectangle({ material: material() });
    const start = rectangle.geometry.version;
    rectangle.width = 2;
    rectangle.height = 3;
    rectangle.tolerance = 0.5;
    const after = rectangle.geometry.version;
    // Four buffer assignments per rebuild plus the empty-state pass; the point
    // is that three edits cost one rebuild, so the delta is that of a single
    // read, not three times it.
    expect(rectangle.geometry.version).toBe(after);
    const oneRebuild = after - start;
    rectangle.width = 4;
    expect(rectangle.geometry.version - after).toBe(oneRebuild);
  });

  it("is a Renderable, and draws through its material's own pipeline", () => {
    const shape = new Circle({ material: material() });
    expect(shape).toBeInstanceOf(Renderable);
    expect(shape.material.kind).toBe("unlit");
    expect(shape.renderLayer).toBe(0);
    expect(shape.castShadow).toBe(true);
  });

  it("takes the Renderable options every drawable takes", () => {
    const shape = new Circle({
      material: material(),
      renderLayer: 2,
      renderOrder: 5,
      castShadow: false,
      receiveShadow: false,
    });
    expect(shape.renderLayer).toBe(2);
    expect(shape.renderOrder).toBe(5);
    expect(shape.castShadow).toBe(false);
    expect(shape.receiveShadow).toBe(false);
  });

  it("validates the flattening tolerance and rebuilds on a write (§85)", () => {
    const circle = new Circle({ radius: 1, material: material() });
    expect(circle.tolerance).toBeCloseTo(0.01, 12);
    const fine = circle.geometry.vertexCount;
    circle.tolerance = 0.2;
    expect(circle.geometry.vertexCount).toBeLessThan(fine);
    expect(() => (circle.tolerance = 0)).toThrow(RangeError);
    expect(() => (circle.tolerance = Number.NaN)).toThrow(RangeError);
    expect(() => new Circle({ material: material(), tolerance: -1 })).toThrow(
      RangeError,
    );
  });

  it("disposes the fill it owns, never the shared material (§83)", () => {
    const shared = material();
    const circle = new Circle({ material: shared });
    const geometry = circle.geometry;
    circle.dispose();
    expect(circle.disposed).toBe(true);
    expect(geometry.disposed).toBe(true);
    expect(shared.disposed).toBe(false);
    // Idempotent, and a disposed shape never rebuilds — the read that would
    // have tessellated finds the terminal state instead.
    circle.dispose();
    expect(circle.geometry.vertexCount).toBe(0);
  });

  it("does not tessellate a shape that is disposed before it is ever drawn", () => {
    const circle = new Circle({ material: material() });
    circle.dispose();
    expect(circle.geometry.vertexCount).toBe(0);
    expect(circle.geometry.indices).toBeUndefined();
  });

  it("hands out a fresh path per call, so an edit cannot desynchronise a shape", () => {
    const circle = new Circle({ radius: 2, material: material() });
    const first = circle.toPath();
    expect(circle.toPath()).not.toBe(first);
    first.lineTo(100, 100);
    expect(circle.toPath().commands).toHaveLength(3);
  });

  it("tessellates nothing for a legal shape that encloses nothing", () => {
    const collinear = new Polygon({
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      material: material(),
    });
    expect(collinear.geometry.vertexCount).toBe(0);
    expect(collinear.geometry.indices).toBeUndefined();
    expect(collinear.geometry.uvs).toBeUndefined();
    // …and it recovers: the shape is not poisoned by having been empty.
    collinear.points = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    expect(filledArea(collinear)).toBeCloseTo(2, 12);
  });

  it("maps uv over the union of the filled regions", () => {
    const rectangle = new Rectangle({
      width: 4,
      height: 2,
      material: material(),
    });
    const uvs = rectangle.geometry.uvs;
    expect(uvs).toBeDefined();
    expect(Math.min(...(uvs as Float32Array))).toBe(0);
    expect(Math.max(...(uvs as Float32Array))).toBe(1);
  });

  it("refuses a self-intersecting outline at rebuild time (§52, §85)", () => {
    const pentagram = new Polygon({
      points: [
        { x: 0, y: 1 },
        { x: 0.588, y: -0.809 },
        { x: -0.951, y: 0.309 },
        { x: 0.951, y: 0.309 },
        { x: -0.588, y: -0.809 },
      ],
      material: material(),
    });
    expect(() => pentagram.geometry).toThrow(RangeError);
  });

  it("widens to a 32-bit index buffer past 65 536 vertices", () => {
    // 257 disjoint 256-gons: 65 792 vertices, which is one region more than a
    // `Uint16Array` index can address, and cheap because both the tessellator
    // and the fill-rule grouping are quadratic in the *ring*, not in the total.
    const path = new Path();
    for (let ring = 0; ring < 257; ring += 1) {
      const cx = (ring % 17) * 4;
      const cy = Math.floor(ring / 17) * 4;
      for (let i = 0; i < 256; i += 1) {
        const angle = (Math.PI * 2 * i) / 256;
        const x = cx + Math.cos(angle);
        const y = cy + Math.sin(angle);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.close();
    }
    const shape = new PathShape({ path, material: material() });
    expect(shape.geometry.vertexCount).toBe(257 * 256);
    expect(shape.geometry.indices).toBeInstanceOf(Uint32Array);
    expectAreaJustUnder(shape, 257 * Math.PI, 0.01 * 257 * Math.PI);
  });
});

describe("§50 circle, ellipse, sector, ring — the arc-bearing shapes", () => {
  it("fills a circle", () => {
    const circle = new Circle({
      radius: 2,
      tolerance: 0.001,
      material: material(),
    });
    expectAreaJustUnder(circle, Math.PI * 4, 0.02);
    expect(circle.radius).toBe(2);
    circle.radius = 3;
    expectAreaJustUnder(circle, Math.PI * 9, 0.05);
    expect(() => (circle.radius = 0)).toThrow(RangeError);
    expect(() => new Circle({ radius: -1, material: material() })).toThrow(
      RangeError,
    );
    expect(new Circle({ material: material() }).radius).toBe(1);
  });

  it("fills an ellipse, tilted about its own centre", () => {
    const ellipse = new Ellipse({
      radiusX: 3,
      radiusY: 1,
      tolerance: 0.001,
      material: material(),
    });
    expectAreaJustUnder(ellipse, Math.PI * 3, 0.02);
    expect(ellipse.startAngle).toBe(0);

    // A tilt is a rigid motion: the area is invariant and the bounding box is
    // not, which is what proves the parameter reached the ellipse's own frame
    // rather than the node transform.
    const wideBefore = ellipse.geometry.computeBounds().max.x;
    ellipse.startAngle = Math.PI / 2;
    expectAreaJustUnder(ellipse, Math.PI * 3, 0.02);
    expect(ellipse.geometry.computeBounds().max.x).toBeLessThan(wideBefore);

    ellipse.radiusX = 2;
    ellipse.radiusY = 2;
    expectAreaJustUnder(ellipse, Math.PI * 4, 0.02);
    expect(() => (ellipse.radiusX = 0)).toThrow(RangeError);
    expect(() => (ellipse.radiusY = -2)).toThrow(RangeError);
    expect(() => (ellipse.startAngle = Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(
      () => new Ellipse({ startAngle: Number.NaN, material: material() }),
    ).toThrow(RangeError);
    const unit = new Ellipse({ material: material() });
    expect(unit.radiusX).toBe(1);
    expect(unit.radiusY).toBe(1);
  });

  it("fills a sector as a pie slice, centre included", () => {
    const sector = new Sector({
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
      tolerance: 0.001,
      material: material(),
    });
    expectAreaJustUnder(sector, Math.PI, 0.01);
    expect(sector.radius).toBe(2);
    expect(sector.startAngle).toBe(0);
    expect(sector.endAngle).toBeCloseTo(Math.PI / 2, 12);

    sector.endAngle = Math.PI;
    expectAreaJustUnder(sector, Math.PI * 2, 0.02);
    sector.startAngle = Math.PI / 2;
    expectAreaJustUnder(sector, Math.PI, 0.01);
    sector.radius = 1;
    expectAreaJustUnder(sector, Math.PI / 4, 0.01);

    expect(() => (sector.radius = 0)).toThrow(RangeError);
    expect(() => (sector.startAngle = Number.NaN)).toThrow(RangeError);
    expect(() => (sector.endAngle = Number.NaN)).toThrow(RangeError);
    expect(
      () =>
        new Sector({
          startAngle: Number.NaN,
          endAngle: 1,
          material: material(),
        }),
    ).toThrow(RangeError);
  });

  it("fills a sector of zero sweep with nothing, rather than refusing it", () => {
    const empty = new Sector({
      startAngle: 1,
      endAngle: 1,
      material: material(),
    });
    expect(empty.geometry.vertexCount).toBe(0);
  });

  it("cuts a real hole in a ring rather than filling its middle twice", () => {
    const ring = new Ring({
      innerRadius: 0.6,
      outerRadius: 1,
      tolerance: 0.001,
      material: material(),
    });
    expect(ring.innerRadius).toBe(0.6);
    expect(ring.outerRadius).toBe(1);
    expectAreaJustUnder(ring, Math.PI * (1 - 0.36), 0.01);
    // The proof that the hole is a hole: the tessellation covers the annulus
    // once, so the *sum* is the annulus. Two same-wound circles would sum to
    // the outer disc plus the inner one instead.
    expect(filledArea(ring)).toBeLessThan(Math.PI);

    ring.innerRadius = 0.2;
    expectAreaJustUnder(ring, Math.PI * (1 - 0.04), 0.02);
    ring.outerRadius = 4;
    expectAreaJustUnder(ring, Math.PI * (16 - 0.04), 0.4);

    expect(() => (ring.innerRadius = 0)).toThrow(RangeError);
    expect(() => (ring.innerRadius = 4)).toThrow(RangeError);
    expect(() => (ring.outerRadius = 0.1)).toThrow(RangeError);
    expect(
      () => new Ring({ innerRadius: 2, outerRadius: 1, material: material() }),
    ).toThrow(RangeError);
    expect(
      new Ring({ innerRadius: 0.5, material: material() }).outerRadius,
    ).toBe(1);
  });
});

describe("§50 rectangle and rounded rectangle — one class", () => {
  it("fills a square-cornered rectangle with exactly four vertices", () => {
    const rectangle = new Rectangle({
      width: 8,
      height: 4,
      material: material(),
    });
    expect(rectangle.geometry.vertexCount).toBe(4);
    expect(filledArea(rectangle)).toBe(32);
    expect(rectangle.radius).toBe(0);
  });

  it("fills §50's rounded rectangle through four arcs and implicit edges", () => {
    const rounded = new Rectangle({
      width: 8,
      height: 4,
      radius: 1,
      tolerance: 0.001,
      material: material(),
    });
    expectAreaJustUnder(rounded, 32 - (4 - Math.PI), 0.02);
    rounded.radius = 2;
    expectAreaJustUnder(rounded, 32 - (4 - Math.PI) * 4, 0.05);
  });

  it("refuses a corner radius the rectangle cannot hold, from either side (§85)", () => {
    const rectangle = new Rectangle({
      width: 8,
      height: 4,
      radius: 2,
      material: material(),
    });
    expect(() => (rectangle.radius = 2.5)).toThrow(RangeError);
    expect(() => (rectangle.radius = -1)).toThrow(RangeError);
    expect(() => (rectangle.radius = Number.NaN)).toThrow(RangeError);
    // The check runs on the extents too, so the three can never disagree.
    expect(() => (rectangle.height = 3)).toThrow(RangeError);
    expect(() => (rectangle.width = 1)).toThrow(RangeError);
    expect(rectangle.height).toBe(4);
    expect(rectangle.width).toBe(8);
    // …and a refused write leaves the shape drawing exactly what it drew.
    expectAreaJustUnder(rectangle, 32 - (4 - Math.PI) * 4, 0.1);
    expect(
      () =>
        new Rectangle({
          width: 1,
          height: 1,
          radius: 0.6,
          material: material(),
        }),
    ).toThrow(RangeError);
  });

  it("resizes, and defaults to the unit square", () => {
    const rectangle = new Rectangle({ material: material() });
    expect(filledArea(rectangle)).toBe(1);
    rectangle.width = 3;
    rectangle.height = 2;
    expect(filledArea(rectangle)).toBe(6);
    expect(() => (rectangle.width = 0)).toThrow(RangeError);
    expect(() => (rectangle.height = Number.NaN)).toThrow(RangeError);
  });
});

describe("§50 regular polygon, star, arbitrary polygon", () => {
  it("fills a regular polygon at its analytic area", () => {
    const hexagon = new RegularPolygon({
      sides: 6,
      radius: 1,
      material: material(),
    });
    expect(hexagon.sides).toBe(6);
    expect(hexagon.radius).toBe(1);
    expect(hexagon.geometry.vertexCount).toBe(6);
    expect(filledArea(hexagon)).toBeCloseTo((3 * Math.sqrt(3)) / 2, 6);

    hexagon.sides = 4;
    expect(filledArea(hexagon)).toBeCloseTo(2, 6);
    hexagon.radius = 2;
    expect(filledArea(hexagon)).toBeCloseTo(8, 6);
    // A rotation of a quarter turn maps the square onto itself.
    hexagon.startAngle = Math.PI / 2;
    expect(filledArea(hexagon)).toBeCloseTo(8, 6);

    expect(() => (hexagon.sides = 2)).toThrow(RangeError);
    expect(() => (hexagon.sides = 5.5)).toThrow(RangeError);
    expect(() => (hexagon.radius = 0)).toThrow(RangeError);
    expect(() => (hexagon.startAngle = Number.NaN)).toThrow(RangeError);
    expect(
      () => new RegularPolygon({ sides: 1, material: material() }),
    ).toThrow(RangeError);
    expect(new RegularPolygon({ sides: 3, material: material() }).radius).toBe(
      1,
    );
    expect(
      new RegularPolygon({ sides: 3, material: material() }).startAngle,
    ).toBe(0);
  });

  it("fills a star at the area of its 2n triangles", () => {
    const star = new Star({
      points: 5,
      innerRadius: 0.4,
      outerRadius: 1,
      material: material(),
    });
    expect(star.points).toBe(5);
    expect(star.innerRadius).toBe(0.4);
    expect(star.outerRadius).toBe(1);
    expect(star.geometry.vertexCount).toBe(10);
    // A 2n-gon of alternating radii is 2n triangles of area
    // ½·r·R·sin(π/n) about the centre.
    const exact = 2 * 5 * 0.5 * 0.4 * 1 * Math.sin(Math.PI / 5);
    expect(filledArea(star)).toBeCloseTo(exact, 6);

    star.points = 6;
    expect(filledArea(star)).toBeCloseTo(
      2 * 6 * 0.5 * 0.4 * 1 * Math.sin(Math.PI / 6),
      6,
    );
    star.innerRadius = 0.5;
    star.outerRadius = 2;
    star.startAngle = Math.PI / 2;
    expect(filledArea(star)).toBeCloseTo(
      2 * 6 * 0.5 * 0.5 * 2 * Math.sin(Math.PI / 6),
      6,
    );

    expect(() => (star.points = 1)).toThrow(RangeError);
    expect(() => (star.points = 4.5)).toThrow(RangeError);
    expect(() => (star.innerRadius = 0)).toThrow(RangeError);
    expect(() => (star.innerRadius = 3)).toThrow(RangeError);
    expect(() => (star.outerRadius = 0.25)).toThrow(RangeError);
    expect(() => (star.outerRadius = 0)).toThrow(RangeError);
    expect(() => (star.startAngle = Number.NaN)).toThrow(RangeError);
    expect(
      () =>
        new Star({
          points: 5,
          innerRadius: 1,
          outerRadius: 1,
          material: material(),
        }),
    ).toThrow(RangeError);
    expect(
      new Star({
        points: 5,
        innerRadius: 0.5,
        outerRadius: 1,
        material: material(),
      }).startAngle,
    ).toBe(0);
  });

  it("fills a concave arbitrary polygon and holds its own copy of the points", () => {
    const authored = [
      { x: 0, y: 1 },
      { x: -1, y: -1 },
      { x: 0, y: -0.4 },
      { x: 1, y: -1 },
    ];
    const arrow = new Polygon({ points: authored, material: material() });
    expect(arrow.points).toHaveLength(4);
    expect(arrow.points[0]).not.toBe(authored[0]);
    // Two triangles of a concave quadrilateral: the shoelace area.
    expect(filledArea(arrow)).toBeCloseTo(1.4, 6);

    // The array the caller passed is not the shape's.
    authored[0].y = 100;
    expect(filledArea(arrow)).toBeCloseTo(1.4, 6);

    arrow.points = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(filledArea(arrow)).toBe(4);

    // …but its own records are live, on the documented markDirty contract.
    (arrow.points[2] as { x: number }).x = 4;
    arrow.markDirty();
    expect(filledArea(arrow)).toBe(6);

    expect(
      () =>
        new Polygon({
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          material: material(),
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new Polygon({
          points: [
            { x: 0, y: 0 },
            { x: 1, y: Number.NaN },
            { x: 1, y: 1 },
          ],
          material: material(),
        }),
    ).toThrow(RangeError);
    expect(() => (arrow.points = [])).toThrow(RangeError);
  });
});

describe("§50 path and Bézier path — PathShape", () => {
  it("fills every region of a letter 'e', island included", () => {
    const outline = new Path()
      .moveTo(-2, -3)
      .lineTo(2, -3)
      .lineTo(2, 3)
      .lineTo(-2, 3)
      .close()
      .moveTo(-1, -2)
      .lineTo(-1, 2)
      .lineTo(1, 2)
      .lineTo(1, -2)
      .close()
      .moveTo(-0.5, -0.5)
      .lineTo(0.5, -0.5)
      .lineTo(0.5, 0.5)
      .lineTo(-0.5, 0.5)
      .close();
    const glyph = new PathShape({ path: outline, material: material() });
    // 24 − 8 + 1: the counter is a hole, the island inside it is filled.
    expect(filledArea(glyph)).toBeCloseTo(17, 5);
  });

  it("fills a Bézier path — §50's fourteenth row, no new class", () => {
    // A cubic "circle" of radius 1: the classic κ = 0.5522847498 construction,
    // whose area is within 0.03% of π.
    const k = 0.5522847498307936;
    const bezier = new Path()
      .moveTo(1, 0)
      .cubicCurveTo(1, k, k, 1, 0, 1)
      .cubicCurveTo(-k, 1, -1, k, -1, 0)
      .cubicCurveTo(-1, -k, -k, -1, 0, -1)
      .cubicCurveTo(k, -1, 1, -k, 1, 0)
      .close();
    const disc = new PathShape({
      path: bezier,
      tolerance: 0.0001,
      material: material(),
    });
    // The κ construction is not a circle: its own area is about 0.03% over
    // π, which dwarfs the flattening error and is the number asserted here.
    expect(filledArea(disc)).toBeGreaterThan(Math.PI);
    expect(filledArea(disc)).toBeLessThan(Math.PI * 1.0005);
    expect(bezier.commands.filter((c) => c.kind === "cubic")).toHaveLength(4);
  });

  it("honours the path's own fill rule", () => {
    const nested = (rule: "nonzero" | "even-odd"): Path =>
      new Path({ fillRule: rule })
        .moveTo(-2, -2)
        .lineTo(2, -2)
        .lineTo(2, 2)
        .lineTo(-2, 2)
        .close()
        .moveTo(-1, -1)
        .lineTo(1, -1)
        .lineTo(1, 1)
        .lineTo(-1, 1)
        .close();
    // Same winding for both rings: nonzero fills the middle twice (16 + 4),
    // even-odd cuts it out (16 − 4).
    expect(
      filledArea(
        new PathShape({ path: nested("nonzero"), material: material() }),
      ),
    ).toBeCloseTo(20, 5);
    expect(
      filledArea(
        new PathShape({ path: nested("even-odd"), material: material() }),
      ),
    ).toBeCloseTo(12, 5);
  });

  it("holds the path by reference, on the markDirty contract", () => {
    const path = new Path().moveTo(0, 0).lineTo(2, 0).lineTo(2, 2).close();
    const shape = new PathShape({ path, material: material() });
    expect(shape.path).toBe(path);
    expect(filledArea(shape)).toBeCloseTo(2, 6);

    path.moveTo(4, 0).lineTo(6, 0).lineTo(6, 2).close();
    shape.markDirty();
    expect(filledArea(shape)).toBeCloseTo(4, 6);

    shape.path = new Path().moveTo(0, 0).lineTo(4, 0).lineTo(4, 4).close();
    expect(filledArea(shape)).toBeCloseTo(8, 6);
    // …and `toPath` still answers with a copy, per the family contract.
    expect(shape.toPath()).not.toBe(shape.path);
    expect(shape.toPath().commands).toEqual(shape.path.commands);
  });

  it("fills nothing for an empty path", () => {
    const empty = new PathShape({ path: new Path(), material: material() });
    expect(empty.geometry.vertexCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §58 paints, fills and strokes (R-16, 2026-08-09)
// ---------------------------------------------------------------------------

/** A material that multiplies the geometry's per-vertex colours (§57, R-19). */
const painted = (): UnlitMaterial => new UnlitMaterial({ vertexColors: true });

// Exactly representable in `Float32Array`, so the assertions can be exact.
const BLUE: SolidPaint = { kind: "solid", color: [0.25, 0.5, 1, 1] };
const WHITE: SolidPaint = { kind: "solid", color: [1, 1, 1, 1] };

/** Every vertex colour of a shape, as `[r, g, b, a]` tuples. */
function vertexColors(shape: Shape2D): number[][] {
  const colors = shape.geometry.colors;
  if (colors === undefined) return [];
  const out: number[][] = [];
  for (let i = 0; i < colors.length; i += 4) {
    out.push([colors[i], colors[i + 1], colors[i + 2], colors[i + 3]]);
  }
  return out;
}

/** The distinct vertex colours a shape carries, in first-seen order. */
function distinctColors(shape: Shape2D): number[][] {
  const seen: number[][] = [];
  for (const color of vertexColors(shape)) {
    if (!seen.some((entry) => entry.every((v, i) => v === color[i]))) {
      seen.push(color);
    }
  }
  return seen;
}

describe("§58 fill — the paint model at its solid tier", () => {
  it("defaults to the material's own colour and carries no colour stream", () => {
    const circle = new Circle({ radius: 1, material: material() });
    expect(circle.fill).toBe("inherit");
    expect(circle.stroke).toBeNull();
    expect(circle.geometry.colors).toBeUndefined();
  });

  it("paints the fill through per-vertex colour when a paint is named", () => {
    const circle = new Circle({ radius: 1, material: painted(), fill: BLUE });
    expect(circle.fill).toEqual({ ...BLUE, opacity: 1 });
    expect(distinctColors(circle)).toEqual([[0.25, 0.5, 1, 1]]);
    expect(vertexColors(circle)).toHaveLength(
      circle.geometry.positions.length / 3,
    );
  });

  it("folds §50's separate opacity into the drawn alpha", () => {
    const circle = new Circle({
      radius: 1,
      material: painted(),
      fill: { kind: "solid", color: [1, 0, 0, 0.5], opacity: 0.5 },
    });
    expect(distinctColors(circle)).toEqual([[1, 0, 0, 0.25]]);
  });

  it("copies the paint, so editing the record you passed changes nothing", () => {
    const authored = { kind: "solid", color: [1, 0, 0, 1] } as SolidPaint;
    const circle = new Circle({
      radius: 1,
      material: painted(),
      fill: authored,
    });
    (authored.color as number[])[0] = 0;
    expect(distinctColors(circle)).toEqual([[1, 0, 0, 1]]);
  });

  it("draws nothing at all for `none`, and rebuilds when the fill changes", () => {
    const circle = new Circle({
      radius: 1,
      material: material(),
      fill: "none",
    });
    expect(circle.geometry.positions).toHaveLength(0);
    expect(filledArea(circle)).toBe(0);
    circle.fill = "inherit";
    expectAreaJustUnder(circle, Math.PI, 0.05);
    expect(circle.geometry.colors).toBeUndefined();
  });

  it("refuses a paint kind this build cannot draw, and a nonsense opacity", () => {
    expect(
      () =>
        new Circle({
          material: painted(),
          fill: { kind: "linear-gradient" } as unknown as SolidPaint,
        }),
    ).toThrow(/§58/);
    expect(
      () =>
        new Circle({
          material: painted(),
          fill: { kind: "solid", color: [1, 0, 0, Number.NaN] },
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new Circle({
          material: painted(),
          fill: { kind: "solid", color: [1, 0, 0, 1], opacity: 2 },
        }),
    ).toThrow(/opacity/);
  });

  it("refuses a paint on a material that cannot multiply vertex colours", () => {
    expect(() => new Circle({ material: material(), fill: BLUE })).toThrow(
      /vertexColors/,
    );
    const circle = new Circle({ material: material() });
    expect(() => {
      circle.fill = BLUE;
    }).toThrow(/vertexColors/);
    // …and accepts the two words, which need no colour stream at all.
    circle.fill = "none";
    expect(circle.fill).toBe("none");
  });
});

describe("§58 stroke — the band beside the fill", () => {
  it("adds the band's triangles after the fill's, in one geometry", () => {
    const filled = new Rectangle({ width: 4, height: 2, material: material() });
    const stroked = new Rectangle({
      width: 4,
      height: 2,
      material: material(),
      stroke: { width: 0.5 },
    });
    // 12 of perimeter × 0.5 wide, plus four miter corners of (0.5/2)².
    expect(filledArea(stroked) - filledArea(filled)).toBeCloseTo(
      12 * 0.5 + 4 * 0.25 * 0.25,
      9,
    );
    expect(stroked.geometry.colors).toBeUndefined();
  });

  it("resolves every optional field and hands back a copy", () => {
    const shape = new Rectangle({
      material: material(),
      stroke: { width: 0.2 },
    });
    expect(shape.stroke).toEqual({
      width: 0.2,
      alignment: "center",
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 4,
      dashOffset: 0,
    });
    const authored = { width: 0.2, dash: [1, 1] };
    shape.stroke = authored;
    authored.dash[0] = 5;
    expect(shape.stroke?.dash).toEqual([1, 1]);
  });

  it("paints the fill and the stroke in two colours through one draw", () => {
    const shape = new Rectangle({
      width: 4,
      height: 2,
      material: painted(),
      fill: BLUE,
      stroke: { width: 0.2, paint: WHITE },
    });
    expect(distinctColors(shape)).toEqual([
      [0.25, 0.5, 1, 1],
      [1, 1, 1, 1],
    ]);
    expect(vertexColors(shape)).toHaveLength(
      shape.geometry.positions.length / 3,
    );
  });

  it("gives the unpainted half the identity, so the material's colour reaches it", () => {
    const shape = new Rectangle({
      width: 4,
      height: 2,
      material: painted(),
      stroke: { width: 0.2, paint: WHITE },
    });
    expect(distinctColors(shape)).toEqual([[1, 1, 1, 1]]);
    const outlined = new Rectangle({
      width: 4,
      height: 2,
      material: painted(),
      fill: BLUE,
      stroke: { width: 0.2 },
    });
    expect(distinctColors(outlined)).toEqual([
      [0.25, 0.5, 1, 1],
      [1, 1, 1, 1],
    ]);
  });

  it("strokes at the shape's own tolerance, so fill and stroke agree", () => {
    const coarse = new Circle({
      radius: 1,
      material: material(),
      tolerance: 0.2,
      stroke: { width: 0.1, lineJoin: "round" },
    });
    const fine = new Circle({
      radius: 1,
      material: material(),
      tolerance: 0.001,
      stroke: { width: 0.1, lineJoin: "round" },
    });
    expect(fine.geometry.positions.length).toBeGreaterThan(
      coarse.geometry.positions.length * 3,
    );
    coarse.tolerance = 0.001;
    expect(coarse.geometry.positions.length).toBe(
      fine.geometry.positions.length,
    );
  });

  it("refuses a stroke it cannot expand, at the write that named it", () => {
    const shape = new Rectangle({ material: material() });
    expect(() => {
      shape.stroke = { width: 0 };
    }).toThrow(/width/);
    expect(() => {
      shape.stroke = { width: 1, miterLimit: 0 };
    }).toThrow(/miterLimit/);
    expect(() => {
      shape.stroke = { width: 1, dashOffset: Number.NaN };
    }).toThrow(/dashOffset/);
    expect(() => {
      shape.stroke = { width: 1, dash: [1, -1] };
    }).toThrow(/dash\[1\]/);
    expect(() => {
      shape.stroke = { width: 1, dash: [1, Number.NaN] };
    }).toThrow(/dash\[1\]/);
    expect(() => {
      shape.stroke = { width: 1, dash: [0, 0] };
    }).toThrow(/not all be zero/);
    expect(shape.stroke).toBeNull();
  });

  it("refuses a stroke paint on a material that cannot multiply vertex colours", () => {
    const shape = new Rectangle({ material: material() });
    expect(() => {
      shape.stroke = { width: 1, paint: WHITE };
    }).toThrow(/vertexColors/);
    shape.stroke = { width: 1 };
    expect(shape.stroke?.width).toBe(1);
    shape.stroke = null;
    expect(shape.stroke).toBeNull();
  });

  it("drops both streams when a rebuild empties the shape", () => {
    const shape = new Rectangle({
      width: 2,
      height: 2,
      material: painted(),
      fill: BLUE,
      stroke: { width: 0.1, paint: WHITE },
    });
    expect(shape.geometry.colors).toBeDefined();
    shape.fill = "none";
    shape.stroke = null;
    expect(shape.geometry.positions).toHaveLength(0);
    expect(shape.geometry.colors).toBeUndefined();
    expect(shape.geometry.indices).toBeUndefined();
  });
});

describe("§50 line, polyline, arc — the three stroke-only primitives", () => {
  it("draws a line as its band, with no fill", () => {
    const line = new Line({
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      stroke: { width: 0.5 },
      material: material(),
    });
    expect(line.fill).toBe("none");
    expect(filledArea(line)).toBeCloseTo(2, 9);
    expect(line.start).toEqual({ x: 0, y: 0 });
    expect(line.end).toEqual({ x: 4, y: 0 });
    line.end = { x: 8, y: 0 };
    expect(filledArea(line)).toBeCloseTo(4, 9);
    line.start = { x: 4, y: 0 };
    expect(filledArea(line)).toBeCloseTo(2, 9);
  });

  it("draws a zero-length line as nothing, rather than refusing it", () => {
    const line = new Line({
      start: { x: 1, y: 1 },
      end: { x: 1, y: 1 },
      stroke: { width: 0.5, lineCap: "round" },
      material: material(),
    });
    expect(line.geometry.positions).toHaveLength(0);
  });

  it("refuses a line endpoint that is not finite (§85)", () => {
    expect(
      () =>
        new Line({
          start: { x: Number.NaN, y: 0 },
          end: { x: 1, y: 0 },
          stroke: { width: 1 },
          material: material(),
        }),
    ).toThrow(/Line start/);
    const line = new Line({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      stroke: { width: 1 },
      material: material(),
    });
    expect(() => {
      line.end = { x: 0, y: Number.POSITIVE_INFINITY };
    }).toThrow(/Line end/);
  });

  it("draws a polyline open — its two ends capped, its corner joined", () => {
    const polyline = new Polyline({
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      stroke: { width: 1 },
      material: material(),
    });
    // 8 of length × 1 wide + one miter corner of 0.5², with no closing segment.
    expect(filledArea(polyline)).toBeCloseTo(8 + 0.25, 9);
    expect(polyline.points).toHaveLength(3);
    polyline.points = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(filledArea(polyline)).toBeCloseTo(2, 9);
  });

  it("fills a polyline as if closed, when asked — SVG's rule", () => {
    const polyline = new Polyline({
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      stroke: { width: 0.001 },
      fill: "inherit",
      material: material(),
    });
    expect(filledArea(polyline)).toBeGreaterThan(8);
  });

  it("refuses a polyline of fewer than two points (§85)", () => {
    expect(
      () =>
        new Polyline({
          points: [{ x: 0, y: 0 }],
          stroke: { width: 1 },
          material: material(),
        }),
    ).toThrow(/at least 2/);
    const polyline = new Polyline({
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      stroke: { width: 1 },
      material: material(),
    });
    expect(() => {
      polyline.points = [];
    }).toThrow(/at least 2/);
  });

  it("draws an arc as an open curve, not a region", () => {
    const arc = new Arc({
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI,
      stroke: { width: 0.2 },
      material: material(),
      tolerance: 1e-5,
    });
    expect(arc.radius).toBe(2);
    expect(arc.startAngle).toBe(0);
    expect(arc.endAngle).toBe(Math.PI);
    // A half annulus: π(2.1² − 1.9²) / 2 = 0.4π, not the half disc a Sector
    // of the same numbers would draw.
    expect(filledArea(arc)).toBeGreaterThan(0.4 * Math.PI);
    expect(filledArea(arc)).toBeLessThan(0.4 * Math.PI + 0.05);
  });

  it("rebuilds an arc on every parameter, and refuses what §85 refuses", () => {
    const arc = new Arc({
      startAngle: 0,
      endAngle: Math.PI,
      stroke: { width: 0.1 },
      material: material(),
    });
    const before = filledArea(arc);
    arc.radius = 3;
    expect(filledArea(arc)).toBeGreaterThan(before);
    arc.startAngle = 0.5;
    arc.endAngle = 1;
    expect(filledArea(arc)).toBeLessThan(before);
    expect(() => {
      arc.radius = 0;
    }).toThrow(/Arc radius/);
    expect(() => {
      arc.startAngle = Number.NaN;
    }).toThrow(/Arc startAngle/);
    expect(() => {
      arc.endAngle = Number.POSITIVE_INFINITY;
    }).toThrow(/Arc endAngle/);
  });

  it("draws a zero-sweep arc as nothing", () => {
    const arc = new Arc({
      startAngle: 1,
      endAngle: 1,
      stroke: { width: 0.1 },
      material: material(),
    });
    expect(arc.geometry.positions).toHaveLength(0);
  });

  it("answers toPath() with the open curve, for §51 and §79", () => {
    const line = new Line({
      start: { x: 0, y: 0 },
      end: { x: 3, y: 4 },
      stroke: { width: 1 },
      material: material(),
    });
    expect(line.toPath().length()).toBeCloseTo(5, 9);
    const polyline = new Polyline({
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ],
      stroke: { width: 1 },
      material: material(),
    });
    expect(polyline.toPath().length()).toBeCloseTo(7, 9);
    const arc = new Arc({
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI,
      stroke: { width: 1 },
      material: material(),
    });
    expect(arc.toPath().length()).toBeCloseTo(2 * Math.PI, 1);
  });
});
