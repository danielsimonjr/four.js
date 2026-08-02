/**
 * `Rapier3dAdapter`'s §28 joints against the **real** Rapier 3D wasm (§37,
 * §109, WP-6.3).
 *
 * No fake solver here, for the reason `rapier3d-adapter.test.ts` gives: the
 * point of an adapter packet is to prove the mapping onto a real engine, and
 * the closed forms below are the only referee worth having. `@four/physics`'s
 * `FakeSolverAdapter` is where the `SolverJointAccess` *contract* is exercised
 * without a solver.
 *
 * ## What the analytic tests compare against, and to what tolerance
 *
 * - **Pendulum.** A point bob at radius `L` on a hinge has the small-angle
 *   period `T₀ = 2π√(L/g)`, and a *finite* amplitude `θ₀` lengthens it by the
 *   first-order correction `T ≈ T₀(1 + θ₀²/16)`. Both are asserted: measured
 *   over 3000 steps at `θ₀ = 0.2 rad`, the period lands **0.254%** above `T₀`
 *   (asserted under 0.3%) and within **0.05%** of the corrected form — that is
 *   the amplitude correction showing up, not solver error.
 * - **Spring.** A mass `m` on a spring `k` oscillates with `T = 2π√(m/k)`;
 *   measured within **0.5%**. Damping is compared qualitatively — successive
 *   peaks must decay geometrically — because Rapier's spring joint is a soft
 *   constraint solved per substep and its effective damping ratio is not the
 *   textbook `c/2√(km)` to three digits.
 * - **Everything else** (rope length, hinge limits, slider limits, motor
 *   steady state, weld rigidity) is compared against the constraint's own
 *   definition, with a tolerance that names the solver's one iteration of
 *   overshoot where there is one.
 *
 * Sleeping is disabled in every world here (§32): a slow pendulum is exactly
 * what Rapier's auto-sleep is designed to stop simulating, and a test measuring
 * a period over 50 seconds must not race it.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import { supportsSolverJointAccess } from "@four/physics";
import type {
  JointDescriptor,
  PhysicsBodyHandle,
  PhysicsJointHandle,
  PhysicsWorldOptions,
} from "@four/physics";
import { beforeAll, describe, expect, it } from "vitest";

import { initializeRapier3d } from "../src/init.js";
import { Rapier3dAdapter } from "../src/rapier3d-adapter.js";

/** One fixed step (§10). Seconds, like every duration in this engine (§7a). */
const DT = 1 / 60;

/** Appendix A gravity, and the value every closed form below assumes. */
const G = 9.81;

async function createAdapter(
  options?: Partial<PhysicsWorldOptions>,
): Promise<Rapier3dAdapter> {
  const adapter = new Rapier3dAdapter();
  await adapter.initialize({
    dimension: "3d",
    sleeping: { enabled: false },
    ...options,
  });
  return adapter;
}

/** A static body at `position` — every rig below hangs off one. */
function anchorAt(
  adapter: Rapier3dAdapter,
  position: Vector3,
): PhysicsBodyHandle {
  return adapter.createBody({ type: "static", position });
}

/** A dynamic body with one sphere collider, so it has mass (§25). */
function ballAt(
  adapter: Rapier3dAdapter,
  position: Vector3,
  radius = 0.02,
  density = 10000,
): PhysicsBodyHandle {
  const body = adapter.createBody({ type: "dynamic", position });
  adapter.createCollider({
    body,
    shape: { type: "sphere", radius },
    density,
  });
  return body;
}

/** A dynamic box, the arm and shaft of the motor and weld tests. */
function barAt(
  adapter: Rapier3dAdapter,
  position: Vector3,
  halfExtents = new Vector3(0.5, 0.05, 0.05),
  density = 100,
): PhysicsBodyHandle {
  const body = adapter.createBody({ type: "dynamic", position });
  adapter.createCollider({
    body,
    shape: { type: "box", halfExtents },
    density,
  });
  return body;
}

function positionOf(
  adapter: Rapier3dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  const position = new Vector3();
  adapter.getBodyTransform(body, position, new Quaternion());
  return position;
}

function rotationOf(
  adapter: Rapier3dAdapter,
  body: PhysicsBodyHandle,
): Quaternion {
  const rotation = new Quaternion();
  adapter.getBodyTransform(body, new Vector3(), rotation);
  return rotation;
}

function angularVelocityOf(
  adapter: Rapier3dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  const angular = new Vector3();
  adapter.getBodyVelocities(body, new Vector3(), angular);
  return angular;
}

