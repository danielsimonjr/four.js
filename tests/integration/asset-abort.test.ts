/**
 * §76 cancellation against the platform's own types (A-18, 2026-08-09).
 *
 * The unit suite in `packages/assets/tests/cancellation.test.ts` drives the
 * policy with hand-rolled fakes. This one exists for the property those fakes
 * cannot prove: a real `AbortController`, a real `AbortSignal`, and a transport
 * with the platform `fetch`'s own signature satisfy `@four/assets`'s seams with
 * **no adapter** — the property the generic `FetchLike<TSignal>` was built to
 * keep (see the module comment's variance measurement in `asset-manager.ts`).
 */

import {
  AssetManager,
  type AssetLoader,
  type FetchLike,
  type FetchResponse,
} from "@four/assets";
import { isFourError, type FourError } from "@four/core";
import { describe, expect, it } from "vitest";

const textLoader: AssetLoader<string> = {
  name: "text",
  load: (response) => response.text(),
};

/** A `Response`-shaped body over a string. */
function response(body: string): FetchResponse {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  };
}

interface Transport {
  /** Written with the platform `fetch`'s parameter shape, not the engine's. */
  readonly fetch: (
    url: string,
    init?: { signal?: AbortSignal },
  ) => Promise<FetchResponse>;
  /** Resolves the pending request for `url`. */
  deliver(url: string, body: string): void;
  /** Whether the request for `url` was cancelled at the transport. */
  wasAborted(url: string): boolean;
}

/**
 * A transport that behaves the way `fetch` does with a signal: it rejects with
 * the platform's own `AbortError` the moment the signal fires, and never
 * delivers a body afterwards.
 */
function transport(): Transport {
  const pending = new Map<
    string,
    { resolve: (value: FetchResponse) => void; aborted: boolean }
  >();
  return {
    fetch: (url: string, init?: { signal?: AbortSignal }) =>
      new Promise<FetchResponse>((resolve, reject) => {
        const record = { resolve, aborted: false };
        pending.set(url, record);
        init?.signal?.addEventListener("abort", () => {
          record.aborted = true;
          reject(new Error("The operation was aborted."));
        });
      }),
    deliver(url: string, body: string): void {
      pending.get(url)?.resolve(response(body));
    },
    wasAborted(url: string): boolean {
      return pending.get(url)?.aborted ?? false;
    },
  };
}

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

describe("§76 cancellation with the platform's AbortController", () => {
  it("accepts the platform fetch as a FetchLike<AbortSignal>", () => {
    // The whole point of the generic seam: this assignment is the compile-time
    // assertion, and `canAbortTransport` is its runtime witness.
    const platform: FetchLike<AbortSignal> = fetch;
    const manager = new AssetManager({
      fetch: platform,
      abortController: () => new AbortController(),
    });

    expect(manager.canAbortTransport).toBe(true);
    manager.dispose();
  });

  it("stays assignable to a plain AssetManager (Application's option type)", () => {
    const capable = new AssetManager({
      fetch: transport().fetch,
      abortController: () => new AbortController(),
    });
    // `ApplicationOptions.assets` is declared `AssetManager`; a manager that
    // gained the capability must still fit it.
    const asOption: AssetManager = capable;

    expect(asOption.canAbortTransport).toBe(true);
  });

  it("cancels the request when the last waiter aborts", async () => {
    const io = transport();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: () => new AbortController(),
    });
    const controller = new AbortController();

    const load = manager.load("/level.json", textLoader, {
      signal: controller.signal,
    });
    expect(io.wasAborted("/level.json")).toBe(false);

    controller.abort();
    const error = await rejectionOf(load);

    expect(error.code).toBe("ASSET_LOAD_FAILED");
    expect(error.context?.reason).toBe("aborted");
    expect(io.wasAborted("/level.json")).toBe(true);
    expect(manager.size).toBe(0);
  });

  it("keeps the request alive for a waiter that did not abort", async () => {
    const io = transport();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: () => new AbortController(),
    });
    const controller = new AbortController();

    const cancelled = manager.load("/level.json", textLoader, {
      signal: controller.signal,
    });
    const kept = manager.load("/level.json", textLoader);

    controller.abort();
    await rejectionOf(cancelled);
    expect(io.wasAborted("/level.json")).toBe(false);

    io.deliver("/level.json", '{"ok":true}');
    await expect(kept).resolves.toBe('{"ok":true}');
    expect(manager.refCount("/level.json", textLoader)).toBe(1);

    manager.dispose();
  });

  it("cancels the request the §96 deadline gave up on", async () => {
    const io = transport();
    const manager = new AssetManager({
      fetch: io.fetch,
      abortController: () => new AbortController(),
      timeoutSeconds: 0.01,
    });

    const error = await rejectionOf(manager.load("/slow.json", textLoader));

    expect(error.context?.limitName).toBe("timeoutSeconds");
    expect(io.wasAborted("/slow.json")).toBe(true);
    expect(manager.size).toBe(0);
  });
});
