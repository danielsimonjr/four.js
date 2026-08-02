/**
 * Shared rigs and measurement for the §111 advanced-motion integration suite
 * (WP-8.4): the six modules Phase 8 added to `@four/motion` — `PIDController`,
 * `SpringDamper`, the steering behaviours, `SeededRandom`, the trajectory
 * prediction closed forms, and the two-bone IK solver — composed with the
 * stacks Phases 5–7 already built, through the **public API** only
 * (`four/application`, `@four/motion`, `@four/physics`, `@four/physics-rapier`,
 * `@four/scene`).
 *
 * This file is to Phase 8 what `joint-scenarios.ts` is to Phase 6 and
 * `blending-scenarios.ts` is to Phase 7, and like both of them it builds on
 * `physics-scenarios.ts` (WP-5.6) rather than restating it: {@link DimensionKit},
 * `createRig`, `createWorld`, `DT`, and the substepped free-fall closed forms
 * all come from there.
 *
 * ## What is only true of the composition
 *
 * Every module above has analytic unit tests inside `@four/motion`, and none of
 * them has ever met a solver, a scene node, or the §10 fixed step. What the
 * cases here add:
 *
 * 1. **A controller in a real loop.** `PIDController` is exercised against a
 *    plant nobody wrote for it — a Phase 6 motorized hinge on Rapier 0.19.3,
 *    whose motor is a *proportional velocity drive* rather than a torque source
 *    (MEMORY 2026-08-02: `maxTorque` is a `ForceBased` gain, not §28's cap), so
 *    the loop is a genuine cascade with a plant that droops.
 * 2. **A smoother at the fixed step.** `SpringDamper`'s exact discretization is
 *    checked against the closed-form steady state of *its own* difference
 *    equation, derived independently below, at the frequency a scene node is
 *    actually driven at.
 * 3. **Steering beside a solver.** Agents that are not bodies read the world
 *    through §30 `overlapSphere` every fixed step, which is exactly the
 *    arrangement that could perturb solver state — and §33 says it must not.
 * 4. **Prediction against a substepped integrator.** `interceptPoint`'s answer
 *    is fired as a real Rapier body, whose integrator is not the continuous
 *    parabola the closed form assumes (WP-5.4: four substeps per step).
 * 5. **IK inside §19's pipeline.** `solveTwoBoneIK` writes `PoseTarget`s that
 *    the Phase 7 blend publishes onto blended bodies while physics runs.
 *
 * ## Conventions (plan §1)
 *
 * Y-up in both dimensions, radians, **seconds** everywhere. Nothing here reads
 * a clock or `Math.random` (§33): every run is `Application.step(DT)` with a
 * constant injected delta, every "time" is a step count times `DT`, and the one
 * random stream is a `SeededRandom` with a literal seed.
 */

import { Quaternion, Vector3 } from "@four/math";
import {
  PIDController,
  PRIORITY_ANIMATION_TARGETS,
  PRIORITY_COMMANDS,
  PRIORITY_KINEMATICS,
  SeededRandom,
  SpringDamper,
  SteeringAgent,
  createTwoBoneIKSolution,
  flee,
  interceptPoint,
  interceptTime,
  seek,
  separation,
  solveTwoBoneIK,
  type SimulationSystem,
  type SpringDamperVector3Result,
  type SteeringNeighbor,
  type TwoBoneIKSolution,
} from "@four/motion";
import { Collider, HingeJoint, PhysicsWorld, RigidBody } from "@four/physics";
import { Group, PoseTarget, type Node } from "@four/scene";
import { Application } from "four/application";

import { createBlendRig, createBlendWorld } from "./blending-scenarios.js";
import {
  DT,
  GRAVITY_Y,
  KIT_2D,
  addBall,
  addSlab,
  createRig,
  createWorld,
  fallDistance,
  type DimensionKit,
  type PhysicsRig,
} from "./physics-scenarios.js";

// ---------------------------------------------------------------------------
// (a) PID speed control of a Phase 6 motorized hinge
// ---------------------------------------------------------------------------

/**
 * Half extents of the driven shaft, in metres — WP-6.4's `buildMotorShaft` bar,
 * restated here because this rig needs the numbers to derive the shaft's
 * inertia (see {@link shaftInertia}) and because it adds angular damping, which
 * that builder has no option for.
 */
export const SHAFT_HALF_EXTENTS = new Vector3(0.4, 0.05, 0.05);

/**
 * Angular damping on the shaft, in s⁻¹ (§23): the **load** the controller has
 * to work against.
 *
 * Without it this scenario measures nothing. A bar hinged at its own centre of
 * mass feels no gravitational torque, so a motor that is itself a velocity
 * controller would reach any commanded speed exactly and an outer loop would
 * have nothing to correct. Damping is the simplest load that is honest about
 * what it is: a torque `−I·c·ω` that grows with speed, which is what makes the
 * open loop *droop* — the classic reason a speed controller exists at all.
 */
export const SHAFT_ANGULAR_DAMPING = 10;

/**
 * Bandwidth of the hinge motor, in s⁻¹, from which its §28 `maxTorque` is
 * derived as `SHAFT_MOTOR_BANDWIDTH · I` (see {@link shaftMotorGain}).
 *
 * Rapier's motor exerts `maxTorque · (targetVelocity − ω)` (MEMORY
 * 2026-08-02), so `maxTorque / I` is a rate in s⁻¹ and is the only way to
 * specify the same actuator for both §21 dimensions, whose shafts differ in
 * inertia by a factor of ten (a 2D rectangle has area, a 3D box has volume).
 */
export const SHAFT_MOTOR_BANDWIDTH = 20;

/** Speed the closed loop is asked to hold, in rad/s about +Z. */
export const SHAFT_SETPOINT = 8;

/**
 * Command limits handed to the controller, in rad/s — §111's `outputLimits`.
 *
 * The command the loop settles at is `12.867 rad/s` (measured) and the same
 * PID's transient peaks at `16.167 rad/s` when its limits never bind
 * ({@link SHAFT_WIDE_COMMAND_LIMITS}, measured), so `±14` is the one choice
 * that leaves the steady state reachable **and** puts the transient outside the
 * limits: the conditional-integration anti-windup path is exercised rather than
 * merely present. Note that the *recorded* command never reaches `14` even so —
 * the rule freezes the integrator and re-evaluates, and the re-evaluated output
 * is below the limit that triggered the freeze (see the suite header).
 * `SHAFT_SETPOINT · (1 + c/bandwidth) = 12 rad/s` is what the continuous model
 * predicts for the steady command; the solver's discrete damping makes it 7.2%
 * higher.
 */
