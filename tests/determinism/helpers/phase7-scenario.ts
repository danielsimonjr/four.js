/**
 * The Phase 7 exit scenario (§19 physics-animation blending, §42's `"blended"`
 * authority, §33 determinism, plan WP-7.7) — one headless run of a **three-link
 * blended chain** that is animated, dropped into a ragdoll, blended back onto
 * its animation and re-typed kinematic, all inside **one** `Application`,
 * stepped 600 times (10 s at 1/60) and reduced to per-step digests plus the
 * readable facts a hash cannot diagnose.
 *
 * §110's exit criterion is that *"a character or machine can move between
 * animated, kinematic, and physical control without abrupt discontinuities"*.
 * `examples/blending` is that claim's visible half and
 * `tests/browser/blending.spec.ts` measures it in a real browser; this module is
 * the **determinism** half, and it is deliberately the same *kind* of evidence
 * as `phase5-scenario.ts` and `phase6-scenario.ts`: build an {@link Application}
 * (scene + fixed-step scheduler + §39 system registry; nothing renderer-shaped
 * is constructed or consulted, and no canvas or DOM is touched), register §19's
 * three systems, drive 600 clean frames, and digest the world **and the blended
 * nodes** after every one.
 *
 * ## The three systems, and why the middle one is not optional
 *
 * ```text
 * 299  createPoseTargetCaptureSystem(physics.worlds)   §19 history: previous ← current
 * 300  AnimationSystem                                 the mixers write PoseTargets
 * 600  PhysicsSystem                                   feed targets → solve → publish blend
 * ```
 *
 * `Application` registers none of them, and the capture system is load-bearing
 * *for this golden specifically*: {@link RAGDOLL_STEP}'s activation inherits its
 * velocity by finite-differencing `PoseTarget.position` against
 * `PoseTarget.previousPosition` over one fixed step, and without the capture
 * that history never moves — the switch would divide the target's *total*
 * animated displacement by one fixed delta and inherit an absurd velocity
 * (measured at 60 m/s from a 2 m/s animation, WP-7.5). The inherited speed is
 * therefore one of the numbers the golden pins.
 *
 * ## What is in the scene (the `examples/blending` rig, restated)
 *
 * | body | § | note |
 * | ---- | - | ---- |
 * | anchor block | §23 | `"static"`, **no collider** — a joint's fixed side is a body, not a point, and nothing may contact it |
 * | ground slab | §24 | `"static"` with a rectangle collider: the ragdoll actually lands on it |
 * | link 0…2 | §19 | `"blended"` nodes carrying the §19 trio — `RigidBody`, `Collider` offset one half-length down, `PoseTarget` |
 *
 * plus three §28 hinges: anchor → link 0, then link to link. The geometry, the
 * wave, and the mode cycle are `examples/blending`'s, number for number
 * (`LINK_HALF_LENGTH`, `ANCHOR_X/Y`, `GROUND_TOP`, `BASE_ANGLE`,
 * `WAVE_AMPLITUDE`, `WAVE_PERIOD`, `WAVE_PHASE_LAG`, `WAVE_KEYS`), so a
 * divergence here and a divergence on the built page are divergences of the same
 * rig. It is **restated, not imported**: the example is a page with a renderer
 * and a DOM, and this file must stay headless (see "Self-contained on purpose").
 *
 * ## The scripted mode cycle (§19, §110)
 *
 * Everything happens at fixed step indices, all pure functions of the step
 * number, none of them reading a clock or an RNG (§33):
 *
 * | step | what | § |
 * | ---- | ---- | - |
 * | 1 … {@link RAGDOLL_STEP} − 1 | **ANIMATED**: `"kinematic-position"`, weights 0 / 1, the wave drives every `PoseTarget` | §19 |
 * | {@link RAGDOLL_STEP} | `setBodyControlMode("dynamic", { inheritVelocityFrom })` on every link, weights 1 / 0 | §19, §22, P7-3 |
 * | … {@link SWEEP_FIRST_STEP} − 1 | **RAGDOLL**: the solver owns the chain and it collapses onto the floor | §19 |
 * | {@link SWEEP_FIRST_STEP} … {@link SWEEP_LAST_STEP} | **RECOVERING**: both §19 weights swept `1 − w` / `w`, `w = i / {@link SWEEP_STEPS}`, one notch per step | §19 |
 * | {@link SWEEP_HOLD_STEP} | the first step published at **full** animation weight, with the links still `"dynamic"` | §19 |
 * | {@link RETYPE_STEP} | `setBodyControlMode("kinematic-position")`, weights 0 / 1 | §22, P7-3 |
 * | … {@link STEP_COUNT} | **ANIMATED** again | §19 |
 *
 * Each command is issued *before* `application.step`, so the weights it writes
 * are the ones that step's publish uses — the same "commands, not mutations"
 * discipline §26 and §28 impose, and the same ordering `examples/blending`
 * reaches by writing its weights from the previous step's `fixedUpdate`.
 *
 * Two details are load-bearing, and both are WP-7.5's:
 *
 * - **Both** weights are written during the sweep (`1 − w` and `w`), not just
 *   the animation one: `normalizedWeights` divides by their sum, so leaving
 *   `physicsWeight` at 1 would ramp the published animation share as
 *   `w / (1 + w)` — only ½ at `w = 1`. Writing both makes the published share
 *   exactly `w`, and the per-step weight change exactly `1 / {@link SWEEP_STEPS}`.
 * - The re-type to `"kinematic-position"` happens **after**
 *   {@link SWEEP_HOLD_STEP}, a step that already published at full animation
 *   weight. By then the node has been following the target alone for a step, so
 *   re-typing teleports the *solver body* onto the target and cannot move the
 *   node at all. That ordering is the whole reason the sweep comes first, and it
 *   is what makes the second switch continuous rather than a scripted snap —
 *   {@link Phase7Summary.entryStepRetypeMicro} is the measurement of it.
 *
 * ## Where this deliberately follows the example rather than WP-7.5's rig
 *
 * `tests/integration/helpers/blending-scenarios.ts` re-seeds each `PoseTarget`
 * from the pose the ragdoll landed in before sweeping, so its crossfade is short
 * by construction. This scenario does **not**, exactly as the example does not:
 * the wave keeps playing all the way through the ragdoll (at animation weight 0
 * it is invisible, but it is running), so the chain blends from where it fell
 * back onto a wave that never stopped. The get-up is therefore a genuine
 * metres-wide crossfade whose per-step displacement is bounded by
 * `gap / {@link SWEEP_STEPS} + the wave's own speed`, and that bound is a
 * *measured* number in the golden rather than an assumption
 * ({@link Phase7Summary.maxStepRecoveringMicro}).
 *
 * ## Why the digest is more than `world.checksum()`
 *
 * §33's checksum is defined over the **solver's** bodies — every body's
 * transform and velocities, quantized to 1e-6, in ascending body id — and that
 * is exactly what `PhysicsWorld.checksum()` returns. It is necessary here and
 * not sufficient: §19's whole subject is the pose the *blend* publishes onto the
 * node, which during the sweep is neither the solver's pose nor the animation's
 * but a weighted combination of the two. A run whose blend regressed to "publish
 * the solver pose" would leave every solver checksum untouched.
 *
 * So each step's digest is the D6 hash (`@four/diagnostics`'s `createChecksum`,
 * the same hasher phases 1, 2, 4, 5 and 6 use) of, in this fixed order:
 *
 * 1. `world.checksum()` — §33's own uint32 over the solver state;
 * 2. for each link in registration order, the **published node pose**:
 *    `position.x, y, z` then `rotation.x, y, z, w`.
 *
 * `addFloat` quantizes to the same 1e-6 grid §33 uses, so the node half of the
 * digest is on §33's own resolution and not a finer one. The raw checksum
 * sequence is published alongside the digests
 * ({@link Phase7ScenarioResult.checksums}) so a divergence can be localised to
 * "the solver moved" versus "only the blend's output moved".
 *
 * ## What the golden pins beyond four hashes
 *
 * A hash says "something changed" and nothing else, and §110's criterion is a
 * statement about *trajectories*, so the golden also carries, as ordinary
 * readable numbers: the four **mode-switch steps** (which are inputs, recorded
 * so the golden is self-describing); the **largest per-fixed-step link
 * displacement in each of the four phases**, quantized to 1e-6 m; the
 * displacement of the **first step of each switch** — §110's criterion at its
 * two switches; the §19 **weight endpoints** at the sweep's first and last step
 * and the per-notch change; the **inherited speed** the ragdoll activation
 * seeded; where the chain hung, fell to, and returned to; and the §29 tallies.
 * When this file goes red, those numbers say *what* moved before anyone opens a
 * debugger.
 *
 * Every quantized value in the summary is an **integer count of 1e-6 units** —
 * micrometres for a distance, micrometres per second for a speed, millionths for
 * a weight — so the golden holds exact integers rather than a float's tail.
 *
 * ## Clean frames, on purpose (as in WP-2.7, WP-4.8, WP-5.8 and WP-6.6)
 *
 * Every injected frame is exactly {@link FIXED_TIME_STEP} seconds, so the §10
 * accumulator runs exactly one fixed step per frame, drops nothing, and leaves
 * `interpolationAlpha` at 0. Both facts are published. §43 pose interpolation is
 * explicitly **off**: it is a render concern, it never feeds back into physics
 * state (§10, §43), and leaving it out keeps this golden a statement about §19's
 * blend alone.
 *
 * ## §32 sleeping is left ON, exactly as the example leaves it
 *
 * Unlike `phase6-scenario.ts`, which had to disable sleeping so a coasting
 * mechanism could be re-driven, a settled ragdoll that Rapier puts to sleep is a
 * *feature* here — and the transition out of it goes through
 * `setBodyControlMode`, which wakes the body by default. Sleeping is
 * deterministic, the sleep/wake tallies are recorded rather than assumed, and
 * they are part of what a future regression would have to keep constant.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * Identical to WP-1.14/WP-2.7/WP-4.8/WP-5.8/WP-6.6: the determinism gate (plan
 * §8) demands the same scenario run twice in-process **and** once in a fresh
 * `node` child process, and those runs are only evidence if they execute the
 * same code. So one file is loaded by Vitest (through Vite) and by plain `node`
 * (through its default type-stripping, Node ≥ 22.18; this repo pins Node ≥ 20
 * and runs 22.22). The constraint that imposes: **this file must stay within
 * Node's erasable-syntax subset** — type annotations, `interface`, `type` and
 * `import type` are fine; `enum`, `namespace`, constructor parameter properties,
 * and decorators are not.
 *
 * As in phases 5 and 6, **wasm** adds one wrinkle: Rapier loads its WebAssembly
 * image asynchronously, so {@link runPhase7Scenario} is `async` and the world is
 * `await world.initialize()`-ed before a single step is taken. The child runner
 * in `../phase7-blending.test.ts` awaits the returned promise for the same
 * reason. (Rapier's loader writes one "using deprecated parameters" notice to
 * **stderr**; the child's stdout stays a single clean JSON object.)
 *
 * ## Self-contained on purpose (the WP-5.8/WP-6.6 decision, restated)
 *
 * `tests/integration/helpers/blending-scenarios.ts` (WP-7.5) has the same
 * builder *patterns* and this file mirrors them, and `examples/blending/main.ts`
 * has the geometry and the mode cycle — but neither is imported. A golden is
 * only evidence if the code that produced it is pinned: importing a sibling
 * packet's helper would let an unrelated edit to the integration rig silently
 * change what the golden means, and importing the example would drag a renderer
 * and a DOM into a headless run.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target — see the golden's `_tier`
 * field. Rapier is compiled WebAssembly, so its arithmetic is fixed by the wasm
 * image and does not vary with the host JS engine's `Math`; the node-side half
 * of the digest is §19's own `lerp`/`slerp`, plain IEEE-754 double arithmetic
 * with no transcendental in it. What is *not* claimed is cross-platform
 * determinism, because the values still cross the JS/wasm boundary as f64 → f32
 * conversions in this build, the wasm image is pinned per platform by the
 * package manager, and §33's `cross-platform` tier requires evidence this suite
 * does not gather.
 */

