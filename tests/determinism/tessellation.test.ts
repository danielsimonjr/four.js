/**
 * §52 tessellation determinism (§33, gap `R-25`).
 *
 * `R-25` is the load-bearing prerequisite of the 2D stack: `R-24`'s `Path`
 * caches a fill, `R-23`'s shape nodes build geometry from one, `R-16`'s paints
 * stroke along one, and every pixel golden above them assumes the triangles
 * underneath do not move. This file is the gate on that assumption, in the four
 * forms the phase suites established:
 *
 * 1. **Headless and dependency-free.** The scenario imports `@four/geometry`,
 *    `@four/core` and `@four/diagnostics` — no renderer, no application, no
 *    canvas, no DOM. The tessellator is a pure function; there is no clock to
 *    inject and no state to reset.
 * 2. **Deterministic in-process.** Two independent runs produce identical
 *    per-shape digests and identical records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child — new heap, new module graph, new JIT state — running *the
 *    same helper file* reproduces every digest and matches
 *    `golden/tessellation.json`.
 * 4. **Correct where correctness is checkable without re-deriving the module.**
 *    Every triangle of every accepted shape is counter-clockwise and the
 *    triangles tile the shape's exact area — asserted here, in this file, from
 *    the index arrays themselves. A digest that matched a golden while the
 *    triangulation was wrong would fail these.
 *
 * ## The golden file is immutable
 *
 * `golden/tessellation.json` is evidence, not configuration. **Never regenerate
 * it to make a test pass.** A mismatch means the tessellator changed what it
 * emits — a different ear order, a different bridge, a different set of
 * refusals. Find the change and decide whether it is correct; only a
 * deliberate, reviewed change justifies new values, and it must be recorded in
 * `CHANGELOG.md` and `MEMORY.md` with the reason.
 *
 * ## The tier this pins is `cross-platform`
 *
 * Unlike its neighbours in this directory, this scenario claims §33's top tier:
 * nothing between the seed and the digest is allowed to differ between
 * conforming engines. The helper's header carries the argument. That is why the
 * cross-process check here is a real cross-*platform* claim and not merely a
 * fresh-heap one.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { triangulatePolygon, type Point2D } from "@four/geometry";
import { beforeAll, describe, expect, test } from "vitest";

import {
  RANDOM_SHAPES,
  SEED,
  runTessellationScenario,
  scenarioShapes,
  type TessellationScenarioResult,
} from "./helpers/tessellation-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile {
  _warning: string;
  _scenario: string;
  _tier: string;
  seed: number;
  shapes: number;
  tessellated: number;
  refused: number;
  triangles: number;
  summaryDigest: number;
  firstShapeDigest: number;
  lastShapeDigest: number;
}

const GOLDEN_URL = new URL("./golden/tessellation.json", import.meta.url);
const HELPER_URL = new URL(
  "./helpers/tessellation-scenario.ts",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one run is milliseconds; a cold child adds process start. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Runs the scenario in a fresh `node` process and parses what it printed.
 *
 * The child inherits no state from Vitest beyond the environment: no Vite, no
 * transform pipeline, no test globals. It writes exactly one JSON object to
 * stdout; anything on stderr is surfaced in the failure message.
 */
