/**
 * Key events and their propagation through the scene graph (§72, §6b,
 * 2026-08-07, A-10).
 *
 * §72 lists keyboard events among the input events a node may receive, and
 * until this module landed `@four/input` had **no key source at all** — the
 * single fact that blocked §75's keyboard traversal (`@four/ui`'s `UI_STAGED`
 * named it), and that `examples/ui-demo` worked around with a page-level
 * `keydown` handler.
 *
 * ```ts
 * button.on("keydown", (event) => {                  // bubble phase
 *   if (event.key === "Enter") { activate(); event.preventDefault(); }
 * });
 * dialog.on("capture:keydown", (event) => {          // capture phase (root first)
 *   if (event.key === "Escape") { close(); event.stopPropagation(); }
 * });
 * ```
 *
 * Everything structural about these events is the pointer precedent, unchanged:
 * the listener keys widen `NodeEventMap` by declaration merging (the mechanism
 * `@four/scene` designed and `pointer-events.ts` established), the capture
 * phase gets its own `"capture:"`-prefixed keys because §6b's `on(type,
 * listener)` has no phase flag to pass, and the walk itself is the shared
 * {@link dispatchThreePhase}.
 *
 * ## What is a key event's target (decision, A-10)
 *
 * A pointer event resolves its target by *picking*: the event has a position,
 * and the scene answers what is under it. A key event has no position. §72's
 * answer, and every windowing system's, is the **focus**: keys go to whatever
 * currently holds it, and travel that node's ancestor chain so a container can
 * intercept.
 *
 * So `KeyboardInput` takes a `focusTarget()` resolver instead of a picker, and
 * this module knows nothing about how focus is decided — which is what keeps
 * the §3.1 dependency direction intact (`ui` depends on `input`, never the
 * reverse: `@four/ui` owns focus and hands its answer *in*).
 *
 * ## Why the event carries `preventDefault`
 *
 * Because the keys a scene wants are keys the host already means something by:
 * Tab moves the browser's own focus, Space scrolls the page. A UI layer that
 * consumes Tab for §75 traversal must be able to say so, and the only thing
 * that can suppress a platform default is the platform event.
 * {@link SceneKeyEvent.preventDefault} therefore forwards to the platform event
 * behind it when the source supplied one, and records the request either way —
 * a synthesized event with no platform behind it is not an error, it simply has
 * no default to suppress.
 *
 * This is deliberately **not** `stopPropagation`'s job, exactly as in the DOM:
 * one governs the scene walk, the other the host's reaction, and a listener
 * routinely wants one without the other.
 *
 * ## Which types ship
 *
 * `keydown` and `keyup`. §72 also lists `keypress`, which the DOM deprecated
 * (it fires only for character-producing keys, cannot see Tab or the arrows,
 * and disagrees between engines about what its `key` holds); a scene-level
 * text-entry event belongs with §56's text input control, not here. Repeat is
 * not a separate type either — the platform's auto-repeat sets
 * {@link SceneKeyEvent.repeat} on a `keydown`, which is what lets a listener
 * distinguish "held" from "pressed again".
 */

import type { Node } from "@four/scene";

import { SceneInputEvent, dispatchThreePhase } from "./propagation.js";

/**
 * Key event types that propagate through the scene graph (§72).
 *
 * Both travel capture → target → bubble; there is no targeted-only key event
 * (the pointer's `pointerenter`/`pointerleave` pair has no keyboard analogue).
 */
export type SceneKeyEventType = "keydown" | "keyup";

/**
 * The four modifier keys, as booleans — held at the instant of the event.
 *
 * Grouped into one record rather than spread across four fields on the event so
 * that "did the user press a chord?" is one object to pass, compare, and log,
 * and so that a source that learns about a fifth modifier (AltGr, a game
 * controller's shoulder) widens one type.
 */
export interface KeyModifiers {
  /** Alt (Option). */
  readonly alt: boolean;
  /** Control. */
  readonly ctrl: boolean;
  /** Meta (Command, Windows). */
  readonly meta: boolean;
  /** Shift. */
  readonly shift: boolean;
}

/** No modifier held — the value every event without a `modifiers` init gets. */
const NO_MODIFIERS: KeyModifiers = Object.freeze({
  alt: false,
  ctrl: false,
  meta: false,
  shift: false,
});

/**
 * The one thing a {@link SceneKeyEvent} needs from the platform event behind
 * it: a way to suppress the host's own reaction to the keystroke.
 *
 * Structural and optional, for this package's usual reason — a browser
 * `KeyboardEvent`, a Playwright-synthesized one, and a plain object in a unit
 * test are all equally acceptable, and naming `KeyboardEvent` would pull a DOM
 * lib into a package that must build in Node.
 */
export interface KeyDefaultSuppressor {
  /** The host's own default-suppression, when the source has one. */
  preventDefault?(): void;
}

