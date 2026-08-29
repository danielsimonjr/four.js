/**
 * §71's `"geometry"` strategy — A-11's analytic tier (adopted RFC 0005 Q3,
 * 2026-08-29): exact ray/triangle intersection against a candidate's
 * tessellated triangles, and the `node.hitTestMode` dispatch that selects it.
 *
 * The geometry of every test: an orthographic camera looking down −Z, a unit
 * box at z = −2 spanning NDC `[-0.25, 0.25]²`, and inside it the lower-left
 * **half** of that box as a single triangle — so any pick in the upper-right
 * half is exactly the case the analytic tier exists for: inside the box,
 * outside the shape.
 */

import { isFourError } from "@four/core";
import { Vector3 } from "@four/math";
import { Group, OrthographicCamera, type HitTestMode } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  pick,
  type PickHit,
  type Pickable,
  type PickableTriangles,
} from "../src/pick.js";

/** Orthographic camera showing world `[-2, 2]²`, looking down −Z. */
function orthoCamera(): OrthographicCamera {
  return new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
    near: 1,
    far: 21,
  });
}

/**
 * The lower-left half of the local unit square at z = 0, as one triangle —
 * non-indexed: three consecutive position triples.
 */
function lowerLeftTriangle(): PickableTriangles {
  return {
    // prettier-ignore
    positions: new Float32Array([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
      -0.5,  0.5, 0,
    ]),
  };
}

/** The full local unit square at z = 0, indexed: four vertices, two triangles. */
function indexedQuad(): PickableTriangles {
  return {
    // prettier-ignore
    positions: new Float32Array([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
      -0.5,  0.5, 0,
       0.5,  0.5, 0,
    ]),
    indices: new Uint16Array([0, 1, 2, 2, 1, 3]),
  };
}

/**
 * A flat unit-box candidate at z = −2 (NDC `[-0.25, 0.25]²`), with `mode` on
 * its node and `triangles` on the candidate.
 */
function box(
  mode: HitTestMode | null = null,
  triangles?: PickableTriangles,
): Pickable {
  const node = new Group();
  node.hitTestMode = mode;
  node.transform.position.set(0, 0, -2);
  return {
    node,
    boundsMin: new Vector3(-0.5, -0.5, 0),
    boundsMax: new Vector3(0.5, 0.5, 0),
    triangles,
  };
}

function pickAt(candidates: Pickable[], ndcX: number, ndcY: number): PickHit[] {
  return pick(orthoCamera(), ndcX, ndcY, candidates, []);
}

