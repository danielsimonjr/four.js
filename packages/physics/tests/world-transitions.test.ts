/**
 * `PhysicsWorld.setBodyControlMode` — §19's control-mode transitions over the
 * structural double (§22, §23, §33, §42, §110; plan P7-3, WP-7.2).
 *
 * The solver-side proof that a body really can be re-typed in place lives in
 * `@four/physics-rapier`'s `rapier-retype.test.ts`, against the real wasm. What
 * is proved *here* is everything the engine owns and a solver cannot answer for:
 * which call the world makes and in which order, that the fixed-step pipeline
 * follows the **new** type from the next step, §23's mass rule for the switch,
 * the exact finite-difference arithmetic of velocity inheritance, §43 pose
 * tracking, and that ids and iteration order — and with them §33's checksum
 * stream — are untouched.
 */

import { isFourError } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import { Group, PoseBuffer, PoseTarget } from "@four/scene";
import { describe, expect, it } from "vitest";

import type { PhysicsWorldInit } from "../src/index.js";
import { Collider, PhysicsWorld, RigidBody } from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

/** One fixed step (§10). Seconds, like every duration in this engine (§7a). */
const DT = 1 / 60;

/** Everything `PhysicsWorldInit` carries except the adapter, which is the fake. */
type WorldOverrides = Omit<Partial<PhysicsWorldInit>, "adapter"> & {
  adapter?: FakeSolverAdapter;
};

/** A 2D world on a fresh fake adapter, already initialized. */
async function readyWorld(overrides: WorldOverrides = {}): Promise<{
  adapter: FakeSolverAdapter;
  world: PhysicsWorld;
}> {
  const adapter = overrides.adapter ?? new FakeSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", ...overrides, adapter });
  await world.initialize();
  return { adapter, world };
}

/** A node with a body of `type` and, unless suppressed, one ball collider. */
function bodyNode(
  type: RigidBody["type"],
  options: { collider?: boolean; mass?: number; dimension?: "2d" | "3d" } = {},
): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.addComponent(
    new RigidBody(
      options.mass === undefined ? { type } : { type, mass: options.mass },
    ),
  );
  if (options.collider !== false) {
    node.addComponent(
      new Collider({
        shape:
          options.dimension === "3d"
            ? { type: "sphere", radius: 0.5 }
            : { type: "circle", radius: 0.5 },
      }),
    );
  }
  return node;
}

/** A `PoseTarget` whose one-step history is exactly `previous → current`. */
function scriptedTarget(
  previous: { position: Vector3; rotation?: Quaternion },
  current: { position: Vector3; rotation?: Quaternion },
): PoseTarget {
  const target = new PoseTarget();
  target.previousPosition.copy(previous.position);
  target.previousRotation.copy(previous.rotation ?? new Quaternion());
  target.position.copy(current.position);
  target.rotation.copy(current.rotation ?? new Quaternion());
  return target;
}

/** A quaternion of `angle` radians about `axis`, allocated per call. */
function rotation(axis: Vector3, angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(axis, angle);
}

/** The linear/angular pair of the adapter's last `setBodyVelocities`. */
function lastSeededVelocities(adapter: FakeSolverAdapter): {
  linear: Vector3;
  angular: Vector3;
  wake: boolean;
} {
  const calls = adapter.callsOf("setBodyVelocities");
  const call = calls[calls.length - 1];
  return {
    linear: call.args[0] as Vector3,
    angular: call.args[1] as Vector3,
    wake: call.args[2] as boolean,
  };
}

/** The `(id, pose, velocities)` stream §33 hashes, for one world. */
function stateStream(world: PhysicsWorld, adapter: FakeSolverAdapter): string {
  const parts: string[] = [];
  adapter.forEachBody((handle, id) => {
    const position = new Vector3();
    const rotationOut = new Quaternion();
    const linear = new Vector3();
    const angular = new Vector3();
    adapter.getBodyTransform(handle, position, rotationOut);
    adapter.getBodyVelocities(handle, linear, angular);
    parts.push(
      [
        id,
        position.x,
        position.y,
        position.z,
        rotationOut.x,
        rotationOut.y,
        rotationOut.z,
        rotationOut.w,
        linear.x,
        linear.y,
        linear.z,
        angular.x,
        angular.y,
        angular.z,
      ].join(","),
    );
  });
  return `${String(world.checksum())}|${parts.join(";")}`;
}

