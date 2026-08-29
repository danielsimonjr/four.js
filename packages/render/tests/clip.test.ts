/**
 * §67's bit-plane allocator (R-23, 2026-08-28) — the unit half.
 *
 * What a clip *means* — inheritance, nesting, mask emission — is a property of
 * the render-list walk and is tested in `clip-render-list.test.ts`; this file
 * pins the allocator's own contract: which stencil records a plane hands out,
 * that assignment is by call order and resets per build (§33), and that the
 * ninth clip is refused with §67's required diagnostic, once, failing toward
 * drawing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ClipPlaneAllocator, MAX_CLIP_PLANES } from "../src/clip.js";

function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ClipPlaneAllocator — plane assignment", () => {
  it("spends one bit plane per clip, in call order", () => {
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    const first = allocator.allocate(0, "node-1");
    const second = allocator.allocate(0, "node-2");
    const third = allocator.allocate(0, "node-3");
    expect(first?.bits).toBe(0b001);
    expect(second?.bits).toBe(0b010);
    expect(third?.bits).toBe(0b100);
    expect(allocator.used).toBe(3);
  });

  it("accumulates inherited bits into the subtree's test, not the mask's write", () => {
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    const outer = allocator.allocate(0, "node-1");
    expect(outer).not.toBeNull();
    const inner = allocator.allocate(outer?.bits ?? 0, "node-2");
    // The inner subtree must pass *both* tests — the intersection.
    expect(inner?.bits).toBe(0b11);
    expect(inner?.test.stencil.ref).toBe(0b11);
    expect(inner?.test.stencil.readMask).toBe(0b11);
    // The inner mask writes only its own plane; the outer bit is not its to
    // touch, or an inner mask would widen the outer clip wherever it drew.
    expect(inner?.write.stencil.ref).toBe(0b10);
    expect(inner?.write.stencil.writeMask).toBe(0b10);
  });

  it("hands out the mask-write record §67 composes: always/replace on one plane", () => {
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    const scope = allocator.allocate(0, "node-1");
    expect(scope?.write.maskPass).toBe(true);
    expect(scope?.write.stencil).toEqual({
      func: "always",
      ref: 0b1,
      readMask: 0xff,
      writeMask: 0b1,
      failOp: "keep",
      depthFailOp: "keep",
      passOp: "replace",
    });
  });

  it("hands out the read-only test record: equal over the accumulated bits", () => {
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    const scope = allocator.allocate(0, "node-1");
    expect(scope?.test.maskPass).toBe(false);
    expect(scope?.test.stencil).toEqual({
      func: "equal",
      ref: 0b1,
      readMask: 0b1,
      writeMask: 0,
      failOp: "keep",
      depthFailOp: "keep",
      passOp: "keep",
    });
  });

  it("pools each plane's records: the same objects come back after begin()", () => {
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    const first = allocator.allocate(0, "node-1");
    allocator.begin();
    const again = allocator.allocate(0, "node-1");
    // Identity, not equality — the pooled record is what lets every item under
    // one clip share one reference and the batcher compare with `!==`.
    expect(again?.test).toBe(first?.test);
    expect(again?.write).toBe(first?.write);
  });

  it("resets assignment on begin(), so planes are a function of the build (§33)", () => {
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    allocator.allocate(0, "node-1");
    allocator.allocate(0, "node-2");
    allocator.begin();
    const scope = allocator.allocate(0, "node-3");
    // The first clip of the *next* build gets plane 0 again, whatever the last
    // build used — not a monotonic counter over the allocator's lifetime.
    expect(scope?.bits).toBe(0b1);
    expect(allocator.used).toBe(1);
  });
});

describe("ClipPlaneAllocator — §67's exhaustion diagnostic", () => {
  it("refuses the ninth clip of a build and returns null", () => {
    const warn = silenceWarnings();
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    for (let index = 0; index < MAX_CLIP_PLANES; index += 1) {
      expect(allocator.allocate(0, `node-${String(index)}`)).not.toBeNull();
    }
    expect(allocator.allocate(0, "node-9")).toBeNull();
    expect(allocator.allocate(0, "node-10")).toBeNull();
    expect(allocator.used).toBe(MAX_CLIP_PLANES);
    expect(allocator.refused).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("names the first refused clip and the defined failure direction", () => {
    const warn = silenceWarnings();
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    for (let index = 0; index < MAX_CLIP_PLANES; index += 1) {
      allocator.allocate(0, `node-${String(index)}`);
    }
    allocator.allocate(0, "node-offender");
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("§67");
    expect(message).toContain("node-offender");
    // The defined behaviour §67 requires: the subtree spills rather than
    // vanishing, and the message says so — it is the author's only clue.
    expect(message).toContain("spill");
  });

  it("warns once per allocator, not once per exhausted build", () => {
    const warn = silenceWarnings();
    const allocator = new ClipPlaneAllocator();
    for (let build = 0; build < 3; build += 1) {
      allocator.begin();
      for (let index = 0; index <= MAX_CLIP_PLANES; index += 1) {
        allocator.allocate(0, `node-${String(index)}`);
      }
    }
    // An over-budget scene is over budget on every frame; a warning repeated
    // at the frame rate hides its own first line.
    expect(warn).toHaveBeenCalledTimes(1);
    // The refused *count* is still per build — it is §84-shaped state, not a
    // diagnostic.
    expect(allocator.refused).toBe(1);
  });

  it("warns again from a fresh allocator — the flag is per list, not global", () => {
    const warn = silenceWarnings();
    for (let run = 0; run < 2; run += 1) {
      const allocator = new ClipPlaneAllocator();
      allocator.begin();
      for (let index = 0; index <= MAX_CLIP_PLANES; index += 1) {
        allocator.allocate(0, `node-${String(index)}`);
      }
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("counts zero refusals for a build that fits", () => {
    const allocator = new ClipPlaneAllocator();
    allocator.begin();
    allocator.allocate(0, "node-1");
    expect(allocator.refused).toBe(0);
  });
});

describe("MAX_CLIP_PLANES", () => {
  it("is 8, because every WebGL 2 stencil format is 8 bits deep (R-7)", () => {
    expect(MAX_CLIP_PLANES).toBe(8);
  });
});
