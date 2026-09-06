/**
 * The two cross-package contracts this wave's assets packet rests on (A-18,
 * A-19; 2026-08-21).
 *
 * 1. **`TextureAsset` is a `TextureSource`.** `@four/assets` sits below the
 *    renderer in §3.1's matrix and must not import it, so `packages/assets/
 *    src/texture.ts` states the §61/§77 source contract structurally. That is
 *    only safe if the two spellings agree — so this suite hands a loaded
 *    {@link TextureAsset} to `@four/render`'s real `Texture`, which is the
 *    compile-time and run-time proof. (The `PARTICLE_INSTANCE_FLOATS`
 *    precedent: a duplicated contract with a test on each side, not a
 *    dependency edge in the wrong direction.)
 * 2. **A §79 manifest reaches a `SceneResourceCatalog`.** §79 resolves assets
 *    by logical key through a manifest of URL + content hash, while
 *    `@four/four`'s deserializer resolves keys *synchronously* from a catalog.
 *    The wiring is therefore preload-then-catalog, and `preloadManifestIntoCatalog`
 *    is the walk — this suite uses that helper so the seam A-16 finishes
 *    against is the shipped API, not a hand-rolled proof of the same steps.
 */

import {
  AssetManager,
  createTextureLoader,
  loadFromManifest,
  manifestLoader,
  type AssetManifest,
  type FetchResponse,
  type TextureAsset,
} from "@four/assets";
import { preloadManifestIntoCatalog, resourceCatalog } from "four";
import { Texture } from "@four/render";
import { describe, expect, it } from "vitest";

/** A 2 × 2 image, top row first: red row over blue row. */
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const TOP_FIRST = new Uint8Array([...RED, ...RED, ...BLUE, ...BLUE]);

/** The "encoded" body: this fake codec ships the texels verbatim. */
const ENCODED = new Uint8Array([2, 2, ...TOP_FIRST]);

function response(bytes: Uint8Array): FetchResponse {
  const buffer = bytes.slice().buffer;
  const text = (): Promise<string> =>
    Promise.resolve(new TextDecoder().decode(bytes));
  return {
    ok: true,
    status: 200,
    text,
    json: async () => JSON.parse(await text()) as unknown,
    arrayBuffer: () => Promise.resolve(buffer),
  };
}

/** A codec whose header is `[width, height]` and whose body is RGBA8. */
const fakeCodec = createTextureLoader({
  name: "fake-png",
  colorSpace: "srgb",
  filter: "nearest",
  wrap: "repeat",
  probe: (data) => {
    const header = new Uint8Array(data);
    return { width: header[0] ?? 0, height: header[1] ?? 0 };
  },
  decode: (data) => {
    const bytes = new Uint8Array(data);
    return {
      width: bytes[0] ?? 0,
      height: bytes[1] ?? 0,
      data: bytes.slice(2),
    };
  },
});

describe("TextureAsset satisfies @four/render's TextureSource", () => {
  it("constructs a Texture with no adapter, bottom row first (§7a, §77)", async () => {
    const assets = new AssetManager({
      fetch: () => Promise.resolve(response(ENCODED)),
    });
    const asset: TextureAsset = await assets.load("/crate.png", fakeCodec);

    // The compile-time half of the contract: no cast, no conversion.
    const texture = new Texture(asset);

    expect(texture.width).toBe(2);
    expect(texture.height).toBe(2);
    expect(texture.colorSpace).toBe("srgb");
    expect(texture.filter).toBe("nearest");
    expect(texture.wrap).toBe("repeat");
    // Row 0 is `v = 0`: the loader flipped the codec's top-first rows.
    expect([...(texture.source.data ?? [])].slice(0, 8)).toEqual([
      ...BLUE,
      ...BLUE,
    ]);
    texture.dispose();
  });
});

describe("a §79 manifest preloads a SceneResourceCatalog", () => {
  it("resolves key → URL → verified bytes → catalog entry", async () => {
    const manifestDocument = JSON.stringify({
      crate: {
        url: "/crate.png",
        // The digest of ENCODED, computed by the same manager below.
        hash: await sha256(ENCODED),
      },
    });
    const assets = new AssetManager({
      fetch: (url: string) =>
        Promise.resolve(
          response(
            url === "/assets.json"
              ? new TextEncoder().encode(manifestDocument)
              : ENCODED,
          ),
        ),
    });

    const manifest: AssetManifest = await assets.load(
      "/assets.json",
      manifestLoader,
    );
    const catalog = await preloadManifestIntoCatalog(
      assets,
      manifest,
      fakeCodec,
      {
        requireHash: true,
        map: (asset) => new Texture(asset),
      },
    );

    // Preload complete: the catalog is a synchronous map, as §79's read side
    // requires, and every key in it was verified on the way in.
    const restored = catalog.get("crate");
    expect(restored?.width).toBe(2);
    expect(
      catalog.keyOf(restored ?? new Texture({ width: 1, height: 1 })),
    ).toBe("crate");
    expect(catalog.get("absent")).toBeUndefined();
  });

  it("the hand-rolled walk still agrees with the helper", async () => {
    const hash = await sha256(ENCODED);
    const manifest: AssetManifest = {
      crate: { url: "/crate.png", hash },
    };
    const assets = new AssetManager({
      fetch: () => Promise.resolve(response(ENCODED)),
    });

    const crate = await loadFromManifest(assets, manifest, "crate", fakeCodec, {
      requireHash: true,
    });
    const byHand = resourceCatalog(new Map([["crate", new Texture(crate)]]));
    const byHelper = await preloadManifestIntoCatalog(
      assets,
      manifest,
      fakeCodec,
      {
        requireHash: true,
        map: (asset) => new Texture(asset),
      },
    );

    expect(byHelper.get("crate")?.width).toBe(byHand.get("crate")?.width);
    expect(byHelper.get("crate")?.height).toBe(byHand.get("crate")?.height);
    expect(byHelper.get("crate")?.colorSpace).toBe(
      byHand.get("crate")?.colorSpace,
    );
  });

  it("refuses bytes the manifest did not name (§96)", async () => {
    const manifest: AssetManifest = {
      crate: { url: "/crate.png", hash: "sha256-not-the-bytes" },
    };
    const assets = new AssetManager({
      fetch: () => Promise.resolve(response(ENCODED)),
    });
    await expect(
      loadFromManifest(assets, manifest, "crate", fakeCodec),
    ).rejects.toThrow(/hashes to/);
    expect(assets.size).toBe(0);
  });
});

/** The platform SHA-256, in this suite's own words, for the manifest fixture. */
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `sha256-${hex}`;
}
