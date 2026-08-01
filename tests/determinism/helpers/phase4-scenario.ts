/**
 * The Phase 4 exit scenario (§15–§17 authored animation, §33 determinism, plan
 * WP-4.8) — one headless run of a tween, a clip mixer, and a timeline, stepped
 * 1000 times (16⅔ s at 1/60), reduced to per-step checksums plus the exact
 * fixed-step indices at which every marker and clip event fired.
 *
 * §107's exit criterion is that *"tweens, timelines, and clip playback are
 * deterministic and unit tested"*. `packages/animation/tests/` covers the unit
 * half; this module is the determinism half, and it is written to be exactly the
 * same *kind* of evidence as `phase1-scenario.ts` and `phase2-scenario.ts`: it
 * builds an {@link Application} (scene + fixed-step scheduler + §39 system
 * registry; nothing renderer-shaped is constructed or consulted, and no canvas
 * or DOM is touched), registers an `AnimationSystem` (§39 step 3, priority 300)
 * and a `MotionSystem` (step 4, priority 400), drives 1000 clean frames, and
 * checksums every animated value after every one.
 *
 * ## What is animated, and why each piece is here (plan WP-4.8)
 *
 * | player                | §17 value kinds        | what it proves |
 * | --------------------- | ---------------------- | -------------- |
 * | `Tween` on `beacon`   | vector                 | §15 easing (`sine-in-out`), `yoyo`, `repeat(Infinity)` — a player that never finishes, so the digest keeps moving for all 1000 steps |
 * | `AnimationMixer` on `vane` | scalar + quaternion + color | §17 multi-track clip playback with `loop(3)`, `cubic` scalar interpolation, `slerp` on the quaternion track, and 2 clip events crossing 3 times each |
 * | `Timeline` (`loop(2)`)| number (through its child tween) | §16 sequencing: a nested unplayed tween the timeline owns, plus a marker that mutates a counter — the counter puts marker timing *inside* the per-step digest rather than only beside it |
 * | `MotionComponent` on `drifter` | — | the §39 ordering is real: animation (300) runs before motion (400) in the same fixed step, and the motion pillar's own state is hashed alongside the animation's |
 *
 * The mixer and the timeline both finish inside the run (at 9 s and 4.4 s), so
 * the scenario also covers `AnimationSystem`'s auto-untracking and the
 * value-holding behaviour of a finished player; the tween never finishes, so
 * something is still moving on the last step. Both facts are published
 * ({@link Phase4ScenarioResult.trackedAtEnd}) rather than assumed.
 *
 * ## One target object for the three-track clip (decision, WP-4.8)
 *
 * A mixer has exactly one target, and the §17 track kinds this clip has to carry
 * do not all live on a node: a `Node` has a transform (scalar and quaternion
 * tracks bind into it) but no colour. The target is therefore a small composite —
 * {@link ClipTarget} — holding the *same* `Transform` object the node holds plus
 * a `ColorRGBA` tuple, with `{ authority: vane }` declared so §42 still gates the
 * transform writes (the mixer identity-tests the binding owner against the node's
 * transform members, which is why sharing the object rather than copying it is
 * what makes the gate work). This is the headless stand-in for the example's
 * `Renderable`, whose `transform` and `material.color` are reached the same way.
 *
 * ## Clean frames, on purpose (as in WP-2.7)
 *
 * Every injected frame is exactly `FIXED_TIME_STEP` seconds, so the §10
 * accumulator runs exactly one fixed step per frame, drops nothing, and leaves
 * `interpolationAlpha` at 0. WP-1.14 already proved the ragged-frame path
 * reproduces bit-for-bit; what Phase 4 has to prove is that *authored* animation
 * is a pure function of the step count, and a ragged schedule would only add the
 * scheduler's noise to that measurement. Both facts are published
 * ({@link Phase4ScenarioResult.droppedTime},
 * {@link Phase4ScenarioResult.maximumInterpolationAlpha}).
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * Identical to WP-1.14/WP-2.7, and for the same reason: the determinism gate
 * (plan §8) demands the same scenario run twice in-process **and** once in a
 * fresh `node` child process, and those runs are only evidence if they execute
 * the same code. So one file is loaded by Vitest (through Vite) and by plain
 * `node` (through its default type-stripping, Node ≥ 22.18; this repo pins
 * Node ≥ 20 and runs 22.22). The constraint that imposes: **this file must stay
 * within Node's erasable-syntax subset** — type annotations, `interface`,
 * `type`, and `import type` are fine; `enum`, `namespace`, constructor parameter
 * properties, and decorators are not.
 *
 * ## `four/application`, not `four` (decision, WP-4.8)
 *
 * `phase2-scenario.ts` imports `Application` from `four`'s root barrel and its
 * test file files the consequence as a follow-up: that barrel namespace-exports
 * every workspace package, including `@four/render-webgl`, which was a Phase 0
 * stub then and is real code now. This scenario takes the subpath that note asks
 * for — `four/application` imports `@four/core`, `@four/motion`, `@four/scene`
 * and one `import type` from `@four/render`, so "no renderer is loaded" is a
 * fact about the import graph here and not only about behaviour. The two
 * existing scenarios are deliberately left alone: their goldens are immutable.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target. No RNG and no clock is
 * involved — every time in the run is an injected multiple of the fixed step —
 * but the values are runtime-bound all the same: `sine-in-out` and `back-out`
 * easing call `Math.sin`/`Math.cos`, `Quaternion.slerp` calls `Math.acos` and
 * `Math.sin`, and `MotionSystem`'s angular step calls `Quaternion.setFromAxisAngle`.
 * Those transcendentals may legally differ in their last bits between JS
 * engines. The checksum itself (plan D6) is exact and cross-platform; only its
 * inputs are runtime-bound.
 */

