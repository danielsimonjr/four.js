/**
 * The `Application` composition root (§45, plan D4).
 *
 * §45's Application "owns the default scene, renderer, time system, simulation
 * scheduler, input routing, assets, diagnostics, cameras, and viewports". This
 * is the **Phase 1 subset** of that object: the scene, the simulation
 * scheduler, and the §39 system registry, wired together and re-emitting the
 * §10 main-loop events. Renderer, input, assets, cameras, viewports, and
 * physics arrive with the phases that build them (§103); their `§45`
 * construction options are deliberately absent rather than accepted and
 * ignored, so a program that sets `renderer: "webgpu"` today fails to compile
 * instead of silently rendering nothing.
 *
 * ## Why the composition root lives here
 *
 * Plan D4: `@four/motion`'s {@link Scheduler} is an event-free
 * `step(elapsedSeconds)` state machine and knows nothing about events, scenes,
 * or renderers; `@four/scene` knows nothing about time. The `four` umbrella
 * package is the one place that already depends on both, so it is where the
 * loop is *composed* — and §45 requires exactly that the wrapper be optional:
 * "The application must permit advanced users to construct and own these
 * systems independently rather than requiring the convenience wrapper." Every
 * part of this class is reachable separately (`new Scheduler`, `new Scene`,
 * `new SystemRegistry`, `resolveWorldTransforms`); `Application` only saves
 * you the wiring below.
 *
 * ## The wiring, and what it guarantees
 *
 * ```text
 * app.step(elapsed)
 *   └─ scheduler.step(elapsed)                       §10 accumulator
 *        ├─ onFixedStep  ×N   systems.runFixedStep(time)   §39 priority order
 *        │                    emit("fixedUpdate", time)    §10 / §6b
 *        ├─ onUpdate          resolveWorldTransforms(scene) §7
 *        │                    emit("update", time)
 *        └─ onRender          emit("render", time)
 * ```
 *
 * Three consequences worth stating, because tests pin all of them:
 *
 * 1. **Systems run before `fixedUpdate` listeners.** Registered systems are the
 *    engine's own simulation work (§39); an application listener observes the
 *    step *after* it has been simulated, never halfway through it.
 * 2. **World matrices are current when `update` fires.** §7 resolves world
 *    transforms once per fixed step (before physics synchronization) and once
 *    before render-item generation. Phase 1 has no physics synchronization
 *    point, so the single per-frame resolve sits at the top of `onUpdate`,
 *    which is before both the `update` and `render` listeners — the render pass
 *    of Phase 3 therefore already sees resolved matrices. When the physics
 *    adapter lands (§37), a second resolve is added inside the fixed step; that
 *    is a change to this file only.
 * 3. **`fixedUpdate` may fire zero or many times per `step`**, and `update` and
 *    `render` fire exactly once, always in that order — the §10 contract,
 *    inherited unchanged from the scheduler.
 *
 * ## Headless by construction
 *
 * There is no `requestAnimationFrame` driver in Phase 1 and no DOM reference
 * anywhere in this file: {@link Application.start} flips state, and the host
 * calls {@link Application.step} with the elapsed seconds it chooses. That is
 * what makes determinism (§33) and replay (§34) testable — feed two
 * applications the same sequence and they produce identical event traces — and
 * a browser driver is a thin addition on top (Phase 3, with the renderer that
 * needs it) rather than something this class has to be rescued from.
 */

import { EventEmitter, FourError } from "@four/core";
import {
  DEFAULT_FIXED_DELTA_TIME,
  DEFAULT_MAXIMUM_SUB_STEPS,
  Scheduler,
  SystemRegistry,
  type Detach,
  type ReadonlyTimeState,
} from "@four/motion";
import {
  Scene,
  resolveWorldTransforms,
  type WorldTransformStats,
} from "@four/scene";

/**
 * The §10 main-loop events, as §6b types them.
 *
 * Every event carries the scheduler's **live** {@link ReadonlyTimeState} — the
 * same object each time, mutated in place by the scheduler (plan D7: the loop
 * allocates nothing per frame). Read what you need during the listener; to
 * retain a frame's values, copy them with `copyTimeState` from `@four/motion`.
 *
 * §10's example listeners destructure `{ fixedDelta }` and `{ delta, alpha }`;
 * those are the pre-1.0 names for §9's `fixedDeltaTime`, `deltaTime`, and
 * `interpolationAlpha`, which is what the record actually carries (WP-1.12
 * decision: one time record, §9's field names, no per-event aliases).
 */
