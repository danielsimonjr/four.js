/**
 * Phase 8 cross-integration: **§111's advanced-motion utilities composed with
 * the Phase 5–7 stacks and driven through the public API** (WP-8.4; §111, §33,
 * §30, §19, §110).
 *
 * The shape is WP-5.6's, WP-6.4's, and WP-7.5's, and so is the discipline: one
 * headless `Application` from `four/application`, real Rapier worlds wherever
 * physics is involved, nothing but the public API anywhere, and no clock and no
 * `Math.random` in any scenario (§33). What is new is that the *controllers* —
 * PID, spring-damper, steering, prediction, IK — are now the thing under test
 * and the engine is the plant.
 *
 * ## What every number below was measured at
 *
 * Rapier 0.19.3 (`-compat@0.19.3`), `DT = 1/60`, both §21 dimensions where the
 * case runs in both.
 *
 * | Case                                                   | Measured                        |
 * | ------------------------------------------------------ | ------------------------------- |
 * | (a) shaft mass vs the §25 density derivation            | `7.1e-8` / `4.7e-8` relative    |
 * | (a) open-loop DC gain (identified)                      | `0.621764` (2d and 3d)          |
 * | (a) …vs the continuous `k/(k + I·c)` prediction `⅔`      | `−6.73%`                        |
 * | (a) P-only settled speed vs the identified-model form   | `1.2e-7` / `3.2e-8` relative    |
 * | (a) P-only droop from the setpoint                      | `4.139 rad/s` (51.7%)           |
 * | (a) PID settled speed vs the 8 rad/s setpoint           | `0` (f32 ULP is `9.5e-7`)       |
 * | (a) PID late-window standard deviation                  | `0` exactly                     |
 * | (a) PID overshoot                                       | `0` (2d) / `1e-6` (3d) rad/s    |
 * | (a) anti-windup: peak command at `±14` vs `±20` limits   | `12.8666` vs `16.1667 rad/s`    |
 * | (b) tracking error vs the exact discrete steady state   | `2.9e-15` / `3.1e-15 m`         |
 * | (b) phase lag vs `−arg H(λ)`                            | `1.5e-15` / `1.7e-15 rad`       |
 * | (c) agent excursion (arena half width 6 m)              | `5.0191 m`                      |
 * | (c) …with the wall behaviour removed                    | `47.7202 m`                     |
 * | (c) obstacle surface clearance                          | `2.0427 m`                      |
 * | (c) …with the §30 probe removed                         | `0.3376 m`                      |
 * | (c) two identical runs: agent trace / checksum stream   | `0` differences                 |
 * | (c) steering run vs no-steering run: checksum stream    | `0` differences                 |
 * | (d) `interceptTime` vs the constructed `0.8 s`          | exact to `1e-15`                |
 * | (d) substep-compensated shot, closest approach          | `2.45e-5 m`                     |
 * | (d) continuous-compensated shot, closest approach       | `1.6355e-2 m`                   |
 * | (d) …vs the substep bias `g·h·t/2 = 1.6350e-2 m`        | `2.2e-5 m`                      |
 * | (e) IK tip tracking error (0.9/0.1 blend)               | `1.63e-8 m`                     |
 * | (e) …at 1.0/0.0 (pure target) / 0.5/0.5                 | `9.0e-16` / `8.13e-8 m`         |
 * | (e) elbow gap                                           | `1.65e-8 m`                     |
 * | (e) per-step tip displacement (§110)                    | `0.00749993 m` (bound `0.0075`) |
 *
 * ## The two places the engine surprised this packet (measured)
 *
 * 1. **A velocity written after registration reaches no solver.** The first
 *    version of the interception case wrote `RigidBody.linearVelocity` on the
 *    projectile *after* `world.addBody`; the shot stayed at the muzzle and fell
 *    straight down (its Y matched `fallDistance(48)` to the digit). §23 already
 *    says the field is authored state going in and solved state coming back —
 *    the launch velocity is now on the descriptor, and the helper says why.
 * 2. **Conditional-integration anti-windup can return a command strictly
 *    inside the limits.** Tightening `outputLimits` from `±20` to `±14` did not
 *    make the recorded command `14`: the rule freezes the integrator and
 *    *re-evaluates*, and the re-evaluated output is `12.8666`, below the limit
 *    that triggered the freeze. That is `pid.ts`'s documented behaviour, and it
 *    is why "did the command reach the limit?" is the wrong saturation
 *    detector; the case compares the two runs' peak commands instead.
 */

import { PIDController, SpringDamper } from "@four/motion";
import { describe, expect, it } from "vitest";

