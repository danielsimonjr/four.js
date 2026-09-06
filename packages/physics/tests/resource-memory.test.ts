import { describe, expect, it } from "vitest";

import { Group } from "@four/scene";

import { RigidBody } from "../src/rigid-body.js";
import { liveSolverBodyCount } from "../src/resource-memory.js";
import { PhysicsWorld } from "../src/world.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

describe("solver body resource memory", () => {
  it("tracks registrations across addBody and removeBody", async () => {
    const before = liveSolverBodyCount();
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const node = new Group();
    node.addComponent(new RigidBody({ type: "dynamic" }));
    world.addBody(node);
    expect(liveSolverBodyCount()).toBe(before + 1);
    world.removeBody(node);
    expect(liveSolverBodyCount()).toBe(before);
    world.dispose();
  });
});
