/**
 * The §44/§42 camera-rig determinism scenario (R-36 rig half + PH-11,
 * 2026-08-13; §12, §33, §39, §42, §44) — one headless run of three rigged
 * cameras tracking a path-driven subject, stepped 300 fixed steps and reduced
 * to per-step checksums.
 *
 * `ConstraintSystem` is a new per-fixed-step engine occupant — §39's step 7,
 * and the first producing system §42's `"constraint"` authority has ever had —
 * so it owes §33 a golden. This module is that obligation, executable: it
 * builds a scene with **no renderer, no canvas and no DOM**, registers a
 * `KinematicSystem` at step 4 and a `ConstraintSystem` at step 7 on one
 * `SystemRegistry`, drives 300 clean fixed steps, and hashes every camera's
 * world pose after each one.
 *
 * ## What the scenario deliberately exercises
 *
 * | surface | how it is reached |
 * |---|---|
 * | §44 orbit | camera A, driven by a `SeededRandom` input stream — the numbers an application would feed from a pointer |
 * | the pitch clamp | that stream walks pitch into the pole guard, so `pitchLimitHits` is non-zero *by construction* and the golden says so |
 * | §44 follow rig | camera B, a world-frame offset smoothed by a critically damped `SpringDamper` |
 * | §44 spring arm | camera C, a **target-frame** offset smoothed by an underdamped spring, under a **scaled, rotated parent** — so the parent-inverse placement path is on the golden |
 * | §12 look-at | all three cameras aim every step; camera C's aim is slew-limited (`maxAngularSpeed`), so the shortest-arc rate limit is hashed too |
 * | §42 | four nodes, three authorities (`kinematic`, `manual`, `constraint`), no conflict — a warning would mean the scenario is wrong |
 * | §39 ordering | one registry, step 4 strictly before step 7, so every aim reads the pose written the same step |
 * | §13 | the subject rides an `EllipticalTrajectory` through `KinematicController.followPath` |
 *
 * The clamp is the deliberate one. A rig whose pitch guard is never reached
 * would leave the reason `DEFAULT_ORBIT_PITCH_LIMIT` exists — the pole is
 * exactly the aim `Node.lookAt` refuses with the default `+Y` up — unpinned,
 * and the golden's pair of numbers is what says out loud that it was reached
 * (`pitchLimitHits > 0`) *and* that no aim ever went degenerate anyway
 * (`skippedAims === 0`).
 *
 * ## Clean steps, and no `Application`
 *
 * The registry is driven directly with an injected `TimeState` whose
 * `simulationTime` is `step · DT` — an exact product rather than a running sum,
 * so the subject's own rotation is a pure function of the step index and no
 * accumulator drift enters the poses. §10's accumulator, its sub-step clamp and
 * `droppedTime` are pinned by `phase1-headless-stepping.test.ts` and are not
 * this file's subject.
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
 * **`same-runtime`**, §33's stated initial target. The rigs call `Math.sin`,
 * `Math.cos`, `Math.sqrt`, `Math.acos` and — through `SpringDamper` —
 * `Math.exp`; only `sqrt` is specified exactly rounded, so cross-platform
 * determinism is **not** claimed. Everything else here is exact: the seeded
 * stream is integer arithmetic (§33), the step count and `dt` are fixed, the
 * iteration order is insertion order, and no wall clock is read.
 */

import { createChecksum } from "@four/diagnostics";
import { Vector3 } from "@four/math";
import {
  ConstraintSystem,
  EllipticalTrajectory,
  FollowRig,
  KinematicController,
  KinematicSystem,
  LookAtConstraint,
  OrbitRig,
  PRIORITY_CONSTRAINTS,
  PRIORITY_KINEMATICS,
  SeededRandom,
  SpringDamper,
  SystemRegistry,
  createTimeState,
} from "@four/motion";
import {
  Group,
  PerspectiveCamera,
  Scene,
  resolveWorldTransform,
} from "@four/scene";

/** World +Y (§7a), the axis the subject turns about. Allocated once. */
const UP_AXIS = new Vector3(0, 1, 0);

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Fixed steps the run covers (5 simulated seconds). */
export const STEP_COUNT = 300;

/** Rigged cameras in the scene. */
export const CAMERA_COUNT = 3;

/** 1-based fixed step of the early probe (t = 1 s). */
export const PROBE_STEP_ONE_SECOND = 60;

/** 1-based fixed step of the end-of-run probe. */
export const PROBE_STEP_END = STEP_COUNT;

/** Seed of the orbit rig's input stream (§33: streams are reproducible). */
export const ORBIT_INPUT_SEED = 20260813;

