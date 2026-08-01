import {
  constructionCount,
  Quaternion,
  resetConstructionCount,
  Vector3,
} from "@four/math";
// Test-only import (WP-2.6 decision, reported to the orchestrator): §39's
// `SystemRegistry` and the §10 `Scheduler` live in `@four/motion`, whose
// dependency edge runs motion → scene (plan §3.1). `src/interpolation.ts`
// therefore imports nothing from motion — it restates the system shape
// structurally — and this file imports motion **only** to prove that the
// restated shape really does register, run in the §39 slot, and carry the same
// priority constant. No package.json dependency is added; the module resolves
// through the workspace root, which declares every package as a devDependency.
import {
  PRIORITY_KINEMATICS,
  PRIORITY_SNAPSHOT,
  Scheduler,
  SystemRegistry,
  type SimulationSystem,
} from "@four/motion";
import { describe, expect, it } from "vitest";

import {
  createSnapshotSystem,
  Group,
  POSE_SNAPSHOT_PRIORITY,
  PoseBuffer,
  type Node,
} from "../src/index.js";

const AXIS_Z = new Vector3(0, 0, 1);
const HALF_PI = Math.PI / 2;

/** A scratch destination pair, so no test reuses another's outputs. */
function outputs(): { position: Vector3; rotation: Quaternion } {
  return { position: new Vector3(), rotation: new Quaternion() };
}

/** A named node at `(x, y, z)`, for readable failures. */
function nodeAt(name: string, x = 0, y = 0, z = 0): Group {
  const node = new Group();
  node.name = name;
  node.transform.position.set(x, y, z);
  return node;
}

function expectVector(
  actual: Vector3,
  x: number,
  y: number,
  z: number,
  digits = 12,
): void {
  expect(actual.x, "x").toBeCloseTo(x, digits);
  expect(actual.y, "y").toBeCloseTo(y, digits);
  expect(actual.z, "z").toBeCloseTo(z, digits);
}

function expectQuaternion(
  actual: Quaternion,
  x: number,
  y: number,
  z: number,
  w: number,
  digits = 12,
): void {
  expect(actual.x, "x").toBeCloseTo(x, digits);
  expect(actual.y, "y").toBeCloseTo(y, digits);
  expect(actual.z, "z").toBeCloseTo(z, digits);
  expect(actual.w, "w").toBeCloseTo(w, digits);
}

/**
 * The rotation angle a unit quaternion about +Z encodes, in radians — read
 * straight from its components rather than through any math helper, so the
 * slerp assertions have an independent ground truth.
 */
function angleAboutZ(q: Quaternion): number {
  return 2 * Math.atan2(q.z, q.w);
}

describe("PoseBuffer tracking", () => {
  it("tracks and untracks nodes, reporting membership and size", () => {
    const buffer = new PoseBuffer();
    const a = nodeAt("a");
    const b = nodeAt("b");

    expect(buffer.size).toBe(0);
    expect(buffer.has(a)).toBe(false);

    buffer.track(a).track(b);
    expect(buffer.size).toBe(2);
    expect(buffer.has(a)).toBe(true);
    expect(buffer.has(b)).toBe(true);

    expect(buffer.untrack(a)).toBe(true);
    expect(buffer.untrack(a)).toBe(false);
    expect(buffer.has(a)).toBe(false);
    expect(buffer.size).toBe(1);

    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.has(b)).toBe(false);
  });

  it("returns false for an untracked node and leaves the outputs untouched", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("untracked", 7, 8, 9);
    const out = outputs();
    out.position.set(-1, -2, -3);
    out.rotation.set(0, 0, 1, 0);

    expect(
      buffer.computeRenderPose(node, 0.5, out.position, out.rotation),
    ).toBe(false);
    expectVector(out.position, -1, -2, -3);
    expectQuaternion(out.rotation, 0, 0, 1, 0);

    // Also false after the node has been untracked again.
    buffer.track(node);
    buffer.capture();
    expect(buffer.untrack(node)).toBe(true);
    expect(
      buffer.computeRenderPose(node, 0.5, out.position, out.rotation),
    ).toBe(false);
    expectVector(out.position, -1, -2, -3);
  });

  it("seeds both poses at track time, so a freshly tracked node never interpolates from garbage", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("seeded", 3, 4, 5);
    buffer.track(node);
    const out = outputs();

    for (const alpha of [0, 0.5, 1]) {
      expect(
        buffer.computeRenderPose(node, alpha, out.position, out.rotation),
      ).toBe(true);
      expectVector(out.position, 3, 4, 5);
      expectQuaternion(out.rotation, 0, 0, 0, 1);
    }
  });

  it("re-tracking an already tracked node keeps its stored poses", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("retracked", 0, 0, 0);
    buffer.track(node);
    buffer.capture();
    node.transform.position.set(10, 0, 0);
    buffer.capture();

    buffer.track(node); // no-op
    expect(buffer.size).toBe(1);

    const out = outputs();
    buffer.computeRenderPose(node, 0, out.position, out.rotation);
    expectVector(out.position, 0, 0, 0);
    buffer.computeRenderPose(node, 1, out.position, out.rotation);
    expectVector(out.position, 10, 0, 0);
  });
});

