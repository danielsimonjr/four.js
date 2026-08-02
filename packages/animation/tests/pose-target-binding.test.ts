/**
 * Cross-package proof for P7-1: `@four/animation` can drive a `PoseTarget`
 * (which lives in `@four/scene`) through the ordinary §16 binding machinery,
 * with no special case anywhere and without touching the node's transform.
 *
 * The import edge exercised here — animation → scene — is the allowed one (plan
 * §3.1). The forbidden edges are the two this arrangement exists to avoid:
 * animation → physics and physics → animation.
 */

import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { Group, PoseTarget } from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBinding } from "../src/binding.js";
import { AnimationClip } from "../src/clip.js";
import { AnimationMixer } from "../src/mixer.js";
import { AnimationTrack, type AnimationTrackLike } from "../src/track.js";
import { animate } from "../src/tween.js";
import { quaternionAdapter, vector3Adapter } from "../src/values.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const HALF_PI = Math.PI / 2;
const AXIS_Y = new Vector3(0, 1, 0);

/** A unit quaternion of `angle` radians about +Y (§7a: radians, Y-up). */
function yaw(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(AXIS_Y, angle);
}

function expectVector(actual: Vector3, x: number, y: number, z: number): void {
  expect(actual.x).toBeCloseTo(x, 12);
  expect(actual.y).toBeCloseTo(y, 12);
  expect(actual.z).toBeCloseTo(z, 12);
}

function expectQuaternion(actual: Quaternion, expected: Quaternion): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
  expect(actual.z).toBeCloseTo(expected.z, 12);
  expect(actual.w).toBeCloseTo(expected.w, 12);
}

/** A node carrying a seeded target — the P7-1 arrangement. */
function targetedNode(): { node: Group; target: PoseTarget } {
  const node = new Group();
  const target = node.addComponent(new PoseTarget()).copyFrom(node.transform);
  return { node, target };
}

describe("PoseTarget bindings (§16, P7-1)", () => {
  it("resolves `position` and `rotation` as ordinary property paths", () => {
    const { target } = targetedNode();

    const position = createBinding(target, "position");
    const rotation = createBinding(target, "rotation");

    expect(position.owner).toBe(target);
    expect(position.adapter).toBe(vector3Adapter);
    expect(position.get()).toBe(target.position);
    expect(rotation.adapter).toBe(quaternionAdapter);
    expect(rotation.get()).toBe(target.rotation);
  });

  it("writes in place, so the version hook survives the write", () => {
    const { target } = targetedNode();
    const binding = createBinding(target, "position");
    const before = target.version;

    binding.set(new Vector3(1, 2, 3));

    expect(binding.get()).toBe(target.position);
    expectVector(target.position, 1, 2, 3);
    expect(target.version).toBeGreaterThan(before);
  });
});

describe("Tween over a PoseTarget (§15, §19 step 1)", () => {
  it("animates the target position", () => {
    const { target } = targetedNode();

    const tween = animate(target)
      .to({ position: new Vector3(0, 2, 0) }, 1)
      .play();

    expectVector(target.position, 0, 0, 0);
    tween.advance(0.5);
    expectVector(target.position, 0, 1, 0);
    tween.advance(0.5);
    expectVector(target.position, 0, 2, 0);
  });

  it("animates the target rotation by slerp", () => {
    const { target } = targetedNode();

    const tween = animate(target)
      .to({ rotation: yaw(HALF_PI) }, 1)
      .play();

    tween.advance(0.5);
    expectQuaternion(target.rotation, yaw(HALF_PI / 2));
    tween.advance(0.5);
    expectQuaternion(target.rotation, yaw(HALF_PI));
  });

  it("keeps the version channel live for the blend system", () => {
    const { target } = targetedNode();
    const tween = animate(target)
      .to({ position: new Vector3(0, 2, 0) }, 1)
      .play();

    const afterPlay = target.version;
    tween.advance(0.5);

    expect(target.version).toBeGreaterThan(afterPlay);
  });

  it("never touches the node's transform or claims its authority (§42)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { node, target } = targetedNode();
    const transformVersion = node.transform.version;

    animate(target)
      .to({ position: new Vector3(0, 2, 0) }, 1)
      .play()
      .advance(1);

    expectVector(target.position, 0, 2, 0);
    expectVector(node.transform.position, 0, 0, 0);
    expect(node.transform.version).toBe(transformVersion);
    expect(node.transformAuthority).toBe("manual");
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves the finite-difference history to the blend system", () => {
    // The tween writes only the current pose; `previousPosition` moves when —
    // and only when — something calls `capturePrevious` (WP-7.3 owns that).
    const fixedDelta = 1 / 60;
    const { target } = targetedNode();
    const tween = animate(target)
      .to({ position: new Vector3(0, 1, 0) }, 1)
      .play();

    target.capturePrevious();
    tween.advance(fixedDelta);

    expectVector(target.previousPosition, 0, 0, 0);
    const velocityY =
      (target.position.y - target.previousPosition.y) / fixedDelta;
    expect(velocityY).toBeCloseTo(1, 9);
  });
});

describe("AnimationMixer over a PoseTarget (§17, §19 step 1)", () => {
  /** A one-second clip driving both target channels. */
  function poseClip(): AnimationClip {
    const tracks: AnimationTrackLike[] = [
      new AnimationTrack({
        path: "position",
        adapter: vector3Adapter,
        times: [0, 1],
        values: [new Vector3(0, 0, 0), new Vector3(3, 6, 9)],
      }),
      new AnimationTrack({
        path: "rotation",
        adapter: quaternionAdapter,
        times: [0, 1],
        values: [new Quaternion(), yaw(HALF_PI)],
      }),
    ];
    return new AnimationClip({ name: "target-pose", duration: 1, tracks });
  }

  it("samples both channels onto the target", () => {
    const { target } = targetedNode();
    const mixer = new AnimationMixer(target).play(poseClip());

    mixer.advance(0.5);
    expectVector(target.position, 1.5, 3, 4.5);
    expectQuaternion(target.rotation, yaw(HALF_PI / 2));

    mixer.advance(0.5);
    expectVector(target.position, 3, 6, 9);
    expectQuaternion(target.rotation, yaw(HALF_PI));
  });

  it("scrubs deterministically — seeking twice writes the same pose", () => {
    const { target } = targetedNode();
    const mixer = new AnimationMixer(target).play(poseClip());

    mixer.seek(0.25);
    const first = target.position.clone();
    mixer.seek(0.75);
    mixer.seek(0.25);

    expectVector(target.position, first.x, first.y, first.z);
  });

  it("leaves the node's transform untouched", () => {
    const { node, target } = targetedNode();
    const mixer = new AnimationMixer(target).play(poseClip());

    mixer.advance(1);

    expectVector(target.position, 3, 6, 9);
    expectVector(node.transform.position, 0, 0, 0);
  });

  it("allocates nothing per sampled step (§7b, plan D7)", () => {
    const { target } = targetedNode();
    const mixer = new AnimationMixer(target).play(poseClip());

    resetConstructionCount();
    for (let i = 0; i < 30; i += 1) {
      mixer.advance(1 / 60);
      target.capturePrevious();
    }
    expect(constructionCount()).toBe(0);
  });
});
