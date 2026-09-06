/**
 * A-18 remainder (§76): progress, streaming, dependency graphs, worker
 * decoding, and hot reload. Each seam is driven with an injected fake —
 * no real Worker, no websocket, no platform fetch.
 */

import { FourError, isFourError } from "@four/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AssetManager,
  binaryLoader,
  textLoader,
  type AssetLoader,
  type AssetProgressEvent,
  type FetchResponse,
  type WorkerLike,
} from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function response(
  body: string,
  extras: Partial<FetchResponse> = {},
): FetchResponse {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve().then(() => JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
    ...extras,
  };
}

const plainLoader: AssetLoader<string> = {
  name: "plain",
  load: (res) => res.text(),
};

function chunkReader(chunks: readonly Uint8Array[]): FetchResponse["body"] {
  let index = 0;
  return {
    getReader() {
      return {
        read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (index >= chunks.length) {
            return Promise.resolve({ done: true });
          }
          const value = chunks[index];
          index += 1;
          return Promise.resolve({ done: false, value });
        },
      };
    },
  };
}

async function collect(
  iterable: AsyncIterable<Uint8Array>,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const chunk of iterable) {
    out.push(chunk);
  }
  return out;
}

async function rejectionOf(work: Promise<unknown>): Promise<FourError> {
  try {
    await work;
    expect.unreachable("expected a rejection");
  } catch (error) {
    expect(isFourError(error)).toBe(true);
    return error as FourError;
  }
}

// --- progress ---------------------------------------------------------------

describe("AssetManager progress reporting", () => {
  it("reports total from Content-Length via headers.get", async () => {
    const events: AssetProgressEvent[] = [];
    const manager = new AssetManager({
      fetch: () =>
        Promise.resolve(
          response("hello", {
            headers: {
              get: (name) => (name === "content-length" ? "5" : null),
            },
          }),
        ),
    });

    await expect(
      manager.load("/a.txt", plainLoader, {
        onProgress: (event) => {
          events.push(event);
        },
      }),
    ).resolves.toBe("hello");

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toEqual({
      loaded: 5,
      total: 5,
      url: "/a.txt",
    });
    manager.dispose();
  });

  it("uses FetchResponse.contentLength when headers are absent", async () => {
    const events: AssetProgressEvent[] = [];
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("ab", { contentLength: 2 })),
    });

    await manager.load("/b.txt", plainLoader, {
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events.some((event) => event.total === 2)).toBe(true);
    expect(events[events.length - 1]?.loaded).toBe(2);
    manager.dispose();
  });

  it("reports total null when the transport declares no size", async () => {
    const events: AssetProgressEvent[] = [];
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("xyz")),
    });

    await manager.load("/c.txt", plainLoader, {
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events.every((event) => event.total === null)).toBe(true);
    expect(events[events.length - 1]?.loaded).toBe(3);
    manager.dispose();
  });

  it("emits incremental events when body.getReader exists", async () => {
    const events: AssetProgressEvent[] = [];
    const chunks = [new Uint8Array([65, 66]), new Uint8Array([67])];
    const manager = new AssetManager({
      fetch: () =>
        Promise.resolve(
          response("ABC", {
            headers: {
              get: (name) => (name === "content-length" ? "3" : null),
            },
            body: chunkReader(chunks),
            arrayBuffer: () =>
              Promise.reject(
                new Error("arrayBuffer should not be used when streaming"),
              ),
          }),
        ),
    });

    await expect(
      manager.load("/s.txt", plainLoader, {
        onProgress: (event) => {
          events.push({ ...event });
        },
      }),
    ).resolves.toBe("ABC");

    expect(events.map((event) => event.loaded)).toEqual([0, 2, 3]);
    expect(events.every((event) => event.total === 3)).toBe(true);
    manager.dispose();
  });

  it("gives each coalesced waiter its own callback", async () => {
    const first: AssetProgressEvent[] = [];
    const second: AssetProgressEvent[] = [];
    let resolveFetch!: (value: FetchResponse) => void;
    const manager = new AssetManager({
      fetch: () =>
        new Promise<FetchResponse>((resolve) => {
          resolveFetch = resolve;
        }),
    });

    const a = manager.load("/d.txt", plainLoader, {
      onProgress: (event) => {
        first.push(event);
      },
    });
    const b = manager.load("/d.txt", plainLoader, {
      onProgress: (event) => {
        second.push(event);
      },
    });
    resolveFetch(response("hi", { contentLength: 2 }));
    await expect(a).resolves.toBe("hi");
    await expect(b).resolves.toBe("hi");

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first[first.length - 1]?.url).toBe("/d.txt");
    expect(second[second.length - 1]?.url).toBe("/d.txt");
    manager.dispose();
  });

  it("isolates a throwing onProgress from the load", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("ok")),
    });

    await expect(
      manager.load("/e.txt", plainLoader, {
        onProgress: () => {
          throw new Error("listener exploded");
        },
      }),
    ).resolves.toBe("ok");
    manager.dispose();
  });
});

