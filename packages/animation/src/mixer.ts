/**
 * The clip player (§17 clips, §16 playback semantics, §107 "playback controls").
 *
 * An {@link AnimationClip} is data: tracks over clip-local time plus markers. An
 * {@link AnimationMixer} is what plays one onto a target — it owns the bindings,
 * the local clock, the loop count, the speed, and the §16 marker history that a
 * clip deliberately has none of:
 *
 * ```ts
 * const mixer = new AnimationMixer(node);
 * mixer.play(clip, { loop: 2, onEvent: (event) => spawn(event.name) });
 * // …each fixed step (AnimationSystem, plan P4-1):
 * mixer.advance(time.fixedDeltaTime);
 * ```
 *
 * ## Bindings are resolved once (§16)
 *
 * Every track's path is resolved against the target **once**, at
 * {@link AnimationMixer.play}, through `createBinding` — §16's "string-path
 * convenience forms are resolved once, at creation time". The resolved owner is
 * kept for the mixer's whole life, so replacing `target.transform` afterwards
 * does not silently redirect the animation; and because the binding array is
 * index-parallel with `clip.tracks`, sampling is an indexed walk with no lookup.
 *
 * Each track is also checked against the property it resolved to: a `vector3`
 * track bound to a number is a configuration error and throws at `play`, not a
 * mysterious `NaN` three seconds in. Discrete tracks are the one kind that binds
 * to anything, because assignment always works.
 *
 * ## Evaluation is a pure function of clip time (§16, §9)
 *
 * {@link AnimationMixer.seek} and {@link AnimationMixer.advance} share one code
 * path: both position the clip clock and sample every track at that time.
 * Nothing integrates, so evaluating twice at the same time writes byte-identical
 * values and scrubbing backwards is exactly as valid as scrubbing forwards. Time
 * is clip-local seconds (§9: "animation time is clip-local and lives on players
 * and timelines, not in the global `TimeState`"; §7a: seconds, never
 * milliseconds) and never comes from a clock — only from `advance`/`seek`
 * (§33).
 *
 * ## Markers are not a function of time
 *
 * Clip events fire **once per forward crossing** during playback, through
 * `clip.eventsInRange`'s half-open `(from, to]` convention, so consecutive
 * advances neither miss an event nor repeat one. Looping re-arms them. A
 * {@link AnimationMixer.seek} fires nothing unless the play was configured
 * `{ replayOnSeek: true }`, which is §16's "opt-in per-marker replay-on-seek
 * policy" expressed per playback — a clip's `AnimationEvent` has no policy field
 * to opt in with (see {@link MixerPlayOptions.replayOnSeek}).
 *
 * ## Conflicts (§16) and authority (§42)
 *
 * The mixer claims every property it animates in the **same** module-level
 * registry `Tween` uses (`./tween.js`), so a tween and a mixer fighting over one
 * property resolve last-started-wins with a warning, exactly as two tweens do.
 * Transform writes are gated on §42 authority with `Tween`'s semantics: the
 * authority node is the target when the target is a `Node`, or
 * {@link MixerPlayOptions.authority} otherwise; a refusal warns once and skips
 * **every** transform write of that evaluation, never a partial pose, while
 * non-transform tracks keep animating.
 *
 * ## Allocation (§7b)
 *
 * {@link AnimationMixer.play} allocates: one binding, one scratch value, and one
 * claim per track. After that the advance path allocates nothing — the sample
 * sink and the event visitor are built once per mixer, and every track writes
 * through its own scratch.
 */

import { FourError } from "@four/core";
import { Node, warnAuthorityConflict } from "@four/scene";
import type { TransformAuthority } from "@four/scene";

import { createBinding, type PropertyBinding } from "./binding.js";
import type { AnimationClip, AnimationEvent, TrackSampleSink } from "./clip.js";
import type { AnimationTrackLike } from "./track.js";
import {
  claimProperty,
  isTransformOwner,
  releaseProperty,
  type PropertyClaim,
} from "./tween.js";
import { detectAdapter, type ValueAdapter } from "./values.js";

