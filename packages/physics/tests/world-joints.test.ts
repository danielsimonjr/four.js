import { isFourError } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import { Group } from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  JointBreakPayload,
  PhysicsDimension,
  PhysicsJointHandle,
} from "../src/index.js";
import {
  Collider,
  FixedJoint,
  HingeJoint,
  NO_TUNING_CAPABILITIES,
  PhysicsWorld,
  RigidBody,
  RopeJoint,
  SliderJoint,
  SphericalJoint,
  SpringJoint,
  resolveTuningCapabilities,
  supportsSolverJointAccess,
} from "../src/index.js";
import { FakeJointSolverAdapter, FakeSolverAdapter } from "./fake-adapter.js";

/**
 * vitest 4 reuses an unrestored `spyOn(console, "warn")` and keeps its call
 * history. The PH-22e motor-cap tests below count warns and used to inherit
 * the first test's `jointMotorEffortCap` line — they passed alone and failed
 * with the file. Restore the spy so each test's count is its own. Worlds
 * created here are not stepped again after their test returns; the extra
 * calls were spy history, not leftover writers.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

/** A node carrying a dynamic body and one collider, under `"physics"` (§42). */
function dynamicNode(dimension: PhysicsDimension = "2d"): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type: "dynamic" }));
  node.addComponent(
    new Collider({
      shape:
        dimension === "2d"
          ? { type: "circle", radius: 0.5 }
          : { type: "sphere", radius: 0.5 },
    }),
  );
  return node;
}

/** A ready 2D world on a joint-capable fake, with two registered bodies. */
async function jointWorld(): Promise<{
  adapter: FakeJointSolverAdapter;
  world: PhysicsWorld;
  nodeA: Group;
  nodeB: Group;
  bodyA: RigidBody;
  bodyB: RigidBody;
}> {
  const adapter = new FakeJointSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", adapter });
  await world.initialize();
  const nodeA = dynamicNode();
  const nodeB = dynamicNode();
  const bodyA = world.addBody(nodeA);
  const bodyB = world.addBody(nodeB);
  return { adapter, world, nodeA, nodeB, bodyA, bodyB };
}

/** Runs `run` and returns the `FourError` it threw. */
function expectFourError(run: () => void): Error & { code: string } {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  return caught as Error & { code: string };
}

describe("the joint seam detection (WP-6.1)", () => {
  it("recognizes an adapter that implements SolverJointAccess", () => {
    expect(supportsSolverJointAccess(new FakeJointSolverAdapter())).toBe(true);
    expect(supportsSolverJointAccess(new FakeSolverAdapter())).toBe(false);
    expect(supportsSolverJointAccess({})).toBe(false);
  });

  it("rejects a half-implemented seam", () => {
    const partial = {
      reportsJointReactions: true,
      getJointReaction: () => undefined,
      setJointLimits: () => undefined,
      setJointMotor: () => undefined,
      getJointId: () => 1,
      // forEachJoint missing
    };
    expect(supportsSolverJointAccess(partial)).toBe(false);
  });

  it("refuses addJoint on a jointless adapter, naming what is missing", async () => {
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const bodyA = world.addBody(dynamicNode());
    const bodyB = world.addBody(dynamicNode());
    expect(world.supportsJoints).toBe(false);

    const error = expectFourError(() => {
      world.addJoint(new FixedJoint({ bodyA, bodyB }));
    });
    expect(error.code).toBe("NOT_IMPLEMENTED");
    expect(error.message).toContain("SolverJointAccess");
    expect(error.message).toContain("reportsJointReactions");
    expect(error.message).toContain("forEachJoint");
  });

  it("reports a capable adapter through world.supportsJoints", async () => {
    const { world } = await jointWorld();
    expect(world.supportsJoints).toBe(true);
    expect(world.jointCount).toBe(0);
    expect([...world.joints]).toEqual([]);
  });
});

