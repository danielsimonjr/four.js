/**
 * Replay playback and inspection (§33–34, §113; plan P10-3) — the consuming
 * half of the replay format.
 *
 * `recorder.ts` turns a running session into the §34 document `replay-format.ts`
 * defines. {@link ReplayPlayer} runs that document back: restore the initial
 * state, feed the recorded inputs to the target at the exact steps they were
 * recorded for, advance the simulation one fixed step at a time, and land on the
 * recording's `finalChecksum` (§33). On top of that it adds the §113 inspection
 * controls — play/pause, single-stepping, slow motion, and seeking — so a
 * captured physics defect can be *inspected frame by frame* rather than merely
 * re-run.
 *
 * ## The stepping seam (decision, WP-10.2)
 *
 * The player does **not** own a scheduler, and it does not import one:
 * `@four/diagnostics` may depend on `core`, `math`, and `scene` only, so
 * `@four/motion`'s `Scheduler` and `four`'s `Application` are both out of reach
 * (the same dispatch-wave constraint that made {@link ReplayTarget} a duck-typed
 * contract in `recorder.ts`). That constraint turns out to describe the right
 * design anyway, so it is worth stating as a decision rather than an excuse:
 *
 * - **The player owns replay bookkeeping.** Which step is current, which inputs
 *   belong to it, which snapshot is nearest a seek target, how much real time
 *   has accumulated toward the next step, and whether the run ended on the
 *   recorded checksum.
 * - **The host owns the simulation.** The caller supplies
 *   {@link ReplayPlayerOptions.stepFn}, a closure that advances *its* world by
 *   exactly one fixed step of `fixedDeltaTime` seconds — typically
 *   `() => { app.systems.runFixedStep(...) }`, `() => world.step(dt)`, or, for
 *   an `Application`, a closure that drives the scheduler's fixed step directly.
 *
 * The player never calls `Application.step(elapsedSeconds)` and never feeds real
 * time into a scheduler, because a scheduler's accumulator would decide *how
 * many* fixed steps a frame runs — and the recording already knows: §34 stored
 * the executed step counts precisely so replay does not have to re-derive them
 * from a clock. Handing the host a one-fixed-step closure is the smallest seam
 * that keeps that authority on the player's side. A host that wants its
 * `fixedUpdate` listeners to fire during replay emits them from inside its own
 * `stepFn`; the player has no opinion about what one step contains, only about
 * when one happens.
 *
 * The honest cost of the seam, stated plainly: **the player cannot verify that
 * `stepFn` advances the same world `target` snapshots.** Nothing type-checks
 * that pairing. A mismatched pair replays without error and fails at
 * {@link ReplayPlayer.verifyChecksum}, which is exactly the signal §33 wants,
 * but it is a runtime signal, not a compile-time one.
 *
 * ## Determinism
 *
 * Replay is deterministic in the §33 sense — same runtime, same target, same
 * `stepFn` — because everything the player does is a function of the document:
 * inputs are applied by step index in recorded (insertion) order, steps are
 * counted, no wall clock is read anywhere in this module, and *no interpolation
 * or render state ever feeds back into the target* (§42). This is what makes
 * {@link ReplayPlayer.seekToStep} sound: re-simulating from a snapshot reaches
 * the same state as playing forward from the start, so the two are
 * interchangeable and the player is free to pick the cheaper one.
 */

import { FourError } from "@four/core";

import type { ReplaySnapshot, ReplayTarget } from "./recorder.js";
import {
  type ReplayRecording,
  assertReplayCompatible,
  decodeBase64,
  validateReplayRecording,
} from "./replay-format.js";

/**
 * Default clamp on fixed steps per {@link ReplayPlayer.advanceRealtime} call.
 *
 * The same number as §10's `maximumSubSteps` (Appendix A default 5) and for the
 * same reason: a long real-time gap must not turn into an unbounded burst of
 * simulation. It is re-declared here rather than imported because
 * `@four/diagnostics` cannot depend on `@four/motion`; if the Appendix A default
 * ever changes, this literal has to change with it, and nothing but this comment
 * says so.
 */
export const DEFAULT_REPLAY_MAXIMUM_SUB_STEPS = 5;

