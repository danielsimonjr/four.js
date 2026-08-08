/**
 * `Rapier2dAdapter`'s §28 joints against the **real** Rapier 2D wasm (§37,
 * §109, WP-6.2).
 *
 * No fake solver, for the same reason `rapier2d-adapter.test.ts` has none: an
 * adapter packet exists to prove the mapping onto a real engine, and a mock
 * would only re-assert this file's own assumptions. `@four/physics`'s
 * `FakeJointSolverAdapter` is where the *contract* is exercised without a
 * solver.
 *
 * ## The measurements these tests are written against
 *
 * Every constant below was measured against the installed `0.19.3`, not
 * derived from documentation:
 *
 * - **Pendulum period.** A 1 m pendulum released at `0.05 rad` completes a
 *   period in `2.0066 s` where the small-angle closed form `2π√(L/g)` gives
 *   `2.0061 s` — `2.5e-4` relative, well inside the `1%` these tests allow.
 *   The tolerance is loose on purpose: it is a statement about the *physics*
 *   being right, not a pin on Rapier's substepping, and a finite bob has a
 *   physical-pendulum correction of its own (`+1.5e-4` for the `r = 0.02`
 *   disc used here).
 * - **Sleeping is off** in every oscillation test. Rapier puts a slow pendulum
 *   to sleep within a second and it then never moves again, which would make a
 *   period unmeasurable; §32's switch is `sleeping: { enabled: false }`.
 * - **A motorized hinge is tested in free space.** Under gravity a pinned bar
 *   swings at ±3 rad/s all by itself, so "the motor reached 3 rad/s" would be
 *   true of a joint with no motor at all. With `gravity: 0` the unmotored bar
 *   stays at rest, and reaching the commanded rate means the motor did it.
 * - **Rapier's motor gain saturates.** `maxTorque` values of 5 and 200 both
 *   converge to the same steady rate here; see `setJointMotor` for why the
 *   number is a strength coefficient rather than the ceiling §28 describes.
 * - **A disabled motor is a gain of `1e-12`, not a gain of `0`** (WP-6.2-fix1).
 *   Rapier cannot remove a motor, and `configureMotorVelocity(0, 0)` is its
 *   *rigid* zero-velocity constraint: a bar turning at 3 rad/s drops to
 *   `0.294 rad/s` in one step and to `5.9e-44 rad/s` within a second. The
 *   `1e-12` gain is inert instead, and measurably so — a hinge and a slider
 *   carrying it reproduce an unmotorized rig **bit for bit**, `max |Δ| = 0`
 *   across position, angle, and both velocities, over 3600 steps and also over
 *   600 steps continuing from a joint that had just been driven hard. The tests
 *   below assert that equality rather than trusting this note.
 */

import { FourError } from "@four/core";
import { Quaternion, Vector2, Vector3 } from "@four/math";
import { supportsSolverJointAccess } from "@four/physics";
import type {
  JointDescriptor,
  PhysicsBodyHandle,
  PhysicsJointHandle,
  PhysicsWorldOptions,
} from "@four/physics";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createRapierVector2,
  revoluteAxisSignZ,
  toRapierJointAxis2d,
} from "../src/conversions2d.js";
import { initializeRapier2d } from "../src/init.js";
import { Rapier2dAdapter } from "../src/rapier2d-adapter.js";

/** One fixed step (§10). Seconds, like every duration in this engine (§7a). */
const DT = 1 / 60;

/** Appendix A gravity. */
const GRAVITY_Y = -9.81;

/** Scratch for every transform read below — the tests allocate nothing hot. */
const position = new Vector3();
const rotation = new Quaternion();
const linear = new Vector3();
const angular = new Vector3();

async function createAdapter(
  options?: Partial<PhysicsWorldOptions>,
): Promise<Rapier2dAdapter> {
  const adapter = new Rapier2dAdapter();
  await adapter.initialize({
    dimension: "2d",
    sleeping: { enabled: false },
    ...options,
  });
  return adapter;
}

/** A static body at `(x, y)` — the fixed side of every joint here. */
function anchorBody(adapter: Rapier2dAdapter, x = 0, y = 0): PhysicsBodyHandle {
  return adapter.createBody({ type: "static", position: new Vector2(x, y) });
}

/** A dynamic disc of radius `r` at `(x, y)`, optionally pre-rotated. */
function disc(
  adapter: Rapier2dAdapter,
  x: number,
  y: number,
  r: number,
  angle = 0,
): PhysicsBodyHandle {
  const body = adapter.createBody({
    type: "dynamic",
    position: new Vector2(x, y),
    rotation: angle,
  });
  adapter.createCollider({ body, shape: { type: "circle", radius: r } });
  return body;
}

/** A dynamic box of half-extents `(hx, hy)` at `(x, y)`. */
function boxBody(
  adapter: Rapier2dAdapter,
  x: number,
  y: number,
  hx: number,
  hy: number,
): PhysicsBodyHandle {
  const body = adapter.createBody({
    type: "dynamic",
    position: new Vector2(x, y),
  });
  adapter.createCollider({
    body,
    shape: { type: "rectangle", halfExtents: new Vector2(hx, hy) },
  });
  return body;
}

