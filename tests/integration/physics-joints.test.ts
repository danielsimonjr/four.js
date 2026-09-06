/**
 * Phase 6 cross-integration: §28's **joints driven through a real Rapier
 * solver**, in both §21 dimensions, through the public API only (WP-6.4;
 * §28, §33, §37, §109).
 *
 * The shape is WP-5.6's (`physics-rapier.test.ts`) and so is the rig: a
 * headless `Application` from `four/application`, one `PhysicsSystem`, and
 * worlds built on real `Rapier2dAdapter` / `Rapier3dAdapter` instances. What is
 * new is that every mechanism below is assembled from the §28 **classes** —
 * `HingeJoint`, `SliderJoint`, `SpringJoint`, `RopeJoint`, `SphericalJoint` —
 * with world-space anchors, registered with `world.addJoint`, and reconfigured
 * afterwards through `setLimits` / `setMotor` / `enableMotor`. Neither half of
 * Phase 6 is tested that way anywhere else: `packages/physics/tests/` drives
 * `PhysicsWorld` against a structural fake and never reaches a solver, and
 * `packages/physics-rapier/tests/` drives `createJoint` with **body-local**
 * descriptors and never sees a `Joint`, a node, an authority, or an application.
 *
 * ## What the analytic assertions compare against
 *
 * Every tolerance below is stated at its assertion together with the number
 * this packet actually measured against Rapier 0.19.3. In summary:
 *
 * | Case                        | Measured (2d / 3d)                     |
 * | --------------------------- | -------------------------------------- |
 * | Pendulum period vs `2π√(L/g)` | `+0.2561%` / `+0.2542%`              |
 * | …vs the finite-amplitude form | `+6.1e-5` / `+4.2e-5` relative       |
 * | Motor steady state (3 rad/s)  | `3.000000` / `3.000000`              |
 * | Slider limit overshoot        | `0` / `0` (parks exactly on ±0.5)    |
 * | Spring period vs `2π√(m/k)`   | `+5.77e-4` relative, both            |
 * | Rope slack past `maxLength`   | `0` / `0`                            |
 * | Hinge anchor drift, 3600 steps| `1.35e-5 m` / `1.34e-5 m`            |
 *
 * The pendulum's `+0.25%` is **physics, not solver error**: a pendulum released
 * at `θ₀ = 0.2 rad` has the first-order correction `T ≈ T₀(1 + θ₀²/16)`, which
 * is `+0.25%` on its own — and the measurement sits within `6.1e-5` of *that*.
 * The packet asks for `< 1%` against the small-angle form and that is what is
 * asserted, with the correction asserted alongside it so the residual is
 * explained rather than absorbed.
 *
 * ## Breakage: why the only real break here runs on a scripted solver
 *
 * §28's `breakForce` / `breakTorque` are enforced by `PhysicsWorld`, which
 * needs the constraint's reaction impulse — and **both Rapier adapters report
 * `reportsJointReactions: false`**, because Rapier 0.19.3 exposes no joint
 * reaction anywhere (verified three ways by WP-6.2/6.3). A breakable joint on a
 * Rapier world is therefore *refused*, loudly, which is the first thing this
 * suite asserts about breakage — in both dimensions, because that refusal is
 * the behaviour every application on this solver will actually meet.
 *
 * The break path itself is then exercised on `ScriptedJointAdapter`
 * (`helpers/joint-scenarios.ts`), a local double with scripted reactions: the
 * packet's option (a). `@four/physics` already covers the *world's* break
 * monitor against its own `FakeJointSolverAdapter`
 * (`packages/physics/tests/world-joints.test.ts`), but that fake is
 * test-internal to that package and unreachable from here, and those tests call
 * `world.step()` and `world.dispatchEvents()` directly. What this file adds is
 * the composition: a break driven end to end through `Application.step` →
 * `PhysicsSystem.fixedUpdate` → `world.step` → `world.dispatchEvents` (§39
 * steps 6 and 9), with a second, healthy joint in the same world to show that
 * the survivors keep simulating.
 */

