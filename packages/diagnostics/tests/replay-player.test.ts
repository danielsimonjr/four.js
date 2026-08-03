/**
 * `ReplayPlayer` (§33–34, §113; plan P10-3) — playback and inspection.
 *
 * The target is a fake for the same reason `recorder.test.ts`'s is:
 * `@four/diagnostics` cannot import `@four/physics`, and {@link ReplayTarget}
 * exists so that it does not have to. {@link FakeWorld} below is a deterministic
 * counter state machine — its state is a uint32 mixed forward by each step, its
 * `bias` is moved by applied inputs, its snapshot is those two numbers, and its
 * checksum is a function of both. That is enough to make every claim in this
 * suite falsifiable: if an input were applied at the wrong step, in the wrong
 * order, or a step were run twice, the final checksum would not match the
 * recorded one.
 *
 * Recordings are produced by the real {@link ReplayRecorder} driving a
 * {@link FakeWorld} with a script, so the player is tested against documents
 * that came out of the recorder rather than hand-written ones — the two halves
 * of the format meet here.
 */

import { isFourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  ReplayPlayer,
  type ReplayStepEvent,
  DEFAULT_REPLAY_MAXIMUM_SUB_STEPS,
} from "../src/replay-player.js";
import { ReplayRecorder, type ReplayTarget } from "../src/recorder.js";
import type { JsonValue, ReplayRecording } from "../src/replay-format.js";
import type { ReplaySnapshot } from "../src/recorder.js";

/**
 * The fixed step used throughout, in seconds.
 *
 * `1/64` rather than the Appendix A `1/60` on purpose: it is exact in binary, so
 * the accumulator assertions in the `advanceRealtime` block ("four ticks at
 * quarter speed produce exactly one step") test the clamp rules rather than
 * floating-point luck.
 */
const FIXED_DT = 1 / 64;

// --- the fake target --------------------------------------------------------

/** One input the target was asked to apply, in the order it arrived. */
interface AppliedInput {
  readonly step: number;
  readonly bias: number;
}

/**
 * A deterministic stand-in for a simulated world.
 *
 * `state` is advanced by {@link FakeWorld.step} as a function of the previous
 * state, the current `bias`, and the step's delta; `bias` is moved only by
 * applied inputs. Both are captured by snapshots and both feed the checksum.
 */
class FakeWorld implements ReplayTarget {
  state = 0;

  bias = 0;

  stepCalls = 0;

  checksumCalls = 0;

  restoreCalls = 0;

  readonly applied: AppliedInput[] = [];

  constructor(
    readonly adapterName = "fake2d",
    readonly adapterVersion = "1.0.0",
  ) {}

  checksum(): number {
    this.checksumCalls += 1;
    return Math.imul(this.state ^ (this.bias * 2), 2654435761) >>> 0;
  }

  createSnapshot(): ReplaySnapshot {
    const data = new ArrayBuffer(8);
    const view = new DataView(data);
    view.setUint32(0, this.state);
    view.setInt32(4, this.bias);
    return {
      adapterName: this.adapterName,
      adapterVersion: this.adapterVersion,
      data,
    };
  }

  restoreSnapshot(snapshot: ReplaySnapshot): void {
    this.restoreCalls += 1;
    const view = new DataView(snapshot.data);
    this.state = view.getUint32(0);
    this.bias = view.getInt32(4);
  }

  applyInput(step: number, payload: JsonValue): void {
    const { bias } = payload as { readonly bias: number };
    this.applied.push({ step, bias });
    this.bias += bias;
  }

  /** One fixed step: a deterministic mix of state, bias, and the delta. */
  step(deltaTime: number): void {
    this.stepCalls += 1;
    this.state =
      (Math.imul(this.state, 1664525) +
        this.bias +
        Math.round(deltaTime * 1_000_000)) >>>
      0;
  }
}

/** A target that cannot receive inputs — `PhysicsWorld`'s shape (§34). */
class InputlessWorld implements ReplayTarget {
  readonly inner = new FakeWorld();