/** The body's world position, into the shared scratch vector. */
function positionOf(
  adapter: Rapier2dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  adapter.getBodyTransform(body, position, rotation);
  return position;
}

/** The body's rotation about +Z in radians (§21). */
function angleOf(adapter: Rapier2dAdapter, body: PhysicsBodyHandle): number {
  adapter.getBodyTransform(body, position, rotation);
  return 2 * Math.atan2(rotation.z, rotation.w);
}

/** The body's angular velocity about +Z in rad/s (§21). */
function angularVelocityOf(
  adapter: Rapier2dAdapter,
  body: PhysicsBodyHandle,
): number {
  adapter.getBodyVelocities(body, linear, angular);
  return angular.z;
}

/** Advances the solver `steps` times. */
function run(adapter: Rapier2dAdapter, steps: number): void {
  for (let i = 0; i < steps; i += 1) {
    adapter.step(DT);
  }
}

/**
 * A body's whole planar state: `[x, y, angle, vx, vy, ω]`.
 *
 * Every component, not only the interesting one, because the motor tests below
 * assert *bit-identical* trajectories — a claim that is only worth making about
 * the complete state.
 */
function stateOf(
  adapter: Rapier2dAdapter,
  body: PhysicsBodyHandle,
): readonly number[] {
  adapter.getBodyTransform(body, position, rotation);
  const x = position.x;
  const y = position.y;
  const angle = 2 * Math.atan2(rotation.z, rotation.w);
  adapter.getBodyVelocities(body, linear, angular);
  return [x, y, angle, linear.x, linear.y, angular.z];
}

/** {@link stateOf} sampled after each of `steps` steps. */
function trajectoryOf(
  adapter: Rapier2dAdapter,
  body: PhysicsBodyHandle,
  steps: number,
): readonly (readonly number[])[] {
  const samples: (readonly number[])[] = [];
  for (let i = 0; i < steps; i += 1) {
    run(adapter, 1);
    samples.push(stateOf(adapter, body));
  }
  return samples;
}

/**
 * A 1 m × 0.1 m bar pinned at its left end to a static anchor at the origin —
 * the rig every motor and limit test below uses. Mass `0.1 kg`.
 */
function pinnedBar(
  adapter: Rapier2dAdapter,
  joint: Partial<JointDescriptor> = {},
): {
  anchor: PhysicsBodyHandle;
  bar: PhysicsBodyHandle;
  joint: PhysicsJointHandle;
} {
  const anchor = anchorBody(adapter);
  const bar = boxBody(adapter, 0.5, 0, 0.5, 0.05);
  const handle = adapter.createJoint({
    type: "revolute",
    bodyA: anchor,
    bodyB: bar,
    anchorA: new Vector2(0, 0),
    anchorB: new Vector2(-0.5, 0),
    ...joint,
  } as JointDescriptor);
  return { anchor, bar, joint: handle };
}

beforeAll(async () => {
  await initializeRapier2d();
});

describe("capabilities and the SolverJointAccess seam (§37, plan P6-1)", () => {
  it("declares exactly the planar joint tier it builds", async () => {
    const adapter = await createAdapter();
    expect([...adapter.capabilities.jointTypes]).toEqual([
      "fixed",
      "spring",
      "revolute",
      "prismatic",
      "rope",
    ]);
    // §21: a plane has no ball joint, and Rapier 2D has no factory for one.
    expect(adapter.capabilities.jointTypes).not.toContain("spherical");
    adapter.dispose();
  });

  it("is detected structurally as a joint-carrying adapter (WP-6.1)", async () => {
    const adapter = await createAdapter();
    expect(supportsSolverJointAccess(adapter)).toBe(true);
    adapter.dispose();
  });

  it("reports no joint reactions, and says so instead of inventing them", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const bob = disc(adapter, 1, 0, 0.05);
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorB: new Vector2(-1, 0),
    });
    run(adapter, 10);

    expect(adapter.reportsJointReactions).toBe(false);
    try {
      adapter.getJointReaction(joint, linear, angular);
      throw new Error("expected getJointReaction to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(FourError);
      expect((error as FourError).code).toBe("NOT_IMPLEMENTED");
      expect((error as FourError).message).toMatch(/no joint reaction/u);
    }
    adapter.dispose();
  });
});