import {
  AGENT_MAX_SPEED,
  ARENA_HALF,
  FOLLOW_RADIUS,
  FOLLOW_RATE,
  IK_TARGET_RADIUS,
  IK_TARGET_RATE,
  IK_WEIGHTS,
  INTERCEPT_STEPS,
  INTERCEPT_TIME,
  SHAFT_COMMAND_LIMITS,
  SHAFT_SETPOINT,
  SHAFT_WIDE_COMMAND_LIMITS,
  closestApproach,
  countDifferences,
  followPhaseLag,
  followTrackingError,
  lateWindow,
  maxDeviation,
  mean,
  pidCommand,
  runCameraFollow,
  runFlock,
  runInterception,
  runSpeedControl,
  runTwoBoneIK,
  shaftMass,
  standardDeviation,
  substepBias,
} from "./helpers/motion-advanced-scenarios.js";
import {
  DIMENSION_KITS,
  DT,
  fallDistance,
} from "./helpers/physics-scenarios.js";

/** Fixed steps every controller case runs for: 10 s at `DT`. */
const SETTLE_STEPS = 600;

/** Steps of the late window every "has it settled?" statistic is taken over. */
const LATE_WINDOW = 120;

/** Proportional gain of both controllers in case (a). */
const SHAFT_KP = 1.5;

/** Integral gain of the PID in case (a), per second. */
const SHAFT_KI = 31.25;

/** Derivative gain of the PID in case (a), in seconds. */
const SHAFT_KD = 0.02;

/** Fixed steps the steering arena runs for — the packet's 2000. */
const FLOCK_STEPS = 2000;

