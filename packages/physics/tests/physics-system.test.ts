import { isFourError } from "@four/core";
import { Vector2, Vector3 } from "@four/math";
import { Group } from "@four/scene";
import {
  PRIORITY_KINEMATICS,
  PRIORITY_PHYSICS_SOLVE,
  SystemRegistry,
  createTimeState,
  type FixedUpdateContext,
  type SimulationSystem,
} from "@four/motion";
import { describe, expect, it } from "vitest";

import type { CollisionEvent, PhysicsBodyHandle } from "../src/index.js";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
} from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

/** An initialized world of `dimension` on its own fake adapter. */
async function makeWorld(
  dimension: "2d" | "3d" = "2d",
): Promise<{ adapter: FakeSolverAdapter; world: PhysicsWorld }> {
  const adapter = new FakeSolverAdapter();
  const world = new PhysicsWorld({
    dimension,
    gravity: new Vector3(0, -10, 0),
    adapter,
  });
  await world.initialize();
  return { adapter, world };
}

/** A dynamic node with one collider, owned by `"physics"` authority. */
function dynamicNode(dimension: "2d" | "3d" = "2d"): Group {
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

/** A `collisionstart` naming the fake's body/collider 1 on both sides. */
function selfCollision(adapter: FakeSolverAdapter): CollisionEvent {
  const body: PhysicsBodyHandle = adapter.body(1).handle;
  const collider = adapter.colliders.get(1);
  if (collider === undefined) {
    throw new Error("fake adapter has no collider 1");
  }
  return {
    type: "collisionstart",
    bodyA: body,
    bodyB: body,
    colliderA: collider.handle,
    colliderB: collider.handle,
    contacts: [],
    relativeVelocity: new Vector3(),
    totalImpulse: new Vector3(),
  };
}

/** A fixed-step context carrying `fixedDeltaTime` seconds. */
function contextOf(fixedDeltaTime: number): FixedUpdateContext {
  return { time: createTimeState({ fixedDeltaTime }) };
}

describe("PhysicsSystem registration (§39, plan P5-2)", () => {
  it("runs at PRIORITY_PHYSICS_SOLVE by default (§39 step 6)", () => {
    expect(new PhysicsSystem().priority).toBe(PRIORITY_PHYSICS_SOLVE);
    expect(PRIORITY_PHYSICS_SOLVE).toBe(600);
    expect(new PhysicsSystem({ priority: 650 }).priority).toBe(650);
  });

  it("is a SimulationSystem the §39 registry accepts", async () => {
    const { adapter, world } = await makeWorld();
    const system: SimulationSystem = new PhysicsSystem({ worlds: [world] });
    const registry = new SystemRegistry();
    const order: string[] = [];
    const before: SimulationSystem = {
      priority: PRIORITY_KINEMATICS,
      initialize: () => undefined,
      fixedUpdate: () => order.push("kinematics"),
      dispose: () => undefined,
    };
    registry.register(system);
    registry.register(before);

    registry.runFixedStep(createTimeState({ fixedDeltaTime: 1 / 60 }));

    expect(order).toEqual(["kinematics"]);
    expect(adapter.callsOf("step")).toHaveLength(1);
    registry.dispose();
  });

  it("tracks worlds in insertion order and refuses duplicates", async () => {
    const first = await makeWorld();
    const second = await makeWorld();
    const system = new PhysicsSystem({ worlds: [first.world] });

    expect(system.size).toBe(1);
    expect(system.has(first.world)).toBe(true);
    expect(system.track(second.world)).toBe(second.world);
    expect(system.worlds).toEqual([first.world, second.world]);

    let caught: unknown;
    try {
      system.track(first.world);
    } catch (error) {
      caught = error;
    }
    expect(isFourError(caught)).toBe(true);
    expect((caught as Error).message).toContain("already tracked");

    expect(system.untrack(first.world)).toBe(true);
    expect(system.untrack(first.world)).toBe(false);
    expect(system.worlds).toEqual([second.world]);

    system.clear();
    expect(system.size).toBe(0);
  });

  it("initializes and disposes without touching its worlds", async () => {
    const { adapter, world } = await makeWorld();
    const system = new PhysicsSystem({ worlds: [world] });

    system.initialize();
    system.dispose();

    expect(system.size).toBe(0);
    expect(adapter.disposed).toBe(false);
    expect(world.disposed).toBe(false);
  });
});

describe("PhysicsSystem fixed step (§39 steps 6 and 9)", () => {
  it("steps every world with the fixed delta, in tracking order", async () => {
    const first = await makeWorld("2d");
    const second = await makeWorld("3d");
    first.world.addBody(dynamicNode("2d"));
    second.world.addBody(dynamicNode("3d"));
    const system = new PhysicsSystem({ worlds: [first.world, second.world] });

    system.fixedUpdate(contextOf(0.5));

    expect(first.adapter.callsOf("step")[0].args[0]).toBe(0.5);
    expect(second.adapter.callsOf("step")[0].args[0]).toBe(0.5);
    expect(first.adapter.steps).toBe(1);
    expect(second.adapter.steps).toBe(1);
  });

  it("mixes a 2D and a 3D world on one clock (§21, §108)", async () => {
    const flat = await makeWorld("2d");
    const solid = await makeWorld("3d");
    const flatNode = dynamicNode("2d");
    const solidNode = dynamicNode("3d");
    flat.world.addBody(flatNode);
    solid.world.addBody(solidNode);
    const system = new PhysicsSystem({ worlds: [flat.world, solid.world] });

    system.fixedUpdate(contextOf(0.5));

    // Gravity is −Y in both dimensions (§7a).
    expect(flatNode.transform.position.y).toBeCloseTo(-2.5);
    expect(solidNode.transform.position.y).toBeCloseTo(-2.5);
    expect(flatNode.transform.position.z).toBe(0);
  });

  it("dispatches no events until every world has stepped (§39 step 9)", async () => {
    const first = await makeWorld();
    const second = await makeWorld();
    const firstNode = dynamicNode();
    const secondNode = dynamicNode();
    const body = first.world.addBody(firstNode);
    second.world.addBody(secondNode);
    const system = new PhysicsSystem({ worlds: [first.world, second.world] });

    let observedSteps = -1;
    let observedY = Number.NaN;
    body.on("collisionstart", () => {
      observedSteps = second.adapter.steps;
      observedY = secondNode.transform.position.y;
    });
    first.adapter.scriptEvents(selfCollision(first.adapter));

    system.fixedUpdate(contextOf(0.5));

    expect(observedSteps).toBe(1);
    expect(observedY).toBeCloseTo(-2.5);
    expect(first.world.queuedEvents).toHaveLength(0);
  });

  it("dispatches each world's events in tracking order", async () => {
    const first = await makeWorld();
    const second = await makeWorld();
    const firstBody = first.world.addBody(dynamicNode());
    const secondBody = second.world.addBody(dynamicNode());
    const system = new PhysicsSystem({ worlds: [first.world, second.world] });

    const seen: string[] = [];
    firstBody.on("collisionstart", () => seen.push("first"));
    secondBody.on("collisionstart", () => seen.push("second"));
    first.adapter.scriptEvents(selfCollision(first.adapter));
    second.adapter.scriptEvents(selfCollision(second.adapter));

    system.fixedUpdate(contextOf(1 / 60));

    expect(seen).toEqual(["first", "second"]);
  });

  it("keeps stepping an empty system harmlessly", () => {
    const system = new PhysicsSystem();
    expect(() => system.fixedUpdate(contextOf(1 / 60))).not.toThrow();
  });

  it("advances a world identically through the registry and by hand", async () => {
    const driven = await makeWorld();
    const manual = await makeWorld();
    const drivenNode = dynamicNode();
    const manualNode = dynamicNode();
    driven.world.addBody(drivenNode);
    manual.world.addBody(manualNode);

    const registry = new SystemRegistry();
    registry.register(new PhysicsSystem({ worlds: [driven.world] }));
    const time = createTimeState({ fixedDeltaTime: 1 / 60 });
    for (let i = 0; i < 10; i += 1) {
      registry.runFixedStep(time);
      manual.world.step(1 / 60);
      manual.world.dispatchEvents();
    }

    expect(driven.world.checksum()).toBe(manual.world.checksum());
    expect(drivenNode.transform.position.y).toBe(
      manualNode.transform.position.y,
    );
    registry.dispose();
  });

  it("applies commands queued between steps, once per step (§26)", async () => {
    const { adapter, world } = await makeWorld();
    const node = new Group();
    node.transformAuthority = "physics";
    node.addComponent(new RigidBody({ type: "dynamic", mass: 2 }));
    node.addComponent(new Collider({ shape: { type: "circle", radius: 1 } }));
    const body = world.addBody(node);
    const system = new PhysicsSystem({ worlds: [world] });

    body.applyImpulse(new Vector2(0, 4));
    system.fixedUpdate(contextOf(1 / 60));
    system.fixedUpdate(contextOf(1 / 60));

    expect(adapter.callsOf("applyImpulse")).toHaveLength(1);
    expect(body.linearVelocity.y).toBeGreaterThan(0);
  });
});
