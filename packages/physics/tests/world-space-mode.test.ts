/**
 * §8 *Space Modes* at the physics boundary (PH-12, 2026-08-09).
 *
 * §8's one physics sentence — *"Physics normally operates in world or
 * local-plane space. Screen-space UI should not automatically participate in
 * physical simulation unless explicitly mapped to a simulation plane."* — is
 * declared by `RigidBody.space` and enforced in exactly one place,
 * `PhysicsWorld.addBody`. This file pins both ends of that, plus the §79
 * round trip that keeps a saved body in the frame it was authored in.
 *
 * The two properties that matter most are the least obvious:
 *
 * 1. **Silence for everything written before PH-12.** `space` defaults to
 *    `"world"` and `toDescriptor()` omits it there, so the check cannot fire on
 *    any body in the repository and no descriptor or document changes a byte.
 *    That is what makes this a safe addition rather than a breaking one, and it
 *    is asserted rather than assumed.
 * 2. **`"local-plane"` is refused for a different reason than `"screen"` is**,
 *    and the message says which. §8 *permits* local-plane simulation; §21's
 *    mapping onto the `"2d"` world's XY frame is simply unbuilt. A packet
 *    implementing that mapping deletes one arm of this check and must not be
 *    able to mistake it for the §8 prohibition.
 */

import { DEFAULT_SPACE_MODE, isFourError, type SpaceMode } from "@four/core";
import { Group } from "@four/scene";
import { describe, expect, it } from "vitest";

import type { RigidBodyDocument } from "../src/index.js";
import {
  Collider,
  PhysicsWorld,
  RIGID_BODY_SERIALIZER,
  RigidBody,
} from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

/** A 2D world on a fresh fake adapter, already initialized. */
async function readyWorld(): Promise<{
  adapter: FakeSolverAdapter;
  world: PhysicsWorld;
}> {
  const adapter = new FakeSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", adapter });
  await world.initialize();
  return { adapter, world };
}

/** A dynamic body with a circle collider, optionally declaring a §8 space. */
function node(space?: SpaceMode): Group {
  const group = new Group();
  group.transformAuthority = "physics";
  group.addComponent(
    new RigidBody(
      space === undefined ? { type: "dynamic" } : { type: "dynamic", space },
    ),
  );
  group.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
  return group;
}