describe("(a) §111 PID speed control of a Phase 6 motorized hinge", () => {
  for (const kit of DIMENSION_KITS) {
    it(`${kit.dimension}: identifies the plant, then removes its droop`, async () => {
      // --- open loop: the plant, commanded straight at the setpoint ---------
      //
      // Rapier's hinge motor is itself a proportional velocity drive of gain
      // `maxTorque` (a `ForceBased` factor, MEMORY 2026-08-02), so with the
      // viscous load `I·c` the continuous model predicts a steady speed of
      // `setpoint · k/(k + I·c) = setpoint · 20/30`. The solver's discrete
      // damping makes the real gain lower; the measurement below *identifies*
      // it, and every later prediction in this case uses the identified value
      // rather than the continuous one.
      const open = await runSpeedControl(kit, {
        command: () => SHAFT_SETPOINT,
        steps: SETTLE_STEPS,
      });
      const openSpeed = mean(lateWindow(open.speeds, LATE_WINDOW));
      const dcGain = openSpeed / SHAFT_SETPOINT;

      // The §25 density derivation, checked against the solver's own mass —
      // the number `shaftInertia` (and therefore the motor gain) is built on.
      expect(Math.abs(open.mass / shaftMass(kit) - 1)).toBeLessThan(1e-6);

      // Measured 0.621764 in **both** dimensions: normalizing the motor gain
      // by the derived inertia makes a 2D rectangle and a 3D box the same
      // plant, to six digits, despite a 10× mass difference.
      expect(dcGain).toBeGreaterThan(0.6);
      expect(dcGain).toBeLessThan(0.65);
      // …and 6.73% below the continuous prediction. The gap is the solver's,
      // not the controller's: Rapier applies damping and the motor per substep
      // rather than in continuous time. Bounded here, not pinned.
      expect(Math.abs(dcGain / (20 / 30) - 1)).toBeLessThan(0.08);
      // The droop the controller exists to remove: 3.026 rad/s, 37.8%.
      expect(SHAFT_SETPOINT - openSpeed).toBeGreaterThan(3);

      // --- proportional only: the droop shrinks but does not go away --------
      //
      // For a first-order plant of DC gain `G` under `u = kp·(sp − ω)`,
      // `ω = sp·G·kp/(1 + G·kp)`. With the identified `G` this is a closed-form
      // prediction of the closed loop from an open-loop measurement.
      const proportional = new PIDController({
        kp: SHAFT_KP,
        outputLimits: SHAFT_COMMAND_LIMITS,
      });
      const pRun = await runSpeedControl(kit, {
        command: pidCommand(proportional),
        steps: SETTLE_STEPS,
      });
      const pSpeed = mean(lateWindow(pRun.speeds, LATE_WINDOW));
      const pPredicted =
        (SHAFT_SETPOINT * (dcGain * SHAFT_KP)) / (1 + dcGain * SHAFT_KP);

      // Measured 1.2e-7 (2d) / 3.2e-8 (3d) relative — the loop algebra and the
      // solver agree to f32 resolution.
      expect(Math.abs(pSpeed / pPredicted - 1)).toBeLessThan(1e-5);
      // And the offset is not academic: 3.8606 rad/s against a setpoint of 8.
      expect(SHAFT_SETPOINT - pSpeed).toBeGreaterThan(4);

      // --- PID: the integral term removes it entirely -----------------------
      const pid = new PIDController({
        kp: SHAFT_KP,
        ki: SHAFT_KI,
        kd: SHAFT_KD,
        outputLimits: SHAFT_COMMAND_LIMITS,
      });
      const run = await runSpeedControl(kit, {
        command: pidCommand(pid),
        steps: SETTLE_STEPS,
      });
      const settled = lateWindow(run.speeds, LATE_WINDOW);

      // Measured deviation: **0** — every one of the last 120 samples is the
      // same float, and it is `8`. The tolerance is one f32 ULP at 8 (9.5e-7),
      // which is the finest a Rapier-published velocity can resolve; the loop
      // cannot be shown to do better than land on the setpoint exactly.
      expect(maxDeviation(settled, SHAFT_SETPOINT)).toBeLessThan(1e-5);
      // No sustained oscillation: the late-window spread is 0 exactly. A limit
      // cycle of even one ULP would fail this.
      expect(standardDeviation(settled)).toBeLessThan(1e-7);
      // Nor a slow drift: the second half of the window equals the first.
      expect(
        Math.abs(mean(lateWindow(settled, 60)) - mean(settled.slice(0, 60))),
      ).toBeLessThan(1e-6);
      // Overshoot: 0 (2d) / 1e-6 (3d) rad/s — the `kd` term and the command
      // limit between them keep the approach monotone.
      expect(Math.max(...run.speeds) - SHAFT_SETPOINT).toBeLessThan(1e-5);
      // Settled (and stayed) within 0.02 rad/s by step 23 = 0.383 s.
      const settleStep = run.speeds.findIndex((_, index) =>
        run.speeds
          .slice(index)
          .every((value) => Math.abs(value - SHAFT_SETPOINT) < 0.02),
      );
      expect(settleStep).toBeGreaterThan(0);
      expect(settleStep).toBeLessThan(40);
      // The command the loop had to find: 12.867 rad/s, i.e. it asks the inner
      // drive for 61% more speed than it wants, which is exactly the droop.
      const finalCommand = run.commands[run.commands.length - 1];
      expect(finalCommand / SHAFT_SETPOINT).toBeGreaterThan(1.5);

      // --- anti-windup: the same loop with limits that bind -----------------
      const wide = new PIDController({
        kp: SHAFT_KP,
        ki: SHAFT_KI,
        kd: SHAFT_KD,
        outputLimits: SHAFT_WIDE_COMMAND_LIMITS,
      });
      const wideRun = await runSpeedControl(kit, {
        command: pidCommand(wide),
        steps: SETTLE_STEPS,
      });

      // Unbound, the transient peaks at 16.167 rad/s — above the ±14 limit the
      // run above was given, so that run's integrator *was* frozen. Its peak
      // command is 12.867, i.e. below its own limit (see the module header on
      // why the re-evaluated output can be), and it still settles exactly.
      expect(Math.max(...wideRun.commands)).toBeGreaterThan(
        SHAFT_COMMAND_LIMITS[1],
      );
      expect(Math.max(...run.commands)).toBeLessThan(
        Math.max(...wideRun.commands),
      );
      // Neither run ever returns a command outside its own limits (§111).
      for (const command of run.commands) {
        expect(command).toBeGreaterThanOrEqual(SHAFT_COMMAND_LIMITS[0]);
        expect(command).toBeLessThanOrEqual(SHAFT_COMMAND_LIMITS[1]);
      }
      // And windup cost neither run its steady state: both land on the
      // setpoint to f32 resolution.
      expect(
        maxDeviation(lateWindow(wideRun.speeds, LATE_WINDOW), SHAFT_SETPOINT),
      ).toBeLessThan(1e-6);
    }, 60_000);
  }
});

