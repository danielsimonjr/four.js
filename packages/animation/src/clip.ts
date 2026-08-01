/**
 * Animation clips (§17).
 *
 * A clip is §17's container: a name, a duration in seconds, a list of
 * {@link ./track.js#AnimationTrack}s, and a list of {@link AnimationEvent}s.
 *
 * ```ts
 * class AnimationClip {
 *   name: string;
 *   duration: number;
 *   tracks: AnimationTrack[];
 *   events: AnimationEvent[];
 * }
 * ```
 *
 * Like a track, a clip is **data**: it holds no bindings, no playback state, and
 * no target. Time is clip-local seconds throughout (§9: "animation time is
 * clip-local and lives on players and timelines (§16-17), not in the global
 * `TimeState`"; §7a: everything is seconds). Two players can run the same clip
 * at different times on different targets with no interference, which is what
 * makes evaluation a pure function of clip time (§16) and therefore replayable
 * (§34).
 *
 * ## The clip does not fire events
 *
 * {@link AnimationClip.eventsInRange} *reports* which events a time interval
 * crossed; it never calls anything. Firing is the mixer's job (WP-4.6), because
 * §16's marker semantics — fire exactly once per forward crossing, suppress on
 * seek and scrub unless a marker opts in, restore a snapshot without re-firing —
 * are all statements about a *player's* history, and a clip has no history.
 *
 * ## Deviations from the §17 sketch, stated
 *
 * `name` and `duration` are mutable fields exactly as §17 writes them.
 * `tracks` and `events` are `readonly` arrays: {@link
 * AnimationClip.eventsInRange} binary-searches `events` and would return wrong
 * answers if a caller pushed an out-of-order event, and a mixer caches one
 * binding per track index (see {@link TrackSampleSink}) which a mutated
 * `tracks` would silently invalidate. Building a new clip is cheap; corrupting
 * a live one is not.
 */

import { FourError } from "@four/core";

import type { AnimationTrackLike } from "./track.js";

/**
 * A named marker at a clip-local time (§17), delivered by the mixer with §16's
 * crossing semantics.
 *
 * Fields are `readonly`: a clip keeps its events in time order, and a mutable
 * `time` would let that order rot underneath the binary search.
 */
export interface AnimationEvent {
  /** Clip-local time in seconds. Must be finite. */
  readonly time: number;
  /** Marker name, matched by whatever listens for it. */
  readonly name: string;
  /** Optional payload, passed through untouched. */
  readonly payload?: unknown;
}

/**
 * Where {@link AnimationClip.sampleAll} gets its scratch and sends its results.
 *
 * Split in two so the clip can sample without allocating and without knowing
 * anything about targets. The mixer implements it over arrays indexed the same
 * way as {@link AnimationClip.tracks}: one `PropertyBinding` per track, resolved
 * once (§16), and one scratch value per track, allocated once.
 *
 * ```ts
 * const sink: TrackSampleSink = {
 *   outFor: (index) => scratch[index],
 *   applySample: (index, _track, value) => { bindings[index].set(value); },
 * };
 * clip.sampleAll(localTime, sink);          // allocates nothing
 * ```
 *
 * The two-step shape exists because of the `mutatesInPlace` split in
 * `./values.js`: for a Vector3 track the sampled value *is* the scratch object
 * handed out by `outFor`, while for a number track it is a fresh primitive that
 * `outFor`'s storage never saw. Passing the result back through `applySample`
 * is the only way to serve both without branching per sample.
 */
export interface TrackSampleSink {
  /**
   * Storage for track `trackIndex`'s sample. Must be a value of that track's
   * type and must not alias one of its keyframe values. Ignored — but still
   * requested — for value kinds whose adapter reports
   * `mutatesInPlace: false`.
   */
  outFor(trackIndex: number, track: AnimationTrackLike): unknown;