/** The error `addBody` threw, or a failure if it did not throw. */
function refusal(world: PhysicsWorld, target: Group): Error {
  try {
    world.addBody(target);
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("addBody did not refuse the body");
}

describe("§8 — the space a RigidBody declares", () => {
  it("defaults to world and leaves the descriptor untouched", () => {
    const body = new RigidBody({ type: "dynamic" });
    expect(body.space).toBe(DEFAULT_SPACE_MODE);
    // The whole byte-identity claim in one assertion: a pre-PH-12 body emits no
    // `space` at all, so no adapter and no document sees a new field.
    expect(body.toDescriptor().space).toBeUndefined();
  });

  it("carries an authored space into the descriptor", () => {
    const body = new RigidBody({ type: "dynamic", space: "local-plane" });
    expect(body.space).toBe("local-plane");
    expect(body.toDescriptor().space).toBe("local-plane");
  });

  it("is plain and mutable, because only registration reads it", () => {
    const body = new RigidBody({ type: "dynamic" });
    body.space = "camera";
    expect(body.toDescriptor().space).toBe("camera");
  });
});

describe("§8 — which space a body may be simulated in", () => {
  it("registers a body that declares nothing (the pre-PH-12 default)", async () => {
    const { world } = await readyWorld();
    expect(() => world.addBody(node())).not.toThrow();
    expect(world.size).toBe(1);
  });

  it('registers a body that explicitly declares "world"', async () => {
    const { world } = await readyWorld();
    expect(() => world.addBody(node("world"))).not.toThrow();
    expect(world.size).toBe(1);
  });

  it("refuses every presentation frame, quoting §8's own sentence", async () => {
    const { world, adapter } = await readyWorld();
    for (const space of [
      "screen",
      "viewport",
      "camera",
      "billboard",
    ] as const) {
      const error = refusal(world, node(space));
      expect(isFourError(error)).toBe(true);
      expect(error.message).toContain(`declares space "${space}"`);
      expect(error.message).toContain("automatically participate");
      expect(error.message).toContain(
        "explicitly mapped to a simulation plane",
      );
    }
    // §85: a refused registration leaves no half-built body behind, in the
    // world or in the solver.
    expect(world.size).toBe(0);
    expect(adapter.bodies.size).toBe(0);
  });

  it('refuses "local-plane" for the unbuilt §21 mapping, not for §8', async () => {
    const { world } = await readyWorld();
    const error = refusal(world, node("local-plane"));

    expect(isFourError(error)).toBe(true);
    expect(error.message).toContain("§8 permits it for physics");
    expect(error.message).toContain("XY frame is not implemented");
    // The distinguishing assertion: this arm must NOT claim §8 forbids it.
    expect(error.message).not.toContain("automatically participate");
  });

  it("names the node and the mode in the error context", async () => {
    const { world } = await readyWorld();
    const screen = node("screen");
    const error = refusal(world, screen);

    expect(isFourError(error) ? error.code : "").toBe("INVALID_SCENE_GRAPH");
    expect(isFourError(error) ? error.context : undefined).toEqual({
      node: screen.id,
      spaceMode: "screen",
    });
  });

  it("is read at registration, so a later write changes nothing", async () => {
    const { world } = await readyWorld();
    const body = node("world");
    world.addBody(body);

    // The check is a registration gate, exactly as documented: writing `space`
    // on an already registered body does not retro-refuse it.
    const component = body.getComponent(RigidBody);
    expect(component).toBeDefined();
    if (component !== undefined) {
      component.space = "screen";
    }
    expect(() => {
      world.step(1 / 60);
    }).not.toThrow();
    expect(world.size).toBe(1);
  });
});

describe("§8 — the space round-trips through §79", () => {
  it("writes no field for a world-space body", () => {
    const document = RIGID_BODY_SERIALIZER.serialize(
      new RigidBody({ type: "dynamic" }),
    ) as unknown as RigidBodyDocument;
    expect(document.space).toBeUndefined();
    expect(Object.keys(document)).not.toContain("space");
  });

  it("restores an authored space, so a reload cannot silently accept it", () => {
    const document = RIGID_BODY_SERIALIZER.serialize(
      new RigidBody({ type: "dynamic", space: "screen" }),
    );
    expect((document as unknown as RigidBodyDocument).space).toBe("screen");

    const restored = RIGID_BODY_SERIALIZER.deserialize(document, new Group());
    // The point of round-tripping a value the world refuses: dropping it would
    // turn a body no world accepts into one every world accepts.
    expect(restored.space).toBe("screen");
  });

  it("restores the default for an absent or unrecognized space", () => {
    for (const value of [undefined, "elsewhere", 7, null]) {
      const document: Record<string, unknown> = {
        type: "dynamic",
        linearVelocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        linearDamping: 0,
        angularDamping: 0,
        gravityScale: 1,
        ccdMode: "disabled",
        physicsWeight: 1,
        animationWeight: 0,
        sleeping: false,
      };
      if (value !== undefined) {
        document.space = value;
      }
      // A defaulted field: `"world"` is the frame every world honours, so a
      // corrupt document can never become a body that is silently somewhere
      // else.
      expect(
        RIGID_BODY_SERIALIZER.deserialize(
          document as unknown as Parameters<
            typeof RIGID_BODY_SERIALIZER.deserialize
          >[0],
          new Group(),
        ).space,
      ).toBe(DEFAULT_SPACE_MODE);
    }
  });
});
