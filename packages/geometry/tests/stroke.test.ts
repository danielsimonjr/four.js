/**
 * §52's stroke expansion (`R-16`, 2026-08-09).
 *
 * The oracle throughout is **area**, for `tessellation.test.ts`'s reason: a
 * stroke's triangles are checkable against a number the geometry has
 * analytically, and reading the vertex list proves nothing about whether the
 * band covers the right region. Where the band overlaps itself — the inside of
 * every corner, which `expandStroke` documents rather than removes — the
 * expected number is the true area *plus* the overlap, computed the same way,
 * so the tests assert the documented behaviour rather than a wish.
 *
 * Every triangle is also checked for counter-clockwise winding (§7a), which is
 * the one contract a caller cannot recover for itself.
 */

import {
  expandStroke,
  Path,
  type Polyline2D,
  type StrokeMesh,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

/** Signed area of a mesh — overlaps counted twice, which is the point. */
function area(mesh: StrokeMesh): number {
  let twice = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.positions[mesh.indices[i]];
    const b = mesh.positions[mesh.indices[i + 1]];
    const c = mesh.positions[mesh.indices[i + 2]];
    twice += (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }
  return twice / 2;
}

/** Whether every triangle turns counter-clockwise seen from +Z (§7a). */
function allCounterClockwise(mesh: StrokeMesh): boolean {
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.positions[mesh.indices[i]];
    const b = mesh.positions[mesh.indices[i + 1]];
    const c = mesh.positions[mesh.indices[i + 2]];
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) return false;
  }
  return true;
}

/** The mesh's bounding box, rounded past the flattening error. */
function bounds(mesh: StrokeMesh): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of mesh.positions) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return [minX, minY, maxX, maxY];
}

const SEGMENT: Polyline2D[] = [
  {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    closed: false,
  },
];

/** A counter-clockwise 10×10 square, centred — the closed-ring fixture. */
const SQUARE: Polyline2D[] = [
  {
    points: [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ],
    closed: true,
  },
];

describe("expandStroke — the band", () => {
  it("covers width × length for a straight butt-capped segment", () => {
    const mesh = expandStroke(SEGMENT, { width: 2, tolerance: 0.01 });
    expect(area(mesh)).toBe(20);
    expect(mesh.indices.length / 3).toBe(2);
    expect(allCounterClockwise(mesh)).toBe(true);
    expect(bounds(mesh)).toEqual([0, -1, 10, 1]);
  });

  it("straddles the path for `center` and sits on one side for the others", () => {
    const centered = expandStroke(SEGMENT, { width: 2, tolerance: 0.01 });
    const inside = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 0.01,
      alignment: "inside",
    });
    const outside = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 0.01,
      alignment: "outside",
    });
    expect(bounds(centered)).toEqual([0, -1, 10, 1]);
    // `inside` is the left of the travel direction — the interior of a
    // counter-clockwise ring, which is what makes the name true.
    expect(bounds(inside)).toEqual([0, 0, 10, 2]);
    expect(bounds(outside)).toEqual([0, -2, 10, 0]);
    expect(area(inside)).toBe(20);
    expect(area(outside)).toBe(20);
  });

  it("puts a counter-clockwise ring's `inside` band inside it", () => {
    const inside = expandStroke(SQUARE, {
      width: 2,
      tolerance: 1e-9,
      alignment: "inside",
    });
    expect(bounds(inside)).toEqual([-5, -5, 5, 5]);
    const outside = expandStroke(SQUARE, {
      width: 2,
      tolerance: 1e-9,
      alignment: "outside",
    });
    expect(bounds(outside)).toEqual([-7, -7, 7, 7]);
    // The outer band of a convex ring never overlaps itself, so its area is
    // exact: (14² − 10²).
    expect(area(outside)).toBeCloseTo(96, 9);
  });

  it("joins a closed ring at every vertex and caps it at none", () => {
    const mesh = expandStroke(SQUARE, { width: 2, tolerance: 1e-9 });
    // 40 of perimeter × 2 wide, + 4 miter corners of 1×1, + 4 inner overlaps
    // of 1×1 counted twice by the oracle.
    expect(area(mesh)).toBeCloseTo(84, 9);
    expect(bounds(mesh)).toEqual([-6, -6, 6, 6]);
    expect(allCounterClockwise(mesh)).toBe(true);
  });
});