  /**
   * Receives the effective sampled value for track `trackIndex` — the object
   * returned by {@link TrackSampleSink.outFor} for in-place kinds, the sampled
   * primitive or discrete value otherwise.
   */
  applySample(
    trackIndex: number,
    track: AnimationTrackLike,
    value: unknown,
  ): void;
}

/** Visitor for {@link AnimationClip.eventsInRange}. */
export type AnimationEventVisitor = (
  event: AnimationEvent,
  index: number,
) => void;

/** Construction inputs for {@link AnimationClip}. */
export interface AnimationClipOptions {
  /** Clip name, used for lookup and diagnostics. */
  name: string;

  /**
   * The clip's tracks, in evaluation order. Copied; the tracks themselves are
   * shared, which is safe because a track is immutable data.
   */
  tracks: readonly AnimationTrackLike[];

  /**
   * Markers on the clip's timeline. Copied and sorted by time; see
   * {@link AnimationClip.events} for the tie-break rule.
   */
  events?: readonly AnimationEvent[];

  /**
   * Clip length in seconds. Defaults to the largest of every track's last
   * keyframe time, every event's time, and `0` — the natural extent of the
   * authored content. Must be finite and non-negative.
   */
  duration?: number;
}

/** Throws the §89 error used for every malformed clip. */
function invalidClip(message: string, context: Record<string, unknown>): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/** True when `events` is already non-decreasing in time. */
function isSortedByTime(events: readonly AnimationEvent[]): boolean {
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].time < events[index - 1].time) {
      return false;
    }
  }
  return true;
}

/**
 * §17's animation clip: named, timed, tracks plus events.
 *
 * ```ts
 * const clip = new AnimationClip({
 *   name: "wave",
 *   tracks: [rotationTrack, colorTrack],
 *   events: [{ time: 0.5, name: "footstep" }],
 * });
 * ```
 */
export class AnimationClip {
  /** Clip name (§17). */
  name: string;

  /**
   * Clip length in seconds (§17, §7a). Metadata, not a limit: tracks clamp to
   * their own key range and a player decides what happens past the end.
   */
  duration: number;

  /**
   * The clip's tracks, in evaluation order (§17).
   *
   * Order is the array's order, forever — insertion order, never sorted or
   * de-duplicated (§33: iterate collections in insertion order only). Two
   * tracks on the same path are allowed and the later one wins, because that is
   * what applying them in order does; the mixer, which owns conflict policy
   * (§16), is where a warning belongs.
   */
  readonly tracks: readonly AnimationTrackLike[];

  /**
   * The clip's events (§17), **sorted by time**.
   *
   * The constructor sorts a copy when the input is out of order and leaves an
   * already-sorted input in its given order. The sort is stable, so events
   * sharing a time keep their construction order and fire in it — a
   * deterministic tie-break (§33) rather than whatever the engine's sort
   * happened to do.
   */
  readonly events: readonly AnimationEvent[];

  /**
   * @throws FourError `INVALID_APPLICATION_STATE` — an empty name, a non-finite
   * event time, or a `duration` that is not a finite non-negative number of
   * seconds.
   */
  constructor(options: AnimationClipOptions) {
    if (options.name.length === 0) {
      invalidClip("An animation clip needs a non-empty name.", {
        name: options.name,
      });
    }

    const givenEvents = options.events ?? [];
    for (let index = 0; index < givenEvents.length; index += 1) {
      const time = givenEvents[index].time;
      if (!Number.isFinite(time)) {
        invalidClip(
          `Animation clip "${options.name}" has a non-finite time on event "${givenEvents[index].name}" at index ${String(index)}: ${String(time)}.`,
          { name: options.name, index, time },
        );
      }
    }
    const events = [...givenEvents];
    if (!isSortedByTime(events)) {
      // Stable since ES2019, so equal times keep their construction order.
      events.sort((a, b) => a.time - b.time);
    }

    const tracks = [...options.tracks];
    let duration = options.duration;
    if (duration === undefined) {
      duration = 0;
      for (const track of tracks) {
        duration = Math.max(duration, track.endTime);
      }
      if (events.length > 0) {
        duration = Math.max(duration, events[events.length - 1].time);
      }
    } else if (!Number.isFinite(duration) || duration < 0) {
      invalidClip(
        `Animation clip "${options.name}" duration must be a finite non-negative number of seconds (§7a); received ${String(duration)}.`,
        { name: options.name, duration },
      );
    }

    this.name = options.name;
    this.duration = duration;
    this.tracks = tracks;
    this.events = events;
  }

