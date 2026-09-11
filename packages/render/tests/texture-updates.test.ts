import { describe, expect, it } from "vitest";
import { Rectangle2 } from "@fourjs/math";
import { Texture } from "../src/texture.js";
import { CanvasTexture } from "../src/raster.js";

const rect = (x = 0, y = 0, w = 1, h = 1) => new Rectangle2(x, y, w, h);
describe("versioned texture regions", () => {
  it("unions updates for independent readers without exposing retained rectangles", () => {
    const t = new Texture({ width: 8, height: 8 });
    const region = rect(1, 2, 2, 3);
    t.markDirty(region);
    region.x = 6;
    t.markDirty(rect(4, 1, 2, 2));
    expect(t.getDirtyRegion(0)).toEqual(rect(1, 1, 5, 4));
    expect(t.getDirtyRegion(1)).toEqual(rect(4, 1, 2, 2));
    t.getDirtyRegion(0)!.width = 100;
    expect(t.getDirtyRegion(0)).toEqual(rect(1, 1, 5, 4));
    t.markDirty();
    expect(t.getDirtyRegion(0)).toBeNull();
    t.markDirty(rect());
    expect(t.getDirtyRegion(3)).toEqual(rect());
    t.dispose();
    expect(t.getDirtyRegion(4)).toBeNull();
  });
  it("uses full uploads for stale versions and rejects invalid regions atomically", () => {
    const t = new Texture({ width: 2, height: 2 });
    expect(t.getDirtyRegion(0)).toBeNull();
    for (const r of [
      rect(-1),
      rect(0, -1),
      rect(0, 0, 0),
      rect(0, 0, 1, 0),
      rect(2),
      rect(0, 2),
      rect(0.1),
      rect(0, 0, Infinity),
    ])
      expect(() => t.markDirty(r)).toThrow(RangeError);
    expect(t.version).toBe(0);
    for (let i = 0; i < 35; i++) t.markDirty(rect());
    for (const version of [-1, 0, 35, 36, NaN])
      expect(t.getDirtyRegion(version)).toBeNull();
    expect(t.getDirtyRegion(3)).toEqual(rect());
    t.source = { width: 3, height: 3 };
    expect(t.getDirtyRegion(35)).toBeNull();
    t.dispose();
  });
  it("tracks canvas invalidations in bottom-left coordinates and sampler memory", () => {
    const t = new CanvasTexture(
      {
        width: 4,
        height: 4,
        origin: "top-left",
        readPixels(out) {
          for (let i = 0; i < out.length; i++) out[i] = i;
        },
      },
      { mipmaps: true, filter: "nearest", wrap: "repeat", anisotropy: 4 },
    );
    expect(t.byteLength).toBe(84);
    expect(t.minFilter).toBe("nearest-mipmap-nearest");
    expect(t.wrap).toBe("repeat");
    expect(t.anisotropy).toBe(4);
    t.invalidate(rect());
    t.update();
    expect(t.getDirtyRegion(0)).toBeNull();
    t.invalidate(rect(1, 1));
    t.invalidate(rect(2, 2));
    t.update();
    expect(t.getDirtyRegion(1)).toEqual(rect(1, 1, 2, 2));
    expect(t.data![0]).toBe(48);
    t.invalidate();
    t.update();
    expect(t.getDirtyRegion(2)).toBeNull();
    t.dispose();
    expect(t.byteLength).toBe(0);
  });
  it("validates and resolves canvas sampler defaults", () => {
    const source = { width: 1, height: 1, readPixels() {} };
    expect(
      () => new CanvasTexture(source, { minFilter: "linear-mipmap-linear" }),
    ).toThrow();
    for (const options of [
      {},
      { mipmaps: true },
      { mipmaps: true, minFilter: "nearest" as const },
    ]) {
      const t = new CanvasTexture(source, options);
      expect(t.filter).toBe("linear");
      expect(t.wrap).toBe("clamp-to-edge");
      expect(t.anisotropy).toBe(1);
      expect(t.minFilter).toBe(
        options.minFilter ??
          (options.mipmaps ? "linear-mipmap-linear" : "linear"),
      );
      t.dispose();
    }
  });
});
