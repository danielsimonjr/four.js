/**
 * The §18 `AnimationController` determinism scenario (gap PH-9, 2026-08-07) —
 * one headless run of a five-state machine driven by a scripted parameter
 * schedule, stepped 600 times (10 s at 1/60), reduced to per-step checksums plus
 * the exact fixed-step indices at which every state change happened.
 *
 * It is the same *kind* of evidence as `phase4-scenario.ts`, and deliberately
 * the same shape: build an {@link Application} (scene + fixed-step scheduler +
 * §39 system registry; nothing renderer-shaped is constructed and no DOM is
 * touched), register an `AnimationSystem` (§39 step 3), drive 600 clean frames,
 * and checksum every animated value after every one. What it adds is the axis
 * `phase4` cannot reach: a pose that depends on the machine's *history* — which
 * conditions held on which step — rather than on one time axis.
 *
 * ## What the run exercises (§18)
 *
 * | feature | where |
 * | ------- | ----- |
 * | numeric comparisons | `idle → walk` (`speed > 0.1`), `walk → run` (`> 5`), `run → walk` (`<= 5`), `walk → idle` (`<= 0.1`) |
 * | Boolean conditions | `idle → walk` also requires `grounded` |
 * | triggers | `walk → land`, latched at step 240 and consumed by the transition |
 * | transition duration | every transition cross-fades (0.2 s – 0.4 s) |
 * | exit time | `land → idle` after 0.6 s of `land` |
 * | interruption | the `walk → land` fade declares `interruptible: false`, and the schedule raises `speed` to 9 while it runs — the suppressed `walk → run` is visible as a state change that does **not** happen |
 * | baseline channels | `land` animates no colour, so the colour channel fades to the baseline and back |
 *
 * ## Determinism tier reached (§33)
 *
 * **`cross-platform` arithmetic, recorded at the `same-runtime` tier.** Every
 * track in this scenario is `"linear"` over `number`, `vector3`, and `color`, so
 * every value the run produces comes from `a + (b − a) * t` and the transition
 * weight from one division and a `Math.min` — IEEE-754 operations with no
 * transcendental anywhere, unlike `phase4`'s `slerp` and `sine-in-out`. That is
 * a deliberate property of the scenario, not an accident: it makes a golden
 * mismatch mean "the controller changed", never "this engine's `Math.acos`
 * differs in its last bit". The recorded tier stays `same-runtime` because §33's
 * cross-platform tier is a claim about the whole engine, which this file cannot
 * make on its own.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * As WP-1.14/WP-2.7/WP-4.8: the determinism gate demands the same scenario run
 * twice in-process **and** once in a fresh `node` child process, and those runs
 * are only evidence if they execute the same code. So one file is loaded by
 * Vitest (through Vite) and by plain `node` (through its default type-stripping,
 * Node ≥ 22.18). The constraint that imposes: **this file must stay within
 * Node's erasable-syntax subset** — type annotations, `interface`, `type`, and
 * `import type` are fine; `enum`, `namespace`, constructor parameter
 * properties, and decorators are not.
 */

import {
  AnimationClip,
  AnimationController,
  AnimationSystem,
  AnimationTrack,
  colorAdapter,
  numberAdapter,
  vector3Adapter,
  type AnimationTrackLike,
  type AnimationTransition,
  type ColorRGBA,
} from "@four/animation";
import { createChecksum } from "@four/diagnostics";
import { Vector3 } from "@four/math";
import { Group, type Node } from "@four/scene";
import { Application } from "four/application";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long. */
export const STEP_COUNT = 600;

/** 1-based fixed step at t = 2 s — the mid-run probe. */
export const PROBE_STEP_MID = 120;

/** 1-based fixed step at the end of the run — the second probe. */
export const PROBE_STEP_END = STEP_COUNT;

/**
 * The machine's states, in the order they are declared — which is also the order
 * that fixes the channel indices (§33) and the encoding
 * {@link AnimationSample.stateIndex} uses.
 */
