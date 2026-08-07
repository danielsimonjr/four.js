/**
 * Session recording (§33–34, plan P10-1) — the producing half of the replay
 * format.
 *
 * §33 requires the engine to support "recorded inputs; state snapshots; replay;
 * rollback; checksums", and §113's exit is that *a physics defect can be
 * captured, replayed, and inspected frame by frame*. {@link ReplayRecorder} is
 * the capture step: point it at a running simulation, feed it the loop's own
 * numbers, and it produces the §34 document `replay-format.ts` defines.
 *
 * ## Why the recorder records through an interface
 *
 * `@four/diagnostics` may depend on `core`, `math`, and `scene` only. It cannot
 * import `@four/physics` — the two packages are in the same dispatch wave — so
 * it cannot name `PhysicsWorld`, `PhysicsSnapshot`, or any solver type. What is
 * left is the **duck-typed contract** the codebase already uses for exactly this
 * situation (`@four/render`'s `ParticleDrawable`, plan §6h): this module
 * *declares* the shape it needs as {@link ReplayTarget}, and `PhysicsWorld`
 * satisfies it structurally, without either side importing the other.
 *
 * The shape is not a guess. It is transcribed from `packages/physics/src/world.ts`:
 *
 * ```ts
 * checksum(): number;                          // §33, uint32 FNV-1a
 * createSnapshot(): PhysicsSnapshot;           // { adapterName, adapterVersion, data }
 * restoreSnapshot(snapshot: PhysicsSnapshot): void;
 * ```
 *
 * and {@link ReplaySnapshot} re-declares `PhysicsSnapshot`'s four readonly
 * fields member for member (the fourth, `configuration`, joined on 2026-08-06 —
 * PH-6 — closing the mirror drift this note had warned about since the physics
 * side gained it). The honest cost, stated as plainly as `particles.ts`
 * states its own: **nothing type-checks the two declarations against each
 * other.** A change to `PhysicsSnapshot` will not fail this package's build; it
 * will fail `tests/recorder.test.ts`, which asserts assignability in both
 * directions against a mirror of `PhysicsSnapshot` copied from the physics
 * source. If a later revision of the dependency matrix lets diagnostics see
 * physics, `ReplayTarget` becomes an interface `PhysicsWorld` formally
 * implements and nothing else changes.
 *
 * `applyInput` is the fourth member P10-1 lists, and it is **optional** here for
 * one concrete reason: `PhysicsWorld` does not have it, and the contract must
 * stay satisfiable by `PhysicsWorld` (which is the whole point). Recording never
 * calls it — the recorder observes inputs, it does not apply them — so it exists
 * for the replay player (WP-10.2), whose targets are application-level and do
 * route input.
 *
 * ## What the caller owes the recorder
 *
 * Nothing about the loop is inferred, because inferring it would mean guessing:
 *
 * - {@link ReplayRecorder.recordInput} is called by whoever routes external
 *   input, with the step the input applies to;
 * - {@link ReplayRecorder.recordFrame} is called once per rendered frame with
 *   the fixed-step count and `TimeState.droppedTime` the §10 accumulator
 *   produced.
 *
 * No wall clock is read anywhere in this module (§33). A recording's `metadata`
 * may carry a date, but only one the *caller* supplied.
 */

import { FourError } from "@four/core";

import {
  REPLAY_FORMAT_VERSION,
  type JsonValue,
  type ReplayFrameRecord,
  type ReplayInputRecord,
  type ReplayRecording,
  type ReplaySnapshotRecord,
  cloneJsonValue,
  encodeBase64,
  validateReplayRecording,
} from "./replay-format.js";

/**
 * A solver snapshot plus §34's validity key.
 *
 * Structurally identical to `@four/physics`'s `PhysicsSnapshot`; see the module
 * note on why it is re-declared instead of imported.
 */
export interface ReplaySnapshot {
  /** The solver adapter's name at capture time, e.g. `"rapier2d"`. */
  readonly adapterName: string;
  /** The solver adapter's version at capture time. */
  readonly adapterVersion: string;
  /** The adapter's opaque bytes (§34). */
  readonly data: ArrayBuffer;
  /**
   * The world configuration the bytes were captured under — §34's *"a snapshot
   * is valid only for the same adapter, adapter version, and world
   * configuration"* (2026-08-06, PH-6).
   *
   * `unknown`, deliberately: `PhysicsSnapshot` types this as
   * `PhysicsSnapshotConfiguration`, and naming that type would need an edge to
   * `@four/physics` this package may not have. The recorder validates it as
   * JSON and carries it ({@link @four/diagnostics!ReplayRecording.worldConfiguration});
   * the player hands it back; only the solver reads a field of it.
   *
   * Optional because two legitimate producers cannot supply one: a target that
   * has no configuration to report, and snapshots this package reconstructs
   * from a recording that predates the field.
   */
  readonly configuration?: unknown;
}