import {
  AnimationClip,
  AnimationMixer,
  AnimationSystem,
  AnimationTrack,
  quaternionAdapter,
  vector3Adapter,
  type AnimationTrackLike,
} from "@four/animation";
import { createChecksum } from "@four/diagnostics";
import { Quaternion, Vector2, Vector3 } from "@four/math";
import {
  Collider,
  HingeJoint,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  createPoseTargetCaptureSystem,
} from "@four/physics";
import { Rapier2dAdapter } from "@four/physics-rapier";
import { Group, PoseTarget, type Node } from "@four/scene";
import { Application } from "four/application";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long — 10 s. */
export const STEP_COUNT = 600;

// ---------------------------------------------------------------------------
// The scripted mode cycle (see the module header's table)
// ---------------------------------------------------------------------------

/**
 * 1-based fixed step whose frame hands the chain to the solver: switch 1, the
 * ragdoll activation, with `inheritVelocityFrom` on every link (§19, P7-3).
 *
 * 150 steps of wave is 2.5 s — most of one {@link WAVE_PERIOD}, and far enough
 * past `t = 0` that every link's target is moving when the switch happens, which
 * is the only condition under which velocity inheritance has anything to
 * inherit.
 */
export const RAGDOLL_STEP = 150;

/** …whose frame writes the sweep's first notch (`w = 1 / {@link SWEEP_STEPS}`). */
export const SWEEP_FIRST_STEP = 300;