describe("expandStroke — caps", () => {
  it("adds nothing for `butt`, a half width for `square`, a semicircle for `round`", () => {
    const butt = expandStroke(SEGMENT, { width: 2, tolerance: 1e-7 });
    const square = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 1e-7,
      lineCap: "square",
    });
    const round = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 1e-7,
      lineCap: "round",
    });
    expect(area(butt)).toBe(20);
    expect(area(square)).toBe(24);
    expect(area(round)).toBeCloseTo(20 + Math.PI, 4);
    expect(bounds(square)).toEqual([-1, -1, 11, 1]);
    expect(allCounterClockwise(round)).toBe(true);
  });

  it("caps an asymmetric band on the band's own end edge", () => {
    // `inside` puts the whole width to the left, so the round cap is a
    // semicircle centred half a width up rather than on the path.
    const round = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 1e-7,
      alignment: "inside",
      lineCap: "round",
    });
    const [minX, minY, maxX, maxY] = bounds(round);
    expect(minX).toBeCloseTo(-1, 5);
    expect(maxX).toBeCloseTo(11, 5);
    expect(minY).toBeCloseTo(0, 9);
    expect(maxY).toBeCloseTo(2, 9);
    expect(area(round)).toBeCloseTo(20 + Math.PI, 4);
  });

  it("caps a chain at both ends and nowhere in between", () => {
    const chain: Polyline2D[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
        ],
        closed: false,
      },
    ];
    const butt = expandStroke(chain, { width: 1, tolerance: 1e-9 });
    const square = expandStroke(chain, {
      width: 1,
      tolerance: 1e-9,
      lineCap: "square",
    });
    expect(square.indices.length).toBe(butt.indices.length + 12);
    expect(area(square) - area(butt)).toBeCloseTo(1, 9);
  });
});

describe("expandStroke — joins", () => {
  const corner: Polyline2D[] = [
    {
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      closed: false,
    },
  ];

  it("fills a right-angle corner with a square, a triangle or a quarter disc", () => {
    const miter = expandStroke(corner, { width: 2, tolerance: 1e-9 });
    const bevel = expandStroke(corner, {
      width: 2,
      tolerance: 1e-9,
      lineJoin: "bevel",
    });
    const round = expandStroke(corner, {
      width: 2,
      tolerance: 1e-9,
      lineJoin: "round",
    });
    // The oracle sums triangles, so the doubly-covered inner square is already
    // inside these 16 — twice, which is the overlap `expandStroke` documents.
    const quads = 8 * 2;
    expect(area(miter)).toBeCloseTo(quads + 1, 9);
    expect(area(bevel)).toBeCloseTo(quads + 0.5, 9);
    expect(area(round)).toBeCloseTo(quads + Math.PI / 4, 6);
    expect(allCounterClockwise(round)).toBe(true);
  });

  it("bevels a miter past the limit, and only then", () => {
    const spike: Polyline2D[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 0.5 },
        ],
        closed: false,
      },
    ];
    const generous = expandStroke(spike, {
      width: 1,
      tolerance: 1e-9,
      miterLimit: 100,
    });
    const strict = expandStroke(spike, {
      width: 1,
      tolerance: 1e-9,
      miterLimit: 1.5,
    });
    const bevelled = expandStroke(spike, {
      width: 1,
      tolerance: 1e-9,
      lineJoin: "bevel",
    });
    expect(area(generous)).toBeGreaterThan(area(strict) + 1);
    expect(area(strict)).toBeCloseTo(area(bevelled), 9);
  });

  it("joins nothing on a side the band does not reach", () => {
    // A counter-clockwise square turns left at every vertex, so the outer side
    // is the right one — which an `inside` band does not occupy at all.
    const inside = expandStroke(SQUARE, {
      width: 2,
      tolerance: 1e-9,
      alignment: "inside",
      lineJoin: "round",
    });
    expect(inside.indices.length / 3).toBe(8);
  });

  it("leaves a hairpin's notch under miter and bevel, and rounds it under round", () => {
    const hairpin: Polyline2D[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 0 },
        ],
        closed: false,
      },
    ];
    const miter = expandStroke(hairpin, { width: 2, tolerance: 1e-7 });
    const round = expandStroke(hairpin, {
      width: 2,
      tolerance: 1e-7,
      lineJoin: "round",
    });
    // Two quads over the same 20, and no join triangle at all: the two offset
    // points sit on a diameter through the vertex, so the bevel is collinear.
    expect(miter.indices.length / 3).toBe(4);
    expect(area(miter)).toBe(40);
    expect(area(round)).toBeCloseTo(40 + Math.PI / 2, 4);
    expect(bounds(round)[2]).toBeCloseTo(11, 4);
  });

  it("rounds a hairpin on whichever side an asymmetric band occupies", () => {
    // `outside` puts the whole width to the right, so the join's radius is the
    // width rather than half of it — which is where the band's edge is.
    const hairpin: Polyline2D[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 0 },
        ],
        closed: false,
      },
    ];
    const outside = expandStroke(hairpin, {
      width: 2,
      tolerance: 1e-7,
      alignment: "outside",
      lineJoin: "round",
    });
    expect(bounds(outside)[2]).toBeCloseTo(12, 4);
    expect(area(outside)).toBeCloseTo(40 + 2 * Math.PI, 4);
    expect(allCounterClockwise(outside)).toBe(true);
  });

  it("adds nothing at a straight-through vertex", () => {
    const straight: Polyline2D[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 10, y: 0 },
        ],
        closed: false,
      },
    ];
    expect(
      expandStroke(straight, { width: 2, tolerance: 1e-9 }).indices.length / 3,
    ).toBe(4);
    expect(
      expandStroke(straight, { width: 2, tolerance: 1e-9, lineJoin: "bevel" })
        .indices.length / 3,
    ).toBe(4);
    expect(
      expandStroke(straight, { width: 2, tolerance: 1e-9, lineJoin: "round" })
        .indices.length / 3,
    ).toBe(4);
  });

  it("miters a right turn on the left side, as it miters a left turn on the right", () => {
    const corner180: Polyline2D[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: -4 },
        ],
        closed: false,
      },
    ];
    const mesh = expandStroke(corner180, { width: 2, tolerance: 1e-9 });
    expect(allCounterClockwise(mesh)).toBe(true);
    expect(area(mesh)).toBeCloseTo(8 * 2 + 1, 9);
  });
});

