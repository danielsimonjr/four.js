/**
 * §19's blend pipeline over the structural double (§19, §33, §39, §42, §43;
 * plan P7-4, WP-7.3).
 *
 * What is proved here is everything the engine owns and no solver can answer
 * for: that `"blended"` is opt-in and says what it is missing, that the two
 * weight extremes are **bit-identical** to the two poses they name, that the
 * middle is exactly §19's lerp/slerp of target and solver pose, that the target
 * — not the transform — is what a blended kinematic body is fed, that the
 * capture of the target history happens once per step *before* animation, that
 * §43 interpolates the blended pose, that §33's checksum is blind to the blend,
 * and that a step allocates nothing.
 */

import { isFourError, type FourError } from "@four/core";
import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import {
  PRIORITY_ANIMATION_TARGETS,
  SystemRegistry,
  createTimeState,
  type SimulationSystem,
} from "@four/motion";
import {
  Group,
  PoseBuffer,
  PoseTarget,
  createSnapshotSystem,
  type Node,
} from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BodyType, PhysicsWorldInit } from "../src/index.js";
import {
  Collider,
  POSE_TARGET_CAPTURE_PRIORITY,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  createPoseTargetCaptureSystem,
} from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

/** One fixed step (§10). Seconds, like every duration in this engine (§7a). */
const DT = 1 / 60;

/** Everything `PhysicsWorldInit` carries except the adapter, which is the fake. */
type WorldOverrides = Omit<Partial<PhysicsWorldInit>, "adapter"> & {
  adapter?: FakeSolverAdapter;
};

/**
 * A 3D world on a fresh fake adapter, already initialized.
 *
 * Gravity is **zero** unless a test overrides it: the fake's toy integrator
 * accelerates every dynamic body every step, and what is under test here is the
 * exact float a blend produces from a solver pose. A pose the test pinned has to
 * survive the step for that to be assertable.
 */
async function readyWorld(overrides: WorldOverrides = {}): Promise<{
  adapter: FakeSolverAdapter;
  world: PhysicsWorld;
}> {
  const adapter = overrides.adapter ?? new FakeSolverAdapter();
  const world = new PhysicsWorld({
    dimension: "3d",
    gravity: new Vector3(0, 0, 0),
    ...overrides,
    adapter,
  });
  await world.initialize();
  return { adapter, world };
}

/** Options for {@link bodyNode}. */
interface BodyNodeOptions {
  /** §22 type. Default `"dynamic"`. */
  type?: BodyType;
  /** §42 authority. Default `"blended"`. */
  authority?: Node["transformAuthority"];
  /** Attach a `PoseTarget`. Default `true`. */
  target?: boolean;
  /** §19 weights, unnormalized. Default: the component's own `1 / 0`. */
  physicsWeight?: number;
  animationWeight?: number;
}

/** A node with a body, a sphere collider and (by default) a blended target. */
function bodyNode(options: BodyNodeOptions = {}): Group {
  const node = new Group();
  node.transformAuthority = options.authority ?? "blended";
  const body = node.addComponent(
    new RigidBody({ type: options.type ?? "dynamic", mass: 2 }),
  );
  node.addComponent(new Collider({ shape: { type: "sphere", radius: 0.5 } }));
  if (options.physicsWeight !== undefined) {
    body.physicsWeight = options.physicsWeight;
  }
  if (options.animationWeight !== undefined) {
    body.animationWeight = options.animationWeight;
  }
  if (options.target !== false) {
    node.addComponent(new PoseTarget().copyFrom(node.transform));
  }
  return node;
}

/** Puts the fake solver's body `id` at an exact pose, as a solved step would. */
function placeSolverBody(
  adapter: FakeSolverAdapter,
  id: number,
  position: Vector3,
  rotation: Quaternion = new Quaternion(),
): void {
  const body = adapter.body(id);
  body.position.copy(position);
  body.rotation.copy(rotation);
  // The toy integrator would move a dynamic body by its velocity; a test that
  // pins a pose wants that pose to survive the step.
  body.linearVelocity.set(0, 0, 0);
  body.angularVelocity.set(0, 0, 0);
}

