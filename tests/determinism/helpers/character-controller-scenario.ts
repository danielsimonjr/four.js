/**
 * The §12/§44 character-controller determinism scenario (PH-11 residue,
 * 2026-08-21; §12, §33, §39, §42, §44) — one headless run of two characters
 * and a first-person eye, driven by a seeded input stream, stepped 300 fixed
 * steps and reduced to per-step checksums.
 *
 * `CharacterController` and `FirstPersonLook` are new arithmetic inside every
 * fixed step — §39's step 4, under §42's `"kinematic"` authority — so they owe
 * §33 a golden. This module is that obligation, executable: it builds a scene
 * with **no renderer, no canvas and no DOM**, registers one `KinematicSystem`
 * on one `SystemRegistry`, drives 300 clean fixed steps, and hashes every
 * node's world pose plus the two pieces of state that are *not* in a transform
 * (the vertical velocity and the eye's pitch) after each one.
 *
 * ## What the scenario deliberately exercises
 *
 * | surface | how it is reached |
 * |---|---|
 * | §12 locomotion | character A walks a `SeededRandom` intent stream at 4 m/s — the numbers an application would feed from a stick |
 * | the unit-disc clamp | the stream feeds `(±1, ±1)` intents, so the `√2` scale-back is on the golden |
 * | the yaw channel | the same stream turns A every step; its heading is the only source of its facing |
 * | jumping and landing | A jumps every 45th step, rises under gravity and lands back on the plane — `jumpsTaken` and `landings` are pinned |
 * | terminal velocity | character B falls from 50 m with `maxFallSpeed: 6`, so the clamp bites on every step of the run and B never lands |
 * | the parent frame | B hangs under a rotated, scaled parent, so its *world* pose exercises the composition rather than only its local write |
 * | §44 first-person | the eye is a child of A pitching on a biased stream that walks it into the pole guard — `pitchLimitHits` is non-zero *by construction* |
 * | §42 | three nodes, one authority, one system, and not one conflict |
 *
 * The pitch clamp is the deliberate one, exactly as the orbit rig's is in
 * `camera-rig-scenario.ts`: a guard that is never reached leaves the reason
 * `DEFAULT_FIRST_PERSON_PITCH_LIMIT` exists unpinned.
 *
 * ## Clean steps, and no `Application`
 *
 * The registry is driven directly with an injected `TimeState` whose
 * `simulationTime` is `step · DT` — an exact product rather than a running sum.
 * §10's accumulator, its sub-step clamp and `droppedTime` are pinned by
 * `phase1-headless-stepping.test.ts` and are not this file's subject.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * Identical to WP-1.14's arrangement: the two in-process runs and the fresh
 * `node` child process must execute the same code. The constraint that
 * imposes: **this file must stay within Node's erasable-syntax subset** — type
 * annotations, `interface`, `type` and `import type` are fine; `enum`,
 * `namespace`, constructor parameter properties and decorators are not.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target. The controllers call
 * `Math.sin`, `Math.cos` and `Math.sqrt`; only `sqrt` is specified exactly
 * rounded, so cross-platform determinism is **not** claimed. Everything else
 * here is exact: the seeded stream is integer arithmetic (§33), the step count
 * and `dt` are fixed, iteration is insertion order, and no wall clock is read.
 */

import { createChecksum } from "@four/diagnostics";
import { Vector3 } from "@four/math";
import {
  CharacterController,
  FirstPersonLook,
  KinematicSystem,
  PRIORITY_KINEMATICS,
  SeededRandom,
  SystemRegistry,
  createTimeState,
} from "@four/motion";
import {
  Group,
  PerspectiveCamera,
  Scene,
  resolveWorldTransform,
} from "@four/scene";

/** World +Y (§7a), the axis the scaled parent turns about. Allocated once. */
const UP_AXIS = new Vector3(0, 1, 0);

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Fixed steps the run covers (5 simulated seconds). */
export const STEP_COUNT = 300;

/** 1-based fixed step of the early probe (t = 1 s). */
export const PROBE_STEP_ONE_SECOND = 60;

/** 1-based fixed step of the end-of-run probe. */
export const PROBE_STEP_END = STEP_COUNT;

