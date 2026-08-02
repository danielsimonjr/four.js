/**
 * The Phase 6 exit scenario (§28 joints, §33 determinism, plan WP-6.6) — one
 * headless run of **two** solver worlds, a `"2d"` Rapier world and a `"3d"`
 * Rapier world, tracked on **one** `PhysicsSystem` inside **one**
 * `Application`, stepped 600 times (10 s at 1/60) and reduced to per-step
 * checksums plus the readable facts a hash cannot diagnose.
 *
 * §109's exit criterion is that constraints *"remain stable under expected
 * real-time loads"*. `examples/mechanism` is that claim's visible half and
 * `tests/browser/mechanism.spec.ts` measures it in a real browser; this module
 * is the **determinism** half, and it is deliberately the same *kind* of
 * evidence as `phase5-scenario.ts`: build an {@link Application} (scene +
 * fixed-step scheduler + §39 system registry; nothing renderer-shaped is
 * constructed or consulted, and no canvas or DOM is touched), register a
 * `PhysicsSystem` (§39 step 6), drive 600 clean frames, and checksum both
 * worlds after every one.
 *
 * ## What the two halves are, and why
 *
 * Unlike phase 5's two halves — the same scene built twice, once per dimension
 * — the two halves here are **different mechanisms**, because §28's joint set
 * is not the same in a plane and in a volume: a spherical joint exists only in
 * `"3d"` (plan P6-1), and a closed slider–crank loop is the planar arrangement
 * §109 names part for part. So the two worlds' checksums differ from step 1,
 * and that is the intended shape of this golden, not a defect.
 *
 * | half | what is in it | § |
 * | ---- | ------------- | - |
 * | `"2d"` | the `examples/mechanism` slider–crank: a motorised {@link HingeJoint} shaft, two more hinges (crank pin, wrist pin), a limited {@link SliderJoint}, a {@link SpringJoint} to a static post — plus an independent {@link RopeJoint} load | §28, §109 |
 * | `"3d"` | a motorised shaft hinged about **+Y** (an axis a `"2d"` world does not have), a {@link SphericalJoint} pendulum pushed out of the XY plane, and a limited, motorised {@link SliderJoint} carriage pulling on a {@link SpringJoint} | §21, §28 |
 *
 * The 2D half's geometry is the *example's* geometry, number for number
 * (`SHAFT_X`, `CRANK_RADIUS`, `ROD_LENGTH`, the derived carriage stroke, the
 * spring's rest length), so a divergence here and a divergence on the built
 * page are divergences of the same mechanism. It is **restated, not imported**:
 * the example is a page with a renderer and a DOM, and this file must stay
 * headless (see "Self-contained on purpose" below).
 *
 * ## Nothing in either world touches anything (deliberate)
 *
 * Every static body is a `RigidBody` with **no** `Collider` — §23 permits it,
 * and a joint's fixed side is a body rather than a point — and the dynamic
 * bodies are either jointed to each other (§28 disables collision between a
 * jointed pair by default) or too far apart to meet. So every number in this
 * scenario is a **constraint's**, never a contact's, which is the discipline
 * `tests/integration/helpers/joint-scenarios.ts` and `examples/mechanism` both
 * keep. The §29 tallies in the golden are the *measurement* of that claim:
 * they are recorded, not assumed, and a future edit that lets two bodies touch
 * will show up as a number rather than as an unexplained digest change.
 *
 * §32 sleeping is **off** in both worlds for the reason WP-6.2/6.3/6.4 all
 * found: Rapier puts a slowly coasting mechanism to sleep, and a body asleep
 * when the motor is re-engaged would never restart — which would make the
 * scripted schedule below measure nothing.
 *
 * ## The scripted schedule (§28 live reconfiguration)
 *
 * Five things happen at fixed step indices, all of them pure functions of the
 * step number, none of them reading a clock or an RNG (§33):
 *
 * | step | what | § |
 * | ---- | ---- | - |
 * | {@link IMPULSE_STEP} | a 1 N·s push along +Z on the 3D spherical bob, so it swings out of the plane a hinge is confined to | §26, §28 |
 * | {@link RETARGET_STEP} | `setMotor` on both shafts (faster) and on the 3D slider (**reversed**) | §28 |
 * | {@link LIMITS_STEP} | `setLimits` on both sliders: the 2D one widened, the 3D one tightened to inside the carriage's current travel | §28 |
 * | {@link MOTOR_OFF_STEP} | `enableMotor(false)` on both shafts — the mechanisms coast (WP-6.2-fix1: releasing is not braking) | §28 |
 * | {@link KICK_STEP} | a small angular impulse on the released 3D shaft, which a released motor lets stand and a live one would erase | §26, §28 |
 * | {@link MOTOR_ON_STEP} | `enableMotor(true)` on both shafts | §28 |
 * | {@link REMOVE_STEP} | `removeJoint` — the 2D rope (its load falls free) and the 3D spring | §28, §83 |
 *
 * Each is applied *before* `application.step`, so it reaches the solver through
 * the §28 command queue that `PhysicsWorld` drains at the top of that same
 * fixed step — the same commands-not-mutations rule §26 imposes on forces.
 *
 * ## What the golden pins beyond four hashes
 *
 * A hash says "something changed" and nothing else. So the golden also carries,
 * as ordinary readable numbers: the **joint counts before and after** the
 * removal, per world; the **travel extrema** of both carriages, quantized to
 * 1e-6 (the same resolution §33's checksum uses) — the limit-switch-style
 * measurement §109's "limit switches" asks for; the **limit-switch hit counts**
 * a sampled switch produces, exactly as `examples/mechanism` samples them; the
 * shafts' **angular velocity at three probes** (driven, coasting, re-driven),
 * which is where the motor schedule becomes visible; and the §29 tallies. When
 * this file goes red, those numbers say *what* moved before anyone opens a
 * debugger.
 *
 * Every quantized value in the summary is an **integer count of 1e-6 units** —
 * micrometres for a position, micro-radians per second for a rate — so the
 * golden holds exact integers rather than a float's tail.
 *
 * ## The digest is §33's own checksum, not a re-derivation
 *
 * `PhysicsWorld.checksum()` *is* §33's definition — FNV-1a over every body's
 * transform and velocities, quantized to 1e-6, in ascending body id. This file
 * does not re-hash body state; it takes that uint32 from each world after every
 * fixed step and combines the pair with the same D6 hasher
 * (`@four/diagnostics`'s `createChecksum`) that phases 1, 2, 4 and 5 use, in the
 * fixed order **2D then 3D**. The two raw sequences are published alongside it
 * ({@link Phase6ScenarioResult.checksums2d},
 * {@link Phase6ScenarioResult.checksums3d}) so a divergence can be localised to
 * a world as well as to a step.
 *
 * ## Clean frames, on purpose (as in WP-2.7, WP-4.8 and WP-5.8)
 *
 * Every injected frame is exactly {@link FIXED_TIME_STEP} seconds, so the §10
 * accumulator runs exactly one fixed step per frame, drops nothing, and leaves
 * `interpolationAlpha` at 0. Both facts are published.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * Identical to WP-1.14/WP-2.7/WP-4.8/WP-5.8: the determinism gate (plan §8)
 * demands the same scenario run twice in-process **and** once in a fresh `node`
 * child process, and those runs are only evidence if they execute the same
 * code. So one file is loaded by Vitest (through Vite) and by plain `node`
 * (through its default type-stripping, Node ≥ 22.18; this repo pins Node ≥ 20
 * and runs 22.22). The constraint that imposes: **this file must stay within
 * Node's erasable-syntax subset** — type annotations, `interface`, `type` and
 * `import type` are fine; `enum`, `namespace`, constructor parameter
 * properties, and decorators are not.
 *
 * As in phase 5, **wasm** adds one wrinkle: both Rapier builds load their
 * WebAssembly image asynchronously, so {@link runPhase6Scenario} is `async` and
 * every world is `await world.initialize()`-ed before a single step is taken.
 * The child runner in `../phase6-joints.test.ts` awaits the returned promise for
 * the same reason. (Rapier's loader writes one "using deprecated parameters"
 * notice per dimension to **stderr**; the child's stdout stays a single clean
 * JSON object.)
 *
 * ## Self-contained on purpose (the WP-5.8 decision, restated)
 *
 * `tests/integration/helpers/joint-scenarios.ts` (WP-6.4) has the same builder
 * *patterns* and this file mirrors them, and `examples/mechanism/main.ts` has
 * the 2D half's geometry — but neither is imported. A golden is only evidence
 * if the code that produced it is pinned: importing a sibling packet's helper
 * would let an unrelated edit to the integration rig silently change what the
 * golden means, and importing the example would drag a renderer and a DOM into
 * a headless run.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target — see the golden's `_tier`
 * field. Rapier is compiled WebAssembly, so its arithmetic is fixed by the wasm
 * image and does not vary with the host JS engine's `Math`; what is *not*
 * claimed is cross-platform determinism, because the values still cross the
 * JS/wasm boundary as f64 → f32 conversions in this build, the wasm image is
 * pinned per platform by the package manager, and §33's `cross-platform` tier
 * requires evidence this suite does not gather.
 */

