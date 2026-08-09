/**
 * The §26/§27 force-field determinism scenario (PH-8, 2026-08-09; §27, §33,
 * §39) — one headless run of twelve rigid bodies driven by four §27 fields
 * through `ForceFieldSystem`, stepped 300 fixed steps and reduced to per-step
 * checksums.
 *
 * PH-8 adds a per-fixed-step engine occupant to §39's step 5, so it owes §33 a
 * golden. This module is that obligation, executable: it builds a `"2d"`
 * `PhysicsWorld` on the **real Rapier 2D adapter**, registers a
 * `ForceFieldSystem` at `PRIORITY_FORCES` and a `PhysicsSystem` at
 * `PRIORITY_PHYSICS_SOLVE` on one `SystemRegistry`, drives 300 clean fixed
 * steps, and takes `world.checksum()` after every one.
 *
 * ## What the scenario deliberately exercises
 *
 * | surface | how it is reached |
 * |---|---|
 * | §27 field sampling for bodies | four fields, sampled at every awake dynamic body every step |
 * | both §41 unit readings | two `"acceleration"` fields and two `"force"` fields, interleaved |
 * | the summation order (§33) | four fields in a fixed registration order; FP addition is not associative |
 * | velocity-dependent fields | `dragField` reads the start-of-step velocity |
 * | position-dependent fields | `vortexField` and `radialField` read the centre of mass |
 * | time-dependent fields | a hand-written gust whose only input is §27's `time` |
 * | §27 volume inclusion | every field is wrapped in one `volumeField` box |
 * | §32 sleeping | world gravity is on, a floor is present, and the field volume stops **above** the resting height, so bodies settle, receive exactly zero, fall asleep, and the field pass then stops visiting them |
 * | mass variety | masses 0.5 … 6 kg, so `"acceleration"` and `"force"` fields separate |
 * | §39 wiring | one `SystemRegistry`, step 5 before step 6, checked by the digest |
 *
 * Sleeping is the deliberate one. `forEachActiveBody` skips a sleeping body,
 * so a scenario in which nothing ever sleeps would leave the most consequential
 * clause of this packet's contract unpinned — and the golden's
 * `sleepingAtEnd` count is what says out loud that the clause was reached.
 *
 * ## Clean steps, and no `Application`
 *
 * The registry is driven directly with an injected `TimeState` whose
 * `simulationTime` is `(step + 1) · DT` — an exact product rather than a
 * running sum, so §27's `time` argument is a pure function of the step index
 * and no accumulator drift enters the field samples. §10's accumulator, its
 * sub-step clamp and `droppedTime` are pinned by
 * `phase1-headless-stepping.test.ts` and are not this file's subject.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * Identical to WP-1.14's arrangement: the determinism gate demands the same
 * scenario run twice in-process **and** once in a fresh `node` child process,
 * and those runs are only evidence if they execute the same code. So one file
 * is loaded by Vitest (through Vite) and by plain `node` (through its default
 * type-stripping). The constraint that imposes: **this file must stay within
 * Node's erasable-syntax subset** — type annotations, `interface`, `type` and
 * `import type` are fine; `enum`, `namespace`, constructor parameter properties
 * and decorators are not.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target — the same tier, and for the
 * same reasons, as `golden/phase5.json`: Rapier is compiled WebAssembly, state
 * crosses the JS/wasm boundary as f64 → f32, and the wasm image is resolved per
 * platform by the package manager. The *field* arithmetic adds its own
 * runtime-bound inputs on top: `vortexField` and `radialField` call
 * `Math.sqrt`, and the gust below calls `Math.sin`. Cross-platform determinism
 * is **not** claimed.
 */

import { createChecksum } from "@four/diagnostics";
import { Vector2, Vector3 } from "@four/math";
import {
  PRIORITY_FORCES,
  PRIORITY_PHYSICS_SOLVE,
  SystemRegistry,
  createTimeState,
} from "@four/motion";
import {
  dragField,
  radialField,
  volumeField,
  vortexField,
  type FieldVolume,
} from "@four/particles";
import {
  Collider,
  ForceFieldSystem,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type ForceField,
} from "@four/physics";
import { Rapier2dAdapter } from "@four/physics-rapier";
import { Group } from "@four/scene";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Fixed steps the run covers (5 simulated seconds). */
export const STEP_COUNT = 300;

/** Dynamic bodies in the scene, plus one static floor. */
export const BODY_COUNT = 12;

/** 1-based fixed step of the early probe (t = 1 s). */
export const PROBE_STEP_ONE_SECOND = 60;

