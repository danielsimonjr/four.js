import { describe, expect, it, vi } from "vitest";
import { Texture } from "@fourjs/render";
import { Rectangle2 } from "@fourjs/math";
import type { WebglContext } from "../src/gl-program.js";
import { TextureCache } from "../src/gl-texture.js";
import { createRecordingGl } from "../../../tests/integration/helpers/recording-gl.js";

describe("regional GL texture upload", () => {
  it("updates the existing allocation with packed rows and refreshes its mip chain", () => {
    const { gl } = createRecordingGl();
    const subImage = vi.fn<NonNullable<WebglContext["texSubImage2D"]>>(),
      mipmap = vi.fn();
    gl.texSubImage2D = subImage;
    gl.generateMipmap = mipmap;
    const cache = new TextureCache(gl),
      data = Uint8Array.from({ length: 64 }, (_, i) => i);
    const t = new Texture({ width: 4, height: 4, data, mipmaps: true });
    const first = cache.acquire(t)!;
    t.markDirty(new Rectangle2(1, 1, 2, 2));
    const second = cache.acquire(t)!;
    expect(second.texture).toBe(first.texture);
    expect(second.version).toBe(1);
    expect(subImage.mock.calls[0].slice(2, 6)).toEqual([1, 1, 2, 2]);
    expect(Array.from(subImage.mock.calls[0][8] as Uint8Array)).toEqual([
      ...data.slice(20, 28),
      ...data.slice(36, 44),
    ]);
    expect(mipmap).toHaveBeenCalledTimes(2);
    t.source = { width: 4, height: 4, data };
    expect(cache.acquire(t)!.texture).not.toBe(first.texture);
    t.dispose();
    expect(cache.acquire(t)).toBeNull();
    cache.dispose();
    expect(cache.acquire(t)).toBeNull();
  });
  it("falls back for missing subimage support, full updates, and changed sampler state", () => {
    const { gl } = createRecordingGl();
    const cache = new TextureCache(gl);
    const source = {
      width: 2,
      height: 2,
      data: new Uint8Array(16),
      filter: "linear" as "nearest" | "linear",
    };
    const t = new Texture(source);
    let old = cache.acquire(t)!;
    t.markDirty(new Rectangle2(0, 0, 1, 1));
    expect(cache.acquire(t)!.texture).not.toBe(old.texture);
    const subImage = vi.fn();
    gl.texSubImage2D = subImage;
    old = cache.acquire(t)!;
    source.filter = "nearest";
    t.markDirty(new Rectangle2(0, 0, 1, 1));
    expect(cache.acquire(t)!.texture).not.toBe(old.texture);
    t.markDirty(new Rectangle2(0, 0, 1, 1));
    old = cache.acquire(t)!;
    expect(subImage).toHaveBeenCalledOnce();
    t.markDirty();
    expect(cache.acquire(t)!.texture).not.toBe(old.texture);
    cache.dispose();
    t.dispose();
  });
});
