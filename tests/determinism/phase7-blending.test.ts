/**
 * Phase 7 exit test (plan WP-7.7; §110 exit criterion; §19 blending, §42's
 * `"blended"` authority, §33, §92 determinism).
 *
 * §110 closes Phase 7 on the claim that *"a character or machine can move
 * between animated, kinematic, and physical control without abrupt
 * discontinuities"*. `examples/blending` is that claim's visible half — a
 * three-link chain that cycles ANIMATED → RAGDOLL → RECOVERING → ANIMATED on a
 * click — and `tests/browser/blending.spec.ts` measures it in a real browser.
 * This file is the other half of the same claim: that §19's blend pipeline
 * underneath it is **deterministic**, in the four forms WP-1.14, WP-2.7, WP-4.8,
 * WP-5.8 and WP-6.6 established:
 *
 * 1. **Headless.** The scenario imports `@four/animation`, `@four/physics`,
 *    `@four/physics-rapier`, `@four/math`, `@four/scene`, `@four/diagnostics`
 *    and `four/application` — no renderer package, no canvas, no DOM. As in
 *    WP-4.8, WP-5.8 and WP-6.6 the application comes from the
 *    `four/application` subpath, so "nothing renderer-shaped is loaded" is a
 *    property of the import graph and not only of behaviour.
 * 2. **Deterministic in-process.** Two independent runs in one process — each on
 *    its own freshly constructed adapter, world and mixers — produce
 *    byte-identical per-step digests and identical records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state, a newly
 *    decoded Rapier wasm image — running *the same helper file* reproduces the
 *    same 600 digests and matches `golden/phase7.json`.
 * 4. **Correct where correctness is checkable without re-deriving §19.** Both
 *    control-mode switches actually happened (the body's §22 type changed, in
 *    place, on the step the schedule names); the §19 weight sweep's endpoints
 *    are the ones the sweep's arithmetic implies; the ragdoll activation
 *    inherited a real one-step velocity from the target history (and exactly
 *    zero from the link whose origin is the hinge, which does not translate);
 *    the chain fell metres and came back; and neither switch cost more per-step
 *    displacement than the animation was already spending.
 *
 * ## §110's criterion, and how this file states it
 *
 * The measurable form the plan fixes is: *across every control-mode switch, the
 * per-step node displacement stays bounded by a documented continuity tolerance
 * — no teleport step.* Every bound below is derived from the scenario's own
 * numbers (the animated phase's own per-step displacement, the sweep's
 * `gap / 90`, a free-fall step) and states what the reference run measured.
 *
 * There is also a sharper statement available here than any tolerance, and the
 * golden pins it: the wave loops in exactly 216 fixed steps, so if the chain
 * that comes back from the ragdoll is genuinely back on its animation, every one
 * of the 149 opening ANIMATED steps must have a **bit-identical** twin two wave
 * periods later — same published node poses *and* same solver state, on §33's
 * 1e-6 grid. It does, all 149 of them
 * ({@link Phase7Summary.digestRepeatsAtTwoWavePeriods}).
 *
 * ## What the golden pins beyond four hashes
 *
 * §19's blend is exactly the kind of behaviour a hash would report as an
 * undiagnosable digest mismatch, so the golden also carries, as readable
 * numbers: the four mode-switch steps and the §22 types either side of them; the
 * largest per-fixed-step link displacement in each of the four phases and at
 * each of the two switches, quantized to 1e-6 m; the §19 weight endpoints and
 * the per-notch change; the inherited speeds; the chain's mean height before the
 * fall, at the bottom of it, and at the end; the largest pose-to-target gap the
 * crossfade had to close; and the §29/§32 tallies — which, unlike phase 6's, are
 * **not** zero, because the ragdoll lands on a ground slab.
 *
 * ## The digest is §33's checksum *plus the published node poses*
 *
 * §33's checksum is defined over the solver's bodies, and `PhysicsWorld.checksum()`
 * is exactly that. It cannot see §19's output: during the sweep the pose
 * published onto a `"blended"` node is neither the solver's nor the animation's
 * but a weighted combination of the two, and a regression that published the raw
 * solver pose would leave every solver checksum untouched. So each step's digest
 * hashes the world checksum **and** each link node's published position and
 * rotation; the raw checksum sequence is published alongside so a divergence can
 * be localised to "the solver moved" versus "only the blend's output moved".
 *
 * ## The golden file is immutable
 *
 * `golden/phase7.json` is evidence, not configuration. **Never regenerate it to
 * make this test pass.** A mismatch is a real finding: engine or solver
 * behaviour changed between the run that produced the golden and the run under
 * test — including a Rapier version bump, which is exactly the kind of change
 * this file exists to make visible. The correct response is to identify the
 * change and decide whether it is intended, and only then, as a reviewed and
 * recorded decision (CHANGELOG.md, MEMORY.md), write new values. The per-step
 * digests exist for this diagnosis: the first index at which two runs disagree
 * localises the divergence to a step.
 *
 * ## Why the child process runs a `.ts` file directly, and awaits
 *
 * Identical to WP-1.14/WP-2.7/WP-4.8/WP-5.8/WP-6.6: the in-process and
 * fresh-process runs must execute the same code, so both load
 * `helpers/phase7-scenario.ts` — Vitest through Vite, plain `node` through its
 * default type-stripping (Node ≥ 22.18; this repo pins Node ≥ 20 and runs
 * 22.22). The child is launched with `--input-type=module -e`, so there is no
 * second runner file to drift out of sync with this one, and it `await`s the
 * scenario because Rapier loads its wasm asynchronously. Rapier's loader also
 * writes a "using deprecated parameters" notice to **stderr**, so the child's
 * stdout stays the single JSON object this file parses;
 * `runScenarioInChildProcess` reports stderr only when the child fails.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  BODY_COUNT,
  FIXED_TIME_STEP,
  JOINT_COUNT,
  LINK_COUNT,
  RAGDOLL_STEP,
  RETYPE_STEP,
  STEP_COUNT,
  SWEEP_FIRST_STEP,
  SWEEP_HOLD_STEP,
  SWEEP_LAST_STEP,
  SWEEP_STEPS,
  WAVE_PERIOD_STEPS,
  type Phase7ScenarioResult,
  type Phase7Summary,
  runPhase7Scenario,
} from "./helpers/phase7-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends Phase7Summary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/phase7.json", import.meta.url);
const HELPER_URL = new URL("./helpers/phase7-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/**
 * Generous ceiling: one 600-step run is about a second, and a cold child adds
 * process start plus a wasm decode.
 */