  /**
   * Samples every track at `timeSeconds` (clip-local) and hands each result to
   * `sink`, in {@link AnimationClip.tracks} order (§33: insertion order only).
   *
   * Allocates nothing, provided the sink's `outFor` returns pre-allocated
   * storage. This is the whole of the clip's contribution to the mixer's inner
   * loop: ordered iteration, with the guarantee that a track's index here is the
   * same index it had when the mixer resolved its binding.
   */
  sampleAll(timeSeconds: number, sink: TrackSampleSink): void {
    const tracks = this.tracks;
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      const value = track.sample(timeSeconds, sink.outFor(index, track));
      sink.applySample(index, track, value);
    }
  }

  /**
   * Visits every event in the **half-open interval `(fromExclusive,
   * toInclusive]`** — `event.time > fromExclusive && event.time <= toInclusive`
   * — in time order, and returns how many were visited.
   *
   * ## Why half-open, precisely
   *
   * Forward playback advances clip time in steps: `(t₀ → t₁]`, `(t₁ → t₂]`, …
   * Because each step excludes its start and includes its end, consecutive
   * steps partition the timeline: **every event fires exactly once**, and an
   * event landing exactly on a step boundary fires with the step that *reaches*
   * it, never with the one that leaves it. That is §16's "exactly once per
   * forward crossing" reduced to arithmetic.
   *
   * Consequences worth stating outright:
   *
   * - an event at exactly `toInclusive` **is** visited; one at exactly
   *   `fromExclusive` is **not**;
   * - an empty range (`fromExclusive === toInclusive`) visits nothing, so a
   *   paused player crossing no time fires nothing;
   * - a reversed range (`toInclusive < fromExclusive`) visits nothing and
   *   returns `0`. Reverse playback is not "the same thing backwards": §16
   *   defines marker crossing as a *forward* notion, so a player running in
   *   reverse decides its own policy rather than getting a silent guess here;
   * - an event at time `0` needs `fromExclusive < 0` to fire. A player starting
   *   at `0` therefore begins its first step from a value below zero (or fires
   *   the zero-time events explicitly on start) — a deliberate consequence of
   *   the rule that no event fires twice.
   *
   * The visitor receives the event and its index into
   * {@link AnimationClip.events}. Allocation-free with a hoisted visitor: the
   * scan is a binary search for the first event past `fromExclusive` followed by
   * a walk.
   */
  eventsInRange(
    fromExclusive: number,
    toInclusive: number,
    visit: AnimationEventVisitor,
  ): number {
    if (!(toInclusive > fromExclusive)) {
      return 0;
    }
    const events = this.events;
    let visited = 0;
    for (
      let index = this.indexOfFirstEventAfter(fromExclusive);
      index < events.length && events[index].time <= toInclusive;
      index += 1
    ) {
      visit(events[index], index);
      visited += 1;
    }
    return visited;
  }

  /**
   * Index of the first event with `time > timeExclusive`, or
   * `events.length` when there is none.
   *
   * The positioning primitive behind {@link AnimationClip.eventsInRange}, and
   * the one a seek uses on its own: jumping to time `t` sets the cursor here so
   * that already-crossed markers are skipped rather than re-fired (§16).
   * Binary search; allocation-free.
   */
  indexOfFirstEventAfter(timeExclusive: number): number {
    const events = this.events;
    let low = 0;
    let high = events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (events[middle].time > timeExclusive) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return low;
  }
}