export const STATE_NAMES = ["idle", "walk", "run", "land"] as const;

/**
 * Quantities absorbed into every per-step digest, in the order
 * {@link AnimationSample} lists them. Published so the test can assert the
 * digest is over what this file's documentation claims it is over.
 */
export const SAMPLED_QUANTITY_COUNT = 10;

/**
 * The scripted parameter schedule: `[1-based fixed step, what happens]`.
 *
 * Applied *before* `application.step`, so a write lands strictly between two
 * fixed steps and the step it affects is unambiguous. This is the whole input to
 * the machine — there is no clock and no RNG anywhere in the run (§33).
 */
export const SCHEDULE: readonly (readonly [number, string])[] = [
  [20, "grounded"],
  [30, "speed=3"],
  [90, "speed=8"],
  [180, "speed=2"],
  [240, "land"],
  [250, "speed=9"],
  [400, "speed=0"],
  [450, "speed=6"],
];

/** A position or colour component triple/quad as plain numbers, for JSON. */
export type Triple = readonly [number, number, number];

/** A colour as plain numbers. */
export type Quad = readonly [number, number, number, number];

/**
 * The one target the state clips are played onto.
 *
 * `transform` is the character node's own `Transform`, shared rather than
 * copied, so the position and scale channels write into the scene graph and the
 * controller's §42 identity test recognises them as transform writes. `color` is
 * the headless stand-in for a material's colour — a `Node` has no colour of its
 * own, and a controller has exactly one target.
 */
export interface ClipTarget {
  transform: Node["transform"];
  color: ColorRGBA;
}

/** Every animated value at one fixed step, as plain numbers. */
export interface AnimationSample {
  /** `character.transform.position` — the §17 vector kind. */
  position: Triple;
  /** `character.transform.scale.x` — the §17 scalar kind. */
  scaleX: number;
  /** The clip target's RGBA — the §17 colour kind. */
  color: Quad;
  /** Index into {@link STATE_NAMES} of the active (destination) state. */
  stateIndex: number;
  /** The destination state's blend weight; `1` when no fade runs. */
  weight: number;
}

/** One state change, with the fixed step it happened on. */
export interface StateChangeRecord {
  /** 1-based fixed step index. */
  step: number;
  /** The state entered. */
  to: string;
  /** The state left. */
  from: string;
}

/** The values the golden file pins. */
export interface ControllerSummary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Digest after step 1. */
  firstStepDigest: number;
  /** Digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
  /** 1-based fixed steps on which the machine changed state, in order. */
  stateChangeSteps: readonly number[];
  /** `"from→to"` for each of those changes, index-parallel with the steps. */
  stateChangeEdges: readonly string[];
}

/** Everything one scenario run produces; `summary` is under golden lock. */
export interface ControllerScenarioResult {
  summary: ControllerSummary;
  /** One uint32 per fixed step, in step order, over every animated value. */
  digests: number[];
  /** Sample at step {@link PROBE_STEP_MID}. */
  atMid: AnimationSample;
  /** Sample at step {@link PROBE_STEP_END}. */
  atEnd: AnimationSample;
  /** Every state change, in order. */
  stateChanges: StateChangeRecord[];
  /** Host frames driven (always {@link STEP_COUNT}). */
  frameCount: number;
  /** Fixed steps the scheduler actually ran (§10); must equal `frameCount`. */
  fixedStepCount: number;
  /** Simulation time discarded by the §10 sub-step clamp; must be 0 here. */
  droppedTime: number;
  /** Simulation time reached, in seconds. */
  simulationTime: number;
  /** §42 conflict and §16 property-conflict warnings emitted; must be 0. */
  authorityWarningCount: number;
  /** Players still tracked at the end — a controller is never auto-untracked. */
  trackedAtEnd: number;
  /** The machine's state when the run ended. */
  finalState: string;
  /** The controller's playback state when the run ended. */
  playbackState: string;
}

