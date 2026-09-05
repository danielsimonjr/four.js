/**
 * §12's character controllers and §44's first-person look are deterministic
 * (PH-11 residue, 2026-08-21; §12, §33, §39, §42, §44).
 *
 * `CharacterController` and `FirstPersonLook` put new arithmetic into §39's
 * step 4, so they owe §33 a golden. This file is that obligation, in the three
 * forms WP-1.14 established and every later phase reused:
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
 *    `golden/character-controller.json`.
 *
 * ## What the golden pins beyond three hashes
 *
 * - `pitchLimitHits` — **non-zero**, which is what says the pole guard was
 *   *reached* rather than merely present, exactly as the orbit rig's clamp is
 *   pinned in `camera-rigs.test.ts`.
 * - `jumpsTaken` / `landings` / `groundedSteps` — the ground contract, in three
 *   numbers. Six jumps are attempted and three are taken, because the other
 *   three fall on steps the character is still airborne: both arms of
 *   `jump()`'s refusal are on the golden, and every jump that was taken landed.
 * - `fallerVerticalVelocity` — exactly `−6`, the configured `maxFallSpeed`. A
 *   terminal velocity that stopped clamping would show here as a large negative
 *   number rather than as a mysterious hash change.
 * - `skippedSteps` — zero: no pose in the run ever went non-finite, so the
 *   counted-transient path never fired and the checksums are a run in which
 *   every step wrote.
 *
 * ## The golden file is immutable
 *
 * `golden/character-controller.json` is evidence, not configuration. **Never
 * regenerate it to make this test pass.** A mismatch is a real finding: the
 * per-step checksums exist for the diagnosis, and the first index at which two
 * runs disagree localises the divergence to a step.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  EXPECTED_PRIORITY,
  FIXED_TIME_STEP,
  PROBE_STEP_ONE_SECOND,
  STEP_COUNT,
  type CharacterScenarioResult,
  type CharacterSummary,
  runCharacterScenario,
} from "./helpers/character-controller-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends CharacterSummary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL(
  "./golden/character-controller.json",
  import.meta.url,
);
const HELPER_URL = new URL(
  "./helpers/character-controller-scenario.ts",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: a 300-step run of three nodes is milliseconds. */
const RUN_TIMEOUT_MS = 120_000;

/** Nodes the scenario samples per step. */
const NODE_COUNT = 3;

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
function runScenarioInChildProcess(): CharacterScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = scenario.runCharacterScenario();\n` +
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

  return JSON.parse(child.stdout) as CharacterScenarioResult;
}

describe("PH-11: §12's character controllers are deterministic (§33)", () => {
  let first: CharacterScenarioResult;
  let second: CharacterScenarioResult;
  let child: CharacterScenarioResult;

  beforeAll(() => {
    first = runCharacterScenario();
    second = runCharacterScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario is the one the golden assumes", () => {
    // Guards on the *inputs*. A run that quietly stopped stepping, or lost a
    // node, could otherwise satisfy the digest tests with a degenerate run.
    expect(first.stepCount).toBe(STEP_COUNT);
    expect(first.checksums).toHaveLength(STEP_COUNT);
    expect(first.atOneSecond).toHaveLength(NODE_COUNT);
    expect(first.atEnd).toHaveLength(NODE_COUNT);
    expect(PROBE_STEP_ONE_SECOND).toBe(Math.round(1 / FIXED_TIME_STEP));

    // §39: one system, step 4 — locomotion is kinematic motion, not a solve.
    expect(first.kinematicPriority).toBe(EXPECTED_PRIORITY);

    // §42: one authority over three moving nodes, and not one conflict. The
    // whole first-person decomposition rests on this line.
    expect(first.authorities).toEqual([
      "kinematic",
      "kinematic",
      "manual",
      "kinematic",
    ]);
    expect(first.warnings).toBe(0);

    // The published probes really are the checksums they claim to be.
    expect(first.checksums[0]).toBe(first.summary.firstStepChecksum);
    expect(first.checksums[STEP_COUNT - 1]).toBe(
      first.summary.lastStepChecksum,
    );
  });

  test("the characters actually moved (§12)", () => {
    for (let i = 0; i < NODE_COUNT; i += 1) {
      expect(first.atEnd[i].position).not.toEqual(
        first.atOneSecond[i].position,
      );
      const [x, y, z] = first.atEnd[i].position;
      expect(Number.isFinite(x + y + z)).toBe(true);
    }
    // The faller is still falling at its terminal velocity, 4 s in.
    expect(first.summary.fallerVerticalVelocity).toBe(-6);
    expect(first.atEnd[2].position[1]).toBeLessThan(
      first.atOneSecond[2].position[1],
    );
  });

  test("the ground contract held, and the pole guard was reached", () => {
    expect(first.summary.jumpsTaken).toBeGreaterThan(0);
    // Every jump that was taken came back down.
    expect(first.summary.landings).toBe(first.summary.jumpsTaken);
    expect(first.summary.groundedSteps).toBeGreaterThan(0);
    expect(first.summary.groundedSteps).toBeLessThan(STEP_COUNT);
    expect(first.summary.pitchLimitHits).toBeGreaterThan(0);
    expect(first.summary.skippedSteps).toBe(0);
  });

  test("two in-process runs produce identical checksums and samples", () => {
    expect(firstDivergence(second.checksums, first.checksums)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(second.atOneSecond).toEqual(first.atOneSecond);
    expect(second.atEnd).toEqual(first.atEnd);
  });

  test("a fresh node process reproduces the same run", () => {
    expect(firstDivergence(child.checksums, first.checksums)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.atEnd).toEqual(first.atEnd);
  });

  test("the run matches the committed golden", () => {
    const { _warning, _scenario, _tier, ...expected } = golden;
    expect(_warning).toContain("IMMUTABLE");
    expect(_scenario.length).toBeGreaterThan(0);
    expect(_tier).toContain("same-runtime");
    expect(first.summary).toEqual(expected);
  });
});