import { createChecksum } from "@four/diagnostics";
import { Vector2, Vector3 } from "@four/math";
import {
  Collider,
  HingeJoint,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  RopeJoint,
  SliderJoint,
  SphericalJoint,
  SpringJoint,
  type CollisionShape,
} from "@four/physics";
import { Rapier2dAdapter, Rapier3dAdapter } from "@four/physics-rapier";
import { Group, type Node } from "@four/scene";
import { Application } from "four/application";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long — 10 s. */
export const STEP_COUNT = 600;

// ---------------------------------------------------------------------------
// The scripted schedule (see the module header's table)
// ---------------------------------------------------------------------------

/** 1-based fixed step whose frame pushes the 3D bob out of the XY plane (§26). */
export const IMPULSE_STEP = 1;

/** …whose frame retargets both shaft motors and reverses the 3D slider (§28). */
export const RETARGET_STEP = 120;

/** …whose frame changes both sliders' §28 limits. */
export const LIMITS_STEP = 220;

/** …whose frame releases both shaft motors: the mechanisms coast (§28). */
export const MOTOR_OFF_STEP = 300;

/** …whose frame re-engages them. */
export const MOTOR_ON_STEP = 400;

/** …whose frame kicks the released 3D shaft (§26; see {@link SHAFT_KICK}). */
export const KICK_STEP = 340;

/** …whose frame removes one joint from each world (§28, §83). */
export const REMOVE_STEP = 500;

/** Where the shafts' rate is probed while driven, coasting, and driven again. */
export const SPIN_PROBE_DRIVEN = 280;
export const SPIN_PROBE_COASTING = 380;
export const SPIN_PROBE_REDRIVEN = 480;

/** The §26 push that takes the 3D spherical bob out of the plane, in N·s. */
export const BOB_IMPULSE_Z = 1;

/**
 * The §26 angular impulse applied to the **released** 3D shaft at
 * {@link KICK_STEP}, in N·m·s about +Y.
 *
 * It is what makes `enableMotor(false)` measurable on that shaft at all: the 3D
 * shaft is balanced about its hinge and carries no load, so a released motor
 * leaves it turning at exactly the rate it had, and a probe of that rate cannot
 * tell "released" from "still driving". A kick can: a released shaft *keeps*
 * what the kick gave it (WP-6.2-fix1's inert gain is bit-identical to a joint
 * that never had a motor), and a driven one is pulled back to its target inside
 * a step. The golden records both readings.
 *
 * 0.001 N·m·s against the bar's ≈ 4.33e-4 kg·m² about +Y is ≈ +2.3 rad/s —
 * far outside any solver residual and far short of anything violent.
 */
export const SHAFT_KICK = 0.001;

// ---------------------------------------------------------------------------
// The 2D half: the `examples/mechanism` slider–crank, restated (§109)
// ---------------------------------------------------------------------------

/** Where the driven shaft is pinned; every other 2D coordinate derives from it. */
export const SHAFT_X = -5.4;
export const SHAFT_Y = 0.6;

/** Distance from the shaft's centre to the crank pin — the half-stroke, in m. */
export const CRANK_RADIUS = 0.85;

/** The crank bar's half extents: centred on the shaft, so gravity exerts no torque. */
export const CRANK_HALF_LENGTH = 1;
export const CRANK_HALF_THICKNESS = 0.11;

/** Distance between the crank pin and the wrist pin, and the rod's half thickness. */
export const ROD_LENGTH = 2.4;
export const ROD_HALF_THICKNESS = 0.075;

/** The reciprocating carriage, a square block on the rail. */
export const CARRIAGE_HALF_EXTENT = 0.26;

/**
 * The crank angle the mechanism is assembled at (§7b): 90°, **not** 0°, where
 * the crank and rod would be collinear (dead centre) — the example's choice and
 * its reason, unchanged.
 */