/** What {@link ReplayPlayer.onStep} receives after each replayed fixed step. */
export interface ReplayStepEvent {
  /**
   * Index of the step that just ran — the same index its inputs were recorded
   * under (§34). The first step of a recording is `0`, and
   * {@link ReplayPlayer.currentStep} is `step + 1` when the listener runs.
   */
  readonly step: number;
  /**
   * Whether this step was part of a {@link ReplayPlayer.seekToStep}
   * re-simulation rather than ordinary playback. A UI that renders every step
   * can skip the fast-forward by ignoring these.
   */
  readonly resimulating: boolean;
  /**
   * The target's §33 checksum after the step — present only while
   * {@link ReplayPlayer.verifyChecksums} is on. See that property for the cost.
   */
  readonly checksum?: number;
}

/** A {@link ReplayPlayer.onStep} listener. */
export type ReplayStepListener = (event: ReplayStepEvent) => void;

/** How a {@link ReplayPlayer} is wired to the host that owns the simulation. */
export interface ReplayPlayerOptions {
  /**
   * The simulation to replay into: it restores the recorded snapshots, receives
   * the recorded inputs, and reports the §33 checksum.
   */
  readonly target: ReplayTarget;
  /**
   * Advances the host's world by exactly one fixed step.
   *
   * Called with the recording's `fixedDeltaTime` (seconds) so the closure does
   * not have to close over it, and called once per replayed step — never with a
   * variable delta, never twice for one step. See the module note for why the
   * player asks for this instead of driving a scheduler.
   */
  readonly stepFn: (fixedDeltaTime: number) => void;
  /**
   * Clamp on fixed steps per {@link ReplayPlayer.advanceRealtime} call (§10).
   * An integer `>= 1`; default {@link DEFAULT_REPLAY_MAXIMUM_SUB_STEPS}.
   */
  readonly maximumSubSteps?: number;
  /** Initial value of {@link ReplayPlayer.verifyChecksums}. Default `false`. */
  readonly verifyChecksums?: boolean;
  /** Initial value of {@link ReplayPlayer.onStep}. */
  readonly onStep?: ReplayStepListener;
}

const STATE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * Plays a §34 replay document back into a {@link ReplayTarget}, with the §113
 * inspection controls.
 *
 * A player is a small state machine over one recording: constructed (compatible
 * with the target, but the target untouched), loaded (initial snapshot restored,
 * step 0), and then advanced by whichever control the caller prefers — all of
 * them are the same fixed steps in the same order, so they can be mixed freely:
 *
 * | Control | Advances by |
 * | --- | --- |
 * | {@link ReplayPlayer.stepOnce} | exactly one fixed step |
 * | {@link ReplayPlayer.advanceFrame} | to a recorded frame boundary (§34) |
 * | {@link ReplayPlayer.advanceRealtime} | the §10 accumulator's worth of steps |
 * | {@link ReplayPlayer.seekToStep} | to any step, forwards or backwards |
 *
 * @example
 * ```ts
 * const player = new ReplayPlayer(recording, {
 *   target: world,
 *   stepFn: (dt) => { world.step(dt); },
 * });
 * player.load();
 * while (player.stepOnce()) {
 *   // inspect world here — one fixed step at a time (§113)
 * }
 * player.verifyChecksum(); // true when the run reproduced the recording (§33)
 * ```
 */
export class ReplayPlayer {
  /**
   * Called after every replayed fixed step, including those a
   * {@link ReplayPlayer.seekToStep} re-simulates.
   *
   * Assignable after construction, in the style of `Scheduler.onFixedStep`. When
   * it is `undefined` a replayed step allocates nothing and computes no
   * checksum.
   */
  onStep: ReplayStepListener | undefined;

  /**
   * Whether {@link ReplayPlayer.onStep} events carry a per-step checksum.
   *
   * **Cost:** off (the default) a step is `applyInput?` + `stepFn` and nothing
   * else. On, every step additionally calls `target.checksum()`, which for a
   * real solver hashes the whole world — the dominant cost of the replay, easily
   * larger than the step itself. Turn it on to bisect a divergence, off to watch
   * a replay run.
   *
   * It is a *hook*, not a check: §34's envelope stores one checksum for the
   * whole run ({@link ReplayRecording.finalChecksum}), so the player has nothing
   * per-step to compare against and does not pretend otherwise. What the hook
   * buys is the ability to record two runs' per-step digests and find the first
   * step where they differ — which is how a determinism defect (§33) gets
   * located rather than merely detected.
   */
  verifyChecksums: boolean;

  /** The document being replayed, in canonical, frozen form (§34). */
  readonly recording: ReplayRecording;

