/**
 * Simulation systems and the priority registry (§39).
 *
 * §39 gives the engine one extension point for per-fixed-step work:
 *
 * ```ts
 * interface SimulationSystem {
 *   priority: number;
 *   initialize(context: SimulationContext): void;
 *   fixedUpdate(context: FixedUpdateContext): void;
 *   dispose(): void;
 * }
 * ```
 *
 * {@link SystemRegistry} is the "explicit and configurable" ordering §39
 * requires: systems run in ascending `priority`, and the §39 example order is
 * published here as the {@link PRIORITY_INPUT} … {@link
 * PRIORITY_RENDER_INTERPOLATION} constants. This is plan decision D5 — every
 * later feature (kinematics, forces, the solver adapter, sensors, snapshots,
 * render interpolation) *registers a system*; nothing ever edits
 * `scheduler.ts`. {@link SystemRegistry.attachToScheduler} is the only seam
 * between the two files, and it only assigns the scheduler's public
 * `onFixedStep` property.
 *
 * The contexts are intentionally thin. Phase 1 has no scene/physics world to
 * hand a system, so `SimulationContext` carries only the registry and
 * `FixedUpdateContext` only the time record. They are **interfaces**, so later
 * phases widen them (scene, physics world, command buffer, …) without changing
 * this file's shape or breaking existing implementations.
 *
 * Nothing here reads a wall clock or iterates a hash map: order is registration
 * order within a priority, and time is injected (§33, ground rule 5).
 */

import type { ReadonlyTimeState } from "./clock.js";
import type { Scheduler, SchedulerCallback } from "./scheduler.js";

/**
 * Step 1 of the §39 order: input sampling.
 *
 * The constants are spaced by 100 so features can be inserted between two §39
 * steps without renumbering (e.g. `PRIORITY_FORCES + 10` for a force generator
 * that must run after the built-in one). `priority` is a plain number: any
 * finite value is legal, these are only the named landmarks.
 */
export const PRIORITY_INPUT = 100;

/** Step 2 of the §39 order: command processing. */
export const PRIORITY_COMMANDS = 200;

/** Step 3 of the §39 order: animation target evaluation. */
export const PRIORITY_ANIMATION_TARGETS = 300;

/** Step 4 of the §39 order: kinematic motion. */
export const PRIORITY_KINEMATICS = 400;

/** Step 5 of the §39 order: force generation. */
export const PRIORITY_FORCES = 500;

/** Step 6 of the §39 order: physics solve. */
export const PRIORITY_PHYSICS_SOLVE = 600;

/** Step 7 of the §39 order: constraint solve. */
export const PRIORITY_CONSTRAINTS = 700;

/** Step 8 of the §39 order: sensor update. */
export const PRIORITY_SENSOR_UPDATE = 800;

/**
 * Step 9 of the §39 order: collision event dispatch.
 *
 * Physics events are dispatched here — after the solve, inside the fixed step
 * but never during it (§6b, ground rule 4).
 */
export const PRIORITY_EVENT_DISPATCH = 900;

/** Step 10 of the §39 order: state snapshot (the §43 previous pose). */
export const PRIORITY_SNAPSHOT = 1000;

/**
 * Step 11 of the §39 order: render interpolation.
 *
 * Interpolation reads {@link ReadonlyTimeState.interpolationAlpha} and never
 * writes simulation state back (§42).
 */
export const PRIORITY_RENDER_INTERPOLATION = 1100;

/**
 * What a system is given once, when it is registered.
 *
 * Phase 1 exposes only the registry (so a system can register a helper system
 * or hold a handle for its own teardown). Later phases add fields; this is an
 * interface precisely so that widening it is source-compatible.
 */
export interface SimulationContext {
  /** The registry the system was registered with. */
  readonly registry: SystemRegistry;
}

/**
 * What a system is given on every fixed step.
 *
 * `time` is the scheduler's **live** {@link ReadonlyTimeState}; copy it with
 * `copyTimeState` to retain a step's values. `simulationStep` and
 * `simulationTime` already describe the step being produced.
 * `interpolationAlpha` still holds the previous frame's value during a fixed
 * step and must not be read here (§42).
 */
export interface FixedUpdateContext {
  /** The live time record for the step being executed (§9). */
  readonly time: ReadonlyTimeState;
}