describe("PhysicsWorld.addJoint (§28, plan P6-3)", () => {
  it("creates the solver joint and binds its monotonic id", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = new FixedJoint({ bodyA, bodyB });
    expect(world.addJoint(joint)).toBe(joint);

    expect(world.jointCount).toBe(1);
    expect(world.hasJoint(joint)).toBe(true);
    expect(joint.registered).toBe(true);
    expect(joint.id).toBe(1);
    expect(adapter.joints.size).toBe(1);
    expect(adapter.joint(1).descriptor.type).toBe("fixed");
    expect(adapter.callsOf("createJoint")).toHaveLength(1);
  });

  it("iterates joints in registration order (§33)", async () => {
    const { world, bodyA, bodyB } = await jointWorld();
    const first = new FixedJoint({ bodyA, bodyB });
    const second = new HingeJoint({ bodyA, bodyB });
    world.addJoint(first);
    world.addJoint(second);
    expect([...world.joints]).toEqual([first, second]);
    expect([first.id, second.id]).toEqual([1, 2]);
  });

  it("converts world anchors and axes into body-local frames (§28)", async () => {
    const adapter = new FakeJointSolverAdapter();
    const world = new PhysicsWorld({ dimension: "3d", adapter });
    await world.initialize();
    const nodeA = dynamicNode("3d");
    const nodeB = dynamicNode("3d");
    nodeA.transform.position.set(0, 5, 0);
    nodeB.transform.position.set(2, 5, 0);
    // A quarter turn about +Z on body B, so the conversion has work to do.
    nodeB.transform.rotation.setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 2,
    );
    const bodyA = world.addBody(nodeA);
    const bodyB = world.addBody(nodeB);

    const hinge = new HingeJoint({
      bodyA,
      bodyB,
      anchor: new Vector3(1, 5, 0),
      axis: new Vector3(0, 0, 3),
    });
    world.addJoint(hinge);

    const descriptor = adapter.joint(1).descriptor;
    if (descriptor.type !== "revolute") {
      throw new Error("expected a revolute descriptor");
    }
    const anchorA = descriptor.anchorA as Vector3;
    const anchorB = descriptor.anchorB as Vector3;
    const axis = descriptor.axis as Vector3;
    // A: no rotation, so the local anchor is the offset from its position.
    expect([anchorA.x, anchorA.y, anchorA.z]).toEqual([1, 0, 0]);
    // B: the anchor is one unit -X of it in world space, which its own frame
    // sees as +Y after the quarter turn.
    expect(anchorB.x).toBeCloseTo(0, 12);
    expect(anchorB.y).toBeCloseTo(1, 12);
    // The axis is normalized and unchanged by a rotation about itself.
    expect([axis.x, axis.y, axis.z]).toEqual([0, 0, 1]);
    // PH-22f: the converted locals are written back onto the joint so later
    // reads and setAnchors share one space.
    expect(hinge.anchorsAreLocal).toBe(true);
    expect([hinge.anchorA?.x, hinge.anchorA?.y, hinge.anchorA?.z]).toEqual([
      1, 0, 0,
    ]);
    expect(hinge.anchorB?.x).toBeCloseTo(0, 12);
    expect(hinge.anchorB?.y).toBeCloseTo(1, 12);
  });

  it("uses setAnchors locals as-is at addJoint, without re-measuring (PH-22f)", async () => {
    const { adapter, world } = await jointWorld();
    const nodeA = dynamicNode();
    const nodeB = dynamicNode();
    nodeA.transform.position.set(5, 0, 0);
    nodeB.transform.position.set(8, 0, 0);
    const bodyA = world.addBody(nodeA);
    const bodyB = world.addBody(nodeB);
    const joint = new FixedJoint({
      bodyA,
      bodyB,
      anchor: new Vector3(5, 0, 0),
    });
    // Body-local on purpose: if addJoint still converted these as world-space
    // against the current poses, bodyA's local would become (1−5, 0) = (−4, 0).
    joint.setAnchors(new Vector3(1, 0, 0), new Vector3(0, 0, 0));
    world.addJoint(joint);
    const descriptor = adapter.joint(1).descriptor;
    expect([
      (descriptor.anchorA as Vector3).x,
      (descriptor.anchorA as Vector3).y,
      (descriptor.anchorA as Vector3).z,
    ]).toEqual([1, 0, 0]);
    expect([
      (descriptor.anchorB as Vector3).x,
      (descriptor.anchorB as Vector3).y,
      (descriptor.anchorB as Vector3).z,
    ]).toEqual([0, 0, 0]);
  });

  it("keeps each joint's anchors to itself", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    world.addJoint(
      new FixedJoint({ bodyA, bodyB, anchor: new Vector3(1, 0, 0) }),
    );
    world.addJoint(
      new FixedJoint({ bodyA, bodyB, anchor: new Vector3(2, 0, 0) }),
    );
    expect((adapter.joint(1).descriptor.anchorA as Vector3).x).toBe(1);
    expect((adapter.joint(2).descriptor.anchorA as Vector3).x).toBe(2);
  });

  it("defaults a 2d hinge axis to +Z and leaves anchors at the origin", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    world.addJoint(new HingeJoint({ bodyA, bodyB }));
    const descriptor = adapter.joint(1).descriptor;
    if (descriptor.type !== "revolute") {
      throw new Error("expected a revolute descriptor");
    }
    expect([...vector(descriptor.axis as Vector3)]).toEqual([0, 0, 1]);
    expect([...vector(descriptor.anchorA as Vector3)]).toEqual([0, 0, 0]);
  });

  it("rejects a joint whose bodies are not registered here (§28)", async () => {
    const { world, bodyA } = await jointWorld();
    const stranger = new RigidBody({ type: "dynamic" });
    expect(
      expectFourError(() => {
        world.addJoint(new FixedJoint({ bodyA, bodyB: stranger }));
      }).message,
    ).toContain("bodyB is not registered");
    expect(
      expectFourError(() => {
        world.addJoint(new FixedJoint({ bodyA: stranger, bodyB: bodyA }));
      }).message,
    ).toContain("bodyA is not registered");
  });

  it("rejects a joint that is already registered", async () => {
    const { world, bodyA, bodyB } = await jointWorld();
    const joint = new FixedJoint({ bodyA, bodyB });
    world.addJoint(joint);
    expect(
      expectFourError(() => {
        world.addJoint(joint);
      }).message,
    ).toContain("already registered");
  });

  it("validates the descriptor against the world's dimension (§21)", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    expect(
      expectFourError(() => {
        world.addJoint(new SphericalJoint({ bodyA, bodyB }));
      }).message,
    ).toContain('not valid in a "2d" world');
    expect(
      expectFourError(() => {
        world.addJoint(
          new SliderJoint({ bodyA, bodyB, axis: new Vector3(0, 0, 1) }),
        );
      }).message,
    ).toContain("z = 0");
    // Nothing reached the solver: a rejected registration builds nothing (§85).
    expect(adapter.joints.size).toBe(0);
    expect(world.jointCount).toBe(0);
  });

  it("rejects a hinge with no axis in a 3d world (§28)", async () => {
    const adapter = new FakeJointSolverAdapter();
    const world = new PhysicsWorld({ dimension: "3d", adapter });
    await world.initialize();
    const bodyA = world.addBody(dynamicNode("3d"));
    const bodyB = world.addBody(dynamicNode("3d"));
    expect(
      expectFourError(() => {
        world.addJoint(new HingeJoint({ bodyA, bodyB }));
      }).message,
    ).toContain("non-zero direction");
  });

  it("refuses a breakable joint on an adapter that reports no reactions (P6-2)", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    adapter.reportsJointReactions = false;
    const error = expectFourError(() => {
      world.addJoint(new FixedJoint({ bodyA, bodyB, breakForce: 10 }));
    });
    expect(error.code).toBe("NOT_IMPLEMENTED");
    expect(error.message).toContain("never be enforced");
    // A joint with no thresholds is still perfectly registerable.
    expect(() =>
      world.addJoint(new FixedJoint({ bodyA, bodyB })),
    ).not.toThrow();
  });

  it("needs an initialized world", () => {
    const adapter = new FakeJointSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    const bodyA = new RigidBody({ type: "dynamic" });
    const bodyB = new RigidBody({ type: "dynamic" });
    expect(
      expectFourError(() => {
        world.addJoint(new FixedJoint({ bodyA, bodyB }));
      }).message,
    ).toContain("has not been initialized");
  });
});

