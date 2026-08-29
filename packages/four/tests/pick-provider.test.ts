/**
 * The §71 picking adapter (RFC 0005 §2): a render-side `PickingService`
 * presented as `@four/input`'s render-free `PickProvider`, headlessly — a
 * `Map`-backed service double is the whole GPU.
 */

import type { PickRequest, PickResult, PickingService } from "@four/render";
import type { Viewport } from "@four/scene";
import { OrthographicCamera, createFullscreenViewport } from "@four/scene";
import { describe, expect, it } from "vitest";

import { createPickProvider } from "../src/index.js";

/** A service double answering from a table, recording what it was asked. */
class TableService implements PickingService {
  readonly requests: PickRequest[] = [];

  disposed = false;

  #answer: string | undefined;

  #frame = 7;

  constructor(answer: string | undefined) {
    this.#answer = answer;
  }

  update(): void {
    this.#frame += 1;
  }

  pick(request: PickRequest): Promise<PickResult> {
    this.requests.push(request);
    return Promise.resolve({ nodeId: this.#answer, frame: this.#frame });
  }

  dispose(): void {
    this.disposed = true;
  }
}

function view(): Viewport {
  return createFullscreenViewport(
    new OrthographicCamera({ left: -1, right: 1, bottom: -1, top: 1 }),
  );
}

describe("createPickProvider (§71, RFC 0005)", () => {
  it("forwards the closed-over viewport and the coordinates, and hands back the id", async () => {
    const service = new TableService("node-9");
    const viewport = view();
    const provider = createPickProvider(service, viewport);

    await expect(provider.pick(0.25, -0.5)).resolves.toBe("node-9");
    expect(service.requests).toHaveLength(1);
    expect(service.requests[0].viewport).toBe(viewport);
    expect(service.requests[0].ndcX).toBe(0.25);
    expect(service.requests[0].ndcY).toBe(-0.5);
  });

  it("maps “nothing there” to undefined — the frame ordinal is deliberately dropped", async () => {
    const provider = createPickProvider(new TableService(undefined), view());
    await expect(provider.pick(0, 0)).resolves.toBeUndefined();
  });

  it("propagates the service's rejection untouched", async () => {
    const refusal = new Error("no id buffer");
    const service = new TableService(undefined);
    service.pick = () => Promise.reject(refusal);
    const provider = createPickProvider(service, view());
    await expect(provider.pick(0, 0)).rejects.toBe(refusal);
  });
});
