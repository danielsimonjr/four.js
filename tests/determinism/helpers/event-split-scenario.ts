/**
 * The §39 step-9 split determinism scenario (PH-21, 2026-08-21; §33, §39, §6b)
 * — one headless pile of colliding rigid bodies, run twice: once with
 * `PhysicsSystem` dispatching its own events at step 6 (the default, and what
 * every committed golden was recorded under), and once with dispatch moved to a
 * `PhysicsEventSystem` at `PRIORITY_EVENT_DISPATCH`.
 *
 * PH-21 makes §39's order configurable where it was fixed, so it owes §33 a
 * golden of its own. What that golden has to pin is unusual and is the whole
 * point of the packet: **the two arms must agree, step for step**. A split that
 * moved the simulation would not be a re-ordering of the frame, it would be a
 * different simulation.
 *
 * ## What the scenario deliberately exercises
 *
 * | surface | how it is reached |
 * |---|---|
 * | real collision events | eight 0.5 m boxes dropped onto a floor and onto each other, so `collisionstart`/`stay`/`end` all occur |
 * | the two-pass rule (§6b) | listeners record the step they fired on; no event may be delivered before every world has stepped |
 * | multi-world tracking | a second, quieter world is tracked by the same systems, so dispatch order across worlds is part of the digest |
 * | the ordering difference | a marker system at `PRIORITY_CONSTRAINTS` (700) counts its runs, and every listener records the count it saw |
 * | §33 iteration order | listeners are attached in registration order and the digest is fed in delivery order |
 *
 * The marker count is the measurement that makes the split visible rather than
 * merely asserted: with dispatch at step 6 a listener on fixed step *n* sees
 * `n − 1` constraint runs (constraints have not run yet), and with dispatch at
 * step 9 it sees `n`. Same events, same order, same emitters — later.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * WP-1.14's arrangement, unchanged: the in-process runs and the fresh-`node`
 * child process are only evidence if they execute the same code, so one file is
 * loaded by Vitest (through Vite) and by plain `node` (through its default
 * type-stripping). It must therefore stay inside Node's erasable-syntax subset
 * — annotations, `interface`, `type` and `import type` are fine; `enum`,
 * `namespace`, parameter properties and decorators are not.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, for exactly `golden/phase5.json`'s reasons: Rapier is
 * compiled WebAssembly, state crosses the JS/wasm boundary as f64 → f32, and
 * the wasm image is resolved per platform by the package manager. Nothing this
 * packet added does arithmetic at all — the split moves a dispatch loop between
 * two priorities — so the tier is entirely the solver's.
 */

import { createChecksum } from "@four/diagnostics";
import { Vector2 } from "@four/math";
import {
  PRIORITY_CONSTRAINTS,
  PRIORITY_EVENT_DISPATCH,
  PRIORITY_PHYSICS_SOLVE,
  SystemRegistry,
  createTimeState,
  type SimulationSystem,
} from "@four/motion";
import {
  Collider,
  PhysicsEventSystem,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
} from "@four/physics";
import { Rapier2dAdapter } from "@four/physics-rapier";
import { Group } from "@four/scene";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Fixed steps the run covers (3 simulated seconds). */
export const STEP_COUNT = 180;

/** Dynamic bodies in the busy world, plus one static floor. */
export const BODY_COUNT = 8;

/** Which arm of the run this is. */
export type DispatchArm = "combined" | "split";

/** The numbers the golden file pins, per arm. */
export interface EventSplitSummary {
  /** Checksum of all {@link STEP_COUNT} per-step checksums, in step order. */
  summaryDigest: number;
  /** `world.checksum()` of the busy world after step 1. */
  firstStepChecksum: number;
  /** `world.checksum()` of the busy world after step {@link STEP_COUNT}. */
  lastStepChecksum: number;
  /** Physics events delivered to listeners over the whole run. */
  eventCount: number;
  /** FNV-1a over every delivered event's step, kind and emitter, in order. */
  eventDigest: number;
}

/** Everything one arm produces. */
export interface EventSplitArmResult {
  summary: EventSplitSummary;
  /** One uint32 per fixed step, in step order (the busy world). */
  checksums: number[];
  /**
   * Constraint-system runs observed by the first event of each fixed step,
   * minus the step index — `-1` with dispatch at step 6, `0` at step 9.
   *
   * The measured difference the split exists to produce. Empty entries are not
   * recorded, so a step with no events contributes nothing.
   */
  constraintOffsets: number[];
  /** The §39 priority dispatch actually ran at. */
  dispatchPriority: number;
}

/** Both arms, plus the facts the test compares them on. */
export interface EventSplitScenarioResult {
  combined: EventSplitArmResult;
  split: EventSplitArmResult;
  /** Fixed steps driven (always {@link STEP_COUNT}). */
  stepCount: number;
  /** The adapter that actually ran, so the run cannot silently be a double. */
  adapterName: string;
}

/** A body's identity in the digest — registration index, stable across runs. */
const EVENT_KINDS = [
  "collisionstart",
  "collisionstay",
  "collisionend",
  "triggerenter",
  "triggerexit",
  "sleep",
  "wake",
];

