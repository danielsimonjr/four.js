/**
 * `PhysicsSystem` (§39 step 6, plan P5-2) — the `SimulationSystem` that steps
 * every `PhysicsWorld` once per fixed step.
 *
 * §39 gives the engine one extension point for per-fixed-step work and one
 * published order for it. Physics occupies step 6, "physics solve"
 * (`PRIORITY_PHYSICS_SOLVE`), which puts it after input, commands, animation
 * targets, kinematic motion, and force generation, and before constraints,
 * sensors, and event dispatch. That is the whole of D5's rule at work: this
 * feature *registers a system*, and nothing edits the scheduler.
 *
 * ```ts
 * const world = new PhysicsWorld({ dimension: "2d", adapter, poses: app.poses });
 * await world.initialize();
 * app.systems.register(new PhysicsSystem({ worlds: [world] }));
 * ```
 *
 * ## Why more than one world (§21, §108)
 *
 * A world is one dimension (§21) and one solver instance, and §108's exit
 * criterion is a demonstration in which a 2D world and a 3D world run in one
 * application through the common API. So the system holds a *list*: worlds are
 * stepped in the order they were tracked, and both dimensions advance on the
 * same fixed clock without either knowing the other exists.
 *
 * ## Events come after every world has stepped (§39 step 9, §6b)
 *
 * The system makes two passes:
 *
 * ```text
 * for each world, in tracking order: world.step(fixedDeltaTime)
 * for each world, in tracking order: world.dispatchEvents()
 * ```
 *
 * PH-21 (2026-08-21) makes that second pass movable: `dispatchEvents: false`
 * leaves step 9 to a `PhysicsEventSystem` registered at
 * `PRIORITY_EVENT_DISPATCH`. The default is unchanged, and this method was not
 * otherwise edited, so every §33 golden is unmoved.
 *
 * §6b forbids dispatching physics events during the step, and §39 puts
 * "collision event dispatch" at step 9, after the solve and the sensor update.
 * Splitting the passes gives the stronger guarantee that matters once there is
 * more than one world: a listener on the 2D world's body always observes a 3D
 * world that has finished its own step, so a callback that queries or edits
 * either world can never catch one mid-solve. Within one world the ordering is
 * `PhysicsWorld.dispatchEvents`'s, which is the adapter's deterministic event
 * order (§33, §37).
 *
 * ## What this system does not do
 *
 * It does not initialize a world — `PhysicsWorld.initialize` is asynchronous
 * (a WebAssembly solver loads its module there, plan P5-1) and §39's
 * `initialize(context)` is not. Await the world first, then track it. It does
 * not dispose the worlds it steps either: a world may be stepped by a
 * different system afterwards, and disposing a world disposes its adapter,
 * which is not a decision a scheduler teardown should make.
 *
 * Nothing here reads a clock: the delta is `context.time.fixedDeltaTime` (§9,
 * §10), and the tracked worlds are iterated in insertion order only (§33).
 */

import { FourError } from "@four/core";
import {
  PRIORITY_PHYSICS_SOLVE,
  type FixedUpdateContext,
  type SimulationSystem,
} from "@four/motion";

import type { PhysicsWorld } from "./world.js";

/** See the rest of the package: §89 has no physics-input code, so misuse is this. */
const SYSTEM_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** Options for {@link PhysicsSystem}. */
export interface PhysicsSystemOptions {
  /**
   * Execution order key (§39). Defaults to `PRIORITY_PHYSICS_SOLVE` (600) —
   * step 6, "physics solve". Read once, at registration, like every other
   * system's priority.
   */
  priority?: number;

  /**
   * Worlds to track immediately, in order. Equivalent to calling
   * {@link PhysicsSystem.track} for each, which is what the constructor does.
   */
  worlds?: Iterable<PhysicsWorld>;

  /**
   * Whether this system also dispatches its worlds' queued events (§39 step 9).
   *
   * Defaults to `true`, which is the behaviour every application and every §33
   * golden has had since P5-2: solve, then dispatch, both at step 6's priority.
   *
   * Pass `false` to move dispatch to its own §39 priority with
   * `PhysicsEventSystem` (PH-21) — see that class for what the split changes.
   * A system constructed with `false` whose dispatch nobody claims never
   * delivers anything, and each world's queue grows without bound — so the
   * first such fixed step warns once (see
   * {@link PhysicsSystem.claimEventDispatch}). That is why `true` remains the
   * default.
   */
  dispatchEvents?: boolean;
}

/**
 * Steps every tracked {@link PhysicsWorld} once per fixed step, then dispatches
 * every world's events (§39 steps 6 and 9).
 *
 * See the module header for the two-pass ordering, the multi-world rationale,
 * and what the system deliberately leaves to the application.
 */
export class PhysicsSystem implements SimulationSystem {
  /** Execution order key (§39); default `PRIORITY_PHYSICS_SOLVE`. */
  priority: number;

  /**
   * Tracked worlds in insertion order (§33: deterministic iteration).
   *
   * An array rather than a `Set` because both passes index it and the list is
   * short; membership tests are linear over a handful of entries.
   */
  readonly #worlds: PhysicsWorld[] = [];

