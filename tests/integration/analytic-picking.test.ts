/**
 * §71's analytic `"geometry"` tier across the packages that have to agree
 * about it (A-11, adopted RFC 0005 Q3, 2026-08-29): `@four/geometry`
 * tessellates a §50 shape, `@four/render`'s `Shape2D` owns that geometry,
 * `@four/scene` carries `node.hitTestMode`, `@four/input` runs the exact
 * ray/triangle test against the structural `Pickable.triangles`, and `four`'s
 * §79 pair round-trips the mode.
 *
 * The claim that lives only in the composition: **what draws is what picks.**
 * A circle's candidate is built from the very `BufferGeometry` the renderer
 * draws — `shape.geometry.positions`/`.indices`, `computeBounds()` for the
 * broad phase — so the analytic tier rejects the box corner the bounds tier
 * reports, §51's flattening tolerance included, with no shape-specific
 * picking code anywhere.
 */

import { pick, type PickHit, type Pickable } from "@four/input";
import { UnlitMaterial, type Material } from "@four/materials";
import { Circle } from "@four/render";
import { OrthographicCamera, Scene } from "@four/scene";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@four/serialization";
import { registerSceneNodeTypes, resourceCatalog } from "four";
import { describe, expect, it } from "vitest";

const material = new UnlitMaterial();

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
 * A unit circle at z = −2, finely flattened, with its candidate built from
 * its own drawn tessellation — the two lines the `Pickable` docs promise.
 */
function circleCandidate(): { circle: Circle<Material>; pickable: Pickable } {
  const circle = new Circle<Material>({
    radius: 1,
    material,
    tolerance: 0.001,
  });
  circle.hitTestMode = "geometry";
  circle.transform.position.set(0, 0, -2);
  const geometry = circle.geometry;
  const bounds = geometry.computeBounds();
  return {
    circle,
    pickable: {
      node: circle,
      boundsMin: bounds.min,
      boundsMax: bounds.max,
      triangles: { positions: geometry.positions, indices: geometry.indices },
    },
  };
}

function pickAt(candidates: Pickable[], ndcX: number, ndcY: number): PickHit[] {
  return pick(orthoCamera(), ndcX, ndcY, candidates, []);
}

describe("§71 analytic picking over a §50 shape's own tessellation", () => {
  it("hits the disc and rejects the box corner the bounds tier reports", () => {
    const { pickable } = circleCandidate();

    // Centre of the disc: both tiers agree, and the refined distance is the
    // circle's plane (z = −2, one unit past the near plane at z = −1).
    const centre = pickAt([pickable], 0, 0);
    expect(centre).toHaveLength(1);
    expect(centre[0].distance).toBe(1);

    // The corner region: world (0.9, 0.9) is inside the bounding box but
    // 1.27 units from the centre — outside the disc. The analytic tier says
    // no; strip the triangles from the same candidate (the pre-A-11
    // spelling) and the bounds tier says yes. That one pair of answers is
    // the gap A-11 was filed about.
    const withMode = pickAt([pickable], 0.45, 0.45);
    expect(withMode).toHaveLength(0);

    const boundsOnly: Pickable = {
      node: pickable.node,
      boundsMin: pickable.boundsMin,
      boundsMax: pickable.boundsMax,
    };
    boundsOnly.node.hitTestMode = null;
    expect(pickAt([boundsOnly], 0.45, 0.45)).toHaveLength(1);
  });

  it("round-trips the mode through §79 and picks identically after reload", () => {
    const { circle } = circleCandidate();
    const root = new Scene();
    root.add(circle);
    const support = registerSceneNodeTypes({
      materials: resourceCatalog<Material>([["material/flat", material]]),
    });
    const restoredRoot = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(
          serializeScene(root, support.components, support.write),
        ),
      ),
      support.components,
      support.read,
    );
    const restored = restoredRoot.children[0] as Circle<Material>;
    expect(restored).toBeInstanceOf(Circle);
    expect(restored.hitTestMode).toBe("geometry");

    // The restored shape re-tessellates from its restored parameters, and
    // its candidate answers exactly as the original's did.
    const geometry = restored.geometry;
    const bounds = geometry.computeBounds();
    const candidate: Pickable = {
      node: restored,
      boundsMin: bounds.min,
      boundsMax: bounds.max,
      triangles: { positions: geometry.positions, indices: geometry.indices },
    };
    expect(pickAt([candidate], 0, 0)).toHaveLength(1);
    expect(pickAt([candidate], 0.45, 0.45)).toHaveLength(0);
  });

  it("is §33-deterministic: identical constructions answer with identical bits", () => {
    const measure = (): number => {
      const { pickable } = circleCandidate();
      const hits = pickAt([pickable], 0.31, -0.17);
      expect(hits).toHaveLength(1);
      return hits[0].distance;
    };
    expect(Object.is(measure(), measure())).toBe(true);
  });
});
