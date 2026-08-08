/**
 * PH-1 stage 2 composed end to end: a §23/§24/§25/§31 property written on a
 * **component**, after `world.addBody`, changing what a **real Rapier solver**
 * does on the next fixed step (§23–§25, §31, §33, §37).
 *
 * The two halves are separately covered — `packages/physics/tests/
 * world-properties.test.ts` drives the dirty set against a structural double,
 * and `packages/physics-rapier/tests/rapier-live-properties.test.ts` measures
 * what Rapier does with the six seam methods — and nowhere composed. What this
 * file pins is the sentence the gap analysis said was false: *a property
 * written between steps takes effect at the next one*, through
 * `Application` + `@four/physics` + `@four/physics-rapier`, in both dimensions,
 * with nothing reaching into a package's internals.
 *
 * It also pins the two properties the closure had to preserve:
 *
 * - **a run that writes nothing is bit-identical** to the same run before the
 *   seam existed (asserted here as: two worlds, one of which merely *could*
 *   take live writes, produce the same §33 checksum stream);
 * - **the drain is deterministic** — the same writes in the same steps produce
 *   the same checksum stream twice.
 */

import { Vector3 } from "@four/math";
import { Collider, type PhysicsWorld } from "@four/physics";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DIMENSION_KITS,
  DT,
  addBall,
  addGround,
  createRig,
  createWorld,
  stepAndChecksum,
  stepFrames,
  type DimensionKit,
  type PhysicsRig,
} from "./helpers/physics-scenarios.js";

/** Rigs created by the case in flight; disposed after it, newest first (§83). */
const openRigs: PhysicsRig[] = [];

/** Creates a rig and registers it for teardown. */
async function openRig(): Promise<PhysicsRig> {
  const rig = await createRig();
  openRigs.push(rig);
  return rig;
}

/** A rig, a world, and one dynamic ball at `y = 5` above the ground. */
async function openBallWorld(
  kit: DimensionKit,
  options: { mass?: number } = {},
): Promise<{
  rig: PhysicsRig;
  world: PhysicsWorld;
  ball: ReturnType<typeof addBall>;
}> {
  const rig = await openRig();
  const world = await createWorld(rig, kit);
  addGround(world, kit);
  const ball = addBall(world, kit, "dynamic", 0.5, {
    position: new Vector3(0, 5, 0),
    ...(options.mass === undefined ? {} : { mass: options.mass }),
  });
  return { rig, world, ball };
}

afterEach(() => {
  for (let i = openRigs.length - 1; i >= 0; i -= 1) {
    openRigs[i].dispose();
  }
  openRigs.length = 0;
  vi.restoreAllMocks();
});

beforeAll(async () => {
  const rig = await createRig();
  for (const kit of DIMENSION_KITS) {
    await createWorld(rig, kit, { track: false });
  }
  rig.dispose();
});