import {
  AnimationClip,
  AnimationMixer,
  AnimationSystem,
  AnimationTrack,
  Timeline,
  animate,
  colorAdapter,
  numberAdapter,
  quaternionAdapter,
  tween,
  type AnimationEvent,
  type ColorRGBA,
} from "@four/animation";
import { createChecksum } from "@four/diagnostics";
import { Quaternion, Vector3 } from "@four/math";
import { MotionComponent, MotionSystem } from "@four/motion";
import { Group, type Node } from "@four/scene";
import { Application } from "four/application";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long. */
export const STEP_COUNT = 1000;

/** 1-based fixed step at t = 1 s — the mid-run probe. */
export const PROBE_STEP_ONE_SECOND = 60;

/** 1-based fixed step at the end of the run — the second probe. */
export const PROBE_STEP_END = STEP_COUNT;

/**
 * Quantities absorbed into every per-step digest, in the order
 * {@link AnimationSample} lists them. Published so the test can assert the
 * digest is
 * over what this file's documentation claims it is over, rather than over
 * whatever survived an edit.
 */
export const SAMPLED_QUANTITY_COUNT = 21;

/** A position or velocity as plain numbers, so results survive JSON. */
export type Triple = readonly [number, number, number];

/** A quaternion or RGBA colour as plain numbers. */
export type Quad = readonly [number, number, number, number];

// ---------------------------------------------------------------------------
// The authored content (§15, §16, §17)
// ---------------------------------------------------------------------------

/**
 * The §15 vector tween on `beacon.transform.position`: `sine-in-out`, `yoyo`,
 * and `repeat(Infinity)` so it is still animating on step 1000.
 *
 * All three components move, and none of the six numbers is a round multiple of
 * another, so a transposed axis or a dropped component changes the digest.
 */
export const BEACON_TWEEN = {
  from: [2, -1, 0.5] as Triple,
  to: [-1.5, 2.25, -0.75] as Triple,
  /** Seconds (§7a) — one leg of the yoyo. */
  duration: 2.2,
};

