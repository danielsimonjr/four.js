/**
 * Phase 1 exit test (plan WP-1.14; §104 exit criterion; §33, §92 determinism).
 *
 * §104 closes Phase 1 on one sentence: *"A scene graph can be deterministically
 * stepped without a renderer."* This file is the proof, in the three forms the
 * plan's §8 verification stack demands:
 *
 * 1. **Headless.** The scenario imports `four`, `@four/scene`, `@four/motion`,
 *    `@four/math`, and `@four/diagnostics` — no renderer package, no canvas, no
 *    DOM. It runs under plain `node` with no environment at all (test 3), which
 *    is stronger evidence than any assertion could be.
 * 2. **Deterministic in-process.** Two independent runs in one process produce
 *    byte-identical per-step digests (test 1).
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state — running
 *    *the same helper file* reproduces the same 1000 digests, and both match
 *    values committed to `golden/phase1.json` (tests 2 and 3).
 *
 * ## The golden file is immutable
 *
 * `golden/phase1.json` is evidence, not configuration. **Never regenerate it to
 * make this test pass.** A mismatch is a real finding: engine behaviour changed
 * between the run that produced the golden and the run under test. The correct
 * response is to identify the change and decide whether it is intended — and
 * only then, as a reviewed and recorded decision (CHANGELOG.md, MEMORY.md),
 * write new values. The per-step digests exist for exactly this diagnosis: the
 * first index at which two runs disagree localises the divergence to a step,
 * which localises it to a frame's elapsed time and to the state that frame
 * touched. See {@link firstDivergence}.
 *
 * ## Why the child process runs a `.ts` file directly
 *
 * The in-process and fresh-process runs must execute *identical code*, or the
 * comparison proves nothing about the engine. So both load the single helper
 * `helpers/phase1-scenario.ts`: Vitest through Vite, and plain `node` through
 * its default type-stripping (Node ≥ 22.18; this repo pins Node ≥ 20 and runs
 * 22.22). The child is launched with `--input-type=module -e`, importing the
 * helper by absolute `file:` URL, so there is no second runner file to drift
 * out of sync with this one. The helper's module documentation records the
 * constraint that choice imposes (erasable TypeScript syntax only).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  FIXED_TIME_STEP,
  LONG_FRAME_INDICES,
  NODE_COUNT,
  PROBE_STEP,
  STEP_COUNT,
  runPhase1Scenario,
  type Phase1ScenarioResult,
  type Phase1Summary,
} from "./helpers/phase1-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends Phase1Summary {
  _warning: string;
}

const GOLDEN_URL = new URL("./golden/phase1.json", import.meta.url);
const HELPER_URL = new URL("./helpers/phase1-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one scenario run is ~1 s, a cold child adds process start. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * The index of the first differing digest, or `-1` when the two arrays are
 * identical. Reported on failure so a divergence names a step rather than just
 * a mismatched summary hash.
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

/**
 * Runs the scenario in a fresh `node` process and parses what it printed.
 *
 * The child inherits no state from Vitest beyond the environment: no Vite, no
 * transform pipeline, no test globals. It writes exactly one JSON object to
 * stdout; anything on stderr is surfaced in the failure message.
 */
function runScenarioInChildProcess(): Phase1ScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runPhase1Scenario();\n` +
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

  return JSON.parse(child.stdout) as Phase1ScenarioResult;
}

describe("Phase 1 exit: deterministic headless stepping (§104)", () => {
  let first: Phase1ScenarioResult;
  let second: Phase1ScenarioResult;
  let child: Phase1ScenarioResult;

  beforeAll(async () => {
    first = await runPhase1Scenario();
    second = await runPhase1Scenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario actually exercises what Phase 1 must guarantee", () => {
    // Guards on the *inputs*, so a scenario that quietly stopped stepping,
    // stopped branching, or stopped clamping cannot pass the digest tests by
    // reproducing a degenerate run.
    expect(first.stepCount).toBe(STEP_COUNT);
    expect(first.digests).toHaveLength(STEP_COUNT);
    expect(first.nodeCount).toBe(NODE_COUNT);
    // Every node's world matrix, plus the scene root's, is hashed each step.
    expect(first.hashedNodeCount).toBe(NODE_COUNT + 1);

    // Mixed depth (§6): chains and stars, not a flat list of 100 siblings.
    expect(first.maximumDepth).toBeGreaterThanOrEqual(3);

    // The §10 accumulator ran, and consumed less than one fixed step per frame
    // on average would if every frame were long — i.e. it is genuinely ragged.
    expect(first.fixedStepCount).toBeGreaterThan(0);
    expect(first.simulationTime).toBeCloseTo(
      first.fixedStepCount * FIXED_TIME_STEP,
      9,
    );

    // The long frames tripped the §10 sub-step clamp, so `droppedTime` (§9)
    // advanced. Without this, the clamp path would be untested and a
    // regression in it would not move any digest.
    expect(LONG_FRAME_INDICES.length).toBeGreaterThan(0);
    expect(first.droppedTime).toBeGreaterThan(0);

    // Not a stuck scene: the digests move.
    expect(new Set(first.digests).size).toBeGreaterThan(STEP_COUNT / 2);
  });

  test("two in-process runs produce identical per-step digests", () => {
    expect(firstDivergence(first.digests, second.digests)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(second.fixedStepCount).toBe(first.fixedStepCount);
    expect(second.droppedTime).toBe(first.droppedTime);
  });

  test("the in-process run matches the committed golden digests", () => {
    // If this fails: DO NOT edit golden/phase1.json. See this file's header.
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.step500Digest).toBe(golden.step500Digest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);

    // The published probes really are the digests they claim to be.
    expect(first.digests[0]).toBe(first.summary.firstStepDigest);
    expect(first.digests[PROBE_STEP - 1]).toBe(first.summary.step500Digest);
    expect(first.digests[STEP_COUNT - 1]).toBe(first.summary.lastStepDigest);
  });

  test("a fresh node process reproduces the same digests and the golden", () => {
    expect(firstDivergence(child.digests, first.digests)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.summary.summaryDigest).toBe(golden.summaryDigest);
    expect(child.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(child.summary.step500Digest).toBe(golden.step500Digest);
    expect(child.summary.lastStepDigest).toBe(golden.lastStepDigest);

    // The child ran the same simulation, not just the same hash.
    expect(child.fixedStepCount).toBe(first.fixedStepCount);
    expect(child.droppedTime).toBe(first.droppedTime);
    expect(child.maximumDepth).toBe(first.maximumDepth);
  });

  test("the golden file carries its immutability warning", () => {
    expect(golden._warning).toMatch(/DO NOT REGENERATE/i);
  });
});