describe("PhysicsWorld.removeJoint and disposal (§28, §83)", () => {
  it("destroys the solver joint and unbinds the object", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    expect(world.removeJoint(joint)).toBe(true);
    expect(world.removeJoint(joint)).toBe(false);
    expect(world.jointCount).toBe(0);
    expect(world.hasJoint(joint)).toBe(false);
    expect(joint.registered).toBe(false);
    expect(joint.broken).toBe(false);
    expect(adapter.joints.size).toBe(0);
    expect(adapter.callsOf("destroyJoint")).toHaveLength(1);
    // Removal is not breakage: the same joint can be registered again.
    expect(() => world.addJoint(joint)).not.toThrow();
  });

  it("destroys a body's joints before the body itself (§83)", async () => {
    const { adapter, world, nodeA, bodyA, bodyB } = await jointWorld();
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    world.addJoint(new HingeJoint({ bodyA: bodyB, bodyB: bodyA }));
    adapter.clearCalls();

    expect(world.removeBody(nodeA)).toBe(true);
    expect(world.jointCount).toBe(0);
    const order = adapter.callOrder;
    expect(order.filter((m) => m === "destroyJoint")).toHaveLength(2);
    expect(order.indexOf("destroyJoint")).toBeLessThan(
      order.indexOf("destroyBody"),
    );
    // Joints on other bodies would survive; here there were none left.
    expect(adapter.joints.size).toBe(0);
  });

  it("leaves joints between other bodies alone when one body goes", async () => {
    const { world, nodeA, bodyA, bodyB } = await jointWorld();
    const nodeC = dynamicNode();
    const bodyC = world.addBody(nodeC);
    const kept = world.addJoint(new FixedJoint({ bodyA: bodyB, bodyB: bodyC }));
    world.addJoint(new FixedJoint({ bodyA, bodyB: bodyC }));

    world.removeBody(nodeA);
    expect([...world.joints]).toEqual([kept]);
  });

  it("disposes joints before bodies and clears the registry (§83)", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    adapter.clearCalls();

    world.dispose();
    const order = adapter.callOrder;
    expect(order.indexOf("destroyJoint")).toBeLessThan(
      order.indexOf("destroyBody"),
    );
    expect(order.indexOf("destroyBody")).toBeLessThan(order.indexOf("dispose"));
    expect(world.jointCount).toBe(0);
    expect(joint.registered).toBe(false);
    expect(joint.broken).toBe(false);
  });
});

