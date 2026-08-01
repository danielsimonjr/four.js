/**
 * The Phase 2 exit scenario (§105 demonstration set, §33 determinism, plan
 * WP-2.7) — one headless run of the five motions §105 names, stepped 600 times
 * (10 s at 1/60), reduced to per-step checksums plus two probe samples.
 *
 * §105's demonstration is *"a set of 2D and 3D objects move through: constant
 * velocity; constant acceleration; circular paths; spline paths; damped spring
 * motion"*, and its exit criterion is *"motion is deterministic,
 * renderer-independent, and unit tested"*. This module is that sentence,
 * executable: it builds an {@link Application} (scene + fixed-step scheduler +
 * §39 system registry; nothing renderer-shaped is constructed or consulted, and
 * no canvas or DOM is touched — see the test file's header for why that is a
 * behavioural rather than an import-graph claim), gives each of
 * the five demonstrations its own node under `"kinematic"` transform authority
 * (§42), registers a `MotionSystem`, a `KinematicSystem`, and the §43 pose
 * snapshot system on `app.systems`, drives 600 clean frames, and checksums
 * every world matrix after every one.
 *
 * ## Clean frames, on purpose (decision, WP-2.7)
 *
 * Every injected frame is exactly `FIXED_TIME_STEP` seconds, so the §10
 * accumulator runs exactly one fixed step per frame, drops nothing, and leaves
 * `interpolationAlpha` at 0. That is deliberate and is *not* a weaker test than
 * Phase 1's: WP-1.14 already proved the ragged-frame path (long frames, the
 * sub-step clamp, `droppedTime`) reproduces bit-for-bit, and repeating it here
 * would only re-test the scheduler. What Phase 2 has to prove is that the
 * *motion* is right, and the closed-form assertions in
 * `../phase2-motion.test.ts` need an exactly known simulation time to compare
 * against. Raggedness would make "the position at t = 1 s" a statement about
 * which frame boundary happened to land there.
 *
 * Both facts are published — {@link Phase2ScenarioResult.droppedTime} and
 * {@link Phase2ScenarioResult.maximumInterpolationAlpha} — so the test can
 * assert the frames really were clean rather than take it on trust.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * Identical to WP-1.14's arrangement, and for the same reason: the determinism
 * gate (plan §8) demands the same scenario run twice in-process **and** once in
 * a fresh `node` child process, and those runs are only evidence if they
 * execute the same code. So one file is loaded by Vitest (through Vite) and by
 * plain `node` (through its default type-stripping, Node ≥ 22.18; this repo
 * pins Node ≥ 20 and runs 22.22). The constraint that imposes: **this file must
 * stay within Node's erasable-syntax subset** — type annotations, `interface`,
 * `type`, and `import type` are fine; `enum`, `namespace`, constructor
 * parameter properties, and decorators are not.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target. The structure, the step
 * count, and every elapsed time here are exact — no RNG is needed, because
 * unlike Phase 1 this scenario's job is closed-form motion, not a random walk.
 * The arithmetic that computes the poses is nonetheless runtime-bound:
 * `CircularTrajectory` calls `Math.cos`/`Math.sin`, `DampedSpringTrajectory`
 * calls `Math.exp`, `CatmullRomTrajectory` calls `Math.pow` (`** alpha`), and
 * `MotionSystem`'s angular step calls `Math.sin`/`Math.cos` through
 * `Quaternion.setFromAxisAngle` — all transcendentals whose last bits may
 * legally differ between JS engines. The checksum itself (plan D6) is exact and
 * cross-platform; only its inputs are runtime-bound.
 *
 * ## What the scenario deliberately exercises
 *
 * | Phase 2 surface | how it is reached |
 * |---|---|
 * | `MotionComponent` + `MotionSystem` (§11, WP-2.2) | nodes 1 and 2, linear *and* angular |
 * | semi-implicit integration with damping (§38) | node 2 (`damping = 0.5`) |
 * | `KinematicController.followPath` (§12, WP-2.5) | nodes 3, 4, 5 |
 * | `CircularTrajectory` (§13, WP-2.4) | node 3, looping past its `duration` |
 * | `CatmullRomTrajectory` (§13) | node 4, centripetal, completing mid-run |
 * | `DampedSpringTrajectory` (§13) | node 5, underdamped, settling over the run |
 * | transform authority (§42, WP-2.3) | every node declared `"kinematic"`; conflicts counted |
 * | interpolation buffers (§43, WP-2.6) | `PoseBuffer` + snapshot system, probed at α = 0.5 |
 * | §39 registry ordering | motion → kinematics → snapshot, by priority |
 * | fixed-step loop (§10) | 600 injected frames through `Application.step` |
 */

