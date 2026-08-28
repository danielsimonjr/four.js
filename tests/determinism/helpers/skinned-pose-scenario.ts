/**
 * The §54 skinned-pose determinism scenario (RFC 0003 — gaps PH-10 + R-22,
 * 2026-08-28): one headless run of a three-bone rig driven by §17's two
 * "binding form" tracks — a skeletal-joint quaternion track slerping the hip,
 * a skeletal-joint vector track translating the knee, and a morph-weight
 * number track ramping one element of the `MorphWeights` component — stepped
 * 600 times (10 s at 1/60), reduced to a per-step checksum over the
 * **skinning palette**.
 *
 * The claim under golden lock is RFC 0003 §6's boundary, measured: *skeletal
 * animation is deterministic* up to and including the palette
 * (`Skeleton.update` — bones visited in insertion order, matrix products in
 * one fixed association order), which is the last CPU value before vertex
 * deformation leaves the §33 envelope for the GPU. Nothing here reads
 * anything back from below that line, because no such API exists — the
 * scenario is itself evidence that the palette is reachable headlessly and
 * skinned vertices are not.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`.** The quaternion track slerps (§17's fifth interpolation
 * mode), and slerp is `acos`/`sin` arithmetic ECMA-262 does not pin to the
 * last bit — the same reason `phase4`'s golden records that tier. The vector
 * and number tracks are exact IEEE lerps; the palette is products and one
 * inversion over those values.
 *
 * ## Runtime constraints
 *
 * Loaded by Vitest *and* by a fresh `node` child process, so this file must
 * stay within Node's erasable-syntax subset — see
 * `animation-controller-scenario.ts`, whose shape this file deliberately
 * follows.
 */

import {
  AnimationClip,
  AnimationMixer,
  AnimationSystem,
  AnimationTrack,
  numberAdapter,
  quaternionAdapter,
  vector3Adapter,
} from "@four/animation";
import { createChecksum } from "@four/diagnostics";
import { Quaternion, Vector3 } from "@four/math";
import { Bone, Group, MorphWeights, Skeleton } from "@four/scene";
import { Application } from "four/application";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long. */
export const STEP_COUNT = 600;

/** Joints in the rig; the palette is `16 ×` this many floats. */
export const BONE_COUNT = 3;

/** 1-based fixed step at t = 2 s — the mid-run probe. */
export const PROBE_STEP_MID = 120;

/** The values the golden file pins. */
export interface SkinnedPoseSummary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Digest after step 1. */
  firstStepDigest: number;
  /** Digest after step {@link PROBE_STEP_MID}. */
  midStepDigest: number;
  /** Digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
}

/** Everything one scenario run produces; `summary` is under golden lock. */
export interface SkinnedPoseResult {
  summary: SkinnedPoseSummary;
  /** One uint32 per fixed step, over the palette and the morph weights. */
  digests: number[];
  /** The full palette after the last step, as plain numbers. */
  finalPalette: number[];
  /** The morph weights after the last step. */
  finalWeights: number[];
  /** Fixed steps the scheduler actually ran; must equal {@link STEP_COUNT}. */
  fixedStepCount: number;
  /** Simulation time discarded by the §10 clamp; must be 0 here. */
  droppedTime: number;
  /** §42/§16 warnings observed; must be 0. */
  authorityWarningCount: number;
}

/**
 * Runs the skinned-pose determinism scenario once, from scratch.
 *
 * Every call in any process is independent — nothing is cached at module
 * scope, so a second call is a genuine second run rather than a replay.
 */
export async function runSkinnedPoseScenario(): Promise<SkinnedPoseResult> {
  const application = new Application({ fixedTimeStep: FIXED_TIME_STEP });

  // The rig: a mesh-shaped root (a Group — the palette needs a skin root, not
  // a renderer) over hip → knee → foot, each a scene node like any other.
  const skinRoot = new Group();
  skinRoot.name = "character";
  const hip = new Bone();
  hip.transform.position.set(0, 1, 0);
  const knee = new Bone();
  knee.transform.position.set(0, -0.5, 0);
  const foot = new Bone();
  foot.transform.position.set(0, -0.5, 0);
  hip.add(knee);
  knee.add(foot);
  skinRoot.add(hip);
  application.scene.add(skinRoot);
  for (const bone of [hip, knee, foot]) {
    bone.transformAuthority = "animation";
  }

  const skeleton = new Skeleton([hip, knee, foot]);
  const morph = skinRoot.addComponent(new MorphWeights(2));

  const animationSystem = new AnimationSystem();
  application.systems.register(animationSystem);

  // §17's two "missing" track types, as the binding forms they are: the
  // skeletal-joint tracks address bones through the skeleton (`bones.<i>` —
  // insertion order is the ABI, §33), the morph-weight track one element of
  // the component's array. One composite target, one mixer, one clip.
  const target = { skeleton, morph };
  const quarterTurn = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.PI / 2,
  );
  const clip = new AnimationClip({
    name: "skinned-pose",
    duration: 2,
    tracks: [
      new AnimationTrack({
        path: "skeleton.bones.0.transform.rotation",
        adapter: quaternionAdapter,
        times: [0, 1, 2],
        values: [new Quaternion(), quarterTurn, new Quaternion()],
      }),
      new AnimationTrack({
        path: "skeleton.bones.1.transform.position",
        adapter: vector3Adapter,
        times: [0, 2],
        values: [new Vector3(0, -0.5, 0), new Vector3(0.25, -0.75, 0)],
        interpolation: "linear",
      }),
      new AnimationTrack({
        path: "morph.weights.1",
        adapter: numberAdapter,
        times: [0, 2],
        values: [0, 1],
        interpolation: "linear",
      }),
    ],
  });
  const mixer = new AnimationMixer(target);
  mixer.prepare(clip, { loop: Infinity, authority: hip });
  mixer.play();
  animationSystem.track(mixer);

  const digests: number[] = [];
  let fixedStepCount = 0;

  application.on("fixedUpdate", () => {
    fixedStepCount += 1;
    // The palette after this step's pose. `update` resolves world matrices
    // on demand (`resolveWorldTransform` is version-cached), so this is
    // headless exactly what the render list does when it snapshots the
    // palette onto the item.
    skeleton.update(skinRoot);
    const checksum = createChecksum();
    checksum.addFloats(skeleton.jointMatrices);
    checksum.addFloats(morph.weights);
    digests.push(checksum.digest());
  });

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
    for (let step = 1; step <= STEP_COUNT; step += 1) {
      application.step(FIXED_TIME_STEP);
    }
  } finally {
    console.warn = originalWarn;
  }

  const summaryChecksum = createChecksum();
  for (const digest of digests) {
    summaryChecksum.addFloat(digest);
  }

  const time = application.time;
  const result: SkinnedPoseResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      midStepDigest: digests[PROBE_STEP_MID - 1],
      lastStepDigest: digests[digests.length - 1],
    },
    digests,
    finalPalette: Array.from(skeleton.jointMatrices),
    finalWeights: Array.from(morph.weights),
    fixedStepCount,
    droppedTime: time.droppedTime,
    authorityWarningCount,
  };
  application.dispose();
  return result;
}