/** A quaternion of `angle` radians about `axis`. */
function rotation(axis: Vector3, angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(axis, angle);
}

/** The four components of `q`, for `Object.is`-grade comparison. */
function quaternionComponents(q: Quaternion): number[] {
  return [q.x, q.y, q.z, q.w];
}

/** The three components of `v`. */
function vectorComponents(v: Vector3): number[] {
  return [v.x, v.y, v.z];
}

/** Asserts every component is the *same float*, `-0`/`+0` included. */
function expectBitIdentical(actual: number[], expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i += 1) {
    expect(Object.is(actual[i], expected[i])).toBe(true);
  }
}

/** Silences and records `console.warn` for one test. */
function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/**
 * vitest 4 reuses an unrestored `spyOn(console, "warn")` and keeps its call
 * history. This file's later tests count warns and used to inherit the §19
 * zero-weight warning and a leftover §42 authority warning from earlier tests
 * in the same file — they passed alone and failed with the file. Restore the
 * spy so a new `spyOnWarn()` starts at zero. Worlds created here are not
 * stepped again after their test returns; the extra calls were spy history,
 * not leftover writers.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the §19 trio is opt-in and named (§19, §42, §6a)", () => {
  it("blends a node that has authority, a registered body, and a target", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ animationWeight: 1, physicsWeight: 0 });
    world.addBody(node);
    node.getComponent(PoseTarget)?.position.set(1, 2, 3);
    placeSolverBody(adapter, 1, new Vector3(9, 9, 9));

    world.step(DT);

    expect(vectorComponents(node.transform.position)).toEqual([1, 2, 3]);
  });

  it("throws INVALID_SCENE_GRAPH naming the node when the PoseTarget is missing", async () => {
    const { world } = await readyWorld();
    const node = bodyNode({ target: false });
    world.addBody(node);

    let thrown: unknown;
    try {
      world.step(DT);
    } catch (error) {
      thrown = error;
    }

    expect(isFourError(thrown)).toBe(true);
    const error = thrown as FourError;
    expect(error.code).toBe("INVALID_SCENE_GRAPH");
    expect(error.message).toContain("PoseTarget");
    expect(error.message).toContain("§19");
    expect(error.context).toEqual({ node: node.id, authority: "blended" });
  });

  it("throws from the pre-solve feed too, for a kinematic blended body", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ type: "kinematic-position", target: false });
    world.addBody(node);

    expect(() => {
      world.step(DT);
    }).toThrow();
    // Before the solve: the adapter never got its step.
    expect(adapter.steps).toBe(0);
  });

  it("leaves a node whose authority is not blended alone", async () => {
    const { world } = await readyWorld();
    const node = bodyNode({ authority: "physics", target: false });
    world.addBody(node);

    expect(() => {
      world.step(DT);
    }).not.toThrow();
  });
});

describe("weight extremes are bit-identical (§19, plan P7-4)", () => {
  it("1 / 0 writes exactly what the `physics` publish writes", async () => {
    const solverPosition = new Vector3(1 / 3, -0, 1e-8);
    const solverRotation = rotation(new Vector3(1, 2, 3).normalize(), 0.7);

    const physics = await readyWorld();
    const physicsNode = bodyNode({ authority: "physics", target: false });
    physics.world.addBody(physicsNode);
    placeSolverBody(physics.adapter, 1, solverPosition, solverRotation);
    physics.world.step(DT);

    const blended = await readyWorld();
    const blendedNode = bodyNode({ physicsWeight: 1, animationWeight: 0 });
    blended.world.addBody(blendedNode);
    blendedNode.getComponent(PoseTarget)?.position.set(-5, -5, -5);
    placeSolverBody(blended.adapter, 1, solverPosition, solverRotation);
    blended.world.step(DT);

    expectBitIdentical(
      vectorComponents(blendedNode.transform.position),
      vectorComponents(physicsNode.transform.position),
    );
    expectBitIdentical(
      quaternionComponents(blendedNode.transform.rotation),
      quaternionComponents(physicsNode.transform.rotation),
    );
  });

  it("1 / 0 is bit-identical however the ratio is spelled", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 7.5, animationWeight: 0 });
    world.addBody(node);
    const solverRotation = rotation(new Vector3(0, 1, 0), 1.234);
    placeSolverBody(adapter, 1, new Vector3(0.1, 0.2, 0.3), solverRotation);
    node.getComponent(PoseTarget)?.position.set(-5, -5, -5);

    world.step(DT);

    expectBitIdentical(
      vectorComponents(node.transform.position),
      [0.1, 0.2, 0.3],
    );
    expectBitIdentical(
      quaternionComponents(node.transform.rotation),
      quaternionComponents(solverRotation),
    );
  });

  it("0 / 1 writes exactly the target pose", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 0, animationWeight: 3 });
    world.addBody(node);
    const target = node.getComponent(PoseTarget);
    if (target === undefined) {
      throw new Error("the fixture attaches a PoseTarget");
    }
    target.position.set(1 / 3, -0, 1e-8);
    target.rotation.copy(rotation(new Vector3(1, 0, 1).normalize(), 2.3));
    target.scale.set(2, 3, 4);
    placeSolverBody(
      adapter,
      1,
      new Vector3(100, 200, 300),
      rotation(new Vector3(0, 0, 1), 1),
    );

    world.step(DT);

    expectBitIdentical(
      vectorComponents(node.transform.position),
      vectorComponents(target.position),
    );
    expectBitIdentical(
      quaternionComponents(node.transform.rotation),
      quaternionComponents(target.rotation),
    );
    expectBitIdentical(vectorComponents(node.transform.scale), [2, 3, 4]);
  });

  it("1 / 0 writes identity scale — a solver body has none", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 1, animationWeight: 0 });
    node.transform.scale.set(4, 5, 6);
    world.addBody(node);
    node.getComponent(PoseTarget)?.scale.set(2, 2, 2);
    placeSolverBody(adapter, 1, new Vector3(1, 2, 3));

    world.step(DT);

    expectBitIdentical(vectorComponents(node.transform.scale), [1, 1, 1]);
  });

  it("both weights zero falls back to fully physical, still bit-identical", async () => {
    const warn = spyOnWarn();
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 0, animationWeight: 0 });
    world.addBody(node);
    node.getComponent(PoseTarget)?.position.set(-5, -5, -5);
    placeSolverBody(adapter, 1, new Vector3(4, 5, 6));

    world.step(DT);

    expectBitIdentical(vectorComponents(node.transform.position), [4, 5, 6]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("mid-weight blending is §19's lerp/slerp (§19)", () => {
  it("matches a hand-computed lerp and slerp", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 0.35, animationWeight: 0.65 });
    world.addBody(node);
    const target = node.getComponent(PoseTarget);
    if (target === undefined) {
      throw new Error("the fixture attaches a PoseTarget");
    }
    const targetRotation = rotation(new Vector3(0, 1, 0), 1.2);
    const solverRotation = rotation(new Vector3(0, 1, 0), -0.4);
    target.position.set(10, 20, 30);
    target.rotation.copy(targetRotation);
    placeSolverBody(adapter, 1, new Vector3(0, 0, 0), solverRotation);

    world.step(DT);

    // §19: the animation fraction is how far the solver pose moves towards the
    // target. 0.65 / (0.35 + 0.65) = 0.65 exactly, and lerp((0,0,0), p, 0.65)
    // is 0.65 · p — hand-computed, no interpolator involved.
    expect(node.transform.position.x).toBeCloseTo(6.5, 12);
    expect(node.transform.position.y).toBeCloseTo(13, 12);
    expect(node.transform.position.z).toBeCloseTo(19.5, 12);

    // Both rotations are about **+Y**, so the arc between them is the angle
    // difference and slerp is a plain lerp of angles: −0.4 + 0.65 · 1.6 = 0.64
    // radians. That is a rotation this test builds itself, not a second call to
    // the method under test.
    const expected = rotation(new Vector3(0, 1, 0), 0.64);
    const blended = node.transform.rotation;
    expect(blended.x).toBeCloseTo(expected.x, 12);
    expect(blended.y).toBeCloseTo(expected.y, 12);
    expect(blended.z).toBeCloseTo(expected.z, 12);
    expect(blended.w).toBeCloseTo(expected.w, 12);
  });

  it("normalizes weights that do not sum to 1", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 35, animationWeight: 65 });
    world.addBody(node);
    node.getComponent(PoseTarget)?.position.set(10, 0, 0);
    placeSolverBody(adapter, 1, new Vector3(0, 0, 0));

    world.step(DT);

    expect(node.transform.position.x).toBeCloseTo(6.5, 12);
  });

  it("takes the shortest arc between antipodal quaternions (plan D8)", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 0.5, animationWeight: 0.5 });
    world.addBody(node);
    const target = node.getComponent(PoseTarget);
    if (target === undefined) {
      throw new Error("the fixture attaches a PoseTarget");
    }

    // Same rotation, opposite quaternion signs: q and −q. The short way round
    // is "no rotation at all"; the long way is a full turn through the far
    // side, and its midpoint is a quarter turn away from both ends.
    const solverRotation = rotation(new Vector3(0, 0, 1), 0.8);
    const negated = new Quaternion(
      -solverRotation.x,
      -solverRotation.y,
      -solverRotation.z,
      -solverRotation.w,
    );
    target.rotation.copy(negated);
    placeSolverBody(adapter, 1, new Vector3(), solverRotation);

    world.step(DT);

    // The blended rotation is the solver's own rotation (up to sign), not a
    // quarter turn away from it: |dot| is 1.
    const q = node.transform.rotation;
    const dot =
      q.x * solverRotation.x +
      q.y * solverRotation.y +
      q.z * solverRotation.z +
      q.w * solverRotation.w;
    expect(Math.abs(dot)).toBeCloseTo(1, 12);
  });
});

describe("the pre-solve kinematic feed follows the target (§19 steps 1-3)", () => {
  it("feeds a blended kinematic body its PoseTarget, not its transform", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ type: "kinematic-position" });
    world.addBody(node);
    node.transform.position.set(-9, -9, -9);
    node.getComponent(PoseTarget)?.position.set(1, 2, 3);

    world.step(DT);

    const fed = adapter.callsOf("setNextKinematicTransform");
    expect(fed).toHaveLength(1);
    expect(fed[0].args[0]).toEqual(new Vector3(1, 2, 3));
    // The fake teleports a kinematic body to its target, so the solver pose is
    // the target pose and the blend is the target pose whatever the weights.
    expect(vectorComponents(adapter.body(1).position)).toEqual([1, 2, 3]);
  });

  it("feeds the target unweighted, so weights cannot double-apply", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({
      type: "kinematic-position",
      physicsWeight: 0.5,
      animationWeight: 0.5,
    });
    world.addBody(node);
    node.getComponent(PoseTarget)?.position.set(4, 0, 0);

    world.step(DT);

    const fed = adapter.callsOf("setNextKinematicTransform");
    expect(fed[0].args[0]).toEqual(new Vector3(4, 0, 0));
    // Solver pose = target pose, so any blend of the two is the target pose.
    expect(vectorComponents(node.transform.position)).toEqual([4, 0, 0]);
  });

  it("still feeds the transform under every non-blended authority", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({
      type: "kinematic-position",
      authority: "animation",
    });
    world.addBody(node);
    node.transform.position.set(-9, -9, -9);
    node.getComponent(PoseTarget)?.position.set(1, 2, 3);

    world.step(DT);

    const fed = adapter.callsOf("setNextKinematicTransform");
    expect(fed[0].args[0]).toEqual(new Vector3(-9, -9, -9));
  });

  it("leaves a dynamic blended body to the solver", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);

    world.step(DT);

    expect(adapter.callsOf("setNextKinematicTransform")).toHaveLength(0);
  });
});

describe("authority interactions in the publish pass (§42)", () => {
  it("writes a blended node without any authority warning", async () => {
    const warn = spyOnWarn();
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 1, animationWeight: 1 });
    world.addBody(node);
    placeSolverBody(adapter, 1, new Vector3(2, 0, 0));

    world.step(DT);

    expect(node.transform.position.x).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the `physics` publish exactly as it was", async () => {
    const warn = spyOnWarn();
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ authority: "physics", target: false });
    world.addBody(node);
    placeSolverBody(adapter, 1, new Vector3(7, 8, 9));

    world.step(DT);

    expect(vectorComponents(node.transform.position)).toEqual([7, 8, 9]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("still warns and skips for every other authority", async () => {
    const warn = spyOnWarn();
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ authority: "manual", target: false });
    world.addBody(node);
    placeSolverBody(adapter, 1, new Vector3(7, 8, 9));

    world.step(DT);

    expect(vectorComponents(node.transform.position)).toEqual([0, 0, 0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"physics"');
  });

  it("blends every §22 type, not only dynamic bodies", async () => {
    for (const type of ["static", "kinematic-velocity"] as const) {
      const { adapter, world } = await readyWorld();
      const node = bodyNode({ type, physicsWeight: 0, animationWeight: 1 });
      world.addBody(node);
      node.getComponent(PoseTarget)?.position.set(1, 1, 1);
      placeSolverBody(adapter, 1, new Vector3(5, 5, 5));

      world.step(DT);

      expect(vectorComponents(node.transform.position)).toEqual([1, 1, 1]);
    }
  });

  it("follows an authority changed after registration", async () => {
    const warn = spyOnWarn();
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ authority: "physics" });
    world.addBody(node);
    placeSolverBody(adapter, 1, new Vector3(3, 0, 0));

    world.step(DT);
    expect(node.transform.position.x).toBe(3);

    node.transformAuthority = "blended";
    node.getComponent(PoseTarget)?.position.set(-3, 0, 0);
    const body = node.getComponent(RigidBody);
    if (body === undefined) {
      throw new Error("the fixture attaches a RigidBody");
    }
    body.physicsWeight = 0;
    body.animationWeight = 1;

    world.step(DT);
    expect(node.transform.position.x).toBe(-3);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not inherit console.warn spy history from earlier tests in this file", () => {
    // Isolation regression: earlier tests in this file record a §19
    // zero-weight warning and a §42 authority warning. Without the
    // afterEach restore, vitest 4's reused spy still holds those calls
    // and this assertion fails even though this test emits nothing.
    const warn = spyOnWarn();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the PoseTarget capture system (§39, plan P7-4)", () => {
  it("runs one notch before §39 step 3", () => {
    expect(POSE_TARGET_CAPTURE_PRIORITY).toBe(PRIORITY_ANIMATION_TARGETS - 1);
    expect(createPoseTargetCaptureSystem([]).priority).toBe(
      POSE_TARGET_CAPTURE_PRIORITY,
    );
    expect(createPoseTargetCaptureSystem([], { priority: 42 }).priority).toBe(
      42,
    );
  });

  it("captures every registered target once per step, before animation", async () => {
    const { world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const target = node.getComponent(PoseTarget);
    if (target === undefined) {
      throw new Error("the fixture attaches a PoseTarget");
    }

    const order: string[] = [];
    const physics = new PhysicsSystem({ worlds: [world] });
    const registry = new SystemRegistry();

    // A stand-in for §39 step 3: it writes the target, as an animation system
    // does, and records what the history looked like when it ran.
    let historyAtAnimation = 0;
    const animation: SimulationSystem = {
      priority: PRIORITY_ANIMATION_TARGETS,
      initialize: () => undefined,
      fixedUpdate: () => {
        order.push("animation");
        historyAtAnimation = target.previousPosition.y;
        target.position.set(0, target.position.y + 1, 0);
      },
      dispose: () => undefined,
    };
    const capture = createPoseTargetCaptureSystem(physics.worlds);
    const recordedCapture: SimulationSystem = {
      priority: capture.priority,
      initialize: () => undefined,
      fixedUpdate: (context) => {
        order.push("capture");
        capture.fixedUpdate(context);
      },
      dispose: () => undefined,
    };

    registry.register(physics);
    registry.register(animation);
    registry.register(recordedCapture);

    const time = createTimeState({ fixedDeltaTime: DT });
    registry.runFixedStep(time);
    expect(order).toEqual(["capture", "animation"]);
    expect(historyAtAnimation).toBe(0);
    expect(target.position.y).toBe(1);
    expect(target.previousPosition.y).toBe(0);

    registry.runFixedStep(time);
    expect(order).toEqual(["capture", "animation", "capture", "animation"]);
    // One step of history, not two and not zero.
    expect(historyAtAnimation).toBe(1);
    expect(target.position.y).toBe(2);
    expect(target.previousPosition.y).toBe(1);
  });

  it("iterates the live world list it was handed", async () => {
    const { world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const target = node.getComponent(PoseTarget);
    if (target === undefined) {
      throw new Error("the fixture attaches a PoseTarget");
    }
    target.position.set(0, 5, 0);

    const physics = new PhysicsSystem();
    const capture = createPoseTargetCaptureSystem(physics.worlds);
    const context = { time: createTimeState({ fixedDeltaTime: DT }) };

    capture.fixedUpdate(context);
    expect(target.previousPosition.y).toBe(0);

    physics.track(world);
    capture.fixedUpdate(context);
    expect(target.previousPosition.y).toBe(5);
  });

  it("captures targets on bodies of every authority, and skips nodes with none", async () => {
    const { world } = await readyWorld();
    const animated = bodyNode({ authority: "kinematic" });
    const bare = bodyNode({ authority: "physics", target: false });
    world.addBody(animated);
    world.addBody(bare);
    animated.getComponent(PoseTarget)?.position.set(0, 4, 0);

    expect(() => {
      world.capturePoseTargets();
    }).not.toThrow();
    expect(animated.getComponent(PoseTarget)?.previousPosition.y).toBe(4);
  });

  it("is safe before initialize and does nothing on an empty world", () => {
    const world = new PhysicsWorld({
      dimension: "3d",
      adapter: new FakeSolverAdapter(),
    });
    expect(() => {
      world.capturePoseTargets();
    }).not.toThrow();
  });

  it("registers, initializes and disposes without touching the worlds", async () => {
    const { world } = await readyWorld();
    const capture = createPoseTargetCaptureSystem([world]);
    expect(() => {
      capture.initialize({ registry: new SystemRegistry() });
      capture.dispose();
    }).not.toThrow();
    expect(world.disposed).toBe(false);
  });
});

describe("§43 interpolation sees the blended pose (§43)", () => {
  it("tracks a blended node whatever its §22 type", async () => {
    const poses = new PoseBuffer();
    const { world } = await readyWorld({ poses });
    const node = bodyNode({ type: "kinematic-position" });
    world.addBody(node);
    expect(poses.has(node)).toBe(true);
  });

  it("untracks a node that stops being blended", async () => {
    const poses = new PoseBuffer();
    const { world } = await readyWorld({ poses });
    const node = bodyNode({ type: "static" });
    world.addBody(node);
    expect(poses.has(node)).toBe(true);

    node.transformAuthority = "manual";
    world.step(DT);
    expect(poses.has(node)).toBe(false);
  });

  it("interpolates between two blended poses at alpha 0.5", async () => {
    const poses = new PoseBuffer();
    const { adapter, world } = await readyWorld({ poses });
    const node = bodyNode({ physicsWeight: 1, animationWeight: 1 });
    world.addBody(node);
    const target = node.getComponent(PoseTarget);
    if (target === undefined) {
      throw new Error("the fixture attaches a PoseTarget");
    }

    const registry = new SystemRegistry();
    registry.register(new PhysicsSystem({ worlds: [world] }));
    registry.register(createSnapshotSystem(poses));
    const time = createTimeState({ fixedDeltaTime: DT });

    // Step 1: solver at 0, target at 0 → blended 0.
    placeSolverBody(adapter, 1, new Vector3(0, 0, 0));
    registry.runFixedStep(time);
    expect(node.transform.position.x).toBe(0);

    // Step 2: solver at 2, target at 4 → blended 3 (half of each).
    placeSolverBody(adapter, 1, new Vector3(2, 0, 0));
    target.position.set(4, 0, 0);
    registry.runFixedStep(time);
    expect(node.transform.position.x).toBe(3);

    const outPosition = new Vector3();
    const outRotation = new Quaternion();
    expect(poses.computeRenderPose(node, 0.5, outPosition, outRotation)).toBe(
      true,
    );
    // The midpoint of the two *blended* poses, not of the two solver poses.
    expect(outPosition.x).toBe(1.5);
  });
});

describe("§33 is blind to the blend (§33)", () => {
  it("checksums solver state, which the blend configuration cannot move", async () => {
    const solverPosition = new Vector3(1.5, -2.25, 0.125);

    const plain = await readyWorld();
    const plainNode = bodyNode({ authority: "physics", target: false });
    plain.world.addBody(plainNode);
    placeSolverBody(plain.adapter, 1, solverPosition);
    plain.world.step(DT);

    const blended = await readyWorld();
    const blendedNode = bodyNode({ physicsWeight: 1, animationWeight: 4 });
    blended.world.addBody(blendedNode);
    blendedNode.getComponent(PoseTarget)?.position.set(-99, -99, -99);
    placeSolverBody(blended.adapter, 1, solverPosition);
    blended.world.step(DT);

    // The blended node's transform moved a long way from the solver pose …
    expect(blendedNode.transform.position.x).not.toBeCloseTo(
      plainNode.transform.position.x,
      6,
    );
    // … and the checksum did not notice, because §33 hashes the solver.
    expect(blended.world.checksum()).toBe(plain.world.checksum());
  });

  it("is identical across two identical blended runs (§33, §34)", async () => {
    const run = async (): Promise<{ checksum: number; pose: number[] }> => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode({ physicsWeight: 0.25, animationWeight: 0.75 });
      world.addBody(node);
      const target = node.getComponent(PoseTarget);
      if (target === undefined) {
        throw new Error("the fixture attaches a PoseTarget");
      }
      for (let i = 0; i < 10; i += 1) {
        target.capturePrevious();
        target.position.set(i * 0.1, i * 0.2, 0);
        target.rotation.copy(rotation(new Vector3(0, 0, 1), i * 0.05));
        world.step(DT);
      }
      void adapter;
      return {
        checksum: world.checksum(),
        pose: [
          ...vectorComponents(node.transform.position),
          ...quaternionComponents(node.transform.rotation),
        ],
      };
    };

    const first = await run();
    const second = await run();
    expect(second.checksum).toBe(first.checksum);
    expectBitIdentical(second.pose, first.pose);
  });
});

describe("allocation (§7b, plan D7)", () => {
  it("allocates no math objects per blended step", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ physicsWeight: 0.4, animationWeight: 0.6 });
    world.addBody(node);
    const target = node.getComponent(PoseTarget);
    if (target === undefined) {
      throw new Error("the fixture attaches a PoseTarget");
    }
    target.position.set(1, 2, 3);
    placeSolverBody(adapter, 1, new Vector3(4, 5, 6));
    world.step(DT); // warm every lazily-built path

    resetConstructionCount();
    for (let i = 0; i < 5; i += 1) {
      world.capturePoseTargets();
      world.step(DT);
    }
    expect(constructionCount()).toBe(0);
  });
});
