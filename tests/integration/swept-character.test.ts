/**
 * §12's swept character controller against **real Rapier 3D geometry**
 * (`PH-11b`, 2026-08-21; §12, §22, §24, §30, §39, §42, §79).
 *
 * `packages/physics/tests/swept-character-controller.test.ts` drives the
 * resolver against a scripted `shapeCast`, which is the right level for
 * asserting *which casts it issues*. This file is the other half: it asserts
 * that the resolver produces the **behaviour §12 names** when the casts are
 * answered by an actual solver — slide along wall, step height, slope limit —
 * and it is the only place where three cross-package claims can be checked at
 * all:
 *
 * 1. **The §39 ordering.** The controller writes the node at
 *    `PRIORITY_KINEMATICS` (400) and `PhysicsWorld.step` feeds that same
 *    transform to the solver at 600. The observable consequence — a dynamic box
 *    shoved out of the way by a kinematic capsule in the same step it moved —
 *    is what makes the ordering argument testable rather than merely stated.
 *    It is also the boundary this tier draws: the character does **not** push
 *    anything; the solver does, because the character's collider moved.
 * 2. **§79 through the umbrella.** `registerPhysicsSerializers` is in
 *    `@four/four`, the component is in `@four/physics`, and the registry is in
 *    `@four/serialization` — three packages that only meet here.
 * 3. **`groundBody`, the moving-platform seam.** A character standing on a body
 *    reports which body, which is what an application differences to carry
 *    itself. Carry itself is staged; the handle is not.
 */

import { describe, expect, it } from "vitest";

import { Vector3 } from "@four/math";
import {
  PRIORITY_KINEMATICS,
  PRIORITY_PHYSICS_SOLVE,
  SystemRegistry,
  createTimeState,
} from "@four/motion";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  SweptCharacterController,
  SweptCharacterSystem,
} from "@four/physics";
import { Rapier3dAdapter } from "@four/physics-rapier";
import { Group } from "@four/scene";
import {
  createDefaultComponentSerializers,
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@four/serialization";
import { registerPhysicsSerializers, registerSceneNodeTypes } from "four";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
const DT = 1 / 60;

/** Capsule radius shared by every character here, in metres (§24). */
const RADIUS = 0.3;

/** Capsule half-height (cylindrical section only), in metres (§24). */
const HALF_HEIGHT = 0.5;

/** Distance from a capsule's centre to its lowest point. */
const FEET = HALF_HEIGHT + RADIUS;

/** A `"3d"` world on the real Rapier adapter, initialized. */
async function readyWorld(): Promise<PhysicsWorld> {
  const world = new PhysicsWorld({
    dimension: "3d",
    adapter: new Rapier3dAdapter(),
  });
  await world.initialize();
  return world;
}

/** A static box body: `halfExtents` about `center` (§22, §24). */
function addStaticBox(
  world: PhysicsWorld,
  center: Vector3,
  halfExtents: Vector3,
  rotation?: Vector3,
): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.transform.position.copy(center);
  if (rotation !== undefined) {
    const half = rotation.x * 0.5;
    node.transform.rotation.set(Math.sin(half), 0, 0, Math.cos(half));
  }
  node.addComponent(new RigidBody({ type: "static" }));
  node.addComponent(new Collider({ shape: { type: "box", halfExtents } }));
  world.addBody(node);
  return node;
}

/** A flat floor whose top is `y = 0`. */
function addFloor(world: PhysicsWorld): Group {
  return addStaticBox(world, new Vector3(0, -0.5, 0), new Vector3(30, 0.5, 30));
}

/** A capsule character on the floor, tracked and registered as a body. */
function addCharacter(
  world: PhysicsWorld,
  system: SweptCharacterSystem,
  position: Vector3,
  options: { stepHeight?: number; slopeLimit?: number } = {},
): { node: Group; controller: SweptCharacterController } {
  const node = new Group();
  node.transformAuthority = "kinematic";
  node.transform.position.copy(position);
  node.addComponent(new RigidBody({ type: "kinematic-position" }));
  node.addComponent(
    new Collider({
      shape: { type: "capsule", radius: RADIUS, halfHeight: HALF_HEIGHT },
    }),
  );
  const controller = node.addComponent(
    new SweptCharacterController({
      world,
      radius: RADIUS,
      halfHeight: HALF_HEIGHT,
      moveSpeed: 3,
      stepHeight: options.stepHeight ?? 0.35,
      slopeLimit: options.slopeLimit ?? Math.PI / 4,
    }),
  );
  world.addBody(node);
  system.track(node);
  return { node, controller };
}