export const START_ANGLE = Math.PI / 2;

/** The crank pin's world position at {@link START_ANGLE}. */
export const PIN_X = SHAFT_X + CRANK_RADIUS * Math.cos(START_ANGLE);
export const PIN_Y = SHAFT_Y + CRANK_RADIUS * Math.sin(START_ANGLE);

/**
 * The carriage's world X at {@link START_ANGLE}: the point on the rail (which
 * runs at {@link SHAFT_Y}) exactly {@link ROD_LENGTH} from the crank pin. A rod
 * whose ends do not reach its two pins is a joint that starts violated.
 */
export const CARRIAGE_START_X =
  PIN_X + Math.sqrt(ROD_LENGTH * ROD_LENGTH - (PIN_Y - SHAFT_Y) ** 2);

/** The rod spans pin to pin, so its pose is the midpoint and the pin-to-pin angle. */
export const ROD_CENTER_X = (PIN_X + CARRIAGE_START_X) / 2;
export const ROD_CENTER_Y = (PIN_Y + SHAFT_Y) / 2;
export const ROD_ANGLE = Math.atan2(SHAFT_Y - PIN_Y, CARRIAGE_START_X - PIN_X);

/**
 * The centre of the carriage's stroke: `shaftX + rodLength` exactly, which is
 * where the slider–crank's two extremes (`θ = 0` and `θ = π`) are symmetric
 * about. All 2D travel below is measured from here.
 */
export const RAIL_ORIGIN_X = SHAFT_X + ROD_LENGTH;

/** The 2D slider's §28 travel limits: 0.1 m wider than the crank's throw. */
export const SLIDER_LIMIT = CRANK_RADIUS + 0.1;

/** The widened limits {@link LIMITS_STEP} commands (the command path, exercised). */
export const SLIDER_LIMIT_WIDE = 1.2;

/**
 * Where a 2D limit switch trips, in metres from {@link RAIL_ORIGIN_X}: 0.07 m
 * short of each end of the throw, which the carriage crosses at nearly zero
 * speed, so the switch is closed for far longer than one fixed step.
 */
export const SWITCH_TRAVEL = CRANK_RADIUS - 0.07;

/** The static post the 2D spring pulls against. */
export const SPRING_ANCHOR_X = 0.4;

/**
 * The 2D spring's rest length: post to stroke centre, so it is stretched over
 * one half of every revolution and compressed over the other.
 */
export const SPRING_REST_LENGTH = SPRING_ANCHOR_X - RAIL_ORIGIN_X;

/** Spring constant in N/m and damping in N·s/m for the 2D spring (§28). */
export const SPRING_STIFFNESS = 25;
export const SPRING_DAMPING = 0.8;

/**
 * §28's `maxTorque` on the 2D shaft, which on Rapier 0.19.3 is the motor's
 * **gain** and not a clamp (WP-6.2's finding, and the example's note): the
 * effort exerted equals this at one rad/s of velocity error.
 */
export const CRANK_MOTOR_GAIN = 400;

/** The 2D shaft's commanded rate in rad/s, before and after {@link RETARGET_STEP}. */
export const CRANK_TARGET = 6;
export const CRANK_TARGET_FAST = 9;

/** The independent 2D rope rig: anchor, load start, and the rope's `maxLength`. */
export const ROPE_ANCHOR = { x: 4, y: 3 };
export const ROPE_SLACK = 0.2;
export const ROPE_MAX_LENGTH = 1.5;
export const ROPE_LOAD_RADIUS = 0.05;

// ---------------------------------------------------------------------------
// The 3D half (§21: an axis and a joint type a plane does not have)
// ---------------------------------------------------------------------------

/** The 3D shaft: a bar hinged at its own centre about **+Y**, WP-6.4's rig. */
export const SHAFT3D_HALF_EXTENTS = { x: 0.4, y: 0.05, z: 0.05 };

/** Its motor: rad/s and §28 `maxTorque` (a gain here too), before and after. */
export const SHAFT3D_TARGET = 3;
export const SHAFT3D_TARGET_FAST = 5;
export const SHAFT3D_GAIN = 50;

/** The spherical pendulum: pivot, bob start (1 m below), radius and mass. */
export const BOB_PIVOT = { x: 3, y: 2, z: 0 };
export const BOB_START = { x: 3, y: 1, z: 0 };
export const BOB_RADIUS = 0.05;
export const BOB_MASS = 1;

/** The 3D slider carriage: origin on the rail, half extents, limits, motor. */
export const CARRIAGE3D_ORIGIN = { x: 6, y: 0, z: 0 };
export const CARRIAGE3D_HALF_EXTENT = 0.1;

/**
 * The 3D carriage's **authored** mass in kilograms (§23) — the one authored
 * mass in this scenario.
 *
 * Measured reason: the §25 density-derived mass of a 0.2 m cube is 0.008 kg,
 * and a 25 N/m spring on 0.008 kg is `ω = 56 rad/s`, i.e. six fixed steps per
 * period — stiff enough that the sprung, motor-driven carriage stalls (measured:
 * it stops at 0.077 m with the solver still reporting 0.68 m/s). At 1 kg the
 * same spring is 5 rad/s, the motor drives the carriage cleanly onto its limit,
 * and the scenario measures constraints rather than a stiff-spring artifact.
 */
export const CARRIAGE3D_MASS = 1;
export const CARRIAGE3D_LIMIT = 0.5;
export const CARRIAGE3D_LIMIT_TIGHT = 0.3;
export const CARRIAGE3D_TARGET = 1;
export const CARRIAGE3D_TARGET_REVERSED = -1;
export const CARRIAGE3D_MAX_FORCE = 500;

/** Where the 3D limit switches trip, in metres from {@link CARRIAGE3D_ORIGIN}. */
export const SWITCH_TRAVEL_3D = 0.25;

/** The 3D spring, from a static post at `postX` to the carriage (§28). */
export const SPRING3D_POST_X = 8;
export const SPRING3D_REST_LENGTH = SPRING3D_POST_X - CARRIAGE3D_ORIGIN.x;
export const SPRING3D_STIFFNESS = 25;
export const SPRING3D_DAMPING = 0.8;

/** Bodies each world registers — measured against `world.size` by the test. */
export const BODIES_2D = 8;
export const BODIES_3D = 7;

/** Joints each world registers before {@link REMOVE_STEP}. */
export const JOINTS_2D = 6;
export const JOINTS_3D = 4;

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** A position as plain numbers, so results survive JSON. */
export type Triple = readonly [number, number, number];

