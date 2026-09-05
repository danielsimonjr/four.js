/**
 * §51 path determinism (§33, gap `R-24`).
 *
 * The `Path` is the vector-level source everything 2D is built from: `R-23`'s
 * shape nodes build geometry from one, `R-16`'s paints stroke along one, §56
 * lays text along one, and `R-26` reads and writes them as SVG. "Same path,
 * same points" is what all of that assumes, and this file is the gate on it, in
 * the four forms the phase suites established:
 *
 * 1. **Headless and dependency-free.** The scenario imports `@four/geometry`,
 *    `@four/core` and `@four/diagnostics` — no renderer, no application, no
 *    canvas, no DOM. A path is a pure value; there is no clock to inject.
 * 2. **Deterministic in-process.** Two independent runs produce identical
 *    per-path digests and identical records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child — new heap, new module graph, new JIT state — running *the
 *    same helper file* reproduces every digest and matches `golden/path.json`.
 * 4. **Correct where correctness is checkable without re-deriving the module.**
 *    The cross-platform half's coordinates are asserted to be exactly
 *    representable dyadic rationals — the mechanical proof of its tier, below.
 *
 * ## The golden file is immutable
 *
 * `golden/path.json` is evidence, not configuration. **Never regenerate it to
 * make a test pass.** A mismatch means the path model changed what it produces.
 * Find the change, decide whether it is correct, and record a deliberate one in
 * `CHANGELOG.md` and `MEMORY.md` with the reason.
 *
 * ## Two tiers, two digests, on purpose
 *
 * Unlike every other scenario in this directory, this one pins **two** tiers at
 * once, because §51 has two kinds of segment and only one of them can be
 * exact:
 *
 * - `bezier` claims §33's top tier, `cross-platform`. Its control points are
 *   integers and its tolerances powers of two, so de Casteljau's `(a + b) × ½`
 *   never rounds and every emitted coordinate is a dyadic rational — which the
 *   test below asserts directly rather than taking on trust.
 * - `arc` claims `same-runtime` only. A point on an arc is
 *   `centre + r·(cos θ, sin θ)` and its sample count comes from `Math.acos`;
 *   ECMA-262 leaves both implementation-approximated, so a conforming engine
 *   may legally produce different last bits and, at a boundary tolerance, one
 *   sample more or fewer.
 *
 * Averaging the two into one digest would let a `Math.hypot` introduced into
 * the Bézier flattener hide inside the arc half's weaker claim. Keeping them
 * apart is what makes the stronger claim checkable.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  RANDOM_PATHS,
  SEED,
  TOLERANCES,
  arcCatalogue,
  bezierCatalogue,
  runPathScenario,
  type PathScenarioResult,
  type PathTierResult,
} from "./helpers/path-scenario.js";

/** One half of the committed golden. */
interface GoldenTier {
  _tier: string;
  paths: number;
  points: number;
  summaryDigest: number;
  firstPathDigest: number;
  lastPathDigest: number;
}

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile {
  _warning: string;
  _scenario: string;
  _tiers: string;
  seed: number;
  tolerances: number[];
  bezier: GoldenTier;
  arc: GoldenTier;
}