describe("(b) SpringDamper smoothing a camera follow", () => {
  for (const [label, spring] of [
    [
      "critically damped, 1.5 Hz",
      new SpringDamper({ frequencyHz: 1.5, dampingRatio: 1 }),
    ],
    [
      "underdamped, 1 Hz, ζ = 0.7",
      new SpringDamper({ frequencyHz: 1, dampingRatio: 0.7 }),
    ],
  ] as const) {
    it(`${label}: lags by exactly the discrete steady state`, async () => {
      const run = await runCameraFollow({ spring, steps: SETTLE_STEPS });
      const errors = lateWindow(run.errors, LATE_WINDOW);
      const lags = lateWindow(run.lags, LATE_WINDOW);

      // The prediction: `|H(λ) − 1| · radius`, with `H` the exact steady-state
      // gain of the difference equation the follow system runs (derived on
      // `followGain`, from transition entries re-derived from the spring's
      // public parameters rather than read out of it).
      const analyticError = followTrackingError(
        spring,
        FOLLOW_RATE,
        DT,
        FOLLOW_RADIUS,
      );
      const analyticLag = followPhaseLag(spring, FOLLOW_RATE, DT);

      // Measured 0.961321243326 m (critical) and 1.107699571480 m
      // (underdamped) against a 2 m radius, matching the closed form to
      // 2.9e-15 / 3.1e-15 m — round-off, not agreement to a tolerance. The
      // transient is long gone: the slowest mode decays as `e^{−ζωₙt}`, i.e.
      // by `e^{−75}` (critical) and `e^{−35}` (underdamped) over the 8 s that
      // precede the window.
      expect(maxDeviation(errors, analyticError)).toBeLessThan(1e-12);
      // The error is a constant, not a bound: every sample in the window is
      // the same distance (spread < 1e-12 m), which is what "steady state"
      // means for a circular target through a linear filter.
      expect(Math.max(...errors) - Math.min(...errors)).toBeLessThan(1e-12);
      // The lag is a phase: 0.497741 rad = 0.1991 s (critical) and 0.563805
      // rad = 0.2255 s (underdamped) behind the target, matched to 1.5e-15 /
      // 1.7e-15 rad.
      expect(maxDeviation(lags, analyticLag)).toBeLessThan(1e-12);
      expect(analyticLag).toBeGreaterThan(0);
      // A smoother that lagged by more than the radius would not be smoothing.
      expect(analyticError).toBeLessThan(FOLLOW_RADIUS);
    }, 60_000);
  }
});

describe("(c) steering agents in a bounded arena with physics obstacles", () => {
  it("stays in bounds, repeats bit-identically, and never touches solver state", async () => {
    const first = await runFlock({ steps: FLOCK_STEPS });
    const second = await runFlock({ steps: FLOCK_STEPS });
    const noSteering = await runFlock({ steps: FLOCK_STEPS, steering: false });
    const noWalls = await runFlock({ steps: FLOCK_STEPS, walls: false });
    const noProbe = await runFlock({ steps: FLOCK_STEPS, avoid: false });

    // In bounds for the whole run: the worst excursion is 5.0191 m against the
    // 6 m arena half width, over 2000 steps.
    expect(first.maxExcursion).toBeLessThan(ARENA_HALF);
    // …and the wall behaviour is what does it. With that one term removed and
    // everything else identical, the same agents reach 47.7202 m.
    expect(noWalls.maxExcursion).toBeGreaterThan(ARENA_HALF * 5);

    // The §30 probe is what keeps them off the obstacles: 2.0427 m of surface
    // clearance with it, 0.3376 m without.
    expect(first.minObstacleClearance).toBeGreaterThan(1);
    expect(noProbe.minObstacleClearance).toBeLessThan(0.5);

    // `SteeringAgent.integrate`'s speed clamp holds: 2.8225 m/s ≤ 3.
    expect(first.maxSpeed).toBeLessThanOrEqual(AGENT_MAX_SPEED);

    // §33: two identical runs are bit-identical, agent for agent and step for
    // step — 12,000 positions (36,000 coordinates) compared with `Object.is`,
    // 0 differences.
    expect(first.trace.length).toBe(FLOCK_STEPS * 6 * 3);
    expect(countDifferences(first.trace, second.trace)).toBe(0);
    expect(countDifferences(first.checksums, second.checksums)).toBe(0);

    // §33, the claim this case exists for: the world checksum stream is
    // identical to a run with **no agents at all**, so 12,000 `overlapSphere`
    // calls per run perturbed no solver state. The stream is not a constant —
    // 373 distinct digests over the run — so the comparison has teeth.
    expect(countDifferences(first.checksums, noSteering.checksums)).toBe(0);
    expect(new Set(first.checksums).size).toBeGreaterThan(100);
  }, 60_000);
});

