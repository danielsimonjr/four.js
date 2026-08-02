/**
 * `ReplayRecorder` (§33–34, plan P10-1) — capture.
 *
 * The target is a fake, on purpose: `@four/diagnostics` cannot import
 * `@four/physics` (same dispatch wave), and the point of {@link ReplayTarget}
 * is that it does not need to. What *is* asserted against physics is the
 * **shape**: `MirroredPhysicsWorld` below is transcribed from
 * `packages/physics/src/world.ts` — `checksum(): number`,
 * `createSnapshot(): PhysicsSnapshot`, `restoreSnapshot(PhysicsSnapshot): void`,
 * with `PhysicsSnapshot` being `{ adapterName, adapterVersion, data }` — and the
 * assignability assertions in the first describe block fail to compile the day
 * the two drift apart. That is the same protection `@four/particles` and
 * `@four/render` give the `ParticleDrawable` contract, and the same honest
 * limitation: it catches drift at *this* package's typecheck, not at physics'.
 */

import { isFourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  ReplayRecorder,
  type ReplaySnapshot,
  type ReplayTarget,
} from "../src/recorder.js";
import {
  REPLAY_FORMAT_VERSION,
  assertReplayCompatible,
  decodeBase64,
  encodeReplayRecording,
} from "../src/replay-format.js";

// --- the mirror of @four/physics -------------------------------------------

/** Transcribed from `PhysicsSnapshot` in `packages/physics/src/world.ts`. */
interface MirroredPhysicsSnapshot {
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly data: ArrayBuffer;
}

/** The three `PhysicsWorld` members a recording needs, transcribed. */
interface MirroredPhysicsWorld {
  checksum(): number;
  createSnapshot(): MirroredPhysicsSnapshot;
  restoreSnapshot(snapshot: MirroredPhysicsSnapshot): void;
}

// --- the fake target --------------------------------------------------------

/**
 * A deterministic stand-in for a solver world.
 *
 * Its "state" is a counter the test advances; snapshots are the counter's bytes,
 * so a recorded snapshot can be decoded and checked against the step it claims
 * to belong to.
 */
class FakeTarget implements ReplayTarget {
  state = 0;

  snapshotCalls = 0;

  checksumCalls = 0;

  restored: ReplaySnapshot[] = [];

  constructor(
    readonly adapterName = "fake2d",
    readonly adapterVersion = "1.0.0",
  ) {}

  checksum(): number {
    this.checksumCalls += 1;
    return (this.state * 2654435761) >>> 0;
  }

  createSnapshot(): ReplaySnapshot {
    this.snapshotCalls += 1;
    return {
      adapterName: this.adapterName,
      adapterVersion: this.adapterVersion,
      data: new Uint8Array([this.state & 0xff, (this.state >>> 8) & 0xff])
        .buffer,
    };
  }

  restoreSnapshot(snapshot: ReplaySnapshot): void {
    this.restored.push(snapshot);
    const bytes = new Uint8Array(snapshot.data);
    this.state = bytes[0] | (bytes[1] << 8);
  }
}

/** The state a recorded snapshot blob encodes. */
function stateOf(base64: string): number {
  const bytes = new Uint8Array(decodeBase64(base64));
  return bytes[0] | (bytes[1] << 8);
}

/** Runs `stepCount` steps on the fake and records the frame. */
function frame(
  recorder: ReplayRecorder,
  target: FakeTarget,
  stepCount: number,
  droppedTime = 0,
): void {
  target.state += stepCount;
  recorder.recordFrame(stepCount, droppedTime);
}

describe("ReplayTarget — structural compatibility with PhysicsWorld", () => {
  it("accepts a PhysicsWorld-shaped object as a ReplayTarget", () => {
    const world: MirroredPhysicsWorld = new FakeTarget();

    // The assignment is the assertion: it is what `recorder.begin(world, …)`
    // does at a call site in an application, and it fails to compile if
    // `ReplayTarget` ever asks for something `PhysicsWorld` does not have —
    // `applyInput`, notably, which is why that member is optional.
    const target: ReplayTarget = world;

    expect(typeof target.checksum).toBe("function");
    expect(typeof target.createSnapshot).toBe("function");
    expect(typeof target.restoreSnapshot).toBe("function");
    expect("applyInput" in target).toBe(false);
  });

  it("hands a PhysicsSnapshot-shaped value back and forth unchanged", () => {
    const target = new FakeTarget();

    const snapshot: MirroredPhysicsSnapshot = target.createSnapshot();
    const asReplaySnapshot: ReplaySnapshot = snapshot;
    target.restoreSnapshot(asReplaySnapshot);

    expect(Object.keys(snapshot).sort()).toEqual([
      "adapterName",
      "adapterVersion",
      "data",
    ]);
    expect(snapshot.data).toBeInstanceOf(ArrayBuffer);
    expect(target.restored[0]).toBe(snapshot);
  });

  it("keys the recording on the identity §34's refusal compares", () => {
    const target = new FakeTarget("rapier2d", "0.4.1");
    const recorder = new ReplayRecorder();
    recorder.begin(target, { fixedDeltaTime: 1 / 60 });

    const recording = recorder.end();

    expect(() =>
      assertReplayCompatible(recording, target.createSnapshot()),
    ).not.toThrow();
    expect(() =>
      assertReplayCompatible(recording, {
        adapterName: "box2d",
        adapterVersion: "0.4.1",
      }),
    ).toThrow(/different solver/);
  });
});

