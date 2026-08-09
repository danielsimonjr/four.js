/**
 * Unit tests for the nine §53 3D primitives (R-20).
 *
 * ## What is actually checked, and why it is not "the vertices are these"
 *
 * A primitive builder has three properties a caller depends on and a golden
 * vertex list would not prove:
 *
 * 1. **Winding.** Every triangle must be counter-clockwise seen from outside
 *    (§7a), because the backend sets `frontFace(CCW)` and a later packet will
 *    turn culling on. That is checked by recomputing each face's geometric
 *    normal `(b − a) × (c − a)` from the *positions* and requiring it to agree
 *    with the *authored* vertex normals — one assertion that fails if either
 *    the index order or the normals are wrong, and that needs no ground truth
 *    beyond the two arrays the builder emitted.
 * 2. **Normals.** Unit length everywhere, and — where the surface has a closed
 *    form — equal to the analytic normal. A sphere's is `position / radius`; a
 *    cylinder's side is radial; a cap's is ±Y; a height field's is the sampled
 *    gradient. Those are asserted directly, per primitive.
 * 3. **Uvs.** Present, two floats per vertex, inside `[0, 1]`, and laid out the
 *    way the doc comment promises — `u` around, `v` along, `v = 0` at the `−Y`
 *    or path-start end.
 *
 * Everything else (counts, bounds, validation) is asserted per builder in the
 * ordinary way. The helpers below are the same ones `geometry.test.ts` uses,
 * generalized over an arbitrary primitive; `faceNormal` deliberately does its
 * own cross product rather than calling `@four/math`, so the winding assertions
 * have ground truth independent of the package under test.
 */

import { describe, expect, it } from "vitest";

import {
  BufferGeometry,
  capsuleGeometry,
  coneGeometry,
  cylinderGeometry,
  extrudeGeometry,
  heightFieldGeometry,
  latheGeometry,
  sphereGeometry,
  torusGeometry,
  tubeGeometry,
} from "../src/index.js";

interface Point {
  x: number;
  y: number;
  z: number;
}

function vertex(geometry: BufferGeometry, index: number): Point {
  const p = geometry.positions;
  return { x: p[index * 3], y: p[index * 3 + 1], z: p[index * 3 + 2] };
}

function normalAt(geometry: BufferGeometry, index: number): Point {
  const n = geometry.normals;
  if (n === undefined) {
    throw new Error("expected a geometry with normals");
  }
  return { x: n[index * 3], y: n[index * 3 + 1], z: n[index * 3 + 2] };
}

function uvAt(geometry: BufferGeometry, index: number): [number, number] {
  const uvs = geometry.uvs;
  if (uvs === undefined) {
    throw new Error("expected a geometry with uvs");
  }
  return [uvs[index * 2], uvs[index * 2 + 1]];
}

/** `(b - a) × (c - a)` — the un-normalized face normal. */
function faceNormal(a: Point, b: Point, c: Point): Point {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx,
  };
}

function length(p: Point): number {
  return Math.hypot(p.x, p.y, p.z);
}

/**
 * Asserts the three universal properties: every triangle winds the way its
 * vertices' normals say it should, every normal is unit length, and every uv is
 * inside `[0, 1]` with one pair per vertex.
 *
 * Degenerate triangles — a sphere's poles, a cone's apex ring — are skipped for
 * the winding check and counted, because a zero-area face has no normal to
 * compare; the returned count is asserted per primitive so a builder cannot
 * quietly degenerate a face that should have had area.
 */
function assertSurface(
  geometry: BufferGeometry,
  label: string,
): { degenerate: number; faces: number } {
  const indices = geometry.indices;
  if (indices === undefined) {
    throw new Error(`${label}: expected an indexed geometry`);
  }
  expect(geometry.normals?.length, `${label}: normals`).toBe(
    geometry.positions.length,
  );
  expect(geometry.uvs?.length, `${label}: uvs`).toBe(geometry.vertexCount * 2);

  for (let i = 0; i < geometry.vertexCount; i += 1) {
    expect(
      length(normalAt(geometry, i)),
      `${label}: normal ${String(i)}`,
    ).toBeCloseTo(1, 5);
    const [u, v] = uvAt(geometry, i);
    expect(u, `${label}: u ${String(i)}`).toBeGreaterThanOrEqual(0);
    expect(u, `${label}: u ${String(i)}`).toBeLessThanOrEqual(1);
    expect(v, `${label}: v ${String(i)}`).toBeGreaterThanOrEqual(0);
    expect(v, `${label}: v ${String(i)}`).toBeLessThanOrEqual(1);
  }

  let degenerate = 0;
  const faces = indices.length / 3;
  for (let f = 0; f < faces; f += 1) {
    const i0 = indices[f * 3];
    const i1 = indices[f * 3 + 1];
    const i2 = indices[f * 3 + 2];
    expect(i0, `${label}: index range`).toBeLessThan(geometry.vertexCount);
    expect(i1, `${label}: index range`).toBeLessThan(geometry.vertexCount);
    expect(i2, `${label}: index range`).toBeLessThan(geometry.vertexCount);

    const geometric = faceNormal(
      vertex(geometry, i0),
      vertex(geometry, i1),
      vertex(geometry, i2),
    );
    const magnitude = length(geometric);
    if (magnitude < 1e-9) {
      degenerate += 1;
      continue;
    }
    const a = normalAt(geometry, i0);
    const b = normalAt(geometry, i1);
    const c = normalAt(geometry, i2);
    const authored = {
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
      z: (a.z + b.z + c.z) / 3,
    };
    const authoredLength = length(authored);
    const dot =
      (geometric.x * authored.x +
        geometric.y * authored.y +
        geometric.z * authored.z) /
      (magnitude * authoredLength);
    expect(dot, `${label}: face ${String(f)} winds inwards`).toBeGreaterThan(0);
  }
  return { degenerate, faces };
}

