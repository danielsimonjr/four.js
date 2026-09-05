/**
 * Phase 4 exit test (plan WP-4.8; §107 exit criterion; §33, §92 determinism).
 *
 * §107 closes Phase 4 on one criterion: *"tweens, timelines, and clip playback
 * are deterministic and unit tested"*. The per-package suites under
 * `packages/animation/tests/` are the "unit tested" half. This file is the
 * "deterministic" half, in the four forms WP-1.14 and WP-2.7 established:
 *
 * 1. **Headless.** The scenario imports `@four/animation`, `@four/motion`,
 *    `@four/scene`, `@four/math`, `@four/diagnostics` and `four/application` —
 *    no renderer package, no canvas, no DOM. Unlike Phase 2's scenario, which
 *    reaches `Application` through `four`'s root barrel (and whose test files
 *    that fact as a follow-up, because the barrel namespace-exports every
 *    backend package), this one takes the `four/application` subpath, so
 *    "nothing renderer-shaped is loaded" is a property of the import graph and
 *    not only of behaviour.
 * 2. **Deterministic in-process.** Two independent runs in one process produce
 *    byte-identical per-step digests and identical firing records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state — running
 *    *the same helper file* reproduces the same 1000 digests and matches
 *    `golden/phase4.json`.
 * 4. **Correct where correctness is checkable without re-deriving the engine.**
 *    §16's marker policy is a *rule*, not a curve, so the last `describe` states
 *    it directly: a seek fires only the markers that opted into replay, and
 *    advancing afterwards fires only the markers the seek did not already cross.
 *
 * ## What the golden pins beyond three hashes
 *
 * A hash says "something changed" and nothing else, and §16's marker semantics
 * are exactly the kind of behaviour that a hash would report as an undiagnosable
 * digest mismatch. So the golden also carries **the fixed-step indices on which
 * every marker and every clip event fired** — six clip events across three loop
 * iterations, two timeline markers across two — as ordinary readable numbers.
 * When this file goes red, those arrays say whether the animation moved or
 * merely fired at a different moment, before anyone opens a debugger.
 *
 * They also record something worth stating out loud: the second timeline marker
 * fires on step **199**, not the step 198 that `3.3 s ÷ (1/60)` predicts, and
 * four of the six clip events land one step later than their exact-arithmetic
 * time. Nothing is wrong — a fixed-step accumulator sums `1/60` a thousand times
 * and the sum drifts a few ULP below the exact multiple, so a marker sitting
 * exactly on a step boundary is crossed by the *next* step. That is a real,
 * reproducible property of the design and precisely the sort of thing a golden
 * exists to freeze.
 *
 * ## The golden file is immutable
 *
 * `golden/phase4.json` is evidence, not configuration. **Never regenerate it to
 * make this test pass.** A mismatch is a real finding: engine behaviour changed
 * between the run that produced the golden and the run under test. The correct
 * response is to identify the change and decide whether it is intended — and
 * only then, as a reviewed and recorded decision (CHANGELOG.md, MEMORY.md),
 * write new values. The per-step digests exist for exactly this diagnosis: the
 * first index at which two runs disagree localises the divergence to a step.
 *
 * ## Why the child process runs a `.ts` file directly
 *
 * Identical to WP-1.14 and WP-2.7: the in-process and fresh-process runs must
 * execute the same code, so both load `helpers/phase4-scenario.ts` — Vitest
 * through Vite, plain `node` through its default type-stripping (Node ≥ 22.18;
 * this repo pins Node ≥ 20 and runs 22.22). The child is launched with
 * `--input-type=module -e`, importing the helper by absolute `file:` URL, so
 * there is no second runner file to drift out of sync with this one.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  BEACON_TWEEN,
  CLIP,
  FIXED_TIME_STEP,
  PROBE_STEP_END,
  PROBE_STEP_ONE_SECOND,
  SAMPLED_QUANTITY_COUNT,
  SEEK_MARKERS,
  STEP_COUNT,
  TIMELINE,
  runMarkerSeekScenario,
  runPhase4Scenario,
  type AnimationSample,
  type Phase4ScenarioResult,
  type Phase4Summary,
} from "./helpers/phase4-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends Phase4Summary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/phase4.json", import.meta.url);
const HELPER_URL = new URL("./helpers/phase4-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one scenario run is well under a second; a cold child adds process start. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Tolerance for the one comparison that is arithmetic rather than exact: the
 * scheduler's accumulated simulation time against `STEP_COUNT × FIXED_TIME_STEP`.
 *
 * Summing `1/60` a thousand times drifts from the exact quotient by a few ULP of
 * 16.67 — the measured residual is 3.4e-13. 1e-9 is three orders of magnitude
 * above that and eleven below one fixed step, so it distinguishes "floating-point
 * summation" from "a step was dropped".
 */
