/**
 * Runtime body re-typing on the **real** Rapier wasm, in both dimensions
 * (§19, §22, §33, §110; plan P7-3, WP-7.2).
 *
 * `SolverBodyAccess.setBodyType` only means anything if the underlying solver
 * really can swap a live body between §22's models without losing it, so this
 * file measures exactly that against `@dimforge/rapier2d-compat` and
 * `@dimforge/rapier3d-compat` 0.19.3 rather than against a double. What
 * `@four/physics` builds on top — the mass rule, the pipeline re-routing, the
 * inheritance arithmetic — is proved over the structural double in
 * `@four/physics`'s `world-transitions.test.ts`; a `PhysicsWorld` cannot be
 * built here, because it needs `@four/scene` and this package does not depend
 * on it.
 *
 * ## What was verified about Rapier itself (2026-08-02, 0.19.3, both builds)
 *
 * `RigidBody.prototype.setBodyType` is a function of arity 2 —
 * `(type: RigidBodyType, wakeUp: boolean)`, `wakeUp` **required** — and
 * `RigidBodyType` is `Dynamic = 0`, `Fixed = 1`, `KinematicPositionBased = 2`,
 * `KinematicVelocityBased = 3` in both packages. The tests below pin the
 * consequences: the handle, the id, the iteration order, the colliders, the
 * pose, and the mass all survive a switch.
 *
 * ## The integration form these tests are written against
 *
 * As in the two adapter suites, `World.step` runs `numSolverIterations = 4`
 * substeps of `dt / 4`, so free fall after `N` steps is
 * `g · h² · K(K+1)/2` with `h = dt/4` and `K = 4N` — not `g · dt² · N(N+1)/2`.
 * Rapier stores state in 32-bit floats, which is why velocity comparisons here
 * carry a `1e-6` absolute tolerance.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector2, Vector3 } from "@four/math";
import type { BodyType, PhysicsBodyHandle } from "@four/physics";
import { beforeAll, describe, expect, it } from "vitest";

import { initializeRapier2d, initializeRapier3d } from "../src/init.js";
import { Rapier2dAdapter } from "../src/rapier2d-adapter.js";
import { Rapier3dAdapter } from "../src/rapier3d-adapter.js";

/** One fixed step (§10). Seconds, like every duration in this engine (§7a). */
const DT = 1 / 60;

/** Appendix A gravity. */
const GRAVITY_Y = -9.81;

/** Rapier 0.19.3's default `World.numSolverIterations`. */
const SUBSTEPS = 4;

/** The float32 tolerance every velocity comparison below is held to. */
const EPSILON = 1e-6;

/** Free-fall displacement after `steps` steps, in Rapier's substepped form. */
function fallDistance(steps: number): number {
  const h = DT / SUBSTEPS;
  const k = steps * SUBSTEPS;
  return (GRAVITY_Y * h * h * k * (k + 1)) / 2;
}

/**
 * The one shape of adapter both dimensions expose to this file — the
 * `SolverBodyAccess` members it exercises, minus everything dimension-specific.
 */
interface RetypeAdapter {
  createBody(desc: {
    type: BodyType;
    position?: Vector2 | Vector3;
  }): PhysicsBodyHandle;
  createCollider(desc: {
    body: PhysicsBodyHandle;
    shape: { type: "circle" | "sphere"; radius: number };
  }): unknown;
  step(delta: number): void;
  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void;
  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void;
  setBodyVelocities(
    handle: PhysicsBodyHandle,
    linear: Vector3,
    angular: Vector3,
    wake?: boolean,
  ): void;
  setBodyType(handle: PhysicsBodyHandle, type: BodyType, wake?: boolean): void;
  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3,
    rotation?: Quaternion,
  ): void;
  sleepBody(handle: PhysicsBodyHandle): void;
  isBodySleeping(handle: PhysicsBodyHandle): boolean;
  getBodyMass(handle: PhysicsBodyHandle): number;
  getBodyId(handle: PhysicsBodyHandle): number;
  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void;
  destroyBody(handle: PhysicsBodyHandle): void;
  dispose(): void;
}