function linearVelocityOf(
  adapter: Rapier3dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  const linear = new Vector3();
  adapter.getBodyVelocities(body, linear, new Vector3());
  return linear;
}

/** Every live body, in creation order — how a restored world is re-found. */
function collectBodies(adapter: Rapier3dAdapter): PhysicsBodyHandle[] {
  const bodies: PhysicsBodyHandle[] = [];
  adapter.forEachBody((handle) => {
    bodies.push(handle);
  });
  return bodies;
}

/** Steps `count` times through §37's per-step call order. */
function step(adapter: Rapier3dAdapter, count: number, delta = DT): void {
  for (let i = 0; i < count; i += 1) {
    adapter.syncSceneToSolver();
    adapter.step(delta);
    adapter.syncSolverToScene();
    adapter.drainEvents();
  }
}

beforeAll(async () => {
  await initializeRapier3d();
});

describe("the SolverJointAccess seam (§37, WP-6.1)", () => {
  it("is detected structurally, which is what lets a world add joints", async () => {
    const adapter = await createAdapter();
    expect(supportsSolverJointAccess(adapter)).toBe(true);
    adapter.dispose();
  });

  it("declares exactly the plan P6-1 types it builds", async () => {
    const adapter = await createAdapter();
    expect([...adapter.capabilities.jointTypes]).toEqual([
      "fixed",
      "spring",
      "revolute",
      "prismatic",
      "spherical",
      "rope",
    ]);
    adapter.dispose();
  });

  it("reports no joint reactions, and refuses to invent them (plan P6-2)", async () => {
    const adapter = await createAdapter();
    // Verified against Rapier 0.19.3 itself: neither `ImpulseJoint` nor
    // `RawImpulseJointSet` has any impulse, reaction, force, or torque member,
    // so §28's break thresholds cannot be enforced on this solver.
    expect(adapter.reportsJointReactions).toBe(false);
    const bodyA = anchorAt(adapter, new Vector3(0, 0, 0));
    const bodyB = ballAt(adapter, new Vector3(1, 0, 0));
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA,
      bodyB,
      axis: new Vector3(0, 0, 1),
    });
    let thrown: unknown;
    try {
      adapter.getJointReaction(joint, new Vector3(), new Vector3());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FourError);
    expect((thrown as FourError).code).toBe("NOT_IMPLEMENTED");
    expect((thrown as FourError).message).toMatch(/no joint reaction/u);
    adapter.dispose();
  });

  it("mints monotonic ids and iterates joints in creation order (§33)", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const joints: PhysicsJointHandle[] = [];
    for (let i = 0; i < 3; i += 1) {
      const bob = ballAt(adapter, new Vector3(i + 1, 0, 0));
      joints.push(
        adapter.createJoint({
          type: "revolute",
          bodyA: anchor,
          bodyB: bob,
          axis: new Vector3(0, 0, 1),
        }),
      );
    }
    expect(joints.map((handle) => adapter.getJointId(handle))).toEqual([
      1, 2, 3,
    ]);

    adapter.destroyJoint(joints[1]);
    const seen: number[] = [];
    adapter.forEachJoint((_handle, id) => {
      seen.push(id);
    });
    // Destroying the middle joint removes it from the sequence and never
    // renumbers the survivors — the §33 ordering guarantee.
    expect(seen).toEqual([1, 3]);

    const extra = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: ballAt(adapter, new Vector3(4, 0, 0)),
      axis: new Vector3(0, 0, 1),
    });
    expect(adapter.getJointId(extra)).toBe(4);
    adapter.dispose();
  });

  it("rejects a handle it did not mint, or one it has destroyed", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const bob = ballAt(adapter, new Vector3(1, 0, 0));
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      axis: new Vector3(0, 0, 1),
    });
    adapter.destroyJoint(joint);
    expect(() => adapter.getJointId(joint)).toThrowError(FourError);
    expect(() =>
      adapter.getJointId({} as unknown as PhysicsJointHandle),
    ).toThrowError(/not valid for this Rapier3dAdapter/u);
    adapter.dispose();
  });

  it("retires the joints of a destroyed body, as Rapier does", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const bob = ballAt(adapter, new Vector3(1, 0, 0));
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      axis: new Vector3(0, 0, 1),
    });
    adapter.destroyBody(bob);
    let count = 0;
    adapter.forEachJoint(() => {
      count += 1;
    });
    expect(count).toBe(0);
    expect(() => adapter.getJointId(joint)).toThrowError(FourError);
    adapter.dispose();
  });
});

