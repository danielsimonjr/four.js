/**
 * The pointer source (§72): platform pointer events in, scene pointer events
 * out.
 *
 * ```ts
 * const input = new PointerInput(canvas, {
 *   camera,
 *   pickables: () => pickables,   // rebuilt only when the candidate set changes
 * });
 * node.on("click", () => recolor(node));
 * // …
 * input.dispose();
 * ```
 *
 * What it does, in the order a frame of interaction goes through it:
 *
 * 1. **Normalizes coordinates.** A platform event carries client-space pixels;
 *    everything above the platform speaks normalized device coordinates
 *    (`[-1, 1]`, **+Y up**, §7a). The surface's bounding rectangle is the
 *    conversion, including the Y flip that turns the platform's downward Y into
 *    the engine's upward Y.
 * 2. **Resolves a target** by picking (§71) — nearest hit wins — unless the
 *    pointer is captured, in which case the capturing node *is* the target.
 * 3. **Synthesizes** what the platform does not send at scene level: `click`
 *    (a press and release on one node with no drag in between) and the
 *    `pointerenter`/`pointerleave` pair (a change of hovered node).
 * 4. **Dispatches** through the scene graph in the three §72 phases
 *    (`dispatchPointerEvent`).
 *
 * ## What it deliberately does not do
 *
 * - It never writes a transform. §42 gives exactly one system authority over a
 *   node's transform, and "the pointer moved" is not a claim to it; input
 *   reports, the application decides (see `DragManager`).
 * - It never touches the scene graph, and it holds no reference to a scene: the
 *   candidate list is a function the caller owns (`pickables`), for the reasons
 *   `pick` documents.
 * - It does not handle wheel (§72 lists it; this is the pointer subset of
 *   WP-3a.2). Keyboard is no longer on this list: `KeyboardInput` is its own
 *   source, sibling to this one, as of 2026-08-07 (A-10).
 *   `pointercancel` **is** handled as of 2026-08-06 (A-9);
 *   the note that used to stand here said a cancelled pointer looked like a
 *   pointer that stopped moving, and that is no longer true.
 *
 * ## Multiple pointers, and when a pointer stops existing (2026-08-06, A-9)
 *
 * All state — the press that a click is measured from, the hovered node, the
 * capture — is keyed by `pointerId`, so two fingers are two independent
 * interactions rather than one interleaved mess. Nothing is shared between
 * pointers.
 *
 * A pointer's entry is created on demand and **deleted when the pointer ends**
 * — on `pointerup` and on `pointercancel`. That matters because the platform
 * issues a *fresh* `pointerId` for every touch contact and every pen contact:
 * a map that only ever grew would grow for the life of the surface, and each
 * entry retains `downTarget` and `captured`, both `Node` references, so it
 * would pin scene nodes the application had already removed from the graph
 * (§83's "detached nodes retaining listeners" class of leak, not merely a map
 * slot). `dispose()` remains the bulk clear; the per-pointer teardown is what
 * makes a long-lived surface bounded.
 *
 * The teardown is **the same for both endings**, in this order: dispatch the
 * ending event, synthesize `click` (release only, and only when the press and
 * the release agree — a cancel never clicks), release the capture, fire the
 * pending `pointerleave`, forget the pointer. Every decision the ending needs
 * is read before anything is dispatched, so a listener that starts a new
 * interaction cannot rewrite this one's history.
 *
 * **Known consequence, stated rather than hidden.** A `pointerup` therefore
 * ends hover as well: a mouse that presses and releases without moving fires
 * `pointerleave`, and the next `pointermove` fires `pointerenter` again. That
 * is right for touch and pen, where the contact really has ceased to exist,
 * and it is a behavioural change for the mouse, whose pointer persists.
 * Distinguishing the two needs `pointerType` on
 * {@link SurfacePointerEvent} — which the platform event carries and this
 * three-field structural subset does not — so retaining a mouse's hover across
 * its own release is left to the packet that widens that interface.
 */

import { Vector3, type DepthRange } from "@four/math";
import type { Camera, Node } from "@four/scene";

