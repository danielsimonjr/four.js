import {
  FourError,
  isFourError,
  resetDevWarnings,
  type Disposable,
} from "@four/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AssetManager,
  type AssetLoader,
  type FetchLike,
  type FetchResponse,
} from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  resetDevWarnings();
});

// --- fakes ------------------------------------------------------------------

/** A `FetchResponse` over a fixed body; `json()` parses `body`. */
function response(body: string, ok = true, status = 200): FetchResponse {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve().then(() => JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  };
}

interface FakeFetch {
  readonly fetch: FetchLike;
  /** Every URL requested, in call order. */
  readonly calls: string[];
}

/** A fetch that answers immediately from a URL → body table. */
function immediateFetch(bodies: Record<string, string>): FakeFetch {
  const calls: string[] = [];
  return {
    calls,
    fetch: (url: string) => {
      calls.push(url);
      const body = bodies[url];
      return Promise.resolve(
        body === undefined ? response("", false, 404) : response(body),
      );
    },
  };
}

interface DeferredFetch extends FakeFetch {
  /** Resolves the oldest unsettled request for `url` with `body`. */
  resolve(url: string, body: string): void;
  /** Resolves the request made at call index `index` (see `calls`). */
  resolveAt(index: number, body: string): void;
  /** Rejects the oldest unsettled request for `url`. */
  reject(url: string, error: unknown): void;
}

interface PendingRequest {
  readonly url: string;
  settled: boolean;
  readonly resolve: (value: FetchResponse) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * A fetch whose responses the test releases by hand. Requests are kept in call
 * order, so two in-flight fetches of the same URL can be settled in either
 * order (`resolveAt`) — which is exactly the race the eviction-identity test
 * needs.
 */
function deferredFetch(): DeferredFetch {
  const calls: string[] = [];
  const requests: PendingRequest[] = [];
  const takeAt = (index: number): PendingRequest => {
    const request = requests[index];
    if (request === undefined || request.settled) {
      throw new Error(`no pending fetch at index ${String(index)}`);
    }
    request.settled = true;
    return request;
  };
  const takeFor = (url: string): PendingRequest => {
    const index = requests.findIndex(
      (request) => request.url === url && !request.settled,
    );
    if (index < 0) {
      throw new Error(`no pending fetch for ${url}`);
    }
    return takeAt(index);
  };
  return {
    calls,
    fetch: (url: string) => {
      calls.push(url);
      return new Promise<FetchResponse>((resolve, reject) => {
        requests.push({ url, settled: false, resolve, reject });
      });
    },
    resolve(url: string, body: string): void {
      takeFor(url).resolve(response(body));
    },
    resolveAt(index: number, body: string): void {
      takeAt(index).resolve(response(body));
    },
    reject(url: string, error: unknown): void {
      takeFor(url).reject(error);
    },
  };
}

/** A disposable asset that records how often it was disposed. */
class DisposableAsset implements Disposable {
  disposeCount = 0;

  constructor(readonly body: string) {}

