/**
 * The `Application` composition root (§45, plan D4).
 *
 * §45's Application "owns the default scene, renderer, time system, simulation
 * scheduler, input routing, assets, diagnostics, cameras, and viewports". This
 * is the current subset of that object: the scene, the simulation scheduler,
 * the §39 system registry, the §48 viewport list, the §43 pose buffer, the
 * surface size ({@link Application.resize}), and — optionally — a §61 renderer,
 * wired together and re-emitting the §10 main-loop events.
 *
 * **`app.input`, `app.assets`, `app.diagnostics`, `app.stats` and `app.physics`
 * are still absent, and that is now a gap rather than a schedule** (2026-08-06,
 * A-6). The note that stood here said they "arrive with the phases that build
 * them (§103)"; those phases have all landed — Phase 11 built `@four/assets`,
 * `@four/ui` and `@four/serialization` and wired none of them in — so the
 * sentence pointed at a future that no longer exists. What remains true is the
 * reason the options are absent rather than accepted and ignored: a program
 * that sets `physics: {…}` today fails to compile instead of silently
 * simulating nothing. Every example still hand-wires `PointerInput` and
 * `AssetManager`; closing that is A-6's own packet.
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
 *        │                      … incl. the pose snapshot  §39 step 10 / §43
 *        │                    emit("fixedUpdate", time)    §10 / §6b
 *        ├─ onUpdate          resolveWorldTransforms(scene) §7
 *        │                    emit("update", time)
 *        └─ onRender          emit("render", time)
 *                             renderer.render(scene, views, interpolation) §61
 * ```
 *
 * Four consequences worth stating, because tests pin all of them:
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
 * 4. **The draw is the last thing in the frame**, after the `render`
 *    listeners, so a listener can still move a camera or edit a viewport for
 *    the frame being drawn (§45; see `onRender` below).
 *
 * ## Headless by construction
 *
 * There is still no `requestAnimationFrame` driver and no DOM reference
 * anywhere in this file: {@link Application.start} flips state, and the host
 * calls {@link Application.step} with the elapsed seconds it chooses. That is
 * what makes determinism (§33) and replay (§34) testable — feed two
 * applications the same sequence and they produce identical event traces — and
 * a browser driver is a thin addition on top rather than something this class
 * has to be rescued from.
 *
 * The renderer does not change that. It arrives as an *instance* the
 * application author constructed (`renderer: new WebglRenderer()`), so this
 * module imports no backend even as a type at runtime, and an application
 * constructed without one behaves exactly as it did before renderers existed:
 * no renderer, no viewport list to draw, no snapshot system registered, and
 * an identical event trace (§33). Everything the renderer adds — the awaited
 * `initialize`, the per-frame draw, the §43 pose capture — is conditional on
 * that one option.
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
import type { DepthRange } from "@four/math";
import {
  PerspectiveCamera,
  PoseBuffer,
  Scene,
  createSnapshotSystem,
  resolveWorldTransforms,
  type Viewport,
  type WorldTransformStats,
} from "@four/scene";
// Type-only, and deliberately so: the emitted JavaScript of this module must
// not import a renderer package. `four/application` is the headless
// composition subpath (WP-2.7-fix2) — a program that never names a backend
// must not pull one in, and a backend arrives here as an *instance* the
// application author constructed (see `ApplicationOptions.renderer`).
import type { Renderer } from "@four/render";

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
 * The current subset of §45's `ApplicationOptions`.
 *
 * §45's remaining options (`antialias`, `alpha`, `powerPreference`,
 * `autoResize`, `reducedMotion`, `physics`) belong to subsystems that do not
 * exist yet; each option is added by the packet that builds its subsystem.
 * Omitted numeric options take the Appendix A normative defaults.
 *
 * TODO(§62, renderer-selection packet): `antialias`/`alpha`/`powerPreference`
 * are device-selection options that only a backend constructor can honour, and
 * they belong with the `"auto"` backend selection described on
 * {@link ApplicationOptions.renderer}; accepting them now would mean storing
 * values no code reads. `autoResize` needs a `ResizeObserver` on a canvas the
 * host owns, so it arrives as an injected observer factory — the discipline
 * `PointerInput` uses for `PointerSurface` — rather than as a DOM reference in
 * this file.
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

  /**
   * The backend that draws the scene (§45, §61), or `false` (the default) for a
   * headless application that draws nothing.
   *
   * **An instance, not a string** (decision, WP-3.6). §45 spells this option
   * `"auto" | "webgpu" | "webgl2" | "canvas2d" | "svg"`, i.e. the application
   * selects and constructs the backend. That form is deferred, for one
   * concrete reason: resolving a string to a class means `four` importing every
   * backend package at runtime, and every program — including the headless and
   * determinism ones — would then carry a WebGL renderer it never uses. So the
   * application author constructs the backend and hands it over:
   *
   * ```ts
   * import { WebglRenderer } from "@four/render-webgl";
   *
   * const app = new Application({ renderer: new WebglRenderer(), canvas });
   * app.views.push(createFullscreenViewport(camera));
   * await app.initialize();          // awaits renderer.initialize({ canvas })
   * app.start();
   * ```
   *
   * TODO(§62, renderer-selection packet): add the §45 string form
   * (`"auto" | "webgpu" | "webgl2" | "canvas2d" | "svg"`) as a *widening* of
   * this option, resolved through a registry a backend package opts into, so
   * that `"auto"`'s capability-ordered fallback (§62) exists without `four`
   * statically importing any backend. Passing an instance stays supported: §45
   * requires the systems to be constructible and ownable independently.
   *
   * The application **initializes** the renderer (see
   * {@link Application.initialize}) and **drives** it once per frame, but does
   * not own it: {@link Application.dispose} leaves it alone (§83 — whoever
   * created a resource disposes it).
   */
  renderer?: Renderer | false;

  /**
   * The drawing surface handed to the renderer as `initialize({ canvas })`
   * (§45, §61).
   *
   * Typed `unknown` for the same reason `RendererOptions.canvas` is: this
   * package compiles with no DOM lib, and each backend narrows and validates
   * the value itself (the WebGL 2 backend rejects a non-canvas with
   * `RENDERER_INITIALIZATION_FAILED`). Ignored when no renderer is configured.
   */
  canvas?: unknown;

  /**
   * Initial surface width in **logical** pixels (§45), applied through
   * {@link Application.resize} at construction.
   *
   * Defaults to `0` together with `height`, which means "no size has been
   * declared": nothing is forwarded to the renderer and no camera aspect is
   * touched until the first `resize` call. A renderer configured but never
   * resized keeps whatever size its own `initialize` established, exactly as
   * before this option existed.
   */
  width?: number;

  /** Initial surface height in logical pixels (§45). See {@link ApplicationOptions.width}. */
  height?: number;

  /**
   * Device pixels per logical pixel (§45, §61) — `devicePixelRatio` in a
   * browser. Default `1`.
   *
   * Validated at construction, with or without a `width`/`height` pair
   * (2026-08-07): a non-finite or non-positive value throws a `RangeError` from
   * the constructor rather than reaching `renderer.resize` on some later call.
   */
  resolution?: number;

  /**
   * Clip-space depth convention the projections this application recomputes are
   * written with (plan D8).
   *
   * {@link Application.resize} rebuilds the projection of any perspective camera
   * filling the surface, and §47 makes that an *explicit* recomputation whose
   * depth convention belongs to the renderer, not to the camera. Defaults to
   * `"negative-one-to-one"`, matching `Camera.updateProjectionMatrix` and the
   * WebGL 2 MVP (§120); a WebGPU application passes `"zero-to-one"`, exactly as
   * it does to `PointerInput`.
   */
  depthRange?: DepthRange;

  /**
   * The viewports drawn each frame, in order (§48). Copied into
   * {@link Application.views}, which is mutable afterwards.
   *
   * Defaults to none — and an application with **no viewport draws nothing**
   * (§61: an empty view list draws and clears nothing), because there is no
   * camera the application could invent. Push a viewport before the first
   * frame:
   *
   * ```ts
   * app.views.push(createFullscreenViewport(camera));
   * ```
   */
  views?: readonly Viewport[];

  /**
   * Whether the frame's draw uses §43 interpolated render poses. Defaults to
   * `true` when a renderer is configured, `false` otherwise.
   *
   * When on, the application owns a {@link PoseBuffer} ({@link Application.poses}),
   * registers the §39 step-10 snapshot system that captures into it, and passes
   * `{ poseBuffer, alpha: time.interpolationAlpha }` to every
   * `renderer.render` call. **Which nodes are interpolated is still opt-in**:
   * the buffer tracks nothing until something calls `app.poses.track(node)`
   * (from Phase 5 the physics adapter tracks its bodies), and an untracked node
   * draws from its live transform. Tracking every node automatically would cost
   * a copy per node per fixed step for scenery that never moves (decision,
   * WP-3.6).
   *
   * Set it to `false` for a renderer that must draw exactly the simulation
   * state — a screenshot at a known step, a visual regression baseline — and to
   * `true` without a renderer to run the capture for a custom draw path.
   */
  poseInterpolation?: boolean;
}