import { pick, type PickHit, type Pickable } from "./pick.js";
import {
  ScenePointerEvent,
  buildPropagationPath,
  dispatchPointerEvent,
  type PropagatingPointerEventType,
  type ScenePointerEventType,
} from "./pointer-events.js";

/**
 * The platform pointer event this module reads — three fields out of the DOM's
 * `PointerEvent`.
 *
 * Structural on purpose: a browser `PointerEvent`, a Playwright-synthesized
 * one, and a plain object in a unit test are all equally acceptable, and naming
 * `PointerEvent` would pull a DOM lib into a package that must build in Node.
 */
export interface SurfacePointerEvent {
  /** Horizontal position in client (viewport) pixels, +X right. */
  readonly clientX: number;
  /** Vertical position in client pixels, **+Y down** — the platform's sign. */
  readonly clientY: number;
  /** Which pointer this is: mouse, finger, or stylus. */
  readonly pointerId: number;
}

/**
 * The surface's position and size in client pixels — the subset of the DOM's
 * `DOMRect` used to normalize a pointer position.
 */
export interface SurfaceRect {
  /** Distance from the client area's left edge to the surface's left edge. */
  readonly left: number;
  /** Distance from the client area's top edge to the surface's top edge. */
  readonly top: number;
  /** Surface width in client pixels. */
  readonly width: number;
  /** Surface height in client pixels. */
  readonly height: number;
}

/** A listener {@link PointerSurface} delivers platform pointer events to. */
export type SurfacePointerListener = (event: SurfacePointerEvent) => void;

/**
 * The drawing surface pointer events arrive on, described by what this module
 * actually touches — the same structural-seam policy `@four/render-webgl` uses
 * for its canvas (`WebglCanvas`), and for the same reasons: an
 * `HTMLCanvasElement`, a wrapper around one, and a test double are all equally
 * acceptable, `instanceof HTMLCanvasElement` fails across realms, and this
 * package does not name DOM types.
 *
 * There is deliberately no runtime validation of the argument: unlike §61's
 * `canvas`, which arrives typed `unknown` and must be narrowed, this is a
 * checked parameter type, and §89 has no error code for "wrong argument".
 */
export interface PointerSurface {
  addEventListener(type: string, listener: SurfacePointerListener): void;
  removeEventListener(type: string, listener: SurfacePointerListener): void;
  /** The surface's current position and size in client pixels. */
  getBoundingClientRect(): SurfaceRect;
}

/**
 * How far a pointer may travel between press and release and still produce a
 * `click`, in NDC units.
 *
 * `0.02` NDC is 1% of the surface's width (NDC spans 2 units edge to edge) —
 * about 8 px on an 800 px-wide canvas, which is the order of magnitude the
 * platforms use for their own click/drag discrimination. It is expressed in NDC
 * rather than pixels so the pointer source needs no notion of device pixel
 * ratio, and it is anisotropic on a non-square surface (1% of the width
 * horizontally, 1% of the height vertically) — deliberately, since that is what
 * "a small fraction of the viewport" means on each axis.
 *
 * Override it per input with {@link PointerInputOptions.clickMoveThreshold}.
 */
export const DEFAULT_CLICK_MOVE_THRESHOLD = 0.02;

/** Construction options for {@link PointerInput}. */
export interface PointerInputOptions {
  /** The camera whose rays resolve pointer positions into the scene (§71). */
  camera: Camera;
  /**
   * The current picking candidates, called once per platform event.
   *
   * A function rather than an array so the caller can rebuild the list when the
   * *set* of candidates changes without re-creating the input; returning a
   * stable array is the cheap case and is expected.
   */
  pickables: () => readonly Pickable[];
  /**
   * Clip-space depth convention the camera's projection was built with (plan
   * D8). Defaults to `"negative-one-to-one"`, matching
   * `Camera.updateProjectionMatrix` and the WebGL 2 MVP (§120); WebGPU callers
   * pass `"zero-to-one"`.
   */
  depthRange?: DepthRange;
  /**
   * Click movement tolerance in NDC. Defaults to
   * {@link DEFAULT_CLICK_MOVE_THRESHOLD}.
   */
  clickMoveThreshold?: number;
}

