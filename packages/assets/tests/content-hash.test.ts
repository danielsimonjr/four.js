import { isFourError } from "@four/core";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

import {
  AssetManager,
  CONTENT_HASH_ALGORITHM,
  binaryLoader,
  jsonLoader,
  textLoader,
  type AssetLoader,
  type FetchResponse,
} from "../src/index.js";
import {
  resolveGlobalDigest,
  resolveGlobalTextDecoder,
} from "../src/content-hash.js";

// --- fakes ------------------------------------------------------------------

function response(body: string): FetchResponse {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve().then(() => JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  };
}

/** A fetch answering every URL with `bodies[url]`. */
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

/** The context of a rejected load, for the assertions below. */
async function contextOf(
  work: Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (isFourError(error)) {
      return error.context ?? {};
    }
    throw error;
  }
  throw new Error("expected a rejection");
}

// --- the platform digest ----------------------------------------------------

describe("resolveGlobalDigest", () => {
  it("hashes with SHA-256 in this runtime and formats algorithm-hex", async () => {
    const digest = resolveGlobalDigest();
    expect(digest).toBeTypeOf("function");
    const hash = await digest?.(new TextEncoder().encode("abc").buffer);
    // The published SHA-256 of "abc".
    expect(hash).toBe(
      `${CONTENT_HASH_ALGORITHM}-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`,
    );
  });

  it("is absent when the runtime exposes no crypto.subtle", () => {
    const saved = Reflect.getOwnPropertyDescriptor(globalThis, "crypto");
    Reflect.deleteProperty(globalThis, "crypto");
    try {
      expect(resolveGlobalDigest()).toBeUndefined();
      Object.defineProperty(globalThis, "crypto", {
        value: {},
        configurable: true,
      });
      expect(resolveGlobalDigest()).toBeUndefined();
    } finally {
      Reflect.deleteProperty(globalThis, "crypto");
      if (saved !== undefined) {
        Object.defineProperty(globalThis, "crypto", saved);
      }
    }
  });
});

describe("resolveGlobalTextDecoder", () => {
  it("decodes UTF-8 in this runtime", () => {
    const decode = resolveGlobalTextDecoder();
    expect(decode?.(new TextEncoder().encode("héllo").buffer)).toBe("héllo");
  });

  it("is absent when the runtime has no TextDecoder", () => {
    const saved = Reflect.getOwnPropertyDescriptor(globalThis, "TextDecoder");
    Reflect.deleteProperty(globalThis, "TextDecoder");
    try {
      expect(resolveGlobalTextDecoder()).toBeUndefined();
    } finally {
      if (saved !== undefined) {
        Object.defineProperty(globalThis, "TextDecoder", saved);
      }
    }
  });
});

// --- hashing through the manager -------------------------------------------

const HASH_OF_ABC = `${CONTENT_HASH_ALGORITHM}-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`;