describe("expandStroke — dashes", () => {
  it("walks arc length, and repeats an odd pattern SVG's way", () => {
    const even = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 0.01,
      dash: [2, 2],
    });
    const odd = expandStroke(SEGMENT, { width: 2, tolerance: 0.01, dash: [2] });
    expect(area(even)).toBe(12);
    expect(area(odd)).toBe(12);
  });

  it("moves the pattern by the offset, in both directions", () => {
    const shifted = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 0.01,
      dash: [2, 2],
      dashOffset: 2,
    });
    const negative = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 0.01,
      dash: [2, 2],
      dashOffset: -2,
    });
    expect(area(shifted)).toBe(8);
    expect(area(negative)).toBe(8);
  });

  it("caps every dash, so a dashed round-capped line is longer than its dashes", () => {
    const solid = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 1e-7,
      dash: [2, 2],
      lineCap: "round",
    });
    // Three dashes, six semicircular caps.
    expect(area(solid)).toBeCloseTo(12 + 3 * Math.PI, 4);
  });

  it("leaves a ring closed when the pattern never toggles over it", () => {
    const whole = expandStroke(SQUARE, {
      width: 2,
      tolerance: 1e-9,
      dash: [1000, 1],
    });
    const solid = expandStroke(SQUARE, { width: 2, tolerance: 1e-9 });
    expect(area(whole)).toBe(area(solid));
    const nothing = expandStroke(SQUARE, {
      width: 2,
      tolerance: 1e-9,
      dash: [1, 1000],
      dashOffset: 1,
    });
    expect(nothing.indices.length).toBe(0);
    expect(nothing.positions.length).toBe(0);
  });

  it("joins the dash that crosses a ring's seam into one piece", () => {
    // The pattern is "on" across the ring's first point. Without the join that
    // dash would be two, with two spurious caps where the ring happens to
    // start — so the test is that squaring the caps costs exactly two of them.
    const butt = expandStroke(SQUARE, {
      width: 2,
      tolerance: 1e-9,
      dash: [30, 10],
      dashOffset: 5,
    });
    const square = expandStroke(SQUARE, {
      width: 2,
      tolerance: 1e-9,
      dash: [30, 10],
      dashOffset: 5,
      lineCap: "square",
    });
    expect(area(square) - area(butt)).toBeCloseTo(2 * (1 * 2), 6);
  });

  it("draws nothing for a zero-length `on` entry", () => {
    const dots = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 0.01,
      dash: [0, 4],
      lineCap: "round",
    });
    expect(dots.indices.length).toBe(0);
  });
});