  readonly #target: ReplayTarget;

  readonly #stepFn: (fixedDeltaTime: number) => void;

  readonly #maximumSubSteps: number;

  /**
   * `#frameEnds[i]` is the step index at the end of recorded frame `i`;
   * `#frameEnds[frames.length - 1]` is {@link ReplayPlayer.totalSteps}.
   * Non-decreasing, since a frame may have run zero steps (§10).
   */
  readonly #frameEnds: readonly number[];

  #loaded = false;

  #currentStep = 0;

  /** Index of the next input to consider; always `>= #currentStep` by step. */
  #inputCursor = 0;

  #playing = false;

  #speed = 1;

  #accumulator = 0;

  #droppedTime = 0;

  /**
   * Validates the pairing of recording and target, without touching either's
   * state.
   *
   * Three things are checked here rather than at the first step, so a
   * mis-wired replay fails at construction with a useful message:
   *
   * 1. the document is a valid §34 recording (it is re-validated even when it
   *    came from `decodeReplayRecording`, so a hand-built object cannot smuggle
   *    a bad field into the player — the cost is one deep copy at construction);
   * 2. §34's refusal — the recording's adapter name and version must match the
   *    target's, compared against a fresh `target.createSnapshot()` (the only
   *    way to read a target's adapter identity; the snapshot's bytes are
   *    discarded and the target is not modified);
   * 3. a recording with inputs needs a target that can apply them. `applyInput`
   *    is optional on {@link ReplayTarget} — `PhysicsWorld` does not have it —
   *    and replaying recorded inputs into a target that cannot receive them
   *    would diverge *silently*, which §42's "warn rather than silently
   *    overwrite" instinct forbids just as much here.
   *
   * @param recording the §34 document to replay
   * @param options the target, the one-step closure, and the inspection knobs
   * @throws FourError `INVALID_APPLICATION_STATE` on an adapter mismatch (§34),
   * or when the recording has inputs and the target has no `applyInput`
   * @throws FourError `SERIALIZATION_VERSION_MISMATCH` if the document's
   * `formatVersion` is not this build's
   * @throws TypeError if the document is malformed, or `stepFn` is not a
   * function
   * @throws RangeError if `maximumSubSteps` is not an integer `>= 1`
   */
  constructor(recording: ReplayRecording, options: ReplayPlayerOptions) {
    const canonical = validateReplayRecording(recording);
    const { target, stepFn } = options;
    if (typeof stepFn !== "function") {
      throw new TypeError(
        "ReplayPlayer options.stepFn must be a function advancing the host world by one fixed step.",
      );
    }
    const maximumSubSteps =
      options.maximumSubSteps ?? DEFAULT_REPLAY_MAXIMUM_SUB_STEPS;
    if (!Number.isInteger(maximumSubSteps) || maximumSubSteps < 1) {
      throw new RangeError(
        `ReplayPlayer options.maximumSubSteps must be an integer >= 1 (§10); received ${String(maximumSubSteps)}.`,
      );
    }
    assertReplayCompatible(canonical, target.createSnapshot());
    if (
      canonical.inputs.length > 0 &&
      typeof target.applyInput !== "function"
    ) {
      throw new FourError(
        STATE_ERROR_CODE,
        `Replay has ${String(canonical.inputs.length)} recorded input(s) but the target has no applyInput(step, payload); replaying it would silently drop them (§34).`,
        {
          context: {
            inputs: canonical.inputs.length,
            adapter: canonical.adapterName,
          },
        },
      );
    }

    const frameEnds: number[] = [];
    let total = 0;
    for (const frame of canonical.frames) {
      total += frame.stepCount;
      frameEnds.push(total);
    }

    this.recording = canonical;
    this.#target = target;
    this.#stepFn = stepFn;
    this.#maximumSubSteps = maximumSubSteps;
    this.#frameEnds = frameEnds;
    this.verifyChecksums = options.verifyChecksums ?? false;
    this.onStep = options.onStep;
  }

  /** The recording's fixed simulation step, in seconds (§10). */
  get fixedDeltaTime(): number {
    return this.recording.fixedDeltaTime;
  }

  /**
   * Steps in the recording — the sum of every recorded frame's `stepCount`
   * (§34), and the step index at which the run's `finalChecksum` was taken.
   */
  get totalSteps(): number {
    return this.#frameEnds.length === 0
      ? 0
      : this.#frameEnds[this.#frameEnds.length - 1];
  }

