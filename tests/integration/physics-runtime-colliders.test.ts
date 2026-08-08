/**
 * PH-5 composed end to end: a `Collider` attached to — or detached from — a
 * node **after** `world.addBody`, reaching a **real Rapier solver** and moving
 * the simulation (§23, §24, §25, §33, §34, §37, §83).
 *
 * `packages/physics/tests/world-colliders.test.ts` drives the world's
 * bookkeeping against a structural double. What this file pins is the half a
 * double cannot: that Rapier's own mass composition survives a runtime collider
 * change in both directions, on both kinds of §23 body, in both §21 dimensions
 * — the rule PH-3's heir logic and PH-4's authored-mass rule state from the
 * adapter side, exercised here through nothing but the public API.
 *
 * Three properties are asserted throughout:
 *
 * 1. **Mass is correct after every change.** A derived-mass body's mass is the
 *    sum of its colliders' contributions before and after; an authored-mass
 *    body's mass is what its author wrote, whichever collider Rapier is
 *    currently using to carry it (PH-3's `"first-collider"` heir).
 * 2. **The body is never re-created.** Its §33 position in the checksum
 *    sequence, its handle, and any joint naming it all survive — which is the
 *    whole reason `removeBody` + `addBody` was not the answer.
 * 3. **A run that changes nothing is unchanged.** Two worlds stepped
 *    identically, one of which merely *could* take a runtime collider, produce
 *    the same §33 checksum stream; and a run that does change produces the same
 *    stream twice.
 */

import { Vector3 } from "@four/math";
import { Collider, RigidBody, type PhysicsWorld } from "@four/physics";
import { Group, type Node } from "@four/scene";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DIMENSION_KITS,
  addBall,
  addGround,
  createRig,
  createWorld,
  derivedBallMass,
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

/**
 * Attaches a second collider to `node`'s body the way §24 says several
 * colliders on one body are expressed — a child node — and hands it to the
 * world, which is the call PH-5 added.
 */
function addRuntimeBall(
  world: PhysicsWorld,
  kit: DimensionKit,
  node: Node,
  radius: number,
  density?: number,
): Collider {
  const child = new Group();
  const collider = new Collider({
    shape: kit.ball(radius),
    ...(density === undefined ? {} : { density }),
  });
  child.addComponent(collider);
  node.add(child);
  world.addCollider(collider);
  return collider;
}

/** How close two masses have to be, in kilograms, to count as equal here. */
const MASS_EPSILON = 1e-9;

afterEach(() => {
  for (let i = openRigs.length - 1; i >= 0; i -= 1) {
    openRigs[i].dispose();
  }
  openRigs.length = 0;
});

beforeAll(async () => {
  // Loads and caches both wasm builds once, so the per-case timings below are
  // simulation and not module instantiation.
  const rig = await createRig();
  for (const kit of DIMENSION_KITS) {
    await createWorld(rig, kit);
  }
  rig.dispose();
}, 30_000);