export const SHAFT_COMMAND_LIMITS: readonly [number, number] = [-14, 14];

/**
 * The same controller's limits set wide enough never to bind, in rad/s: the
 * unsaturated reference the anti-windup case is measured against.
 */
export const SHAFT_WIDE_COMMAND_LIMITS: readonly [number, number] = [-20, 20];

/**
 * The shaft's mass in kilograms, derived from §25's density rule rather than
 * measured: `DEFAULT_DENSITY = 1` times the bar's area in 2D and its volume in
 * 3D. Checked against the solver's own `RigidBody.mass` in the suite.
 */
export function shaftMass(kit: DimensionKit): number {
  const { x, y, z } = SHAFT_HALF_EXTENTS;
  return kit.dimension === "2d" ? 2 * x * 2 * y : 2 * x * 2 * y * 2 * z;
}

/**
 * The shaft's moment of inertia about +Z, in kg·m².
 *
 * A rectangle and a box share the same formula about the axis normal to their
 * `x`/`y` face: `I = m·((2a)² + (2b)²)/12 = m·(a² + b²)/3` for half extents
 * `a`, `b`. Derived, not read back from the solver — Rapier exposes no inertia
 * getter (§23's tensor is authored-or-derived and never published back,
 * WP-5.2-fix1).
 */
export function shaftInertia(kit: DimensionKit): number {
  const { x, y } = SHAFT_HALF_EXTENTS;
  return (shaftMass(kit) * (x * x + y * y)) / 3;
}

/** §28 `maxTorque` for the shaft's motor, in N·m·s/rad — a gain, not a cap. */
export function shaftMotorGain(kit: DimensionKit): number {
  return SHAFT_MOTOR_BANDWIDTH * shaftInertia(kit);
}

/** A motor-driven shaft with a viscous load, hinged about +Z at its centre. */
export interface ControlledShaftRig {
  /** The driven bar; its `angularVelocity.z` is the controlled variable. */
  readonly body: RigidBody;
  /** The scene node the solver writes. */
  readonly node: Node;
  /** The §28 hinge carrying the motor the controller commands. */
  readonly joint: HingeJoint;
}

/**
 * Builds the plant: a static anchor, a damped bar, and a hinge whose motor
 * starts at rest.
 *
 * The motor is constructed *with* a motor record because §28 motors cannot be
 * added to a registered joint (WP-6.1), only reconfigured — which is exactly
 * what a controller does every fixed step.
 */
export function buildControlledShaft(
  world: PhysicsWorld,
  kit: DimensionKit,
): ControlledShaftRig {
  const centre = new Vector3(0, 0, 0);

  const anchorNode = new Group();
  anchorNode.name = "shaft-anchor";
  const anchorBody = new RigidBody({ type: "static" });
  anchorNode.addComponent(anchorBody);
  world.addBody(anchorNode);

  const node = new Group();
  node.name = "shaft";
  node.transformAuthority = "physics";
  const body = new RigidBody({
    type: "dynamic",
    angularDamping: SHAFT_ANGULAR_DAMPING,
  });
  node.addComponent(body);
  node.addComponent(
    new Collider({
      shape: kit.slab(
        SHAFT_HALF_EXTENTS.x,
        SHAFT_HALF_EXTENTS.y,
        SHAFT_HALF_EXTENTS.z,
      ),
    }),
  );
  world.addBody(node);

  const joint = new HingeJoint({
    bodyA: anchorBody,
    bodyB: body,
    anchor: centre,
    axis: new Vector3(0, 0, 1),
    motor: {
      enabled: true,
      targetVelocity: 0,
      maxTorque: shaftMotorGain(kit),
    },
  });
  world.addJoint(joint);
  return { body, node, joint };
}

/** What {@link runSpeedControl} records, once per fixed step. */
export interface SpeedControlRun {
  /** Measured shaft speed in rad/s after each step, in step order. */
  readonly speeds: readonly number[];
  /** Commanded motor `targetVelocity` in rad/s for each step, in step order. */
  readonly commands: readonly number[];
  /** The shaft's solver-side mass in kilograms (§23), for the derivation check. */
  readonly mass: number;
}

/** How {@link runSpeedControl} drives the shaft. */
export interface SpeedControlOptions {
  /**
   * Motor command in rad/s for the step about to run, given the speed measured
   * at the end of the previous one — the sampled-data form every digital
   * controller has (§10: the command is queued before the solve).
   */
  command: (measured: number, step: number) => number;
  /** Fixed steps to run. */
  steps: number;
}

/**
 * Runs the closed (or open) loop and returns the sampled trajectory.
 *
 * The command is queued from a `SimulationSystem` at §39's
 * `PRIORITY_COMMANDS` — step 2, "commands", strictly before the step-6 solve —
 * so the ordering under test is the engine's, not a test harness's.
 */
export async function runSpeedControl(
  kit: DimensionKit,
  options: SpeedControlOptions,
): Promise<SpeedControlRun> {
  const rig = await createRig();
  try {
    const world = await createWorld(rig, kit, { sleeping: { enabled: false } });
    const shaft = buildControlledShaft(world, kit);

    const speeds: number[] = [];
    const commands: number[] = [];
    let step = 0;
    let measured = 0;
    const controller: SimulationSystem = {
      priority: PRIORITY_COMMANDS,
      initialize(): void {
        // Nothing to set up: the plant is built before registration.
      },
      fixedUpdate(): void {
        step += 1;
        const command = options.command(measured, step);
        shaft.joint.setMotor({
          enabled: true,
          targetVelocity: command,
          maxTorque: shaftMotorGain(kit),
        });
        commands.push(command);
      },
      dispose(): void {
        // Deliberately empty; the world outlives the system.
      },
    };
    rig.app.systems.register(controller);

    for (let i = 0; i < options.steps; i += 1) {
      rig.app.step(DT);
      measured = shaft.body.angularVelocity.z;
      speeds.push(measured);
    }
    return { speeds, commands, mass: shaft.body.mass ?? Number.NaN };
  } finally {
    rig.dispose();
  }
}

