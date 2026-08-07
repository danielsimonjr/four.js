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
 * **`app.input`, `app.assets`, `app.diagnostics` and `app.physics` are still
 * absent, and that is now a gap rather than a schedule** (2026-08-06, A-6;
 * `app.stats` was in this list until 2026-08-07, when A-1 added it — see
 * {@link Application.stats}). The note that stood here said they "arrive with
 * the phases that build them (§103)"; those phases have all landed — Phase 11
 * built `@four/assets`, `@four/ui` and `@four/serialization` and wired none of
 * them in — so the sentence pointed at a future that no longer exists. What
 * remains true is the reason the options are absent rather than accepted and
 * ignored: a program that sets `physics: {…}` today fails to compile instead of
 * silently simulating nothing. Every example still hand-wires `PointerInput`
 * and `AssetManager`; closing that is A-6's own packet.
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
  createFrameStats,
  monotonicNowSeconds,
  recordRenderStatistics,
  resetFrameStats,
  type FrameStats,
} from "@four/diagnostics";
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
// not import a renderer *backend*. `four/application` is the headless
// composition subpath (WP-2.7-fix2) — a program that never names a backend
// must not pull one in, and a backend arrives here as an *instance* the
// application author constructed (see `ApplicationOptions.renderer`).
import type {
  RenderStatistics,
  Renderer,
  RendererFallbackReport,
  RendererRegistry,
  RendererSelection,
} from "@four/render";
// The one value this module takes from `@four/render` (R-2/A-8, 2026-08-07),
// and the reason the sentence above says "backend" rather than "package":
// `resolveRenderer` is `renderer-registry.ts`'s eight-line front door, it
// names no backend and no other module of that package, and it deliberately
// does not reference `RendererRegistry` — so a bundle whose application hands
// this class a constructed renderer keeps this function and its message and
// drops the registry, the §62 preference walk, and every backend with it. The
// alternative, a `switch` over the §45 string, would make `four` import all
// five backends and cost every program a renderer it never uses (§91; MEMORY
// 2026-08-01).
import { resolveRenderer } from "@four/render";

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
 * §45's remaining options (`alpha`, `powerPreference`, `autoResize`,
 * `reducedMotion`, `physics`) belong to subsystems that do not exist yet; each
 * option is added by the packet that builds its subsystem. Omitted numeric
 * options take the Appendix A normative defaults.
 *
 * `antialias` landed with the §62 selection packet (R-2/A-8, 2026-08-07), for
 * the reason its TODO gave: it is a *device-selection* option only a backend
 * constructor can honour, so it had to wait for the code that constructs the
 * backend. `alpha` and `powerPreference` are still absent because
 * `RendererOptions` (§61) does not carry them — accepting them here would mean
 * storing values no backend ever reads, which is the accept-and-ignore this
 * repository refuses. `autoResize` needs a `ResizeObserver` on a canvas the
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
   * The backend that draws the scene (§45, §61) — an instance, or §45's string
   * form — or `false` (the default) for a headless application that draws
   * nothing.
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
   * ## The string form (R-2/A-8, 2026-08-07)
   *
   * §45 spells this option `"auto" | "webgpu" | "webgl2" | "canvas2d" | "svg"`,
   * and since 2026-08-01 this class took an instance instead, because
   * resolving a string to a class would mean `four` importing every backend
   * package at runtime: every program — the headless and determinism ones
   * included — would carry a WebGL renderer it never uses (§91; the deferral is
   * recorded in MEMORY, and the payload evidence was a 14.88 kB example).
   *
   * The string now works, and that reason is intact, because `four` still
   * imports no backend. A backend package registers itself into
   * `@four/render`'s §62 registry when the application asks it to, and the
   * string is resolved against whatever was registered:
   *
   * ```ts
   * import { registerWebglRenderer } from "@four/render-webgl";
   *
   * registerWebglRenderer();                    // the app names its backends
   * const app = new Application({ renderer: "auto", canvas, antialias: true });
   * await app.initialize();                     // resolves, then initializes
   * app.renderer;                               // the WebglRenderer, from here on
   * ```
   *
   * `"auto"` prefers WebGPU, then WebGL 2, then a 2D backend (§62), skipping
   * any that is unregistered, reports itself unsupported, or fails to
   * initialize — each skip reported through
   * {@link ApplicationOptions.onRendererFallback}. A named backend fails fast
   * with `RENDERER_INITIALIZATION_FAILED` (§62, §89) rather than downgrading,
   * and so does `"auto"` when nothing is left, naming every backend that *is*
   * registered (§85).
   *
   * Three consequences worth stating:
   *
   * 1. **{@link Application.renderer} is `null` until
   *    {@link Application.initialize} resolves** when a string is used — there
   *    is no renderer to hold before then. With an instance it is set at
   *    construction, exactly as before.
   * 2. **The registry initializes the renderer it built.** §62's fallback is
   *    defined in terms of `initialize` failing, so the selection has to be the
   *    one calling it; this class does not call it a second time.
   * 3. **Passing an instance stays fully supported**, and is what §45 requires
   *    ("the application must permit advanced users to construct and own these
   *    systems independently").
   *
   * The application **initializes** the renderer (see
   * {@link Application.initialize}) and **drives** it once per frame, but does
   * not own it: {@link Application.dispose} leaves it alone (§83 — whoever
   * created a resource disposes it), including one the registry built on its
   * behalf.
   */
  renderer?: Renderer | RendererSelection | false;

  /**
   * Requests multisampled anti-aliasing from the backend (§45, §61).
   *
   * Forwarded verbatim as `RendererOptions.antialias` — to the string form's
   * construction *and* initialization, and to an instance's `initialize`. A
   * hint, not a requirement: §61 forbids a backend from failing initialization
   * over it.
   *
   * Ignored when no renderer is configured.
   */
  antialias?: boolean;

  /**
   * Called for each backend `renderer: "auto"` passes over, with the §62 reason
   * (`"unsupported"` or `"initialization-failed"`).
   *
   * This is §62's *"emits a diagnostics event"*, delivered as a callback: the
   * frozen §3.1 matrix gives `@four/render` no `@four/diagnostics` edge, so the
   * report is handed to the application, which is the one place that already
   * has both. Forwarding it to a diagnostics channel is one line.
   *
   * Never called for an instance, or for an explicitly named backend — naming
   * one means it must work, so its failure is thrown rather than reported.
   */
  onRendererFallback?: (report: RendererFallbackReport) => void;

  /**
   * The §62 registry {@link ApplicationOptions.renderer}'s string form resolves
   * against; the shared one by default.
   *
   * Pass one to keep a selection scope to itself — the discipline the tests use
   * so that one application's backends are invisible to the next, and the seam
   * a host embedding two independent engines needs. Unread for an instance.
   */
  rendererRegistry?: RendererRegistry;

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

  /**
   * Whether to measure §84's runtime statistics into {@link Application.stats}.
   * Defaults to `false` (A-1, 2026-08-07).
   *
   * **Off by default, and off means off.** With statistics off,
   * {@link Application.stats} is `null`, the clock is never read, the backend's
   * counters are never assigned, and the frame runs the code it ran before this
   * option existed apart from three `!== null` comparisons per frame — no
   * allocation, and not one GPU call added, removed, or reordered. That is the
   * point: a diagnostic that changes the thing it measures is not a diagnostic
   * (§84), and a `render` gated on a `render`-affecting flag could not share a
   * pixel golden with one that is not.
   *
   * With statistics on, the application owns one {@link FrameStats} record,
   * resets it at the top of every {@link Application.step}, measures
   * `cpuFrameTime` and `simulationTime` itself, and — when the renderer reports
   * them (§61's optional `statistics` member) — reads `drawCalls`, `triangles`,
   * and `instances` back off the backend. The counters §84 lists that nothing
   * in this repository can yet measure stay `NaN`; `FrameStats` says which and
   * why.
   */
  stats?: boolean;

  /**
   * Monotonic clock, **in seconds**, used only by the §84 statistics
   * ({@link ApplicationOptions.stats}). Defaults to `performance.now()`
   * divided by 1000; a host without `performance` measures nothing and the two
   * durations read `NaN` rather than being filled from a non-monotonic
   * `Date.now()` this repository bans outright (§33 — see
   * `@four/diagnostics`' `createMonotonicClock`).
   *
   * Injected rather than reached for, the way `PointerInput` takes a
   * `PointerSurface`: this class names no host object, so a test can measure a
   * frame it controls (`now: () => t`), a profiler can supply its own timebase,
   * and a worker or an exotic host is not a special case. Read at most twice
   * per {@link Application.step}, and never at all when `stats` is off — so a
   * clock with a cost (a syscall, a GPU query) is only paid for when its
   * numbers are wanted.
   *
   * Seconds, like every other time in this engine (§7a, §9). A clock that
   * reports milliseconds must divide.
   */
  now?: () => number;
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
   * Constructed by the application *author* — or, for the string form, by the
   * §62 registry on its behalf (R-2/A-8) — and merely driven here; see
   * {@link ApplicationOptions.renderer}. It is initialized by
   * {@link Application.initialize}, called once per frame after the `render`
   * event, and **not** disposed by {@link Application.dispose}.
   *
   * A getter rather than a `readonly` field since 2026-08-07, because a string
   * selection has nothing to hold at construction: with `renderer: "auto"` this
   * reads `null` until `initialize()` resolves, and the resolved backend from
   * then on. With an instance it is set in the constructor and never changes,
   * exactly as before.
   */
  get renderer(): Renderer | null {
    return this.#renderer;
  }

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

  /**
   * §84's runtime statistics for the frame just stepped, or `null` when
   * statistics are off — which is the default (A-1, 2026-08-07; A-6 recorded
   * this member as absent until then).
   *
   * ```ts
   * const app = new Application({ renderer, stats: true });
   * // … a frame later …
   * app.stats?.cpuFrameTime;   // seconds of CPU work in the last step
   * app.stats?.drawCalls;      // what the backend actually submitted
   * ```
   *
   * **One record, rewritten in place** every {@link Application.step} — the
   * same discipline §9's `TimeState` follows, and for the same reason (plan D7:
   * the loop allocates nothing per frame). Retaining a reference retains
   * nothing; copy a frame's values with `copyFrameStats` from
   * `@four/diagnostics`.
   *
   * **A field reading `NaN` was not measured this frame**, as distinct from a
   * `0` that was measured. Five of §84's eleven counters have no producer
   * anywhere in this repository (`gpuFrameTime`, `physicsStepTime`,
   * `contacts`, `textureMemory`, `bufferMemory` — the last two pending §83
   * ownership tracking), and a sixth, `activeBodies`, has one
   * (`recordSolverStatistics`) that nothing *here* can call: this class owns no
   * physics world, which is A-6's `app.physics`. Until it does, an application
   * with a solver fills that field itself, from a fixed-step listener.
   * {@link @four/diagnostics!FrameStats | FrameStats} documents each counter
   * and what it waits on. `drawCalls`/`triangles`/`instances` are `NaN` with no
   * renderer, or with a backend that does not report statistics, and `0` when a
   * reporting backend drew nothing.
   *
   * What is deliberately *not* here: §10's fixed-step count, dropped time, and
   * every §9 clock. They are on `app.time` already, and §84's list does not
   * name them — a statistics block that re-published the time record would be
   * two places to read one number.
   */
  readonly stats: FrameStats | null;

  /** Undoes {@link SystemRegistry.attachToScheduler}; run once, by `dispose`. */
  readonly #detachSystems: Detach;

  /** {@link ApplicationOptions.canvas}, held until `initialize` hands it over. */
  readonly #canvas: unknown;

  /** {@link ApplicationOptions.antialias}, forwarded with the canvas (§61). */
  readonly #antialias: boolean | undefined;

  /**
   * The backend, or `null` while headless or while a string selection is still
   * unresolved. Written exactly twice at most: the constructor, and the
   * selection inside {@link Application.initialize}.
   */
  #renderer: Renderer | null;

  /**
   * §45's string form, held until {@link Application.initialize} resolves it
   * against the §62 registry, and `null` when the option was an instance or
   * absent (R-2/A-8).
   */
  readonly #rendererSelection: RendererSelection | null;

  /** {@link ApplicationOptions.onRendererFallback}; §62's diagnostics report. */
  readonly #onRendererFallback:
    ((report: RendererFallbackReport) => void) | undefined;

  /** {@link ApplicationOptions.rendererRegistry}; the shared one when absent. */
  readonly #rendererRegistry: RendererRegistry | undefined;

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

  /**
   * The record the renderer accumulates §84's draw counters into, or `null`
   * when statistics are off or the backend does not report them (§61's
   * optional `statistics` member).
   *
   * Built here as an object literal rather than with `@four/render`'s
   * `createRenderStatistics()` for the reason the `Renderer` import is
   * type-only (see the top of this file): the emitted JavaScript of the
   * headless composition subpath must not pull in a render package, and the
   * factory it would call is a three-field zero literal. `RenderStatistics` is
   * imported as a *type*, so the shape is still pinned by the compiler.
   */
  #renderStatistics: RenderStatistics | null = null;

  /**
   * Whether {@link ApplicationOptions.stats} asked for §84's draw counters, so
   * that a renderer resolved later (the string form) is wired to them exactly
   * as a constructed one is. Unread once `#renderStatistics` is set.
   */
  readonly #statisticsRequested: boolean;

  /** {@link ApplicationOptions.now}; unread while statistics are off. */
  readonly #now: () => number;

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
    // §45's option is now an instance, a selection string, or `false`
    // (R-2/A-8). The string is kept and resolved in `initialize`, because
    // building a backend means acquiring a context — asynchronous by §61, and
    // not something a constructor may do.
    const rendererOption = options.renderer;
    this.#renderer =
      rendererOption === undefined ||
      rendererOption === false ||
      typeof rendererOption === "string"
        ? null
        : rendererOption;
    this.#rendererSelection =
      typeof rendererOption === "string" ? rendererOption : null;
    this.#onRendererFallback = options.onRendererFallback;
    this.#rendererRegistry = options.rendererRegistry;
    this.#canvas = options.canvas;
    this.#antialias = options.antialias;
    if (options.views !== undefined) {
      // Copied, not aliased: `views` is the application's array from here on,
      // so an author who keeps their own list does not accidentally share
      // mutation with the frame loop (decision, WP-3.6).
      this.views.push(...options.views);
    }
    this.#now = options.now ?? monotonicNowSeconds;
    // §84 (A-1). One record for the application's lifetime, and — when the
    // backend reports draw counters at all — one for the renderer to
    // accumulate into; `#lendStatistics` does the lending, here for an instance
    // and again after a string selection resolves.
    this.stats = options.stats === true ? createFrameStats() : null;
    this.#statisticsRequested = this.stats !== null;
    this.#lendStatistics();
    this.#depthRange = options.depthRange;
    // A selection counts as "a renderer is configured" for the §43 default: the
    // capture system is registered here or not at all (see below), and a
    // program that asked for `renderer: "auto"` is going to draw.
    this.#poseInterpolation =
      options.poseInterpolation ??
      (this.#renderer !== null || this.#rendererSelection !== null);
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
      // §84's `simulationTime`: wall-clock seconds spent inside the frame's
      // fixed steps, summed over however many the accumulator runs. Measured
      // around the *whole* step — systems and `fixedUpdate` listeners — because
      // that is what the frame pays for simulating; the solver's own share is
      // `physicsStepTime`, which only the solver can report (staged).
      const stats = this.stats;
      if (stats === null) {
        runSystems?.(time);
        this.emit("fixedUpdate", time);
        return;
      }
      const started = this.#now();
      try {
        runSystems?.(time);
        this.emit("fixedUpdate", time);
      } finally {
        // In a `finally` so a throwing system leaves the accumulator holding
        // the time it really spent rather than losing the step entirely; the
        // exception propagates unchanged.
        stats.simulationTime += this.#now() - started;
      }
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
      const selection = this.#rendererSelection;
      if (selection === null) {
        await this.#renderer?.initialize({
          canvas: this.#canvas,
          antialias: this.#antialias,
        });
      } else {
        // The registry constructs *and* initializes: §62's fallback is defined
        // in terms of initialization failing, so it has to own that call. What
        // comes back is ready to draw, and is never initialized twice.
        const renderer = await resolveRenderer(
          selection,
          {
            canvas: this.#canvas,
            antialias: this.#antialias,
            onFallback: this.#onRendererFallback,
          },
          this.#rendererRegistry,
        );
        this.#renderer = renderer;
        this.#lendStatistics();
        // A size declared before the backend existed — through the `width`/
        // `height` options or a `resize` call — was recorded but had nothing to
        // forward to. Replay it now, so the string form ends up in exactly the
        // state the instance form is in.
        if (this.#surfaceWidth > 0 && this.#surfaceHeight > 0) {
          this.resize(
            this.#surfaceWidth,
            this.#surfaceHeight,
            this.#resolution,
          );
        }
      }
      this.#initialized = true;
    });
    return this.#initialization;
  }

  /**
   * Hands the renderer the §84 record to accumulate into, if this application
   * was asked for statistics and the backend reports them (A-1).
   *
   * Called from the constructor for an instance and from
   * {@link Application.initialize} for a resolved selection, so both forms wire
   * up identically. Idempotent: a second call with the record already lent
   * re-assigns the same object.
   */
  #lendStatistics(): void {
    const renderer = this.#renderer;
    if (
      !this.#statisticsRequested ||
      renderer === null ||
      !("statistics" in renderer)
    ) {
      return;
    }
    // Assigning `renderer.statistics` reaches into an object this class does
    // not own, which is why it happens **only** when the application was asked
    // for statistics, and why `dispose` puts it back: ownership follows
    // construction (§83), so the borrow is scoped to the application's life
    // exactly as the renderer's initialization is.
    this.#renderStatistics ??= { drawCalls: 0, triangles: 0, instances: 0 };
    renderer.statistics = this.#renderStatistics;
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
   * With statistics on ({@link ApplicationOptions.stats}) this call is also
   * §84's frame boundary: {@link Application.stats} is reset before the frame
   * and finished after it, so it always describes the *last completed* step. A
   * frame that throws records nothing — its numbers would describe half a
   * frame, and half a frame's `drawCalls` is worse than no answer.
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
    const stats = this.stats;
    let frameStarted = 0;
    if (stats !== null) {
      // §84's frame boundary (A-1). Everything goes back to "not measured"
      // first, so a producer that does not run this frame cannot leave last
      // frame's number standing; the two accumulators this class owns then
      // seed themselves, because initializing a counter is the job of whoever
      // is about to write it.
      resetFrameStats(stats);
      stats.simulationTime = 0;
      if (this.#renderStatistics !== null) {
        this.#renderStatistics.drawCalls = 0;
        this.#renderStatistics.triangles = 0;
        this.#renderStatistics.instances = 0;
      }
      frameStarted = this.#now();
    }
    this.#stepping = true;
    try {
      this.scheduler.step(elapsedSeconds);
    } finally {
      this.#stepping = false;
    }
    if (stats !== null) {
      if (this.#renderStatistics !== null) {
        recordRenderStatistics(stats, this.#renderStatistics);
      }
      stats.cpuFrameTime = this.#now() - frameStarted;
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

    // Give the renderer its `statistics` slot back (A-1). The renderer is not
    // this application's to dispose (see below), and by the same rule the
    // record this application lent it must not outlive the loan: a renderer
    // shared with a second application, or kept for a later one, would
    // otherwise go on accumulating into a record nobody reads. Cleared only
    // when this application is the one that filled it.
    const renderer = this.renderer;
    if (
      this.#renderStatistics !== null &&
      renderer !== null &&
      renderer.statistics === this.#renderStatistics
    ) {
      renderer.statistics = null;
    }

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