/** How many notches the §19 weight sweep takes: 1.5 s at 1/60, the example's. */
export const SWEEP_STEPS = 90;

/** …whose frame writes the sweep's last notch, `w = 1`. */
export const SWEEP_LAST_STEP = SWEEP_FIRST_STEP + SWEEP_STEPS - 1;

/**
 * The one step that runs at `w = 1` with the links still `"dynamic"`.
 *
 * Not a mode of its own — it is the step that makes switch 2 continuous, and it
 * is why {@link RETYPE_STEP} is one past the sweep's end rather than on it. See
 * the module header.
 */
export const SWEEP_HOLD_STEP = SWEEP_LAST_STEP + 1;

/** …whose frame re-types every link back to `"kinematic-position"`: switch 2. */
export const RETYPE_STEP = SWEEP_HOLD_STEP + 1;

/** Where the §19 weights are probed, on the sweep's first and last notch. */
export const WEIGHT_PROBE_FIRST = SWEEP_FIRST_STEP;
export const WEIGHT_PROBE_LAST = SWEEP_LAST_STEP;

// ---------------------------------------------------------------------------
// The chain, in world units (§7a: +Y is up, metres, radians) — the example's
// ---------------------------------------------------------------------------

/** How many links the chain has (the example's `LINK_COUNT`, and WP-7.5's). */
export const LINK_COUNT = 3;

/** Half the length of one link, in metres: the joint-to-joint distance is 2 ×. */
export const LINK_HALF_LENGTH = 0.8;

/** Half the thickness of one link, in metres. */
export const LINK_HALF_THICKNESS = 0.17;

/** §24 friction and restitution on every link and on the ground. */
export const CONTACT_FRICTION = 0.7;
export const CONTACT_RESTITUTION = 0;

/** Where the chain hangs from — the node origin of link 0, and never moves. */
export const ANCHOR_X = -5.6;
export const ANCHOR_Y = 1.8;

/** Side of the static anchor block. Carries no collider — see the header. */
export const ANCHOR_BLOCK = 0.6;

/**
 * The top surface of the ground slab, in metres.
 *
 * 0.3 m **above** the lowest point a chain hanging straight down could reach
 * (`ANCHOR_Y − 3 × 2 × LINK_HALF_LENGTH = −3.0`), so the collapsed chain drapes
 * against the floor and rests there rather than swinging free forever.
 */
export const GROUND_TOP = -2.7;

/** The ground slab: wider than the example's view, and unmissably thick. */
export const GROUND_HALF_WIDTH = 8.2;
export const GROUND_HALF_HEIGHT = 0.75;

// ---------------------------------------------------------------------------
// The wave (§16/§17 clips, sampled from the chain's forward kinematics)
// ---------------------------------------------------------------------------

/**
 * The angle every link is animated about, measured from the hanging direction.
 *
 * A rotation of `a` about +Z takes the link's own −Y axis to `(sin a, −cos a)`,
 * so `π/2` points the chain along **+X**: an articulated arm held out
 * horizontally, which is the pose a collapse is most visible from.
 */
export const BASE_ANGLE = Math.PI / 2;

/** How far each link swings either side of {@link BASE_ANGLE}, in radians. */
export const WAVE_AMPLITUDE = 0.18;

/** One full loop of the wave, in seconds (§7a: seconds, never milliseconds). */
export const WAVE_PERIOD = 3.6;

/** Angular frequency of the wave, in rad/s. */
export const WAVE_OMEGA = (2 * Math.PI) / WAVE_PERIOD;

/** Phase lag between neighbouring links, in radians — a *travelling* wave. */
export const WAVE_PHASE_LAG = 1;

/** Keys sampled per link per loop (the example's 48; mid-key error < 0.3 mm). */
export const WAVE_KEYS = 48;

/**
 * One wave loop as a whole number of fixed steps: `3.6 s ÷ (1/60 s) = 216`.
 *
 * It is exact, and that is what makes {@link Phase7Summary.digestRepeatsAtTwoWavePeriods}
 * meaningful — the animated phases before and after the ragdoll are sampled at
 * *identical* clip-local times, so a chain that came back onto the wave produces
 * literally the same digests two periods later. `Math.round` because `3.6 × 60`
 * is `216.00000000000003` in binary floating point.
 */
export const WAVE_PERIOD_STEPS = Math.round(WAVE_PERIOD / FIXED_TIME_STEP);

