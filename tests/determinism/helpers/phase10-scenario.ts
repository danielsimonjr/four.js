/**
 * The Phase 10 determinism scenario (plan §6i P10-4, WP-10.4; §33–34, §113,
 * §92) — one headless 2D Rapier run that is **recorded**, then **replayed into a
 * fresh world**, then **seeked into through a periodic snapshot**, reduced to
 * digests a golden file can pin.
 *
 * ## What is under golden lock here, and why it is unusual
 *
 * Every earlier phase pinned the digest of a *simulation*: hash the world after
 * each fixed step, hash the sequence, commit the number. This one pins that too
 * — but its primary artifact is **the recording itself**. §34 defines a document
 * (format version, adapter identity, seed, fixed delta, base64 initial snapshot,
 * inputs by step, per-frame step counts and dropped time, periodic snapshots,
 * final checksum), and §113's exit is that such a document can be *captured,
 * replayed, and inspected*. A golden over the document's bytes therefore pins
 * something no per-step checksum can: that the capture is reproducible, not only
 * the simulation it captured. If Rapier's snapshot encoding, the base64 writer,
 * the key order of the envelope, or the snapshot cadence changes, this digest
 * moves and the earlier phases' goldens do not.
 *
 * ### How a text digest is taken with a float hasher (decision, WP-10.4)
 *
 * `@four/diagnostics`'s `checksum.ts` offers exactly two primitives —
 * `createChecksum()` and `hashFloats(xs)` — and **neither takes a string or a
 * byte array**; there is no string/bytes entry point to reuse. So
 * {@link digestText} encodes the document to UTF-8 with `TextEncoder` and feeds
 * the resulting bytes to `hashFloats` as numbers. Each byte is an exact integer,
 * so §33's 1e-6 quantization is lossless on it, and the digest is FNV-1a over a
 * deterministic function of the bytes — the *same* hasher every other golden in
 * this directory uses. It is deliberately not called "FNV-1a of the UTF-8
 * bytes": D6's encoding absorbs each value as two 32-bit words, so this digest
 * would not match a byte-wise FNV-1a of the same text computed elsewhere. What
 * it is, is stable, reproducible, and localisable — which is what a golden
 * needs. The per-step checksum stream is digested alongside it, so a failure can
 * be attributed to the *document* or to the *simulation* rather than to "phase
 * 10".
 *
 * ## Self-contained on purpose (the WP-5.8 precedent)
 *
 * `tests/integration/helpers/replay-scenarios.ts` (this packet's other half) has
 * the same builders and the same `ReplayTarget` wrapper pattern, and this file
 * deliberately does **not** import them. A golden is only evidence if the code
 * that produced it is pinned: importing the integration rig would let an
 * unrelated edit to it silently change what these digests mean. Every phase
 * scenario in this directory is self-contained for that reason.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * The determinism gate (plan §8) demands the same scenario run twice in-process
 * **and** once in a fresh `node` child process, and those runs are only evidence
 * if they execute the same code. So one file is loaded by Vitest (through Vite)
 * and by plain `node` (through its default type-stripping, Node ≥ 22.18; this
 * repo pins Node ≥ 20 and runs 22.22). The constraint that imposes: **this file
 * must stay within Node's erasable-syntax subset** — type annotations,
 * `interface`, `type` and `import type` are fine; `enum`, `namespace`,
 * constructor parameter properties and decorators are not.
 *
 * Rapier's wasm image loads asynchronously, so {@link runPhase10Scenario} is
 * `async` and every world is `await world.initialize()`-ed before a step is
 * taken. (Rapier's loader writes one "using deprecated parameters" notice to
 * **stderr**; the child's stdout stays a single clean JSON object.)
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target, and for Phase 5's reasons
 * plus one more: the recording digest additionally depends on Rapier's
 * `World.takeSnapshot` byte encoding, which is a property of the pinned wasm
 * image rather than of anything this repository controls.
 */