describe("joint reconfiguration in the fixed step (§28)", () => {
  it("pushes queued limits and motors once, before the solve", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const hinge = world.addJoint(
      new HingeJoint({
        bodyA,
        bodyB,
        limits: { min: -1, max: 1 },
        motor: { targetVelocity: 1, maxTorque: 2 },
      }),
    ) as HingeJoint;
    // Registration clears the queue: the descriptor already carried both.
    expect(hinge.commands).toEqual({
      limitsDirty: false,
      motorDirty: false,
      collisionDirty: false,
      anchorsDirty: false,
    });
    world.step(1 / 60);
    expect(adapter.callsOf("setJointLimits")).toHaveLength(0);
    expect(adapter.callsOf("setJointMotor")).toHaveLength(0);

    hinge.setLimits(-2, 2);
    hinge.setMotor({ targetVelocity: 5, maxTorque: 9 });
    adapter.clearCalls();
    world.step(1 / 60);

    const order = adapter.callOrder;
    expect(order.indexOf("setJointLimits")).toBeLessThan(
      order.indexOf("syncSceneToSolver"),
    );
    expect(adapter.joint(1).limits).toEqual({ min: -2, max: 2 });
    expect(adapter.joint(1).motor).toEqual({
      enabled: true,
      targetVelocity: 5,
      maxEffort: 9,
    });
    expect(hinge.commands).toEqual({
      limitsDirty: false,
      motorDirty: false,
      collisionDirty: false,
      anchorsDirty: false,
    });

    // Nothing queued, nothing pushed.
    adapter.clearCalls();
    world.step(1 / 60);
    expect(adapter.callsOf("setJointLimits")).toHaveLength(0);
  });

  it("maps a slider's maxForce onto the seam's maxEffort", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const slider = world.addJoint(
      new SliderJoint({
        bodyA,
        bodyB,
        axis: new Vector3(1, 0, 0),
        motor: { targetVelocity: 1, maxForce: 30 },
      }),
    ) as SliderJoint;
    slider.enableMotor(false);
    world.step(1 / 60);
    expect(adapter.joint(1).motor).toEqual({
      enabled: false,
      targetVelocity: 1,
      maxEffort: 30,
    });
  });

  it("pushes nothing for a hinge whose limits and motor were never authored", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const hinge = world.addJoint(
      new HingeJoint({ bodyA, bodyB }),
    ) as HingeJoint;
    // Neither can be *added* to a registered joint, so a dirty flag with no
    // record behind it is only reachable defensively — and must push nothing.
    (hinge.commands as { limitsDirty: boolean }).limitsDirty = true;
    (hinge.commands as { motorDirty: boolean }).motorDirty = true;
    world.step(1 / 60);
    expect(adapter.callsOf("setJointLimits")).toHaveLength(0);
    expect(adapter.callsOf("setJointMotor")).toHaveLength(0);
  });

  it("pushes nothing for a slider whose limits and motor were never authored", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const slider = world.addJoint(
      new SliderJoint({ bodyA, bodyB, axis: new Vector3(1, 0, 0) }),
    ) as SliderJoint;
    (slider.commands as { motorDirty: boolean }).motorDirty = true;
    world.step(1 / 60);
    expect(adapter.callsOf("setJointMotor")).toHaveLength(0);
  });

  it("pushes nothing for a joint type with neither limits nor a motor", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    // A fixed joint has no setters; force the queue to prove the world copes.
    (joint.commands as { limitsDirty: boolean }).limitsDirty = true;
    (joint.commands as { motorDirty: boolean }).motorDirty = true;
    world.step(1 / 60);
    expect(adapter.callsOf("setJointLimits")).toHaveLength(0);
    expect(adapter.callsOf("setJointMotor")).toHaveLength(0);
    expect(joint.commands).toEqual({
      limitsDirty: false,
      motorDirty: false,
      collisionDirty: false,
      anchorsDirty: false,
    });
  });
});