describe("sphereGeometry (§53)", () => {
  it("winds outwards, with unit normals and a rectangular uv chart", () => {
    const geometry = sphereGeometry({
      radius: 2,
      widthSegments: 8,
      heightSegments: 4,
    });

    expect(geometry.vertexCount).toBe(9 * 5);
    expect(geometry.drawCount).toBe(8 * 4 * 6);
    // Two rows of quads touch a pole; each contributes one degenerate triangle
    // per column.
    expect(assertSurface(geometry, "sphere").degenerate).toBe(16);
  });

  it("carries the analytic normal — position / radius — at every vertex", () => {
    const radius = 3;
    const geometry = sphereGeometry({ radius, widthSegments: 12 });

    for (let i = 0; i < geometry.vertexCount; i += 1) {
      const p = vertex(geometry, i);
      const n = normalAt(geometry, i);
      expect(length(p)).toBeCloseTo(radius, 4);
      expect(n.x).toBeCloseTo(p.x / radius, 5);
      expect(n.y).toBeCloseTo(p.y / radius, 5);
      expect(n.z).toBeCloseTo(p.z / radius, 5);
    }
  });

  it("puts v = 0 at the south pole and v = 1 at the north (§7a)", () => {
    const geometry = sphereGeometry({
      radius: 1,
      widthSegments: 4,
      heightSegments: 2,
    });

    // Ring 0 is the first `widthSegments + 1` vertices.
    expect(vertex(geometry, 0).y).toBeCloseTo(-1, 6);
    expect(uvAt(geometry, 0)[1]).toBe(0);
    const last = geometry.vertexCount - 1;
    expect(vertex(geometry, last).y).toBeCloseTo(1, 6);
    expect(uvAt(geometry, last)[1]).toBe(1);
    // The seam column repeats the first at u = 1, which is what stops the last
    // quad sampling the whole texture backwards.
    expect(uvAt(geometry, 4)[0]).toBe(1);
    expect(vertex(geometry, 4).x).toBeCloseTo(vertex(geometry, 0).x, 6);
  });

  it("rejects extents and segment counts that cannot make a surface", () => {
    expect(() => sphereGeometry({ radius: 0 })).toThrow(RangeError);
    expect(() => sphereGeometry({ widthSegments: 2 })).toThrow(RangeError);
    expect(() => sphereGeometry({ heightSegments: 1 })).toThrow(RangeError);
    expect(() => sphereGeometry({ widthSegments: 8.5 })).toThrow(RangeError);
  });
});

