/**
 * WP-R1.7's stencil units, tested directly: the per-frame stencil question,
 * the record resolution, the pass-command mirror, and the clear state — the
 * `wgpu-stencil.ts` halves a failure should localise to. The renderer-level
 * behaviour — format selection, per-view clears, the material-stencil tier
 * reaching hardware on clipless frames — lives in `webgpu-renderer.test.ts`.
 */

import type { RenderItem } from "@four/render";
import { describe, expect, it } from "vitest";

import {
  CLEAR_STENCIL,
  STENCIL_ALL_BITS,
  applyStencilReference,
  frameWantsStencil,
  stencilDescriptor,
} from "../src/index.js";

/** A minimal structural item — only what `frameWantsStencil` reads. */
function item(
  kind: string,
  material: object = {},
  clip: object | null = null,
): RenderItem {
  return { kind, material, clip } as unknown as RenderItem;
}

describe("frameWantsStencil", () => {
  it("answers false for an empty frame", () => {
    expect(frameWantsStencil([])).toBe(false);
  });

  it("answers true from the first item alone when the frame clips", () => {
    // R-23's sort key: mask draws carry the comparators' first key, so a
    // clipping frame's answer is one property read — the scan never runs.
    const mask = item("unlit", {}, { maskPass: true, stencil: { ref: 1 } });
    expect(frameWantsStencil([mask, item("unlit")])).toBe(true);
  });

  it("finds a §57 material stencil on any drawable kind", () => {
    for (const kind of ["unlit", "sprite", "lit", "standard"]) {
      expect(
        frameWantsStencil([
          item("unlit"),
          item(kind, { stencil: { func: "equal" } }),
        ]),
      ).toBe(true);
    }
  });

  it("ignores stencils on kinds the scan has no material to read", () => {
    // A skipped draw (skinned, node) must not re-key every pipeline of a
    // frame it contributes nothing to — and a particle item, drawn since
    // WP-R1.8, carries no material at all (`material?: undefined`), so a
    // structural double smuggling one in must still not re-key the frame:
    // its only stencil is §67's clip record, which clause 1 answers.
    expect(
      frameWantsStencil([
        item("particles", { stencil: { func: "never" } }),
        item("skinned-lit", { stencil: {} }),
        item("node", { stencil: {} }),
      ]),
    ).toBe(false);
  });

  it("answers false for a frame with no clip and no stencil material", () => {
    expect(
      frameWantsStencil([item("unlit"), item("sprite"), item("lit")]),
    ).toBe(false);
  });
});

describe("stencilDescriptor", () => {
  it("fills §57's documented defaults into a partial record", () => {
    expect(stencilDescriptor({})).toEqual({
      func: "always",
      readMask: STENCIL_ALL_BITS,
      writeMask: STENCIL_ALL_BITS,
      failOp: "keep",
      depthFailOp: "keep",
      passOp: "keep",
    });
  });

  it("passes a full record through unchanged, ref excluded", () => {
    // `ref` is a pass command, not pipeline identity — the descriptor form
    // deliberately has no slot for it.
    const resolved = stencilDescriptor({
      func: "equal",
      ref: 5,
      readMask: 3,
      writeMask: 0,
      failOp: "zero",
      depthFailOp: "invert",
      passOp: "replace",
    });
    expect(resolved).toEqual({
      func: "equal",
      readMask: 3,
      writeMask: 0,
      failOp: "zero",
      depthFailOp: "invert",
      passOp: "replace",
    });
    expect("ref" in resolved).toBe(false);
  });
});

describe("applyStencilReference", () => {
  it("issues the pass command only on change, defaulting a missing ref to 0", () => {
    const calls: number[] = [];
    const pass = {
      setStencilReference: (reference: number): void => {
        calls.push(reference);
      },
    };
    let current = 0;
    current = applyStencilReference(
      pass as Parameters<typeof applyStencilReference>[0],
      current,
      undefined,
    );
    expect(current).toBe(0);
    current = applyStencilReference(
      pass as Parameters<typeof applyStencilReference>[0],
      current,
      4,
    );
    expect(current).toBe(4);
    current = applyStencilReference(
      pass as Parameters<typeof applyStencilReference>[0],
      current,
      4,
    );
    // One call for three applications: initial 0 matches the pass default,
    // and a repeated value is mirrored away.
    expect(calls).toEqual([4]);
  });
});

describe("CLEAR_STENCIL", () => {
  it("zeroes every plane under an always-pass test", () => {
    // The §61 clear triangle's stencil half: both comparisons ignore the
    // reference, and the pass op stores zero into all eight planes.
    expect(CLEAR_STENCIL).toEqual({
      func: "always",
      readMask: STENCIL_ALL_BITS,
      writeMask: STENCIL_ALL_BITS,
      failOp: "keep",
      depthFailOp: "keep",
      passOp: "zero",
    });
    expect(Object.isFrozen(CLEAR_STENCIL)).toBe(true);
  });
});