/**
 * The §29 tallies of one world.
 *
 * Every one of these is expected to be **0**: nothing in either world can touch
 * anything (see the module header) and §32 sleeping is off. They are recorded
 * because "no contacts" is a claim, and a claim in a golden is a measurement.
 */
export interface WorldEvents {
  /** `collisionstart` callbacks observed over listeners on every body (§29). */
  collisionStartCount: number;
  /** `collisionend` callbacks, on the same terms. */
  collisionEndCount: number;
  /** §32 `sleep` callbacks — 0, because sleeping is disabled in both worlds. */
  sleepCount: number;
  /** §32 `wake` callbacks. */
  wakeCount: number;
}

/**
 * What one world's sampled limit switches saw, and how far its carriage
 * travelled.
 *
 * A switch here is a **position sample in application code** — the carriage's
 * travel along its rail compared with a fixed threshold, latched on the
 * open→closed edge — which is what `examples/mechanism` does and what an
 * encoder-fed limit switch is. It is not a §24 sensor and nothing here pretends
 * otherwise. Extrema are integer counts of 1e-6 m.
 */
export interface SwitchRecord {
  /** Open→closed transitions at the negative-travel end. */
  leftHits: number;
  /** Open→closed transitions at the positive-travel end. */
  rightHits: number;
  /** Least travel reached, in micrometres from the rail origin. */
  minTravelMicro: number;
  /** Greatest travel reached, in micrometres. */
  maxTravelMicro: number;
}

/** A shaft's rate at the three schedule probes, in micro-radians per second. */
export interface SpinProbes {
  /** At {@link SPIN_PROBE_DRIVEN} — the motor is driving the retargeted rate. */
  drivenMicro: number;
  /**
   * At {@link SPIN_PROBE_COASTING} — the motor was released 80 steps earlier
   * and, on the 3D shaft, kicked at {@link KICK_STEP} 40 steps earlier.
   */
  coastingMicro: number;
  /** At {@link SPIN_PROBE_REDRIVEN} — 80 steps after it was re-engaged. */
  redrivenMicro: number;
}

/** The values the golden file pins. */
export interface Phase6Summary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Combined digest after step 1. */
  firstStepDigest: number;
  /** Combined digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
  /** `world2d.checksum()` after step 1 — §33's own uint32, unwrapped. */
  firstChecksum2d: number;
  /** `world2d.checksum()` after step {@link STEP_COUNT}. */
  lastChecksum2d: number;
  /** `world3d.checksum()` after step 1. */
  firstChecksum3d: number;
  /** `world3d.checksum()` after step {@link STEP_COUNT}. */
  lastChecksum3d: number;
  /** `world2d.jointCount` on the step before {@link REMOVE_STEP}. */
  jointsBefore2d: number;
  /** …and after the rope was removed. */
  jointsAfter2d: number;
  /** `world3d.jointCount` before and after the spring was removed. */
  jointsBefore3d: number;
  jointsAfter3d: number;
  /** The 2D carriage's switches and travel extrema. */
  switches2d: SwitchRecord;
  /** The 3D carriage's. */
  switches3d: SwitchRecord;
  /** The 3D carriage's greatest travel *after* {@link LIMITS_STEP}, in µm. */
  lateTravelMax3dMicro: number;
  /** The 2D crank's rate at the three probes. */
  spin2d: SpinProbes;
  /** The 3D shaft's. */
  spin3d: SpinProbes;
  /** Greatest |z| the 3D spherical bob reached, in µm — a plane has no such freedom. */
  bobMaxZMicro: number;
  /** The rope load's Y at the last step, in µm: far below where the rope held it. */
  ropeLoadEndYMicro: number;
  /** The §29 tallies of each world; see {@link WorldEvents}. */
  events2d: WorldEvents;
  events3d: WorldEvents;
}

/** Everything one scenario run produces; `summary` is the part under golden lock. */
export interface Phase6ScenarioResult {
  summary: Phase6Summary;
  /** One uint32 per fixed step: the D6 hash of (2D checksum, 3D checksum). */
  digests: number[];
  /** `world2d.checksum()` after every fixed step, in step order (§33). */
  checksums2d: number[];
  /** `world3d.checksum()` after every fixed step, in step order (§33). */
  checksums3d: number[];
  /** The 2D carriage's node position at the last step. */
  carriage2dEnd: Triple;
  /** The 3D carriage's node position at the last step. */
  carriage3dEnd: Triple;
  /** The 3D spherical bob's node position at the last step. */
  bob3dEnd: Triple;
  /** Host frames driven (always {@link STEP_COUNT}). */
  frameCount: number;
  /** Fixed steps the scheduler actually ran (§10); must equal `frameCount`. */
  fixedStepCount: number;
  /** Simulation time discarded by the §10 sub-step clamp; must be 0 here. */
  droppedTime: number;
  /** Simulation time reached, in seconds. */
  simulationTime: number;
  /** Largest `interpolationAlpha` seen at frame end; 0 on clean frames (§10). */
  maximumInterpolationAlpha: number;
  /** §42 conflict warnings emitted during the drive loop; must be 0. */
  authorityWarningCount: number;
  /** Bodies registered in each world. */
  bodyCount2d: number;
  bodyCount3d: number;
  /** Joints registered in each world at the end of the run. */
  jointCount2d: number;
  jointCount3d: number;
  /** Adapter names, so "two *different* solvers ran" is measured (§37). */
  adapterName2d: string;
  adapterName3d: string;
  /** Worlds tracked on the one `PhysicsSystem` (§39 step 6). */
  trackedWorlds: number;
  /** `PhysicsSystem.priority` (§39 step 6). */
  physicsPriority: number;
  /** Whether every value that reached a node stayed finite (§109's "no NaN"). */
  allFinite: boolean;
}

// ---------------------------------------------------------------------------
// Builders (the WP-6.4 rig's patterns, restated — see the module header)
// ---------------------------------------------------------------------------

/** A registered dynamic body: the node that carries the pose, the component. */
interface Part {
  readonly node: Node;
  readonly body: RigidBody;
}

/** Quantizes a metre or a rad/s to an integer count of 1e-6 units (§33's grid). */
function micro(value: number): number {
  return Math.round(value * 1e6);
}

/** §24's `rectangle` in 2D. */
function rectangle(halfWidth: number, halfHeight: number): CollisionShape {
  return { type: "rectangle", halfExtents: new Vector2(halfWidth, halfHeight) };
}