import {
  ReplayPlayer,
  ReplayRecorder,
  encodeReplayRecording,
  hashFloats,
  type JsonValue,
  type ReplayRecording,
  type ReplaySnapshot,
  type ReplayTarget,
} from "@four/diagnostics";
import { Vector2, Vector3 } from "@four/math";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type CollisionShape,
  type PhysicsSnapshot,
  type WorldPhysicsEvent,
} from "@four/physics";
import { Rapier2dAdapter } from "@four/physics-rapier";
import { Group, type Node } from "@four/scene";
import { Application } from "four/application";

/**
 * The one narrowing the §34 snapshot round trip needs, and why it is a named
 * helper rather than an inline cast.
 *
 * `ReplaySnapshot.configuration` is `unknown` **by design**:
 * `@four/diagnostics` may not import `@four/physics`, so it cannot name
 * `PhysicsSnapshotConfiguration` (`packages/diagnostics/src/recorder.ts`
 * says so at the field). `PhysicsSnapshot.configuration` *is* that type. The
 * two declarations are therefore assignable in the **produce** direction
 * (`createSnapshot`) and not in the **consume** direction — which the tests
 * typecheck gate (2026-08-21) is what first made visible; before it, nothing
 * compiled this directory at all.
 *
 * The cast is safe because nothing trusts it: `PhysicsWorld.restoreSnapshot`
 * validates adapter name, adapter version and — when the field is present —
 * the configuration field by field, and refuses a mismatch (§34). A snapshot
 * carrying a foreign `configuration` is rejected at run time by the code under
 * test, which is precisely what these scenarios assert. No assertion is
 * weakened by spelling the conversion here.
 */
function asPhysicsSnapshot(snapshot: ReplaySnapshot): PhysicsSnapshot {
  return snapshot as PhysicsSnapshot;
}

// ---------------------------------------------------------------------------
// Scenario constants (§7a: seconds and world units, never milliseconds)
// ---------------------------------------------------------------------------

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long — 4 s. */
export const STEP_COUNT = 240;

/** §34 periodic snapshot cadence. */
export const SNAPSHOT_INTERVAL_STEPS = 30;

/** Periodic snapshots the cadence yields over the run (initial one excluded). */
export const SNAPSHOT_COUNT = STEP_COUNT / SNAPSHOT_INTERVAL_STEPS;

/** The §33 seed recorded in the document. Nothing in this scenario draws on it. */
export const SEED = 1337;

/** Bodies the scene registers: the ground plus three balls. */
export const BODY_COUNT = 4;

/** The step the seek case lands on — five past the fifth periodic snapshot. */
export const SEEK_STEP = SNAPSHOT_INTERVAL_STEPS * 5 + 5;

/** Static ground, 16 units wide, top surface at y = 0. */
export const GROUND = { halfWidth: 8, halfHeight: 0.5, centerY: -0.5 };

/** The three dropped balls, in registration order (§33's checksum order). */
export const BALLS = [
  { name: "ball-0", x: -1.5, y: 1.2 },
  { name: "ball-1", x: 0, y: 2.1 },
  { name: "ball-2", x: 1.5, y: 3 },
] as const;

/** Every ball: radius in units, mass in kg (§23), §24 restitution and friction. */
export const BALL = { radius: 0.3, mass: 1, restitution: 0.3, friction: 0.5 };

/** One scripted §26 input: a body name and an impulse in newton-seconds. */
export type ImpulsePayload = {
  readonly body: string;
  readonly impulse: readonly [number, number, number];
};

/** A scripted input and the 0-based step it is applied before. */
export interface ScheduledInput {
  readonly step: number;
  readonly payload: ImpulsePayload;
}

/**
 * The scripted inputs, in **insertion order** (§34) — two share step 20, which
 * is what makes "several inputs may share a step and replay in the order they
 * were recorded" part of what this golden pins.
 */
export const INPUT_SCHEDULE: readonly ScheduledInput[] = [
  { step: 20, payload: { body: "ball-0", impulse: [0.6, 3.2, 0] } },
  { step: 20, payload: { body: "ball-1", impulse: [-0.4, 2, 0] } },
  { step: 75, payload: { body: "ball-2", impulse: [0.9, 4, 0] } },
  { step: 140, payload: { body: "ball-0", impulse: [-1.1, 1.5, 0] } },
];

// ---------------------------------------------------------------------------
// Digests (see the module header on how a text digest is taken)
// ---------------------------------------------------------------------------