describe("ReplayRecorder.begin", () => {
  it("captures the initial snapshot and the §34 header", () => {
    const target = new FakeTarget();
    target.state = 11;
    const recorder = new ReplayRecorder();

    recorder.begin(target, {
      fixedDeltaTime: 1 / 120,
      seed: 1337,
      metadata: { scenario: "stack", recordedAt: "2026-08-02T09:00:00.000Z" },
    });
    const recording = recorder.end();

    expect(target.snapshotCalls).toBe(1);
    expect(recording.formatVersion).toBe(REPLAY_FORMAT_VERSION);
    expect(recording.adapterName).toBe("fake2d");
    expect(recording.adapterVersion).toBe("1.0.0");
    expect(recording.fixedDeltaTime).toBe(1 / 120);
    expect(recording.seed).toBe(1337);
    expect(stateOf(recording.initialSnapshot)).toBe(11);
    expect(recording.metadata).toEqual({
      scenario: "stack",
      recordedAt: "2026-08-02T09:00:00.000Z",
    });
  });

  it("omits the seed when none was supplied", () => {
    const recorder = new ReplayRecorder();
    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });

    expect(recorder.end().seed).toBeUndefined();
  });

  it("copies metadata, so later mutation cannot rewrite history", () => {
    const metadata: Record<string, string> = { scenario: "before" };
    const recorder = new ReplayRecorder();
    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02, metadata });

    metadata.scenario = "after";

    expect(recorder.end().metadata?.scenario).toBe("before");
  });

  it("reports whether a session is open", () => {
    const recorder = new ReplayRecorder();
    expect(recorder.isRecording).toBe(false);

    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });
    expect(recorder.isRecording).toBe(true);

    recorder.end();
    expect(recorder.isRecording).toBe(false);
  });

  it("refuses to open a second session over an open one", () => {
    const recorder = new ReplayRecorder();
    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });

    let thrown: unknown;
    try {
      recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });
    } catch (error) {
      thrown = error;
    }

    expect(isFourError(thrown) ? thrown.code : "").toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(isFourError(thrown) ? thrown.message : "").toMatch(/already open/);
  });

  it("rejects a fixed step that is not a positive number of seconds", () => {
    const recorder = new ReplayRecorder();

    expect(() =>
      recorder.begin(new FakeTarget(), { fixedDeltaTime: 0 }),
    ).toThrow(/positive number of seconds/);
    expect(() =>
      recorder.begin(new FakeTarget(), { fixedDeltaTime: -1 / 60 }),
    ).toThrow(TypeError);
    expect(() =>
      recorder.begin(new FakeTarget(), {
        fixedDeltaTime: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(TypeError);
    expect(recorder.isRecording).toBe(false);
  });

  it("rejects a bad snapshot interval, seed, or metadata before touching the target", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();

    expect(() =>
      recorder.begin(target, {
        fixedDeltaTime: 0.02,
        snapshotIntervalSteps: -1,
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      recorder.begin(target, {
        fixedDeltaTime: 0.02,
        snapshotIntervalSteps: 2.5,
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      recorder.begin(target, { fixedDeltaTime: 0.02, seed: Number.NaN }),
    ).toThrow(/seed must be a finite number/);
    expect(() =>
      recorder.begin(target, {
        fixedDeltaTime: 0.02,
        metadata: { bad: Number.NaN },
      }),
    ).toThrow(TypeError);
    expect(target.snapshotCalls).toBe(0);
    expect(recorder.isRecording).toBe(false);
  });
});

describe("ReplayRecorder.recordInput", () => {
  it("keeps inputs in insertion order, several per step allowed", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, { fixedDeltaTime: 0.02 });

    recorder.recordInput(0, { key: "left" });
    recorder.recordInput(0, { key: "jump" });
    frame(recorder, target, 1);
    recorder.recordInput(1, ["fire"]);
    recorder.recordInput(4, null);

    const { inputs } = recorder.end();
    expect(inputs).toEqual([
      { step: 0, payload: { key: "left" } },
      { step: 0, payload: { key: "jump" } },
      { step: 1, payload: ["fire"] },
      { step: 4, payload: null },
    ]);
  });

  it("copies the payload, so a reused input object is not recorded N times", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, { fixedDeltaTime: 0.02 });
    const live = { thrust: 0 };

    live.thrust = 1;
    recorder.recordInput(0, live);
    live.thrust = 2;
    recorder.recordInput(1, live);
    live.thrust = 3;

    const { inputs } = recorder.end();
    expect(inputs.map((input) => input.payload)).toEqual([
      { thrust: 1 },
      { thrust: 2 },
    ]);
  });

  it("counts what it has recorded", () => {
    const recorder = new ReplayRecorder();
    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });

    expect(recorder.inputsRecorded).toBe(0);
    recorder.recordInput(0, 1);
    expect(recorder.inputsRecorded).toBe(1);
  });

  it("rejects a step that is not a non-negative integer", () => {
    const recorder = new ReplayRecorder();
    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });

    expect(() => recorder.recordInput(-1, null)).toThrow(RangeError);
    expect(() => recorder.recordInput(1.5, null)).toThrow(RangeError);
    expect(() => recorder.recordInput(Number.NaN, null)).toThrow(RangeError);
  });

  it("rejects a step that goes backwards", () => {
    const recorder = new ReplayRecorder();
    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });
    recorder.recordInput(5, null);

    expect(() => recorder.recordInput(4, null)).toThrow(
      /non-decreasing step order/,
    );
    expect(() => recorder.recordInput(5, null)).not.toThrow();
  });

  it("rejects a payload JSON cannot carry", () => {
    const recorder = new ReplayRecorder();
    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });

    expect(() => recorder.recordInput(0, Number.NaN)).toThrow(TypeError);
    expect(() =>
      recorder.recordInput(0, new Date(0) as unknown as string),
    ).toThrow(/not a plain object/);
  });
});

