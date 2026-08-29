/**
 * §71's `"pixel"` strategy for CPU-resident texels (RFC 0005 alternative D,
 * adopted): the `Pickable.alphaMask` refinement of the bounds tier, and the
 * render-free `PickProvider` seam.
 */

import { isFourError } from "@four/core";
import { Vector3 } from "@four/math";
import { Group, OrthographicCamera } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  pick,
  type PickHit,
  type PickProvider,
  type Pickable,
  type PickableAlphaMask,
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
 * A flat unit quad in front of the camera (z = −2 — the ortho near plane is
 * at z = −1, and a box behind it is deliberately never hit): local
 * `[-0.5, 0.5]²`, zero thickness, spanning NDC `[-0.25, 0.25]²`.
 */
function quad(mask?: PickableAlphaMask): Pickable {
  const node = new Group();
  node.transform.position.set(0, 0, -2);
  return {
    node,
    boundsMin: new Vector3(-0.5, -0.5, 0),
    boundsMax: new Vector3(0.5, 0.5, 0),
    alphaMask: mask,
  };
}

/**
 * A 2×2 RGBA8 mask whose bottom-left and top-right texels are opaque and the
 * other two fully transparent — a checkerboard the box test alone cannot see.
 * Row 0 is the quad's bottom edge (`texImage2D`'s orientation).
 */
function checkerboardMask(): PickableAlphaMask {
  const data = new Uint8Array(2 * 2 * 4);
  // (0, 0) bottom-left: opaque.
  data[3] = 255;
  // (1, 0) bottom-right: transparent (alpha 0).
  // (0, 1) top-left: transparent.
  // (1, 1) top-right: opaque.
  data[(1 * 2 + 1) * 4 + 3] = 255;
  return { data, width: 2, height: 2 };
}

function pickAt(candidates: Pickable[], ndcX: number, ndcY: number): PickHit[] {
  return pick(orthoCamera(), ndcX, ndcY, candidates, []);
}

