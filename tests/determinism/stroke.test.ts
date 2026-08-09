/**
 * §52 stroke-expansion determinism (§33, gap `R-16`).
 *
 * The sibling of `tessellation.test.ts`, in the same four forms — headless,
 * twice in-process, once in a fresh `node` child, and checked against a
 * committed golden — with **one deliberate difference**: this scenario claims
 * §33's `same-runtime` tier where the fill tessellator claims `cross-platform`.
 *
 * That is not a weaker test of the same thing; it is an honest test of a
 * different thing. Offsetting a polyline by a fixed distance needs a unit
 * normal, so `Math.sqrt` is unavoidable, and a round join or cap needs
 * `Math.acos`, `Math.cos` and `Math.sin` — all four implementation-approximated
 * by ECMA-262. `R-24`'s recorded rule is that **a determinism tier is a
 * property of the operation, not of the module**, and the cost of ignoring it
 * is that a transcendental hides inside the stronger claim. So §52 has two
 * goldens carrying two `_tier` labels, and this is the second one.
 *
 * ## The golden file is immutable
 *
 * `golden/stroke.json` is evidence, not configuration. **Never regenerate it to
 * make a test pass.** A mismatch means `expandStroke` changed what it emits —
 * a different offset, a different join fallback, a different fan step, a
 * different dash phase. Find the change and decide whether it is correct; only
 * a deliberate, reviewed change justifies new values, and it must be recorded
 * in `CHANGELOG.md` and `MEMORY.md` with the reason.
 *
 * ## What is asserted here rather than digested
 *
 * A digest that matched a golden while the band was in the wrong place would
 * still be wrong, so the last test re-derives two properties from the meshes
 * themselves: every triangle turns counter-clockwise (§7a), and a straight
 * butt-capped segment covers exactly `width × length`. Those are the same
 * oracles `packages/geometry/tests/stroke.test.ts` uses, applied here to prove
 * the *recorded* run is the correct one.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expandStroke } from "@four/geometry";
import { beforeAll, describe, expect, test } from "vitest";

import {
  RANDOM_CHAINS,
  SEED,
  runStrokeScenario,
  scenarioStrokes,
  type StrokeScenarioResult,
} from "./helpers/stroke-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile {
  _warning: string;
  _scenario: string;
  _tier: string;
  seed: number;
  strokes: number;
  triangles: number;
  vertices: number;
  summaryDigest: number;
  firstStrokeDigest: number;
  lastStrokeDigest: number;
}

const GOLDEN_URL = new URL("./golden/stroke.json", import.meta.url);
const HELPER_URL = new URL("./helpers/stroke-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one run is milliseconds; a cold child adds process start. */
const RUN_TIMEOUT_MS = 120_000;

/** Runs the scenario in a fresh `node` process and parses what it printed. */
function runScenarioInChildProcess(): StrokeScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = scenario.runStrokeScenario();\n` +
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

  return JSON.parse(child.stdout) as StrokeScenarioResult;
}

/** The index of the first differing record, or `-1` when the two agree. */
function firstDivergence(
  a: readonly StrokeScenarioResult["records"][number][],
  b: readonly StrokeScenarioResult["records"][number][],
): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (
      a[i].digest !== b[i].digest ||
      a[i].triangles !== b[i].triangles ||
      a[i].vertices !== b[i].vertices
    ) {
      return i;
    }
  }
  return a.length === b.length ? -1 : shared;
}

describe("§52 stroke expansion is deterministic", () => {
  let first: StrokeScenarioResult;
  let second: StrokeScenarioResult;
  let child: StrokeScenarioResult;

  beforeAll(() => {
    first = runStrokeScenario();
    second = runStrokeScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario really exercised the catalogue it claims to", () => {
    // Guards on the *inputs*. A scenario that quietly stopped generating
    // chains, or started producing empty meshes, could otherwise satisfy every
    // digest assertion below with a degenerate run.
    expect(first.strokes).toBe(golden.strokes);
    expect(first.records).toHaveLength(first.strokes);
    expect(first.strokes).toBeGreaterThan(RANDOM_CHAINS);
    expect(SEED).toBe(golden.seed);
    // Every hand-written case draws something; the seeded half may include a
    // chain that collapses, which is itself part of the record.
    for (const record of first.records.slice(
      0,
      first.strokes - RANDOM_CHAINS,
    )) {
      expect(record.triangles).toBeGreaterThan(0);
    }
  });

  test("two in-process runs agree case for case", () => {
    expect(firstDivergence(first.records, second.records)).toBe(-1);
    expect(second.summaryDigest).toBe(first.summaryDigest);
    expect(second.triangles).toBe(first.triangles);
  });

  test("a fresh node process agrees case for case", () => {
    expect(firstDivergence(first.records, child.records)).toBe(-1);
    expect(child.summaryDigest).toBe(first.summaryDigest);
    expect(child.vertices).toBe(first.vertices);
  });

  test("the run matches the committed golden", () => {
    // If this fails: DO NOT edit golden/stroke.json. See this file's header.
    expect(first.triangles).toBe(golden.triangles);
    expect(first.vertices).toBe(golden.vertices);
    expect(first.summaryDigest).toBe(golden.summaryDigest);
    expect(first.records[0].digest).toBe(golden.firstStrokeDigest);
    expect(first.records[first.records.length - 1].digest).toBe(
      golden.lastStrokeDigest,
    );
  });

  test("the meshes themselves are byte-identical, not just their digests", () => {
    // A checksum collision is not the failure mode anyone expects, but a
    // digest is only evidence about the array it was taken over.
    for (const stroke of scenarioStrokes()) {
      const a = expandStroke(stroke.polylines, stroke.options);
      const b = expandStroke(stroke.polylines, stroke.options);
      expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
      expect(b.positions).toEqual(a.positions);
    }
  });

  test("the recorded run is the correct one, not merely a stable one", () => {
    for (const stroke of scenarioStrokes()) {
      const mesh = expandStroke(stroke.polylines, stroke.options);
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.positions[mesh.indices[i]];
        const b = mesh.positions[mesh.indices[i + 1]];
        const c = mesh.positions[mesh.indices[i + 2]];
        const twice = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        expect(twice).toBeGreaterThanOrEqual(0);
      }
    }
    const straight = expandStroke(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
          ],
          closed: false,
        },
      ],
      { width: 2, tolerance: 0.03125 },
    );
    let area = 0;
    for (let i = 0; i < straight.indices.length; i += 3) {
      const a = straight.positions[straight.indices[i]];
      const b = straight.positions[straight.indices[i + 1]];
      const c = straight.positions[straight.indices[i + 2]];
      area += ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    }
    expect(area).toBe(16);
  });
});
