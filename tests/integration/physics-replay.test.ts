/**
 * Phase 10 replay integration (plan §6i, WP-10.4; §33–34, §113).
 *
 * §113's exit is that *a physics defect can be captured, replayed, and inspected
 * frame by frame*, and plan §6i makes that concrete as four claims. This file
 * discharges all four end to end against **real Rapier**, through the public API
 * (`four/application`, `@four/physics`, `@four/physics-rapier`,
 * `@four/diagnostics`) and with no renderer anywhere in the import graph:
 *
 * 1. **Record.** A scripted 240-step 2D scenario is captured into a §34
 *    document — initial snapshot, seed, fixed delta, inputs by step, per-frame
 *    step counts and dropped time, periodic snapshots, final checksum — and the
 *    recording is shown not to perturb the run it records.
 * 2. **Bit-identical replay.** A *fresh* world, driven by `ReplayPlayer` with
 *    `stepFn` = one `Application` fixed step, reproduces the original's §33
 *    checksum **for every step**, not merely at the end; `verifyChecksum()`
 *    agrees.
 * 3. **Snapshot restore.** A mid-run seek restores the nearest periodic snapshot
 *    and re-simulates the remainder, and stepping on from there reproduces the
 *    original checksum stream from the seek point.
 * 4. **Frame-by-frame inspection.** Single-stepping a collision window and
 *    reading `collectContactPoints` + `solverStatistics` into a
 *    `DebugDrawBuffer` yields debug geometry exactly on the §29 event steps —
 *    plus slow motion, which runs exactly a quarter of the steps at speed 0.25.
 *
 * ## What is deliberately shown to fail
 *
 * WP-10.2 states the cost of the stepping seam plainly: **nothing type-checks
 * that `stepFn` advances the same world `target` snapshots.** The last case
 * crosses the wiring on purpose and shows what that costs — a replay that runs
 * to completion without an error and reports `verifyChecksum() === false`. That
 * is the §33 signal working as designed; it is a runtime signal, not a
 * compile-time one, and pretending otherwise would be the dishonest thing to do.
 *
 * ## Why every case builds its own rig
 *
 * A replay is a statement about a world's *whole* history, so a case that reused
 * a world another case had stepped would be testing something else. Rapier's
 * wasm image is cached per process, so a fresh rig costs a `World` construction
 * and four body registrations — the whole file runs in about a second.
 */

import {
  DebugDrawBuffer,
  ReplayPlayer,
  decodeReplayRecording,
  encodeReplayRecording,
  type ReplayRecording,
  type ReplayStepEvent,
} from "@four/diagnostics";
import { beforeAll, describe, expect, test } from "vitest";

import {
  BALLS,
  BODY_COUNT,
  CONTACT_WINDOW,
  DT,
  FIRST_CONTACT_STEP,
  INPUT_SCHEDULE,
  PHYSICS_WORLD_AS_REPLAY_TARGET,
  SEED,
  SEGMENTS_PER_CONTACT,
  SNAPSHOT_COUNT,
  SNAPSHOT_INTERVAL_STEPS,
  STEP_COUNT,
  createReplayRig,
  createSolverStatistics,
  decodeImpulseInput,
  inspectStep,
  runPlainRun,
  runRecordedRun,
  type InspectedStep,
  type RecordedRun,
  type ReplayRig,
  type ScenarioRun,
} from "./helpers/replay-scenarios.js";

/** Rapier's wasm load dominates the first rig; every later one is cheap. */
const SETUP_TIMEOUT_MS = 60_000;

/**
 * The index of the first differing element, or `-1` when the two sequences are
 * identical — reported so a divergence names a *step* rather than just a failed
 * array comparison.
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

/** Builds a player over `recording` wired to `rig`'s target *and* its stepper. */
function createPlayer(
  recording: ReplayRecording,
  rig: ReplayRig,
  onStep?: (event: ReplayStepEvent) => void,
): ReplayPlayer {
  return new ReplayPlayer(recording, {
    target: rig.target,
    stepFn: (): void => {
      rig.stepOnce();
    },
    verifyChecksums: true,
    ...(onStep === undefined ? {} : { onStep }),
  });
}

