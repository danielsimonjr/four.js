import { ComponentRegistry } from "@four/core";
import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Group, PoseTarget, Transform } from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const HALF_PI = Math.PI / 2;
const AXIS_Y = new Vector3(0, 1, 0);

/** A unit quaternion of `angle` radians about +Y (§7a: radians, Y-up). */
function yaw(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(AXIS_Y, angle);
}

/** Component-wise vector assertion. */
function expectVector(actual: Vector3, x: number, y: number, z: number): void {
  expect(actual.x).toBeCloseTo(x, 12);
  expect(actual.y).toBeCloseTo(y, 12);
  expect(actual.z).toBeCloseTo(z, 12);
}

/** Component-wise quaternion assertion (`Quaternion` has no `equalsApprox`). */
function expectQuaternion(actual: Quaternion, expected: Quaternion): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
  expect(actual.z).toBeCloseTo(expected.z, 12);
  expect(actual.w).toBeCloseTo(expected.w, 12);
}

describe("PoseTarget construction (§19, P7-1)", () => {
  it("starts at the origin with identity rotation and version 0", () => {
    const target = new PoseTarget();

    expectVector(target.position, 0, 0, 0);
    expectQuaternion(target.rotation, new Quaternion(0, 0, 0, 1));
    expect(target.version).toBe(0);
    expect(target.host).toBeNull();
  });

  it("seeds the finite-difference history to the same pose", () => {
    const target = new PoseTarget();

    expectVector(target.previousPosition, 0, 0, 0);
    expectQuaternion(target.previousRotation, new Quaternion(0, 0, 0, 1));
  });

  it("gives every instance its own math objects", () => {
    const a = new PoseTarget();
    const b = new PoseTarget();

    a.position.set(1, 2, 3);
    expectVector(b.position, 0, 0, 0);
    expect(b.version).toBe(0);
  });

  it("carries no scale channel (P7-1 MVP)", () => {
    // Position and rotation only — a solver body has no scale to blend
    // against. The assertion exists so adding one later is a deliberate act.
    expect("scale" in new PoseTarget()).toBe(false);
  });

  it("is keyed as `pose-target` (plan D2, §79)", () => {
    expect(PoseTarget.typeName).toBe("pose-target");
  });
});

describe("PoseTarget as a §6a component", () => {
  it("attaches to a node and is found by type", () => {
    const node = new Group();
    const target = node.addComponent(new PoseTarget());

    expect(target.host).toBe(node);
    expect(node.getComponent(PoseTarget)).toBe(target);

    expect(node.removeComponent(target)).toBe(true);
    expect(target.host).toBeNull();
    expect(node.getComponent(PoseTarget)).toBeUndefined();
  });

  it("is one per node: a second attach replaces the first with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    const first = node.addComponent(new PoseTarget());
    const second = node.addComponent(new PoseTarget());

    expect(node.getComponent(PoseTarget)).toBe(second);
    expect(first.host).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("survives a bare ComponentRegistry host and disposeAll", () => {
    const registry = new ComponentRegistry();
    const target = registry.add(new PoseTarget());

    expect(target.host).toBe(registry);
    registry.disposeAll();
    expect(target.host).toBeNull();
    // Nothing to dispose: a target holds values, no listeners and no handles.
    expect(target.version).toBe(0);
  });

  it("does not disturb the node's own transform", () => {
    const node = new Group();
    const target = node.addComponent(new PoseTarget());
    const before = node.transform.version;

    target.position.set(5, 6, 7);

    expect(node.transform.version).toBe(before);
    expectVector(node.transform.position, 0, 0, 0);
  });
});

describe("PoseTarget.version (plan D3)", () => {
  it("bumps once per math method call on position", () => {
    const target = new PoseTarget();

    target.position.set(1, 2, 3);
    expect(target.version).toBe(1);

    target.position.add(new Vector3(1, 0, 0));
    expect(target.version).toBe(2);

    target.position.scale(2);
    expect(target.version).toBe(3);
    expectVector(target.position, 4, 4, 6);
  });

  it("bumps once per math method call on rotation", () => {
    const target = new PoseTarget();

    target.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);
    expect(target.version).toBe(1);

    target.rotation.normalize();
    expect(target.version).toBe(2);

    target.rotation.identity();
    expect(target.version).toBe(3);
  });

  it("does not bump on a direct field write until markDirty announces it", () => {
    const target = new PoseTarget();

    target.position.x = 5;
    expect(target.version).toBe(0);

    target.markDirty();
    expect(target.version).toBe(1);
  });

  it("keeps the hooks when a value is copied in (§16 writes in place)", () => {
    const target = new PoseTarget();
    const source = new Vector3(1, 1, 1);

    target.position.copy(source);
    expect(target.version).toBe(1);

    // The source's (absent) hook is not copied over ours.
    target.position.copy(source);
    expect(target.version).toBe(2);
  });

  it("is not bumped by capturePrevious", () => {
    const target = new PoseTarget();
    target.position.set(1, 2, 3);
    const version = target.version;

    target.capturePrevious();

    expect(target.version).toBe(version);
  });

  it("advances monotonically and is only compared, never subtracted", () => {
    const target = new PoseTarget();
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      target.position.set(i, 0, 0);
      seen.push(target.version);
    }
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    }
  });
});