function runScenarioInChildProcess(): TessellationScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = scenario.runTessellationScenario();\n` +
    `process.stdout.write(JSON.stringify(result));\n`;

  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (child.error !== undefined) {
    throw new Error(
      `Failed to spawn the fresh-process determinism run: ${child.error.message}`,
    );
  }
  if (child.status !== 0) {
    throw new Error(
      `Fresh-process determinism run exited with status ${String(child.status)} ` +
        `(signal ${String(child.signal)}).\n--- stderr ---\n${child.stderr}\n` +
        `--- stdout ---\n${child.stdout}`,
    );
  }

  return JSON.parse(child.stdout) as TessellationScenarioResult;
}

/** Twice the signed area of a ring; positive when counter-clockwise. */
function doubleArea(points: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** The index of the first differing digest, or `-1` when the two agree. */
function firstDivergence(
  a: readonly TessellationScenarioResult["records"][number][],
  b: readonly TessellationScenarioResult["records"][number][],
): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i].digest !== b[i].digest || a[i].triangles !== b[i].triangles) {
      return i;
    }
  }
  return a.length === b.length ? -1 : shared;
}

describe("§52 tessellation is deterministic", () => {
  let first: TessellationScenarioResult;
  let second: TessellationScenarioResult;
  let child: TessellationScenarioResult;

  beforeAll(() => {
    first = runTessellationScenario();
    second = runTessellationScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario really exercised the catalogue it claims to", () => {
    // Guards on the *inputs*. A scenario that quietly stopped generating
    // shapes, or started refusing all of them, could otherwise satisfy every
    // digest assertion below with a degenerate run.
    expect(first.shapes).toBe(golden.shapes);
    expect(first.records).toHaveLength(first.shapes);
    expect(first.tessellated).toBeGreaterThan(RANDOM_SHAPES / 2);
    expect(first.refused).toBeGreaterThan(0);
    expect(first.tessellated + first.refused).toBe(first.shapes);
    expect(SEED).toBe(golden.seed);
  });

  test("two in-process runs agree shape for shape", () => {
    expect(firstDivergence(first.records, second.records)).toBe(-1);
    expect(second.summaryDigest).toBe(first.summaryDigest);
    expect(second.triangles).toBe(first.triangles);
  });

  test("a fresh node process agrees shape for shape", () => {
    expect(firstDivergence(first.records, child.records)).toBe(-1);
    expect(child.summaryDigest).toBe(first.summaryDigest);
    expect(child.refused).toBe(first.refused);
  });

  test("the run matches the committed golden", () => {
    // If this fails: DO NOT edit golden/tessellation.json. See this file's
    // header.
    expect(first.tessellated).toBe(golden.tessellated);
    expect(first.refused).toBe(golden.refused);
    expect(first.triangles).toBe(golden.triangles);
    expect(first.summaryDigest).toBe(golden.summaryDigest);
    expect(first.records[0].digest).toBe(golden.firstShapeDigest);
    expect(first.records[first.records.length - 1].digest).toBe(
      golden.lastShapeDigest,
    );
  });

  test("the index arrays themselves are byte-identical, not just their digests", () => {
    // A checksum collision is not the failure mode anyone expects, but a
    // scenario that hashed the wrong thing is. This re-tessellates the fixed
    // half of the catalogue and compares element by element.
    for (const shape of scenarioShapes().slice(0, 8)) {
      const a = triangulatePolygon(shape.outline, shape.holes);
      const b = triangulatePolygon(shape.outline, shape.holes);
      expect([...b], shape.name).toEqual([...a]);
    }
  });

  test("every accepted shape is a real triangulation of its polygon", () => {
    // Correctness, independent of any digest: counter-clockwise triangles whose
    // areas sum to the outline's area minus the holes'.
    let checked = 0;
    for (const shape of scenarioShapes()) {
      let indices;
      try {
        indices = triangulatePolygon(shape.outline, shape.holes);
      } catch {
        continue;
      }
      const points = [shape.outline, ...shape.holes].flat();
      let area = 0;
      for (let i = 0; i < indices.length; i += 3) {
        const a = points[indices[i]];
        const b = points[indices[i + 1]];
        const c = points[indices[i + 2]];
        const twice = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        expect(
          twice,
          `${shape.name}: triangle ${String(i / 3)}`,
        ).toBeGreaterThan(0);
        area += twice;
      }
      const expected =
        Math.abs(doubleArea(shape.outline)) -
        shape.holes.reduce((sum, hole) => sum + Math.abs(doubleArea(hole)), 0);
      expect(area, `${shape.name}: tiles its region`).toBeCloseTo(expected, 9);
      checked += 1;
    }
    expect(checked).toBe(first.tessellated);
  });
});