const TIME_TOLERANCE = 1e-9;

// ---------------------------------------------------------------------------
// Cross-run comparison plumbing
// ---------------------------------------------------------------------------

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
function runScenarioInChildProcess(): Phase4ScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runPhase4Scenario();\n` +
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

  return JSON.parse(child.stdout) as Phase4ScenarioResult;
}

/** One sample flattened into the digest's own order, for array comparison. */
function flattenSample(sample: AnimationSample): number[] {
  return [
    ...sample.beaconPosition,
    ...sample.vaneRotation,
    sample.vaneScaleX,
    ...sample.color,
    sample.pipY,
    ...sample.drifterPosition,
    ...sample.drifterRotation,
    sample.markerCount,
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 4 exit: authored animation is deterministic (§107)", () => {
  let first: Phase4ScenarioResult;
  let second: Phase4ScenarioResult;
  let child: Phase4ScenarioResult;

  beforeAll(async () => {
    first = await runPhase4Scenario();
    second = await runPhase4Scenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 1000-step schedule the golden assumes", () => {
    // Guards on the *inputs*. A scenario that quietly stopped stepping, or
    // started dropping time, could otherwise satisfy the digest tests with a
    // degenerate run — and every marker index below names a fixed step, so a
    // changed step schedule would silently invalidate all of them.
    expect(first.frameCount).toBe(STEP_COUNT);
    expect(first.fixedStepCount).toBe(STEP_COUNT);
    expect(first.digests).toHaveLength(STEP_COUNT);

    // Exactly one fixed step per frame: nothing clamped, nothing dropped, and
    // no partial step left in the accumulator (§9, §10).
    expect(first.droppedTime).toBe(0);
    expect(first.maximumInterpolationAlpha).toBe(0);
    expect(
      Math.abs(first.simulationTime - STEP_COUNT * FIXED_TIME_STEP),
    ).toBeLessThanOrEqual(TIME_TOLERANCE);

    // §42 and §16: every animated node declared its authority before any player
    // wrote, and no two writers claimed one property. Measured, not assumed.
    expect(first.authorityWarningCount).toBe(0);

    // §39 step 3 before step 4 (plan P4-1), which is the order §19's
    // animation → kinematics → physics pipeline needs.
    expect(first.animationPriority).toBeLessThan(first.motionPriority);

    // Not a stuck scene: every step's animated state is distinct, which is only
    // possible because the vector tween never finishes.
    expect(new Set(first.digests).size).toBe(STEP_COUNT);

    // The players ended where the scenario's documentation says they do: the
    // finite clip and timeline finished and were auto-untracked (§39 teardown
    // policy, WP-4.6), the infinite tween is still running and still tracked.
    expect(first.mixerState).toBe("finished");
    expect(first.timelineState).toBe("finished");
    expect(first.tweenState).toBe("running");
    expect(first.trackedAtEnd).toBe(1);

    // The digest is over what this suite claims it is over.
    expect(flattenSample(first.atEnd)).toHaveLength(SAMPLED_QUANTITY_COUNT);
  });

  test("the run reaches every §17 track value type and every player", () => {
    // Evidence that the scenario is the one §107 asks for, rather than a hash
    // over four numbers that happen to reproduce. Each assertion names one of
    // the kinds the §107 exit criterion enumerates.
    const start = first.atOneSecond;
    const end = first.atEnd;

    // Vector: the tween moved all three components off their start values.
    for (let axis = 0; axis < 3; axis += 1) {
      expect(
        Math.abs(start.beaconPosition[axis] - BEACON_TWEEN.from[axis]),
      ).toBeGreaterThan(1e-3);
    }

    // Quaternion: `slerp` over a tilted axis leaves x exactly 0 (the axis has
    // no x component) and moves the other three.
    expect(start.vaneRotation[0]).toBe(0);
    expect(
      Math.hypot(start.vaneRotation[1], start.vaneRotation[2]),
    ).toBeGreaterThan(1e-3);

    // Scalar: the cubic track overshoots neither into nothing nor into nonsense,
    // and ends on its last keyframe because the mixer finished.
    expect(start.vaneScaleX).toBeGreaterThan(1);
    expect(end.vaneScaleX).toBeCloseTo(
      CLIP.scaleValues[CLIP.scaleValues.length - 1],
      12,
    );

    // Colour: mid-run it is between two keyframes, at the end it holds the last.
    expect(start.color[1]).toBeGreaterThan(CLIP.colorValues[0][1]);
    for (let channel = 0; channel < 4; channel += 1) {
      expect(end.color[channel]).toBeCloseTo(
        CLIP.colorValues[CLIP.colorValues.length - 1][channel],
        12,
      );
    }

    // Numeric, through the timeline's child tween: `back-out` overshoots past
    // the target, which is why this is not merely "some number moved".
    expect(start.pipY).toBeGreaterThan(TIMELINE.childTo);
    // …and the yoyo brought it exactly home before the timeline finished.
    expect(end.pipY).toBe(0);

    // The marker fired once per loop iteration and the counter is in the hash.
    expect(end.markerCount).toBe(TIMELINE.loop);
    expect(start.markerCount).toBe(0);
    expect(PROBE_STEP_ONE_SECOND).toBeLessThan(
      first.summary.markerFireSteps[0],
    );
    expect(PROBE_STEP_END).toBe(STEP_COUNT);
  });

  test("two in-process runs produce identical digests, samples and firings", () => {
    expect(firstDivergence(first.digests, second.digests)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(flattenSample(second.atOneSecond)).toEqual(
      flattenSample(first.atOneSecond),
    );
    expect(flattenSample(second.atEnd)).toEqual(flattenSample(first.atEnd));
    expect(second.markerFires).toEqual(first.markerFires);
    expect(second.clipEventFires).toEqual(first.clipEventFires);
    expect(second.fixedStepCount).toBe(first.fixedStepCount);
    expect(second.droppedTime).toBe(first.droppedTime);
  });

  test("the in-process run matches the committed golden digests", () => {
    // If this fails: DO NOT edit golden/phase4.json. See this file's header.
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);

    // The published probes really are the digests they claim to be.
    expect(first.digests[0]).toBe(first.summary.firstStepDigest);
    expect(first.digests[STEP_COUNT - 1]).toBe(first.summary.lastStepDigest);
  });

  test("every marker and clip event fired on exactly the golden's fixed step", () => {
    // The readable half of the golden: not "the hash matches" but "the marker
    // fired on step 66 and step 199, and the clip's two events fired on steps
    // 45/136/226/316/406/496, in that order, with those names".
    expect(first.summary.markerFireSteps).toEqual(golden.markerFireSteps);
    expect(first.summary.clipEventFireSteps).toEqual(golden.clipEventFireSteps);
    expect(first.summary.clipEventNames).toEqual(golden.clipEventNames);

    // Loop counting, stated independently of the numbers above: the clip's two
    // events fire once per `loop(3)` iteration, the marker once per `loop(2)`.
    expect(first.summary.clipEventFireSteps).toHaveLength(
      CLIP.events.length * CLIP.loop,
    );
    expect(first.summary.markerFireSteps).toHaveLength(TIMELINE.loop);

    // Strictly increasing, so no firing was recorded twice for one step and the
    // order in the golden is the order they actually happened in.
    for (const steps of [
      first.summary.markerFireSteps,
      first.summary.clipEventFireSteps,
    ]) {
      for (let i = 1; i < steps.length; i += 1) {
        expect(steps[i]).toBeGreaterThan(steps[i - 1]);
      }
      expect(steps[0]).toBeGreaterThanOrEqual(1);
      expect(steps[steps.length - 1]).toBeLessThanOrEqual(STEP_COUNT);
    }
  });

  test("a fresh node process reproduces the same digests and the golden", () => {
    expect(firstDivergence(child.digests, first.digests)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.summary.summaryDigest).toBe(golden.summaryDigest);
    expect(child.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(child.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(child.summary.markerFireSteps).toEqual(golden.markerFireSteps);
    expect(child.summary.clipEventFireSteps).toEqual(golden.clipEventFireSteps);

    // The child ran the same animation, not just the same hash.
    expect(flattenSample(child.atOneSecond)).toEqual(
      flattenSample(first.atOneSecond),
    );
    expect(flattenSample(child.atEnd)).toEqual(flattenSample(first.atEnd));
    expect(child.fixedStepCount).toBe(first.fixedStepCount);
    expect(child.droppedTime).toBe(first.droppedTime);
    expect(child.authorityWarningCount).toBe(0);
    expect(child.trackedAtEnd).toBe(first.trackedAtEnd);
  });

  test("the golden file carries its immutability warning and tier", () => {
    expect(golden._warning).toMatch(/DO NOT REGENERATE/i);
    expect(golden._tier).toMatch(/same-runtime/i);
    expect(golden._scenario.length).toBeGreaterThan(0);
  });
});

describe("§16 markers are suppressed by seek, and re-armed deterministically", () => {
  /** Markers with `replayOnSeek: true`, in time order. */
  const REPLAY_ON_SEEK = SEEK_MARKERS.filter((m) => m.replayOnSeek).map(
    (m) => m.name,
  );

  /** Markers a plain forward advance to the same time would have fired. */
  const CROSSED_BY_TIME = SEEK_MARKERS.filter((m) => m.at <= 2.7).map(
    (m) => m.name,
  );

  test("a seek fires only the replay-on-seek markers, and advancing then fires only the uncrossed ones", () => {
    const run = runMarkerSeekScenario();

    // The control: played straight through, every marker in the range fires, in
    // time order. Without this the two assertions below could be satisfied by a
    // timeline whose markers simply do not work.
    expect(run.playedThrough).toEqual(CROSSED_BY_TIME);

    // §16: "seek and scrubbing suppress them by default", with an opt-in
    // per-marker replay policy. The seek crosses a, b, c and d; only b and d
    // opted in.
    expect(run.duringSeek).toEqual(REPLAY_ON_SEEK);

    // …and playback resumes from where the seek left the cursor: e is the only
    // marker between 2.2 s and 2.7 s, and none of a…d fires again. This is the
    // property a mid-timeline snapshot restore (§34) depends on.
    expect(run.afterAdvance).toEqual(["e"]);
  });

  test("two runs of the seek scenario are identical", () => {
    // §33: no clock, no RNG, and markers iterated in a stable time order, so
    // the *sequence* — not merely the set — reproduces.
    const a = runMarkerSeekScenario();
    const b = runMarkerSeekScenario();
    expect(b.playedThrough).toEqual(a.playedThrough);
    expect(b.duringSeek).toEqual(a.duringSeek);
    expect(b.afterAdvance).toEqual(a.afterAdvance);
  });
});
