/**
 * PH-5 — a `Collider` attached to (or removed from) a node **after**
 * `world.addBody` reaches the solver (§23, §24, §25, §33, §34, §37, §83, §85).
 *
 * `addBody` scans a body's subtree once; until this packet that scan was the
 * only route, so a collider added later was silently not simulated and the only
 * workaround — `removeBody` + `addBody` — minted a new solver body id and broke
 * §33's checksum ordering, §34 snapshot compatibility, and every joint naming
 * the body.
 *
 * What this suite pins, against the structural double so the *world's*
 * bookkeeping is the object under test:
 *
 * 1. **Mass stays correct in both directions and on both kinds of body.** A
 *    derived-mass body gains and loses its colliders' contributions; an
 *    authored-mass body keeps what its author wrote, across add *and* remove.
 *    A derived-mass body left with no collider stops reporting a mass at all,
 *    rather than mirroring colliders that no longer exist.
 * 2. **The registry stays in the order §33 and PH-1's drain depend on** —
 *    ascending collider id within a body — and event and query translation see
 *    exactly the registered set.
 * 3. **The refusals are the §85 ones**, and the one source of truth about which
 *    body a collider belongs to stays `Collider.requireBody`.
 * 4. **A world that never adds or removes at runtime is untouched** — the same
 *    solver-call sequence, byte for byte.
 */

import { isFourError } from "@four/core";
import { Vector3 } from "@four/math";
import { Group } from "@four/scene";
import { describe, expect, it, vi } from "vitest";

import type { CollisionEvent, PhysicsWorldInit } from "../src/index.js";
import {
  Collider,
  PhysicsWorld,
  RigidBody,
  type CollisionShape,
} from "../src/index.js";
import { FakeSolverAdapter, FakeTuningSolverAdapter } from "./fake-adapter.js";

/** Everything `PhysicsWorldInit` carries except the adapter, which is the fake. */
type WorldOverrides = Omit<Partial<PhysicsWorldInit>, "adapter"> & {
  adapter?: FakeSolverAdapter;
};

/** A 2D world on a fresh fake adapter, initialized. */
async function readyWorld(
  overrides: WorldOverrides = {},
): Promise<{ adapter: FakeSolverAdapter; world: PhysicsWorld }> {
  const adapter = overrides.adapter ?? new FakeSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", ...overrides, adapter });
  await world.initialize();
  return { adapter, world };
}

/** A node carrying a body of `type` and one circle collider, under `"physics"`. */
function bodyNode(
  options: {
    mass?: number;
    density?: number;
    type?: RigidBody["type"];
  } = {},
): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.addComponent(
    new RigidBody({
      type: options.type ?? "dynamic",
      ...(options.mass === undefined ? {} : { mass: options.mass }),
    }),
  );
  node.addComponent(makeCollider(options.density));
  return node;
}

/** A circle collider, optionally with an authored §25 density. */
function makeCollider(density?: number, shape?: CollisionShape): Collider {
  return new Collider({
    shape: shape ?? { type: "circle", radius: 0.5 },
    ...(density === undefined ? {} : { density }),
  });
}

/**
 * A child node under `parent` carrying `collider` — the §24 arrangement several
 * colliders on one body are expressed as (WP-5.2), and the one `addCollider`
 * resolves through `Collider.requireBody`.
 */
