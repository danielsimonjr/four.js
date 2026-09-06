/**
 * §84 runtime statistics — the record behind `app.stats` (A-1, 2026-08-07).
 *
 * §84 opens the diagnostics section with a block of counter reads:
 *
 * ```ts
 * app.stats.cpuFrameTime;
 * app.stats.gpuFrameTime;
 * app.stats.simulationTime;
 * app.stats.physicsStepTime;
 * app.stats.drawCalls;
 * app.stats.triangles;
 * app.stats.instances;
 * app.stats.activeBodies;
 * app.stats.contacts;
 * app.stats.textureMemory;
 * app.stats.bufferMemory;
 * ```
 *
 * {@link FrameStats} is exactly that list — **eleven** fields, no more and no
 * fewer. (`docs/GAP ANALYSIS v0.md` A-1 calls them "the twelve named counters"
 * twice; the spec block it quotes lists eleven. Recorded here rather than
 * silently rounded: the deviation is the gap document's, and this module is
 * written against §84 itself.)
 *
 * ## `NaN` means "not measured", `0` means "measured zero"
 *
 * Every field is a plain mutable `number`, and {@link resetFrameStats} sets all
 * of them to `NaN`. A producer that ran writes its fields; a producer that does
 * not exist writes nothing, and the field reads `NaN` for the frame. That
 * distinction is the whole reason this record can be shipped before its
 * producers are: a headless application honestly reports `drawCalls: NaN`
 * ("nobody counted"), while an application with a renderer and an empty view
 * list reports `drawCalls: 0` ("counted; nothing was drawn"). Filling an
 * unmeasured counter with `0` would be a confident wrong answer, which is the
 * failure mode §84 exists to prevent — the same stance
 * {@link @four/render!RendererCapabilities | RendererCapabilities} takes on
 * limits a backend has not queried.
 *
 * Read the fields with `Number.isNaN` in mind, and render them as `—` rather
 * than as a number in an overlay.
 *
 * ## Times are seconds (§7a, §9)
 *
 * `cpuFrameTime`, `gpuFrameTime`, `simulationTime`, and `physicsStepTime` are
 * **durations in seconds**, like every other time in this engine — never
 * milliseconds. A host clock that reports milliseconds is divided on the way in
 * (see {@link createMonotonicClock}).
 *
 * ## Zero allocation (plan D7)
 *
 * One record per application, written in place every frame; nothing here
 * allocates after {@link createFrameStats}. {@link resetFrameStats},
 * {@link recordRenderStatistics}, and {@link recordSolverStatistics} are field
 * writes, and {@link copyFrameStats} takes its destination as an `out`
 * parameter (§7b's hot-path discipline). The frame loop that owns the record
 * therefore adds a fixed handful of stores per frame and nothing to the heap.
 *
 * ## Producers, and the seams they arrive through
 *
 * `@four/diagnostics` may depend on `core`, `math`, and `scene` only (plan
 * §3.1, frozen), so it cannot import `@four/render`, `@four/geometry`, or
 * `@four/physics` to receive their numbers. Producers therefore reach this
 * record without being named — usually the way `debug-draw.ts` reaches a
 * solver, through a **locally declared shape satisfied structurally**, and
 * once (A-5) through plain numbers, where there was no foreign shape to
 * describe:
 *
 * - {@link RenderStatisticsLike} transcribes `@four/render`'s
 *   `RenderStatistics` (`drawCalls`, `triangles`, `instances`), which a backend
 *   accumulates into and {@link recordRenderStatistics} copies across. The
 *   WebGL 2 backend counts real `drawArrays`/`drawElements`/
 *   `drawArraysInstanced` calls.
 * - {@link recordSolverStatistics} takes the {@link SolverStatistics} this
 *   package already produces from a §113 `DebugBodyAccess`, so `activeBodies`
 *   is reachable today by anything that can already draw a collider overlay.
 * - {@link recordResourceMemory} takes §83's live-resource totals as two plain
 *   numbers — `@four/render`'s `textureMemoryBytes()` and `@four/geometry`'s
 *   `geometryMemoryBytes()` (A-5, 2026-08-07). No transcribed shape here,
 *   unlike every other seam in this package: the producers own no record to
 *   describe, only two accumulators, so a duck-typed interface would be
 *   ceremony around a pair of numbers — and passing them directly is
 *   allocation-free by construction rather than by discipline.
 * - `cpuFrameTime` and `simulationTime` are the frame loop's own measurements;
 *   `Application` (`four`) makes them.
 *
 * ## What is staged, and why
 *
 * `gpuFrameTime` is produced when a backend publishes a finite
 * `Renderer.lastGpuFrameTimeSeconds` (A-1, 2026-09-06). WebGL 2 uses
 * `EXT_disjoint_timer_query_webgl2`; WebGPU uses `timestamp-query`. Both
 * are asynchronous and often absent (SwiftShader, most WebGL 2 browsers),
 * so a frame with no completed sample — or a renderer that does not
 * declare the member — still reads `NaN`. `contacts` is the solver's live
 * manifold count, written through {@link recordSolverStatistics}.
 *
 * `textureMemory` and `bufferMemory` were staged too until A-5 landed the §83
 * resource accounting they were waiting on (2026-08-07) — see
 * {@link recordResourceMemory} — and `physicsStepTime` until A-6 gave the
 * composition root a world to step (2026-08-08): `four`'s `Application` times
 * `PhysicsWorld.step` itself, which is the solve and nothing else, and
 * accumulates it over the frame's fixed steps exactly as it accumulates
 * `simulationTime` around the whole of them.
 */