/** Largest yaw delta the input stream feeds per step, in radians. */
export const YAW_INPUT_RANGE = 0.09;

/** Largest pitch delta the input stream feeds per step, in radians. */
export const PITCH_INPUT_RANGE = 0.22;

/** Largest dolly delta the input stream feeds per step, in metres. */
export const DOLLY_INPUT_RANGE = 0.06;

/** A position or quaternion as plain numbers, so results survive JSON. */
export type Quad = readonly [number, number, number, number];

/** One camera's pose at a probe step. */
export interface CameraSample {
  /** World-space origin — the translation column of the world matrix. */
  position: readonly [number, number, number];
  /** Local rotation, the only thing the aim writes. */
  rotation: Quad;
}

/** The numbers the golden file pins. */
export interface CameraRigSummary {
  /** Checksum of all {@link STEP_COUNT} per-step checksums, in step order. */
  summaryDigest: number;
  /** The per-step checksum after step 1. */
  firstStepChecksum: number;
  /** The per-step checksum after step {@link STEP_COUNT}. */
  lastStepChecksum: number;
  /** Degenerate aims over the run — zero, because the pitch clamp holds. */
  skippedAims: number;
  /** Refused placements over the run — zero, because no parent is singular. */
  skippedPlacements: number;
  /** Times the orbit rig's pitch was clamped: the pole guard, exercised. */
  pitchLimitHits: number;
}

/** Everything one scenario run produces; `summary` is under golden lock. */
export interface CameraRigScenarioResult {
  summary: CameraRigSummary;
  /** One uint32 per fixed step, in step order. */
  checksums: number[];
  /** The cameras at step {@link PROBE_STEP_ONE_SECOND}. */
  atOneSecond: CameraSample[];
  /** The cameras at step {@link PROBE_STEP_END}. */
  atEnd: CameraSample[];
  /** Fixed steps driven (always {@link STEP_COUNT}). */
  stepCount: number;
  /** The kinematic system's §39 priority, so the ordering claim is checkable. */
  kinematicPriority: number;
  /** The constraint system's §39 priority. */
  constraintPriority: number;
  /** Authorities in scene order, so a mis-declared node cannot hide. */
  authorities: string[];
  /** §42 conflicts reported over the whole run; always 0. */
  warnings: number;
}

/** One camera's pose, as plain numbers. */
function sampleCamera(camera: PerspectiveCamera): CameraSample {
  const e = resolveWorldTransform(camera).elements;
  const r = camera.transform.rotation;
  return {
    position: [e[12], e[13], e[14]],
    rotation: [r.x, r.y, r.z, r.w],
  };
}

/**
 * Runs the scenario once and returns everything the test compares.
 *
 * Synchronous: nothing here loads a solver or a wasm image — the §44 rigs are
 * arithmetic over the scene graph.
 */