describe("break monitoring (§28, plan P6-2)", () => {
  const DELTA = 0.02;

  /** A registered breakable fixed joint, with its scripted reaction at zero. */
  async function breakable(options: {
    breakForce?: number;
    breakTorque?: number;
  }): Promise<{
    adapter: FakeJointSolverAdapter;
    world: PhysicsWorld;
    joint: FixedJoint;
  }> {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(
      new FixedJoint({ bodyA, bodyB, ...options }),
    ) as FixedJoint;
    return { adapter, world, joint };
  }

  it("does not break a joint at exactly its threshold", async () => {
    const { adapter, world, joint } = await breakable({ breakForce: 100 });
    // |impulse| / delta === 100 exactly.
    adapter.scriptJointReaction(
      1,
      new Vector3(100 * DELTA, 0, 0),
      new Vector3(),
    );
    world.step(DELTA);
    expect(joint.broken).toBe(false);
    expect(world.jointCount).toBe(1);
    expect(world.queuedEvents).toHaveLength(0);
  });

  it("breaks exactly once past the threshold and reports the payload", async () => {
    const { adapter, world, joint } = await breakable({ breakForce: 100 });
    adapter.scriptJointReaction(
      1,
      new Vector3(0, 101 * DELTA, 0),
      new Vector3(0, 0, 7 * DELTA),
    );
    const seen: JointBreakPayload[] = [];
    joint.on("jointbreak", (event) => {
      seen.push(event);
    });

    world.step(DELTA);
    expect(world.queuedEvents).toHaveLength(1);
    world.dispatchEvents();

    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("jointbreak");
    expect(seen[0].joint).toBe(joint);
    expect(seen[0].force).toBeCloseTo(101, 9);
    expect(seen[0].torque).toBeCloseTo(7, 9);

    expect(joint.broken).toBe(true);
    expect(joint.registered).toBe(false);
    expect(world.jointCount).toBe(0);
    expect(adapter.joints.size).toBe(0);
    expect(adapter.callsOf("destroyJoint")).toHaveLength(1);

    // Gone means gone: a second step neither re-reads nor re-emits it.
    adapter.clearCalls();
    world.step(DELTA);
    expect(adapter.callsOf("getJointReaction")).toHaveLength(0);
    expect(seen).toHaveLength(1);
  });

  it("breaks on torque alone", async () => {
    const { adapter, world, joint } = await breakable({ breakTorque: 2 });
    adapter.scriptJointReaction(1, new Vector3(), new Vector3(3 * DELTA, 0, 0));
    world.step(DELTA);
    expect(joint.broken).toBe(true);
    expect(world.queuedEvents[0].type).toBe("jointbreak");
  });

  it("refuses to re-register a broken joint", async () => {
    const { adapter, world, joint } = await breakable({ breakForce: 1 });
    adapter.scriptJointReaction(1, new Vector3(10, 0, 0), new Vector3());
    world.step(DELTA);
    expect(
      expectFourError(() => {
        world.addJoint(joint);
      }).message,
    ).toContain("broke under load");
  });

  it("never reads a reaction for a joint with no thresholds", async () => {
    const { adapter, world } = await breakable({});
    world.step(DELTA);
    expect(adapter.callsOf("getJointReaction")).toHaveLength(0);
  });

  it("skips monitoring when the adapter reports no reactions", async () => {
    const { adapter, world, joint } = await breakable({ breakForce: 1 });
    adapter.reportsJointReactions = false;
    adapter.scriptJointReaction(1, new Vector3(1000, 0, 0), new Vector3());
    world.step(DELTA);
    expect(joint.broken).toBe(false);
  });

  it("treats a zero-length step as carrying no load", async () => {
    const { adapter, world, joint } = await breakable({ breakForce: 1 });
    adapter.scriptJointReaction(1, new Vector3(1000, 0, 0), new Vector3());
    world.step(0);
    expect(joint.broken).toBe(false);
  });

  it("breaks several joints in one step, in registration order", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const first = world.addJoint(
      new FixedJoint({ bodyA, bodyB, breakForce: 1 }),
    );
    const survivor = world.addJoint(
      new FixedJoint({ bodyA, bodyB, breakForce: 1000 }),
    );
    const third = world.addJoint(
      new FixedJoint({ bodyA, bodyB, breakForce: 1 }),
    );
    for (const id of [1, 2, 3]) {
      adapter.scriptJointReaction(id, new Vector3(0, 1, 0), new Vector3());
    }

    world.step(DELTA);
    expect(world.queuedEvents.map((event) => event.type)).toEqual([
      "jointbreak",
      "jointbreak",
    ]);
    expect(first.broken).toBe(true);
    expect(third.broken).toBe(true);
    expect(survivor.broken).toBe(false);
    expect([...world.joints]).toEqual([survivor]);
  });

  it("queues the break after the step's own events (§39 step 9)", async () => {
    const { adapter, world, joint } = await breakable({ breakForce: 1 });
    const body = adapter.body(1);
    adapter.scriptEvents({ type: "sleep", body: body.handle });
    adapter.scriptJointReaction(1, new Vector3(0, 100, 0), new Vector3());

    world.step(DELTA);
    expect(world.queuedEvents.map((event) => event.type)).toEqual([
      "sleep",
      "jointbreak",
    ]);
    expect(joint.broken).toBe(true);
  });

  it("leaves the §33 checksum untouched by the joint's presence", async () => {
    const adapter = new FakeJointSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const bodyA = world.addBody(dynamicNode());
    const bodyB = world.addBody(dynamicNode());
    world.step(DELTA);
    const withoutJoint = world.checksum();

    const other = new FakeJointSolverAdapter();
    const jointed = new PhysicsWorld({ dimension: "2d", adapter: other });
    await jointed.initialize();
    const a = jointed.addBody(dynamicNode());
    const b = jointed.addBody(dynamicNode());
    jointed.addJoint(new FixedJoint({ bodyA: a, bodyB: b }));
    jointed.step(DELTA);

    expect(jointed.checksum()).toBe(withoutJoint);
    expect([bodyA, bodyB, a, b].every((body) => body.sleeping)).toBe(false);
  });
});