/** §24's `box` in 3D. */
function box(
  halfWidth: number,
  halfHeight: number,
  halfDepth: number,
): CollisionShape {
  return {
    type: "box",
    halfExtents: new Vector3(halfWidth, halfHeight, halfDepth),
  };
}

/**
 * Registers a `"static"` body with **no collider** — a joint's fixed side.
 *
 * §42 authority is `"manual"`: nothing writes a static body's transform, and
 * saying so is what keeps the authority warning count a measured zero.
 */
function addAnchor(
  world: PhysicsWorld,
  scene: Node,
  name: string,
  x: number,
  y: number,
  z: number,
): RigidBody {
  const node = new Group();
  node.name = name;
  node.transform.position.set(x, y, z);
  node.transformAuthority = "manual";
  const body = new RigidBody({ type: "static" });
  node.addComponent(body);
  scene.add(node);
  world.addBody(node);
  return body;
}

/**
 * Registers a dynamic body with one collider and, optionally, a rotation about
 * +Z (the crank and the rod are assembled at an angle).
 *
 * No mass is authored unless `mass` is given: the collider carries §25's
 * default density, the solver derives mass from density × measure, and
 * `PhysicsWorld.addBody` reads it back onto the component (§23, §25).
 */
function addDynamic(
  world: PhysicsWorld,
  scene: Node,
  name: string,
  shape: CollisionShape,
  x: number,
  y: number,
  z: number,
  angleZ: number,
  mass?: number,
): Part {
  const node = new Group();
  node.name = name;
  node.transform.position.set(x, y, z);
  if (angleZ !== 0) {
    node.transform.rotation.setFromAxisAngle(new Vector3(0, 0, 1), angleZ);
  }
  // §42: the solver owns a dynamic body's transform.
  node.transformAuthority = "physics";
  const body = new RigidBody({
    type: "dynamic",
    ...(mass === undefined ? {} : { mass }),
  });
  node.addComponent(body);
  node.addComponent(new Collider({ shape }));
  scene.add(node);
  world.addBody(node);
  return { node, body };
}

/** A fresh, zeroed §29 tally. */
function emptyEvents(): WorldEvents {
  return {
    collisionStartCount: 0,
    collisionEndCount: 0,
    sleepCount: 0,
    wakeCount: 0,
  };
}

/** Subscribes one body to the four §29 names that belong to a body. */
function watchBody(body: RigidBody, events: WorldEvents): void {
  body.on("collisionstart", () => {
    events.collisionStartCount += 1;
  });
  body.on("collisionend", () => {
    events.collisionEndCount += 1;
  });
  body.on("sleep", () => {
    events.sleepCount += 1;
  });
  body.on("wake", () => {
    events.wakeCount += 1;
  });
}

/** A sampled limit switch pair: its state, its counters, and its extrema. */
interface Switches {
  readonly record: SwitchRecord;
  leftClosed: boolean;
  rightClosed: boolean;
}

/** A fresh switch pair, with extrema that any first sample must beat. */
function emptySwitches(): Switches {
  return {
    record: {
      leftHits: 0,
      rightHits: 0,
      minTravelMicro: Number.POSITIVE_INFINITY,
      maxTravelMicro: Number.NEGATIVE_INFINITY,
    },
    leftClosed: false,
    rightClosed: false,
  };
}

/**
 * Samples one switch pair against `travel` metres and latches the open→closed
 * edges, exactly as `examples/mechanism`'s `sampleSwitches` does.
 */
function sampleSwitches(
  switches: Switches,
  travel: number,
  threshold: number,
): void {
  const quantized = micro(travel);
  const record = switches.record;
  if (quantized < record.minTravelMicro) {
    record.minTravelMicro = quantized;
  }
  if (quantized > record.maxTravelMicro) {
    record.maxTravelMicro = quantized;
  }
  const left = travel <= -threshold;
  const right = travel >= threshold;
  if (left !== switches.leftClosed) {
    switches.leftClosed = left;
    if (left) {
      record.leftHits += 1;
    }
  }
  if (right !== switches.rightClosed) {
    switches.rightClosed = right;
    if (right) {
      record.rightHits += 1;
    }
  }
}

/** The 2D half: the slider–crank, its spring, and an independent rope load. */
interface Half2d {
  readonly crank: Part;
  readonly carriage: Part;
  readonly ropeLoad: Part;
  readonly shaftHinge: HingeJoint;
  readonly slider: SliderJoint;
  readonly rope: RopeJoint;
  readonly events: WorldEvents;
  readonly switches: Switches;
}

/**
 * Builds the `examples/mechanism` slider–crank in `world`, plus the rope rig.
 *
 * Registration order is fixed and is part of the golden: §33's checksum visits
 * bodies in ascending solver id, which is creation order, so reordering these
 * calls changes every digest. Bodies first, then joints, because
 * `world.addJoint` bakes each **world-space** anchor into body-local frames
 * against the pose the solver holds at that moment (§28).
 */