export interface ApplicationEventMap {
  /**
   * One fixed simulation step completed (§10). Fires 0..`maximumSubSteps` times
   * per {@link Application.step}, after the registered systems ran.
   * `simulationStep`/`simulationTime` describe the step just produced;
   * `interpolationAlpha` still holds the previous frame's value and must not be
   * read here (§42).
   */
  fixedUpdate: ReadonlyTimeState;
  /**
   * The variable-rate frame update (§10). Fires exactly once per
   * {@link Application.step}, after every fixed step of that call and after
   * world transforms have been resolved (§7).
   */
  update: ReadonlyTimeState;
  /** The frame's render point (§10). Fires exactly once per step, last. */
  render: ReadonlyTimeState;
}

/**
 * The Phase 1 subset of §45's `ApplicationOptions`.
 *
 * §45's full option set (`canvas`, `renderer`, `width`, `height`,
 * `resolution`, `antialias`, `alpha`, `powerPreference`, `autoResize`,
 * `reducedMotion`, `physics`) belongs to subsystems that do not exist yet; each
 * option is added by the packet that builds its subsystem. Omitted numeric
 * options take the Appendix A normative defaults.
 */
export interface ApplicationOptions {
  /**
   * Fixed simulation step in seconds (§10, §45). Default 1/60 (Appendix A).
   *
   * §45 spells this `fixedTimeStep` while §9/§10's time record spells the same
   * quantity `fixedDeltaTime`; this option is the §45 name and is passed
   * straight through to the scheduler's `fixedDeltaTime`.
   */
  fixedTimeStep?: number;
  /** Maximum fixed steps per {@link Application.step} (§10, §45). Default 5 (Appendix A). */
  maximumSubSteps?: number;
}

/**
 * The §89 code every lifecycle-misuse failure of this class carries.
 *
 * §89 lists nine "example codes" and `@four/core` models them as a closed
 * union so a typo is a compile error; none of the nine names "the application
 * was used out of order", and `packages/core/src/errors.ts` is outside this
 * packet's scope (the same collision WP-1.9 hit, which chose the platform
 * `RangeError` for argument validation — not an option here, because a
 * lifecycle failure is an engine failure and §89 requires those to be
 * `FourError`s so diagnostics can report them).
 *
 * `RENDERER_INITIALIZATION_FAILED` is the union's only *initialization-order*
 * member and the one that becomes literally true in Phase 3, when
 * {@link Application.initialize} is what constructs the renderer: using the
 * application before `initialize()` resolved is precisely "the renderer was
 * never initialized". Until then the code is broader than its name, so every
 * throw carries a `context` naming the real state (`initialized`, `running`,
 * `disposed`, `method`) and a message that says what the caller did wrong.
 *
 * TODO(WP-1.12-fix1, §89): add `INVALID_APPLICATION_STATE` to `FourErrorCode`
 * in `@four/core` and switch these throws to it. That is a one-line change to a
 * file this packet may not touch.
 */
const LIFECYCLE_ERROR_CODE = "RENDERER_INITIALIZATION_FAILED";

export class Application extends EventEmitter<ApplicationEventMap> {
  /**
   * The default scene (§45). Constructed and owned by the application; the
   * root of everything {@link Application.step} resolves and, from Phase 3, of
   * everything the renderer draws.
   */
  readonly scene: Scene;

  /**
   * The simulation scheduler (§10, §45). Exposed because it is the only way to
   * reach the time record and the time scale, and because §45 requires these
   * systems to be usable directly: `app.scheduler.timeScale = 0.5` is slow
   * motion, `app.scheduler.time` is §9's `TimeState`.
   *
   * Its three callbacks belong to this class — reassigning
   * `scheduler.onFixedStep`, `onUpdate`, or `onRender` unwires the application
   * (register a {@link SimulationSystem} or an event listener instead, D5).
   */
  readonly scheduler: Scheduler;

  /**
   * The §39 simulation-system registry, attached to {@link Application.scheduler}.
   *
   * This is where per-fixed-step engine work is registered (D5): every later
   * feature registers a system here, in `PRIORITY_*` order, and nothing edits
   * the loop.
   */
  readonly systems: SystemRegistry;

  /** Undoes {@link SystemRegistry.attachToScheduler}; run once, by `dispose`. */
  readonly #detachSystems: Detach;