/** 1-based fixed step of the end-of-run probe. */
export const PROBE_STEP_END = STEP_COUNT;

/** The masses of the twelve bodies, in registration order (kg). */
export const MASSES: readonly number[] = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6,
];

/**
 * The one §27 volume every field is confined to (`center ± extents`).
 *
 * Its floor is `y = −3` and the bodies come to rest at `y = −3.25`, so a
 * settled body is **outside** it and its total is exactly `(0, 0, 0)` — which
 * is what lets §32 put it to sleep and lets this scenario pin the clause that a
 * sleeping body is never visited. A field that reached the resting height would
 * apply a small force every step and nothing would ever sleep.
 */
export const FIELD_VOLUME: FieldVolume = {
  shape: "box",
  center: new Vector3(0, 2, 0),
  extents: new Vector3(14, 5, 1),
};

/** Amplitude of the time-only gust, in newtons. */
export const GUST_AMPLITUDE = 4;

/** Angular frequency of the gust, in rad/s. */
export const GUST_FREQUENCY = 1.7;

/**
 * §27's *"user-defined callback"* built-in, and the one field here whose only
 * input is `time` — so the golden fails if the system ever stops handing over
 * §9's simulation clock, or starts handing over a wall clock.
 */
export function gustField(): ForceField {
  const scratch = new Vector3();
  return {
    sample(_position, _velocity, time, out) {
      const target = out ?? scratch;
      return target.set(GUST_AMPLITUDE * Math.sin(GUST_FREQUENCY * time), 0, 0);
    },
  };
}

/** A position or velocity as plain numbers, so results survive JSON. */
export type Triple = readonly [number, number, number];

/** One body's state at a probe step. */
export interface BodySample {
  mass: number;
  position: Triple;
  velocity: Triple;
  sleeping: boolean;
}

/** The numbers the golden file pins. */
export interface ForceFieldSummary {
  /** Checksum of all {@link STEP_COUNT} per-step checksums, in step order. */
  summaryDigest: number;
  /** `world.checksum()` after step 1. */
  firstStepChecksum: number;
  /** `world.checksum()` after step {@link STEP_COUNT}. */
  lastStepChecksum: number;
  /** Fixed steps on which at least one body was asleep. */
  stepsWithSleepers: number;
  /** Bodies asleep when the run ended (§32). */
  sleepingAtEnd: number;
  /** Field samples taken over the whole run — falls as bodies fall asleep. */
  sampleCount: number;
}

/** Everything one scenario run produces; `summary` is under golden lock. */
export interface ForceFieldScenarioResult {
  summary: ForceFieldSummary;
  /** One uint32 per fixed step, in step order. */
  checksums: number[];
  /** Bodies at step {@link PROBE_STEP_ONE_SECOND}. */
  atOneSecond: BodySample[];
  /** Bodies at step {@link PROBE_STEP_END}. */
  atEnd: BodySample[];
  /** Fixed steps driven (always {@link STEP_COUNT}). */
  stepCount: number;
  /** The adapter that actually ran, so the run cannot silently be a double. */
  adapterName: string;
  /** The force system's §39 priority, so the ordering claim is checkable. */
  forcePriority: number;
  /** The physics system's §39 priority. */
  solvePriority: number;
  /** Registered fields, so the summation order is part of the record. */
  fieldUnits: string[];
}

/** The twelve dynamic bodies plus the floor, in registration order. */
function buildScene(world: PhysicsWorld): Group[] {
  const floor = new Group();
  floor.transformAuthority = "physics";
  floor.transform.position.set(0, -4, 0);
  floor.addComponent(new RigidBody({ type: "static" }));
  floor.addComponent(
    new Collider({
      shape: { type: "rectangle", halfExtents: new Vector2(20, 0.5) },
    }),
  );
  world.addBody(floor);

  const nodes: Group[] = [];
  for (let i = 0; i < BODY_COUNT; i += 1) {
    const node = new Group();
    node.transformAuthority = "physics";
    // A fanned row, so the position-dependent fields see twelve different
    // radii and the bodies settle into a spread pile rather than a stack.
    node.transform.position.set(-5.5 + i, 2 + (i % 3) * 0.75, 0);
    node.addComponent(new RigidBody({ type: "dynamic", mass: MASSES[i] }));
    node.addComponent(
      new Collider({
        shape: { type: "rectangle", halfExtents: new Vector2(0.25, 0.25) },
      }),
    );
    world.addBody(node);
    nodes.push(node);
  }
  return nodes;
}