  dispose(): void {
    this.disposeCount += 1;
  }
}

const plainLoader: AssetLoader<string> = {
  name: "plain",
  load: (res) => res.text(),
};

/** A second loader for the same bytes — a distinct cache slot by identity. */
const upperLoader: AssetLoader<string> = {
  name: "upper",
  load: (res) => res.text().then((text) => text.toUpperCase()),
};

const disposableLoader: AssetLoader<DisposableAsset> = {
  name: "disposable",
  load: (res) => res.text().then((text) => new DisposableAsset(text)),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- fetch injection --------------------------------------------------------

describe("AssetManager fetch injection", () => {
  it("uses the injected fetch", async () => {
    const io = immediateFetch({ "/a.txt": "alpha" });
    const manager = new AssetManager({ fetch: io.fetch });

    await expect(manager.load("/a.txt", plainLoader)).resolves.toBe("alpha");
    expect(io.calls).toEqual(["/a.txt"]);
  });

  it("falls back to globalThis.fetch when none is injected", async () => {
    const io = immediateFetch({ "/a.txt": "alpha" });
    vi.stubGlobal("fetch", io.fetch);
    const manager = new AssetManager();

    await expect(manager.load("/a.txt", plainLoader)).resolves.toBe("alpha");
    expect(io.calls).toEqual(["/a.txt"]);
  });

  it("throws INVALID_APPLICATION_STATE when the runtime has no fetch", () => {
    vi.stubGlobal("fetch", undefined);
    const manager = new AssetManager();

    expect(() => manager.load("/a.txt", plainLoader)).toThrow(
      /no fetch implementation/,
    );
    try {
      // `void`: this call throws synchronously, so no promise is ever created.
      void manager.load("/a.txt", plainLoader);
      expect.unreachable("load should have thrown");
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      expect((error as FourError).code).toBe("INVALID_APPLICATION_STATE");
      expect((error as FourError).context).toEqual({
        url: "/a.txt",
        loader: "plain",
      });
    }
    expect(manager.size).toBe(0);
  });
});

// --- caching and coalescing -------------------------------------------------

describe("AssetManager caching", () => {
  it("fetches once for repeated sequential loads and counts references", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const io = immediateFetch({ "/a.txt": "alpha" });
    const manager = new AssetManager({ fetch: io.fetch });

    await manager.load("/a.txt", plainLoader);
    await manager.load("/a.txt", plainLoader);

    expect(io.calls).toEqual(["/a.txt"]);
    expect(manager.refCount("/a.txt", plainLoader)).toBe(2);
    expect(manager.size).toBe(1);
  });

  it("coalesces two concurrent loads onto one fetch", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });

    const first = manager.load("/a.txt", plainLoader);
    const second = manager.load("/a.txt", plainLoader);
    expect(io.calls).toEqual(["/a.txt"]);
    expect(manager.refCount("/a.txt", plainLoader)).toBe(2);
    // Not settled yet: `get`/`has` are peeks at resolved assets only.
    expect(manager.has("/a.txt", plainLoader)).toBe(false);
    expect(manager.get("/a.txt", plainLoader)).toBeUndefined();

    io.resolve("/a.txt", "alpha");
    expect(await first).toBe("alpha");
    expect(await second).toBe("alpha");
    expect(io.calls).toEqual(["/a.txt"]);
    expect(manager.has("/a.txt", plainLoader)).toBe(true);
    expect(manager.get("/a.txt", plainLoader)).toBe("alpha");
  });

  it("warns once when a settled asset is loaded again (§83)", async () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const io = immediateFetch({ "/a.txt": "alpha" });
    const manager = new AssetManager({ fetch: io.fetch });

    await manager.load("/a.txt", plainLoader);
    expect(warn).not.toHaveBeenCalled();

    await manager.load("/a.txt", plainLoader);
    await manager.load("/a.txt", plainLoader);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("§83");
    expect(String(warn.mock.calls[0][0])).toContain("/a.txt");
  });

  it("does not warn when two loads coalesce before the fetch settles", async () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });

    const first = manager.load("/a.txt", plainLoader);
    const second = manager.load("/a.txt", plainLoader);
    expect(warn).not.toHaveBeenCalled();
    io.resolve("/a.txt", "alpha");
    await first;
    await second;
    expect(warn).not.toHaveBeenCalled();
  });

  it("keys the cache by loader identity, not by loader name", async () => {
    const io = immediateFetch({ "/a.txt": "alpha" });
    const manager = new AssetManager({ fetch: io.fetch });

    expect(await manager.load("/a.txt", plainLoader)).toBe("alpha");
    expect(await manager.load("/a.txt", upperLoader)).toBe("ALPHA");

    expect(io.calls).toEqual(["/a.txt", "/a.txt"]);
    expect(manager.size).toBe(2);
    expect(manager.refCount("/a.txt", plainLoader)).toBe(1);
    expect(manager.refCount("/a.txt", upperLoader)).toBe(1);

    // Two loaders that share a *name* are still two slots: identity decides.
    const twin: AssetLoader<string> = { name: "plain", load: (r) => r.text() };
    expect(await manager.load("/a.txt", twin)).toBe("alpha");
    expect(io.calls).toHaveLength(3);
    expect(manager.size).toBe(3);
  });

  it("reports absent keys as absent", () => {
    const io = immediateFetch({});
    const manager = new AssetManager({ fetch: io.fetch });

    expect(manager.has("/missing", plainLoader)).toBe(false);
    expect(manager.get("/missing", plainLoader)).toBeUndefined();
    expect(manager.refCount("/missing", plainLoader)).toBe(0);
    expect(manager.size).toBe(0);
    expect(manager.isDisposed).toBe(false);
  });
});

// --- reference counting and disposal ---------------------------------------