  checksum(): number {
    return this.inner.checksum();
  }

  createSnapshot(): ReplaySnapshot {
    return this.inner.createSnapshot();
  }

  restoreSnapshot(snapshot: ReplaySnapshot): void {
    this.inner.restoreSnapshot(snapshot);
  }
}

// --- scripted recordings ----------------------------------------------------

/**
 * One recorded frame of the script: the inputs to apply before each of its
 * steps (so `stepInputs.length` is the frame's `stepCount`, possibly zero).
 */
interface ScriptedFrame {
  readonly stepInputs: readonly (readonly number[])[];
  readonly droppedTime?: number;
}

interface BuiltRecording {
  readonly recording: ReplayRecording;
  /** Every input the script applied, in insertion order. */
  readonly expectedInputs: readonly AppliedInput[];
  /** The world the script ran on — the authority the replay must reproduce. */
  readonly source: FakeWorld;
}

/** Runs a script through the real recorder and returns its §34 document. */
function buildRecording(
  script: readonly ScriptedFrame[],
  snapshotIntervalSteps = 0,
): BuiltRecording {
  const source = new FakeWorld();
  const recorder = new ReplayRecorder();
  recorder.begin(source, {
    fixedDeltaTime: FIXED_DT,
    seed: 7,
    snapshotIntervalSteps,
    metadata: { scenario: "replay-player" },
  });
  const expectedInputs: AppliedInput[] = [];
  let step = 0;
  for (const frame of script) {
    for (const biases of frame.stepInputs) {
      for (const bias of biases) {
        const payload = { bias };
        recorder.recordInput(step, payload);
        source.applyInput(step, payload);
        expectedInputs.push({ step, bias });
      }
      source.step(FIXED_DT);
      step += 1;
    }
    recorder.recordFrame(frame.stepInputs.length, frame.droppedTime ?? 0);
  }
  return { recording: recorder.end(), expectedInputs, source };
}

/** `count` single-step frames, with `inputs[step]` applied before each. */
function singleStepFrames(
  count: number,
  inputs: ReadonlyMap<number, readonly number[]> = new Map(),
): ScriptedFrame[] {
  const frames: ScriptedFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    frames.push({ stepInputs: [inputs.get(i) ?? []] });
  }
  return frames;
}

interface Harness {
  readonly player: ReplayPlayer;
  readonly world: FakeWorld;
  readonly deltas: number[];
}

/** A player wired to a fresh world, plus the deltas `stepFn` was handed. */
function makePlayer(
  recording: ReplayRecording,
  options: {
    world?: FakeWorld;
    maximumSubSteps?: number;
    verifyChecksums?: boolean;
    onStep?: (event: ReplayStepEvent) => void;
  } = {},
): Harness {
  const world = options.world ?? new FakeWorld();
  const deltas: number[] = [];
  const player = new ReplayPlayer(recording, {
    target: world,
    stepFn: (deltaTime) => {
      deltas.push(deltaTime);
      world.step(deltaTime);
    },
    ...(options.maximumSubSteps === undefined
      ? {}
      : { maximumSubSteps: options.maximumSubSteps }),
    ...(options.verifyChecksums === undefined
      ? {}
      : { verifyChecksums: options.verifyChecksums }),
    ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
  });
  return { player, world, deltas };
}

/** Asserts a thrown {@link FourError} and returns it. */
function expectFourError(run: () => unknown, code: string): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  if (!isFourError(thrown)) {
    throw new Error(`expected a FourError, received ${String(thrown)}`);
  }
  expect(thrown.code).toBe(code);
  return thrown;
}

// --- construction -----------------------------------------------------------

