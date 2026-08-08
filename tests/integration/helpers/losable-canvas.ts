/**
 * A recording canvas that can lose and regain its context (A-24, 2026-08-08).
 *
 * `RecordingCanvas` in `recording-gl.ts` ignores `addEventListener` outright —
 * "the loss/restore path is `packages/render-webgl/tests`' business" — which
 * was true while §92's *"renderer context loss and restore"* integration
 * category did not exist. It does now, and the seam it needs is exactly the
 * three lines that file declines to carry: keep the listeners, and deliver an
 * event to them on demand.
 *
 * This is a separate module rather than an edit to that one so the landed
 * suites built on `RecordingCanvas` keep the double they were written against,
 * byte for byte. The *context* is still `createRecordingGl`'s — one double for
 * the GL surface, in one place.
 *
 * ## What it does and does not simulate
 *
 * It delivers the two DOM events a real canvas delivers, in the shape
 * `WebglContextEventLike` describes, and reports whether a listener called
 * `preventDefault()` — which is the browser's actual precondition for firing
 * `webglcontextrestored` at all, and therefore the one piece of the contract a
 * double can check that no unit assertion about the renderer's own fields can.
 *
 * It does **not** make the underlying context behave as a lost one: a real
 * lost context turns every entry point into a no-op and answers
 * `isContextLost()` with `true`. That difference is deliberate and is what
 * makes the suite's central assertion possible — the recorded tape shows
 * whether the renderer *issued* calls while lost, which a faithfully no-op'ing
 * double would hide. The real-driver half is `tests/browser/context-loss.spec.ts`.
 */

import type { WebglCanvas } from "@four/render-webgl";

/** The one member of a `webglcontextlost` event this backend reads. */
interface ContextEvent {
  preventDefault(): void;
}

type ContextListener = (event: ContextEvent) => void;

/** A {@link RecordingCanvas} that also delivers `webglcontext*` events. */
export class LosableCanvas implements WebglCanvas {
  width = 256;

  height = 256;

  readonly #context: unknown;

  readonly #listeners = new Map<string, ContextListener[]>();

  constructor(context: unknown) {
    this.#context = context;
  }

  getContext(): unknown {
    return this.#context;
  }

  addEventListener(type: string, listener: ContextListener): void {
    const existing = this.#listeners.get(type);
    if (existing === undefined) {
      this.#listeners.set(type, [listener]);
      return;
    }
    existing.push(listener);
  }

  removeEventListener(type: string, listener: ContextListener): void {
    const existing = this.#listeners.get(type);
    if (existing === undefined) {
      return;
    }
    const index = existing.indexOf(listener);
    if (index !== -1) {
      existing.splice(index, 1);
    }
  }

  /** How many listeners are attached for `type` (§83's teardown check). */
  listenerCount(type: string): number {
    return this.#listeners.get(type)?.length ?? 0;
  }

  /**
   * Delivers `webglcontextlost`, and returns whether a listener prevented the
   * default — which is what a browser requires before it will ever fire
   * `webglcontextrestored`.
   */
  loseContext(): boolean {
    return this.#dispatch("webglcontextlost");
  }

  /** Delivers `webglcontextrestored`. */
  restoreContext(): void {
    this.#dispatch("webglcontextrestored");
  }

  /** Delivers one event; the listener list is copied so a handler may detach. */
  #dispatch(type: string): boolean {
    let prevented = false;
    const event: ContextEvent = {
      preventDefault(): void {
        prevented = true;
      },
    };
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      listener(event);
    }
    return prevented;
  }
}
