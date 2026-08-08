/**
 * `SolverBodyTuningAccess` on the **real** Rapier wasm, in both dimensions
 * (§23, §24, §25, §31, §37; PH-1 stage 2, 2026-08-07).
 *
 * The six methods only close PH-1 if Rapier really applies them to a body that
 * already exists, so this file measures the consequences against
 * `@dimforge/rapier2d-compat` and `@dimforge/rapier3d-compat` 0.19.3 rather
 * than asserting that a setter was called. What `@four/physics` builds on top —
 * the dirty set, the drain order, the warnings — is proved over the structural
 * double in `@four/physics`'s `world-properties.test.ts`; a `PhysicsWorld`
 * cannot be built here, because it needs `@four/scene` and this package does
 * not depend on it.
 *
 * ## What was verified about Rapier itself (2026-08-07, 0.19.3, both builds)
 *
 * `RigidBody` carries live `setLinearDamping(factor)`,
 * `setAngularDamping(factor)`, `setGravityScale(factor, wakeUp)`,
 * `enableCcd(enabled)`, `setSoftCcdPrediction(distance)`, and
 * `setAdditionalMassProperties(mass, centreOfMass, principalInertia[, frame],
 * wakeUp)`; `Collider` carries `setFriction`, `setRestitution`, `setDensity`,
 * `setSensor`, `setCollisionGroups`, and `setActiveCollisionTypes`. All are
 * transcribed into `init.ts` from the installed typings, and the tests below
 * pin what they do: a mass written after `createBody` changes the acceleration
 * a force produces, a gravity scale of `0` stops a fall, damping bleeds
 * velocity, and the §31 mode round-trips through `getBodyCcdMode`.
 *
 * As in the other adapter suites, `World.step` runs `numSolverIterations = 4`
 * substeps of `dt / 4`, and Rapier stores state in 32-bit floats — hence the
 * tolerances below.
 */

import { Matrix3, Vector2, Vector3 } from "@four/math";
import type {
  CCDMode,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
} from "@four/physics";
import { supportsSolverBodyTuning } from "@four/physics";
import { describe, expect, it } from "vitest";

import { Rapier2dAdapter } from "../src/rapier2d-adapter.js";
import { Rapier3dAdapter } from "../src/rapier3d-adapter.js";

/** One fixed step (§10). Seconds, like every duration in this engine (§7a). */
const DT = 1 / 60;

/** The float32 tolerance every comparison below is held to. */
const EPSILON = 1e-4;

/** The dimension-independent slice of both adapters this file drives. */
interface TuningAdapter {
  createBody(desc: {
    type: "dynamic" | "static";
    position?: Vector2 | Vector3;
    mass?: number;
  }): PhysicsBodyHandle;
  createCollider(desc: {
    body: PhysicsBodyHandle;
    shape: { type: "circle" | "sphere"; radius: number };
    density?: number;
    friction?: number;
    restitution?: number;
    sensor?: boolean;
  }): PhysicsColliderHandle;
  step(delta: number): void;
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
  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3): void;
  getBodyMass(handle: PhysicsBodyHandle): number;
  getBodyCenterOfMass(handle: PhysicsBodyHandle, out: Vector3): void;
  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode;
  setBodyMassProperties(
    handle: PhysicsBodyHandle,
    mass: number,
    centerOfMass: Vector3 | undefined,
    inertiaTensor: Matrix3 | undefined,
    wake?: boolean,
  ): void;
  setBodyDamping(
    handle: PhysicsBodyHandle,
    linear: number,
    angular: number,
  ): void;
  setBodyGravityScale(
    handle: PhysicsBodyHandle,
    scale: number,
    wake?: boolean,
  ): void;
  setBodyCcdMode(
    handle: PhysicsBodyHandle,
    mode: CCDMode,
    predictionDistance?: number,
  ): void;
  setColliderMaterial(
    handle: PhysicsColliderHandle,
    friction: number,
    restitution: number,
    density: number | undefined,
  ): void;
  setColliderFilter(
    handle: PhysicsColliderHandle,
    sensor: boolean,
    collisionGroups: number,
    collisionMask: number,
  ): void;
  destroyCollider(handle: PhysicsColliderHandle): void;
  dispose(): void;
}