describe("Phase 10: record → replay → seek → frame-step (§33–34, §113)", () => {
  let recorded: RecordedRun;
  let plain: ScenarioRun;

  beforeAll(async () => {
    recorded = await runRecordedRun();
    plain = await runPlainRun();
  }, SETUP_TIMEOUT_MS);

  describe("(1) recording a live Rapier session (§34)", () => {
    test("the run is the clean 240-step schedule every later claim assumes", () => {
      expect(recorded.fixedStepCount).toBe(STEP_COUNT);
      expect(recorded.checksums).toHaveLength(STEP_COUNT);
      expect(recorded.contactsPerStep).toHaveLength(STEP_COUNT);
      // Exactly one fixed step per frame: nothing clamped, nothing dropped.
      expect(recorded.droppedTime).toBe(0);
      // A moving simulation, not a stuck one: every step's state is distinct.
      expect(new Set(recorded.checksums).size).toBe(STEP_COUNT);
    });

    test("recording does not perturb the run it records", () => {
      // The recorder reads the target (one snapshot at `begin`, one every
      // SNAPSHOT_INTERVAL_STEPS, one checksum at `end`). If `takeSnapshot` had
      // any effect on Rapier's world, this is where it would show — and the
      // whole packet would rest on a false premise.
      expect(firstDivergence(recorded.checksums, plain.checksums)).toBe(-1);
      expect(recorded.contactsPerStep).toEqual(plain.contactsPerStep);
    });

    test("the §34 document carries what P10-2 says it carries", () => {
      const recording = recorded.recording;
      expect(recording.formatVersion).toBe(1);
      expect(recording.adapterName).toBe("rapier2d");
      expect(recording.adapterVersion.length).toBeGreaterThan(0);
      expect(recording.seed).toBe(SEED);
      expect(recording.fixedDeltaTime).toBe(DT);
      expect(recording.initialSnapshot.length).toBeGreaterThan(0);

      // One frame record per injected frame, each one fixed step, nothing
      // dropped (§10) — the step *pattern* §34 stores so replay need not
      // re-derive it from a clock.
      expect(recording.frames).toHaveLength(STEP_COUNT);
      expect(recording.frames.every((frame) => frame.stepCount === 1)).toBe(
        true,
      );
      expect(recording.frames.every((frame) => frame.droppedTime === 0)).toBe(
        true,
      );

      // Inputs, in insertion order, at the steps they were scripted for —
      // including the two that share step 20.
      expect(recording.inputs.map((input) => input.step)).toEqual(
        INPUT_SCHEDULE.map((entry) => entry.step),
      );
      expect(
        recording.inputs.map((input) => decodeImpulseInput(input.payload).body),
      ).toEqual(INPUT_SCHEDULE.map((entry) => entry.payload.body));

      // Periodic snapshots at every multiple of the cadence (§34).
      expect(recording.periodicSnapshots).toHaveLength(SNAPSHOT_COUNT);
      expect(recording.periodicSnapshots?.map((s) => s.step)).toEqual(
        Array.from(
          { length: SNAPSHOT_COUNT },
          (_, i) => (i + 1) * SNAPSHOT_INTERVAL_STEPS,
        ),
      );

      // §33's gate value, taken at the end of the last recorded frame.
      expect(recording.finalChecksum).toBe(recorded.checksums[STEP_COUNT - 1]);
    });

    test("the document survives a JSON round trip unchanged (§34)", () => {
      const text = encodeReplayRecording(recorded.recording);
      const decoded = decodeReplayRecording(text);
      expect(encodeReplayRecording(decoded)).toBe(text);
      expect(decoded.finalChecksum).toBe(recorded.recording.finalChecksum);
    });

    test("PhysicsWorld is a ReplayTarget — but cannot carry inputs (P10-1)", async () => {
      const rig = await createReplayRig();
      try {
        // The assignment is the check and the compiler already made it; this
        // states at runtime that nothing is interposed — the world *is* the
        // target, with `checksum`/`createSnapshot`/`restoreSnapshot` its own.
        const asTarget = PHYSICS_WORLD_AS_REPLAY_TARGET(rig.world);
        expect(asTarget).toBe(rig.world);
        // Read as properties rather than as bound methods, so the assertion is
        // about the shape and not about a `this` the world never loses.
        const members = asTarget as unknown as Record<string, unknown>;
        expect(typeof members.checksum).toBe("function");
        expect(typeof members.createSnapshot).toBe("function");
        expect(typeof members.restoreSnapshot).toBe("function");
        // And the one member it does not have, which is exactly why this
        // packet's scenario supplies a wrapper rather than passing the world.
        expect(members.applyInput).toBeUndefined();

        // A recording with inputs against a bare world is refused at
        // construction (§34), instead of silently dropping four impulses.
        expect(
          () =>
            new ReplayPlayer(recorded.recording, {
              target: rig.world,
              stepFn: (): void => {
                rig.stepOnce();
              },
            }),
        ).toThrow(/applyInput/);
      } finally {
        rig.dispose();
      }
    });
  });

  describe("(2) replaying into a fresh world (§33, §34)", () => {
    test("every step's checksum is bit-identical to the recorded run", async () => {
      const rig = await createReplayRig();
      try {
        const replayed: number[] = [];
        const player = createPlayer(
          recorded.recording,
          rig,
          (event: ReplayStepEvent) => {
            expect(event.resimulating).toBe(false);
            expect(event.checksum).toBeTypeOf("number");
            replayed.push(event.checksum ?? -1);
          },
        );

        // Constructed but not loaded: the target is untouched, so the fresh
        // world is still the one the rig built.
        expect(player.isLoaded).toBe(false);
        expect(player.totalSteps).toBe(STEP_COUNT);
        expect(player.totalFrames).toBe(STEP_COUNT);

        player.load();
        let steps = 0;
        while (player.stepOnce()) {
          steps += 1;
        }

        expect(steps).toBe(STEP_COUNT);
        expect(player.currentStep).toBe(STEP_COUNT);
        expect(player.isAtEnd).toBe(true);
        expect(replayed).toHaveLength(STEP_COUNT);
        // The whole claim, in one line: same steps, same numbers, all 240.
        expect(firstDivergence(replayed, recorded.checksums)).toBe(-1);
        expect(player.verifyChecksum()).toBe(true);

        // The four scripted inputs were replayed — through the same
        // `applyInput` the live run used.
        expect(rig.target.inputsApplied).toBe(INPUT_SCHEDULE.length);
      } finally {
        rig.dispose();
      }
    });

    test("load() rewinds, so a second replay reproduces the first", async () => {
      const rig = await createReplayRig();
      try {
        const first: number[] = [];
        const second: number[] = [];
        let sink = first;
        const player = createPlayer(recorded.recording, rig, (event) => {
          sink.push(event.checksum ?? -1);
        });
        player.load();
        while (player.stepOnce()) {
          /* replay */
        }
        sink = second;
        player.load();
        while (player.stepOnce()) {
          /* replay again from the initial snapshot */
        }
        expect(firstDivergence(second, first)).toBe(-1);
        expect(firstDivergence(second, recorded.checksums)).toBe(-1);
        expect(player.verifyChecksum()).toBe(true);
      } finally {
        rig.dispose();
      }
    });
  });

  describe("(3) seeking through a periodic snapshot (§34)", () => {
    test("a seek to a snapshot step costs nothing to re-simulate", async () => {
      const rig = await createReplayRig();
      try {
        const player = createPlayer(recorded.recording, rig);
        player.load();

        // Exactly on a recorded snapshot: restore, re-simulate zero steps.
        const onSnapshot = player.seekToStep(SNAPSHOT_INTERVAL_STEPS * 5);
        expect(onSnapshot).toBe(0);
        expect(player.currentStep).toBe(SNAPSHOT_INTERVAL_STEPS * 5);
        expect(rig.world.checksum()).toBe(
          recorded.checksums[SNAPSHOT_INTERVAL_STEPS * 5 - 1],
        );

        // Five steps past one: the nearest snapshot at or before the target is
        // restored and five steps are re-run — never the 155 a from-the-start
        // replay would have cost.
        const pastSnapshot = player.seekToStep(SNAPSHOT_INTERVAL_STEPS * 5 + 5);
        expect(pastSnapshot).toBe(5);
        expect(pastSnapshot).toBeLessThan(SNAPSHOT_INTERVAL_STEPS);

        // Worst case anywhere in the recording is one step short of the cadence.
        expect(player.seekToStep(SNAPSHOT_INTERVAL_STEPS * 4 - 1)).toBe(
          SNAPSHOT_INTERVAL_STEPS - 1,
        );

        // Backwards, to the very start: the initial snapshot, zero steps.
        expect(player.seekToStep(0)).toBe(0);
        expect(player.currentStep).toBe(0);
      } finally {
        rig.dispose();
      }
    });

    test("stepping on from a restored snapshot matches the original stream", async () => {
      const rig = await createReplayRig();
      try {
        const tail: number[] = [];
        const player = createPlayer(recorded.recording, rig, (event) => {
          // Re-simulated steps are marked; only the post-seek playback is the
          // claim here.
          if (!event.resimulating) {
            tail.push(event.checksum ?? -1);
          }
        });
        player.load();

        const seekTo = 155;
        const cost = player.seekToStep(seekTo);
        expect(cost).toBe(5);
        expect(tail).toHaveLength(0);

        // The restored-and-re-simulated state is the recorded state at 155.
        expect(rig.world.checksum()).toBe(recorded.checksums[seekTo - 1]);

        while (player.stepOnce()) {
          /* continue identically */
        }
        expect(tail).toHaveLength(STEP_COUNT - seekTo);
        expect(firstDivergence(tail, recorded.checksums.slice(seekTo))).toBe(
          -1,
        );
        expect(player.verifyChecksum()).toBe(true);

        // Every scripted input is at a step before the restored snapshot (150),
        // so its effect is *inside* the snapshot's bytes and none of them are
        // re-applied. Replaying an input that the snapshot already contains
        // would double it — the reason `seekToStep` re-syncs the input cursor.
        expect(INPUT_SCHEDULE.every((entry) => entry.step < 150)).toBe(true);
        expect(rig.target.inputsApplied).toBe(0);
      } finally {
        rig.dispose();
      }
    });

    test("a seek is idempotent — a scrub bar can land on the same step twice", async () => {
      const rig = await createReplayRig();
      try {
        const player = createPlayer(recorded.recording, rig);
        player.load();
        player.seekToStep(97);
        const once = rig.world.checksum();
        player.seekToStep(200);
        player.seekToStep(97);
        expect(rig.world.checksum()).toBe(once);
        expect(once).toBe(recorded.checksums[96]);
      } finally {
        rig.dispose();
      }
    });
  });

  describe("(4) frame-by-frame inspection of a collision window (§113)", () => {
    test("debug segments appear exactly on the §29 contact steps", async () => {
      const rig = await createReplayRig();
      try {
        const player = createPlayer(recorded.recording, rig);
        player.load();

        // Fast-forward to the window through the nearest snapshot, then throw
        // away everything the re-simulation dispatched: what follows must be
        // this step's contacts and no earlier step's.
        player.seekToStep(CONTACT_WINDOW.start);
        rig.drainEvents();

        const buffer = new DebugDrawBuffer();
        const statistics = createSolverStatistics();
        const inspected: InspectedStep[] = [];
        for (
          let step = CONTACT_WINDOW.start;
          step < CONTACT_WINDOW.end;
          step += 1
        ) {
          expect(player.stepOnce()).toBe(true);
          inspected.push(inspectStep(rig, step, buffer, statistics));
        }

        expect(inspected).toHaveLength(
          CONTACT_WINDOW.end - CONTACT_WINDOW.start,
        );

        for (const frame of inspected) {
          // The step really is the recorded step: frame stepping did not drift.
          expect(frame.checksum).toBe(recorded.checksums[frame.step]);
          // The manifold the replay saw is the manifold the recorded run saw.
          expect(frame.contacts).toBe(recorded.contactsPerStep[frame.step]);
          // …and the overlay drew exactly the geometry it implies: a cross at
          // `pointOnA` (3 segments) plus the contact normal (1), per contact.
          expect(frame.segments).toBe(frame.contacts * SEGMENTS_PER_CONTACT);
          expect(frame.lineCount).toBe(frame.segments);
          // §113 solver statistics, per step, from the same seam.
          expect(frame.statistics.bodyCount).toBe(BODY_COUNT);
          expect(frame.statistics.colliderCount).toBe(BODY_COUNT);
          expect(
            frame.statistics.awakeCount + frame.statistics.sleepingCount,
          ).toBe(BODY_COUNT);
        }

        // The window is not vacuous: it opens on quiet steps, then the first
        // contact lands exactly where FIRST_CONTACT_STEP says it does.
        const quiet = inspected.filter((frame) => frame.segments === 0);
        const drawn = inspected.filter((frame) => frame.segments > 0);
        expect(inspected[0].segments).toBe(0);
        expect(quiet.length).toBeGreaterThan(0);
        expect(drawn.length).toBeGreaterThan(0);
        expect(drawn[0].step).toBe(FIRST_CONTACT_STEP);
        expect(recorded.contactsPerStep[FIRST_CONTACT_STEP - 1]).toBe(0);
        expect(recorded.contactsPerStep[FIRST_CONTACT_STEP]).toBeGreaterThan(0);

        // Three balls, three landings: the window really does contain more than
        // one body's first contact.
        expect(BALLS).toHaveLength(3);
        expect(
          Math.max(...drawn.map((frame) => frame.contacts)),
        ).toBeGreaterThan(1);
      } finally {
        rig.dispose();
      }
    });

    test("slow motion runs exactly a quarter of the steps over the same time", async () => {
      const rigFull = await createReplayRig();
      const rigSlow = await createReplayRig();
      try {
        const full = createPlayer(recorded.recording, rigFull);
        const slow = createPlayer(recorded.recording, rigSlow);
        full.load();
        slow.load();
        full.play();
        slow.play();
        slow.speed = 0.25;

        // The same elapsed *real* time, delivered in the same 40 calls. Slow
        // motion is a smaller number of accumulated seconds, never a smaller
        // fixed step (§10: the fixed step is immutable).
        const calls = 40;
        let fullSteps = 0;
        let slowSteps = 0;
        for (let i = 0; i < calls; i += 1) {
          fullSteps += full.advanceRealtime(DT);
          slowSteps += slow.advanceRealtime(DT);
        }

        expect(fullSteps).toBe(calls);
        expect(slowSteps).toBe(calls / 4);
        expect(slowSteps * 4).toBe(fullSteps);
        expect(full.currentStep).toBe(calls);
        expect(slow.currentStep).toBe(calls / 4);
        // Both accumulators land exactly on a step boundary: 4 × (DT/4) is DT
        // exactly in binary floating point, so these are equalities, not
        // approximations.
        expect(full.accumulator).toBe(0);
        expect(slow.accumulator).toBe(0);
        expect(full.droppedTime).toBe(0);
        expect(slow.droppedTime).toBe(0);

        // Slower, but not different: the states are the recorded states.
        expect(rigFull.world.checksum()).toBe(recorded.checksums[calls - 1]);
        expect(rigSlow.world.checksum()).toBe(
          recorded.checksums[calls / 4 - 1],
        );

        // Paused, real time buys nothing at all (§10's pause).
        slow.pause();
        expect(slow.advanceRealtime(DT * 100)).toBe(0);
        expect(slow.currentStep).toBe(calls / 4);
      } finally {
        rigSlow.dispose();
        rigFull.dispose();
      }
    });
  });

  describe("the stepping seam's stated cost (WP-10.2)", () => {
    test("a mismatched stepFn/target pair replays cleanly and fails the checksum", async () => {
      const targetRig = await createReplayRig();
      const stepperRig = await createReplayRig();
      try {
        // The pairing nothing type-checks: snapshots and inputs go to one
        // world, the fixed steps to another.
        const player = new ReplayPlayer(recorded.recording, {
          target: targetRig.target,
          stepFn: (): void => {
            stepperRig.stepOnce();
          },
        });
        player.load();
        let steps = 0;
        while (player.stepOnce()) {
          steps += 1;
        }

        // No throw anywhere: the player has no way to notice.
        expect(steps).toBe(STEP_COUNT);
        expect(player.isAtEnd).toBe(true);
        // §33 catches it at the gate, which is the whole point of the gate.
        expect(player.verifyChecksum()).toBe(false);
        // The target never moved — it was restored, given impulses, and never
        // stepped; the impulses are still sitting in §26's command buffers.
        expect(targetRig.world.checksum()).not.toBe(
          recorded.recording.finalChecksum,
        );
      } finally {
        stepperRig.dispose();
        targetRig.dispose();
      }
    });
  });
});