/** Unit axis the clip's quaternion track turns about; exactly unit length. */
export const SPIN_AXIS = [0, 0.6, 0.8] as Triple;

/**
 * The §17 clip played on `vane`: three tracks (scalar, quaternion, colour) and
 * two events, looped three times.
 *
 * The quaternion track has four keys 120° apart rather than one key at 0 and one
 * at 2π, for the reason the example records: `slerp` always takes the short way
 * round, so a single 360° span would be a 0° span.
 */
export const CLIP = {
  name: "phase4-vane",
  /** Seconds; one iteration. */
  duration: 3,
  /** Total iterations (`AnimationMixer.loop` counts total, not extra). */
  loop: 3,
  scaleTimes: [0, 1.2, 3] as readonly number[],
  scaleValues: [1, 1.6, 0.75] as readonly number[],
  colorTimes: [0, 1.5, 3] as readonly number[],
  colorValues: [
    [0.62, 0.3, 0.14, 1],
    [0.68, 0.46, 0.22, 1],
    [0.58, 0.34, 0.1, 1],
  ] as readonly ColorRGBA[],
  events: [
    { time: 0.75, name: "spark" },
    { time: 2.25, name: "chime" },
  ] as readonly AnimationEvent[],
};

/**
 * The §16 timeline: a child tween the timeline owns (handed over unplayed) and
 * one marker at the `"beat"` label, played twice.
 *
 * The marker mutates {@link Phase4ScenarioResult.markerCount}, which is itself
 * hashed into every per-step digest — so the digest fails if the marker fires on
 * the wrong step, not merely if it fires the wrong number of times.
 */
export const TIMELINE = {
  /** Seconds; the child tween's one leg. Its total duration is twice this. */
  childDuration: 1.1,
  /** Where the child tween takes `pip.transform.position.y`. */
  childTo: 1.4,
  /** Label time in seconds; also the marker's time. */
  beat: 1.1,
  /** Total iterations. */
  loop: 2,
};

/** The `MotionComponent` node, so the §39 order is exercised, not just declared. */
export const DRIFTER = {
  start: [-3, 0.5, 1] as Triple,
  linearVelocity: [0.4, 0, -0.15] as Triple,
  linearAcceleration: [0, -1.2, 0] as Triple,
  damping: 0.35,
  /** Axis-angle rate, rad/s (§7a: radians). */
  angularVelocity: [0.7, 1.1, 0] as Triple,
};

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * The one target the three-track clip is played onto — see the module header.
 *
 * `transform` is the vane node's own `Transform`, shared rather than copied, so
 * the scalar and quaternion tracks write into the scene graph and the mixer's
 * §42 identity test recognises them as transform writes.
 */
export interface ClipTarget {
  transform: Node["transform"];
  color: ColorRGBA;
}

/** Every animated value at one fixed step, as plain numbers. */
export interface AnimationSample {
  /** `beacon.transform.position` — the §17 vector kind. */
  beaconPosition: Triple;
  /** `vane.transform.rotation` — the §17 quaternion kind. */
  vaneRotation: Quad;
  /** `vane.transform.scale.x` — the §17 scalar kind, from the clip. */
  vaneScaleX: number;
  /** The clip target's RGBA — the §17 colour kind. */
  color: Quad;
  /** `pip.transform.position.y` — the §17 numeric kind, from the timeline. */
  pipY: number;
  /** The motion node, so the §39 co-execution is in the hash too. */
  drifterPosition: Triple;
  drifterRotation: Quad;
  /** How many times the timeline's marker has fired so far. */
  markerCount: number;
}

/** One marker or clip event firing, with the fixed step it fired on. */
export interface FireRecord {
  /** 1-based fixed step index (see {@link runPhase4Scenario}). */
  step: number;
  /** Marker or event name. */
  name: string;
}