// ---------------------------------------------------------------------------
// Expected shape of the world, measured by the test rather than assumed
// ---------------------------------------------------------------------------

/** Bodies the world registers: the anchor, the ground, and three links. */
export const BODY_COUNT = 2 + LINK_COUNT;

/** §28 hinges: anchor → link 0, then link to link. */
export const JOINT_COUNT = LINK_COUNT;

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** A position as plain numbers, so results survive JSON. */
export type Triple = readonly [number, number, number];

/**
 * The §29/§32 tallies of the world, summed over the three links.
 *
 * Unlike phase 6's — which are zero by construction — these are **expected to be
 * non-zero**: the ragdoll lands on the ground slab, and a settled ragdoll is put
 * to sleep by §32 and woken again by switch 2. They are recorded because that is
 * a claim, and a claim in a golden is a measurement.
 */
export interface WorldEvents {
  /** `collisionstart` callbacks observed over listeners on every link (§29). */
  collisionStartCount: number;
  /** `collisionend` callbacks, on the same terms. */
  collisionEndCount: number;
  /** §32 `sleep` callbacks — sleeping is left on, as the example leaves it. */
  sleepCount: number;
  /** §32 `wake` callbacks. */
  wakeCount: number;
}

/** §19's two weights at one probe, as millionths (`1e6` = fully animated). */
export interface WeightProbe {
  /** `RigidBody.animationWeight` on link 0, ×1e6. */
  animationMicro: number;
  /** `RigidBody.physicsWeight` on link 0, ×1e6. */
  physicsMicro: number;
}

/** The values the golden file pins. */
export interface Phase7Summary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Combined digest after step 1. */
  firstStepDigest: number;
  /** Combined digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
  /** `world.checksum()` after step 1 — §33's own uint32, unwrapped. */
  firstChecksum: number;
  /** `world.checksum()` after step {@link STEP_COUNT}. */
  lastChecksum: number;

  // --- the mode cycle, as the run actually observed it ---------------------

  /** The step at which switch 1 was issued; equals {@link RAGDOLL_STEP}. */
  activationStep: number;
  /** The sweep's first notch step; equals {@link SWEEP_FIRST_STEP}. */
  sweepFirstStep: number;
  /** The sweep's last notch step; equals {@link SWEEP_LAST_STEP}. */
  sweepLastStep: number;
  /** The step at which switch 2 was issued; equals {@link RETYPE_STEP}. */
  retypeStep: number;
  /** `RigidBody.type` on link 0 immediately after switch 1 — `"dynamic"`. */
  typeAfterActivation: string;
  /** …and after switch 2 — `"kinematic-position"`. */
  typeAfterRetype: string;

  // --- §110's criterion, per phase and at the two switches ------------------

  /** Largest per-step link displacement while ANIMATED (steps 1 … 149), in µm. */
  maxStepAnimatedMicro: number;
  /** …while RAGDOLL (steps {@link RAGDOLL_STEP} … {@link SWEEP_FIRST_STEP} − 1). */
  maxStepRagdollMicro: number;
  /** …while RECOVERING ({@link SWEEP_FIRST_STEP} … {@link SWEEP_HOLD_STEP}). */
  maxStepRecoveringMicro: number;
  /** …after switch 2 ({@link RETYPE_STEP} … {@link STEP_COUNT}). */
  maxStepRekinematicMicro: number;
  /** Displacement during the *first* step of switch 1, in µm — §110's number. */
  entryStepActivationMicro: number;
  /** Displacement during the first step after switch 2, in µm — §110's number. */
  entryStepRetypeMicro: number;

  // --- §19's weights -------------------------------------------------------

  /** The two weights on the sweep's first notch: 1/90 animation, 89/90 physics. */
  weightsAtSweepStart: WeightProbe;
  /** …and on its last: fully animated. */
  weightsAtSweepEnd: WeightProbe;
  /** The per-notch change in the published animation share, ×1e6 (`1e6 / 90`). */
  weightStepMicro: number;

  // --- what the chain actually did -----------------------------------------

  /**
   * Speed link 0's activation inherited from its target history, in µm/s.
   *
   * **Exactly 0, by construction and not by accident**: link 0's node origin is
   * the hinge it hangs from, so the wave's `position` track holds it at
   * ({@link ANCHOR_X}, {@link ANCHOR_Y}) for every key and only its `rotation`
   * track moves. Recorded because "the anchor link inherited nothing" and "the
   * history was never captured" would otherwise look the same from the outside —
   * {@link Phase7Summary.inheritedSpeedTipMicro} is the one that distinguishes
   * them.
   */
  inheritedSpeedAnchorMicro: number;
  /**
   * Speed the **tip** link's activation inherited, in µm/s.
   *
   * The number that proves `createPoseTargetCaptureSystem` is registered and
   * working: it is one fixed step of the wave's own tip motion, so a stale
   * history (the application `world.ts` warns about) would report the tip's
   * *total* animated displacement over 149 steps divided by one fixed delta —
   * two orders of magnitude larger.
   */
  inheritedSpeedTipMicro: number;
  /** Mean link-origin height just before switch 1, in µm — the animated band. */
  chainYBeforeActivationMicro: number;
  /** …at the end of the ragdoll phase: the chain is on the floor. */
  chainYAtSweepStartMicro: number;
  /** …at the end of the run: back in the animated band. */
  chainYFinalMicro: number;
  /** Greatest distance any link's pose sat from its target during the sweep, µm. */
  maxTargetGapMicro: number;

  /**
   * How many 1-based steps `s` satisfy `digests[s] === digests[s + 432]`, i.e.
   * reproduce themselves exactly **two wave periods** (2 × {@link WAVE_PERIOD_STEPS})
   * later.
   *
   * §110's exit criterion, stated as an identity rather than as a tolerance: the
   * wave is exactly periodic over {@link WAVE_PERIOD_STEPS} fixed steps, so if
   * the chain that comes back from the ragdoll is back on the wave — the same
   * node poses *and* the same solver state, on §33's 1e-6 grid — then every step
   * of the opening ANIMATED phase has a bit-identical twin two periods later,
   * inside the closing one. It measures 149: every step from 1 to
   * {@link RAGDOLL_STEP} − 1, with none missing.
   *
   * (One period later is *not* checked and would be 0: steps 217 … 365 are the
   * ragdoll, which is the point.)
   */
  digestRepeatsAtTwoWavePeriods: number;

  /** The §29/§32 tallies; see {@link WorldEvents}. */
  events: WorldEvents;
}

