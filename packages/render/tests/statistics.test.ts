/**
 * Unit tests for §84's render counters (A-1) and the optional `Renderer`
 * capability that carries them.
 *
 * The record is three numbers; what is worth pinning is the *contract* around
 * it — accumulate-never-clear, presence-is-the-capability, and the structural
 * agreement with `@four/diagnostics`, which transcribes this shape because the
 * frozen §3.1 matrix forbids it the import.
 */

import { describe, expect, it } from "vitest";

import { NullRenderer, type Renderer } from "../src/index.js";
import type {
  RenderStatistics,
  RenderStatisticsReporter,
} from "../src/statistics.js";
import {
  createRenderStatistics,
  resetRenderStatistics,
  supportsRenderStatistics,
} from "../src/statistics.js";

describe("createRenderStatistics", () => {
  it("starts at zero — a record that exists is being counted", () => {
    expect(createRenderStatistics()).toEqual({
      drawCalls: 0,
      triangles: 0,
      instances: 0,
    });
  });

  it("allocates a distinct record per call", () => {
    expect(createRenderStatistics()).not.toBe(createRenderStatistics());
  });
});

describe("resetRenderStatistics", () => {
  it("zeroes in place rather than replacing the record", () => {
    const statistics = createRenderStatistics();
    statistics.drawCalls = 5;
    statistics.triangles = 900;
    statistics.instances = 40;
    resetRenderStatistics(statistics);
    expect(statistics).toEqual({ drawCalls: 0, triangles: 0, instances: 0 });
  });
});

describe("supportsRenderStatistics", () => {
  it("accepts a renderer that declares the member, even while it is null", () => {
    const renderer = new NullRenderer();
    expect(renderer.statistics).toBeNull();
    expect(supportsRenderStatistics(renderer)).toBe(true);
  });

  it("rejects a renderer that omits it", () => {
    const uncounting = {
      render(): void {
        // A backend with nothing to count declares nothing.
      },
    };
    expect(supportsRenderStatistics(uncounting)).toBe(false);
  });

  it("narrows the value so the record can be assigned", () => {
    const renderer: Renderer = new NullRenderer();
    const statistics = createRenderStatistics();
    if (supportsRenderStatistics(renderer)) {
      renderer.statistics = statistics;
    }
    expect((renderer as RenderStatisticsReporter).statistics).toBe(statistics);
  });
});

describe("NullRenderer statistics", () => {
  it("counts nothing, because it submits nothing", () => {
    const renderer = new NullRenderer();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    renderer.render({} as Parameters<Renderer["render"]>[0], []);
    expect(renderer.renderCount).toBe(1);
    expect(statistics).toEqual({ drawCalls: 0, triangles: 0, instances: 0 });
  });

  it("is assignable to the interface's optional member", () => {
    const renderer: Renderer = new NullRenderer();
    renderer.statistics = createRenderStatistics();
    expect(renderer.statistics).not.toBeNull();
  });
});

describe("the @four/diagnostics transcription", () => {
  it("is satisfied by this package's record (structural agreement)", () => {
    // `RenderStatisticsLike` in `@four/diagnostics/src/stats.ts`, transcribed
    // here because that package may not import this one and this one may not
    // import it (§3.1, frozen). Assigning the real type to the transcription is
    // what turns "they look the same" into a compile error when they stop
    // being the same — the discipline `ParticleDrawable` and `ReplayTarget`
    // established.
    interface RenderStatisticsLike {
      readonly drawCalls: number;
      readonly triangles: number;
      readonly instances: number;
    }
    const statistics: RenderStatistics = createRenderStatistics();
    const transcribed: RenderStatisticsLike = statistics;
    expect(transcribed.drawCalls).toBe(0);
  });
});
