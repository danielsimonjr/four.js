import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  AssetManager,
  createGzipLoader,
  type FetchResponse,
  type GzipDecodeLike,
} from "../src/index.js";
function response(bytes: Uint8Array): FetchResponse {
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(Uint8Array.from(bytes).buffer),
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(null),
  };
}
const platform: GzipDecodeLike = (bytes) =>
  new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
describe("bounded gzip assets", () => {
  it.each(["", "Hello fourJS — 世界", "x".repeat(100_000)])(
    "decodes real gzip output (%#)",
    async (text) => {
      const output = await createGzipLoader(platform).load(
        response(gzipSync(text)),
        "/asset.gz",
      );
      expect(new TextDecoder().decode(output)).toBe(text);
    },
  );
  it("enforces encoded manager limits and preserves loader cache identity", async () => {
    const bytes = gzipSync("scene");
    const fetch = vi.fn(() => Promise.resolve(response(bytes)));
    const manager = new AssetManager({ fetch, maximumBytes: 1024 });
    const loader = createGzipLoader(platform);
    const [a, b] = await Promise.all([
      manager.load("/scene.gz", loader),
      manager.load("/scene.gz", loader),
    ]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledOnce();
    manager.dispose();
    const bounded = new AssetManager({ fetch, maximumBytes: 1 });
    await expect(bounded.load("/scene.gz", loader)).rejects.toThrow();
    bounded.dispose();
  });
  it.each(["absolute", "ratio"])(
    "cancels over-limit output (%s)",
    async (kind) => {
      const cancel = vi.fn(() => Promise.resolve()),
        releaseLock = vi.fn();
      const read = vi.fn(() =>
        Promise.resolve({
          done: false,
          value: new Uint8Array(100),
        }),
      );
      const limits =
        kind === "absolute"
          ? { maximumDecodedBytes: 10 }
          : { maximumExpansionRatio: 0.1 };
      await expect(
        createGzipLoader(() => ({ read, cancel, releaseLock }), limits).load(
          response(gzipSync("x")),
          "/bomb.gz",
        ),
      ).rejects.toMatchObject({ code: "UNTRUSTED_INPUT_REJECTED" });
      expect(read).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
      expect(releaseLock).toHaveBeenCalledOnce();
    },
  );
  it("accepts the exact limit and copies reused buffers", async () => {
    const chunk = new Uint8Array([1, 2]);
    let reads = 0;
    const cancel = vi.fn(),
      releaseLock = vi.fn();
    const loader = createGzipLoader(
      () => ({
        read: () => {
          reads++;
          if (reads === 3) return Promise.resolve({ done: true });
          if (reads === 2) chunk.set([3, 4]);
          return Promise.resolve({ done: false, value: chunk });
        },
        cancel,
        releaseLock,
      }),
      { maximumDecodedBytes: 4 },
    );
    expect(
      Array.from(
        new Uint8Array(await loader.load(response(gzipSync("x")), "/x.gz")),
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(cancel).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
  it.each(["truncated", "checksum", "header"])(
    "rejects corrupt real gzip (%s)",
    async (kind) => {
      let bytes = Uint8Array.from(gzipSync("a".repeat(1000)));
      if (kind === "truncated") bytes = bytes.slice(0, -3);
      if (kind === "checksum") bytes[bytes.length - 8] ^= 255;
      if (kind === "header") bytes[3] = 0xe0;
      await expect(
        createGzipLoader(platform).load(response(bytes), "/bad.gz"),
      ).rejects.toMatchObject({ code: "UNTRUSTED_INPUT_REJECTED" });
    },
  );
  it("validates limits at authoring time", () => {
    for (const value of [0, -1, NaN, Infinity, 0.5])
      expect(() =>
        createGzipLoader(platform, { maximumDecodedBytes: value }),
      ).toThrow(RangeError);
    for (const value of [0, -1, NaN, Infinity])
      expect(() =>
        createGzipLoader(platform, { maximumExpansionRatio: value }),
      ).toThrow(RangeError);
  });
  it("cleans up malformed output, preserving failures when cancellation fails", async () => {
    const releaseLock = vi.fn();
    const loader = createGzipLoader(() => ({
      read: () => Promise.resolve({ done: false, value: new Uint8Array() }),
      cancel: () => Promise.reject(new Error("cancel")),
      releaseLock,
    }));
    await expect(
      loader.load(response(gzipSync("x")), "/x.gz"),
    ).rejects.toMatchObject({ code: "UNTRUSTED_INPUT_REJECTED" });
    expect(releaseLock).toHaveBeenCalledOnce();
    await expect(
      createGzipLoader(() => {
        throw new Error("decoder");
      }).load(response(gzipSync("x")), "/x.gz"),
    ).rejects.toMatchObject({ code: "UNTRUSTED_INPUT_REJECTED" });
  });
});