describe("PhysicsWorld.setBodyControlMode", () => {
  describe("the switch itself", () => {
    it("re-types the solver body in place and moves the component with it", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("dynamic");
      const body = world.addBody(node);
      adapter.clearCalls();

      const returned = world.setBodyControlMode(node, "kinematic-position");

      expect(returned).toBe(body);
      expect(body.type).toBe("kinematic-position");
      expect(adapter.body(1).type).toBe("kinematic-position");
      const calls = adapter.callsOf("setBodyType");
      expect(calls).toHaveLength(1);
      expect(calls[0].id).toBe(1);
      expect(calls[0].args).toEqual(["kinematic-position", true]);
      // In place: nothing was destroyed and nothing was created.
      expect(adapter.callsOf("destroyBody")).toHaveLength(0);
      expect(adapter.callsOf("createBody")).toHaveLength(0);
    });

    it("keeps the body's id, its colliders, and forEachBody's order", async () => {
      const { adapter, world } = await readyWorld();
      const first = bodyNode("dynamic");
      const middle = bodyNode("kinematic-position");
      const last = bodyNode("static");
      world.addBody(first);
      world.addBody(middle);
      world.addBody(last);

      const before: number[] = [];
      adapter.forEachBody((_handle, id) => before.push(id));

      world.setBodyControlMode(middle, "dynamic");

      const after: number[] = [];
      adapter.forEachBody((_handle, id) => after.push(id));
      expect(after).toEqual(before);
      expect(after).toEqual([1, 2, 3]);
      expect(adapter.body(2).colliders).toHaveLength(1);
      expect(world.size).toBe(3);
      expect([...world.nodes]).toEqual([first, middle, last]);
    });

    it("leaves the §33 state stream identical between two runs that both retype mid-run", async () => {
      const run = async (): Promise<string[]> => {
        const { adapter, world } = await readyWorld();
        const falling = bodyNode("dynamic");
        const platform = bodyNode("kinematic-position");
        world.addBody(falling);
        world.addBody(platform);

        const stream: string[] = [];
        for (let step = 0; step < 6; step += 1) {
          if (step === 3) {
            world.setBodyControlMode(platform, "dynamic");
          }
          world.step(DT);
          stream.push(stateStream(world, adapter));
        }
        return stream;
      };

      expect(await run()).toEqual(await run());
    });

    it("is a no-op apart from wake when the type is unchanged", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("dynamic");
      world.addBody(node);
      adapter.body(1).sleeping = true;
      adapter.clearCalls();

      world.setBodyControlMode(node, "dynamic");

      expect(adapter.body(1).type).toBe("dynamic");
      expect(adapter.body(1).sleeping).toBe(false);
      expect(adapter.callsOf("setBodyType")).toHaveLength(1);
    });
  });

  describe("wake semantics (§32)", () => {
    it("wakes the body by default", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("static");
      world.addBody(node);
      adapter.body(1).sleeping = true;

      world.setBodyControlMode(node, "dynamic");

      expect(adapter.body(1).sleeping).toBe(false);
      expect(adapter.callsOf("setBodyType")[0].args[1]).toBe(true);
    });

    it("leaves a sleeping body asleep with wake: false", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("static");
      world.addBody(node);
      adapter.body(1).sleeping = true;

      world.setBodyControlMode(node, "dynamic", { wake: false });

      expect(adapter.body(1).sleeping).toBe(true);
      expect(adapter.callsOf("setBodyType")[0].args[1]).toBe(false);
    });

    it("passes wake through to the seeded velocities", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("static");
      world.addBody(node);
      const target = scriptedTarget(
        { position: new Vector3() },
        { position: new Vector3(1, 0, 0) },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
        wake: false,
      });

      expect(lastSeededVelocities(adapter).wake).toBe(false);
    });
  });

  describe("the pipeline follows the new type", () => {
    it("starts feeding a body re-typed to kinematic-position the node's pose", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("dynamic");
      world.addBody(node);
      node.transformAuthority = "animation";
      node.transform.position.set(2, 3, 0);

      world.setBodyControlMode(node, "kinematic-position");
      adapter.clearCalls();
      world.step(DT);

      expect(adapter.callsOf("setNextKinematicTransform")).toHaveLength(1);
      expect(adapter.body(1).position.equalsApprox(new Vector3(2, 3, 0))).toBe(
        true,
      );
    });

    it("starts feeding a body re-typed to kinematic-velocity its authored velocities", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("dynamic");
      const body = world.addBody(node);

      world.setBodyControlMode(node, "kinematic-velocity");
      body.linearVelocity.set(1.5, 0, 0);
      adapter.clearCalls();
      world.step(DT);

      const seeded = lastSeededVelocities(adapter);
      expect(seeded.linear.x).toBeCloseTo(1.5, 12);
      expect(adapter.body(1).position.x).toBeCloseTo(1.5 * DT, 12);
    });

    it("stops publishing the solved pose once the body is no longer dynamic", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("dynamic");
      world.addBody(node);
      world.step(DT);
      const fallen = node.transform.position.y;
      expect(fallen).toBeLessThan(0);

      world.setBodyControlMode(node, "static");
      adapter.body(1).position.set(9, 9, 0);
      world.step(DT);

      expect(node.transform.position.y).toBe(fallen);
      expect(node.transform.position.x).toBe(0);
    });

    it("starts publishing the solved pose once the body becomes dynamic", async () => {
      const { world, adapter } = await readyWorld();
      const node = bodyNode("static");
      world.addBody(node);
      world.step(DT);
      expect(node.transform.position.y).toBe(0);

      world.setBodyControlMode(node, "dynamic");
      world.step(DT);

      expect(node.transform.position.y).toBeLessThan(0);
      expect(node.transform.position.y).toBeCloseTo(
        adapter.body(1).position.y,
        12,
      );
    });
  });

  describe("§43 pose tracking", () => {
    it("tracks a node that becomes dynamic and untracks one that stops being", async () => {
      const poses = new PoseBuffer();
      const { world } = await readyWorld({ poses });
      const node = bodyNode("kinematic-position");
      world.addBody(node);
      expect(poses.has(node)).toBe(false);

      world.setBodyControlMode(node, "dynamic");
      expect(poses.has(node)).toBe(true);

      world.setBodyControlMode(node, "kinematic-velocity");
      expect(poses.has(node)).toBe(false);
    });

    it("leaves tracking alone when dynamic-ness does not change", async () => {
      const poses = new PoseBuffer();
      const { world } = await readyWorld({ poses });
      const kinematic = bodyNode("kinematic-position");
      const dynamic = bodyNode("dynamic");
      world.addBody(kinematic);
      world.addBody(dynamic);

      world.setBodyControlMode(kinematic, "kinematic-velocity");
      world.setBodyControlMode(dynamic, "dynamic");

      expect(poses.has(kinematic)).toBe(false);
      expect(poses.has(dynamic)).toBe(true);
      expect(poses.size).toBe(1);
    });

    it("does nothing when the world has no pose buffer", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);

      expect(() => world.setBodyControlMode(node, "dynamic")).not.toThrow();
    });

    it("untracks a node re-typed to dynamic and removed afterwards", async () => {
      const poses = new PoseBuffer();
      const { world } = await readyWorld({ poses });
      const node = bodyNode("static");
      world.addBody(node);

      world.setBodyControlMode(node, "dynamic");
      expect(poses.has(node)).toBe(true);
      world.removeBody(node);

      expect(poses.has(node)).toBe(false);
    });
  });

  describe("§23's mass rule", () => {
    it("refuses a switch to dynamic when no mass is authored or derivable", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("kinematic-position", { collider: false });
      world.addBody(node);

      expect(() => world.setBodyControlMode(node, "dynamic")).toThrowError(
        /cannot become a "dynamic" body/,
      );
    });

    it("leaves the solver untouched when the mass rule refuses the switch", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position", { collider: false });
      const body = world.addBody(node);
      adapter.clearCalls();

      expect(() => world.setBodyControlMode(node, "dynamic")).toThrow();

      expect(adapter.callsOf("setBodyType")).toHaveLength(0);
      expect(body.type).toBe("kinematic-position");
      expect(adapter.body(1).type).toBe("kinematic-position");
    });

    it("accepts a switch whose mass the solver can derive from a collider", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("static");
      const body = world.addBody(node);
      // The double reports 0 for a non-dynamic body, exactly as `addBody`'s
      // refresh expects, so the collider is what makes the mass derivable.
      expect(body.mass).toBeUndefined();

      expect(() => world.setBodyControlMode(node, "dynamic")).not.toThrow();
      expect(body.type).toBe("dynamic");
    });

    it("accepts a switch whose mass the solver already reports", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position", { collider: false });
      world.addBody(node);
      adapter.body(1).mass = 3;
      adapter.body(1).type = "dynamic";

      expect(() => world.setBodyControlMode(node, "dynamic")).not.toThrow();
    });

    it("rejects an authored mass that the new type forbids", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("static", { collider: false, mass: 0 });
      world.addBody(node);

      expect(() => world.setBodyControlMode(node, "dynamic")).toThrowError(
        /mass must be positive/,
      );
    });
  });

  describe("velocity inheritance (§19)", () => {
    it("seeds the linear velocity as (position − previousPosition) / dt", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);
      const target = scriptedTarget(
        { position: new Vector3(1, 2, 0) },
        { position: new Vector3(1.25, 1.5, 0) },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
      });

      const seeded = lastSeededVelocities(adapter);
      expect(seeded.linear.x).toBeCloseTo(0.25 * 60, 12);
      expect(seeded.linear.y).toBeCloseTo(-0.5 * 60, 12);
      expect(seeded.linear.z).toBe(0);
    });

    it("seeds the angular velocity as the quaternion-delta axis-angle over dt", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);
      const z = new Vector3(0, 0, 1);
      const target = scriptedTarget(
        { position: new Vector3(), rotation: rotation(z, 0.5) },
        { position: new Vector3(), rotation: rotation(z, 0.7) },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
      });

      const seeded = lastSeededVelocities(adapter);
      // 0.2 rad about +Z in one 1/60 s step.
      expect(seeded.angular.x).toBeCloseTo(0, 12);
      expect(seeded.angular.y).toBeCloseTo(0, 12);
      expect(seeded.angular.z).toBeCloseTo(0.2 * 60, 10);
    });

    it("keeps a planar delta exactly planar (§21)", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);
      const z = new Vector3(0, 0, 1);
      const target = scriptedTarget(
        { position: new Vector3(), rotation: rotation(z, 1.1) },
        { position: new Vector3(), rotation: rotation(z, 1.3) },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
      });

      const seeded = lastSeededVelocities(adapter);
      expect(seeded.angular.x).toBe(0);
      expect(seeded.angular.y).toBe(0);
    });

    it("takes the shortest arc when the delta's w is negative (plan D8)", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);
      const short = rotation(new Vector3(0, 0, 1), 0.2);
      // −q is the same rotation as q; only one of them is the short way round.
      const negated = new Quaternion(-short.x, -short.y, -short.z, -short.w);
      const target = scriptedTarget(
        { position: new Vector3() },
        { position: new Vector3(), rotation: negated },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
      });

      expect(lastSeededVelocities(adapter).angular.z).toBeCloseTo(0.2 * 60, 10);
    });

    it("measures the delta in the world frame, not the body frame", async () => {
      const { adapter, world } = await readyWorld({ dimension: "3d" });
      const node = bodyNode("kinematic-position", { dimension: "3d" });
      world.addBody(node);
      const previous = rotation(new Vector3(1, 0, 0), Math.PI / 2);
      const current = rotation(new Vector3(0, 0, 1), 0.2).multiply(previous);
      const target = scriptedTarget(
        { position: new Vector3(), rotation: previous },
        { position: new Vector3(), rotation: current },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
      });

      const seeded = lastSeededVelocities(adapter);
      expect(seeded.angular.x).toBeCloseTo(0, 9);
      expect(seeded.angular.y).toBeCloseTo(0, 9);
      expect(seeded.angular.z).toBeCloseTo(0.2 * 60, 9);
    });

    it("seeds zero angular velocity for an unrotated target", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);
      const target = scriptedTarget(
        {
          position: new Vector3(),
          rotation: rotation(new Vector3(0, 0, 1), 2),
        },
        {
          position: new Vector3(),
          rotation: rotation(new Vector3(0, 0, 1), 2),
        },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
      });

      const seeded = lastSeededVelocities(adapter);
      expect(seeded.angular.x).toBe(0);
      expect(seeded.angular.y).toBe(0);
      expect(seeded.angular.z).toBe(0);
    });

    it("falls back to the delta of the last step when none is given", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);
      world.step(0.5);
      const target = scriptedTarget(
        { position: new Vector3() },
        { position: new Vector3(2, 0, 0) },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
      });

      expect(lastSeededVelocities(adapter).linear.x).toBeCloseTo(4, 12);
    });

    it("seeds a kinematic-velocity body just as it seeds a dynamic one", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("dynamic");
      world.addBody(node);
      const target = scriptedTarget(
        { position: new Vector3() },
        { position: new Vector3(0, 0.5, 0) },
      );

      world.setBodyControlMode(node, "kinematic-velocity", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
      });

      expect(lastSeededVelocities(adapter).linear.y).toBeCloseTo(30, 12);
    });

    it("survives a step: the seeded velocity is the simulation's initial state", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      const body = world.addBody(node);
      const target = scriptedTarget(
        { position: new Vector3() },
        { position: new Vector3(0.05, 0, 0) },
      );

      world.setBodyControlMode(node, "dynamic", {
        inheritVelocityFrom: target,
        fixedDeltaSeconds: DT,
      });
      world.step(DT);

      expect(body.linearVelocity.x).toBeCloseTo(3, 12);
      expect(node.transform.position.x).toBeCloseTo(3 * DT, 12);
    });

    it("refuses inheritance on a type that carries no velocity", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("dynamic");
      world.addBody(node);
      const target = new PoseTarget();
      adapter.clearCalls();

      for (const type of ["static", "kinematic-position"] as const) {
        expect(() =>
          world.setBodyControlMode(node, type, {
            inheritVelocityFrom: target,
            fixedDeltaSeconds: DT,
          }),
        ).toThrowError(/has no meaning for a/);
      }
      expect(adapter.callsOf("setBodyType")).toHaveLength(0);
    });

    it("refuses inheritance before the first step with no fixedDeltaSeconds", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);

      expect(() =>
        world.setBodyControlMode(node, "dynamic", {
          inheritVelocityFrom: new PoseTarget(),
        }),
      ).toThrowError(/has not stepped yet/);
    });

    it("refuses a non-positive or non-finite fixedDeltaSeconds", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);

      for (const delta of [0, -DT, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          world.setBodyControlMode(node, "dynamic", {
            inheritVelocityFrom: new PoseTarget(),
            fixedDeltaSeconds: delta,
          }),
        ).toThrowError(/fixedDeltaSeconds must be a positive, finite number/);
      }
    });

    it("seeds nothing when no target is given", async () => {
      const { adapter, world } = await readyWorld();
      const node = bodyNode("kinematic-position");
      world.addBody(node);
      adapter.clearCalls();

      world.setBodyControlMode(node, "dynamic");

      expect(adapter.callsOf("setBodyVelocities")).toHaveLength(0);
    });
  });

  describe("what it refuses", () => {
    it("refuses an unregistered node", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("dynamic");

      expect(() => world.setBodyControlMode(node, "static")).toThrowError(
        /is not registered with this PhysicsWorld/,
      );
    });

    it("reports the refusal as a FourError naming the node", async () => {
      const { world } = await readyWorld();
      const node = bodyNode("dynamic");

      try {
        world.setBodyControlMode(node, "static");
        expect.unreachable("setBodyControlMode should have thrown");
      } catch (error) {
        expect(isFourError(error)).toBe(true);
        if (isFourError(error)) {
          expect(error.code).toBe("INVALID_APPLICATION_STATE");
          expect(error.context).toMatchObject({ node: node.id });
        }
      }
    });

    it("refuses before initialize and after dispose", async () => {
      const adapter = new FakeSolverAdapter();
      const world = new PhysicsWorld({ dimension: "2d", adapter });
      const node = bodyNode("dynamic");

      expect(() => world.setBodyControlMode(node, "static")).toThrowError(
        /has not been initialized/,
      );

      await world.initialize();
      world.addBody(node);
      world.dispose();
      expect(() => world.setBodyControlMode(node, "static")).toThrowError(
        /has been disposed/,
      );
    });
  });
});