/** The values the golden file pins. */
export interface Phase4Summary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Digest after step 1. */
  firstStepDigest: number;
  /** Digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
  /** 1-based fixed steps on which the timeline's marker fired, in order. */
  markerFireSteps: readonly number[];
  /** 1-based fixed steps on which a clip event fired, in order. */
  clipEventFireSteps: readonly number[];
  /** Names of those clip events, index-parallel with the steps above. */
  clipEventNames: readonly string[];
}

/** Everything one scenario run produces; `summary` is the part under golden lock. */
export interface Phase4ScenarioResult {
  summary: Phase4Summary;
  /** One uint32 per fixed step, in step order, over every animated value. */
  digests: number[];
  /** Sample at step {@link PROBE_STEP_ONE_SECOND}. */
  atOneSecond: AnimationSample;
  /** Sample at step {@link PROBE_STEP_END}. */
  atEnd: AnimationSample;
  /** Every timeline marker firing, in order. */
  markerFires: FireRecord[];
  /** Every clip event firing, in order. */
  clipEventFires: FireRecord[];
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
  /** §42 conflict and §16 property-conflict warnings emitted; must be 0. */
  authorityWarningCount: number;
  /** Players still tracked when the run ended — the never-finishing tween. */
  trackedAtEnd: number;
  /** `AnimationSystem.priority` (§39 step 3). */
  animationPriority: number;
  /** `MotionSystem.priority` (§39 step 4); must be greater than the above. */
  motionPriority: number;
  /** Playback states at the end, so "finished" is measured rather than assumed. */
  tweenState: string;
  mixerState: string;
  timelineState: string;
}

/** `Vector3` from a {@link Triple}. */
function vec(t: Triple): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
}

