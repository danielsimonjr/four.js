/**
 * Phase 7 cross-integration: **§19's four worked examples driven end to end**
 * through a real Rapier solver, §110's continuity criterion, and §33's
 * identical-runs check with blending active (WP-7.5; §19, §33, §42, §110).
 *
 * The shape is WP-5.6's and WP-6.4's, and so is the discipline: one headless
 * `Application` from `four/application`, real `Rapier2dAdapter` /
 * `Rapier3dAdapter` worlds, both §21 dimensions, and nothing but the public API
 * anywhere. What is new is the third and fourth system on the rig —
 * `AnimationSystem` (§39 step 3) and `createPoseTargetCaptureSystem` (step
 * 3 − 1), which `Application` deliberately does **not** register — and the fact
 * that every pose asserted below is the *output of a blend* between something
 * an animation asked for and something Rapier solved.
 *
 * ## What each tolerance below was measured at
 *
 * Every assertion states its derivation at the assertion. In summary, on Rapier
 * 0.19.3 (2d / 3d where they differ):
 *
 * | Case                                        | Measured                    |
 * | ------------------------------------------- | --------------------------- |
 * | (a) animated door vs the tween's closed form | `1.4e-15 rad`               |
 * | (a) same door published from the solver pose | `8.1e-8` / `7.5e-8 rad`     |
 * | (b) hinged door period vs `2π√(I/mgd)`       | `+0.2471%` / `+0.2471%`     |
 * | (b) …vs the finite-amplitude form            | `−2.86e-5` / `−2.88e-5`     |
 * | (b) blended vs `"physics"` authority         | bit-identical               |
 * | (c) blend vs `lerp(solver, target, 0.1)`     | `0` exactly                 |
 * | (c) commanded arm vs `v·t`                   | `7.4e-7 m`                  |
 * | (d) max per-step link displacement           | `0.1078 m` (bound `0.1644`) |
 * | (d) displacement at the activation switch    | `0.0333769 m` (bound `0.0333801`) |
 * | (d) displacement at the re-type switch       | `0.005 m` (the target's own step) |
 * | (d) inherited speed vs the animated speed    | `2.0000000` vs `2` m/s      |
 * | (e) walked distance vs `stride · t`          | `2.2e-14 m` over 4 loops    |
 *
 * ## The one place the packet's plan met the solver and lost (measured)
 *
 * The packet asks the ragdoll's velocity inheritance to be shown against "a
 * no-inheritance control — the inherited one keeps moving in the pre-switch
 * direction". Measured, `inheritVelocity: false` travels **exactly as far** as
 * the inherited run (`1.000002 m` in both), because a Rapier
 * `"kinematic-position"` body that is being driven to per-step targets already
 * carries the velocity Rapier derived from those targets, and `setBodyType`
 * keeps it. §19's finite difference and Rapier's own derivation agree to
 * `2e-6 m` over half a second, which is a cross-check rather than a difference.
 *
 * The suite therefore keeps that control *and reports what it measures*, and
 * adds the two that do separate the variables: a run with no pre-switch motion
 * at all (which drops straight down, so the +X travel really is inherited
 * motion and not a rig artefact), and a run whose application forgot
 * `createPoseTargetCaptureSystem` (which proves inheritance writes real
 * velocities — see the case for what it actually writes).
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ARM_ANIMATION_WEIGHT,
  ARM_COMMAND_SPEED,
  ARM_LIFT,
  ARM_LIFT_SECONDS,
  CHAIN_DRIVE_SPEED,
  CHAIN_HEIGHT,
  CHAIN_LIFT,
  CHAIN_RECOVER_SECONDS,
  CRATE_START_X,
  DOOR_OPEN_ANGLE,
  DOOR_OPEN_SECONDS,
  DOOR_PIVOT,
  G,
  INHERITANCE_WINDOW,
  PoseTrace,
  RAGDOLL_PHASES,
  WALKER_HALF_EXTENTS,
  WALK_STRIDE,
  angleAboutZ,
  buildCommandedArm,
  buildDoor,
  buildWalker,
  createBlendRig,
  createBlendWorld,
  doorAngleAt,
  doorPendulumPeriod,
  driveDoorOpen,
  maxBetween,
  maxOf,
  requireTarget,
  runRagdollCycle,
  runSteps,
  walkedDistance,
  type BlendRig,
} from "./helpers/blending-scenarios.js";
import { crossingTimes, meanInterval } from "./helpers/joint-scenarios.js";
import {
  DIMENSION_KITS,
  DT,
  addGround,
  fallDistance,
  type DimensionKit,
} from "./helpers/physics-scenarios.js";

/** Rigs created by the case in flight; disposed after it, newest first (§83). */
const openRigs: BlendRig[] = [];