/** Everything one scenario run produces; `summary` is the part under golden lock. */
export interface Phase7ScenarioResult {
  summary: Phase7Summary;
  /** One uint32 per fixed step: the D6 hash of (checksum, published poses). */
  digests: number[];
  /** `world.checksum()` after every fixed step, in step order (§33). */
  checksums: number[];
  /** Link 0's node position at the last step. */
  link0End: Triple;
  /** The tip link's node position at the last step. */
  linkTipEnd: Triple;
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
  /** Bodies registered in the world. */
  bodyCount: number;
  /** Joints registered in the world (§28). */
  jointCount: number;
  /** Adapter name, so "the solver really ran" is measured (§37). */
  adapterName: string;
  /** Worlds tracked on the one `PhysicsSystem` (§39 step 6). */
  trackedWorlds: number;
  /** `PhysicsSystem.priority` (§39 step 6). */
  physicsPriority: number;
  /** `AnimationSystem.priority` (§39 step 3). */
  animationPriority: number;
  /** The pose-target capture system's priority (§39 step 3 − 1). */
  capturePriority: number;
  /** Whether every value that reached a node stayed finite (§110's "no NaN"). */
  allFinite: boolean;
}

// ---------------------------------------------------------------------------
// The wave's closed form (the example's, restated)
// ---------------------------------------------------------------------------

/** The +Z axis: §21's only rotational freedom in a `"2d"` world. */
const Z_AXIS = new Vector3(0, 0, 1);

/** The angle of link `index` at clip-local time `seconds`, in radians. */
function linkAngle(index: number, seconds: number): number {
  return (
    BASE_ANGLE +
    WAVE_AMPLITUDE * Math.sin(WAVE_OMEGA * seconds - index * WAVE_PHASE_LAG)
  );
}