/**
 * A `PIDController` command closure for {@link runSpeedControl}: PID on the
 * speed error, output taken directly as the motor's `targetVelocity`.
 *
 * ## Why `targetVelocity` and not `maxTorque` (decision, WP-8.4)
 *
 * Rapier's motor is `effort = maxTorque · (targetVelocity − ω)`, so the two
 * modulations are not interchangeable:
 *
 * - Modulating **`targetVelocity`** leaves the actuator linear — the plant from
 *   command to speed is a fixed first-order system — and makes the arrangement
 *   the textbook **cascade**: an outer PID on speed around an inner
 *   proportional velocity drive. That is also the only mapping that survives a
 *   solver where `maxTorque` *is* §28's hard cap (Box2D may honour one), since
 *   there the gain is not an input at all.
 * - Modulating **`maxTorque`** would make the loop gain the manipulated
 *   variable, i.e. a bilinear plant whose sign cannot even be commanded
 *   (`maxTorque` is non-negative, so it can only ever push toward the standing
 *   `targetVelocity`). §111's sketch — a PID with `outputLimits` in the
 *   controlled quantity's own units — does not describe that plant.
 *
 * The controller's `outputLimits` are therefore a real actuator limit (a
 * maximum commanded shaft speed), which is what makes the anti-windup rule
 * meaningful here.
 */
export function pidCommand(
  controller: PIDController,
  setpoint = SHAFT_SETPOINT,
): (measured: number) => number {
  return (measured: number): number =>
    controller.update(setpoint, measured, DT);
}

/** The mean of `values` — the settled-speed statistic the assertions read. */
export function mean(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return values.length === 0 ? Number.NaN : total / values.length;
}

/** The population standard deviation of `values`, in the same units. */
export function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  let total = 0;
  for (const value of values) {
    total += (value - average) * (value - average);
  }
  return Math.sqrt(total / values.length);
}

/** The largest absolute deviation of `values` from `reference`. */
export function maxDeviation(
  values: readonly number[],
  reference: number,
): number {
  let worst = 0;
  for (const value of values) {
    worst = Math.max(worst, Math.abs(value - reference));
  }
  return worst;
}

/** The last `count` entries of `values` — the late window every settle test reads. */
export function lateWindow(
  values: readonly number[],
  count: number,
): readonly number[] {
  return values.slice(Math.max(0, values.length - count));
}

// ---------------------------------------------------------------------------
// (b) SpringDamper camera follow
// ---------------------------------------------------------------------------

/** Radius of the circle the followed target moves on, in metres. */
export const FOLLOW_RADIUS = 2;

/** Angular rate of that circle, in rad/s (§7a) — a 2.4 s lap at `radius · Ω = 1 m/s`. */
export const FOLLOW_RATE = 2.5;

/** A target node on a circle and a spring-damped follower node. */
export interface FollowRun {
  /** `|follower − target|` in metres after each step, in step order. */
  readonly errors: readonly number[];
  /**
   * The follower's angular position behind the target, in radians, after each
   * step — `atan2` of the follower minus that of the target, wrapped.
   */
  readonly lags: readonly number[];
}

/**
 * Runs the camera-follow scenario: a node driven around a circle by a
 * `SimulationSystem`, and a second node dragged after it by a
 * {@link SpringDamper} stepped with the same fixed delta.
 *
 * Both nodes are `@four/scene` nodes on the application's scene under §42
 * `"manual"` authority (the smoother is the author), and the spring's `out`
 * record **aliases the follower's own position vector**, which the module
 * documents as safe and which is how a real smoother keeps its state.
 */
export async function runCameraFollow(options: {
  spring: SpringDamper;
  steps: number;
  radius?: number;
  rate?: number;
}): Promise<FollowRun> {
  const radius = options.radius ?? FOLLOW_RADIUS;
  const rate = options.rate ?? FOLLOW_RATE;
  const app = new Application({ fixedTimeStep: DT });
  try {
    const target = new Group();
    target.name = "follow-target";
    const follower = new Group();
    follower.name = "follow-camera";
    app.scene.add(target);
    app.scene.add(follower);

    const velocity = new Vector3();
    const out: SpringDamperVector3Result = {
      value: follower.transform.position,
      velocity,
    };
    const errors: number[] = [];
    const lags: number[] = [];
    let step = 0;

    const follow: SimulationSystem = {
      priority: PRIORITY_KINEMATICS,
      initialize(): void {
        // Nothing to set up.
      },
      fixedUpdate(): void {
        step += 1;
        const angle = rate * step * DT;
        target.transform.position.set(
          radius * Math.cos(angle),
          radius * Math.sin(angle),
          0,
        );
        options.spring.updateVector3(
          follower.transform.position,
          target.transform.position,
          velocity,
          DT,
          out,
        );
      },
      dispose(): void {
        // Deliberately empty; the scene outlives the system.
      },
    };
    app.systems.register(follow);
    await app.initialize();
    app.start();

    for (let i = 0; i < options.steps; i += 1) {
      app.step(DT);
      const at = follower.transform.position;
      const to = target.transform.position;
      errors.push(Math.hypot(at.x - to.x, at.y - to.y, at.z - to.z));
      lags.push(wrapToPi(Math.atan2(to.y, to.x) - Math.atan2(at.y, at.x)));
    }
    return { errors, lags };
  } finally {
    app.dispose();
  }
}

/** `angle` wrapped into `[−π, π)`, the same branchless form `wander` uses. */
export function wrapToPi(angle: number): number {
  return angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
}

/** A complex number, for the steady-state gain below. */
export interface Complex {
  /** Real part. */
  readonly re: number;
  /** Imaginary part. */
  readonly im: number;
}

/** `a · b`. */
export function complexMultiply(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

/** `a / b`. */
export function complexDivide(a: Complex, b: Complex): Complex {
  const denominator = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  };
}

/** `|a|`. */
export function complexAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

/**
 * The four state-transition entries of {@link SpringDamper}'s exact
 * discretization, **re-derived here** from the spring's public parameters
 * rather than read out of the class (they are private, and an assertion
 * written against an independent derivation is the point — plan §8's
 * "independently derived closed form").
 *
 * With `ωₙ = angularFrequency`, `ζ = dampingRatio`, `σ = ζωₙ`, `E = e^{−σ·dt}`:
 *
 * ```text
 * ζ < 1  a11 = E(cos ω_d dt + σ sin ω_d dt/ω_d)   a12 = E sin ω_d dt/ω_d
 *        a21 = −E ωₙ² sin ω_d dt/ω_d              a22 = E(cos ω_d dt − σ sin ω_d dt/ω_d)
 * ζ = 1  a11 = E(1 + ωₙ dt)                       a12 = E dt
 *        a21 = −E ωₙ² dt                          a22 = E(1 − ωₙ dt)
 * ```
 *
 * (The overdamped branch is not needed here and is deliberately absent rather
 * than untested.)
 */
