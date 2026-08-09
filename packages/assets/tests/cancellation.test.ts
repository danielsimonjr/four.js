/**
 * Caller-driven cancellation (§76) — the three rules in `asset-manager.ts`'s
 * module comment, each with the case that would break if it did not hold.
 *
 * Everything is hand-rolled: the transport, the timer, and the signal. A real
 * `AbortController` drives the same manager in
 * `tests/integration/asset-abort.test.ts`, where the point is that the platform
 * type needs no adapter; here the point is every branch of the policy.
 */

import { FourError, isFourError, type Disposable } from "@four/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AssetManager,
  type AbortSignalLike,
  type AssetLoader,
  type FetchInit,
  type FetchResponse,
  type TimerLike,
} from "../src/index.js";

// --- fakes ------------------------------------------------------------------

/** A `FetchResponse` over a fixed body. */
function response(body: string): FetchResponse {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve().then(() => JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  };
}

/** One fake cancellation source, standing in for an `AbortController`. */
interface FakeController {
  readonly signal: AbortSignalLike;
  abort(): void;
  /** How many listeners are still subscribed — a leak shows up here. */
  readonly listenerCount: number;
  /** Whether {@link FakeController.abort} was called. */
  readonly aborted: boolean;
}

function fakeController(): FakeController {
  const listeners = new Set<() => void>();
  let aborted = false;
  return {
    get listenerCount(): number {
      return listeners.size;
    },
    get aborted(): boolean {
      return aborted;
    },
    signal: {
      get aborted(): boolean {
        return aborted;
      },
      addEventListener(_type: "abort", listener: () => void): void {
        listeners.add(listener);
      },
      removeEventListener(_type: "abort", listener: () => void): void {
        listeners.delete(listener);
      },
    },
    abort(): void {
      if (aborted) {
        return;
      }
      aborted = true;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

/** The manager's own transport-abort source, so a test can watch it fire. */
interface TransportController {
  readonly signal: object;
  abort(): void;
}

interface AbortSpy {
  /** One handle per load, in load order. */
  readonly handles: TransportController[];
  /** How many of them were aborted. */
  readonly abortCount: number;
  readonly factory: () => TransportController;
}

function abortSpy(): AbortSpy {
  const handles: TransportController[] = [];
  let abortCount = 0;
  const spy: AbortSpy = {
    handles,
    get abortCount(): number {
      return abortCount;
    },
    factory: (): TransportController => {
      const handle: TransportController = {
        signal: { id: handles.length },
        abort(): void {
          abortCount += 1;
        },
      };
      handles.push(handle);
      return handle;
    },
  };
  return spy;
}

interface PendingRequest {
  readonly url: string;
  readonly signal: unknown;
  settled: boolean;
  readonly resolve: (value: FetchResponse) => void;
  readonly reject: (error: unknown) => void;
}

interface DeferredFetch {
  readonly fetch: (
    url: string,
    init?: FetchInit<object>,
  ) => Promise<FetchResponse>;
  readonly requests: PendingRequest[];
  resolve(url: string, body: string): void;
  /** Resolves the request made at call index `index` (see `requests`). */
  resolveAt(index: number, body: string): void;
  reject(url: string, error: unknown): void;
}

/** A transport whose responses the test releases by hand, recording `init`. */
function deferredFetch(): DeferredFetch {
  const requests: PendingRequest[] = [];
  const takeFor = (url: string): PendingRequest => {
    const request = requests.find((r) => r.url === url && !r.settled);
    if (request === undefined) {
      throw new Error(`no pending fetch for ${url}`);
    }
    request.settled = true;
    return request;
  };
  return {
    requests,
    fetch: (url: string, init?: FetchInit<object>) =>
      new Promise<FetchResponse>((resolve, reject) => {
        requests.push({
          url,
          signal: init?.signal,
          settled: false,
          resolve,
          reject,
        });
      }),
    resolve(url: string, body: string): void {
      takeFor(url).resolve(response(body));
    },
    resolveAt(index: number, body: string): void {
      const request = requests[index];
      if (request === undefined || request.settled) {
        throw new Error(`no pending fetch at index ${String(index)}`);
      }
      request.settled = true;
      request.resolve(response(body));
    },
    reject(url: string, error: unknown): void {
      takeFor(url).reject(error);
    },
  };
}

interface FakeTimer extends TimerLike {
  expire(): void;
}

/** A timer the test drives by hand — no wall clock, no fake globals. */
function fakeTimer(): FakeTimer {
  const scheduled = new Map<number, () => void>();
  let nextHandle = 0;
  return {
    setTimeout(callback: () => void): unknown {
      const handle = nextHandle;
      nextHandle += 1;
      scheduled.set(handle, callback);
      return handle;
    },
    clearTimeout(handle: unknown): void {
      scheduled.delete(handle as number);
    },
    expire(): void {
      const due = [...scheduled.values()];
      scheduled.clear();
      for (const callback of due) {
        callback();
      }
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

const disposableLoader: AssetLoader<DisposableAsset> = {
  name: "disposable",
  load: (res) => res.text().then((text) => new DisposableAsset(text)),
};

/** The `FourError` a rejected load carried. */
async function rejectionOf(work: Promise<unknown>): Promise<FourError> {
  try {
    await work;
    expect.unreachable("the load should have rejected");
  } catch (error) {
    expect(isFourError(error)).toBe(true);
    return error as FourError;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- the capability ---------------------------------------------------------

describe("AssetManager transport-abort capability", () => {
  it("reports its absence, and works without it", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });

    expect(manager.canAbortTransport).toBe(false);
    const load = manager.load("/a.txt", plainLoader);
    // No controller means no `init` at all — the pre-cancellation call shape.
    expect(io.requests[0].signal).toBeUndefined();
    io.resolve("/a.txt", "alpha");
    await expect(load).resolves.toBe("alpha");
  });

  it("reports its presence and hands the transport a signal", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });

    expect(manager.canAbortTransport).toBe(true);
    const load = manager.load("/a.txt", plainLoader);
    expect(io.requests[0].signal).toBe(spy.handles[0].signal);
    io.resolve("/a.txt", "alpha");
    await expect(load).resolves.toBe("alpha");
    // A load that completed never aborts its own request.
    expect(spy.abortCount).toBe(0);
  });

  it("mints one handle per load, not one per manager", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });

    const first = manager.load("/a.txt", plainLoader);
    const second = manager.load("/b.txt", plainLoader);
    expect(spy.handles).toHaveLength(2);
    expect(io.requests[0].signal).not.toBe(io.requests[1].signal);

    io.resolve("/a.txt", "alpha");
    io.resolve("/b.txt", "beta");
    await Promise.all([first, second]);
  });

  it("forwards the signal through the global fetch fallback", async () => {
    const seen: (FetchInit<object> | undefined)[] = [];
    vi.stubGlobal("fetch", (url: string, init?: FetchInit<object>) => {
      seen.push(init);
      return Promise.resolve(response(`body of ${url}`));
    });
    const spy = abortSpy();
    const manager = new AssetManager({ abortController: spy.factory });

    await expect(manager.load("/a.txt", plainLoader)).resolves.toBe(
      "body of /a.txt",
    );
    expect(seen[0]?.signal).toBe(spy.handles[0].signal);
  });
});

