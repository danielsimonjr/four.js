/**
 * Timelines (§16).
 *
 * §16's example is the whole shape of the thing:
 *
 * ```ts
 * const timeline = new Timeline();
 * timeline
 *   .at(0, tween(node.position, { x: 5 }, 0.8))
 *   .at(0.25, tween(node, { opacity: 0.5 }, 0.5))
 *   .at(1.0, () => console.log("complete"));
 * timeline.play();
 * ```
 *
 * A timeline places three kinds of entry on one local time axis: `Tween`s,
 * other {@link Timeline}s (nesting), and callbacks (event markers). Everything
 * §16 asks for is expressed over that axis — sequencing is "a later `at`",
 * parallel tracks are "two entries at the same time", and scrubbing, looping,
 * reversing, and playback speed are all statements about how the axis is
 * traversed.
 *
 * ## Values are a pure function of time; markers are not
 *
 * §16 splits the two deliberately, and so does this module:
 *
 * - **Values.** Every evaluation — an {@link Timeline.advance}, a
 *   {@link Timeline.seek}, a {@link Timeline.scrub} — positions *every* child at
 *   its mapped local time and lets the child write. Children whose window has
 *   not started are written at their start pose, children whose window has ended
 *   at their end pose. Nothing integrates, so evaluating twice at the same time
 *   writes byte-identical values and scrubbing backwards is exactly as valid as
 *   scrubbing forwards. This is why children are driven through
 *   `seek(childLocalTime)` and never through their own `advance`: advancing and
 *   scrubbing are then literally the same code path.
 *
 * - **Markers.** A callback fires *once per forward crossing* during playback.
 *   Crossings use the half-open interval `(fromExclusive, toInclusive]` — the
 *   same convention as `AnimationClip.eventsInRange`, for the same reason:
 *   consecutive steps partition the axis, so no marker is missed and none fires
 *   twice. `seek`/`scrub` fire nothing unless the marker opted in with
 *   `{ replayOnSeek: true }`, and nothing fires while moving backwards, because
 *   §16 defines crossing as a forward notion.
 *
 * ### Markers at time 0
 *
 * `clip.ts` states the consequence of the half-open rule outright: "an event at
 * time `0` needs `fromExclusive < 0` to fire. A player starting at `0` therefore
 * begins its first step from a value below zero (or fires the zero-time events
 * explicitly on start)." A timeline is that player, and it takes the first
 * option: {@link Timeline.play} positions the cursor at
 * {@link CURSOR_BEFORE_START}, *below* every legal marker time, and writes the
 * start pose without firing anything. The first `advance` — including
 * `advance(0)` — therefore fires markers at exactly time 0, and fires them
 * exactly once. Wrapping into a new loop iteration re-arms them the same way.
 *
 * ## No clocks (plan P4-1, §33)
 *
 * A timeline never reads a clock. Local time moves only through
 * {@link Timeline.advance}, which the fixed-step `AnimationSystem` (WP-4.6)
 * calls, and through {@link Timeline.seek}. Entries are stored and iterated in
 * insertion order; markers sharing a time fire in insertion order (a stable
 * sort). Nothing here touches `Date.now`, `performance.now`, or `Math.random`.
 *
 * ## Allocation (§7b)
 *
 * {@link Timeline.play} allocates (one sorted marker array). After that the
 * advance path allocates nothing: indexed loops, a binary search, and child
 * `seek` calls that are themselves allocation-free.
 */

import { FourError } from "@four/core";

/**
 * The cursor value that means "before the start of an iteration".
 *
 * Marker times are validated as finite and `>= 0`, so any negative number is
 * strictly below all of them; `-1` is chosen over `-Infinity` because the cursor
 * takes part in arithmetic (`cursor - iteration * duration`) where an infinity
 * would produce `NaN`. It is a sentinel, not an epsilon: no marker time can ever
 * land on or below it.
 */
const CURSOR_BEFORE_START = -1;