export function springTransition(
  spring: SpringDamper,
  deltaSeconds: number,
): readonly [number, number, number, number] {
  const omega = spring.angularFrequency;
  const zeta = spring.dampingRatio;
  const sigma = zeta * omega;
  const decay = Math.exp(-sigma * deltaSeconds);
  if (zeta === 1) {
    return [
      decay * (1 + omega * deltaSeconds),
      decay * deltaSeconds,
      -decay * omega * omega * deltaSeconds,
      decay * (1 - omega * deltaSeconds),
    ];
  }
  if (zeta > 1) {
    throw new RangeError(
      "springTransition covers the underdamped and critical regimes only",
    );
  }
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const cosine = Math.cos(damped * deltaSeconds);
  const sineOverDamped = Math.sin(damped * deltaSeconds) / damped;
  return [
    decay * (cosine + sigma * sineOverDamped),
    decay * sineOverDamped,
    -decay * omega * omega * sineOverDamped,
    decay * (cosine - sigma * sineOverDamped),
  ];
}

/**
 * The **exact** steady-state complex gain from the target's position to the
 * follower's, for a target that advances by `rate · dt` radians of phase per
 * step (see the module note in the suite for the derivation).
 *
 * With the transition entries `a11…a22` and `λ = e^{iΩ·dt}`, the loop
 * {@link runCameraFollow} runs is
 *
 * ```text
 * x_k = a11·x_{k−1} + a12·v_{k−1} + (1 − a11)·T_k
 * v_k = a21·x_{k−1} + a22·v_{k−1} − a21·T_k
 * ```
 *
 * — note `T_k`, the target's *new* position, because the system writes the
 * target before stepping the spring. Substituting `x_k = X λ^k`,
 * `v_k = V λ^k`, `T_k = R λ^k` and eliminating `V` gives
 *
 * ```text
 *        λ·[(1 − a11)(λ − a22) − a12·a21]
 * H(λ) = ───────────────────────────────
 *          (λ − a11)(λ − a22) − a12·a21
 * ```
 */
export function followGain(
  spring: SpringDamper,
  rate: number,
  deltaSeconds: number,
): Complex {
  const [a11, a12, a21, a22] = springTransition(spring, deltaSeconds);
  const phase = rate * deltaSeconds;
  const lambda: Complex = { re: Math.cos(phase), im: Math.sin(phase) };
  const shiftedByA22: Complex = { re: lambda.re - a22, im: lambda.im };
  const shiftedByA11: Complex = { re: lambda.re - a11, im: lambda.im };
  const numerator = complexMultiply(lambda, {
    re: (1 - a11) * shiftedByA22.re - a12 * a21,
    im: (1 - a11) * shiftedByA22.im,
  });
  const denominator = complexMultiply(shiftedByA11, shiftedByA22);
  return complexDivide(numerator, {
    re: denominator.re - a12 * a21,
    im: denominator.im,
  });
}

/**
 * The exact steady-state tracking error in metres: `|H(λ) − 1| · radius`.
 *
 * Both components of a circular target are the same real filter applied to
 * `Re`/`Im` of `R·e^{iΩt}`, so the *vector* error magnitude is constant in time
 * and equals this number — a prediction, not a bound.
 */
export function followTrackingError(
  spring: SpringDamper,
  rate: number,
  deltaSeconds: number,
  radius: number,
): number {
  const gain = followGain(spring, rate, deltaSeconds);
  return complexAbs({ re: gain.re - 1, im: gain.im }) * radius;
}

/** The exact steady-state phase lag in radians: `−arg H(λ)`. */
export function followPhaseLag(
  spring: SpringDamper,
  rate: number,
  deltaSeconds: number,
): number {
  const gain = followGain(spring, rate, deltaSeconds);
  return -Math.atan2(gain.im, gain.re);
}

// ---------------------------------------------------------------------------
// (c) Steering agents in a bounded arena with physics obstacles
// ---------------------------------------------------------------------------

/** Half width of the square arena in metres; agents must stay inside `±` this. */
export const ARENA_HALF = 6;

/** How close to a wall an agent starts fleeing it, in metres. */
export const ARENA_MARGIN = 1.5;

/** Radius of each static obstacle, in metres. */
export const OBSTACLE_RADIUS = 0.8;

/** Where the two static obstacles sit, in world space. */
export const OBSTACLE_CENTRES: readonly Vector3[] = [
  new Vector3(-2.5, 1.5, 0),
  new Vector3(3, -1, 0),
];

/** How far clear of every obstacle surface an agent must start, in metres. */
export const AGENT_START_CLEARANCE = 1;

/** Radius of the §30 `overlapSphere` probe each agent casts, in metres. */
export const AVOID_PROBE_RADIUS = 2.2;

/** How many agents fly in the arena. */
export const AGENT_COUNT = 6;

/** Agent top speed in m/s. */
export const AGENT_MAX_SPEED = 3;

/** Agent acceleration budget in m/s². */
export const AGENT_MAX_ACCELERATION = 8;

/** Radius of the circle the seek goal orbits on, in metres. */
export const GOAL_RADIUS = 5.5;

/** Angular rate of that orbit, in rad/s. */
export const GOAL_RATE = 0.5;

/** Seed of the one random stream in this file (§33). */
export const FLOCK_SEED = 0x5eed_8004;

/** Blend weights of the four behaviours, in the order they are added. */
export const STEERING_WEIGHTS = {
  /** Toward the orbiting goal. */
  seek: 1,
  /** Away from crowding neighbours. */
  separation: 2.5,
  /** Away from the nearest point on any wall inside {@link ARENA_MARGIN}. */
  wall: 6,
  /** Away from any obstacle the §30 probe found. */
  obstacle: 14,
} as const;

/** What {@link runFlock} measured. */
export interface FlockRun {
  /** `world.checksum()` after each fixed step, in step order (§33). */
  readonly checksums: readonly number[];
  /**
   * Every agent's position after every step, flattened as `x, y, z` in agent
   * insertion order — the trace two identical runs must match bit for bit.
   */
  readonly trace: Float64Array;
  /** The largest `|x|` or `|y|` any agent reached, in metres. */
  readonly maxExcursion: number;
  /** The smallest surface clearance to any obstacle, in metres (negative = inside). */
  readonly minObstacleClearance: number;
  /** The largest speed any agent reached, in m/s. */
  readonly maxSpeed: number;
}

/** How {@link runFlock} is run. */
export interface FlockOptions {
  /** Fixed steps to run. */
  steps: number;
  /** Whether to create and integrate the agents at all. Default `true`. */
  steering?: boolean;
  /**
   * Whether the arena-wall term is added. Default `true`; `false` is the
   * control that shows the wall behaviour is what keeps the agents inside.
   */
  walls?: boolean;
  /**
   * Whether the §30 `overlapSphere` obstacle term is added. Default `true`;
   * `false` is the control that shows what the query buys.
   */
  avoid?: boolean;
}