/**
 * What the recorder (and the replay player) need from a simulation.
 *
 * `PhysicsWorld` satisfies this shape already; so does any application-level
 * object that can checksum, capture, and restore itself.
 */
export interface ReplayTarget {
  /** The §33 per-step determinism checksum, as a uint32. */
  checksum(): number;
  /** Captures the target's state, with the adapter identity §34 requires. */
  createSnapshot(): ReplaySnapshot;
  /** Restores a snapshot this target produced; refuses a foreign one (§34). */
  restoreSnapshot(snapshot: ReplaySnapshot): void;
  /**
   * Applies one recorded external input during replay (P10-1).
   *
   * Optional so that `PhysicsWorld`, which has no such method, still satisfies
   * the contract. The recorder never calls it.
   */
  applyInput?(step: number, payload: JsonValue): void;
}

/** How a recording session is configured (§34). */
export interface ReplayRecorderOptions {
  /** The fixed simulation step, in seconds (§10). Must be finite and `> 0`. */
  readonly fixedDeltaTime: number;
  /** The run's RNG seed (§33), when there is one. */
  readonly seed?: number;
  /**
   * Capture a periodic snapshot roughly every N simulation steps (§34).
   *
   * Omit — or pass `0` — for none. See {@link ReplayRecorder.recordFrame} for
   * exactly where the snapshots land.
   */
  readonly snapshotIntervalSteps?: number;
  /**
   * Free-form JSON the caller wants pinned to the recording: a scenario name, a
   * build id, a date *the caller* read. Validated and deep-copied.
   */
  readonly metadata?: { readonly [key: string]: JsonValue };
}

/** The recorder is used out of order (`begin` twice, `end` before `begin`, …). */
const STATE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * Records a live session into a §34 replay document.
 *
 * A recorder is a small state machine — idle → recording → idle — and is
 * reusable: {@link ReplayRecorder.end} returns it to idle, ready for another
 * {@link ReplayRecorder.begin}.
 *
 * @example
 * ```ts
 * const recorder = new ReplayRecorder();
 * recorder.begin(world, { fixedDeltaTime: 1 / 60, seed: 1337 });
 *
 * app.on("fixedUpdate", () => {
 *   recorder.recordInput(recorder.stepsRecorded, { thrust: input.thrust });
 * });
 * app.on("update", (time) => {
 *   recorder.recordFrame(time.fixedStepsThisFrame, time.droppedTime);
 * });
 *
 * const recording = recorder.end();
 * ```
 */
export class ReplayRecorder {
  /** The target being recorded, or `undefined` while idle. */
  #target: ReplayTarget | undefined = undefined;

  #adapterName = "";

  #adapterVersion = "";

  #fixedDeltaTime = 0;

  #seed: number | undefined = undefined;

  #metadata: { readonly [key: string]: JsonValue } | undefined = undefined;

  #initialSnapshot = "";

  /** §34's "solver settings", captured off the initial snapshot (PH-6). */
  #worldConfiguration: JsonValue | undefined = undefined;

  #snapshotIntervalSteps = 0;

  /** Steps at which the next periodic snapshot becomes due; `0` if disabled. */
  #nextSnapshotStep = 0;

  #stepsRecorded = 0;

  readonly #inputs: ReplayInputRecord[] = [];

  readonly #frames: ReplayFrameRecord[] = [];

  readonly #snapshots: ReplaySnapshotRecord[] = [];

  /** Whether a session is open (between `begin` and `end`). */
  get isRecording(): boolean {
    return this.#target !== undefined;
  }

  /**
   * Simulation steps recorded so far — the sum of every
   * {@link ReplayRecorder.recordFrame}'s `stepCount`.
   *
   * Also the index of the next step to run, which is the step index an input
   * recorded "now, for the step about to happen" belongs to.
   */
  get stepsRecorded(): number {
    return this.#stepsRecorded;
  }

  /** Frames recorded so far. */
  get framesRecorded(): number {
    return this.#frames.length;
  }

  /** Inputs recorded so far. */
  get inputsRecorded(): number {
    return this.#inputs.length;
  }

  /** Periodic snapshots captured so far (excluding the initial one). */
  get snapshotsRecorded(): number {
    return this.#snapshots.length;
  }

