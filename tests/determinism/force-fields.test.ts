/**
 * §26/§27 force generation for rigid bodies is deterministic (PH-8,
 * 2026-08-09; §27, §33, §39).
 *
 * PH-8 put an engine occupant into §39's step 5, so it runs arithmetic inside
 * every fixed step and owes §33 a golden. This file is that obligation, in the
 * three forms WP-1.14 established and every later phase reused:
 *
 * 1. **Headless.** The scenario imports `@four/physics`, `@four/physics-rapier`,
 *    `@four/particles`, `@four/motion`, `@four/math`, `@four/scene` and
 *    `@four/diagnostics` — no renderer package, no canvas, no DOM.
 * 2. **Deterministic in-process.** Two independent runs, each on a freshly
 *    constructed adapter and world, produce byte-identical per-step checksums
 *    and identical probe samples.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, a newly decoded Rapier
 *    wasm image — running *the same helper file* reproduces the same 300
 *    checksums and matches `golden/force-fields.json`.
 *
 * ## What the golden pins beyond three hashes
 *
 * A hash says "something changed" and nothing else. So the golden also carries
 * three readable numbers that localise a change before anyone opens a debugger:
 *
 * - `sampleCount` — total §27 samples over the run. It is **strictly less**
 *   than `fields × bodies × steps`, and the deficit is exactly the samples not
 *   taken at sleeping bodies. A change that made the pass visit every
 *   registration would raise it to the product; a change that stopped applying
 *   fields at all would collapse it.
 * - `stepsWithSleepers` / `sleepingAtEnd` — §32 was reached, so the "a field is
 *   not an alarm clock" clause of `forEachActiveBody` was actually exercised
 *   rather than merely written down.
 *
 * ## The golden file is immutable
 *
 * `golden/force-fields.json` is evidence, not configuration. **Never regenerate
 * it to make this test pass.** A mismatch is a real finding — including a
 * Rapier version bump, which is exactly the kind of change this file exists to
 * make visible. The per-step checksums exist for the diagnosis: the first index
 * at which two runs disagree localises the divergence to a step.
 *
 * ## Why the child process runs a `.ts` file directly, and awaits
 *
 * Identical to WP-1.14/WP-5.8: the in-process and fresh-process runs must
 * execute the same code, so both load `helpers/force-field-scenario.ts` —
 * Vitest through Vite, plain `node` through its default type-stripping. Rapier
 * loads asynchronously and writes one deprecation notice to **stderr**, so the
 * child's stdout stays the single JSON object this file parses.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  BODY_COUNT,
  FIXED_TIME_STEP,
  MASSES,
  PROBE_STEP_ONE_SECOND,
  STEP_COUNT,
  type ForceFieldScenarioResult,
  type ForceFieldSummary,
  runForceFieldScenario,
} from "./helpers/force-field-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends ForceFieldSummary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/force-fields.json", import.meta.url);
const HELPER_URL = new URL(
  "./helpers/force-field-scenario.ts",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: a 300-step run is well under a second plus a wasm decode. */
const RUN_TIMEOUT_MS = 120_000;

/** Fields registered on the system — the summation order the golden depends on. */
const FIELD_UNITS = ["acceleration", "force", "acceleration", "force"];

/**
 * The index of the first differing checksum, or `-1` when the two arrays are
 * identical. Reported on failure so a divergence names a step.
 */
function firstDivergence(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return a.length === b.length ? -1 : shared;
}

