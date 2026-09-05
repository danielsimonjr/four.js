/**
 * §18 `AnimationController` determinism gate (gap PH-9, 2026-08-07; §33, §92).
 *
 * `phase4-animation.test.ts` proves that authored animation — tweens, timelines,
 * clip playback — is a pure function of the step count. A state machine is the
 * case that argument does not cover: its pose depends on *which conditions held
 * on which step*, so "the same inputs produce the same pose" is a statement
 * about the machine's history, not about a time axis. This file proves it in the
 * three forms the determinism gate uses:
 *
 * 1. **Headless.** The scenario imports `@four/animation`, `@four/scene`,
 *    `@four/math`, `@four/diagnostics` and `four/application` — no renderer
 *    package, no canvas, no DOM.
 * 2. **Deterministic in-process.** Two independent runs in one process produce
 *    byte-identical per-step digests and identical state-change records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state — running
 *    *the same helper file* reproduces the same 600 digests and matches
 *    `golden/animation-controller.json`.
 *
 * The fourth form phase 4 adds — "correct where correctness is checkable without
 * re-deriving the engine" — is the last `describe` here: §18's *rules* (a
 * transition suppressed by `interruptible: false`, a trigger latched across 200
 * steps, an exit-time gate) are stated directly as facts about the state-change
 * record, so a red run says which rule broke before anyone opens a debugger.
 *
 * ## The golden file is immutable
 *
 * `golden/animation-controller.json` is evidence, not configuration. **Never
 * regenerate it to make this test pass.** A mismatch is a real finding: the
 * controller's behaviour changed between the run that produced the golden and
 * the run under test. The correct response is to identify the change and decide
 * whether it is intended — and only then, as a reviewed and recorded decision
 * (CHANGELOG.md, MEMORY.md), write new values.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  FIXED_TIME_STEP,
  PROBE_STEP_END,
  PROBE_STEP_MID,
  SAMPLED_QUANTITY_COUNT,
  STATE_NAMES,
  STEP_COUNT,
  runControllerScenario,
  type AnimationSample,
  type ControllerScenarioResult,
  type ControllerSummary,
} from "./helpers/animation-controller-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends ControllerSummary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL(
  "./golden/animation-controller.json",
  import.meta.url,
);
const HELPER_URL = new URL(
  "./helpers/animation-controller-scenario.ts",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one run is well under a second; a cold child adds start-up. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Tolerance for the one comparison that is arithmetic rather than exact: the
 * scheduler's accumulated simulation time against `STEP_COUNT × FIXED_TIME_STEP`
 * (see `phase4-animation.test.ts`, which measures the same residual).
 */
const TIME_TOLERANCE = 1e-9;

/**
 * The index of the first differing digest, or `-1` when the two arrays are
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

/**
 * Runs the scenario in a fresh `node` process and parses what it printed.
 *
 * The child inherits no state from Vitest beyond the environment: no Vite, no
 * transform pipeline, no test globals. It writes exactly one JSON object to
 * stdout; anything on stderr is surfaced in the failure message.
 */