describe("Pickable.alphaMask (§71 “pixel”, RFC 0005 D)", () => {
  it("keeps a hit on a present texel and drops one on a transparent texel", () => {
    const candidate = quad(checkerboardMask());
    // The quad spans NDC [-0.25, 0.25]²; sample inside each quadrant.
    expect(pickAt([candidate], -0.06, -0.06)).toHaveLength(1);
    expect(pickAt([candidate], 0.06, 0.06)).toHaveLength(1);
    expect(pickAt([candidate], 0.06, -0.06)).toHaveLength(0);
    expect(pickAt([candidate], -0.06, 0.06)).toHaveLength(0);
  });

  it("lets a dropped front candidate reveal what is behind it", () => {
    const front = quad(checkerboardMask());
    const behind = quad();
    behind.node.transform.position.set(0, 0, -3);
    // Top-left is transparent on the front quad: the plain quad behind wins.
    const hits = pickAt([front, behind], -0.06, 0.06);
    expect(hits).toHaveLength(1);
    expect(hits[0].node).toBe(behind.node);
  });

  it("clamps edge samples inside the mask — the +1 edges hit the last texel", () => {
    const candidate = quad(checkerboardMask());
    // Exactly the box's top-right corner: u = v = 1 must sample texel (1, 1),
    // not one past it.
    expect(pickAt([candidate], 0.25, 0.25)).toHaveLength(1);
    // And the bottom-left corner samples (0, 0).
    expect(pickAt([candidate], -0.25, -0.25)).toHaveLength(1);
  });

  it("samples a region — §55's frame — inside a larger atlas", () => {
    // A 4×4 atlas, fully transparent except the 2×2 window at (2, 1), which
    // is opaque only in its right column.
    const data = new Uint8Array(4 * 4 * 4);
    for (const [x, y] of [
      [3, 1],
      [3, 2],
    ]) {
      data[(y * 4 + x) * 4 + 3] = 255;
    }
    const candidate = quad({
      data,
      width: 4,
      height: 4,
      region: { x: 2, y: 1, width: 2, height: 2 },
    });
    // Right half of the quad maps onto the window's opaque column…
    expect(pickAt([candidate], 0.06, 0.06)).toHaveLength(1);
    expect(pickAt([candidate], 0.06, -0.06)).toHaveLength(1);
    // …the left half onto its transparent column.
    expect(pickAt([candidate], -0.06, 0.06)).toHaveLength(0);
  });

  it("honours the threshold — alpha must exceed it, strictly", () => {
    const data = new Uint8Array(1 * 1 * 4);
    data[3] = 128;
    const candidate = quad({ data, width: 1, height: 1, threshold: 0.5 });
    expect(pickAt([candidate], 0, 0)).toHaveLength(1);
    (candidate.alphaMask as { threshold?: number }).threshold = 128 / 255;
    expect(pickAt([candidate], 0, 0)).toHaveLength(0);
  });

  it("treats a zero-extent axis as texel row/column 0 — a flat bar still samples", () => {
    const node = new Group();
    const data = new Uint8Array(2 * 1 * 4);
    data[3] = 255; // texel (0, 0) opaque, (1, 0) transparent
    node.transform.position.set(0, 0, -2);
    const bar: Pickable = {
      node,
      // Zero Y extent: v reads as 0 on every hit.
      boundsMin: new Vector3(-0.5, 0, 0),
      boundsMax: new Vector3(0.5, 0, 0),
      alphaMask: { data, width: 2, height: 1 },
    };
    expect(pickAt([bar], -0.06, 0)).toHaveLength(1);
    expect(pickAt([bar], 0.06, 0)).toHaveLength(0);

    // And the mirrored case — a zero-X-extent column — reads u as 0.
    const columnNode = new Group();
    columnNode.transform.position.set(0, 0, -2);
    const columnData = new Uint8Array(1 * 2 * 4);
    columnData[3] = 255; // texel (0, 0) opaque, (0, 1) transparent
    const column: Pickable = {
      node: columnNode,
      boundsMin: new Vector3(0, -0.5, 0),
      boundsMax: new Vector3(0, 0.5, 0),
      alphaMask: { data: columnData, width: 1, height: 2 },
    };
    expect(pickAt([column], 0, -0.06)).toHaveLength(1);
    expect(pickAt([column], 0, 0.06)).toHaveLength(0);
  });

  it("refuses a malformed mask and an out-of-bounds region (§85)", () => {
    const short = quad({ data: new Uint8Array(3), width: 1, height: 1 });
    const shortFailure = (() => {
      try {
        pickAt([short], 0, 0);
      } catch (error: unknown) {
        return error;
      }
      return undefined;
    })();
    expect(isFourError(shortFailure)).toBe(true);
    expect((shortFailure as { code: string }).code).toBe(
      "INVALID_APPLICATION_STATE",
    );

    const badRegion = quad({
      data: new Uint8Array(2 * 2 * 4),
      width: 2,
      height: 2,
      region: { x: 1, y: 0, width: 2, height: 1 },
    });
    expect(() => pickAt([badRegion], 0, 0)).toThrowError(/region/);
  });

  it("never consults — and never validates — a mask whose box the ray missed", () => {
    // The malformed mask sits entirely off to the side; picking elsewhere
    // must not touch it (the validation runs only where the mask is read).
    const offside = quad({ data: new Uint8Array(0), width: 8, height: 8 });
    offside.node.transform.position.set(10, 0, 0);
    expect(pickAt([offside], 0, 0)).toHaveLength(0);
  });

  it("changes nothing for candidates without a mask — the bounds tier as it was", () => {
    const plain = quad();
    const hits = pickAt([plain], 0.06, 0.06);
    expect(hits).toHaveLength(1);
    expect(hits[0].node).toBe(plain.node);
  });
});

describe("PickProvider (RFC 0005 §2)", () => {
  it("is satisfiable with a Map and no GPU — the structural seam's point", async () => {
    const answers = new Map<string, string>([["0.5,0.5", "node-42"]]);
    const provider: PickProvider = {
      pick: (ndcX, ndcY) =>
        Promise.resolve(answers.get(`${String(ndcX)},${String(ndcY)}`)),
    };
    await expect(provider.pick(0.5, 0.5)).resolves.toBe("node-42");
    await expect(provider.pick(-1, -1)).resolves.toBeUndefined();
  });
});
