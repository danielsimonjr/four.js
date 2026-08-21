/**
 * `PhysicsEventSystem` (§39 step 9, PH-21) — the optional occupant of
 * `PRIORITY_EVENT_DISPATCH`.
 *
 * §39 publishes eleven steps and requires the ordering to be *"explicit and
 * configurable"*. Physics solves at step 6 and dispatches collision events at
 * step 9, and until PH-21 one system did both: `PhysicsSystem.fixedUpdate`
 * stepped every tracked world and then dispatched every tracked world's queued
 * events, leaving `PRIORITY_EVENT_DISPATCH` empty. That is correct — §6b's rule
 * is that events are not dispatched *during* a step, and a second pass after
 * every world has stepped satisfies it — but it is not *configurable*: nothing
 * could be scheduled between the solve and the callbacks.
 *
 * This system is the seam that makes it configurable, using the technique PH-8
 * established for step 5 and `ConstraintSystem` reused for step 7: **a new
 * registered system, at its own §39 priority, with `PhysicsWorld.step` and
 * `PhysicsWorld.dispatchEvents` untouched**. Nothing in the solver pipeline was
 * edited, so every §33 golden is unmoved by construction.
 *
 * ```ts
 * const physics = new PhysicsSystem({ worlds: [world], dispatchEvents: false });
 * app.systems.register(physics);
 * app.systems.register(new PhysicsEventSystem({ source: physics }));
 * ```
 *
 * ## What moves, and what does not
 *
 * Within one fixed step the sequence of *solver* calls is identical either way:
 * the split changes **when the listeners run**, not what the solver did. The
 * queued events, their order (the adapter's `drainEvents` order, §37), their
 * payload objects and their emitters are `PhysicsWorld.dispatchEvents`'s
 * business and are not re-derived here.
 *
 * What the split buys is the ordering §39 asks for: with dispatch at 900, a
 * system at step 7 (`PRIORITY_CONSTRAINTS`) or step 8
 * (`PRIORITY_SENSOR_UPDATE`) runs **before** application listeners, so a
 * listener observes the constraint-corrected pose rather than the raw solver
 * pose. That is a real behaviour difference for any application whose listeners
 * read transforms, which is why it is opt-in rather than the new default: the
 * combined form stays the default so that no existing application, and no
 * committed golden, changes because this file exists.
 *
 * ## §39 steps 7 and 8 are not splittable, and that is a solver fact
 *
 * The unused constants imply four separable stages where there are two. A
 * solver's constraint solve (step 7) and its sensor/intersection update (step
 * 8) happen **inside `adapter.step()`** — one call, one internal pipeline — so
 * no engine system can be interposed between them without asking every adapter
 * to expose a half-stepped world, which neither Rapier nor Box2D does.
 *
 * What `PRIORITY_CONSTRAINTS` and `PRIORITY_SENSOR_UPDATE` legitimately hold is
 * *engine-side* work at those points in the order: `ConstraintSystem`
 * (`@four/motion`, §42's `"constraint"` authority) occupies step 7, and step 8
 * is where an application's own sensor bookkeeping belongs — reading the
 * §30 queries and the poses the solve just produced, before the listeners at
 * step 9 see either. Step 9 is the last of the four that was structurally
 * unavailable, and this class is why it no longer is.
 *
 * ## Why it takes a `PhysicsSystem` rather than a world list
 *
 * Tracking lives in one place. A world added to or removed from the solve
 * system is added to or removed from dispatch in the same call, so the two can
 * never disagree about which worlds exist — the failure mode of a duplicated
 * list is a world that steps and never dispatches, which presents as events
 * that silently stop arriving.
 *
 * Reads `source.worlds` every fixed step (a getter over the system's own array,
 * no copy). Allocates nothing.
 *
 * @see {@link PhysicsSystem} — the step-6 occupant, and this system's source.
 */

import { FourError } from "@four/core";
import { PRIORITY_EVENT_DISPATCH, type SimulationSystem } from "@four/motion";

import type { PhysicsSystem } from "./physics-system.js";
import type { PhysicsWorld } from "./world.js";

/** See the rest of the package: §89 has no physics-input code, so misuse is this. */
const SYSTEM_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** Options for {@link PhysicsEventSystem}. */
export interface PhysicsEventSystemOptions {
  /**
   * The {@link PhysicsSystem} whose worlds' events this system dispatches.
   *
   * Must have been constructed with `dispatchEvents: false` — see the
   * constructor's refusal.
   */
  source: PhysicsSystem;

  /**
   * Execution order key (§39). Defaults to `PRIORITY_EVENT_DISPATCH` (900) —
   * step 9, "collision event dispatch". Read once, at registration, like every
   * other system's priority.
   */
  priority?: number;
}

/**
 * Dispatches every queued physics event of a {@link PhysicsSystem}'s worlds at
 * §39's step 9.
 *
 * See the module header for what the split changes and what it deliberately
 * leaves identical.
 */
export class PhysicsEventSystem implements SimulationSystem {
  /** Execution order key (§39); default `PRIORITY_EVENT_DISPATCH`. */
  priority: number;

  /** The step-6 system whose tracked worlds are drained here. */
  readonly source: PhysicsSystem;

  /**
   * @throws FourError if `source` still dispatches its own events. Both halves
   * running would put the listeners back at step 6 and make this system a
   * no-op over an already-empty queue — a configuration that looks wired and
   * is not, which §85 says to refuse rather than to accept and ignore.
   */
  constructor(options: PhysicsEventSystemOptions) {
    const { source } = options;
    if (source.dispatchesEvents) {
      throw new FourError(
        SYSTEM_ERROR_CODE,
        "PhysicsEventSystem requires a PhysicsSystem constructed with { dispatchEvents: false }; otherwise the source dispatches at §39 step 6 and this system drains an empty queue at step 9.",
        { context: { priority: options.priority ?? PRIORITY_EVENT_DISPATCH } },
      );
    }
    this.source = source;
    this.priority = options.priority ?? PRIORITY_EVENT_DISPATCH;
    source.claimEventDispatch();
  }

  /** The worlds whose events are dispatched, in the source's tracking order. */
  get worlds(): readonly PhysicsWorld[] {
    return this.source.worlds;
  }

  /** No per-registration setup is needed (§39). */
  initialize(): void {
    // Intentionally empty: the source owns the worlds and their lifetimes.
  }

  /**
   * Dispatches every tracked world's queued events, in tracking order (§39
   * step 9, §6b).
   *
   * Exactly the pass `PhysicsSystem.fixedUpdate` performs when it dispatches
   * its own events — same worlds, same order, same method — moved to its own
   * priority. Allocates nothing.
   */
  fixedUpdate(): void {
    const worlds = this.source.worlds;
    for (let i = 0; i < worlds.length; i += 1) {
      worlds[i].dispatchEvents();
    }
  }

  /**
   * Nothing to release (§39 teardown).
   *
   * The worlds belong to the source system, which drops its own references in
   * its `dispose`; dropping them here as well would make teardown order matter.
   */
  dispose(): void {
    // Intentionally empty — see the doc comment.
  }
}