  /** Recorded frames (§34). */
  get totalFrames(): number {
    return this.#frameEnds.length;
  }

  /** Steps replayed so far; `0` immediately after {@link ReplayPlayer.load}. */
  get currentStep(): number {
    return this.#currentStep;
  }

  /**
   * Recorded frames fully replayed so far.
   *
   * A frame counts as completed once every one of its steps has run, so a frame
   * that recorded zero steps (§10 runs none when the accumulator is short)
   * completes as soon as the player reaches its boundary.
   */
  get framesCompleted(): number {
    return this.#frameIndexAfter(this.#currentStep);
  }

  /** Whether {@link ReplayPlayer.load} has run; the other controls require it. */
  get isLoaded(): boolean {
    return this.#loaded;
  }

  /** Whether every recorded step has been replayed. */
  get isAtEnd(): boolean {
    return this.#currentStep >= this.totalSteps;
  }

  /** Whether {@link ReplayPlayer.advanceRealtime} is advancing time (§10 pause). */
  get isPlaying(): boolean {
    return this.#playing;
  }

  /**
   * Playback rate for {@link ReplayPlayer.advanceRealtime}: `0.25` is quarter
   * speed (§113 slow motion), `1` real time, `4` fast-forward.
   *
   * This is `timeScale` on the *replay clock* (P10-3), not on the simulation:
   * the fixed step never changes, only how much recorded time one second of real
   * time is worth. `0` is legal and freezes playback while leaving
   * {@link ReplayPlayer.isPlaying} true; negative values are rejected, because
   * running the recorded steps backwards is not something a solver can do — step
   * backwards with {@link ReplayPlayer.seekToStep}, which re-simulates.
   *
   * @throws RangeError if set to anything but a finite number `>= 0`
   */
  get speed(): number {
    return this.#speed;
  }