/**
 * The D6 digest of `values` in order — the hasher every golden in this
 * directory uses. uint32 checksums quantize to at most 4.29e15, inside the
 * 53-bit-safe range `hashFloats` requires.
 */
export function digestNumbers(values: readonly number[]): number {
  return hashFloats(values);
}

/**
 * The D6 digest of `text`'s UTF-8 bytes, each byte absorbed as a number.
 *
 * See the module header: `checksum.ts` has no string or byte entry point, so the
 * bytes are fed to `hashFloats`. Exact for every byte, and therefore a
 * deterministic function of the text.
 */
export function digestText(text: string): number {
  return hashFloats(new TextEncoder().encode(text));
}

/** UTF-8 byte length of `text` — pinned beside its digest, as readable evidence. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------
// The ReplayTarget wrapper (the pattern; see the integration helper's header)
// ---------------------------------------------------------------------------

/** Narrows a recorded §34 payload back to {@link ImpulsePayload}. */
function decodeImpulse(payload: JsonValue): ImpulsePayload {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new TypeError("Replay input payload must be an object.");
  }
  const record = payload as { readonly [key: string]: JsonValue };
  const body = record.body;
  const impulse = record.impulse;
  if (typeof body !== "string") {
    throw new TypeError("Replay input payload.body must be a string.");
  }
  if (!Array.isArray(impulse)) {
    throw new TypeError("Replay input payload.impulse must be [x, y, z].");
  }
  // `Array.isArray`'s predicate is `any[]`; re-state the element type §34
  // guarantees and check each component below.
  const components: readonly JsonValue[] = impulse;
  if (components.length !== 3) {
    throw new TypeError("Replay input payload.impulse must be [x, y, z].");
  }
  const x = components[0];
  const y = components[1];
  const z = components[2];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") {
    throw new TypeError("Replay input payload.impulse must hold numbers.");
  }
  return { body, impulse: [x, y, z] };
}

/**
 * One `PhysicsWorld` plus this scenario's input vocabulary — the §34 members
 * delegate verbatim, and only `applyInput` is the application's.
 */
export class ImpulseReplayTarget implements ReplayTarget {
  readonly #world: PhysicsWorld;

  readonly #bodies: ReadonlyMap<string, RigidBody>;

  readonly #scratch = new Vector3();

  #inputsApplied = 0;

  constructor(world: PhysicsWorld, bodies: ReadonlyMap<string, RigidBody>) {
    this.#world = world;
    this.#bodies = bodies;
  }

  get inputsApplied(): number {
    return this.#inputsApplied;
  }

  checksum(): number {
    return this.#world.checksum();
  }

  createSnapshot(): ReplaySnapshot {
    return this.#world.createSnapshot();
  }

  restoreSnapshot(snapshot: ReplaySnapshot): void {
    this.#world.restoreSnapshot(asPhysicsSnapshot(snapshot));
  }

  applyInput(step: number, payload: JsonValue): void {
    const input = decodeImpulse(payload);
    const body = this.#bodies.get(input.body);
    if (body === undefined) {
      throw new TypeError(
        `Replay input at step ${String(step)} names an unknown body.`,
      );
    }
    this.#scratch.set(input.impulse[0], input.impulse[1], input.impulse[2]);
    body.applyImpulse(this.#scratch);
    this.#inputsApplied += 1;
  }
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/** Everything one built scenario exposes to the runs below. */
interface Rig {
  readonly app: Application;
  readonly world: PhysicsWorld;
  readonly target: ImpulseReplayTarget;
  stepOnce(): void;
  drainEvents(): WorldPhysicsEvent[];
  dispose(): void;
}

/** Registers one body and returns its §23 component. */
function addBody(
  world: PhysicsWorld,
  scene: Node,
  type: "dynamic" | "static",
  shape: CollisionShape,
  options: {
    name: string;
    x: number;
    y: number;
    mass?: number;
    restitution?: number;
    friction?: number;
  },
): RigidBody {
  const node = new Group();
  node.name = options.name;
  node.transform.position.set(options.x, options.y, 0);
  node.transformAuthority = type === "dynamic" ? "physics" : "manual";

  const body = new RigidBody({
    type,
    ...(options.mass === undefined ? {} : { mass: options.mass }),
  });
  node.addComponent(body);
  node.addComponent(
    new Collider({
      shape,
      ...(options.restitution === undefined
        ? {}
        : { restitution: options.restitution }),
      ...(options.friction === undefined ? {} : { friction: options.friction }),
    }),
  );
  scene.add(node);
  world.addBody(node);
  return body;
}

/**
 * Builds a fresh application, a fresh 2D Rapier world, and the four bodies, in
 * the fixed registration order §33's checksum visits.
 *
 * Nothing is cached at module scope (the *wasm image* is, inside
 * `@four/physics-rapier`, which is a decoded module and not solver state), so
 * calling this twice in one process is a genuine second world.
 */
async function createRig(): Promise<Rig> {
  const app = new Application({
    fixedTimeStep: FIXED_TIME_STEP,
    // §43 pose capture is a render concern and never feeds back into physics
    // state (§10, §42); off, so every number here is the solver's alone.
    poseInterpolation: false,
  });
  const system = new PhysicsSystem();
  app.systems.register(system);
  await app.initialize();

  const world = new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
  });
  await world.initialize();
  system.track(world);