describe("cylinderGeometry (§53)", () => {
  it("winds outwards and spans the requested extents about +Y", () => {
    const geometry = cylinderGeometry({
      radius: 2,
      height: 6,
      radialSegments: 8,
    });

    expect(assertSurface(geometry, "cylinder").degenerate).toBe(0);
    const bounds = geometry.computeBounds();
    expect(bounds.min.y).toBeCloseTo(-3, 6);
    expect(bounds.max.y).toBeCloseTo(3, 6);
    expect(bounds.max.x).toBeCloseTo(2, 6);
  });

  it("gives the side a radial normal and each cap its own axial one", () => {
    const radialSegments = 6;
    const geometry = cylinderGeometry({ radius: 1, height: 2, radialSegments });

    const sideVertices = (radialSegments + 1) * 2;
    for (let i = 0; i < sideVertices; i += 1) {
      const p = vertex(geometry, i);
      const n = normalAt(geometry, i);
      expect(n.y).toBeCloseTo(0, 6);
      expect(n.x).toBeCloseTo(p.x, 5);
      expect(n.z).toBeCloseTo(p.z, 5);
    }
    // The two cap fans follow: bottom (−Y) then top (+Y).
    expect(normalAt(geometry, sideVertices).y).toBe(-1);
    expect(vertex(geometry, sideVertices).y).toBeCloseTo(-1, 6);
    const topCentre = sideVertices + radialSegments + 1;
    expect(normalAt(geometry, topCentre).y).toBe(1);
    expect(uvAt(geometry, topCentre)).toEqual([0.5, 0.5]);
  });

  it("omits both caps when asked, leaving an open tube", () => {
    const radialSegments = 5;
    const open = cylinderGeometry({ radialSegments, capped: false });
    const closed = cylinderGeometry({ radialSegments, capped: true });

    expect(open.vertexCount).toBe((radialSegments + 1) * 2);
    expect(closed.vertexCount).toBe(
      open.vertexCount + 2 * (radialSegments + 1),
    );
    expect(open.drawCount).toBe(radialSegments * 6);
    assertSurface(open, "open cylinder");
  });

  it("subdivides along the axis without changing the surface", () => {
    const geometry = cylinderGeometry({
      radialSegments: 6,
      heightSegments: 4,
      capped: false,
    });

    expect(geometry.vertexCount).toBe(7 * 5);
    assertSurface(geometry, "subdivided cylinder");
  });

  it("rejects extents and segment counts that cannot make a surface", () => {
    expect(() => cylinderGeometry({ radius: -1 })).toThrow(RangeError);
    expect(() => cylinderGeometry({ height: 0 })).toThrow(RangeError);
    expect(() => cylinderGeometry({ radialSegments: 2 })).toThrow(RangeError);
    expect(() => cylinderGeometry({ heightSegments: 0 })).toThrow(RangeError);
  });
});

