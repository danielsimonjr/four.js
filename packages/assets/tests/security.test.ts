import { FourError, isFourError } from "@four/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AssetManager,
  DEFAULT_MAXIMUM_BYTES,
  DEFAULT_TIMEOUT_SECONDS,
  binaryLoader,
  jsonLoader,
  textLoader,
  type AssetLoader,
  type FetchResponse,
  type TimerLike,
} from "../src/index.js";

// --- fakes ------------------------------------------------------------------

/**
 * A `FetchResponse` over a fixed body, optionally carrying headers.
 *
 * `headers` is the §96 seam: a real `Response.headers` satisfies
 * `ResponseHeadersLike` structurally, and so does this.
 */
function response(
  body: string,
  headers?: Record<string, string>,
): FetchResponse {
  const base = {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve().then(() => JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  };
  if (headers === undefined) {
    return base;
  }
  return {
    ...base,
    headers: { get: (name: string) => headers[name] ?? null },
  };
}

/** A fetch that answers every URL with one response. */
function always(value: FetchResponse): (url: string) => Promise<FetchResponse> {
  return () => Promise.resolve(value);
}

interface FakeTimer extends TimerLike {
  /** Number of scheduled-and-not-yet-cleared callbacks. */
  readonly pending: number;
  /** The delay of the most recent schedule, in milliseconds. */
  readonly lastDelayMilliseconds: number;
  /** Fires every pending callback, oldest first. */
  expire(): void;
}

/** A {@link TimerLike} the test drives by hand — no wall clock, no fake globals. */
function fakeTimer(): FakeTimer {
  const scheduled = new Map<number, () => void>();
  let nextHandle = 0;
  let lastDelayMilliseconds = 0;
  return {
    get pending(): number {
      return scheduled.size;
    },
    get lastDelayMilliseconds(): number {
      return lastDelayMilliseconds;
    },
    setTimeout(callback: () => void, delayMilliseconds: number): unknown {
      lastDelayMilliseconds = delayMilliseconds;
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

/** The `FourError` a rejected promise carried, with its code asserted. */
async function refusalOf(work: Promise<unknown>): Promise<FourError> {
  try {
    await work;
    expect.unreachable("the load should have been refused");
  } catch (error) {
    expect(isFourError(error)).toBe(true);
    return error as FourError;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- §96 input-size limits --------------------------------------------------

describe("AssetManager input-size limits (§96)", () => {
  it("defaults to a finite documented byte budget", () => {
    const manager = new AssetManager({ fetch: always(response("{}")) });
    expect(manager.maximumBytes).toBe(DEFAULT_MAXIMUM_BYTES);
    expect(DEFAULT_MAXIMUM_BYTES).toBe(67_108_864);
    expect(Number.isFinite(DEFAULT_MAXIMUM_BYTES)).toBe(true);
  });

  it("refuses a declared content-length over the limit before reading a byte", async () => {
    let bodyReads = 0;
    const oversize: FetchResponse = {
      ok: true,
      status: 200,
      headers: { get: () => "1048576" },
      text: () => {
        bodyReads += 1;
        return Promise.resolve("");
      },
      json: () => {
        bodyReads += 1;
        return Promise.resolve(null);
      },
      arrayBuffer: () => {
        bodyReads += 1;
        return Promise.resolve(new ArrayBuffer(0));
      },
    };
    const manager = new AssetManager({
      fetch: always(oversize),
      maximumBytes: 1024,
    });
    const failure = await refusalOf(manager.load("/big.bin", binaryLoader));
    expect(failure.code).toBe("ASSET_LOAD_FAILED");
    expect(failure.message).toContain("§96");
    expect(failure.context).toEqual({
      url: "/big.bin",
      loader: "binary",
      status: 200,
      limitName: "maximumBytes",
      limit: 1024,
      observed: 1_048_576,
    });
    expect(bodyReads).toBe(0);
    // Refusals are not cached, exactly like every other failure.
    expect(manager.size).toBe(0);
  });

  it("accepts a declared content-length at the limit", async () => {
    const manager = new AssetManager({
      fetch: always(response("ok", { "content-length": "2" })),
      maximumBytes: 2,
    });
    await expect(manager.load("/small.txt", textLoader)).resolves.toBe("ok");
  });

  it("ignores an absent, null, non-numeric, or negative content-length", async () => {
    const cases: (Record<string, string> | undefined)[] = [
      undefined, // no headers at all — a non-HTTP transport
      {}, // headers present, `get` answers null
      { "content-length": "not-a-number" },
      { "content-length": "-1" },
    ];
    for (const headers of cases) {
      const manager = new AssetManager({
        fetch: always(response("hello", headers)),
        maximumBytes: 1024,
      });
      await expect(manager.load("/a.txt", textLoader)).resolves.toBe("hello");
    }
  });

  it("bounds the body the loader actually reads, however the server declared it", async () => {
    // The header lies: it claims 2 bytes and sends 64.
    const manager = new AssetManager({
      fetch: always(response("x".repeat(64), { "content-length": "2" })),
      maximumBytes: 8,
    });
    const failure = await refusalOf(manager.load("/liar.bin", binaryLoader));
    expect(failure.code).toBe("ASSET_LOAD_FAILED");
    expect(failure.context).toMatchObject({
      limitName: "maximumBytes",
      limit: 8,
      observed: 64,
    });
  });

  it("bounds text() in UTF-16 code units and json() through it", async () => {
    const body = JSON.stringify({ padding: "y".repeat(64) });
    const textManager = new AssetManager({
      fetch: always(response(body)),
      maximumBytes: 16,
    });
    const textFailure = await refusalOf(textManager.load("/a.txt", textLoader));
    expect(textFailure.context).toMatchObject({
      limitName: "maximumBytes",
      observed: body.length,
    });

    const jsonManager = new AssetManager({
      fetch: always(response(body)),
      maximumBytes: 16,
    });
    const jsonFailure = await refusalOf(
      jsonManager.load("/a.json", jsonLoader),
    );
    expect(jsonFailure.context).toMatchObject({ limitName: "maximumBytes" });
  });

  it("decodes JSON through the bounded text path when the body fits", async () => {
    const manager = new AssetManager({
      fetch: always(response('{"a":1}')),
      maximumBytes: 1024,
    });
    await expect(manager.load("/a.json", jsonLoader)).resolves.toEqual({
      a: 1,
    });
  });

  it("forwards ok, status, and headers to the loader through the bounded view", async () => {
    const seen: FetchResponse[] = [];
    const probe: AssetLoader<string> = {
      name: "probe",
      load(bounded: FetchResponse): Promise<string> {
        seen.push(bounded);
        return bounded.text();
      },
    };
    const manager = new AssetManager({
      fetch: always(response("body", { "content-type": "text/plain" })),
      maximumBytes: 1024,
    });
    await expect(manager.load("/a.txt", probe)).resolves.toBe("body");
    const bounded = seen[0];
    expect(bounded?.ok).toBe(true);
    expect(bounded?.status).toBe(200);
    expect(bounded?.headers?.get("content-type")).toBe("text/plain");
    await expect(bounded?.arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("skips the wrapper entirely when the limit is disabled", async () => {
    const seen: FetchResponse[] = [];
    const raw = response("anything");
    const probe: AssetLoader<string> = {
      name: "probe",
      load(bounded: FetchResponse): Promise<string> {
        seen.push(bounded);
        return bounded.text();
      },
    };
    const manager = new AssetManager({
      fetch: always(raw),
      maximumBytes: Number.POSITIVE_INFINITY,
    });
    await expect(manager.load("/a.txt", probe)).resolves.toBe("anything");
    // The very object the fetch returned, not a view over it.
    expect(seen[0]).toBe(raw);
  });

  it("refuses a maximumBytes that is not greater than zero", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => new AssetManager({ maximumBytes: bad })).toThrow(FourError);
      expect(() => new AssetManager({ maximumBytes: bad })).toThrow(
        /maximumBytes must be greater than zero/,
      );
    }
  });
});

// --- §96 timeouts -----------------------------------------------------------

describe("AssetManager load deadline (§96)", () => {
  it("defaults to a finite budget in seconds, not milliseconds", () => {
    const manager = new AssetManager({ fetch: always(response("{}")) });
    expect(manager.timeoutSeconds).toBe(DEFAULT_TIMEOUT_SECONDS);
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(30);
    expect(Number.isFinite(DEFAULT_TIMEOUT_SECONDS)).toBe(true);
  });

  it("converts seconds to the platform's milliseconds at the timer seam", async () => {
    const timer = fakeTimer();
    const manager = new AssetManager({
      fetch: always(response("ok")),
      timer,
      timeoutSeconds: 2.5,
    });
    await expect(manager.load("/a.txt", textLoader)).resolves.toBe("ok");
    expect(timer.lastDelayMilliseconds).toBe(2500);
  });

  it("rejects and evicts a load that outlives its deadline", async () => {
    const timer = fakeTimer();
    const manager = new AssetManager({
      // A fetch that never settles: the deadline is the only way out.
      fetch: () => new Promise<FetchResponse>(() => undefined),
      timer,
      timeoutSeconds: 5,
    });
    const pending = manager.load("/stalled.txt", textLoader);
    expect(manager.size).toBe(1);
    expect(timer.pending).toBe(1);
    timer.expire();
    const failure = await refusalOf(pending);
    expect(failure.code).toBe("ASSET_LOAD_FAILED");
    expect(failure.message).toContain("§96");
    expect(failure.context).toEqual({
      url: "/stalled.txt",
      loader: "text",
      limitName: "timeoutSeconds",
      limit: 5,
    });
    // Never cached, so the same call retries.
    expect(manager.size).toBe(0);
  });

  it("clears the timer when the load settles either way", async () => {
    const timer = fakeTimer();
    const good = new AssetManager({
      fetch: always(response("ok")),
      timer,
      timeoutSeconds: 5,
    });
    await expect(good.load("/a.txt", textLoader)).resolves.toBe("ok");
    expect(timer.pending).toBe(0);

    const bad = new AssetManager({
      fetch: () => Promise.reject(new Error("offline")),
      timer,
      timeoutSeconds: 5,
    });
    const failure = await refusalOf(bad.load("/b.txt", textLoader));
    expect(failure.code).toBe("ASSET_LOAD_FAILED");
    expect(timer.pending).toBe(0);
  });

  it("schedules nothing at all when the deadline is disabled", async () => {
    const timer = fakeTimer();
    const manager = new AssetManager({
      fetch: always(response("ok")),
      timer,
      timeoutSeconds: Number.POSITIVE_INFINITY,
    });
    await expect(manager.load("/a.txt", textLoader)).resolves.toBe("ok");
    expect(timer.pending).toBe(0);
    expect(timer.lastDelayMilliseconds).toBe(0);
  });

  it("refuses a timeoutSeconds that is not greater than zero", () => {
    expect(() => new AssetManager({ timeoutSeconds: 0 })).toThrow(
      /timeoutSeconds must be greater than zero/,
    );
  });

  it("uses the host's own setTimeout when no timer is injected", async () => {
    // No `timer` option: `resolveGlobalTimer` binds globalThis, and a load that
    // settles normally must clear the handle rather than leak it.
    const manager = new AssetManager({
      fetch: always(response("ok")),
      timeoutSeconds: 60,
    });
    await expect(manager.load("/a.txt", textLoader)).resolves.toBe("ok");
  });

  it("diagnoses a host with no setTimeout at the first load that needs one", () => {
    vi.stubGlobal("setTimeout", undefined);
    const manager = new AssetManager({ fetch: always(response("ok")) });
    vi.unstubAllGlobals();
    expect(() => manager.load("/a.txt", textLoader)).toThrow(
      /this runtime has no setTimeout/,
    );
    try {
      void manager.load("/a.txt", textLoader);
      expect.unreachable("should have refused");
    } catch (error) {
      const failure = error as FourError;
      expect(failure.code).toBe("INVALID_APPLICATION_STATE");
      expect(failure.context).toMatchObject({ limitName: "timeoutSeconds" });
    }
  });

  it("treats a host with no clearTimeout the same way", () => {
    vi.stubGlobal("clearTimeout", undefined);
    const manager = new AssetManager({ fetch: always(response("ok")) });
    vi.unstubAllGlobals();
    expect(() => manager.load("/a.txt", textLoader)).toThrow(
      /this runtime has no setTimeout/,
    );
  });

  it("still loads without a timer when the deadline is disabled", async () => {
    vi.stubGlobal("setTimeout", undefined);
    const manager = new AssetManager({
      fetch: always(response("ok")),
      timeoutSeconds: Number.POSITIVE_INFINITY,
    });
    vi.unstubAllGlobals();
    await expect(manager.load("/a.txt", textLoader)).resolves.toBe("ok");
  });
});