  const events: WorldPhysicsEvent[] = [];
  const bodies = new Map<string, RigidBody>();
  const watch = (body: RigidBody): RigidBody => {
    body.on("collisionstart", (event) => events.push(event));
    body.on("collisionstay", (event) => events.push(event));
    body.on("collisionend", (event) => events.push(event));
    return body;
  };

  watch(
    addBody(
      world,
      app.scene,
      "static",
      {
        type: "rectangle",
        halfExtents: new Vector2(GROUND.halfWidth, GROUND.halfHeight),
      },
      { name: "ground", x: 0, y: GROUND.centerY, friction: 0.8 },
    ),
  );
  for (const ball of BALLS) {
    bodies.set(
      ball.name,
      watch(
        addBody(
          world,
          app.scene,
          "dynamic",
          { type: "circle", radius: BALL.radius },
          {
            name: ball.name,
            x: ball.x,
            y: ball.y,
            mass: BALL.mass,
            restitution: BALL.restitution,
            friction: BALL.friction,
          },
        ),
      ),
    );
  }

  app.start();

  return {
    app,
    world,
    target: new ImpulseReplayTarget(world, bodies),
    stepOnce(): void {
      app.step(FIXED_TIME_STEP);
    },
    drainEvents(): WorldPhysicsEvent[] {
      const drained = events.slice();
      events.length = 0;
      return drained;
    },
    dispose(): void {
      world.dispose();
      app.dispose();
    },
  };
}