/** A colour tuple copied out of the shared array, so samples never alias it. */
function quadOf(color: ColorRGBA): Quad {
  return [color[0], color[1], color[2], color[3]];
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Runs the Phase 4 exit scenario once, from scratch, and returns its checksums,
 * probe samples, and marker/event firing records.
 *
 * Every call in any process is independent: it builds its own `Application`, its
 * own scene, its own clip and players, and disposes the application before
 * returning. Nothing is cached at module scope, so calling it twice in one
 * process is a genuine second run rather than a replay.
 *
 * ## How a firing learns its step index
 *
 * `AnimationSystem` advances the players inside the fixed step (§39 step 3) and
 * the application's `fixedUpdate` event fires *after* every system ran, so the
 * counter incremented there is one behind while a marker callback is executing.
 * `currentStep()` adds that one back, which makes every recorded index the
 * 1-based number of the step during which the marker fired — the same numbering
 * the digest array is indexed by.
 *
 * @returns the run's summary, per-step digests, probe samples, and statistics
 */
export async function runPhase4Scenario(): Promise<Phase4ScenarioResult> {
  const application = new Application({ fixedTimeStep: FIXED_TIME_STEP });
  const scene = application.scene;

  // --- nodes ---------------------------------------------------------------
  // §42: the three animated nodes declare `"animation"` *before* any player
  // writes, and the motion node declares `"kinematic"`, so no system ever
  // attempts a write it does not own. The warning counter below turns that from
  // a claim into a measurement.
  const beacon = new Group();
  beacon.name = "beacon";
  beacon.transformAuthority = "animation";
  beacon.transform.position.set(
    BEACON_TWEEN.from[0],
    BEACON_TWEEN.from[1],
    BEACON_TWEEN.from[2],
  );
  scene.add(beacon);

  const vane = new Group();
  vane.name = "vane";
  vane.transformAuthority = "animation";
  scene.add(vane);

  const pip = new Group();
  pip.name = "pip";
  pip.transformAuthority = "animation";
  scene.add(pip);

  const drifter = new Group();
  drifter.name = "drifter";
  drifter.transformAuthority = "kinematic";
  drifter.transform.position.set(
    DRIFTER.start[0],
    DRIFTER.start[1],
    DRIFTER.start[2],
  );
  drifter.addComponent(
    new MotionComponent({
      linearVelocity: vec(DRIFTER.linearVelocity),
      linearAcceleration: vec(DRIFTER.linearAcceleration),
      angularVelocity: vec(DRIFTER.angularVelocity),
      damping: DRIFTER.damping,
    }),
  );
  scene.add(drifter);

  // --- systems (§39, plan D5, P4-1) ----------------------------------------
  // Registration order is deliberately "motion first" so that the run is
  // evidence about the *registry*: `SystemRegistry` sorts by priority, so the
  // animation system (300) still advances the players before `MotionSystem`
  // (400) integrates, which is the order §19's pipeline needs.
  const motionSystem = new MotionSystem();
  motionSystem.track(drifter);
  application.systems.register(motionSystem);

  const animationSystem = new AnimationSystem();
  application.systems.register(animationSystem);

  // --- probes and hashing (§33, plan D6) -----------------------------------
  // Declared before the players so that the marker and clip-event callbacks
  // below close over an already-initialised counter rather than over one in its
  // temporal dead zone.
  const digests: number[] = [];
  let fixedStepCount = 0;
  let markerCount = 0;
  let maximumInterpolationAlpha = 0;
  let atOneSecond: AnimationSample | null = null;
  let atEnd: AnimationSample | null = null;

  /** The 1-based fixed step currently executing; see this function's header. */
  const currentStep = (): number => fixedStepCount + 1;

  // --- (1) the §15 vector tween --------------------------------------------
  const beaconTween = animate(beacon)
    .to({ "transform.position": vec(BEACON_TWEEN.to) }, BEACON_TWEEN.duration)
    .ease("sine-in-out")
    .yoyo()
    .repeat(Infinity)
    .play();
  animationSystem.track(beaconTween);

  // --- (2) the §17 three-track clip ----------------------------------------
  const clipTarget: ClipTarget = {
    transform: vane.transform,
    color: [
      CLIP.colorValues[0][0],
      CLIP.colorValues[0][1],
      CLIP.colorValues[0][2],
      CLIP.colorValues[0][3],
    ],
  };

  const clip = new AnimationClip({
    name: CLIP.name,
    duration: CLIP.duration,
    tracks: [
      // Scalar, `cubic`: the one interpolation mode with per-component
      // arithmetic that a number track can use, so the clip is not three
      // linear ramps wearing different types.
      new AnimationTrack({
        path: "transform.scale.x",
        adapter: numberAdapter,
        times: CLIP.scaleTimes,
        values: CLIP.scaleValues,
        interpolation: "cubic",
      }),
      // Quaternion, `linear` — which is `slerp` for this adapter.
      new AnimationTrack({
        path: "transform.rotation",
        adapter: quaternionAdapter,
        times: [0, CLIP.duration / 3, (CLIP.duration * 2) / 3, CLIP.duration],
        values: [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3, Math.PI * 2].map(
          (angle) => new Quaternion().setFromAxisAngle(vec(SPIN_AXIS), angle),
        ),
        interpolation: "linear",
      }),
      // Colour, straight (non-premultiplied) RGBA, linear in linear light.
      new AnimationTrack({
        path: "color",
        adapter: colorAdapter,
        times: CLIP.colorTimes,
        values: CLIP.colorValues.map((c): ColorRGBA => [
          c[0],
          c[1],
          c[2],
          c[3],
        ]),
        interpolation: "linear",
      }),
    ],
    events: CLIP.events,
  });

  const clipEventFires: FireRecord[] = [];
  const mixer = new AnimationMixer(clipTarget).play(clip, {
    loop: CLIP.loop,
    // The target is not a `Node`, so §42's gate has to be declared (see the
    // module header): the transform tracks bind into `vane`'s own transform.
    authority: vane,
    onEvent: (event) => {
      clipEventFires.push({ step: currentStep(), name: event.name });
    },
  });
  animationSystem.track(mixer);

  // --- (3) the §16 timeline ------------------------------------------------
  const markerFires: FireRecord[] = [];
  const timeline = new Timeline()
    .addLabel("beat", TIMELINE.beat)
    .at(
      0,
      tween(
        pip,
        { "transform.position.y": TIMELINE.childTo },
        TIMELINE.childDuration,
      )
        .ease("back-out")
        .yoyo()
        .repeat(1),
    )
    .at("beat", () => {
      markerCount += 1;
      markerFires.push({ step: currentStep(), name: "beat" });
    })
    .loop(TIMELINE.loop);
  animationSystem.track(timeline.play());

  // --- sampling -------------------------------------------------------------

  /** Every animated value right now, in the digest's own order. */
  function sample(): AnimationSample {
    return {
      beaconPosition: [
        beacon.transform.position.x,
        beacon.transform.position.y,
        beacon.transform.position.z,
      ],
      vaneRotation: [
        vane.transform.rotation.x,
        vane.transform.rotation.y,
        vane.transform.rotation.z,
        vane.transform.rotation.w,
      ],
      vaneScaleX: vane.transform.scale.x,
      color: quadOf(clipTarget.color),
      pipY: pip.transform.position.y,
      drifterPosition: [
        drifter.transform.position.x,
        drifter.transform.position.y,
        drifter.transform.position.z,
      ],
      drifterRotation: [
        drifter.transform.rotation.x,
        drifter.transform.rotation.y,
        drifter.transform.rotation.z,
        drifter.transform.rotation.w,
      ],
      markerCount,
    };
  }

  // `fixedUpdate` fires after every registered system ran for that step (§10,
  // §39), so a sample here reads the finished values of the step it names.
  application.on("fixedUpdate", () => {
    fixedStepCount += 1;
    const current = sample();
    digests.push(digestOf(current));
    if (fixedStepCount === PROBE_STEP_ONE_SECOND) {
      atOneSecond = current;
    }
    if (fixedStepCount === PROBE_STEP_END) {
      atEnd = current;
    }
  });

  application.on("update", (time) => {
    if (time.interpolationAlpha > maximumInterpolationAlpha) {
      maximumInterpolationAlpha = time.interpolationAlpha;
    }
  });

  // --- drive (§10) ---------------------------------------------------------
  // §42 conflict warnings and §16 property-conflict warnings both go to
  // `console.warn` with a `[four]` prefix; counting them here turns "every write
  // is under proper authority and no two writers collide" into a measured zero.
  // Restored in `finally` so a failure cannot leak a patched console into the
  // rest of the suite.
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
    await application.initialize();
    application.start();
    for (let step = 0; step < STEP_COUNT; step += 1) {
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
  const result: Phase4ScenarioResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      lastStepDigest: digests[digests.length - 1],
      markerFireSteps: markerFires.map((fire) => fire.step),
      clipEventFireSteps: clipEventFires.map((fire) => fire.step),
      clipEventNames: clipEventFires.map((fire) => fire.name),
    },
    digests,
    atOneSecond: atOneSecond ?? sample(),
    atEnd: atEnd ?? sample(),
    markerFires,
    clipEventFires,
    frameCount: STEP_COUNT,
    fixedStepCount,
    droppedTime: time.droppedTime,
    simulationTime: time.simulationTime,
    maximumInterpolationAlpha,
    authorityWarningCount,
    trackedAtEnd: animationSystem.size,
    animationPriority: animationSystem.priority,
    motionPriority: motionSystem.priority,
    tweenState: beaconTween.state,
    mixerState: mixer.state,
    timelineState: timeline.state,
  };

  application.dispose();
  return result;
}

