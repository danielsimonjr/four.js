/**
 * PH-1 stage 2 — §37's post-registration **property changes** actually reach a
 * solver (§23, §24, §25, §31, §33, §37).
 *
 * Stage 1 documented which `RigidBody` writes stopped at the component and made
 * each of them warn once. This suite is the other half: the widened seam
 * (`SolverBodyTuningAccess`), the dirty set `PhysicsWorld` drains at the top of
 * every step, `refreshCollider`, and `teleport`. Three properties are asserted
 * throughout, because they are what the closure had to preserve:
 *
 * 1. **A quiet world makes no extra call.** A body nobody wrote to must produce
 *    exactly the solver-call sequence it produced before this existed — that is
 *    what kept every §33 golden bit-identical.
 * 2. **The drain order is deterministic.** Ascending body id, and ascending
 *    collider id within a body, which is `forEachBody`'s order and §33's.
 * 3. **An adapter without the seam still warns.** Capability differences are
 *    declared and visible, never papered over (the `PhysicsTuningCapabilities`
 *    rule, applied to a seam).
 */

import { Matrix3, Vector3 } from "@four/math";
import { Group } from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Collider,
  PhysicsMaterial,
  PhysicsWorld,
  RigidBody,
} from "../src/index.js";
import {
  missingSolverBodyTuning,
  supportsSolverBodyTuning,
} from "../src/index.js";
import { FakeSolverAdapter, FakeTuningSolverAdapter } from "./fake-adapter.js";

/** A node carrying a dynamic body and one circle collider, under `"physics"`. */
function dynamicNode(
  options: { mass?: number; density?: number; friction?: number } = {},
): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.addComponent(
    new RigidBody(
      options.mass === undefined
        ? { type: "dynamic" }
        : { type: "dynamic", mass: options.mass },
    ),
  );
  node.addComponent(
    new Collider({
      shape: { type: "circle", radius: 0.5 },
      ...(options.density === undefined ? {} : { density: options.density }),
      ...(options.friction === undefined ? {} : { friction: options.friction }),
    }),
  );
  return node;
}

/** A ready 2D world on a tuning-capable fake. */
async function tuningWorld(): Promise<{
  adapter: FakeTuningSolverAdapter;
  world: PhysicsWorld;
}> {
  const adapter = new FakeTuningSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", adapter });
  await world.initialize();
  return { adapter, world };
}

/** A ready 2D world on the plain fake, which implements no tuning seam. */
async function plainWorld(): Promise<{
  adapter: FakeSolverAdapter;
  world: PhysicsWorld;
}> {
  const adapter = new FakeSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", adapter });
  await world.initialize();
  return { adapter, world };
}

