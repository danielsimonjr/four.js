/**
 * The `PH-11b` swept-character determinism scenario (2026-08-21; §12, §30,
 * §33, §39) — five capsules resolved against real Rapier 3D geometry through
 * `PhysicsWorld.shapeCast`, stepped 300 fixed steps and reduced to per-step
 * checksums.
 *
 * `SweptCharacterController` puts new arithmetic into §39's step 4 **and**
 * consumes solver queries, so it owes §33 a golden on a real solver rather than
 * on the scripted double its unit tests use. This module is that obligation,
 * executable: it builds a `"3d"` `PhysicsWorld` on the **real Rapier 3D
 * adapter**, registers a `SweptCharacterSystem` at `PRIORITY_KINEMATICS` and a
 * `PhysicsSystem` at `PRIORITY_PHYSICS_SOLVE` on one `SystemRegistry`, drives
 * 300 clean fixed steps, and hashes every character's pose and vertical state
 * after each one alongside `world.checksum()`.
 *
 * ## The five characters, and which clause each one is evidence for
 *
 * | character | scenario | what it pins |
 * |---|---|---|
 * | `walker` | walks straight into a wall | **slide along wall**: it stops one skin short and its `x` keeps moving while its `z` does not |
 * | `stepper` | walks into a 0.25 m riser | **step height**: `stepUps` is non-zero, so the up/forward/down triple was *accepted*, not merely present |
 * | `climber` | walks into a 60° ramp with a 45° `slopeLimit` | **slope limit**: it never stands on the ramp, so its height barely moves |
 * | `jumper` | asks to jump on every single step | **both arms of `jump()`'s refusal**: `jumpAttempts` is 300 and `jumpsTaken` is far fewer, because the rest were asked in mid-air |
 * | `faller` | dropped from 20 m with `maxFallSpeed: 6` | **the terminal-velocity clamp bites**: `fallerMinVerticalVelocity` is exactly `−6` |
 *
 * Every one of those is a *number in the golden*, which is what makes a
 * regression localisable without a debugger: a change that broke sliding moves
 * `walkerSlides`, one that broke step-up moves `stepperStepUps`, and one that
 * broke the slope limit moves `climberMaxHeight` — before anybody looks at a
 * hash.
 *
 * ## Each character is also a kinematic body, on purpose
 *
 * Every capsule is registered as a `"kinematic-position"` `RigidBody` under
 * `"kinematic"` authority (§22, §42), which is the arrangement the module's §39
 * argument is *about*: the controller writes the node at priority 400 and
 * `world.step` feeds that same transform to the solver at 600. So this scenario
 * exercises the ordering claim rather than merely asserting it, and it exercises
 * §30's "ignored bodies" — a character that did not exclude its own collider
 * would report `distance: 0` on its first cast and never move at all.
 *
 * ## Clean steps, and no `Application`
 *
 * The registry is driven directly with an injected `TimeState` whose
 * `simulationTime` is `(step + 1) · DT` — an exact product rather than a running
 * sum. §10's accumulator, its sub-step clamp and `droppedTime` are pinned by
 * `phase1-headless-stepping.test.ts` and are not this file's subject.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * WP-1.14's arrangement: the same scenario runs twice in-process under Vitest
 * and once in a fresh `node` child process, and those runs are only evidence if
 * they execute the same code. The constraint that imposes: **this file must stay
 * within Node's erasable-syntax subset** — type annotations, `interface`,
 * `type` and `import type` are fine; `enum`, `namespace`, constructor parameter
 * properties and decorators are not.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target and the same tier as
 * `golden/phase5.json` and `golden/force-fields.json` — with one extra reason
 * that is specific to this packet: **a controller consuming solver queries
 * inherits the solver's tier.** Rapier is compiled WebAssembly, its state
 * crosses the JS/wasm boundary as f64 → f32, and every `distance` and `normal`
 * this controller resolves against is therefore runtime-bound *before* the
 * controller's own `Math.sin`/`Math.cos`/`Math.sqrt` touch it. Cross-platform
 * determinism is **not** claimed.
 */

import { createChecksum } from "@four/diagnostics";
import { Vector3 } from "@four/math";
import {
  PRIORITY_KINEMATICS,
  PRIORITY_PHYSICS_SOLVE,
  SystemRegistry,
  createTimeState,
} from "@four/motion";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  SweptCharacterController,
  SweptCharacterSystem,
} from "@four/physics";
import { Rapier3dAdapter } from "@four/physics-rapier";
import { Group } from "@four/scene";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Fixed steps the run covers (5 simulated seconds). */
export const STEP_COUNT = 300;