/** One body's state, as plain numbers. */
function sampleBody(node: Group, body: RigidBody): BodySample {
  return {
    mass: body.mass ?? Number.NaN,
    position: [
      node.transform.position.x,
      node.transform.position.y,
      node.transform.position.z,
    ],
    velocity: [
      body.linearVelocity.x,
      body.linearVelocity.y,
      body.linearVelocity.z,
    ],
    sleeping: body.sleeping,
  };
}

/**
 * Runs the scenario once and returns everything the test compares.
 *
 * Asynchronous because the Rapier adapter loads a WebAssembly module in
 * `initialize`; nothing else here awaits anything.
 */
export async function runForceFieldScenario(): Promise<ForceFieldScenarioResult> {
  const adapter = new Rapier2dAdapter();
  const world = new PhysicsWorld({ dimension: "2d", adapter });
  await world.initialize();

  const nodes = buildScene(world);
  const bodies = nodes.map((node) => {
    const body = world.getBody(node);
    if (body === undefined) {
      throw new Error("a scene body was not registered");
    }
    return body;
  });

  // Counted rather than asserted: the number of samples is what falls as §32
  // puts bodies to sleep, and it is the cheapest evidence that the field pass
  // is walking `forEachActiveBody` and not every registration.
  let sampleCount = 0;
  const counting = (inner: ForceField): ForceField => ({
    sample(position, velocity, time, out) {
      sampleCount += 1;
      return inner.sample(position, velocity, time, out);
    },
  });

  const forces = new ForceFieldSystem({ worlds: [world] });
  // Registration order is the summation order (§33): two accelerations and two
  // forces, interleaved so neither reading can be dropped without moving the
  // digest.
  forces.addField(
    counting(volumeField(dragField(0.35), FIELD_VOLUME)),
    "acceleration",
  );
  forces.addField(counting(volumeField(gustField(), FIELD_VOLUME)), "force");
  forces.addField(
    counting(
      volumeField(
        vortexField(new Vector3(0, -1, 0), new Vector3(0, 0, 1), 2.5),
        FIELD_VOLUME,
      ),
    ),
    "acceleration",
  );
  forces.addField(
    counting(volumeField(radialField(new Vector3(0, 3, 0), 6), FIELD_VOLUME)),
    "force",
  );

  const registry = new SystemRegistry();
  registry.register(forces);
  registry.register(new PhysicsSystem({ worlds: [world] }));

  const time = createTimeState({ fixedDeltaTime: FIXED_TIME_STEP });
  const checksums: number[] = [];
  const summary = createChecksum();
  let stepsWithSleepers = 0;
  let atOneSecond: BodySample[] = [];
  let atEnd: BodySample[] = [];

  for (let step = 1; step <= STEP_COUNT; step += 1) {
    time.frame = step;
    time.simulationStep = step;
    // An exact product, not a running sum: §27's `time` is then a pure function
    // of the step index and carries no accumulator drift into a field sample.
    time.simulationTime = step * FIXED_TIME_STEP;
    time.deltaTime = FIXED_TIME_STEP;
    time.unscaledDeltaTime = FIXED_TIME_STEP;
    registry.runFixedStep(time);

    const checksum = world.checksum();
    checksums.push(checksum);
    summary.addFloat(checksum);

    let sleepers = 0;
    for (const body of bodies) {
      if (body.sleeping) {
        sleepers += 1;
      }
    }
    if (sleepers > 0) {
      stepsWithSleepers += 1;
    }
    if (step === PROBE_STEP_ONE_SECOND) {
      atOneSecond = nodes.map((node, i) => sampleBody(node, bodies[i]));
    }
    if (step === PROBE_STEP_END) {
      atEnd = nodes.map((node, i) => sampleBody(node, bodies[i]));
    }
  }

  const sleepingAtEnd = atEnd.filter((sample) => sample.sleeping).length;
  const result: ForceFieldScenarioResult = {
    summary: {
      summaryDigest: summary.digest(),
      firstStepChecksum: checksums[0],
      lastStepChecksum: checksums[checksums.length - 1],
      stepsWithSleepers,
      sleepingAtEnd,
      sampleCount,
    },
    checksums,
    atOneSecond,
    atEnd,
    stepCount: STEP_COUNT,
    adapterName: world.adapter.name,
    forcePriority: forces.priority,
    solvePriority: PRIORITY_PHYSICS_SOLVE,
    fieldUnits: forces.fields.map((entry) => entry.units),
  };

  world.dispose();
  if (forces.priority !== PRIORITY_FORCES) {
    throw new Error("the force system left §39's step-5 slot");
  }
  return result;
}