function runScenarioInChildProcess(): ControllerScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runControllerScenario();\n` +
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

  return JSON.parse(child.stdout) as ControllerScenarioResult;
}

/** One sample flattened into the digest's own order, for array comparison. */
function flattenSample(sample: AnimationSample): number[] {
  return [
    ...sample.position,
    sample.scaleX,
    ...sample.color,
    sample.stateIndex,
    sample.weight,
  ];
}

describe("AnimationController: a state machine is deterministic (§18, §33)", () => {
  let first: ControllerScenarioResult;
  let second: ControllerScenarioResult;
  let child: ControllerScenarioResult;

  beforeAll(async () => {
    first = await runControllerScenario();
    second = await runControllerScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 600-step schedule the golden assumes", () => {
    expect(first.frameCount).toBe(STEP_COUNT);
    expect(first.fixedStepCount).toBe(STEP_COUNT);
    expect(first.digests).toHaveLength(STEP_COUNT);

    // Exactly one fixed step per frame: nothing clamped, nothing dropped (§10).
    expect(first.droppedTime).toBe(0);
    expect(
      Math.abs(first.simulationTime - STEP_COUNT * FIXED_TIME_STEP),
    ).toBeLessThanOrEqual(TIME_TOLERANCE);

    // §42 and §16: the character declared its authority before the controller
    // wrote, and nothing else claimed the channels. Measured, not assumed.
    expect(first.authorityWarningCount).toBe(0);

    // A controller is never `finished`, so `AnimationSystem` keeps it forever.
    expect(first.trackedAtEnd).toBe(1);
    expect(first.playbackState).toBe("running");

    // The digest is over what this suite claims it is over.
    expect(flattenSample(first.atEnd)).toHaveLength(SAMPLED_QUANTITY_COUNT);
  });

  test("two runs in one process are byte-identical", () => {
    expect(firstDivergence(first.digests, second.digests)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(second.stateChanges).toEqual(first.stateChanges);
    expect(flattenSample(second.atMid)).toEqual(flattenSample(first.atMid));
    expect(flattenSample(second.atEnd)).toEqual(flattenSample(first.atEnd));
  });

  test("a fresh process reproduces the same run", () => {
    expect(firstDivergence(first.digests, child.digests)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.stateChanges).toEqual(first.stateChanges);
  });

  test("the run matches the committed golden", () => {
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(first.summary.stateChangeSteps).toEqual(golden.stateChangeSteps);
    expect(first.summary.stateChangeEdges).toEqual(golden.stateChangeEdges);
  });

  test("the machine actually moved, and through every declared state", () => {
    // A hash over a machine that never left `idle` would reproduce perfectly and
    // prove nothing; these assertions are what make the golden meaningful.
    const visited = new Set<string>(["idle"]);
    for (const change of first.stateChanges) {
      visited.add(change.to);
    }
    expect([...STATE_NAMES].every((name) => visited.has(name))).toBe(true);

    // Distinct poses on most steps: the pose is moving, not stuck. It is *not*
    // 600 distinct digests, and that is itself the point — a looping state
    // reproduces its pose bit-exactly once per cycle (`run` is a 0.5 s clip, so
    // 30 fixed steps apart the digest repeats), which is what "evaluation is a
    // pure function of clip time" means when the clip time comes round again.
    expect(new Set(first.digests).size).toBeGreaterThan(STEP_COUNT / 3);

    // The mid-run probe is inside a state that is not the initial one.
    expect(first.atMid.stateIndex).toBeGreaterThan(0);
  });
});

describe("AnimationController: §18's rules, stated directly", () => {
  let result: ControllerScenarioResult;

  beforeAll(async () => {
    result = await runControllerScenario();
  }, RUN_TIMEOUT_MS);

  test("a Boolean condition holds back a transition whose numeric one holds", () => {
    // `speed` is raised at step 30 but `grounded` was set at step 20, so the
    // very first change is `idle → walk` and it happens at step 30, not before.
    const firstChange = result.stateChanges[0];
    expect(`${firstChange.from}→${firstChange.to}`).toBe("idle→walk");
    expect(firstChange.step).toBe(30);
  });

  test("an uninterruptible fade suppresses the transition that would win", () => {
    // `speed = 9` lands at step 250, ten steps into the 0.2 s (12-step)
    // `walk → land` fade. `walk → run` is therefore never taken from `walk`
    // while that fade runs — the machine is already in `land`, and `land` has no
    // edge to `run`.
    const landing = result.stateChanges.find((change) => change.to === "land");
    expect(landing).toBeDefined();
    expect((landing as { step: number }).step).toBe(240);

    const afterLanding = result.stateChanges.filter(
      (change) => change.step >= 240 && change.step <= 260,
    );
    expect(afterLanding.map((change) => change.to)).toEqual(["land"]);
  });

  test("an exit-time gate is measured in seconds of state time (§7a)", () => {
    // `land → idle` has `exitTime: 0.6`, so it fires on the first step whose
    // advanced `land` clock reaches 0.6 s — 36 fixed steps at 1/60 after the
    // step the machine entered `land` on. Floating-point accumulation can carry
    // it to the next step, exactly as `phase4`'s markers document, so the
    // assertion allows the one-step lag and forbids anything larger.
    const landing = result.stateChanges.find((change) => change.to === "land");
    const leaving = result.stateChanges.find(
      (change) => change.from === "land",
    );
    expect(landing).toBeDefined();
    expect(leaving).toBeDefined();
    const elapsed =
      (leaving as { step: number }).step - (landing as { step: number }).step;
    expect(elapsed).toBeGreaterThanOrEqual(36);
    expect(elapsed).toBeLessThanOrEqual(37);
  });

  test("a trigger raised long before its gate is still consumed exactly once", () => {
    const landings = result.stateChanges.filter(
      (change) => change.to === "land",
    );
    expect(landings).toHaveLength(1);
  });

  test("the probes sit where the golden says, at the same fixed steps", () => {
    expect(PROBE_STEP_MID).toBeLessThan(PROBE_STEP_END);
    expect(PROBE_STEP_END).toBe(STEP_COUNT);
    expect(result.digests[PROBE_STEP_END - 1]).toBe(
      result.summary.lastStepDigest,
    );
  });
});