// --- streaming --------------------------------------------------------------

describe("AssetManager.stream", () => {
  it("yields chunks from body.getReader", async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
    const manager = new AssetManager({
      fetch: () =>
        Promise.resolve(
          response("", {
            body: chunkReader(chunks),
            arrayBuffer: () => Promise.reject(new Error("should stream")),
          }),
        ),
    });

    const got = await collect(manager.stream("/bin"));
    expect(got).toEqual(chunks);
    manager.dispose();
  });

  it("yields the whole buffer once when there is no reader", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("xy")),
    });

    const got = await collect(manager.stream("/xy"));
    expect(got).toHaveLength(1);
    const first = got[0] ?? new Uint8Array();
    expect([...first]).toEqual([...new TextEncoder().encode("xy")]);
    manager.dispose();
  });

  it("refuses a declared oversize body before reading", async () => {
    let reads = 0;
    const manager = new AssetManager({
      maximumBytes: 4,
      fetch: () =>
        Promise.resolve(
          response("nope", {
            headers: { get: () => "64" },
            arrayBuffer: () => {
              reads += 1;
              return Promise.resolve(new ArrayBuffer(64));
            },
          }),
        ),
    });

    const error = await rejectionOf(collect(manager.stream("/big")));
    expect(error.context?.limitName).toBe("maximumBytes");
    expect(error.context?.observed).toBe(64);
    expect(reads).toBe(0);
    manager.dispose();
  });

  it("rejects an already-aborted signal without fetching", async () => {
    let fetches = 0;
    const manager = new AssetManager({
      fetch: () => {
        fetches += 1;
        return Promise.resolve(response("x"));
      },
    });
    const listeners = new Set<() => void>();
    const signal = {
      aborted: true,
      addEventListener: (_type: "abort", listener: () => void): void => {
        listeners.add(listener);
      },
      removeEventListener: (_type: "abort", listener: () => void): void => {
        listeners.delete(listener);
      },
    };

    const error = await rejectionOf(collect(manager.stream("/x", { signal })));
    expect(error.context?.reason).toBe("aborted");
    expect(error.context?.loader).toBe("stream");
    expect(fetches).toBe(0);
    manager.dispose();
  });

  it("throws INVALID_APPLICATION_STATE after dispose", () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("x")),
    });
    manager.dispose();
    expect(() => manager.stream("/x")).toThrow(/disposed/);
  });

  it("throws when the runtime has no fetch", () => {
    vi.stubGlobal("fetch", undefined);
    const manager = new AssetManager();
    expect(() => manager.stream("/x")).toThrow(/no fetch implementation/);
    manager.dispose();
  });

  it("diagnoses a host with no setTimeout at the first stream that needs one", () => {
    vi.stubGlobal("setTimeout", undefined);
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("ok")),
    });
    vi.unstubAllGlobals();
    expect(() => manager.stream("/x")).toThrow(
      /this runtime has no setTimeout/,
    );
    manager.dispose();
  });

  it("refuses a streamed body that exceeds maximumBytes after reading", async () => {
    const manager = new AssetManager({
      maximumBytes: 2,
      fetch: () =>
        Promise.resolve(
          response("abcd", {
            body: chunkReader([new Uint8Array([1, 2]), new Uint8Array([3])]),
          }),
        ),
    });
    const error = await rejectionOf(collect(manager.stream("/over")));
    expect(error.context?.limitName).toBe("maximumBytes");
    expect(error.context?.observed).toBe(3);
    manager.dispose();
  });

  it("wraps a transport failure and a non-ok status", async () => {
    const offline = new AssetManager({
      fetch: () => Promise.reject(new Error("offline")),
    });
    const offlineError = await rejectionOf(collect(offline.stream("/x")));
    expect(offlineError.message).toContain("Fetch failed");
    expect(offlineError.cause).toBeInstanceOf(Error);
    offline.dispose();

    const missing = new AssetManager({
      fetch: () => Promise.resolve(response("", { ok: false, status: 404 })),
    });
    const missingError = await rejectionOf(collect(missing.stream("/x")));
    expect(missingError.message).toContain("HTTP 404");
    missing.dispose();
  });

  it("cancels the transport when a streamed fetch exceeds timeoutSeconds", async () => {
    let aborted = 0;
    let expire: (() => void) | undefined;
    const manager = new AssetManager({
      fetch: () => new Promise<FetchResponse>(() => undefined),
      timeoutSeconds: 1,
      timer: {
        setTimeout(callback: () => void): unknown {
          expire = callback;
          return 1;
        },
        clearTimeout(): void {
          expire = undefined;
        },
      },
      abortController: () => ({
        signal: {},
        abort(): void {
          aborted += 1;
        },
      }),
    });
    const work = collect(manager.stream("/slow"));
    expire?.();
    const error = await rejectionOf(work);
    expect(error.context?.limitName).toBe("timeoutSeconds");
    expect(aborted).toBe(1);
    manager.dispose();
  });

  it("aborts an in-flight stream when the signal fires", async () => {
    const listeners = new Set<() => void>();
    let aborted = false;
    const signal = {
      get aborted(): boolean {
        return aborted;
      },
      addEventListener: (_type: "abort", listener: () => void): void => {
        listeners.add(listener);
      },
      removeEventListener: (_type: "abort", listener: () => void): void => {
        listeners.delete(listener);
      },
    };
    let release!: () => void;
    const manager = new AssetManager({
      fetch: () =>
        new Promise<FetchResponse>((resolve) => {
          release = (): void => {
            resolve(
              response("late", {
                body: chunkReader([new Uint8Array([1]), new Uint8Array([2])]),
              }),
            );
          };
        }),
    });

    const iter = manager.stream("/slow", { signal })[Symbol.asyncIterator]();
    const first = iter.next();
    aborted = true;
    for (const listener of [...listeners]) {
      listener();
    }
    release();
    await expect(first).rejects.toThrow(/aborted/);
    manager.dispose();
  });

  it("aborts between streamed chunks", async () => {
    const listeners = new Set<() => void>();
    let aborted = false;
    const signal = {
      get aborted(): boolean {
        return aborted;
      },
      addEventListener: (_type: "abort", listener: () => void): void => {
        listeners.add(listener);
      },
      removeEventListener: (_type: "abort", listener: () => void): void => {
        listeners.delete(listener);
      },
    };
    let pulls = 0;
    const manager = new AssetManager({
      fetch: () =>
        Promise.resolve(
          response("xx", {
            body: {
              getReader() {
                return {
                  read(): Promise<{
                    done: boolean;
                    value?: Uint8Array;
                  }> {
                    pulls += 1;
                    if (pulls === 1) {
                      return Promise.resolve({
                        done: false,
                        value: new Uint8Array([1]),
                      });
                    }
                    return Promise.resolve({
                      done: false,
                      value: new Uint8Array([2]),
                    });
                  },
                };
              },
            },
          }),
        ),
    });

    const chunks: number[] = [];
    const work = (async () => {
      for await (const chunk of manager.stream("/mid", { signal })) {
        chunks.push(...chunk);
        aborted = true;
        for (const listener of [...listeners]) {
          listener();
        }
      }
    })();

    await expect(work).rejects.toThrow(/aborted/);
    expect(chunks).toEqual([1]);
    manager.dispose();
  });

  it("passes chunks to a loader that implements loadStream", async () => {
    const seen: number[] = [];
    const streaming: AssetLoader<string> = {
      name: "stream-loader",
      load: () => Promise.reject(new Error("load() should not run")),
      async loadStream(chunks: AsyncIterable<Uint8Array>): Promise<string> {
        const parts: Uint8Array[] = [];
        for await (const chunk of chunks) {
          seen.push(chunk.byteLength);
          parts.push(chunk);
        }
        return new TextDecoder().decode(parts[0] ?? new Uint8Array());
      },
    };
    const manager = new AssetManager({
      fetch: () =>
        Promise.resolve(
          response("Z", {
            body: chunkReader([new Uint8Array([90])]),
          }),
        ),
    });

    await expect(manager.load("/z", streaming)).resolves.toBe("Z");
    expect(seen).toEqual([1]);
    manager.dispose();
  });
});