  /** Whether this system dispatches its own worlds' events (§39 step 9). */
  readonly #dispatchEvents: boolean;

  /** Whether some other system has claimed step 9 — see `claimEventDispatch`. */
  #dispatchClaimed = false;

  /** Whether the "nobody dispatches" warning has already been written. */
  #warnedUnclaimed = false;

  constructor(options: PhysicsSystemOptions = {}) {
    this.priority = options.priority ?? PRIORITY_PHYSICS_SOLVE;
    this.#dispatchEvents = options.dispatchEvents ?? true;
    if (options.worlds !== undefined) {
      for (const world of options.worlds) {
        this.track(world);
      }
    }
  }

  /**
   * Whether this system dispatches its worlds' queued events itself (§39 step
   * 9), as opposed to leaving step 9 to another system.
   *
   * Fixed at construction: moving dispatch between priorities mid-run would
   * deliver one step's events at two different points in the order, which is
   * exactly the ambiguity §39's *"explicit"* forbids.
   */
  get dispatchesEvents(): boolean {
    return this.#dispatchEvents;
  }

  /**
   * Records that some other system dispatches this system's worlds' events, so
   * that the "nobody is draining the queue" warning stays silent.
   *
   * {@link PhysicsEventSystem} calls this on itself at construction; call it
   * yourself if you drive `PhysicsWorld.dispatchEvents` from your own system or
   * from application code. Idempotent, and a no-op on a system that dispatches
   * its own events.
   */
  claimEventDispatch(): void {
    this.#dispatchClaimed = true;
  }

  /** How many worlds are tracked. */
  get size(): number {
    return this.#worlds.length;
  }

  /** The tracked worlds, in the order they are stepped. */
  get worlds(): readonly PhysicsWorld[] {
    return this.#worlds;
  }

  /**
   * Starts stepping `world` and returns it, so a world can be built and tracked
   * in one expression.
   *
   * @throws FourError if the same world is already tracked — stepping one world
   * twice per fixed step would advance it at double rate and break §34 replay,
   * which is not something to do by accident
   */
  track(world: PhysicsWorld): PhysicsWorld {
    if (this.#worlds.includes(world)) {
      throw new FourError(
        SYSTEM_ERROR_CODE,
        "PhysicsWorld is already tracked by this PhysicsSystem; stepping it twice per fixed step would advance the simulation at twice the rate (§10, §39).",
        { context: { worlds: this.#worlds.length } },
      );
    }
    this.#worlds.push(world);
    return world;
  }

  /** Stops stepping `world`. Returns whether it was tracked. */
  untrack(world: PhysicsWorld): boolean {
    const index = this.#worlds.indexOf(world);
    if (index === -1) {
      return false;
    }
    this.#worlds.splice(index, 1);
    return true;
  }

  /** Whether `world` is tracked. */
  has(world: PhysicsWorld): boolean {
    return this.#worlds.includes(world);
  }

  /** Stops stepping everything. The system stays registered. */
  clear(): void {
    this.#worlds.length = 0;
  }

  /** No per-registration setup is needed (§39). */
  initialize(): void {
    // Intentionally empty: a world is initialized by the application, which can
    // await it — see the module header.
  }

  /**
   * Steps every tracked world by `time.fixedDeltaTime` seconds, then dispatches
   * every world's queued events (§39 steps 6 and 9).
   *
   * The delta is the **scaled simulation delta**: §10 puts `timeScale` in the
   * scheduler's accumulator, so a fixed step already *is* one `fixedDeltaTime`
   * of simulation time and multiplying by `timeScale` here would scale it twice.
   *
   * The two passes iterate a live array. A listener that untracks a world during
   * dispatch therefore skips that world's own dispatch if it has not run yet —
   * the same "mutate outside the step" caveat every system in the engine
   * carries. Allocates nothing.
   */
  fixedUpdate(context: FixedUpdateContext): void {
    const delta = context.time.fixedDeltaTime;
    const worlds = this.#worlds;
    for (let i = 0; i < worlds.length; i += 1) {
      worlds[i].step(delta);
    }
    if (this.#dispatchEvents) {
      for (let i = 0; i < worlds.length; i += 1) {
        worlds[i].dispatchEvents();
      }
      return;
    }
    if (!this.#dispatchClaimed && !this.#warnedUnclaimed) {
      this.#warnedUnclaimed = true;
      // Not `devWarn`: a simulation package may not import the dev-build gate
      // (tests/integration/dev-build-mode.test.ts), so the idiom is a plain
      // warning behind a once-flag — see `RigidBody`.
      console.warn(
        "PhysicsSystem was constructed with { dispatchEvents: false } and no system has claimed §39 step 9; queued physics events will never be delivered and each world's queue will grow without bound. Register a PhysicsEventSystem, or call claimEventDispatch() if you dispatch them yourself.",
      );
    }
  }

  /**
   * Drops every tracked world (§39 teardown).
   *
   * Deliberately does **not** dispose them: the system drives worlds, it does
   * not own them, and `PhysicsWorld.dispose` also disposes the solver adapter.
   */
  dispose(): void {
    this.#worlds.length = 0;
  }
}