import { createChecksum } from "@four/diagnostics";
import { Quaternion, Vector3 } from "@four/math";
import {
  CatmullRomTrajectory,
  CircularTrajectory,
  DampedSpringTrajectory,
  KinematicController,
  KinematicSystem,
  MotionComponent,
  MotionSystem,
} from "@four/motion";
import {
  Group,
  PoseBuffer,
  createSnapshotSystem,
  type Node,
} from "@four/scene";
import { Application } from "four";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long. */
export const STEP_COUNT = 600;

/** Simulated seconds the run covers: `STEP_COUNT * FIXED_TIME_STEP`. */
export const SIMULATED_SECONDS = 10;

/** 1-based fixed step at t = 1 s — the §105 closed-form probe. */
export const PROBE_STEP_ONE_SECOND = 60;

/** 1-based fixed step at t = 10 s — the end-of-run probe. */
export const PROBE_STEP_TEN_SECONDS = 600;

/**
 * Alpha used for the render-pose probe.
 *
 * Not `TimeState.interpolationAlpha`: on clean frames that is exactly 0, which
 * would make the probe a copy of the previous pose and prove nothing about
 * §43's lerp/slerp. A fixed 0.5 puts every probe at the midpoint of the two
 * stored poses, where a lerp and a slerp visibly differ.
 */
export const RENDER_POSE_ALPHA = 0.5;

/** The five §105 demonstrations, in the order their nodes are created. */
export const DEMO_NAMES = [
  "constant-velocity",
  "constant-acceleration",
  "circular-path",
  "spline-path",
  "damped-spring",
] as const;

/** One of {@link DEMO_NAMES}. */
export type DemoName = (typeof DEMO_NAMES)[number];

/** A position or axis-angle rate as plain numbers, so results survive JSON. */
export type Triple = readonly [number, number, number];

/** A quaternion as plain numbers, `[x, y, z, w]`. */
export type Quad = readonly [number, number, number, number];

/**
 * Node 1 (§105 "constant velocity"), a 3D object: zero acceleration, zero
 * damping, plus a constant angular rate so the quaternion path is exercised
 * too.
 */
export const CONSTANT_VELOCITY = {
  start: [0, 0, 0] as Triple,
  linearVelocity: [2, 0, -0.5] as Triple,
  /** Axis-angle rate, rad/s: a quarter turn per second about +Y. */
  angularVelocity: [0, Math.PI / 2, 0] as Triple,
};

/**
 * Node 2 (§105 "constant acceleration"), a 3D object under gravity with linear
 * damping — the case whose discrete closed form differs visibly from the
 * continuous one.
 */
export const CONSTANT_ACCELERATION = {
  start: [-4, 5, 0] as Triple,
  linearVelocity: [1, 3, 0] as Triple,
  /** §7a: Y-up, so gravity is negative Y. */
  linearAcceleration: [0, -9.81, 0] as Triple,
  /** Per-second damping rate; makes the closed form the damped one. */
  damping: 0.5,
};

/**
 * Node 3 (§105 "circular paths"), a 2D object: `CircularTrajectory` sweeps the
 * XY plane (§7a: Y-up in 2D as well), followed with `loop: true` so the path
 * keeps running past its 4 s revolution for the whole 10 s.
 */
export const CIRCULAR = {
  center: [1, 2, -1] as Triple,
  radius: 3,
  /** rad/s — one revolution every 4 s, so `duration` is exactly 4. */
  angularVelocity: Math.PI / 2,
  phase: Math.PI / 6,
  loop: true,
};