/** Construction arguments for a {@link SceneKeyEvent}. */
export interface SceneKeyEventInit {
  /** Which event this is. */
  readonly type: SceneKeyEventType;
  /**
   * The **character or named key** produced, as the platform reports it:
   * `"a"`, `"A"`, `"Enter"`, `"Tab"`, `" "` for the space bar. Layout- and
   * modifier-dependent — this is what a listener means by "the user typed a
   * question mark".
   */
  readonly key: string;
  /**
   * The **physical key**, independent of layout and modifiers: `"KeyA"`,
   * `"Enter"`, `"Space"`. This is what a listener means by "the key left of
   * the 1", and what a game's key binding should be stored as.
   */
  readonly code: string;
  /** Modifiers held; every omitted flag is `false`. */
  readonly modifiers?: Partial<KeyModifiers>;
  /** Whether the platform's auto-repeat produced this event. Default `false`. */
  readonly repeat?: boolean;
  /** The focused node this event is delivered to, or `null` when none is. */
  readonly target: Node | null;
  /**
   * The platform event behind this one, when there is one — used by
   * {@link SceneKeyEvent.preventDefault} and nothing else. Held rather than
   * bound so no closure is allocated per event.
   */
  readonly platformEvent?: KeyDefaultSuppressor;
}

/**
 * One key event travelling the scene graph (§72).
 *
 * Construct one directly when driving {@link dispatchKeyEvent} by hand (tests,
 * synthetic input, a non-DOM key source); `KeyboardInput` constructs them for
 * real keystrokes. {@link SceneInputEvent} supplies `target`,
 * `propagationStopped`, and `stopPropagation`.
 */
export class SceneKeyEvent extends SceneInputEvent {
  /** Which event this is. */
  readonly type: SceneKeyEventType;

  /** See {@link SceneKeyEventInit.key} — the character or named key. */
  readonly key: string;

  /** See {@link SceneKeyEventInit.code} — the physical key. */
  readonly code: string;

  /** Modifiers held at the instant of the event. */
  readonly modifiers: KeyModifiers;

  /**
   * Whether the platform's auto-repeat produced this event — `true` for every
   * `keydown` after the first while a key is held, and never for a `keyup`.
   *
   * A listener that must fire once per physical press (a button activation)
   * ignores repeats; one that should accelerate while held (a traversal, a
   * scroll) honours them.
   */
  readonly repeat: boolean;

  readonly #platformEvent: KeyDefaultSuppressor | null;

  #defaultPrevented = false;

  constructor(init: SceneKeyEventInit) {
    super(init.target);
    this.type = init.type;
    this.key = init.key;
    this.code = init.code;
    this.modifiers =
      init.modifiers === undefined
        ? NO_MODIFIERS
        : {
            alt: init.modifiers.alt ?? false,
            ctrl: init.modifiers.ctrl ?? false,
            meta: init.modifiers.meta ?? false,
            shift: init.modifiers.shift ?? false,
          };
    this.repeat = init.repeat ?? false;
    this.#platformEvent = init.platformEvent ?? null;
  }

  /** Whether {@link SceneKeyEvent.preventDefault} has been called. */
  get defaultPrevented(): boolean {
    return this.#defaultPrevented;
  }

  /**
   * Tells the host not to do whatever it would normally do with this keystroke
   * — the DOM's `preventDefault`, forwarded to the platform event when the
   * source supplied one.
   *
   * Independent of {@link SceneInputEvent.stopPropagation}: this one is about
   * the *host*, that one about the *scene walk*. A UI layer consuming Tab for
   * §75 traversal wants this and usually not that (an ancestor may legitimately
   * want to see the Tab it just handled).
   *
   * Idempotent, and safe on an event with no platform behind it.
   */
  preventDefault(): void {
    this.#defaultPrevented = true;
    this.#platformEvent?.preventDefault?.();
  }
}

/**
 * Capture-phase key for each key event type — the `"capture:"` convention,
 * spelled out as literal types so `emit` stays fully checked against
 * `NodeEventMap` with no cast.
 */
const CAPTURE_KEYS = {
  keydown: "capture:keydown",
  keyup: "capture:keyup",
} as const satisfies Record<SceneKeyEventType, string>;

declare module "@four/scene" {
  // Key events (§72), merged into the one node event map (§6b) by declaration
  // merging — the same mechanism, and for the same reasons, as the pointer
  // events in `pointer-events.ts`.
  //
  // Deliberately NOT a doc comment: TypeDoc warns when two declarations of one
  // merged interface both carry one, and `@four/scene`'s declaration is the
  // documented one.
  interface NodeEventMap {
    /** Key pressed (or auto-repeated). Capture, target, bubble. */
    keydown: SceneKeyEvent;
    /** Key released. Capture, target, bubble. */
    keyup: SceneKeyEvent;

    /** Capture-phase `keydown`; fires root-first, before the target. */
    "capture:keydown": SceneKeyEvent;
    /** Capture-phase `keyup`; fires root-first, before the target. */
    "capture:keyup": SceneKeyEvent;
  }
}

/**
 * Dispatches `event` along `path` (root first, target last) in the three phases
 * of §72 — {@link dispatchThreePhase} with this module's listener keys.
 *
 * Both key types propagate, so there is no targeted-only case to handle here.
 * An empty path dispatches nothing, which is what makes "nothing is focused" a
 * no-op rather than a special case at every call site.
 */
export function dispatchKeyEvent(
  event: SceneKeyEvent,
  path: readonly Node[],
): void {
  dispatchThreePhase(event, path, event.type, CAPTURE_KEYS[event.type]);
}
