/**
 * Moving §39's collision-event dispatch from step 6 to step 9 leaves the
 * simulation bit-identical (PH-21, 2026-08-21; §33, §39, §6b).
 *
 * PH-21 makes an ordering that was fixed into an ordering that is configurable,
 * which is a fixed-step change and therefore owes §33 a golden. This file is
 * that obligation, in the three forms WP-1.14 established:
 *
 * 1. **Headless.** The scenario imports `@four/physics`,
 *    `@four/physics-rapier`, `@four/motion`, `@four/math`, `@four/scene` and
 *    `@four/diagnostics` — no renderer package, no canvas, no DOM.
 * 2. **Deterministic in-process.** Two independent runs, each on freshly
 *    constructed adapters and worlds, produce byte-identical per-step
 *    checksums and event digests — in *both* arms.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, a newly decoded Rapier
 *    wasm image — running *the same helper file* reproduces the numbers in
 *    `golden/event-dispatch-split.json`.
 *
 * ## The claim the golden carries
 *
 * One set of numbers covers both arms, because the packet's claim is that the
 * two arms are equal: same per-step checksums, same event count, same events in
 * the same delivery order to the same emitters. The single recorded difference
 * is *when* the listeners ran — the constraint-marker offset, `-1` at step 6
 * and `0` at step 9 — which is the whole feature, measured rather than argued.
 *
 * ## The golden file is immutable
 *
 * `golden/event-dispatch-split.json` is evidence, not configuration. **Never
 * regenerate it to make this test pass.** A mismatch is a real finding — a
 * Rapier version bump included. The per-step checksums exist for the
 * diagnosis: the first index at which two runs disagree localises the
 * divergence to a step.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  STEP_COUNT,
  type EventSplitScenarioResult,
  type EventSplitSummary,
  runEventSplitScenario,
} from "./helpers/event-split-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends EventSplitSummary {
  _warning: string;
  _scenario: string;
  _tier: string;
  _claim: string;
  stepsWithEvents: number;
}

const GOLDEN_URL = new URL(
  "./golden/event-dispatch-split.json",
  import.meta.url,
);
const HELPER_URL = new URL(
  "./helpers/event-split-scenario.ts",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: four 180-step runs plus two wasm decodes. */
const RUN_TIMEOUT_MS = 180_000;

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
function runScenarioInChildProcess(): EventSplitScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runEventSplitScenario();\n` +
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

  return JSON.parse(child.stdout) as EventSplitScenarioResult;
}

describe("PH-21: §39 step 9 can be split out without moving the simulation (§33)", () => {
  let first: EventSplitScenarioResult;
  let second: EventSplitScenarioResult;
  let child: EventSplitScenarioResult;

  beforeAll(async () => {
    first = await runEventSplitScenario();
    second = await runEventSplitScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario is the one the golden assumes", () => {
    // Guards on the *inputs*: a run that quietly stopped stepping, or stopped
    // producing events, could otherwise satisfy the digests degenerately.
    expect(first.stepCount).toBe(STEP_COUNT);
    expect(first.adapterName).toBe("rapier2d");
    for (const arm of [first.combined, first.split]) {
      expect(arm.checksums).toHaveLength(STEP_COUNT);
      expect(arm.summary.eventCount).toBeGreaterThan(0);
      expect(arm.checksums[0]).toBe(arm.summary.firstStepChecksum);
      expect(arm.checksums[STEP_COUNT - 1]).toBe(arm.summary.lastStepChecksum);
    }
    // §39: the split arm really did dispatch at step 9, the combined at step 6.
    expect(first.split.dispatchPriority).toBe(900);
    expect(first.combined.dispatchPriority).toBe(600);
  });

  test("the two arms are identical, step for step and event for event", () => {
    expect(
      firstDivergence(first.split.checksums, first.combined.checksums),
    ).toBe(-1);
    expect(first.split.summary).toEqual(first.combined.summary);
  });

  test("the one recorded difference is when the listeners ran (§39)", () => {
    // With dispatch at step 6 a listener on fixed step n has seen n − 1 runs of
    // the step-7 marker; at step 9 it has seen n. Same events, later.
    expect(first.combined.constraintOffsets.length).toBe(
      golden.stepsWithEvents,
    );
    expect(first.split.constraintOffsets.length).toBe(golden.stepsWithEvents);
    expect(new Set(first.combined.constraintOffsets)).toEqual(new Set([-1]));
    expect(new Set(first.split.constraintOffsets)).toEqual(new Set([0]));
  });

  test("two in-process runs produce identical checksums and digests", () => {
    expect(
      firstDivergence(second.combined.checksums, first.combined.checksums),
    ).toBe(-1);
    expect(firstDivergence(second.split.checksums, first.split.checksums)).toBe(
      -1,
    );
    expect(second.combined.summary).toEqual(first.combined.summary);
    expect(second.split.summary).toEqual(first.split.summary);
  });

  test("a fresh process reproduces the same run", () => {
    expect(
      firstDivergence(child.combined.checksums, first.combined.checksums),
    ).toBe(-1);
    expect(child.combined.summary).toEqual(first.combined.summary);
    expect(child.split.summary).toEqual(first.split.summary);
  });

  test("every run and every arm matches the committed golden", () => {
    for (const run of [first, second, child]) {
      for (const arm of [run.combined, run.split]) {
        expect(arm.summary.summaryDigest).toBe(golden.summaryDigest);
        expect(arm.summary.firstStepChecksum).toBe(golden.firstStepChecksum);
        expect(arm.summary.lastStepChecksum).toBe(golden.lastStepChecksum);
        expect(arm.summary.eventCount).toBe(golden.eventCount);
        expect(arm.summary.eventDigest).toBe(golden.eventDigest);
      }
    }
  });
});