import { FourError } from "@four/core";
import { solverJointStatistics } from "@four/diagnostics";
import { Vector3 } from "@four/math";
import {
  FixedJoint,
  HingeJoint,
  SphericalJoint,
  supportsSolverJointAccess,
} from "@four/physics";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  G,
  ScriptedJointAdapter,
  addAnchor,
  addBob,
  allFinite,
  apexes,
  buildMechanism,
  buildMotorShaft,
  buildPendulum,
  buildRope,
  buildSlider,
  buildSpring,
  createJointWorld,
  createScriptedWorld,
  crossingTimes,
  distanceTo,
  elevationAngle,
  meanInterval,
  spinZ,
} from "./helpers/joint-scenarios.js";
import {
  DIMENSION_KITS,
  DT,
  createRig,
  stepFrames,
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

afterEach(() => {
  for (let i = openRigs.length - 1; i >= 0; i -= 1) {
    openRigs[i].dispose();
  }
  openRigs.length = 0;
});

beforeAll(async () => {
  // Both wasm modules load once per process; paying for them here keeps the
  // first case in each dimension from carrying the cost (WP-5.6's arrangement).
  const rig = await createRig();
  for (const kit of DIMENSION_KITS) {
    await createJointWorld(rig, kit, { track: false });
  }
  rig.dispose();
});

for (const kit of DIMENSION_KITS) {
  describe(`${kit.dimension} joints on ${kit.adapterName}`, () => {
    // --- (a) the hinge pendulum against 2π√(L/g) (§28) ----------------------

    it("swings a HingeJoint pendulum at the period 2π√(L/g) predicts", async () => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit);
      const amplitude = 0.2;
      const pendulum = buildPendulum(world, kit, { length: 1, amplitude });
      // The joint went in through the world, not onto a node (§28, plan P6-3).
      expect(world.jointCount).toBe(1);
      expect(pendulum.joint.registered).toBe(true);
      expect(pendulum.joint.type).toBe("revolute");
      // §113's joint statistics against the live jointed adapter (2026-08-04
      // — the last debug provider previously exercised via fakes only). Both
      // Rapier adapters honestly declare reportsJointReactions false.
      // Tests typecheck gate (2026-08-21): `world.adapter` is a
      // `PhysicsWorldAdapter` (`PhysicsSolverAdapter & SolverBodyAccess`), and
      // the joint seam is deliberately *separate* — so the adapter has to be
      // narrowed before `@four/diagnostics`' structurally-declared
      // `DebugJointAccess` can be satisfied. `supportsSolverJointAccess` is the
      // guard `@four/physics` exports for exactly this, and it strengthens the
      // assertion: a Rapier adapter that stopped implementing the seam now
      // fails here instead of type-erroring nowhere.
      const jointAccess = world.adapter;
      expect(supportsSolverJointAccess(jointAccess)).toBe(true);
      if (!supportsSolverJointAccess(jointAccess)) {
        throw new TypeError("the joint world's adapter has no joint seam");
      }
      const jointStats = solverJointStatistics(jointAccess);
      expect(jointStats.jointCount).toBe(1);
      expect(jointStats.reportsJointReactions).toBe(false);

      // 50 seconds of swing, timed by the interpolated zero crossings of x —
      // which is ~25 half-periods, so the mean interval is accurate to far
      // better than one fixed step.
      const crossings = crossingTimes(
        rig.app,
        3000,
        () => pendulum.bob.node.transform.position.x,
      );
      expect(crossings.length).toBeGreaterThanOrEqual(20);
      const period = meanInterval(crossings);

      const ideal = 2 * Math.PI * Math.sqrt(pendulum.length / G);
      const relative = (period - ideal) / ideal;
      // Measured: 2.011205 s (2d) and 2.011166 s (3d) against 2.006067 s, i.e.
      // +0.2561% and +0.2542%. The packet's bound is 1%.
      expect(Math.abs(relative)).toBeLessThan(0.01);
      // And the residual is the finite amplitude, not the solver: the
      // first-order correction predicts +0.25% on its own, and the measurement
      // sits 6.1e-5 (2d) / 4.2e-5 (3d) from it.
      const corrected = ideal * (1 + (amplitude * amplitude) / 16);
      expect(Math.abs((period - corrected) / corrected)).toBeLessThan(2e-4);

      // The constraint itself held for the whole 50 s: the bob never left the
      // circle the hinge defines (measured radius 1.00000199 m).
      expect(
        Math.abs(distanceTo(pendulum.bob.node, pendulum.pivot) - 1),
      ).toBeLessThan(1e-4);
      // §42: the node carries the pose, which is what makes this integration.
      expect(pendulum.bob.node.transformAuthority).toBe("physics");
    });

    // --- (b) the motorized shaft, and what enableMotor(false) means ---------

    it("drives a shaft to the commanded rate and then releases it (§28, WP-6.2-fix1)", async () => {
      const rig = await openRig();
      // No gravity: an unmotorized shaft would never turn, so "3 rad/s" is a
      // claim about the motor rather than about gravity.
      const world = await createJointWorld(rig, kit, {
        gravity: new Vector3(0, 0, 0),
      });
      const { shaft, joint } = buildMotorShaft(world, kit, {
        targetVelocity: 3,
        maxTorque: 50,
      });

      stepFrames(rig.app, 300);
      // Measured 3.000000 in both dimensions; the tolerance is 1e-3.
      expect(Math.abs(spinZ(shaft.body) - 3)).toBeLessThan(1e-3);

      // §28's enableMotor, through the class: the record survives, disabled.
      joint.enableMotor(false);
      expect(joint.motor?.enabled).toBe(false);
      expect(joint.commands.motorDirty).toBe(true);
      stepFrames(rig.app, 1);
      expect(joint.commands.motorDirty).toBe(false);
      // Not braked: one step after the disable the shaft still turns at 3.
      // (Rapier's *other* spelling of "no motor" — a rigid zero-velocity
      // constraint — would have taken it to ~0.3 rad/s; WP-6.2-fix1 measured
      // that and chose the inert gain instead.)
      expect(Math.abs(spinZ(shaft.body) - 3)).toBeLessThan(1e-3);

      // And not driven either, which a shaft still sitting at its target could
      // not show on its own: kick it off the commanded rate and it *stays*
      // where the kick put it. Measured 7.615384 rad/s (2d) and 49.153835
      // rad/s (3d) — the two rigs have very different inertia — and both are
      // unchanged to the last bit 300 steps later.
      shaft.body.applyAngularImpulse(new Vector3(0, 0, 0.02));
      stepFrames(rig.app, 1);
      const kicked = spinZ(shaft.body);
      expect(kicked).toBeGreaterThan(4);
      stepFrames(rig.app, 300);
      expect(Math.abs(spinZ(shaft.body) - kicked)).toBeLessThan(2e-3);

      // The control: the same kick on a *live* motor is pulled back to the
      // target inside one step (measured 3.000001 in 2d, 3.000000 in 3d).
      const controlRig = await openRig();
      const controlWorld = await createJointWorld(controlRig, kit, {
        gravity: new Vector3(0, 0, 0),
      });
      const control = buildMotorShaft(controlWorld, kit, {
        targetVelocity: 3,
        maxTorque: 50,
      });
      stepFrames(controlRig.app, 300);
      control.shaft.body.applyAngularImpulse(new Vector3(0, 0, 0.02));
      stepFrames(controlRig.app, 1);
      expect(Math.abs(spinZ(control.shaft.body) - 3)).toBeLessThan(1e-3);
    });

    // --- (c) the slider and its limits (§28) --------------------------------

    it("drives a SliderJoint onto its limit and back to the other one", async () => {
      const rig = await openRig();
      // Gravity on: a slider that leaked off its axis would show it here.
      const world = await createJointWorld(rig, kit);
      const slider = buildSlider(world, kit, {
        origin: new Vector3(0, 0, 0),
        limits: { min: -0.5, max: 0.5 },
        targetVelocity: 1,
        maxForce: 500,
      });

      let maxTravel = -Infinity;
      let offAxis = 0;
      for (let i = 0; i < 300; i += 1) {
        rig.app.step(DT);
        const at = slider.carriage.node.transform.position;
        maxTravel = Math.max(maxTravel, at.x);
        offAxis = Math.max(offAxis, Math.hypot(at.y, at.z));
      }
      // Measured: the carriage parks on **exactly** 0.5 and never passes it —
      // overshoot 0 in both dimensions over 300 steps. The 1e-3 bound is the
      // documented allowance for one solver iteration of overshoot, which this
      // rig does not spend.
      expect(maxTravel).toBeLessThan(0.5 + 1e-3);
      expect(
        Math.abs(slider.carriage.node.transform.position.x - 0.5),
      ).toBeLessThan(1e-3);
      // Gravity pulled straight down for five seconds and moved it nowhere:
      // measured 0 (2d) and 1.55e-11 (3d).
      expect(offAxis).toBeLessThan(1e-6);

      // Reverse the drive through the class and it parks on the other limit.
      slider.joint.setMotor({
        enabled: true,
        targetVelocity: -1,
        maxForce: 500,
      });
      let minTravel = Infinity;
      for (let i = 0; i < 300; i += 1) {
        rig.app.step(DT);
        minTravel = Math.min(
          minTravel,
          slider.carriage.node.transform.position.x,
        );
      }
      // Measured: exactly -0.5, again with no overshoot.
      expect(minTravel).toBeGreaterThan(-0.5 - 1e-3);
      expect(
        Math.abs(slider.carriage.node.transform.position.x + 0.5),
      ).toBeLessThan(1e-3);
    });

    // --- (d) the spring against 2π√(m/k) (§28 spring, damping) --------------

    it("oscillates a SpringJoint about its rest length at 2π√(m/k)", async () => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit, {
        gravity: new Vector3(0, 0, 0),
      });
      const stiffness = 100;
      const spring = buildSpring(world, kit, {
        restLength: 1,
        stiffness,
        damping: 0,
        mass: 1,
        stretch: 0.5,
      });
      // The mass the *solver* is using, read back at registration (§23), so the
      // closed form below is computed from the simulation's own number.
      expect(Math.abs(spring.mass - 1)).toBeLessThan(1e-5);

      // Crossings of the rest length: one per period (rising only).
      const crossings = crossingTimes(
        rig.app,
        1200,
        () => spring.bob.node.transform.position.y,
        spring.origin.y - 1,
        "rising",
      );
      expect(crossings.length).toBeGreaterThanOrEqual(20);
      const period = meanInterval(crossings);
      const ideal = 2 * Math.PI * Math.sqrt(spring.mass / stiffness);
      // Measured 0.628681 s against 0.628319 s — +5.77e-4 relative, identical
      // in both dimensions. Asserted to 0.5%, the tolerance WP-6.3 documented
      // for Rapier's soft spring constraint.
      expect(Math.abs((period - ideal) / ideal)).toBeLessThan(0.005);
      // It oscillates *about the rest length*: the bob crosses it repeatedly
      // rather than settling short of it.
      expect(crossings.length).toBeGreaterThan(10);
    });

    it("decays a damped SpringJoint's amplitude apex by apex (§28 damping)", async () => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit, {
        gravity: new Vector3(0, 0, 0),
      });
      const spring = buildSpring(world, kit, {
        restLength: 1,
        stiffness: 100,
        damping: 5,
        mass: 1,
        stretch: 0.5,
      });

      const samples: number[] = [];
      for (let i = 0; i < 600; i += 1) {
        rig.app.step(DT);
        samples.push(
          Math.abs(
            spring.bob.node.transform.position.y - (spring.origin.y - 1),
          ),
        );
      }
      const peaks = apexes(samples);
      // Measured (identically in both dimensions): 0.207192, 0.086232,
      // 0.035846, 0.014859, 0.006180, 0.002570, … — 15 apexes, each about
      // 0.416 of the one before.
      expect(peaks.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < peaks.length; i += 1) {
        expect(peaks[i]).toBeLessThan(peaks[i - 1]);
      }
      expect(peaks[1] / peaks[0]).toBeLessThan(0.5);
      // Monotone decay, all the way down to rest at the rest length.
      expect(peaks[peaks.length - 1]).toBeLessThan(0.01);
    });

    // --- (e) the rope (§28) --------------------------------------------------

    it("never lets a RopeJoint's anchors pass maxLength, and leaves slack alone", async () => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit);
      const rope = buildRope(world, kit, { maxLength: 1.5, slack: 0.2 });

      // One step: the load started 0.2 m below a 1.5 m rope, so it is still in
      // free fall — a rope pulls and never pushes (§28).
      rig.app.step(DT);
      expect(rope.load.node.transform.position.y).toBeLessThan(
        rope.origin.y - 0.2,
      );

      let maxDistance = 0;
      let slackSeen = false;
      for (let i = 0; i < 600; i += 1) {
        rig.app.step(DT);
        const distance = distanceTo(rope.load.node, rope.origin);
        maxDistance = Math.max(maxDistance, distance);
        slackSeen ||= distance < 1.4;
      }
      // Measured: the separation reaches exactly 1.5 and never exceeds it —
      // slack past `maxLength` is 0 in both dimensions over 600 steps. The 1e-4
      // allowance is the documented room for the solver's constraint softness,
      // which this rig does not use.
      expect(maxDistance).toBeLessThanOrEqual(rope.maxLength + 1e-4);
      expect(maxDistance).toBeGreaterThan(rope.maxLength - 1e-3);
      expect(slackSeen).toBe(true);
    });

    // --- (g) live reconfiguration through the command queue (§28) -----------

    it("drains setLimits and setMotor into the solver on the next fixed step", async () => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit);
      const slider = buildSlider(world, kit, {
        origin: new Vector3(0, 0, 0),
        limits: { min: -0.5, max: 0.5 },
        targetVelocity: -1,
        maxForce: 500,
      });
      stepFrames(rig.app, 200);
      expect(
        Math.abs(slider.carriage.node.transform.position.x + 0.5),
      ).toBeLessThan(1e-3);

      // Both commands are authored on a *registered* joint and reach the solver
      // only at the next step (§26's pattern applied to constraints).
      slider.joint.setLimits(-0.5, 0.2);
      slider.joint.setMotor({
        enabled: true,
        targetVelocity: 1,
        maxForce: 500,
      });
      expect(slider.joint.commands.limitsDirty).toBe(true);
      expect(slider.joint.commands.motorDirty).toBe(true);
      expect(slider.joint.limits).toEqual({ min: -0.5, max: 0.2 });
      rig.app.step(DT);
      expect(slider.joint.commands.limitsDirty).toBe(false);
      expect(slider.joint.commands.motorDirty).toBe(false);

      let maxTravel = -Infinity;
      for (let i = 0; i < 300; i += 1) {
        rig.app.step(DT);
        maxTravel = Math.max(
          maxTravel,
          slider.carriage.node.transform.position.x,
        );
      }
      // The new limit is the one being enforced: measured 0.20000000298 (2d)
      // and 0.20000001788 (3d), i.e. 3.0e-9 and 1.8e-8 past 0.2 — the float32
      // representation of the limit, not overshoot.
      expect(maxTravel).toBeLessThan(0.2 + 1e-3);
      expect(maxTravel).toBeGreaterThan(0.2 - 1e-3);

      // The angular twin: a hinge re-limited under load swings to the new bound.
      const anchor = addAnchor(world, new Vector3(10, 0, 0), "arm-pivot");
      const arm = addBob(world, kit, new Vector3(11, 0, 0), 0.05, {
        name: "arm",
        mass: 1,
      });
      const hinge = new HingeJoint({
        bodyA: anchor.body,
        bodyB: arm.body,
        anchor: new Vector3(10, 0, 0),
        axis: new Vector3(0, 0, 1),
        limits: { min: -0.5, max: 0.5 },
      });
      world.addJoint(hinge);

      const lowest = (steps: number): number => {
        let low = 0;
        for (let i = 0; i < steps; i += 1) {
          rig.app.step(DT);
          low = Math.min(
            low,
            elevationAngle(arm.node, anchor.node.transform.position),
          );
        }
        return low;
      };
      // Gravity would take the arm to -π/2; the authored limit stops it at
      // -0.5 rad (measured -0.500835 in 2d, -0.500000 in 3d).
      const first = lowest(400);
      expect(first).toBeLessThan(-0.49);
      expect(first).toBeGreaterThan(-0.51);

      hinge.setLimits(-1.2, 0.5);
      // Measured -1.200685 (2d) and -1.200062 (3d) — the 0.01 rad allowance is
      // the solver's own constraint softness, as WP-6.3 documented.
      const second = lowest(400);
      expect(second).toBeLessThan(-1.19);
      expect(second).toBeGreaterThan(-1.21);
    });

    it("re-anchors a live rope in body-local space without re-measuring (PH-22f)", async () => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit);
      const rope = buildRope(world, kit, {
        origin: new Vector3(0, 0, 0),
        maxLength: 1,
        slack: 1,
      });
      // Construction is world-space; addJoint writes the locals back.
      expect(rope.joint.anchorsAreLocal).toBe(true);
      expect(rope.joint.anchorA?.y).toBeCloseTo(0, 12);
      expect(rope.joint.anchorB?.y).toBeCloseTo(0, 12);

      stepFrames(rig.app, 180);
      // Slack start at y = -1 with maxLength 1: hanging at the origin distance.
      expect(rope.load.node.transform.position.y).toBeCloseTo(-1, 2);

      // Same locals again: writing what is already stored queues nothing, and
      // the COM is not re-measured against the current pose.
      rope.joint.setAnchors(new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      expect(rope.joint.commands.anchorsDirty).toBe(false);
      stepFrames(rig.app, 60);
      expect(rope.load.node.transform.position.y).toBeCloseTo(-1, 2);

      // New body-local attachment 0.5 m above the load origin. Gravity hangs
      // the new pair at 1 m, so the COM drops to y = -1.5.
      rope.joint.setAnchors(new Vector3(0, 0, 0), new Vector3(0, 0.5, 0));
      expect(rope.joint.commands.anchorsDirty).toBe(true);
      rig.app.step(DT);
      expect(rope.joint.commands.anchorsDirty).toBe(false);
      stepFrames(rig.app, 180);
      expect(rope.load.node.transform.position.y).toBeCloseTo(-1.5, 2);
    });

    // --- (h, first half) breakage is refused on Rapier (§28, plan P6-2) -----

    it("refuses a breakable joint because the adapter reports no reactions", async () => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit);
      // The seam is there — this adapter carries joints…
      expect(world.supportsJoints).toBe(true);
      const anchor = addAnchor(world, new Vector3(0, 0, 0));
      const bob = addBob(world, kit, new Vector3(1, 0, 0), 0.05, { mass: 1 });

      // …but Rapier 0.19.3 cannot report what a constraint pushed with, so a
      // threshold it could never enforce is refused rather than accepted and
      // silently ignored (plan P6-2: breakage is never faked).
      let thrown: unknown;
      try {
        world.addJoint(
          new FixedJoint({
            bodyA: anchor.body,
            bodyB: bob.body,
            breakForce: 10,
          }),
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FourError);
      expect((thrown as FourError).code).toBe("NOT_IMPLEMENTED");
      expect((thrown as FourError).message).toContain("reportsJointReactions");
      expect((thrown as FourError).message).toContain(kit.adapterName);
      // Nothing was half-built: the refusal happens before `createJoint` (§85).
      expect(world.jointCount).toBe(0);

      // The same joint without thresholds registers immediately. The anchor is
      // the bob's own position, so §28's weld promise — the bodies keep the
      // relative pose they had — is what is being watched. (A `FixedJoint` with
      // no anchor at all welds the two *origins* together and would drag the
      // bob onto the anchor; that is the joint asking for something else.)
      const plain = new FixedJoint({
        bodyA: anchor.body,
        bodyB: bob.body,
        anchor: new Vector3(1, 0, 0),
      });
      world.addJoint(plain);
      expect(world.jointCount).toBe(1);
      expect(plain.breakable).toBe(false);
      stepFrames(rig.app, 30);
      // A weld holds: the bob stayed a metre out rather than falling.
      expect(distanceTo(bob.node, new Vector3(0, 0, 0))).toBeCloseTo(1, 3);
      expect(bob.node.transform.position.y).toBeGreaterThan(-0.01);
    });

    // --- (i) §33 determinism with joints ------------------------------------

    it("produces identical checksum streams for a jointed scene, joint edits included (§33)", async () => {
      /**
       * One run of a jointed scene. `mutate` removes the pendulum's hinge at
       * step 60 and welds the two bobs together at step 120, so the second half
       * of the run has a different constraint set than the first.
       */
      const run = async (mutate: boolean): Promise<number[]> => {
        const rig = await openRig();
        const world = await createJointWorld(rig, kit);
        const pendulum = buildPendulum(world, kit, {
          pivot: new Vector3(0, 0, 0),
          amplitude: 0.4,
        });
        const spring = buildSpring(world, kit, {
          origin: new Vector3(5, 0, 0),
          damping: 0.5,
        });
        const digests: number[] = [];
        for (let step = 1; step <= 240; step += 1) {
          if (mutate && step === 60) {
            expect(world.removeJoint(pendulum.joint)).toBe(true);
          }
          if (mutate && step === 120) {
            world.addJoint(
              new FixedJoint({
                bodyA: pendulum.bob.body,
                bodyB: spring.bob.body,
              }),
            );
          }
          rig.app.step(DT);
          digests.push(world.checksum());
        }
        return digests;
      };

      const first = await run(false);
      const second = await run(false);
      expect(second).toEqual(first);
      // Non-degenerate: the world is evolving, so equality is a claim (measured
      // 240 distinct digests out of 240 steps).
      expect(new Set(first).size).toBeGreaterThan(200);

      // A run whose joint set changes mid-flight is just as reproducible…
      const mutated = await run(true);
      const mutatedAgain = await run(true);
      expect(mutatedAgain).toEqual(mutated);
      // …and it is a genuinely different simulation, so the equality above is
      // not two copies of the same trajectory.
      expect(mutated.slice(0, 59)).toEqual(first.slice(0, 59));
      expect(mutated[239]).not.toBe(first[239]);
    });

    // --- (j) §109's stability core ------------------------------------------

    it("keeps a five-joint mechanism bounded and drift-free over 3600 fixed steps (§109)", async () => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit);
      const mechanism = buildMechanism(world, kit);
      expect(world.jointCount).toBe(5);

      /** Generous: the whole mechanism lives inside |x| ≤ 13 (measured 12.09). */
      const BOUND = 20;
      const digests: number[] = [];
      let maxRadius = 0;
      let hingeDrift = 0;
      let ropeMax = 0;
      let sliderOffAxis = 0;

      for (let step = 0; step < 3600; step += 1) {
        rig.app.step(DT);
        digests.push(world.checksum());
        for (const node of mechanism.nodes) {
          const at = node.transform.position;
          expect(Number.isFinite(at.x)).toBe(true);
          expect(Number.isFinite(at.y)).toBe(true);
          expect(Number.isFinite(at.z)).toBe(true);
          maxRadius = Math.max(maxRadius, Math.hypot(at.x, at.y, at.z));
        }
        // The hinge's anchor coincidence: the arm must stay exactly its own
        // length from the pivot, which is what "the constraint still holds"
        // means for a revolute joint.
        hingeDrift = Math.max(
          hingeDrift,
          Math.abs(
            distanceTo(mechanism.arm.bob.node, mechanism.arm.pivot) -
              mechanism.arm.length,
          ),
        );
        ropeMax = Math.max(
          ropeMax,
          distanceTo(mechanism.rope.load.node, mechanism.rope.origin),
        );
        const carriage = mechanism.slider.carriage.node.transform.position;
        sliderOffAxis = Math.max(
          sliderOffAxis,
          Math.hypot(
            carriage.y - mechanism.slider.origin.y,
            carriage.z - mechanism.slider.origin.z,
          ),
        );
      }

      // No NaN anywhere: 3600 finite checksums over 3600 finite poses.
      expect(allFinite(digests)).toBe(true);
      expect(digests).toHaveLength(3600);
      // Still simulating rather than frozen (measured: 3600 distinct digests).
      expect(new Set(digests).size).toBeGreaterThan(3000);
      // Bounded (measured max |p| = 12.093387, which is the rope station's own
      // x offset — nothing ran away).
      expect(maxRadius).toBeLessThan(BOUND);

      // Constraint drift, after a full minute of simulated time. Measured:
      //   hinge anchor coincidence  1.345e-5 m (2d) / 1.344e-5 m (3d)
      //   rope length               exactly 1.5 m, i.e. 0 past maxLength
      //   slider off-axis           0 (2d) / 1.552e-11 m (3d)
      expect(hingeDrift).toBeLessThan(1e-3);
      expect(ropeMax).toBeLessThanOrEqual(mechanism.rope.maxLength + 1e-4);
      expect(sliderOffAxis).toBeLessThan(1e-6);

      // The driven parts are still doing their jobs at step 3600: the shaft
      // turns at its commanded 2 rad/s and the carriage sits on its limit.
      expect(Math.abs(spinZ(mechanism.shaft.shaft.body) - 2)).toBeLessThan(
        1e-3,
      );
      expect(
        Math.abs(
          mechanism.slider.carriage.node.transform.position.x -
            (mechanism.slider.origin.x + 0.5),
        ),
      ).toBeLessThan(1e-3);
    }, 60_000);
  });
}