/**
 * The §89 code every lifecycle-misuse failure of this class carries.
 *
 * §89 lists nine "example codes" and `@four/core` models them as a closed
 * union so a typo is a compile error; `INVALID_APPLICATION_STATE` (added by
 * WP-1.12-fix1) names "the application
 * was used out of order" precisely. Every throw still carries a `context`
 * naming the real state (`initialized`, `running`, `disposed`, `method`) and a
 * message that says what the caller did wrong.
 */
const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * Whether `view` covers the whole drawing surface — a normalized `(0, 0, 1, 1)`
 * rectangle, which is what `createFullscreenViewport` builds (§48).
 *
 * Deliberately exact rather than approximate: a viewport that is *nearly*
 * full-surface is a deliberate inset, and silently treating it as full-surface
 * would give its camera the surface's aspect rather than its own.
 */
function isFullSurface(view: Viewport): boolean {
  return (
    view.normalized === true &&
    view.x === 0 &&
    view.y === 0 &&
    view.width === 1 &&
    view.height === 1
  );
}

/**
 * Refuses a resolution that is not a finite number of device pixels per logical
 * pixel `> 0`.
 *
 * One function rather than an inline check inside {@link Application.resize},
 * because the constructor has a **second** way in: `ApplicationOptions`
 * `resolution` without a `width`/`height` pair never reaches `resize` and used
 * to be stored unvalidated (2026-08-07), so `new Application({ renderer,
 * resolution: 0 })` was accepted and the *next* `resize(w, h)` forwarded the
 * zero to `renderer.resize` — a degenerate drawing buffer, reported at a call
 * site that had done nothing wrong. Both paths validate through here now, so an
 * option and an argument are refused by the same rule with the same message.
 */