describe("expandStroke — what contributes nothing", () => {
  it("drops a polyline with fewer than two distinct points", () => {
    expect(
      expandStroke([{ points: [{ x: 1, y: 1 }], closed: false }], {
        width: 1,
        tolerance: 0.01,
        lineCap: "round",
      }).indices.length,
    ).toBe(0);
    expect(
      expandStroke(
        [
          {
            points: [
              { x: 1, y: 1 },
              { x: 1, y: 1 },
            ],
            closed: false,
          },
        ],
        { width: 1, tolerance: 0.01 },
      ).indices.length,
    ).toBe(0);
    expect(expandStroke([], { width: 1, tolerance: 0.01 }).positions).toEqual(
      [],
    );
  });

  it("drops a closed ring's repeated first point rather than stroking a spike", () => {
    const repeated = expandStroke(
      [
        {
          points: [
            { x: -5, y: -5 },
            { x: 5, y: -5 },
            { x: 5, y: 5 },
            { x: -5, y: 5 },
            { x: -5, y: -5 },
          ],
          closed: true,
        },
      ],
      { width: 2, tolerance: 1e-9 },
    );
    expect(area(repeated)).toBe(
      area(expandStroke(SQUARE, { width: 2, tolerance: 1e-9 })),
    );
  });

  it("still bends a round cap when the tolerance is coarser than the cap", () => {
    // `1 − tolerance/radius ≤ −1`: no chord can satisfy the request, so the
    // step falls back to a third of a turn and the cap is a coarse fan rather
    // than a single chord across the band.
    const coarse = expandStroke(SEGMENT, {
      width: 2,
      tolerance: 10,
      lineCap: "round",
    });
    expect(coarse.indices.length / 3).toBe(2 + 2 * 2);
    expect(allCounterClockwise(coarse)).toBe(true);
  });

  it("bounds a fan whose tolerance is finer than the coordinates can express", () => {
    const huge = expandStroke(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1e300, y: 0 },
          ],
          closed: false,
        },
      ],
      { width: 2e300, tolerance: 1e-300, lineCap: "round" },
    );
    expect(Number.isFinite(huge.indices.length)).toBe(true);
    expect(huge.indices.length / 3).toBeLessThanOrEqual(2 + 2 * 4096);
  });
});

describe("expandStroke — refusals (§85)", () => {
  const base = { width: 1, tolerance: 0.01 };
  it("refuses a width, tolerance, miter limit or dash offset it cannot use", () => {
    expect(() => expandStroke(SEGMENT, { ...base, width: 0 })).toThrow(
      RangeError,
    );
    expect(() => expandStroke(SEGMENT, { ...base, width: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => expandStroke(SEGMENT, { ...base, tolerance: -1 })).toThrow(
      RangeError,
    );
    expect(() => expandStroke(SEGMENT, { ...base, miterLimit: 0.5 })).toThrow(
      /miterLimit/,
    );
    expect(() =>
      expandStroke(SEGMENT, { ...base, miterLimit: Number.POSITIVE_INFINITY }),
    ).toThrow(/miterLimit/);
    expect(() =>
      expandStroke(SEGMENT, { ...base, dashOffset: Number.NaN }),
    ).toThrow(/dashOffset/);
  });

  it("refuses a dash pattern that is empty, negative or all zero", () => {
    expect(() => expandStroke(SEGMENT, { ...base, dash: [] })).toThrow(
      /at least one/,
    );
    expect(() => expandStroke(SEGMENT, { ...base, dash: [1, -1] })).toThrow(
      /dash\[1\]/,
    );
    expect(() =>
      expandStroke(SEGMENT, { ...base, dash: [1, Number.NaN] }),
    ).toThrow(/dash\[1\]/);
    expect(() => expandStroke(SEGMENT, { ...base, dash: [0, 0] })).toThrow(
      /not all be zero/,
    );
  });

  it("refuses a non-finite coordinate", () => {
    expect(() =>
      expandStroke(
        [
          {
            points: [
              { x: 0, y: 0 },
              { x: Number.NaN, y: 1 },
            ],
            closed: false,
          },
        ],
        base,
      ),
    ).toThrow(/point 1/);
    expect(() =>
      expandStroke(
        [{ points: [{ x: 0, y: Number.POSITIVE_INFINITY }], closed: false }],
        base,
      ),
    ).toThrow(/point 0/);
  });
});

describe("Path.polylines — the flattening a stroke needs", () => {
  it("reports each subpath's closedness beside its points", () => {
    const path = new Path()
      .moveTo(0, 0)
      .lineTo(2, 0)
      .lineTo(2, 2)
      .close()
      .moveTo(4, 0)
      .lineTo(6, 0);
    const polylines = path.polylines();
    expect(polylines).toHaveLength(2);
    expect(polylines[0].closed).toBe(true);
    expect(polylines[0].points).toHaveLength(3);
    expect(polylines[1].closed).toBe(false);
    expect(polylines[1].points).toHaveLength(2);
    // The same flattening `flatten()` reports, with one bit more.
    expect(polylines.map((p) => p.points)).toEqual(path.flatten());
  });

  it("refuses a tolerance it cannot flatten at (§85)", () => {
    expect(() => new Path().moveTo(0, 0).lineTo(1, 1).polylines(0)).toThrow(
      RangeError,
    );
  });

  it("strokes a circle into an annulus of the right area", () => {
    const circle = new Path().arc(0, 0, 5, 0, Math.PI * 2).close();
    const mesh = expandStroke(circle.polylines(1e-4), {
      width: 1,
      tolerance: 1e-4,
    });
    // π(5.5² − 4.5²) = 10π, plus the documented per-corner overlap of a
    // finely flattened ring.
    expect(area(mesh)).toBeGreaterThan(10 * Math.PI);
    expect(area(mesh)).toBeLessThan(10 * Math.PI + 1);
    expect(allCounterClockwise(mesh)).toBe(true);
  });
});