// --- dependency graphs ------------------------------------------------------

describe("AssetManager dependency graphs", () => {
  it("registers edges, ignores duplicates, and lists children in order", () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("{}")),
    });
    manager.registerDependency("/root.json", "/a.bin");
    manager.registerDependency("/root.json", "/b.bin");
    manager.registerDependency("/root.json", "/a.bin");
    expect(manager.dependenciesOf("/root.json")).toEqual(["/a.bin", "/b.bin"]);
    expect(manager.unregisterDependency("/root.json", "/a.bin")).toBe(true);
    expect(manager.dependenciesOf("/root.json")).toEqual(["/b.bin"]);
    expect(manager.unregisterDependency("/root.json", "/missing")).toBe(false);
    expect(manager.dependenciesOf("/none")).toEqual([]);
    manager.dispose();
  });

  it("refuses register after dispose", () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("{}")),
    });
    manager.dispose();
    expect(() => manager.registerDependency("/a", "/b")).toThrow(/disposed/);
  });

  it("refuses a self-edge at registration", () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("{}")),
    });
    expect(() => manager.registerDependency("/a", "/a")).toThrow(
      /dependency of itself/,
    );
    manager.dispose();
  });

  it("loadWithDependencies fetches children before the parent", async () => {
    const order: string[] = [];
    const manager = new AssetManager({
      fetch: (url) => {
        order.push(url);
        return Promise.resolve(response(url));
      },
    });
    manager.registerDependency("/root", "/child-a");
    manager.registerDependency("/root", "/child-b");
    manager.registerDependency("/child-a", "/leaf");

    await expect(
      manager.loadWithDependencies("/root", plainLoader),
    ).resolves.toBe("/root");
    expect(order).toEqual(["/leaf", "/child-a", "/child-b", "/root"]);
    manager.dispose();
  });

  it("loadGraph walks { dependencies } on a loader result", async () => {
    const order: string[] = [];
    const graphLoader: AssetLoader<{ name: string; dependencies: string[] }> = {
      name: "graph",
      async load(res) {
        const text = await res.text();
        return JSON.parse(text) as { name: string; dependencies: string[] };
      },
    };
    const bodies: Record<string, string> = {
      "/root.json": JSON.stringify({
        name: "root",
        dependencies: ["/mid.json"],
      }),
      "/mid.json": JSON.stringify({
        name: "mid",
        dependencies: ["/leaf.json"],
      }),
      "/leaf.json": JSON.stringify({ name: "leaf", dependencies: [] }),
    };
    const manager = new AssetManager({
      fetch: (url) => {
        order.push(url);
        const body = bodies[url];
        if (body === undefined) {
          return Promise.resolve(response("", { ok: false, status: 404 }));
        }
        return Promise.resolve(response(body));
      },
    });

    const graph = await manager.loadGraph("/root.json", graphLoader);
    expect(graph.root.name).toBe("root");
    expect([...graph.loaded.keys()]).toEqual([
      "/root.json",
      "/mid.json",
      "/leaf.json",
    ]);
    expect(order).toEqual(["/root.json", "/mid.json", "/leaf.json"]);
    expect(manager.dependenciesOf("/root.json")).toEqual(["/mid.json"]);
    manager.dispose();
  });

  it("refuses a registered cycle", async () => {
    const manager = new AssetManager({
      fetch: (url) => Promise.resolve(response(url)),
    });
    manager.registerDependency("/a", "/b");
    manager.registerDependency("/b", "/a");

    const error = await rejectionOf(
      manager.loadWithDependencies("/a", plainLoader),
    );
    expect(error.code).toBe("ASSET_LOAD_FAILED");
    expect(error.context?.reason).toBe("dependency-cycle");
    manager.dispose();
  });
});