function assertResolution(resolution: number): void {
  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new RangeError(
      `Application resolution must be a finite number of device pixels per logical pixel > 0 (got ${String(resolution)}).`,
    );
  }
}

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
   * (register a {@link @four/motion!SimulationSystem | SimulationSystem} or an event listener instead, D5).
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

  /**
   * The backend this application draws with (§45, §61), or `null` when it is
   * headless.
   *
   * Constructed by the application *author* and merely driven here — see
   * {@link ApplicationOptions.renderer}. It is initialized by
   * {@link Application.initialize}, called once per frame after the `render`
   * event, and **not** disposed by {@link Application.dispose}.
   */
  readonly renderer: Renderer | null;

  /**
   * The viewports drawn each frame, in order (§48). Mutable: push, splice, and
   * reorder it at any time; the next frame uses whatever it holds.
   *
   * Empty by default, and an empty list **draws and clears nothing** (§61).
   * The array itself is handed to the renderer without being copied, so a
   * backend must read it during the call (the `Renderer.render` contract).
   */
  readonly views: Viewport[] = [];

  /**
   * The engine's single previous/current pose store (§37, §43).
   *
   * Always present, and empty until something tracks a node —
   * `app.poses.track(node)`. It is captured once per fixed step (§39 step 10)
   * only when pose interpolation is on, which is the default whenever a
   * renderer is configured; see {@link ApplicationOptions.poseInterpolation}.
   * Not cleared by {@link Application.dispose}, for the reason the scene is not
   * destroyed either: the buffer may outlive the application that stepped it.
   */
  readonly poses = new PoseBuffer();

  /** Undoes {@link SystemRegistry.attachToScheduler}; run once, by `dispose`. */
  readonly #detachSystems: Detach;

  /** {@link ApplicationOptions.canvas}, held until `initialize` hands it over. */
  readonly #canvas: unknown;

  /** Whether the frame's draw passes §43 interpolation. See the option. */
  readonly #poseInterpolation: boolean;

  /** Clip-space depth convention `resize` recomputes projections with (D8). */
  readonly #depthRange: DepthRange | undefined;

  /** Surface size in logical pixels; `0 × 0` until `resize` (or the options) set it. */
  #surfaceWidth = 0;
  #surfaceHeight = 0;

  /** Device pixels per logical pixel, as last given to `resize`. */
  #resolution = 1;

  /**
   * The §43 record handed to `renderer.render`, reused every frame with only
   * `alpha` rewritten (plan D7: the loop allocates nothing). Safe because
   * `Renderer.render` forbids a backend from retaining it.
   */
  readonly #interpolation: { poseBuffer: PoseBuffer; alpha: number };

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
    this.renderer =
      options.renderer === undefined || options.renderer === false
        ? null
        : options.renderer;
    this.#canvas = options.canvas;
    if (options.views !== undefined) {
      // Copied, not aliased: `views` is the application's array from here on,
      // so an author who keeps their own list does not accidentally share
      // mutation with the frame loop (decision, WP-3.6).
      this.views.push(...options.views);
    }
    this.#depthRange = options.depthRange;
    this.#poseInterpolation =
      options.poseInterpolation ?? this.renderer !== null;
    this.#interpolation = { poseBuffer: this.poses, alpha: 0 };
    if (this.#poseInterpolation) {
      // §39 step 10, at the default `POSE_SNAPSHOT_PRIORITY`: after every
      // system that moves a node, so the captured pose is the finished pose of
      // the step (§43). Registered here rather than in `initialize` so that
      // `app.systems` describes the application before it is initialized, and
      // so a program that never initializes still tears down symmetrically.
      this.systems.register(createSnapshotSystem(this.poses));
    }

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
      // Listeners first, then the draw (decision, WP-3.6). §10's own example
      // renders *from* the `render` listener, so the two orders are equally
      // spec-conformant; drawing last is the useful one, because a listener is
      // where an application moves its camera, updates a viewport rectangle,
      // or toggles visibility for the frame — work that would otherwise land
      // one frame late. Nothing in the frame depends on the reverse order: the
      // renderer neither emits nor mutates scene state.
      this.emit("render", time);
      this.#draw(time);
    };

    // Last, so the resize sees the final viewport list and the constructed
    // renderer. Both dimensions or neither: a surface with one of them is not a
    // surface, and forwarding a half-declared `0 × h` would blank a canvas the
    // host had already sized.
    if (options.resolution !== undefined) {
      // Validated even on this path, which does not go through `resize`
      // (2026-08-07) — see `assertResolution`.
      assertResolution(options.resolution);
      this.#resolution = options.resolution;
    }
    if (options.width !== undefined && options.height !== undefined) {
      this.resize(options.width, options.height, options.resolution);
    }
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
   * With a renderer configured this awaits `renderer.initialize({ canvas })` —
   * §61's context or device acquisition, which is genuinely asynchronous for
   * WebGPU and may compile pipelines for any backend — and the application
   * counts as initialized only once that resolves. A rejected renderer
   * initialization therefore rejects this call, leaves `initialized` false, and
   * leaves `start()` refusing to run: a program that failed to acquire a GPU
   * should stop at the line that says so, not at the first frame (decision,
   * WP-3.6). The rejection is remembered, so a retry needs a new application.
   *
   * With no renderer there is still nothing to await, and this resolves on the
   * next microtask. It has always been async because §45's usage is
   * `await app.initialize(); app.start();`, and the later subsystems (WASM
   * solver loading §37, asset preloads §75) are asynchronous too.
   *
   * Idempotent: repeated or concurrent calls return the same promise and
   * initialize once.
   *
   * @throws FourError if the application has been disposed. Thrown
   * synchronously, like every other lifecycle precondition here.
   */
  initialize(): Promise<void> {
    this.#assertNotDisposed("initialize");
    this.#initialization ??= Promise.resolve().then(async () => {
      await this.renderer?.initialize({ canvas: this.#canvas });
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
   * The surface width in logical pixels, as last given to
   * {@link Application.resize}. `0` before any resize.
   */
  get width(): number {
    return this.#surfaceWidth;
  }

  /** The surface height in logical pixels. See {@link Application.width}. */
  get height(): number {
    return this.#surfaceHeight;
  }

  /**
   * Device pixels per logical pixel, as last given to
   * {@link Application.resize}. `1` until one is supplied.
   */
  get resolution(): number {
    return this.#resolution;
  }

  /**
   * Resizes the drawing surface (§45's seventh lifecycle method, 2026-08-06
   * A-7; "eighth" until 2026-08-07 — §45 lists initialize, start, stop, pause,
   * resume, step, resize, dispose, and `resize` is the seventh of those eight).
   *
   * Three things happen, in this order:
   *
   * 1. the size is **recorded** ({@link Application.width} /
   *    {@link Application.height} / {@link Application.resolution}), so a
   *    headless application still knows how big it is;
   * 2. the renderer is told — `renderer.resize(width, height, resolution)`,
   *    which makes the drawing buffer `width · resolution` × `height ·
   *    resolution` device pixels and re-resolves every normalized viewport
   *    rectangle (§61);
   * 3. every **full-surface** viewport whose camera is a
   *    {@link PerspectiveCamera} has its `aspect` set to `width / height` and
   *    its projection rebuilt.
   *
   * **Why this class updates cameras and the renderer does not** (decision,
   * A-7; the sentence here quoted §61 until 2026-08-07 — "a camera's `aspect`
   * is the application's to set, because only the application knows which
   * camera belongs to which viewport" — and §61 says no such thing: it defines
   * `Renderer.resize(width, height, resolution)` and nothing about cameras. The
   * reasoning stands on its own and is restated as the decision it is). §47
   * gives the camera its projection and §48 maps one camera to one viewport
   * rectangle; a renderer is handed the finished `Viewport[]` and has no way to
   * know which of those rectangles a given camera was authored for. This class
   * is exactly that knowledge — {@link Application.views} is the mapping — so
   * the aspect update belongs here. §47 keeps projection recomputation
   * explicit, so the rebuild is a call to `updateProjectionMatrix`, made with
   * {@link ApplicationOptions.depthRange}.
   *
   * **Full-surface** means `normalized` with the rectangle `(0, 0, 1, 1)` —
   * what `createFullscreenViewport` builds. A partial viewport is left alone
   * because its aspect is its rectangle's, not the surface's, and the rectangle
   * may be in pixels the application maintains itself; an orthographic camera
   * is left alone because its extent is an authoring decision (how much world
   * to show), not a consequence of the window size.
   * Two viewports sharing one camera update it twice with the same value, which
   * is idempotent.
   *
   * **Headless is a no-op for step 2 only.** With no renderer the size is still
   * recorded and the cameras are still updated: a headless application that
   * feeds a custom draw path or takes a screenshot needs both, and "no
   * renderer" is not "no surface".
   *
   * Legal at any point in the lifecycle, including before `initialize` and
   * while stopped — a window resizes whether or not a frame is running. Not
   * legal after `dispose`.
   *
   * @param width surface width in logical pixels; finite and `>= 0`
   * @param height surface height in logical pixels; finite and `>= 0`
   * @param resolution device pixels per logical pixel; finite and `> 0`.
   * Defaults to the current value, so `app.resize(w, h)` after
   * `app.resize(w, h, 2)` keeps the 2× buffer rather than silently halving it.
   * @throws FourError if the application has been disposed
   * @throws RangeError if any argument is out of range
   */
  resize(width: number, height: number, resolution?: number): void {
    this.#assertNotDisposed("resize");
    if (!Number.isFinite(width) || width < 0) {
      throw new RangeError(
        `Application.resize width must be a finite number of logical pixels >= 0 (got ${String(width)}).`,
      );
    }
    if (!Number.isFinite(height) || height < 0) {
      throw new RangeError(
        `Application.resize height must be a finite number of logical pixels >= 0 (got ${String(height)}).`,
      );
    }
    if (resolution !== undefined) {
      assertResolution(resolution);
    }

    this.#surfaceWidth = width;
    this.#surfaceHeight = height;
    if (resolution !== undefined) {
      this.#resolution = resolution;
    }

    this.renderer?.resize(width, height, this.#resolution);

    if (width <= 0 || height <= 0) {
      // A degenerate surface has no aspect ratio; writing `NaN` or `Infinity`
      // into a projection would poison every matrix derived from it.
      return;
    }
    const aspect = width / height;
    for (const view of this.views) {
      if (!isFullSurface(view)) {
        continue;
      }
      const camera = view.camera;
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix(this.#depthRange);
      }
    }
  }

  /**
   * Tears the application down (§45, §83): stops it, unwires the scheduler,
   * disposes every registered system, and removes every listener.
   *
   * Idempotent and terminal — a disposed application cannot be initialized or
   * started again, and stepping it throws. The scene is deliberately **not**
   * destroyed: `Node` has no `dispose` (nothing yet holds a GPU or solver
   * resource on a node), and the scene may well outlive the application that
   * was stepping it. The packet that gives nodes disposable resources owns that
   * decision (§83).
   *
   * **The renderer is not disposed either** (§83, decision WP-3.6). It arrives
   * as an instance the application author constructed
   * ({@link ApplicationOptions.renderer}), so the author disposes it —
   * ownership follows construction, and an application that destroyed a
   * renderer it was merely lent would break the perfectly ordinary case of one
   * renderer outliving, or being shared between, applications. Disposing it is
   * one line at the same call site:
   *
   * ```ts
   * app.dispose();
   * renderer.dispose();
   * ```
   *
   * {@link Application.views} and {@link Application.poses} are left intact for
   * the same reason the scene is; the snapshot system that captured into the
   * buffer is disposed with every other registered system.
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

  /**
   * The frame's draw (§45, §61), run after the `render` listeners.
   *
   * Two ways to draw nothing, both silent and both normal: no renderer
   * (headless), and no viewport (§61 — an empty view list draws and clears
   * nothing). Pose interpolation off is not one of them: it merely omits the
   * third argument, so the backend draws the resolved world transforms (§7)
   * instead of §43 render poses. Those matrices were resolved at the top of
   * `onUpdate`, so either path draws a current frame.
   */
  #draw(time: ReadonlyTimeState): void {
    const renderer = this.renderer;
    if (renderer === null || this.views.length === 0) {
      return;
    }
    if (!this.#poseInterpolation) {
      renderer.render(this.scene, this.views);
      return;
    }
    this.#interpolation.alpha = time.interpolationAlpha;
    renderer.render(this.scene, this.views, this.#interpolation);
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