/** Runs the scenario in a fresh `node` process and parses what it printed. */
function runScenarioInChildProcess(): ForceFieldScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runForceFieldScenario();\n` +
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

  return JSON.parse(child.stdout) as ForceFieldScenarioResult;
}

describe("PH-8: §27 force fields on rigid bodies are deterministic (§33)", () => {
  let first: ForceFieldScenarioResult;
  let second: ForceFieldScenarioResult;
  let child: ForceFieldScenarioResult;

  beforeAll(async () => {
    first = await runForceFieldScenario();
    second = await runForceFieldScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario is the one the golden assumes", () => {
    // Guards on the *inputs*. A run that quietly stopped stepping, or dropped a
    // field, could otherwise satisfy the digest tests with a degenerate run.
    expect(first.stepCount).toBe(STEP_COUNT);
    expect(first.checksums).toHaveLength(STEP_COUNT);
    expect(first.adapterName).toBe("rapier2d");
    expect(first.fieldUnits).toEqual(FIELD_UNITS);
    expect(first.atOneSecond).toHaveLength(BODY_COUNT);
    expect(first.atEnd).toHaveLength(BODY_COUNT);
    expect(first.atEnd.map((sample) => sample.mass)).toEqual([...MASSES]);

    // §39: force generation strictly before the solve, in one registry.
    expect(first.forcePriority).toBeLessThan(first.solvePriority);

    // The published probes really are the checksums they claim to be.
    expect(first.checksums[0]).toBe(first.summary.firstStepChecksum);
    expect(first.checksums[STEP_COUNT - 1]).toBe(
      first.summary.lastStepChecksum,
    );
  });

  test("the fields actually moved the bodies (§26, §27)", () => {
    // At t = 1 s every body has fallen from its start height and is still
    // above the floor, so the run is a simulation and not a frozen scene.
    for (const sample of first.atOneSecond) {
      expect(sample.position[1]).toBeLessThan(2);
      expect(sample.position[1]).toBeGreaterThan(-3.5);
    }
    // The gust and the vortex both act along X, so the row has spread: no body
    // is still exactly where it started.
    const startXs = first.atEnd.map((_sample, i) => -5.5 + i);
    for (let i = 0; i < BODY_COUNT; i += 1) {
      expect(first.atEnd[i].position[0]).not.toBe(startXs[i]);
    }
    expect(PROBE_STEP_ONE_SECOND).toBe(Math.round(1 / FIXED_TIME_STEP));
  });

  test("sleeping bodies are visited by nothing (§32)", () => {
    // The clause `forEachActiveBody` exists for, measured rather than argued:
    // §32 was reached, and the sample count is short of the full product by
    // exactly the samples not taken at sleeping bodies.
    expect(first.summary.stepsWithSleepers).toBeGreaterThan(0);
    expect(first.summary.sleepingAtEnd).toBeGreaterThan(0);
    expect(first.summary.sampleCount).toBeLessThan(
      FIELD_UNITS.length * BODY_COUNT * STEP_COUNT,
    );
    expect(first.summary.sampleCount).toBeGreaterThan(0);
  });

  test("two in-process runs produce identical checksums and samples", () => {
    expect(firstDivergence(second.checksums, first.checksums)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(second.atOneSecond).toEqual(first.atOneSecond);
    expect(second.atEnd).toEqual(first.atEnd);
  });

  test("a fresh process reproduces the same run", () => {
    expect(firstDivergence(child.checksums, first.checksums)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.atEnd).toEqual(first.atEnd);
  });

  test("every run matches the committed golden", () => {
    for (const run of [first, second, child]) {
      expect(run.summary.summaryDigest).toBe(golden.summaryDigest);
      expect(run.summary.firstStepChecksum).toBe(golden.firstStepChecksum);
      expect(run.summary.lastStepChecksum).toBe(golden.lastStepChecksum);
      expect(run.summary.stepsWithSleepers).toBe(golden.stepsWithSleepers);
      expect(run.summary.sleepingAtEnd).toBe(golden.sleepingAtEnd);
      expect(run.summary.sampleCount).toBe(golden.sampleCount);
    }
  });

  test("the golden states its tier and its immutability", () => {
    expect(golden._warning).toContain("IMMUTABLE");
    expect(golden._tier).toContain("same-runtime");
    expect(golden._tier).toContain("NOT claimed");
    expect(golden._scenario).toContain("PRIORITY_FORCES");
  });
});