describe("revolute joints (§28 hinge)", () => {
  it("swings a pendulum with the period 2π√(L/g) predicts", async () => {
    const adapter = await createAdapter();
    const length = 1;
    const amplitude = 0.2;
    const start = new Vector3(
      length * Math.sin(amplitude),
      -length * Math.cos(amplitude),
      0,
    );
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const bob = ballAt(adapter, start);
    adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      // Body-local anchors: the pivot is the anchor's own origin, and the same
      // world point is `-start` in the bob's frame (the bob is unrotated).
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(-start.x, -start.y, 0),
      axis: new Vector3(0, 0, 1),
    });

    // Zero crossings of x, interpolated inside the step that crosses.
    const crossings: number[] = [];
    let previous = positionOf(adapter, bob).x;
    for (let i = 1; i <= 3000; i += 1) {
      step(adapter, 1);
      const x = positionOf(adapter, bob).x;
      if (previous > 0 && x <= 0) {
        crossings.push((i - 1 + previous / (previous - x)) * DT);
      }
      previous = x;
    }
    expect(crossings.length).toBeGreaterThan(10);
    const period =
      (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);

    const ideal = 2 * Math.PI * Math.sqrt(length / G);
    // The small-angle form, to the documented 0.3%: the gap is dominated by
    // the finite amplitude, not by the solver. Measured: 0.254%, against the
    // 0.25% the correction below predicts on its own.
    expect(Math.abs(period - ideal) / ideal).toBeLessThan(0.003);
    // The first-order finite-amplitude form, to 0.05% — which is what shows
    // that the residual above is physics and not error. The remainder is the
    // bob's own rotational inertia: a 0.02 m sphere is not quite a point.
    const corrected = ideal * (1 + (amplitude * amplitude) / 16);
    expect(Math.abs(period - corrected) / corrected).toBeLessThan(0.0005);

    // The constraint itself: the bob stays exactly `length` from the pivot.
    const radius = positionOf(adapter, bob).length();
    expect(radius).toBeCloseTo(length, 4);
    adapter.dispose();
  });

  it("clamps a hinge at its limits, and re-limits it live", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const arm = barAt(adapter, new Vector3(1, 0, 0));
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: arm,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
      axis: new Vector3(0, 0, 1),
      limits: { min: -0.5, max: 0.5 },
    });

    const swing = (steps: number): number => {
      let lowest = 0;
      for (let i = 0; i < steps; i += 1) {
        step(adapter, 1);
        const p = positionOf(adapter, arm);
        lowest = Math.min(lowest, Math.atan2(p.y, p.x));
      }
      return lowest;
    };

    // Gravity pulls the arm down; the lower bound stops it. One solver
    // iteration of overshoot is expected and is why the tolerance is 0.01 rad.
    const first = swing(400);
    expect(first).toBeLessThan(-0.49);
    expect(first).toBeGreaterThan(-0.51);

    adapter.setJointLimits(joint, -1.2, 0.5);
    const second = swing(400);
    expect(second).toBeLessThan(-1.19);
    expect(second).toBeGreaterThan(-1.21);
    adapter.dispose();
  });

  it("drives a shaft to the commanded speed about its own axis", async () => {
    const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const shaft = barAt(
      adapter,
      new Vector3(0, 0, 0),
      new Vector3(0.4, 0.05, 0.05),
      500,
    );
    adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: shaft,
      axis: new Vector3(0, 1, 0),
      motor: { enabled: true, targetVelocity: 4, maxTorque: 50 },
    });
    step(adapter, 300);

    const angular = angularVelocityOf(adapter, shaft);
    expect(angular.y).toBeCloseTo(4, 3);
    // About its axis and no other: the hinge removes the other two freedoms.
    expect(Math.abs(angular.x)).toBeLessThan(1e-6);
    expect(Math.abs(angular.z)).toBeLessThan(1e-6);
    adapter.dispose();
  });

  it("reconfigures a motor live, and a disabled one exerts nothing", async () => {
    const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const shaft = barAt(
      adapter,
      new Vector3(0, 0, 0),
      new Vector3(0.4, 0.05, 0.05),
      500,
    );
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: shaft,
      axis: new Vector3(0, 1, 0),
      motor: { enabled: true, targetVelocity: 4, maxTorque: 50 },
    });
    step(adapter, 200);
    expect(angularVelocityOf(adapter, shaft).y).toBeCloseTo(4, 3);

    adapter.setJointMotor(joint, {
      enabled: true,
      targetVelocity: -2,
      maxEffort: 50,
    });
    step(adapter, 200);
    expect(angularVelocityOf(adapter, shaft).y).toBeCloseTo(-2, 3);

    // Disabled: Rapier cannot remove a motor, so the adapter configures the
    // inert gain instead. With no gravity and no drive the shaft coasts at
    // whatever speed it had, rather than being held at a target.
    adapter.setJointMotor(joint, {
      enabled: false,
      targetVelocity: -2,
      maxEffort: 50,
    });
    adapter.setBodyVelocities(shaft, new Vector3(), new Vector3(0, 3, 0));
    step(adapter, 200);
    expect(angularVelocityOf(adapter, shaft).y).toBeCloseTo(3, 3);
    adapter.dispose();
  });

  it("makes a disabled motor indistinguishable from no motor at all", async () => {
    // The measurement the inert gain rests on, asserted rather than asserted
    // about: Rapier cannot remove a motor, so a disabled one is configured
    // with INERT_MOTOR_GAIN — and a joint carrying it must follow *exactly*
    // the trajectory of a joint that never had a motor, under load.
    const trajectory = async (disableMotor: boolean): Promise<number[]> => {
      const adapter = await createAdapter();
      const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
      const arm = barAt(adapter, new Vector3(0.5, 0, 0));
      const joint = adapter.createJoint({
        type: "revolute",
        bodyA: anchor,
        bodyB: arm,
        anchorA: new Vector3(0, 0, 0),
        anchorB: new Vector3(-0.5, 0, 0),
        axis: new Vector3(0, 0, 1),
        ...(disableMotor
          ? { motor: { enabled: true, targetVelocity: 3, maxTorque: 40 } }
          : {}),
      });
      if (disableMotor) {
        adapter.setJointMotor(joint, {
          enabled: false,
          targetVelocity: 3,
          maxEffort: 40,
        });
      }
      const angles: number[] = [];
      for (let i = 0; i < 240; i += 1) {
        step(adapter, 1);
        const at = positionOf(adapter, arm);
        angles.push(Math.atan2(at.y, at.x));
      }
      adapter.dispose();
      return angles;
    };
    expect(await trajectory(true)).toEqual(await trajectory(false));
  });

  it("underpowers honestly: a small maxTorque loses to a load a large one holds", async () => {
    // §28's cap reaches this solver as a *gain* — see `setJointMotor` — so what
    // is asserted is the part that is true either way: a weak motor is pushed
    // backwards by a load a strong one holds against. The load is an explicit
    // opposing torque rather than gravity, because gravity would *help* the
    // motor round half of every revolution and prove nothing.
    const drive = async (maxTorque: number): Promise<number> => {
      const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
      const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
      const shaft = barAt(adapter, new Vector3(0, 0, 0));
      adapter.createJoint({
        type: "revolute",
        bodyA: anchor,
        bodyB: shaft,
        axis: new Vector3(0, 0, 1),
        motor: { enabled: true, targetVelocity: 2, maxTorque },
      });
      for (let i = 0; i < 400; i += 1) {
        // §26: a force acts for one step. Rapier keeps user torques until they
        // are reset, which is why `PhysicsWorld` resets before it re-applies —
        // and why this loop does the same.
        adapter.resetForces(shaft);
        adapter.applyTorque(shaft, new Vector3(0, 0, -30));
        step(adapter, 1);
      }
      const speed = angularVelocityOf(adapter, shaft).z;
      adapter.dispose();
      return speed;
    };
    const strong = await drive(500);
    const weak = await drive(1);
    expect(strong).toBeGreaterThan(1.9);
    expect(weak).toBeLessThan(0);
    expect(weak).toBeLessThan(strong);
  });
});