/** One link's pose at one instant: the joint it hangs from, and its rotation. */
interface LinkPose {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

/**
 * The whole chain's pose at `seconds`, by forward kinematics from the anchor.
 *
 * Every hinge is satisfied exactly by construction: joint `i + 1` is placed one
 * link-length along link `i`'s own axis, which is what a hinge constrains. A
 * link's node origin is its **proximal joint**, not its centre (the collider is
 * pushed one half-length down by its §24 offset), which is what makes that true:
 * rotating a link about its own origin is a pure rotation.
 */
function sampleWave(seconds: number): readonly LinkPose[] {
  const poses: LinkPose[] = [];
  let x = ANCHOR_X;
  let y = ANCHOR_Y;
  for (let index = 0; index < LINK_COUNT; index += 1) {
    const angle = linkAngle(index, seconds);
    poses.push({
      // z is always 0: §21 requires a `"2d"` body to lie in the XY plane.
      position: new Vector3(x, y, 0),
      rotation: new Quaternion().setFromAxisAngle(Z_AXIS, angle),
    });
    x += 2 * LINK_HALF_LENGTH * Math.sin(angle);
    y -= 2 * LINK_HALF_LENGTH * Math.cos(angle);
  }
  return poses;
}

/**
 * The looping clip for one link: a `position` track and a `rotation` track,
 * sampled from {@link sampleWave} at {@link WAVE_KEYS} keys per period.
 *
 * The last key repeats the first exactly (`sin` is periodic and both are
 * evaluated from the same closed form), so the loop seam is continuous in both
 * channels — a mixer wrapping from `duration` to `0` sees no step.
 */
function waveClip(index: number): AnimationClip {
  const times: number[] = [];
  const positions: Vector3[] = [];
  const rotations: Quaternion[] = [];
  for (let key = 0; key <= WAVE_KEYS; key += 1) {
    const seconds = (key * WAVE_PERIOD) / WAVE_KEYS;
    const pose = sampleWave(seconds)[index];
    times.push(seconds);
    positions.push(pose.position);
    rotations.push(pose.rotation);
  }
  const position: AnimationTrackLike = new AnimationTrack({
    path: "position",
    adapter: vector3Adapter,
    times,
    values: positions,
  });
  const rotation: AnimationTrackLike = new AnimationTrack({
    path: "rotation",
    adapter: quaternionAdapter,
    times,
    values: rotations,
  });
  return new AnimationClip({
    name: `wave-${String(index)}`,
    tracks: [position, rotation],
    duration: WAVE_PERIOD,
  });
}

// ---------------------------------------------------------------------------
// Builders (the example's rig, restated — see the module header)
// ---------------------------------------------------------------------------

/** One link of the chain: the §19 trio, on one `"blended"` node. */
interface Link {
  readonly node: Node;
  readonly body: RigidBody;
  readonly target: PoseTarget;
}

/** Quantizes a metre, a m/s or a weight to an integer count of 1e-6 (§33's grid). */
function micro(value: number): number {
  return Math.round(value * 1e6);
}

/**
 * Registers one immovable block, with or without contact geometry.
 *
 * The anchor takes none — nothing may contact it — and §23 permits a body
 * without a collider. A static body still has to exist because a joint's fixed
 * side is a body, not a point (§28). §42 authority is `"manual"`: nothing writes
 * a static body's transform, and saying so is what keeps the authority warning
 * count a measured zero.
 */
function addStatic(
  world: PhysicsWorld,
  scene: Node,
  name: string,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  solid: boolean,
): RigidBody {
  const node = new Group();
  node.name = name;
  node.transform.position.set(x, y, 0);
  node.transformAuthority = "manual";
  const body = new RigidBody({ type: "static" });
  node.addComponent(body);
  if (solid) {
    node.addComponent(
      new Collider({
        shape: {
          type: "rectangle",
          halfExtents: new Vector2(halfWidth, halfHeight),
        },
        friction: CONTACT_FRICTION,
        restitution: CONTACT_RESTITUTION,
      }),
    );
  }
  scene.add(node);
  world.addBody(node);
  return body;
}

/**
 * Registers one blended link: a `"blended"` node with the §19 trio — a
 * `RigidBody`, a `Collider` offset to hang below the joint, and a `PoseTarget`.
 *
 * The target is seeded with `copyFrom(node.transform)`, which seeds the
 * *history* as well, so the first fixed step differences to zero instead of
 * reading the seeding itself as motion.
 *
 * No mass is authored: the collider carries §25's default density of 1, the
 * solver derives mass from density × area, and `PhysicsWorld.addBody` reads it
 * back onto the component (§23, §25).
 */
function addLink(
  world: PhysicsWorld,
  scene: Node,
  index: number,
  pose: LinkPose,
): Link {
  const node = new Group();
  node.name = `link-${String(index)}`;
  node.transform.position.copy(pose.position);
  node.transform.rotation.copy(pose.rotation);
  // §42: §19's pipeline is this node's single transform owner. Animation writes
  // the PoseTarget below; nothing in this file writes the transform.
  node.transformAuthority = "blended";

  const body = node.addComponent(new RigidBody({ type: "kinematic-position" }));
  // §19's weights: fully animated to start with.
  body.physicsWeight = 0;
  body.animationWeight = 1;

  const collider = node.addComponent(
    new Collider({
      shape: {
        type: "rectangle",
        halfExtents: new Vector2(LINK_HALF_THICKNESS, LINK_HALF_LENGTH),
      },
      friction: CONTACT_FRICTION,
      restitution: CONTACT_RESTITUTION,
    }),
  );
  // The leaf hangs below the joint, exactly as the drawn quad does on the page.
  collider.offset.position.set(0, -LINK_HALF_LENGTH, 0);

  const target = node.addComponent(new PoseTarget()).copyFrom(node.transform);

  scene.add(node);
  world.addBody(node);
  return { node, body, target };
}

/** A fresh, zeroed §29/§32 tally. */
function emptyEvents(): WorldEvents {
  return {
    collisionStartCount: 0,
    collisionEndCount: 0,
    sleepCount: 0,
    wakeCount: 0,
  };
}

/** Subscribes one body to the four §29/§32 names that belong to a body. */
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

/**
 * Builds the whole scene in `world`: the anchor, the ground, the three links,
 * the three hinges, and one mixer per link.
 *
 * Registration order is fixed and is part of the golden: §33's checksum visits
 * bodies in ascending solver id, which is creation order, so reordering these
 * calls changes every digest. Bodies first, then joints, because
 * `world.addJoint` bakes each **world-space** anchor into body-local frames
 * against the pose the solver holds at that moment (§28). The chain is built at
 * the wave's `t = 0` pose for the same reason one level up: the clips' first key
 * *is* that pose, so nothing moves on the first step.
 */
function buildScene(
  world: PhysicsWorld,
  scene: Node,
  animation: AnimationSystem,
  events: WorldEvents,
): readonly Link[] {
  const anchor = addStatic(
    world,
    scene,
    "anchor-block",
    ANCHOR_X,
    ANCHOR_Y,
    ANCHOR_BLOCK / 2,
    ANCHOR_BLOCK / 2,
    false,
  );
  addStatic(
    world,
    scene,
    "ground",
    0,
    GROUND_TOP - GROUND_HALF_HEIGHT,
    GROUND_HALF_WIDTH,
    GROUND_HALF_HEIGHT,
    true,
  );

  const start = sampleWave(0);
  const links: Link[] = [];
  for (let index = 0; index < LINK_COUNT; index += 1) {
    links.push(addLink(world, scene, index, start[index]));
  }
  for (const link of links) {
    watchBody(link.body, events);
  }

  // The hinges. None names an axis — a hinge in a `"2d"` world has exactly one
  // possible one (+Z, §21) and the joint fills it in. Jointed bodies do not
  // collide (§28 default), which is what lets neighbours overlap at a joint.
  world.addJoint(
    new HingeJoint({
      bodyA: anchor,
      bodyB: links[0].body,
      anchor: new Vector3(ANCHOR_X, ANCHOR_Y, 0),
    }),
  );
  for (let index = 1; index < links.length; index += 1) {
    world.addJoint(
      new HingeJoint({
        bodyA: links[index - 1].body,
        bodyB: links[index].body,
        anchor: links[index].node.transform.position.clone(),
      }),
    );
  }

  // One mixer per link, aimed at the link's PoseTarget rather than at a node:
  // §19's "animation produces a target pose", using nothing but §16/§17.
  for (let index = 0; index < links.length; index += 1) {
    animation.track(
      new AnimationMixer(links[index].target).play(waveClip(index), {
        loop: Number.POSITIVE_INFINITY,
      }),
    );
  }

  return links;
}

/**
 * The speed `link`'s `PoseTarget` is moving at, in m/s: the same one-step finite
 * difference `setBodyControlMode`'s `inheritVelocityFrom` performs, over the
 * same history the capture system shifted (§19, P7-3).
 */
function targetSpeed(link: Link): number {
  const target = link.target;
  return (
    Math.hypot(
      target.position.x - target.previousPosition.x,
      target.position.y - target.previousPosition.y,
      target.position.z - target.previousPosition.z,
    ) / FIXED_TIME_STEP
  );
}

/** A node's local position as plain numbers. */
function positionOf(link: Link): Triple {
  const at = link.node.transform.position;
  return [at.x, at.y, at.z];
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Runs the Phase 7 exit scenario once, from scratch, and returns its per-step
 * digests and the readable facts the golden pins.
 *
 * Every call in any process is independent: it builds its own `Application`, its
 * own world on its own fresh Rapier adapter, and disposes both before returning.
 * Nothing is cached at module scope (the *wasm image* is, inside
 * `@four/physics-rapier`, which is a decoded module and not solver state), so
 * calling it twice in one process is a genuine second run rather than a replay.
 *
 * ## What the host script does between frames
 *
 * Only the scripted mode cycle in the module header, and it is a pure function
 * of the step index: nothing reads a clock or an RNG (§33), and no transform is
 * written by anything but its §42 owner — which is why
 * {@link Phase7ScenarioResult.authorityWarningCount} is a measured zero rather
 * than an assumption.
 *
 * @returns the run's summary, per-step digests and statistics
 */
export async function runPhase7Scenario(): Promise<Phase7ScenarioResult> {
  const application = new Application({
    fixedTimeStep: FIXED_TIME_STEP,
    // Explicitly off: §43 pose capture is a *render* concern and render
    // interpolation never feeds back into physics state (§10, §43), so leaving
    // it out keeps this golden a statement about §19's blend alone.
    poseInterpolation: false,
  });
  const scene = application.scene;

  // §39 step 3 (priority 300): the mixers that write the pose targets.
  const animation = new AnimationSystem();
  application.systems.register(animation);

  // §39 step 6 (priority 600): the solve, and §19's blend around it.
  const physics = new PhysicsSystem();
  application.systems.register(physics);

  // §39 step 3 − 1 (priority 299): the pose-target history. Not registered by
  // `Application`, and not optional here — see the module header.
  const capture = createPoseTargetCaptureSystem(physics.worlds);
  application.systems.register(capture);

  const digests: number[] = [];
  const checksums: number[] = [];
  let fixedStepCount = 0;
  let maximumInterpolationAlpha = 0;
  let allFinite = true;

  await application.initialize();

  // --- the one world (§21, §37) --------------------------------------------
  // §32 sleeping is left at its default (on), exactly as the example leaves it.
  const world = new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
  });
  // wasm loads here (once per process), before a single step.
  await world.initialize();
  physics.track(world);