/**
 * A unit of per-fixed-step simulation work (§39, verbatim interface).
 *
 * `priority` is read **once, at registration**: the registry keeps its systems
 * in sorted order rather than re-sorting every step, so mutating `priority`
 * after registration has no effect until the system is unregistered and
 * registered again (WP-1.11 decision — re-sorting per step would cost work in
 * the hot path and make the order depend on when a field happened to change).
 */
export interface SimulationSystem {
  /** Execution order key; lower runs first. See the `PRIORITY_*` constants. */
  priority: number;
  /** Called once when the system is registered. */
  initialize(context: SimulationContext): void;
  /** Called once per fixed simulation step, in priority order. */
  fixedUpdate(context: FixedUpdateContext): void;
  /** Called once when the system is unregistered or the registry is disposed. */
  dispose(): void;
}

/** Removes the system that returned it. Calling it more than once is a no-op. */
export type Unregister = () => void;

/** Restores the callback `attachToScheduler` replaced. Idempotent. */
export type Detach = () => void;

/** Registry bookkeeping for one registered system. */
interface SystemEntry {
  readonly system: SimulationSystem;
  /** The priority captured at registration. */
  readonly priority: number;
  /** Set when the system is unregistered, so an in-flight snapshot skips it. */
  removed: boolean;
}

/**
 * The §39 ordered set of simulation systems.
 *
 * Ordering rules:
 *
 * 1. Systems run in **ascending `priority`**.
 * 2. Systems of **equal priority run in registration order**, always. The
 *    registry inserts each system before the first entry of a strictly higher
 *    priority instead of sorting, so equal priorities can never be reordered
 *    by a sort implementation (ground rule 5: deterministic iteration).
 *
 * Mutation rules, mirroring `EventEmitter` (§6b rule 3) so the two lifecycle
 * surfaces behave the same way:
 *
 * 3. A system registered **during** a fixed step does not run until the **next**
 *    fixed step: {@link runFixedStep} iterates a snapshot taken before the
 *    first system runs.
 * 4. A system unregistered **during** a fixed step is **skipped** for the rest
 *    of that step even though it is in the snapshot ("unregistered" must mean
 *    "will not be called again"), and its `dispose` runs immediately at the
 *    moment of unregistration.
 *
 * Failure rule:
 *
 * 5. A system that throws propagates the error out of {@link runFixedStep};
 *    the systems after it are skipped for that step. The registry itself is
 *    never corrupted — its bookkeeping unwinds in a `finally`, so the next
 *    `runFixedStep` runs the full set again. A simulation step that failed
 *    halfway is not silently completed: swallowing the error would leave the
 *    world in a half-stepped state that later steps would build on (WP-1.11
 *    decision; matches `EventEmitter`'s dispatch).
 */
export class SystemRegistry {
  /** Live entries, kept sorted by (priority, registration order). */
  readonly #entries: SystemEntry[] = [];

  /** The context handed to every `initialize`; allocated once (D7). */
  readonly #simulationContext: SimulationContext = { registry: this };

  /**
   * The context handed to every `fixedUpdate`. Created on the first step and
   * then reused with its `time` replaced, so a fixed step allocates nothing
   * (D7); a registry that has never stepped holds no time at all.
   */
  #fixedUpdateContext: { time: ReadonlyTimeState } | undefined;

  /** Guards against a system re-entering `runFixedStep` (rule below). */
  #running = false;

  /** Number of registered systems. */
  get size(): number {
    return this.#entries.length;
  }

  /** Whether `system` is currently registered. */
  has(system: SimulationSystem): boolean {
    return this.#indexOf(system) !== -1;
  }