import type { DebugBodyAccess, SolverStatistics } from "./debug-draw.js";

/**
 * §84's eleven runtime counters for one frame, mutated in place.
 *
 * Obtain one from {@link createFrameStats} — or, in an application, from
 * `app.stats`, which is `null` until statistics are switched on. Fields are
 * mutable because producers write them from several packages and none of them
 * may allocate (see the module header); treat them as read-only from
 * application code.
 *
 * A field reading `NaN` was **not measured this frame**. See the module header
 * for which producers write which fields.
 */
export interface FrameStats {
  /**
   * Wall-clock seconds the CPU spent producing the frame — the whole of the §10
   * loop for one `step`: fixed steps, systems, `update`/`render` listeners, and
   * the draw submission.
   *
   * Submission, not completion: the GPU is still working when this stops (that
   * is `gpuFrameTime`, when the backend measured one). Measured with the
   * monotonic clock the application was given.
   */
  cpuFrameTime: number;

  /**
   * Seconds the GPU spent on the most recently completed frame.
   *
   * Written from `Renderer.lastGpuFrameTimeSeconds` when that number is
   * finite (A-1). `NaN` when the backend does not measure, the first armed
   * frame has not landed a query, or the last sample was disjoint.
   */
  gpuFrameTime: number;

  /**
   * Wall-clock seconds this frame spent inside its §10 fixed steps — systems,
   * `fixedUpdate` listeners, and everything else the accumulator ran, summed
   * over the 0..`maximumSubSteps` steps of the frame.
   *
   * **A duration, not §9's clock.** §9 also has a `simulationTime` — total
   * simulated time since start, which is what `app.time.simulationTime` reads —
   * and the two are different quantities with one name. This field takes the
   * duration reading because its three neighbours in §84's own list
   * (`cpuFrameTime`, `gpuFrameTime`, `physicsStepTime`) are all durations, and
   * because the §9 clock is already exposed on the time record: reporting it
   * again in a statistics block would be duplication rather than measurement
   * (decision, A-1). A frame that ran no fixed step reports `0`.
   */
  simulationTime: number;

  /**
   * Seconds spent in the physics solver's step, the subset of
   * {@link FrameStats.simulationTime} the solver owns — summed over the frame's
   * fixed steps, like its neighbour.
   *
   * Written by whoever calls `PhysicsWorld.step`; in an application that is
   * `four`'s `Application`, and only when a world is attached to it
   * (`ApplicationOptions.physics`, A-6). Without one the field stays `NaN`:
   * a frame with no solver did not spend zero seconds solving, it did not
   * measure.
   */
  physicsStepTime: number;

  /**
   * Draw calls submitted for the frame, summed over every view and every pass.
   *
   * `NaN` when no renderer counted (a headless application, or a backend that
   * does not report statistics); `0` when a counting backend drew nothing.
   */
  drawCalls: number;

  /**
   * Triangles submitted for the frame — per-instance primitive count times the
   * instance count, so an instanced draw contributes all of its triangles.
   * Line and point primitives contribute none.
   */
  triangles: number;

  /**
   * Primitive-set instances submitted for the frame. A non-instanced draw
   * contributes `1` (GL's own model: `drawArrays` is `drawArraysInstanced` with
   * one instance), an instanced draw contributes its instance count — so
   * `instances - drawCalls` is what instancing bought, and
   * {@link FrameStats.triangles} stays consistent with both.
   */
  instances: number;

  /**
   * Rigid bodies the solver is integrating — §32's awake bodies, excluding
   * sleeping ones. Written by {@link recordSolverStatistics}.
   */
  activeBodies: number;

