/**
 * Phase 10 determinism test (plan §6i P10-4, WP-10.4; §113, §33–34, §92).
 *
 * §113's exit is that *a physics defect can be captured, replayed, and inspected
 * frame by frame*; `../integration/physics-replay.test.ts` shows the whole loop
 * against real Rapier, and **this file** discharges P10-4: *"determinism golden
 * phase10 (record → replay bit-identity, cross-process)"*.
 *
 * It follows the form WP-1.14, WP-2.7, WP-4.8, WP-5.8, WP-6.6, WP-7.7 and
 * WP-9.4 established:
 *
 * 1. **Headless.** The scenario imports `@four/diagnostics`, `@four/physics`,
 *    `@four/physics-rapier`, `@four/math`, `@four/scene` and
 *    `four/application` — no renderer package, no canvas, no DOM. The
 *    `four/application` subpath keeps "nothing renderer-shaped is loaded" a
 *    property of the import graph and not only of behaviour.
 * 2. **Deterministic in-process.** Two independent runs in one process produce
 *    identical digests, identical checksum streams, and identical recordings.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state — running
 *    *the same helper file* reproduces every digest and matches
 *    `golden/phase10.json`.
 * 4. **Correct where correctness is checkable without re-deriving the engine.**
 *    The replay really replays into a fresh world; the seek really restores a
 *    snapshot and re-simulates five steps; the balls really collide; the four
 *    scripted impulses really reach the solver, live and replayed.
 *
 * ## What this golden pins that no earlier one does
 *
 * The **recording itself**. `recordingDigest` is the digest of the §34
 * document's JSON text — envelope, base64 initial snapshot, inputs, per-frame
 * step counts, eight periodic snapshots, final checksum — so a change to the
 * format, to the snapshot cadence, or to Rapier's snapshot encoding moves this
 * number and nothing else in `golden/` notices. Beside it,
 * `stepChecksumDigest` and `replayChecksumDigest` are the digests of the
 * recorded run's and the replay's per-step §33 checksum streams. **Their
 * equality is §113's exit**, and it is asserted as an equality of streams (not
 * just of digests), so a divergence names a step.
 *
 * ## The golden file is immutable
 *
 * `golden/phase10.json` is evidence, not configuration. **Never regenerate it to
 * make this test pass.** A mismatch is a real finding: something changed between
 * the run that produced the golden and the run under test. The correct response
 * is to identify the change and decide whether it is intended — and only then,
 * as a reviewed and recorded decision (CHANGELOG.md, MEMORY.md), write new
 * values.
 *
 * ## Why the child process runs a `.ts` file directly
 *
 * Identical to every phase before: the in-process and fresh-process runs must
 * execute the same code, so both load `helpers/phase10-scenario.ts` — Vitest
 * through Vite, plain `node` through its default type-stripping (Node ≥ 22.18;
 * this repo pins Node ≥ 20 and runs 22.22). The child is launched with
 * `--input-type=module -e`, importing the helper by absolute `file:` URL, so
 * there is no second runner file to drift out of sync with this one. (Rapier's
 * loader writes a deprecation notice to **stderr**; the child's stdout stays a
 * single clean JSON object.)
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  BODY_COUNT,
  FIXED_TIME_STEP,
  INPUT_SCHEDULE,
  SEED,
  SEEK_STEP,
  SNAPSHOT_COUNT,
  SNAPSHOT_INTERVAL_STEPS,
  STEP_COUNT,
  runPhase10Scenario,
  type Phase10ScenarioResult,
  type Phase10Summary,
} from "./helpers/phase10-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends Phase10Summary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/phase10.json", import.meta.url);
const HELPER_URL = new URL("./helpers/phase10-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one run is well under a second; a cold child adds start-up. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * The index of the first differing digest, or `-1` when the two arrays are
 * identical. Reported on failure so a divergence names a step rather than just a
 * mismatched summary hash.
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
function runScenarioInChildProcess(): Phase10ScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runPhase10Scenario();\n` +
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

  return JSON.parse(child.stdout) as Phase10ScenarioResult;
}

describe("Phase 10: a session records and replays bit-identically (§113, §33–34)", () => {
  let first: Phase10ScenarioResult;
  let second: Phase10ScenarioResult;
  let child: Phase10ScenarioResult;

  beforeAll(async () => {
    first = await runPhase10Scenario();
    second = await runPhase10Scenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 240-step schedule the golden assumes", () => {
    // Guards on the *inputs*. A scenario that quietly stopped stepping, or
    // started dropping time, could otherwise satisfy the digest tests with a
    // degenerate run.
    expect(first.frameCount).toBe(STEP_COUNT);
    expect(first.fixedStepCount).toBe(STEP_COUNT);
    expect(first.checksums).toHaveLength(STEP_COUNT);
    expect(first.contactsPerStep).toHaveLength(STEP_COUNT);

    // Exactly one fixed step per frame: nothing clamped, nothing dropped (§10).
    expect(first.droppedTime).toBe(0);

    // §42: nothing fought over a transform. The solver owns every dynamic body's
    // transform and nothing else writes one, so this is a measured zero.
    expect(first.authorityWarningCount).toBe(0);

    // The world under test is the one the golden describes.
    expect(first.bodyCount).toBe(BODY_COUNT);
    expect(FIXED_TIME_STEP).toBe(1 / 60);
    expect(SEED).toBe(1337);

    // Not a stuck world: every step's state is distinct.
    expect(new Set(first.checksums).size).toBe(STEP_COUNT);
  });

  test("the replay reproduces the recorded run step for step (§113 exit)", () => {
    // The whole packet, in three lines: a fresh world, driven only by the §34
    // document, walks through the same 240 states.
    expect(first.replayChecksums).toHaveLength(STEP_COUNT);
    expect(firstDivergence(first.replayChecksums, first.checksums)).toBe(-1);
    expect(first.replayVerified).toBe(true);

    // And §34's own gate agrees with the stream's last element.
    expect(first.summary.finalChecksum).toBe(first.summary.lastStepChecksum);
    expect(first.summary.replayChecksumDigest).toBe(
      first.summary.stepChecksumDigest,
    );

    // Every scripted input reached the solver, live and replayed — through the
    // same `ReplayTarget.applyInput`.
    expect(first.inputsApplied).toBe(INPUT_SCHEDULE.length);
    expect(first.replayInputsApplied).toBe(INPUT_SCHEDULE.length);
    expect(first.summary.inputCount).toBe(INPUT_SCHEDULE.length);
  });

  test("the seek restores a periodic snapshot rather than replaying from 0", () => {
    // §34's periodic snapshots exist to make this number small: reaching step
    // 155 costs 5 re-simulated steps, not 155.
    expect(first.seekStep).toBe(SEEK_STEP);
    expect(first.seekCost).toBe(SEEK_STEP - SNAPSHOT_INTERVAL_STEPS * 5);
    expect(first.seekCost).toBeLessThan(SNAPSHOT_INTERVAL_STEPS);
    expect(first.summary.snapshotCount).toBe(SNAPSHOT_COUNT);

    // And the tail it played on to is a real tail, not an empty one.
    expect(first.summary.seekTailDigest).not.toBe(0);
  });

  test("the run exercises the physics the digests are supposed to be over", () => {
    // Evidence that the digests describe a colliding, bouncing scene rather
    // than three balls falling through a ground that was never registered.
    expect(first.summary.firstContactStep).toBeGreaterThan(0);
    expect(first.summary.firstContactStep).toBeLessThan(STEP_COUNT);
    expect(first.summary.contactStepCount).toBeGreaterThan(0);
    expect(first.summary.totalContacts).toBeGreaterThan(
      first.summary.contactStepCount,
    );
    // Contacts start when the first ball lands, not on step 0.
    expect(first.contactsPerStep[0]).toBe(0);
    expect(
      first.contactsPerStep[first.summary.firstContactStep],
    ).toBeGreaterThan(0);

    // §34's identity fields are the solver that actually ran (§37).
    expect(first.summary.adapterName).toBe("rapier2d");
    expect(first.summary.adapterVersion.length).toBeGreaterThan(0);

    // The document is a real document: a frame per injected frame, eight
    // periodic snapshots, and tens of kilobytes of snapshot bytes.
    expect(first.summary.frameCount).toBe(STEP_COUNT);
    expect(first.summary.recordingLength).toBeGreaterThan(1000);
  });

  test("two in-process runs produce identical digests and streams", () => {
    expect(second.summary).toEqual(first.summary);
    expect(firstDivergence(second.checksums, first.checksums)).toBe(-1);
    expect(firstDivergence(second.replayChecksums, first.replayChecksums)).toBe(
      -1,
    );
    expect(second.contactsPerStep).toEqual(first.contactsPerStep);
    expect(second.seekCost).toBe(first.seekCost);
    expect(second.droppedTime).toBe(first.droppedTime);
  });

  test("the in-process run matches the committed golden", () => {
    // If this fails: DO NOT edit golden/phase10.json. See this file's header.
    expect(first.summary.recordingDigest).toBe(golden.recordingDigest);
    expect(first.summary.recordingLength).toBe(golden.recordingLength);
    expect(first.summary.initialSnapshotDigest).toBe(
      golden.initialSnapshotDigest,
    );
    expect(first.summary.stepChecksumDigest).toBe(golden.stepChecksumDigest);
    expect(first.summary.replayChecksumDigest).toBe(
      golden.replayChecksumDigest,
    );
    expect(first.summary.seekTailDigest).toBe(golden.seekTailDigest);
    expect(first.summary.firstStepChecksum).toBe(golden.firstStepChecksum);
    expect(first.summary.lastStepChecksum).toBe(golden.lastStepChecksum);
    expect(first.summary.finalChecksum).toBe(golden.finalChecksum);

    // The readable half of the golden: not "the hash matches" but "rapier2d
    // 0.19.3, 4 inputs, 240 frames, 8 snapshots, first contact on step 36,
    // 910 contact points over 198 steps".
    expect(first.summary.adapterName).toBe(golden.adapterName);
    expect(first.summary.adapterVersion).toBe(golden.adapterVersion);
    expect(first.summary.inputCount).toBe(golden.inputCount);
    expect(first.summary.frameCount).toBe(golden.frameCount);
    expect(first.summary.snapshotCount).toBe(golden.snapshotCount);
    expect(first.summary.firstContactStep).toBe(golden.firstContactStep);
    expect(first.summary.contactStepCount).toBe(golden.contactStepCount);
    expect(first.summary.totalContacts).toBe(golden.totalContacts);
  });

  test("a fresh node process records and replays to the same digests", () => {
    // The strongest form of the claim: a process that shares nothing with this
    // one captures the same document and replays it to the same states.
    expect(child.summary).toEqual(first.summary);
    expect(child.summary.recordingDigest).toBe(golden.recordingDigest);
    expect(child.summary.stepChecksumDigest).toBe(golden.stepChecksumDigest);
    expect(child.summary.replayChecksumDigest).toBe(
      golden.replayChecksumDigest,
    );

    // The child ran the same simulation, not just the same hash.
    expect(firstDivergence(child.checksums, first.checksums)).toBe(-1);
    expect(firstDivergence(child.replayChecksums, first.checksums)).toBe(-1);
    expect(child.contactsPerStep).toEqual(first.contactsPerStep);
    expect(child.replayVerified).toBe(true);
    expect(child.seekCost).toBe(first.seekCost);
    expect(child.droppedTime).toBe(0);
    expect(child.authorityWarningCount).toBe(0);
  });

  test("the golden file carries its immutability warning and tier", () => {
    expect(golden._warning).toMatch(/DO NOT REGENERATE/i);
    expect(golden._tier).toMatch(/same-runtime/i);
    expect(golden._scenario.length).toBeGreaterThan(0);
  });
});