describe("PoseTarget.capturePrevious (WP-7.1)", () => {
  it("shifts current into previous, leaving current alone", () => {
    const target = new PoseTarget();
    target.position.set(1, 2, 3);
    target.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);

    target.capturePrevious();

    expectVector(target.previousPosition, 1, 2, 3);
    expectQuaternion(target.previousRotation, yaw(HALF_PI));
    expectVector(target.position, 1, 2, 3);
  });

  it("gives a finite difference of one step of target motion", () => {
    const fixedDelta = 1 / 60;
    const target = new PoseTarget();
    target.position.set(0, 0, 0);

    target.capturePrevious(); // top of the fixed step
    target.position.set(0, fixedDelta * 3, 0); // this step's animation write

    const velocityY =
      (target.position.y - target.previousPosition.y) / fixedDelta;
    expect(velocityY).toBeCloseTo(3, 12);
  });

  it("leaves previous === current immediately after a capture", () => {
    const target = new PoseTarget();
    target.position.set(0, 10, 0);
    target.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);

    target.capturePrevious();

    expect(target.position.y - target.previousPosition.y).toBe(0);
    expectQuaternion(target.previousRotation, target.rotation);
  });

  it("reads pre-first-capture authoring as motion — hence copyFrom", () => {
    // The documented window: `previous` still holds the constructed pose, so a
    // target authored before its first capture differences that authoring.
    const authored = new PoseTarget();
    authored.position.set(0, 10, 0);
    expect(authored.position.y - authored.previousPosition.y).toBe(10);

    const transform = new Transform();
    transform.position.set(0, 10, 0);
    const seeded = new PoseTarget().copyFrom(transform);
    expect(seeded.position.y - seeded.previousPosition.y).toBe(0);
  });

  it("keeps history independent of later current-pose edits", () => {
    const target = new PoseTarget();
    target.position.set(1, 0, 0);
    target.capturePrevious();

    target.position.set(9, 9, 9);
    target.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);

    expectVector(target.previousPosition, 1, 0, 0);
    expectQuaternion(target.previousRotation, new Quaternion(0, 0, 0, 1));
    expect(target.previousPosition).not.toBe(target.position);
    expect(target.previousRotation).not.toBe(target.rotation);
  });

  it("collapses the difference to zero when called twice in one step", () => {
    // Documented consequence of a double call — asserted so the contract is
    // visible to whoever wires the call site (WP-7.3).
    const target = new PoseTarget();
    target.position.set(1, 0, 0);
    target.capturePrevious();
    target.position.set(2, 0, 0);
    target.capturePrevious();
    target.capturePrevious();

    expect(target.position.x - target.previousPosition.x).toBe(0);
  });

  it("allocates nothing (§7b, plan D7)", () => {
    const target = new PoseTarget();
    target.position.set(1, 2, 3);
    target.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);

    resetConstructionCount();
    for (let i = 0; i < 100; i += 1) {
      target.position.set(i, 0, 0);
      target.capturePrevious();
    }
    expect(constructionCount()).toBe(0);
  });

  it("does not install a change hook on the history objects", () => {
    const target = new PoseTarget();
    expect(target.previousPosition.onChanged).toBeUndefined();
    expect(target.previousRotation.onChanged).toBeUndefined();
  });
});

describe("PoseTarget.copyFrom", () => {
  it("seeds position and rotation from a transform", () => {
    const transform = new Transform();
    transform.position.set(4, 5, 6);
    transform.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);

    const target = new PoseTarget().copyFrom(transform);

    expectVector(target.position, 4, 5, 6);
    expectQuaternion(target.rotation, yaw(HALF_PI));
  });

  it("seeds the history too, so the first step differences to zero", () => {
    const transform = new Transform();
    transform.position.set(100, 0, 0);

    const target = new PoseTarget().copyFrom(transform);

    expectVector(target.previousPosition, 100, 0, 0);
    expect(target.position.x - target.previousPosition.x).toBe(0);
  });

  it("copies values and retains nothing", () => {
    const transform = new Transform();
    transform.position.set(1, 1, 1);
    const target = new PoseTarget().copyFrom(transform);

    transform.position.set(2, 2, 2);

    expectVector(target.position, 1, 1, 1);
    expect(target.position).not.toBe(transform.position);
    expect(target.rotation).not.toBe(transform.rotation);
  });

  it("ignores scale and pivot (P7-1 MVP)", () => {
    const transform = new Transform();
    transform.scale.set(3, 3, 3);
    transform.pivot.set(1, 1, 1);
    transform.position.set(7, 0, 0);

    const target = new PoseTarget().copyFrom(transform);

    expectVector(target.position, 7, 0, 0);
  });

  it("returns `this` so it chains off addComponent", () => {
    const node = new Group();
    node.transform.position.set(0, 3, 0);
    const target = node.addComponent(new PoseTarget()).copyFrom(node.transform);

    expect(node.getComponent(PoseTarget)).toBe(target);
    expectVector(target.position, 0, 3, 0);
  });

  it("bumps the version twice — once per hooked member", () => {
    const target = new PoseTarget();
    target.copyFrom(new Transform());
    expect(target.version).toBe(2);
  });

  it("allocates nothing", () => {
    const transform = new Transform();
    const target = new PoseTarget();

    resetConstructionCount();
    for (let i = 0; i < 100; i += 1) {
      target.copyFrom(transform);
    }
    expect(constructionCount()).toBe(0);
  });
});