/**
 * The §42 authority a mixer writes transforms under — the same `"animation"` a
 * tween writes under, because §42 identifies writers by the authority they claim
 * and both *are* the animation system.
 */
const MIXER_AUTHORITY: TransformAuthority = "animation";

/** How a mixer names itself in the §16 conflict warning. */
const MIXER_WRITER_KIND = "clip mixer";

/**
 * The cursor value that means "before the start of playback", so an event at
 * clip time `0` still has a forward crossing to fire on. Identical in role and
 * value to `Timeline`'s: marker times are finite and `>= 0`, so `-1` is strictly
 * below all of them, and it stays finite for the `cursor - iteration * duration`
 * arithmetic where `-Infinity` would produce `NaN`.
 */
const CURSOR_BEFORE_START = -1;

/**
 * Playback state of an {@link AnimationMixer}. Deliberately the same vocabulary
 * as `TweenState` and `TimelineState`, which is what lets all three satisfy one
 * `Advanceable` (see `./animation-system.js`) and lets a prepared mixer satisfy
 * `TimelineChild` (see `./timeline.js`).
 *
 * - `"idle"` — built, possibly armed with {@link AnimationMixer.prepare}, but
 *   nothing is bound or claimed yet.
 * - `"running"` — {@link AnimationMixer.advance} moves it.
 * - `"paused"` — {@link AnimationMixer.resume} puts it back to `"running"`.
 * - `"finished"` — an advance carried playback to the end. The properties are
 *   released for other writers and the mixer can still be scrubbed.
 * - `"stopped"` — {@link AnimationMixer.stop} was called; the mixer writes
 *   nothing further and values stay where the last write put them.
 */
export type MixerState = "idle" | "running" | "paused" | "finished" | "stopped";

/**
 * Receives a clip event when playback crosses it (§16, §17).
 *
 * The index is the event's position in {@link AnimationClip.events}, which is
 * time-sorted — enough to identify a marker even when two share a name.
 */
export type AnimationEventListener = (
  event: AnimationEvent,
  index: number,
) => void;

/** Per-playback policy for {@link AnimationMixer.play}. */
export interface MixerPlayOptions {
  /**
   * Number of **total** iterations: `1` (the default) plays the clip once,
   * `3` plays it three times, `Infinity` never ends. The same counting as
   * `Timeline.loop`, deliberately not `Tween.repeat`'s "additional cycles".
   */
  readonly loop?: number;

  /** Multiplier applied to every advance delta; finite and `> 0`. Default `1`. */
  readonly speed?: number;

  /**
   * The node whose §42 authority gates this playback's transform writes.
   *
   * Inferred when the target *is* a `Node`. A mixer aimed at something else — a
   * material, a bare `Transform`, a plain object — cannot infer it (math and
   * material objects carry no back-reference to a node), so declare it here if
   * the clip writes into a node's transform through that target.
   */
  readonly authority?: Node;

  /** Called for every clip event this playback crosses (§16 semantics). */
  readonly onEvent?: AnimationEventListener;

  /**
   * Whether {@link AnimationMixer.seek} also fires the events it crosses
   * forwards — §16's opt-in replay-on-seek policy.
   *
   * §16 words it per marker; a clip's {@link AnimationEvent} is plain authored
   * data with no policy field (see `./clip.js`), so the opt-in lives on the
   * playback that owns the marker *history* instead. A caller who needs
   * per-marker granularity filters inside {@link MixerPlayOptions.onEvent},
   * which receives the event and its index.
   *
   * Defaults to `false`: seeking is silent, and a backward seek fires nothing
   * either way (crossing is a forward notion, §16).
   */
  readonly replayOnSeek?: boolean;
}