  /** Reused stats object, so the per-frame resolve allocates nothing (D7). */
  readonly #worldTransformStats: WorldTransformStats = {
    visited: 0,
    recomputed: 0,
  };

  /** Resolved once {@link Application.initialize} has completed. */
  #initialized = false;

  /**
   * The in-flight or completed `initialize()` result. Kept so that concurrent
   * and repeated calls share one initialization (idempotence, §45), which is
   * what the Phase 3 renderer construction will need.
   */
  #initialization: Promise<void> | undefined;

  #running = false;

  #disposed = false;

  /** True while a {@link Application.step} call is in progress (re-entrancy guard). */
  #stepping = false;

  constructor(options: ApplicationOptions = {}) {
    super();
    this.scene = new Scene();
    this.scheduler = new Scheduler({
      // Explicitly resolved from motion's exported constants rather than left
      // to the scheduler's own defaulting, so the values the application runs
      // with are visible at this call site (Appendix A).
      fixedDeltaTime: options.fixedTimeStep ?? DEFAULT_FIXED_DELTA_TIME,
      maximumSubSteps: options.maximumSubSteps ?? DEFAULT_MAXIMUM_SUB_STEPS,
    });
    this.systems = new SystemRegistry();

    // Composition of the fixed step (WP-1.12 decision). `attachToScheduler` is
    // D5's only sanctioned seam between the registry and the scheduler, so the
    // registry installs itself first; the callback it installed is then read
    // back off the scheduler and wrapped, rather than reimplemented, so that
    // "run the systems" stays the registry's own code (including its
    // re-entrancy guard and its snapshot semantics). Registry first, then the
    // application event: a listener observes a completed simulation step.
    //
    // The alternative — assigning `scheduler.onFixedStep = t => { registry
    // .runFixedStep(t); this.emit(...) }` directly and never calling
    // `attachToScheduler` — is one line shorter and bypasses the documented
    // seam, so a later change to how the registry attaches itself would silently
    // not apply here.
    this.#detachSystems = this.systems.attachToScheduler(this.scheduler);
    const runSystems = this.scheduler.onFixedStep;
    this.scheduler.onFixedStep = (time) => {
      runSystems?.(time);
      this.emit("fixedUpdate", time);
    };

    this.scheduler.onUpdate = (time) => {
      // §7's pre-render resolution point. Once per frame, before any listener
      // can read a world matrix, and version-cached — a frame that moved
      // nothing recomputes nothing.
      resolveWorldTransforms(this.scene, this.#worldTransformStats);
      this.emit("update", time);
    };

    this.scheduler.onRender = (time) => {
      this.emit("render", time);
    };
  }

  /** Whether {@link Application.initialize} has completed. */
  get initialized(): boolean {
    return this.#initialized;
  }

  /** Whether the application is started (§45 `start`/`stop`). */
  get running(): boolean {
    return this.#running;
  }

  /** The scheduler's pause flag (§10). See {@link Application.pause}. */
  get paused(): boolean {
    return this.scheduler.paused;
  }

  /** Whether {@link Application.dispose} has run. Disposal is terminal. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * The live §9 time record. The same object the events carry; copy it with
   * `copyTimeState` to retain a frame's values.
   */
  get time(): ReadonlyTimeState {
    return this.scheduler.time;
  }

  /**
   * Prepares the application for stepping (§45), asynchronously and exactly
   * once.
   *
   * Phase 1 has nothing to await — no renderer, no GPU device, no solver — so
   * this resolves immediately. It is async and it exists now because §45's
   * usage is `await app.initialize(); app.start();` and because the backends
   * that arrive later (renderer initialization §62, WASM solver loading §37,
   * asset preloads §75) are genuinely asynchronous; making the call shape
   * correct from the start means those phases add work inside this method
   * instead of changing every program that uses the engine.
   *
   * Idempotent: repeated or concurrent calls return the same promise and
   * initialize once.
   *
   * @throws FourError if the application has been disposed. Thrown
   * synchronously, like every other lifecycle precondition here.
   */
  initialize(): Promise<void> {
    this.#assertNotDisposed("initialize");
    this.#initialization ??= Promise.resolve().then(() => {
      this.#initialized = true;
    });
    return this.#initialization;
  }

  /**
   * Starts the application (§45): from here {@link Application.step} is legal.
   *
   * Phase 1 installs **no driver** — no `requestAnimationFrame`, no timer, no
   * DOM (plan D4: manual stepping is the headless mode). The host owns the
   * cadence and calls `step(elapsedSeconds)`; `start` establishes that doing so
   * is intended, which is what makes an accidental step before setup an error
   * instead of a silently advanced clock. The browser driver arrives with the
   * renderer (Phase 3) and will attach here.
   *
   * Calling `start` on a running application is a no-op.
   *
   * @throws FourError if `initialize()` has not completed, or if the
   * application has been disposed.
   */
  start(): void {
    this.#assertNotDisposed("start");
    if (!this.#initialized) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "Application.start() requires a completed initialize(): call `await app.initialize()` first (§45).",
        { context: { method: "start", initialized: false, running: false } },
      );
    }
    this.#running = true;
  }

  /**
   * Stops the application (§45). {@link Application.step} becomes an error
   * again; nothing else is torn down, so `start()` resumes stepping with the
   * time record, accumulator, systems, and listeners exactly as they were.
   *
   * Idempotent, and legal before `start` — "stopped" is the initial state.
   */
  stop(): void {
    this.#running = false;
  }

  /**
   * Pauses simulation (§10, §45): the accumulator stops accumulating and
   * `deltaTime` is 0, while `unscaledDeltaTime`, `update`, and `render`
   * continue — so a paused application still renders, and a paused frame is
   * exactly a `timeScale = 0` frame with `timeScale` preserved.
   *
   * A pure proxy for `scheduler.paused`; pausing a stopped or uninitialized
   * application is legal and is how an application starts paused.
   */
  pause(): void {
    this.scheduler.paused = true;
  }

  /** Resumes simulation (§10, §45). The proxy inverse of {@link Application.pause}. */
  resume(): void {
    this.scheduler.paused = false;
  }

  /**
   * Advances the loop by `elapsedSeconds` of injected real time — one frame
   * (§10, §45).
   *
   * This is the whole driver in Phase 1: the host decides the cadence, which is
   * what determinism (§33) and replay (§34) require. `elapsedSeconds` is real
   * (unscaled) time; `timeScale` and `paused` are applied by the scheduler.
   *
   * @throws FourError if the application is disposed, not initialized, not
   * running, or already inside a `step` (a nested step would advance one
   * `TimeState` re-entrantly and interleave two frames' events, which no
   * replay could reproduce — WP-1.12 decision, matching
   * `SystemRegistry.runFixedStep`'s guard).
   * @throws RangeError if `elapsedSeconds` is not a finite number >= 0
   * (validated by the scheduler).
   */
  step(elapsedSeconds: number): void {
    if (this.#disposed || !this.#initialized || !this.#running) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "Application.step() requires an initialized, started, undisposed application: call `await app.initialize()` then `app.start()` (§45).",
        {
          context: {
            method: "step",
            initialized: this.#initialized,
            running: this.#running,
            disposed: this.#disposed,
          },
        },
      );
    }
    if (this.#stepping) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "Application.step() is already running; a frame must not re-enter itself (§10).",
        { context: { method: "step", reentrant: true } },
      );
    }
    this.#stepping = true;
    try {
      this.scheduler.step(elapsedSeconds);
    } finally {
      this.#stepping = false;
    }
  }

  /**
   * Tears the application down (§45, §83): stops it, unwires the scheduler,
   * disposes every registered system, and removes every listener.
   *
   * Idempotent and terminal — a disposed application cannot be initialized or
   * started again, and stepping it throws. The scene is deliberately **not**
   * destroyed: `Node` has no `dispose` (nothing in Phase 1 holds a GPU or
   * solver resource), and the scene may well outlive the application that was
   * stepping it. The packet that gives nodes disposable resources owns that
   * decision (§83).
   *
   * The scheduler's callbacks are cleared *before* systems are disposed, so a
   * `dispose` that touches the scheduler cannot re-enter the loop or reach a
   * listener that has been told the application is gone. A system whose
   * `dispose` throws still leaves the application fully unwired: the registry
   * re-throws the first failure, and listener removal runs in a `finally`.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#running = false;

    // Idempotent, and defensive about a foreign callback: `detach` only
    // restores what it replaced if nothing else has since taken over
    // `onFixedStep` — which is exactly this class's wrapper, so the explicit
    // clears below are what actually unwire the loop.
    this.#detachSystems();
    this.scheduler.onFixedStep = undefined;
    this.scheduler.onUpdate = undefined;
    this.scheduler.onRender = undefined;

    try {
      this.systems.dispose();
    } finally {
      this.removeAllListeners();
    }
  }

  #assertNotDisposed(method: string): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `Application.${method}() was called on a disposed application; disposal is terminal (§45, §83).`,
        { context: { method, disposed: true } },
      );
    }
  }
}
