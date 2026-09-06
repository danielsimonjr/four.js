/**
 * Tests for §83's leaked-resource development warning (A-4/A-5, 2026-08-07).
 *
 * The production half re-imports the module with `__FOUR_DEV__` defined, for
 * the reason `packages/core/tests/dev.test.ts` explains at length: `DEV` is
 * resolved once at module evaluation and has no setter, so the only honest way
 * to test the other build is to evaluate the other build.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NO_RESOURCE_LEAKS,
  auditResourceLeaks,
  type LiveResourceCounts,
} from "../src/resource-audit.js";
import { resetDevWarnings } from "@four/core";

/** A reading with every counter at zero; cases override what they care about. */
function counts(
  overrides: Partial<LiveResourceCounts> = {},
): LiveResourceCounts {
  return {
    geometries: 0,
    bufferBytes: 0,
    textures: 0,
    renderTargets: 0,
    textureBytes: 0,
    materials: 0,
    solverBodies: 0,
    solverColliders: 0,
    solverJoints: 0,
    solverHandles: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  resetDevWarnings();
});

describe("auditResourceLeaks", () => {
  it("reports nothing when the span ended where it began", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const before = counts({ geometries: 4, bufferBytes: 1024, textures: 2 });
    const report = auditResourceLeaks(before, before);
    expect(report).toBe(NO_RESOURCE_LEAKS);
    expect(report.leaked).toBe(false);
    expect(report.message).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports nothing when the span disposed more than it created", () => {
    // A negative difference is not a leak; it is a teardown that over-delivered
    // relative to the baseline (something created *before* the span was
    // disposed inside it), and warning about it would be nonsense.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditResourceLeaks(
      counts({
        geometries: 9,
        bufferBytes: 900,
        textures: 3,
        textureBytes: 300,
      }),
      counts({
        geometries: 2,
        bufferBytes: 200,
        textures: 1,
        textureBytes: 100,
      }),
    );
    expect(report.leaked).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("counts surviving geometries and the bytes they hold", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditResourceLeaks(
      counts(),
      counts({ geometries: 3, bufferBytes: 4096 }),
      { label: "level teardown" },
    );
    expect(report.leaked).toBe(true);
    expect(report.geometries).toBe(3);
    expect(report.bufferBytes).toBe(4096);
    expect(report.textures).toBe(0);
    expect(report.message).toContain("§83");
    expect(report.message).toContain("3 geometries (4096 B)");
    expect(report.message).toContain("level teardown");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[four] §83");
  });

  it("counts textures and render targets separately but their bytes together", () => {
    // `textureMemoryBytes()` is defined as textures *plus* targets (§84 names
    // two memory counters, and a target's attachments are textures), so the
    // report cannot split the bytes and deliberately does not pretend to.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditResourceLeaks(
      counts({ textures: 1, renderTargets: 1, textureBytes: 100 }),
      counts({ textures: 4, renderTargets: 2, textureBytes: 900 }),
    );
    expect(report.textures).toBe(3);
    expect(report.renderTargets).toBe(1);
    expect(report.textureBytes).toBe(800);
    expect(report.message).toContain("3 textures");
    expect(report.message).toContain("1 render targets");
    expect(report.message).toContain("800 B of texture memory");
    expect(report.message).not.toContain("geometries");
  });

  it('names the span "this span" when no label is given', () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditResourceLeaks(counts(), counts({ textures: 1 }));
    expect(report.message).toContain('"this span"');
  });

  it("warns once per label, so a leak inside a loop is one report", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let index = 0; index < 5; index += 1) {
      auditResourceLeaks(counts(), counts({ geometries: 1 }), {
        label: "tick",
      });
    }
    expect(warn).toHaveBeenCalledTimes(1);
    // Distinct spans are distinct mistakes.
    auditResourceLeaks(counts(), counts({ geometries: 1 }), { label: "other" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("counts materials and solver body registrations separately", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditResourceLeaks(
      counts(),
      counts({ materials: 2, solverBodies: 1 }),
      { label: "physics demo" },
    );
    expect(report.materials).toBe(2);
    expect(report.solverBodies).toBe(1);
    expect(report.message).toContain("2 materials");
  });

  it("mentions solver handles when that count regresses", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditResourceLeaks(
      counts(),
      counts({ materials: 1, solverHandles: 4 }),
      { label: "solver teardown" },
    );
    expect(report.materials).toBe(1);
    expect(report.solverHandles).toBe(4);
    expect(report.message).toContain("1 materials");
    expect(report.message).toContain("4 solver handles");
  });

  it("names collider and joint handle leaks separately", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditResourceLeaks(
      counts(),
      counts({ solverColliders: 2, solverJoints: 1 }),
      { label: "constraint teardown" },
    );
    expect(report.solverColliders).toBe(2);
    expect(report.solverJoints).toBe(1);
    expect(report.message).toContain("2 solver colliders");
    expect(report.message).toContain("1 solver joints");
  });

  it("computes the report without printing when warn is false", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditResourceLeaks(
      counts(),
      counts({ geometries: 2, bufferBytes: 64 }),
      {
        label: "silent",
        warn: false,
      },
    );
    expect(report.leaked).toBe(true);
    expect(report.message).toContain("2 geometries (64 B)");
    expect(warn).not.toHaveBeenCalled();
  });

  it("is inert in a production build", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const production = await import("../src/resource-audit.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = production.auditResourceLeaks(
      counts(),
      counts({
        geometries: 12,
        textures: 5,
        renderTargets: 2,
        textureBytes: 999,
      }),
      { label: "level teardown" },
    );
    expect(report).toBe(production.NO_RESOURCE_LEAKS);
    expect(report.leaked).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("NO_RESOURCE_LEAKS", () => {
  it("is frozen, because it is handed out as a shared result", () => {
    expect(Object.isFrozen(NO_RESOURCE_LEAKS)).toBe(true);
  });
});