describe("PoseBuffer.capture", () => {
  it("sets previous = current at the first capture, even when the node moved since track()", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("first", 0, 0, 0);
    buffer.track(node);

    // Movement between track() and the first capture is not a simulation step.
    node.transform.position.set(100, 0, 0);
    buffer.capture();

    const out = outputs();
    for (const alpha of [0, 0.25, 1]) {
      buffer.computeRenderPose(node, alpha, out.position, out.rotation);
      expectVector(out.position, 100, 0, 0);
    }

    // The step after it does interpolate.
    node.transform.position.set(200, 0, 0);
    buffer.capture();
    buffer.computeRenderPose(node, 0.5, out.position, out.rotation);
    expectVector(out.position, 150, 0, 0);
  });

  it("shifts previous <- current <- transform on every capture", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("shifting", 0, 0, 0);
    buffer.track(node);
    buffer.capture();

    const out = outputs();
    for (let step = 1; step <= 4; step += 1) {
      node.transform.position.set(step, 2 * step, -step);
      buffer.capture();

      buffer.computeRenderPose(node, 0, out.position, out.rotation);
      expectVector(out.position, step - 1, 2 * (step - 1), -(step - 1));
      buffer.computeRenderPose(node, 1, out.position, out.rotation);
      expectVector(out.position, step, 2 * step, -step);
    }
  });

  it("restricts the capture to a subtree when given a root", () => {
    const buffer = new PoseBuffer();
    const root = nodeAt("root", 0, 0, 0);
    const child = nodeAt("child", 0, 0, 0);
    const outsider = nodeAt("outsider", 0, 0, 0);
    root.add(child);
    buffer.track(root).track(child).track(outsider);
    buffer.capture();

    root.transform.position.set(1, 0, 0);
    child.transform.position.set(2, 0, 0);
    outsider.transform.position.set(3, 0, 0);
    buffer.capture(root);

    const out = outputs();
    buffer.computeRenderPose(root, 1, out.position, out.rotation);
    expectVector(out.position, 1, 0, 0);
    buffer.computeRenderPose(child, 1, out.position, out.rotation);
    expectVector(out.position, 2, 0, 0);
    // The outsider was not captured: it still reports its seeded pose.
    buffer.computeRenderPose(outsider, 1, out.position, out.rotation);
    expectVector(out.position, 0, 0, 0);
  });

  it("does not modify the transforms it reads", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("read-only", 1, 2, 3);
    buffer.track(node);
    const version = node.transform.version;

    buffer.capture();
    node.transform.position.set(4, 5, 6);
    const versionAfterMove = node.transform.version;
    buffer.capture();

    expect(node.transform.version).toBe(versionAfterMove);
    expect(versionAfterMove).toBeGreaterThan(version);
    expectVector(node.transform.position, 4, 5, 6);
  });
});

