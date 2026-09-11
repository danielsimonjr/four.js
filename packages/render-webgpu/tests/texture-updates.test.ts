import { describe, expect, it } from "vitest";
import { Texture } from "@fourjs/render";
import { Rectangle2 } from "@fourjs/math";
import { WgpuTextureCache } from "../src/wgpu-texture.js";
import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";

describe("regional WebGPU upload", () => {
  it("retains bindings, writes the dirty origin/stride, and regenerates mips", () => {
    const gpu = createRecordingGpu(),
      cache = new WgpuTextureCache(gpu.device!);
    const t = new Texture({
      width: 4,
      height: 4,
      data: new Uint8Array(64),
      mipmaps: true,
      colorSpace: "srgb",
    });
    const first = cache.acquire(t)!;
    const bytes = cache.byteLength;
    t.markDirty(new Rectangle2(1, 2, 2, 1));
    const second = cache.acquire(t)!;
    expect(second.texture).toBe(first.texture);
    expect(second.bindGroup).toBe(first.bindGroup);
    expect(cache.byteLength).toBe(bytes);
    const call = gpu.callsOf("queue.writeTexture").at(-1)!;
    expect(call.args[0]).toMatchObject({ origin: [1, 2, 0] });
    expect(call.args[2]).toEqual({
      offset: 36,
      bytesPerRow: 16,
      rowsPerImage: 4,
    });
    expect(call.args[3]).toEqual([2, 1]);
    expect(gpu.countOf("queue.submit")).toBe(2);
    t.dispose();
    expect(cache.acquire(t)).toBeNull();
    expect(cache.byteLength).toBe(0);
    cache.dispose();
  });
  it("handles linear mips, mip-free updates, metadata edits, and full invalidation", () => {
    const gpu = createRecordingGpu(),
      cache = new WgpuTextureCache(gpu.device!);
    const source = {
      width: 2,
      height: 2,
      data: new Uint8Array(16),
      mipmaps: true,
    };
    const t = new Texture(source);
    let old = cache.acquire(t)!;
    t.markDirty(new Rectangle2(0, 0, 1, 1));
    expect(cache.acquire(t)!.texture).toBe(old.texture);
    source.mipmaps = false;
    t.markDirty(new Rectangle2(0, 0, 1, 1));
    expect(cache.acquire(t)!.texture).not.toBe(old.texture);
    old = cache.acquire(t)!;
    t.markDirty(new Rectangle2(0, 0, 1, 1));
    expect(cache.acquire(t)!.texture).toBe(old.texture);
    t.markDirty();
    expect(cache.acquire(t)!.texture).not.toBe(old.texture);
    t.dispose();
    cache.dispose();
  });
});