// --- worker decoding --------------------------------------------------------

function echoWorker(): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(message: unknown): void {
      queueMicrotask(() => {
        worker.onmessage?.({ data: message });
      });
    },
  };
  return worker;
}

function transformWorker(
  transform: (buffer: ArrayBuffer) => ArrayBuffer,
): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(message: unknown): void {
      const rec = message as { buffer: ArrayBuffer };
      queueMicrotask(() => {
        worker.onmessage?.({
          data: { type: "decoded", buffer: transform(rec.buffer) },
        });
      });
    },
  };
  return worker;
}

describe("AssetManager worker decoding", () => {
  it("reports the capability only when a factory was injected", () => {
    const bare = new AssetManager({
      fetch: () => Promise.resolve(response("x")),
    });
    expect(bare.canDecodeInWorker).toBe(false);
    const capable = new AssetManager({
      fetch: () => Promise.resolve(response("x")),
      workerFactory: echoWorker,
    });
    expect(capable.canDecodeInWorker).toBe(true);
    bare.dispose();
    capable.dispose();
  });

  it("decodes in-process when decodeInWorker is set but no factory exists", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("plain")),
    });
    await expect(
      manager.load("/p.txt", plainLoader, { decodeInWorker: true }),
    ).resolves.toBe("plain");
    manager.dispose();
  });

  it("posts the ArrayBuffer to an injected worker and loads the reply", async () => {
    let posted: unknown;
    let terminated = 0;
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("abc")),
      workerFactory: (): WorkerLike => {
        const worker: WorkerLike = {
          onmessage: null,
          postMessage(message: unknown): void {
            posted = message;
            const rec = message as { buffer: ArrayBuffer };
            queueMicrotask(() => {
              worker.onmessage?.({
                data: {
                  type: "decoded",
                  buffer: rec.buffer,
                },
              });
            });
          },
          terminate(): void {
            terminated += 1;
          },
        };
        return worker;
      },
    });

    await expect(
      manager.load("/w.txt", plainLoader, { decodeInWorker: true }),
    ).resolves.toBe("abc");
    expect(posted).toMatchObject({ type: "decode", url: "/w.txt" });
    expect(terminated).toBe(1);
    manager.dispose();
  });

  it("hands the loader the worker-transformed bytes", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("abc")),
      workerFactory: () =>
        transformWorker((buffer) => {
          const bytes = new Uint8Array(buffer);
          return new TextEncoder().encode(
            new TextDecoder().decode(bytes).toUpperCase(),
          ).buffer;
        }),
    });

    await expect(
      manager.load("/up.txt", plainLoader, { decodeInWorker: true }),
    ).resolves.toBe("ABC");
    manager.dispose();
  });

  it("refuses a worker error reply", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("abc")),
      workerFactory: (): WorkerLike => {
        const worker: WorkerLike = {
          onmessage: null,
          postMessage(): void {
            queueMicrotask(() => {
              worker.onmessage?.({
                data: { type: "error", message: "bad codec" },
              });
            });
          },
        };
        return worker;
      },
    });

    const error = await rejectionOf(
      manager.load("/bad.txt", plainLoader, { decodeInWorker: true }),
    );
    expect(error.message).toContain("Worker decode failed");
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toBe("bad codec");
    manager.dispose();
  });

  it("accepts a raw ArrayBuffer reply and surfaces factory / postMessage failures", async () => {
    const raw = new AssetManager({
      fetch: () => Promise.resolve(response("ab")),
      workerFactory: (): WorkerLike => {
        const worker: WorkerLike = {
          onmessage: null,
          postMessage(message: unknown): void {
            const rec = message as { buffer: ArrayBuffer };
            queueMicrotask(() => {
              worker.onmessage?.({ data: rec.buffer });
            });
          },
        };
        return worker;
      },
    });
    await expect(
      raw.load("/raw.txt", plainLoader, { decodeInWorker: true }),
    ).resolves.toBe("ab");
    raw.dispose();

    const exploding = new AssetManager({
      fetch: () => Promise.resolve(response("ab")),
      workerFactory: () => {
        throw new Error("no worker");
      },
    });
    const factoryError = await rejectionOf(
      exploding.load("/x.txt", plainLoader, { decodeInWorker: true }),
    );
    expect((factoryError.cause as Error).message).toBe("no worker");
    exploding.dispose();

    const brokenPost = new AssetManager({
      fetch: () => Promise.resolve(response("ab")),
      workerFactory: (): WorkerLike => ({
        onmessage: null,
        postMessage(): void {
          throw new Error("post failed");
        },
      }),
    });
    const postError = await rejectionOf(
      brokenPost.load("/y.txt", plainLoader, { decodeInWorker: true }),
    );
    expect((postError.cause as Error).message).toBe("post failed");
    brokenPost.dispose();
  });

  it("accepts { error } replies and still settles if terminate throws", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("ab")),
      workerFactory: (): WorkerLike => {
        const worker: WorkerLike = {
          onmessage: null,
          postMessage(): void {
            queueMicrotask(() => {
              worker.onmessage?.({ data: { error: "nope" } });
            });
          },
          terminate(): void {
            throw new Error("terminate exploded");
          },
        };
        return worker;
      },
    });
    const error = await rejectionOf(
      manager.load("/t.txt", plainLoader, { decodeInWorker: true }),
    );
    expect((error.cause as Error).message).toBe("nope");
    manager.dispose();
  });

  it("refuses via worker.onerror", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("ab")),
      workerFactory: (): WorkerLike => {
        const worker: WorkerLike = {
          onmessage: null,
          onerror: null,
          postMessage(): void {
            queueMicrotask(() => {
              worker.onerror?.({ message: "thread died" });
            });
          },
        };
        return worker;
      },
    });
    const error = await rejectionOf(
      manager.load("/z.txt", plainLoader, { decodeInWorker: true }),
    );
    expect((error.cause as Error).message).toBe("thread died");
    manager.dispose();
  });

  it("refuses an unrecognised worker reply", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("abc")),
      workerFactory: (): WorkerLike => {
        const worker: WorkerLike = {
          onmessage: null,
          postMessage(): void {
            queueMicrotask(() => {
              worker.onmessage?.({ data: { nope: true } });
            });
          },
        };
        return worker;
      },
    });

    const error = await rejectionOf(
      manager.load("/odd.txt", plainLoader, { decodeInWorker: true }),
    );
    expect((error.cause as Error).message).toContain("unrecognised");
    manager.dispose();
  });
});