describe("PoseBuffer.computeRenderPose", () => {
  it("lerps positions at alpha 0, 0.5 and 1", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("lerped", 0, 0, 0);
    buffer.track(node);
    buffer.capture();
    node.transform.position.set(10, -4, 2);
    buffer.capture();

    const out = outputs();
    const cases: [number, [number, number, number]][] = [
      [0, [0, 0, 0]],
      [0.25, [2.5, -1, 0.5]],
      [0.5, [5, -2, 1]],
      [0.75, [7.5, -3, 1.5]],
      [1, [10, -4, 2]],
    ];
    for (const [alpha, [x, y, z]] of cases) {
      expect(
        buffer.computeRenderPose(node, alpha, out.position, out.rotation),
      ).toBe(true);
      expectVector(out.position, x, y, z);
    }
  });

  it("slerps rotations: the 90-degree midpoint is the unit 45-degree rotation, not the component average", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("slerped");
    buffer.track(node);
    buffer.capture(); // previous = identity
    node.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    buffer.capture(); // current = 90 degrees about +Z

    const out = outputs();
    buffer.computeRenderPose(node, 0.5, out.position, out.rotation);

    // Spherical midpoint: the unit quaternion of a 45-degree rotation.
    const half = HALF_PI / 4; // half of 45 degrees
    expectQuaternion(out.rotation, 0, 0, Math.sin(half), Math.cos(half));

    // Component-wise lerp of the same pair would give (0, 0, 0.35355, 0.85355)
    // — the same *direction*, but not a unit quaternion. Assert both that the
    // result is unit length and that it differs from the raw average, so a
    // straight lerp cannot pass this test.
    const rawZ = 0.5 * Math.sin(HALF_PI / 2);
    const rawW = 0.5 * (1 + Math.cos(HALF_PI / 2));
    expect(Math.abs(out.rotation.z - rawZ)).toBeGreaterThan(0.02);
    expect(Math.abs(out.rotation.w - rawW)).toBeGreaterThan(0.06);
    const length = Math.hypot(
      out.rotation.x,
      out.rotation.y,
      out.rotation.z,
      out.rotation.w,
    );
    expect(length).toBeCloseTo(1, 12);
  });

  it("slerps at constant angular velocity, which normalized linear interpolation does not", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("constant-speed");
    buffer.track(node);
    buffer.capture();
    node.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    buffer.capture();

    const out = outputs();
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      buffer.computeRenderPose(node, alpha, out.position, out.rotation);
      expect(angleAboutZ(out.rotation), `alpha ${String(alpha)}`).toBeCloseTo(
        alpha * HALF_PI,
        12,
      );
    }

    // At alpha 0.25 nlerp (normalize(lerp(a, b, t))) would give ~21.6 degrees
    // rather than 22.5 — the check above is tight enough to separate them, and
    // this states the margin explicitly.
    buffer.computeRenderPose(node, 0.25, out.position, out.rotation);
    const nlerpZ = 0.25 * Math.sin(HALF_PI / 2);
    const nlerpW = 0.75 + 0.25 * Math.cos(HALF_PI / 2);
    const nlerpAngle = 2 * Math.atan2(nlerpZ, nlerpW);
    expect(Math.abs(0.25 * HALF_PI - nlerpAngle)).toBeGreaterThan(0.01);
    expect(angleAboutZ(out.rotation)).not.toBeCloseTo(nlerpAngle, 4);
  });

  it("clamps alpha to [0, 1] and treats a non-finite alpha as 0", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("clamped", 0, 0, 0);
    buffer.track(node);
    buffer.capture();
    node.transform.position.set(10, 0, 0);
    node.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    buffer.capture();

    const out = outputs();
    for (const alpha of [-1, -0.001, Number.NEGATIVE_INFINITY, Number.NaN]) {
      buffer.computeRenderPose(node, alpha, out.position, out.rotation);
      expectVector(out.position, 0, 0, 0);
      expectQuaternion(out.rotation, 0, 0, 0, 1);
    }
    for (const alpha of [1.001, 2, Number.POSITIVE_INFINITY]) {
      buffer.computeRenderPose(node, alpha, out.position, out.rotation);
      expectVector(out.position, 10, 0, 0);
      expect(angleAboutZ(out.rotation)).toBeCloseTo(HALF_PI, 12);
    }
  });

  it("never writes a render pose back into the scene (§43): transforms and versions are untouched", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("presentation-only", 0, 0, 0);
    buffer.track(node);
    buffer.capture();
    node.transform.position.set(10, 0, 0);
    node.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    buffer.capture();

    const version = node.transform.version;
    const out = outputs();
    for (let i = 0; i <= 20; i += 1) {
      buffer.computeRenderPose(node, i / 20, out.position, out.rotation);
    }

    expect(node.transform.version).toBe(version);
    expectVector(node.transform.position, 10, 0, 0);
    expect(angleAboutZ(node.transform.rotation)).toBeCloseTo(HALF_PI, 12);
    // The mid-frame outputs are not the scene pose, which is the whole point.
    buffer.computeRenderPose(node, 0.5, out.position, out.rotation);
    expectVector(out.position, 5, 0, 0);
  });
});

