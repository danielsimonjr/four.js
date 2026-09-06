/**
 * Phase 6 exit test (plan WP-6.6; §109 exit criterion; §28 joints, §33, §92
 * determinism).
 *
 * §109 closes Phase 6 on constraints that *"remain stable under expected
 * real-time loads"*. `examples/mechanism` is that claim's visible half —
 * a motorised slider–crank with a shaft, three hinges, a slider, a spring and
 * two limit switches — and `tests/browser/mechanism.spec.ts` measures it in a
 * real browser. This file is the other half of the same claim: that the joint
 * pillar underneath it is **deterministic**, in the four forms WP-1.14, WP-2.7,
 * WP-4.8 and WP-5.8 established:
 *
 * 1. **Headless.** The scenario imports `@four/physics`,
 *    `@four/physics-rapier`, `@four/math`, `@four/scene`, `@four/diagnostics`
 *    and `four/application` — no renderer package, no canvas, no DOM. As in
 *    WP-4.8 and WP-5.8 the application comes from the `four/application`
 *    subpath, so "nothing renderer-shaped is loaded" is a property of the
 *    import graph and not only of behaviour.
 * 2. **Deterministic in-process.** Two independent runs in one process — each
 *    on its own freshly constructed adapters and worlds — produce byte-identical
 *    per-step digests and identical records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state, a newly
 *    decoded pair of Rapier wasm images — running *the same helper file*
 *    reproduces the same 600 digests and matches `golden/phase6.json`.
 * 4. **Correct where correctness is checkable without re-deriving the solver.**
 *    Both motors reach the rate they were commanded; a *released* motor is not
 *    a brake (a kick given to the released 3D shaft is still there 40 steps
 *    later, and is erased inside 80 steps once the motor is re-engaged); both
 *    sliders honour their §28 limits, including the tightened ones commanded
 *    mid-run; and `removeJoint` really removed a joint — the rope's load, freed
 *    on step 500, is 15 metres below where the rope held it by step 600.
 *
 * ## The determinism tier this pins — §33, stated once, deliberately narrow
 *
 * **`same-runtime`**, exactly as in Phase 5 and for the same reasons: Rapier is
 * compiled WebAssembly, so these numbers do not depend on the host JS engine's
 * `Math` implementation, but **cross-platform determinism is NOT claimed** —
 * state crosses the JS/wasm boundary as f64 → f32 in this build, the wasm image
 * is resolved per platform by the package manager, and §33's `cross-platform`
 * tier demands evidence (a second architecture, a second engine) that this
 * suite does not gather.
 *
 * ## What the golden pins beyond four hashes
 *
 * §28's reconfiguration is exactly the kind of behaviour a hash would report as
 * an undiagnosable digest mismatch, so the golden also carries, as readable
 * numbers: joint counts **before and after** the mid-run removal; both
 * carriages' travel extrema, quantized to 1e-6 m; the limit-switch hit counts a
 * sampled switch produces (12 and 11 on the 2D carriage over ten seconds, one
 * each on the 3D one); each shaft's rate at three probes — driven, coasting,
 * re-driven; the greatest |z| the spherical bob reached (0.314878 m, a freedom
 * a `"2d"` world does not have); and the §29 tallies, which are **zero by
 * construction** because nothing in either world can touch anything, and are
 * recorded so that a future edit which lets two bodies meet shows up as a
 * number rather than as an unexplained hash change.
 *
 * ## The golden file is immutable
 *
 * `golden/phase6.json` is evidence, not configuration. **Never regenerate it to
 * make this test pass.** A mismatch is a real finding: engine or solver
 * behaviour changed between the run that produced the golden and the run under
 * test — including a Rapier version bump, which is exactly the kind of change
 * this file exists to make visible. The correct response is to identify the
 * change and decide whether it is intended, and only then, as a reviewed and
 * recorded decision (CHANGELOG.md, MEMORY.md), write new values. The per-step
 * digests exist for this diagnosis: the first index at which two runs disagree
 * localises the divergence to a step, and the two published raw checksum
 * sequences localise it to a world.
 *
 * ## Why the child process runs a `.ts` file directly, and awaits
 *
 * Identical to WP-1.14/WP-2.7/WP-4.8/WP-5.8: the in-process and fresh-process
 * runs must execute the same code, so both load `helpers/phase6-scenario.ts` —
 * Vitest through Vite, plain `node` through its default type-stripping
 * (Node ≥ 22.18; this repo pins Node ≥ 20 and runs 22.22). The child is
 * launched with `--input-type=module -e`, so there is no second runner file to
 * drift out of sync with this one, and it `await`s the scenario because both
 * Rapier builds load their wasm asynchronously. Rapier's loader also writes one
 * "using deprecated parameters" notice per dimension to **stderr**, so the
 * child's stdout stays the single JSON object this file parses;
 * `runScenarioInChildProcess` reports stderr only when the child fails.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  BODIES_2D,
  BODIES_3D,
  CARRIAGE3D_LIMIT,
  CARRIAGE3D_LIMIT_TIGHT,
  CARRIAGE3D_ORIGIN,
  CRANK_TARGET_FAST,
  FIXED_TIME_STEP,
  JOINTS_2D,
  JOINTS_3D,
  KICK_STEP,
  LIMITS_STEP,
  MOTOR_OFF_STEP,
  MOTOR_ON_STEP,
  RAIL_ORIGIN_X,
  REMOVE_STEP,
  RETARGET_STEP,
  ROPE_ANCHOR,
  SHAFT3D_TARGET_FAST,
  SLIDER_LIMIT,
  SPIN_PROBE_COASTING,
  SPIN_PROBE_DRIVEN,
  SPIN_PROBE_REDRIVEN,
  STEP_COUNT,
  SWITCH_TRAVEL,
  type Phase6ScenarioResult,
  type Phase6Summary,
  type WorldEvents,
  runPhase6Scenario,
} from "./helpers/phase6-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends Phase6Summary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/phase6.json", import.meta.url);
const HELPER_URL = new URL("./helpers/phase6-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/**
 * Generous ceiling: one 600-step two-world run is a few seconds, and a cold
 * child adds process start plus two wasm decodes.
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

/** How the summary's quantized fields convert back to metres and rad/s. */
const MICRO = 1e-6;

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
function runScenarioInChildProcess(): Phase6ScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runPhase6Scenario();\n` +
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

  return JSON.parse(child.stdout) as Phase6ScenarioResult;
}

/** Both worlds' §29 tallies, labelled, for the loop below. */
function worlds(
  result: Phase6ScenarioResult,
): readonly (readonly [string, WorldEvents])[] {
  return [
    ["2d", result.summary.events2d],
    ["3d", result.summary.events3d],
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 6 exit: two jointed mechanisms are deterministic (§109, §28, §33)", () => {
  let first: Phase6ScenarioResult;
  let second: Phase6ScenarioResult;
  let child: Phase6ScenarioResult;

  beforeAll(async () => {
    first = await runPhase6Scenario();
    second = await runPhase6Scenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 600-step schedule the golden assumes", () => {
    // Guards on the *inputs*. A scenario that quietly stopped stepping, or
    // started dropping time, could otherwise satisfy the digest tests with a
    // degenerate run — and every scripted event below names a fixed step, so a
    // changed step schedule would silently invalidate all of them.
    expect(first.frameCount).toBe(STEP_COUNT);
    expect(first.fixedStepCount).toBe(STEP_COUNT);
    expect(first.digests).toHaveLength(STEP_COUNT);
    expect(first.checksums2d).toHaveLength(STEP_COUNT);
    expect(first.checksums3d).toHaveLength(STEP_COUNT);

    // Exactly one fixed step per frame: nothing clamped, nothing dropped, and
    // no partial step left in the accumulator (§9, §10).
    expect(first.droppedTime).toBe(0);
    expect(first.maximumInterpolationAlpha).toBe(0);
    expect(
      Math.abs(first.simulationTime - STEP_COUNT * FIXED_TIME_STEP),
    ).toBeLessThanOrEqual(TIME_TOLERANCE);

    // §42: the solver wrote only the transforms it owns, and nothing else wrote
    // any. Measured, not assumed.
    expect(first.authorityWarningCount).toBe(0);

    // Not a stuck scene: every step's combined state is distinct, which two
    // continuously driven mechanisms guarantee.
    expect(new Set(first.digests).size).toBe(STEP_COUNT);

    // The published probes really are the digests they claim to be.
    expect(first.digests[0]).toBe(first.summary.firstStepDigest);
    expect(first.digests[STEP_COUNT - 1]).toBe(first.summary.lastStepDigest);

    // The scripted schedule is ordered the way every assertion below reads it.
    expect(RETARGET_STEP).toBeLessThan(LIMITS_STEP);
    expect(LIMITS_STEP).toBeLessThan(MOTOR_OFF_STEP);
    expect(MOTOR_OFF_STEP).toBeLessThan(KICK_STEP);
    expect(KICK_STEP).toBeLessThan(MOTOR_ON_STEP);
    expect(MOTOR_ON_STEP).toBeLessThan(REMOVE_STEP);
    expect(REMOVE_STEP).toBeLessThan(STEP_COUNT);
    expect(SPIN_PROBE_DRIVEN).toBeGreaterThan(RETARGET_STEP);
    expect(SPIN_PROBE_DRIVEN).toBeLessThan(MOTOR_OFF_STEP);
    expect(SPIN_PROBE_COASTING).toBeGreaterThan(KICK_STEP);
    expect(SPIN_PROBE_COASTING).toBeLessThan(MOTOR_ON_STEP);
    expect(SPIN_PROBE_REDRIVEN).toBeGreaterThan(MOTOR_ON_STEP);
    expect(SPIN_PROBE_REDRIVEN).toBeLessThan(REMOVE_STEP);
  });

  test("both solvers really ran, over the two mechanisms (§21, §28, §37)", () => {
    // Evidence that this is the two-world scenario the packet asks for rather
    // than one world hashed twice.
    expect(first.adapterName2d).toBe("rapier2d");
    expect(first.adapterName3d).toBe("rapier3d");
    expect(first.trackedWorlds).toBe(2);
    expect(first.bodyCount2d).toBe(BODIES_2D);
    expect(first.bodyCount3d).toBe(BODIES_3D);

    // One `PhysicsSystem` at §39's solve slot, before the `fixedUpdate` the
    // per-step records depend on.
    expect(first.physicsPriority).toBeGreaterThan(0);

    // The joints §28 asks for went in through the *world*, not onto a node
    // (plan P6-3), and one left each world mid-run.
    expect(first.summary.jointsBefore2d).toBe(JOINTS_2D);
    expect(first.summary.jointsBefore3d).toBe(JOINTS_3D);
    expect(first.summary.jointsAfter2d).toBe(JOINTS_2D - 1);
    expect(first.summary.jointsAfter3d).toBe(JOINTS_3D - 1);
    expect(first.jointCount2d).toBe(first.summary.jointsAfter2d);
    expect(first.jointCount3d).toBe(first.summary.jointsAfter3d);

    // §109's stability question, in its bluntest form: nothing diverged.
    expect(first.allFinite).toBe(true);
  });

  test("nothing in either world ever touched anything (§24, §28, §29)", () => {
    // The scenario's design claim, measured: static bodies carry no collider,
    // jointed pairs have §28 collision disabled, and every other body is out of
    // reach — so every number in this golden is a constraint's, never a
    // contact's. §32 sleeping is off in both worlds, hence no sleep or wake.
    for (const [label, events] of worlds(first)) {
      expect(events.collisionStartCount, label).toBe(0);
      expect(events.collisionEndCount, label).toBe(0);
      expect(events.sleepCount, label).toBe(0);
      expect(events.wakeCount, label).toBe(0);
    }
    expect(first.summary.events2d).toEqual(golden.events2d);
    expect(first.summary.events3d).toEqual(golden.events3d);
  });

  test("both motors reached the rate they were commanded (§28)", () => {
    // The 2D crank drives a closed loop against a spring, so it holds its
    // retargeted 9 rad/s to within the motor's gain-limited error: measured
    // 9.039012 rad/s at step 280 and 8.950732 at step 480.
    expect(first.summary.spin2d.drivenMicro * MICRO).toBeCloseTo(
      CRANK_TARGET_FAST,
      1,
    );
    expect(first.summary.spin2d.redrivenMicro * MICRO).toBeCloseTo(
      CRANK_TARGET_FAST,
      1,
    );
    // The unloaded 3D shaft sits exactly on its retargeted 5 rad/s.
    expect(first.summary.spin3d.drivenMicro * MICRO).toBeCloseTo(
      SHAFT3D_TARGET_FAST,
      3,
    );
  });

  test("a released motor coasts and does not brake (§28, WP-6.2-fix1)", () => {
    // The 2D mechanism gives its energy back through the spring, so a released
    // crank does not merely slow — it *reverses*: measured −3.356330 rad/s at
    // step 380, from +9 rad/s at release, and back to +8.95 once re-engaged.
    // (Any sign at all here would be consistent with "coasting"; what would not
    // be is the driven rate, and that is what this pair of assertions excludes.)
    const coasting2d = first.summary.spin2d.coastingMicro * MICRO;
    expect(Math.abs(coasting2d - CRANK_TARGET_FAST)).toBeGreaterThan(1);

    // The 3D shaft is balanced about its hinge and carries no load, so a
    // released motor leaves it exactly where it was — which is why the scenario
    // *kicks* it at step 340. A released shaft keeps the kick (measured
    // 7.307693 rad/s, i.e. +2.31 from the 0.001 N·m·s impulse), and a live
    // motor pulls it back to the target inside 80 steps (measured 5.000000).
    const coasting3d = first.summary.spin3d.coastingMicro * MICRO;
    expect(coasting3d).toBeGreaterThan(SHAFT3D_TARGET_FAST + 1);
    expect(first.summary.spin3d.redrivenMicro * MICRO).toBeCloseTo(
      SHAFT3D_TARGET_FAST,
      3,
    );
  });

  test("both sliders honoured their §28 limits, including the new ones", () => {
    // The 2D carriage is driven by the crank, not by its own motor, so its
    // travel is the crank's throw (±0.85 m) and never the slider's stops
    // (±0.95 m) — the mechanism is not fighting its own end stops, which is the
    // arrangement `examples/mechanism` documents.
    const travel2d = first.summary.switches2d;
    expect(travel2d.maxTravelMicro * MICRO).toBeLessThanOrEqual(SLIDER_LIMIT);
    expect(travel2d.minTravelMicro * MICRO).toBeGreaterThanOrEqual(
      -SLIDER_LIMIT,
    );
    expect(travel2d.maxTravelMicro * MICRO).toBeCloseTo(0.85, 2);
    expect(travel2d.minTravelMicro * MICRO).toBeCloseTo(-0.85, 2);
    // …and it reciprocated, which is what a slider–crank is for: 12 and 11
    // switch closures in ten seconds at the retargeted rate.
    expect(travel2d.leftHits).toBeGreaterThan(5);
    expect(travel2d.rightHits).toBeGreaterThan(5);
    expect(
      Math.abs(travel2d.leftHits - travel2d.rightHits),
    ).toBeLessThanOrEqual(1);
    // The switch threshold really is inside the throw, or the counters above
    // would be counting nothing.
    expect(SWITCH_TRAVEL).toBeLessThan(travel2d.maxTravelMicro * MICRO);

    // The 3D carriage is motor-driven, so it parks on its limits: +0.499752 m
    // before the reversal, −0.499755 m after it, and never past either.
    const travel3d = first.summary.switches3d;
    expect(travel3d.maxTravelMicro * MICRO).toBeLessThanOrEqual(
      CARRIAGE3D_LIMIT,
    );
    expect(travel3d.minTravelMicro * MICRO).toBeGreaterThanOrEqual(
      -CARRIAGE3D_LIMIT,
    );
    expect(travel3d.maxTravelMicro * MICRO).toBeCloseTo(CARRIAGE3D_LIMIT, 2);
    expect(travel3d.minTravelMicro * MICRO).toBeCloseTo(-CARRIAGE3D_LIMIT, 2);
    expect(travel3d.leftHits).toBe(2);
    expect(travel3d.rightHits).toBe(1);

    // And the §28 command drained: after the limits were tightened to ±0.3 the
    // carriage — which was sitting on −0.4998 — was pulled back inside them and
    // never left again (measured greatest travel afterwards: −0.278336 m).
    expect(first.summary.lateTravelMax3dMicro * MICRO).toBeLessThanOrEqual(
      CARRIAGE3D_LIMIT_TIGHT,
    );
    expect(first.summary.lateTravelMax3dMicro * MICRO).toBeGreaterThan(
      -CARRIAGE3D_LIMIT,
    );
  });

  test("the removed joint really left, and the ball joint left the plane", () => {
    // §28/§83: `removeJoint` is not breakage and not a no-op. The rope's load
    // hung 1.5 m below its anchor until step 500 and was in free fall from
    // then on — measured −12.433298 m at step 600, which is 15.4 m below the
    // anchor and 13.9 m below anything the rope could have allowed.
    const loadY = first.summary.ropeLoadEndYMicro * MICRO;
    expect(loadY).toBeLessThan(ROPE_ANCHOR.y - 5);

    // §28's spherical joint, which a `"2d"` world does not have (plan P6-1):
    // the bob swung 0.314878 m out of the XY plane — the same figure WP-6.4
    // measured for the same 1 N·s push — where a hinge about +Z would have
    // moved in z by exactly 0.
    expect(first.summary.bobMaxZMicro * MICRO).toBeGreaterThan(0.2);
    expect(Math.abs(first.bob3dEnd[2])).toBeGreaterThan(0.01);

    // The carriages ended where the summary says they did: the same numbers,
    // reached through the node transforms rather than through the samplers.
    expect(first.carriage2dEnd[0] - RAIL_ORIGIN_X).toBeGreaterThanOrEqual(
      first.summary.switches2d.minTravelMicro * MICRO,
    );
    expect(first.carriage3dEnd[0] - CARRIAGE3D_ORIGIN.x).toBeCloseTo(-0.3, 2);
  });

  test("two in-process runs produce identical digests and records", () => {
    expect(firstDivergence(second.digests, first.digests)).toBe(-1);
    expect(firstDivergence(second.checksums2d, first.checksums2d)).toBe(-1);
    expect(firstDivergence(second.checksums3d, first.checksums3d)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(second.carriage2dEnd).toEqual(first.carriage2dEnd);
    expect(second.carriage3dEnd).toEqual(first.carriage3dEnd);
    expect(second.bob3dEnd).toEqual(first.bob3dEnd);
    expect(second.fixedStepCount).toBe(first.fixedStepCount);
    expect(second.droppedTime).toBe(first.droppedTime);
  });

  test("the in-process run matches the committed golden digests", () => {
    // If this fails: DO NOT edit golden/phase6.json. See this file's header.
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);

    // …and the §33 checksums the digest is built from, unwrapped, so a failure
    // says which world moved.
    expect(first.summary.firstChecksum2d).toBe(golden.firstChecksum2d);
    expect(first.summary.lastChecksum2d).toBe(golden.lastChecksum2d);
    expect(first.summary.firstChecksum3d).toBe(golden.firstChecksum3d);
    expect(first.summary.lastChecksum3d).toBe(golden.lastChecksum3d);

    // The whole summary, including every readable number the header lists.
    expect(first.summary).toEqual({
      summaryDigest: golden.summaryDigest,
      firstStepDigest: golden.firstStepDigest,
      lastStepDigest: golden.lastStepDigest,
      firstChecksum2d: golden.firstChecksum2d,
      lastChecksum2d: golden.lastChecksum2d,
      firstChecksum3d: golden.firstChecksum3d,
      lastChecksum3d: golden.lastChecksum3d,
      jointsBefore2d: golden.jointsBefore2d,
      jointsAfter2d: golden.jointsAfter2d,
      jointsBefore3d: golden.jointsBefore3d,
      jointsAfter3d: golden.jointsAfter3d,
      switches2d: golden.switches2d,
      switches3d: golden.switches3d,
      lateTravelMax3dMicro: golden.lateTravelMax3dMicro,
      spin2d: golden.spin2d,
      spin3d: golden.spin3d,
      bobMaxZMicro: golden.bobMaxZMicro,
      ropeLoadEndYMicro: golden.ropeLoadEndYMicro,
      events2d: golden.events2d,
      events3d: golden.events3d,
    });

    // Two *different* mechanisms, not one hashed twice: unlike Phase 5's
    // mirrored halves, these worlds hold different scenes, so their §33
    // checksums differ from the very first step.
    expect(first.checksums2d[0]).not.toBe(first.checksums3d[0]);
    expect(first.checksums2d[STEP_COUNT - 1]).not.toBe(
      first.checksums3d[STEP_COUNT - 1],
    );
  });

  test("a fresh node process reproduces the same digests and the golden", () => {
    expect(firstDivergence(child.digests, first.digests)).toBe(-1);
    expect(firstDivergence(child.checksums2d, first.checksums2d)).toBe(-1);
    expect(firstDivergence(child.checksums3d, first.checksums3d)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.summary.summaryDigest).toBe(golden.summaryDigest);
    expect(child.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(child.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(child.summary.switches2d).toEqual(golden.switches2d);
    expect(child.summary.switches3d).toEqual(golden.switches3d);
    expect(child.summary.spin2d).toEqual(golden.spin2d);
    expect(child.summary.spin3d).toEqual(golden.spin3d);

    // The child ran the same simulation, not just the same hash.
    expect(child.carriage2dEnd).toEqual(first.carriage2dEnd);
    expect(child.carriage3dEnd).toEqual(first.carriage3dEnd);
    expect(child.bob3dEnd).toEqual(first.bob3dEnd);
    expect(child.fixedStepCount).toBe(first.fixedStepCount);
    expect(child.droppedTime).toBe(first.droppedTime);
    expect(child.authorityWarningCount).toBe(0);
    expect(child.allFinite).toBe(true);
    expect(child.bodyCount2d).toBe(first.bodyCount2d);
    expect(child.bodyCount3d).toBe(first.bodyCount3d);
    expect(child.jointCount2d).toBe(first.jointCount2d);
    expect(child.jointCount3d).toBe(first.jointCount3d);
  });

  test("the golden file carries its immutability warning and tier", () => {
    expect(golden._warning).toMatch(/DO NOT REGENERATE/i);
    // §33's tiers: this suite pins the initial target and says so. A golden
    // that claimed `cross-platform` would be claiming evidence nobody gathered.
    expect(golden._tier).toMatch(/same-runtime/i);
    expect(golden._tier).toMatch(/NOT claimed/i);
    expect(golden._scenario.length).toBeGreaterThan(0);
  });
});