describe("an adapter-reported jointbreak (§37, plan P6-2)", () => {
  it("retires the registration without destroying it twice", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    const handle = adapter.joint(1).handle;
    adapter.scriptEvents({
      type: "jointbreak",
      joint: handle,
      force: 12,
      torque: 3,
    });
    const seen: JointBreakPayload[] = [];
    joint.on("jointbreak", (event) => {
      seen.push(event);
    });

    world.step(1 / 60);
    world.dispatchEvents();

    expect(seen).toHaveLength(1);
    expect(seen[0].force).toBe(12);
    expect(joint.broken).toBe(true);
    expect(world.jointCount).toBe(0);
    // The adapter already removed it, so the world does not call destroyJoint.
    expect(adapter.callsOf("destroyJoint")).toHaveLength(0);
  });

  it("drops a break naming a joint this world does not hold", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    adapter.scriptEvents({
      type: "jointbreak",
      joint: { id: 99 } as unknown as PhysicsJointHandle,
      force: 1,
      torque: 1,
    });
    // The fake rejects a foreign handle, exactly as §37 asks an adapter to.
    expect(() => {
      world.step(1 / 60);
    }).toThrow();
  });

  it("drops a break naming a joint the adapter has but the world does not", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    // A second joint created behind the world's back: alive in the solver,
    // unknown to the registry, so its break has no component to name.
    const stray = adapter.createJoint({
      type: "fixed",
      bodyA: adapter.body(1).handle,
      bodyB: adapter.body(2).handle,
    });
    adapter.scriptEvents({
      type: "jointbreak",
      joint: stray,
      force: 1,
      torque: 1,
    });
    world.step(1 / 60);
    expect(world.queuedEvents).toHaveLength(0);
    expect(world.jointCount).toBe(1);
  });

  it("drops a break on a world that holds no joints at all", async () => {
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    world.addBody(dynamicNode());
    adapter.scriptEvents({
      type: "jointbreak",
      joint: { id: 1 } as unknown as PhysicsJointHandle,
      force: 1,
      torque: 1,
    });
    world.step(1 / 60);
    expect(world.queuedEvents).toHaveLength(0);
  });
});

describe("the fake joint adapter itself (WP-6.1)", () => {
  it("mints monotonic ids and iterates in creation order (§33)", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    const seen: number[] = [];
    adapter.forEachJoint((handle, id) => {
      expect(adapter.getJointId(handle)).toBe(id);
      seen.push(id);
    });
    expect(seen).toEqual([1, 2]);
  });

  it("rejects a destroyed or foreign handle, and a joint on a dead body", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    const handle = adapter.joint(1).handle;
    world.removeJoint(joint);
    expect(() => adapter.getJointId(handle)).toThrow();
    expect(() => adapter.joint(1)).toThrow();
    expect(() =>
      adapter.createJoint({
        type: "fixed",
        bodyA: { id: 42 } as unknown as never,
        bodyB: { id: 43 } as unknown as never,
      }),
    ).toThrow();
  });

  it("still refuses joints on the plain FakeSolverAdapter (Phase 5)", () => {
    const adapter = new FakeSolverAdapter();
    expect(() =>
      adapter.createJoint({
        type: "fixed",
        bodyA: {} as unknown as never,
        bodyB: {} as unknown as never,
      }),
    ).toThrow();
    expect(() =>
      adapter.destroyJoint({} as unknown as PhysicsJointHandle),
    ).toThrow();
  });

  it("drops a joint's listeners on dispose (§83)", async () => {
    const { world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    let fired = 0;
    joint.on("jointbreak", () => {
      fired += 1;
    });
    joint.dispose();
    joint.emit("jointbreak", {
      type: "jointbreak",
      joint,
      force: 0,
      torque: 0,
    });
    expect(fired).toBe(0);
  });

  it("clears its joints on dispose", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    adapter.dispose();
    expect(adapter.joints.size).toBe(0);
    expect(adapter.disposed).toBe(true);
  });

  it("reads back a joint's scripted reaction through the seam", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    adapter.scriptJointReaction(1, new Vector3(1, 2, 3), new Vector3(4, 5, 6));
    const linear = new Vector3();
    const angular = new Vector3();
    adapter.getJointReaction(adapter.joint(1).handle, linear, angular);
    expect([...vector(linear)]).toEqual([1, 2, 3]);
    expect([...vector(angular)]).toEqual([4, 5, 6]);
  });
});