describe("prismatic joints (§28 slider)", () => {
  it("constrains motion to its axis, drives along it, and stops at the limit", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const carriage = barAt(
      adapter,
      new Vector3(0, 0, 0),
      new Vector3(0.1, 0.1, 0.1),
    );
    const joint = adapter.createJoint({
      type: "prismatic",
      bodyA: anchor,
      bodyB: carriage,
      axis: new Vector3(1, 0, 0),
      limits: { min: -0.5, max: 0.5 },
      motor: { enabled: true, targetVelocity: 1, maxForce: 500 },
    });
    step(adapter, 200);

    const at = positionOf(adapter, carriage);
    // The motor pushed it to the upper bound and gravity never moved it off
    // the axis: that is the whole point of a slider.
    expect(at.x).toBeCloseTo(0.5, 3);
    expect(Math.abs(at.y)).toBeLessThan(1e-6);
    expect(Math.abs(at.z)).toBeLessThan(1e-6);

    adapter.setJointMotor(joint, {
      enabled: true,
      targetVelocity: -1,
      maxEffort: 500,
    });
    adapter.setJointLimits(joint, -0.2, 0.5);
    step(adapter, 200);
    expect(positionOf(adapter, carriage).x).toBeCloseTo(-0.2, 3);
    expect(Math.abs(linearVelocityOf(adapter, carriage).y)).toBeLessThan(1e-6);
    adapter.dispose();
  });
});

