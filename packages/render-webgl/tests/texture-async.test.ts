import { describe, expect, it, vi } from "vitest";
import { Texture } from "@fourjs/render";
import { TextureCache } from "../src/gl-texture.js";
import { WebglRenderer } from "../src/webgl-renderer.js";
import {
  createRecordingGl,
  RecordingCanvas,
} from "../../../tests/integration/helpers/recording-gl.js";
function setup() {
  const recording = createRecordingGl();
  recording.gl.fenceSync = vi.fn(() => ({}));
  recording.gl.deleteSync = vi.fn();
  recording.gl.clientWaitSync = vi.fn(() => 0x911a);
  return {
    ...recording,
    cache: new TextureCache(recording.gl),
    texture: new Texture({ width: 1, height: 1 }),
  };
}
describe("asynchronous GL texture preparation", () => {
  it("waits nonblocking for the fence and reports pending/resident/stale versions", async () => {
    const { gl, cache, texture } = setup();
    expect(cache.residency(texture)).toBe("absent");
    gl.clientWaitSync = vi
      .fn()
      .mockReturnValueOnce(0x911b)
      .mockReturnValue(0x911c);
    const pending = cache.acquireAsync(texture);
    expect(cache.residency(texture)).toBe("uploading");
    expect(await pending).not.toBeNull();
    expect(cache.residency(texture)).toBe("resident");
    expect(gl.clientWaitSync).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      1,
      0,
    );
    expect(gl.clientWaitSync).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      0,
      0,
    );
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    texture.markDirty();
    expect(cache.residency(texture)).toBe("stale");
    texture.dispose();
    expect(cache.residency(texture)).toBe("absent");
    cache.dispose();
    expect(await cache.acquireAsync(texture)).toBeNull();
  });
  it("refuses missing capabilities, invalid limits, failed allocation and failed fences", async () => {
    const { gl, cache, texture } = setup();
    await expect(cache.acquireAsync(texture, undefined, 0)).rejects.toThrow(
      "maximumPolls",
    );
    gl.fenceSync = undefined;
    await expect(cache.acquireAsync(texture)).rejects.toThrow("sync objects");
    gl.fenceSync = () => null;
    await expect(cache.acquireAsync(texture)).rejects.toThrow("allocate");
    gl.fenceSync = () => ({});
    gl.clientWaitSync = () => 0x911d;
    await expect(cache.acquireAsync(texture)).rejects.toThrow("failed");
    gl.clientWaitSync = () => 0x911b;
    await expect(
      cache.acquireAsync(texture, () => Promise.resolve(), 1),
    ).rejects.toThrow("limit");
    cache.forget();
    gl.createTexture = () => null;
    expect(await cache.acquireAsync(texture)).toBeNull();
    texture.dispose();
    cache.dispose();
  });
  it("cancels on mutation, disposal, and context loss without touching a lost context", async () => {
    for (const action of ["mutation", "texture", "cache", "loss"] as const) {
      const { gl, cache, texture } = setup();
      gl.clientWaitSync = () => 0x911b;
      const value = await cache.acquireAsync(texture, () => {
        if (action === "mutation") texture.markDirty();
        if (action === "texture") texture.dispose();
        if (action === "cache") cache.dispose();
        if (action === "loss") cache.forget();
        return Promise.resolve();
      });
      expect(value).toBeNull();
      expect(gl.deleteSync).toHaveBeenCalledTimes(action === "loss" ? 0 : 1);
      texture.dispose();
      cache.dispose();
    }
  });
  it("keeps residency pending until both concurrent waits settle", async () => {
    const { gl, cache, texture } = setup();
    gl.clientWaitSync = vi
      .fn()
      .mockReturnValueOnce(0x911b)
      .mockReturnValueOnce(0x911b)
      .mockReturnValue(0x911a);
    const releases: (() => void)[] = [],
      poll = () => new Promise<void>((resolve) => releases.push(resolve));
    const a = cache.acquireAsync(texture, poll),
      b = cache.acquireAsync(texture, poll);
    releases[0]();
    await a;
    expect(cache.residency(texture)).toBe("uploading");
    releases[1]();
    await b;
    expect(cache.residency(texture)).toBe("resident");
    texture.dispose();
    cache.dispose();
  });
  it("exposes preparation through the renderer with lifecycle checks", async () => {
    const { gl, texture } = setup();
    const canvas = new RecordingCanvas(gl);
    const renderer = new WebglRenderer();
    await expect(renderer.prepareTexture(texture)).rejects.toThrow(
      "initialized",
    );
    await renderer.initialize({ canvas });
    expect(await renderer.prepareTexture(texture)).toBe(true);
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    renderer.dispose();
    await expect(renderer.prepareTexture(texture)).rejects.toThrow();
    texture.dispose();
  });
});