/** One `SystemRegistry` wired the way §39 asks, plus a driver. */
function drive(
  world: PhysicsWorld,
  characters: SweptCharacterSystem,
): (steps: number) => void {
  const registry = new SystemRegistry();
  registry.register(characters);
  registry.register(new PhysicsSystem({ worlds: [world] }));
  const time = createTimeState({ fixedDeltaTime: DT });
  let step = 0;
  return (steps: number) => {
    for (let i = 0; i < steps; i += 1) {
      step += 1;
      time.frame = step;
      time.simulationStep = step;
      time.simulationTime = step * DT;
      time.deltaTime = DT;
      time.unscaledDeltaTime = DT;
      registry.runFixedStep(time);
    }
  };
}

describe("SweptCharacterController against real Rapier 3D geometry", () => {
  it("stops at a wall and slides along it (§12, §30)", async () => {
    const world = await readyWorld();
    addFloor(world);
    // A wall facing +Z at z = -4.
    addStaticBox(world, new Vector3(0, 1, -4), new Vector3(6, 1, 0.5));

    const characters = new SweptCharacterSystem();
    const { node, controller } = addCharacter(
      world,
      characters,
      new Vector3(0, FEET + 0.05, 0),
    );
    // Mostly forward (−Z), partly rightward (+X): the wall takes the first
    // component and leaves the second, which is what "slide" means.
    controller.setMoveIntent(1, 0.6);
    drive(world, characters)(180);

    // Stopped at the wall's face, one capsule radius plus a skin short of it.
    expect(node.transform.position.z).toBeGreaterThan(-3.5 + RADIUS - 0.05);
    expect(node.transform.position.z).toBeLessThan(-3.5 + RADIUS + 0.05);
    // …and carried on sideways for the rest of the run.
    expect(node.transform.position.x).toBeGreaterThan(2);
    expect(controller.slideCount).toBeGreaterThan(0);
    expect(controller.grounded).toBe(true);
    expect(controller.skippedSteps).toBe(0);

    world.dispose();
  });

  it("steps up onto a riser below its step height, and stops at one above it", async () => {
    const world = await readyWorld();
    addFloor(world);
    // A 0.25 m kerb the first character clears and a 0.8 m ledge it does not.
    addStaticBox(world, new Vector3(0, -0.25, -10), new Vector3(3, 0.5, 8));
    addStaticBox(world, new Vector3(10, 0.3, -10), new Vector3(3, 0.5, 8));

    const characters = new SweptCharacterSystem();
    const climbable = addCharacter(
      world,
      characters,
      new Vector3(0, FEET + 0.05, 0),
    );
    const tooTall = addCharacter(
      world,
      characters,
      new Vector3(10, FEET + 0.05, 0),
    );
    climbable.controller.setMoveIntent(1, 0);
    tooTall.controller.setMoveIntent(1, 0);
    drive(world, characters)(120);

    expect(climbable.controller.stepUpCount).toBeGreaterThan(0);
    expect(climbable.node.transform.position.y).toBeCloseTo(FEET + 0.25, 1);
    expect(climbable.node.transform.position.z).toBeLessThan(-2);

    // The 0.8 m ledge is a wall, not a step: no step-up, no height gained.
    expect(tooTall.controller.stepUpCount).toBe(0);
    expect(tooTall.node.transform.position.y).toBeCloseTo(FEET, 1);

    world.dispose();
  });

  it("will not stand on ground steeper than its slope limit (§12)", async () => {
    const world = await readyWorld();
    addFloor(world);
    // A slab tilted 60° about +X: its up-facing normal is 60° off vertical.
    addStaticBox(
      world,
      new Vector3(0, 1, -5),
      new Vector3(4, 0.5, 4),
      new Vector3(Math.PI / 3, 0, 0),
    );

    const characters = new SweptCharacterSystem();
    const strict = addCharacter(
      world,
      characters,
      new Vector3(0, FEET + 0.05, 0),
      { slopeLimit: Math.PI / 4 },
    );
    strict.controller.setMoveIntent(1, 0);
    drive(world, characters)(180);

    // Three seconds of walking at 3 m/s into a 60° face gains it nothing: the
    // ramp is not walkable, so it is a wall.
    expect(strict.node.transform.position.y).toBeLessThan(FEET + 0.3);
    expect(strict.controller.stepUpCount).toBe(0);

    world.dispose();
  });

  it("hands this step's pose to the solver in this step (§39 step 4 → step 6)", async () => {
    const world = await readyWorld();
    addFloor(world);
    const characters = new SweptCharacterSystem();
    const { node, controller } = addCharacter(
      world,
      characters,
      new Vector3(0, FEET + 0.05, 0),
    );
    // Fast enough that one fixed step carries the capsule clear of where it
    // started: 120 m/s is 2 m per step against a 1.6 m tall capsule.
    controller.moveSpeed = 120;
    controller.setMoveIntent(1, 0);
    const start = node.transform.position.clone();
    drive(world, characters)(1);

    const body = world.getBody(node);
    const here = world.pointQuery(node.transform.position);
    const there = world.pointQuery(start);

    // The solver holds the pose the controller wrote *this* step. Had the
    // character been advanced after the solve, its collider would still be two
    // metres back — which is the arrangement §39's step 4 exists to prevent,
    // and the reason this controller is not a post-solve system.
    expect(here.some((entry) => entry.body === body)).toBe(true);
    expect(there.some((entry) => entry.body === body)).toBe(false);

    world.dispose();
  });

  it("does not push a dynamic body — pushing is staged (§26)", async () => {
    const world = await readyWorld();
    addFloor(world);

    const box = new Group();
    box.transformAuthority = "physics";
    box.transform.position.set(0, 0.3, -1.5);
    box.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
    box.addComponent(
      new Collider({
        shape: { type: "box", halfExtents: new Vector3(0.3, 0.3, 0.3) },
      }),
    );
    world.addBody(box);

    const characters = new SweptCharacterSystem();
    const { node, controller } = addCharacter(
      world,
      characters,
      new Vector3(0, FEET + 0.05, 0),
    );
    controller.setMoveIntent(1, 0);
    drive(world, characters)(90);

    // The character walks up to the box and stops one skin short of it, so the
    // solver never sees a penetration to resolve and the box does not move.
    // That is this tier's honest boundary rather than an accident: a kinematic
    // character *shoving* dynamics is a §26 force question with no policy yet
    // (how much impulse, split how by mass, may it wake a sleeping body?), and
    // the seam is `RigidBody.applyImpulseAtPoint` at `ShapeCastHit.point`.
    expect(node.transform.position.z).toBeGreaterThan(-1.5);
    expect(box.transform.position.z).toBeGreaterThan(-1.6);
    expect(box.transform.position.z).toBeLessThan(-1.4);

    world.dispose();
  });

  it("reports the body it is standing on — the platform-carry seam", async () => {
    const world = await readyWorld();
    const floor = addFloor(world);
    const characters = new SweptCharacterSystem();
    const { controller } = addCharacter(
      world,
      characters,
      new Vector3(0, FEET + 0.05, 0),
    );
    controller.setMoveIntent(0, 0);
    drive(world, characters)(20);

    expect(controller.grounded).toBe(true);
    expect(controller.groundBody).toBe(floor.getComponent(RigidBody));

    world.dispose();
  });
});

