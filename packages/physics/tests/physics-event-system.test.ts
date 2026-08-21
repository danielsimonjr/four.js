/**
 * PH-21 (2026-08-21): §39 step 9 gets its own occupant.
 *
 * The claims under test are (1) the default is unchanged — a `PhysicsSystem`
 * nobody configured still solves and dispatches at step 6, which is what keeps
 * every §33 golden still — (2) the split delivers the *same events, in the same
 * order, to the same emitters*, only later in the step order, and (3) the two
 * ways to get it wrong are refused or announced rather than silently accepted.
 */

import { isFourError } from "@four/core";
import { Vector3 } from "@four/math";
import {
  PRIORITY_CONSTRAINTS,
  PRIORITY_EVENT_DISPATCH,
  SystemRegistry,
  createTimeState,
  type FixedUpdateContext,
  type SimulationSystem,
} from "@four/motion";
import { Group } from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CollisionEvent, PhysicsBodyHandle } from "../src/index.js";
import {
  Collider,
  PhysicsEventSystem,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
} from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

/** An initialized 2D world on its own fake adapter. */
async function makeWorld(): Promise<{
  adapter: FakeSolverAdapter;
  world: PhysicsWorld;
}> {
  const adapter = new FakeSolverAdapter();
  const world = new PhysicsWorld({
    dimension: "2d",
    gravity: new Vector3(0, -10, 0),
    adapter,
  });
  await world.initialize();
  return { adapter, world };
}

/** A dynamic node with one collider, owned by `"physics"` authority (§42). */
function dynamicNode(): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type: "dynamic" }));
  node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PhysicsEventSystem registration (§39 step 9, PH-21)", () => {
  it("runs at PRIORITY_EVENT_DISPATCH by default", async () => {
    const { world } = await makeWorld();
    const source = new PhysicsSystem({
      worlds: [world],
      dispatchEvents: false,
    });

    expect(new PhysicsEventSystem({ source }).priority).toBe(
      PRIORITY_EVENT_DISPATCH,
    );
    expect(PRIORITY_EVENT_DISPATCH).toBe(900);
    expect(new PhysicsEventSystem({ source, priority: 950 }).priority).toBe(
      950,
    );
  });

  it("reads its worlds from the source, so the two cannot disagree", async () => {
    const first = await makeWorld();
    const second = await makeWorld();
    const source = new PhysicsSystem({
      worlds: [first.world],
      dispatchEvents: false,
    });
    const events = new PhysicsEventSystem({ source });

    expect(events.worlds).toEqual([first.world]);
    source.track(second.world);
    expect(events.worlds).toEqual([first.world, second.world]);
    source.untrack(first.world);
    expect(events.worlds).toEqual([second.world]);
    expect(events.source).toBe(source);
  });

  it("refuses a source that still dispatches its own events (§85)", async () => {
    const { world } = await makeWorld();
    const source = new PhysicsSystem({ worlds: [world] });

    expect(source.dispatchesEvents).toBe(true);
    let caught: unknown;
    try {
      new PhysicsEventSystem({ source });
    } catch (error) {
      caught = error;
    }
    expect(isFourError(caught)).toBe(true);
    expect((caught as Error).message).toContain("dispatchEvents: false");
  });

  it("initializes and disposes without touching the source's worlds", async () => {
    const { adapter, world } = await makeWorld();
    const source = new PhysicsSystem({
      worlds: [world],
      dispatchEvents: false,
    });
    const events = new PhysicsEventSystem({ source });

    events.initialize();
    events.dispose();

    expect(source.size).toBe(1);
    expect(adapter.disposed).toBe(false);
    expect(world.disposed).toBe(false);
  });
});

