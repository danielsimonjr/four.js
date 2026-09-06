/**
 * A-6 — §45's `physics` option, against a real solver (2026-08-08).
 *
 * `packages/four/tests/application.test.ts` proves the composition root's
 * *contract* with a world using a double: construct or accept, initialize once,
 * step then dispatch per fixed step, count bodies after the frame, dispose only
 * what it built. What no unit test in `four` can prove is that the contract is
 * the one a real `PhysicsWorld` on a real Rapier adapter answers to — that is
 * three packages agreeing, so it belongs here.
 *
 * Two claims, and the first is the load-bearing one:
 *
 * 1. **`physics:` composes identically to the hand-wired form.** §97's own
 *    example builds a `PhysicsWorld`, registers a `PhysicsSystem`, and tracks
 *    the world on it; `ApplicationOptions.physics` is meant to be that wiring
 *    and nothing else. So the same scene is run both ways and the two
 *    `world.checksum()` sequences are compared step by step — §33's own
 *    equality, over §34's own recording. A difference of one fixed step, one
 *    dispatch, or one delta would show up in the first frame that moved.
 * 2. **§84's two new counters read what they claim.** `physicsStepTime` is
 *    wall-clock seconds inside `PhysicsWorld.step` and `activeBodies` is §32's
 *    awake count, both taken from an application that really is simulating.
 *
 * Everything goes through the public API — `four/application`,
 * `@four/physics`, `@four/physics-rapier` — and no clock and no `Math.random`
 * drives anything (§33): frames are `app.step(DT)` with a constant delta.
 */

import { Vector3 } from "@four/math";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
} from "@four/physics";
import { Rapier3dAdapter } from "@four/physics-rapier";
import { Group } from "@four/scene";
import { Application } from "four/application";
import { describe, expect, it } from "vitest";

/** One fixed step in seconds (§7a, §10; Appendix A's 1/60). */
const DT = 1 / 60;

/** Frames every scenario runs — enough for the ball to fall visibly. */
const FRAMES = 20;

/** Adds one dynamic sphere at `y`, the §42 authority declared (§23, §24). */
function addBall(world: PhysicsWorld, y: number): Group {
  const node = new Group();
  node.transform.position.set(0, y, 0);
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
  node.addComponent(new Collider({ shape: { type: "sphere", radius: 0.5 } }));
  world.addBody(node);
  return node;
}

/** A world on a fresh Rapier 3D adapter; wasm loads in `initialize`. */
function createWorld(poses?: Application["poses"]): PhysicsWorld {
  return new PhysicsWorld({
    dimension: "3d",
    adapter: new Rapier3dAdapter(),
    gravity: new Vector3(0, -9.81, 0),
    ...(poses === undefined ? {} : { poses }),
  });
}