describe("rope joints (§28)", () => {
  it("caps the anchor distance and never pushes", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    // Starts well inside the rope, so the slack half is exercised first.
    const bob = ballAt(adapter, new Vector3(0, -0.2, 0), 0.05, 100);
    adapter.createJoint({
      type: "rope",
      bodyA: anchor,
      bodyB: bob,
      maxLength: 1.5,
    });

    let maximum = 0;
    let slackObserved = false;
    for (let i = 0; i < 400; i += 1) {
      step(adapter, 1);
      const distance = positionOf(adapter, bob).length();
      maximum = Math.max(maximum, distance);
      if (distance < 1.4) {
        slackObserved = true;
      }
    }
    expect(slackObserved).toBe(true);
    expect(maximum).toBeLessThanOrEqual(1.5 + 1e-4);
    expect(maximum).toBeGreaterThan(1.49);
    adapter.dispose();
  });
});

describe("spring joints (§28)", () => {
  it("oscillates with the period 2π√(m/k) predicts", async () => {
    const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    // A 0.1 m sphere at this density weighs 1 kg, which is what makes the
    // closed form readable.
    const bob = ballAt(adapter, new Vector3(0, -1.5, 0), 0.1, 238.7324146);
    const stiffness = 100;
    adapter.createJoint({
      type: "spring",
      bodyA: anchor,
      bodyB: bob,
      restLength: 1,
      stiffness,
      damping: 0,
    });
    const mass = adapter.getBodyMass(bob);
    expect(mass).toBeCloseTo(1, 3);

    const crossings: number[] = [];
    let previous = positionOf(adapter, bob).y;
    for (let i = 1; i <= 1200; i += 1) {
      step(adapter, 1);
      const y = positionOf(adapter, bob).y;
      if (previous < -1 && y >= -1) {
        crossings.push((i - 1 + (-1 - previous) / (y - previous)) * DT);
      }
      previous = y;
    }
    expect(crossings.length).toBeGreaterThan(10);
    const period =
      (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    const ideal = 2 * Math.PI * Math.sqrt(mass / stiffness);
    expect(Math.abs(period - ideal) / ideal).toBeLessThan(0.005);
    adapter.dispose();
  });

  it("damps: successive peaks decay", async () => {
    const peaks = async (damping: number): Promise<number[]> => {
      const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
      const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
      const bob = ballAt(adapter, new Vector3(0, -1.5, 0), 0.1, 238.7324146);
      adapter.createJoint({
        type: "spring",
        bodyA: anchor,
        bodyB: bob,
        restLength: 1,
        stiffness: 100,
        damping,
      });
      const found: number[] = [];
      let older = -1.5;
      let previous = -1.5;
      for (let i = 0; i < 600; i += 1) {
        step(adapter, 1);
        const y = positionOf(adapter, bob).y;
        if (previous < older && previous < y) {
          found.push(Math.abs(previous + 1));
        }
        older = previous;
        previous = y;
      }
      adapter.dispose();
      return found;
    };

    const undamped = await peaks(0);
    const damped = await peaks(5);
    expect(undamped.length).toBeGreaterThan(3);
    expect(damped.length).toBeGreaterThan(1);
    // Undamped: the solver bleeds a little energy per step, so "does not
    // collapse" is the honest assertion. Damped: an order of magnitude a cycle.
    expect(undamped[2] / undamped[0]).toBeGreaterThan(0.5);
    expect(damped[1] / damped[0]).toBeLessThan(0.5);
    expect(damped[0]).toBeLessThan(undamped[0]);
  });
});

describe("fixed joints (§28 weld)", () => {
  it("holds a lever rigid under torque and force", async () => {
    const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
    const base = anchorAt(adapter, new Vector3(0, 0, 0));
    const lever = barAt(adapter, new Vector3(1, 0, 0));
    adapter.createJoint({
      type: "fixed",
      bodyA: base,
      bodyB: lever,
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(0, 0, 0),
    });

    for (let i = 0; i < 240; i += 1) {
      // Reset first, as `PhysicsWorld` does: §26's forces act for one step and
      // Rapier's persist until they are cleared.
      adapter.resetForces(lever);
      adapter.applyTorque(lever, new Vector3(0, 0, 200));
      adapter.applyForce(lever, new Vector3(0, 300, 0));
      step(adapter, 1);
    }
    const at = positionOf(adapter, lever);
    expect(at.x).toBeCloseTo(1, 4);
    expect(at.y).toBeCloseTo(0, 4);
    expect(at.z).toBeCloseTo(0, 4);
    const rotation = rotationOf(adapter, lever);
    expect(rotation.w).toBeCloseTo(1, 4);
    expect(rotation.z).toBeCloseTo(0, 4);
    adapter.dispose();
  });

  it("keeps the relative pose the bodies had, rather than aligning them", async () => {
    // Rapier's 3D fixed joint welds `q₁·frame1` to `q₂·frame2`; identity frames
    // would snap the lever's 90° back to 0°. The adapter derives `frame2` from
    // the poses the solver holds at `createJoint`, so §28's promise — the
    // bodies keep the relative pose they had — actually holds.
    const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
    const base = anchorAt(adapter, new Vector3(0, 0, 0));
    const quarterTurn = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 2,
    );
    const lever = adapter.createBody({
      type: "dynamic",
      position: new Vector3(1, 0, 0),
      rotation: quarterTurn,
    });
    adapter.createCollider({
      body: lever,
      shape: { type: "box", halfExtents: new Vector3(0.5, 0.05, 0.05) },
      density: 100,
    });
    adapter.createJoint({
      type: "fixed",
      bodyA: base,
      bodyB: lever,
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(0, 0, 0),
    });
    step(adapter, 120);

    const rotation = rotationOf(adapter, lever);
    expect(rotation.z).toBeCloseTo(Math.SQRT1_2, 4);
    expect(rotation.w).toBeCloseTo(Math.SQRT1_2, 4);
    adapter.dispose();
  });
});