/**
 * Node 4 (§105 "spline paths"): a centripetal Catmull-Rom through four
 * non-coplanar waypoints, not looping, so it completes at t = 8 s and holds its
 * final waypoint for the remaining 2 s.
 */
export const SPLINE = {
  points: [
    [0, 0, 0],
    [2, 3, 1],
    [5, 1, -2],
    [7, 4, 0],
  ] as readonly Triple[],
  duration: 8,
  /** §13's spline of choice and WP-2.4's default: centripetal. */
  alpha: 0.5,
};

/**
 * Node 5 (§105 "damped spring motion"): underdamped, released from rest, with
 * an explicit `duration` of 10 s so the command runs for the whole scenario and
 * completes exactly on the last step.
 */
export const SPRING = {
  from: [-6, 0, 2] as Triple,
  to: [6, 4, -2] as Triple,
  frequencyHz: 0.5,
  dampingRatio: 0.25,
  duration: 10,
};

/** A node's pose at a probe step, as plain numbers. */
export interface DemoSample {
  position: Triple;
  rotation: Quad;
}

/** Every demonstration's pose at one probe step. */
export type ProbeSample = Record<DemoName, DemoSample>;

/** The three numbers the golden file pins. */
export interface Phase2Summary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Digest after step 1. */
  firstStepDigest: number;
  /** Digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
}

/** Everything one scenario run produces; `summary` is the part under golden lock. */
export interface Phase2ScenarioResult {
  summary: Phase2Summary;
  /** One uint32 per fixed step, in step order: every node's world matrix. */
  digests: number[];
  /**
   * One uint32 per fixed step over the §43 render poses at
   * {@link RENDER_POSE_ALPHA}. Not under golden lock, but compared between
   * runs — interpolation must be as deterministic as simulation.
   */
  renderDigests: number[];
  /** Poses at step {@link PROBE_STEP_ONE_SECOND} (t = 1 s). */
  atOneSecond: ProbeSample;
  /** Poses at step {@link PROBE_STEP_TEN_SECONDS} (t = 10 s). */
  atTenSeconds: ProbeSample;
  /** Host frames driven (always {@link STEP_COUNT}). */
  frameCount: number;
  /** Fixed steps the scheduler actually ran (§10); must equal `frameCount`. */
  fixedStepCount: number;
  /** Simulation time discarded by the §10 sub-step clamp; must be 0 here. */
  droppedTime: number;
  /** Simulation time reached, in seconds. */
  simulationTime: number;
  /** Largest `interpolationAlpha` seen at frame end; 0 on clean frames (§10). */
  maximumInterpolationAlpha: number;
  /** §42 conflict warnings emitted during the run; must be 0. */
  authorityWarningCount: number;
  /**
   * Whether computing render poses ever changed a scene transform (§42/§43:
   * it must not). `false` is the passing value.
   */
  renderPoseTouchedTransforms: boolean;
  /** Nodes hashed per step — the five demonstrations plus the scene root. */
  hashedNodeCount: number;
}

/** `Vector3` from a {@link Triple}. */
function vec(t: Triple): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
}

/** A node's local pose as plain numbers. */
function sampleOf(node: Node): DemoSample {
  const { position, rotation } = node.transform;
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
}

/**
 * Runs the Phase 2 exit scenario once, from scratch, and returns its checksums
 * and probe samples.
 *
 * Every call in any process is independent: it builds its own `Application`,
 * its own scene, its own components and trajectories, and disposes the
 * application before returning. Nothing is cached at module scope, so calling
 * it twice in one process is a genuine second run rather than a replay.
 *
 * @returns the run's summary, per-step digests, probe poses, and run statistics
 */