describe("createSnapshotSystem", () => {
  it("runs in the §39 snapshot slot, which is @four/motion's PRIORITY_SNAPSHOT", () => {
    expect(POSE_SNAPSHOT_PRIORITY).toBe(PRIORITY_SNAPSHOT);
    const system = createSnapshotSystem(new PoseBuffer());
    expect(system.priority).toBe(PRIORITY_SNAPSHOT);
    expect(
      createSnapshotSystem(new PoseBuffer(), { priority: 42 }).priority,
    ).toBe(42);
  });

  it("captures once per fixed step, after a system that moves nodes at PRIORITY_KINEMATICS", () => {
    const buffer = new PoseBuffer();
    const node = nodeAt("driven", 0, 0, 0);
    buffer.track(node);

    const order: string[] = [];
    let stepIndex = 0;
    const mover: SimulationSystem = {
      priority: PRIORITY_KINEMATICS,
      initialize: () => {
        order.push("mover:init");
      },
      fixedUpdate: () => {
        stepIndex += 1;
        node.transform.position.set(stepIndex, 0, 0);
        order.push(`mover:${String(stepIndex)}`);
      },
      dispose: () => {
        order.push("mover:dispose");
      },
    };

    const snapshot = createSnapshotSystem(buffer);
    const observer: SimulationSystem = {
      priority: POSE_SNAPSHOT_PRIORITY + 1,
      initialize: () => undefined,
      fixedUpdate: () => {
        order.push(`snapshot-observed:${String(stepIndex)}`);
      },
      dispose: () => undefined,
    };

    const registry = new SystemRegistry();
    // Registered out of order on purpose: the registry sorts by priority.
    registry.register(observer);
    registry.register(snapshot);
    registry.register(mover);

    const scheduler = new Scheduler({ fixedDeltaTime: 1 / 60 });
    const detach = registry.attachToScheduler(scheduler);

    const out = outputs();
    for (let step = 1; step <= 3; step += 1) {
      scheduler.step(1 / 60);
      expect(scheduler.time.simulationStep).toBe(step);

      // Current pose is this step's, previous is the one before it: the
      // snapshot ran *after* the mover, not before it.
      buffer.computeRenderPose(node, 1, out.position, out.rotation);
      expectVector(out.position, step, 0, 0);
      buffer.computeRenderPose(node, 0, out.position, out.rotation);
      expectVector(out.position, step === 1 ? 1 : step - 1, 0, 0);
      buffer.computeRenderPose(node, 0.5, out.position, out.rotation);
      expectVector(out.position, step === 1 ? 1 : step - 0.5, 0, 0);
    }

    expect(order).toEqual([
      "mover:init",
      "mover:1",
      "snapshot-observed:1",
      "mover:2",
      "snapshot-observed:2",
      "mover:3",
      "snapshot-observed:3",
    ]);

    detach();
    registry.dispose();
    expect(order.at(-1)).toBe("mover:dispose");
    // Disposal leaves the buffer intact for a renderer still interpolating.
    expect(buffer.has(node)).toBe(true);
    expect(buffer.computeRenderPose(node, 1, out.position, out.rotation)).toBe(
      true,
    );
  });

  it("captures only its configured subtree", () => {
    const buffer = new PoseBuffer();
    const root = nodeAt("sub-root", 0, 0, 0);
    const outsider = nodeAt("outsider", 0, 0, 0);
    buffer.track(root).track(outsider);

    const registry = new SystemRegistry();
    registry.register(createSnapshotSystem(buffer, { root }));
    const scheduler = new Scheduler({ fixedDeltaTime: 1 / 60 });
    registry.attachToScheduler(scheduler);

    scheduler.step(1 / 60);
    root.transform.position.set(5, 0, 0);
    outsider.transform.position.set(5, 0, 0);
    scheduler.step(1 / 60);

    const out = outputs();
    buffer.computeRenderPose(root, 1, out.position, out.rotation);
    expectVector(out.position, 5, 0, 0);
    buffer.computeRenderPose(outsider, 1, out.position, out.rotation);
    expectVector(out.position, 0, 0, 0);
  });
});

describe("allocation", () => {
  it("allocates nothing in a steady state of captures and interpolations", () => {
    const buffer = new PoseBuffer();
    const nodes: Node[] = [];
    for (let i = 0; i < 50; i += 1) {
      const node = nodeAt(`node-${String(i)}`, i, 0, 0);
      nodes.push(node);
      buffer.track(node);
    }
    const out = outputs();

    // Warm up: first capture, first interpolation, first subtree walk.
    buffer.capture();
    for (const node of nodes) {
      buffer.computeRenderPose(node, 0.5, out.position, out.rotation);
    }

    resetConstructionCount();
    for (let step = 0; step < 1000; step += 1) {
      const angle = step * 0.001;
      for (let i = 0; i < nodes.length; i += 1) {
        const transform = nodes[i].transform;
        transform.position.set(i + step, step, 0);
        transform.rotation.setFromAxisAngle(AXIS_Z, angle);
      }
      buffer.capture();
      const alpha = (step % 10) / 10;
      for (let i = 0; i < nodes.length; i += 1) {
        buffer.computeRenderPose(nodes[i], alpha, out.position, out.rotation);
      }
    }
    expect(constructionCount()).toBe(0);

    // The result is still correct after all that.
    buffer.computeRenderPose(nodes[0], 1, out.position, out.rotation);
    expectVector(out.position, 999, 999, 0);
  });
});