describe("spherical joints (§28 ball)", () => {
  it("swings in every direction where a hinge swings in one", async () => {
    const swing = async (
      descriptor: (
        bodyA: PhysicsBodyHandle,
        bodyB: PhysicsBodyHandle,
      ) => JointDescriptor,
      push: Vector3,
    ): Promise<{ x: number; z: number }> => {
      const adapter = await createAdapter();
      const anchor = anchorAt(adapter, new Vector3(0, 2, 0));
      const bob = ballAt(adapter, new Vector3(0, 1, 0), 0.05, 100);
      adapter.createJoint(descriptor(anchor, bob));
      adapter.applyImpulse(bob, push);
      let maxX = 0;
      let maxZ = 0;
      for (let i = 0; i < 200; i += 1) {
        step(adapter, 1);
        const at = positionOf(adapter, bob);
        maxX = Math.max(maxX, Math.abs(at.x));
        maxZ = Math.max(maxZ, Math.abs(at.z));
      }
      adapter.dispose();
      return { x: maxX, z: maxZ };
    };

    const ball = (
      bodyA: PhysicsBodyHandle,
      bodyB: PhysicsBodyHandle,
    ): JointDescriptor => ({
      type: "spherical",
      bodyA,
      bodyB,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(0, 1, 0),
    });
    const hinge = (
      bodyA: PhysicsBodyHandle,
      bodyB: PhysicsBodyHandle,
    ): JointDescriptor => ({
      type: "revolute",
      bodyA,
      bodyB,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(0, 1, 0),
      axis: new Vector3(0, 0, 1),
    });

    const ballX = await swing(ball, new Vector3(2, 0, 0));
    const ballZ = await swing(ball, new Vector3(0, 0, 2));
    const hingeX = await swing(hinge, new Vector3(2, 0, 0));
    const hingeZ = await swing(hinge, new Vector3(0, 0, 2));

    expect(ballX.x).toBeGreaterThan(0.5);
    expect(ballZ.z).toBeGreaterThan(0.5);
    // The hinge about +Z swings in the XY plane and nowhere else, which is the
    // difference the ball joint exists for.
    expect(hingeX.x).toBeGreaterThan(0.5);
    expect(hingeZ.z).toBeLessThan(1e-6);
  });

  it("refuses a swing cone rather than approximating one (WP-6.3)", async () => {
    // Rapier 0.19.3 has no cone: per-axis angular limits bound a planar swing
    // correctly (0.2998 rad against ±0.3) and let a diagonal one reach
    // 1.1247 rad. Building the cone from them would be a wrong simulation, so
    // the adapter refuses the descriptor instead of shipping the wrong shape.
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 2, 0));
    const bob = ballAt(adapter, new Vector3(0, 1, 0), 0.05, 100);
    let thrown: unknown;
    try {
      adapter.createJoint({
        type: "spherical",
        bodyA: anchor,
        bodyB: bob,
        anchorA: new Vector3(0, 0, 0),
        anchorB: new Vector3(0, 1, 0),
        limits: { coneAngle: 0.3 },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FourError);
    expect((thrown as FourError).code).toBe("NOT_IMPLEMENTED");
    expect((thrown as FourError).message).toMatch(/swing cone/u);
    // The unlimited ball joint is built by the very next call.
    const joint = adapter.createJoint({
      type: "spherical",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(0, 1, 0),
    });
    expect(adapter.getJointId(joint)).toBe(1);
    adapter.dispose();
  });

  it("has no limits or motor to reconfigure, and says so", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 2, 0));
    const bob = ballAt(adapter, new Vector3(0, 1, 0), 0.05, 100);
    const joint = adapter.createJoint({
      type: "spherical",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(0, 1, 0),
    });
    expect(() => adapter.setJointLimits(joint, -1, 1)).toThrowError(
      /only revolute and prismatic joints are UnitImpulseJoints/u,
    );
    expect(() =>
      adapter.setJointMotor(joint, {
        enabled: true,
        targetVelocity: 1,
        maxEffort: 1,
      }),
    ).toThrowError(FourError);
    adapter.dispose();
  });
});