/** Everything remembered about one pointer between platform events. */
interface PointerState {
  /** Target of the last `pointerdown`, or `null` when the pointer is up. */
  downTarget: Node | null;
  /** NDC of that press — the origin the click tolerance is measured from. */
  downNdcX: number;
  downNdcY: number;
  /** Set once the pointer has travelled past the tolerance since the press. */
  moved: boolean;
  /** Node this pointer is currently over, for enter/leave. */
  hovered: Node | null;
  /** Node holding this pointer's capture, or `null`. */
  captured: Node | null;
  /**
   * Set for the duration of this entry's teardown (2026-08-07).
   *
   * The teardown dispatches `pointerleave` while the entry is still in the map,
   * and a listener may start a new gesture with the same `pointerId` during it.
   * The flag makes `#stateFor` treat this entry as gone and mint a fresh one, so
   * the new gesture is not written into a state that is one line from being
   * deleted. See `#endPointer`.
   */
  ending: boolean;
}

function createPointerState(): PointerState {
  return {
    downTarget: null,
    downNdcX: 0,
    downNdcY: 0,
    moved: false,
    hovered: null,
    captured: null,
    ending: false,
  };
}

export class PointerInput {
  /**
   * The camera pointer positions are resolved through. Assignable: swapping the
   * camera (a split view, a cut to another angle) takes effect on the next
   * event, and nothing is cached from it.
   */
  camera: Camera;

  readonly #surface: PointerSurface;
  readonly #pickables: () => readonly Pickable[];
  readonly #depthRange: DepthRange | undefined;
  readonly #clickMoveThresholdSq: number;

  /** Per-pointer state, keyed by `pointerId`; see {@link PointerState}. */
  readonly #pointers = new Map<number, PointerState>();

  /** Reused picking results and NDC pair (plan D7). */
  readonly #hits: PickHit[] = [];
  readonly #ndc: [number, number] = [0, 0];

  #disposed = false;