/**
 * FNV-1a checksum (plan D6, 1e-6 quantization) over one sample's
 * {@link SAMPLED_QUANTITY_COUNT} numbers, in a fixed order.
 *
 * The order is the field order of {@link AnimationSample} and is part of the
 * golden: reordering it changes every digest, which is why it is written out
 * once here rather than derived from `Object.values`.
 */
function digestOf(s: AnimationSample): number {
  const checksum = createChecksum();
  checksum.addFloats(s.beaconPosition);
  checksum.addFloats(s.vaneRotation);
  checksum.addFloat(s.vaneScaleX);
  checksum.addFloats(s.color);
  checksum.addFloat(s.pipY);
  checksum.addFloats(s.drifterPosition);
  checksum.addFloats(s.drifterRotation);
  checksum.addFloat(s.markerCount);
  return checksum.digest();
}

// ---------------------------------------------------------------------------
// Marker seek-suppression scenario (§16)
// ---------------------------------------------------------------------------

/** Markers the seek scenario places, in `at()` insertion order. */
export const SEEK_MARKERS = [
  { at: 0.5, name: "a", replayOnSeek: false },
  { at: 1.0, name: "b", replayOnSeek: true },
  { at: 1.5, name: "c", replayOnSeek: false },
  { at: 2.0, name: "d", replayOnSeek: true },
  { at: 2.5, name: "e", replayOnSeek: false },
] as const;