describe("revolute joints (§28 hinge)", () => {
  it("swings a pendulum at the small-angle period 2π√(L/g)", async () => {
    const adapter = await createAdapter();
    const length = 1;
    const theta0 = 0.05;
    const anchor = anchorBody(adapter);
    const bob = disc(
      adapter,
      length * Math.sin(theta0),
      -length * Math.cos(theta0),
      0.02,
      theta0,
    );
    adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector2(0, 0),
      anchorB: new Vector2(0, length),
    });

    // Zero crossings of the swing angle, linearly interpolated between steps.
    const crossings: number[] = [];
    let previous = theta0;
    for (let step = 1; step <= 1200; step += 1) {
      adapter.step(DT);
      const p = positionOf(adapter, bob);
      const angle = Math.atan2(p.x, -p.y);
      if ((previous > 0 && angle <= 0) || (previous < 0 && angle >= 0)) {
        crossings.push((step - 1 + previous / (previous - angle)) * DT);
      }
      previous = angle;
    }

    expect(crossings.length).toBeGreaterThanOrEqual(3);
    const first = crossings[0];
    const last = crossings[crossings.length - 1];
    const period = (2 * (last - first)) / (crossings.length - 1);
    const closedForm = 2 * Math.PI * Math.sqrt(length / -GRAVITY_Y);
    // Measured 2.00657 s against a closed form of 2.00607 s: 2.5e-4 relative.
    expect(Math.abs(period - closedForm) / closedForm).toBeLessThan(0.01);
    adapter.dispose();
  });

  it("holds the pendulum's suspension point and stays bounded for 3600 steps", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const bob = disc(adapter, 0.5, -0.866, 0.05, Math.PI / 6);
    adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorB: new Vector2(0, 1),
    });

    let maxRadius = 0;
    for (let step = 0; step < 3600; step += 1) {
      adapter.step(DT);
      const p = positionOf(adapter, bob);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      maxRadius = Math.max(maxRadius, Math.hypot(p.x, p.y));
    }
    // The bob never leaves the circle of radius 1 the constraint defines.
    expect(maxRadius).toBeCloseTo(1, 3);
    adapter.dispose();
  });

  it("clamps a swing to its limits", async () => {
    const adapter = await createAdapter();
    const { bar } = pinnedBar(adapter, { limits: { min: -0.4, max: 0.4 } });

    let lowest = 0;
    for (let step = 0; step < 600; step += 1) {
      adapter.step(DT);
      lowest = Math.min(lowest, angleOf(adapter, bar));
    }
    // Gravity would take the bar to -π/2; the limit stops it at -0.4 (measured
    // overshoot 1.1e-3 rad, which is the solver's own constraint softness).
    expect(lowest).toBeLessThan(-0.35);
    expect(lowest).toBeGreaterThan(-0.41);
    adapter.dispose();
  });

  it("mirrors limits for a −Z hinge axis (§21)", async () => {
    const limits = { min: 0, max: 0.9 };

    // About +Z the authored range [0, 0.9] forbids swinging down at all, so
    // the bar hangs on its upper limit where gravity found it.
    const plus = await createAdapter();
    const plusRig = pinnedBar(plus, { axis: new Vector3(0, 0, 1), limits });
    run(plus, 300);
    expect(angleOf(plus, plusRig.bar)).toBeCloseTo(0, 2);
    plus.dispose();

    const minus = await createAdapter();
    const minusRig = pinnedBar(minus, { axis: new Vector3(0, 0, -1), limits });
    run(minus, 300);
    // The same authored range about −Z is [−0.9, 0] about +Z: the bar falls to
    // −0.9 instead of being held up.
    expect(angleOf(minus, minusRig.bar)).toBeCloseTo(-0.9, 2);
    minus.dispose();
  });

  it("drives a shaft to the commanded angular velocity", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const { bar } = pinnedBar(adapter, {
      motor: { targetVelocity: 3, maxTorque: 50 },
    });
    run(adapter, 600);
    // Measured 2.9997 rad/s; without a motor this bar never leaves rest.
    expect(angularVelocityOf(adapter, bar)).toBeCloseTo(3, 2);
    adapter.dispose();
  });

  it("mirrors the motor rate for a −Z hinge axis", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const { bar } = pinnedBar(adapter, {
      axis: new Vector3(0, 0, -1),
      motor: { targetVelocity: 3, maxTorque: 50 },
    });
    run(adapter, 600);
    expect(angularVelocityOf(adapter, bar)).toBeCloseTo(-3, 2);
    adapter.dispose();
  });

  it("drives nothing when the motor arrives disabled", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const { bar, joint } = pinnedBar(adapter, {
      motor: { enabled: false, targetVelocity: 3, maxTorque: 50 },
    });
    run(adapter, 120);
    expect(angularVelocityOf(adapter, bar)).toBeCloseTo(0, 6);

    // Still disabled: the inert configuration is re-applied and still drives
    // nothing. (A *rigid* zero motor would be indistinguishable here — the bar
    // is at rest either way — which is why the next test compares trajectories
    // rather than a single number.)
    adapter.setJointMotor(joint, {
      enabled: false,
      targetVelocity: 3,
      maxEffort: 50,
    });
    run(adapter, 120);
    expect(angularVelocityOf(adapter, bar)).toBeCloseTo(0, 6);
    adapter.dispose();
  });

  it("makes a disabled motor indistinguishable from no motor at all", async () => {
    // The measurement `INERT_MOTOR_GAIN` rests on, asserted rather than
    // asserted about (WP-6.2-fix1): Rapier cannot remove a motor, so a disabled
    // one is configured with a gain of 1e-12 — and a joint carrying it must
    // follow *exactly* the trajectory of a joint that never had a motor, under
    // load, in every component of the state. Measured against 2D 0.19.3:
    // max |Δ| = 0 over 3600 steps. 600 steps are run here.
    //
    // Gravity is on, unlike the driving tests: a free hinge has to be doing
    // something for "identical" to mean anything, and the bar swings.
    const trajectory = async (
      motorized: boolean,
    ): Promise<readonly (readonly number[])[]> => {
      const adapter = await createAdapter();
      const { bar, joint } = pinnedBar(
        adapter,
        motorized
          ? { motor: { enabled: false, targetVelocity: 3, maxTorque: 50 } }
          : {},
      );
      if (motorized) {
        adapter.setJointMotor(joint, {
          enabled: false,
          targetVelocity: 3,
          maxEffort: 50,
        });
      }
      const samples = trajectoryOf(adapter, bar, 600);
      adapter.dispose();
      return samples;
    };
    const disabled = await trajectory(true);
    const never = await trajectory(false);
    // The rig genuinely moves, so the equality below is not two rows of zeros.
    expect(Math.abs(never[599]?.[2] ?? 0)).toBeGreaterThan(0.5);
    expect(disabled).toEqual(never);
  });

  it("releases a running motor rather than braking the joint", async () => {
    // Disabling a motor that *is* running is the case Rapier makes awkward:
    // its only other spelling of "no motor", configureMotorVelocity(0, 0), is a
    // rigid zero-velocity constraint that stops the bar dead (measured: 3 rad/s
    // → 0.294 rad/s in one step, → 5.9e-44 rad/s within a second). The inert
    // gain releases the axis instead, and this test pins both halves of that:
    // the bar keeps its speed, and its continuation is *bit-identical* to a
    // never-motorized control placed in the same state.
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const { bar, joint } = pinnedBar(adapter, {
      motor: { targetVelocity: 3, maxTorque: 50 },
    });
    run(adapter, 120);
    expect(angularVelocityOf(adapter, bar)).toBeCloseTo(3, 2);

    adapter.setJointMotor(joint, {
      enabled: false,
      targetVelocity: 3,
      maxEffort: 50,
    });
    const released = stateOf(adapter, bar);

    // The control never had a motor and is put into the released bar's exact
    // state at the moment of the disable. The two histories differ — that is
    // unavoidable, one of them ran a motor — so what is compared is what the
    // claim is actually about: from the same state, the released joint and the
    // free joint move the same way.
    const control = await createAdapter({ gravity: new Vector2(0, 0) });
    const free = pinnedBar(control);
    control.setBodyTransform(
      free.bar,
      new Vector3(released[0] ?? 0, released[1] ?? 0, 0),
      released[2] ?? 0,
    );
    control.setBodyVelocities(
      free.bar,
      new Vector3(released[3] ?? 0, released[4] ?? 0, 0),
      released[5] ?? 0,
    );

    const releasedRun = trajectoryOf(adapter, bar, 600);
    const freeRun = trajectoryOf(control, free.bar, 600);
    // Not braked: one step after the disable the bar is still turning at the
    // speed it had. A rigid zero motor would have taken it to ~0.29 rad/s.
    expect(releasedRun[0]?.[5]).toBeCloseTo(3, 2);
    expect(releasedRun).toEqual(freeRun);
    // And it is coasting, not being held at a target: the hinge sheds a little
    // speed to the solver over ten seconds (measured: 3.0 → 2.65 rad/s) instead
    // of being driven back to 3.
    expect(freeRun[599]?.[5]).toBeLessThan(2.9);
    expect(freeRun[599]?.[5]).toBeGreaterThan(2.4);
    adapter.dispose();
    control.dispose();
  });

  it("treats a zero maxEffort as an inert motor, not a rigid brake", async () => {
    // `maxEffort: 0` asks for a drive that exerts nothing, which is the same
    // request as a disabled motor — and *not* what Rapier's zero gain does.
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const { bar, joint } = pinnedBar(adapter, {
      motor: { targetVelocity: 3, maxTorque: 50 },
    });
    run(adapter, 120);

    adapter.setJointMotor(joint, {
      enabled: true,
      targetVelocity: 3,
      maxEffort: 0,
    });
    run(adapter, 60);
    // Coasting a second later (measured 2.9585 rad/s), where Rapier's own zero
    // gain would have left 5.9e-44 rad/s.
    expect(angularVelocityOf(adapter, bar)).toBeGreaterThan(2.9);
    expect(angularVelocityOf(adapter, bar)).toBeLessThan(3);
    adapter.dispose();
  });

  it("reconfigures limits and the motor after creation (§28)", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const { bar, joint } = pinnedBar(adapter, {
      motor: { targetVelocity: 3, maxTorque: 50 },
    });
    run(adapter, 300);
    expect(angularVelocityOf(adapter, bar)).toBeCloseTo(3, 2);

    adapter.setJointMotor(joint, {
      enabled: true,
      targetVelocity: -1,
      maxEffort: 50,
    });
    run(adapter, 300);
    expect(angularVelocityOf(adapter, bar)).toBeCloseTo(-1, 2);

    adapter.setJointLimits(joint, -0.2, 0.2);
    run(adapter, 300);
    expect(angleOf(adapter, bar)).toBeGreaterThan(-0.21);
    adapter.dispose();
  });
});