describe("ReplayRecorder.recordFrame", () => {
  it("records the §10 accounting of every frame, in order", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, { fixedDeltaTime: 1 / 60 });

    frame(recorder, target, 1);
    frame(recorder, target, 0);
    frame(recorder, target, 4, 0.125);

    const recording = recorder.end();
    expect(recording.frames).toEqual([
      { stepCount: 1, droppedTime: 0 },
      { stepCount: 0, droppedTime: 0 },
      { stepCount: 4, droppedTime: 0.125 },
    ]);
  });

  it("accumulates the step count", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, { fixedDeltaTime: 1 / 60 });

    expect(recorder.stepsRecorded).toBe(0);
    frame(recorder, target, 3);
    frame(recorder, target, 2);

    expect(recorder.stepsRecorded).toBe(5);
    expect(recorder.framesRecorded).toBe(2);
  });

  it("rejects out-of-range arguments", () => {
    const recorder = new ReplayRecorder();
    recorder.begin(new FakeTarget(), { fixedDeltaTime: 0.02 });

    expect(() => recorder.recordFrame(-1, 0)).toThrow(RangeError);
    expect(() => recorder.recordFrame(1.5, 0)).toThrow(RangeError);
    expect(() => recorder.recordFrame(1, -0.5)).toThrow(RangeError);
    expect(() => recorder.recordFrame(1, Number.NaN)).toThrow(RangeError);
  });
});

describe("ReplayRecorder — periodic snapshots (§34)", () => {
  it("captures none by default", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, { fixedDeltaTime: 0.02 });

    for (let i = 0; i < 10; i += 1) {
      frame(recorder, target, 1);
    }

    expect(recorder.end().periodicSnapshots).toBeUndefined();
    expect(target.snapshotCalls).toBe(1);
  });

  it("captures none when the interval is 0", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, {
      fixedDeltaTime: 0.02,
      snapshotIntervalSteps: 0,
    });

    frame(recorder, target, 5);

    expect(recorder.end().periodicSnapshots).toBeUndefined();
  });

  it("captures one every N steps when frames run one step each", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, {
      fixedDeltaTime: 0.02,
      snapshotIntervalSteps: 3,
    });

    for (let i = 0; i < 10; i += 1) {
      frame(recorder, target, 1);
    }

    const snapshots = recorder.end().periodicSnapshots ?? [];
    expect(snapshots.map((snapshot) => snapshot.step)).toEqual([3, 6, 9]);
    // Each blob is the target's state at exactly that step.
    expect(snapshots.map((snapshot) => stateOf(snapshot.data))).toEqual([
      3, 6, 9,
    ]);
  });

  it("captures at most one per frame, skipping multiples a long frame passed", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, {
      fixedDeltaTime: 0.02,
      snapshotIntervalSteps: 2,
    });

    frame(recorder, target, 7); // passes 2, 4, 6 — one snapshot, at 7
    frame(recorder, target, 1); // step 8 — the next due multiple
    frame(recorder, target, 1); // step 9 — nothing due
    frame(recorder, target, 1); // step 10

    const snapshots = recorder.end().periodicSnapshots ?? [];
    expect(snapshots.map((snapshot) => snapshot.step)).toEqual([7, 8, 10]);
    expect(recorder.isRecording).toBe(false);
  });

  it("never captures for a frame that ran no steps", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, {
      fixedDeltaTime: 0.02,
      snapshotIntervalSteps: 1,
    });

    frame(recorder, target, 0, 0.5);

    expect(recorder.snapshotsRecorded).toBe(0);
    frame(recorder, target, 1);
    expect(recorder.snapshotsRecorded).toBe(1);
  });
});