function build2d(world: PhysicsWorld, scene: Node): Half2d {
  const events = emptyEvents();

  const shaftBlock = addAnchor(
    world,
    scene,
    "shaft-block",
    SHAFT_X,
    SHAFT_Y,
    0,
  );
  const railBlock = addAnchor(
    world,
    scene,
    "rail-block",
    RAIL_ORIGIN_X,
    SHAFT_Y,
    0,
  );
  const springPost = addAnchor(
    world,
    scene,
    "spring-post",
    SPRING_ANCHOR_X,
    SHAFT_Y,
    0,
  );

  const crank = addDynamic(
    world,
    scene,
    "crank",
    rectangle(CRANK_HALF_LENGTH, CRANK_HALF_THICKNESS),
    SHAFT_X,
    SHAFT_Y,
    0,
    START_ANGLE,
  );
  const rod = addDynamic(
    world,
    scene,
    "connecting-rod",
    rectangle(ROD_LENGTH / 2, ROD_HALF_THICKNESS),
    ROD_CENTER_X,
    ROD_CENTER_Y,
    0,
    ROD_ANGLE,
  );
  const carriage = addDynamic(
    world,
    scene,
    "carriage",
    rectangle(CARRIAGE_HALF_EXTENT, CARRIAGE_HALF_EXTENT),
    CARRIAGE_START_X,
    SHAFT_Y,
    0,
    0,
  );

  // The rope rig stands on its own, far from the mechanism: an anchor and a
  // load that starts slack, so both halves of §28's pull-never-push rule run.
  const ropeAnchor = addAnchor(
    world,
    scene,
    "rope-anchor",
    ROPE_ANCHOR.x,
    ROPE_ANCHOR.y,
    0,
  );
  const ropeLoad = addDynamic(
    world,
    scene,
    "rope-load",
    { type: "circle", radius: ROPE_LOAD_RADIUS },
    ROPE_ANCHOR.x,
    ROPE_ANCHOR.y - ROPE_SLACK,
    0,
    0,
  );

  for (const body of [crank.body, rod.body, carriage.body, ropeLoad.body]) {
    watchBody(body, events);
  }

  // The motorised shaft. No axis is named: a hinge in a `"2d"` world has
  // exactly one possible one (+Z, §21) and the joint fills it in.
  const shaftHinge = new HingeJoint({
    bodyA: shaftBlock,
    bodyB: crank.body,
    anchor: new Vector3(SHAFT_X, SHAFT_Y, 0),
    motor: {
      enabled: true,
      targetVelocity: CRANK_TARGET,
      maxTorque: CRANK_MOTOR_GAIN,
    },
  });
  world.addJoint(shaftHinge);

  // The crank pin and the wrist pin: the two hinges that close the loop.
  world.addJoint(
    new HingeJoint({
      bodyA: crank.body,
      bodyB: rod.body,
      anchor: new Vector3(PIN_X, PIN_Y, 0),
    }),
  );
  world.addJoint(
    new HingeJoint({
      bodyA: rod.body,
      bodyB: carriage.body,
      anchor: new Vector3(CARRIAGE_START_X, SHAFT_Y, 0),
    }),
  );

  // The slider. Its two anchors are named separately — the rail's origin on the
  // static side, the carriage's own centre on the moving side — so travel is
  // measured from the stroke centre.
  const slider = new SliderJoint({
    bodyA: railBlock,
    bodyB: carriage.body,
    anchorA: new Vector3(RAIL_ORIGIN_X, SHAFT_Y, 0),
    anchorB: new Vector3(CARRIAGE_START_X, SHAFT_Y, 0),
    axis: new Vector3(1, 0, 0),
    limits: { min: -SLIDER_LIMIT, max: SLIDER_LIMIT },
  });
  world.addJoint(slider);

  world.addJoint(
    new SpringJoint({
      bodyA: springPost,
      bodyB: carriage.body,
      anchorA: new Vector3(SPRING_ANCHOR_X, SHAFT_Y, 0),
      anchorB: new Vector3(CARRIAGE_START_X, SHAFT_Y, 0),
      restLength: SPRING_REST_LENGTH,
      stiffness: SPRING_STIFFNESS,
      damping: SPRING_DAMPING,
    }),
  );

  const rope = new RopeJoint({
    bodyA: ropeAnchor,
    bodyB: ropeLoad.body,
    anchorA: new Vector3(ROPE_ANCHOR.x, ROPE_ANCHOR.y, 0),
    anchorB: new Vector3(ROPE_ANCHOR.x, ROPE_ANCHOR.y - ROPE_SLACK, 0),
    maxLength: ROPE_MAX_LENGTH,
  });
  world.addJoint(rope);

  return {
    crank,
    carriage,
    ropeLoad,
    shaftHinge,
    slider,
    rope,
    events,
    switches: emptySwitches(),
  };
}

/** The 3D half: a shaft about +Y, a spherical pendulum, a sprung slider. */
interface Half3d {
  readonly shaft: Part;
  readonly bob: Part;
  readonly carriage: Part;
  readonly shaftHinge: HingeJoint;
  readonly slider: SliderJoint;
  readonly spring: SpringJoint;
  readonly events: WorldEvents;
  readonly switches: Switches;
}

/** Builds the 3D half. See {@link build2d} for the ordering rule. */
function build3d(world: PhysicsWorld, scene: Node): Half3d {
  const events = emptyEvents();

  const shaftAnchor = addAnchor(world, scene, "shaft-anchor", 0, 0, 0);
  const shaft = addDynamic(
    world,
    scene,
    "shaft",
    box(SHAFT3D_HALF_EXTENTS.x, SHAFT3D_HALF_EXTENTS.y, SHAFT3D_HALF_EXTENTS.z),
    0,
    0,
    0,
    0,
  );

  const bobPivot = addAnchor(
    world,
    scene,
    "bob-pivot",
    BOB_PIVOT.x,
    BOB_PIVOT.y,
    BOB_PIVOT.z,
  );
  const bob = addDynamic(
    world,
    scene,
    "bob",
    { type: "sphere", radius: BOB_RADIUS },
    BOB_START.x,
    BOB_START.y,
    BOB_START.z,
    0,
    BOB_MASS,
  );

  const railAnchor = addAnchor(
    world,
    scene,
    "rail-anchor",
    CARRIAGE3D_ORIGIN.x,
    CARRIAGE3D_ORIGIN.y,
    CARRIAGE3D_ORIGIN.z,
  );
  const carriage = addDynamic(
    world,
    scene,
    "carriage-3d",
    box(CARRIAGE3D_HALF_EXTENT, CARRIAGE3D_HALF_EXTENT, CARRIAGE3D_HALF_EXTENT),
    CARRIAGE3D_ORIGIN.x,
    CARRIAGE3D_ORIGIN.y,
    CARRIAGE3D_ORIGIN.z,
    0,
    CARRIAGE3D_MASS,
  );
  const springPost = addAnchor(
    world,
    scene,
    "spring-post-3d",
    SPRING3D_POST_X,
    CARRIAGE3D_ORIGIN.y,
    CARRIAGE3D_ORIGIN.z,
  );

  for (const body of [shaft.body, bob.body, carriage.body]) {
    watchBody(body, events);
  }

  // A hinge in a `"3d"` world must name its axis (§21, §28) — and this one
  // names +Y, an axis the 2D half does not have.
  const shaftHinge = new HingeJoint({
    bodyA: shaftAnchor,
    bodyB: shaft.body,
    anchor: new Vector3(0, 0, 0),
    axis: new Vector3(0, 1, 0),
    motor: {
      enabled: true,
      targetVelocity: SHAFT3D_TARGET,
      maxTorque: SHAFT3D_GAIN,
    },
  });
  world.addJoint(shaftHinge);

  // §28's ball joint: three rotational freedoms about a point. A `"2d"` world
  // rejects it, which is exactly why it is here (plan P6-1).
  world.addJoint(
    new SphericalJoint({
      bodyA: bobPivot,
      bodyB: bob.body,
      anchor: new Vector3(BOB_PIVOT.x, BOB_PIVOT.y, BOB_PIVOT.z),
    }),
  );

  const slider = new SliderJoint({
    bodyA: railAnchor,
    bodyB: carriage.body,
    anchor: new Vector3(
      CARRIAGE3D_ORIGIN.x,
      CARRIAGE3D_ORIGIN.y,
      CARRIAGE3D_ORIGIN.z,
    ),
    axis: new Vector3(1, 0, 0),
    limits: { min: -CARRIAGE3D_LIMIT, max: CARRIAGE3D_LIMIT },
    motor: {
      enabled: true,
      targetVelocity: CARRIAGE3D_TARGET,
      maxForce: CARRIAGE3D_MAX_FORCE,
    },
  });
  world.addJoint(slider);

  const spring = new SpringJoint({
    bodyA: springPost,
    bodyB: carriage.body,
    anchorA: new Vector3(
      SPRING3D_POST_X,
      CARRIAGE3D_ORIGIN.y,
      CARRIAGE3D_ORIGIN.z,
    ),
    anchorB: new Vector3(
      CARRIAGE3D_ORIGIN.x,
      CARRIAGE3D_ORIGIN.y,
      CARRIAGE3D_ORIGIN.z,
    ),
    restLength: SPRING3D_REST_LENGTH,
    stiffness: SPRING3D_STIFFNESS,
    damping: SPRING3D_DAMPING,
  });
  world.addJoint(spring);

  return {
    shaft,
    bob,
    carriage,
    shaftHinge,
    slider,
    spring,
    events,
    switches: emptySwitches(),
  };
}