describe("prismatic joints (§28 slider)", () => {
  it("slides along its axis and along nothing else", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const slider = boxBody(adapter, 0, 0, 0.1, 0.1);
    adapter.createJoint({
      type: "prismatic",
      bodyA: anchor,
      bodyB: slider,
      axis: new Vector2(1, 0),
    });

    run(adapter, 300);
    const p = positionOf(adapter, slider);
    // Gravity is pulling straight down and the slider does not budge in y.
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeCloseTo(0, 6);
    adapter.dispose();
  });

  it("drives to a limit under a linear motor and stops there", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const slider = boxBody(adapter, 0, 0, 0.1, 0.1);
    adapter.createJoint({
      type: "prismatic",
      bodyA: anchor,
      bodyB: slider,
      axis: new Vector2(1, 0),
      limits: { min: -0.5, max: 1.5 },
      motor: { targetVelocity: 0.5, maxForce: 20 },
    });

    run(adapter, 200);
    expect(positionOf(adapter, slider).x).toBeCloseTo(1.5, 2);
    run(adapter, 400);
    // It stays at the limit rather than creeping through it.
    const p = positionOf(adapter, slider);
    expect(p.x).toBeCloseTo(1.5, 2);
    expect(p.y).toBeCloseTo(0, 6);
    adapter.dispose();
  });

  it("takes a non-unit axis and measures its limits in metres", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const anchor = anchorBody(adapter);
    const slider = boxBody(adapter, 0, 0, 0.1, 0.1);
    adapter.createJoint({
      type: "prismatic",
      bodyA: anchor,
      bodyB: slider,
      axis: new Vector2(3, 0),
      limits: { min: -1, max: 1 },
    });
    adapter.setBodyVelocities(slider, new Vector2(5, 0), 0);

    run(adapter, 120);
    expect(positionOf(adapter, slider).x).toBeCloseTo(1, 2);
    adapter.dispose();
  });
});

