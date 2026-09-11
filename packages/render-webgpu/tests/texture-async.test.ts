import { describe, expect, it, vi } from "vitest";
import { Texture } from "@fourjs/render";
import { WgpuTextureCache } from "../src/wgpu-texture.js";
import { WebgpuRenderer } from "../src/webgpu-renderer.js";
import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
function setup() {
  const gpu = createRecordingGpu();
  const queue = gpu.device!.queue;
  queue.onSubmittedWorkDone = vi.fn(() => Promise.resolve());
  return {
    gpu,
    queue,
    cache: new WgpuTextureCache(gpu.device!),
    texture: new Texture({ width: 1, height: 1 }),
  };
}
describe("asynchronous WebGPU texture preparation", () => {
  it("waits for queue completion and exposes residency", async () => {
    const { queue, cache, texture } = setup();
    let release = () => {};
    queue.onSubmittedWorkDone = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    expect(cache.residency(texture)).toBe("absent");
    const pending = cache.acquireAsync(texture);
    expect(cache.residency(texture)).toBe("uploading");
    release();
    expect(await pending).not.toBeNull();
    expect(cache.residency(texture)).toBe("resident");
    texture.markDirty();
    expect(cache.residency(texture)).toBe("stale");
    texture.dispose();
    expect(cache.residency(texture)).toBe("absent");
    expect(await cache.acquireAsync(texture)).toBeNull();
    cache.dispose();
  });
  it("rejects missing completion support and actual device errors", async () => {
    const { queue, cache, texture } = setup();
    queue.onSubmittedWorkDone = undefined;
    await expect(cache.acquireAsync(texture)).rejects.toThrow("completion");
    queue.onSubmittedWorkDone = () => Promise.reject(new Error("device lost"));
    await expect(cache.acquireAsync(texture)).rejects.toThrow("device lost");
    expect(cache.residency(texture)).toBe("absent");
    cache.dispose();
    expect(await cache.acquireAsync(texture)).toBeNull();
    texture.dispose();
  });
  it("cancels stale, lost or disposed allocations after completion", async () => {
    for (const action of ["mutation", "texture", "cache", "loss"] as const) {
      const { queue, cache, texture } = setup();
      queue.onSubmittedWorkDone = () => {
        if (action === "mutation") texture.markDirty();
        if (action === "texture") texture.dispose();
        if (action === "cache") cache.dispose();
        if (action === "loss") cache.forget();
        return Promise.resolve();
      };
      expect(await cache.acquireAsync(texture)).toBeNull();
      texture.dispose();
      cache.dispose();
    }
  });
  it("tracks concurrent completion waiters", async () => {
    const { queue, cache, texture } = setup(),
      releases: (() => void)[] = [];
    queue.onSubmittedWorkDone = () =>
      new Promise((resolve) => releases.push(resolve));
    const a = cache.acquireAsync(texture),
      b = cache.acquireAsync(texture);
    releases[0]();
    await a;
    expect(cache.residency(texture)).toBe("uploading");
    releases[1]();
    await b;
    expect(cache.residency(texture)).toBe("resident");
    texture.dispose();
    cache.dispose();
  });
  it("rejects renderer preparation before initialization and after disposal", async () => {
    const renderer = new WebgpuRenderer(),
      texture = new Texture({ width: 1, height: 1 });
    await expect(renderer.prepareTexture(texture)).rejects.toThrow(
      "initialized",
    );
    renderer.dispose();
    await expect(renderer.prepareTexture(texture)).rejects.toThrow();
    texture.dispose();
  });
});