/**
 * Playback state of a {@link Timeline}. Deliberately the same vocabulary as
 * `TweenState`, so {@link TimelineChild} covers both.
 *
 * - `"idle"` — built but never played; children are unplayed and unclaimed.
 * - `"running"` — {@link Timeline.advance} moves it.
 * - `"paused"` — {@link Timeline.resume} puts it back to `"running"`.
 * - `"finished"` — playback reached the end (or, in reverse, time 0). Values can
 *   still be scrubbed.
 * - `"stopped"` — {@link Timeline.stop} was called; every child is stopped and
 *   has released its property claims.
 */
export type TimelineState =
  "idle" | "running" | "paused" | "finished" | "stopped";

/** A §16 event marker: a callback placed at a time on the timeline. */
export type TimelineMarkerCallback = () => void;

/** Per-marker policy (§16). */
export interface TimelineMarkerOptions {
  /**
   * Whether the marker also fires when a {@link Timeline.seek} or
   * {@link Timeline.scrub} crosses it moving forward — §16's "opt-in per-marker
   * replay-on-seek policy". Defaults to `false`, so seeking is silent.
   *
   * A backward seek never fires it: crossing is a forward notion (§16), and the
   * same rule that makes `eventsInRange` return nothing for a reversed range
   * applies here.
   */
  readonly replayOnSeek?: boolean;
}

/**
 * What a timeline can drive: a `Tween` or another {@link Timeline}.
 *
 * Structural rather than a union of the two classes, so the timeline states its
 * actual requirements — a total duration, playback that can be started and
 * stopped, and pure evaluation by local time — and so a future player (a clip
 * player, WP-4.6) satisfies it without this file importing it.
 */
export interface TimelineChild {
  /** Playback state; {@link Timeline.at} accepts only `"idle"` children. */
  readonly state: TimelineState;
  /** Full length in seconds, including the child's own repeats or loops. */
  readonly totalDuration: number;
  /** Called once, by {@link Timeline.play}, in `at()` insertion order. */
  play(): unknown;
  /** Called by {@link Timeline.stop}; releases the child's property claims. */
  stop(): unknown;
  /** Pure evaluation at a child-local time in seconds. */
  seek(timeSeconds: number): unknown;
}

/** Anything {@link Timeline.at} accepts. */
export type TimelineEntry = TimelineChild | TimelineMarkerCallback;

/** How an evaluation treats markers. */
type MarkerMode =
  /** Playback: every marker in the crossed range fires. */
  | "play"
  /** Seek/scrub: only `replayOnSeek` markers fire. */
  | "seek"
  /** Pose only: nothing fires and no cursor moves. */
  | "silent";

/** A child placed on the axis. */
interface ChildEntry {
  /** Start time on the parent's local axis, in seconds. */
  readonly at: number;
  /** The child itself. */
  readonly child: TimelineChild;
  /**
   * The same object when the child is a {@link Timeline}, `undefined` for
   * anything else. Nested timelines need marker crossing pushed into them,
   * which is more than {@link TimelineChild} exposes.
   */
  readonly nested: Timeline | undefined;
}

/** A marker placed on the axis. */
interface MarkerEntry {
  /** Time on the local axis, in seconds. */
  readonly at: number;
  /** The §16 callback. */
  readonly callback: TimelineMarkerCallback;
  /** See {@link TimelineMarkerOptions.replayOnSeek}. */
  readonly replayOnSeek: boolean;
}

