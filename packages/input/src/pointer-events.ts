/**
 * Pointer events and their propagation through the scene graph (§72, §6b).
 *
 * §6b makes input **the** exception to "all other events fire on their emitter
 * only": an input event travels the ancestor chain in the three DOM phases §72
 * pins verbatim —
 *
 * ```text
 * Capture -> Target -> Bubble
 * ```
 *
 * — so a panel can intercept a click destined for a button inside it, and a
 * group can react to anything that happens to its children without subscribing
 * to each one.
 *
 * ```ts
 * button.on("pointerdown", (event) => {           // bubble phase (target first)
 *   press(event.target);
 *   event.stopPropagation();                      // the panel below never sees it
 * });
 * panel.on("capture:pointerdown", (event) => {    // capture phase (root first)
 *   if (locked) event.stopPropagation();          // …and the button never sees it
 * });
 * ```
 *
 * ## Why the listener keys are the widening mechanism (decision, WP-3a.2)
 *
 * Nodes carry the one typed emitter §6b requires: `Node extends
 * EventEmitter<NodeEventMap>`, with no generic parameter of its own (plan D1).
 * A package that adds node events therefore cannot re-parameterize the emitter
 * — it must widen the *map*, and `NodeEventMap` is an `interface` for exactly
 * that reason (see its documentation in `@four/scene`: "later packets add their
 * keys here (or, for out-of-package events, by declaration merging)").
 *
 * This module is the first out-of-package case, so it uses the mechanism the
 * scene package designed for it:
 *
 * ```ts
 * declare module "@four/scene" {
 *   interface NodeEventMap {
 *     pointerdown: ScenePointerEvent;
 *     // …
 *   }
 * }
 * ```
 *
 * The augmentation merges into the very interface `Node` was parameterized
 * with, so `node.on("pointerdown", …)` type-checks with a fully typed event and
 * `node.on("nope", …)` is still rejected — verified by the type-level
 * assertions in this package's tests. It is a **global** widening: importing
 * `@four/input` anywhere in a program adds these keys to every node's map. That
 * is the intended semantics (an input event is a node event, not an
 * input-package event) and it is additive, so no existing listener, subclass, or
 * downstream build changes meaning.
 *
 * The rejected alternative was a private listener registry inside
 * `@four/input`, keyed by node. It would have given input events their own
 * `on`/`off` surface — two event APIs on one object, which is precisely what
 * §6b's "nodes and the application expose one typed event API" forbids.
 *
 * ## Why capture listeners use `"capture:"`-prefixed keys (decision, WP-3a.2)
 *
 * The DOM selects the phase with a *flag* on `addEventListener`, so one key
 * addresses two listener lists. §6b's emitter has no such flag — `on(type,
 * listener)` is the whole contract, and adding a third parameter would change
 * an API the spec quotes literally, for every event type, to serve one of them.
 *
 * So the phase is part of the key: `"capture:pointerdown"` is a distinct event
 * type from `"pointerdown"`, declared as such in the map, and dispatch emits it
 * on the way down. This costs nothing at runtime, keeps the emitter contract
 * untouched, and keeps registration order meaningful within a phase (§6b rule
 * 2) — which a single key with an out-of-band flag could not do.
 *
 * Only the four **propagating** types have a capture key. Enter and leave are
 * targeted-only (see {@link dispatchPointerEvent}), so a capture key for them
 * would be a key that never fires.
 *
 * ## Allocation
 *
 * One {@link ScenePointerEvent} and one path array per dispatched event.
 * Pointer events arrive at hardware rates, not per-object-per-frame rates; an
 * event outlives its dispatch whenever a listener stores one, and a listener
 * may dispatch a second event from inside the first, so reusing either would
 * trade a real correctness hazard for an allocation nobody can measure.
 * {@link buildPropagationPath} still takes an `out` for callers that can rule
 * that out. Plan D7's "engine-internal per-frame code always passes `out`"
 * governs the picking and drag maths underneath, which do.
 */

import type { Vector3 } from "@four/math";
import type { Node } from "@four/scene";

/**
 * Pointer event types that propagate through the scene graph (§72).
 *
 * `"click"` is synthesized by the pointer source rather than delivered by the
 * platform — see `PointerInput` — but it propagates like the rest.
 *
 * `"pointercancel"` is the platform's own (2026-08-06, A-9): the system took
 * the pointer away mid-gesture — a touch became a browser scroll or a
 * page-level gesture, the stylus left the digitizer, the window lost the
 * pointer. It propagates like `pointerup` and means the opposite of it: the
 * gesture did **not** complete, so no `click` follows and a listener that
 * committed something on press must undo it.
 */
export type PropagatingPointerEventType =
  "pointerdown" | "pointerup" | "pointermove" | "pointercancel" | "click";