  /**
   * Registers `system`, calls its `initialize` exactly once, and returns an
   * idempotent unregister function.
   *
   * `initialize` is called **after** the system is inserted, so it may query
   * the registry (including registering further systems) from the context.
   *
   * @throws RangeError if `priority` is not a finite number.
   * @throws Error if the same system instance is already registered —
   * registering twice would call `initialize` twice and make `dispose`
   * ambiguous (WP-1.11 decision; §39 describes a set of systems, not a bag).
   */
  register(system: SimulationSystem): Unregister {
    const priority = system.priority;
    if (!Number.isFinite(priority)) {
      throw new RangeError(
        `SimulationSystem.priority must be a finite number (§39); received ${String(priority)}`,
      );
    }
    if (this.#indexOf(system) !== -1) {
      throw new Error(
        "SimulationSystem is already registered with this registry (§39)",
      );
    }
    const entry: SystemEntry = { system, priority, removed: false };
    // Insert before the first strictly-higher priority: stable by construction,
    // no sort involved (ground rule 5).
    let index = this.#entries.length;
    while (index > 0 && this.#entries[index - 1].priority > priority) {
      index -= 1;
    }
    this.#entries.splice(index, 0, entry);
    system.initialize(this.#simulationContext);
    return () => {
      this.#removeEntry(entry);
    };
  }

  /**
   * Unregisters `system` and calls its `dispose` exactly once. Returns whether
   * it was registered. Safe to call from inside a fixed step (rule 4).
   */
  unregister(system: SimulationSystem): boolean {
    const index = this.#indexOf(system);
    if (index === -1) {
      return false;
    }
    this.#removeEntry(this.#entries[index]);
    return true;
  }

  /**
   * Runs every registered system's `fixedUpdate` once, in registry order.
   *
   * @throws Error if called while a fixed step is already running. A nested
   * fixed step would advance the simulation twice for one `TimeState` and break
   * replay (§34), and unlike a re-entrant event (§6b rule 4) there is no
   * meaningful "later" to defer it to — the scheduler owns the step cadence
   * (WP-1.11 decision).
   */
  runFixedStep(time: ReadonlyTimeState): void {
    if (this.#running) {
      throw new Error(
        "SystemRegistry.runFixedStep is already running; a simulation step must not re-enter itself (§39)",
      );
    }
    if (this.#entries.length === 0) {
      return;
    }
    const snapshot = this.#entries.slice();
    let context = this.#fixedUpdateContext;
    if (context === undefined) {
      context = { time };
      this.#fixedUpdateContext = context;
    } else {
      context.time = time;
    }
    this.#running = true;
    try {
      for (const entry of snapshot) {
        if (entry.removed) {
          continue;
        }
        entry.system.fixedUpdate(context);
      }
    } finally {
      this.#running = false;
    }
  }

  /**
   * Installs {@link runFixedStep} as `scheduler.onFixedStep` and returns a
   * function that puts the previous callback back.
   *
   * This is the whole of D5's seam: the scheduler is not modified, imported
   * from, or subclassed — its public callback property is assigned, exactly as
   * `SchedulerOptions.onFixedStep` would.
   *
   * The returned `detach` is idempotent and defensive: if something else has
   * since replaced `onFixedStep`, detaching leaves that newer callback alone
   * rather than clobbering it (WP-1.11 decision).
   */
  attachToScheduler(scheduler: Scheduler): Detach {
    const previous = scheduler.onFixedStep;
    const installed: SchedulerCallback = (time) => {
      this.runFixedStep(time);
    };
    scheduler.onFixedStep = installed;
    let detached = false;
    return () => {
      if (detached) {
        return;
      }
      detached = true;
      if (scheduler.onFixedStep === installed) {
        scheduler.onFixedStep = previous;
      }
    };
  }

  /**
   * Unregisters every system, calling each `dispose` once, in **reverse
   * registration order** — teardown mirrors construction, as `disposeAll`
   * (§83) does for resources. A `dispose` that throws does not stop the rest;
   * the first thrown value is re-thrown afterwards.
   */
  dispose(): void {
    const entries = this.#entries.slice().reverse();
    this.#entries.length = 0;
    let firstFailure: unknown;
    let failed = false;
    for (const entry of entries) {
      if (entry.removed) {
        continue;
      }
      entry.removed = true;
      try {
        entry.system.dispose();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstFailure = error;
        }
      }
    }
    if (failed) {
      throw firstFailure;
    }
  }

  #indexOf(system: SimulationSystem): number {
    return this.#entries.findIndex((entry) => entry.system === system);
  }

  /** Flags the entry (so in-flight snapshots skip it), drops it, disposes once. */
  #removeEntry(entry: SystemEntry): void {
    if (entry.removed) {
      return;
    }
    entry.removed = true;
    const index = this.#entries.indexOf(entry);
    if (index !== -1) {
      this.#entries.splice(index, 1);
    }
    entry.system.dispose();
  }
}