// --- hot reload -------------------------------------------------------------

describe("AssetManager.watch", () => {
  it("throws when no watch was injected", () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("x")),
    });
    expect(manager.canWatch).toBe(false);
    try {
      manager.watch("/a.txt", () => undefined);
      expect.unreachable("watch should have thrown");
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      expect((error as FourError).code).toBe("INVALID_APPLICATION_STATE");
      expect((error as FourError).message).toContain("no watch");
      expect((error as FourError).context).toEqual({ url: "/a.txt" });
    }
    manager.dispose();
  });

  it("forwards to the injected watcher and returns its unsubscriber", () => {
    const seen: string[] = [];
    const unsubs: string[] = [];
    const listeners = new Map<string, (url: string) => void>();
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("x")),
      watch: (url, listener) => {
        listeners.set(url, listener);
        return () => {
          listeners.delete(url);
          unsubs.push(url);
        };
      },
    });
    expect(manager.canWatch).toBe(true);

    const stop = manager.watch("/hot.txt", (url) => {
      seen.push(url);
    });
    listeners.get("/hot.txt")?.("/hot.txt");
    expect(seen).toEqual(["/hot.txt"]);

    stop();
    listeners.get("/hot.txt")?.("/hot.txt");
    expect(seen).toEqual(["/hot.txt"]);
    expect(unsubs).toEqual(["/hot.txt"]);
    manager.dispose();
  });

  it("refuses watch after dispose", () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("x")),
      watch: () => () => undefined,
    });
    manager.dispose();
    expect(() => manager.watch("/a.txt", () => undefined)).toThrow(/disposed/);
  });
});