describe("rope joints (§28)", () => {
  it("caps the separation at maxLength and leaves slack alone", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const load = boxBody(adapter, 0, -0.5, 0.05, 0.05);
    adapter.createJoint({
      type: "rope",
      bodyA: anchor,
      bodyB: load,
      maxLength: 2,
    });

    // One step: still slack, so the load is in free fall.
    adapter.step(DT);
    expect(positionOf(adapter, load).y).toBeLessThan(-0.5);
    expect(positionOf(adapter, load).y).toBeGreaterThan(-0.6);

    run(adapter, 600);
    const p = positionOf(adapter, load);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 3);
    adapter.dispose();
  });
});

describe("spring joints (§28 spring, damping)", () => {
  it("oscillates about its rest length and settles onto it", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const anchor = anchorBody(adapter);
    const bob = boxBody(adapter, 0, -2, 0.2, 0.2);
    adapter.createJoint({
      type: "spring",
      bodyA: anchor,
      bodyB: bob,
      restLength: 1,
      stiffness: 40,
      damping: 2,
    });

    let earlySwing = 0;
    for (let step = 0; step < 120; step += 1) {
      adapter.step(DT);
      earlySwing = Math.max(
        earlySwing,
        Math.abs(positionOf(adapter, bob).y + 1),
      );
    }
    let lateSwing = 0;
    for (let step = 0; step < 480; step += 1) {
      adapter.step(DT);
      lateSwing = Math.max(lateSwing, Math.abs(positionOf(adapter, bob).y + 1));
    }

    // Measured: the first second swings ~0.96 m about the rest length and the
    // amplitude is under a millimetre by the end.
    expect(earlySwing).toBeGreaterThan(0.5);
    expect(lateSwing).toBeLessThan(0.05);
    expect(positionOf(adapter, bob).y).toBeCloseTo(-1, 2);
    adapter.dispose();
  });

  it("takes an omitted damping as zero and still oscillates", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const anchor = anchorBody(adapter);
    const bob = boxBody(adapter, 0, -2, 0.2, 0.2);
    adapter.createJoint({
      type: "spring",
      bodyA: anchor,
      bodyB: bob,
      restLength: 1,
      stiffness: 40,
    });

    let swing = 0;
    for (let step = 0; step < 120; step += 1) {
      adapter.step(DT);
      swing = Math.max(swing, Math.abs(positionOf(adapter, bob).y + 1));
    }
    expect(swing).toBeGreaterThan(0.5);
    adapter.dispose();
  });
});