describe("Pickable.triangles (§71 “geometry”, A-11)", () => {
  it("keeps a box hit on the triangle and drops one off it — both modes", () => {
    for (const mode of [null, "geometry"] as const) {
      const candidate = box(mode, lowerLeftTriangle());
      // Lower-left half: on the triangle.
      expect(pickAt([candidate], -0.06, -0.06)).toHaveLength(1);
      // Upper-right half: inside the box, outside the shape — the exact case
      // the bounds tier gets wrong and this tier exists to fix.
      expect(pickAt([candidate], 0.06, 0.06)).toHaveLength(0);
    }
  });

  it("tests an indexed quad through its indices — both triangles hit", () => {
    const candidate = box("geometry", indexedQuad());
    expect(pickAt([candidate], -0.06, -0.06)).toHaveLength(1);
    expect(pickAt([candidate], 0.06, 0.06)).toHaveLength(1);
    expect(pickAt([candidate], 0.3, 0.3)).toHaveLength(0); // outside the box
  });

  it("refines the hit to the triangle's own distance and point", () => {
    // Box z-extent [-0.5, 0.5] around the node at z = −2: the ray (origin on
    // the near plane at z = −1, direction −Z) enters the box at z = −1.5,
    // t = 0.5 — but the triangle lives at z = −2, t = 1. The reported hit
    // must be the surface, not the box entry.
    const candidate = box("geometry", lowerLeftTriangle());
    candidate.boundsMin.set(-0.5, -0.5, -0.5);
    candidate.boundsMax.set(0.5, 0.5, 0.5);
    const hits = pickAt([candidate], -0.06, -0.06);
    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBe(1);
    expect(hits[0].point.z).toBe(-2);

    // And the box entry is what the bounds tier still reports.
    const bounds = box(null);
    bounds.boundsMin.set(-0.5, -0.5, -0.5);
    bounds.boundsMax.set(0.5, 0.5, 0.5);
    expect(pickAt([bounds], -0.06, -0.06)[0].distance).toBe(0.5);
  });

  it("reports the nearest of several triangles, whatever their order", () => {
    // Two full-box triangles pairs at local z = −0.25 (far, t = 1.25) listed
    // *before* z = +0.25 (near, t = 0.75): the smaller t must win anyway.
    // prettier-ignore
    const positions = new Float32Array([
      -0.5, -0.5, -0.25,   0.5, -0.5, -0.25,   -0.5, 0.5, -0.25,
      -0.5, -0.5,  0.25,   0.5, -0.5,  0.25,   -0.5, 0.5,  0.25,
    ]);
    const candidate = box("geometry", { positions });
    candidate.boundsMin.set(-0.5, -0.5, -0.5);
    candidate.boundsMax.set(0.5, 0.5, 0.5);
    const hits = pickAt([candidate], -0.06, -0.06);
    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBe(0.75);
  });

  it("hits from either side — winding does not matter (§71 states no rule)", () => {
    const flipped = lowerLeftTriangle();
    // Reverse the winding by swapping two vertices in place.
    const p = flipped.positions;
    // prettier-ignore
    const swap = [p[0], p[1], p[2]];
    p[0] = p[3];
    p[1] = p[4];
    p[2] = p[5];
    p[3] = swap[0];
    p[4] = swap[1];
    p[5] = swap[2];
    expect(pickAt([box("geometry", flipped)], -0.06, -0.06)).toHaveLength(1);
  });

  it("misses a triangle behind the ray origin and one edge-on to the ray", () => {
    // Behind: the triangle sits at world z = −0.5, behind the near plane at
    // z = −1 — its t is negative. The box still spans the origin, so only the
    // triangle test can reject it.
    const behind = box("geometry", {
      // prettier-ignore
      positions: new Float32Array([
        -0.5, -0.5, 1.5,   0.5, -0.5, 1.5,   -0.5, 0.5, 1.5,
      ]),
    });
    behind.boundsMax.set(0.5, 0.5, 1.5);
    expect(pickAt([behind], -0.06, -0.06)).toHaveLength(0);

    // Edge-on: a triangle in the y–z plane is parallel to the −Z ray
    // (det === 0) and is skipped rather than divided by zero.
    const edgeOn = box("geometry", {
      // prettier-ignore
      positions: new Float32Array([
        0, -0.5, -0.5,   0, 0.5, -0.5,   0, 0, 0.5,
      ]),
    });
    edgeOn.boundsMin.set(0, -0.5, -0.5);
    edgeOn.boundsMax.set(0, 0.5, 0.5);
    expect(pickAt([edgeOn], 0, 0)).toHaveLength(0);
  });

  it("fails toward a miss on NaN data rather than crashing", () => {
    const poisoned = box("geometry", {
      // prettier-ignore
      positions: new Float32Array([
        NaN, -0.5, 0,   0.5, -0.5, 0,   -0.5, 0.5, 0,
      ]),
    });
    expect(pickAt([poisoned], -0.06, -0.06)).toHaveLength(0);
  });

  it("keeps world distance exact under a scaled node", () => {
    // Double the node's scale: the same local triangle covers NDC
    // [-0.5, 0.5]², and the distance stays a world measurement — the
    // unnormalized-local-direction property the box test documents, inherited.
    const candidate = box("geometry", lowerLeftTriangle());
    candidate.node.transform.scale.set(2, 2, 2);
    const hits = pickAt([candidate], -0.15, -0.15);
    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBe(1);
  });

  it("is deterministic (§33): identical constructions, identical bits", () => {
    const run = (): number[] => {
      const hits = pickAt(
        [box("geometry", indexedQuad()), box(null, lowerLeftTriangle())],
        -0.061,
        -0.059,
      );
      return hits.map((hit) => hit.distance);
    };
    const first = run();
    const second = run();
    expect(first).toHaveLength(2);
    expect(second.length).toBe(first.length);
    for (let i = 0; i < first.length; i += 1) {
      expect(Object.is(first[i], second[i])).toBe(true);
    }
  });
});