describe("live collisionEnabled (§28, PH-22f)", () => {
  it("pushes a queued change once, in the scene→solver phase", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    // Registration clears the queue: the descriptor already carried the value.
    expect(adapter.joint(1).collisionEnabled).toBe(false);
    world.step(1 / 60);
    expect(adapter.callsOf("setJointCollisionEnabled")).toHaveLength(0);

    joint.collisionEnabled = true;
    adapter.clearCalls();
    world.step(1 / 60);

    expect(adapter.callsOf("setJointCollisionEnabled")).toHaveLength(1);
    expect(adapter.joint(1).collisionEnabled).toBe(true);
    const order = adapter.callOrder;
    expect(order.indexOf("setJointCollisionEnabled")).toBeLessThan(
      order.indexOf("syncSceneToSolver"),
    );
    expect(joint.commands.collisionDirty).toBe(false);

    // Nothing queued, nothing pushed.
    adapter.clearCalls();
    world.step(1 / 60);
    expect(adapter.callsOf("setJointCollisionEnabled")).toHaveLength(0);
  });

  it("works for every §28 type, unlike limits and motors", async () => {
    // The point of the closure: `setContactsEnabled` is on Rapier's base
    // joint class, so a fixed or rope joint — neither of which can be
    // re-limited or motored — can still be re-collided.
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const fixed = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    const rope = world.addJoint(new RopeJoint({ bodyA, bodyB, maxLength: 2 }));
    adapter.clearCalls();

    fixed.collisionEnabled = true;
    rope.collisionEnabled = true;
    world.step(1 / 60);

    expect(adapter.callsOf("setJointCollisionEnabled")).toHaveLength(2);
    expect(adapter.joint(1).collisionEnabled).toBe(true);
    expect(adapter.joint(2).collisionEnabled).toBe(true);
  });

  it("drains joints in ascending registration order (§33)", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const first = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    const second = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    adapter.clearCalls();

    // Queued in the reverse of registration order; drained in registration
    // order regardless.
    second.collisionEnabled = true;
    first.collisionEnabled = true;
    world.step(1 / 60);

    expect(
      adapter.callsOf("setJointCollisionEnabled").map((call) => call.id),
    ).toEqual([1, 2]);
  });

  it("leaves the properties with no live setter frozen at compile time", async () => {
    const { world, bodyA, bodyB } = await jointWorld();
    const rope = world.addJoint(new RopeJoint({ bodyA, bodyB, maxLength: 2 }));
    const hinge = world.addJoint(
      new HingeJoint({ bodyA, bodyB, axis: new Vector3(0, 0, 1) }),
    ) as HingeJoint;
    const spring = world.addJoint(
      new SpringJoint({
        bodyA,
        bodyB,
        restLength: 1,
        stiffness: 10,
      }),
    );

    // Axis / rope / spring / cone stay frozen: they are `readonly` fields, so
    // writing one cannot compile. Anchors are live (PH-22f) and are not in
    // this list.
    // @ts-expect-error - `maxLength` is readonly (§28; see the module header).
    rope.maxLength = 5;
    // @ts-expect-error - `axis` is readonly.
    hinge.axis = new Vector3(0, 1, 0);
    // @ts-expect-error - `restLength` is readonly.
    spring.restLength = 2;
    // @ts-expect-error - `stiffness` is readonly.
    spring.stiffness = 4;

    expect(world.hasJoint(rope)).toBe(true);
  });
});

describe("live anchors (§28, PH-22f)", () => {
  it("pushes a queued setAnchors once, in the scene→solver phase", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const joint = world.addJoint(
      new FixedJoint({ bodyA, bodyB, anchor: new Vector3(1, 0, 0) }),
    );
    world.step(1 / 60);
    expect(adapter.callsOf("setJointAnchors")).toHaveLength(0);

    joint.setAnchors(new Vector3(0.5, 0, 0), new Vector3(0, 0.25, 0));
    adapter.clearCalls();
    world.step(1 / 60);

    expect(adapter.callsOf("setJointAnchors")).toHaveLength(1);
    expect(adapter.joint(1).anchors).toEqual({
      anchorA: new Vector3(0.5, 0, 0),
      anchorB: new Vector3(0, 0.25, 0),
    });
    const order = adapter.callOrder;
    expect(order.indexOf("setJointAnchors")).toBeLessThan(
      order.indexOf("syncSceneToSolver"),
    );
    expect(joint.commands.anchorsDirty).toBe(false);

    adapter.clearCalls();
    world.step(1 / 60);
    expect(adapter.callsOf("setJointAnchors")).toHaveLength(0);
  });

  it("works for every §28 type, like collisionEnabled", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const fixed = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    const rope = world.addJoint(new RopeJoint({ bodyA, bodyB, maxLength: 2 }));
    adapter.clearCalls();

    fixed.setAnchors(new Vector3(1, 0, 0), new Vector3(0, 0, 0));
    rope.setAnchors(new Vector3(0, 1, 0), new Vector3(0, 0, 0));
    world.step(1 / 60);

    expect(adapter.callsOf("setJointAnchors")).toHaveLength(2);
    expect(adapter.joint(1).anchors?.anchorA.x).toBe(1);
    expect(adapter.joint(2).anchors?.anchorA.y).toBe(1);
  });

  it("drains joints in ascending registration order (§33)", async () => {
    const { adapter, world, bodyA, bodyB } = await jointWorld();
    const first = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    const second = world.addJoint(new FixedJoint({ bodyA, bodyB }));
    adapter.clearCalls();

    second.setAnchors(new Vector3(2, 0, 0), undefined);
    first.setAnchors(new Vector3(1, 0, 0), undefined);
    world.step(1 / 60);

    expect(adapter.callsOf("setJointAnchors").map((call) => call.id)).toEqual([
      1, 2,
    ]);
  });
});

