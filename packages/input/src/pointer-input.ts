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
 * - It does not handle `pointercancel`, wheel, or keyboard (§72 lists them;
 *   this is the pointer subset of WP-3a.2). A cancelled pointer currently looks
 *   like a pointer that stopped moving; the fix is one more listener and is
 *   left to the packet that has a browser to verify it against.
 *
 * ## Multiple pointers
 *
 * All state — the press that a click is measured from, the hovered node, the
 * capture — is keyed by `pointerId`, so two fingers are two independent
 * interactions rather than one interleaved mess. Nothing is shared between
 * pointers.
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
}

function createPointerState(): PointerState {
  return {
    downTarget: null,
    downNdcX: 0,
    downNdcY: 0,
    moved: false,
    hovered: null,
    captured: null,
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

    state.downTarget = null;
    state.moved = false;
    // Implicit release, as in the DOM: a capture never outlives its gesture.
    state.captured = null;
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

  #stateFor(pointerId: number): PointerState {
    let state = this.#pointers.get(pointerId);
    if (state === undefined) {
      state = createPointerState();
      this.#pointers.set(pointerId, state);
    }
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
