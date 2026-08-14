/**
 * §44's camera rigs and §42's `"constraint"` authority are deterministic
 * (R-36 rig half + PH-11, 2026-08-13; §12, §33, §39, §44).
 *
 * `ConstraintSystem` put a new engine occupant into §39's step 7, so it runs
 * arithmetic inside every fixed step and owes §33 a golden. This file is that
 * obligation, in the three forms WP-1.14 established and every later phase
 * reused:
 *
 * 1. **Headless.** The scenario imports `@four/motion`, `@four/math`,
 *    `@four/scene` and `@four/diagnostics` — no renderer package, no canvas, no
 *    DOM, and no solver.
 * 2. **Deterministic in-process.** Two independent runs, each on a freshly
 *    built scene and a freshly seeded input stream, produce byte-identical
 *    per-step checksums and identical probe samples.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph — running *the same
 *    helper file* reproduces the same 300 checksums and matches
 *    `golden/camera-rigs.json`.
 *
 * ## What the golden pins beyond three hashes
 *
 * A hash says "something changed" and nothing else. So the golden also carries
 * three readable numbers that localise a change before anyone opens a debugger:
 *
 * - `skippedAims` — degenerate aims over the run. **Zero**, and that is a
 *   claim, not an accident: the orbit rig's pitch is clamped one milliradian
 *   short of the pole, which is exactly the configuration `Node.lookAt` refuses
 *   with the default `+Y` up. A change that widened or dropped the clamp would
 *   make this number climb.
 * - `pitchLimitHits` — times that clamp actually bit. **Non-zero**, which is
 *   what says the guard was *reached* rather than merely present; the pair of
 *   numbers only means something together.
 * - `skippedPlacements` — refused placements. Zero: no parent in the scenario
 *   is singular, so every rig wrote every step, and a regression that started
 *   refusing writes would show here rather than as a mysterious hash change.
 *
 * ## The golden file is immutable
 *
 * `golden/camera-rigs.json` is evidence, not configuration. **Never regenerate
 * it to make this test pass.** A mismatch is a real finding: the per-step
 * checksums exist for the diagnosis, and the first index at which two runs
 * disagree localises the divergence to a step.
 *
 * ## Why the child process runs a `.ts` file directly
 *
 * Identical to WP-1.14/PH-8: the in-process and fresh-process runs must execute
 * the same code, so both load `helpers/camera-rig-scenario.ts` — Vitest through
 * Vite, plain `node` through its default type-stripping.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  CAMERA_COUNT,
  EXPECTED_PRIORITIES,
  FIXED_TIME_STEP,
  PROBE_STEP_ONE_SECOND,
  STEP_COUNT,
  type CameraRigScenarioResult,
  type CameraRigSummary,
  runCameraRigScenario,
} from "./helpers/camera-rig-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends CameraRigSummary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/camera-rigs.json", import.meta.url);
const HELPER_URL = new URL("./helpers/camera-rig-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: a 300-step run of four nodes is milliseconds. */
const RUN_TIMEOUT_MS = 120_000;

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
function runScenarioInChildProcess(): CameraRigScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = scenario.runCameraRigScenario();\n` +
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

  return JSON.parse(child.stdout) as CameraRigScenarioResult;
}

describe("R-36/PH-11: §44 camera rigs under §42's constraint authority are deterministic (§33)", () => {
  let first: CameraRigScenarioResult;
  let second: CameraRigScenarioResult;
  let child: CameraRigScenarioResult;

  beforeAll(() => {
    first = runCameraRigScenario();
    second = runCameraRigScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario is the one the golden assumes", () => {
    // Guards on the *inputs*. A run that quietly stopped stepping, or lost a
    // camera, could otherwise satisfy the digest tests with a degenerate run.
    expect(first.stepCount).toBe(STEP_COUNT);
    expect(first.checksums).toHaveLength(STEP_COUNT);
    expect(first.atOneSecond).toHaveLength(CAMERA_COUNT);
    expect(first.atEnd).toHaveLength(CAMERA_COUNT);
    expect(PROBE_STEP_ONE_SECOND).toBe(Math.round(1 / FIXED_TIME_STEP));

    // §39: kinematic motion strictly before the constraint solve, in one
    // registry — which is what makes every aim read the pose written this step.
    expect(first.kinematicPriority).toBe(EXPECTED_PRIORITIES[0]);
    expect(first.constraintPriority).toBe(EXPECTED_PRIORITIES[1]);
    expect(first.kinematicPriority).toBeLessThan(first.constraintPriority);

    // §42: three authorities over four nodes, and not one conflict.
    expect(first.authorities).toEqual([
      "kinematic",
      "manual",
      "constraint",
      "constraint",
      "constraint",
    ]);
    expect(first.warnings).toBe(0);

    // The published probes really are the checksums they claim to be.
    expect(first.checksums[0]).toBe(first.summary.firstStepChecksum);
    expect(first.checksums[STEP_COUNT - 1]).toBe(
      first.summary.lastStepChecksum,
    );
  });

  test("the rigs actually moved the cameras (§44)", () => {
    // Every camera is somewhere else at t = 5 s than at t = 1 s, and none of
    // them is sitting at the origin: the run is a simulation, not a frozen scene.
    for (let i = 0; i < CAMERA_COUNT; i += 1) {
      expect(first.atEnd[i].position).not.toEqual(
        first.atOneSecond[i].position,
      );
      const [x, y, z] = first.atEnd[i].position;
      expect(Math.abs(x) + Math.abs(y) + Math.abs(z)).toBeGreaterThan(1);
      expect(Number.isFinite(x + y + z)).toBe(true);
    }
  });

  test("the pole guard was reached, and no aim ever went degenerate", () => {
    // The clause `DEFAULT_ORBIT_PITCH_LIMIT` exists for, measured rather than
    // argued: the clamp bit, and because it bit, `Node.lookAt` was never handed
    // an aim parallel to its `up`.
    expect(first.summary.pitchLimitHits).toBeGreaterThan(0);
    expect(first.summary.skippedAims).toBe(0);
    expect(first.summary.skippedPlacements).toBe(0);
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
      expect(run.summary.skippedAims).toBe(golden.skippedAims);
      expect(run.summary.skippedPlacements).toBe(golden.skippedPlacements);
      expect(run.summary.pitchLimitHits).toBe(golden.pitchLimitHits);
    }
  });

  test("the golden states its tier and its immutability", () => {
    expect(golden._warning).toContain("IMMUTABLE");
    expect(golden._tier).toContain("same-runtime");
    expect(golden._tier).toContain("NOT claimed");
    expect(golden._scenario).toContain("PRIORITY_CONSTRAINTS");
  });
});