/** Every tuning call the adapter received, as `method` names in order. */
function tuningCallOrder(adapter: FakeSolverAdapter): string[] {
  return adapter.calls
    .filter(
      (call) =>
        call.method.startsWith("setBody") ||
        call.method.startsWith("setCollider"),
    )
    .map((call) => `${call.method}#${String(call.id)}`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("supportsSolverBodyTuning (§37, PH-1 stage 2)", () => {
  it("answers false for an adapter that implements none of the six", () => {
    expect(supportsSolverBodyTuning(new FakeSolverAdapter())).toBe(false);
    expect(missingSolverBodyTuning(new FakeSolverAdapter())).toEqual([
      "setBodyMassProperties",
      "setBodyDamping",
      "setBodyGravityScale",
      "setBodyCcdMode",
      "setColliderMaterial",
      "setColliderFilter",
    ]);
  });

  it("answers true only when all six are present", () => {
    const adapter = new FakeTuningSolverAdapter();
    expect(supportsSolverBodyTuning(adapter)).toBe(true);
    expect(missingSolverBodyTuning(adapter)).toEqual([]);
  });

  it("treats a half-implemented seam as absent, naming what is missing", () => {
    const noop = (): void => {};
    const stripped = {
      setBodyMassProperties: noop,
      setBodyDamping: noop,
      setBodyGravityScale: noop,
      setBodyCcdMode: noop,
      setColliderMaterial: noop,
    };
    expect(supportsSolverBodyTuning(stripped)).toBe(false);
    expect(missingSolverBodyTuning(stripped)).toEqual(["setColliderFilter"]);
  });
});

describe("PhysicsWorld.supportsLiveProperties", () => {
  it("is false on an adapter without the seam and true with it", async () => {
    const plain = await plainWorld();
    const tuning = await tuningWorld();
    expect(plain.world.supportsLiveProperties).toBe(false);
    expect(tuning.world.supportsLiveProperties).toBe(true);
  });
});

describe("the dirty set costs nothing when nothing was written", () => {
  it("issues the identical solver-call sequence with and without the seam", async () => {
    const plain = await plainWorld();
    const tuning = await tuningWorld();
    for (const { world } of [plain, tuning]) {
      world.addBody(dynamicNode({ mass: 2 }));
      world.addBody(dynamicNode({ mass: 3 }));
    }
    plain.adapter.clearCalls();
    tuning.adapter.clearCalls();

    plain.world.step(1 / 60);
    tuning.world.step(1 / 60);

    expect(tuning.adapter.callOrder).toEqual(plain.adapter.callOrder);
    expect(tuningCallOrder(tuning.adapter)).toEqual([]);
  });

  it("clears a body's pending writes even when the adapter cannot serve them", async () => {
    const { world } = await plainWorld();
    const node = dynamicNode({ mass: 2 });
    const body = world.addBody(node);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    body.linearDamping = 0.5;
    expect(body.pendingSolverWrites).not.toBe(0);
    world.step(1 / 60);
    expect(body.pendingSolverWrites).toBe(0);
  });
});

describe("RigidBody property writes reach the solver (§23, §31)", () => {
  it("pushes §23's mass triple as one call, before forces", async () => {
    const { adapter, world } = await tuningWorld();
    const node = dynamicNode({ mass: 2 });
    const body = world.addBody(node);
    adapter.clearCalls();

    body.mass = 7;
    body.applyForce(new Vector3(1, 0, 0));
    world.step(1 / 60);

    const order = adapter.callOrder;
    expect(order.indexOf("setBodyMassProperties")).toBeLessThan(
      order.indexOf("applyForce"),
    );
    expect(adapter.tuningOf(1)?.mass).toBe(7);
    expect(adapter.callsOf("setBodyMassProperties")[0]?.args).toEqual([
      7,
      undefined,
      undefined,
      true,
    ]);
  });

  it("carries an authored centre and tensor with the mass", async () => {
    const { adapter, world } = await tuningWorld();
    const node = new Group();
    node.transformAuthority = "physics";
    node.addComponent(
      new RigidBody({
        type: "dynamic",
        mass: 2,
        centerOfMass: new Vector3(0.25, 0, 0),
        inertiaTensor: new Matrix3(),
      }),
    );
    const body = world.addBody(node);
    adapter.clearCalls();

    body.mass = 9;
    world.step(1 / 60);

    const tuning = adapter.tuningOf(1);
    expect(tuning?.mass).toBe(9);
    expect(tuning?.centerOfMass?.x).toBe(0.25);
    expect(tuning?.inertiaTensor).toBeDefined();
  });

  it("pushes an in-place centre-of-mass edit only when it is marked", async () => {
    const { adapter, world } = await tuningWorld();
    const node = dynamicNode({ mass: 2 });
    const body = world.addBody(node);
    adapter.clearCalls();

    body.centerOfMass.set(0, 0.5, 0);
    world.step(1 / 60);
    expect(adapter.callsOf("setBodyMassProperties")).toHaveLength(0);

    body.markMassPropertiesChanged();
    world.step(1 / 60);
    expect(adapter.callsOf("setBodyMassProperties")).toHaveLength(1);
    expect(adapter.tuningOf(1)?.centerOfMass?.y).toBe(0.5);
  });

  it("never pushes a solver-derived mass back as an authored one (PH-4)", async () => {
    const { adapter, world } = await tuningWorld();
    const node = dynamicNode({ density: 4 });
    const body = world.addBody(node);
    expect(body.massAuthored).toBe(false);
    adapter.clearCalls();

    body.markMassPropertiesChanged();
    world.step(1 / 60);
    expect(adapter.callsOf("setBodyMassProperties")).toHaveLength(0);
  });

  it("pushes both damping coefficients in one call", async () => {
    const { adapter, world } = await tuningWorld();
    const body = world.addBody(dynamicNode({ mass: 1 }));
    adapter.clearCalls();

    body.linearDamping = 0.25;
    body.angularDamping = 0.5;
    world.step(1 / 60);

    expect(adapter.callsOf("setBodyDamping")).toHaveLength(1);
    expect(adapter.callsOf("setBodyDamping")[0]?.args).toEqual([0.25, 0.5]);
  });

  it("pushes the gravity scale", async () => {
    const { adapter, world } = await tuningWorld();
    const body = world.addBody(dynamicNode({ mass: 1 }));
    adapter.clearCalls();

    body.gravityScale = 0;
    world.step(1 / 60);

    expect(adapter.tuningOf(1)?.gravityScale).toBe(0);
  });

  it("pushes §31's mode with the authored prediction distance", async () => {
    const { adapter, world } = await tuningWorld();
    const node = new Group();
    node.transformAuthority = "physics";
    node.addComponent(
      new RigidBody({
        type: "dynamic",
        mass: 1,
        ccdMode: "speculative",
        ccdPredictionDistance: 0.75,
      }),
    );
    const body = world.addBody(node);
    adapter.clearCalls();

    body.ccdMode = "swept";
    world.step(1 / 60);
    expect(adapter.callsOf("setBodyCcdMode")[0]?.args).toEqual(["swept", 0.75]);

    body.ccdMode = "speculative";
    world.step(1 / 60);
    expect(adapter.callsOf("setBodyCcdMode")[1]?.args).toEqual([
      "speculative",
      0.75,
    ]);
  });

  it("routes §23's on/off switch through the same dirty bit", async () => {
    const { adapter, world } = await tuningWorld();
    const body = world.addBody(dynamicNode({ mass: 1 }));
    adapter.clearCalls();

    body.continuousCollisionDetection = true;
    world.step(1 / 60);
    expect(adapter.callsOf("setBodyCcdMode")).toHaveLength(1);

    body.continuousCollisionDetection = false;
    world.step(1 / 60);
    expect(adapter.callsOf("setBodyCcdMode")[1]?.args?.[0]).toBe("disabled");

    // Idempotent: turning it on twice queues one write, not two.
    adapter.clearCalls();
    body.continuousCollisionDetection = false;
    world.step(1 / 60);
    expect(adapter.callsOf("setBodyCcdMode")).toHaveLength(0);
  });

  it("does not warn when every world holding the body can carry the write", async () => {
    const { world } = await tuningWorld();
    const body = world.addBody(dynamicNode({ mass: 1 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    body.mass = 5;
    body.linearDamping = 0.1;
    body.gravityScale = 0.5;
    body.ccdMode = "swept";

    expect(warn).not.toHaveBeenCalled();
  });

  it("still warns when one of two worlds cannot carry the write", async () => {
    const tuning = await tuningWorld();
    const plain = await plainWorld();
    const node = dynamicNode({ mass: 1 });
    const body = tuning.world.addBody(node);
    plain.world.addBody(node);
    expect(body.registeredWorldCount).toBe(2);
    expect(body.liveSolverWriteWorldCount).toBe(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    body.gravityScale = 0.25;
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stops warning once the plain world lets go", async () => {
    const tuning = await tuningWorld();
    const plain = await plainWorld();
    const node = dynamicNode({ mass: 1 });
    const body = tuning.world.addBody(node);
    plain.world.addBody(node);
    plain.world.removeBody(node);
    expect(body.registeredWorldCount).toBe(1);
    expect(body.liveSolverWriteWorldCount).toBe(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    body.gravityScale = 0.25;
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps warning about un-authoring a mass, on every adapter", async () => {
    const { adapter, world } = await tuningWorld();
    const body = world.addBody(dynamicNode({ mass: 4 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    adapter.clearCalls();

    body.mass = undefined;
    world.step(1 / 60);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "derive it from collider density",
    );
    expect(adapter.callsOf("setBodyMassProperties")).toHaveLength(0);
  });

  it("warns when a distribution is marked on a body with no authored mass", async () => {
    const { world } = await tuningWorld();
    const body = world.addBody(dynamicNode({ density: 2 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    body.markMassPropertiesChanged();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("markMassPropertiesChanged");
    expect(body.pendingSolverWrites).toBe(0);
  });

  it("marks an unregistered body without warning, and never loses the value", () => {
    const body = new RigidBody({ type: "dynamic", mass: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    body.gravityScale = 0.5;
    expect(warn).not.toHaveBeenCalled();
    expect(body.pendingSolverWrites).not.toBe(0);
    expect(body.toDescriptor().gravityScale).toBe(0.5);
  });
});

describe("PhysicsWorld.refreshCollider (§24, §25)", () => {
  it("pushes the effective material and the filter", async () => {
    const { adapter, world } = await tuningWorld();
    const node = dynamicNode({ mass: 2, friction: 0.9 });
    world.addBody(node);
    const collider = node.getComponent(Collider);
    if (collider === undefined) {
      throw new Error("collider missing");
    }
    adapter.clearCalls();

    collider.restitution = 0.4;
    collider.sensor = true;
    collider.collisionMask = 0b1010;
    world.refreshCollider(collider);
    world.step(1 / 60);

    const material = adapter.colliderTuning.get(1);
    expect(material?.friction).toBe(0.9);
    expect(material?.restitution).toBe(0.4);
    expect(material?.sensor).toBe(true);
    expect(material?.collisionMask).toBe(0b1010);
  });

  it("resolves §25 precedence in the engine, never in the adapter", async () => {
    const { adapter, world } = await tuningWorld();
    const node = dynamicNode({ mass: 2 });
    const collider = node.getComponent(Collider);
    if (collider === undefined) {
      throw new Error("collider missing");
    }
    collider.material = new PhysicsMaterial({
      friction: 0.1,
      restitution: 0.9,
    });
    collider.friction = 0.8;
    world.addBody(node);
    adapter.clearCalls();

    world.refreshCollider(collider);
    world.step(1 / 60);

    // The collider's own field beats its material's (§25).
    expect(adapter.colliderTuning.get(1)?.friction).toBe(0.8);
    expect(adapter.colliderTuning.get(1)?.restitution).toBe(0.9);
  });

  it("offers a density only for a body whose mass is collider-derived (§23)", async () => {
    const derived = await tuningWorld();
    const authored = await tuningWorld();

    const derivedNode = dynamicNode({ density: 3 });
    derived.world.addBody(derivedNode);
    const derivedCollider = derivedNode.getComponent(Collider);
    const authoredNode = dynamicNode({ mass: 5, density: 3 });
    authored.world.addBody(authoredNode);
    const authoredCollider = authoredNode.getComponent(Collider);
    if (derivedCollider === undefined || authoredCollider === undefined) {
      throw new Error("collider missing");
    }

    derived.world.refreshCollider(derivedCollider);
    derived.world.step(1 / 60);
    authored.world.refreshCollider(authoredCollider);
    authored.world.step(1 / 60);

    expect(derived.adapter.colliderTuning.get(1)?.density).toBe(3);
    expect(authored.adapter.colliderTuning.get(1)?.density).toBeUndefined();
  });

  it("is idempotent and consumed by one step", async () => {
    const { adapter, world } = await tuningWorld();
    const node = dynamicNode({ mass: 2 });
    world.addBody(node);
    const collider = node.getComponent(Collider);
    if (collider === undefined) {
      throw new Error("collider missing");
    }
    adapter.clearCalls();

    world.refreshCollider(collider);
    world.refreshCollider(collider);
    world.step(1 / 60);
    expect(adapter.callsOf("setColliderMaterial")).toHaveLength(1);

    world.step(1 / 60);
    expect(adapter.callsOf("setColliderMaterial")).toHaveLength(1);
  });

  it("is accepted but unserved on an adapter without the seam", async () => {
    const { adapter, world } = await plainWorld();
    const node = dynamicNode({ mass: 2 });
    world.addBody(node);
    const collider = node.getComponent(Collider);
    if (collider === undefined) {
      throw new Error("collider missing");
    }
    adapter.clearCalls();

    world.refreshCollider(collider);
    expect(() => {
      world.step(1 / 60);
    }).not.toThrow();
    expect(tuningCallOrder(adapter)).toEqual([]);
  });

  it("refuses a collider this world does not hold", async () => {
    const { world } = await tuningWorld();
    const stranger = new Collider({ shape: { type: "circle", radius: 1 } });
    expect(() => {
      world.refreshCollider(stranger);
    }).toThrow(/not registered with this PhysicsWorld/u);
  });

  it("forgets a pending refresh when the body is removed", async () => {
    const { adapter, world } = await tuningWorld();
    const first = dynamicNode({ mass: 1 });
    const second = dynamicNode({ mass: 1 });
    world.addBody(first);
    world.addBody(second);
    const collider = first.getComponent(Collider);
    if (collider === undefined) {
      throw new Error("collider missing");
    }

    world.refreshCollider(collider);
    world.removeBody(first);
    adapter.clearCalls();
    world.step(1 / 60);

    // Nothing scans for a refresh that no longer has a collider to serve.
    expect(tuningCallOrder(adapter)).toEqual([]);
  });
});

describe("the drain order is §33 deterministic", () => {
  it("walks ascending body id, and ascending collider id within a body", async () => {
    const { adapter, world } = await tuningWorld();
    const first = dynamicNode({ mass: 1 });
    const second = new Group();
    second.transformAuthority = "physics";
    second.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
    second.addComponent(new Collider({ shape: { type: "circle", radius: 1 } }));
    const child = new Group();
    child.addComponent(new Collider({ shape: { type: "circle", radius: 2 } }));
    second.add(child);

    const bodyA = world.addBody(first);
    const bodyB = world.addBody(second);
    const collidersB = [
      second.getComponent(Collider),
      child.getComponent(Collider),
    ];
    adapter.clearCalls();

    // Written in the *reverse* of the order they must be drained in.
    for (const collider of collidersB.reverse()) {
      if (collider === undefined) {
        throw new Error("collider missing");
      }
      world.refreshCollider(collider);
    }
    bodyB.gravityScale = 0.5;
    bodyA.gravityScale = 0.25;
    world.step(1 / 60);

    expect(tuningCallOrder(adapter)).toEqual([
      "setBodyGravityScale#1",
      "setBodyGravityScale#2",
      "setColliderMaterial#2",
      "setColliderFilter#2",
      "setColliderMaterial#3",
      "setColliderFilter#3",
    ]);
  });

  it("pushes one body's properties in the seam's declaration order", async () => {
    const { adapter, world } = await tuningWorld();
    const body = world.addBody(dynamicNode({ mass: 1 }));
    adapter.clearCalls();

    // Written in reverse of the order they must be drained in.
    body.ccdMode = "swept";
    body.gravityScale = 0.5;
    body.angularDamping = 0.25;
    body.mass = 3;
    world.step(1 / 60);

    expect(tuningCallOrder(adapter)).toEqual([
      "setBodyMassProperties#1",
      "setBodyDamping#1",
      "setBodyGravityScale#1",
      "setBodyCcdMode#1",
    ]);
  });
});

describe("PhysicsWorld.teleport (§37 teleports)", () => {
  it("writes the pose through setBodyTransform, keeping the rotation by default", async () => {
    const { adapter, world } = await tuningWorld();
    const node = dynamicNode({ mass: 1 });
    world.addBody(node);
    adapter.clearCalls();

    world.teleport(node, new Vector3(3, 4, 0));

    expect(adapter.callsOf("getBodyTransform")).toHaveLength(1);
    expect(adapter.callsOf("setBodyTransform")).toHaveLength(1);
    expect(adapter.body(1).position.x).toBe(3);
    expect(adapter.body(1).position.y).toBe(4);
  });

  it("takes an explicit rotation without reading the solver first", async () => {
    const { adapter, world } = await tuningWorld();
    const node = dynamicNode({ mass: 1 });
    world.addBody(node);
    adapter.clearCalls();

    world.teleport(node, new Vector3(1, 0, 0), Math.PI / 2, false);

    expect(adapter.callsOf("getBodyTransform")).toHaveLength(0);
    expect(adapter.callsOf("setBodyTransform")[0]?.args).toEqual([false]);
  });

  it("leaves the node transform to §42's owner", async () => {
    const { world } = await tuningWorld();
    const node = dynamicNode({ mass: 1 });
    world.addBody(node);

    world.teleport(node, new Vector3(9, 9, 0));

    expect(node.transform.position.x).toBe(0);
  });

  it("refuses a node this world does not hold", async () => {
    const { world } = await tuningWorld();
    expect(() => {
      world.teleport(new Group(), new Vector3());
    }).toThrow(/not registered with this PhysicsWorld/u);
  });
});
