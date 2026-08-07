/**
 * The propagation machinery every scene input event shares (§72, §6b) — the
 * path, the three-phase walk, and the base class that owns `stopPropagation`.
 *
 * §72 pins the DOM's three phases verbatim:
 *
 * ```text
 * Capture -> Target -> Bubble
 * ```
 *
 * `pointer-events.ts` was the first module to implement that walk, for pointers
 * alone. It is not a pointer property: a key event delivered to the focused
 * node travels the same ancestor chain for the same reason (a dialog wants to
 * see the Escape its focused field received), and so will wheel, gamepad, and
 * XR sources. So the walk lives here, once, and each source module contributes
 * only its own event class and the two listener keys the walk emits.
 *
 * ```ts
 * dispatchThreePhase(event, buildPropagationPath(target), "keydown", "capture:keydown");
 * ```
 *
 * ## Why the keys are parameters rather than derived
 *
 * `"capture:" + type` would be one line shorter and would defeat the type
 * system: `emit` is checked against `NodeEventMap`, and a computed string is a
 * `string`, so every dispatch would need a cast and a typo would reach runtime.
 * Passing both keys as arguments keeps them literal types at every call site —
 * `CAPTURE_KEYS[type]` in the source modules is a lookup in a table that
 * `satisfies Record<…, string>`, so a missing entry is a compile error — and
 * costs nothing: no closure, no string concatenation, no allocation per event.
 *
 * ## What this module deliberately does not own
 *
 * Which types propagate and which are targeted-only. `pointerenter` and
 * `pointerleave` do not travel the path at all, and that is a fact about
 * pointers (see `dispatchPointerEvent`), not about propagation; a source module
 * handles its own targeted-only types before calling in here.
 */

import type { Node, NodeEventMap } from "@four/scene";

/**
 * The state and behaviour every propagating input event carries: the node the
 * event resolved to, and the one flag that stops the walk.
 *
 * A **class**, not an interface, for the reason `ScenePointerEvent` already
 * gave: `stopPropagation()` and `propagationStopped` are a single piece of
 * state that must agree, and an object literal could set the flag without the
 * method, or the method without the flag, leaving dispatch to silently do the
 * wrong thing. Subclasses add what their source knows — a pointer's NDC, a
 * key's `key`/`code`/modifiers — and nothing here knows about either.
 *
 * `type` is abstract: every subclass narrows it to its own union of literal
 * types, which is what lets {@link dispatchThreePhase} take the listener keys
 * as checked `NodeEventMap` keys.
 */
export abstract class SceneInputEvent {
  /** Which event this is. Narrowed by each subclass to its own union. */
  abstract readonly type: string;

  /**
   * The node the event resolved to — the deepest hit for a pointer, the
   * focused node for a key — and the node the propagation path ends at.
   * `null` when the source resolved nothing; such an event has nowhere to
   * propagate and is not dispatched.
   *
   * It stays the *target* for the whole walk: a listener on an ancestor
   * reading `event.target` sees what was actually resolved, not the node it is
   * listening on (which it already knows, having registered there).
   */
  readonly target: Node | null;

  #propagationStopped = false;

  constructor(target: Node | null) {
    this.target = target;
  }

  /** Whether {@link SceneInputEvent.stopPropagation} has been called. */
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
 * 1. **Capture** — root → target, delivering `captureKey`.
 * 2. **Target** — the last path entry, which receives its capture-keyed
 *    listeners at the end of phase 1 and its plain-keyed listeners at the start
 *    of phase 3. (The DOM does the same: a capture listener registered *on the
 *    target* fires in the at-target phase, before that node's bubble
 *    listeners.)
 * 3. **Bubble** — target → root, delivering `type`.
 *
 * {@link SceneInputEvent.stopPropagation} is honoured **between nodes**: the
 * node dispatching when it is called finishes its listener list, and no further
 * node is visited — in either direction. A capture listener that stops
 * propagation therefore also prevents the target from seeing the event.
 *
 * An empty path dispatches nothing, which is what makes a resolution failure (a
 * pointer that hit nothing, a keystroke with nothing focused) a no-op rather
 * than a special case at every call site.
 */
export function dispatchThreePhase<
  BubbleKey extends keyof NodeEventMap,
  CaptureKey extends keyof NodeEventMap,
>(
  event: NodeEventMap[BubbleKey] & NodeEventMap[CaptureKey] & SceneInputEvent,
  path: readonly Node[],
  type: BubbleKey,
  captureKey: CaptureKey,
): void {
  const depth = path.length;
  if (depth === 0) {
    return;
  }

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