  const events = emptyEvents();
  const links = buildScene(world, scene, animation, events);

  // --- what the golden pins beyond the hashes -------------------------------

  /** Per-phase and per-switch displacement records, all in metres until output. */
  let maxStepAnimated = 0;
  let maxStepRagdoll = 0;
  let maxStepRecovering = 0;
  let maxStepRekinematic = 0;
  let entryStepActivation = 0;
  let entryStepRetype = 0;
  let maxTargetGap = 0;

  let typeAfterActivation = "";
  let typeAfterRetype = "";
  let inheritedSpeedAnchor = 0;
  let inheritedSpeedTip = 0;
  let chainYBeforeActivation = 0;
  let chainYAtSweepStart = 0;

  const weightsAtSweepStart: WeightProbe = {
    animationMicro: 0,
    physicsMicro: 0,
  };
  const weightsAtSweepEnd: WeightProbe = { animationMicro: 0, physicsMicro: 0 };

  /** Previous fixed step's link origins, flattened — §110's raw material. */
  const previousPositions = new Float64Array(LINK_COUNT * 3);
  let havePrevious = false;

  /** The mean link-origin height, in metres: "how low the chain hangs". */
  function chainY(): number {
    let sum = 0;
    for (const link of links) {
      sum += link.node.transform.position.y;
    }
    return sum / links.length;
  }

  /**
   * §110's criterion, measured live: the largest distance any link's origin
   * moved during the fixed step that just finished, plus the finiteness check
   * §110's stability claim rests on.
   */
  function measureStep(step: number): number {
    let worst = 0;
    for (let index = 0; index < links.length; index += 1) {
      const position = links[index].node.transform.position;
      if (!Number.isFinite(position.x)) allFinite = false;
      if (!Number.isFinite(position.y)) allFinite = false;
      if (!Number.isFinite(position.z)) allFinite = false;
      const base = index * 3;
      if (havePrevious) {
        const distance = Math.hypot(
          position.x - previousPositions[base],
          position.y - previousPositions[base + 1],
          position.z - previousPositions[base + 2],
        );
        if (distance > worst) {
          worst = distance;
        }
      }
      previousPositions[base] = position.x;
      previousPositions[base + 1] = position.y;
      previousPositions[base + 2] = position.z;
    }
    havePrevious = true;

    // Which phase this step belongs to; the boundaries are the switch steps, so
    // the step that *performs* a switch is the first step of the new phase.
    if (step < RAGDOLL_STEP) {
      if (worst > maxStepAnimated) maxStepAnimated = worst;
    } else if (step < SWEEP_FIRST_STEP) {
      if (worst > maxStepRagdoll) maxStepRagdoll = worst;
    } else if (step < RETYPE_STEP) {
      if (worst > maxStepRecovering) maxStepRecovering = worst;
    } else if (worst > maxStepRekinematic) {
      maxStepRekinematic = worst;
    }
    if (step === RAGDOLL_STEP) {
      entryStepActivation = worst;
    }
    if (step === RETYPE_STEP) {
      entryStepRetype = worst;
    }
    return worst;
  }

  /** How far each link's published pose sits from the target it blends towards. */
  function measureTargetGap(): void {
    for (const link of links) {
      const at = link.node.transform.position;
      const to = link.target.position;
      const gap = Math.hypot(at.x - to.x, at.y - to.y, at.z - to.z);
      if (gap > maxTargetGap) {
        maxTargetGap = gap;
      }
    }
  }

  /** Writes §19's two weights onto every link, as the one value `w` implies. */
  function setWeights(weight: number): void {
    for (const link of links) {
      // Both, not just the animation one: `normalizedWeights` divides by the
      // sum, so leaving `physicsWeight` at 1 would cap the published share at ½.
      link.body.physicsWeight = 1 - weight;
      link.body.animationWeight = weight;
    }
  }

  /** Reads link 0's two §19 weights into a probe record. */
  function probeWeights(into: WeightProbe): void {
    into.animationMicro = micro(links[0].body.animationWeight);
    into.physicsMicro = micro(links[0].body.physicsWeight);
  }