describe("fixed joints (§28)", () => {
  it("keeps the relative pose the bodies had, under load", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const welded = adapter.createBody({
      type: "dynamic",
      position: new Vector2(1, 0),
      rotation: 0.7,
    });
    adapter.createCollider({
      body: welded,
      shape: { type: "rectangle", halfExtents: new Vector2(0.1, 0.1) },
    });
    adapter.createJoint({
      type: "fixed",
      bodyA: anchor,
      bodyB: welded,
      anchorA: new Vector2(1, 0),
      anchorB: new Vector2(0, 0),
    });

    run(adapter, 300);
    const p = positionOf(adapter, welded);
    expect(p.x).toBeCloseTo(1, 3);
    expect(p.y).toBeCloseTo(0, 3);
    // Not snapped to the anchor's orientation: the pose at creation is kept.
    expect(angleOf(adapter, welded)).toBeCloseTo(0.7, 3);
    adapter.dispose();
  });
});

describe("collisionEnabled (§28)", () => {
  it("lets the jointed bodies collide when asked, and not by default", async () => {
    const separations: number[] = [];
    for (const collisionEnabled of [true, false]) {
      const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
      const anchor = adapter.createBody({ type: "static" });
      adapter.createCollider({
        body: anchor,
        shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
      });
      const other = boxBody(adapter, 0.2, 0, 0.5, 0.5);
      adapter.createJoint({
        type: "rope",
        bodyA: anchor,
        bodyB: other,
        maxLength: 5,
        collisionEnabled,
      });
      run(adapter, 120);
      separations.push(positionOf(adapter, other).x);
      adapter.dispose();
    }

    // Overlapping boxes push each other apart with contacts on (measured 2.05 m
    // of travel) and stay exactly where they were with contacts off — §28's
    // default, and the opposite of Rapier's.
    expect(separations[0]).toBeGreaterThan(0.9);
    expect(separations[1]).toBeCloseTo(0.2, 6);
  });

  it("switches contacts on after creation, live (PH-22f)", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const anchor = adapter.createBody({ type: "static" });
    adapter.createCollider({
      body: anchor,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });
    const other = boxBody(adapter, 0.2, 0, 0.5, 0.5);
    const joint = adapter.createJoint({
      type: "rope",
      bodyA: anchor,
      bodyB: other,
      maxLength: 5,
      collisionEnabled: false,
    });

    // Overlapping, contacts off: nothing moves.
    run(adapter, 60);
    expect(positionOf(adapter, other).x).toBeCloseTo(0.2, 6);

    // `setContactsEnabled` is on Rapier's *base* joint class, so this works on
    // a rope joint — which has neither limits nor a motor to reconfigure.
    adapter.setJointCollisionEnabled(joint, true);
    run(adapter, 120);
    expect(positionOf(adapter, other).x).toBeGreaterThan(0.9);

    // …and back off again: the box coasts on the velocity the contact gave it
    // (there is no gravity and no damping here) but stops being *accelerated*,
    // so its velocity is unchanged across the next second.
    adapter.setJointCollisionEnabled(joint, false);
    adapter.getBodyVelocities(other, linear, angular);
    const coasting = linear.x;
    run(adapter, 60);
    adapter.getBodyVelocities(other, linear, angular);
    expect(linear.x).toBeCloseTo(coasting, 5);
    adapter.dispose();
  });

  it("refuses a destroyed joint handle", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const other = disc(adapter, 1, 0, 0.25);
    const joint = adapter.createJoint({
      type: "rope",
      bodyA: anchor,
      bodyB: other,
      maxLength: 2,
    });
    adapter.destroyJoint(joint);
    expect(() => {
      adapter.setJointCollisionEnabled(joint, true);
    }).toThrowError(/not valid for this Rapier2dAdapter/u);
    adapter.dispose();
  });
});