describe("PhysicsEventSystem dispatch (§6b, §39 step 9)", () => {
  it("delivers the same events, in tracking order, one step later in the order", async () => {
    const first = await makeWorld();
    const second = await makeWorld();
    const firstBody = first.world.addBody(dynamicNode());
    const secondBody = second.world.addBody(dynamicNode());
    const source = new PhysicsSystem({
      worlds: [first.world, second.world],
      dispatchEvents: false,
    });
    const events = new PhysicsEventSystem({ source });

    const seen: string[] = [];
    firstBody.on("collisionstart", () => seen.push("first"));
    secondBody.on("collisionstart", () => seen.push("second"));
    first.adapter.scriptEvents(selfCollision(first.adapter));
    second.adapter.scriptEvents(selfCollision(second.adapter));

    source.fixedUpdate(contextOf(1 / 60));
    expect(seen).toEqual([]);
    expect(first.world.queuedEvents).toHaveLength(1);

    events.fixedUpdate();
    expect(seen).toEqual(["first", "second"]);
    expect(first.world.queuedEvents).toHaveLength(0);
    expect(second.world.queuedEvents).toHaveLength(0);
  });

  it("puts a step-7 system before the listeners, which is the point (§39)", async () => {
    const { adapter, world } = await makeWorld();
    const body = world.addBody(dynamicNode());
    const source = new PhysicsSystem({
      worlds: [world],
      dispatchEvents: false,
    });
    const order: string[] = [];
    const constraints: SimulationSystem = {
      priority: PRIORITY_CONSTRAINTS,
      initialize: () => undefined,
      fixedUpdate: () => order.push("constraints"),
      dispose: () => undefined,
    };
    const registry = new SystemRegistry();
    registry.register(new PhysicsEventSystem({ source }));
    registry.register(constraints);
    registry.register(source);
    body.on("collisionstart", () => order.push("listener"));
    adapter.scriptEvents(selfCollision(adapter));

    registry.runFixedStep(createTimeState({ fixedDeltaTime: 1 / 60 }));

    expect(order).toEqual(["constraints", "listener"]);
    registry.dispose();
  });

  it("reaches the same state as the combined form, checksum for checksum (§33)", async () => {
    const combined = await makeWorld();
    const split = await makeWorld();
    combined.world.addBody(dynamicNode());
    split.world.addBody(dynamicNode());

    const combinedRegistry = new SystemRegistry();
    combinedRegistry.register(new PhysicsSystem({ worlds: [combined.world] }));
    const splitSource = new PhysicsSystem({
      worlds: [split.world],
      dispatchEvents: false,
    });
    const splitRegistry = new SystemRegistry();
    splitRegistry.register(splitSource);
    splitRegistry.register(new PhysicsEventSystem({ source: splitSource }));

    const time = createTimeState({ fixedDeltaTime: 1 / 60 });
    for (let i = 0; i < 20; i += 1) {
      combinedRegistry.runFixedStep(time);
      splitRegistry.runFixedStep(time);
      expect(split.world.checksum()).toBe(combined.world.checksum());
    }

    combinedRegistry.dispose();
    splitRegistry.dispose();
  });

  it("dispatches nothing, harmlessly, for a source with no worlds", () => {
    const source = new PhysicsSystem({ dispatchEvents: false });
    const events = new PhysicsEventSystem({ source });
    expect(() => events.fixedUpdate()).not.toThrow();
  });
});

describe("PhysicsSystem.dispatchEvents (§39, PH-21)", () => {
  it("defaults to dispatching, and says so", async () => {
    const { world } = await makeWorld();
    expect(new PhysicsSystem({ worlds: [world] }).dispatchesEvents).toBe(true);
    expect(new PhysicsSystem({ dispatchEvents: false }).dispatchesEvents).toBe(
      false,
    );
  });

  it("warns once when nobody has claimed step 9", async () => {
    const { adapter, world } = await makeWorld();
    world.addBody(dynamicNode());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = new PhysicsSystem({
      worlds: [world],
      dispatchEvents: false,
    });
    adapter.scriptEvents(selfCollision(adapter));

    source.fixedUpdate(contextOf(1 / 60));
    source.fixedUpdate(contextOf(1 / 60));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("claimed §39 step 9");
    // The queue really does grow — the warning is not decorative.
    expect(world.queuedEvents.length).toBeGreaterThan(0);
  });

  it("stays silent once a dispatcher claims step 9", async () => {
    const { world } = await makeWorld();
    world.addBody(dynamicNode());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = new PhysicsSystem({
      worlds: [world],
      dispatchEvents: false,
    });
    new PhysicsEventSystem({ source });

    source.fixedUpdate(contextOf(1 / 60));

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the application claims step 9 itself", async () => {
    const { world } = await makeWorld();
    world.addBody(dynamicNode());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = new PhysicsSystem({
      worlds: [world],
      dispatchEvents: false,
    });
    source.claimEventDispatch();
    source.claimEventDispatch();

    source.fixedUpdate(contextOf(1 / 60));
    world.dispatchEvents();

    expect(warn).not.toHaveBeenCalled();
  });

  it("never warns on the default path", async () => {
    const { world } = await makeWorld();
    world.addBody(dynamicNode());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = new PhysicsSystem({ worlds: [world] });
    source.claimEventDispatch();

    source.fixedUpdate(contextOf(1 / 60));

    expect(warn).not.toHaveBeenCalled();
  });
});