/**
 * Builds the arena world: a floor, two static circular obstacles, and one
 * dynamic ball dropped above the floor so the solver has state that keeps
 * changing for the whole run (a checksum stream that never moves would make the
 * §33 comparison vacuous).
 *
 * Sleeping is **off** (§32) for the same reason: a settled ball that Rapier put
 * to sleep would freeze the checksum.
 */
export async function createArenaWorld(rig: PhysicsRig): Promise<{
  world: PhysicsWorld;
  obstacles: Map<RigidBody, { centre: Vector3; radius: number }>;
}> {
  const world = await createWorld(rig, KIT_2D, {
    sleeping: { enabled: false },
  });
  addSlab(world, KIT_2D, "static", new Vector3(ARENA_HALF, 0.5, 1), {
    name: "arena-floor",
    position: new Vector3(0, -ARENA_HALF - 0.5, 0),
  });
  const obstacles = new Map<RigidBody, { centre: Vector3; radius: number }>();
  for (const [index, centre] of OBSTACLE_CENTRES.entries()) {
    const parts = addBall(world, KIT_2D, "static", OBSTACLE_RADIUS, {
      name: `obstacle-${String(index)}`,
      position: centre,
    });
    obstacles.set(parts.body, { centre, radius: OBSTACLE_RADIUS });
  }
  addBall(world, KIT_2D, "dynamic", 0.3, {
    name: "witness-ball",
    position: new Vector3(0, 4, 0),
    restitution: 0.6,
  });
  return { world, obstacles };
}

/**
 * Runs the arena: `AGENT_COUNT` `SteeringAgent`s integrated by hand every fixed
 * step, beside a Rapier world they only ever *read* (§30 `overlapSphere`).
 *
 * The agents are **not** bodies — that is the point. Nothing about them can
 * reach solver state except through a query, so a checksum stream that differs
 * from a run with no agents at all would be a query mutating the world.
 *
 * Behaviour order is fixed and neighbour iteration is insertion-ordered (plan
 * P8-3), so the whole run is a pure function of `FLOCK_SEED` and the step count.
 */
export async function runFlock(options: FlockOptions): Promise<FlockRun> {
  const steering = options.steering !== false;
  const rig = await createRig();
  try {
    const { world, obstacles } = await createArenaWorld(rig);

    const random = new SeededRandom(FLOCK_SEED);
    const agents: SteeringAgent[] = [];
    if (steering) {
      const start = new Vector3();
      for (let index = 0; index < AGENT_COUNT; index += 1) {
        // Rejection sampling from the same stream: an agent that *started*
        // inside an obstacle would make the clearance measurement a statement
        // about this file's placement rather than about the avoidance
        // behaviour (measured, WP-8.4: the unfiltered draw put one agent
        // 0.35 m inside an obstacle at step 0 and that placement, not any
        // trajectory, was the reported minimum). The loop is bounded and
        // consumes a deterministic number of draws, so §33 is untouched.
        do {
          start.set(random.nextRange(-4, 4), random.nextRange(-4, 4), 0);
        } while (!clearsObstacles(start));
        agents.push(
          new SteeringAgent({
            position: start,
            velocity: new Vector3(
              random.nextRange(-1, 1),
              random.nextRange(-1, 1),
              0,
            ),
            maxSpeed: AGENT_MAX_SPEED,
            maxAcceleration: AGENT_MAX_ACCELERATION,
          }),
        );
      }
    }

    const goal = new Vector3();
    const wallPoint = new Vector3();
    const scratch = new Vector3();
    const steer = new Vector3();
    const neighbours: SteeringNeighbor[] = [];
    const checksums: number[] = [];
    const trace = new Float64Array(options.steps * agents.length * 3);
    let maxExcursion = 0;
    let minObstacleClearance = Number.POSITIVE_INFINITY;
    let maxSpeed = 0;
    let cursor = 0;

    for (let step = 1; step <= options.steps; step += 1) {
      const time = step * DT;
      goal.set(
        GOAL_RADIUS * Math.cos(GOAL_RATE * time),
        GOAL_RADIUS * Math.sin(GOAL_RATE * time),
        0,
      );

      for (const agent of agents) {
        agent.beginSteering();
        agent.addSteering(seek(agent, goal, scratch), STEERING_WEIGHTS.seek);

        neighbours.length = 0;
        for (const other of agents) {
          if (other !== agent) {
            neighbours.push(other);
          }
        }
        agent.addSteering(
          separation(agent, neighbours, scratch),
          STEERING_WEIGHTS.separation,
        );

        if (options.walls !== false) {
          addWallSteering(agent, wallPoint, scratch);
        }

        for (const hit of options.avoid === false
          ? []
          : world.overlapSphere(agent.position, AVOID_PROBE_RADIUS)) {
          const obstacle = obstacles.get(hit.body);
          if (obstacle === undefined) {
            continue;
          }
          agent.addSteering(
            flee(agent, obstacle.centre, scratch),
            STEERING_WEIGHTS.obstacle,
          );
        }

        agent.endSteering(steer);
        agent.integrate(DT, steer);
      }

      rig.app.step(DT);
      checksums.push(world.checksum());

      for (const agent of agents) {
        const { x, y, z } = agent.position;
        trace[cursor] = x;
        trace[cursor + 1] = y;
        trace[cursor + 2] = z;
        cursor += 3;
        maxExcursion = Math.max(maxExcursion, Math.abs(x), Math.abs(y));
        maxSpeed = Math.max(maxSpeed, agent.velocity.length());
        for (const obstacle of obstacles.values()) {
          minObstacleClearance = Math.min(
            minObstacleClearance,
            Math.hypot(x - obstacle.centre.x, y - obstacle.centre.y) -
              obstacle.radius,
          );
        }
      }
    }

    return {
      checksums,
      trace,
      maxExcursion,
      minObstacleClearance,
      maxSpeed,
    };
  } finally {
    rig.dispose();
  }
}