describe("§28 motor effort limits are declared, not assumed (PH-22e)", () => {
  /** A joint-capable world whose adapter declares the named tuning record. */
  async function motorWorld(jointMotorEffortCap: boolean): Promise<{
    world: PhysicsWorld;
    bodyA: RigidBody;
    bodyB: RigidBody;
  }> {
    const adapter = new FakeJointSolverAdapter({
      capabilities: {
        tuning: {
          rollingFriction: false,
          spinningFriction: false,
          sleepThresholds: false,
          jointMotorEffortCap,
        },
      },
    });
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const bodyA = world.addBody(dynamicNode());
    const bodyB = world.addBody(dynamicNode());
    return { world, bodyA, bodyB };
  }

  it("reads an undeclared tuning record as 'not a cap'", () => {
    // The all-false reading is the one that warns, per the same rule the other
    // three fields follow: an adapter that has not answered has given no
    // evidence it caps anything.
    expect(NO_TUNING_CAPABILITIES.jointMotorEffortCap).toBe(false);
    expect(
      resolveTuningCapabilities(new FakeJointSolverAdapter().capabilities)
        .jointMotorEffortCap,
    ).toBe(false);
  });

  it("warns once when a motored joint meets an adapter with no cap", async () => {
    const { world, bodyA, bodyB } = await motorWorld(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    world.addJoint(
      new HingeJoint({
        bodyA,
        bodyB,
        axis: new Vector3(0, 0, 1),
        motor: { targetVelocity: 2, maxTorque: 50 },
      }),
    );
    world.addJoint(
      new SliderJoint({
        bodyA,
        bodyB,
        axis: new Vector3(1, 0, 0),
        motor: { targetVelocity: 1, maxForce: 30 },
      }),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("strength gain");
    expect(warn.mock.calls[0]?.[0]).toContain("jointMotorEffortCap");
  });

  it("stays silent for a disabled motor and for a motorless joint", async () => {
    const { world, bodyA, bodyB } = await motorWorld(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    world.addJoint(
      new HingeJoint({
        bodyA,
        bodyB,
        axis: new Vector3(0, 0, 1),
        motor: { enabled: false, targetVelocity: 2, maxTorque: 50 },
      }),
    );

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the adapter declares a real cap", async () => {
    const { world, bodyA, bodyB } = await motorWorld(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    world.addJoint(
      new HingeJoint({
        bodyA,
        bodyB,
        axis: new Vector3(0, 0, 1),
        motor: { targetVelocity: 2, maxTorque: 50 },
      }),
    );

    expect(warn).not.toHaveBeenCalled();
  });

  it("also warns for a motor switched on after registration", async () => {
    const { world, bodyA, bodyB } = await motorWorld(false);
    // Registered disabled — silent, per the test above — then enabled through
    // §28's queued reconfiguration, which is exactly as misleading.
    const joint = world.addJoint(
      new HingeJoint({
        bodyA,
        bodyB,
        axis: new Vector3(0, 0, 1),
        motor: { enabled: false, targetVelocity: 3, maxTorque: 12 },
      }),
    ) as HingeJoint;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    joint.setMotor({ enabled: true, targetVelocity: 3, maxTorque: 12 });
    world.step(1 / 60);
    // …and a second queued change stays quiet: one line per world.
    joint.setMotor({ enabled: true, targetVelocity: 4, maxTorque: 12 });
    world.step(1 / 60);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("strength gain");
  });

  it("does not inherit console.warn spy history from earlier tests in this file", () => {
    // Isolation regression: the first PH-22e test records a
    // jointMotorEffortCap warning. Without the afterEach restore, vitest 4's
    // reused spy still holds that call and this assertion fails even though
    // this test emits nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("joint poses and the §42 authority are untouched", () => {
  it("keeps publishing solved poses with a joint registered", async () => {
    const { adapter, world, nodeA, bodyA, bodyB } = await jointWorld();
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    adapter.body(1).position.set(3, 4, 0);
    adapter.body(1).rotation.copy(new Quaternion());
    world.step(1 / 60);
    // The toy integrator moved it under gravity; the world published whatever
    // the solver held, which is all §42 asks of it.
    expect(nodeA.transform.position.x).toBe(3);
  });
});

/** The three components of a vector, for an exact tuple comparison. */
function vector(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}