describe("coneGeometry (§53)", () => {
  it("winds outwards, degenerating exactly one ring at the apex", () => {
    const radialSegments = 8;
    const geometry = coneGeometry({ radius: 1, height: 2, radialSegments });

    const { degenerate } = assertSurface(geometry, "cone");
    expect(degenerate).toBe(radialSegments);
    const bounds = geometry.computeBounds();
    expect(bounds.max.y).toBeCloseTo(1, 6);
    expect(bounds.min.y).toBeCloseTo(-1, 6);
  });

  it("shades the side by the slope, not radially", () => {
    // A 45° cone: the side normal is (cos θ, 1, sin θ)/√2.
    const geometry = coneGeometry({ radius: 1, height: 1, radialSegments: 4 });

    const n = normalAt(geometry, 0);
    expect(n.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.hypot(n.x, n.z)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("caps the base only — an apex needs no disc", () => {
    const radialSegments = 5;
    const capped = coneGeometry({ radialSegments });
    const open = coneGeometry({ radialSegments, capped: false });

    expect(open.vertexCount).toBe((radialSegments + 1) * 2);
    // One cap, not two.
    expect(capped.vertexCount).toBe(open.vertexCount + (radialSegments + 1));
    expect(normalAt(capped, open.vertexCount).y).toBe(-1);
  });

  it("rejects extents that cannot make a surface", () => {
    expect(() => coneGeometry({ radius: Number.NaN })).toThrow(RangeError);
    expect(() => coneGeometry({ height: -2 })).toThrow(RangeError);
    expect(() => coneGeometry({ radialSegments: 1 })).toThrow(RangeError);
    expect(() => coneGeometry({ heightSegments: 1.5 })).toThrow(RangeError);
  });
});

describe("capsuleGeometry (§53)", () => {
  it("winds outwards and spans height + 2·radius along Y", () => {
    const radius = 0.5;
    const height = 2;
    const geometry = capsuleGeometry({
      radius,
      height,
      radialSegments: 8,
      capSegments: 3,
    });

    expect(assertSurface(geometry, "capsule").degenerate).toBe(16);
    const bounds = geometry.computeBounds();
    expect(bounds.min.y).toBeCloseTo(-(height / 2 + radius), 6);
    expect(bounds.max.y).toBeCloseTo(height / 2 + radius, 6);
    expect(bounds.max.x).toBeCloseTo(radius, 6);
  });

  it("normals are radial about each cap centre, and about the axis between", () => {
    const radius = 1;
    const height = 4;
    const columns = 6;
    const capSegments = 4;
    const geometry = capsuleGeometry({
      radius,
      height,
      radialSegments: columns,
      capSegments,
    });

    for (let i = 0; i < geometry.vertexCount; i += 1) {
      const p = vertex(geometry, i);
      const n = normalAt(geometry, i);
      // Whichever half the vertex is in, its normal points away from that
      // half's cap centre — which on the cylindrical band is the pure radial
      // direction, because there the vertex is level with its centre.
      const centreY = p.y < 0 ? -height / 2 : height / 2;
      const dx = p.x;
      const dy = p.y - centreY;
      const dz = p.z;
      const magnitude = Math.hypot(dx, dy, dz);
      expect(magnitude).toBeCloseTo(radius, 5);
      expect(n.x).toBeCloseTo(dx / magnitude, 5);
      expect(n.y).toBeCloseTo(dy / magnitude, 5);
      expect(n.z).toBeCloseTo(dz / magnitude, 5);
    }

    // The two middle rows are the cylinder: same radius, purely radial normal.
    const stride = columns + 1;
    const tangencyBottom = capSegments * stride;
    const tangencyTop = (capSegments + 1) * stride;
    expect(normalAt(geometry, tangencyBottom).y).toBeCloseTo(0, 6);
    expect(normalAt(geometry, tangencyTop).y).toBeCloseTo(0, 6);
    expect(vertex(geometry, tangencyBottom).y).toBeCloseTo(-height / 2, 6);
    expect(vertex(geometry, tangencyTop).y).toBeCloseTo(height / 2, 6);
  });

  it("runs v from 0 at the bottom tip to 1 at the top", () => {
    const geometry = capsuleGeometry({ radialSegments: 4, capSegments: 2 });

    expect(uvAt(geometry, 0)[1]).toBe(0);
    expect(uvAt(geometry, geometry.vertexCount - 1)[1]).toBe(1);
  });

  it("defaults to radius 0.5, height 1, 32 × 8 segments", () => {
    const geometry = capsuleGeometry();

    expect(geometry.vertexCount).toBe(2 * (8 + 1) * (32 + 1));
    const bounds = geometry.computeBounds();
    expect(bounds.max.y).toBeCloseTo(1, 6);
    expect(bounds.min.y).toBeCloseTo(-1, 6);
  });

  it("rejects extents and segment counts that cannot make a surface", () => {
    expect(() => capsuleGeometry({ radius: 0 })).toThrow(RangeError);
    expect(() => capsuleGeometry({ height: Number.NaN })).toThrow(RangeError);
    expect(() => capsuleGeometry({ radialSegments: 2 })).toThrow(RangeError);
    expect(() => capsuleGeometry({ capSegments: 0 })).toThrow(RangeError);
  });
});

describe("torusGeometry (§53)", () => {
  it("winds outwards with no degenerate faces", () => {
    const geometry = torusGeometry({
      radius: 2,
      tubeRadius: 0.5,
      tubularSegments: 8,
      radialSegments: 8,
    });

    const { degenerate, faces } = assertSurface(geometry, "torus");
    expect(degenerate).toBe(0);
    expect(faces).toBe(8 * 8 * 2);
    // Eight radial segments sample v = π/2 exactly, so the tessellated extents
    // reach the analytic ones on both axes.
    const bounds = geometry.computeBounds();
    expect(bounds.max.x).toBeCloseTo(2.5, 5);
    expect(bounds.max.y).toBeCloseTo(0.5, 5);
    expect(bounds.min.y).toBeCloseTo(-0.5, 5);
  });

  it("carries the analytic normal, and puts v = 0 on the outer equator", () => {
    const radius = 1;
    const tubeRadius = 0.25;
    const geometry = torusGeometry({
      radius,
      tubeRadius,
      tubularSegments: 8,
      radialSegments: 8,
    });

    for (let i = 0; i < geometry.vertexCount; i += 1) {
      const p = vertex(geometry, i);
      const n = normalAt(geometry, i);
      // The tube's centre line, directly "below" this vertex in plan view.
      const planar = Math.hypot(p.x, p.z);
      const centreX = (p.x / planar) * radius;
      const centreZ = (p.z / planar) * radius;
      expect(
        Math.hypot(p.x - centreX, p.y, p.z - centreZ),
        `vertex ${String(i)} is off the tube`,
      ).toBeCloseTo(tubeRadius, 5);
      expect(n.x).toBeCloseTo((p.x - centreX) / tubeRadius, 5);
      expect(n.y).toBeCloseTo(p.y / tubeRadius, 5);
      expect(n.z).toBeCloseTo((p.z - centreZ) / tubeRadius, 5);
    }

    expect(uvAt(geometry, 0)).toEqual([0, 0]);
    expect(vertex(geometry, 0).y).toBeCloseTo(0, 6);
    expect(vertex(geometry, 0).x).toBeCloseTo(radius + tubeRadius, 6);
  });

  it("defaults to radius 1, tube 0.4, 32 × 16 segments", () => {
    const geometry = torusGeometry();

    expect(geometry.vertexCount).toBe((32 + 1) * (16 + 1));
    const bounds = geometry.computeBounds();
    expect(bounds.max.x).toBeCloseTo(1.4, 5);
  });

  it("rejects radii and segment counts that cannot make a surface", () => {
    expect(() => torusGeometry({ radius: 0 })).toThrow(RangeError);
    expect(() => torusGeometry({ tubeRadius: -1 })).toThrow(RangeError);
    expect(() => torusGeometry({ tubularSegments: 2 })).toThrow(RangeError);
    expect(() => torusGeometry({ radialSegments: 2 })).toThrow(RangeError);
  });
});

describe("latheGeometry (§53)", () => {
  it("winds outwards and revolves the profile about +Y", () => {
    const geometry = latheGeometry({
      points: [
        { x: 0.5, y: -1 },
        { x: 1, y: 0 },
        { x: 0.5, y: 1 },
      ],
      segments: 8,
    });

    expect(geometry.vertexCount).toBe(9 * 3);
    expect(assertSurface(geometry, "lathe").degenerate).toBe(0);
    const bounds = geometry.computeBounds();
    expect(bounds.max.x).toBeCloseTo(1, 5);
    expect(bounds.min.y).toBeCloseTo(-1, 6);
  });

  it("reproduces a sphere's exact radial normals from a circular profile", () => {
    // Half a unit circle, bottom to top: the lathe of it *is* a sphere, so its
    // profile-derived normals must equal position / radius.
    const rings = 8;
    const points = Array.from({ length: rings + 1 }, (_, i) => {
      const phi = (Math.PI * i) / rings;
      return { x: Math.sin(phi), y: -Math.cos(phi) };
    });
    const geometry = latheGeometry({ points, segments: 12 });

    for (let i = 0; i < geometry.vertexCount; i += 1) {
      const p = vertex(geometry, i);
      const n = normalAt(geometry, i);
      // At a pole the ring has zero radius and the central difference is
      // one-sided, so the normal leans by half a segment — 11° at 8 rings.
      // Every face touching it is degenerate, so nothing shades from it; the
      // assertion is only that it still points along the right end of the axis.
      if (Math.hypot(p.x, p.z) < 1e-6) {
        expect(n.y * p.y).toBeGreaterThan(0.9);
        continue;
      }
      expect(n.x).toBeCloseTo(p.x, 3);
      expect(n.y).toBeCloseTo(p.y, 3);
      expect(n.z).toBeCloseTo(p.z, 3);
    }
  });

  it("runs v along the profile in the order the points were given", () => {
    const geometry = latheGeometry({
      points: [
        { x: 1, y: 0 },
        { x: 1, y: 5 },
      ],
      segments: 4,
    });

    expect(uvAt(geometry, 0)).toEqual([0, 0]);
    expect(vertex(geometry, 0).y).toBe(0);
    expect(uvAt(geometry, geometry.vertexCount - 1)).toEqual([1, 1]);
    expect(vertex(geometry, geometry.vertexCount - 1).y).toBe(5);
  });

  it("rejects profiles and segment counts that cannot make a surface", () => {
    expect(() => latheGeometry({ points: [{ x: 1, y: 0 }] })).toThrow(
      /at least 2 profile points/,
    );
    expect(() =>
      latheGeometry({
        points: [
          { x: -1, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow(/non-negative/);
    expect(() =>
      latheGeometry({
        points: [
          { x: 1, y: Number.NaN },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow(/must be finite/);
    expect(() =>
      latheGeometry({
        points: [
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        segments: 2,
      }),
    ).toThrow(RangeError);
  });

  it("survives a profile whose consecutive points coincide", () => {
    // A zero-length tangent would divide by zero; the builder falls back to a
    // length of 1 rather than emitting NaN, which §85 would then reject.
    const geometry = latheGeometry({
      points: [
        { x: 1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      segments: 4,
    });

    for (const value of geometry.normals ?? []) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("extrudeGeometry (§53)", () => {
  /** A counter-clockwise unit square in the XY plane. */
  const square = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];

  it("extrudes along +Z, centred, with flat per-edge side normals", () => {
    const geometry = extrudeGeometry({ shape: square, depth: 0.5 });

    expect(assertSurface(geometry, "extrude").degenerate).toBe(0);
    const bounds = geometry.computeBounds();
    expect(bounds.min.z).toBeCloseTo(-0.25, 6);
    expect(bounds.max.z).toBeCloseTo(0.25, 6);
    expect([bounds.min.x, bounds.max.x]).toEqual([-1, 1]);

    // Edge 0 runs (−1,−1) → (1,−1); its outward normal is −Y.
    for (let i = 0; i < 4; i += 1) {
      const n = normalAt(geometry, i);
      expect([n.x, n.y, n.z]).toEqual([0, -1, 0]);
    }
  });

  it("caps both ends facing outwards, and omits them when asked", () => {
    const capped = extrudeGeometry({ shape: square, depth: 1 });
    const open = extrudeGeometry({ shape: square, depth: 1, capped: false });

    expect(open.vertexCount).toBe(4 * 4);
    // One rim per cap, no centroid: §52's tessellator triangulates the outline
    // itself, so a square's cap is 2 triangles rather than a 4-triangle fan.
    expect(capped.vertexCount).toBe(open.vertexCount + 2 * 4);
    expect(open.drawCount).toBe(4 * 6);
    expect(capped.drawCount).toBe(4 * 6 + 2 * 3 * 2);

    // The front cap's rim is the first block of vertices after the side walls.
    const frontRim = 4 * 4;
    expect(normalAt(capped, frontRim)).toEqual({ x: 0, y: 0, z: 1 });
    expect(vertex(capped, frontRim).z).toBeCloseTo(0.5, 6);
    const backRim = frontRim + 4;
    expect(normalAt(capped, backRim)).toEqual({ x: 0, y: 0, z: -1 });
    expect(vertex(capped, backRim).z).toBeCloseTo(-0.5, 6);
    assertSurface(open, "open extrude");
    assertSurface(capped, "capped extrude");
  });

  it("normalizes a clockwise outline, so either winding extrudes outwards", () => {
    const clockwise = [...square].reverse();
    const geometry = extrudeGeometry({ shape: clockwise, depth: 0.5 });

    assertSurface(geometry, "clockwise extrude");
    // Every side normal points away from the (origin-centred) outline.
    for (let i = 0; i < 4 * 4; i += 1) {
      const p = vertex(geometry, i);
      const n = normalAt(geometry, i);
      expect(n.x * p.x + n.y * p.y).toBeGreaterThan(0);
    }
  });

  it("maps side u by arc length and cap uv by the outline's bounding box", () => {
    const geometry = extrudeGeometry({
      shape: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 1 },
        { x: 0, y: 1 },
      ],
      depth: 1,
    });

    // Perimeter is 8; the first edge is 3 long, so it takes u ∈ [0, 0.375].
    expect(uvAt(geometry, 0)).toEqual([0, 0]);
    expect(uvAt(geometry, 1)[0]).toBeCloseTo(3 / 8, 6);
    expect(uvAt(geometry, 3)).toEqual([0, 1]);

    // The front cap's rim is the first block after the side walls: vertex
    // (0, 0) maps to (0, 0) and (3, 1) to (1, 1).
    const rim = 4 * 4;
    expect(uvAt(geometry, rim)).toEqual([0, 0]);
    expect(uvAt(geometry, rim + 2)).toEqual([1, 1]);
  });

  it("caps a concave outline — the restriction §52's tessellator lifted", () => {
    // An L: convex nowhere near its inner corner. Until 2026-08-09 this was
    // `expect(() => extrudeGeometry({ shape: concave })).toThrow(/concave/)`,
    // because the caps were a centroid fan that folded over such an outline.
    const concave = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];

    const capped = extrudeGeometry({ shape: concave, depth: 0.5 });
    expect(capped.vertexCount).toBe(concave.length * 4 + 2 * concave.length);
    // Six points, four cap triangles per end.
    expect(capped.drawCount).toBe(6 * 6 + 2 * 3 * 4);
    expect(assertSurface(capped, "concave extrude").degenerate).toBe(0);

    // The caps really cover the L's 3 square units, twice, and no more: a
    // folded fan would have covered the 4-unit bounding square instead.
    const indices = capped.indices ?? new Uint16Array();
    let capArea = 0;
    for (let i = 6 * 6; i < indices.length; i += 3) {
      const a = vertex(capped, indices[i]);
      const b = vertex(capped, indices[i + 1]);
      const c = vertex(capped, indices[i + 2]);
      capArea +=
        Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    }
    expect(capArea).toBeCloseTo(2 * 3, 10);

    // Uncapped, the same outline is still fine, as it always was.
    const walls = extrudeGeometry({ shape: concave, capped: false });
    expect(walls.vertexCount).toBe(concave.length * 4);
    assertSurface(walls, "concave walls");
  });

  it("still refuses a self-intersecting outline when capped (§52 tier)", () => {
    // A pentagram: §52's "self-intersections where well-defined" needs a fill
    // rule this release does not ship, so the tessellator refuses and the
    // extrusion refuses with it.
    const pentagram: { x: number; y: number }[] = [];
    for (let i = 0; i < 5; i += 1) {
      const angle = (Math.PI * 2 * ((i * 2) % 5)) / 5;
      pentagram.push({
        x: Math.round(Math.cos(angle) * 1000),
        y: Math.round(Math.sin(angle) * 1000),
      });
    }

    expect(() => extrudeGeometry({ shape: pentagram })).toThrow(/not simple/);
    // Uncapped it extrudes: side walls need no triangulation at all.
    expect(
      extrudeGeometry({ shape: pentagram, capped: false }).vertexCount,
    ).toBe(5 * 4);
  });

  it("rejects degenerate outlines and depths", () => {
    expect(() => extrudeGeometry({ shape: square, depth: 0 })).toThrow(
      RangeError,
    );
    expect(() => extrudeGeometry({ shape: [{ x: 0, y: 0 }] })).toThrow(
      /at least 3 points/,
    );
    expect(() =>
      extrudeGeometry({ shape: [{ x: 0, y: 0 }], capped: false }),
    ).toThrow(/at least 3 points/);
    expect(() =>
      extrudeGeometry({
        shape: [
          { x: 0, y: Number.NaN },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow(/not finite/);
    expect(() =>
      extrudeGeometry({
        shape: [
          { x: 0, y: Number.POSITIVE_INFINITY },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        capped: false,
      }),
    ).toThrow(/not finite/);
    // A symmetric bowtie encloses no area at all. The message now comes from
    // the tessellator, which says "ring" where the fan's check said "outline".
    expect(() =>
      extrudeGeometry({
        shape: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 0, y: 2 },
          { x: 2, y: 2 },
        ],
      }),
    ).toThrow(/non-zero area/);
  });

  it("emits finite data for a degenerate uncapped outline", () => {
    // Every point the same: no perimeter to normalize u by and no edge
    // direction to take a normal from. The builder must still emit finite
    // arrays — `BufferGeometry` rejects NaN (§85), and a §85 failure blamed on
    // the geometry rather than on the outline would be a confusing report.
    const geometry = extrudeGeometry({
      shape: [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
      capped: false,
    });

    for (const value of geometry.uvs ?? []) {
      expect(Number.isFinite(value)).toBe(true);
    }
    for (const value of geometry.normals ?? []) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("tolerates a collinear vertex on an otherwise convex outline", () => {
    const geometry = extrudeGeometry({
      shape: [
        { x: -1, y: -1 },
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
      depth: 0.2,
    });

    // Five outline points, so five side quads and five rim vertices per cap —
    // a collinear vertex keeps its wall and its cap vertex. What it does not
    // get is a cap *triangle*: the tessellator drops it before clipping, so
    // the caps are the 2 triangles of the effective square, not 3 (§52).
    expect(geometry.vertexCount).toBe(5 * 4 + 2 * 5);
    expect(geometry.drawCount).toBe(5 * 6 + 2 * 3 * 2);
    expect(assertSurface(geometry, "collinear extrude").degenerate).toBe(0);
  });
});

describe("tubeGeometry (§53)", () => {
  const straight = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ];

  it("sweeps a circle of the requested radius along the path", () => {
    const radius = 0.25;
    const geometry = tubeGeometry({
      path: straight,
      radius,
      radialSegments: 6,
    });

    expect(geometry.vertexCount).toBe(7 * 3);
    expect(assertSurface(geometry, "tube").degenerate).toBe(0);

    // Every vertex is exactly `radius` from its own path point, in the plane
    // perpendicular to the (constant, +X) tangent.
    for (let ring = 0; ring < 3; ring += 1) {
      for (let column = 0; column <= 6; column += 1) {
        const p = vertex(geometry, ring * 7 + column);
        expect(p.x).toBeCloseTo(straight[ring].x, 6);
        expect(Math.hypot(p.y, p.z)).toBeCloseTo(radius, 5);
      }
    }
  });

  it("gives every vertex the outward radial normal of its own ring", () => {
    const geometry = tubeGeometry({
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 1 },
      ],
      radius: 0.5,
      radialSegments: 8,
    });

    for (let ring = 0; ring < 3; ring += 1) {
      for (let column = 0; column <= 8; column += 1) {
        const index = ring * 9 + column;
        const p = vertex(geometry, index);
        const n = normalAt(geometry, index);
        const centre = [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 2, y: 0, z: 1 },
        ][ring];
        expect(n.x).toBeCloseTo((p.x - centre.x) / 0.5, 5);
        expect(n.y).toBeCloseTo((p.y - centre.y) / 0.5, 5);
        expect(n.z).toBeCloseTo((p.z - centre.z) / 0.5, 5);
      }
    }
  });

  it("carries a parallel-transported frame through a straight run", () => {
    // A Frenet frame is undefined where the curvature vanishes; the transported
    // one is continuous, so the seam column stays put along the straight middle.
    const geometry = tubeGeometry({
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      radius: 1,
      radialSegments: 4,
    });

    const first = vertex(geometry, 0);
    for (let ring = 1; ring < 4; ring += 1) {
      const p = vertex(geometry, ring * 5);
      expect(p.y).toBeCloseTo(first.y, 6);
      expect(p.z).toBeCloseTo(first.z, 6);
    }
  });

  it("seeds the frame from the axis least aligned with the tangent", () => {
    // Three paths, one per dominant axis, to cover every seed branch.
    for (const path of [
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
    ]) {
      const geometry = tubeGeometry({ path, radius: 0.1, radialSegments: 3 });
      assertSurface(geometry, "seeded tube");
    }
  });

  it("runs v from 0 at the first path point to 1 at the last", () => {
    const geometry = tubeGeometry({ path: straight, radialSegments: 3 });

    expect(uvAt(geometry, 0)[1]).toBe(0);
    expect(uvAt(geometry, geometry.vertexCount - 1)[1]).toBe(1);
    expect(uvAt(geometry, 3)[0]).toBe(1);
  });

  it("rejects paths and radii that cannot make a tube", () => {
    expect(() => tubeGeometry({ path: [{ x: 0, y: 0, z: 0 }] })).toThrow(
      /at least 2 path points/,
    );
    expect(() =>
      tubeGeometry({
        path: [
          { x: 0, y: 0, z: Number.NaN },
          { x: 1, y: 0, z: 0 },
        ],
      }),
    ).toThrow(/not finite/);
    expect(() => tubeGeometry({ path: straight, radius: 0 })).toThrow(
      RangeError,
    );
    expect(() => tubeGeometry({ path: straight, radialSegments: 2 })).toThrow(
      RangeError,
    );
    // A doubled-back point leaves the central difference with no direction.
    expect(() =>
      tubeGeometry({
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
      }),
    ).toThrow(/no direction to sweep/);
  });
});

describe("heightFieldGeometry (§53)", () => {
  /** A 3 × 3 field that rises along +X only, so ∂y/∂z is zero everywhere. */
  const ramp = [0, 1, 2, 0, 1, 2, 0, 1, 2];

  it("lays the grid out in XZ, centred, with no duplicated seam", () => {
    const geometry = heightFieldGeometry({
      heights: ramp,
      columns: 3,
      rows: 3,
      width: 4,
      depth: 6,
    });

    expect(geometry.vertexCount).toBe(9);
    expect(geometry.drawCount).toBe(2 * 2 * 6);
    expect(vertex(geometry, 0)).toEqual({ x: -2, y: 0, z: -3 });
    expect(vertex(geometry, 8)).toEqual({ x: 2, y: 2, z: 3 });
    expect(assertSurface(geometry, "height field").degenerate).toBe(0);
  });

  it("normals are the sampled gradient, and every face faces up", () => {
    const geometry = heightFieldGeometry({
      heights: ramp,
      columns: 3,
      rows: 3,
      width: 4,
      depth: 4,
    });

    // The ramp rises 1 per 2 units of x, so ∂y/∂x = 0.5 and the normal is
    // (−0.5, 1, 0) normalized.
    const expected = Math.hypot(0.5, 1);
    for (let i = 0; i < geometry.vertexCount; i += 1) {
      const n = normalAt(geometry, i);
      expect(n.x).toBeCloseTo(-0.5 / expected, 5);
      expect(n.y).toBeCloseTo(1 / expected, 5);
      expect(n.z).toBeCloseTo(0, 6);
    }
  });

  it("gives a flat field the +Y normal and the grid's own uv square", () => {
    const geometry = heightFieldGeometry({
      heights: new Float32Array(6),
      columns: 3,
      rows: 2,
    });

    for (let i = 0; i < geometry.vertexCount; i += 1) {
      expect(normalAt(geometry, i)).toEqual({ x: -0, y: 1, z: -0 });
    }
    expect(uvAt(geometry, 0)).toEqual([0, 0]);
    expect(uvAt(geometry, 2)).toEqual([1, 0]);
    expect(uvAt(geometry, 5)).toEqual([1, 1]);
  });

  it("rejects malformed grids (§85)", () => {
    expect(() =>
      heightFieldGeometry({ heights: [0, 0, 0], columns: 2, rows: 2 }),
    ).toThrow(/rows × columns/);
    expect(() =>
      heightFieldGeometry({ heights: [0, 0], columns: 1, rows: 2 }),
    ).toThrow(RangeError);
    expect(() =>
      heightFieldGeometry({ heights: [0, 0], columns: 2, rows: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      heightFieldGeometry({
        heights: [0, 0, 0, Number.NaN],
        columns: 2,
        rows: 2,
      }),
    ).toThrow(/must be finite/);
    expect(() =>
      heightFieldGeometry({
        heights: [0, 0, 0, 0],
        columns: 2,
        rows: 2,
        width: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      heightFieldGeometry({
        heights: [0, 0, 0, 0],
        columns: 2,
        rows: 2,
        depth: -1,
      }),
    ).toThrow(RangeError);
  });
});