describe("ReplayPlayer construction", () => {
  it("reports the recording's shape without touching the target's state", () => {
    const { recording } = buildRecording([
      { stepInputs: [[], []] },
      { stepInputs: [] },
      { stepInputs: [[]] },
    ]);
    const { player, world } = makePlayer(recording);

    expect(player.recording).toEqual(recording);
    expect(player.fixedDeltaTime).toBe(FIXED_DT);
    expect(player.totalSteps).toBe(3);
    expect(player.totalFrames).toBe(3);
    expect(player.maximumSubSteps).toBe(DEFAULT_REPLAY_MAXIMUM_SUB_STEPS);
    expect(player.isLoaded).toBe(false);
    expect(player.isPlaying).toBe(false);
    expect(player.speed).toBe(1);
    expect(player.currentStep).toBe(0);
    expect(player.accumulator).toBe(0);
    expect(player.droppedTime).toBe(0);
    // Construction reads the adapter identity and nothing else.
    expect(world.restoreCalls).toBe(0);
    expect(world.stepCalls).toBe(0);
  });

  it("reports zero steps for a recording with no frames", () => {
    const { recording } = buildRecording([]);
    const { player } = makePlayer(recording);

    expect(player.totalFrames).toBe(0);
    expect(player.totalSteps).toBe(0);
    expect(player.isAtEnd).toBe(true);
  });

  it("keeps the recording it was given in canonical form", () => {
    const { recording } = buildRecording(singleStepFrames(2));
    // A structurally equal but non-canonical object is re-validated, not
    // trusted: the player's `recording` is its own frozen copy.
    const copy = JSON.parse(JSON.stringify(recording)) as ReplayRecording;
    const { player } = makePlayer(copy);

    expect(player.recording).not.toBe(copy);
    expect(player.recording).toEqual(recording);
    expect(Object.isFrozen(player.recording)).toBe(true);
  });

  it("refuses a recording from another adapter (§34)", () => {
    const { recording } = buildRecording(singleStepFrames(2));
    const other = new FakeWorld("box2d", "1.0.0");
    const error = expectFourError(
      () => makePlayer(recording, { world: other }),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("different solver");
  });

  it("refuses a recording from another adapter version (§34)", () => {
    const { recording } = buildRecording(singleStepFrames(2));
    const other = new FakeWorld("fake2d", "2.0.0");
    const error = expectFourError(
      () => makePlayer(recording, { world: other }),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("version");
  });

  it("refuses a recording with inputs when the target cannot apply them", () => {
    const { recording } = buildRecording(
      singleStepFrames(2, new Map([[0, [5]]])),
    );
    const error = expectFourError(
      () =>
        new ReplayPlayer(recording, {
          target: new InputlessWorld(),
          stepFn: () => undefined,
        }),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("applyInput");
  });

  it("accepts an input-less target for an input-less recording", () => {
    const { recording } = buildRecording(singleStepFrames(2));
    const target = new InputlessWorld();
    const player = new ReplayPlayer(recording, {
      target,
      stepFn: (deltaTime) => {
        target.inner.step(deltaTime);
      },
    });
    player.load();
    while (player.stepOnce()) {
      /* replay to the end */
    }

    expect(player.verifyChecksum()).toBe(true);
  });

  it("rejects a missing stepFn and a bad maximumSubSteps", () => {
    const { recording } = buildRecording(singleStepFrames(1));
    const world = new FakeWorld();

    expect(
      () =>
        new ReplayPlayer(recording, {
          target: world,
          stepFn: undefined as unknown as (deltaTime: number) => void,
        }),
    ).toThrow(TypeError);
    expect(() => makePlayer(recording, { maximumSubSteps: 0 })).toThrow(
      RangeError,
    );
    expect(() => makePlayer(recording, { maximumSubSteps: 1.5 })).toThrow(
      RangeError,
    );
  });

  it("rejects a malformed document", () => {
    const { recording } = buildRecording(singleStepFrames(1));
    expect(() => makePlayer({ ...recording, fixedDeltaTime: -1 })).toThrow(
      TypeError,
    );
  });
});

// --- load -------------------------------------------------------------------

describe("ReplayPlayer.load", () => {
  it("restores the initial snapshot and is idempotent", () => {
    const { recording } = buildRecording(
      singleStepFrames(4, new Map([[1, [9]]])),
    );
    const { player, world } = makePlayer(recording);

    player.load();
    const afterFirst = { state: world.state, bias: world.bias };
    expect(player.isLoaded).toBe(true);
    expect(player.currentStep).toBe(0);
    expect(world.restoreCalls).toBe(1);

    // Advance, then reload: the second load lands on exactly the first's state.
    player.stepOnce();
    player.stepOnce();
    expect(world.state).not.toBe(afterFirst.state);
    player.load();

    expect(world.state).toBe(afterFirst.state);
    expect(world.bias).toBe(afterFirst.bias);
    expect(player.currentStep).toBe(0);
    expect(player.accumulator).toBe(0);
    expect(player.droppedTime).toBe(0);
    expect(world.restoreCalls).toBe(2);
  });

  it("leaves the transport state alone", () => {
    const { recording } = buildRecording(singleStepFrames(2));
    const { player } = makePlayer(recording);
    player.play();
    player.speed = 0.5;
    player.load();

    expect(player.isPlaying).toBe(true);
    expect(player.speed).toBe(0.5);
  });

  it("refuses every control before it has run", () => {
    const { recording } = buildRecording(singleStepFrames(2));
    const { player } = makePlayer(recording);

    for (const control of [
      () => player.stepOnce(),
      () => player.advanceFrame(),
      () => player.advanceRealtime(1),
      () => player.seekToStep(0),
      () => player.verifyChecksum(),
    ]) {
      expectFourError(control, "INVALID_APPLICATION_STATE");
    }
  });
});

// --- stepping ---------------------------------------------------------------

describe("ReplayPlayer.stepOnce", () => {
  it("reproduces the recorded final checksum step by step (§33)", () => {
    const { recording, source } = buildRecording(
      singleStepFrames(
        8,
        new Map([
          [0, [3]],
          [5, [-2]],
        ]),
      ),
    );
    const { player, world, deltas } = makePlayer(recording);
    player.load();

    let steps = 0;
    while (player.stepOnce()) {
      steps += 1;
      expect(player.currentStep).toBe(steps);
    }

    expect(steps).toBe(8);
    expect(world.stepCalls).toBe(8);
    expect(deltas).toEqual(new Array<number>(8).fill(FIXED_DT));
    expect(world.state).toBe(source.state);
    expect(world.bias).toBe(source.bias);
    expect(player.isAtEnd).toBe(true);
    expect(player.verifyChecksum()).toBe(true);
  });

  it("applies the inputs recorded for each step, in insertion order", () => {
    const inputs = new Map<number, readonly number[]>([
      [0, [1]],
      [2, [10, -4, 7]],
      [3, [2]],
    ]);
    const { recording, expectedInputs } = buildRecording(
      singleStepFrames(5, inputs),
    );
    const { player, world } = makePlayer(recording);
    player.load();
    while (player.stepOnce()) {
      /* to the end */
    }

    expect(world.applied).toEqual(expectedInputs);
    // The three inputs sharing step 2 arrived in the order recorded (§34).
    expect(world.applied.filter((entry) => entry.step === 2)).toEqual([
      { step: 2, bias: 10 },
      { step: 2, bias: -4 },
      { step: 2, bias: 7 },
    ]);
  });

  it("no-ops at the end of the recording instead of throwing", () => {
    const { recording } = buildRecording(singleStepFrames(2));
    const { player, world } = makePlayer(recording);
    player.load();
    player.stepOnce();
    player.stepOnce();

    expect(player.stepOnce()).toBe(false);
    expect(player.stepOnce()).toBe(false);
    expect(world.stepCalls).toBe(2);
    expect(player.currentStep).toBe(2);
  });

  it("detects a corrupted final checksum", () => {
    const { recording } = buildRecording(singleStepFrames(3));
    const corrupted: ReplayRecording = {
      ...recording,
      finalChecksum: (recording.finalChecksum ^ 1) >>> 0,
    };
    const { player } = makePlayer(corrupted);
    player.load();
    while (player.stepOnce()) {
      /* to the end */
    }

    expect(player.verifyChecksum()).toBe(false);
  });

  it("refuses to compare checksums before the end of the recording", () => {
    const { recording } = buildRecording(singleStepFrames(3));
    const { player } = makePlayer(recording);
    player.load();
    player.stepOnce();

    const error = expectFourError(
      () => player.verifyChecksum(),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("finalChecksum");
  });
});

// --- frames -----------------------------------------------------------------

describe("ReplayPlayer.advanceFrame", () => {
  const script: ScriptedFrame[] = [
    { stepInputs: [[]] }, // frame 0: 1 step  → ends at 1
    { stepInputs: [] }, // frame 1: 0 steps → ends at 1
    { stepInputs: [[], [], []] }, // frame 2: 3 steps → ends at 4
    { stepInputs: [[], []] }, // frame 3: 2 steps → ends at 6
  ];

  it("advances one recorded frame at a time, skipping empty ones", () => {
    const { recording } = buildRecording(script);
    const { player } = makePlayer(recording);
    player.load();

    expect(player.advanceFrame()).toBe(1);
    expect(player.currentStep).toBe(1);
    // Frame 1 recorded zero steps, so reaching step 1 completed both it and
    // frame 0; the next advance is frame 2's three steps.
    expect(player.framesCompleted).toBe(2);
    expect(player.advanceFrame()).toBe(3);
    expect(player.currentStep).toBe(4);
    expect(player.framesCompleted).toBe(3);
    expect(player.advanceFrame()).toBe(2);
    expect(player.framesCompleted).toBe(4);
    expect(player.advanceFrame()).toBe(0);
    expect(player.isAtEnd).toBe(true);
    expect(player.verifyChecksum()).toBe(true);
  });

  it("advances to a named frame's end, finishing a partial frame first", () => {
    const { recording } = buildRecording(script);
    const { player } = makePlayer(recording);
    player.load();

    expect(player.advanceFrame(2)).toBe(4);
    expect(player.currentStep).toBe(4);
    // Mid-frame: one step into frame 3, then advancing that frame runs only the
    // step it has left.
    player.stepOnce();
    expect(player.advanceFrame(3)).toBe(1);
    expect(player.currentStep).toBe(6);
    // A frame that ends exactly where the player already is costs nothing.
    expect(player.advanceFrame(3)).toBe(0);
  });

  it("rejects an unknown frame index or a backwards advance", () => {
    const { recording } = buildRecording(script);
    const { player } = makePlayer(recording);
    player.load();
    player.advanceFrame(2);

    expect(() => player.advanceFrame(-1)).toThrow(RangeError);
    expect(() => player.advanceFrame(4)).toThrow(RangeError);
    expect(() => player.advanceFrame(1.5)).toThrow(RangeError);
    expect(() => player.advanceFrame(0)).toThrow(RangeError);
  });
});

// --- realtime playback ------------------------------------------------------

describe("ReplayPlayer.advanceRealtime", () => {
  const build = (steps = 20): ReplayRecording =>
    buildRecording(singleStepFrames(steps)).recording;

  it("runs nothing while paused and accumulates nothing", () => {
    const { player, world } = makePlayer(build());
    player.load();

    expect(player.advanceRealtime(1)).toBe(0);
    expect(world.stepCalls).toBe(0);
    expect(player.accumulator).toBe(0);
    expect(player.interpolationAlpha).toBe(0);
  });

  it("runs whole steps out of the §10 accumulator at speed 1", () => {
    const { player, world } = makePlayer(build());
    player.load();
    player.play();

    expect(player.advanceRealtime(FIXED_DT / 2)).toBe(0);
    expect(player.accumulator).toBeCloseTo(FIXED_DT / 2, 12);
    expect(player.interpolationAlpha).toBeCloseTo(0.5, 12);
    expect(player.advanceRealtime(FIXED_DT / 2)).toBe(1);
    expect(player.accumulator).toBe(0);
    expect(world.stepCalls).toBe(1);
    expect(player.advanceRealtime(FIXED_DT * 3)).toBe(3);
    expect(player.currentStep).toBe(4);
  });

  it("treats speed as slow motion and fast-forward on the replay clock", () => {
    const quarter = makePlayer(build());
    quarter.player.load();
    quarter.player.play();
    quarter.player.speed = 0.25;

    for (let i = 0; i < 3; i += 1) {
      expect(quarter.player.advanceRealtime(FIXED_DT)).toBe(0);
    }
    expect(quarter.player.advanceRealtime(FIXED_DT)).toBe(1);
    expect(quarter.player.currentStep).toBe(1);

    const fast = makePlayer(build());
    fast.player.load();
    fast.player.play();
    fast.player.speed = 4;
    expect(fast.player.advanceRealtime(FIXED_DT)).toBe(4);
    expect(fast.player.currentStep).toBe(4);

    // Speed 0 freezes playback without pausing it.
    fast.player.speed = 0;
    expect(fast.player.advanceRealtime(FIXED_DT * 10)).toBe(0);
    expect(fast.player.isPlaying).toBe(true);
  });

  it("takes a per-call speed without changing the property", () => {
    const { player } = makePlayer(build());
    player.load();
    player.play();

    expect(player.advanceRealtime(FIXED_DT, 2)).toBe(2);
    expect(player.speed).toBe(1);
  });

  it("clamps a long real-time gap and reports the dropped time (§10)", () => {
    const { player, world } = makePlayer(build());
    player.load();
    player.play();

    const steps = player.advanceRealtime(1);

    expect(steps).toBe(DEFAULT_REPLAY_MAXIMUM_SUB_STEPS);
    expect(world.stepCalls).toBe(DEFAULT_REPLAY_MAXIMUM_SUB_STEPS);
    // 1s arrived, 5 steps ran, one whole step stays in the accumulator and the
    // rest is dropped.
    expect(player.droppedTime).toBeCloseTo(
      1 - DEFAULT_REPLAY_MAXIMUM_SUB_STEPS * FIXED_DT - FIXED_DT,
      12,
    );
    expect(player.accumulator).toBeCloseTo(FIXED_DT, 12);
    expect(player.interpolationAlpha).toBe(1);
  });

  it("honours a custom sub-step clamp", () => {
    const { player } = makePlayer(build(), { maximumSubSteps: 2 });
    player.load();
    player.play();

    expect(player.advanceRealtime(FIXED_DT * 10)).toBe(2);
    expect(player.maximumSubSteps).toBe(2);
    expect(player.droppedTime).toBeCloseTo(FIXED_DT * 7, 12);
  });

  it("clears the accumulator at the end of the recording without dropping time", () => {
    const { player, world } = makePlayer(build(3));
    player.load();
    player.play();

    expect(player.advanceRealtime(1)).toBe(3);
    expect(world.stepCalls).toBe(3);
    expect(player.accumulator).toBe(0);
    expect(player.droppedTime).toBe(0);
    expect(player.advanceRealtime(1)).toBe(0);
    expect(player.droppedTime).toBe(0);
    expect(player.verifyChecksum()).toBe(true);
  });

  it("resumes from the fraction of a step it was paused at", () => {
    const { player } = makePlayer(build());
    player.load();
    player.play();
    player.advanceRealtime(FIXED_DT * 0.75);
    player.pause();

    expect(player.advanceRealtime(FIXED_DT * 10)).toBe(0);
    expect(player.accumulator).toBeCloseTo(FIXED_DT * 0.75, 12);
    player.play();
    expect(player.advanceRealtime(FIXED_DT * 0.25)).toBe(1);
  });

  it("rejects negative or non-finite time and speed", () => {
    const { player } = makePlayer(build());
    player.load();
    player.play();

    expect(() => player.advanceRealtime(-1)).toThrow(RangeError);
    expect(() => player.advanceRealtime(Number.NaN)).toThrow(RangeError);
    expect(() => player.advanceRealtime(1, -1)).toThrow(RangeError);
    expect(() => player.advanceRealtime(1, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => {
      player.speed = -0.5;
    }).toThrow(RangeError);
    expect(() => {
      player.speed = Number.NaN;
    }).toThrow(RangeError);
  });
});

// --- seeking ----------------------------------------------------------------

describe("ReplayPlayer.seekToStep", () => {
  const inputs = new Map<number, readonly number[]>([
    [1, [4]],
    [9, [-3]],
  ]);

  /** The checksum straight playback reaches after `step` steps. */
  function checksumAfter(recording: ReplayRecording, step: number): number {
    const { player, world } = makePlayer(recording);
    player.load();
    for (let i = 0; i < step; i += 1) {
      player.stepOnce();
    }
    return world.checksum();
  }

  it("re-simulates from the initial snapshot when there are none periodic", () => {
    const { recording } = buildRecording(singleStepFrames(12, inputs));
    expect(recording.periodicSnapshots).toBeUndefined();
    const { player, world } = makePlayer(recording);
    player.load();

    expect(player.seekToStep(10)).toBe(10);
    expect(player.currentStep).toBe(10);
    expect(world.checksum()).toBe(checksumAfter(recording, 10));
  });

  it("restores the nearest periodic snapshot to minimise re-simulation (§34)", () => {
    const { recording } = buildRecording(singleStepFrames(12, inputs), 4);
    expect(recording.periodicSnapshots?.map((entry) => entry.step)).toEqual([
      4, 8, 12,
    ]);
    const { player, world } = makePlayer(recording);
    player.load();

    // Nearest snapshot at or before 10 is step 8: two steps of re-simulation
    // instead of ten.
    expect(player.seekToStep(10)).toBe(2);
    expect(player.currentStep).toBe(10);
    expect(world.checksum()).toBe(checksumAfter(recording, 10));

    // Below the first snapshot the initial one is still the nearest.
    expect(player.seekToStep(3)).toBe(3);
    expect(world.checksum()).toBe(checksumAfter(recording, 3));

    // Exactly on a snapshot: no re-simulation at all.
    expect(player.seekToStep(8)).toBe(0);
    expect(world.checksum()).toBe(checksumAfter(recording, 8));

    // The last step of the recording is a snapshot too, so seeking to the end
    // is free — and lands on the recorded final checksum.
    expect(player.seekToStep(12)).toBe(0);
    expect(player.verifyChecksum()).toBe(true);
  });

  it("applies only the inputs after the restored snapshot", () => {
    const { recording } = buildRecording(singleStepFrames(12, inputs), 4);
    const { player, world } = makePlayer(recording);
    player.load();
    player.seekToStep(10);

    // Step 1's input is baked into the step-8 snapshot; only step 9's is
    // re-applied.
    expect(world.applied).toEqual([{ step: 9, bias: -3 }]);
  });

  it("seeks backwards and forwards to the same state, and keeps playing", () => {
    const { recording, source } = buildRecording(
      singleStepFrames(12, inputs),
      4,
    );
    const { player, world } = makePlayer(recording);
    player.load();
    while (player.stepOnce()) {
      /* play to the end first */
    }

    player.seekToStep(5);
    expect(world.checksum()).toBe(checksumAfter(recording, 5));
    player.seekToStep(2);
    expect(world.checksum()).toBe(checksumAfter(recording, 2));

    // Seeking is idempotent: the same target step restores the same state.
    const stepsAgain = player.seekToStep(2);
    expect(stepsAgain).toBe(2);
    expect(world.checksum()).toBe(checksumAfter(recording, 2));

    while (player.stepOnce()) {
      /* replay the remainder */
    }
    expect(world.state).toBe(source.state);
    expect(player.verifyChecksum()).toBe(true);
  });

  it("resets the replay clock and clears the sub-step accumulator", () => {
    const { recording } = buildRecording(singleStepFrames(12), 4);
    const { player } = makePlayer(recording);
    player.load();
    player.play();
    player.advanceRealtime(FIXED_DT * 0.5);

    player.seekToStep(6);
    expect(player.accumulator).toBe(0);
    expect(player.currentStep).toBe(6);
  });

  it("rejects a step outside the recording", () => {
    const { recording } = buildRecording(singleStepFrames(4));
    const { player } = makePlayer(recording);
    player.load();

    expect(() => player.seekToStep(-1)).toThrow(RangeError);
    expect(() => player.seekToStep(5)).toThrow(RangeError);
    expect(() => player.seekToStep(1.5)).toThrow(RangeError);
    expect(player.seekToStep(4)).toBe(4);
  });
});

// --- the onStep hook --------------------------------------------------------

describe("ReplayPlayer.onStep", () => {
  it("fires once per step, in order, with no checksum by default", () => {
    const events: ReplayStepEvent[] = [];
    const { recording } = buildRecording(singleStepFrames(4));
    const { player, world } = makePlayer(recording, {
      onStep: (event) => events.push(event),
    });
    player.load();
    while (player.stepOnce()) {
      /* to the end */
    }

    expect(events.map((event) => event.step)).toEqual([0, 1, 2, 3]);
    expect(events.every((event) => !event.resimulating)).toBe(true);
    expect(events.every((event) => event.checksum === undefined)).toBe(true);
    // Verify-mode is off, so nothing hashed the world: that is the cost gate.
    expect(world.checksumCalls).toBe(0);
  });

  it("marks the steps a seek re-simulates", () => {
    const events: ReplayStepEvent[] = [];
    const { recording } = buildRecording(singleStepFrames(8), 4);
    const { player } = makePlayer(recording, {
      onStep: (event) => events.push(event),
    });
    player.load();
    player.stepOnce();
    events.length = 0;
    player.seekToStep(6);

    expect(events).toEqual([
      { step: 4, resimulating: true },
      { step: 5, resimulating: true },
    ]);
  });

  it("carries a per-step checksum only while verifyChecksums is on", () => {
    const events: ReplayStepEvent[] = [];
    const { recording } = buildRecording(singleStepFrames(3));
    const { player, world } = makePlayer(recording, {
      verifyChecksums: true,
      onStep: (event) => events.push(event),
    });
    player.load();
    while (player.stepOnce()) {
      /* to the end */
    }

    expect(world.checksumCalls).toBe(3);
    expect(events.every((event) => typeof event.checksum === "number")).toBe(
      true,
    );
    // Distinct digests: each step moved the world (§33).
    expect(new Set(events.map((event) => event.checksum)).size).toBe(3);
    // The last per-step checksum is the run's final checksum (§33).
    expect(events[2].checksum).toBe(recording.finalChecksum);

    // Turning it off stops the hashing without detaching the listener.
    player.verifyChecksums = false;
    player.load();
    events.length = 0;
    player.stepOnce();
    expect(world.checksumCalls).toBe(3);
    expect(events[0].checksum).toBeUndefined();
  });

  it("costs nothing per step when no listener is attached", () => {
    const { recording } = buildRecording(singleStepFrames(3));
    const { player, world } = makePlayer(recording, { verifyChecksums: true });
    player.load();
    while (player.stepOnce()) {
      /* to the end */
    }

    // `verifyChecksums` without a listener has nothing to hand a checksum to,
    // so none is computed.
    expect(world.checksumCalls).toBe(0);
    expect(player.verifyChecksum()).toBe(true);
    expect(world.checksumCalls).toBe(1);
  });

  it("can be attached and detached after construction", () => {
    const events: ReplayStepEvent[] = [];
    const { recording } = buildRecording(singleStepFrames(3));
    const { player } = makePlayer(recording);
    player.load();
    player.stepOnce();
    player.onStep = (event) => events.push(event);
    player.stepOnce();
    player.onStep = undefined;
    player.stepOnce();

    expect(events.map((event) => event.step)).toEqual([1]);
  });
});