describe("AssetManager content hashing", () => {
  it("reports the capability and records a hash only when asked", async () => {
    const assets = new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) });
    expect(assets.canHashContent).toBe(true);

    await assets.load("/a.txt", textLoader);
    expect(assets.contentHash("/a.txt", textLoader)).toBeUndefined();

    await assets.load("/a.txt", binaryLoader, { hashContent: true });
    expect(assets.contentHash("/a.txt", binaryLoader)).toBe(HASH_OF_ABC);
    // Absent key, and a key that is not settled, both read as `undefined`.
    expect(assets.contentHash("/missing.txt", binaryLoader)).toBeUndefined();
  });

  it("hashes the bytes, so the loader that read them does not matter", async () => {
    const assets = new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) });
    await assets.load("/a.txt", textLoader, { hashContent: true });
    await assets.load("/a.txt", binaryLoader, { hashContent: true });
    expect(assets.contentHash("/a.txt", textLoader)).toBe(HASH_OF_ABC);
    expect(assets.contentHash("/a.txt", binaryLoader)).toBe(HASH_OF_ABC);
  });

  it("routes a hashed json() load through the decoded bytes", async () => {
    const assets = new AssetManager({
      fetch: fetchOf({ "/a.json": '{"n":1}' }),
    });
    await expect(
      assets.load("/a.json", jsonLoader, { hashContent: true }),
    ).resolves.toEqual({ n: 1 });
    expect(assets.contentHash("/a.json", jsonLoader)).toMatch(
      /^sha256-[0-9a-f]{64}$/,
    );
  });

  it("accepts a declared hash that matches", async () => {
    const assets = new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) });
    await expect(
      assets.load("/a.txt", textLoader, { expectedHash: HASH_OF_ABC }),
    ).resolves.toBe("abc");
    expect(assets.refCount("/a.txt", textLoader)).toBe(1);
  });

  it("refuses a mismatch loudly and hands the reference back (§96)", async () => {
    const assets = new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) });
    const context = await contextOf(
      assets.load("/a.txt", textLoader, { expectedHash: "sha256-deadbeef" }),
    );
    expect(context.reason).toBe("hash-mismatch");
    expect(context.expectedHash).toBe("sha256-deadbeef");
    expect(context.observedHash).toBe(HASH_OF_ABC);
    // The refused caller holds nothing: no reference, no cache slot.
    expect(assets.refCount("/a.txt", textLoader)).toBe(0);
    expect(assets.size).toBe(0);
  });

  it("verifies per caller: one wrong expectation does not disturb the others", async () => {
    const assets = new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) });
    const good = assets.load("/a.txt", textLoader, {
      expectedHash: HASH_OF_ABC,
    });
    const bad = assets.load("/a.txt", textLoader, {
      expectedHash: "sha256-00",
    });
    await expect(good).resolves.toBe("abc");
    await expect(bad).rejects.toThrow(/hashes to/);
    expect(assets.refCount("/a.txt", textLoader)).toBe(1);
  });

  it("refuses to verify a load that was not hashing (never silently passes)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const assets = new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) });
    await assets.load("/a.txt", textLoader);
    const context = await contextOf(
      assets.load("/a.txt", textLoader, { expectedHash: HASH_OF_ABC }),
    );
    expect(context.reason).toBe("hash-unavailable");
    // The unhashed entry, and its original reference, are untouched.
    expect(assets.refCount("/a.txt", textLoader)).toBe(1);
  });

  it("refuses at the call when the runtime supplies no digest", async () => {
    // An insecure browser context: `crypto` without `subtle`.
    const bare = withoutGlobal(
      "crypto",
      () => new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) }),
    );
    expect(bare.canHashContent).toBe(false);
    expect(() =>
      bare.load("/a.txt", textLoader, { hashContent: true }),
    ).toThrow(/no digest/);
    // …and an unhashed load through the same manager still works.
    await expect(bare.load("/a.txt", textLoader)).resolves.toBe("abc");
  });

  it("refuses a hashed text load when the runtime has no TextDecoder", async () => {
    const assets = withoutGlobal(
      "TextDecoder",
      () => new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) }),
    );
    const context = await contextOf(
      assets.load("/a.txt", textLoader, { hashContent: true }),
    );
    expect(context.reason).toBe("hash-unavailable");
    // A byte-reading loader needs no decoder and is unaffected.
    await expect(
      assets.load("/a.txt", binaryLoader, { hashContent: true }),
    ).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("refuses when the loader never reads the body", async () => {
    const silent: AssetLoader<string> = {
      name: "silent",
      load: () => Promise.resolve("nothing read"),
    };
    const assets = new AssetManager({ fetch: fetchOf({ "/a.txt": "abc" }) });
    const context = await contextOf(
      assets.load("/a.txt", silent, { hashContent: true }),
    );
    expect(context.reason).toBe("hash-unavailable");
  });

  it("takes a caller's own digest, and hashes once per load", async () => {
    let calls = 0;
    const assets = new AssetManager({
      fetch: fetchOf({ "/a.bin": "abc" }),
      digest: () => {
        calls += 1;
        return `fnv-${String(calls)}`;
      },
    });
    const twice = await Promise.all([
      assets.load("/a.bin", binaryLoader, { hashContent: true }),
      assets.load("/a.bin", binaryLoader, { hashContent: true }),
    ]);
    expect(twice).toHaveLength(2);
    expect(calls).toBe(1);
    expect(assets.contentHash("/a.bin", binaryLoader)).toBe("fnv-1");
  });

  it("hashes inside the §96 size bound, so an over-budget body is refused first", async () => {
    let calls = 0;
    const assets = new AssetManager({
      fetch: fetchOf({ "/a.bin": "abcdefgh" }),
      maximumBytes: 4,
      digest: () => {
        calls += 1;
        return "unreachable";
      },
    });
    await expect(
      assets.load("/a.bin", binaryLoader, { hashContent: true }),
    ).rejects.toThrow(/over the 4-byte limit/);
    expect(calls).toBe(0);
  });
});

/** Runs `build` in a runtime that is missing one global, then restores it. */
function withoutGlobal<T>(name: string, build: () => T): T {
  const saved = Reflect.getOwnPropertyDescriptor(globalThis, name);
  Reflect.deleteProperty(globalThis, name);
  try {
    return build();
  } finally {
    if (saved !== undefined) {
      Object.defineProperty(globalThis, name, saved);
    }
  }
}