/** Throws the §89 error used for every malformed timeline configuration. */
function invalidTimeline(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/** Rejects anything that is not a finite number `>= 0` (§7a: seconds). */
function requireNonNegativeSeconds(value: number, what: string): number {
  if (!Number.isFinite(value) || value < 0) {
    invalidTimeline(
      `${what} must be a finite number of seconds >= 0 (§7a: all times are seconds); received ${String(value)}.`,
      { value },
    );
  }
  return value;
}

/**
 * §16's timeline.
 *
 * ## The two time axes
 *
 * ```text
 * elapsed  0 ─────── d ─────── 2d ─────── 3d      (loop(3), monotonic)
 * local    0 ─── d   0 ─── d   0 ─── d            (what children see)
 * ```
 *
 * {@link Timeline.localTime} is a position inside one iteration and is what
 * children are mapped from; `elapsed` is total played time and is what marker
 * bookkeeping runs in, because it only ever moves forward during forward
 * playback. Looping then needs no special case: a marker at local time `m`
 * simply occurs at `m`, `m + d`, `m + 2d`, … and the half-open crossing rule
 * fires each of those exactly once.
 *
 * ## Child mapping
 *
 * A child placed at `s` with total duration `w` is evaluated at
 * `clamp(localTime - s, 0, w)`:
 *
 * ```text
 * localTime:   0        s            s + w        d
 *              │ start  │ ─ mapped ─ │  end pose  │
 * ```
 *
 * Outside its window a child holds a boundary pose — its start pose before,
 * its end pose after — which is what makes the whole timeline a pure function of
 * time. The consequence is worth stating: a timeline keeps writing its
 * children's properties for its entire duration, so a finished child still owns
 * its property until the timeline stops. That is the point; anything else would
 * make scrubbing backwards impossible.
 */
export class Timeline {
  /** Children in `at()` insertion order (§33). */
  readonly #children: ChildEntry[] = [];

  /** Markers in `at()` insertion order; the firing order is {@link #ordered}. */
  readonly #markers: MarkerEntry[] = [];

  /** Markers sorted by time (stable), built once at {@link Timeline.play}. */
  #ordered: MarkerEntry[] = [];

  /** Labels by name, in insertion order. */
  readonly #labels = new Map<string, number>();

  /** One iteration's length in seconds; cached at play (see `duration`). */
  #duration = 0;

  /** Total iterations: `1` plays once, `Infinity` loops forever. */
  #iterations = 1;

  /** Multiplier applied to every {@link Timeline.advance} delta. */
  #speed = 1;

  /** Whether playback runs toward time 0. */
  #reversed = false;

  /** See {@link TimelineState}. */
  #state: TimelineState = "idle";

  /** Total played time in seconds, across loop iterations. */
  #elapsed = 0;

  /** Exclusive lower bound of the next crossing range, in elapsed seconds. */
  #cursor = CURSOR_BEFORE_START;

  /** Whether playback reached its end (or, reversed, time 0). */
  #finished = false;

  // --- introspection ------------------------------------------------------

  /**
   * Length of one iteration in seconds: the largest of every child's
   * `at + totalDuration` and every marker's time, or `0` when empty.
   *
   * **Labels do not extend the duration.** A label names a time; it is a
   * bookmark, not content, and `addLabel("end", 30)` on a two-second timeline
   * describes a place, not two extra minutes of nothing. Markers *do* extend it,
   * because a marker is authored content that must be reachable by playback.
   *
   * `Infinity` when a child never ends (`tween.repeat(Infinity)` or a nested
   * `loop(Infinity)`), in which case the timeline never finishes either.
   *
   * Computed live while `"idle"` — children may still be configured — and frozen
   * at {@link Timeline.play}, which is also when {@link Timeline.at} stops being
   * legal.
   */
  get duration(): number {
    return this.#state === "idle" ? this.#computeDuration() : this.#duration;
  }

  /**
   * `duration × loopCount` — the elapsed time at which playback finishes.
   * `Infinity` for `loop(Infinity)`, and `0` for an empty timeline (where
   * `0 × Infinity` would otherwise be `NaN`).
   */
  get totalDuration(): number {
    const duration = this.duration;
    return duration <= 0 ? 0 : duration * this.#iterations;
  }

  /** Position inside the current iteration, in seconds. */
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

  /** Current playback state. */
  get state(): TimelineState {
    return this.#state;
  }

  /**
   * Whether playback has reached its end.
   *
   * A playback fact, not a time fact: {@link Timeline.seek} never sets or clears
   * it, exactly as on a tween, so scrubbing a finished timeline inspects values
   * without pretending it is running again.
   */
  get finished(): boolean {
    return this.#finished;
  }

  /** Whether {@link Timeline.reverse} put playback into reverse. */
  get reversed(): boolean {
    return this.#reversed;
  }

  /** The {@link Timeline.speed} multiplier. */
  get playbackSpeed(): number {
    return this.#speed;
  }

  /** Total iterations set by {@link Timeline.loop}; `1` by default. */
  get loopCount(): number {
    return this.#iterations;
  }

  // --- authoring ----------------------------------------------------------

  /**
   * Places an entry on the axis at `at` seconds, or at a label's time when `at`
   * is a string (§16: labels).
   *
   * The entry is one of:
   *
   * - a **`Tween`**, which must be unplayed — the timeline owns its
   *   playback and plays it at {@link Timeline.play}, so the §16 conflict
   *   registry claims happen there, in `at()` insertion order;
   * - a **{@link Timeline}**, nested; the parent drives it and it must likewise
   *   be unplayed;
   * - a **callback**, which *is* an event marker (§16). `options` configures it.
   *
   * ```ts
   * timeline
   *   .addLabel("impact", 1.2)
   *   .at(0, tween(node.position, { x: 5 }, 0.8))
   *   .at("impact", () => spawnDust(), { replayOnSeek: true });
   * ```
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Timeline.play}; the time is negative or non-finite; the label is
   * unknown; the child has already been played or is already on this timeline;
   * the entry would nest this timeline inside itself; or `options` is given for
   * something that is not a marker.
   */
  at(
    at: number | string,
    entry: TimelineEntry,
    options?: TimelineMarkerOptions,
  ): this {
    this.#assertAuthorable("at");
    const time =
      typeof at === "string"
        ? this.labelTime(at)
        : requireNonNegativeSeconds(at, "Timeline entry time");

    if (typeof entry === "function") {
      this.#markers.push({
        at: time,
        callback: entry,
        replayOnSeek: options?.replayOnSeek ?? false,
      });
      return this;
    }

    if (options !== undefined) {
      invalidTimeline(
        "Timeline.at() marker options apply to callback markers only (§16); a tween or nested timeline configures itself.",
        { at: time },
      );
    }
    if (entry.state !== "idle") {
      invalidTimeline(
        `Timeline.at() requires an unplayed child: the timeline owns its playback and plays it at play(). Received a child in state "${entry.state}".`,
        { at: time, state: entry.state },
      );
    }
    for (let index = 0; index < this.#children.length; index += 1) {
      if (this.#children[index].child === entry) {
        invalidTimeline(
          "Timeline.at() was given a child it already holds; place a second tween instead of reusing one, so each entry has one window.",
          { at: time },
        );
      }
    }
    const nested = entry instanceof Timeline ? entry : undefined;
    if (nested !== undefined && (nested === this || nested.#contains(this))) {
      invalidTimeline(
        "Timeline.at() would nest a timeline inside itself, which has no finite evaluation.",
        { at: time },
      );
    }
    this.#children.push({ at: time, child: entry, nested });
    return this;
  }

  /**
   * Names a time on the axis (§16: labels), for {@link Timeline.at} and
   * {@link Timeline.seek}.
   *
   * Names are unique: redefining one throws rather than silently moving every
   * entry that was placed by name.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Timeline.play}; the name is empty or already defined; or the time is
   * negative or non-finite.
   */
  addLabel(name: string, timeSeconds: number): this {
    this.#assertAuthorable("addLabel");
    if (name.length === 0) {
      invalidTimeline("A timeline label needs a non-empty name.", { name });
    }
    if (this.#labels.has(name)) {
      invalidTimeline(
        `Timeline label "${name}" is already defined at ${String(this.#labels.get(name))}s; labels are unique.`,
        { name, timeSeconds },
      );
    }
    this.#labels.set(
      name,
      requireNonNegativeSeconds(timeSeconds, `Timeline label "${name}"`),
    );
    return this;
  }

  /** Whether {@link Timeline.addLabel} defined `name`. */
  hasLabel(name: string): boolean {
    return this.#labels.has(name);
  }

  /**
   * The time in seconds that `name` was defined at.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the label is unknown.
   */
  labelTime(name: string): number {
    const time = this.#labels.get(name);
    if (time === undefined) {
      invalidTimeline(
        `Timeline has no label "${name}"; add it with addLabel(name, timeSeconds) before naming it.`,
        { name, labels: [...this.#labels.keys()] },
      );
    }
    return time;
  }

  // --- playback configuration ---------------------------------------------

  /**
   * Multiplier applied to every {@link Timeline.advance} delta, and to the delta
   * a parent timeline maps into this one when nested.
   *
   * Legal at any time, including mid-playback — §16 lists playback speed as a
   * playback control, not a build-time property. Must be positive and finite;
   * reverse playback is {@link Timeline.reverse}, not a negative speed, so that
   * "the advance that finishes playback" stays unambiguous.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — not finite and `> 0`.
   */
  speed(multiplier: number): this {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      invalidTimeline(
        `Timeline speed must be a finite multiplier > 0; received ${String(multiplier)}. Use reverse() to play backwards (§16).`,
        { multiplier },
      );
    }
    this.#speed = multiplier;
    return this;
  }

  /**
   * Number of **total** iterations: `loop(1)` is the default single pass,
   * `loop(3)` plays the whole timeline three times, `loop(Infinity)` never ends.
   *
   * Deliberately *not* `Tween.repeat`'s "additional cycles" counting: `repeat`
   * and `loop` are different words and a reader who has to guess is a reader who
   * will guess wrong. Markers re-arm on every wrap, so a marker on a `loop(3)`
   * timeline fires three times.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — not an integer `>= 1` or
   * `Infinity`.
   */
  loop(count: number): this {
    if (count !== Infinity && (!Number.isInteger(count) || count < 1)) {
      invalidTimeline(
        `Timeline loop count must be an integer >= 1 or Infinity (it counts total iterations, not extra ones); received ${String(count)}.`,
        { count },
      );
    }
    this.#iterations = count;
    return this;
  }

  /**
   * Plays toward time 0 (§16: reversing). `reverse(false)` restores forward
   * playback, mirroring `Tween.yoyo(enabled)`'s shape.
   *
   * Reverse traverses loop iterations backwards and finishes at elapsed time 0.
   * **Markers never fire while moving backwards**: §16 defines a crossing as a
   * forward event, and `clip.ts` makes the same call for a reversed range.
   */
  reverse(reversed = true): this {
    this.#reversed = reversed;
    return this;
  }

  // --- playback -----------------------------------------------------------

  /**
   * Starts playback at local time 0: freezes the duration, sorts the markers,
   * plays every child in `at()` insertion order (which is where §16's property
   * claims and their conflict warnings happen), and writes the pose at time 0.
   *
   * No marker fires here, not even one at time 0 — the cursor starts below zero
   * and the first {@link Timeline.advance} crosses it. `advance(0)` is enough.
   *
   * A no-op on a timeline that is not `"idle"`, exactly as on a tween: restarting
   * would have to re-capture every child's start values from wherever the
   * properties happen to sit.
   */
  play(): this {
    if (this.#state !== "idle") {
      return this;
    }
    this.#duration = this.#computeDuration();
    this.#ordered = [...this.#markers];
    // Stable since ES2019, so markers sharing a time fire in insertion order.
    this.#ordered.sort((a, b) => a.at - b.at);
    this.#elapsed = 0;
    this.#cursor = CURSOR_BEFORE_START;
    this.#finished = false;
    this.#state = "running";
    for (let index = 0; index < this.#children.length; index += 1) {
      this.#children[index].child.play();
    }
    this.#applyChildren(0, "silent");
    return this;
  }

  /** Suspends advancing. A no-op unless the timeline is `"running"`. */
  pause(): this {
    if (this.#state === "running") {
      this.#state = "paused";
    }
    return this;
  }

  /** Resumes advancing. A no-op unless the timeline is `"paused"`. */
  resume(): this {
    if (this.#state === "paused") {
      this.#state = "running";
    }
    return this;
  }

  /**
   * Stops playback and every child, releasing their §16 property claims and
   * leaving all animated values exactly where the last write put them.
   *
   * A stopped timeline writes nothing further: its children ignore writes too,
   * so even a later {@link Timeline.seek} is inert. A no-op while `"idle"`.
   */
  stop(): this {
    if (this.#state === "idle") {
      return this;
    }
    for (let index = 0; index < this.#children.length; index += 1) {
      this.#children[index].child.stop();
    }
    this.#state = "stopped";
    return this;
  }

  /**
   * Advances playback by `deltaSeconds × speed` and writes the resulting pose.
   * Called by the fixed-step `AnimationSystem` (plan P4-1); a timeline never
   * advances itself and never reads a clock (§33).
   *
   * Markers in the crossed range fire, in time order, once each — including at
   * exactly the end of the range and excluding exactly its start, so consecutive
   * advances neither miss nor repeat one. Crossing an iteration boundary fires
   * that iteration's remaining markers, re-arms every marker, and continues into
   * the next iteration, so a single large delta over a looping timeline fires
   * each marker once per iteration it spans.
   *
   * A no-op unless the timeline is `"running"` and unfinished.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the delta is negative or
   * non-finite.
   */
  advance(deltaSeconds: number): this {
    requireNonNegativeSeconds(deltaSeconds, "Timeline advance delta");
    if (this.#state !== "running" || this.#finished) {
      return this;
    }
    const scaled = deltaSeconds * this.#speed;
    let target: number;
    if (this.#reversed) {
      target = this.#elapsed - scaled;
      if (target <= 0) {
        target = 0;
        this.#finished = true;
      }
    } else {
      const total = this.totalDuration;
      target = this.#elapsed + scaled;
      if (target >= total) {
        target = total;
        this.#finished = true;
      }
    }
    this.#setElapsed(target, "play");
    if (this.#finished) {
      this.#state = "finished";
    }
    return this;
  }

  /**
   * Positions the timeline at a local time (or a label's time) and writes the
   * pose for it — §16's scrubbing, and the positioning half of a snapshot
   * restore (§34).
   *
   * Pure: seeking twice to the same time writes identical values, and seeking
   * backwards is as valid as forwards. Neither {@link Timeline.state} nor
   * {@link Timeline.finished} changes, so a seek is an evaluation and never a
   * playback decision.
   *
   * Markers are suppressed, except that a `{ replayOnSeek: true }` marker fires
   * when the seek crosses it *forwards* (§16). A backward seek fires nothing and
   * re-arms every marker it rewound past, so replaying forwards crosses them
   * again — which is exactly what "restoring a mid-timeline snapshot positions
   * playback without re-firing markers already crossed" needs.
   *
   * The time is clamped to `[0, duration]` — one iteration. Seeking rewinds a
   * looping timeline to its first iteration: loop iterations are a fact about
   * playback history, and a position on the axis cannot name one.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the timeline has never been
   * played, the label is unknown, or the time is negative or non-finite.
   */
  seek(to: number | string): this {
    const time =
      typeof to === "string"
        ? this.labelTime(to)
        : requireNonNegativeSeconds(to, "Timeline seek time");
    if (this.#state === "idle") {
      invalidTimeline(
        "Timeline.seek() requires Timeline.play() first: children capture their start values at play.",
        { to: time },
      );
    }
    const duration = this.#duration;
    // A stopped timeline is inert in every respect: its children ignore writes,
    // and firing a marker on a timeline that has released everything would be a
    // side effect with no animation behind it.
    const mode: MarkerMode = this.#state === "stopped" ? "silent" : "seek";
    this.#setElapsed(time > duration ? duration : time, mode);
    return this;
  }

  /**
   * §16's scrubbing call: {@link Timeline.seek} restricted to a time in seconds.
   *
   * An alias, deliberately — §16 gives seeking and scrubbing identical marker
   * semantics ("`seek` and scrubbing suppress them by default"), so a scrub that
   * behaved differently would be inventing a third policy. It exists because a
   * scrub bar reads better as `scrub(t)` than as `seek(t)`, and because taking
   * only a number keeps a label out of a slider's hands.
   */
  scrub(timeSeconds: number): this {
    return this.seek(timeSeconds);
  }

  // --- internals ----------------------------------------------------------

  /** Rejects authoring after {@link Timeline.play}. */
  #assertAuthorable(method: string): void {
    if (this.#state !== "idle") {
      invalidTimeline(
        `Timeline.${method}() cannot be called after play(): the duration, the marker order, and the children's property claims are all fixed at play time.`,
        { method, state: this.#state },
      );
    }
  }

  /** Whether `candidate` is this timeline or appears anywhere beneath it. */
  #contains(candidate: Timeline): boolean {
    for (let index = 0; index < this.#children.length; index += 1) {
      const nested = this.#children[index].nested;
      if (
        nested !== undefined &&
        (nested === candidate || nested.#contains(candidate))
      ) {
        return true;
      }
    }
    return false;
  }

  /** See {@link Timeline.duration}. Allocation-free. */
  #computeDuration(): number {
    let duration = 0;
    for (let index = 0; index < this.#children.length; index += 1) {
      const entry = this.#children[index];
      const end = entry.at + entry.child.totalDuration;
      if (end > duration) {
        duration = end;
      }
    }
    for (let index = 0; index < this.#markers.length; index += 1) {
      const at = this.#markers[index].at;
      if (at > duration) {
        duration = at;
      }
    }
    return duration;
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
   * Local time inside the iteration containing `elapsed`.
   *
   * The first iteration is returned unshifted rather than as
   * `elapsed - 0 * duration`, because a timeline whose duration is `Infinity`
   * (a child that never ends) would otherwise subtract `0 * Infinity`, which is
   * `NaN`. Landing exactly on the end of the final iteration reads as
   * `duration`, not as `0` of an iteration that does not exist.
   */
  #localAt(elapsed: number): number {
    const iteration = this.#iterationAt(elapsed);
    return iteration === 0 ? elapsed : elapsed - iteration * this.#duration;
  }

  /**
   * Moves to `target` elapsed seconds, writing the pose and firing whatever
   * `mode` allows across the range the move crossed.
   *
   * Forward moves walk the iterations they span so markers re-arm on every wrap;
   * backward moves fire nothing and reposition the cursor, which re-arms the
   * markers they rewound past. A timeline with no markers and no nested children
   * skips the walk entirely — with nothing to fire, intermediate iterations are
   * unobservable.
   */
  #setElapsed(target: number, mode: MarkerMode): void {
    const from = this.#cursor;
    this.#elapsed = target;

    if (mode === "silent" || !(target > from)) {
      this.#applyChildren(this.#localAt(target), mode);
      if (mode !== "silent") {
        // Rewinding to the very start re-arms markers at time 0, exactly as
        // play() does; any other position is its own exclusive lower bound.
        this.#cursor = target === 0 ? CURSOR_BEFORE_START : target;
      }
      return;
    }

    const duration = this.#duration;
    const lastIteration = this.#iterationAt(target);
    const firstIteration = from <= 0 ? 0 : this.#iterationAt(from);
    if (this.#ordered.length === 0 && !this.#hasNestedChildren()) {
      this.#applyChildren(this.#localAt(target), mode);
    } else {
      for (
        let iteration = firstIteration;
        iteration <= lastIteration;
        iteration += 1
      ) {
        const localTo =
          iteration === lastIteration ? this.#localAt(target) : duration;
        // As in `#localAt`: never `0 * Infinity`.
        const localFrom = iteration === 0 ? from : from - iteration * duration;
        if (iteration > firstIteration) {
          this.#rewindChildren();
        }
        this.#applyChildren(localTo, mode);
        this.#fireMarkers(localFrom, localTo, mode);
      }
    }
    this.#cursor = target;
  }

  /** Whether any child is a nested timeline (which may hold markers). */
  #hasNestedChildren(): boolean {
    for (let index = 0; index < this.#children.length; index += 1) {
      if (this.#children[index].nested !== undefined) {
        return true;
      }
    }
    return false;
  }

  /**
   * Writes every child's pose for `local`, in insertion order (§33) — so two
   * children on one property resolve last-placed-wins, the same rule §16 gives
   * two tweens on one property.
   *
   * Children outside their window get a boundary pose and, unless the caller is
   * only posing, have their markers re-armed: a child that has not started must
   * be able to fire its time-0 marker when the window is finally entered, and a
   * child rewound past by a backward seek must be able to fire again.
   */
  #applyChildren(local: number, mode: MarkerMode): void {
    const children = this.#children;
    for (let index = 0; index < children.length; index += 1) {
      const entry = children[index];
      const nested = entry.nested;
      const childTime = local - entry.at;
      if (childTime < 0) {
        if (nested === undefined) {
          entry.child.seek(0);
        } else {
          nested.#setElapsed(0, "silent");
          if (mode !== "silent") {
            nested.#rewind();
          }
        }
        continue;
      }
      const total = entry.child.totalDuration;
      const mapped = childTime > total ? total : childTime;
      if (nested === undefined) {
        entry.child.seek(mapped);
      } else {
        nested.#setElapsed(mapped, mode);
      }
    }
  }

  /** Re-arms this timeline's markers and every nested child's, without firing. */
  #rewind(): void {
    this.#cursor = CURSOR_BEFORE_START;
    this.#rewindChildren();
  }

  /** {@link Timeline.#rewind} for nested children only. */
  #rewindChildren(): void {
    for (let index = 0; index < this.#children.length; index += 1) {
      const nested = this.#children[index].nested;
      if (nested !== undefined) {
        nested.#rewind();
      }
    }
  }

  /**
   * Fires the markers in the half-open range `(localFrom, localTo]`, in time
   * order — the crossing convention of `AnimationClip.eventsInRange`, so a
   * marker exactly at `localTo` fires and one exactly at `localFrom` does not.
   *
   * In `"seek"` mode only `replayOnSeek` markers fire. Allocation-free: a binary
   * search for the first marker past `localFrom`, then a walk.
   *
   * An empty or reversed range needs no guard: the search lands past `localFrom`
   * and the walk's `at <= localTo` test then fails immediately, which is the
   * same "nothing crossed" answer `eventsInRange` gives.
   */
  #fireMarkers(localFrom: number, localTo: number, mode: MarkerMode): void {
    const markers = this.#ordered;
    const seekOnly = mode === "seek";
    for (
      let index = this.#firstMarkerAfter(localFrom);
      index < markers.length && markers[index].at <= localTo;
      index += 1
    ) {
      const marker = markers[index];
      if (!seekOnly || marker.replayOnSeek) {
        marker.callback();
      }
    }
  }

  /** Index of the first ordered marker with `at > timeExclusive`. */
  #firstMarkerAfter(timeExclusive: number): number {
    const markers = this.#ordered;
    let low = 0;
    let high = markers.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (markers[middle].at > timeExclusive) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return low;
  }
}