/** Seed of the character's input stream (§33: streams are reproducible). */
export const CHARACTER_INPUT_SEED = 20260821;

/** Largest yaw delta the input stream feeds per step, in radians. */
export const YAW_INPUT_RANGE = 0.08;

/** Every this many steps, the walking character tries to jump. */
export const JUMP_INTERVAL = 45;

/** Height character B starts at, in metres — far enough that it never lands. */
export const FALLER_START_HEIGHT = 50;

/** Character B's terminal velocity, in m/s. */
export const FALLER_MAX_FALL_SPEED = 6;

/** A position or quaternion as plain numbers, so results survive JSON. */
export type Quad = readonly [number, number, number, number];

/** One node's world pose at a probe step. */
export interface PoseSample {
  /** World-space origin — the translation column of the world matrix. */
  position: readonly [number, number, number];
  /** Local rotation, which is what the controllers write. */
  rotation: Quad;
}

/** The numbers the golden file pins. */
export interface CharacterSummary {
  /** Checksum of all {@link STEP_COUNT} per-step checksums, in step order. */
  summaryDigest: number;
  /** The per-step checksum after step 1. */
  firstStepChecksum: number;
  /** The per-step checksum after step {@link STEP_COUNT}. */
  lastStepChecksum: number;
  /** Jumps the walking character actually took (a refused jump is not one). */
  jumpsTaken: number;
  /** Steps on which the walking character was standing on the plane. */
  groundedSteps: number;
  /** Times the walking character landed after being airborne. */
  landings: number;
  /** Times the eye's pitch was clamped: the pole guard, exercised. */
  pitchLimitHits: number;
  /** Refused writes over the run — zero, because no pose ever goes non-finite. */
  skippedSteps: number;
  /** Character B's vertical velocity at the end: its terminal velocity, exactly. */
  fallerVerticalVelocity: number;
}

/** Everything one scenario run produces; `summary` is under golden lock. */
export interface CharacterScenarioResult {
  summary: CharacterSummary;
  /** One uint32 per fixed step, in step order. */
  checksums: number[];
  /** The three nodes at step {@link PROBE_STEP_ONE_SECOND}. */
  atOneSecond: PoseSample[];
  /** The three nodes at step {@link PROBE_STEP_END}. */
  atEnd: PoseSample[];
  /** Fixed steps driven (always {@link STEP_COUNT}). */
  stepCount: number;
  /** The kinematic system's §39 priority, so the ordering claim is checkable. */
  kinematicPriority: number;
  /** Authorities in scene order, so a mis-declared node cannot hide. */
  authorities: string[];
  /** §42 conflicts reported over the whole run; always 0. */
  warnings: number;
}

/** One node's world pose and local rotation, as plain numbers. */
function samplePose(node: Group | PerspectiveCamera): PoseSample {
  const e = resolveWorldTransform(node).elements;
  const r = node.transform.rotation;
  return {
    position: [e[12], e[13], e[14]],
    rotation: [r.x, r.y, r.z, r.w],
  };
}

/**
 * Runs the scenario once and returns everything the test compares.
 *
 * Synchronous: nothing here loads a solver or a wasm image — a kinematic
 * character is arithmetic over the scene graph.
 */
