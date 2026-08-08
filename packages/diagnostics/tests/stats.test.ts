/**
 * Unit tests for §84's runtime statistics record (A-1).
 *
 * Three properties carry the weight here, because the record itself is
 * eleven numbers and a handful of stores:
 *
 * 1. **The field list is §84's, exactly** — eleven names, no invention, no
 *    omission. Asserted against a literal list rather than by construction, so
 *    adding a twelfth counter fails a test and has to be argued for.
 * 2. **`NaN` means "not measured"** and survives every reset, so a staged
 *    counter cannot quietly start reading `0`.
 * 3. **Nothing allocates after `createFrameStats`** — the record is written in
 *    place, which is what lets the frame loop own one for its lifetime.
 */

import { constructionCount } from "@four/math";
import { describe, expect, it } from "vitest";

import type { DebugBodyAccess, SolverStatistics } from "../src/debug-draw.js";
import { solverStatistics } from "../src/stats.js";
import type { FrameStats } from "../src/stats.js";
import {
  copyFrameStats,
  createFrameStats,
  createMonotonicClock,
  monotonicNowSeconds,
  recordRenderStatistics,
  recordResourceMemory,
  recordSolverStatistics,
  resetFrameStats,
} from "../src/stats.js";

/**
 * §84's counter block, transcribed from `docs/SPECIFICATION.md` § 84 in the
 * order the specification writes it.
 *
 * Eleven, not the twelve `docs/GAP ANALYSIS v0.md` A-1 claims twice — the
 * miscount is recorded in `stats.ts`'s header and pinned here.
 */
const SPEC_FIELDS = [
  "cpuFrameTime",
  "gpuFrameTime",
  "simulationTime",
  "physicsStepTime",
  "drawCalls",
  "triangles",
  "instances",
  "activeBodies",
  "contacts",
  "textureMemory",
  "bufferMemory",
] as const satisfies readonly (keyof FrameStats)[];

describe("FrameStats shape", () => {
  it("carries exactly §84's eleven counters, in the specification's order", () => {
    expect(Object.keys(createFrameStats())).toEqual([...SPEC_FIELDS]);
    expect(SPEC_FIELDS).toHaveLength(11);
  });

  it("starts every counter unmeasured", () => {
    const stats = createFrameStats();
    for (const field of SPEC_FIELDS) {
      expect(stats[field], field).toBeNaN();
    }
  });

  it("allocates a distinct record per call", () => {
    expect(createFrameStats()).not.toBe(createFrameStats());
  });
});

describe("resetFrameStats", () => {
  it("returns every counter to unmeasured, whatever it held", () => {
    const stats = createFrameStats();
    for (const [index, field] of SPEC_FIELDS.entries()) {
      stats[field] = index;
    }
    resetFrameStats(stats);
    for (const field of SPEC_FIELDS) {
      expect(stats[field], field).toBeNaN();
    }
  });

  it("mutates in place rather than replacing the record", () => {
    const stats = createFrameStats();
    stats.drawCalls = 7;
    const before = stats;
    resetFrameStats(stats);
    expect(stats).toBe(before);
  });

  it("allocates nothing", () => {
    const stats = createFrameStats();
    const before = constructionCount();
    for (let index = 0; index < 100; index += 1) {
      resetFrameStats(stats);
    }
    expect(constructionCount()).toBe(before);
  });
});

describe("copyFrameStats", () => {
  it("copies every field into the out parameter and returns it", () => {
    const source = createFrameStats();
    for (const [index, field] of SPEC_FIELDS.entries()) {
      source[field] = index + 1;
    }
    const out = createFrameStats();
    expect(copyFrameStats(source, out)).toBe(out);
    for (const field of SPEC_FIELDS) {
      expect(out[field], field).toBe(source[field]);
    }
  });

  it("carries NaN across as NaN — a copy of 'not measured' is not measured", () => {
    const source = createFrameStats();
    source.cpuFrameTime = 0.016;
    const out = createFrameStats();
    for (const field of SPEC_FIELDS) {
      out[field] = 0;
    }
    copyFrameStats(source, out);
    expect(out.cpuFrameTime).toBe(0.016);
    expect(out.drawCalls).toBeNaN();
  });

  it("leaves the source alone and shares no reference with it", () => {
    const source = createFrameStats();
    source.triangles = 12;
    const out = copyFrameStats(source, createFrameStats());
    out.triangles = 99;
    expect(source.triangles).toBe(12);
  });
});

describe("recordRenderStatistics", () => {
  it("copies the three renderer-produced counters and nothing else", () => {
    const stats = createFrameStats();
    recordRenderStatistics(stats, {
      drawCalls: 3,
      triangles: 512,
      instances: 40,
    });
    expect(stats.drawCalls).toBe(3);
    expect(stats.triangles).toBe(512);
    expect(stats.instances).toBe(40);
    expect(stats.cpuFrameTime).toBeNaN();
    expect(stats.activeBodies).toBeNaN();
  });

  it("records a counted-but-empty frame as 0, not as unmeasured", () => {
    const stats = createFrameStats();
    recordRenderStatistics(stats, {
      drawCalls: 0,
      triangles: 0,
      instances: 0,
    });
    expect(stats.drawCalls).toBe(0);
    expect(Number.isNaN(stats.drawCalls)).toBe(false);
  });
});