  // Bound once so `removeEventListener` gets the same function objects.
  readonly #onPointerDown = (event: SurfacePointerEvent): void => {
    this.#handleDown(event);
  };

  readonly #onPointerMove = (event: SurfacePointerEvent): void => {
    this.#handleMove(event);
  };

  readonly #onPointerUp = (event: SurfacePointerEvent): void => {
    this.#handleUp(event);
  };

  readonly #onPointerCancel = (event: SurfacePointerEvent): void => {
    this.#handleCancel(event);
  };

  constructor(surface: PointerSurface, options: PointerInputOptions) {
    this.#surface = surface;
    this.camera = options.camera;
    this.#pickables = options.pickables;
    this.#depthRange = options.depthRange;
    const threshold =
      options.clickMoveThreshold ?? DEFAULT_CLICK_MOVE_THRESHOLD;
    this.#clickMoveThresholdSq = threshold * threshold;

    surface.addEventListener("pointerdown", this.#onPointerDown);
    surface.addEventListener("pointermove", this.#onPointerMove);
    surface.addEventListener("pointerup", this.#onPointerUp);
    surface.addEventListener("pointercancel", this.#onPointerCancel);
  }

  /**
   * Routes every further event from `pointerId` to `node` until the pointer is
   * released (§72: "pointer capture must be supported across mixed 2D/3D
   * objects").
   *
   * While captured, moves and ups target `node` **whatever the ray touches** —
   * that is the entire point: a slider whose thumb the pointer has already left
   * keeps receiving the drag. Two consequences follow and are intended:
   *
   * - no picking runs for those events, so they carry no
   *   {@link ScenePointerEvent.worldPoint} (there is no hit to report);
   * - hover does not change, so no enter/leave fires mid-gesture.
   *
   * The capture is released implicitly by the next `pointerup` from that
   * pointer (as in the DOM), and explicitly by
   * {@link PointerInput.releasePointerCapture}. Hover resynchronizes on the
   * first move after the release — the release itself fires no enter or leave,
   * because a pointer that has not moved has not crossed anything.
   */
  setPointerCapture(node: Node, pointerId: number): void {
    this.#stateFor(pointerId).captured = node;
  }

  /** Ends a capture. Releasing a pointer that holds none is a no-op. */
  releasePointerCapture(pointerId: number): void {
    const state = this.#pointers.get(pointerId);
    if (state !== undefined) {
      state.captured = null;
    }
  }

  /** The node holding `pointerId`'s capture, or `null`. */
  getPointerCapture(pointerId: number): Node | null {
    return this.#pointers.get(pointerId)?.captured ?? null;
  }

  /** The node `pointerId` is currently over, or `null`. */
  getHovered(pointerId: number): Node | null {
    return this.#pointers.get(pointerId)?.hovered ?? null;
  }

  /**
   * How many pointers this input is currently tracking (2026-08-06, A-9).
   *
   * A pointer is tracked from its first event until it ends (`pointerup` or
   * `pointercancel`), so on a healthy surface this is the number of fingers,
   * pens, and mice that have touched it and not yet let go — never a running
   * total. Public so that the leak this closed stays testable from outside the
   * class: a regression is `trackedPointerCount` climbing with the number of
   * completed gestures rather than with the number of live ones.
   */
  get trackedPointerCount(): number {
    return this.#pointers.size;
  }

  /**
   * Converts a client-pixel position to normalized device coordinates through
   * the surface's current rectangle, writing `[ndcX, ndcY]` into `out`.
   *
   * `ndcX = 2·(clientX − left)/width − 1` and `ndcY = 1 − 2·(clientY − top)/height`:
   * the vertical term is subtracted because client Y grows downwards and NDC Y
   * grows **upwards** (§7a). A degenerate rectangle (zero width or height,
   * which is what a hidden canvas reports) would divide by zero, so it yields
   * `(0, 0)` — the centre — rather than infinities; such a surface cannot be
   * pointed at meaningfully anyway.
   *
   * Public because a caller with its own event source (XR, a gamepad cursor)
   * needs the same conversion, and because it is the one piece of this class
   * worth testing in isolation.
   */
  toNdc(clientX: number, clientY: number, out: [number, number]): void {
    const rect = this.#surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    out[0] = ((clientX - rect.left) / rect.width) * 2 - 1;
    out[1] = 1 - ((clientY - rect.top) / rect.height) * 2;
  }

  /**
   * Removes the surface listeners and forgets every pointer's state. Idempotent
   * (§83: teardown paths must not have to test first).
   *
   * Captures held at dispose are dropped; listeners registered on nodes by the
   * application are not touched, since this object never added them.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#surface.removeEventListener("pointerdown", this.#onPointerDown);
    this.#surface.removeEventListener("pointermove", this.#onPointerMove);
    this.#surface.removeEventListener("pointerup", this.#onPointerUp);
    this.#surface.removeEventListener("pointercancel", this.#onPointerCancel);
    this.#pointers.clear();
  }

  // --- platform event handling ----------------------------------------------

  #handleDown(event: SurfacePointerEvent): void {
    const state = this.#stateFor(event.pointerId);
    const resolved = this.#resolve(event, state);

    this.#updateHover(state, resolved);
    state.downTarget = resolved.target;
    state.downNdcX = resolved.ndcX;
    state.downNdcY = resolved.ndcY;
    state.moved = false;

    this.#dispatch("pointerdown", resolved);
  }

  #handleMove(event: SurfacePointerEvent): void {
    const state = this.#stateFor(event.pointerId);
    const resolved = this.#resolve(event, state);

    if (state.downTarget !== null && !state.moved) {
      const dx = resolved.ndcX - state.downNdcX;
      const dy = resolved.ndcY - state.downNdcY;
      if (dx * dx + dy * dy > this.#clickMoveThresholdSq) {
        state.moved = true;
      }
    }

    // Boundary events precede the move, as in the DOM: a listener handling the
    // move already knows whether it has just been entered.
    this.#updateHover(state, resolved);
    this.#dispatch("pointermove", resolved);
  }

  #handleUp(event: SurfacePointerEvent): void {
    const state = this.#stateFor(event.pointerId);
    const resolved = this.#resolve(event, state);
    const pressed = state.downTarget;
    const clicked =
      pressed !== null && resolved.target === pressed && !state.moved;

    this.#updateHover(state, resolved);
    this.#dispatch("pointerup", resolved);

    // A click is a press and a release on the same node with no drag between
    // them (§72). Same node, because releasing elsewhere is a cancelled press;
    // no drag, because a drag that happens to end where it started is still a
    // drag. Both conditions are read *before* `pointerup` is dispatched, so a
    // listener that starts a new interaction cannot rewrite this one's history.
    if (clicked) {
      this.#dispatch("click", resolved);
    }

    this.#endPointer(state, resolved);
  }

  /**
   * The system took the pointer away (§72 `pointercancel`, 2026-08-06 A-9):
   * a touch turned into a browser scroll, the stylus left the digitizer, the
   * window lost the pointer.
   *
   * The same teardown as a release, minus the click — the gesture did not
   * complete, and synthesizing "the user tapped this" for a tap the user never
   * finished is the one thing a cancel must not do. Hover is not updated before
   * the dispatch either: a cancelled pointer has not crossed anything, it has
   * stopped existing, so the only boundary event it owes is the `pointerleave`
   * the teardown fires.
   */
  #handleCancel(event: SurfacePointerEvent): void {
    const state = this.#stateFor(event.pointerId);
    const resolved = this.#resolve(event, state);

    this.#dispatch("pointercancel", resolved);
    this.#endPointer(state, resolved);
  }

  /**
   * Forgets `pointerId` entirely — the shared tail of `pointerup` and
   * `pointercancel` (2026-08-06, A-9; see the module header for why the entry
   * must not survive its pointer).
   *
   * Order matters. The capture is released *first*, because `#updateHover`
   * deliberately does nothing while a pointer is captured and the pending
   * `pointerleave` must still fire; the leave is dispatched *second*, while the
   * entry is still in the map, so nothing observing this input mid-teardown
   * sees a pointer that has half vanished; the entry is deleted *last*, so
   * nothing a listener does can resurrect a half-torn-down pointer.
   *
   * ## Re-entrancy: a new gesture during the leave is not erased (2026-08-07)
   *
   * The dispatched `pointerleave` runs application listeners, and one of them
   * may feed a fresh `pointerdown` with the *same* `pointerId` straight back
   * into this input (a synthetic gesture, a nested surface, a test). Until this
   * fix that press found the entry being torn down — still in the map — wrote
   * its `downTarget` into it, and then had the whole entry deleted by the line
   * below: the new gesture disappeared silently, and the promise made here that
   * "a listener that presses again from inside the leave gets a fresh entry"
   * was not kept.
   *
   * It is kept now by {@link PointerState.ending}: the entry is marked before
   * the leave is dispatched, so `#stateFor` mints a **new** entry for that
   * `pointerId` and installs it in the map, and the delete below removes the
   * entry only while it is still the one the map holds. A pointer therefore
   * cannot be resurrected, and a genuinely new gesture cannot be swallowed —
   * which are two ways of saying the same thing: the map always answers with
   * the live pointer, never with a dead one.
   */
  #endPointer(state: PointerState, resolved: Resolution): void {
    state.downTarget = null;
    state.moved = false;
    // Implicit release, as in the DOM: a capture never outlives its gesture.
    state.captured = null;
    state.ending = true;
    this.#updateHover(state, {
      pointerId: resolved.pointerId,
      ndcX: resolved.ndcX,
      ndcY: resolved.ndcY,
      target: null,
      point: null,
    });
    if (this.#pointers.get(resolved.pointerId) === state) {
      this.#pointers.delete(resolved.pointerId);
    }
  }

  /**
   * Normalizes and picks, producing everything the dispatch of this one
   * platform event needs.
   *
   * The result is a fresh object rather than reused scratch: dispatch runs
   * application listeners, any of which may feed another platform event into
   * this or another `PointerInput` (a nested widget, a synthesized gesture), and
   * shared scratch would let that inner event rewrite the outer one's target
   * halfway through. One small object per platform event — next to the events
   * themselves — is the honest price of that.
   */
  #resolve(event: SurfacePointerEvent, state: PointerState): Resolution {
    const ndc = this.#ndc;
    this.toNdc(event.clientX, event.clientY, ndc);

    if (state.captured !== null) {
      return {
        pointerId: event.pointerId,
        ndcX: ndc[0],
        ndcY: ndc[1],
        target: state.captured,
        point: null,
      };
    }

    const hits = pick(
      this.camera,
      ndc[0],
      ndc[1],
      this.#pickables(),
      this.#hits,
      this.#depthRange,
    );
    return {
      pointerId: event.pointerId,
      ndcX: ndc[0],
      ndcY: ndc[1],
      target: hits.length === 0 ? null : hits[0].node,
      // Copied out of the pool immediately: `pick` rewrites `#hits` in place.
      point: hits.length === 0 ? null : new Vector3().copy(hits[0].point),
    };
  }

  /**
   * Fires `pointerleave` on the previously hovered node and `pointerenter` on
   * the new one when the hovered node changed. Both are targeted only.
   *
   * A capture freezes hover: the gesture owns the pointer, so crossing another
   * node's bounds mid-drag is not an enter.
   */
  #updateHover(state: PointerState, resolved: Resolution): void {
    if (state.captured !== null || state.hovered === resolved.target) {
      return;
    }

    const previous = state.hovered;
    state.hovered = resolved.target;

    if (previous !== null) {
      // No world point: the pointer is, by definition, no longer on it.
      dispatchPointerEvent(
        new ScenePointerEvent({
          type: "pointerleave",
          pointerId: resolved.pointerId,
          ndcX: resolved.ndcX,
          ndcY: resolved.ndcY,
          target: previous,
        }),
        [previous],
      );
    }
    if (resolved.target !== null) {
      dispatchPointerEvent(createEvent("pointerenter", resolved), [
        resolved.target,
      ]);
    }
  }

  /**
   * Dispatches one propagating event at the resolved target, or nothing at all
   * when the pointer hit nothing — a miss has no path, and there is no
   * scene-level "background" node to deliver it to.
   *
   * The path array is allocated per dispatch rather than reused, for the same
   * reason {@link PointerInput.#resolve} returns a fresh object: a listener may
   * feed another event through this same input, and a shared path would be
   * rewritten underneath the walk that is still using it.
   * {@link buildPropagationPath} takes an `out` for callers that can guarantee
   * otherwise.
   */
  #dispatch(type: PropagatingPointerEventType, resolved: Resolution): void {
    if (resolved.target === null) {
      return;
    }
    dispatchPointerEvent(
      createEvent(type, resolved),
      buildPropagationPath(resolved.target),
    );
  }

  /**
   * The live state of `pointerId`, created on demand.
   *
   * An entry that is mid-teardown ({@link PointerState.ending}) counts as
   * absent: it is about to be dropped, so writing a new gesture into it would
   * lose that gesture. See `#endPointer`.
   */
  #stateFor(pointerId: number): PointerState {
    const existing = this.#pointers.get(pointerId);
    if (existing !== undefined && !existing.ending) {
      return existing;
    }
    const state = createPointerState();
    this.#pointers.set(pointerId, state);
    return state;
  }
}

/** One platform event, normalized and resolved against the scene. */
interface Resolution {
  readonly pointerId: number;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly target: Node | null;
  /** World-space hit point, already copied out of the picking pool. */
  readonly point: Vector3 | null;
}

/** Builds a scene event of `type` at a resolved pointer position. */
function createEvent(
  type: ScenePointerEventType,
  resolved: Resolution,
): ScenePointerEvent {
  const init = {
    type,
    pointerId: resolved.pointerId,
    ndcX: resolved.ndcX,
    ndcY: resolved.ndcY,
    target: resolved.target,
  };
  if (resolved.point === null) {
    return new ScenePointerEvent(init);
  }
  return new ScenePointerEvent({ ...init, worldPoint: resolved.point });
}