/** `Vector3` from a {@link Triple}. */
function vec(t: Triple): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
}

/** A colour tuple copied out of a shared array, so samples never alias it. */
function quadOf(color: ColorRGBA): Quad {
  return [color[0], color[1], color[2], color[3]];
}

/**
 * One state's clip: a position ramp, a scale ramp, and (optionally) a colour
 * ramp, all `"linear"` so every produced value is exact IEEE arithmetic.
 *
 * Omitting the colour track from one state is what puts the controller's
 * baseline rule under the golden: `land` contributes the captured colour, so the
 * fade into and out of it is a fade to the baseline and back.
 */
function stateClip(
  name: string,
  from: Triple,
  to: Triple,
  scaleFrom: number,
  scaleTo: number,
  color: Quad | undefined,
  duration: number,
): AnimationClip {
  const tracks: AnimationTrackLike[] = [
    new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, duration],
      values: [vec(from), vec(to)],
      interpolation: "linear",
    }),
    new AnimationTrack({
      path: "transform.scale.x",
      adapter: numberAdapter,
      times: [0, duration],
      values: [scaleFrom, scaleTo],
      interpolation: "linear",
    }),
  ];
  if (color !== undefined) {
    tracks.push(
      new AnimationTrack({
        path: "color",
        adapter: colorAdapter,
        times: [0, duration],
        values: [
          [color[0], color[1], color[2], color[3]] as ColorRGBA,
          [color[1], color[2], color[0], color[3]] as ColorRGBA,
        ],
        interpolation: "linear",
      }),
    );
  }
  return new AnimationClip({ name, duration, tracks });
}

/** The machine's edges, in the declaration order the scan follows (§33). */
export const TRANSITIONS: readonly AnimationTransition[] = [
  {
    from: "idle",
    to: "walk",
    duration: 0.35,
    when: [
      { parameter: "speed", is: "greater", value: 0.1 },
      { parameter: "grounded", is: "true" },
    ],
  },
  {
    from: "walk",
    to: "land",
    duration: 0.2,
    interruptible: false,
    when: [{ parameter: "land", is: "triggered" }],
  },
  {
    from: "walk",
    to: "run",
    duration: 0.4,
    when: [{ parameter: "speed", is: "greater", value: 5 }],
  },
  {
    from: "walk",
    to: "idle",
    duration: 0.25,
    when: [{ parameter: "speed", is: "lessOrEqual", value: 0.1 }],
  },
  {
    from: "run",
    to: "walk",
    duration: 0.4,
    when: [{ parameter: "speed", is: "lessOrEqual", value: 5 }],
  },
  { from: "land", to: "idle", duration: 0.3, exitTime: 0.6 },
];

/**
 * Runs the controller determinism scenario once, from scratch, and returns its
 * checksums, probe samples, and state-change records.
 *
 * Every call in any process is independent: it builds its own `Application`, its
 * own scene, its own clips and controller, and disposes the application before
 * returning. Nothing is cached at module scope, so calling it twice in one
 * process is a genuine second run rather than a replay.
 *
 * @returns the run's summary, per-step digests, probe samples, and statistics
 */
