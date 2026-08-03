import { describe, expect, it } from "vitest";

import {
  AssetManager,
  ImageAsset,
  binaryLoader,
  createImageLoader,
  jsonLoader,
  textLoader,
  type FetchLike,
  type FetchResponse,
  type ImageBitmapLike,
} from "../src/index.js";

/** A `FetchResponse` whose body is the given bytes. */
function bytesResponse(bytes: Uint8Array): FetchResponse {
  const buffer = bytes.slice().buffer;
  const text = new TextDecoder().decode(bytes);
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
    // Deferred, exactly as a real `Response.json()` behaves: a malformed body
    // rejects the promise, it does not throw synchronously.
    json: () => Promise.resolve().then(() => JSON.parse(text) as unknown),
    arrayBuffer: () => Promise.resolve(buffer),
  };
}

function textResponse(body: string): FetchResponse {
  return bytesResponse(new TextEncoder().encode(body));
}

function fetchOf(bodies: Record<string, string>): FetchLike {
  return (url: string) => {
    const body = bodies[url];
    if (body === undefined) {
      throw new Error(`unexpected url ${url}`);
    }
    return Promise.resolve(textResponse(body));
  };
}

/** A `createImageBitmap`-like fake: decodes "WxH" from the body bytes. */
function fakeDecode(): {
  decode: (data: ArrayBuffer) => Promise<ImageBitmapLike>;
  closed: number[];
  calls: number;
} {
  const state = {
    closed: [] as number[],
    calls: 0,
    decode: (data: ArrayBuffer): Promise<ImageBitmapLike> => {
      state.calls += 1;
      const [width, height] = new TextDecoder()
        .decode(new Uint8Array(data))
        .split("x")
        .map((part) => Number.parseInt(part, 10));
      const id = state.calls;
      return Promise.resolve({
        width: width ?? 0,
        height: height ?? 0,
        close(): void {
          state.closed.push(id);
        },
      });
    },
  };
  return state;
}

describe("body loaders", () => {
  it("textLoader returns the body as text", async () => {
    await expect(
      textLoader.load(textResponse("hello"), "/a.txt"),
    ).resolves.toBe("hello");
    expect(textLoader.name).toBe("text");
  });

  it("jsonLoader returns parsed, unnarrowed JSON", async () => {
    const value = await jsonLoader.load(
      textResponse('{"level":2,"tags":["a"]}'),
      "/a.json",
    );

    expect(value).toEqual({ level: 2, tags: ["a"] });
    expect(jsonLoader.name).toBe("json");
  });

  it("jsonLoader propagates a parse failure", async () => {
    await expect(
      jsonLoader.load(textResponse("not json"), "/a.json"),
    ).rejects.toThrow(SyntaxError);
  });

  it("binaryLoader returns the raw bytes", async () => {
    const source = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

    const buffer = await binaryLoader.load(bytesResponse(source), "/a.glb");

    expect(new Uint8Array(buffer)).toEqual(source);
    expect(binaryLoader.name).toBe("binary");
  });
});

describe("createImageLoader", () => {
  it("decodes through the injected decoder and exposes dimensions", async () => {
    const fake = fakeDecode();
    const loader = createImageLoader(fake.decode);

    const asset = await loader.load(textResponse("64x32"), "/icon.png");

    expect(loader.name).toBe("image");
    expect(fake.calls).toBe(1);
    expect(asset).toBeInstanceOf(ImageAsset);
    expect(asset.width).toBe(64);
    expect(asset.height).toBe(32);
    expect(asset.isDisposed).toBe(false);
  });

  it("accepts a synchronous decoder and a custom name", async () => {
    const bitmap: ImageBitmapLike = {
      width: 4,
      height: 4,
      close: () => undefined,
    };
    const loader = createImageLoader(() => bitmap, "image:sync");

    const asset = await loader.load(textResponse("ignored"), "/icon.png");

    expect(loader.name).toBe("image:sync");
    expect(asset.bitmap).toBe(bitmap);
  });

  it("closes the bitmap once, from dispose or close", async () => {
    const fake = fakeDecode();
    const loader = createImageLoader(fake.decode);

    const asset = await loader.load(textResponse("8x8"), "/icon.png");
    asset.dispose();
    asset.dispose();
    asset.close();

    expect(fake.closed).toEqual([1]);
    expect(asset.isDisposed).toBe(true);
  });

  it("closes through the manager's refcount when the last reference goes", async () => {
    const fake = fakeDecode();
    const loader = createImageLoader(fake.decode);
    const manager = new AssetManager({ fetch: fetchOf({ "/i.png": "16x8" }) });

    const asset = await manager.load("/i.png", loader);
    await manager.load("/i.png", loader);
    expect(fake.calls).toBe(1);

    expect(manager.release("/i.png", loader)).toBe(false);
    expect(fake.closed).toEqual([]);
    expect(manager.release("/i.png", loader)).toBe(true);

    expect(fake.closed).toEqual([1]);
    expect(asset.isDisposed).toBe(true);
  });

  it("gives each factory call its own cache slot", async () => {
    const fake = fakeDecode();
    const first = createImageLoader(fake.decode);
    const second = createImageLoader(fake.decode);
    const manager = new AssetManager({ fetch: fetchOf({ "/i.png": "2x2" }) });

    const a = await manager.load("/i.png", first);
    const b = await manager.load("/i.png", second);

    expect(a).not.toBe(b);
    expect(fake.calls).toBe(2);
    expect(manager.size).toBe(2);
  });
});

describe("loaders as asset-manager keys", () => {
  it("round-trips text, JSON, and binary through the manager", async () => {
    const manager = new AssetManager({
      fetch: fetchOf({
        "/a.txt": "alpha",
        "/a.json": '{"ok":true}',
        "/a.glb": "glTF",
      }),
    });

    expect(await manager.load("/a.txt", textLoader)).toBe("alpha");
    expect(await manager.load("/a.json", jsonLoader)).toEqual({ ok: true });
    expect(
      new TextDecoder().decode(await manager.load("/a.glb", binaryLoader)),
    ).toBe("glTF");
    expect(manager.size).toBe(3);
  });
});