/** 1-based fixed step of the early probe (t = 1 s). */
export const PROBE_STEP_ONE_SECOND = 60;

/** 1-based fixed step of the end-of-run probe. */
export const PROBE_STEP_END = STEP_COUNT;

/** Capsule radius shared by every character, in metres (§24). */
export const CHARACTER_RADIUS = 0.3;

/** Capsule half-height (cylindrical section only), in metres (§24). */
export const CHARACTER_HALF_HEIGHT = 0.5;

/** Top of the static floor, in metres. */
export const FLOOR_TOP = 0;

/** The riser `stepper` climbs, in metres — below its 0.35 m step height. */
export const RISER_HEIGHT = 0.25;

/** Terminal speed the falling character is clamped to, in m/s. */
export const FALLER_MAX_FALL_SPEED = 6;

/** The characters, in registration order (§33: deterministic iteration). */
export const CHARACTER_NAMES: readonly string[] = [
  "walker",
  "stepper",
  "climber",
  "jumper",
  "faller",
];

/** A position as plain numbers, so results survive JSON. */
export type Triple = readonly [number, number, number];

/** One character's state at a probe step. */
export interface CharacterSample {
  name: string;
  position: Triple;
  verticalVelocity: number;
  grounded: boolean;
  slides: number;
  stepUps: number;
}

/** The numbers the golden file pins. */
export interface SweptCharacterSummary {
  /** Checksum of all {@link STEP_COUNT} per-step checksums, in step order. */
  summaryDigest: number;
  /** The per-step checksum after step 1. */
  firstStepChecksum: number;
  /** The per-step checksum after step {@link STEP_COUNT}. */
  lastStepChecksum: number;
  /** Collide-and-slide impacts the wall-walker resolved. */
  walkerSlides: number;
  /** How far the wall-walker slid along the wall, in metres (its final `x`). */
  walkerSlideDistance: number;
  /** Step-ups the riser-climber had **accepted** (§12 "step height"). */
  stepperStepUps: number;
  /** The riser-climber's greatest height over the run, in metres. */
  stepperMaxHeight: number;
  /** The steep-ramp character's greatest height — it never gets up the ramp. */
  climberMaxHeight: number;
  /** Fixed steps on which `jump()` was asked (always {@link STEP_COUNT}). */
  jumpAttempts: number;
  /** Jumps actually taken — the other arm of `jump()`'s refusal. */
  jumpsTaken: number;
  /** Grounded-again transitions: every jump that was taken came back down. */
  landings: number;
  /** The falling character's most negative vertical velocity, in m/s. */
  fallerMinVerticalVelocity: number;
  /** Steps on which any character's slide budget ran out with motion unspent. */
  budgetExhaustedSteps: number;
  /** Steps on which any character declined to write a non-finite pose (§85). */
  skippedSteps: number;
}

/** Everything one scenario run produces; `summary` is under golden lock. */
export interface SweptCharacterScenarioResult {
  summary: SweptCharacterSummary;
  /** One uint32 per fixed step, in step order. */
  checksums: number[];
  /** Characters at step {@link PROBE_STEP_ONE_SECOND}. */
  atOneSecond: CharacterSample[];
  /** Characters at step {@link PROBE_STEP_END}. */
  atEnd: CharacterSample[];
  /** Fixed steps driven (always {@link STEP_COUNT}). */
  stepCount: number;
  /** The adapter that actually ran, so the run cannot silently be a double. */
  adapterName: string;
  /** The character system's §39 priority, so the ordering claim is checkable. */
  characterPriority: number;
  /** The physics system's §39 priority. */
  solvePriority: number;
}

/** A static box body: `halfExtents` about `center` (§22, §24). */
function addStaticBox(
  world: PhysicsWorld,
  center: Vector3,
  halfExtents: Vector3,
): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.transform.position.copy(center);
  node.addComponent(new RigidBody({ type: "static" }));
  node.addComponent(new Collider({ shape: { type: "box", halfExtents } }));
  world.addBody(node);
  return node;
}

/**
 * The static world: a floor, a wall for `walker`, a riser for `stepper`, and a
 * ramp far too steep for `climber`'s 45° limit.
 *
 * The ramp is a box rotated 60° about `+X`, which puts its up-facing normal 60°
 * off vertical — a number chosen so that "not walkable" is unambiguous rather
 * than one degree either side of the limit.
 */
