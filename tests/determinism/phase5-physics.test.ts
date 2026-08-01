/**
 * Phase 5 exit test (plan WP-5.8; §108 exit criterion; §33, §92 determinism).
 *
 * §108 closes Phase 5 on a *"mixed 2D/3D demo in which gravity, collisions,
 * impulses and sensors all go through one common API"*. `examples/physics-
 * playground` is that demo and `tests/browser/playground.spec.ts` measures it
 * in a real browser. This file is the other half of the same claim: that the
 * physics pillar underneath it is **deterministic**, in the four forms WP-1.14,
 * WP-2.7 and WP-4.8 established:
 *
 * 1. **Headless.** The scenario imports `@four/physics`,
 *    `@four/physics-rapier`, `@four/math`, `@four/scene`, `@four/diagnostics`
 *    and `four/application` — no renderer package, no canvas, no DOM. As in
 *    WP-4.8 the application comes from the `four/application` subpath, so
 *    "nothing renderer-shaped is loaded" is a property of the import graph and
 *    not only of behaviour.
 * 2. **Deterministic in-process.** Two independent runs in one process — each
 *    on its own freshly constructed adapters and worlds — produce byte-identical
 *    per-step digests and identical event records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state, a newly
 *    decoded pair of Rapier wasm images — running *the same helper file*
 *    reproduces the same 600 digests and matches `golden/phase5.json`.
 * 4. **Correct where correctness is checkable without re-deriving the solver.**
 *    Gravity is negative Y in *both* dimensions, the density-derived mass path
 *    gives area × density in 2D and volume × density in 3D, and the ball's
 *    §26 impulse arrives on the step the host script queued it for.
 *
 * ## The determinism tier this pins — §33, stated once, deliberately narrow
 *
 * **`same-runtime`.** That is §33's stated initial target and it is all this
 * file claims. Rapier is compiled WebAssembly, so unlike phases 1, 2 and 4 the
 * numbers here do not depend on the host JS engine's `Math` implementation —
 * but **cross-platform determinism is NOT claimed**: the state crosses the
 * JS/wasm boundary as f64 → f32 in this build, the wasm image is resolved per
 * platform by the package manager, and §33's `cross-platform` tier demands
 * evidence (a second architecture, a second engine) that this suite does not
 * gather. A green run here means: *this* runtime, twice in one process and once
 * in a fresh one, agrees with the recorded golden.
 *
 * ## What the golden pins beyond four hashes
 *
 * A hash says "something changed" and nothing else, and §29's event timing is
 * exactly the kind of behaviour a hash would report as an undiagnosable digest
 * mismatch. So the golden also carries, per dimension, **the fixed-step indices
 * on which the sensor fired** — `triggerenter` on steps 25 and 206,
 * `triggerexit` on 42 and 250, the same in both dimensions because the two
 * balls fall down the same line — plus collision and sleep tallies, as ordinary
 * readable numbers. When this file goes red, those numbers say whether the
 * simulation moved or merely noticed things at a different moment, before
 * anyone opens a debugger.
 *
 * They also record something worth stating out loud: the two dimensions'
 * checksums are **identical after step 1** and diverge afterwards. Nothing is
 * wrong — after one step of free fall from identical poses, a circle in a plane
 * and a sphere in a volume are in the same place with the same velocity, and z
 * is exactly 0 — so the first step is a rather good check that the two solvers
 * were handed the same scene, and every later step is where their different
 * contact solving shows.
 *
 * ## The golden file is immutable
 *
 * `golden/phase5.json` is evidence, not configuration. **Never regenerate it to
 * make this test pass.** A mismatch is a real finding: engine or solver
 * behaviour changed between the run that produced the golden and the run under
 * test — including a Rapier version bump, which is exactly the kind of change
 * this file exists to make visible. The correct response is to identify the
 * change and decide whether it is intended, and only then, as a reviewed and
 * recorded decision (CHANGELOG.md, MEMORY.md), write new values. The per-step
 * digests exist for this diagnosis: the first index at which two runs disagree
 * localises the divergence to a step, and the two published raw checksum
 * sequences localise it to a dimension.
 *
 * ## Why the child process runs a `.ts` file directly, and awaits
 *
 * Identical to WP-1.14/WP-2.7/WP-4.8: the in-process and fresh-process runs
 * must execute the same code, so both load `helpers/phase5-scenario.ts` —
 * Vitest through Vite, plain `node` through its default type-stripping
 * (Node ≥ 22.18; this repo pins Node ≥ 20 and runs 22.22). The child is
 * launched with `--input-type=module -e`, so there is no second runner file to
 * drift out of sync with this one.
 *
 * Phase 5 adds one wrinkle: **wasm**. Both Rapier builds load asynchronously,
 * so the scenario is `async` and the child `await`s it before printing, exactly
 * as the in-process runs do. Rapier's loader also writes one "using deprecated
 * parameters" notice per dimension — to **stderr**, so the child's stdout stays
 * the single JSON object this file parses. `runScenarioInChildProcess` reports
 * stderr only when the child fails.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  BALL,
  BODIES_PER_HALF,
  FIXED_TIME_STEP,
  IMPULSE,
  IMPULSE_STEP,
  PROBE_STEP_END,
  PROBE_STEP_ONE_SECOND,
  STACK,
  STEP_COUNT,
  type HalfEvents,
  type Phase5ScenarioResult,
  type Phase5Summary,
  runPhase5Scenario,
} from "./helpers/phase5-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends Phase5Summary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/phase5.json", import.meta.url);
const HELPER_URL = new URL("./helpers/phase5-scenario.ts", import.meta.url);
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

/** §25's `DEFAULT_DENSITY`, restated so the derived masses can be read here. */
const DEFAULT_DENSITY = 1;

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
function runScenarioInChildProcess(): Phase5ScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runPhase5Scenario();\n` +
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

  return JSON.parse(child.stdout) as Phase5ScenarioResult;
}

/** Both halves' event records, labelled, for the loops below. */
function halves(
  result: Phase5ScenarioResult,
): readonly (readonly [string, HalfEvents])[] {
  return [
    ["2d", result.summary.events2d],
    ["3d", result.summary.events3d],
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 5 exit: two-solver physics is deterministic (§108, §33)", () => {
  let first: Phase5ScenarioResult;
  let second: Phase5ScenarioResult;
  let child: Phase5ScenarioResult;

  beforeAll(async () => {
    first = await runPhase5Scenario();
    second = await runPhase5Scenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 600-step schedule the golden assumes", () => {
    // Guards on the *inputs*. A scenario that quietly stopped stepping, or
    // started dropping time, could otherwise satisfy the digest tests with a
    // degenerate run — and every event index below names a fixed step, so a
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

    // §42: the solver wrote only the transforms it owns, and the host script
    // wrote only the kinematic body's. Measured, not assumed.
    expect(first.authorityWarningCount).toBe(0);

    // Not a stuck scene: every step's combined state is distinct, which the
    // continuously moving kinematic sweeper guarantees even after the dynamic
    // bodies have settled and slept.
    expect(new Set(first.digests).size).toBe(STEP_COUNT);

    // The published probes really are the digests they claim to be.
    expect(first.digests[0]).toBe(first.summary.firstStepDigest);
    expect(first.digests[STEP_COUNT - 1]).toBe(first.summary.lastStepDigest);
  });

  test("both solvers really ran, over the same scene (§20, §21, §37)", () => {
    // Evidence that this is the two-dimension scenario §108 asks for rather
    // than one world hashed twice.
    expect(first.adapterName2d).toBe("rapier2d");
    expect(first.adapterName3d).toBe("rapier3d");
    expect(first.trackedWorlds).toBe(2);
    expect(first.bodyCount2d).toBe(BODIES_PER_HALF);
    expect(first.bodyCount3d).toBe(BODIES_PER_HALF);

    // One `PhysicsSystem` at §39's solve slot, before the step-9 dispatch the
    // event records below depend on.
    expect(first.physicsPriority).toBeGreaterThan(0);

    // §23: an authored mass is the mass, in both dimensions…
    expect(first.ballMass2d).toBe(BALL.mass);
    expect(first.ballMass3d).toBe(BALL.mass);

    // …and an unauthored one is derived from §25's density and the shape's
    // measure, which is *area* in 2D and *volume* in 3D — the one number in
    // this scenario that must legitimately differ between the halves.
    const side = STACK.halfExtent * 2;
    expect(first.stackMass2d).toBeCloseTo(DEFAULT_DENSITY * side * side, 5);
    expect(first.stackMass3d).toBeCloseTo(
      DEFAULT_DENSITY * side * side * side,
      5,
    );
    expect(first.stackMass2d).not.toBe(first.stackMass3d);
  });

  test("gravity, the drop, the impulse and the settle all happened (§7a, §26)", () => {
    // §7a: gravity is negative Y in *both* dimensions. The ball starts at y = 3
    // and is resting on a floor whose top is y = 0 one second later.
    for (const sample of [first.atOneSecond.twoD, first.atOneSecond.threeD]) {
      expect(sample.ball[1]).toBeLessThan(BALL.startY);
      expect(sample.ball[1]).toBeGreaterThan(0);
      expect(sample.ball[1]).toBeCloseTo(BALL.radius, 1);
      // Not launched sideways by its own fall.
      expect(sample.ball[0]).toBeCloseTo(BALL.centerX, 3);
    }

    // §26: the impulse's positive X moved each ball to the right of where it
    // landed, and it is still on the floor 400 steps later — so the impulse
    // arrived, and it arrived once.
    for (const sample of [first.atEnd.twoD, first.atEnd.threeD]) {
      expect(sample.ball[0]).toBeGreaterThan(BALL.centerX);
      expect(sample.ball[1]).toBeCloseTo(BALL.radius, 1);
    }
    expect(IMPULSE.x).toBeGreaterThan(0);
    expect(IMPULSE_STEP).toBeLessThan(STEP_COUNT);

    // §22: the kinematic sweeper pushed the stack to the right, from its start
    // at x = −1.2, without either half throwing anything off the floor.
    for (const sample of [first.atEnd.twoD, first.atEnd.threeD]) {
      expect(sample.stackBottom[0]).toBeGreaterThan(STACK.centerX);
      expect(sample.stackBottom[1]).toBeCloseTo(STACK.halfExtent, 1);
    }
    expect(PROBE_STEP_ONE_SECOND).toBeLessThan(IMPULSE_STEP);
    expect(PROBE_STEP_END).toBe(STEP_COUNT);
  });

  test("two in-process runs produce identical digests and event records", () => {
    expect(firstDivergence(second.digests, first.digests)).toBe(-1);
    expect(firstDivergence(second.checksums2d, first.checksums2d)).toBe(-1);
    expect(firstDivergence(second.checksums3d, first.checksums3d)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(second.atOneSecond).toEqual(first.atOneSecond);
    expect(second.atEnd).toEqual(first.atEnd);
    expect(second.fixedStepCount).toBe(first.fixedStepCount);
    expect(second.droppedTime).toBe(first.droppedTime);
  });

  test("the in-process run matches the committed golden digests", () => {
    // If this fails: DO NOT edit golden/phase5.json. See this file's header.
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);

    // …and the §33 checksums the digest is built from, unwrapped, so a failure
    // says which solver moved.
    expect(first.summary.firstChecksum2d).toBe(golden.firstChecksum2d);
    expect(first.summary.lastChecksum2d).toBe(golden.lastChecksum2d);
    expect(first.summary.firstChecksum3d).toBe(golden.firstChecksum3d);
    expect(first.summary.lastChecksum3d).toBe(golden.lastChecksum3d);

    // The two solvers were handed the same scene: one step of free fall from
    // identical poses leaves a circle and a sphere in the same state, z = 0
    // included, so their §33 checksums coincide exactly on step 1 (and, being
    // different contact solvers, not afterwards).
    expect(first.checksums2d[0]).toBe(first.checksums3d[0]);
    expect(first.checksums2d[STEP_COUNT - 1]).not.toBe(
      first.checksums3d[STEP_COUNT - 1],
    );
  });

  test("every §29 event fired on exactly the golden's fixed step", () => {
    // The readable half of the golden: not "the hash matches" but "the sensor
    // saw the ball enter on step 25 and leave on step 42, and saw it again on
    // 206 and 250 after the impulse threw it back up".
    expect(first.summary.events2d).toEqual(golden.events2d);
    expect(first.summary.events3d).toEqual(golden.events3d);

    for (const [label, events] of halves(first)) {
      // §29 trigger pairing, stated independently of the numbers above: the
      // ball fell through the zone once and was thrown back through it once, so
      // each entry has its own exit and they alternate.
      expect(events.triggerEnterSteps, label).toHaveLength(2);
      expect(events.triggerExitSteps, label).toHaveLength(2);
      for (let i = 0; i < events.triggerEnterSteps.length; i += 1) {
        expect(events.triggerExitSteps[i], label).toBeGreaterThan(
          events.triggerEnterSteps[i],
        );
        if (i > 0) {
          expect(events.triggerEnterSteps[i], label).toBeGreaterThan(
            events.triggerExitSteps[i - 1],
          );
        }
      }
      // The first crossing is the free fall, the second is the §26 impulse —
      // which is why the second entry is after the step that queued it.
      expect(events.triggerEnterSteps[1], label).toBeGreaterThan(IMPULSE_STEP);
      expect(events.triggerEnterSteps[0], label).toBeLessThan(IMPULSE_STEP);

      // Collisions happened, and they started when the stack settled rather
      // than at step 1 (nothing was spawned interpenetrating).
      expect(events.collisionStartCount, label).toBeGreaterThan(0);
      expect(events.firstCollisionStartStep, label).toBeGreaterThan(1);
      expect(events.lastCollisionEndStep, label).toBeLessThanOrEqual(
        STEP_COUNT,
      );
      // §32: bodies that settle go to sleep, and the impulse wakes one again.
      expect(events.sleepCount, label).toBeGreaterThan(0);
      expect(events.wakeCount, label).toBeGreaterThan(0);
    }

    // The two balls fall down the same line from the same height, so the two
    // solvers must notice them at the same fixed steps. This is the strongest
    // cross-dimension statement the scenario can make.
    expect(first.summary.events3d.triggerEnterSteps).toEqual(
      first.summary.events2d.triggerEnterSteps,
    );
    expect(first.summary.events3d.triggerExitSteps).toEqual(
      first.summary.events2d.triggerExitSteps,
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
    expect(child.summary.events2d).toEqual(golden.events2d);
    expect(child.summary.events3d).toEqual(golden.events3d);

    // The child ran the same simulation, not just the same hash.
    expect(child.atOneSecond).toEqual(first.atOneSecond);
    expect(child.atEnd).toEqual(first.atEnd);
    expect(child.fixedStepCount).toBe(first.fixedStepCount);
    expect(child.droppedTime).toBe(first.droppedTime);
    expect(child.authorityWarningCount).toBe(0);
    expect(child.bodyCount2d).toBe(first.bodyCount2d);
    expect(child.bodyCount3d).toBe(first.bodyCount3d);
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