/** One dimension's fixtures. */
interface DimensionKit {
  readonly dimension: "2d" | "3d";
  create(): Promise<TuningAdapter>;
  position(x: number, y: number): Vector2 | Vector3;
  ball(radius: number): { type: "circle" | "sphere"; radius: number };
  /** A diagonal tensor both builds accept (2D reads Z, 3D reads the diagonal). */
  tensor(value: number): Matrix3;
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
  tensor(value) {
    return new Matrix3().fromArray([value, 0, 0, 0, value, 0, 0, 0, value]);
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
  tensor(value) {
    return new Matrix3().fromArray([value, 0, 0, 0, value, 0, 0, 0, value]);
  },
};

/** The linear velocity of `handle`, read into a fresh vector. */
function linearVelocity(
  adapter: TuningAdapter,
  handle: PhysicsBodyHandle,
): Vector3 {
  const linear = new Vector3();
  adapter.getBodyVelocities(handle, linear, new Vector3());
  return linear;
}

describe.each([KIT_2D, KIT_3D])(
  "SolverBodyTuningAccess on Rapier $dimension (§37, PH-1 stage 2)",
  (kit) => {
    it("is detected structurally by supportsSolverBodyTuning", async () => {
      const adapter = await kit.create();
      expect(supportsSolverBodyTuning(adapter as unknown as object)).toBe(true);
      adapter.dispose();
    });

    it("a live mass changes the acceleration an impulse produces (§23)", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
        mass: 2,
      });
      adapter.createCollider({ body, shape: kit.ball(0.5) });
      expect(adapter.getBodyMass(body)).toBeCloseTo(2, 4);

      adapter.setBodyMassProperties(body, 8, undefined, undefined);
      expect(adapter.getBodyMass(body)).toBeCloseTo(8, 4);

      adapter.setBodyVelocities(body, new Vector3(), new Vector3());
      adapter.applyImpulse(body, new Vector3(8, 0, 0));
      // v = J / m: 8 N·s on 8 kg is 1 m/s, not the 4 m/s the old mass gave.
      expect(linearVelocity(adapter, body).x).toBeCloseTo(1, 4);
      adapter.dispose();
    });

    it("an authored distribution moves the centre of mass (§23, §25)", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
        mass: 2,
      });
      adapter.createCollider({ body, shape: kit.ball(0.5) });

      adapter.setBodyMassProperties(
        body,
        4,
        new Vector3(0.75, 0, 0),
        kit.tensor(1),
      );

      const com = new Vector3();
      adapter.getBodyCenterOfMass(body, com);
      expect(com.x).toBeCloseTo(0.75, 3);
      expect(adapter.getBodyMass(body)).toBeCloseTo(4, 3);
      adapter.dispose();
    });

    it("switching back to a bare mass puts it on the first collider again", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
        mass: 2,
      });
      adapter.createCollider({ body, shape: kit.ball(0.5) });
      const second = adapter.createCollider({ body, shape: kit.ball(0.25) });

      adapter.setBodyMassProperties(body, 6, new Vector3(0.5, 0, 0), undefined);
      adapter.setBodyMassProperties(body, 3, undefined, undefined);

      // Back in `"first-collider"` mode: the mass is the whole body's, the
      // centre is derived from geometry again, and the previous mode's
      // additional mass has been cleared rather than added on top.
      expect(adapter.getBodyMass(body)).toBeCloseTo(3, 3);
      const com = new Vector3();
      adapter.getBodyCenterOfMass(body, com);
      expect(com.x).toBeCloseTo(0, 3);

      // …and the destroy path still finds the right heir (PH-3).
      adapter.destroyCollider(second);
      expect(adapter.getBodyMass(body)).toBeCloseTo(3, 3);
      adapter.dispose();
    });

    it("a body with no collider keeps a live mass on the body itself", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
      });
      adapter.setBodyMassProperties(body, 5, undefined, undefined);
      expect(adapter.getBodyMass(body)).toBeCloseTo(5, 3);
      adapter.dispose();
    });

    it("live damping bleeds velocity (§23)", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
        mass: 1,
      });
      adapter.createCollider({ body, shape: kit.ball(0.5) });
      adapter.setBodyGravityScale(body, 0);

      adapter.setBodyVelocities(body, new Vector3(10, 0, 0), new Vector3());
      adapter.step(DT);
      const undamped = linearVelocity(adapter, body).x;

      adapter.setBodyDamping(body, 5, 5);
      adapter.setBodyVelocities(body, new Vector3(10, 0, 0), new Vector3());
      adapter.step(DT);
      const damped = linearVelocity(adapter, body).x;

      expect(undamped).toBeCloseTo(10, 4);
      expect(damped).toBeLessThan(undamped - EPSILON);
      adapter.dispose();
    });

    it("a live gravity scale of 0 stops a fall (§23)", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 10),
        mass: 1,
      });
      adapter.createCollider({ body, shape: kit.ball(0.5) });

      adapter.step(DT);
      expect(linearVelocity(adapter, body).y).toBeLessThan(-EPSILON);

      adapter.setBodyGravityScale(body, 0);
      adapter.setBodyVelocities(body, new Vector3(), new Vector3());
      adapter.step(DT);
      expect(linearVelocity(adapter, body).y).toBeCloseTo(0, 5);
      adapter.dispose();
    });

    it("the §31 mode round-trips, and disabling really disables", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
        mass: 1,
      });
      expect(adapter.getBodyCcdMode(body)).toBe("disabled");

      adapter.setBodyCcdMode(body, "swept");
      expect(adapter.getBodyCcdMode(body)).toBe("swept");

      adapter.setBodyCcdMode(body, "speculative", 0.25);
      expect(adapter.getBodyCcdMode(body)).toBe("speculative");

      adapter.setBodyCcdMode(body, "speculative");
      expect(adapter.getBodyCcdMode(body)).toBe("speculative");

      adapter.setBodyCcdMode(body, "disabled");
      expect(adapter.getBodyCcdMode(body)).toBe("disabled");
      adapter.dispose();
    });

    it("a live restitution makes a resting ball bounce (§25)", async () => {
      const bounceHeight = async (restitution: number): Promise<number> => {
        const adapter = await kit.create();
        const ground = adapter.createBody({
          type: "static",
          position: kit.position(0, -1),
        });
        const groundCollider = adapter.createCollider({
          body: ground,
          shape: kit.ball(1),
        });
        const ball = adapter.createBody({
          type: "dynamic",
          position: kit.position(0, 1),
          mass: 1,
        });
        adapter.createCollider({ body: ball, shape: kit.ball(0.25) });

        // The material is written **after** both colliders exist, which is the
        // whole point: nothing else in the adapter can change it now.
        adapter.setColliderMaterial(groundCollider, 0, restitution, undefined);
        adapter.setBodyVelocities(ball, new Vector3(0, -8, 0), new Vector3());

        let highest = -Infinity;
        for (let i = 0; i < 90; i += 1) {
          adapter.step(DT);
          highest = Math.max(highest, linearVelocity(adapter, ball).y);
        }
        adapter.dispose();
        return highest;
      };

      const dead = await bounceHeight(0);
      const lively = await bounceHeight(1);
      expect(lively).toBeGreaterThan(dead + 1);
    });

    it("a live filter change is visible to §30 queries (§24)", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
        mass: 1,
      });
      const collider = adapter.createCollider({ body, shape: kit.ball(0.5) });
      // Colliders are invisible to queries until one step has run.
      adapter.setBodyGravityScale(body, 0);
      adapter.step(DT);

      const cast = (
        options: { collisionMask?: number } = {},
      ): readonly unknown[] =>
        (
          adapter as unknown as {
            raycast(query: Record<string, unknown>): readonly unknown[];
          }
        ).raycast({
          origin: kit.position(-5, 0),
          direction: kit.position(1, 0),
          ...options,
        });

      expect(cast()).toHaveLength(1);

      // Out of the mask's groups: filtered out.
      adapter.setColliderFilter(collider, false, 0b0010, 0xffff);
      expect(cast({ collisionMask: 0b0001 })).toHaveLength(0);
      expect(cast({ collisionMask: 0b0010 })).toHaveLength(1);

      // A sensor is excluded from a query that did not ask for sensors (§30).
      adapter.setColliderFilter(collider, true, 0xffff, 0xffff);
      expect(cast()).toHaveLength(0);
      adapter.dispose();
    });

    it("a live density is honoured only where mass is collider-derived (§23)", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
      });
      const collider = adapter.createCollider({
        body,
        shape: kit.ball(0.5),
        density: 1,
      });
      const before = adapter.getBodyMass(body);

      adapter.setColliderMaterial(collider, 0.5, 0.1, 4);
      expect(adapter.getBodyMass(body)).toBeCloseTo(before * 4, 3);

      // `undefined` leaves the mass contribution exactly as it is.
      adapter.setColliderMaterial(collider, 0.2, 0.2, undefined);
      expect(adapter.getBodyMass(body)).toBeCloseTo(before * 4, 3);
      adapter.dispose();
    });

    it("rejects a foreign or destroyed handle, like the rest of the seam", async () => {
      const adapter = await kit.create();
      const body = adapter.createBody({
        type: "dynamic",
        position: kit.position(0, 0),
        mass: 1,
      });
      const collider = adapter.createCollider({ body, shape: kit.ball(0.5) });
      adapter.destroyCollider(collider);

      expect(() => {
        adapter.setColliderMaterial(collider, 0.5, 0.5, undefined);
      }).toThrow();
      expect(() => {
        adapter.setColliderFilter(collider, false, 1, 1);
      }).toThrow();
      adapter.dispose();

      expect(() => {
        adapter.setBodyDamping(body, 1, 1);
      }).toThrow();
      expect(() => {
        adapter.setBodyGravityScale(body, 1);
      }).toThrow();
      expect(() => {
        adapter.setBodyCcdMode(body, "swept");
      }).toThrow();
      expect(() => {
        adapter.setBodyMassProperties(body, 1, undefined, undefined);
      }).toThrow();
    });
  },
);