/** Contact points carried by one step's dispatched §29 events. */
function countContacts(events: readonly WorldPhysicsEvent[]): number {
  let total = 0;
  for (const event of events) {
    if ("contacts" in event) {
      total += event.contacts.length;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** The values `golden/phase10.json` pins. */
export interface Phase10Summary {
  /** D6 digest of the §34 document's JSON text — the packet's headline artifact. */
  recordingDigest: number;
  /** UTF-8 length of that text, in bytes. */
  recordingLength: number;
  /** D6 digest of the base64 initial snapshot alone, to localise a change. */
  initialSnapshotDigest: number;
  /** D6 digest of the recorded run's per-step §33 checksums, in step order. */
  stepChecksumDigest: number;
  /** D6 digest of the *replay's* per-step checksums; must equal the above. */
  replayChecksumDigest: number;
  /** D6 digest of the checksums after seeking to {@link SEEK_STEP} and playing on. */
  seekTailDigest: number;
  /** `world.checksum()` after the first fixed step. */
  firstStepChecksum: number;
  /** `world.checksum()` after the last fixed step. */
  lastStepChecksum: number;
  /** §34's `finalChecksum`; must equal {@link Phase10Summary.lastStepChecksum}. */
  finalChecksum: number;
  /**
   * The document's declared §34 format version (2026-08-06, PH-6).
   *
   * `2` for this scenario, because a `PhysicsWorld` reports a world
   * configuration and the document therefore carries one. A recording with no
   * configuration still declares `1` — the version is the content's, not the
   * build's.
   */
  formatVersion: number;
  /**
   * The keys of §34's recorded "solver settings", sorted (PH-6).
   *
   * The readable half of the configuration evidence: this pins *that* the
   * document carries the world configuration a replay is refused against, and
   * which fields it names, without pinning the values twice (they are already
   * inside `recordingDigest`).
   */
  worldConfigurationKeys: readonly string[];
  /** `PhysicsSolverAdapter.name` the document is keyed on (§34). */
  adapterName: string;
  /** `PhysicsSolverAdapter.version` the document is keyed on (§34). */
  adapterVersion: string;
  /** Recorded inputs (§34). */
  inputCount: number;
  /** Recorded frames (§34). */
  frameCount: number;
  /** Recorded periodic snapshots (§34), the initial one excluded. */
  snapshotCount: number;
  /** 0-based step of the first §29 contact. */
  firstContactStep: number;
  /** Steps on which any contact was dispatched. */
  contactStepCount: number;
  /** Contact points dispatched over the whole run. */
  totalContacts: number;
}

/** Everything one scenario run produces; `summary` is under golden lock. */
export interface Phase10ScenarioResult {
  summary: Phase10Summary;
  /** `world.checksum()` after every fixed step of the recorded run (§33). */
  checksums: number[];
  /** The same, produced by the replay into a fresh world. */
  replayChecksums: number[];
  /** §29 contact points dispatched during each step of the recorded run. */
  contactsPerStep: number[];
  /** Host frames driven (always {@link STEP_COUNT}). */
  frameCount: number;
  /** Fixed steps the scheduler ran; must equal `frameCount`. */
  fixedStepCount: number;
  /** Simulation time discarded by the §10 sub-step clamp; must be 0 here. */
  droppedTime: number;
  /** §42 conflict warnings during the drive loop; must be 0. */
  authorityWarningCount: number;
  /** Bodies registered in the recorded world. */
  bodyCount: number;
  /** Inputs the target applied live, and again during the replay. */
  inputsApplied: number;
  replayInputsApplied: number;
  /** Whether `ReplayPlayer.verifyChecksum()` accepted the replay (§33). */
  replayVerified: boolean;
  /** The step the seek case landed on. */
  seekStep: number;
  /** Fixed steps `seekToStep` re-simulated — the cost §34's snapshots buy down. */
  seekCost: number;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Records the scenario, replays it into a fresh world, seeks into it, and
 * returns every digest the golden pins.
 *
 * Three worlds are built and disposed: the recorded one, the replay one, and a
 * third for the seek — so the seek's tail is reached from a snapshot rather than
 * from a world that had already played the whole recording.
 *
 * §42 conflict warnings go to `console.warn` with a `[four]` prefix; they are
 * counted here so "every transform is written by its one owner" is a measured
 * zero. Anything else — Rapier's own loader notices — is passed through.
 */
export async function runPhase10Scenario(): Promise<Phase10ScenarioResult> {
  const originalWarn = console.warn;
  let authorityWarningCount = 0;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === "string" && args[0].startsWith("[four]")) {
      authorityWarningCount += 1;
      return;
    }
    originalWarn(...args);
  };

  try {
    // --- record ------------------------------------------------------------
    const rig = await createRig();
    const recorder = new ReplayRecorder();
    const checksums: number[] = [];
    const contactsPerStep: number[] = [];
    let recording: ReplayRecording;
    let bodyCount = 0;
    let fixedStepCount = 0;
    let droppedTime = 0;
    let inputsApplied = 0;
    try {
      recorder.begin(rig.target, {
        fixedDeltaTime: FIXED_TIME_STEP,
        seed: SEED,
        snapshotIntervalSteps: SNAPSHOT_INTERVAL_STEPS,
        metadata: { scenario: "phase10-2d-drop", steps: STEP_COUNT },
      });
      let previousSteps = 0;
      let previousDropped = 0;
      for (let step = 0; step < STEP_COUNT; step += 1) {
        for (const entry of INPUT_SCHEDULE) {
          if (entry.step !== step) {
            continue;
          }
          // The live path *is* the replay path: same method, same decoder.
          rig.target.applyInput(step, entry.payload);
          recorder.recordInput(step, entry.payload);
        }
        rig.drainEvents();
        rig.stepOnce();
        const time = rig.app.time;
        recorder.recordFrame(
          time.simulationStep - previousSteps,
          time.droppedTime - previousDropped,
        );
        previousSteps = time.simulationStep;
        previousDropped = time.droppedTime;
        contactsPerStep.push(countContacts(rig.drainEvents()));
        checksums.push(rig.world.checksum());
      }
      recording = recorder.end();
      bodyCount = rig.world.size;
      fixedStepCount = rig.app.time.simulationStep;
      droppedTime = rig.app.time.droppedTime;
      inputsApplied = rig.target.inputsApplied;
    } finally {
      recorder.abort();
      rig.dispose();
    }

    // --- replay into a fresh world -----------------------------------------
    const replayRig = await createRig();
    const replayChecksums: number[] = [];
    let replayVerified = false;
    let replayInputsApplied = 0;
    try {
      const player = new ReplayPlayer(recording, {
        target: replayRig.target,
        stepFn: () => {
          replayRig.stepOnce();
        },
        verifyChecksums: true,
        onStep: (event) => {
          replayChecksums.push(event.checksum ?? -1);
        },
      });
      player.load();
      while (player.stepOnce()) {
        /* one fixed step at a time (§113) */
      }
      replayVerified = player.verifyChecksum();
      replayInputsApplied = replayRig.target.inputsApplied;
    } finally {
      replayRig.dispose();
    }

    // --- seek into it through a periodic snapshot ---------------------------
    const seekRig = await createRig();
    const seekTail: number[] = [];
    let seekCost = 0;
    try {
      const player = new ReplayPlayer(recording, {
        target: seekRig.target,
        stepFn: () => {
          seekRig.stepOnce();
        },
        verifyChecksums: true,
        onStep: (event) => {
          if (!event.resimulating) {
            seekTail.push(event.checksum ?? -1);
          }
        },
      });
      player.load();
      seekCost = player.seekToStep(SEEK_STEP);
      while (player.stepOnce()) {
        /* continue identically from the restored state (§34) */
      }
    } finally {
      seekRig.dispose();
    }

    // --- digests -----------------------------------------------------------
    const text = encodeReplayRecording(recording);
    let firstContactStep = -1;
    let contactStepCount = 0;
    let totalContacts = 0;
    for (let i = 0; i < contactsPerStep.length; i += 1) {
      if (contactsPerStep[i] > 0) {
        if (firstContactStep < 0) {
          firstContactStep = i;
        }
        contactStepCount += 1;
        totalContacts += contactsPerStep[i];
      }
    }

    return {
      summary: {
        recordingDigest: digestText(text),
        recordingLength: utf8Length(text),
        initialSnapshotDigest: digestText(recording.initialSnapshot),
        stepChecksumDigest: digestNumbers(checksums),
        replayChecksumDigest: digestNumbers(replayChecksums),
        seekTailDigest: digestNumbers(seekTail),
        firstStepChecksum: checksums[0],
        lastStepChecksum: checksums[checksums.length - 1],
        finalChecksum: recording.finalChecksum,
        formatVersion: recording.formatVersion,
        worldConfigurationKeys:
          typeof recording.worldConfiguration === "object" &&
          recording.worldConfiguration !== null &&
          !Array.isArray(recording.worldConfiguration)
            ? Object.keys(recording.worldConfiguration).sort()
            : [],
        adapterName: recording.adapterName,
        adapterVersion: recording.adapterVersion,
        inputCount: recording.inputs.length,
        frameCount: recording.frames.length,
        snapshotCount: recording.periodicSnapshots?.length ?? 0,
        firstContactStep,
        contactStepCount,
        totalContacts,
      },
      checksums,
      replayChecksums,
      contactsPerStep,
      frameCount: STEP_COUNT,
      fixedStepCount,
      droppedTime,
      authorityWarningCount,
      bodyCount,
      inputsApplied,
      replayInputsApplied,
      replayVerified,
      seekStep: SEEK_STEP,
      seekCost,
    };
  } finally {
    console.warn = originalWarn;
  }
}