/**
 * Every pointer event type this tier delivers (§72's `pointer enter/leave,
 * down/up/move, click` subset).
 *
 * Double-click, wheel, keyboard, focus/blur, pinch, and rotate are listed by
 * §72 and are not implemented here: the first three need a source of platform
 * events this packet does not own (wheel deltas, key codes, focus management),
 * and the gesture events need multi-pointer recognizers. Nothing below assumes
 * the set is closed — `pointercancel` joined it on 2026-08-06 (A-9) by adding
 * one member to {@link PropagatingPointerEventType}, which is the whole cost of
 * a new propagating type.
 */
export type ScenePointerEventType =
  PropagatingPointerEventType | "pointerenter" | "pointerleave";

/** Construction arguments for a {@link ScenePointerEvent}. */
export interface ScenePointerEventInit {
  /** Which event this is. */
  readonly type: ScenePointerEventType;
  /**
   * Platform pointer identifier — the mouse, the finger, or the stylus that
   * produced the event. Distinct simultaneous pointers carry distinct ids.
   */
  readonly pointerId: number;
  /** Horizontal normalized device coordinate, `[-1, 1]`, +X right (§7a). */
  readonly ndcX: number;
  /** Vertical normalized device coordinate, `[-1, 1]`, **+Y up** (§7a). */
  readonly ndcY: number;
  /** The node the pointer resolved to, or `null` when it hit nothing. */
  readonly target: Node | null;
  /** World-space point on `target` under the pointer, when one is known. */
  readonly worldPoint?: Vector3;
}

/**
 * One pointer event travelling the scene graph (§72).
 *
 * A **class**, not a bare interface, because `stopPropagation()` and
 * `propagationStopped` are a single piece of state that must agree: an object
 * literal could set the flag without the method, or the method without the
 * flag, and dispatch would silently do the wrong thing. Construct one directly
 * when driving {@link dispatchPointerEvent} by hand (tests, synthetic input, a
 * non-DOM pointer source); `PointerInput` constructs them for real pointers.
 */
export class ScenePointerEvent {
  /** Which event this is. */
  readonly type: ScenePointerEventType;

  /** See {@link ScenePointerEventInit.pointerId}. */
  readonly pointerId: number;

  /** Horizontal normalized device coordinate, `[-1, 1]`, +X right (§7a). */
  readonly ndcX: number;

  /** Vertical normalized device coordinate, `[-1, 1]`, **+Y up** (§7a). */
  readonly ndcY: number;

  /**
   * The node the pointer resolved to — the deepest hit, and the node the
   * propagation path ends at. `null` when the pointer hit nothing; such an
   * event has nowhere to propagate and is not dispatched.
   *
   * It stays the *target* for the whole walk: a listener on an ancestor reading
   * `event.target` sees what was actually hit, not the node it is listening on
   * (which it already knows, having registered there).
   */
  readonly target: Node | null;

  /**
   * World-space point on {@link ScenePointerEvent.target} under the pointer,
   * when the source knew one — the picking hit point (§71).
   *
   * Absent, rather than stale, whenever no hit was computed: while a pointer is
   * captured, the target is the capturing node regardless of what the ray
   * touches, so there is no honest point to report. The vector is a copy taken
   * out of the pooled `PickHit.point` and never written again, so it is safe to
   * keep (the pooled original is not).
   */
  readonly worldPoint?: Vector3;

  #propagationStopped = false;

  constructor(init: ScenePointerEventInit) {
    this.type = init.type;
    this.pointerId = init.pointerId;
    this.ndcX = init.ndcX;
    this.ndcY = init.ndcY;
    this.target = init.target;
    if (init.worldPoint !== undefined) {
      this.worldPoint = init.worldPoint;
    }
  }

  /** Whether {@link ScenePointerEvent.stopPropagation} has been called. */
  get propagationStopped(): boolean {
    return this.#propagationStopped;
  }

  /**
   * Stops the event before the **next node** on the path — the DOM's
   * `stopPropagation`, not `stopImmediatePropagation`.
   *
   * The remaining listeners on the node currently dispatching still run: §6b
   * rule 2 makes registration order the contract within one emitter, and
   * letting one listener cancel its siblings would make that order decide who
   * gets to see an event. (There is deliberately no
   * `stopImmediatePropagation`: no §72 requirement asks for one.)
   *
   * Called during the capture phase, it stops the descent as well, so the
   * target never sees the event at all.
   */
  stopPropagation(): void {
    this.#propagationStopped = true;
  }
}

/**
 * Capture-phase key for each propagating type — the `"capture:"` convention,
 * spelled out as literal types so `emit` stays fully checked against
 * `NodeEventMap` with no cast.
 */
const CAPTURE_KEYS = {
  pointerdown: "capture:pointerdown",
  pointerup: "capture:pointerup",
  pointermove: "capture:pointermove",
  pointercancel: "capture:pointercancel",
  click: "capture:click",
} as const satisfies Record<PropagatingPointerEventType, string>;