export function runCharacterScenario(): CharacterScenarioResult {
  const scene = new Scene();

  // --- character A: the walker, with a first-person eye ---------------------
  const player = new Group();
  player.transformAuthority = "kinematic";
  const character = player.addComponent(
    new CharacterController({ moveSpeed: 4, jumpSpeed: 5, grounded: true }),
  );
  const eye = new PerspectiveCamera({ aspect: 16 / 9 });
  eye.transform.position.set(0, 1.7, 0);
  eye.transformAuthority = "kinematic";
  const look = eye.addComponent(new FirstPersonLook());
  player.add(eye);
  scene.add(player);

  // --- character B: the faller, under a rotated, scaled parent --------------
  const platform = new Group();
  platform.transform.position.set(-3, 0.5, 2);
  platform.transform.rotation.setFromAxisAngle(UP_AXIS, 0.6);
  platform.transform.scale.set(2, 2, 2);
  const faller = new Group();
  faller.transform.position.set(0, FALLER_START_HEIGHT, 0);
  faller.transformAuthority = "kinematic";
  const falling = faller.addComponent(
    new CharacterController({
      moveSpeed: 1,
      maxFallSpeed: FALLER_MAX_FALL_SPEED,
      yaw: 0.25,
    }),
  );
  falling.setMoveIntent(0.5, -0.5);
  platform.add(faller);
  scene.add(platform);

  // --- §39: one registry, step 4 --------------------------------------------
  const kinematics = new KinematicSystem();
  const registry = new SystemRegistry();
  registry.register(kinematics);
  kinematics.track(player);
  kinematics.track(eye);
  kinematics.track(faller);

  // A §42 conflict would mean a node was declared wrong; it is counted rather
  // than assumed, and the golden pins it at zero.
  let warnings = 0;
  const realWarn = console.warn;
  console.warn = () => {
    warnings += 1;
  };

  const nodes = [player, eye, faller];
  const input = new SeededRandom(CHARACTER_INPUT_SEED);
  const time = createTimeState({ fixedDeltaTime: FIXED_TIME_STEP });
  const checksums: number[] = [];
  const summary = createChecksum();
  let atOneSecond: PoseSample[] = [];
  let atEnd: PoseSample[] = [];
  let jumpsTaken = 0;
  let groundedSteps = 0;
  let landings = 0;
  let wasGrounded = true;

  try {
    for (let step = 1; step <= STEP_COUNT; step += 1) {
      // The application's own writes, before the step: the parameter-driven
      // input a device layer would feed (§3.1 — motion never reads input).
      character.turn(input.nextRange(-YAW_INPUT_RANGE, YAW_INPUT_RANGE));
      // Intents outside the unit disc, so the scale-back is on the golden.
      character.setMoveIntent(input.nextRange(-1, 1), input.nextRange(-1, 1));
      // Biased upward, so the pitch walks into the pole guard and stays there.
      look.look(input.nextRange(-0.05, 0.12));
      if (step % JUMP_INTERVAL === 0 && character.jump()) {
        jumpsTaken += 1;
      }

      time.frame = step;
      time.simulationStep = step;
      // An exact product, not a running sum.
      time.simulationTime = step * FIXED_TIME_STEP;
      time.deltaTime = FIXED_TIME_STEP;
      time.unscaledDeltaTime = FIXED_TIME_STEP;
      registry.runFixedStep(time);

      if (character.grounded) {
        groundedSteps += 1;
        if (!wasGrounded) {
          landings += 1;
        }
      }
      wasGrounded = character.grounded;

      const stepChecksum = createChecksum();
      for (const node of nodes) {
        const sample = samplePose(node);
        stepChecksum.addFloats(sample.position);
        stepChecksum.addFloats(sample.rotation);
      }
      // The two pieces of state a transform does not carry.
      stepChecksum.addFloats([
        character.verticalVelocity,
        falling.verticalVelocity,
        look.pitch,
      ]);
      const digest = stepChecksum.digest();
      checksums.push(digest);
      summary.addFloat(digest);

      if (step === PROBE_STEP_ONE_SECOND) {
        atOneSecond = nodes.map(samplePose);
      }
      if (step === PROBE_STEP_END) {
        atEnd = nodes.map(samplePose);
      }
    }
  } finally {
    console.warn = realWarn;
  }

  return {
    summary: {
      summaryDigest: summary.digest(),
      firstStepChecksum: checksums[0],
      lastStepChecksum: checksums[checksums.length - 1],
      jumpsTaken,
      groundedSteps,
      landings,
      pitchLimitHits: look.pitchLimitHits,
      skippedSteps: character.skippedSteps + falling.skippedSteps,
      fallerVerticalVelocity: falling.verticalVelocity,
    },
    checksums,
    atOneSecond,
    atEnd,
    stepCount: STEP_COUNT,
    kinematicPriority: kinematics.priority,
    authorities: [
      player.transformAuthority,
      eye.transformAuthority,
      platform.transformAuthority,
      faller.transformAuthority,
    ],
    warnings,
  };
}

/** The §39 priority the scenario asserts it ran at. */
export const EXPECTED_PRIORITY: number = PRIORITY_KINEMATICS;