/** Local time the seek jumps to, in seconds — past four of the five markers. */
export const SEEK_TIME = 2.2;

/** Seconds advanced after the seek; carries playback past `"e"` and no further. */
export const SEEK_ADVANCE = 0.5;

/** What one marker seek-suppression run observed. */
export interface MarkerSeekResult {
  /**
   * Markers fired by a *control* timeline that simply played from 0 to
   * `SEEK_TIME + SEEK_ADVANCE`. Every marker in that range, in time order — the
   * evidence that the suppressed run below suppressed something real.
   */
  playedThrough: string[];
  /** Markers fired by the seek itself: only the `replayOnSeek` ones (§16). */
  duringSeek: string[];
  /** Markers fired by advancing from the seek point: only not-yet-crossed ones. */
  afterAdvance: string[];
}

/**
 * Builds one timeline carrying {@link SEEK_MARKERS} plus a child tween, and
 * returns it with the array its markers append to.
 *
 * The child tween exists so the timeline is more than a marker rack: its
 * duration (3 s) comes from the child rather than from the last marker, and the
 * seek therefore lands *inside* authored content.
 */
function buildSeekTimeline(fired: string[]): Timeline {
  const target = { value: 0 };
  const timeline = new Timeline().at(
    0,
    tween(target, { value: 10 }, 3).ease("linear"),
  );
  for (const marker of SEEK_MARKERS) {
    timeline.at(
      marker.at,
      () => {
        fired.push(marker.name);
      },
      { replayOnSeek: marker.replayOnSeek },
    );
  }
  return timeline;
}

/**
 * Exercises §16's marker policy on seek: seeking across markers fires only the
 * ones that opted into `replayOnSeek`, and advancing afterwards fires only the
 * markers the seek did *not* already cross.
 *
 * Two timelines are built rather than one, because the control run has to see
 * the same markers from the same starting state; reusing the seeked timeline
 * would make the control a statement about a rewound cursor instead.
 *
 * Reads no clock and uses no RNG (§33), so two calls in one process — or in two
 * processes — must return identical arrays.
 */
export function runMarkerSeekScenario(): MarkerSeekResult {
  const controlFired: string[] = [];
  const control = buildSeekTimeline(controlFired);
  control.play();
  control.advance(SEEK_TIME + SEEK_ADVANCE);

  const fired: string[] = [];
  const timeline = buildSeekTimeline(fired);
  timeline.play();

  timeline.seek(SEEK_TIME);
  const duringSeek = [...fired];

  fired.length = 0;
  timeline.advance(SEEK_ADVANCE);
  const afterAdvance = [...fired];

  return { playedThrough: controlFired, duringSeek, afterAdvance };
}