/**
 * The prefix that turns a propagating pointer event type into its capture-phase
 * listener key. Exported for documentation and tooling; the keys themselves are
 * literal types, so `node.on("capture:pointerdown", …)` is what code writes.
 */
export const CAPTURE_KEY_PREFIX = "capture:";

declare module "@four/scene" {
  // Pointer events (§72), merged into the one node event map (§6b) by
  // declaration merging — see this module's documentation for why this is the
  // widening mechanism and why the capture phase gets its own keys.
  // Deliberately NOT a doc comment: TypeDoc warns when two declarations of one
  // merged interface both carry one, and `@four/scene`'s declaration is the
  // documented one.
  interface NodeEventMap {
    /** Pointer pressed. Capture, target, bubble. */
    pointerdown: ScenePointerEvent;
    /** Pointer released. Capture, target, bubble. */
    pointerup: ScenePointerEvent;
    /** Pointer moved. Capture, target, bubble. */
    pointermove: ScenePointerEvent;
    /** The system took the pointer away mid-gesture; no `click` follows. Capture, target, bubble. */
    pointercancel: ScenePointerEvent;
    /** Press and release on the same node without a drag. Capture, target, bubble. */
    click: ScenePointerEvent;
    /** Pointer entered this node. Target only — no capture, no bubble. */
    pointerenter: ScenePointerEvent;
    /** Pointer left this node. Target only — no capture, no bubble. */
    pointerleave: ScenePointerEvent;

    /** Capture-phase `pointerdown`; fires root-first, before the target. */
    "capture:pointerdown": ScenePointerEvent;
    /** Capture-phase `pointerup`; fires root-first, before the target. */
    "capture:pointerup": ScenePointerEvent;
    /** Capture-phase `pointermove`; fires root-first, before the target. */
    "capture:pointermove": ScenePointerEvent;
    /** Capture-phase `pointercancel`; fires root-first, before the target. */
    "capture:pointercancel": ScenePointerEvent;
    /** Capture-phase `click`; fires root-first, before the target. */
    "capture:click": ScenePointerEvent;
  }
}

/**
 * Writes the propagation path of `target` into `out` — **root first**, target
 * last — and returns it.
 *
 * That is the order the capture phase walks; the bubble phase walks it
 * backwards. The path is captured *before* dispatch, so a listener that
 * reparents or removes a node mid-dispatch cannot change where the rest of the
 * event goes (the same "snapshot first, then deliver" rule §6b applies to
 * listener lists).
 *
 * Pass `out` to reuse an array — the walk overwrites it and truncates it to the
 * path length, allocating nothing.
 */
export function buildPropagationPath(target: Node, out: Node[] = []): Node[] {
  let depth = 0;
  for (let node: Node | null = target; node !== null; node = node.parent) {
    depth += 1;
  }
  out.length = depth;
  let index = depth - 1;
  for (let node: Node | null = target; node !== null; node = node.parent) {
    out[index] = node;
    index -= 1;
  }
  return out;
}

/**
 * Dispatches `event` along `path` (root first, target last) in the three phases
 * of §72.
 *
 * 1. **Capture** — root → target, delivering `"capture:<type>"`.
 * 2. **Target** — the last path entry, which receives its capture-keyed
 *    listeners at the end of phase 1 and its plain-keyed listeners at the start
 *    of phase 3. (The DOM does the same: a capture listener registered *on the
 *    target* fires in the at-target phase, before that node's bubble
 *    listeners.)
 * 3. **Bubble** — target → root, delivering `"<type>"`.
 *
 * {@link ScenePointerEvent.stopPropagation} is honoured **between nodes**: the
 * node dispatching when it is called finishes its listener list, and no further
 * node is visited — in either direction. A capture listener that stops
 * propagation therefore also prevents the target from seeing the event.
 *
 * `pointerenter` and `pointerleave` do **not** propagate: they are delivered to
 * the last path entry only. This is DOM semantics (`pointerenter`/`pointerleave`
 * are the non-bubbling pair, as against `pointerover`/`pointerout`) and it is
 * what makes them usable for hover styling — a bubbling enter would fire on
 * every ancestor of every node the pointer crosses, which is never what a
 * listener on a group means by "the pointer entered me".
 *
 * An empty path dispatches nothing, which is what makes a miss (no target) a
 * no-op rather than a special case at every call site.
 */
export function dispatchPointerEvent(
  event: ScenePointerEvent,
  path: readonly Node[],
): void {
  const depth = path.length;
  if (depth === 0) {
    return;
  }

  const type = event.type;
  if (type === "pointerenter" || type === "pointerleave") {
    path[depth - 1].emit(type, event);
    return;
  }

  const captureKey = CAPTURE_KEYS[type];
  for (let i = 0; i < depth; i += 1) {
    path[i].emit(captureKey, event);
    if (event.propagationStopped) {
      return;
    }
  }

  for (let i = depth - 1; i >= 0; i -= 1) {
    path[i].emit(type, event);
    if (event.propagationStopped) {
      return;
    }
  }
}