function buildStaticGeometry(world: PhysicsWorld): void {
  addStaticBox(
    world,
    new Vector3(0, FLOOR_TOP - 0.5, 0),
    new Vector3(30, 0.5, 30),
  );
  // `walker`'s wall, facing +Z, four metres ahead of it.
  addStaticBox(world, new Vector3(0, 1, -4), new Vector3(6, 1, 0.5));
  // `stepper`'s riser: a low kerb it should climb rather than stop at, deep
  // enough that it stays on top once it has (and clear of `walker`'s wall in
  // x, so the two characters cannot borrow each other's geometry).
  addStaticBox(
    world,
    new Vector3(10, FLOOR_TOP + RISER_HEIGHT - 0.5, -10),
    new Vector3(3, 0.5, 8),
  );
  // `climber`'s ramp: rotated about **+X**, which is what tilts a surface a
  // character walking along −Z has to climb (a +Z rotation would tilt it
  // sideways and present a vertical end face instead).
  const ramp = new Group();
  ramp.transformAuthority = "physics";
  ramp.transform.position.set(20, 1, -5);
  const angle = Math.PI / 3;
  ramp.transform.rotation.set(
    Math.sin(angle * 0.5),
    0,
    0,
    Math.cos(angle * 0.5),
  );
  ramp.addComponent(new RigidBody({ type: "static" }));
  ramp.addComponent(
    new Collider({
      shape: { type: "box", halfExtents: new Vector3(3, 0.5, 3) },
    }),
  );
  world.addBody(ramp);
}

/** One character: a capsule under `"kinematic"` authority, and its body. */
function addCharacter(
  world: PhysicsWorld,
  system: SweptCharacterSystem,
  name: string,
  position: Vector3,
  options: {
    moveSpeed?: number;
    stepHeight?: number;
    maxFallSpeed?: number;
  },
): SweptCharacterController {
  const node = new Group();
  node.name = name;
  node.transformAuthority = "kinematic";
  node.transform.position.copy(position);
  node.addComponent(new RigidBody({ type: "kinematic-position" }));
  node.addComponent(
    new Collider({
      shape: {
        type: "capsule",
        radius: CHARACTER_RADIUS,
        halfHeight: CHARACTER_HALF_HEIGHT,
      },
    }),
  );
  const controller = node.addComponent(
    new SweptCharacterController({
      world,
      radius: CHARACTER_RADIUS,
      halfHeight: CHARACTER_HALF_HEIGHT,
      moveSpeed: options.moveSpeed ?? 0,
      stepHeight: options.stepHeight ?? 0.35,
      maxFallSpeed: options.maxFallSpeed ?? Number.POSITIVE_INFINITY,
      slopeLimit: Math.PI / 4,
    }),
  );
  world.addBody(node);
  system.track(node);
  return controller;
}

/** One character's state, as plain numbers. */
function sample(
  name: string,
  node: Group,
  controller: SweptCharacterController,
): CharacterSample {
  return {
    name,
    position: [
      node.transform.position.x,
      node.transform.position.y,
      node.transform.position.z,
    ],
    verticalVelocity: controller.verticalVelocity,
    grounded: controller.grounded,
    slides: controller.slideCount,
    stepUps: controller.stepUpCount,
  };
}

/**
 * Runs the scenario once and returns everything the test compares.
 *
 * Asynchronous because the Rapier adapter loads a WebAssembly module in
 * `initialize`; nothing else here awaits anything.
 */
