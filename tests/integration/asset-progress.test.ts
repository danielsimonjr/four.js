/**
 * §76 progress / streaming against the platform's own types (A-18 remainder).
 *
 * The unit suite in `packages/assets/tests/a18-remainder.test.ts` drives the
 * policy with hand-rolled fakes. This one exists for the property those fakes
 * cannot prove: a real `Headers`, a real `content-length`, and (where the
 * runtime has one) a real `ReadableStream` satisfy `@four/assets`'s seams
 * with **no adapter**.
 */

import {
  AssetManager,
  type AssetLoader,
  type AssetProgressEvent,
  type FetchResponse,
} from "@four/assets";
import { describe, expect, it } from "vitest";

const textLoader: AssetLoader<string> = {
  name: "text",
  load: (response) => response.text(),
};

function buffered(body: string, headers?: Headers): FetchResponse {
  return {
    ok: true,
    status: 200,
    headers,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  };
}

describe("§76 progress with platform Headers", () => {
  it("reads Content-Length through Headers.get with no adapter", async () => {
    const events: AssetProgressEvent[] = [];
    const manager = new AssetManager({
      fetch: () =>
        Promise.resolve(
          buffered("hello", new Headers({ "content-length": "5" })),
        ),
    });

    await expect(
      manager.load("/level.json", textLoader, {
        onProgress: (event) => {
          events.push(event);
        },
      }),
    ).resolves.toBe("hello");

    expect(events[events.length - 1]).toEqual({
      loaded: 5,
      total: 5,
      url: "/level.json",
    });
    manager.dispose();
  });

  it("streams a platform ReadableStream when the runtime has one", async () => {
    if (typeof ReadableStream !== "function") {
      return;
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });
    const manager = new AssetManager({
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": "4" }),
          body,
          arrayBuffer: () => Promise.reject(new Error("should stream")),
          text: () => Promise.reject(new Error("should stream")),
          json: () => Promise.reject(new Error("should stream")),
        }),
    });

    const chunks: number[] = [];
    for await (const chunk of manager.stream("/mesh.bin")) {
      chunks.push(...chunk);
    }
    expect(chunks).toEqual([1, 2, 3, 4]);
    manager.dispose();
  });

  it("keeps a capable manager assignable to AssetManager", () => {
    const capable = new AssetManager({
      fetch: () => Promise.resolve(buffered("x", new Headers())),
      watch: () => () => undefined,
      workerFactory: () => ({
        onmessage: null,
        postMessage(): void {
          /* unused — capability witness only */
        },
      }),
    });
    const asOption: AssetManager = capable;
    expect(asOption.canWatch).toBe(true);
    expect(asOption.canDecodeInWorker).toBe(true);
    capable.dispose();
  });
});