export function runCameraRigScenario(): CameraRigScenarioResult {
  const scene = new Scene();

  // --- the subject: an elliptical path (§13) under `"kinematic"` -------------
  const pivot = new Group();
  pivot.transformAuthority = "kinematic";
  const controller = pivot.addComponent(new KinematicController());
  controller.followPath(
    new EllipticalTrajectory({
      center: new Vector3(0, 1, 0),
      radiusX: 6,
      radiusY: 3,
      angularVelocity: 0.7,
    }),
    { loop: true },
  );
  // The thing the cameras watch, turning in place under the dolly so that the
  // target-frame arm of camera C has a frame that actually moves. Its rotation
  // is written by this scenario — the application, i.e. `"manual"` (§42).
  const subject = new Group();
  pivot.add(subject);
  scene.add(pivot);

  // --- camera A: §44 orbit, driven by an input stream ------------------------
  const orbitCamera = new PerspectiveCamera({ aspect: 16 / 9 });
  orbitCamera.transformAuthority = "constraint";
  const orbit = orbitCamera.addComponent(
    new OrbitRig({
      target: subject,
      distance: 7,
      minDistance: 3,
      maxDistance: 12,
    }),
  );
  const orbitAim = orbitCamera.addComponent(
    new LookAtConstraint({ target: subject }),
  );
  scene.add(orbitCamera);

  // --- camera B: §44 follow rig, world frame, critically damped --------------
  const followCamera = new PerspectiveCamera({ aspect: 16 / 9 });
  followCamera.transformAuthority = "constraint";
  const follow = followCamera.addComponent(
    new FollowRig({
      target: subject,
      offset: new Vector3(0, 4, 10),
      spring: new SpringDamper({ frequencyHz: 2, dampingRatio: 1 }),
    }),
  );
  const followAim = followCamera.addComponent(
    new LookAtConstraint({ target: subject }),
  );
  scene.add(followCamera);

  // --- camera C: §44 spring arm, target frame, under a scaled parent ---------
  const boom = new Group();
  boom.transform.position.set(-2, 0.5, 1);
  boom.transform.rotation.setFromAxisAngle(UP_AXIS, 0.6);
  boom.transform.scale.set(2, 2, 2);
  const armCamera = new PerspectiveCamera({ aspect: 1 });
  armCamera.transformAuthority = "constraint";
  const arm = armCamera.addComponent(
    new FollowRig({
      target: subject,
      offset: new Vector3(1.5, 2.5, -6),
      frame: "target",
      spring: new SpringDamper({ frequencyHz: 3, dampingRatio: 0.7 }),
    }),
  );
  const armAim = armCamera.addComponent(
    new LookAtConstraint({ target: subject, maxAngularSpeed: 1.2 }),
  );
  boom.add(armCamera);
  scene.add(boom);

  // --- §39: step 4 then step 7, one registry --------------------------------
  const kinematics = new KinematicSystem();
  const constraints = new ConstraintSystem();
  const registry = new SystemRegistry();
  registry.register(kinematics);
  registry.register(constraints);
  kinematics.track(pivot);
  constraints.track(orbitCamera);
  constraints.track(followCamera);
  constraints.track(armCamera);

  // A §42 conflict would mean a node was declared wrong; it is counted rather
  // than assumed, and the golden pins it at zero.
  let warnings = 0;
  const realWarn = console.warn;
  console.warn = () => {
    warnings += 1;
  };

  const cameras = [orbitCamera, followCamera, armCamera];
  const input = new SeededRandom(ORBIT_INPUT_SEED);
  const time = createTimeState({ fixedDeltaTime: FIXED_TIME_STEP });
  const checksums: number[] = [];
  const summary = createChecksum();
  let atOneSecond: CameraSample[] = [];
  let atEnd: CameraSample[] = [];

  try {
    for (let step = 1; step <= STEP_COUNT; step += 1) {
      // The application's own writes, before the step: the input stream an
      // orbit rig would get from a pointer, and the subject's own turn.
      orbit.orbit(
        input.nextRange(-YAW_INPUT_RANGE, YAW_INPUT_RANGE),
        input.nextRange(-PITCH_INPUT_RANGE, PITCH_INPUT_RANGE),
      );
      orbit.dolly(input.nextRange(-DOLLY_INPUT_RANGE, DOLLY_INPUT_RANGE));
      subject.transform.rotation.setFromAxisAngle(
        UP_AXIS,
        0.4 * step * FIXED_TIME_STEP,
      );

      time.frame = step;
      time.simulationStep = step;
      // An exact product, not a running sum.
      time.simulationTime = step * FIXED_TIME_STEP;
      time.deltaTime = FIXED_TIME_STEP;
      time.unscaledDeltaTime = FIXED_TIME_STEP;
      registry.runFixedStep(time);

      const stepChecksum = createChecksum();
      for (const camera of cameras) {
        const sample = sampleCamera(camera);
        stepChecksum.addFloats(sample.position);
        stepChecksum.addFloats(sample.rotation);
      }
      const subjectWorld = resolveWorldTransform(subject).elements;
      stepChecksum.addFloats([
        subjectWorld[12],
        subjectWorld[13],
        subjectWorld[14],
      ]);
      const digest = stepChecksum.digest();
      checksums.push(digest);
      summary.addFloat(digest);

      if (step === PROBE_STEP_ONE_SECOND) {
        atOneSecond = cameras.map(sampleCamera);
      }
      if (step === PROBE_STEP_END) {
        atEnd = cameras.map(sampleCamera);
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
      skippedAims:
        orbitAim.skippedSteps + followAim.skippedSteps + armAim.skippedSteps,
      skippedPlacements:
        orbit.skippedSteps + follow.skippedSteps + arm.skippedSteps,
      pitchLimitHits: orbit.pitchLimitHits,
    },
    checksums,
    atOneSecond,
    atEnd,
    stepCount: STEP_COUNT,
    kinematicPriority: kinematics.priority,
    constraintPriority: constraints.priority,
    authorities: [
      pivot.transformAuthority,
      subject.transformAuthority,
      orbitCamera.transformAuthority,
      followCamera.transformAuthority,
      armCamera.transformAuthority,
    ],
    warnings,
  };
}

/** The §39 priorities the scenario asserts it ran at. */
export const EXPECTED_PRIORITIES: readonly [number, number] = [
  PRIORITY_KINEMATICS,
  PRIORITY_CONSTRAINTS,
];