// --- (f) the ball joint, which only a 3D world has (§21, §28) ----------------

describe("3d spherical joints (§28 ball)", () => {
  const kit = DIMENSION_KITS[1];

  it("swings out of the plane a hinge is confined to", async () => {
    /** The largest |z| a bob reaches after one push along +Z. */
    const swing = async (kind: "ball" | "hinge"): Promise<number> => {
      const rig = await openRig();
      const world = await createJointWorld(rig, kit);
      const pivot = new Vector3(0, 2, 0);
      const anchor = addAnchor(world, pivot);
      const bob = addBob(world, kit, new Vector3(0, 1, 0), 0.05, {
        name: "swinger",
        mass: 1,
      });
      world.addJoint(
        kind === "ball"
          ? new SphericalJoint({
              bodyA: anchor.body,
              bodyB: bob.body,
              anchor: pivot,
            })
          : new HingeJoint({
              bodyA: anchor.body,
              bodyB: bob.body,
              anchor: pivot,
              axis: new Vector3(0, 0, 1),
            }),
      );
      // The same push for both: 1 N·s along +Z on a 1 kg bob.
      bob.body.applyImpulse(new Vector3(0, 0, 1));
      let maxZ = 0;
      for (let i = 0; i < 300; i += 1) {
        rig.app.step(DT);
        maxZ = Math.max(maxZ, Math.abs(bob.node.transform.position.z));
        // Both constraints keep the bob one metre from the pivot throughout.
        expect(Math.abs(distanceTo(bob.node, pivot) - 1)).toBeLessThan(1e-4);
      }
      return maxZ;
    };

    // Measured: the ball joint swings 0.314878 m out of the XY plane; the
    // hinge about +Z moves in z by exactly 0. That difference is the whole
    // reason §28 has both types.
    const ball = await swing("ball");
    const hinge = await swing("hinge");
    expect(ball).toBeGreaterThan(0.2);
    expect(hinge).toBeLessThan(1e-6);
    expect(ball).toBeGreaterThan(hinge);
  });

  it("refuses a swing cone rather than approximating one (WP-6.3)", async () => {
    const rig = await openRig();
    const world = await createJointWorld(rig, kit);
    const pivot = new Vector3(0, 2, 0);
    const anchor = addAnchor(world, pivot);
    const bob = addBob(world, kit, new Vector3(0, 1, 0), 0.05, { mass: 1 });

    // §28 describes a swing cone; Rapier 0.19.3's per-axis angular limits are
    // not one (they let a diagonal swing reach 1.1247 rad where a planar one
    // stops at 0.2998 — measured by WP-6.3). The adapter refuses the descriptor
    // instead of shipping the wrong shape, and the refusal surfaces through
    // `addJoint` unchanged.
    let thrown: unknown;
    try {
      world.addJoint(
        new SphericalJoint({
          bodyA: anchor.body,
          bodyB: bob.body,
          anchor: pivot,
          limits: { coneAngle: 0.3 },
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FourError);
    expect((thrown as FourError).code).toBe("NOT_IMPLEMENTED");
    expect((thrown as FourError).message).toMatch(/swing cone/u);
    expect(world.jointCount).toBe(0);

    // The unlimited ball joint registers on the very next call, and simulates.
    const free = new SphericalJoint({
      bodyA: anchor.body,
      bodyB: bob.body,
      anchor: pivot,
    });
    world.addJoint(free);
    expect(world.jointCount).toBe(1);
    stepFrames(rig.app, 60);
    expect(Math.abs(distanceTo(bob.node, pivot) - 1)).toBeLessThan(1e-4);
  });
});

// --- (h, second half) the break path, on a solver that can report reactions --

describe("§28 breakage through the application (plan P6-2)", () => {
  const kit = DIMENSION_KITS[0];

  it("breaks exactly once past the threshold and leaves the survivors simulating", async () => {
    const rig = await openRig();
    const adapter = new ScriptedJointAdapter();
    const world = await createScriptedWorld(rig, adapter);
    expect(world.supportsJoints).toBe(true);

    const a = addBob(world, kit, new Vector3(0, 0, 0), 0.5, { mass: 1 });
    const b = addBob(world, kit, new Vector3(1, 0, 0), 0.5, { mass: 1 });
    const c = addBob(world, kit, new Vector3(2, 0, 0), 0.5, { mass: 1 });
    const doomed = new FixedJoint({
      bodyA: a.body,
      bodyB: b.body,
      breakForce: 100,
      breakTorque: 2,
    });
    const survivor = new FixedJoint({
      bodyA: b.body,
      bodyB: c.body,
      breakForce: 100,
    });
    world.addJoint(doomed);
    world.addJoint(survivor);
    expect(world.jointCount).toBe(2);
    expect(doomed.id).toBe(1);
    expect(survivor.id).toBe(2);

    const seen: { force: number; torque: number; broken: boolean }[] = [];
    doomed.on("jointbreak", (event) => {
      // Dispatch happens after the step, on the joint's own emitter, with the
      // joint already retired (§39 step 9, §28).
      seen.push({
        force: event.force,
        torque: event.torque,
        broken: event.joint.broken,
      });
    });

    // Exactly at the threshold: |J| / dt === 100 N. §28's comparison is strict,
    // so this joint survives.
    adapter.scriptJointReaction(1, new Vector3(100 * DT, 0, 0), new Vector3());
    rig.app.step(DT);
    expect(doomed.broken).toBe(false);
    expect(world.jointCount).toBe(2);
    expect(seen).toHaveLength(0);

    // Past it: 150 N and 3 N·m, both over. One event, on the joint, after the
    // step — `Application.step` drove the whole path (§39 steps 6 and 9).
    adapter.scriptJointReaction(
      1,
      new Vector3(0, 150 * DT, 0),
      new Vector3(0, 0, 3 * DT),
    );
    rig.app.step(DT);
    expect(seen).toHaveLength(1);
    expect(seen[0].force).toBeCloseTo(150, 6);
    expect(seen[0].torque).toBeCloseTo(3, 6);
    expect(seen[0].broken).toBe(true);
    expect(doomed.broken).toBe(true);
    expect(doomed.registered).toBe(false);

    // The world dropped it and kept the other one.
    expect(world.jointCount).toBe(1);
    expect(world.hasJoint(doomed)).toBe(false);
    expect(survivor.registered).toBe(true);
    expect(adapter.jointCount).toBe(1);

    // Gone means gone, and the rest of the world carries on: three more steps
    // emit nothing further and the bodies keep falling under the scripted
    // solver's gravity.
    const before = c.node.transform.position.y;
    stepFrames(rig.app, 3);
    expect(seen).toHaveLength(1);
    expect(c.node.transform.position.y).toBeLessThan(before);
    expect(Number.isFinite(world.checksum())).toBe(true);

    // A broken joint is permanently broken (§28).
    expect(() => world.addJoint(doomed)).toThrowError(FourError);
  });

  it("still refuses the thresholds when the same solver reports no reactions", async () => {
    const rig = await openRig();
    const adapter = new ScriptedJointAdapter();
    // The one field plan P6-2 hangs everything on, flipped: the world must
    // refuse the joint even though this adapter carries the rest of the seam.
    adapter.reportsJointReactions = false;
    const world = await createScriptedWorld(rig, adapter);

    const a = addBob(world, kit, new Vector3(0, 0, 0), 0.5, { mass: 1 });
    const b = addBob(world, kit, new Vector3(1, 0, 0), 0.5, { mass: 1 });
    expect(() =>
      world.addJoint(
        new FixedJoint({ bodyA: a.body, bodyB: b.body, breakTorque: 1 }),
      ),
    ).toThrowError(/reportsJointReactions/u);
    expect(world.jointCount).toBe(0);
  });
});