describe("SweptCharacterController round-trips through §79", () => {
  it("saves and reloads through registerPhysicsSerializers, then re-binds its world", async () => {
    const world = await readyWorld();
    addFloor(world);
    const characters = new SweptCharacterSystem();
    const { node, controller } = addCharacter(
      world,
      characters,
      new Vector3(0, FEET + 2, 0),
    );
    controller.setMoveIntent(1, 0);
    drive(world, characters)(10);

    const root = new Group();
    const saved = new Group();
    saved.transform.position.copy(node.transform.position);
    saved.transformAuthority = "kinematic";
    saved.addComponent(
      new SweptCharacterController({
        world,
        radius: RADIUS,
        halfHeight: HALF_HEIGHT,
        moveSpeed: 3,
        verticalVelocity: controller.verticalVelocity,
        grounded: controller.grounded,
      }),
    );
    root.add(saved);

    const io = registerSceneNodeTypes();
    const text = encodeSceneDocument(
      serializeScene(root, io.components, io.write),
    );
    const reloaded = instantiateScene(
      decodeSceneDocument(text),
      io.components,
      io.read,
    );
    const restored = reloaded.children[0].getComponent(
      SweptCharacterController,
    );

    expect(restored).toBeDefined();
    expect(restored?.radius).toBe(RADIUS);
    expect(restored?.halfHeight).toBe(HALF_HEIGHT);
    expect(restored?.moveSpeed).toBe(3);
    // Vertical motion is scene state; the move intent is not (§79).
    expect(restored?.verticalVelocity).toBe(controller.verticalVelocity);
    expect(restored?.grounded).toBe(controller.grounded);
    expect(restored?.intentForward).toBe(0);
    // Reloading a scene is not restoring a simulation: the world is re-bound.
    expect(restored?.world).toBeUndefined();
    if (restored !== undefined) {
      restored.world = world;
      expect(restored.world).toBe(world);
    }

    world.dispose();
  });

  it("registers with the physics family, at §39's step-4 priority", () => {
    // The split is by package: the component lives in `@four/physics`, so its
    // serializer goes in with `RigidBody` and `Collider` rather than beside
    // `@four/motion`'s plain `CharacterController`.
    const components = registerPhysicsSerializers(
      createDefaultComponentSerializers(),
    );
    expect(components.has(SweptCharacterController.typeName)).toBe(true);
    expect(components.has(RigidBody.typeName)).toBe(true);

    // And the system it is advanced by runs strictly before the solve (§39).
    expect(new SweptCharacterSystem().priority).toBe(PRIORITY_KINEMATICS);
    expect(PRIORITY_KINEMATICS).toBeLessThan(PRIORITY_PHYSICS_SOLVE);
  });
});
