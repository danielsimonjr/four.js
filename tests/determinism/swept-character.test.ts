/**
 * §12's solver-backed character controller is deterministic (`PH-11b`,
 * 2026-08-21; §12, §30, §33, §39, §42).
 *
 * `SweptCharacterController` adds arithmetic to §39's step 4 *and* consumes
 * §30 shape casts, so it owes §33 a golden — and it owes it on a **real
 * solver**, because a controller that consumes solver queries inherits the
 * solver's determinism tier. This file is that obligation, in the three forms
 * WP-1.14 established and every later phase reused:
 *
 * 1. **Headless.** The scenario imports `@four/physics`,
 *    `@four/physics-rapier`, `@four/motion`, `@four/math`, `@four/scene` and
 *    `@four/diagnostics` — no renderer package, no canvas, no DOM.
 * 2. **Deterministic in-process.** Two independent runs, each on a freshly
 *    built world, produce byte-identical per-step checksums and probe samples.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, a second wasm instance
 *    — running *the same helper file* reproduces the same 300 checksums and
 *    matches `golden/swept-character.json`.
 *
 * ## What the golden pins beyond three hashes
 *
 * Six readable numbers, one per clause of the packet, so that a regression is
 * localised before anyone opens a debugger:
 *
 * - `walkerSlides` — **non-zero**: the collide-and-slide loop resolved real
 *   impacts against a real wall, rather than a character walking through it.
 * - `stepperStepUps` — **non-zero**: the up/forward/down triple was *accepted*,
 *   which is what says step height works rather than merely exists;
 *   `stepperMaxHeight` is the riser's height above the floor, so the step was
 *   the size the geometry says it was.
 * - `climberMaxHeight` — the character facing a 60° ramp with a 45°
 *   `slopeLimit` never gets up it. The **other arm** of the same refusal.
 * - `jumpsTaken` against `jumpAttempts` — `jump()` was asked on every one of
 *   300 steps and refused on all but a handful, because the rest were asked in
 *   mid-air; `landings === jumpsTaken` says every jump that was taken came back
 *   down.
 * - `fallerMinVerticalVelocity` — exactly `−6`, the configured `maxFallSpeed`.
 *   A terminal velocity that stopped clamping would show here as a large
 *   negative number rather than as a mysterious hash change.
 * - `skippedSteps` — zero: no pose in the run went non-finite, so the counted
 *   §85 transient never fired and the checksums are a run in which every step
 *   wrote.
 *
 * ## The golden file is immutable
 *
 * `golden/swept-character.json` is evidence, not configuration. **Never
 * regenerate it to make this test pass.** A mismatch is a real finding: the
 * per-step checksums exist for the diagnosis, and the first index at which two
 * runs disagree localises the divergence to a step.
 *
 * ## Why the child process runs a `.ts` file directly, and awaits
 *
 * Identical to WP-1.14/PH-8: the in-process and fresh-process runs must execute
 * the same code, so both load `helpers/swept-character-scenario.ts` — Vitest
 * through Vite, plain `node` through its default type-stripping. Rapier loads
 * asynchronously and writes one deprecation notice to **stderr**, so the
 * child's stdout stays the single JSON object this file parses.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  CHARACTER_NAMES,
  FALLER_MAX_FALL_SPEED,
  FIXED_TIME_STEP,
  PROBE_STEP_ONE_SECOND,
  RISER_HEIGHT,
  STEP_COUNT,
  type SweptCharacterScenarioResult,
  type SweptCharacterSummary,
  runSweptCharacterScenario,
} from "./helpers/swept-character-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends SweptCharacterSummary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/swept-character.json", import.meta.url);
const HELPER_URL = new URL(
  "./helpers/swept-character-scenario.ts",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: a 300-step run is well under a second plus a wasm decode. */
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
function runScenarioInChildProcess(): SweptCharacterScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runSweptCharacterScenario();\n` +
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

  return JSON.parse(child.stdout) as SweptCharacterScenarioResult;
}

describe("PH-11b: §12's swept character controller is deterministic (§33)", () => {
  let first: SweptCharacterScenarioResult;
  let second: SweptCharacterScenarioResult;
  let child: SweptCharacterScenarioResult;

  beforeAll(async () => {
    first = await runSweptCharacterScenario();
    second = await runSweptCharacterScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario is the one the golden assumes", () => {
    // Guards on the *inputs*. A run that quietly stopped stepping, or lost a
    // character, could otherwise satisfy the digest tests degenerately.
    expect(first.stepCount).toBe(STEP_COUNT);
    expect(first.checksums).toHaveLength(STEP_COUNT);
    expect(first.adapterName).toBe("rapier3d");
    expect(first.atOneSecond.map((sample) => sample.name)).toEqual([
      ...CHARACTER_NAMES,
    ]);
    expect(first.atEnd).toHaveLength(CHARACTER_NAMES.length);

    // §39: the characters are written strictly before the solve, in one
    // registry — the ordering argument this packet turns on.
    expect(first.characterPriority).toBeLessThan(first.solvePriority);

    // The published probes really are the checksums they claim to be.
    expect(first.checksums[0]).toBe(first.summary.firstStepChecksum);
    expect(first.checksums[STEP_COUNT - 1]).toBe(
      first.summary.lastStepChecksum,
    );
    expect(PROBE_STEP_ONE_SECOND).toBe(Math.round(1 / FIXED_TIME_STEP));
  });

  test("the characters moved, and each one met the geometry meant for it", () => {
    const [walker, stepper, climber, jumper, faller] = first.atEnd;

    // A run, not a frozen scene: everyone who was walking has walked.
    expect(walker.position[2]).toBeLessThan(-1);
    expect(stepper.position[2]).toBeLessThan(-1);
    expect(climber.position[2]).toBeLessThan(-1);
    expect(jumper.position[2]).toBeLessThan(-1);

    // Slide along wall: the walker's strafe carried it *along* the wall it
    // could not walk through.
    expect(first.summary.walkerSlides).toBeGreaterThan(0);
    expect(Math.abs(first.summary.walkerSlideDistance)).toBeGreaterThan(1);

    // Step height: accepted, and the accepted step is the riser's height.
    expect(first.summary.stepperStepUps).toBeGreaterThan(0);
    expect(first.summary.stepperMaxHeight).toBeGreaterThan(
      climber.position[1] + RISER_HEIGHT * 0.75,
    );

    // Slope limit: the 60° ramp is never stood on, so the climber stays low.
    expect(first.summary.climberMaxHeight).toBeLessThan(1);

    // The faller fell all the way to the floor and stopped there.
    expect(faller.grounded).toBe(true);
    expect(faller.verticalVelocity).toBe(0);
  });

  test("both arms of jump() and of the fall clamp are on the record", () => {
    expect(first.summary.jumpAttempts).toBe(STEP_COUNT);
    expect(first.summary.jumpsTaken).toBeGreaterThan(0);
    // The interesting half: most attempts were refused, in mid-air.
    expect(first.summary.jumpsTaken).toBeLessThan(STEP_COUNT);
    expect(first.summary.landings).toBe(first.summary.jumpsTaken);
    // The clamp bit, exactly at the configured terminal velocity.
    expect(first.summary.fallerMinVerticalVelocity).toBe(
      -FALLER_MAX_FALL_SPEED,
    );
    // No step in the run declined to write (§85's counted transient).
    expect(first.summary.skippedSteps).toBe(0);
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
      expect(run.summary.walkerSlides).toBe(golden.walkerSlides);
      expect(run.summary.walkerSlideDistance).toBe(golden.walkerSlideDistance);
      expect(run.summary.stepperStepUps).toBe(golden.stepperStepUps);
      expect(run.summary.stepperMaxHeight).toBe(golden.stepperMaxHeight);
      expect(run.summary.climberMaxHeight).toBe(golden.climberMaxHeight);
      expect(run.summary.jumpAttempts).toBe(golden.jumpAttempts);
      expect(run.summary.jumpsTaken).toBe(golden.jumpsTaken);
      expect(run.summary.landings).toBe(golden.landings);
      expect(run.summary.fallerMinVerticalVelocity).toBe(
        golden.fallerMinVerticalVelocity,
      );
      expect(run.summary.budgetExhaustedSteps).toBe(
        golden.budgetExhaustedSteps,
      );
      expect(run.summary.skippedSteps).toBe(golden.skippedSteps);
    }
  });

  test("the golden states its tier and its immutability", () => {
    expect(golden._warning).toContain("IMMUTABLE");
    expect(golden._tier).toContain("same-runtime");
    expect(golden._tier).toContain("NOT claimed");
    expect(golden._scenario).toContain("PRIORITY_KINEMATICS");
  });
});