/** Whether `at` is at least {@link AGENT_START_CLEARANCE} clear of every obstacle. */
function clearsObstacles(at: Vector3): boolean {
  for (const centre of OBSTACLE_CENTRES) {
    if (
      Math.hypot(at.x - centre.x, at.y - centre.y) <
      OBSTACLE_RADIUS + AGENT_START_CLEARANCE
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Adds the arena-wall term: for each of the four walls the agent is within
 * {@link ARENA_MARGIN} of, a {@link flee} from the closest point on that wall.
 *
 * Fleeing the *closest point* rather than the wall's centre keeps the repulsion
 * normal to the wall, so an agent running parallel to one is not turned along
 * it; at a corner both terms add, which is what turns an agent out of it.
 */
function addWallSteering(
  agent: SteeringAgent,
  wallPoint: Vector3,
  scratch: Vector3,
): void {
  const { x, y } = agent.position;
  if (x > ARENA_HALF - ARENA_MARGIN) {
    wallPoint.set(ARENA_HALF, y, 0);
    agent.addSteering(flee(agent, wallPoint, scratch), STEERING_WEIGHTS.wall);
  }
  if (x < -(ARENA_HALF - ARENA_MARGIN)) {
    wallPoint.set(-ARENA_HALF, y, 0);
    agent.addSteering(flee(agent, wallPoint, scratch), STEERING_WEIGHTS.wall);
  }
  if (y > ARENA_HALF - ARENA_MARGIN) {
    wallPoint.set(x, ARENA_HALF, 0);
    agent.addSteering(flee(agent, wallPoint, scratch), STEERING_WEIGHTS.wall);
  }
  if (y < -(ARENA_HALF - ARENA_MARGIN)) {
    wallPoint.set(x, -ARENA_HALF, 0);
    agent.addSteering(flee(agent, wallPoint, scratch), STEERING_WEIGHTS.wall);
  }
}

/** The number of entries `a` and `b` disagree on, by `Object.is` (§33). */
export function countDifferences(
  a: Float64Array | readonly number[],
  b: Float64Array | readonly number[],
): number {
  if (a.length !== b.length) {
    return Math.max(a.length, b.length);
  }
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) {
      differences += 1;
    }
  }
  return differences;
}

// ---------------------------------------------------------------------------
// (d) Ballistic interception of a constant-velocity kinematic target
// ---------------------------------------------------------------------------

/** Where the shot is fired from, in world space. */
export const SHOOTER = new Vector3(0, 0, 0);

/** Where the kinematic target starts, in world space. */
export const TARGET_START = new Vector3(12, 6, 0);

/** The target's constant velocity in m/s — closing on the shooter along −X. */
export const TARGET_VELOCITY = new Vector3(-2, 0, 0);

/** Fixed steps to the rendezvous: `INTERCEPT_STEPS · DT = 0.8 s` exactly. */
export const INTERCEPT_STEPS = 48;

/** Rendezvous time in seconds — a whole number of fixed steps by construction. */
export const INTERCEPT_TIME = INTERCEPT_STEPS * DT;

/**
 * The straight-line projectile speed that makes {@link INTERCEPT_TIME} the
 * interception time, in m/s.
 *
 * Constructed backwards on purpose: the suite then asks `interceptTime` to
 * recover `INTERCEPT_TIME` from it, which tests the closed form against a
 * solution built independently of it, and it puts the rendezvous exactly on a
 * fixed-step boundary so the discrete free-fall closed form
 * ({@link fallDistance}) applies without interpolation.
 */
export const PROJECTILE_SPEED =
  Math.hypot(
    TARGET_START.x + TARGET_VELOCITY.x * INTERCEPT_TIME - SHOOTER.x,
    TARGET_START.y + TARGET_VELOCITY.y * INTERCEPT_TIME - SHOOTER.y,
  ) / INTERCEPT_TIME;

/** How the shot compensates for gravity. */
export type GravityCompensation = "substepped" | "continuous";

/** What {@link runInterception} measured. */
export interface InterceptionRun {
  /** The aim point `interceptPoint` returned, in world space. */
  readonly aimPoint: Vector3;
  /** The interception time `interceptTime` returned, in seconds. */
  readonly time: number;
  /** The launch velocity the shot was fired with, in m/s. */
  readonly launch: Vector3;
  /** `|projectile − target|` in metres after each step, in step order. */
  readonly distances: readonly number[];
  /** Projectile position at {@link INTERCEPT_STEPS}, in world space. */
  readonly arrival: Vector3;
  /** Target position at {@link INTERCEPT_STEPS}, in world space. */
  readonly rendezvous: Vector3;
}

/**
 * Fires a real Rapier projectile at `interceptPoint`'s answer and records how
 * close it gets to a kinematic target moving at a constant velocity.
 *
 * Both bodies carry **sensor** colliders (§24): a sensor exerts no force, so
 * the two can pass through one another and the measurement is of two
 * trajectories rather than of a collision response. The projectile is the only
 * body gravity acts on.
 *
 * ## The two compensations
 *
 * `interceptPoint` solves the *straight-line* lead problem (its own
 * documentation says gravity is not modelled), so a ballistic shot has to add
 * the drop back. `"continuous"` adds the textbook `½·g·t²`; `"substepped"` adds
 * Rapier's own {@link fallDistance}, which is `g·h²·K(K+1)/2` over
 * `K = steps · SUBSTEPS` substeps of `h = DT/SUBSTEPS` (WP-5.4). The two differ
 * by exactly `g·h·t/2`, and the suite measures that difference as the miss.
 */
export async function runInterception(
  compensation: GravityCompensation,
): Promise<InterceptionRun> {
  const rig = await createRig();
  try {
    const world = await createWorld(rig, KIT_2D, {
      sleeping: { enabled: false },
    });

    const time = interceptTime(
      SHOOTER,
      PROJECTILE_SPEED,
      TARGET_START,
      TARGET_VELOCITY,
    );
    const aimPoint = interceptPoint(
      SHOOTER,
      PROJECTILE_SPEED,
      TARGET_START,
      TARGET_VELOCITY,
    );
    if (aimPoint === null) {
      throw new Error("the intercept scenario has no solution");
    }

    const drop =
      compensation === "substepped"
        ? fallDistance(INTERCEPT_STEPS)
        : 0.5 * GRAVITY_Y * INTERCEPT_TIME * INTERCEPT_TIME;
    const launch = new Vector3(
      (aimPoint.x - SHOOTER.x) / INTERCEPT_TIME,
      (aimPoint.y - SHOOTER.y - drop) / INTERCEPT_TIME,
      0,
    );

    // The launch velocity is **authored on the descriptor**, not written onto
    // the component after registration: `RigidBody.linearVelocity` is authored
    // state going in and solved state coming back (§23), and a write after
    // `addBody` reaches no solver — measured, WP-8.4: the shot stayed at the
    // muzzle and fell straight down.
    const projectileNode = new Group();
    projectileNode.name = "projectile";
    projectileNode.transform.position.copy(SHOOTER);
    projectileNode.transformAuthority = "physics";
    const projectileBody = new RigidBody({
      type: "dynamic",
      linearVelocity: launch,
    });
    projectileNode.addComponent(projectileBody);
    projectileNode.addComponent(
      new Collider({ shape: KIT_2D.ball(0.05), sensor: true }),
    );
    world.addBody(projectileNode);

    const targetNode = new Group();
    targetNode.name = "intercept-target";
    targetNode.transform.position.copy(TARGET_START);
    const targetBody = new RigidBody({ type: "kinematic-position" });
    targetNode.addComponent(targetBody);
    targetNode.addComponent(
      new Collider({ shape: KIT_2D.ball(0.2), sensor: true }),
    );
    world.addBody(targetNode);

    let step = 0;
    const driver: SimulationSystem = {
      priority: PRIORITY_KINEMATICS,
      initialize(): void {
        // Nothing to set up.
      },
      fixedUpdate(): void {
        step += 1;
        const at = step * DT;
        targetNode.transform.position.set(
          TARGET_START.x + TARGET_VELOCITY.x * at,
          TARGET_START.y + TARGET_VELOCITY.y * at,
          0,
        );
      },
      dispose(): void {
        // Deliberately empty.
      },
    };
    rig.app.systems.register(driver);

    const distances: number[] = [];
    const arrival = new Vector3();
    const rendezvous = new Vector3();
    for (let i = 1; i <= INTERCEPT_STEPS + 6; i += 1) {
      rig.app.step(DT);
      const shot = projectileNode.transform.position;
      const mark = targetNode.transform.position;
      distances.push(
        Math.hypot(shot.x - mark.x, shot.y - mark.y, shot.z - mark.z),
      );
      if (i === INTERCEPT_STEPS) {
        arrival.copy(shot);
        rendezvous.copy(mark);
      }
    }

    return {
      aimPoint: aimPoint.clone(),
      time,
      launch,
      distances,
      arrival,
      rendezvous,
    };
  } finally {
    rig.dispose();
  }
}

/**
 * The closest approach of two point trajectories sampled at `DT`, in metres,
 * refined **inside** the closest sampling interval.
 *
 * Sampling at 60 Hz can only see the smallest sampled distance, which for two
 * bodies passing at a relative speed `u` overstates the true miss by up to
 * `u·DT/2`. Between two samples the relative displacement is linear to first
 * order, so the minimum of `|d₀ + τ(d₁ − d₀)|` over `τ ∈ [0, 1]` recovers it up
 * to the curvature term — here `⅛·g·DT²`, since the only relative acceleration
 * is gravity.
 *
 * The vectors are not available per step, only the distances, so the refinement
 * is done on the scalar sequence: for three consecutive samples straddling the
 * minimum, the parabola through them has its vertex at the refined distance.
 * That is exact for a quadratic distance profile and is what a near-miss looks
 * like locally.
 */
export function closestApproach(distances: readonly number[]): number {
  let index = 0;
  for (let i = 1; i < distances.length; i += 1) {
    if (distances[i] < distances[index]) {
      index = i;
    }
  }
  if (index === 0 || index === distances.length - 1) {
    return distances[index];
  }
  const before = distances[index - 1];
  const at = distances[index];
  const after = distances[index + 1];
  const curvature = before - 2 * at + after;
  if (curvature <= 0) {
    return at;
  }
  const offset = (0.5 * (before - after)) / curvature;
  return at - 0.25 * (before - after) * offset;
}

/** The substep bias of Rapier's integrator over `steps` fixed steps, in metres. */
export function substepBias(steps: number): number {
  const time = steps * DT;
  return Math.abs(fallDistance(steps) - 0.5 * GRAVITY_Y * time * time);
}

// ---------------------------------------------------------------------------
// (e) Two-bone IK driving PoseTargets on a blended chain
// ---------------------------------------------------------------------------

/** World position of the chain's root (the shoulder), in metres. */
export const IK_ROOT = new Vector3(0, 3, 0);

/** Length of the upper bone, in metres. */
export const IK_UPPER_LENGTH = 1;

/** Length of the lower bone, in metres. */
export const IK_LOWER_LENGTH = 0.8;

/** Centre of the circle the IK target travels on, in world space. */
export const IK_TARGET_CENTRE = new Vector3(1.1, 3, 0);

/** Radius of that circle in metres — reach stays inside `[0.2, 1.8]`. */
export const IK_TARGET_RADIUS = 0.45;

/** Angular rate of that circle, in rad/s. */
export const IK_TARGET_RATE = 1;

/** Where the elbow is asked to bend towards, in world space. */
export const IK_POLE_HINT = new Vector3(0, 5, 0);

/**
 * §19's two weights for both links, as `[animationWeight, physicsWeight]`.
 *
 * The default is animation-dominant but **not** an extreme: at `1 / 0` the
 * publish is bit-identical to the target alone (MEMORY 2026-08-02), which would
 * make the case a test of this file's own arithmetic. At `0.9 / 0.1` the
 * published pose is a real `lerp(solver, target, 0.9)` — and because a
 * `"kinematic-position"` body is *fed* the same target unweighted, the solver's
 * contribution differs from the target only by Rapier's f32 round trip, which
 * is exactly what the suite measures and scales.
 */
export const IK_WEIGHTS: readonly [number, number] = [0.9, 0.1];

/** Half thickness of a link's collider, in metres. */
export const IK_LINK_HALF_THICKNESS = 0.05;

/** What {@link runTwoBoneIK} measured. */
export interface TwoBoneIKRun {
  /** `|tip − target|` in metres after each step, in step order. */
  readonly tipErrors: readonly number[];
  /** `|elbow_lower − elbow_upper|` in metres after each step: the chain's gap. */
  readonly elbowGaps: readonly number[];
  /** Distance the tip moved between consecutive steps, in metres (§110). */
  readonly tipSteps: readonly number[];
  /** Whether every solve reported the target reachable. */
  readonly alwaysReachable: boolean;
  /** The witness body's Y position after the run, in metres. */
  readonly witnessY: number;
  /** Fixed steps run. */
  readonly steps: number;
}

/**
 * Runs the IK scenario: `solveTwoBoneIK` writes the two links' `PoseTarget`s
 * once per fixed step, §19's pipeline publishes the blend onto the nodes, and
 * the suite measures where the chain's tip actually ended up.
 *
 * ## The rig
 *
 * Each link's **node origin sits at its proximal joint** and its collider is
 * offset half a bone length along local +X, the same trick WP-7.5's door uses:
 * posing a bone is then a pure rotation about its own origin, so the pose the
 * IK computes satisfies the elbow constraint exactly at every angle and no
 * tolerance is spent on the rig.
 *
 * Both links are `"kinematic-position"` under §42 `"blended"` authority with
 * {@link IK_WEIGHTS}, so the published pose is a genuine
 * blend of a solver pose and the IK target rather than either alone — and the
 * solver pose is itself driven to the target by §19's unweighted kinematic feed,
 * which is why the two agree to solver precision.
 *
 * The elbow is a registered §28 `HingeJoint`, and it is stated plainly that
 * **it constrains nothing here**: both links are kinematic, and a Rapier joint
 * between two non-dynamic bodies has no dynamic body to correct. It is in the
 * rig because a posed chain in an application would carry one — the Phase 6
 * surface has to coexist with §19's — and because the elbow gap the suite
 * measures would be the joint's job the moment either link went dynamic. What
 * keeps this chain assembled is the IK solution's own consistency.
 *
 * A free-falling witness ball shares the world so "physics stays live" is a
 * measurement (its drop is checked against {@link fallDistance}) rather than an
 * assertion about a world that might have been idle.
 */
export async function runTwoBoneIK(
  steps: number,
  weights: readonly [number, number] = IK_WEIGHTS,
): Promise<TwoBoneIKRun> {
  const rig = await createBlendRig();
  const { app } = rig;
  try {
    const world = await createBlendWorld(rig, KIT_2D);

    const upper = addLink(world, "ik-upper", IK_UPPER_LENGTH, IK_ROOT, weights);
    const lower = addLink(
      world,
      "ik-lower",
      IK_LOWER_LENGTH,
      new Vector3(IK_ROOT.x + IK_UPPER_LENGTH, IK_ROOT.y, IK_ROOT.z),
      weights,
    );
    const elbow = new HingeJoint({
      bodyA: upper.body,
      bodyB: lower.body,
      anchor: new Vector3(IK_ROOT.x + IK_UPPER_LENGTH, IK_ROOT.y, IK_ROOT.z),
      axis: new Vector3(0, 0, 1),
    });
    world.addJoint(elbow);

    const witness = addBall(world, KIT_2D, "dynamic", 0.2, {
      name: "ik-witness",
      position: new Vector3(4, 3, 0),
    });

    const target = new Vector3();
    const solution: TwoBoneIKSolution = createTwoBoneIKSolution();
    let reachable = true;
    let step = 0;

    const ik: SimulationSystem = {
      priority: PRIORITY_ANIMATION_TARGETS,
      initialize(): void {
        // Nothing to set up.
      },
      fixedUpdate(): void {
        step += 1;
        const angle = IK_TARGET_RATE * step * DT;
        target.set(
          IK_TARGET_CENTRE.x + IK_TARGET_RADIUS * Math.cos(angle),
          IK_TARGET_CENTRE.y + IK_TARGET_RADIUS * Math.sin(angle),
          0,
        );
        solveTwoBoneIK(
          IK_ROOT,
          target,
          IK_UPPER_LENGTH,
          IK_LOWER_LENGTH,
          IK_POLE_HINT,
          solution,
        );
        reachable = reachable && solution.reachable;
        poseLink(upper.target, IK_ROOT, solution.joint);
        poseLink(lower.target, solution.joint, solution.end);
      },
      dispose(): void {
        // Deliberately empty.
      },
    };
    app.systems.register(ik);

    const tipErrors: number[] = [];
    const elbowGaps: number[] = [];
    const tipSteps: number[] = [];
    const tip = new Vector3();
    const elbowFromUpper = new Vector3();
    const previousTip = new Vector3();
    let hasPrevious = false;

    for (let i = 0; i < steps; i += 1) {
      app.step(DT);
      boneEnd(lower.node, IK_LOWER_LENGTH, tip);
      boneEnd(upper.node, IK_UPPER_LENGTH, elbowFromUpper);
      const at = lower.node.transform.position;
      tipErrors.push(
        Math.hypot(tip.x - target.x, tip.y - target.y, tip.z - target.z),
      );
      elbowGaps.push(
        Math.hypot(
          at.x - elbowFromUpper.x,
          at.y - elbowFromUpper.y,
          at.z - elbowFromUpper.z,
        ),
      );
      if (hasPrevious) {
        tipSteps.push(
          Math.hypot(
            tip.x - previousTip.x,
            tip.y - previousTip.y,
            tip.z - previousTip.z,
          ),
        );
      }
      previousTip.copy(tip);
      hasPrevious = true;
    }

    return {
      tipErrors,
      elbowGaps,
      tipSteps,
      alwaysReachable: reachable,
      witnessY: witness.node.transform.position.y,
      steps,
    };
  } finally {
    rig.dispose();
  }
}

/** One posed bone: the node, its body, and the `PoseTarget` IK writes. */
interface LinkParts {
  readonly node: Node;
  readonly body: RigidBody;
  readonly target: PoseTarget;
}

/** Adds one blended bone whose origin is its proximal joint (see the run note). */
function addLink(
  world: PhysicsWorld,
  name: string,
  length: number,
  origin: Vector3,
  weights: readonly [number, number],
): LinkParts {
  const node = new Group();
  node.name = name;
  node.transform.position.copy(origin);
  node.transformAuthority = "blended";

  const body = new RigidBody({ type: "kinematic-position" });
  body.animationWeight = weights[0];
  body.physicsWeight = weights[1];
  node.addComponent(body);

  const collider = new Collider({
    shape: KIT_2D.slab(
      length / 2,
      IK_LINK_HALF_THICKNESS,
      IK_LINK_HALF_THICKNESS,
    ),
  });
  collider.offset.position.set(length / 2, 0, 0);
  node.addComponent(collider);

  const target = node.addComponent(new PoseTarget()).copyFrom(node.transform);
  world.addBody(node);
  return { node, body, target };
}

/** Scratch for {@link poseLink} and {@link boneEnd} — allocation-free (plan D7). */
const BONE_ROTATION = new Quaternion();

const BONE_AXIS = new Vector3(0, 0, 1);

const BONE_OFFSET = new Vector3();

/** Points a bone's `PoseTarget` from `from` towards `to`, about +Z (§21). */
function poseLink(target: PoseTarget, from: Vector3, to: Vector3): void {
  target.position.copy(from);
  target.rotation.setFromAxisAngle(
    BONE_AXIS,
    Math.atan2(to.y - from.y, to.x - from.x),
  );
}

/** The distal end of a posed bone in world space: `position + R·(length, 0, 0)`. */
function boneEnd(node: Node, length: number, out: Vector3): Vector3 {
  BONE_ROTATION.copy(node.transform.rotation);
  BONE_OFFSET.set(length, 0, 0);
  BONE_ROTATION.rotateVector3(BONE_OFFSET, out);
  return out.add(node.transform.position);
}