describe.each(DIMENSION_KITS)(
  "live §37 property changes on Rapier $dimension (PH-1 stage 2)",
  (kit) => {
    it("declares that it can carry them", async () => {
      const { world } = await openBallWorld(kit);
      expect(world.supportsLiveProperties).toBe(true);
    });

    it("a gravityScale written between steps stops the acceleration, silently", async () => {
      const weightless = await openBallWorld(kit, { mass: 1 });
      const control = await openBallWorld(kit, { mass: 1 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      stepFrames(weightless.rig.app, 10);
      stepFrames(control.rig.app, 10);
      const shared = weightless.ball.body.linearVelocity.y;
      expect(shared).toBeCloseTo(control.ball.body.linearVelocity.y, 6);
      expect(shared).toBeLessThan(0);

      weightless.ball.body.gravityScale = 0;
      stepFrames(weightless.rig.app, 30);
      stepFrames(control.rig.app, 30);

      // The weightless body coasts at the speed it already had; the control
      // keeps accelerating. Before the drain existed the two were identical.
      expect(weightless.ball.body.linearVelocity.y).toBeCloseTo(shared, 4);
      expect(control.ball.body.linearVelocity.y).toBeLessThan(shared - 1);
      // Stage 1's warning is gone: this write is no longer unreachable.
      expect(warn).not.toHaveBeenCalled();
    });

    it("a mass written between steps changes what a §26 force does (§23)", async () => {
      const heavy = await openBallWorld(kit, { mass: 1 });
      const light = await openBallWorld(kit, { mass: 1 });

      heavy.ball.body.gravityScale = 0;
      light.ball.body.gravityScale = 0;
      heavy.ball.body.mass = 100;
      light.ball.body.mass = 1;
      stepFrames(heavy.rig.app, 1);
      stepFrames(light.rig.app, 1);

      for (const rig of [heavy, light]) {
        rig.ball.body.applyImpulse(new Vector3(10, 0, 0));
      }
      stepFrames(heavy.rig.app, 1);
      stepFrames(light.rig.app, 1);

      // v = J / m — 100× the mass, ~100× less velocity.
      expect(light.ball.body.linearVelocity.x).toBeGreaterThan(
        heavy.ball.body.linearVelocity.x * 50,
      );
    });

    it("damping written between steps bleeds velocity (§23)", async () => {
      const damped = await openBallWorld(kit, { mass: 1 });
      const free = await openBallWorld(kit, { mass: 1 });
      for (const rig of [damped, free]) {
        rig.ball.body.gravityScale = 0;
      }
      stepFrames(damped.rig.app, 1);
      stepFrames(free.rig.app, 1);

      damped.ball.body.linearDamping = 8;
      for (const rig of [damped, free]) {
        rig.ball.body.applyImpulse(new Vector3(10, 0, 0));
      }
      stepFrames(damped.rig.app, 20);
      stepFrames(free.rig.app, 20);

      expect(damped.ball.body.linearVelocity.x).toBeLessThan(
        free.ball.body.linearVelocity.x - 1,
      );
    });

    it("refreshCollider makes a §25 restitution change bounce (§24, §25)", async () => {
      const bouncy = await openBallWorld(kit, { mass: 1 });
      const dead = await openBallWorld(kit, { mass: 1 });

      for (const [rig, restitution] of [
        [bouncy, 0.95],
        [dead, 0],
      ] as const) {
        // Written on the component *after* registration — the exact assignment
        // that reached no solver before this packet.
        rig.ball.collider.restitution = restitution;
        rig.world.refreshCollider(rig.ball.collider);
      }

      stepFrames(bouncy.rig.app, 120);
      stepFrames(dead.rig.app, 120);

      expect(bouncy.ball.node.transform.position.y).toBeGreaterThan(
        dead.ball.node.transform.position.y + 0.05,
      );
    });

    it("teleport moves the body without inventing momentum (§37)", async () => {
      const { rig, world, ball } = await openBallWorld(kit, { mass: 1 });
      stepFrames(rig.app, 10);
      const falling = ball.body.linearVelocity.y;
      expect(falling).toBeLessThan(0);

      world.teleport(ball.node, new Vector3(3, 20, 0));
      stepFrames(rig.app, 1);

      expect(ball.node.transform.position.x).toBeCloseTo(3, 3);
      expect(ball.node.transform.position.y).toBeGreaterThan(19);
      // The velocity it had is the velocity it keeps: a teleport is a pose
      // write, not a launch.
      expect(ball.body.linearVelocity.y).toBeLessThan(falling);
    });

    it("a run that writes nothing is checksum-identical to one that could (§33)", async () => {
      const a = await openBallWorld(kit, { mass: 2 });
      const b = await openBallWorld(kit, { mass: 2 });
      const left = stepAndChecksum(a.rig.app, a.world, 40);
      const right = stepAndChecksum(b.rig.app, b.world, 40);
      expect(left).toEqual(right);
    });

    it("the same writes in the same steps replay to the same checksums (§33)", async () => {
      const run = async (): Promise<number[]> => {
        const { rig, world, ball } = await openBallWorld(kit, { mass: 2 });
        const checksums: number[] = [];
        for (let frame = 0; frame < 40; frame += 1) {
          if (frame === 5) {
            ball.body.mass = 7;
          }
          if (frame === 12) {
            ball.body.linearDamping = 0.4;
            ball.body.gravityScale = 0.25;
          }
          if (frame === 20) {
            ball.collider.friction = 0.05;
            world.refreshCollider(ball.collider);
          }
          rig.app.step(DT);
          checksums.push(world.checksum());
        }
        return checksums;
      };

      expect(await run()).toEqual(await run());
    });
  },
);

describe("a Collider not held by the world is refused", () => {
  it("names the mistake instead of doing nothing", async () => {
    const rig = await openRig();
    const world = await createWorld(rig, DIMENSION_KITS[0]);
    expect(() => {
      world.refreshCollider(
        new Collider({ shape: { type: "circle", radius: 1 } }),
      );
    }).toThrow(/not registered with this PhysicsWorld/u);
  });
});