/** Creates a rig and registers it for teardown. */
async function openRig(): Promise<BlendRig> {
  const rig = await createBlendRig();
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
  const rig = await createBlendRig();
  for (const kit of DIMENSION_KITS) {
    await createBlendWorld(rig, kit, { track: false });
  }
  rig.dispose();
});

/** Steps the animated-door cases run for: past the end of the 1.5 s timeline. */
const DOOR_STEPS = 120;

/** Release angle of the hinged door, in radians — WP-6.4's pendulum amplitude. */
const DOOR_AMPLITUDE = 0.2;

/** Fixed steps the hinged door is held kinematic before it is handed over. */
const DOOR_HOLD_STEPS = 30;

/** Fixed steps the hinged door swings for: 18 periods of ~1.644 s. */
const DOOR_SWING_STEPS = 1800;

/** Fixed steps the two doors of the bit-identity case run after the hand-over. */
const DOOR_COMPARE_STEPS = 600;

/** Fixed steps the commanded arm runs before, and again after, its reversal. */
const ARM_STEPS = 90;

/**
 * Angle the animated door turns through in one fixed step, in radians — the
 * whole sweep over its duration, since the tween eases linearly.
 */
const DOOR_STEP_ANGLE = (DOOR_OPEN_ANGLE * DT) / DOOR_OPEN_SECONDS;

/**
 * §110's per-step bound for the commanded arm, in metres.
 *
 * The published pose is `lerp(solver, target, w)` of two motions whose speeds
 * are both known by construction: the solver moves at the commanded
 * `ARM_COMMAND_SPEED` and the target lifts at `ARM_LIFT / ARM_LIFT_SECONDS`, so
 * no step can move further than the weighted sum of the two, times `DT`.
 * Measured: `0.009014 m` against this `0.0095 m`.
 */
const ARM_STEP_BOUND =
  ((1 - ARM_ANIMATION_WEIGHT) * ARM_COMMAND_SPEED +
    (ARM_ANIMATION_WEIGHT * ARM_LIFT) / ARM_LIFT_SECONDS) *
  DT;

/**
 * §110's per-step bound for the ragdoll cycle, in metres.
 *
 * The fastest a link can be moving anywhere in the run is the energy bound of
 * the collapse: it enters the physical phase at `CHAIN_DRIVE_SPEED` along +X
 * and gains at most `√(2·g·h)` downwards over the drop, and those two are
 * orthogonal. The `1.5` is documented headroom for what an energy argument does
 * not cover — contact and joint impulses at the landing, and the solver's own
 * overshoot within a step. Measured: `0.1078 m` against this `0.1644 m`, i.e.
 * the energy bound alone (`0.1096 m`) was never exceeded.
 */
const RAGDOLL_STEP_BOUND =
  Math.hypot(CHAIN_DRIVE_SPEED, Math.sqrt(2 * G * CHAIN_HEIGHT)) * DT * 1.5;

/** Speed the recovery animation lifts the fallen chain at, in m/s. */
const RECOVERY_SPEED = CHAIN_LIFT / CHAIN_RECOVER_SECONDS;