describe("node.hitTestMode dispatch (§71, adopted RFC 0005 Q3)", () => {
  it("null — the default — is the pre-field bounds tier when nothing is attached", () => {
    const plain = box(null);
    const hits = pickAt([plain], 0.06, 0.06);
    expect(hits).toHaveLength(1);
    expect(hits[0].node).toBe(plain.node);
  });

  it('"bounds" forces the box alone — attached triangles and mask are ignored', () => {
    const candidate = box("bounds", lowerLeftTriangle());
    // Fully transparent mask: under null it would drop every hit.
    candidate.alphaMask = { data: new Uint8Array(4), width: 1, height: 1 };
    // Upper-right half: off the triangle, transparent texel — and still hit,
    // because the author forced the cheapest method.
    expect(pickAt([candidate], 0.06, 0.06)).toHaveLength(1);
  });

  it('"geometry" ignores an attached mask — an explicit mode selects one strategy', () => {
    const candidate = box("geometry", indexedQuad());
    candidate.alphaMask = { data: new Uint8Array(4), width: 1, height: 1 };
    expect(pickAt([candidate], 0.06, 0.06)).toHaveLength(1);
  });

  it('"pixel" consults the mask and ignores attached triangles', () => {
    const opaque = new Uint8Array([0, 0, 0, 255]);
    const candidate = box("pixel", lowerLeftTriangle());
    candidate.alphaMask = { data: opaque, width: 1, height: 1 };
    // Off the triangle — but "pixel" never asks the triangles.
    expect(pickAt([candidate], 0.06, 0.06)).toHaveLength(1);
  });

  it("null composes: triangles refine the hit, then the mask filters it", () => {
    // Left column of a 2×1 mask opaque, right transparent; triangles are the
    // full quad. Lower-left: on a triangle, opaque texel — hit. Lower-right:
    // on a triangle, transparent texel — dropped by the mask. Upper-right
    // with only the lower-left triangle: dropped by the triangles first.
    const candidate = box(null, indexedQuad());
    candidate.alphaMask = {
      data: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0]),
      width: 2,
      height: 1,
    };
    expect(pickAt([candidate], -0.06, -0.06)).toHaveLength(1);
    expect(pickAt([candidate], 0.06, -0.06)).toHaveLength(0);

    const half = box(null, lowerLeftTriangle());
    half.alphaMask = {
      data: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
      width: 2,
      height: 1,
    };
    expect(pickAt([half], 0.06, 0.06)).toHaveLength(0);
  });

  it('"gpu" stands aside for the id-buffer tier — never tested, never validated', () => {
    // Would be a plain box hit under every other mode — and carries triangle
    // data so malformed it would refuse (§85) were it ever consulted.
    const candidate = box("gpu", {
      positions: new Float32Array(7),
      indices: new Uint16Array([9]),
    });
    expect(pickAt([candidate], 0, 0)).toHaveLength(0);

    // The tier behind it still answers: another candidate under the same
    // pointer is unaffected.
    const behind = box(null);
    behind.node.transform.position.set(0, 0, -3);
    const hits = pickAt([box("gpu"), behind], 0, 0);
    expect(hits).toHaveLength(1);
    expect(hits[0].node).toBe(behind.node);
  });

  it('refuses "geometry" and "pixel" with no data for them (§85)', () => {
    for (const [mode, field] of [
      ["geometry", "triangles"],
      ["pixel", "alphaMask"],
    ] as const) {
      const failure = (() => {
        try {
          pickAt([box(mode)], 0, 0);
        } catch (error: unknown) {
          return error;
        }
        return undefined;
      })();
      expect(isFourError(failure)).toBe(true);
      expect((failure as { code: string }).code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect((failure as Error).message).toContain(field);
    }
  });

  it("never refuses a data-less explicit mode whose box the ray missed", () => {
    // The refusal lives where the data would be consulted — after the box
    // gate — so picking elsewhere does not throw (the alphaMask precedent).
    const offside = box("geometry");
    offside.node.transform.position.set(10, 0, -2);
    expect(pickAt([offside], 0, 0)).toHaveLength(0);
  });
});

describe("PickableTriangles validation (§85)", () => {
  function expectRefusal(triangles: PickableTriangles, pattern: RegExp): void {
    const candidate = box("geometry", triangles);
    expect(() => pickAt([candidate], 0, 0)).toThrowError(pattern);
  }

  it("refuses lengths that are not whole triangles", () => {
    // positions not divisible into vertices…
    expectRefusal({ positions: new Float32Array(7) }, /whole triangles/);
    // …a non-indexed vertex count not divisible into triangles…
    expectRefusal({ positions: new Float32Array(12) }, /whole triangles/);
    // …and an index count not divisible into triangles.
    expectRefusal(
      {
        positions: new Float32Array(9),
        indices: new Uint16Array([0, 1, 2, 0]),
      },
      /whole triangles/,
    );
  });

  it("refuses an index outside positions — §85's invalid geometry indices", () => {
    const failure = (() => {
      try {
        pickAt(
          [
            box("geometry", {
              positions: new Float32Array(9),
              indices: new Uint16Array([0, 1, 3]),
            }),
          ],
          0,
          0,
        );
      } catch (error: unknown) {
        return error;
      }
      return undefined;
    })();
    expect(isFourError(failure)).toBe(true);
    expect((failure as Error).message).toContain("index");
  });

  it("validates once per record — the documented in-place-edit caveat", () => {
    const triangles = indexedQuad();
    const candidate = box("geometry", triangles);
    expect(pickAt([candidate], -0.06, -0.06)).toHaveLength(1);

    // Break an index in place: the cached record is not re-scanned, and the
    // dangling read degenerates to NaN arithmetic — a miss, not a crash.
    triangles.indices?.set([999], 0);
    expect(() => pickAt([candidate], -0.2, -0.2)).not.toThrow();

    // A fresh record with the same broken bytes has no cache entry and is
    // refused up front.
    expectRefusal(
      {
        positions: new Float32Array(12),
        indices: new Uint16Array([999, 1, 2, 2, 1, 3]),
      },
      /index/,
    );
  });

  it("an empty record is legal and simply never hits — the empty-geometry convention", () => {
    const candidate = box("geometry", { positions: new Float32Array(0) });
    expect(pickAt([candidate], 0, 0)).toHaveLength(0);
  });

  it("never consults — and never validates — triangles whose box the ray missed", () => {
    const offside = box("geometry", { positions: new Float32Array(7) });
    offside.node.transform.position.set(10, 0, -2);
    expect(pickAt([offside], 0, 0)).toHaveLength(0);
  });
});