  /**
   * Opens a session and captures the initial snapshot — §34's "initial scene
   * state", plus the adapter name and version the whole document is keyed on
   * and, since 2026-08-06 (PH-6), the **world configuration** it was captured
   * under, taken from {@link ReplaySnapshot.configuration}.
   *
   * @param target the simulation to record; must be able to snapshot
   * @param options fixed step (seconds), seed, snapshot cadence, metadata
   * @throws FourError `INVALID_APPLICATION_STATE` if a session is already open
   * @throws TypeError if `fixedDeltaTime` or `snapshotIntervalSteps` is out of
   * range, or `metadata` or the target's snapshot `configuration` is not
   * representable JSON
   */
  begin(target: ReplayTarget, options: ReplayRecorderOptions): void {
    if (this.#target !== undefined) {
      throw new FourError(
        STATE_ERROR_CODE,
        "ReplayRecorder.begin was called while a recording was already open; call end() first.",
      );
    }
    const { fixedDeltaTime } = options;
    if (!Number.isFinite(fixedDeltaTime) || fixedDeltaTime <= 0) {
      throw new TypeError(
        `ReplayRecorder options.fixedDeltaTime must be a positive number of seconds (got ${String(fixedDeltaTime)}).`,
      );
    }
    const interval = options.snapshotIntervalSteps ?? 0;
    if (!Number.isSafeInteger(interval) || interval < 0) {
      throw new TypeError(
        `ReplayRecorder options.snapshotIntervalSteps must be a non-negative integer (got ${String(interval)}).`,
      );
    }
    if (options.seed !== undefined && !Number.isFinite(options.seed)) {
      throw new TypeError(
        `ReplayRecorder options.seed must be a finite number (got ${String(options.seed)}).`,
      );
    }
    let metadata: { readonly [key: string]: JsonValue } | undefined;
    if (options.metadata !== undefined) {
      // Validated and copied before anything is captured, so a bad metadata
      // object cannot leave a half-open session behind.
      metadata = cloneJsonValue(options.metadata, "metadata") as {
        readonly [key: string]: JsonValue;
      };
    }

    const snapshot = target.createSnapshot();
    // §34's "solver settings" (PH-6). Validated and copied here, at the call
    // that introduced it, rather than at `end()` — a target that reports a
    // configuration JSON cannot carry must fail at `begin`, before a whole
    // session has been recorded against it. A target that reports none records
    // a version-1 document, exactly as before.
    const worldConfiguration =
      snapshot.configuration === undefined
        ? undefined
        : cloneJsonValue(snapshot.configuration, "snapshot.configuration");
    this.#inputs.length = 0;
    this.#frames.length = 0;
    this.#snapshots.length = 0;
    this.#stepsRecorded = 0;
    this.#target = target;
    this.#adapterName = snapshot.adapterName;
    this.#adapterVersion = snapshot.adapterVersion;
    this.#initialSnapshot = encodeBase64(snapshot.data);
    this.#worldConfiguration = worldConfiguration;
    this.#fixedDeltaTime = fixedDeltaTime;
    this.#seed = options.seed;
    this.#metadata = metadata;
    this.#snapshotIntervalSteps = interval;
    this.#nextSnapshotStep = interval;
  }