export async function runSweptCharacterScenario(): Promise<SweptCharacterScenarioResult> {
  const adapter = new Rapier3dAdapter();
  const world = new PhysicsWorld({ dimension: "3d", adapter });
  await world.initialize();
  buildStaticGeometry(world);

  const characters = new SweptCharacterSystem();
  const feetOffset = CHARACTER_HALF_HEIGHT + CHARACTER_RADIUS;
  const walker = addCharacter(
    world,
    characters,
    "walker",
    new Vector3(0, FLOOR_TOP + feetOffset + 0.05, 0),
    { moveSpeed: 3 },
  );
  const stepper = addCharacter(
    world,
    characters,
    "stepper",
    new Vector3(10, FLOOR_TOP + feetOffset + 0.05, 0),
    { moveSpeed: 3 },
  );
  const climber = addCharacter(
    world,
    characters,
    "climber",
    new Vector3(20, FLOOR_TOP + feetOffset + 0.05, 0),
    { moveSpeed: 3 },
  );
  const jumper = addCharacter(
    world,
    characters,
    "jumper",
    new Vector3(-10, FLOOR_TOP + feetOffset + 0.05, 0),
    { moveSpeed: 1 },
  );
  const faller = addCharacter(
    world,
    characters,
    "faller",
    new Vector3(-20, 20, 0),
    { maxFallSpeed: FALLER_MAX_FALL_SPEED },
  );

  // Straight ahead is −Z at yaw 0, which is where every obstacle is. The
  // walker also strafes, so that "slid along the wall" is a distance rather
  // than a sign.
  walker.setMoveIntent(1, 0.6);
  stepper.setMoveIntent(1, 0);
  climber.setMoveIntent(1, 0);
  jumper.setMoveIntent(1, 0);

  const nodes = [walker, stepper, climber, jumper, faller].map((controller) => {
    const host = controller.host as Group | null;
    if (host === null) {
      throw new Error("a character controller was not attached to a node");
    }
    return host;
  });
  const controllers = [walker, stepper, climber, jumper, faller];

  const registry = new SystemRegistry();
  registry.register(characters);
  registry.register(new PhysicsSystem({ worlds: [world] }));

  const time = createTimeState({ fixedDeltaTime: FIXED_TIME_STEP });
  const checksums: number[] = [];
  const summary = createChecksum();
  let jumpAttempts = 0;
  let jumpsTaken = 0;
  let landings = 0;
  let jumperWasGrounded = jumper.grounded;
  let fallerMinVerticalVelocity = 0;
  const maxHeights = nodes.map((node) => node.transform.position.y);
  let atOneSecond: CharacterSample[] = [];
  let atEnd: CharacterSample[] = [];

  for (let step = 1; step <= STEP_COUNT; step += 1) {
    // Asked on *every* step, including the ones it is airborne on: the refusal
    // and the acceptance are both part of the record.
    jumpAttempts += 1;
    if (jumper.jump()) {
      jumpsTaken += 1;
    }

    time.frame = step;
    time.simulationStep = step;
    // An exact product, not a running sum: no accumulator drift enters a step.
    time.simulationTime = step * FIXED_TIME_STEP;
    time.deltaTime = FIXED_TIME_STEP;
    time.unscaledDeltaTime = FIXED_TIME_STEP;
    registry.runFixedStep(time);

    if (jumper.grounded && !jumperWasGrounded) {
      landings += 1;
    }
    jumperWasGrounded = jumper.grounded;
    if (faller.verticalVelocity < fallerMinVerticalVelocity) {
      fallerMinVerticalVelocity = faller.verticalVelocity;
    }
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].transform.position.y > maxHeights[i]) {
        maxHeights[i] = nodes[i].transform.position.y;
      }
    }

    // The per-step value hashes the solver's own §33 checksum together with
    // every character's pose and vertical state, because the characters are
    // written *before* the solve and a controller regression would otherwise
    // have to reach the solver to be visible.
    const digest = createChecksum();
    digest.addFloat(world.checksum());
    for (let i = 0; i < nodes.length; i += 1) {
      const position = nodes[i].transform.position;
      digest.addFloat(position.x);
      digest.addFloat(position.y);
      digest.addFloat(position.z);
      digest.addFloat(controllers[i].verticalVelocity);
      digest.addFloat(controllers[i].grounded ? 1 : 0);
    }
    const checksum = digest.digest();
    checksums.push(checksum);
    summary.addFloat(checksum);

    if (step === PROBE_STEP_ONE_SECOND) {
      atOneSecond = nodes.map((node, i) =>
        sample(CHARACTER_NAMES[i], node, controllers[i]),
      );
    }
    if (step === PROBE_STEP_END) {
      atEnd = nodes.map((node, i) =>
        sample(CHARACTER_NAMES[i], node, controllers[i]),
      );
    }
  }

  let budgetExhaustedSteps = 0;
  let skippedSteps = 0;
  for (const controller of controllers) {
    budgetExhaustedSteps += controller.budgetExhaustedSteps;
    skippedSteps += controller.skippedSteps;
  }

  const result: SweptCharacterScenarioResult = {
    summary: {
      summaryDigest: summary.digest(),
      firstStepChecksum: checksums[0],
      lastStepChecksum: checksums[checksums.length - 1],
      walkerSlides: walker.slideCount,
      walkerSlideDistance: nodes[0].transform.position.x,
      stepperStepUps: stepper.stepUpCount,
      stepperMaxHeight: maxHeights[1],
      climberMaxHeight: maxHeights[2],
      jumpAttempts,
      jumpsTaken,
      landings,
      fallerMinVerticalVelocity,
      budgetExhaustedSteps,
      skippedSteps,
    },
    checksums,
    atOneSecond,
    atEnd,
    stepCount: STEP_COUNT,
    adapterName: world.adapter.name,
    characterPriority: characters.priority,
    solvePriority: PRIORITY_PHYSICS_SOLVE,
  };

  world.dispose();
  if (characters.priority !== PRIORITY_KINEMATICS) {
    throw new Error("the character system left §39's step-4 slot");
  }
  return result;
}