describe("joint lifetime", () => {
  it("frees a body the moment its joint is destroyed mid-run", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const bob = ballAt(adapter, new Vector3(1, 0, 0), 0.05, 100);
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
      axis: new Vector3(0, 0, 1),
    });
    step(adapter, 30);
    expect(positionOf(adapter, bob).length()).toBeCloseTo(1, 3);

    adapter.destroyJoint(joint);
    const before = positionOf(adapter, bob).y;
    step(adapter, 60);
    const after = positionOf(adapter, bob);
    // Unconstrained: it falls, and it is no longer on the circle.
    expect(after.y).toBeLessThan(before - 0.3);
    expect(after.length()).toBeGreaterThan(1.3);
    adapter.dispose();
  });

  it("collides the jointed bodies only when the descriptor asks for it", async () => {
    const contacts = async (collisionEnabled: boolean): Promise<number> => {
      const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
      const anchor = adapter.createBody({
        type: "static",
        position: new Vector3(0, 0, 0),
      });
      adapter.createCollider({
        body: anchor,
        shape: { type: "sphere", radius: 0.5 },
      });
      const bob = ballAt(adapter, new Vector3(0.4, 0, 0), 0.5, 100);
      adapter.createJoint({
        type: "spring",
        bodyA: anchor,
        bodyB: bob,
        restLength: 0,
        stiffness: 50,
        damping: 0,
        collisionEnabled,
      });
      let seen = 0;
      for (let i = 0; i < 60; i += 1) {
        adapter.syncSceneToSolver();
        adapter.step(DT);
        adapter.syncSolverToScene();
        seen += adapter
          .drainEvents()
          .filter((event) => event.type === "collisionstart").length;
      }
      adapter.dispose();
      return seen;
    };
    expect(await contacts(false)).toBe(0);
    expect(await contacts(true)).toBeGreaterThan(0);
  });
});