  /**
   * Contact points the solver resolved — narrow-phase manifold count after the
   * last step. Written by {@link recordSolverStatistics} when the adapter
   * implements {@link DebugBodyAccess.countContacts}; otherwise `NaN`.
   */
  contacts: number;

  /**
   * Bytes of texture memory the engine holds — every live (constructed,
   * undisposed) texture and render target, from §83's resource accounting
   * (A-5). Written by {@link recordResourceMemory}.
   *
   * A **level**, not a per-frame quantity: unlike every other counter here it
   * describes the engine at the end of the frame rather than something the
   * frame did. Two frames that draw the same scene report the same value; a
   * value that climbs across identical frames is §83's "leaked textures".
   */
  textureMemory: number;

  /**
   * Bytes of vertex and index buffer memory the engine holds — every live
   * geometry, from §83's resource accounting (A-5). Written by
   * {@link recordResourceMemory}.
   *
   * A level rather than a per-frame quantity; see
   * {@link FrameStats.textureMemory}.
   */
  bufferMemory: number;
}

/**
 * A fresh §84 record with every counter unmeasured (`NaN`).
 *
 * The only allocation in this module. An application holds exactly one and
 * resets it per frame ({@link resetFrameStats}).
 */
export function createFrameStats(): FrameStats {
  return {
    cpuFrameTime: Number.NaN,
    gpuFrameTime: Number.NaN,
    simulationTime: Number.NaN,
    physicsStepTime: Number.NaN,
    drawCalls: Number.NaN,
    triangles: Number.NaN,
    instances: Number.NaN,
    activeBodies: Number.NaN,
    contacts: Number.NaN,
    textureMemory: Number.NaN,
    bufferMemory: Number.NaN,
  };
}

/**
 * Marks every counter unmeasured, in place — the first thing a frame does.
 *
 * `NaN` rather than `0` for the reason the module header gives: a producer that
 * did not run this frame must not leave last frame's number standing, and must
 * not be mistaken for one that ran and counted nothing. A producer that *will*
 * accumulate over the frame (the loop's own `simulationTime`) seeds its own
 * field with `0` after this call — initializing a field is the producer's job,
 * because only the producer knows it is about to run.
 */
export function resetFrameStats(stats: FrameStats): void {
  stats.cpuFrameTime = Number.NaN;
  stats.gpuFrameTime = Number.NaN;
  stats.simulationTime = Number.NaN;
  stats.physicsStepTime = Number.NaN;
  stats.drawCalls = Number.NaN;
  stats.triangles = Number.NaN;
  stats.instances = Number.NaN;
  stats.activeBodies = Number.NaN;
  stats.contacts = Number.NaN;
  stats.textureMemory = Number.NaN;
  stats.bufferMemory = Number.NaN;
}

/**
 * Copies `source` into `out` and returns `out` — how a frame's values are
 * retained past the frame that measured them.
 *
 * The live record is mutated in place by the loop (plan D7), exactly as §9's
 * `TimeState` is, so keeping a reference to it keeps nothing. This is the
 * `copyTimeState` of §84: `copyFrameStats(app.stats, myGraphSample)`.
 *
 * An `out` parameter rather than a returned literal (§7b): a chart sampling
 * every frame must not allocate every frame.
 */
export function copyFrameStats(
  source: Readonly<FrameStats>,
  out: FrameStats,
): FrameStats {
  out.cpuFrameTime = source.cpuFrameTime;
  out.gpuFrameTime = source.gpuFrameTime;
  out.simulationTime = source.simulationTime;
  out.physicsStepTime = source.physicsStepTime;
  out.drawCalls = source.drawCalls;
  out.triangles = source.triangles;
  out.instances = source.instances;
  out.activeBodies = source.activeBodies;
  out.contacts = source.contacts;
  out.textureMemory = source.textureMemory;
  out.bufferMemory = source.bufferMemory;
  return out;
}

/**
 * The three §84 counters a renderer produces — `@four/render`'s
 * `RenderStatistics`, transcribed.
 *
 * Declared here and satisfied structurally, because this package may not import
 * `@four/render` (plan §3.1). The fourth instance of the duck-typed-contract
 * pattern this repository uses across a frozen dependency matrix, after
 * `ParticleDrawable`, `ReplayTarget`, and `DebugGeometrySink`; `@four/render`'s
 * own tests pin the drift by assigning the real type to a matching shape.
 */
export interface RenderStatisticsLike {
  /** Draw calls the backend submitted. */
  readonly drawCalls: number;
  /** Triangles the backend submitted, instances included. */
  readonly triangles: number;
  /** Primitive-set instances the backend submitted. */
  readonly instances: number;
}