/** How one evaluation treats clip events. */
type EventMode =
  /** Playback: every crossed event fires. */
  | "play"
  /** Seek: events fire only under {@link MixerPlayOptions.replayOnSeek}. */
  | "seek"
  /** Pose only: nothing fires and the cursor does not move. */
  | "silent";

/** One bound track, resolved and claimed at {@link AnimationMixer.play}. */
interface MixerEntry {
  /** Resolved property reference (§16), index-parallel with `clip.tracks`. */
  readonly binding: PropertyBinding;
  /** The authored track path, for diagnostics and the §16 conflict warning. */
  readonly path: string;
  /** `out` storage for in-place adapters; ignored by the primitive adapters. */
  readonly scratch: unknown;
  /** Whether this property sits inside the authority node's transform. */
  readonly isTransform: boolean;
  /** Whether a write here bypasses a plan-D3 change hook and must re-fire it. */
  readonly notifyChange: boolean;
  /** This playback's §16 claim; `held` gates every write (see `./tween.js`). */
  readonly claim: PropertyClaim;
}

/** Throws the §89 error used for every malformed mixer configuration. */
function invalidMixer(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/** Rejects anything that is not a finite number `>= 0` (§7a: seconds). */
function requireNonNegativeSeconds(value: number, what: string): number {
  if (!Number.isFinite(value) || value < 0) {
    invalidMixer(
      `${what} must be a finite number of seconds >= 0 (§7a: all times are seconds); received ${String(value)}.`,
      { value },
    );
  }
  return value;
}

/**
 * Plays an {@link AnimationClip} onto one target object (§17, §107).
 *
 * ## The two time axes
 *
 * ```text
 * elapsed  0 ─────── d ─────── 2d ─────── 3d     (loop: 3, monotonic)
 * clip     0 ─── d   0 ─── d   0 ─── d           (what tracks are sampled at)
 * ```
 *
 * {@link AnimationMixer.localTime} is the clip-local position inside the current
 * iteration and is what every track sees; {@link AnimationMixer.elapsedTime} is
 * total played time and is what event bookkeeping runs in, because it only moves
 * forward during forward playback. Looping then needs no special case: an event
 * at clip time `m` occurs at `m`, `m + d`, `m + 2d`, … and the half-open
 * crossing rule fires each of those exactly once.
 *
 * ## One clip at a time
 *
 * A mixer plays a single clip. Cross-fading, layering, and additive blending are
 * §18/§19 material and are staged out of Phase 4 (plan P4-3); animating one
 * target from two clips today means two mixers, and the shared §16 conflict
 * registry then resolves any property they both write last-started-wins, with a
 * warning.
 */
export class AnimationMixer {
  /** Root object every track path is resolved against. */
  readonly #target: object;

  /** The armed or playing clip; `undefined` until `prepare`/`play`. */
  #clip: AnimationClip | undefined;

  /** Bound tracks, index-parallel with `clip.tracks`; empty until play. */
  #entries: MixerEntry[] = [];

  /** Total iterations: `1` plays once, `Infinity` loops forever. */
  #iterations = 1;

  /** Multiplier applied to every {@link AnimationMixer.advance} delta. */
  #speed = 1;

  /** Node declared through {@link MixerPlayOptions.authority}, if any. */
  #declaredNode: Node | undefined;

  /** Node whose §42 authority gates this mixer's transform writes. */
  #authorityNode: Node | undefined;

  /** Whether any bound track writes into {@link AnimationMixer.#authorityNode}. */
  #hasTransformEntries = false;

  /** Set per evaluation by {@link AnimationMixer.#applyPose}; read by the sink. */
  #allowTransform = true;

  /** See {@link MixerPlayOptions.onEvent}. */
  #onEvent: AnimationEventListener | undefined;

  /** See {@link MixerPlayOptions.replayOnSeek}. */
  #replayOnSeek = false;

  /** One iteration's length in seconds — the clip's duration, frozen at play. */
  #duration = 0;

  /** See {@link MixerState}. */
  #state: MixerState = "idle";

  /** Total played time in seconds, across loop iterations. */
  #elapsed = 0;

  /** Exclusive lower bound of the next crossing range, in elapsed seconds. */
  #cursor = CURSOR_BEFORE_START;

  /** Whether playback reached the end of the last iteration. */
  #finished = false;

  /**
   * The sink `clip.sampleAll` writes through. Built **once per mixer** (its two
   * arrow properties are the only closures in the module), so the advance path
   * allocates nothing.
   */
  readonly #sink: TrackSampleSink = {
    outFor: (trackIndex: number): unknown => this.#entries[trackIndex].scratch,
    applySample: (
      trackIndex: number,
      _track: AnimationTrackLike,
      value: unknown,
    ): void => {
      this.#write(this.#entries[trackIndex], value);
    },
  };

  /** The event visitor handed to `clip.eventsInRange`; also built once. */
  readonly #visitEvent = (event: AnimationEvent, index: number): void => {
    this.#onEvent?.(event, index);
  };

  constructor(target: object) {
    this.#target = target;
  }

  // --- introspection ------------------------------------------------------

  /** The object every track path is resolved against. */
  get target(): object {
    return this.#target;
  }

  /** The armed or playing clip, or `undefined` on a fresh mixer. */
  get clip(): AnimationClip | undefined {
    return this.#clip;
  }

  /** Current playback state. */
  get state(): MixerState {
    return this.#state;
  }

  /**
   * Length of one iteration in seconds: the clip's own `duration` (§17), frozen
   * at play. `0` while nothing is armed.
   */
  get duration(): number {
    return this.#state === "idle"
      ? (this.#clip?.duration ?? 0)
      : this.#duration;
  }

  /**
   * `duration × loop` — the elapsed time at which playback finishes.
   * `Infinity` for `loop(Infinity)`, and `0` for a zero-length clip (where
   * `0 × Infinity` would otherwise be `NaN`).
   */
  get totalDuration(): number {
    const duration = this.duration;
    return duration <= 0 ? 0 : duration * this.#iterations;
  }

  /** Clip-local position inside the current iteration, in seconds (§9). */
  get localTime(): number {
    return this.#state === "idle" ? 0 : this.#localAt(this.#elapsed);
  }

  /** Total played time in seconds, across loop iterations. */
  get elapsedTime(): number {
    return this.#elapsed;
  }

  /** Zero-based index of the loop iteration currently playing. */
  get iteration(): number {
    return this.#state === "idle" ? 0 : this.#iterationAt(this.#elapsed);
  }

  /**
   * Whether an advance carried playback to {@link AnimationMixer.totalDuration}.
   *
   * A playback fact, not a time fact: {@link AnimationMixer.seek} never sets or
   * clears it, exactly as on a tween or a timeline, so scrubbing a finished
   * mixer inspects values without pretending it is running again.
   */
  get finished(): boolean {
    return this.#finished;
  }

  /** The {@link AnimationMixer.speed} multiplier. */
  get playbackSpeed(): number {
    return this.#speed;
  }

  /** Total iterations set by {@link AnimationMixer.loop}; `1` by default. */
  get loopCount(): number {
    return this.#iterations;
  }

  // --- playback -----------------------------------------------------------

  /**
   * Arms the mixer with a clip and its per-playback options **without starting
   * it**, so something else can own its playback — a `Timeline`, which requires
   * an `"idle"` child and calls `play()` itself, or a caller that wants to
   * `seek` a pose before running.
   *
   * The same relationship `tween(...)` has to `animate(...).play()`: nothing is
   * bound, captured, or claimed here.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the mixer has already been
   * played, or an option is out of range.
   */
  prepare(clip: AnimationClip, options: MixerPlayOptions = {}): this {
    if (this.#state !== "idle") {
      invalidMixer(
        `AnimationMixer.prepare() cannot be called after play(): bindings, property claims, and the clip are fixed at play time (state "${this.#state}").`,
        { state: this.#state },
      );
    }
    this.#clip = clip;
    if (options.loop !== undefined) {
      this.loop(options.loop);
    }
    if (options.speed !== undefined) {
      this.speed(options.speed);
    }
    this.#declaredNode = options.authority;
    this.#onEvent = options.onEvent;
    this.#replayOnSeek = options.replayOnSeek ?? false;
    return this;
  }

  /**
   * Resolves every track's binding, claims the properties (§16), and starts
   * playback at clip time 0 — writing the pose for time 0 immediately, so the
   * clip's first keyframes are visible without waiting for an advance.
   *
   * `play(clip, options)` is `prepare(clip, options).play()`. Calling it with no
   * clip plays whatever {@link AnimationMixer.prepare} armed, which is the form
   * `Timeline` uses.
   *
   * A no-op on a mixer that is not `"idle"` — replaying would have to re-resolve
   * bindings that §16 says are resolved once. Build a new mixer, or `seek(0)`.
   *
   * No event fires here, not even one at clip time 0: the cursor starts below
   * zero and the first `advance` (even `advance(0)`) crosses it.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — no clip was given or armed;
   * options were passed without a clip; or a track's path resolves to a property
   * whose type its adapter cannot write (see the module header).
   * @throws FourError from `createBinding` — a track path does not resolve.
   */
  play(clip?: AnimationClip, options?: MixerPlayOptions): this {
    if (this.#state !== "idle") {
      return this;
    }
    if (clip !== undefined) {
      this.prepare(clip, options);
    } else if (options !== undefined) {
      invalidMixer(
        "AnimationMixer.play(options) needs the clip the options belong to; pass play(clip, options) or prepare(clip, options) first.",
        {},
      );
    }
    const armed = this.#clip;
    if (armed === undefined) {
      invalidMixer(
        "AnimationMixer.play() needs a clip: call play(clip) or prepare(clip) first (§17).",
        {},
      );
    }

    const node =
      this.#declaredNode ??
      (this.#target instanceof Node ? this.#target : undefined);

    const entries: MixerEntry[] = [];
    let hasTransformEntries = false;
    for (const track of armed.tracks) {
      const adapter = track.adapter;
      const binding = createBinding(this.#target, track.path, adapter);
      this.#assertBindable(armed, track, binding);
      const isTransform =
        node !== undefined && isTransformOwner(node, binding.owner);
      hasTransformEntries = hasTransformEntries || isTransform;
      entries.push({
        binding,
        path: track.path,
        // Scratch, never a keyframe value: `clip.sampleAll` writes into it and
        // `binding.set` reads it, so aliasing a key would corrupt the clip.
        scratch: adapter.clone(binding.get()),
        isTransform,
        notifyChange: !adapter.mutatesInPlace,
        claim: { writerKind: MIXER_WRITER_KIND, held: false },
      });
    }

    this.#entries = entries;
    this.#hasTransformEntries = hasTransformEntries;
    this.#authorityNode = hasTransformEntries ? node : undefined;
    this.#duration = armed.duration;
    for (const entry of entries) {
      claimProperty(
        entry.binding.owner,
        entry.binding.key,
        entry.path,
        entry.claim,
      );
    }
    this.#elapsed = 0;
    this.#cursor = CURSOR_BEFORE_START;
    this.#finished = false;
    this.#state = "running";
    this.#setElapsed(0, "silent");
    return this;
  }

  /** Suspends advancing. A no-op unless the mixer is `"running"`. */
  pause(): this {
    if (this.#state === "running") {
      this.#state = "paused";
    }
    return this;
  }

  /** Resumes advancing. A no-op unless the mixer is `"paused"`. */
  resume(): this {
    if (this.#state === "paused") {
      this.#state = "running";
    }
    return this;
  }

  /**
   * Stops playback and releases every §16 property claim, leaving all animated
   * values exactly where the last write put them.
   *
   * A stopped mixer never writes again — even a later {@link AnimationMixer.seek}
   * is inert — and the properties it held are free for another writer to claim
   * without a conflict warning. A no-op on an `"idle"` mixer, which holds
   * nothing.
   */
  stop(): this {
    if (this.#state === "idle") {
      return this;
    }
    this.#releaseClaims();
    for (const entry of this.#entries) {
      entry.claim.held = false;
    }
    this.#state = "stopped";
    return this;
  }

  /**
   * Sets the playback speed multiplier — legal at any time, including
   * mid-playback, because §107 lists it as a playback *control*.
   *
   * Must be positive and finite. Reverse playback is deliberately not
   * `speed(-1)`: §16 gives reversing to `Timeline`, and a negative multiplier
   * here would make "the advance that finishes playback" ambiguous and event
   * crossing (a forward notion) meaningless. Scrub backwards with
   * {@link AnimationMixer.seek}.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — not finite and `> 0`.
   */
  speed(multiplier: number): this {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      invalidMixer(
        `AnimationMixer speed must be a finite multiplier > 0; received ${String(multiplier)}. Reverse playback is a Timeline feature (§16).`,
        { multiplier },
      );
    }
    this.#speed = multiplier;
    return this;
  }

  /**
   * Sets the number of **total** iterations: `loop(1)` is the default single
   * pass, `loop(3)` plays the clip three times, `loop(Infinity)` never ends.
   * Clip events re-arm on every wrap, so a marker on a `loop(3)` playback fires
   * three times.
   *
   * Legal mid-playback, like {@link AnimationMixer.speed}: it only changes
   * {@link AnimationMixer.totalDuration}, which the next advance reads.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — not an integer `>= 1` or
   * `Infinity`.
   */
  loop(count: number): this {
    if (count !== Infinity && (!Number.isInteger(count) || count < 1)) {
      invalidMixer(
        `AnimationMixer loop count must be an integer >= 1 or Infinity (it counts total iterations, not extra ones); received ${String(count)}.`,
        { count },
      );
    }
    this.#iterations = count;
    return this;
  }

  /**
   * Advances playback by `deltaSeconds × speed` and writes the resulting pose.
   * Called by the fixed-step `AnimationSystem` (plan P4-1) with the simulation's
   * fixed delta; a mixer never advances itself and never reads a clock (§33).
   *
   * Clip events in the crossed range fire in time order, once each — including
   * one exactly at the end of the range and excluding one exactly at its start,
   * so consecutive advances neither miss an event nor repeat one. A delta that
   * spans an iteration boundary fires the rest of that iteration's events,
   * re-arms them, and continues into the next.
   *
   * A no-op unless the mixer is `"running"` and unfinished. The advance that
   * reaches {@link AnimationMixer.totalDuration} clamps to it, writes the final
   * pose, and releases the property claims (a finished mixer can still be
   * scrubbed, exactly as a finished tween can).
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the delta is negative or
   * non-finite.
   */
  advance(deltaSeconds: number): this {
    requireNonNegativeSeconds(deltaSeconds, "AnimationMixer advance delta");
    if (this.#state !== "running" || this.#finished) {
      return this;
    }
    const total = this.totalDuration;
    let target = this.#elapsed + deltaSeconds * this.#speed;
    if (target >= total) {
      target = total;
      this.#finished = true;
    }
    this.#setElapsed(target, "play");
    if (this.#finished) {
      this.#state = "finished";
      this.#releaseClaims();
    }
    return this;
  }

  /**
   * Positions playback at `timeSeconds` of **elapsed** time and writes the pose
   * for it — §16's scrubbing, and the positioning half of a snapshot restore
   * (§34).
   *
   * Pure: seeking twice to the same time writes identical values, and seeking
   * backwards is as valid as forwards. Neither {@link AnimationMixer.state} nor
   * {@link AnimationMixer.finished} changes, so a seek is an evaluation and
   * never a playback decision.
   *
   * The time is clamped to `[0, totalDuration]` — **elapsed** time, spanning
   * every loop iteration, not one iteration's clip time. It therefore differs
   * from `Timeline.seek`, which clamps to a single iteration: a mixer is
   * *placed* on a timeline by its total duration, so a looping mixer driven by a
   * timeline has to be addressable across its loops, and scrubbing a three-loop
   * clip through all three loops is meaningful in a way that scrubbing a
   * timeline "into iteration 2" is not. With the default `loop(1)` the two
   * conventions coincide.
   *
   * Events are suppressed unless the playback opted in with
   * `{ replayOnSeek: true }`, in which case a *forward* seek fires the events it
   * crosses (§16). A backward seek fires nothing and re-arms the events it
   * rewound past, so replaying forwards crosses them again — which is exactly
   * what "restoring a mid-clip snapshot positions playback without re-firing
   * markers already crossed" needs.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the mixer has never been
   * played, or the time is negative or non-finite.
   */
  seek(timeSeconds: number): this {
    requireNonNegativeSeconds(timeSeconds, "AnimationMixer seek time");
    if (this.#state === "idle") {
      invalidMixer(
        "AnimationMixer.seek() requires play() first: bindings are resolved at play.",
        { timeSeconds },
      );
    }
    // A stopped mixer is inert in every respect: its entries refuse writes, and
    // firing an event with no animation behind it would be a bare side effect.
    const mode: EventMode = this.#state === "stopped" ? "silent" : "seek";
    const total = this.totalDuration;
    this.#setElapsed(timeSeconds > total ? total : timeSeconds, mode);
    return this;
  }

  // --- internals ----------------------------------------------------------

  /**
   * Rejects a track whose bound property cannot hold the track's value type.
   *
   * `createBinding` was given the track's adapter, so it accepted the property
   * without inspecting it (§16's "typed property reference" form, where the
   * caller owns the type). This is that inspection, done once at play rather
   * than never: `detectAdapter` reports what the property actually holds, and a
   * `vector3` track bound to a number is a configuration error, not a runtime
   * surprise. Discrete tracks bind to anything — assignment always works — which
   * is also the escape hatch for a property whose type is not detectable.
   */
  #assertBindable(
    clip: AnimationClip,
    track: AnimationTrackLike,
    binding: PropertyBinding,
  ): void {
    const adapter: ValueAdapter<unknown> = track.adapter;
    if (adapter.kind === "discrete") {
      return;
    }
    const detected = detectAdapter(binding.get());
    if (detected === undefined || detected.kind !== adapter.kind) {
      invalidMixer(
        `Animation clip "${clip.name}" has a ${adapter.kind} track on "${track.path}", but that property holds ${detected === undefined ? "a value of no known type" : `a ${detected.kind}`}. Fix the path, the track's adapter, or use a discrete track.`,
        {
          clip: clip.name,
          path: track.path,
          expected: adapter.kind,
          received: detected?.kind,
        },
      );
    }
  }

  /** Zero-based iteration index containing `elapsed`. */
  #iterationAt(elapsed: number): number {
    const duration = this.#duration;
    if (duration <= 0) {
      return 0;
    }
    const last = this.#iterations - 1;
    const index = Math.floor(elapsed / duration);
    return index > last ? last : index;
  }

  /**
   * Clip-local time inside the iteration containing `elapsed`.
   *
   * The first iteration is returned unshifted rather than as
   * `elapsed - 0 * duration`, so an infinite `duration` cannot produce
   * `0 * Infinity === NaN`. Landing exactly on the end of the final iteration
   * reads as `duration`, not as `0` of an iteration that does not exist.
   */
  #localAt(elapsed: number): number {
    const iteration = this.#iterationAt(elapsed);
    return iteration === 0 ? elapsed : elapsed - iteration * this.#duration;
  }

  /**
   * Moves to `target` elapsed seconds, writing the pose and firing whatever
   * `mode` allows across the range the move crossed.
   *
   * Forward moves walk the iterations they span so events re-arm on every wrap;
   * backward moves fire nothing and reposition the cursor, which re-arms the
   * events they rewound past. A clip with no events skips the walk entirely —
   * with nothing to fire, intermediate iterations are unobservable, and the pose
   * depends only on the final time.
   */
  #setElapsed(target: number, mode: EventMode): void {
    const from = this.#cursor;
    this.#elapsed = target;

    const eventless = (this.#clip as AnimationClip).events.length === 0;
    if (mode === "silent" || eventless || !(target > from)) {
      this.#applyPose(this.#localAt(target));
      if (mode !== "silent") {
        // Rewinding to the very start re-arms events at clip time 0, exactly as
        // play() does; any other position is its own exclusive lower bound.
        this.#cursor = target === 0 ? CURSOR_BEFORE_START : target;
      }
      return;
    }

    const duration = this.#duration;
    const lastIteration = this.#iterationAt(target);
    const firstIteration = from <= 0 ? 0 : this.#iterationAt(from);
    for (
      let iteration = firstIteration;
      iteration <= lastIteration;
      iteration += 1
    ) {
      const localTo =
        iteration === lastIteration ? this.#localAt(target) : duration;
      // As in `#localAt`: never `0 * Infinity`.
      const localFrom = iteration === 0 ? from : from - iteration * duration;
      this.#applyPose(localTo);
      this.#fireEvents(localFrom, localTo, mode);
    }
    this.#cursor = target;
  }

  /**
   * Samples every track at clip-local `local` and writes the results, in
   * `clip.tracks` order (§33: insertion order only), so two tracks on one
   * property resolve last-declared-wins.
   *
   * §42 is enforced here with `Tween`'s semantics: if any bound track sits
   * inside the authority node's transform and that node is not owned by
   * `"animation"`, the conflict is reported once (deduplicated per node per
   * writer by `warnAuthorityConflict`) and **every** transform write of this
   * evaluation is skipped — never a partial pose. Non-transform tracks are
   * unaffected, and the moment authority is granted the next write lands on the
   * value for the current time, because evaluation never depended on the writes
   * that were refused.
   *
   * Allocates nothing.
   */
  #applyPose(local: number): void {
    this.#allowTransform = true;
    if (this.#hasTransformEntries) {
      // `#authorityNode` is defined whenever `#hasTransformEntries` is true: an
      // entry can only be a transform entry if a node was resolved.
      const node = this.#authorityNode as Node;
      if (node.transformAuthority !== MIXER_AUTHORITY) {
        warnAuthorityConflict(node, MIXER_AUTHORITY);
        this.#allowTransform = false;
      }
    }
    (this.#clip as AnimationClip).sampleAll(local, this.#sink);
  }

  /** Writes one sampled value through its binding. See `./values.js` on `out`. */
  #write(entry: MixerEntry, value: unknown): void {
    if (!entry.claim.held || (entry.isTransform && !this.#allowTransform)) {
      return;
    }
    entry.binding.set(value);
    if (entry.notifyChange) {
      // A primitive write is a direct field write and bypasses plan D3's change
      // hook; re-fire it so `Transform.version` still advances.
      (entry.binding.owner as { onChanged?: () => void }).onChanged?.();
    }
  }

  /**
   * Fires the clip events in the half-open range `(localFrom, localTo]` — the
   * crossing convention of `AnimationClip.eventsInRange`, which owns the search.
   * In `"seek"` mode nothing fires unless the playback opted in. Allocation-free.
   */
  #fireEvents(localFrom: number, localTo: number, mode: EventMode): void {
    if (mode === "seek" && !this.#replayOnSeek) {
      return;
    }
    (this.#clip as AnimationClip).eventsInRange(
      localFrom,
      localTo,
      this.#visitEvent,
    );
  }

  /** Frees every registry slot this mixer still owns (§16). */
  #releaseClaims(): void {
    for (const entry of this.#entries) {
      releaseProperty(entry.binding.owner, entry.binding.key, entry.claim);
    }
  }
}