export async function runControllerScenario(): Promise<ControllerScenarioResult> {
  const application = new Application({ fixedTimeStep: FIXED_TIME_STEP });

  const character = new Group();
  character.name = "character";
  // §42: declared before any player writes, so the warning counter below is a
  // measurement of "every write was under proper authority", not a hope.
  character.transformAuthority = "animation";
  application.scene.add(character);

  const target: ClipTarget = {
    transform: character.transform,
    color: [0.5, 0.25, 0.125, 1],
  };

  const animationSystem = new AnimationSystem();
  application.systems.register(animationSystem);

  const stateChanges: StateChangeRecord[] = [];
  let fixedStepCount = 0;

  const controller = new AnimationController({
    target,
    // The target is not a `Node`, so §42's gate has to be declared: the position
    // and scale channels bind into `character`'s own transform.
    authority: character,
    states: {
      idle: stateClip(
        "idle",
        [0, 0, 0],
        [0, 0.2, 0],
        1,
        1.1,
        [0.5, 0.25, 0.125, 1],
        1.5,
      ),
      walk: stateClip(
        "walk",
        [0, 0, 0],
        [1.5, 0, 0],
        1.1,
        0.9,
        [0.2, 0.6, 0.4, 1],
        1,
      ),
      run: stateClip(
        "run",
        [0, 0, 0],
        [4, 0, 0],
        0.9,
        1.3,
        [0.8, 0.1, 0.3, 1],
        0.5,
      ),
      land: stateClip(
        "land",
        [0, 0, 0],
        [0, -0.4, 0],
        1.3,
        0.7,
        undefined,
        0.8,
      ),
    },
    parameters: {
      numbers: { speed: 0 },
      booleans: { grounded: false },
      triggers: ["land"],
    },
    transitions: TRANSITIONS,
    onStateChange: (to, from) => {
      // `AnimationSystem` advances inside the fixed step (§39 step 3) and the
      // application's `fixedUpdate` fires after every system ran, so the counter
      // is one behind while this callback executes; adding one back makes the
      // record 1-based in the same numbering the digest array uses.
      stateChanges.push({ step: fixedStepCount + 1, to, from });
    },
  });
  controller.play();
  animationSystem.track(controller);

  const digests: number[] = [];
  let atMid: AnimationSample | null = null;
  let atEnd: AnimationSample | null = null;

  /** Every animated value right now, in the digest's own order. */
  function sample(): AnimationSample {
    return {
      position: [
        character.transform.position.x,
        character.transform.position.y,
        character.transform.position.z,
      ],
      scaleX: character.transform.scale.x,
      color: quadOf(target.color),
      stateIndex: STATE_NAMES.indexOf(
        controller.currentState as (typeof STATE_NAMES)[number],
      ),
      weight: controller.transitionWeight,
    };
  }

  application.on("fixedUpdate", () => {
    fixedStepCount += 1;
    const current = sample();
    digests.push(digestOf(current));
    if (fixedStepCount === PROBE_STEP_MID) {
      atMid = current;
    }
    if (fixedStepCount === PROBE_STEP_END) {
      atEnd = current;
    }
  });

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
    for (let step = 1; step <= STEP_COUNT; step += 1) {
      applySchedule(controller, step);
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
  const result: ControllerScenarioResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      lastStepDigest: digests[digests.length - 1],
      stateChangeSteps: stateChanges.map((change) => change.step),
      stateChangeEdges: stateChanges.map(
        (change) => `${change.from}→${change.to}`,
      ),
    },
    digests,
    atMid: atMid ?? sample(),
    atEnd: atEnd ?? sample(),
    stateChanges,
    frameCount: STEP_COUNT,
    fixedStepCount,
    droppedTime: time.droppedTime,
    simulationTime: time.simulationTime,
    authorityWarningCount,
    trackedAtEnd: animationSystem.size,
    finalState: controller.currentState,
    playbackState: controller.state,
  };

  application.dispose();
  return result;
}

/** Applies whatever {@link SCHEDULE} says happens before fixed step `step`. */
function applySchedule(controller: AnimationController, step: number): void {
  for (let i = 0; i < SCHEDULE.length; i += 1) {
    if (SCHEDULE[i][0] !== step) {
      continue;
    }
    const action = SCHEDULE[i][1];
    if (action === "grounded") {
      controller.setBoolean("grounded", true);
    } else if (action === "land") {
      controller.setTrigger("land");
    } else {
      controller.setNumber("speed", Number(action.slice("speed=".length)));
    }
  }
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
  checksum.addFloats(s.position);
  checksum.addFloat(s.scaleX);
  checksum.addFloats(s.color);
  checksum.addFloat(s.stateIndex);
  checksum.addFloat(s.weight);
  return checksum.digest();
}