function attachChild(parent: Group, collider: Collider): Group {
  const child = new Group();
  child.addComponent(collider);
  parent.add(child);
  return child;
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

describe("PhysicsWorld.addCollider (§24, §37, PH-5)", () => {
  it("creates the solver collider and makes it reachable", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    expect(adapter.colliders.size).toBe(1);

    const late = makeCollider();
    attachChild(node, late);
    expect(world.getColliderHandle(late)).toBeUndefined();

    expect(world.addCollider(late)).toBe(late);
    expect(adapter.colliders.size).toBe(2);
    const handle = world.getColliderHandle(late);
    expect(handle).toBeDefined();
    expect(adapter.getColliderId(handle!)).toBe(2);
  });

  it("resolves the body through Collider.requireBody, not a parameter", async () => {
    const { adapter, world } = await readyWorld();
    const first = bodyNode();
    const second = bodyNode();
    world.addBody(first);
    world.addBody(second);

    // The collider hangs under `second`, so §24's ancestor walk names the
    // second body — the same resolution `addBody`'s subtree scan applies.
    const late = makeCollider();
    attachChild(second, late);
    world.addCollider(late);

    const created = adapter.callsOf("createCollider").at(-1);
    expect(created?.id).toBe(3);
    // The third argument is the body's monotonic id: the *second* body.
    expect(created?.args[1]).toBe(2);
  });

  it("appends in ascending collider id, which is the drain's order (§33)", async () => {
    const { adapter, world } = await readyWorld({
      adapter: new FakeTuningSolverAdapter(),
    });
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider();
    attachChild(node, late);
    world.addCollider(late);

    // The drain visits a body's colliders in registry order; asking both to be
    // refreshed and reading the call order is how that order is observable.
    world.refreshCollider(late);
    world.refreshCollider(node.getComponent(Collider)!);
    adapter.calls.length = 0;
    world.step(1 / 60);

    const refreshed = adapter
      .callsOf("setColliderMaterial")
      .map((call) => call.id);
    expect(refreshed).toEqual([1, 2]);
  });

  it("translates events for a runtime collider (§29)", async () => {
    const { adapter, world } = await readyWorld();
    const first = bodyNode();
    const second = bodyNode();
    world.addBody(first);
    world.addBody(second);
    const late = makeCollider();
    attachChild(second, late);
    world.addCollider(late);

    const seen: Collider[] = [];
    world.getBody(first)?.on("collisionstart", (event) => {
      seen.push(event.colliderB);
    });
    const event: CollisionEvent = {
      type: "collisionstart",
      bodyA: adapter.body(1).handle,
      bodyB: adapter.body(2).handle,
      colliderA: adapter.colliders.get(1)!.handle,
      colliderB: adapter.colliders.get(3)!.handle,
      contacts: [],
      relativeVelocity: new Vector3(),
      totalImpulse: new Vector3(),
    };
    adapter.scriptEvents(event);
    world.step(1 / 60);
    world.dispatchEvents();

    expect(seen).toEqual([late]);
  });

  it("translates query hits for a runtime collider (§30)", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider();
    attachChild(node, late);
    world.addCollider(late);

    adapter.pointHits = [
      {
        body: adapter.body(1).handle,
        collider: adapter.colliders.get(2)!.handle,
        point: new Vector3(),
        distance: 0,
      },
    ];
    const hits = world.pointQuery(new Vector3());
    expect(hits).toHaveLength(1);
    expect(hits[0].collider).toBe(late);
  });

  it("warns once when the new collider's material is unhonoured (§25)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider();
    late.material = { rollingFriction: 0.1 } as never;
    attachChild(node, late);
    world.addCollider(late);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("rollingFriction");
    warn.mockRestore();
  });

  it("refuses a collider already registered here (§85)", async () => {
    const { world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const collider = node.getComponent(Collider)!;

    const error = expectFourError(() => {
      world.addCollider(collider);
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.message).toContain("already registered");
  });

  it("refuses a collider with no RigidBody above it (§23)", async () => {
    const { world } = await readyWorld();
    const orphan = makeCollider();
    const host = new Group();
    host.addComponent(orphan);

    const error = expectFourError(() => {
      world.addCollider(orphan);
    });
    expect(error.code).toBe("INVALID_SCENE_GRAPH");
  });

  it("refuses a collider whose body is not registered here (§85)", async () => {
    const { world } = await readyWorld();
    const node = bodyNode();
    const late = makeCollider();
    attachChild(node, late);

    const error = expectFourError(() => {
      world.addCollider(late);
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.message).toContain("world.addBody(node)");
  });

  it("refuses a collider invalid for the world's dimension (§21, §85)", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider(undefined, {
      type: "sphere",
      radius: 0.5,
    });
    attachChild(node, late);

    expectFourError(() => {
      world.addCollider(late);
    });
    // §85: a rejected registration leaves no half-built collider behind.
    expect(adapter.colliders.size).toBe(1);
    expect(world.getColliderHandle(late)).toBeUndefined();
  });

  it("refuses before initialize", () => {
    const world = new PhysicsWorld({
      dimension: "2d",
      adapter: new FakeSolverAdapter(),
    });
    const error = expectFourError(() => {
      world.addCollider(makeCollider());
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });
});

describe("PhysicsWorld.removeCollider (§24, §37, §83, PH-5)", () => {
  it("destroys the solver collider and forgets the component", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider();
    attachChild(node, late);
    world.addCollider(late);

    expect(world.removeCollider(late)).toBe(true);
    expect(adapter.callsOf("destroyCollider").at(-1)?.id).toBe(2);
    expect(adapter.colliders.size).toBe(1);
    expect(world.getColliderHandle(late)).toBeUndefined();
    // The body itself is untouched: same handle, same id, still registered.
    expect(world.has(node)).toBe(true);
    expect(adapter.bodies.size).toBe(1);
  });

  it("returns false for a collider it does not hold", async () => {
    const { world } = await readyWorld();
    expect(world.removeCollider(makeCollider())).toBe(false);
  });

  it("a runtime collider goes with removeBody and with dispose (§83)", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider();
    attachChild(node, late);
    world.addCollider(late);

    // §37: one `destroyBody` takes everything attached to it, so a runtime
    // collider needs no separate teardown — but the world must still forget it.
    expect(world.removeBody(node)).toBe(true);
    expect(world.getColliderHandle(late)).toBeUndefined();
    expect(world.removeCollider(late)).toBe(false);
    expect(adapter.colliders.size).toBe(0);
    expect(adapter.callsOf("destroyCollider")).toHaveLength(0);

    // Re-registering the body picks the child collider up through the ordinary
    // subtree scan — one source of truth, so there is nothing to hand over.
    world.addBody(node);
    expect(world.getColliderHandle(late)).toBeDefined();
    expect(() => world.addCollider(late)).toThrow(/already registered/);

    world.dispose();
    expect(world.getColliderHandle(late)).toBeUndefined();
    expect(world.removeCollider(late)).toBe(false);
  });

  it("re-registration is allowed and mints a fresh id", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider();
    attachChild(node, late);
    world.addCollider(late);
    world.removeCollider(late);
    world.addCollider(late);

    const handle = world.getColliderHandle(late);
    expect(adapter.getColliderId(handle!)).toBe(3);
  });

  it("drops a pending refreshCollider with the collider (PH-1 stage 2)", async () => {
    const adapter = new FakeTuningSolverAdapter();
    const { world } = await readyWorld({ adapter });
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider();
    attachChild(node, late);
    world.addCollider(late);

    world.refreshCollider(late);
    world.removeCollider(late);
    adapter.calls.length = 0;
    world.step(1 / 60);

    // The dirty count went with it: no collider work at all this step, and the
    // *next* refresh on a surviving collider still lands.
    expect(adapter.callsOf("setColliderMaterial")).toHaveLength(0);
    world.refreshCollider(node.getComponent(Collider)!);
    world.step(1 / 60);
    expect(adapter.callsOf("setColliderMaterial")).toHaveLength(1);
  });

  it("leaves the body's surviving colliders translating (§29)", async () => {
    const { adapter, world } = await readyWorld();
    const first = bodyNode();
    const second = bodyNode();
    world.addBody(first);
    world.addBody(second);
    const late = makeCollider();
    attachChild(second, late);
    world.addCollider(late);

    // The *original* collider of the second body goes; the runtime one stays,
    // and it is the one an event now names.
    world.removeCollider(second.getComponent(Collider)!);

    const seen: Collider[] = [];
    world.getBody(first)?.on("collisionstart", (event) => {
      seen.push(event.colliderB);
    });
    adapter.scriptEvents({
      type: "collisionstart",
      bodyA: adapter.body(1).handle,
      bodyB: adapter.body(2).handle,
      colliderA: adapter.colliders.get(1)!.handle,
      colliderB: adapter.colliders.get(3)!.handle,
      contacts: [],
      relativeVelocity: new Vector3(),
      totalImpulse: new Vector3(),
    });
    world.step(1 / 60);
    world.dispatchEvents();

    expect(seen).toEqual([late]);
  });
});