describe("AssetManager reference counting", () => {
  it("disposes a Disposable asset when the last reference is released", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const io = immediateFetch({ "/a.txt": "alpha" });
    const manager = new AssetManager({ fetch: io.fetch });

    const asset = await manager.load("/a.txt", disposableLoader);
    await manager.load("/a.txt", disposableLoader);

    expect(manager.release("/a.txt", disposableLoader)).toBe(false);
    expect(manager.refCount("/a.txt", disposableLoader)).toBe(1);
    expect(asset.disposeCount).toBe(0);

    expect(manager.release("/a.txt", disposableLoader)).toBe(true);
    expect(asset.disposeCount).toBe(1);
    expect(manager.has("/a.txt", disposableLoader)).toBe(false);
    expect(manager.size).toBe(0);

    // A later load re-fetches: eviction is real, not a flag.
    const reloaded = await manager.load("/a.txt", disposableLoader);
    expect(io.calls).toEqual(["/a.txt", "/a.txt"]);
    expect(reloaded).not.toBe(asset);
  });

  it("evicts a non-disposable asset without complaint", async () => {
    const io = immediateFetch({ "/a.txt": "alpha", "/b.txt": "beta" });
    const manager = new AssetManager({ fetch: io.fetch });

    await manager.load("/a.txt", plainLoader);
    await manager.load("/b.txt", plainLoader);

    // Releasing one of two entries under the same loader keeps the group.
    expect(manager.release("/a.txt", plainLoader)).toBe(true);
    expect(manager.size).toBe(1);
    expect(manager.has("/b.txt", plainLoader)).toBe(true);

    expect(manager.release("/b.txt", plainLoader)).toBe(true);
    expect(manager.size).toBe(0);
  });

  it("returns false when releasing an unknown key", () => {
    const manager = new AssetManager({ fetch: immediateFetch({}).fetch });

    expect(manager.release("/missing", plainLoader)).toBe(false);
  });

  it("disposes on settle when the last reference is released mid-flight", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });

    const pending = manager.load("/a.txt", disposableLoader);
    expect(manager.release("/a.txt", disposableLoader)).toBe(true);
    // Still cached while in flight — there is nothing to cancel (staged).
    expect(manager.size).toBe(1);
    expect(manager.refCount("/a.txt", disposableLoader)).toBe(0);

    io.resolve("/a.txt", "alpha");
    const asset = await pending;

    expect(asset.disposeCount).toBe(1);
    expect(manager.size).toBe(0);
    expect(manager.has("/a.txt", disposableLoader)).toBe(false);
  });

  it("re-joins a pending entry whose references dropped to zero", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });

    const first = manager.load("/a.txt", disposableLoader);
    manager.release("/a.txt", disposableLoader);
    const second = manager.load("/a.txt", disposableLoader);
    expect(io.calls).toEqual(["/a.txt"]);
    expect(manager.refCount("/a.txt", disposableLoader)).toBe(1);

    io.resolve("/a.txt", "alpha");
    const asset = await second;

    expect(await first).toBe(asset);
    expect(asset.disposeCount).toBe(0);
    expect(manager.has("/a.txt", disposableLoader)).toBe(true);
  });
});

// --- failures ---------------------------------------------------------------

describe("AssetManager failures", () => {
  it("reports a non-ok response as ASSET_LOAD_FAILED and caches nothing", async () => {
    const io = immediateFetch({});
    const manager = new AssetManager({ fetch: io.fetch });

    const error: unknown = await manager
      .load("/missing.txt", plainLoader)
      .catch((reason: unknown) => reason);

    expect(isFourError(error)).toBe(true);
    expect((error as FourError).code).toBe("ASSET_LOAD_FAILED");
    expect((error as FourError).message).toContain("HTTP 404");
    expect((error as FourError).context).toEqual({
      url: "/missing.txt",
      loader: "plain",
      status: 404,
    });
    expect(manager.size).toBe(0);
  });

  it("wraps a transport failure and keeps the cause", async () => {
    const cause = new Error("offline");
    const manager = new AssetManager({
      fetch: () => Promise.reject(cause),
    });

    const error: unknown = await manager
      .load("/a.txt", plainLoader)
      .catch((reason: unknown) => reason);

    expect(isFourError(error)).toBe(true);
    expect((error as FourError).code).toBe("ASSET_LOAD_FAILED");
    expect((error as FourError).cause).toBe(cause);
    expect((error as FourError).context).toEqual({
      url: "/a.txt",
      loader: "plain",
    });
  });

  it("wraps a decode failure with the loader name and status", async () => {
    const io = immediateFetch({ "/a.txt": "alpha" });
    const manager = new AssetManager({ fetch: io.fetch });
    const cause = new Error("bad bytes");
    const failing: AssetLoader<string> = {
      name: "failing",
      load: () => Promise.reject(cause),
    };

    const error: unknown = await manager
      .load("/a.txt", failing)
      .catch((reason: unknown) => reason);

    expect(isFourError(error)).toBe(true);
    expect((error as FourError).message).toContain('Loader "failing"');
    expect((error as FourError).cause).toBe(cause);
    expect((error as FourError).context).toEqual({
      url: "/a.txt",
      loader: "failing",
      status: 200,
    });
  });

  it("passes a loader's own FourError through unwrapped", async () => {
    const io = immediateFetch({ "/a.txt": "alpha" });
    const manager = new AssetManager({ fetch: io.fetch });
    const own = new FourError("SERIALIZATION_VERSION_MISMATCH", "v2 required");
    const failing: AssetLoader<string> = {
      name: "picky",
      load: () => Promise.reject(own),
    };

    const error: unknown = await manager
      .load("/a.txt", failing)
      .catch((reason: unknown) => reason);

    expect(error).toBe(own);
  });

  it("rejects every coalesced waiter and allows an immediate retry", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });

    const first = manager.load("/a.txt", plainLoader);
    const second = manager.load("/a.txt", plainLoader);
    io.reject("/a.txt", new Error("boom"));

    await expect(first).rejects.toThrow(/Fetch failed/);
    await expect(second).rejects.toThrow(/Fetch failed/);
    expect(manager.size).toBe(0);

    const retry = manager.load("/a.txt", plainLoader);
    io.resolve("/a.txt", "alpha");
    expect(await retry).toBe("alpha");
    expect(io.calls).toEqual(["/a.txt", "/a.txt"]);
  });
});