describe("§45 physics option — composition (A-6)", () => {
  it("steps a real world exactly as a hand-wired PhysicsSystem does (§33)", async () => {
    // (a) §97's form: build the world, register the system, track it.
    const wired = new Application({ fixedTimeStep: DT });
    const wiredSystem = new PhysicsSystem();
    wired.systems.register(wiredSystem);
    const wiredWorld = wiredSystem.track(createWorld());
    await wiredWorld.initialize();
    await wired.initialize();
    wired.start();
    addBall(wiredWorld, 5);

    // (b) A-6's form: hand the application the same world description.
    const composed = new Application({
      fixedTimeStep: DT,
      physics: () => createWorld(),
    });
    await composed.initialize();
    composed.start();
    const composedWorld = composed.physics;
    expect(composedWorld).not.toBeNull();
    addBall(composedWorld as PhysicsWorld, 5);

    const wiredChecksums: number[] = [];
    const composedChecksums: number[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      wired.step(DT);
      composed.step(DT);
      wiredChecksums.push(wiredWorld.checksum());
      composedChecksums.push((composedWorld as PhysicsWorld).checksum());
    }

    // The whole sequence, element by element — the same equality §34's replay
    // suite uses. A dropped dispatch or a doubled step diverges immediately.
    expect(composedChecksums).toEqual(wiredChecksums);
    // …and the run really did simulate something, so the agreement is not two
    // identical do-nothings.
    expect(new Set(wiredChecksums).size).toBe(FRAMES);

    composed.dispose();
    wiredWorld.dispose();
    wired.dispose();
  });

  it("hands the factory the application's §43 pose buffer", async () => {
    const app = new Application({
      fixedTimeStep: DT,
      poseInterpolation: true,
      physics: ({ poses }) => createWorld(poses),
    });
    await app.initialize();
    app.start();
    const node = addBall(app.physics as PhysicsWorld, 3);

    // The world tracked the body in the *application's* buffer, which is the
    // ordering a world constructed before the application could never reach.
    expect(app.poses.has(node)).toBe(true);
    app.step(DT);
    expect(app.poses.has(node)).toBe(true);

    app.dispose();
  });

  it("disposes the world it built, and the adapter with it (§83)", async () => {
    const app = new Application({
      fixedTimeStep: DT,
      physics: () => createWorld(),
    });
    await app.initialize();
    const world = app.physics as PhysicsWorld;
    expect(world.initialized).toBe(true);
    app.dispose();
    expect(world.disposed).toBe(true);
  });

  it("leaves a world it was handed to its author (§83)", async () => {
    const world = createWorld();
    await world.initialize();
    const app = new Application({ fixedTimeStep: DT, physics: world });
    await app.initialize();
    app.dispose();
    expect(world.disposed).toBe(false);
    world.dispose();
  });
});

describe("§84 physics counters — real solver (A-6)", () => {
  it("measures physicsStepTime and activeBodies while simulating", async () => {
    const app = new Application({
      fixedTimeStep: DT,
      stats: true,
      physics: () => createWorld(),
    });
    await app.initialize();
    app.start();
    const world = app.physics as PhysicsWorld;
    addBall(world, 5);
    addBall(world, 8);

    app.step(DT);

    const stats = app.stats;
    expect(stats).not.toBeNull();
    // A real duration in seconds: measured (not `NaN`), non-negative, and far
    // below the frame it sits inside.
    expect(Number.isNaN(stats?.physicsStepTime ?? Number.NaN)).toBe(false);
    expect(stats?.physicsStepTime).toBeGreaterThanOrEqual(0);
    expect(stats?.physicsStepTime).toBeLessThanOrEqual(
      stats?.simulationTime ?? 0,
    );
    // Two falling bodies are two awake bodies (§32).
    expect(stats?.activeBodies).toBe(2);
    // Contacts ride `SolverStatistics.contactCount` (2026-09-06). GPU timestamps
    // still have no producer (§84).
    expect(stats?.contacts).toBeGreaterThanOrEqual(0);
    expect(stats?.gpuFrameTime).toBeNaN();

    app.dispose();
  });

  it("reports the awake count, not the body count, once a body sleeps (§32)", async () => {
    const app = new Application({
      fixedTimeStep: DT,
      stats: true,
      physics: () =>
        new PhysicsWorld({
          dimension: "3d",
          adapter: new Rapier3dAdapter(),
          gravity: new Vector3(0, 0, 0),
          sleeping: { enabled: true },
        }),
    });
    await app.initialize();
    app.start();
    addBall(app.physics as PhysicsWorld, 0);

    // With no gravity and nothing touching it, Rapier puts the body to sleep.
    // Ten seconds of frames, because the adapters honour §32's `enabled` and
    // none of its three thresholds (they have no binding at Rapier 0.19.3), so
    // the solver's own sleep timer decides when — not Appendix A's 0.5 s.
    for (let frame = 0; frame < 600; frame += 1) {
      app.step(DT);
    }

    expect(app.stats?.activeBodies).toBe(0);
    app.dispose();
  });
});