describe("snapshots with joints (§34)", () => {
  it("round-trips a jointed world and continues it identically", async () => {
    const build = async (): Promise<{
      adapter: Rapier3dAdapter;
      bob: PhysicsBodyHandle;
      joint: PhysicsJointHandle;
    }> => {
      const adapter = await createAdapter();
      const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
      const bob = ballAt(adapter, new Vector3(1, 0, 0), 0.05, 100);
      const joint = adapter.createJoint({
        type: "revolute",
        bodyA: anchor,
        bodyB: bob,
        anchorA: new Vector3(0, 0, 0),
        anchorB: new Vector3(-1, 0, 0),
        axis: new Vector3(0, 0, 1),
        limits: { min: -1.2, max: 1.2 },
        motor: { enabled: true, targetVelocity: 0.5, maxTorque: 200 },
      });
      step(adapter, 30);
      return { adapter, bob, joint };
    };

    const original = await build();
    const snapshot = original.adapter.createSnapshot();
    const continued: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      step(original.adapter, 1);
      continued.push(positionOf(original.adapter, original.bob).y);
    }

    const restored = await build();
    restored.adapter.restoreSnapshot(snapshot);
    // Ids, handles, and the joint's identity survive the round trip.
    expect(restored.adapter.getJointId(restored.joint)).toBe(1);
    const replayed: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      step(restored.adapter, 1);
      replayed.push(positionOf(restored.adapter, restored.bob).y);
    }
    expect(replayed).toEqual(continued);

    // The restored joint is still live: its limits and motor reconfigure.
    restored.adapter.setJointLimits(restored.joint, -0.4, 0.4);
    restored.adapter.setJointMotor(restored.joint, {
      enabled: true,
      targetVelocity: -1,
      maxEffort: 200,
    });
    step(restored.adapter, 200);
    const angle = Math.atan2(
      positionOf(restored.adapter, restored.bob).y,
      positionOf(restored.adapter, restored.bob).x,
    );
    expect(angle).toBeGreaterThan(-0.42);
    expect(angle).toBeLessThan(-0.38);

    original.adapter.dispose();
    restored.adapter.dispose();
  });

  it("rebuilds a joint the restoring adapter never had", async () => {
    // The other direction of the round trip: an adapter that has never seen
    // this joint id has no record to re-point, so the registry entry is built
    // from the envelope alone — which is what makes a snapshot restorable into
    // a fresh process (§34) and not only into the world that wrote it.
    const source = await createAdapter();
    const anchor = anchorAt(source, new Vector3(0, 0, 0));
    const bob = ballAt(source, new Vector3(1, 0, 0), 0.05, 100);
    source.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(-1, 0, 0),
      axis: new Vector3(0, 0, 1),
      limits: { min: -0.8, max: 0.8 },
    });
    step(source, 30);
    const snapshot = source.createSnapshot();
    source.dispose();

    const fresh = await createAdapter();
    fresh.restoreSnapshot(snapshot);
    const rebuilt: PhysicsJointHandle[] = [];
    fresh.forEachJoint((handle, id) => {
      expect(id).toBe(1);
      rebuilt.push(handle);
    });
    expect(rebuilt).toHaveLength(1);
    // Live, and still a revolute joint: its limits reconfigure and bite.
    fresh.setJointLimits(rebuilt[0], -0.2, 0.2);
    const restoredBob = [...collectBodies(fresh)][1];
    let lowest = 0;
    for (let i = 0; i < 300; i += 1) {
      step(fresh, 1);
      const at = positionOf(fresh, restoredBob);
      lowest = Math.min(lowest, Math.atan2(at.y, at.x));
    }
    expect(lowest).toBeLessThan(-0.19);
    expect(lowest).toBeGreaterThan(-0.22);
    fresh.dispose();
  });

  it("retires a joint the snapshot does not carry", async () => {
    const adapter = await createAdapter();
    const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
    const bob = ballAt(adapter, new Vector3(1, 0, 0), 0.05, 100);
    const empty = adapter.createSnapshot();
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      axis: new Vector3(0, 0, 1),
    });
    adapter.restoreSnapshot(empty);
    expect(() => adapter.getJointId(joint)).toThrowError(FourError);
    let count = 0;
    adapter.forEachJoint(() => {
      count += 1;
    });
    expect(count).toBe(0);
    adapter.dispose();
  });

  it("rejects an envelope from an older format version", async () => {
    const adapter = await createAdapter();
    anchorAt(adapter, new Vector3(0, 0, 0));
    const snapshot = adapter.createSnapshot();
    expect(new DataView(snapshot).getUint32(4, true)).toBe(2);
    new DataView(snapshot).setUint32(4, 1, true);
    expect(() => {
      adapter.restoreSnapshot(snapshot);
    }).toThrowError(/envelope version 1 is not 2/u);
    adapter.dispose();
  });
});

describe("determinism with joints (§33)", () => {
  it("reproduces a jointed mechanism exactly across two identical runs", async () => {
    const run = async (): Promise<string> => {
      const adapter = await createAdapter();
      const anchor = anchorAt(adapter, new Vector3(0, 0, 0));
      const arm = barAt(adapter, new Vector3(1, 0, 0));
      adapter.createJoint({
        type: "revolute",
        bodyA: anchor,
        bodyB: arm,
        anchorA: new Vector3(0, 0, 0),
        anchorB: new Vector3(-1, 0, 0),
        axis: new Vector3(0, 0, 1),
        limits: { min: -1, max: 1 },
      });
      const bob = ballAt(adapter, new Vector3(2, 0, 0), 0.05, 100);
      adapter.createJoint({
        type: "rope",
        bodyA: arm,
        bodyB: bob,
        anchorA: new Vector3(0.5, 0, 0),
        anchorB: new Vector3(0, 0, 0),
        maxLength: 0.6,
      });
      step(adapter, 400);
      const digest: string[] = [];
      adapter.forEachBody((handle, id) => {
        const at = positionOf(adapter, handle);
        digest.push(`${String(id)}:${at.x}, ${at.y}, ${at.z}`);
      });
      adapter.dispose();
      return digest.join("|");
    };
    expect(await run()).toBe(await run());
  });
});