const GOLDEN_URL = new URL("./golden/path.json", import.meta.url);
const HELPER_URL = new URL("./helpers/path-scenario.ts", import.meta.url);
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
function runScenarioInChildProcess(): PathScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = scenario.runPathScenario();\n` +
    `process.stdout.write(JSON.stringify(result));\n`;

  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
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

  return JSON.parse(child.stdout) as PathScenarioResult;
}

/** The index of the first differing record, or `-1` when the two agree. */
function firstDivergence(a: PathTierResult, b: PathTierResult): number {
  const shared = Math.min(a.records.length, b.records.length);
  for (let i = 0; i < shared; i += 1) {
    if (
      a.records[i].digest !== b.records[i].digest ||
      a.records[i].points !== b.records[i].points
    ) {
      return i;
    }
  }
  return a.records.length === b.records.length ? -1 : shared;
}

/** Both halves of a run, paired with the golden half they answer to. */
function halves(
  result: PathScenarioResult,
): readonly (readonly [string, PathTierResult, GoldenTier])[] {
  return [
    ["bezier", result.bezier, golden.bezier],
    ["arc", result.arc, golden.arc],
  ];
}

describe("§51 path flattening is deterministic", () => {
  let first: PathScenarioResult;
  let second: PathScenarioResult;
  let child: PathScenarioResult;

  beforeAll(() => {
    first = runPathScenario();
    second = runPathScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario really exercised the catalogues it claims to", () => {
    // Guards on the *inputs*. A scenario that quietly stopped generating paths,
    // or started flattening them to nothing, could otherwise satisfy every
    // digest assertion below with a degenerate run.
    expect(SEED).toBe(golden.seed);
    expect(TOLERANCES).toEqual(golden.tolerances);
    for (const [name, tier, expected] of halves(first)) {
      expect(tier.paths, name).toBe(expected.paths);
      expect(tier.records, name).toHaveLength(expected.paths);
      expect(tier.paths, name).toBeGreaterThan(RANDOM_PATHS);
      expect(tier.points, name).toBeGreaterThan(RANDOM_PATHS);
    }
    expect(bezierCatalogue()).toHaveLength(golden.bezier.paths);
    expect(arcCatalogue()).toHaveLength(golden.arc.paths);
  });

  test("two in-process runs agree path for path, in both tiers", () => {
    expect(firstDivergence(first.bezier, second.bezier)).toBe(-1);
    expect(firstDivergence(first.arc, second.arc)).toBe(-1);
    expect(second.bezier.summaryDigest).toBe(first.bezier.summaryDigest);
    expect(second.arc.summaryDigest).toBe(first.arc.summaryDigest);
  });

  test("a fresh node process agrees path for path, in both tiers", () => {
    expect(firstDivergence(first.bezier, child.bezier)).toBe(-1);
    expect(firstDivergence(first.arc, child.arc)).toBe(-1);
    expect(child.bezier.summaryDigest).toBe(first.bezier.summaryDigest);
    expect(child.arc.summaryDigest).toBe(first.arc.summaryDigest);
  });

  test("the run matches the committed golden, tier by tier", () => {
    // If this fails: DO NOT edit golden/path.json. See this file's header.
    for (const [name, tier, expected] of halves(first)) {
      expect(tier.tier, name).toBe(expected._tier);
      expect(tier.points, name).toBe(expected.points);
      expect(tier.summaryDigest, name).toBe(expected.summaryDigest);
      expect(tier.records[0].digest, name).toBe(expected.firstPathDigest);
      expect(tier.records[tier.records.length - 1].digest, name).toBe(
        expected.lastPathDigest,
      );
    }
  });

  test("the cross-platform half really is exact, not merely reproducible", () => {
    // The tier claim, mechanically: with integer control points and power-of-two
    // tolerances, midpoint subdivision produces dyadic rationals and nothing
    // rounds. Every coordinate is therefore an exact multiple of 2^-24 well
    // inside 53 bits — a value no conforming engine is free to compute
    // differently. A `Math.sqrt`, a `Math.cos` or a non-power-of-two constant
    // introduced into the Bézier path would break this before it broke a digest.
    let checked = 0;
    for (const { name, path } of bezierCatalogue()) {
      for (const tolerance of TOLERANCES) {
        for (const points of path.flatten(tolerance)) {
          for (const point of points) {
            expect(Number.isInteger(point.x * 2 ** 24), name).toBe(true);
            expect(Number.isInteger(point.y * 2 ** 24), name).toBe(true);
            expect(Math.abs(point.x), name).toBeLessThanOrEqual(64);
            checked += 2;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  test("the same-runtime half is honest about why it is not exact", () => {
    // The counterpart: an arc's samples are *not* exact, and pretending
    // otherwise is the failure this split exists to prevent. A quarter-turn arc
    // of radius 1 lands on a coordinate that is not a dyadic rational at all.
    const [points] = arcCatalogue()[0].path.flatten(TOLERANCES[1]);
    const irrational = points.filter(
      (point) => !Number.isInteger(point.x * 2 ** 24),
    );
    expect(irrational.length).toBeGreaterThan(0);
  });
});