describe("the joint registry (§33, §37)", () => {
  it("mints monotonic ids and visits joints in creation order", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const handles = [1, 2, 3].map((i) => {
      const body = disc(adapter, i, 0, 0.05);
      return adapter.createJoint({
        type: "revolute",
        bodyA: anchor,
        bodyB: body,
        anchorA: new Vector2(i, 0),
      });
    });
    expect(handles.map((handle) => adapter.getJointId(handle))).toEqual([
      1, 2, 3,
    ]);

    adapter.destroyJoint(handles[1]);
    const visited: number[] = [];
    adapter.forEachJoint((handle, id) => {
      expect(adapter.getJointId(handle)).toBe(id);
      visited.push(id);
    });
    // Destroying the middle joint neither renumbers nor reorders the rest.
    expect(visited).toEqual([1, 3]);

    const replacement = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: disc(adapter, 4, 0, 0.05),
      anchorA: new Vector2(4, 0),
    });
    expect(adapter.getJointId(replacement)).toBe(4);
    adapter.dispose();
  });

  it("rejects a destroyed, foreign, or already-retired handle", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const bob = disc(adapter, 1, 0, 0.05);
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector2(1, 0),
    });

    adapter.destroyJoint(joint);
    expect(() => adapter.getJointId(joint)).toThrowError(
      /Joint handle is not valid/u,
    );
    expect(() => adapter.destroyJoint(joint)).toThrowError(
      /Joint handle is not valid/u,
    );
    expect(() =>
      adapter.getJointId({} as unknown as PhysicsJointHandle),
    ).toThrowError(/Joint handle is not valid/u);
    adapter.dispose();
  });

  it("retires the joints of a destroyed body, as Rapier does (§83)", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const bob = disc(adapter, 1, 0, 0.05);
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector2(1, 0),
    });
    run(adapter, 10);

    adapter.destroyBody(bob);
    let count = 0;
    adapter.forEachJoint(() => {
      count += 1;
    });
    expect(count).toBe(0);
    expect(() => adapter.getJointId(joint)).toThrowError(
      /Joint handle is not valid/u,
    );
    // The world keeps stepping without the retired constraint.
    run(adapter, 60);
    adapter.dispose();
  });

  it("stays stable when a joint is destroyed mid-run", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const bob = disc(adapter, 1, 0, 0.05);
    const joint = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector2(1, 0),
    });

    run(adapter, 60);
    const held = positionOf(adapter, bob).y;
    expect(Math.hypot(positionOf(adapter, bob).x, held)).toBeCloseTo(1, 3);

    adapter.destroyJoint(joint);
    run(adapter, 60);
    const released = positionOf(adapter, bob);
    // Freed from the constraint, the bob simply falls.
    expect(released.y).toBeLessThan(held - 0.5);
    expect(Number.isFinite(released.x) && Number.isFinite(released.y)).toBe(
      true,
    );
    adapter.dispose();
  });
});

describe("commands a joint type cannot carry (§28)", () => {
  it("refuses limits and motors on fixed, rope, and spring joints", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const descriptors: JointDescriptor[] = [
      {
        type: "fixed",
        bodyA: anchor,
        bodyB: disc(adapter, 1, 0, 0.05),
        anchorA: new Vector2(1, 0),
      },
      {
        type: "rope",
        bodyA: anchor,
        bodyB: disc(adapter, 2, 0, 0.05),
        maxLength: 2,
      },
      {
        type: "spring",
        bodyA: anchor,
        bodyB: disc(adapter, 3, 0, 0.05),
        restLength: 1,
        stiffness: 10,
      },
    ];

    for (const descriptor of descriptors) {
      const joint = adapter.createJoint(descriptor);
      expect(() => adapter.setJointLimits(joint, -1, 1)).toThrowError(
        /no driven degree of freedom/u,
      );
      expect(() =>
        adapter.setJointMotor(joint, {
          enabled: true,
          targetVelocity: 1,
          maxEffort: 1,
        }),
      ).toThrowError(/no driven degree of freedom/u);
    }
    adapter.dispose();
  });

  it("refuses a ball joint in a plane (§21, plan P6-1)", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const bob = disc(adapter, 1, 0, 0.05);
    expect(() =>
      adapter.createJoint({
        type: "spherical",
        bodyA: anchor,
        bodyB: bob,
      } as unknown as JointDescriptor),
    ).toThrowError(/not valid in a "2d" world/u);
    adapter.dispose();
  });

  it("refuses an out-of-plane hinge axis and a zero slider axis (§21, §85)", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const bob = disc(adapter, 1, 0, 0.05);
    expect(() =>
      adapter.createJoint({
        type: "revolute",
        bodyA: anchor,
        bodyB: bob,
        axis: new Vector3(1, 0, 0),
      }),
    ).toThrowError(/must be along ±Z/u);
    expect(() =>
      adapter.createJoint({
        type: "prismatic",
        bodyA: anchor,
        bodyB: bob,
        axis: new Vector2(0, 0),
      }),
    ).toThrowError(/non-zero direction/u);
    adapter.dispose();
  });
});