  set speed(value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `ReplayPlayer.speed must be a finite number >= 0 (got ${String(value)}); use seekToStep to move backwards.`,
      );
    }
    this.#speed = value;
  }

  /** The §10 clamp on steps per {@link ReplayPlayer.advanceRealtime} call. */
  get maximumSubSteps(): number {
    return this.#maximumSubSteps;
  }

  /**
   * Real time accumulated toward the next step, in seconds; always
   * `< fixedDeltaTime` except immediately after a clamp (§10).
   */
  get accumulator(): number {
    return this.#accumulator;
  }

  /**
   * Replay time the `maximumSubSteps` clamp discarded since
   * {@link ReplayPlayer.load}, in seconds — §10's `TimeState.droppedTime` for
   * the replay clock.
   *
   * Time that arrives after the recording is exhausted is *not* counted: there
   * is nothing left to simulate, so nothing was dropped.
   */
  get droppedTime(): number {
    return this.#droppedTime;
  }

  /**
   * The §10 interpolation alpha of the replay clock, in `[0, 1]` — how far the
   * accumulator sits between the last replayed step and the next.
   *
   * Offered for a host that renders an interpolated pose while scrubbing (§43).
   * Like every other alpha it must never feed back into simulation state (§42).
   */
  get interpolationAlpha(): number {
    // The accumulator is never negative (it starts at 0 and only ever has whole
    // fixed steps taken out of it), so only the upper bound needs guarding —
    // and only against a division rounding a hair above 1 at the clamp.
    return Math.min(this.#accumulator / this.recording.fixedDeltaTime, 1);
  }

  /**
   * Restores the recording's initial snapshot and rewinds to step 0.
   *
   * Idempotent: calling it twice restores the same bytes and leaves the same
   * state, so it doubles as "restart this replay". It resets the replay clock
   * (accumulator and {@link ReplayPlayer.droppedTime}) but deliberately **does
   * not** touch {@link ReplayPlayer.isPlaying} or {@link ReplayPlayer.speed}
   * (decision, WP-10.2): those describe the *transport the caller is operating*,
   * not the recording, and a looping player that had to re-press play after
   * every rewind would be the surprising design.
   */
  load(): void {
    this.#target.restoreSnapshot(
      this.#snapshotAt(this.recording.initialSnapshot),
    );
    this.#loaded = true;
    this.#currentStep = 0;
    this.#inputCursor = 0;
    this.#accumulator = 0;
    this.#droppedTime = 0;
  }

  /**
   * Replays exactly one fixed step: the inputs recorded for the current step are
   * applied first, in insertion order, then `stepFn` runs (§34).
   *
   * **At the end of the recording this is a no-op returning `false`, not a
   * throw** (decision, WP-10.2). Reaching the end is the *expected* outcome of a
   * replay, not a misuse: `while (player.stepOnce()) { … }` is the natural
   * inspection loop, and it only reads that way if the terminal call is
   * ordinary. Misuse — stepping a player that was never loaded — still throws.
   *
   * @returns whether a step ran
   * @throws FourError `INVALID_APPLICATION_STATE` if {@link ReplayPlayer.load}
   * has not run
   */
  stepOnce(): boolean {
    this.#requireLoaded("stepOnce");
    if (this.#currentStep >= this.totalSteps) {
      return false;
    }
    this.#runStep(false);
    return true;
  }

  /**
   * Replays whole recorded frames — the §113 "frame by frame" control.
   *
   * With no argument it advances to the next frame boundary at or after the
   * current step, finishing a partially replayed frame rather than running a
   * whole extra one. With a `frameIndex` it advances to the end of that frame,
   * which may be several frames ahead.
   *
   * A frame is §34's record of one *rendered* frame: the fixed steps §10's
   * accumulator ran for it, which is `0` when the frame was short and up to
   * `maximumSubSteps` when it was long. Advancing by frames therefore replays
   * the run's original step *pattern*, which is what a defect that only appears
   * on a long frame needs.
   *
   * @param frameIndex the frame to stop at the end of; omit for the next one
   * @returns fixed steps replayed (`0` at the end of the recording, or when the
   * requested frame ends exactly where the player already is)
   * @throws FourError `INVALID_APPLICATION_STATE` if not loaded
   * @throws RangeError if `frameIndex` is not an index of a recorded frame, or
   * names a frame that ended before the current step — advancing never goes
   * backwards; {@link ReplayPlayer.seekToStep} does
   */
  advanceFrame(frameIndex?: number): number {
    this.#requireLoaded("advanceFrame");
    let target: number;
    if (frameIndex === undefined) {
      const next = this.#frameIndexAfter(this.#currentStep);
      if (next >= this.#frameEnds.length) {
        return 0;
      }
      target = this.#frameEnds[next];
    } else {
      if (
        !Number.isInteger(frameIndex) ||
        frameIndex < 0 ||
        frameIndex >= this.#frameEnds.length
      ) {
        throw new RangeError(
          `ReplayPlayer.advanceFrame frameIndex must be an integer in [0, ${String(this.#frameEnds.length - 1)}] (got ${String(frameIndex)}).`,
        );
      }
      target = this.#frameEnds[frameIndex];
      if (target < this.#currentStep) {
        throw new RangeError(
          `ReplayPlayer.advanceFrame cannot go backwards: frame ${String(frameIndex)} ends at step ${String(target)} and the player is at step ${String(this.#currentStep)}; use seekToStep.`,
        );
      }
    }
    let steps = 0;
    while (this.#currentStep < target) {
      this.#runStep(false);
      steps += 1;
    }
    return steps;
  }

  /** Starts (or resumes) {@link ReplayPlayer.advanceRealtime} playback. */
  play(): void {
    this.#playing = true;
  }

  /**
   * Pauses playback: {@link ReplayPlayer.advanceRealtime} stops accumulating and
   * runs no steps, exactly as §10's pause is `timeScale = 0` for the frame.
   *
   * The accumulator is left as it is, so resuming continues from the same
   * fraction of a step rather than snapping to a boundary. The explicit controls
   * ({@link ReplayPlayer.stepOnce}, {@link ReplayPlayer.advanceFrame},
   * {@link ReplayPlayer.seekToStep}) keep working while paused — that is the
   * point of pausing.
   */
  pause(): void {
    this.#playing = false;
  }

  /**
   * Advances playback by `elapsedSeconds` of the host's real time, running
   * whole fixed steps out of §10's accumulator.
   *
   * The rules, mirroring `Scheduler.step` so a replayed run behaves like a live
   * one, and reported here because a caller counting steps deserves to know them:
   *
   * 1. **Paused ⇒ nothing.** No accumulation, no steps, `0` returned. Real time
   *    spent paused is not owed to the replay later.
   * 2. **Scaled accumulation.** `accumulator += elapsedSeconds * speed`. Slow
   *    motion is a smaller number of accumulated seconds, never a smaller fixed
   *    step (§10: the fixed step is immutable).
   * 3. **Whole steps only,** while `accumulator >= fixedDeltaTime`, at most
   *    {@link ReplayPlayer.maximumSubSteps} of them per call, and never past the
   *    end of the recording.
   * 4. **The clamp.** If steps remain owed after the sub-step limit, the excess
   *    beyond one fixed step is added to {@link ReplayPlayer.droppedTime} and the
   *    accumulator is pinned at `fixedDeltaTime` (alpha 1) — §10's bound on how
   *    far a single call can fall behind, so a debugger pause in the middle of an
   *    inspection session does not produce a burst of simulation afterwards.
   * 5. **End of recording.** When the last step has run, the accumulator is
   *    cleared instead of clamped: leftover real time is not *dropped*
   *    simulation, there is simply no more recording, and counting it as
   *    `droppedTime` would misreport a finished replay as a stuttering one.
   *
   * @param elapsedSeconds real time since the previous call, in seconds
   * @param speed per-call override of {@link ReplayPlayer.speed}; the property
   * itself is unchanged
   * @returns fixed steps replayed by this call
   * @throws FourError `INVALID_APPLICATION_STATE` if not loaded
   * @throws RangeError if either number is not finite and `>= 0`
   */
  advanceRealtime(elapsedSeconds: number, speed = this.#speed): number {
    this.#requireLoaded("advanceRealtime");
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
      throw new RangeError(
        `ReplayPlayer.advanceRealtime elapsedSeconds must be a finite number of seconds >= 0 (got ${String(elapsedSeconds)}).`,
      );
    }
    if (!Number.isFinite(speed) || speed < 0) {
      throw new RangeError(
        `ReplayPlayer.advanceRealtime speed must be a finite number >= 0 (got ${String(speed)}).`,
      );
    }
    if (!this.#playing) {
      return 0;
    }
    const fixedDeltaTime = this.recording.fixedDeltaTime;
    const totalSteps = this.totalSteps;
    this.#accumulator += elapsedSeconds * speed;

    let steps = 0;
    while (
      this.#accumulator >= fixedDeltaTime &&
      steps < this.#maximumSubSteps &&
      this.#currentStep < totalSteps
    ) {
      this.#runStep(false);
      this.#accumulator -= fixedDeltaTime;
      steps += 1;
    }

    if (this.#currentStep >= totalSteps) {
      this.#accumulator = 0;
    } else if (this.#accumulator >= fixedDeltaTime) {
      this.#droppedTime += this.#accumulator - fixedDeltaTime;
      this.#accumulator = fixedDeltaTime;
    }
    return steps;
  }

  /**
   * Moves to any step of the recording, forwards or backwards, by restoring the
   * nearest snapshot at or before it and re-simulating the remainder (§34).
   *
   * The snapshot chosen is the last periodic snapshot whose step is `<= step`,
   * or the initial snapshot when there is none — so with a recorder configured
   * for `snapshotIntervalSteps: N`, a seek costs fewer than `N` steps of
   * re-simulation instead of up to `totalSteps` of it. That is the entire reason
   * §34 has periodic snapshots, and the reason the player prefers them even when
   * seeking *forwards*.
   *
   * Seeking always restores, even for a forward seek the player could reach by
   * simply stepping (decision, WP-10.2). The player does not assume the target's
   * live state is the state the recording says it should be: the host owns that
   * world and may have poked it between calls, and a seek that silently kept a
   * poked state would report a divergence at the wrong step. Restoring is also
   * what makes the operation *idempotent*, which a scrub bar needs.
   *
   * Re-simulation applies the recorded inputs exactly as playback does, so by
   * §33 the state reached is the state playback would have reached.
   *
   * @param step the target step, in `[0, totalSteps]`
   * @returns fixed steps re-simulated — the cost of the seek, and what a test
   * asserts on to prove the nearest snapshot was used
   * @throws FourError `INVALID_APPLICATION_STATE` if not loaded
   * @throws RangeError if `step` is not an integer in `[0, totalSteps]`
   */
  seekToStep(step: number): number {
    this.#requireLoaded("seekToStep");
    const totalSteps = this.totalSteps;
    if (!Number.isInteger(step) || step < 0 || step > totalSteps) {
      throw new RangeError(
        `ReplayPlayer.seekToStep step must be an integer in [0, ${String(totalSteps)}] (got ${String(step)}).`,
      );
    }

    let restoreFrom = this.recording.initialSnapshot;
    let restoredStep = 0;
    const snapshots = this.recording.periodicSnapshots;
    if (snapshots !== undefined) {
      // Snapshots are validated as strictly ascending by step (§34), so the last
      // one at or before the target is the nearest one.
      for (const snapshot of snapshots) {
        if (snapshot.step > step) {
          break;
        }
        restoreFrom = snapshot.data;
        restoredStep = snapshot.step;
      }
    }

    this.#target.restoreSnapshot(this.#snapshotAt(restoreFrom));
    this.#currentStep = restoredStep;
    this.#syncInputCursor();
    this.#accumulator = 0;

    let steps = 0;
    while (this.#currentStep < step) {
      this.#runStep(true);
      steps += 1;
    }
    return steps;
  }

  /**
   * §33's gate: does the replayed run end on the checksum the recording ended
   * on?
   *
   * Only meaningful at the end of the recording — that is the one step index
   * §34 stored a checksum for — so calling it early is a usage error rather than
   * a `false`, which would be indistinguishable from a real divergence.
   *
   * @returns whether `target.checksum()` equals the recording's `finalChecksum`
   * @throws FourError `INVALID_APPLICATION_STATE` if not loaded, or if the
   * player has not replayed every step
   */
  verifyChecksum(): boolean {
    this.#requireLoaded("verifyChecksum");
    const totalSteps = this.totalSteps;
    if (this.#currentStep !== totalSteps) {
      throw new FourError(
        STATE_ERROR_CODE,
        `ReplayPlayer.verifyChecksum compares against the recording's finalChecksum, which was taken at step ${String(totalSteps)}; the player is at step ${String(this.#currentStep)}.`,
        {
          context: { currentStep: this.#currentStep, totalSteps },
        },
      );
    }
    return this.#target.checksum() === this.recording.finalChecksum;
  }

  /** Runs one step: recorded inputs first (insertion order), then `stepFn`. */
  #runStep(resimulating: boolean): void {
    const step = this.#currentStep;
    const inputs = this.recording.inputs;
    while (
      this.#inputCursor < inputs.length &&
      inputs[this.#inputCursor].step === step
    ) {
      const input = inputs[this.#inputCursor];
      // Non-null: the constructor refuses a recording with inputs whose target
      // cannot apply them, so reaching an input means `applyInput` exists.
      this.#target.applyInput?.(step, input.payload);
      this.#inputCursor += 1;
    }
    this.#stepFn(this.recording.fixedDeltaTime);
    this.#currentStep = step + 1;
    const listener = this.onStep;
    if (listener !== undefined) {
      listener({
        step,
        resimulating,
        ...(this.verifyChecksums ? { checksum: this.#target.checksum() } : {}),
      });
    }
  }

  /** Places the input cursor at the first input for the current step or later. */
  #syncInputCursor(): void {
    const inputs = this.recording.inputs;
    // Inputs are validated as non-decreasing by step (§34), so a binary search
    // for the lower bound keeps a seek O(log n) rather than O(n) in inputs, and
    // — because it is a *lower* bound — preserves the insertion order of the
    // several inputs that may share the current step.
    let low = 0;
    let high = inputs.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (inputs[middle].step < this.#currentStep) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    this.#inputCursor = low;
  }

  /**
   * Index of the first recorded frame that ends strictly after `step` — which
   * is also the number of frames completed at `step`, since frame ends are
   * non-decreasing (§10 frames may run zero steps). Returns `totalFrames` when
   * every frame is done. Binary search, so scrubbing a long recording stays
   * cheap.
   */
  #frameIndexAfter(step: number): number {
    let low = 0;
    let high = this.#frameEnds.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.#frameEnds[middle] <= step) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  /** Wraps base64 snapshot bytes in the identity §34 keys them on. */
  #snapshotAt(data: string): ReplaySnapshot {
    return {
      adapterName: this.recording.adapterName,
      adapterVersion: this.recording.adapterVersion,
      data: decodeBase64(data),
    };
  }

  #requireLoaded(method: string): void {
    if (!this.#loaded) {
      throw new FourError(
        STATE_ERROR_CODE,
        `ReplayPlayer.${method} was called before load(); the target still holds whatever state it had.`,
        { context: { method } },
      );
    }
  }
}