/** One dimension's fixtures: how to build an adapter and a ball of radius r. */
interface DimensionKit {
  readonly dimension: "2d" | "3d";
  create(): Promise<RetypeAdapter>;
  position(x: number, y: number): Vector2 | Vector3;
  ball(radius: number): { type: "circle" | "sphere"; radius: number };
}

const KIT_2D: DimensionKit = {
  dimension: "2d",
  async create() {
    const adapter = new Rapier2dAdapter();
    await adapter.initialize({ dimension: "2d" });
    return adapter;
  },
  position(x, y) {
    return new Vector2(x, y);
  },
  ball(radius) {
    return { type: "circle", radius };
  },
};

const KIT_3D: DimensionKit = {
  dimension: "3d",
  async create() {
    const adapter = new Rapier3dAdapter();
    await adapter.initialize({ dimension: "3d" });
    return adapter;
  },
  position(x, y) {
    return new Vector3(x, y, 0);
  },
  ball(radius) {
    return { type: "sphere", radius };
  },
};

/** Creates a body of `type` at `(x, y)` carrying one unit-density ball. */
function ballBody(
  adapter: RetypeAdapter,
  kit: DimensionKit,
  type: BodyType,
  x: number,
  y: number,
  options: { collider?: boolean } = {},
): PhysicsBodyHandle {
  const handle = adapter.createBody({ type, position: kit.position(x, y) });
  if (options.collider !== false) {
    adapter.createCollider({ body: handle, shape: kit.ball(0.5) });
  }
  return handle;
}

/** The body's world position, freshly read. */
function positionOf(
  adapter: RetypeAdapter,
  handle: PhysicsBodyHandle,
): Vector3 {
  const position = new Vector3();
  adapter.getBodyTransform(handle, position, new Quaternion());
  return position;
}

/** The body's linear velocity, freshly read. */
function linearOf(adapter: RetypeAdapter, handle: PhysicsBodyHandle): Vector3 {
  const linear = new Vector3();
  adapter.getBodyVelocities(handle, linear, new Vector3());
  return linear;
}

beforeAll(async () => {
  await initializeRapier2d();
  await initializeRapier3d();
}, 30_000);