describe("snapshots with joints (§34, envelope version 2)", () => {
  it("round-trips the registry and reproduces the run exactly", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const { bar, joint } = pinnedBar(adapter, {
      limits: { min: -2, max: 2 },
      motor: { targetVelocity: 3, maxTorque: 50 },
    });
    run(adapter, 60);

    const snapshot = adapter.createSnapshot();
    const continuation: number[] = [];
    for (let step = 0; step < 120; step += 1) {
      adapter.step(DT);
      continuation.push(angleOf(adapter, bar));
    }

    adapter.restoreSnapshot(snapshot);
    // The handles minted before the snapshot still work — same id, same joint.
    expect(adapter.getJointId(joint)).toBe(1);
    const ids: number[] = [];
    adapter.forEachJoint((_handle, id) => ids.push(id));
    expect(ids).toEqual([1]);

    const replay: number[] = [];
    for (let step = 0; step < 120; step += 1) {
      adapter.step(DT);
      replay.push(angleOf(adapter, bar));
    }
    expect(replay).toEqual(continuation);

    // The restored joint is still a live, reconfigurable constraint. The
    // command reverses the shaft, because by now it is parked on the +2 rad
    // limit and a slower forward rate would be indistinguishable from that.
    adapter.setJointMotor(joint, {
      enabled: true,
      targetVelocity: -0.5,
      maxEffort: 50,
    });
    run(adapter, 300);
    expect(angularVelocityOf(adapter, bar)).toBeCloseTo(-0.5, 2);
    adapter.dispose();
  });

  it("keeps the joint id sequence going across a restore", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const first = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: disc(adapter, 1, 0, 0.05),
      anchorA: new Vector2(1, 0),
    });
    const snapshot = adapter.createSnapshot();
    adapter.destroyJoint(first);
    adapter.restoreSnapshot(snapshot);

    const next = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: disc(adapter, 2, 0, 0.05),
      anchorA: new Vector2(2, 0),
    });
    // Ids are never reused, restore or no restore (§33).
    expect(adapter.getJointId(next)).toBe(2);
    adapter.dispose();
  });

  it("drops a record the snapshot does not name", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    const snapshot = adapter.createSnapshot();
    const later = adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: disc(adapter, 1, 0, 0.05),
      anchorA: new Vector2(1, 0),
    });

    adapter.restoreSnapshot(snapshot);
    expect(() => adapter.getJointId(later)).toThrowError(
      /Joint handle is not valid/u,
    );
    adapter.dispose();
  });

  it("refuses an envelope whose joint table does not match its Rapier bytes", async () => {
    const adapter = await createAdapter();
    const anchor = anchorBody(adapter);
    adapter.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: disc(adapter, 1, 0, 0.05),
      anchorA: new Vector2(1, 0),
    });

    const snapshot = adapter.createSnapshot();
    const header = new DataView(snapshot);
    const metaLength = header.getUint32(8, true);
    const rapierLength = header.getUint32(12, true);
    const bytes = new Uint8Array(snapshot);
    const meta = JSON.parse(
      new TextDecoder().decode(bytes.subarray(16, 16 + metaLength)),
    ) as {
      joints: [number, number, string, number, number, number][];
    };
    // A Rapier joint handle is a packed `(generation, index)` pair read as a
    // double, so a *plausible-looking* integer like 999999 decodes to index 0
    // and resolves to the real joint. This denormal decodes to index 9999,
    // which the restored world genuinely does not have.
    meta.joints[0][1] = Number.MIN_VALUE * 9999;
    const rewritten = new TextEncoder().encode(JSON.stringify(meta));
    const rebuilt = new ArrayBuffer(16 + rewritten.byteLength + rapierLength);
    const out = new Uint8Array(rebuilt);
    out.set(bytes.subarray(0, 16));
    out.set(rewritten, 16);
    out.set(
      bytes.subarray(16 + metaLength, 16 + metaLength + rapierLength),
      16 + rewritten.byteLength,
    );
    const rebuiltHeader = new DataView(rebuilt);
    rebuiltHeader.setUint32(8, rewritten.byteLength, true);
    rebuiltHeader.setUint32(12, rapierLength, true);

    expect(() => adapter.restoreSnapshot(rebuilt)).toThrowError(
      /does not contain/u,
    );
    adapter.dispose();
  });
});

describe("the joint conversion helpers (§21)", () => {
  it("reads the sign of a hinge axis and rejects anything off ±Z", () => {
    expect(revoluteAxisSignZ(undefined)).toBe(1);
    expect(revoluteAxisSignZ(new Vector3(0, 0, 1))).toBe(1);
    expect(revoluteAxisSignZ(new Vector3(0, 0, 7))).toBe(1);
    expect(revoluteAxisSignZ(new Vector3(0, 0, -0.5))).toBe(-1);

    // Reached directly here because `validateJointDescriptor` rejects these
    // before `createJoint` ever calls the helper; the helper still owns the
    // rule, so it is tested where it lives.
    for (const axis of [
      new Vector3(1, 0, 1),
      new Vector3(0, 1, 1),
      new Vector3(0, 0, 0),
      new Vector2(0, 0),
      new Vector3(0, 0, Number.NaN),
    ]) {
      expect(() => revoluteAxisSignZ(axis)).toThrowError(/must be along ±Z/u);
    }
  });

  it("normalizes a slider axis and rejects the zero direction", () => {
    const out = createRapierVector2();
    expect(toRapierJointAxis2d("axis", new Vector2(3, 0), out)).toBe(out);
    expect(out).toEqual({ x: 1, y: 0 });
    toRapierJointAxis2d("axis", new Vector2(0, -2), out);
    expect(out).toEqual({ x: 0, y: -1 });
    toRapierJointAxis2d("axis", new Vector2(3, 4), out);
    expect(out.x).toBeCloseTo(0.6, 12);
    expect(out.y).toBeCloseTo(0.8, 12);

    expect(() =>
      toRapierJointAxis2d("axis", new Vector2(0, 0), out),
    ).toThrowError(/non-zero direction in the XY plane/u);
    expect(() =>
      toRapierJointAxis2d("axis", new Vector3(1, 0, 1), out),
    ).toThrowError(/has no z axis/u);
  });
});