// --- abort still works with the new options ---------------------------------

describe("A-18 remainder does not break abort", () => {
  it("aborts a load that also asked for progress", async () => {
    const events: AssetProgressEvent[] = [];
    const manager = new AssetManager({
      fetch: () => new Promise<FetchResponse>(() => undefined),
    });
    const listeners = new Set<() => void>();
    let aborted = false;
    const signal = {
      get aborted(): boolean {
        return aborted;
      },
      addEventListener: (_type: "abort", listener: () => void): void => {
        listeners.add(listener);
      },
      removeEventListener: (_type: "abort", listener: () => void): void => {
        listeners.delete(listener);
      },
    };

    const load = manager.load("/slow.txt", textLoader, {
      signal,
      onProgress: (event) => {
        events.push(event);
      },
    });
    aborted = true;
    for (const listener of [...listeners]) {
      listener();
    }

    const error = await rejectionOf(load);
    expect(error.context?.reason).toBe("aborted");
    expect(manager.size).toBe(0);
    expect(manager.refCount("/slow.txt", textLoader)).toBe(0);
    manager.dispose();
  });
});

describe("binaryLoader still hashes under the new wrappers", () => {
  it("loads bytes when contentLength is set and no progress is asked", async () => {
    const manager = new AssetManager({
      fetch: () => Promise.resolve(response("hi", { contentLength: 2 })),
    });
    const data = await manager.load("/h.bin", binaryLoader);
    expect(new TextDecoder().decode(data)).toBe("hi");
    manager.dispose();
  });
});