  // `fixedUpdate` fires after every registered system ran for that step (§10,
  // §39), so everything read here is the state §19's blend just published.
  application.on("fixedUpdate", () => {
    fixedStepCount += 1;
    const checksum = world.checksum();
    checksums.push(checksum);

    const combined = createChecksum();
    // §33's own uint32 over the solver bodies…
    combined.addFloat(checksum);
    // …then the poses §19 published onto the blended nodes, which no solver
    // checksum can see (see the module header).
    for (const link of links) {
      const { position, rotation } = link.node.transform;
      combined.addFloat(position.x);
      combined.addFloat(position.y);
      combined.addFloat(position.z);
      combined.addFloat(rotation.x);
      combined.addFloat(rotation.y);
      combined.addFloat(rotation.z);
      combined.addFloat(rotation.w);
    }
    digests.push(combined.digest());

    measureStep(fixedStepCount);
    if (fixedStepCount >= SWEEP_FIRST_STEP && fixedStepCount <= RETYPE_STEP) {
      measureTargetGap();
    }
    if (fixedStepCount === RAGDOLL_STEP - 1) {
      chainYBeforeActivation = chainY();
    }
    if (fixedStepCount === SWEEP_FIRST_STEP - 1) {
      chainYAtSweepStart = chainY();
    }
    if (fixedStepCount === WEIGHT_PROBE_FIRST) {
      probeWeights(weightsAtSweepStart);
    }
    if (fixedStepCount === WEIGHT_PROBE_LAST) {
      probeWeights(weightsAtSweepEnd);
    }
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
      if (step === RAGDOLL_STEP) {
        // Switch 1 — the ragdoll activation (§19, §110, P7-3). The velocity
        // comes from the target's one-step history, which exists only because
        // the capture system is registered.
        inheritedSpeedAnchor = targetSpeed(links[0]);
        inheritedSpeedTip = targetSpeed(links[links.length - 1]);
        for (const link of links) {
          world.setBodyControlMode(link.node, "dynamic", {
            inheritVelocityFrom: link.target,
          });
        }
        setWeights(0);
        typeAfterActivation = links[0].body.type;
      }
      if (step >= SWEEP_FIRST_STEP && step <= SWEEP_LAST_STEP) {
        // The weight sweep, one notch per step: `w = i / SWEEP_STEPS`, so the
        // last notch is exactly 1 and the per-step change is exactly 1/90.
        setWeights((step - SWEEP_FIRST_STEP + 1) / SWEEP_STEPS);
      }
      // SWEEP_HOLD_STEP writes nothing: it is the step that runs at w = 1 with
      // the links still dynamic, which is what makes switch 2 continuous.
      if (step === RETYPE_STEP) {
        // Switch 2 — back under kinematic control, in place (§22, P7-3).
        for (const link of links) {
          world.setBodyControlMode(link.node, "kinematic-position");
        }
        setWeights(1);
        typeAfterRetype = links[0].body.type;
      }

      application.step(FIXED_TIME_STEP);
    }
  } finally {
    console.warn = originalWarn;
  }

  // §110 as an identity: how much of the opening animated phase repeats exactly
  // two wave periods later, once the chain has been through the whole cycle.
  const repeatOffset = 2 * WAVE_PERIOD_STEPS;
  let digestRepeatsAtTwoWavePeriods = 0;
  for (let i = 0; i + repeatOffset < digests.length; i += 1) {
    if (digests[i] === digests[i + repeatOffset]) {
      digestRepeatsAtTwoWavePeriods += 1;
    }
  }

  const summaryChecksum = createChecksum();
  for (let i = 0; i < digests.length; i += 1) {
    // Digests are uint32s; `addFloat` quantizes by 1e6, so the largest possible
    // value maps to 4.29e15 — inside the 53-bit-safe range the hasher requires.
    summaryChecksum.addFloat(digests[i]);
  }

  const time = application.time;
  const result: Phase7ScenarioResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      lastStepDigest: digests[digests.length - 1],
      firstChecksum: checksums[0],
      lastChecksum: checksums[checksums.length - 1],
      activationStep: RAGDOLL_STEP,
      sweepFirstStep: SWEEP_FIRST_STEP,
      sweepLastStep: SWEEP_LAST_STEP,
      retypeStep: RETYPE_STEP,
      typeAfterActivation,
      typeAfterRetype,
      maxStepAnimatedMicro: micro(maxStepAnimated),
      maxStepRagdollMicro: micro(maxStepRagdoll),
      maxStepRecoveringMicro: micro(maxStepRecovering),
      maxStepRekinematicMicro: micro(maxStepRekinematic),
      entryStepActivationMicro: micro(entryStepActivation),
      entryStepRetypeMicro: micro(entryStepRetype),
      weightsAtSweepStart,
      weightsAtSweepEnd,
      weightStepMicro: micro(1 / SWEEP_STEPS),
      inheritedSpeedAnchorMicro: micro(inheritedSpeedAnchor),
      inheritedSpeedTipMicro: micro(inheritedSpeedTip),
      chainYBeforeActivationMicro: micro(chainYBeforeActivation),
      chainYAtSweepStartMicro: micro(chainYAtSweepStart),
      chainYFinalMicro: micro(chainY()),
      maxTargetGapMicro: micro(maxTargetGap),
      digestRepeatsAtTwoWavePeriods,
      events,
    },
    digests,
    checksums,
    link0End: positionOf(links[0]),
    linkTipEnd: positionOf(links[links.length - 1]),
    frameCount: STEP_COUNT,
    fixedStepCount,
    droppedTime: time.droppedTime,
    simulationTime: time.simulationTime,
    maximumInterpolationAlpha,
    authorityWarningCount,
    bodyCount: world.size,
    jointCount: world.jointCount,
    adapterName: world.adapter.name,
    trackedWorlds: physics.size,
    physicsPriority: physics.priority,
    animationPriority: animation.priority,
    capturePriority: capture.priority,
    allFinite,
  };

  world.dispose();
  application.dispose();
  return result;
}