describe.each([KIT_2D, KIT_3D])(
  "runtime body re-typing on rapier$dimension",
  (kit: DimensionKit) => {
    it("stops a dynamic body simulating when it becomes kinematic-position", async () => {
      const adapter = await kit.create();
      const handle = ballBody(adapter, kit, "dynamic", 0, 5);

      for (let i = 0; i < 5; i += 1) {
        adapter.step(DT);
      }
      const fallen = positionOf(adapter, handle);
      expect(fallen.y).toBeCloseTo(5 + fallDistance(5), 5);

      adapter.setBodyType(handle, "kinematic-position");
      for (let i = 0; i < 20; i += 1) {
        adapter.step(DT);
      }

      // Frozen exactly: a kinematic body is not integrated at all.
      expect(positionOf(adapter, handle).y).toBe(fallen.y);
      expect(linearOf(adapter, handle).y).toBe(0);
      adapter.dispose();
    });

    it("follows setNextKinematicTransform once it is kinematic-position", async () => {
      const adapter = await kit.create();
      const handle = ballBody(adapter, kit, "dynamic", 0, 5);
      adapter.setBodyType(handle, "kinematic-position");

      adapter.setNextKinematicTransform(handle, new Vector3(2, 5, 0));
      adapter.step(DT);

      const moved = positionOf(adapter, handle);
      expect(moved.x).toBeCloseTo(2, 5);
      expect(moved.y).toBeCloseTo(5, 5);
      adapter.dispose();
    });

    it("falls again when a kinematic body becomes dynamic", async () => {
      const adapter = await kit.create();
      const handle = ballBody(adapter, kit, "kinematic-position", 0, 5);

      for (let i = 0; i < 5; i += 1) {
        adapter.step(DT);
      }
      expect(positionOf(adapter, handle).y).toBe(5);

      adapter.setBodyType(handle, "dynamic");
      for (let i = 0; i < 5; i += 1) {
        adapter.step(DT);
      }

      expect(positionOf(adapter, handle).y).toBeCloseTo(5 + fallDistance(5), 5);
      adapter.dispose();
    });

    it("falls when a static body becomes dynamic", async () => {
      const adapter = await kit.create();
      const handle = ballBody(adapter, kit, "static", 0, 3);

      adapter.step(DT);
      expect(positionOf(adapter, handle).y).toBe(3);

      adapter.setBodyType(handle, "dynamic");
      for (let i = 0; i < 4; i += 1) {
        adapter.step(DT);
      }

      expect(positionOf(adapter, handle).y).toBeCloseTo(3 + fallDistance(4), 5);
      adapter.dispose();
    });

    it("seeds the finite-differenced velocity through the activation", async () => {
      const adapter = await kit.create();
      const handle = ballBody(adapter, kit, "kinematic-position", 0, 5);

      // One fixed step of animated motion, finite-differenced exactly as
      // `PhysicsWorld.setBodyControlMode` does: (current − previous) / dt.
      const previous = new Vector3(0, 5, 0);
      const current = new Vector3(0.05, 5.02, 0);
      const seeded = current
        .clone()
        .sub(previous)
        .scale(1 / DT);

      adapter.setBodyType(handle, "dynamic");
      adapter.setBodyVelocities(handle, seeded, new Vector3(0, 0, 0));

      const read = linearOf(adapter, handle);
      expect(Math.abs(read.x - seeded.x)).toBeLessThan(EPSILON);
      expect(Math.abs(read.y - seeded.y)).toBeLessThan(EPSILON);

      // And it is the simulation's initial state, not a value that is dropped.
      adapter.step(DT);
      const after = linearOf(adapter, handle);
      expect(Math.abs(after.x - seeded.x)).toBeLessThan(EPSILON);
      expect(after.y).toBeLessThan(seeded.y);
      expect(Math.abs(after.y - (seeded.y + GRAVITY_Y * DT))).toBeLessThan(
        1e-4,
      );
      adapter.dispose();
    });

    it("keeps the id, the pose, the mass, and forEachBody's order", async () => {
      const adapter = await kit.create();
      const first = ballBody(adapter, kit, "dynamic", -2, 4);
      const middle = ballBody(adapter, kit, "kinematic-position", 0, 4);
      const last = ballBody(adapter, kit, "static", 2, 4);
      adapter.step(DT);

      const before: number[] = [];
      adapter.forEachBody((_handle, id) => before.push(id));
      const idBefore = adapter.getBodyId(middle);
      const poseBefore = positionOf(adapter, middle);
      const massBefore = adapter.getBodyMass(middle);
      expect(massBefore).toBeGreaterThan(0);

      adapter.setBodyType(middle, "dynamic");

      const after: number[] = [];
      adapter.forEachBody((_handle, id) => after.push(id));
      expect(after).toEqual(before);
      expect(after).toEqual([1, 2, 3]);
      expect(adapter.getBodyId(middle)).toBe(idBefore);
      expect(adapter.getBodyMass(middle)).toBe(massBefore);
      expect(positionOf(adapter, middle).x).toBe(poseBefore.x);
      expect(positionOf(adapter, middle).y).toBe(poseBefore.y);
      expect(adapter.getBodyId(first)).toBe(1);
      expect(adapter.getBodyId(last)).toBe(3);
      adapter.dispose();
    });

    it("produces an identical state stream from two runs that both retype mid-run", async () => {
      const run = async (): Promise<string> => {
        const adapter = await kit.create();
        const falling = ballBody(adapter, kit, "dynamic", 0, 5);
        const platform = ballBody(adapter, kit, "kinematic-position", 0, 1);
        const rows: string[] = [];
        for (let step = 0; step < 8; step += 1) {
          if (step === 4) {
            adapter.setBodyType(platform, "dynamic");
          }
          adapter.step(DT);
          adapter.forEachBody((handle, id) => {
            const position = new Vector3();
            const rotation = new Quaternion();
            const linear = new Vector3();
            const angular = new Vector3();
            adapter.getBodyTransform(handle, position, rotation);
            adapter.getBodyVelocities(handle, linear, angular);
            rows.push(
              [
                id,
                position.x,
                position.y,
                position.z,
                rotation.x,
                rotation.y,
                rotation.z,
                rotation.w,
                linear.x,
                linear.y,
                linear.z,
                angular.x,
                angular.y,
                angular.z,
              ].join(","),
            );
          });
        }
        adapter.dispose();
        void falling;
        return rows.join(";");
      };

      expect(await run()).toBe(await run());
    });

    it("leaves a dynamic body massless when it has no collider — the state the engine refuses", async () => {
      const adapter = await kit.create();
      const handle = ballBody(adapter, kit, "static", 0, 4, {
        collider: false,
      });
      expect(adapter.getBodyMass(handle)).toBe(0);

      adapter.setBodyType(handle, "dynamic");
      expect(adapter.getBodyMass(handle)).toBe(0);
      for (let i = 0; i < 10; i += 1) {
        adapter.step(DT);
      }

      // A massless dynamic body does not move at all — silently wrong, which is
      // why `PhysicsWorld.setBodyControlMode` refuses the switch up front.
      expect(positionOf(adapter, handle).y).toBe(4);
      adapter.dispose();
    });

    it("wakes a sleeping body by default and leaves it asleep with wake: false", async () => {
      const adapter = await kit.create();
      const handle = ballBody(adapter, kit, "dynamic", 0, 4);

      adapter.sleepBody(handle);
      expect(adapter.isBodySleeping(handle)).toBe(true);
      adapter.setBodyType(handle, "kinematic-velocity", false);
      expect(adapter.isBodySleeping(handle)).toBe(true);

      adapter.setBodyType(handle, "dynamic", true);
      expect(adapter.isBodySleeping(handle)).toBe(false);
      adapter.dispose();
    });

    it("rejects a destroyed handle", async () => {
      const adapter = await kit.create();
      const handle = ballBody(adapter, kit, "dynamic", 0, 4);
      adapter.destroyBody(handle);

      expect(() => {
        adapter.setBodyType(handle, "static");
      }).toThrowError(FourError);
      adapter.dispose();
    });
  },
);

describe("runtime re-typing and §21's plane", () => {
  it("refuses an off-plane angular seed in a 2d world", async () => {
    const adapter = await KIT_2D.create();
    const handle = ballBody(adapter, KIT_2D, "kinematic-position", 0, 4);

    adapter.setBodyType(handle, "dynamic");
    expect(() => {
      adapter.setBodyVelocities(handle, new Vector3(), new Vector3(1, 0, 0));
    }).toThrowError(/spins about \+Z only/);
    adapter.dispose();
  });

  it("carries a full 3d angular seed through the activation", async () => {
    const adapter = await KIT_3D.create();
    const handle = ballBody(adapter, KIT_3D, "kinematic-position", 0, 4);

    adapter.setBodyType(handle, "dynamic");
    adapter.setBodyVelocities(handle, new Vector3(), new Vector3(0.5, 1.5, -2));

    const angular = new Vector3();
    adapter.getBodyVelocities(handle, new Vector3(), angular);
    expect(Math.abs(angular.x - 0.5)).toBeLessThan(EPSILON);
    expect(Math.abs(angular.y - 1.5)).toBeLessThan(EPSILON);
    expect(Math.abs(angular.z + 2)).toBeLessThan(EPSILON);
    adapter.dispose();
  });
});