// --- rule 1: an aborted load never holds a reference ------------------------

describe("AssetManager cancellation — an aborted load holds no reference", () => {
  it("refuses a signal that already fired, without touching the cache", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const controller = fakeController();
    controller.abort();

    const error = await rejectionOf(
      manager.load("/a.txt", plainLoader, { signal: controller.signal }),
    );

    expect(error.code).toBe("ASSET_LOAD_FAILED");
    expect(error.context).toEqual({
      url: "/a.txt",
      loader: "plain",
      reason: "aborted",
    });
    expect(io.requests).toHaveLength(0);
    expect(manager.size).toBe(0);
    expect(manager.refCount("/a.txt", plainLoader)).toBe(0);
  });

  it("refuses a pre-aborted load even when the asset is already cached", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const load = manager.load("/a.txt", plainLoader);
    io.resolve("/a.txt", "alpha");
    await load;

    const controller = fakeController();
    controller.abort();
    const error = await rejectionOf(
      manager.load("/a.txt", plainLoader, { signal: controller.signal }),
    );

    expect(error.context?.reason).toBe("aborted");
    // The caller that did not ask for the asset did not take a reference to it.
    expect(manager.refCount("/a.txt", plainLoader)).toBe(1);
  });

  it("gives the reference back when the signal fires mid-flight", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const controller = fakeController();

    const load = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    expect(manager.refCount("/a.txt", plainLoader)).toBe(1);

    controller.abort();
    const error = await rejectionOf(load);

    expect(error.context?.reason).toBe("aborted");
    expect(manager.size).toBe(0);
    expect(manager.refCount("/a.txt", plainLoader)).toBe(0);
    // …and the key is retryable at once: a fresh load starts a *second*
    // request, which is what the abandoned first one leaves room for.
    const retry = manager.load("/a.txt", plainLoader);
    expect(io.requests).toHaveLength(2);
    io.resolveAt(1, "alpha");
    await expect(retry).resolves.toBe("alpha");
  });

  it("aborts the request when the manager can", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });
    const controller = fakeController();

    const load = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    controller.abort();
    await rejectionOf(load);

    expect(spy.abortCount).toBe(1);
  });

  it("discards and disposes a response that beats the abort", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const controller = fakeController();

    const load = manager.load("/a.bin", disposableLoader, {
      signal: controller.signal,
    });
    controller.abort();
    await rejectionOf(load);

    // No transport abort was available, so the request still lands.
    io.resolve("/a.bin", "alpha");
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.size).toBe(0);
    expect(manager.has("/a.bin", disposableLoader)).toBe(false);
  });

  it("unsubscribes from the signal on success, so nothing outlives the load", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const controller = fakeController();

    const load = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    expect(controller.listenerCount).toBe(1);

    io.resolve("/a.txt", "alpha");
    await expect(load).resolves.toBe("alpha");
    expect(controller.listenerCount).toBe(0);
  });

  it("unsubscribes on failure and reports the failure, not the abort", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const controller = fakeController();

    const load = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    io.reject("/a.txt", new Error("socket closed"));
    const error = await rejectionOf(load);

    expect(error.context?.reason).toBeUndefined();
    expect(error.message).toMatch(/Fetch failed/);
    expect(controller.listenerCount).toBe(0);
    expect(manager.size).toBe(0);
  });

  it("does nothing when the signal fires after the load was awaited", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });
    const controller = fakeController();

    const load = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    io.resolve("/a.txt", "alpha");
    await expect(load).resolves.toBe("alpha");

    controller.abort();

    expect(spy.abortCount).toBe(0);
    expect(manager.refCount("/a.txt", plainLoader)).toBe(1);
    expect(manager.get("/a.txt", plainLoader)).toBe("alpha");
  });

  it("resolves an abort that races a settled entry as an abort", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const first = manager.load("/a.bin", disposableLoader);
    io.resolve("/a.bin", "alpha");
    const asset = await first;

    // The entry is settled, so this second load resolves from the cache — but
    // its `then` is a microtask and `abort()` is synchronous, so the signal
    // wins. The caller asked to cancel before it observed a value, and gets a
    // rejection plus its reference back.
    const controller = fakeController();
    const second = manager.load("/a.bin", disposableLoader, {
      signal: controller.signal,
    });
    expect(manager.refCount("/a.bin", disposableLoader)).toBe(2);
    controller.abort();
    await rejectionOf(second);

    expect(manager.refCount("/a.bin", disposableLoader)).toBe(1);
    expect(asset.disposeCount).toBe(0);
  });

  it("disposes the asset when the aborting waiter was the last one", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const first = manager.load("/a.bin", disposableLoader);
    io.resolve("/a.bin", "alpha");
    const asset = await first;

    // A signalled load joins the settled entry, then the original holder
    // releases: the aborting waiter is now the last reference, so giving it
    // back evicts and disposes.
    const controller = fakeController();
    const second = manager.load("/a.bin", disposableLoader, {
      signal: controller.signal,
    });
    expect(manager.release("/a.bin", disposableLoader)).toBe(false);
    controller.abort();
    await rejectionOf(second);

    expect(manager.size).toBe(0);
    expect(asset.disposeCount).toBe(1);
  });
});