/**
 * §110's per-step bound during the weight sweep, in metres.
 *
 * Writing `w` for the published animation share and `S`/`T` for the solver and
 * target poses, one step of the sweep moves the node by at most
 *
 * ```text
 * |Δ(lerp(S, T, w))|  ≤  Δw·|S − T|  +  w·|ΔT|  +  (1 − w)·|ΔS|
 * ```
 *
 * `Δw` is exactly `1/N`; `|S − T|` is at most the distance the recovery tween
 * has lifted the target by the end of the sweep, `RECOVERY_SPEED · N · DT`; and
 * `|ΔT|` is `RECOVERY_SPEED · DT`. The settled chain contributes the `|ΔS|`
 * term, which the `1.2` covers. The first two terms cancel `N` and leave
 * `2 · RECOVERY_SPEED · DT` — a bound that does **not** grow with the sweep
 * length, which is why sweeping is the continuous way back. Measured:
 * `0.009917 m` (2d) / `0.009919 m` (3d) against this `0.012 m`; the analytic
 * part alone is `0.010 m`.
 */
const RAGDOLL_SWEEP_BOUND = 2 * RECOVERY_SPEED * DT * 1.2;

for (const kit of DIMENSION_KITS) {
  describe(`${kit.dimension} blending on ${kit.adapterName}`, () => {
    // --- (a) §19 example 1: an animated door on a timeline -------------------

    it("drives an animated door from a timeline, exactly (§19 ex.1)", async () => {
      const rig = await openRig();
      const world = await createBlendWorld(rig, kit);
      const door = buildDoor(world, kit);
      driveDoorOpen(rig, door);

      const trace = new PoseTrace([door.node]);
      trace.capture();
      let worstAngleError = 0;
      runSteps(rig.app, DOOR_STEPS, (step) => {
        trace.capture();
        worstAngleError = Math.max(
          worstAngleError,
          Math.abs(
            angleAboutZ(door.node.transform.rotation) - doorAngleAt(step),
          ),
        );
      });

      // The door followed the *pure animation* closed form — the angle a linear
      // tween holds at step n, computed with no reference to the engine — at
      // every one of the 120 steps. Measured 1.4e-15 rad, which is quaternion
      // round-off in `angleAboutZ`, not blending error: under animationWeight 1
      // §19's publish copies the target rather than interpolating towards it.
      expect(worstAngleError).toBeLessThan(1e-13);
      expect(angleAboutZ(door.node.transform.rotation)).toBeCloseTo(
        DOOR_OPEN_ANGLE,
        12,
      );

      // The node origin is the hinge, so opening the door is a pure rotation:
      // its position is not merely close to the pivot, it is bit-identical.
      expect(door.node.transform.position.x).toBe(DOOR_PIVOT.x);
      expect(door.node.transform.position.y).toBe(DOOR_PIVOT.y);
      expect(maxOf(trace.stepDisplacements())).toBe(0);

      // §110's continuity criterion, in the units this scenario moves in: no
      // step turned further than the timeline's own per-step angle.
      expect(maxOf(trace.stepRotations())).toBeLessThanOrEqual(
        DOOR_STEP_ANGLE * (1 + 1e-9),
      );
    });

    it("reaches the same pose from the solver under physicsWeight 1 (plan P7-4)", async () => {
      const rig = await openRig();
      const world = await createBlendWorld(rig, kit);
      const door = buildDoor(world, kit, {
        physicsWeight: 1,
        animationWeight: 0,
      });
      driveDoorOpen(rig, door);

      let worst = 0;
      runSteps(rig.app, DOOR_STEPS, (step) => {
        worst = Math.max(
          worst,
          Math.abs(
            angleAboutZ(door.node.transform.rotation) - doorAngleAt(step),
          ),
        );
      });

      // Plan P7-4's "degenerate case" made concrete on a real solver: this door
      // publishes the *solver's* pose (animationWeight 0) and still tracks the
      // animation, because a "kinematic-position" body under "blended"
      // authority is fed the target itself — so every weight produces the same
      // pose, and the weights genuinely cannot double-apply.
      //
      // The residual is Rapier's f32 storage, not the blend: 8.1e-8 rad (2d) /
      // 7.5e-8 rad (3d), i.e. one f32 ulp at this magnitude. The animation-
      // weighted door above, which never goes near the solver, was exact.
      expect(worst).toBeLessThan(1e-6);
      expect(worst).toBeGreaterThan(0);
      expect(door.node.transform.position.x).toBe(DOOR_PIVOT.x);
    });

    // --- (b) §19 example 2: the hinged physical door -------------------------

    it("swings a hinged door at the compound-pendulum period (§19 ex.2)", async () => {
      const rig = await openRig();
      const world = await createBlendWorld(rig, kit);
      const door = buildDoor(world, kit, {
        angle: DOOR_AMPLITUDE,
        hinged: true,
        physicsWeight: 1,
        animationWeight: 0,
      });
      const target = requireTarget(door).target;

      // Held under animated control first, so the hand-over below is a real
      // §19 control-mode transition rather than a body that started dynamic.
      runSteps(rig.app, DOOR_HOLD_STEPS);
      expect(angleAboutZ(door.node.transform.rotation)).toBeCloseTo(
        DOOR_AMPLITUDE,
        6,
      );

      world.setBodyControlMode(door.node, "dynamic", {
        inheritVelocityFrom: target,
      });

      const times = crossingTimes(rig.app, DOOR_SWING_STEPS, () =>
        angleAboutZ(door.node.transform.rotation),
      );
      const measured = meanInterval(times);
      const small = doorPendulumPeriod();
      const finite = small * (1 + (DOOR_AMPLITUDE * DOOR_AMPLITUDE) / 16);

      // 18 falling zero crossings in 30 s at ~1.644 s each.
      expect(times.length).toBe(18);

      // The same shape as WP-6.4's point pendulum, one rigid body further on:
      // the +0.247% against the small-angle form is the finite-amplitude
      // correction T ≈ T₀(1 + θ₀²/16), which is +0.25% on its own — and the
      // measurement sits within 2.9e-5 relative of *that*. Measured:
      // +0.24714% (2d) / +0.24711% (3d) vs T₀; −2.86e-5 / −2.88e-5 vs finite.
      expect(Math.abs(measured / small - 1)).toBeLessThan(0.01);
      expect(Math.abs(measured / finite - 1)).toBeLessThan(1e-3);

      // The period is mass-independent by derivation, and the two dimensions
      // give the leaf very different masses (density × area vs × volume) — so
      // this one closed form holding in both is the claim, not a coincidence.
      expect(measured).toBeGreaterThan(0);
    });

    it("is bit-identical to the same door under `physics` authority (§42)", async () => {
      const rig = await openRig();
      const blendedWorld = await createBlendWorld(rig, kit);
      const controlWorld = await createBlendWorld(rig, kit);
      const blended = buildDoor(blendedWorld, kit, {
        angle: DOOR_AMPLITUDE,
        hinged: true,
        physicsWeight: 1,
        animationWeight: 0,
      });
      const control = buildDoor(controlWorld, kit, {
        angle: DOOR_AMPLITUDE,
        hinged: true,
        authority: "physics",
        poseTarget: false,
      });

      runSteps(rig.app, DOOR_HOLD_STEPS);
      blendedWorld.setBodyControlMode(blended.node, "dynamic");
      controlWorld.setBodyControlMode(control.node, "dynamic");
      runSteps(rig.app, DOOR_COMPARE_STEPS);

      // Plan P7-4 promises that "switching a node between `physics` and a
      // fully-physical `blended` changes nothing at all, bit for bit". The unit
      // suite proves it for one publish against a double; this is the same
      // claim after 630 steps of a real solver and a real hinge, so an
      // interpolation that was merely *almost* exact would have diverged.
      expect(blended.node.transform.position.x).toBe(
        control.node.transform.position.x,
      );
      expect(blended.node.transform.position.y).toBe(
        control.node.transform.position.y,
      );
      expect(blended.node.transform.rotation.z).toBe(
        control.node.transform.rotation.z,
      );
      expect(blended.node.transform.rotation.w).toBe(
        control.node.transform.rotation.w,
      );
      // …and it is a moving door, not two bodies that both sat still.
      expect(
        Math.abs(angleAboutZ(blended.node.transform.rotation)),
      ).toBeGreaterThan(0.01);
    });

    // --- (c) §19 example 3: the commanded arm --------------------------------

    it("blends a commanded kinematic-velocity arm against a small animation weight (§19 ex.3)", async () => {
      const rig = await openRig();
      const blendedWorld = await createBlendWorld(rig, kit);
      const controlWorld = await createBlendWorld(rig, kit);
      const arm = buildCommandedArm(rig, blendedWorld, kit);
      const control = buildCommandedArm(rig, controlWorld, kit, {
        blended: false,
      });

      const trace = new PoseTrace([arm.node]);
      trace.capture();
      let elapsed = 0;
      let worstLerpError = 0;
      let worstSolverError = 0;
      const check = (): void => {
        elapsed += 1;
        trace.capture();
        // The control world publishes the pure solver pose (animationWeight 0),
        // which is what the blended world's own solver is doing too — the two
        // worlds are built identically and the publish never feeds back.
        const solver = control.node.transform.position;
        const wanted = arm.target.position;
        worstLerpError = Math.max(
          worstLerpError,
          Math.abs(
            arm.node.transform.position.x -
              (solver.x + (wanted.x - solver.x) * ARM_ANIMATION_WEIGHT),
          ),
          Math.abs(
            arm.node.transform.position.y -
              (solver.y + (wanted.y - solver.y) * ARM_ANIMATION_WEIGHT),
          ),
        );
        const commanded =
          elapsed <= ARM_STEPS
            ? ARM_COMMAND_SPEED * elapsed * DT
            : ARM_COMMAND_SPEED * (2 * ARM_STEPS - elapsed) * DT;
        worstSolverError = Math.max(
          worstSolverError,
          Math.abs(solver.x - commanded),
        );
      };

      runSteps(rig.app, ARM_STEPS, check);
      // The §23 command changes mid-run: the arm is told to go back.
      arm.body.linearVelocity.set(-ARM_COMMAND_SPEED, 0, 0);
      control.body.linearVelocity.set(-ARM_COMMAND_SPEED, 0, 0);
      runSteps(rig.app, ARM_STEPS, check);

      // §19 step 5, measured on a real solver: the published pose is *exactly*
      // `lerp(solver pose, target pose, animationWeight)` — 0 error, not a
      // tolerance, because the weights normalize to exactly 0.1/0.9 and
      // `Vector3.lerp` is the same `a + (b − a)·t` recomputed here.
      expect(worstLerpError).toBe(0);

      // The solver side is the §23 authored velocity, integrated: the arm
      // tracked `v·t` out to 0.9 m and back to the origin through the reversal,
      // to 7.4e-7 m — Rapier's f32 accumulation over 180 steps.
      expect(worstSolverError).toBeLessThan(1e-5);
      expect(control.node.transform.position.x).toBeCloseTo(0, 6);

      // The animated half kept lifting the whole time, so the blend is a real
      // mixture and not the solver pose wearing a weight.
      expect(arm.node.transform.position.y).toBeCloseTo(
        (ARM_ANIMATION_WEIGHT * ARM_LIFT * (2 * ARM_STEPS * DT)) /
          ARM_LIFT_SECONDS,
        12,
      );

      // §110: no step — including the one the command reversed on — moved the
      // arm further than the weighted sum of its two motions allows. Measured
      // 0.009014 m against 0.0095 m.
      expect(maxOf(trace.stepDisplacements())).toBeLessThanOrEqual(
        ARM_STEP_BOUND,
      );
    });

    // --- (d) §19 example 4 + §110: the ragdoll cycle -------------------------

    it("cycles animated → dynamic → blended → animated with no teleport (§19 ex.4, §110)", async () => {
      const run = await runRagdollCycle(kit);
      const displacements = run.displacements;

      // The activation inherited exactly the speed the animation was moving at:
      // `(target − previousTarget) / DT` over one fixed step of a 2 m/s tween.
      // Measured 1.9999999999999996 m/s.
      expect(run.inheritedSpeed).toBeCloseTo(CHAIN_DRIVE_SPEED, 9);

      // …and the collapse continued along +X at that speed: 1.000002 m in the
      // half second after the switch, against the 1 m the pre-switch motion
      // predicts. (What that does *not* isolate is the next case.)
      expect(run.travelX).toBeCloseTo(
        CHAIN_DRIVE_SPEED * INHERITANCE_WINDOW * DT,
        4,
      );

      // It really did collapse: the chain fell 1.92 m of its 2 m onto the
      // ground rather than being held up by the blend.
      expect(run.dropY).toBeGreaterThan(1.5);

      // §110's criterion, over the whole run: no step moved any link further
      // than the collapse's own energy bound allows. Measured max 0.1078 m.
      expect(maxOf(displacements)).toBeLessThanOrEqual(RAGDOLL_STEP_BOUND);

      // §110 at switch 1 (kinematic-position → dynamic). The tightest honest
      // statement available: the step after the hand-over may add exactly one
      // fixed step of gravity to the motion the body already had, and gravity
      // is perpendicular to it, so the displacement may grow only in
      // quadrature. `fallDistance(1)` is WP-5.4's substepped free-fall drop for
      // one step (1.703e-3 m), not ½gΔt². Measured 0.0333769 m against a bound
      // of 0.0333801 m — 6 parts per million of headroom used, on a criterion
      // a teleport would miss by orders of magnitude.
      const beforeActivation = displacements[run.activationStep - 2];
      expect(displacements[run.activationStep - 1]).toBeLessThanOrEqual(
        Math.hypot(beforeActivation, Math.abs(fallDistance(1))) * (1 + 1e-4),
      );

      // §110 across the sweep: bounded by `Δw·|S − T| + w·|ΔT| + (1 − w)·|ΔS|`,
      // which telescopes to `2·RECOVERY_SPEED·DT` independently of N.
      expect(
        maxBetween(displacements, run.sweepStart - 1, run.retypeStep - 1),
      ).toBeLessThanOrEqual(RAGDOLL_SWEEP_BOUND);

      // §110 at switch 2 (dynamic → kinematic-position). This is the switch
      // that moves the *solver body* by the whole distance the ragdoll had
      // fallen away from its animation — and the node does not move by it at
      // all, because the sweep had already carried the published weight to 1,
      // so the node has been following the target alone since the step before.
      // The step is therefore exactly the target's own motion, 0.005 m, and
      // strictly smaller than the step before it.
      expect(displacements[run.retypeStep - 1]).toBeCloseTo(
        RECOVERY_SPEED * DT,
        12,
      );
      expect(displacements[run.retypeStep - 1]).toBeLessThanOrEqual(
        displacements[run.retypeStep - 2],
      );

      // And it stayed under animated control afterwards: every remaining step
      // is the recovery tween's own, and the chain rose by exactly what one
      // second of a 0.3 m/s lift is.
      expect(
        maxBetween(displacements, run.retypeStep - 1, displacements.length),
      ).toBeLessThanOrEqual(RECOVERY_SPEED * DT * (1 + 1e-9));
      expect(run.finalY - run.retypeY).toBeCloseTo(
        RECOVERY_SPEED * RAGDOLL_PHASES.kinematic * DT,
        9,
      );
    });

    it("reports what velocity inheritance is and is not doing (§19, measured)", async () => {
      const inherited = await runRagdollCycle(kit);
      const noFlag = await runRagdollCycle(kit, { inheritVelocity: false });
      const stationary = await runRagdollCycle(kit, { drive: false });
      const noCapture = await runRagdollCycle(kit, {
        capturePoseTargets: false,
      });

      // (i) The pre-switch motion is what carries into the collapse. With
      // nothing animating before the switch there is nothing to inherit and the
      // chain drops straight down: travel 0 m exactly, against 1.000002 m.
      expect(stationary.inheritedSpeed).toBe(0);
      expect(stationary.travelX).toBe(0);
      expect(inherited.travelX).toBeGreaterThan(0.9);

      // (ii) But the *flag* did not cause that, on this solver. A Rapier
      // "kinematic-position" body being driven to per-step targets already
      // carries the velocity Rapier derived from them, and `setBodyType` keeps
      // it — so omitting `inheritVelocityFrom` travels just as far. §19's
      // finite difference and Rapier's own derivation agree to 2.4e-7 m over
      // half a second. This is the packet's expectation being *corrected by
      // measurement*, not an assertion weakened to fit.
      expect(Math.abs(noFlag.travelX - inherited.travelX)).toBeLessThan(1e-5);

      // (iii) The flag is nonetheless writing real velocities, and reading a
      // real history: an application that forgot `createPoseTargetCaptureSystem`
      // leaves `previousPosition` at the pose the target was *seeded* with, so
      // the difference is the whole animated displacement over one step —
      // 60 m/s here, thirty times the animation's actual speed, and the chain
      // is launched 30 m instead of falling.
      //
      // Reported to the orchestrator: `world.ts` and `pose-target.ts` both say
      // the un-captured case "inherits zero velocity". Measured, it inherits
      // `animatedDisplacement / DT`. Zero is what an *unanimated* target gives.
      expect(noCapture.inheritedSpeed).toBeGreaterThan(
        10 * inherited.inheritedSpeed,
      );
      expect(noCapture.travelX).toBeGreaterThan(10 * inherited.travelX);
    });

    // --- (f) §33 checksums with blending active ------------------------------

    it("produces identical §33 checksums across two identical blended runs", async () => {
      const first = await runRagdollCycle(kit);
      const second = await runRagdollCycle(kit);

      // Same scenario, same order, two fresh solvers: a control-mode switch, a
      // weight sweep, and a blend publish are all inside these 300 steps, and
      // §33's digest of the solver state agrees on every one of them.
      expect(second.checksums).toEqual(first.checksums);
      expect(first.checksums).toHaveLength(
        RAGDOLL_PHASES.animated +
          RAGDOLL_PHASES.physical +
          RAGDOLL_PHASES.sweep +
          RAGDOLL_PHASES.kinematic,
      );
      // A digest that never changed would satisfy the equality above vacuously.
      expect(new Set(first.checksums).size).toBeGreaterThan(100);
    });
  });
}