  /**
   * Records one external input against the simulation step it applies to (§34).
   *
   * The payload is validated as JSON and deep-copied, so a caller may hand over
   * the same mutable object every frame without the recording collapsing to N
   * copies of its final state. Inputs are kept in **insertion order** (plan §1,
   * §33) — several inputs may share a step, and they replay in the order they
   * were recorded.
   *
   * @param step the simulation step the input applies to; a non-negative
   * integer, not before the previously recorded input's step
   * @param payload any JSON value
   * @throws FourError `INVALID_APPLICATION_STATE` if no session is open
   * @throws RangeError if `step` is not a non-negative integer, or goes
   * backwards
   * @throws TypeError if `payload` is not representable JSON
   */
  recordInput(step: number, payload: JsonValue): void {
    this.#requireRecording("recordInput");
    if (!Number.isSafeInteger(step) || step < 0) {
      throw new RangeError(
        `ReplayRecorder.recordInput step must be a non-negative safe integer (got ${String(step)}).`,
      );
    }
    const previous = this.#inputs[this.#inputs.length - 1];
    if (previous !== undefined && step < previous.step) {
      throw new RangeError(
        `ReplayRecorder.recordInput step ${String(step)} is before the previously recorded step ${String(previous.step)}; inputs are recorded in non-decreasing step order (§34).`,
      );
    }
    this.#inputs.push(
      Object.freeze({ step, payload: cloneJsonValue(payload, "payload") }),
    );
  }

  /**
   * Records one frame of the §10 fixed-step loop, and captures a periodic
   * snapshot if one is due.
   *
   * Call this **after** the frame's fixed steps have run, with the numbers
   * `TimeState` reports: how many fixed steps executed and how much time the
   * `maximumSubSteps` clamp dropped.
   *
   * ### Where periodic snapshots land (decision, WP-10.1)
   *
   * The recorder only ever sees the target between frames, so it cannot capture
   * state at an exact multiple of `snapshotIntervalSteps` in the middle of a
   * frame that ran several steps. It therefore captures **at most one snapshot
   * per frame**, at the first frame boundary at or after each due multiple, and
   * records the step index the snapshot actually corresponds to. The recorded
   * `step` is always exact — the state *after* that many steps — while the
   * cadence is approximate whenever frames run more than one step. Missed
   * multiples are skipped rather than queued, so a long frame produces one
   * snapshot, not five.
   *
   * @param stepCount fixed steps executed this frame; a non-negative integer
   * @param droppedTime dropped simulation time this frame, in seconds; `>= 0`
   * @throws FourError `INVALID_APPLICATION_STATE` if no session is open
   * @throws RangeError if either argument is out of range
   */
  recordFrame(stepCount: number, droppedTime: number): void {
    const target = this.#requireRecording("recordFrame");
    if (!Number.isSafeInteger(stepCount) || stepCount < 0) {
      throw new RangeError(
        `ReplayRecorder.recordFrame stepCount must be a non-negative safe integer (got ${String(stepCount)}).`,
      );
    }
    if (!Number.isFinite(droppedTime) || droppedTime < 0) {
      throw new RangeError(
        `ReplayRecorder.recordFrame droppedTime must be a non-negative number of seconds (got ${String(droppedTime)}).`,
      );
    }
    this.#frames.push(Object.freeze({ stepCount, droppedTime }));
    this.#stepsRecorded += stepCount;
    if (
      this.#snapshotIntervalSteps > 0 &&
      this.#stepsRecorded >= this.#nextSnapshotStep
    ) {
      const snapshot = target.createSnapshot();
      this.#snapshots.push(
        Object.freeze({
          step: this.#stepsRecorded,
          data: encodeBase64(snapshot.data),
        }),
      );
      // Skip every multiple this frame already passed, so one long frame yields
      // one snapshot.
      this.#nextSnapshotStep =
        (Math.floor(this.#stepsRecorded / this.#snapshotIntervalSteps) + 1) *
        this.#snapshotIntervalSteps;
    }
  }

  /**
   * Closes the session and returns the §34 document.
   *
   * The final checksum is read from the target here, at the end of the last
   * recorded frame: a replay that reproduces the run must land on this exact
   * uint32 (§33, §92).
   *
   * @returns the canonical, deep-frozen recording
   * @throws FourError `INVALID_APPLICATION_STATE` if no session is open
   */
  end(): ReplayRecording {
    const target = this.#requireRecording("end");
    const document: Record<string, unknown> = {
      // The real version is derived from the content by
      // `validateReplayRecording` below (PH-6: a document declares the lowest
      // version that can express it), so this is only the upper bound the
      // validator checks the content against.
      formatVersion: REPLAY_FORMAT_VERSION,
      adapterName: this.#adapterName,
      adapterVersion: this.#adapterVersion,
    };
    if (this.#seed !== undefined) {
      document.seed = this.#seed;
    }
    document.fixedDeltaTime = this.#fixedDeltaTime;
    if (this.#worldConfiguration !== undefined) {
      document.worldConfiguration = this.#worldConfiguration;
    }
    document.initialSnapshot = this.#initialSnapshot;
    document.inputs = this.#inputs.slice();
    document.frames = this.#frames.slice();
    if (this.#snapshots.length > 0) {
      document.periodicSnapshots = this.#snapshots.slice();
    }
    document.finalChecksum = target.checksum();
    if (this.#metadata !== undefined) {
      document.metadata = this.#metadata;
    }
    // Validated on the way out: the recorder's own output goes through exactly
    // the same gate a document read from disk does, so the two can never
    // disagree about what a valid recording is.
    const recording = validateReplayRecording(document);
    this.abort();
    return recording;
  }

  /**
   * Abandons an open session without producing a document, returning the
   * recorder to its idle state.
   *
   * Idempotent, and safe to call from a `finally`: it never touches the target.
   * {@link ReplayRecorder.end} finishes with the same reset, so the counters
   * above describe the *open* session and read zero between sessions.
   */
  abort(): void {
    this.#target = undefined;
    this.#inputs.length = 0;
    this.#frames.length = 0;
    this.#snapshots.length = 0;
    this.#stepsRecorded = 0;
    this.#initialSnapshot = "";
    this.#worldConfiguration = undefined;
    this.#metadata = undefined;
    this.#seed = undefined;
    this.#snapshotIntervalSteps = 0;
    this.#nextSnapshotStep = 0;
  }

  #requireRecording(method: string): ReplayTarget {
    const target = this.#target;
    if (target === undefined) {
      throw new FourError(
        STATE_ERROR_CODE,
        `ReplayRecorder.${method} was called with no recording open; call begin() first.`,
      );
    }
    return target;
  }
}