// --- rule 2: one waiter's abort is not the others' --------------------------

describe("AssetManager cancellation — a coalesced load survives one waiter", () => {
  it("keeps fetching for the waiter that did not abort", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });
    const controller = fakeController();

    const cancelled = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    const kept = manager.load("/a.txt", plainLoader);
    expect(io.requests).toHaveLength(1);
    expect(manager.refCount("/a.txt", plainLoader)).toBe(2);

    controller.abort();
    await rejectionOf(cancelled);

    expect(spy.abortCount).toBe(0);
    expect(manager.refCount("/a.txt", plainLoader)).toBe(1);

    io.resolve("/a.txt", "alpha");
    await expect(kept).resolves.toBe("alpha");
    expect(manager.has("/a.txt", plainLoader)).toBe(true);
  });

  it("aborts the request only when the last waiter goes", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });
    const first = fakeController();
    const second = fakeController();

    const a = manager.load("/a.txt", plainLoader, { signal: first.signal });
    const b = manager.load("/a.txt", plainLoader, { signal: second.signal });

    first.abort();
    await rejectionOf(a);
    expect(spy.abortCount).toBe(0);
    expect(manager.size).toBe(1);

    second.abort();
    await rejectionOf(b);
    expect(spy.abortCount).toBe(1);
    expect(manager.size).toBe(0);
  });

  it("lets two waiters share one signal and cancel together", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });
    const controller = fakeController();

    const a = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    const b = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    expect(controller.listenerCount).toBe(2);

    controller.abort();
    await rejectionOf(a);
    await rejectionOf(b);

    expect(spy.abortCount).toBe(1);
    expect(manager.size).toBe(0);
    expect(controller.listenerCount).toBe(0);
  });

  it("strands no rejection when the abandoned request then fails", async () => {
    const io = deferredFetch();
    const manager = new AssetManager({ fetch: io.fetch });
    const controller = fakeController();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const load = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    controller.abort();
    await rejectionOf(load);

    // Nothing is waiting on the coalesced promise any more; its own failure
    // must still be consumed.
    io.reject("/a.txt", new Error("socket closed"));
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });
});