/**
 * Copies a backend's per-frame render counters into the §84 record.
 *
 * The renderer *accumulates* into its own record across every `render` call of
 * the frame (an off-screen pass and an on-screen pass both count), and whoever
 * owns that record clears it once per frame; this call is the last step, after
 * the frame's draws.
 */
export function recordRenderStatistics(
  stats: FrameStats,
  render: RenderStatisticsLike,
): void {
  stats.drawCalls = render.drawCalls;
  stats.triangles = render.triangles;
  stats.instances = render.instances;
}

/**
 * Writes §83's live-resource totals into the §84 record (A-5, 2026-08-07).
 *
 * ```ts
 * recordResourceMemory(
 *   app.stats,
 *   textureMemoryBytes(),    // @four/render
 *   geometryMemoryBytes(),   // @four/geometry
 * );
 * ```
 *
 * Two numbers rather than a transcribed record, for the reason the module
 * header gives: the producers hold accumulators, not objects, so there is no
 * foreign shape to agree with and nothing to allocate.
 *
 * Call it **after** the frame's work, like {@link recordRenderStatistics}: the
 * two counters are *levels*, so the answer that means anything is the one taken
 * once the frame's creations and disposals have happened. Passing the same
 * numbers twice overwrites rather than accumulates, which is what makes a total
 * that fell report as fallen.
 *
 * The totals are process-wide rather than per-application, because a resource
 * belongs to whoever created it and not to an `Application` (§83) — two
 * applications sharing an atlas are each honestly told about the whole of it.
 * They are also an accounting of what the engine *holds*, not a query of the
 * driver: a geometry created and never drawn has no GPU buffer yet. The
 * producing modules (`resource-memory.ts`, in both packages) state both
 * properties at length.
 */
export function recordResourceMemory(
  stats: FrameStats,
  textureBytes: number,
  bufferBytes: number,
): void {
  stats.textureMemory = textureBytes;
  stats.bufferMemory = bufferBytes;
}

/**
 * Counts {@link @four/diagnostics!SolverStatistics | SolverStatistics} in one
 * pass per collection, from §113's `DebugBodyAccess` — which every
 * `PhysicsSolverAdapter` satisfies structurally, so `world.adapter` is what you
 * pass.
 *
 * ```ts
 * recordSolverStatistics(app.stats, solverStatistics(world.adapter, record));
 * ```
 *
 * `out` follows §7b's out-parameter convention: pass a record to reuse and this
 * allocates nothing; omit it and one plain object is allocated (a record, not a
 * math type — the `constructionCount()` allocation tests do not see it).
 *
 * **Why it lives here and not in `debug-draw.ts`**, where it shipped until
 * 2026-08-08 (A-6): that module allocates module-level scratch math objects and
 * freezes its staged-feature list, so a bundler keeps the whole file the moment
 * anything in it is named — 939 B gzip, measured on `examples/ui-demo`, for a
 * frame loop that wanted one integer. `four`'s `Application` reports §84's
 * `activeBodies` from here every frame that asks for statistics; a debug overlay
 * is a different and much rarer thing to be paying for. The seam types stay in
 * `debug-draw.ts` — a type costs nothing to import.
 */
export function solverStatistics<THandle, TColliderHandle>(
  access: DebugBodyAccess<THandle, TColliderHandle>,
  out?: SolverStatistics,
): SolverStatistics {
  const stats: SolverStatistics = out ?? {
    bodyCount: 0,
    sleepingCount: 0,
    awakeCount: 0,
    colliderCount: 0,
    maxBodyId: -1,
    contactCount: Number.NaN,
  };
  stats.bodyCount = 0;
  stats.sleepingCount = 0;
  stats.awakeCount = 0;
  stats.colliderCount = 0;
  stats.maxBodyId = -1;
  stats.contactCount = access.countContacts?.() ?? Number.NaN;
  access.forEachBody((handle, id) => {
    stats.bodyCount += 1;
    if (access.isBodySleeping(handle)) {
      stats.sleepingCount += 1;
    }
    if (id > stats.maxBodyId) {
      stats.maxBodyId = id;
    }
  });
  stats.awakeCount = stats.bodyCount - stats.sleepingCount;
  access.forEachCollider(() => {
    stats.colliderCount += 1;
  });
  return stats;
}