export async function runPhase2Scenario(): Promise<Phase2ScenarioResult> {
  const application = new Application({ fixedTimeStep: FIXED_TIME_STEP });
  const scene = application.scene;

  // --- The five §105 demonstrations, one node each -------------------------
  // Every node declares `"kinematic"` authority (§42) *before* any system runs,
  // so no system ever writes a transform it does not own. The warning counter
  // below turns that from a claim into a measurement.
  const nodes: Node[] = [];
  for (const name of DEMO_NAMES) {
    const node = new Group();
    node.name = name;
    node.transformAuthority = "kinematic";
    scene.add(node);
    nodes.push(node);
  }
  const [velocityNode, accelerationNode, circleNode, splineNode, springNode] =
    nodes;

  velocityNode.transform.position.set(
    CONSTANT_VELOCITY.start[0],
    CONSTANT_VELOCITY.start[1],
    CONSTANT_VELOCITY.start[2],
  );
  velocityNode.addComponent(
    new MotionComponent({
      linearVelocity: vec(CONSTANT_VELOCITY.linearVelocity),
      angularVelocity: vec(CONSTANT_VELOCITY.angularVelocity),
    }),
  );

  accelerationNode.transform.position.set(
    CONSTANT_ACCELERATION.start[0],
    CONSTANT_ACCELERATION.start[1],
    CONSTANT_ACCELERATION.start[2],
  );
  accelerationNode.addComponent(
    new MotionComponent({
      linearVelocity: vec(CONSTANT_ACCELERATION.linearVelocity),
      linearAcceleration: vec(CONSTANT_ACCELERATION.linearAcceleration),
      damping: CONSTANT_ACCELERATION.damping,
    }),
  );

  const circleController = circleNode.addComponent(new KinematicController());
  circleController.followPath(
    new CircularTrajectory({
      center: vec(CIRCULAR.center),
      radius: CIRCULAR.radius,
      angularVelocity: CIRCULAR.angularVelocity,
      phase: CIRCULAR.phase,
    }),
    { loop: CIRCULAR.loop },
  );

  const splineController = splineNode.addComponent(new KinematicController());
  splineController.followPath(
    new CatmullRomTrajectory({
      points: SPLINE.points.map(vec),
      duration: SPLINE.duration,
      alpha: SPLINE.alpha,
    }),
  );

  const springController = springNode.addComponent(new KinematicController());
  springController.followPath(
    new DampedSpringTrajectory({
      from: vec(SPRING.from),
      to: vec(SPRING.to),
      frequencyHz: SPRING.frequencyHz,
      dampingRatio: SPRING.dampingRatio,
      duration: SPRING.duration,
    }),
  );

  // --- Systems (§39, plan D5) ----------------------------------------------
  // `MotionSystem` and `KinematicSystem` share PRIORITY_KINEMATICS and
  // therefore run in registration order; they touch disjoint nodes, so the
  // order is immaterial to the result and fixed only for reproducibility.
  const motionSystem = new MotionSystem();
  motionSystem.track(velocityNode);
  motionSystem.track(accelerationNode);
  application.systems.register(motionSystem);

  const kinematicSystem = new KinematicSystem();
  kinematicSystem.track(circleNode);
  kinematicSystem.track(splineNode);
  kinematicSystem.track(springNode);
  application.systems.register(kinematicSystem);

  // §43 pose store, captured at §39 step 10 — after every writer above.
  const poses = new PoseBuffer();
  for (const node of nodes) {
    poses.track(node);
  }
  application.systems.register(createSnapshotSystem(poses));

  // --- Probes and hashing (§33, plan D6) -----------------------------------
  const digests: number[] = [];
  const renderDigests: number[] = [];
  let fixedStepCount = 0;
  let maximumInterpolationAlpha = 0;
  let renderPoseTouchedTransforms = false;
  let atOneSecond: ProbeSample | null = null;
  let atTenSeconds: ProbeSample | null = null;

  const renderPosition = new Vector3();
  const renderRotation = new Quaternion();

  // `fixedUpdate` fires after every registered system ran for that step (§10,
  // §39), so a probe here reads the finished pose of the step it names.
  application.on("fixedUpdate", () => {
    fixedStepCount += 1;
    if (fixedStepCount === PROBE_STEP_ONE_SECOND) {
      atOneSecond = probe(nodes);
    }
    if (fixedStepCount === PROBE_STEP_TEN_SECONDS) {
      atTenSeconds = probe(nodes);
    }
  });

  // `update` fires once per host frame, after `Application` resolved world
  // transforms (§7), so the matrices hashed here are resolved, not stale.
  application.on("update", (time) => {
    if (time.interpolationAlpha > maximumInterpolationAlpha) {
      maximumInterpolationAlpha = time.interpolationAlpha;
    }

    const worldChecksum = createChecksum();
    scene.traverse((node) => {
      worldChecksum.addFloats(node.transform.worldMatrix.elements);
    });
    digests.push(worldChecksum.digest());

    // §43 render poses are presentation-only: computed into scratch, never
    // written back. The local-pose digest is taken before and after so a
    // regression that wrote one back would show up as a changed transform
    // rather than merely as a changed matrix next frame.
    const before = localPoseDigest(nodes);
    const renderChecksum = createChecksum();
    for (const node of nodes) {
      poses.computeRenderPose(
        node,
        RENDER_POSE_ALPHA,
        renderPosition,
        renderRotation,
      );
      renderChecksum.addFloat(renderPosition.x);
      renderChecksum.addFloat(renderPosition.y);
      renderChecksum.addFloat(renderPosition.z);
      renderChecksum.addFloat(renderRotation.x);
      renderChecksum.addFloat(renderRotation.y);
      renderChecksum.addFloat(renderRotation.z);
      renderChecksum.addFloat(renderRotation.w);
    }
    renderDigests.push(renderChecksum.digest());
    if (localPoseDigest(nodes) !== before) {
      renderPoseTouchedTransforms = true;
    }
  });

  // --- Drive (§10) ---------------------------------------------------------
  // §42 conflict warnings go to `console.warn`; counting them here turns "all
  // under proper authority" into a measured zero. Restored in `finally` so a
  // failure cannot leak a patched console into the rest of the suite.
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
    await application.initialize();
    application.start();
    for (let step = 0; step < STEP_COUNT; step += 1) {
      application.step(FIXED_TIME_STEP);
    }
  } finally {
    console.warn = originalWarn;
  }

  const summaryChecksum = createChecksum();
  for (let i = 0; i < digests.length; i += 1) {
    // Digests are uint32s; `addFloat` quantizes by 1e6, so the largest possible
    // value maps to 4.29e15 — inside the 53-bit-safe range the hasher requires.
    summaryChecksum.addFloat(digests[i]);
  }

  const time = application.time;
  const result: Phase2ScenarioResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      lastStepDigest: digests[digests.length - 1],
    },
    digests,
    renderDigests,
    atOneSecond: atOneSecond ?? emptyProbe(),
    atTenSeconds: atTenSeconds ?? emptyProbe(),
    frameCount: STEP_COUNT,
    fixedStepCount,
    droppedTime: time.droppedTime,
    simulationTime: time.simulationTime,
    maximumInterpolationAlpha,
    authorityWarningCount,
    renderPoseTouchedTransforms,
    hashedNodeCount: DEMO_NAMES.length + 1,
  };

  application.dispose();
  return result;
}

/** Every demonstration's current pose, keyed by {@link DEMO_NAMES}. */
function probe(nodes: readonly Node[]): ProbeSample {
  const sample = emptyProbe();
  for (let i = 0; i < DEMO_NAMES.length; i += 1) {
    sample[DEMO_NAMES[i]] = sampleOf(nodes[i]);
  }
  return sample;
}

/** A probe with every demonstration zeroed; overwritten by {@link probe}. */
function emptyProbe(): ProbeSample {
  const zero: DemoSample = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  return {
    "constant-velocity": zero,
    "constant-acceleration": zero,
    "circular-path": zero,
    "spline-path": zero,
    "damped-spring": zero,
  };
}

/** Checksum of every demonstration node's **local** pose, in node order. */
function localPoseDigest(nodes: readonly Node[]): number {
  const checksum = createChecksum();
  for (const node of nodes) {
    const { position, rotation } = node.transform;
    checksum.addFloat(position.x);
    checksum.addFloat(position.y);
    checksum.addFloat(position.z);
    checksum.addFloat(rotation.x);
    checksum.addFloat(rotation.y);
    checksum.addFloat(rotation.z);
    checksum.addFloat(rotation.w);
  }
  return checksum.digest();
}