describe("recordResourceMemory", () => {
  it("copies §83's two live-resource totals and nothing else", () => {
    const stats = createFrameStats();
    recordResourceMemory(stats, 262144, 1536);
    expect(stats.textureMemory).toBe(262144);
    expect(stats.bufferMemory).toBe(1536);
    expect(stats.drawCalls).toBeNaN();
    expect(stats.cpuFrameTime).toBeNaN();
  });

  it("records an engine holding nothing as 0, not as unmeasured", () => {
    // The A-1 rule: `0` means "counted; nothing held", and an application with
    // no resources at all has genuinely measured that.
    const stats = createFrameStats();
    recordResourceMemory(stats, 0, 0);
    expect(stats.textureMemory).toBe(0);
    expect(stats.bufferMemory).toBe(0);
    expect(Number.isNaN(stats.textureMemory)).toBe(false);
  });

  it("re-reads its source, so a level that fell is reported as fallen", () => {
    // The counters are levels, not accumulations: the second call must
    // overwrite rather than add.
    const stats = createFrameStats();
    recordResourceMemory(stats, 4096, 900);
    recordResourceMemory(stats, 0, 12);
    expect(stats.textureMemory).toBe(0);
    expect(stats.bufferMemory).toBe(12);
  });
});

describe("recordSolverStatistics", () => {
  /** A §113 `DebugBodyAccess` over a fixed body table. */
  function accessOver(
    bodies: readonly { id: number; sleeping: boolean }[],
  ): DebugBodyAccess<number, number> {
    return {
      forEachBody(visit) {
        for (const body of bodies) {
          visit(body.id, body.id);
        }
      },
      forEachCollider() {
        // No colliders: §84 has no collider counter, so the walk is irrelevant
        // here and an empty one keeps the fixture honest about that.
      },
      isBodySleeping(handle) {
        return bodies[handle]?.sleeping === true;
      },
      getBodyTransform() {
        // §84 counts bodies; it never asks where they are.
      },
      getBodyVelocities() {
        // Ditto — velocities are §113's overlay, not a statistic.
      },
    };
  }

  it("maps §32's awake set onto §84's activeBodies", () => {
    const solver = solverStatistics(
      accessOver([
        { id: 0, sleeping: false },
        { id: 1, sleeping: true },
        { id: 2, sleeping: false },
      ]),
    );
    const stats = createFrameStats();
    recordSolverStatistics(stats, solver);
    expect(solver.bodyCount).toBe(3);
    expect(stats.activeBodies).toBe(2);
  });

  it("writes activeBodies alone — no §84 counter maps onto the rest", () => {
    const stats = createFrameStats();
    const solver: SolverStatistics = {
      bodyCount: 9,
      sleepingCount: 4,
      awakeCount: 5,
      colliderCount: 20,
      maxBodyId: 30,
    };
    recordSolverStatistics(stats, solver);
    expect(stats.activeBodies).toBe(5);
    expect(stats.contacts).toBeNaN();
    expect(stats.physicsStepTime).toBeNaN();
  });
});

describe("createMonotonicClock", () => {
  it("reads performance.now() and converts milliseconds to seconds", () => {
    let milliseconds = 1500;
    const clock = createMonotonicClock({
      performance: {
        now: () => milliseconds,
      },
    });
    expect(clock()).toBe(1.5);
    milliseconds = 2250;
    expect(clock()).toBe(2.25);
  });

  it("calls performance.now() with performance as its receiver", () => {
    const performance = {
      base: 4000,
      now(): number {
        return this.base;
      },
    };
    expect(createMonotonicClock({ performance })()).toBe(4);
  });

  it("reports 'not measured' on a host with no performance object", () => {
    // Deliberately not a `Date.now()` fallback: that API is banned
    // repository-wide (§33), and it is not monotonic, so it would replace an
    // honest NaN with a number that is occasionally wrong. See `stats.ts`.
    expect(createMonotonicClock({})()).toBeNaN();
  });

  it("reports 'not measured' when performance.now is not callable", () => {
    expect(createMonotonicClock({ performance: { now: 12 } })()).toBeNaN();
  });

  it("defaults its source to the host, and the default clock advances", async () => {
    const clock = createMonotonicClock();
    const first = clock();
    expect(Number.isFinite(first)).toBe(true);
    const second = monotonicNowSeconds();
    expect(Number.isFinite(second)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(monotonicNowSeconds()).toBeGreaterThanOrEqual(second);
  });

  it("allocates nothing per reading", () => {
    const clock = createMonotonicClock({ performance: { now: () => 1 } });
    const before = constructionCount();
    for (let index = 0; index < 1000; index += 1) {
      clock();
    }
    expect(constructionCount()).toBe(before);
  });
});