/** The dynamic bodies of one world, in registration order, plus a floor. */
function buildScene(world: PhysicsWorld, count: number): RigidBody[] {
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

  const bodies: RigidBody[] = [];
  for (let i = 0; i < count; i += 1) {
    const node = new Group();
    node.transformAuthority = "physics";
    // A narrow stack, so the boxes land on the floor *and* on each other and
    // the run produces starts, stays and ends rather than one contact apiece.
    node.transform.position.set(-0.6 + (i % 2) * 1.2, -2 + i * 0.9, 0);
    node.addComponent(new RigidBody({ type: "dynamic", mass: 1 + i * 0.25 }));
    node.addComponent(
      new Collider({
        shape: { type: "rectangle", halfExtents: new Vector2(0.25, 0.25) },
      }),
    );
    bodies.push(world.addBody(node));
  }
  return bodies;
}

/** A marker system at §39 step 7 that only counts its own runs. */
function makeMarker(): SimulationSystem & { runs: number } {
  return {
    priority: PRIORITY_CONSTRAINTS,
    runs: 0,
    initialize(): void {
      // Nothing to set up: the marker's whole state is its counter.
    },
    fixedUpdate(): void {
      this.runs += 1;
    },
    dispose(): void {
      // Nothing to release.
    },
  };
}

/**
 * Runs one arm and returns everything the test compares.
 *
 * Asynchronous because the Rapier adapter loads a WebAssembly module in
 * `initialize`; nothing else here awaits anything.
 */
export async function runEventSplitArm(
  arm: DispatchArm,
): Promise<EventSplitArmResult> {
  const busyAdapter = new Rapier2dAdapter();
  const busy = new PhysicsWorld({ dimension: "2d", adapter: busyAdapter });
  await busy.initialize();
  const quietAdapter = new Rapier2dAdapter();
  const quiet = new PhysicsWorld({ dimension: "2d", adapter: quietAdapter });
  await quiet.initialize();

  const bodies = buildScene(busy, BODY_COUNT);
  const quietBodies = buildScene(quiet, 2);

  const marker = makeMarker();
  const registry = new SystemRegistry();
  const physics = new PhysicsSystem({
    worlds: [busy, quiet],
    dispatchEvents: arm === "combined",
  });
  registry.register(physics);
  registry.register(marker);
  let dispatchPriority = PRIORITY_PHYSICS_SOLVE;
  if (arm === "split") {
    const events = new PhysicsEventSystem({ source: physics });
    registry.register(events);
    dispatchPriority = events.priority;
  }

  const digest = createChecksum();
  let eventCount = 0;
  const constraintOffsets: number[] = [];
  let currentStep = 0;
  let recordedThisStep = false;

  const listen = (body: RigidBody, id: number): void => {
    for (let k = 0; k < EVENT_KINDS.length; k += 1) {
      const kind = EVENT_KINDS[k];
      body.on(kind as "collisionstart", () => {
        eventCount += 1;
        // Delivery order is the digest's input: step, kind index, emitter id.
        digest.addFloat(currentStep);
        digest.addFloat(k);
        digest.addFloat(id);
        if (!recordedThisStep) {
          recordedThisStep = true;
          constraintOffsets.push(marker.runs - currentStep);
        }
      });
    }
  };
  bodies.forEach((body, index) => {
    listen(body, index);
  });
  quietBodies.forEach((body, index) => {
    listen(body, 100 + index);
  });

  const time = createTimeState({ fixedDeltaTime: FIXED_TIME_STEP });
  const checksums: number[] = [];
  const summary = createChecksum();

  for (let step = 1; step <= STEP_COUNT; step += 1) {
    currentStep = step;
    recordedThisStep = false;
    time.frame = step;
    time.simulationStep = step;
    // An exact product, not a running sum — no accumulator drift enters a step.
    time.simulationTime = step * FIXED_TIME_STEP;
    time.deltaTime = FIXED_TIME_STEP;
    time.unscaledDeltaTime = FIXED_TIME_STEP;
    registry.runFixedStep(time);

    const checksum = busy.checksum();
    checksums.push(checksum);
    summary.addFloat(checksum);
  }

  const result: EventSplitArmResult = {
    summary: {
      summaryDigest: summary.digest(),
      firstStepChecksum: checksums[0],
      lastStepChecksum: checksums[checksums.length - 1],
      eventCount,
      eventDigest: digest.digest(),
    },
    checksums,
    constraintOffsets,
    dispatchPriority,
  };

  registry.dispose();
  busy.dispose();
  quiet.dispose();
  if (arm === "split" && dispatchPriority !== PRIORITY_EVENT_DISPATCH) {
    throw new Error("the event system left §39's step-9 slot");
  }
  return result;
}

/** Runs both arms, in a fixed order, on freshly built worlds. */
export async function runEventSplitScenario(): Promise<EventSplitScenarioResult> {
  const combined = await runEventSplitArm("combined");
  const split = await runEventSplitArm("split");
  return {
    combined,
    split,
    stepCount: STEP_COUNT,
    adapterName: new Rapier2dAdapter().name,
  };
}
