/**
 * `preloadManifestIntoCatalog` (A-16 remainder): walk a §79 manifest's keys,
 * load each, return a catalog whose `get` is synchronous.
 */

import { isFourError } from "@four/core";
import {
  AssetManager,
  textLoader,
  type AssetLoader,
  type AssetManifest,
  type FetchResponse,
} from "@four/assets";
import { describe, expect, it } from "vitest";

import { preloadManifestIntoCatalog } from "../src/index.js";

function response(body: string): FetchResponse {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve().then(() => JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  };
}

function fetchOf(
  bodies: Record<string, string>,
): (url: string) => Promise<FetchResponse> {
  return (url: string) => {
    const body = bodies[url];
    if (body === undefined) {
      return Promise.reject(new Error(`unexpected url ${url}`));
    }
    return Promise.resolve(response(body));
  };
}

const recordLoader: AssetLoader<{ id: string }> = {
  name: "record",
  async load(response, url) {
    return { id: `${url}:${await response.text()}` };
  },
};

const manifest: AssetManifest = {
  brick: { url: "/brick.txt" },
  glass: { url: "/glass.txt" },
};

function manager(): AssetManager {
  return new AssetManager({
    fetch: fetchOf({ "/brick.txt": "brick", "/glass.txt": "glass" }),
  });
}

describe("preloadManifestIntoCatalog", () => {
  it("walks every manifest key into a synchronous catalog", async () => {
    const catalog = await preloadManifestIntoCatalog(
      manager(),
      manifest,
      recordLoader,
    );

    const brick = catalog.get("brick");
    expect(brick?.id).toBe("/brick.txt:brick");
    expect(catalog.get("glass")?.id).toBe("/glass.txt:glass");
    expect(catalog.get("absent")).toBeUndefined();
    expect(catalog.keyOf(brick ?? { id: "" })).toBe("brick");
  });

  it("loads only the keys a document names, once each", async () => {
    const assets = manager();
    const catalog = await preloadManifestIntoCatalog(
      assets,
      manifest,
      recordLoader,
      { keys: ["glass", "glass", "brick"] },
    );

    expect(catalog.get("glass")?.id).toBe("/glass.txt:glass");
    expect(catalog.get("brick")?.id).toBe("/brick.txt:brick");
    expect(assets.refCount("/glass.txt", recordLoader)).toBe(1);
    expect(assets.refCount("/brick.txt", recordLoader)).toBe(1);
  });

  it("maps a loaded asset into the catalog's type", async () => {
    const catalog = await preloadManifestIntoCatalog(
      manager(),
      manifest,
      textLoader,
      { keys: ["brick"], map: (text, key) => ({ key, text }) },
    );

    expect(catalog.get("brick")).toEqual({ key: "brick", text: "brick" });
    expect(catalog.get("glass")).toBeUndefined();
  });

  it("returns an empty catalog when the walk names nothing", async () => {
    const catalog = await preloadManifestIntoCatalog(
      manager(),
      {},
      recordLoader,
    );
    expect(catalog.get("brick")).toBeUndefined();

    const none = await preloadManifestIntoCatalog(
      manager(),
      manifest,
      recordLoader,
      { keys: [] },
    );
    expect(none.get("brick")).toBeUndefined();
  });

  it("refuses a key the manifest does not name", async () => {
    await expect(
      preloadManifestIntoCatalog(manager(), manifest, recordLoader, {
        keys: ["ghost"],
      }),
    ).rejects.toThrow(/names no key "ghost"/);
  });

  it("refuses a hashless row when requireHash is set", async () => {
    try {
      await preloadManifestIntoCatalog(manager(), manifest, recordLoader, {
        requireHash: true,
      });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(isFourError(error) && error.code).toBe("ASSET_LOAD_FAILED");
      expect(isFourError(error) && error.message).toMatch(
        /declares no content hash/,
      );
    }
  });
});