/**
 * Fills `activeBodies` and `contacts` from the §113 solver statistics this
 * package already computes (`solverStatistics`, `debug-draw.ts`).
 *
 * §84's "active bodies" is §32's awake set — the bodies actually being
 * integrated — which is precisely `SolverStatistics.awakeCount`. Nothing else
 * in {@link SolverStatistics} maps onto a §84 counter: `bodyCount`,
 * `colliderCount`, and `maxBodyId` are solver inventory rather than frame cost;
 * `contactCount` is the one other §84 counter this walk can reach when the
 * adapter implements {@link DebugBodyAccess.countContacts}.
 *
 * ```ts
 * const solver = solverStatistics(bodyAccess, solverOut);
 * recordSolverStatistics(app.stats, solver);
 * ```
 */
export function recordSolverStatistics(
  stats: FrameStats,
  solver: Readonly<SolverStatistics>,
): void {
  stats.activeBodies = solver.awakeCount;
  stats.contacts = solver.contactCount;
}

/** What {@link createMonotonicClock} looks for on its source object. */
export interface ClockSource {
  /**
   * A `performance`-like object. Only `now()` is read, and only when it is a
   * function — anything else falls back to `Date`.
   */
  readonly performance?: { readonly now?: unknown } | undefined;
}

/**
 * The clock a host with no `performance.now()` gets: every reading `NaN`, so
 * the durations derived from it read "not measured" exactly like every other
 * counter with no producer.
 *
 * A module-level constant rather than a fresh closure per call, so a host that
 * takes this branch allocates nothing either.
 */
const UNMEASURABLE_CLOCK = (): number => Number.NaN;

/**
 * Builds the **seconds**-valued monotonic clock the frame loop times itself
 * with.
 *
 * `performance.now()` divided by 1000 — §7a admits no milliseconds anywhere in
 * this engine, and the conversion belongs at the boundary rather than in every
 * reader.
 *
 * The source is a parameter, defaulting to `globalThis`, for the reason
 * `PointerInput` takes a `PointerSurface` and `AssetManager` a `FetchLike`:
 * this package names no host object it cannot be handed a stand-in for, and a
 * test that needs a clock it controls passes one. An application that wants a
 * different clock entirely — a profiler's, a fake one, a worker's — passes a
 * function instead (`ApplicationOptions.now`).
 *
 * ## Why there is no `Date.now()` fallback (decision, A-1)
 *
 * `Date.now` is **banned repository-wide** by an ESLint rule whose message is
 * "Determinism (§33): no wall clock in simulation code — inject time via
 * `TimeState`", and `@four/animation`, `@four/particles`, and `@four/motion`
 * each state in their headers that they touch neither it nor
 * `performance.now`. The obvious fallback is therefore not available, and that
 * is the right answer rather than an inconvenience: `Date.now` is not
 * monotonic at all (a clock adjustment moves it backwards, which surfaces as a
 * negative `cpuFrameTime`), so it would replace "I could not measure this" with
 * a number that is occasionally wrong.
 *
 * A host without `performance` gets a clock that reads `NaN` instead, and the
 * §84 durations read `NaN` — "not measured", the same answer the record gives
 * for every counter with no producer. Every browser and every Node ≥ 16 takes
 * the `performance` branch, so this is a stance about honesty in an unreachable
 * corner rather than a working fallback.
 *
 * ## Why a wall clock here is not a §33 violation
 *
 * §33's rule is about *simulation*: a fixed step must not read the wall clock,
 * because a replay could not reproduce it. Nothing in this module feeds a
 * simulation — the values are written into a diagnostics record and read by
 * overlays and charts, never by a system, an integrator, or a checksum. §84
 * asks for `cpuFrameTime`, which is a wall-clock measurement by definition;
 * measuring it with `TimeState` would measure the simulation's own clock and
 * answer a different question.
 */
export function createMonotonicClock(
  source: ClockSource = globalThis,
): () => number {
  const performance = source.performance;
  if (performance !== undefined && typeof performance.now === "function") {
    const now = (performance.now as () => number).bind(performance);
    return () => now() / 1000;
  }
  return UNMEASURABLE_CLOCK;
}

/**
 * The default seconds-valued monotonic clock — {@link createMonotonicClock}
 * over `globalThis`, resolved once at module load.
 *
 * The `@__PURE__` annotation is load-bearing (A-4, 2026-08-07): a top-level
 * *call* is something a bundler must assume might have side effects, so without
 * it this initializer survived into every production bundle — the call, and
 * with it `createMonotonicClock`'s body — even after `Application` stopped
 * naming the binding outside its `DEV` guards. It reads one property off
 * `globalThis` and binds a method, which is exactly what the annotation
 * promises. Nothing about the runtime behaviour changes.
 */
export const monotonicNowSeconds: () => number =
  /* @__PURE__ */ createMonotonicClock();
