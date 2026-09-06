/**
 * PH-1 live velocity writes — §42-style who-wins.
 */

import { Vector3 } from "@four/math";
import { Group } from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isFourError } from "@four/core";
import { Collider } from "../src/collider.js";
import { PhysicsWorld } from "../src/world.js";
import { RigidBody } from "../src/rigid-body.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

async function ready() {
  const adapter = new FakeSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", adapter });
  await world.initialize();
  return { adapter, world };
}

function bodyNode(
  type: "dynamic" | "static" | "kinematic-velocity" | "kinematic-position",
  authority: Group["transformAuthority"] = "physics",
): Group {
  const node = new Group();
  node.transformAuthority = authority;
  node.addComponent(
    new RigidBody(type === "dynamic" ? { type, mass: 1 } : { type }),
  );
  node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
  return node;
}

describe("PhysicsWorld.setLinearVelocity / setAngularVelocity (PH-1)", () => {
  it("writes a physics-authority dynamic body and the next publish keeps it", async () => {
    const { adapter, world } = await ready();
    const node = bodyNode("dynamic");
    world.addBody(node);

    expect(world.setLinearVelocity(node, new Vector3(3, -1, 0))).toBe(true);
    expect(node.getComponent(RigidBody)?.linearVelocity.x).toBe(3);
    expect(adapter.body(1).linearVelocity.x).toBe(3);

    expect(world.setAngularVelocity(node, 1.5)).toBe(true);
    expect(node.getComponent(RigidBody)?.angularVelocity.z).toBe(1.5);
    expect(adapter.body(1).angularVelocity.z).toBe(1.5);

    world.step(1 / 60);
    expect(node.getComponent(RigidBody)?.linearVelocity.x).toBeCloseTo(3, 12);
    world.dispose();
  });

  it("accepts a kinematic-velocity body", async () => {
    const { adapter, world } = await ready();
    const node = bodyNode("kinematic-velocity");
    world.addBody(node);

    expect(world.setLinearVelocity(node, new Vector3(2, 0, 0))).toBe(true);
    expect(adapter.body(1).linearVelocity.x).toBe(2);
    world.dispose();
  });

  it("refuses a manual-authority write and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { adapter, world } = await ready();
    const node = bodyNode("dynamic", "manual");
    world.addBody(node);

    expect(world.setLinearVelocity(node, new Vector3(9, 0, 0))).toBe(false);
    expect(adapter.body(1).linearVelocity.x).toBe(0);
    expect(world.setLinearVelocity(node, new Vector3(8, 0, 0))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("physics");
    expect(String(warn.mock.calls[0]?.[0])).toContain("manual");

    world.dispose();
  });

  it("refuses a static body", async () => {
    const { world } = await ready();
    const node = bodyNode("static");
    world.addBody(node);

    try {
      world.setLinearVelocity(node, new Vector3(1, 0, 0));
      expect.unreachable("static write should throw");
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      expect((error as Error).message).toContain("static");
    }
    world.dispose();
  });
});
