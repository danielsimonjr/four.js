/**
 * §72 — polled keyboard state: "is this key held right now?"
 *
 * ## Why this exists
 *
 * It is the twenty lines every consumer of this engine was writing for
 * themselves. `examples/character-controller` keeps a `Set<string>` fed by two
 * DOM listeners; a flight-sim probe written against the published packages kept
 * another, keyed differently. Neither is wrong, and that is the problem: the
 * engine shipped `@fourjs/input` without the thing "input" most obviously means,
 * so every game re-derived it and each derivation drifted.
 *
 * {@link KeyboardInput} is NOT this. That class routes DOM key events to a
 * focused scene node for widget traversal (§73–§75). Game code asking "is W
 * down" wants neither focus nor dispatch, and reaching for the class whose name
 * sounds right produced a `TypeError` naming a private field — twice, in
 * dogfooding, with the DEV diagnostic already in place. A better message does
 * not repair a missing capability, so here is the capability.
 *
 * ## The part a hand-rolled version gets wrong
 *
 * **Focus loss.** `keydown` fires, the user alt-tabs, and the `keyup` lands on
 * another window: the key is held forever and the character never stops
 * walking. Every hand-rolled copy in this repository has that bug. This class
 * clears its set on `blur`, which is the whole reason to own it centrally.
 *
 * ## Identity is `code`, not `key`
 *
 * `code` is the physical key and does not move with the layout; `key` is the
 * character produced. WASD on an AZERTY keyboard is still `KeyW`/`KeyA` but
 * reports `"z"`/`"q"` as `key`. Movement wants the position, so `code` is the
 * identity and `key` is not consulted.
 *
 * ```ts
 * const keys = new KeyboardState(window);
 * app.on("update", (time) => {
 *   if (keys.isDown("KeyW")) walk(time.deltaTime);
 * });
 * // when the scene goes away
 * keys.dispose();
 * ```
 */

import type { KeySurface, SurfaceKeyListener } from "./keyboard-input.js";

/** The surface events this class listens for. */
const TRACKED = ["keydown", "keyup"] as const;

/**
 * Events after which nothing can be trusted to still be held.
 *
 * `blur` is the one that matters in practice. Kept as a list because the same
 * argument applies to any event meaning "this surface stopped receiving keys".
 */
const RELEASE_ALL = ["blur"] as const;

/**
 * Tracks which physical keys are currently held on a {@link KeySurface}.
 *
 * Construction registers listeners; {@link KeyboardState.dispose} removes them.
 * A caller that never disposes leaks two listeners and keeps the surface alive,
 * which is why `dispose` is idempotent and safe to call from a teardown path
 * that may run twice.
 */
export class KeyboardState {
  readonly #surface: KeySurface;
  readonly #held = new Set<string>();
  readonly #onDown: SurfaceKeyListener;
  readonly #onUp: SurfaceKeyListener;
  readonly #onRelease: SurfaceKeyListener;
  #disposed = false;

  /**
   * @param surface - Where key events arrive. In a browser this is `window`;
   *   tests pass a fake, which is what makes the focus-loss behaviour above
   *   testable without a DOM.
   */
  constructor(surface: KeySurface) {
    this.#surface = surface;
    this.#onDown = (event) => {
      this.#held.add(event.code);
    };
    this.#onUp = (event) => {
      this.#held.delete(event.code);
    };
    // Takes no event: `blur` carries no key, and reading `.code` off it would
    // throw in the one situation this listener exists to survive.
    this.#onRelease = () => {
      this.#held.clear();
    };

    surface.addEventListener(TRACKED[0], this.#onDown);
    surface.addEventListener(TRACKED[1], this.#onUp);
    for (const type of RELEASE_ALL) {
      surface.addEventListener(type, this.#onRelease);
    }
  }

  /** Whether `code` — a `KeyboardEvent.code`, e.g. `"KeyW"` — is held now. */
  isDown(code: string): boolean {
    return this.#held.has(code);
  }

  /**
   * Every held `code`, as a live read-only view.
   *
   * Live rather than a copy so a per-frame read allocates nothing (§7b); frozen
   * so a caller cannot edit the set this class maintains.
   */
  get held(): ReadonlySet<string> {
    return frozenView(this.#held);
  }

  /**
   * Removes every listener and forgets all state.
   *
   * Idempotent: a second call is a no-op rather than an error, so a teardown
   * path that runs twice is not a defect.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#surface.removeEventListener(TRACKED[0], this.#onDown);
    this.#surface.removeEventListener(TRACKED[1], this.#onUp);
    for (const type of RELEASE_ALL) {
      this.#surface.removeEventListener(type, this.#onRelease);
    }
    this.#held.clear();
  }
}

/**
 * Wraps `set` so reads pass through and writes throw.
 *
 * A plain `ReadonlySet` cast would compile and still let JS callers mutate the
 * engine's own state; §83 asks that a shared structure refuse rather than
 * corrupt quietly.
 */
function frozenView(set: ReadonlySet<string>): ReadonlySet<string> {
  return new Proxy(set as Set<string>, {
    get(target, property) {
      if (property === "add" || property === "delete" || property === "clear") {
        return () => {
          throw new TypeError(
            `KeyboardState.held is a read-only view; ${String(property)} is not available on it.`,
          );
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      // Bound because `Set`'s methods are generic over the receiver: an
      // unbound `has` pulled off the proxy would be called with the proxy as
      // `this` and throw on the internal slot.
      return typeof value === "function"
        ? (value as (...args: never[]) => unknown).bind(target)
        : value;
    },
  });
}