// --- (e) root motion composes with the blend ---------------------------------

/** Fixed steps the walker runs for: four loops of the one-second walk clip. */
const WALK_STEPS = 240;

describe("root motion composes with §19's blend (§19, plan P7-5)", () => {
  it("accumulates locomotion while the walker pushes a dynamic crate", async () => {
    // 2D only, and deliberately: the mechanism is a mixer, a follow system, a
    // kinematic-position body and a contact, none of which has a dimension —
    // the §21 coverage that matters is on the blend itself, which every case
    // above runs in both.
    const kit: DimensionKit = DIMENSION_KITS[0];
    const rig = await openRig();
    const world = await createBlendWorld(rig, kit);
    addGround(world, kit);
    const scene = buildWalker(rig, world, kit);

    const trace = new PoseTrace([scene.walker.node]);
    trace.capture();
    let worstWalkError = 0;
    runSteps(rig.app, WALK_STEPS, (step) => {
      trace.capture();
      worstWalkError = Math.max(
        worstWalkError,
        Math.abs(scene.walker.node.transform.position.x - walkedDistance(step)),
      );
    });

    // Root motion accumulated across four loops of the clip and landed on the
    // closed form `stride · elapsed / duration` to 2.2e-14 m — through the
    // mixer's loop-aware differencing, a follow system, a `PoseTarget`, §19's
    // publish, and a contact with a dynamic body along the way.
    expect(worstWalkError).toBeLessThan(1e-12);
    expect(scene.walker.node.transform.position.x).toBeCloseTo(
      WALK_STRIDE.x * WALK_STEPS * DT,
      9,
    );

    // Physics interacted: the crate was pushed 1.85 m and is still in front of
    // the walker rather than under it.
    const crateTravel = scene.crate.node.transform.position.x - CRATE_START_X;
    expect(crateTravel).toBeGreaterThan(1);
    expect(scene.crate.node.transform.position.x).toBeGreaterThan(
      scene.walker.node.transform.position.x,
    );

    // …and the locomotion was *not* deflected by that contact: a
    // kinematic-position body under `"blended"` authority publishes its target,
    // so the walker's height is unchanged and its stride is unbroken. §110's
    // criterion here is the stride itself — every step is exactly one clip
    // step, 0.01333 m.
    expect(scene.walker.node.transform.position.y).toBeCloseTo(
      WALKER_HALF_EXTENTS.y,
      12,
    );
    expect(maxOf(trace.stepDisplacements())).toBeLessThanOrEqual(
      WALK_STRIDE.x * DT * (1 + 1e-9),
    );
  });
});