const RUN_TIMEOUT_MS = 180_000;

/**
 * Tolerance for the one comparison that is arithmetic rather than exact: the
 * scheduler's accumulated simulation time against `STEP_COUNT × FIXED_TIME_STEP`.
 *
 * Summing `1/60` six hundred times drifts from the exact quotient by a few ULP
 * of 10 — the measured residual is 7.6e-14. 1e-9 is four orders of magnitude
 * above that and seven below one fixed step, so it distinguishes "floating-point
 * summation" from "a step was dropped".
 */
const TIME_TOLERANCE = 1e-9;

/** How the summary's quantized fields convert back to metres and m/s. */
const MICRO = 1e-6;

/**
 * The largest per-step displacement a free-falling body could show inside the
 * ragdoll phase, in metres: `g · (150 steps · dt) · dt`.
 *
 * A ceiling on the whole physical phase that owes nothing to §19 — it is what
 * gravity alone can do in the time the phase lasts. The reference run measured
 * **0.142765 m**, i.e. a third of it, because the chain is hinged to a fixed
 * anchor and swings rather than dropping.
 */
const FREE_FALL_STEP_BOUND =
  9.81 * (RAGDOLL_STEP * FIXED_TIME_STEP) * FIXED_TIME_STEP;

/** The §19 animation weight at the sweep's first notch, in millionths. */
const SWEEP_FIRST_WEIGHT_MICRO = Math.round(1e6 / SWEEP_STEPS);

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
 * transform pipeline, no test globals, and no already-decoded wasm. It writes
 * exactly one JSON object to stdout; anything on stderr is surfaced in the
 * failure message (and ignored otherwise — see this file's header).
 */
function runScenarioInChildProcess(): Phase7ScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runPhase7Scenario();\n` +
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

  return JSON.parse(child.stdout) as Phase7ScenarioResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 7 exit: a blended chain cycling control modes is deterministic (§110, §19, §33)", () => {
  let first: Phase7ScenarioResult;
  let second: Phase7ScenarioResult;
  let child: Phase7ScenarioResult;

  beforeAll(async () => {
    first = await runPhase7Scenario();
    second = await runPhase7Scenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 600-step schedule the golden assumes", () => {
    // Guards on the *inputs*. A scenario that quietly stopped stepping, or
    // started dropping time, could otherwise satisfy the digest tests with a
    // degenerate run — and every scripted switch below names a fixed step, so a
    // changed step schedule would silently invalidate all of them.
    expect(first.frameCount).toBe(STEP_COUNT);
    expect(first.fixedStepCount).toBe(STEP_COUNT);
    expect(first.digests).toHaveLength(STEP_COUNT);
    expect(first.checksums).toHaveLength(STEP_COUNT);

    // Exactly one fixed step per frame: nothing clamped, nothing dropped, and
    // no partial step left in the accumulator (§9, §10).
    expect(first.droppedTime).toBe(0);
    expect(first.maximumInterpolationAlpha).toBe(0);
    expect(
      Math.abs(first.simulationTime - STEP_COUNT * FIXED_TIME_STEP),
    ).toBeLessThanOrEqual(TIME_TOLERANCE);

    // §42: §19's pipeline wrote the transforms it owns under `"blended"`, and
    // nothing else wrote any. Measured, not assumed.
    expect(first.authorityWarningCount).toBe(0);

    // The published probes really are the digests they claim to be.
    expect(first.digests[0]).toBe(first.summary.firstStepDigest);
    expect(first.digests[STEP_COUNT - 1]).toBe(first.summary.lastStepDigest);

    // The scripted schedule is ordered the way every assertion below reads it,
    // and the hold step really is one step of full animation weight *before*
    // the re-type — the ordering that makes switch 2 continuous.
    expect(RAGDOLL_STEP).toBeLessThan(SWEEP_FIRST_STEP);
    expect(SWEEP_LAST_STEP).toBe(SWEEP_FIRST_STEP + SWEEP_STEPS - 1);
    expect(SWEEP_HOLD_STEP).toBe(SWEEP_LAST_STEP + 1);
    expect(RETYPE_STEP).toBe(SWEEP_HOLD_STEP + 1);
    expect(RETYPE_STEP).toBeLessThan(STEP_COUNT);
  });

  test("§19's three systems ran in §39's order, over one real solver", () => {
    // Evidence that this is §19's pipeline and not a solver with a mixer
    // bolted on: the history capture runs *before* the animation that writes
    // the targets, which runs before the solve that consumes them (§39 step
    // 3 − 1, step 3, step 6).
    expect(first.capturePriority).toBeLessThan(first.animationPriority);
    expect(first.animationPriority).toBeLessThan(first.physicsPriority);

    expect(first.adapterName).toBe("rapier2d");
    expect(first.trackedWorlds).toBe(1);
    expect(first.bodyCount).toBe(BODY_COUNT);
    expect(first.jointCount).toBe(JOINT_COUNT);

    // §110's stability question, in its bluntest form: nothing diverged.
    expect(first.allFinite).toBe(true);
  });

  test("both control-mode switches happened, in place, on their scheduled steps (§22, P7-3)", () => {
    const summary = first.summary;
    expect(summary.activationStep).toBe(RAGDOLL_STEP);
    expect(summary.retypeStep).toBe(RETYPE_STEP);

    // `setBodyControlMode` re-typed the live body rather than replacing it: the
    // component's §22 type moved both ways, and the world still holds the same
    // body and joint counts afterwards (ids preserved, P7-3).
    expect(summary.typeAfterActivation).toBe("dynamic");
    expect(summary.typeAfterRetype).toBe("kinematic-position");
    expect(first.bodyCount).toBe(BODY_COUNT);
    expect(first.jointCount).toBe(JOINT_COUNT);

    // The activation inherited a real one-step velocity from the §19 history,
    // which exists only because `createPoseTargetCaptureSystem` is registered:
    // measured 0.683829 m/s on the tip link. And exactly 0 on link 0, whose
    // node origin *is* the hinge — its clip only rotates it (see the helper).
    expect(summary.inheritedSpeedAnchorMicro).toBe(0);
    expect(summary.inheritedSpeedTipMicro * MICRO).toBeGreaterThan(0.1);
    expect(summary.inheritedSpeedTipMicro * MICRO).toBeLessThan(3);
  });

  test("the §19 weight sweep ran end to end, both weights written (§19, P7-2)", () => {
    const summary = first.summary;
    expect(summary.sweepFirstStep).toBe(SWEEP_FIRST_STEP);
    expect(summary.sweepLastStep).toBe(SWEEP_LAST_STEP);

    // The first notch is `1/90` and the last is exactly 1 — and the *physics*
    // weight is the complement at both ends, which is the detail that makes the
    // published animation share exactly `w`: `normalizedWeights` divides by the
    // sum, so leaving `physicsWeight` at 1 would cap the share at ½ (WP-7.5).
    expect(summary.weightsAtSweepStart.animationMicro).toBe(
      SWEEP_FIRST_WEIGHT_MICRO,
    );
    expect(
      summary.weightsAtSweepStart.animationMicro +
        summary.weightsAtSweepStart.physicsMicro,
    ).toBe(1_000_000);
    expect(summary.weightsAtSweepEnd.animationMicro).toBe(1_000_000);
    expect(summary.weightsAtSweepEnd.physicsMicro).toBe(0);
    expect(summary.weightStepMicro).toBe(SWEEP_FIRST_WEIGHT_MICRO);
  });

  test("the chain fell metres and came back onto its wave (§19, §110)", () => {
    const summary = first.summary;
    const before = summary.chainYBeforeActivationMicro * MICRO;
    const bottom = summary.chainYAtSweepStartMicro * MICRO;
    const end = summary.chainYFinalMicro * MICRO;

    // It really collapsed: the mean link origin dropped 1.24 m between the
    // switch and the end of the physical phase (measured 1.604 → 0.360 m).
    expect(before - bottom).toBeGreaterThan(1);
    // …and it really came back: the end height is within a wave amplitude's
    // worth of the animated band it left (measured 1.547 m against 1.604 m).
    expect(Math.abs(end - before)).toBeLessThan(0.5);

    // The crossfade genuinely had metres to close, which is what makes the
    // RECOVERING bound below a measurement rather than a formality: the chain
    // blends back onto a wave that never stopped playing (measured 5.549 m).
    expect(summary.maxTargetGapMicro * MICRO).toBeGreaterThan(1);

    // §29/§32: the ragdoll met the ground slab. Unlike phase 6's tallies these
    // are non-zero on purpose, and they are pinned so that a future edit which
    // stopped the chain reaching the floor shows up as a number.
    expect(summary.events.collisionStartCount).toBeGreaterThan(0);
    expect(summary.events).toEqual(golden.events);
  });

  test("§110: no switch cost more than the animation was already spending", () => {
    const summary = first.summary;
    const animated = summary.maxStepAnimatedMicro * MICRO;

    // The ANIMATED phases are the yardstick: the wave's own largest per-step
    // link displacement, measured 0.014626 m. Both closing phases spend exactly
    // the same, because both are the same wave at full animation weight.
    expect(animated).toBeGreaterThan(0);
    expect(summary.maxStepRekinematicMicro).toBe(summary.maxStepAnimatedMicro);

    // Switch 1 — the ragdoll activation. Measured 0.009330 m, i.e. *less* than
    // an ordinary animated step: the activation hands over the velocity the
    // animation already had (§19), so the trajectory continues rather than
    // restarting. This is §110's criterion at its first switch.
    expect(
      summary.entryStepActivationMicro * MICRO,
      "the ragdoll activation moved a link further in one step than the animation ever does",
    ).toBeLessThanOrEqual(animated);

    // Switch 2 — the re-type. Measured 0.002691 m. It is small for a structural
    // reason, not a lucky one: by then the sweep has published a full step at
    // animation weight 1, so the node is already following the target alone and
    // `setBodyControlMode` can only teleport the *solver body* onto it.
    expect(
      summary.entryStepRetypeMicro * MICRO,
      "the re-type teleported the node instead of only the solver body",
    ).toBeLessThanOrEqual(animated);

    // The physical phase is bounded by what gravity alone can do in the time it
    // lasts — a bound that owes nothing to §19. Measured 0.142765 m against
    // 0.408750 m.
    expect(summary.maxStepRagdollMicro * MICRO).toBeLessThan(
      FREE_FALL_STEP_BOUND,
    );

    // The crossfade is the one phase that legitimately moves faster than the
    // animation, and its bound is the sum of the three things that move the
    // published pose during it: the weight ramp closing the gap
    // (`gap / 90` = 0.0617 m per step), the solver's own motion (≤ the physical
    // phase's own maximum), and the target's (≤ the animated maximum).
    // Measured 0.112078 m against that 0.219 m sum — and this is the number
    // `examples/blending` reports as `data-step`, so the page and the golden are
    // measuring the same quantity.
    const sweepBound =
      (summary.maxTargetGapMicro * MICRO) / SWEEP_STEPS +
      summary.maxStepRagdollMicro * MICRO +
      animated;
    expect(summary.maxStepRecoveringMicro * MICRO).toBeLessThan(sweepBound);
    expect(summary.maxStepRecoveringMicro * MICRO).toBeGreaterThan(animated);
  });

  test("§110 as an identity: the closing animation reproduces the opening one exactly", () => {
    // The wave loops in exactly 216 fixed steps, so a chain that is genuinely
    // back on its animation after the whole cycle must reproduce every opening
    // ANIMATED step — published node poses *and* solver state, on §33's 1e-6
    // grid — two periods later. All 149 of them do.
    expect(WAVE_PERIOD_STEPS).toBe(216);
    expect(first.summary.digestRepeatsAtTwoWavePeriods).toBe(RAGDOLL_STEP - 1);

    // Which is also why the run has exactly 149 repeated digests and no others:
    // everything else in it happens once.
    expect(new Set(first.digests).size).toBe(STEP_COUNT - (RAGDOLL_STEP - 1));

    // Spelled out at the level of the arrays, so a failure names steps.
    const offset = 2 * WAVE_PERIOD_STEPS;
    for (let step = 1; step < RAGDOLL_STEP; step += 1) {
      expect(
        first.digests[step - 1 + offset],
        `step ${String(step)} does not repeat at step ${String(step + offset)}`,
      ).toBe(first.digests[step - 1]);
    }
  });

  test("the blend's output is in the digest, not only the solver's state", () => {
    // The links ended where the summary says the chain did: reached through the
    // node transforms — the poses §19 published — rather than through the world
    // checksum. Link 0's origin is the hinge, so it is exactly the anchor; the
    // tip is somewhere on the wave, off to the +X side of it.
    expect(first.link0End[2]).toBe(0);
    expect(first.linkTipEnd[0]).toBeGreaterThan(first.link0End[0]);
    expect(Number.isFinite(first.linkTipEnd[1])).toBe(true);
    expect(LINK_COUNT).toBe(3);

    // The two sequences are genuinely different measurements: the digest is the
    // checksum *plus* the published poses, so it cannot equal the checksum.
    expect(first.digests[0]).not.toBe(first.checksums[0]);
    expect(first.digests[STEP_COUNT - 1]).not.toBe(
      first.checksums[STEP_COUNT - 1],
    );
  });

  test("two in-process runs produce identical digests and records", () => {
    expect(firstDivergence(second.digests, first.digests)).toBe(-1);
    expect(firstDivergence(second.checksums, first.checksums)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(second.link0End).toEqual(first.link0End);
    expect(second.linkTipEnd).toEqual(first.linkTipEnd);
    expect(second.fixedStepCount).toBe(first.fixedStepCount);
    expect(second.droppedTime).toBe(first.droppedTime);
  });

  test("the in-process run matches the committed golden digests", () => {
    // If this fails: DO NOT edit golden/phase7.json. See this file's header.
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);

    // …and the §33 checksums the digest is built from, unwrapped, so a failure
    // says whether the solver moved or only the blend's output did.
    expect(first.summary.firstChecksum).toBe(golden.firstChecksum);
    expect(first.summary.lastChecksum).toBe(golden.lastChecksum);

    // The whole summary, including every readable number the header lists.
    expect(first.summary).toEqual({
      summaryDigest: golden.summaryDigest,
      firstStepDigest: golden.firstStepDigest,
      lastStepDigest: golden.lastStepDigest,
      firstChecksum: golden.firstChecksum,
      lastChecksum: golden.lastChecksum,
      activationStep: golden.activationStep,
      sweepFirstStep: golden.sweepFirstStep,
      sweepLastStep: golden.sweepLastStep,
      retypeStep: golden.retypeStep,
      typeAfterActivation: golden.typeAfterActivation,
      typeAfterRetype: golden.typeAfterRetype,
      maxStepAnimatedMicro: golden.maxStepAnimatedMicro,
      maxStepRagdollMicro: golden.maxStepRagdollMicro,
      maxStepRecoveringMicro: golden.maxStepRecoveringMicro,
      maxStepRekinematicMicro: golden.maxStepRekinematicMicro,
      entryStepActivationMicro: golden.entryStepActivationMicro,
      entryStepRetypeMicro: golden.entryStepRetypeMicro,
      weightsAtSweepStart: golden.weightsAtSweepStart,
      weightsAtSweepEnd: golden.weightsAtSweepEnd,
      weightStepMicro: golden.weightStepMicro,
      inheritedSpeedAnchorMicro: golden.inheritedSpeedAnchorMicro,
      inheritedSpeedTipMicro: golden.inheritedSpeedTipMicro,
      chainYBeforeActivationMicro: golden.chainYBeforeActivationMicro,
      chainYAtSweepStartMicro: golden.chainYAtSweepStartMicro,
      chainYFinalMicro: golden.chainYFinalMicro,
      maxTargetGapMicro: golden.maxTargetGapMicro,
      digestRepeatsAtTwoWavePeriods: golden.digestRepeatsAtTwoWavePeriods,
      events: golden.events,
    });
  });

  test("a fresh node process reproduces the same digests and the golden", () => {
    expect(firstDivergence(child.digests, first.digests)).toBe(-1);
    expect(firstDivergence(child.checksums, first.checksums)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.summary.summaryDigest).toBe(golden.summaryDigest);
    expect(child.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(child.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(child.summary.weightsAtSweepStart).toEqual(
      golden.weightsAtSweepStart,
    );
    expect(child.summary.weightsAtSweepEnd).toEqual(golden.weightsAtSweepEnd);
    expect(child.summary.events).toEqual(golden.events);

    // The child ran the same simulation, not just the same hash.
    expect(child.link0End).toEqual(first.link0End);
    expect(child.linkTipEnd).toEqual(first.linkTipEnd);
    expect(child.fixedStepCount).toBe(first.fixedStepCount);
    expect(child.droppedTime).toBe(first.droppedTime);
    expect(child.authorityWarningCount).toBe(0);
    expect(child.allFinite).toBe(true);
    expect(child.bodyCount).toBe(first.bodyCount);
    expect(child.jointCount).toBe(first.jointCount);
    expect(child.capturePriority).toBe(first.capturePriority);
    expect(child.animationPriority).toBe(first.animationPriority);
    expect(child.physicsPriority).toBe(first.physicsPriority);
  });

  test("the golden file carries its immutability warning and tier", () => {
    expect(golden._warning).toMatch(/DO NOT REGENERATE/i);
    // §33's tiers: this suite pins the initial target and says so. A golden that
    // claimed `cross-platform` would be claiming evidence nobody gathered.
    expect(golden._tier).toMatch(/same-runtime/i);
    expect(golden._tier).toMatch(/NOT claimed/i);
    expect(golden._scenario.length).toBeGreaterThan(0);
  });
});