// --- rule 3: release is not abort -------------------------------------------

describe("AssetManager cancellation — release is not abort", () => {
  it("lets a released pending load settle instead of aborting it", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });

    const load = manager.load("/a.bin", disposableLoader);
    expect(manager.release("/a.bin", disposableLoader)).toBe(true);

    expect(spy.abortCount).toBe(0);
    io.resolve("/a.bin", "alpha");
    const asset = await load;

    // Settled, handed to its caller, then disposed because nothing holds it.
    expect(asset.body).toBe("alpha");
    expect(asset.disposeCount).toBe(1);
    expect(manager.size).toBe(0);
  });
});

// --- the §96 deadline uses the same handle ----------------------------------

describe("AssetManager deadline (§96) and the transport", () => {
  it("aborts the request the deadline gave up on", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const timer = fakeTimer();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
      timer,
      timeoutSeconds: 2,
    });

    const load = manager.load("/a.txt", plainLoader);
    timer.expire();
    const error = await rejectionOf(load);

    expect(error.context?.limitName).toBe("timeoutSeconds");
    expect(spy.abortCount).toBe(1);
    expect(manager.size).toBe(0);
  });

  it("still expires cleanly with no transport-abort capability", async () => {
    const io = deferredFetch();
    const timer = fakeTimer();
    const manager = new AssetManager({
      fetch: io.fetch,
      timer,
      timeoutSeconds: 2,
    });

    const load = manager.load("/a.txt", plainLoader);
    timer.expire();
    const error = await rejectionOf(load);

    expect(error.code).toBe("ASSET_LOAD_FAILED");
    expect(manager.canAbortTransport).toBe(false);
    expect(manager.size).toBe(0);
  });
});

// --- interaction with the rest of the lifecycle -----------------------------

describe("AssetManager cancellation — lifecycle interactions", () => {
  it("still refuses a signalled load on a disposed manager", () => {
    const manager = new AssetManager({ fetch: deferredFetch().fetch });
    manager.dispose();
    const controller = fakeController();

    expect(() =>
      manager.load("/a.txt", plainLoader, { signal: controller.signal }),
    ).toThrow(FourError);
    expect(controller.listenerCount).toBe(0);
  });

  it("hands back one reference even from a signal that fires twice", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });
    // A structural signal is whatever the caller passes: this one ignores
    // `removeEventListener` and notifies twice. One abort must still cost
    // exactly one reference, or the *other* waiter's count would go negative.
    const listeners: (() => void)[] = [];
    const rogue: AbortSignalLike = {
      aborted: false,
      addEventListener(_type: "abort", listener: () => void): void {
        listeners.push(listener);
      },
      removeEventListener(): void {
        // deliberately nothing
      },
    };

    const cancelled = manager.load("/a.txt", plainLoader, { signal: rogue });
    const kept = manager.load("/a.txt", plainLoader);
    for (const listener of [...listeners]) {
      listener();
      listener();
    }
    await rejectionOf(cancelled);

    expect(manager.refCount("/a.txt", plainLoader)).toBe(1);
    expect(spy.abortCount).toBe(0);
    io.resolve("/a.txt", "alpha");
    await expect(kept).resolves.toBe("alpha");
  });

  it("aborts a load the cache has already dropped", async () => {
    const io = deferredFetch();
    const spy = abortSpy();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: spy.factory,
    });
    const controller = fakeController();

    const load = manager.load("/a.txt", plainLoader, {
      signal: controller.signal,
    });
    manager.clear();
    expect(manager.size).toBe(0);

    controller.abort();
    await rejectionOf(load);

    expect(spy.abortCount).toBe(1);
  });
});