describe("ReplayRecorder.end", () => {
  it("reads the final checksum from the target and produces a valid document", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, { fixedDeltaTime: 1 / 60, seed: 1 });
    frame(recorder, target, 2);
    recorder.recordInput(2, { fire: true });

    const recording = recorder.end();

    expect(target.checksumCalls).toBe(1);
    expect(recording.finalChecksum).toBe((2 * 2654435761) >>> 0);
    expect(() => encodeReplayRecording(recording)).not.toThrow();
    expect(Object.isFrozen(recording)).toBe(true);
  });

  it("returns the recorder to idle, ready to record again", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();

    recorder.begin(target, { fixedDeltaTime: 0.02 });
    frame(recorder, target, 3);
    recorder.recordInput(0, "first");
    const first = recorder.end();

    expect(recorder.isRecording).toBe(false);
    expect(recorder.stepsRecorded).toBe(0);
    expect(recorder.framesRecorded).toBe(0);
    expect(recorder.inputsRecorded).toBe(0);

    recorder.begin(target, { fixedDeltaTime: 0.01 });
    frame(recorder, target, 1);
    const second = recorder.end();

    expect(first.inputs).toHaveLength(1);
    expect(second.inputs).toHaveLength(0);
    expect(second.fixedDeltaTime).toBe(0.01);
    expect(stateOf(second.initialSnapshot)).toBe(3);
  });

  it("refuses every method while idle", () => {
    const recorder = new ReplayRecorder();

    for (const call of [
      () => recorder.recordInput(0, null),
      () => recorder.recordFrame(1, 0),
      () => recorder.end(),
    ]) {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(isFourError(thrown) ? thrown.code : "").toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(isFourError(thrown) ? thrown.message : "").toMatch(
        /no recording open/,
      );
    }
  });

  it("abort discards the session without touching the target", () => {
    const target = new FakeTarget();
    const recorder = new ReplayRecorder();
    recorder.begin(target, { fixedDeltaTime: 0.02 });
    frame(recorder, target, 2);

    recorder.abort();

    expect(recorder.isRecording).toBe(false);
    expect(recorder.stepsRecorded).toBe(0);
    expect(recorder.snapshotsRecorded).toBe(0);
    expect(target.checksumCalls).toBe(0);
    expect(target.snapshotCalls).toBe(1);
    expect(() => {
      recorder.abort();
    }).not.toThrow();
  });
});

describe("ReplayRecorder — a whole session", () => {
  it("records a run that a player can reconstruct step by step", () => {
    const target = new FakeTarget("rapier2d", "0.4.1");
    const recorder = new ReplayRecorder();
    recorder.begin(target, {
      fixedDeltaTime: 1 / 60,
      seed: 7,
      snapshotIntervalSteps: 4,
      metadata: { scenario: "ramp" },
    });

    // Six frames: 1, 2, 0 (all time dropped), 1, 3, 1 steps.
    const plan: readonly (readonly [number, number])[] = [
      [1, 0],
      [2, 0],
      [0, 1 / 60],
      [1, 0],
      [3, 0],
      [1, 0],
    ];
    for (const [stepCount, droppedTime] of plan) {
      recorder.recordInput(recorder.stepsRecorded, { frame: stepCount });
      frame(recorder, target, stepCount, droppedTime);
    }

    const recording = recorder.end();
    const text = encodeReplayRecording(recording);

    expect(recording.frames).toHaveLength(6);
    expect(recording.frames.reduce((sum, f) => sum + f.stepCount, 0)).toBe(8);
    expect(recording.frames[2].droppedTime).toBe(1 / 60);
    expect(recording.inputs.map((input) => input.step)).toEqual([
      0, 1, 3, 3, 4, 7,
    ]);
    expect(recording.periodicSnapshots?.map((s) => s.step)).toEqual([4, 8]);
    expect(stateOf(recording.initialSnapshot)).toBe(0);
    expect(recording.finalChecksum).toBe((8 * 2654435761) >>> 0);
    // The document survives a file round trip unchanged.
    expect(JSON.parse(text) as unknown).toEqual(
      JSON.parse(JSON.stringify(recording)) as unknown,
    );
  });
});