describe("(d) ballistic interception of a constant-velocity target", () => {
  it("meets the target at interceptPoint's rendezvous", async () => {
    const substepped = await runInterception("substepped");
    const continuous = await runInterception("continuous");

    // The scenario was built backwards from a rendezvous at exactly 48 fixed
    // steps, so `interceptTime` recovering 0.8 s is the closed form solving a
    // problem whose answer was constructed independently of it.
    expect(substepped.time).toBeCloseTo(INTERCEPT_TIME, 12);
    // …and the aim point is the target's own position at that instant.
    expect(substepped.aimPoint.x).toBeCloseTo(10.4, 9);
    expect(substepped.aimPoint.y).toBeCloseTo(6, 9);
    expect(
      Math.hypot(
        substepped.aimPoint.x - substepped.rendezvous.x,
        substepped.aimPoint.y - substepped.rendezvous.y,
      ),
    ).toBeLessThan(1e-5);

    // Compensating the drop with Rapier's own substepped closed form
    // (`fallDistance`, WP-5.4) puts the shot on the target: 2.45e-5 m of
    // closest approach, which is f32 resolution at a 12 m range accumulated
    // over 192 substeps, not a modelling error.
    const substeppedMiss = closestApproach(substepped.distances);
    expect(substeppedMiss).toBeLessThan(1e-4);
    expect(
      Math.hypot(
        substepped.arrival.x - substepped.rendezvous.x,
        substepped.arrival.y - substepped.rendezvous.y,
      ),
    ).toBeLessThan(1e-4);

    // Compensating it with the textbook continuous `½·g·t²` instead misses
    // low, by exactly the substep bias `g·h·t/2` (h = DT/4): predicted
    // 0.0163500 m, measured gap 0.0163722 m, agreement 2.2e-5 m — again f32.
    const gap = continuous.rendezvous.y - continuous.arrival.y;
    expect(gap).toBeGreaterThan(0);
    expect(Math.abs(gap - substepBias(INTERCEPT_STEPS))).toBeLessThan(1e-4);
    // The closest approach is essentially the whole of that gap (0.0163550 m):
    // at the rendezvous the relative velocity is 13.4° off horizontal, so the
    // vertical miss is very nearly perpendicular to the passing direction.
    const continuousMiss = closestApproach(continuous.distances);
    expect(continuousMiss).toBeLessThanOrEqual(gap);
    expect(continuousMiss).toBeGreaterThan(0.9 * gap);
    // Which is the point of the case: knowing the integrator is worth a factor
    // of 668 in accuracy on the same closed form.
    expect(continuousMiss / substeppedMiss).toBeGreaterThan(100);
  }, 60_000);
});

describe("(e) two-bone IK driving PoseTargets on a blended chain", () => {
  it("tracks a moving target through §19's pipeline while physics runs", async () => {
    const run = await runTwoBoneIK(SETTLE_STEPS);
    const pureTarget = await runTwoBoneIK(SETTLE_STEPS, [1, 0]);
    const evenBlend = await runTwoBoneIK(SETTLE_STEPS, [0.5, 0.5]);

    // The target never leaves the chain's annulus, so every sample below is a
    // solved pose rather than a clamped one.
    expect(run.alwaysReachable).toBe(true);

    // The published tip tracks the IK target to 1.63e-8 m over 600 steps.
    expect(Math.max(...run.tipErrors)).toBeLessThan(5e-8);
    // The chain stays assembled: the lower link's origin and the upper link's
    // computed elbow differ by at most 1.65e-8 m.
    expect(Math.max(...run.elbowGaps)).toBeLessThan(5e-8);

    // That residue is the **blend**, not the IK. At 1.0/0.0 the publish is the
    // target alone and the error collapses to double round-off (9.0e-16 m);
    // at 0.5/0.5 it is 8.13e-8 m, five times the 0.9/0.1 figure — exactly the
    // ratio of the physics shares (0.5/0.1), because the only difference
    // between the two contributions is Rapier's f32 round trip.
    expect(Math.max(...pureTarget.tipErrors)).toBeLessThan(1e-14);
    const ratio = Math.max(...evenBlend.tipErrors) / Math.max(...run.tipErrors);
    expect(Math.abs(ratio / (0.5 / IK_WEIGHTS[1]) - 1)).toBeLessThan(0.02);

    // §110 continuity: no step moves the tip further than the IK target itself
    // moves, `radius · rate · DT = 0.0075 m`. Measured 0.00749993 m — the
    // chain is driven, never corrected.
    expect(Math.max(...run.tipSteps)).toBeLessThanOrEqual(
      IK_TARGET_RADIUS * IK_TARGET_RATE * DT,
    );

    // And physics was live throughout: the witness body free-fell for the whole
    // run, matching WP-5.4's substepped closed form to 3.8e-6 relative (1.9 mm
    // at −487.7 m, where an f32 ULP is already 3.1e-5 m).
    const expectedY = 3 + fallDistance(SETTLE_STEPS);
    expect(Math.abs(run.witnessY / expectedY - 1)).toBeLessThan(1e-5);
  }, 60_000);
});