// --- clear and dispose ------------------------------------------------------

describe("AssetManager clear and dispose", () => {
  it("clears every entry and disposes the disposable ones", async () => {
    const io = immediateFetch({ "/a.txt": "alpha", "/b.txt": "beta" });
    const manager = new AssetManager({ fetch: io.fetch });

    const a = await manager.load("/a.txt", disposableLoader);
    const b = await manager.load("/b.txt", disposableLoader);
    await manager.load("/a.txt", plainLoader); // non-disposable, second group
    expect(manager.size).toBe(3);

    manager.clear();

    expect(a.disposeCount).toBe(1);
    expect(b.disposeCount).toBe(1);
    expect(manager.size).toBe(0);
  });

  it("disposes every asset even when one dispose throws, then rethrows", async () => {
    const io = immediateFetch({ "/a.txt": "alpha", "/b.txt": "beta" });
    const manager = new AssetManager({ fetch: io.fetch });
    const thrower: AssetLoader<Disposable> = {
      name: "thrower",
      load: (res) =>
        res.text().then((text) => ({
          dispose(): void {
            throw new Error(`dispose failed: ${text}`);
          },
        })),
    };

    await manager.load("/a.txt", thrower);
    const survivor = await manager.load("/b.txt", disposableLoader);

    expect(() => {
      manager.clear();
    }).toThrow(/dispose failed: alpha/);
    expect(survivor.disposeCount).toBe(1);
    expect(manager.size).toBe(0);
  });

  it("disposes an in-flight asset when it settles after clear", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });

    const pending = manager.load("/a.txt", disposableLoader);
    manager.clear();
    expect(manager.size).toBe(0);

    io.resolve("/a.txt", "alpha");
    const asset = await pending;

    expect(asset.disposeCount).toBe(1);
    expect(manager.size).toBe(0);
  });

  it("never evicts a newer entry when an older cleared load settles", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });

    const stale = manager.load("/a.txt", disposableLoader);
    manager.clear();
    const fresh = manager.load("/a.txt", disposableLoader);
    expect(io.calls).toEqual(["/a.txt", "/a.txt"]);

    // Settle the *fresh* request (call index 1) first, then the stale one.
    io.resolveAt(1, "fresh");
    const freshAsset = await fresh;
    expect(manager.has("/a.txt", disposableLoader)).toBe(true);

    io.resolveAt(0, "stale");
    const staleAsset = await stale;

    expect(staleAsset.disposeCount).toBe(1);
    expect(freshAsset.disposeCount).toBe(0);
    expect(manager.get("/a.txt", disposableLoader)).toBe(freshAsset);
    expect(manager.size).toBe(1);
  });

  it("refuses loads after dispose but answers queries emptily", async () => {
    const io = immediateFetch({ "/a.txt": "alpha" });
    const manager = new AssetManager({ fetch: io.fetch });
    const asset = await manager.load("/a.txt", disposableLoader);

    manager.dispose();
    manager.dispose(); // idempotent

    expect(asset.disposeCount).toBe(1);
    expect(manager.isDisposed).toBe(true);
    expect(manager.size).toBe(0);
    expect(manager.has("/a.txt", disposableLoader)).toBe(false);
    expect(manager.get("/a.txt", disposableLoader)).toBeUndefined();
    expect(manager.refCount("/a.txt", disposableLoader)).toBe(0);
    expect(manager.release("/a.txt", disposableLoader)).toBe(false);
    manager.clear();

    try {
      void manager.load("/a.txt", disposableLoader);
      expect.unreachable("load after dispose should throw");
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      expect((error as FourError).code).toBe("INVALID_APPLICATION_STATE");
      expect((error as FourError).message).toContain("disposed");
    }
  });
});
