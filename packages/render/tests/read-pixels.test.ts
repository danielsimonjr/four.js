/**
 * §61's `readPixels` seam, backend-independent half (`read-pixels.ts`,
 * 2026-08-29): the duck-typed capability guard and the shared §85 region
 * check every backend refuses malformed regions through. The backends' own
 * suites (`wgpu-readback*.test.ts`, `webgl-renderer.test.ts`) own the bytes.
 */

import { Rectangle2 } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  NullRenderer,
  supportsReadPixels,
  validateReadbackRegion,
  type PixelReader,
  type RenderTarget,
} from "../src/index.js";

describe("supportsReadPixels", () => {
  it("narrows a renderer that declares the member and refuses one that does not", () => {
    // The null tier has no pixels at all, and says so by omission — the
    // optional-member stance the interface documents.
    expect(supportsReadPixels(new NullRenderer())).toBe(false);

    const reader: PixelReader = {
      readPixels: (target: RenderTarget, region?: Rectangle2) => {
        void target;
        void region;
        return Promise.resolve(new ArrayBuffer(0));
      },
    };
    expect(supportsReadPixels(reader)).toBe(true);
    // A readPixels that is not callable is not the capability.
    expect(supportsReadPixels({ readPixels: 42 })).toBe(false);
  });
});

describe("validateReadbackRegion (§85)", () => {
  it("accepts the whole target and any interior texel rectangle", () => {
    expect(() =>
      validateReadbackRegion(new Rectangle2(0, 0, 8, 4), 8, 4),
    ).not.toThrow();
    expect(() =>
      validateReadbackRegion(new Rectangle2(3, 1, 2, 3), 8, 4),
    ).not.toThrow();
    // One-texel read at the far corner: x + width == width is inside.
    expect(() =>
      validateReadbackRegion(new Rectangle2(7, 3, 1, 1), 8, 4),
    ).not.toThrow();
  });

  it("refuses fractional components, naming the component (§85)", () => {
    expect(() =>
      validateReadbackRegion(new Rectangle2(0.5, 0, 1, 1), 8, 4),
    ).toThrow(/region x must be an integer/);
    expect(() =>
      validateReadbackRegion(new Rectangle2(0, 1.5, 1, 1), 8, 4),
    ).toThrow(/region y must be an integer/);
    expect(() =>
      validateReadbackRegion(new Rectangle2(0, 0, 1.5, 1), 8, 4),
    ).toThrow(/region width must be an integer/);
    expect(() =>
      validateReadbackRegion(new Rectangle2(0, 0, 1, 1.5), 8, 4),
    ).toThrow(/region height must be an integer/);
  });

  it("refuses an empty region", () => {
    expect(() =>
      validateReadbackRegion(new Rectangle2(0, 0, 0, 4), 8, 4),
    ).toThrow(/non-empty/);
    expect(() =>
      validateReadbackRegion(new Rectangle2(0, 0, 8, 0), 8, 4),
    ).toThrow(/non-empty/);
  });

  it("refuses a region that hangs off any edge of the target", () => {
    expect(() =>
      validateReadbackRegion(new Rectangle2(-1, 0, 2, 2), 8, 4),
    ).toThrow(/does not lie inside the 8 × 4 target/);
    expect(() =>
      validateReadbackRegion(new Rectangle2(0, -1, 2, 2), 8, 4),
    ).toThrow(/does not lie inside/);
    expect(() =>
      validateReadbackRegion(new Rectangle2(7, 0, 2, 1), 8, 4),
    ).toThrow(/does not lie inside/);
    expect(() =>
      validateReadbackRegion(new Rectangle2(0, 3, 1, 2), 8, 4),
    ).toThrow(/does not lie inside/);
  });
});