describe("runtime collider mass correctness (§23, §25, PH-3, PH-4, PH-5)", () => {
  it("a derived-mass body gains the new collider's contribution", async () => {
    const { world } = await readyWorld();
    const node = bodyNode({ density: 2 });
    const body = world.addBody(node);
    expect(body.mass).toBe(2);
    expect(body.massAuthored).toBe(false);

    const late = makeCollider(3);
    attachChild(node, late);
    world.addCollider(late);

    expect(body.mass).toBe(5);
    expect(body.massAuthored).toBe(false);
    expect(body.toDescriptor().mass).toBeUndefined();
  });

  it("a derived-mass body loses it again on removal", async () => {
    const { world } = await readyWorld();
    const node = bodyNode({ density: 2 });
    const body = world.addBody(node);
    const late = makeCollider(3);
    attachChild(node, late);
    world.addCollider(late);

    world.removeCollider(late);
    expect(body.mass).toBe(2);
    expect(body.massAuthored).toBe(false);
  });

  it("a derived-mass body left with no collider reports no mass", async () => {
    const { world } = await readyWorld();
    const node = bodyNode({ density: 2 });
    const body = world.addBody(node);

    world.removeCollider(node.getComponent(Collider)!);

    // Nothing left to derive a mass from: the mirror is cleared rather than
    // reporting colliders that no longer exist (PH-4's rule, applied to loss).
    expect(body.mass).toBeUndefined();
    expect(body.derivedMass).toBeUndefined();
    expect(body.massAuthored).toBe(false);
  });

  it("an authored-mass body keeps its mass across add and remove (PH-4)", async () => {
    const { world } = await readyWorld();
    const node = bodyNode({ mass: 7 });
    const body = world.addBody(node);
    expect(body.mass).toBe(7);
    expect(body.massAuthored).toBe(true);

    const late = makeCollider(9);
    attachChild(node, late);
    world.addCollider(late);
    expect(body.mass).toBe(7);
    expect(body.toDescriptor().mass).toBe(7);

    world.removeCollider(late);
    expect(body.mass).toBe(7);
    expect(body.massAuthored).toBe(true);

    // Even down to zero colliders: an authored mass belongs to the *body*.
    world.removeCollider(node.getComponent(Collider)!);
    expect(body.mass).toBe(7);
    expect(body.massAuthored).toBe(true);
    expect(body.toDescriptor().mass).toBe(7);
  });

  it("leaves the mirror alone when the solver reports no mass but colliders remain", async () => {
    const { world } = await readyWorld();
    const node = bodyNode({ type: "kinematic-position", density: 2 });
    node.transformAuthority = "kinematic";
    const body = world.addBody(node);
    // The double reports `0` for a non-dynamic body — "not simulated", not "no
    // mass" (§23) — so registration never mirrored anything.
    expect(body.derivedMass).toBeUndefined();

    const late = makeCollider(3);
    attachChild(node, late);
    world.addCollider(late);
    expect(body.derivedMass).toBeUndefined();

    world.removeCollider(late);
    expect(body.derivedMass).toBeUndefined();
  });

  it("ignores a non-finite solver mass", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ density: 2 });
    const body = world.addBody(node);
    const late = makeCollider(3);
    attachChild(node, late);

    adapter.body(1).mass = Number.NaN;
    world.addCollider(late);
    expect(body.derivedMass).toBe(2);

    world.removeCollider(late);
    world.removeCollider(node.getComponent(Collider)!);
    // No colliders left, so the mirror clears even though the reported mass was
    // never usable.
    expect(body.derivedMass).toBeUndefined();
  });

  it("a body that lost every collider can still be re-collidered", async () => {
    const { world } = await readyWorld();
    const node = bodyNode({ density: 2 });
    const body = world.addBody(node);
    world.removeCollider(node.getComponent(Collider)!);
    expect(body.mass).toBeUndefined();

    const late = makeCollider(4);
    attachChild(node, late);
    world.addCollider(late);
    expect(body.mass).toBe(4);
  });
});