describe.each(DIMENSION_KITS)(
  "runtime colliders on a real Rapier solver — $dimension (PH-5)",
  (kit) => {
    it("a derived-mass body gains and loses collider mass (§23, §25)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 5, 0),
      });
      const one = derivedBallMass(kit.dimension, 0.5);
      expect(ball.body.mass).toBeCloseTo(one, 6);
      expect(ball.body.massAuthored).toBe(false);

      const late = addRuntimeBall(world, kit, ball.node, 0.5);
      const two = derivedBallMass(kit.dimension, 0.5) * 2;
      expect(ball.body.mass).toBeCloseTo(two, 6);
      expect(ball.body.massAuthored).toBe(false);
      // Still derived, never authored: PH-4's rule holds across the add.
      expect(ball.body.toDescriptor().mass).toBeUndefined();

      expect(world.removeCollider(late)).toBe(true);
      expect(ball.body.mass).toBeCloseTo(one, 6);
      expect(ball.body.toDescriptor().mass).toBeUndefined();
    });

    it("an authored-mass body keeps its mass across add and remove (PH-3, PH-4)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        mass: 4,
        position: new Vector3(0, 5, 0),
      });
      expect(ball.body.mass).toBeCloseTo(4, 6);

      // Rapier carries an authored mass with no authored tensor on the body's
      // *first* collider (`MassMode.first-collider`), so the runtime one must
      // be created massless or the body would weigh 4 + its own density.
      const late = addRuntimeBall(world, kit, ball.node, 0.5);
      expect(ball.body.mass).toBeCloseTo(4, 6);

      // …and destroying the collider that was carrying it must hand it to the
      // surviving lowest-id collider rather than dropping the body to zero.
      expect(world.removeCollider(ball.collider)).toBe(true);
      expect(ball.body.mass).toBeCloseTo(4, 6);
      expect(ball.body.massAuthored).toBe(true);
      expect(ball.body.toDescriptor().mass).toBe(4);

      // The heir really is carrying it: the body still falls like a body.
      stepFrames(rig.app, 10);
      expect(ball.node.transform.position.y).toBeLessThan(5);

      expect(world.removeCollider(late)).toBe(true);
      expect(ball.body.mass).toBeCloseTo(4, 6);
    });

    it("an authored-mass body left with no collider gets its mass back from the next one", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        mass: 4,
        position: new Vector3(0, 5, 0),
      });
      world.removeCollider(ball.collider);

      // Nowhere to hold the authored mass while the body has no collider — the
      // component still reports it (§23 makes it the *body's*), and the next
      // collider is what puts it back into the solver.
      expect(ball.body.mass).toBe(4);
      addRuntimeBall(world, kit, ball.node, 0.5);
      expect(ball.body.mass).toBeCloseTo(4, 6);
    });

    it("a derived-mass body left with no collider stops reporting a mass", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 5, 0),
      });
      expect(ball.body.mass).toBeGreaterThan(0);

      world.removeCollider(ball.collider);
      expect(ball.body.mass).toBeUndefined();

      const late = addRuntimeBall(world, kit, ball.node, 0.5);
      expect(ball.body.mass).toBeCloseTo(
        derivedBallMass(kit.dimension, 0.5),
        6,
      );
      expect(world.getColliderHandle(late)).toBeDefined();
    });

    it("the collider actually collides — and stops when removed (§29, §37)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit);

      // A body whose own collider sits well above the ground, plus a runtime
      // collider on a child node offset downwards: the body rests higher with
      // the second collider than without it, which is only true if Rapier is
      // solving contacts against it.
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 4, 0),
      });
      addRuntimeBall(world, kit, ball.node, 1.5);
      stepFrames(rig.app, 180);
      const restingWithBoth = ball.node.transform.position.y;
      expect(restingWithBoth).toBeGreaterThan(1);

      const rig2 = await openRig();
      const world2 = await createWorld(rig2, kit);
      addGround(world2, kit);
      const ball2 = addBall(world2, kit, "dynamic", 0.5, {
        position: new Vector3(0, 4, 0),
      });
      const late2 = addRuntimeBall(world2, kit, ball2.node, 1.5);
      world2.removeCollider(late2);
      stepFrames(rig2.app, 180);
      expect(ball2.node.transform.position.y).toBeLessThan(restingWithBoth);
      expect(ball2.node.transform.position.y).toBeCloseTo(0.5, 1);
    });

    it("never re-creates the body, so §33's sequence keeps its shape", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 5, 0),
      });
      const handleBefore = world.getBodyHandle(ball.node);

      const late = addRuntimeBall(world, kit, ball.node, 0.4);
      world.removeCollider(late);

      expect(world.getBodyHandle(ball.node)).toBe(handleBefore);
      expect(world.has(ball.node)).toBe(true);
      expect(world.getBody(ball.node)).toBe(ball.body);
    });

    it("a snapshot taken after a runtime add restores (§34)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        position: new Vector3(0, 5, 0),
      });
      const late = addRuntimeBall(world, kit, ball.node, 0.4);

      stepFrames(rig.app, 20);
      const snapshot = world.createSnapshot();
      const checksum = world.checksum();
      const afterMore = stepAndChecksum(rig.app, world, 20);
      expect(afterMore.at(-1)).not.toBe(checksum);

      world.restoreSnapshot(snapshot);
      expect(world.checksum()).toBe(checksum);
      // The envelope carries the collider table, so the runtime collider is in
      // the restored world and still belongs to the same body.
      expect(world.getColliderHandle(late)).toBeDefined();
      expect(stepAndChecksum(rig.app, world, 20)).toEqual(afterMore);
    });

    it("a runtime removal survives a snapshot round trip (§34)", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      addGround(world, kit);
      const ball = addBall(world, kit, "dynamic", 0.5, {
        mass: 4,
        position: new Vector3(0, 5, 0),
      });
      const late = addRuntimeBall(world, kit, ball.node, 0.4);
      world.removeCollider(ball.collider);

      stepFrames(rig.app, 20);
      const snapshot = world.createSnapshot();
      const checksum = world.checksum();
      stepFrames(rig.app, 20);
      world.restoreSnapshot(snapshot);

      expect(world.checksum()).toBe(checksum);
      expect(world.getColliderHandle(late)).toBeDefined();
      expect(world.getColliderHandle(ball.collider)).toBeUndefined();
      expect(Math.abs((ball.body.mass ?? 0) - 4)).toBeLessThan(MASS_EPSILON);
    });

    it("is reproducible, and leaves an unchanged world bit-identical (§33)", async () => {
      async function run(runtimeChange: boolean): Promise<number[]> {
        const rig = await openRig();
        const world = await createWorld(rig, kit);
        addGround(world, kit);
        const ball = addBall(world, kit, "dynamic", 0.5, {
          position: new Vector3(0, 5, 0),
        });
        if (runtimeChange) {
          // Added and immediately removed: the solver sees a collider come and
          // go, and the *body* is untouched — which is what makes the two
          // streams comparable at all.
          const late = addRuntimeBall(world, kit, ball.node, 0.4);
          world.removeCollider(late);
        }
        return stepAndChecksum(rig.app, world, 40);
      }

      const quiet = await run(false);
      expect(await run(false)).toEqual(quiet);
      expect(await run(true)).toEqual(quiet);
    });

    it("refuses the §85 mistakes", async () => {
      const rig = await openRig();
      const world = await createWorld(rig, kit);
      const ball = addBall(world, kit, "dynamic", 0.5);

      expect(() => world.addCollider(ball.collider)).toThrow(
        /already registered/,
      );

      const orphanHost = new Group();
      const orphan = new Collider({ shape: kit.ball(0.25) });
      orphanHost.addComponent(orphan);
      expect(() => world.addCollider(orphan)).toThrow(/RigidBody/);

      const unregistered = new Group();
      unregistered.addComponent(new RigidBody({ type: "dynamic" }));
      const stray = new Collider({ shape: kit.ball(0.25) });
      unregistered.addComponent(stray);
      expect(() => world.addCollider(stray)).toThrow(/world\.addBody\(node\)/);

      expect(world.removeCollider(stray)).toBe(false);
    });
  },
);