/** A node's local position as plain numbers. */
function positionOf(part: Part): Triple {
  const at = part.node.transform.position;
  return [at.x, at.y, at.z];
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Runs the Phase 6 exit scenario once, from scratch, and returns its per-step
 * checksums and the readable facts the golden pins.
 *
 * Every call in any process is independent: it builds its own `Application`,
 * its own two worlds on their own fresh Rapier adapters, and disposes all of
 * them before returning. Nothing is cached at module scope (the *wasm image*
 * is, inside `@four/physics-rapier`, which is a decoded module and not solver
 * state), so calling it twice in one process is a genuine second run rather
 * than a replay.
 *
 * ## What the host script does between frames
 *
 * Only the scripted schedule in the module header, and it is a pure function of
 * the step index: nothing reads a clock or an RNG (§33), and no transform is
 * written by anything but its §42 owner — which is why
 * {@link Phase6ScenarioResult.authorityWarningCount} is a measured zero rather
 * than an assumption.
 *
 * @returns the run's summary, per-step digests and statistics
 */
export async function runPhase6Scenario(): Promise<Phase6ScenarioResult> {
  const application = new Application({
    fixedTimeStep: FIXED_TIME_STEP,
    // Explicitly off: §43 pose capture is a *render* concern and render
    // interpolation never feeds back into physics state (§10, §43), so leaving
    // it out keeps this golden a statement about the solvers alone.
    poseInterpolation: false,
  });
  const scene = application.scene;

  const system = new PhysicsSystem();
  application.systems.register(system);

  const digests: number[] = [];
  const checksums2d: number[] = [];
  const checksums3d: number[] = [];
  let fixedStepCount = 0;
  let maximumInterpolationAlpha = 0;
  let allFinite = true;

  await application.initialize();

  // --- the two worlds (§21, §37) -------------------------------------------
  // One `PhysicsSystem`, two worlds, two different solver adapters. §32
  // sleeping is off in both: see the module header.
  const world2d = new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
    sleeping: { enabled: false },
  });
  const world3d = new PhysicsWorld({
    dimension: "3d",
    adapter: new Rapier3dAdapter(),
    sleeping: { enabled: false },
  });
  // wasm loads here (once per dimension per process), before a single step.
  await world2d.initialize();
  await world3d.initialize();
  system.track(world2d);
  system.track(world3d);

  const half2d = build2d(world2d, scene);
  const half3d = build3d(world3d, scene);

  // Recorded around `REMOVE_STEP`, so "the joint left" is a number and not an
  // inference from a changed hash.
  let jointsBefore2d = world2d.jointCount;
  let jointsAfter2d = jointsBefore2d;
  let jointsBefore3d = world3d.jointCount;
  let jointsAfter3d = jointsBefore3d;

  const spin2d: SpinProbes = {
    drivenMicro: 0,
    coastingMicro: 0,
    redrivenMicro: 0,
  };
  const spin3d: SpinProbes = {
    drivenMicro: 0,
    coastingMicro: 0,
    redrivenMicro: 0,
  };
  let bobMaxZ = 0;
  let lateTravelMax3d = Number.NEGATIVE_INFINITY;

  /** Every value that must stay finite for §109's stability claim to hold. */
  function checkFinite(): void {
    const values = [
      ...positionOf(half2d.crank),
      ...positionOf(half2d.carriage),
      ...positionOf(half2d.ropeLoad),
      ...positionOf(half3d.shaft),
      ...positionOf(half3d.bob),
      ...positionOf(half3d.carriage),
      half2d.crank.body.angularVelocity.z,
      half3d.shaft.body.angularVelocity.y,
    ];
    for (let i = 0; i < values.length; i += 1) {
      if (!Number.isFinite(values[i])) {
        allFinite = false;
      }
    }
  }

  // `fixedUpdate` fires after every registered system ran for that step (§10,
  // §39), so a checksum here is over the finished state of the step it names.
  application.on("fixedUpdate", () => {
    fixedStepCount += 1;
    const checksum2d = world2d.checksum();
    const checksum3d = world3d.checksum();
    checksums2d.push(checksum2d);
    checksums3d.push(checksum3d);
    const combined = createChecksum();
    combined.addFloat(checksum2d);
    combined.addFloat(checksum3d);
    digests.push(combined.digest());

    // The sampled limit switches, exactly as `examples/mechanism` samples them.
    const travel2d = half2d.carriage.node.transform.position.x - RAIL_ORIGIN_X;
    const travel3d =
      half3d.carriage.node.transform.position.x - CARRIAGE3D_ORIGIN.x;
    sampleSwitches(half2d.switches, travel2d, SWITCH_TRAVEL);
    sampleSwitches(half3d.switches, travel3d, SWITCH_TRAVEL_3D);
    if (fixedStepCount > LIMITS_STEP) {
      const quantized = micro(travel3d);
      if (quantized > lateTravelMax3d) {
        lateTravelMax3d = quantized;
      }
    }

    const bobZ = Math.abs(half3d.bob.node.transform.position.z);
    if (bobZ > bobMaxZ) {
      bobMaxZ = bobZ;
    }

    if (fixedStepCount === SPIN_PROBE_DRIVEN) {
      spin2d.drivenMicro = micro(half2d.crank.body.angularVelocity.z);
      spin3d.drivenMicro = micro(half3d.shaft.body.angularVelocity.y);
    }
    if (fixedStepCount === SPIN_PROBE_COASTING) {
      spin2d.coastingMicro = micro(half2d.crank.body.angularVelocity.z);
      spin3d.coastingMicro = micro(half3d.shaft.body.angularVelocity.y);
    }
    if (fixedStepCount === SPIN_PROBE_REDRIVEN) {
      spin2d.redrivenMicro = micro(half2d.crank.body.angularVelocity.z);
      spin3d.redrivenMicro = micro(half3d.shaft.body.angularVelocity.y);
    }
    if (fixedStepCount === REMOVE_STEP) {
      jointsAfter2d = world2d.jointCount;
      jointsAfter3d = world3d.jointCount;
    }
    checkFinite();
  });

  application.on("update", (time) => {
    if (time.interpolationAlpha > maximumInterpolationAlpha) {
      maximumInterpolationAlpha = time.interpolationAlpha;
    }
  });

  // --- drive (§10) ---------------------------------------------------------
  // §42 conflict warnings go to `console.warn` with a `[four]` prefix; counting
  // them here turns "every transform is written by its one owner" into a
  // measured zero. Anything else — Rapier's own loader notices, for instance —
  // is passed through untouched. Restored in `finally` so a failure cannot leak
  // a patched console into the rest of the suite.
  const originalWarn = console.warn;
  let authorityWarningCount = 0;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === "string" && args[0].startsWith("[four]")) {
      authorityWarningCount += 1;
      return;
    }
    originalWarn(...args);
  };

  try {
    application.start();
    for (let step = 1; step <= STEP_COUNT; step += 1) {
      // Each of these queues a §28 (or §26) command that the world drains at
      // the top of *this* step — see the module header's schedule.
      if (step === IMPULSE_STEP) {
        half3d.bob.body.applyImpulse(new Vector3(0, 0, BOB_IMPULSE_Z));
      }
      if (step === RETARGET_STEP) {
        half2d.shaftHinge.setMotor({
          enabled: true,
          targetVelocity: CRANK_TARGET_FAST,
          maxTorque: CRANK_MOTOR_GAIN,
        });
        half3d.shaftHinge.setMotor({
          enabled: true,
          targetVelocity: SHAFT3D_TARGET_FAST,
          maxTorque: SHAFT3D_GAIN,
        });
        half3d.slider.setMotor({
          enabled: true,
          targetVelocity: CARRIAGE3D_TARGET_REVERSED,
          maxForce: CARRIAGE3D_MAX_FORCE,
        });
      }
      if (step === LIMITS_STEP) {
        // Widened past the crank's throw: the 2D loop must never be
        // over-constrained by stops that sit inside it (the example's rule), so
        // this change exercises the command path rather than the mechanism.
        half2d.slider.setLimits(-SLIDER_LIMIT_WIDE, SLIDER_LIMIT_WIDE);
        // Tightened to *inside* the 3D carriage's present travel: this one the
        // solver has to enforce, and the travel extrema record that it did.
        half3d.slider.setLimits(
          -CARRIAGE3D_LIMIT_TIGHT,
          CARRIAGE3D_LIMIT_TIGHT,
        );
      }
      if (step === MOTOR_OFF_STEP) {
        half2d.shaftHinge.enableMotor(false);
        half3d.shaftHinge.enableMotor(false);
      }
      if (step === KICK_STEP) {
        // §26, through the command buffer: the released shaft keeps this.
        half3d.shaft.body.applyAngularImpulse(new Vector3(0, SHAFT_KICK, 0));
      }
      if (step === MOTOR_ON_STEP) {
        half2d.shaftHinge.enableMotor(true);
        half3d.shaftHinge.enableMotor(true);
      }
      if (step === REMOVE_STEP) {
        jointsBefore2d = world2d.jointCount;
        jointsBefore3d = world3d.jointCount;
        world2d.removeJoint(half2d.rope);
        world3d.removeJoint(half3d.spring);
      }

      application.step(FIXED_TIME_STEP);
    }
  } finally {
    console.warn = originalWarn;
  }

  const summaryChecksum = createChecksum();
  for (let i = 0; i < digests.length; i += 1) {
    // Digests are uint32s; `addFloat` quantizes by 1e6, so the largest possible
    // value maps to 4.29e15 — inside the 53-bit-safe range the hasher requires.
    summaryChecksum.addFloat(digests[i]);
  }

  const time = application.time;
  const result: Phase6ScenarioResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      lastStepDigest: digests[digests.length - 1],
      firstChecksum2d: checksums2d[0],
      lastChecksum2d: checksums2d[checksums2d.length - 1],
      firstChecksum3d: checksums3d[0],
      lastChecksum3d: checksums3d[checksums3d.length - 1],
      jointsBefore2d,
      jointsAfter2d,
      jointsBefore3d,
      jointsAfter3d,
      switches2d: half2d.switches.record,
      switches3d: half3d.switches.record,
      lateTravelMax3dMicro: lateTravelMax3d,
      spin2d,
      spin3d,
      bobMaxZMicro: micro(bobMaxZ),
      ropeLoadEndYMicro: micro(half2d.ropeLoad.node.transform.position.y),
      events2d: half2d.events,
      events3d: half3d.events,
    },
    digests,
    checksums2d,
    checksums3d,
    carriage2dEnd: positionOf(half2d.carriage),
    carriage3dEnd: positionOf(half3d.carriage),
    bob3dEnd: positionOf(half3d.bob),
    frameCount: STEP_COUNT,
    fixedStepCount,
    droppedTime: time.droppedTime,
    simulationTime: time.simulationTime,
    maximumInterpolationAlpha,
    authorityWarningCount,
    bodyCount2d: world2d.size,
    bodyCount3d: world3d.size,
    jointCount2d: world2d.jointCount,
    jointCount3d: world3d.jointCount,
    adapterName2d: world2d.adapter.name,
    adapterName3d: world3d.adapter.name,
    trackedWorlds: system.size,
    physicsPriority: system.priority,
    allFinite,
  };

  world3d.dispose();
  world2d.dispose();
  application.dispose();
  return result;
}