describe("runtime collider changes and §33/§34 (PH-5)", () => {
  it("keeps the body id, so the checksum sequence keeps its shape", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const before = adapter.getBodyId(world.getBodyHandle(node)!);

    const late = makeCollider();
    attachChild(node, late);
    world.addCollider(late);
    world.removeCollider(late);

    expect(adapter.getBodyId(world.getBodyHandle(node)!)).toBe(before);
    expect(adapter.callsOf("createBody")).toHaveLength(1);
    expect(adapter.callsOf("destroyBody")).toHaveLength(0);
  });

  it("a snapshot taken after a runtime add restores (§34)", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode();
    world.addBody(node);
    const late = makeCollider();
    attachChild(node, late);
    world.addCollider(late);

    world.step(1 / 60);
    const snapshot = world.createSnapshot();
    const checksum = world.checksum();
    world.step(1 / 60);
    expect(world.checksum()).not.toBe(checksum);

    world.restoreSnapshot(snapshot);
    expect(world.checksum()).toBe(checksum);
    // The collider survived the restore on both sides of the seam.
    expect(world.getColliderHandle(late)).toBeDefined();
    expect(adapter.colliders.size).toBe(2);
  });

  it("a world that never adds or removes makes the identical solver calls", async () => {
    async function run(runtimeChanges: boolean): Promise<string[]> {
      const { adapter, world } = await readyWorld();
      const node = bodyNode();
      world.addBody(node);
      if (runtimeChanges) {
        const late = makeCollider();
        attachChild(node, late);
        world.addCollider(late);
        world.removeCollider(late);
      }
      adapter.calls.length = 0;
      world.step(1 / 60);
      world.step(1 / 60);
      return adapter.callOrder;
    }

    expect(await run(false)).toEqual(await run(true));
  });
});
